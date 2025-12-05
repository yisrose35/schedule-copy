// ============================================================================
// scheduler_core_main.js
// PART 3 of 3: THE ORCHESTRATOR (Main Entry)
//
// UPDATES:
// - Implemented Continuous Transition Merging (Zone Handshake.
// - Implemented Atomic Block Filling (Pre/Activity/Post).
// - Added Transition Concurrency Tracking.
// - FIXED: Smart Tile Integration (Pass 2.5 restored).
// - FIX: Corrected canBlockFit argument signature (removed fieldUsageBySlot).
// - FIX: Corrected findBest... function argument signatures (removed fieldUsageBySlot).
// ============================================================================

(function () {
    'use strict';

    const GENERATED_EVENTS = [
        'General Activity Slot',
        'Sports Slot',
        'Special Activity',
        'Swim',
        'League Game',
        'Specialty League'
    ];

    const INCREMENT_MINS = 30;
    const TRANSITION_TYPE = window.TRANSITION_TYPE;

    // =================================================================
    // LOCAL HELPERS
    // =================================================================

    function fieldLabel(f) {
        return window.SchedulerCoreUtils.fieldLabel(f);
    }

    function normalizeGA(name) {
        if (!name) return null;
        const s = String(name).toLowerCase().replace(/\s+/g, '');
        const keys = [
            "generalactivity", "activity", "activyty", "activty",
            "activityslot", "genactivity", "genact", "ga"
        ];
        return keys.some(k => s.includes(k)) ? "General Activity Slot" : null;
    }

    function normalizeLeague(name) {
        if (!name) return null;
        const s = String(name).toLowerCase().replace(/\s+/g, '');
        const keys = ["leaguegame", "leaguegameslot", "leagame", "lg", "lgame"];
        return keys.some(k => s.includes(k)) ? "League Game" : null;
    }

    function normalizeSpecialtyLeague(name) {
        if (!name) return null;
        const s = String(name).toLowerCase().replace(/\s+/g, '');
        const keys = ["specialtyleague", "specialityleague", "specleague", "specialleague", "sleauge"];
        return keys.some(k => s.includes(k)) ? "Specialty League" : null;
    }

    function shuffleArray(array) {
        if (!Array.isArray(array)) return [];
        const arr = array.slice();
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }

    function getGeneralActivitiesDoneToday(bunkName) {
        const done = new Set();
        const sched = window.scheduleAssignments[bunkName];
        if (Array.isArray(sched)) {
            sched.forEach(s => {
                if (s?._activity) done.add(s._activity);
            });
        }
        return done;
    }

    function sortPicksByFreshness(picks, bunkHistory) {
        return picks.sort((a, b) => {
            const timeA = bunkHistory[a._activity] || 0;
            const timeB = bunkHistory[b._activity] || 0;
            if (timeA !== timeB) return timeA - timeB;
            return Math.random() - 0.5;
        });
    }

    function sortPicksByIsolation(picks, slotIndex, fieldUsageBySlot, activityProperties) {
        return picks.sort((a, b) => {
            const nameA = fieldLabel(a.field);
            const nameB = fieldLabel(b.field);
            const usageA = fieldUsageBySlot[slotIndex]?.[nameA] || { count: 0 };
            const usageB = fieldUsageBySlot[slotIndex]?.[nameB] || { count: 0 };
            return usageA.count - usageB.count;
        });
    }

    // =================================================================
    // FILL BLOCK
    // =================================================================

    function fillBlock(block, pick, fieldUsageBySlot, yesterdayHistory, isLeagueFill = false, activityProperties) {
        const fieldName = window.SchedulerCoreUtils.fieldLabel(pick.field);
        const sport = pick.sport;
        const bunk = block.bunk;

        const transRules = window.SchedulerCoreUtils.getTransitionRules(fieldName, activityProperties);
        const { blockStartMin, blockEndMin, effectiveStart, effectiveEnd } =
            window.SchedulerCoreUtils.getEffectiveTimeRange(block, transRules);

        const preMin = transRules.preMin || 0;
        const postMin = transRules.postMin || 0;
        const zone = transRules.zone;

        let writePre = preMin > 0;
        let writePost = postMin > 0;

        const firstSlotIndex = block.slots[0];
        const prevEntry = window.scheduleAssignments[bunk]?.[firstSlotIndex - 1];

        if (writePre && firstSlotIndex > 0) {
            if (
                prevEntry?._zone === zone &&
                prevEntry?._activity === TRANSITION_TYPE &&
                prevEntry?._transitionType === 'Post'
            ) {
                writePre = false;

                const prevPostSlots = window.SchedulerCoreUtils.findSlotsForRange(
                    blockStartMin - postMin,
                    blockStartMin
                );
                prevPostSlots.forEach(slotIndex => {
                    if (window.scheduleAssignments[bunk][slotIndex]?._transitionType === 'Post') {
                        window.scheduleAssignments[bunk][slotIndex] = null;
                    }
                });
            }
        }

        // pre-buffer
        if (writePre) {
            const preSlots = window.SchedulerCoreUtils.findSlotsForRange(blockStartMin, effectiveStart);
            preSlots.forEach((slotIndex, idx) => {
                window.scheduleAssignments[bunk][slotIndex] = {
                    field: TRANSITION_TYPE,
                    sport: transRules.label,
                    continuation: idx > 0,
                    _fixed: true,
                    _activity: TRANSITION_TYPE,
                    _isTransition: true,
                    _transitionType: 'Pre',
                    _zone: zone,
                    _endTime: effectiveStart
                };
            });
        }

        // main activity
        const activitySlots = window.SchedulerCoreUtils.findSlotsForRange(effectiveStart, effectiveEnd);
        activitySlots.forEach((slotIndex, idx) => {
            const existing = window.scheduleAssignments[bunk][slotIndex];
            if (!existing || existing._isTransition) {
                window.scheduleAssignments[bunk][slotIndex] = {
                    field: fieldName,
                    sport,
                    continuation: idx > 0,
                    _fixed: pick._fixed || false,
                    _h2h: pick._h2h || false,
                    _activity: pick._activity || fieldName,
                    _allMatchups: pick._allMatchups || null,
                    _gameLabel: pick._gameLabel || null,
                    _zone: zone,
                    _endTime: effectiveEnd
                };

                if (!isLeagueFill && transRules.occupiesField) {
                    window.registerSingleSlotUsage(
                        slotIndex,
                        fieldName,
                        block.divName,
                        bunk,
                        pick._activity,
                        fieldUsageBySlot,
                        activityProperties
                    );
                }
            }
        });

        // post-buffer
        if (writePost) {
            const postSlots = window.SchedulerCoreUtils.findSlotsForRange(effectiveEnd, blockEndMin);
            postSlots.forEach((slotIndex, idx) => {
                window.scheduleAssignments[bunk][slotIndex] = {
                    field: TRANSITION_TYPE,
                    sport: transRules.label,
                    continuation: idx > 0,
                    _fixed: true,
                    _activity: TRANSITION_TYPE,
                    _isTransition: true,
                    _transitionType: 'Post',
                    _zone: zone,
                    _endTime: blockEndMin
                };
            });
        }

        if (!isLeagueFill && !transRules.occupiesField) {
            activitySlots.forEach(slotIndex => {
                window.registerSingleSlotUsage(
                    slotIndex,
                    fieldName,
                    block.divName,
                    bunk,
                    pick._activity,
                    fieldUsageBySlot,
                    activityProperties
                );
            });
        }
    }

    window.fillBlock = fillBlock;

    // =================================================================
    // MAIN ENTRY
    // =================================================================

    window.runSkeletonOptimizer = function (manualSkeleton, externalOverrides) {
        window.scheduleAssignments = {};
        window.leagueAssignments = {};
        window.unifiedTimes = [];
        const dailyLeagueSportsUsage = {};

        if (!manualSkeleton || manualSkeleton.length === 0) return false;

        // 1. load config
        const config = window.SchedulerCoreUtils.loadAndFilterData();
       // Use the new loader results
const {
    divisions,
    bunks,
    fields,

    // loader results
    activities,
    blocks,

    // the following still come from loader → utils → loader pipeline
    activityProperties,
    allActivities,
    h2hActivities,
    fieldsBySport,
    masterLeagues,
    masterSpecialtyLeagues,
    masterSpecials,
    yesterdayHistory,
    rotationHistory,
    disabledLeagues,
    disabledSpecialtyLeagues,
    historicalCounts,
    specialActivityNames,
    disabledFields,
    disabledSpecials,
    dailyFieldAvailability,
    bunkMetaData,
    masterZones
} = config;


        let fieldUsageBySlot = {};
        window.fieldUsageBySlot = fieldUsageBySlot;
        window.activityProperties = activityProperties;
        window.registerSingleSlotUsage = registerSingleSlotUsage;

        // 2. unified grid
        const timePoints = new Set([540, 960]);

        manualSkeleton.forEach(item => {
            const s = window.SchedulerCoreUtils.parseTimeToMinutes(item.startTime);
            const e = window.SchedulerCoreUtils.parseTimeToMinutes(item.endTime);
            if (s !== null) timePoints.add(s);
            if (e !== null) timePoints.add(e);
        });

        const sortedPoints = Array.from(timePoints).sort((a, b) => a - b);
        window.unifiedTimes = [];

        for (let i = 0; i < sortedPoints.length - 1; i++) {
            const start = sortedPoints[i];
            const end = sortedPoints[i + 1];
            if (end - start >= 5) {
                window.unifiedTimes.push({
                    start: window.SchedulerCoreUtils.minutesToDate(start),
                    end: window.SchedulerCoreUtils.minutesToDate(end),
                    label: `${window.SchedulerCoreUtils.fmtTime(window.SchedulerCoreUtils.minutesToDate(start))} - ${window.SchedulerCoreUtils.fmtTime(window.SchedulerCoreUtils.minutesToDate(end))}`
                });
            }
        }

        if (window.unifiedTimes.length === 0) return false;

        Object.keys(divisions).forEach(divName => {
            (divisions[divName]?.bunks || []).forEach(bunk => {
                window.scheduleAssignments[bunk] = new Array(window.unifiedTimes.length);
            });
        });

        // 3. override pins
        const bunkOverrides = window.loadCurrentDailyData?.().bunkActivityOverrides || [];
        bunkOverrides.forEach(override => {
            const fieldName = override.activity;
            const transRules = window.SchedulerCoreUtils.getTransitionRules(fieldName, activityProperties);
            const startMin = window.SchedulerCoreUtils.parseTimeToMinutes(override.startTime);
            const endMin = window.SchedulerCoreUtils.parseTimeToMinutes(override.endTime);
            const { effectiveStart, effectiveEnd } = window.SchedulerCoreUtils.getEffectiveTimeRange(
                { startTime: startMin, endTime: endMin },
                transRules
            );

            const slots = window.SchedulerCoreUtils.findSlotsForRange(startMin, endMin);
            const bunk = override.bunk;
            const divName = Object.keys(divisions).find(d => divisions[d].bunks.includes(bunk));

            if (window.scheduleAssignments[bunk] && slots.length > 0) {
                fillBlock(
                    { divName, bunk, startTime: startMin, endTime: endMin, slots },
                    { field: fieldName, sport: null, _fixed: true, _h2h: false, _activity: fieldName },
                    fieldUsageBySlot,
                    yesterdayHistory,
                    false,
                    activityProperties
                );
            }
        });

        // 4. pass 2
        const schedulableSlotBlocks = [];

        manualSkeleton.forEach(item => {
            const allBunks = divisions[item.division]?.bunks || [];
            if (!allBunks.length) return;

            const startMin = window.SchedulerCoreUtils.parseTimeToMinutes(item.startTime);
            const endMin = window.SchedulerCoreUtils.parseTimeToMinutes(item.endTime);
            const allSlots = window.SchedulerCoreUtils.findSlotsForRange(startMin, endMin);
            if (allSlots.length === 0) return;

            const normGA = normalizeGA(item.event);
            const normLeague = normalizeLeague(item.event);
            const normSpecLg = normalizeSpecialtyLeague(item.event);
            const finalEventName = normGA || normSpecLg || normLeague || item.event;

            const isGeneratedEvent =
                GENERATED_EVENTS.includes(finalEventName) ||
                normGA === "General Activity Slot" ||
                normLeague === "League Game" ||
                normSpecLg === "Specialty League";

            const transRules = window.SchedulerCoreUtils.getTransitionRules(item.event, activityProperties);
            const hasBuffer = transRules.preMin > 0 || transRules.postMin > 0;

            if ((item.type === 'pinned' || !isGeneratedEvent) && item.type !== 'smart' && !hasBuffer) {
                if (disabledFields.includes(item.event) || disabledSpecials.includes(item.event)) return;

                allBunks.forEach(bunk => {
                    allSlots.forEach((slotIndex, idx) => {
                        if (!window.scheduleAssignments[bunk][slotIndex]) {
                            window.scheduleAssignments[bunk][slotIndex] = {
                                field: { name: item.event },
                                sport: null,
                                continuation: idx > 0,
                                _fixed: true,
                                _h2h: false,
                                vs: null,
                                _activity: item.event,
                                _endTime: endMin
                            };
                            registerSingleSlotUsage(
                                slotIndex,
                                item.event,
                                item.division,
                                bunk,
                                item.event,
                                fieldUsageBySlot,
                                activityProperties
                            );
                        }
                    });
                });
            }
            else if (item.type === 'split') {
                const mid = Math.ceil(allBunks.length / 2);
                const bunksTop = allBunks.slice(0, mid);
                const bunksBottom = allBunks.slice(mid);
                const slotMid = Math.ceil(allSlots.length / 2);
                const slotsFirst = allSlots.slice(0, slotMid);
                const slotsSecond = allSlots.slice(slotMid);

                const swimLabel = "Swim";
                const gaLabel = normalizeGA(item.subEvents[1]?.event) || "General Activity Slot";

                function pinEvent(bunks, slots, eventName) {
                    const { blockStartMin, blockEndMin } = window.SchedulerCoreUtils.getBlockTimeRange({ slots });
                    bunks.forEach(bunk => {
                        fillBlock(
                            { divName: item.division, bunk, startTime: blockStartMin, endTime: blockEndMin, slots },
                            { field: eventName, sport: null, _fixed: true, _h2h: false, _activity: eventName },
                            fieldUsageBySlot,
                            yesterdayHistory,
                            false,
                            activityProperties
                        );
                    });
                }

                function pushGenerated(bunks, slots, eventName) {
                    const { blockStartMin, blockEndMin } = window.SchedulerCoreUtils.getBlockTimeRange({ slots });
                    bunks.forEach(bunk => {
                        schedulableSlotBlocks.push({
                            divName: item.division,
                            bunk,
                            event: eventName,
                            startTime: blockStartMin,
                            endTime: blockEndMin,
                            slots
                        });
                    });
                }

                pinEvent(bunksTop, slotsFirst, swimLabel);
                pushGenerated(bunksBottom, slotsFirst, gaLabel);
                pushGenerated(bunksTop, slotsSecond, gaLabel);
                pinEvent(bunksBottom, slotsSecond, swimLabel);
            }
            else if ((item.type === 'slot' && isGeneratedEvent) || hasBuffer) {
                let normalizedEvent = normSpecLg || normLeague || normGA || item.event;

                allBunks.forEach(bunk => {
                    schedulableSlotBlocks.push({
                        divName: item.division,
                        bunk,
                        event: normalizedEvent,
                        startTime: startMin,
                        endTime: endMin,
                        slots: allSlots,
                        _transRules: transRules
                    });
                });
            }
        });

        // =======================================================================
        // 5. PASS 2.5 — SMART TILES (*** FIXED ***)
        // =======================================================================

        let smartJobs = window.SmartLogicAdapter?.preprocessSmartTiles?.(
            manualSkeleton,
            externalOverrides,
            masterSpecials
        ) || [];

        smartJobs.forEach(job => {
            const bunks = divisions[job.division]?.bunks || [];
            if (!bunks.length) return;

            const result = window.SmartLogicAdapter.generateAssignments(
                bunks,
                job,
                historicalCounts,
                specialActivityNames,
                activityProperties,
                config.masterFields,
                dailyFieldAvailability,
                yesterdayHistory
            );

            const { block1Assignments, block2Assignments } = result || {};

            function pushGenerated(bunk, event, startMin, endMin) {
                const slots = window.SchedulerCoreUtils.findSlotsForRange(startMin, endMin);
                schedulableSlotBlocks.push({
                    divName: job.division,
                    bunk,
                    event,
                    startTime: startMin,
                    endTime: endMin,
                    slots,
                    fromSmartTile: true
                });
            }

            const slotsA = window.SchedulerCoreUtils.findSlotsForRange(job.blockA.startMin, job.blockA.endMin);
            Object.entries(block1Assignments || {}).forEach(([bunk, act]) => {
                const lower = act.toLowerCase();
                if (lower.includes("sport")) {
                    pushGenerated(bunk, "Sports Slot", job.blockA.startMin, job.blockA.endMin);
                } else if (lower.includes("special")) {
                    pushGenerated(bunk, "Special Activity Slot", job.blockA.startMin, job.blockA.endMin);
                } else if (lower.includes("general activity")) {
                    pushGenerated(bunk, "General Activity Slot", job.blockA.startMin, job.blockA.endMin);
                } else {
                    fillBlock(
                        { divName: job.division, bunk, startTime: job.blockA.startMin, endTime: job.blockA.endMin, slots: slotsA },
                        { field: act, sport: null, _fixed: true, _h2h: false, _activity: act },
                        fieldUsageBySlot,
                        yesterdayHistory,
                        false,
                        activityProperties
                    );
                }
            });

            if (job.blockB && block2Assignments) {
                const slotsB = window.SchedulerCoreUtils.findSlotsForRange(job.blockB.startMin, job.blockB.endMin);
                Object.entries(block2Assignments).forEach(([bunk, act]) => {
                    const lower = act.toLowerCase();
                    if (lower.includes("sport")) {
                        pushGenerated(bunk, "Sports Slot", job.blockB.startMin, job.blockB.endMin);
                    } else if (lower.includes("special")) {
                        pushGenerated(bunk, "Special Activity Slot", job.blockB.startMin, job.blockB.endMin);
                    } else if (lower.includes("general activity")) {
                        pushGenerated(bunk, "General Activity Slot", job.blockB.startMin, job.blockB.endMin);
                    } else {
                        fillBlock(
                        // The pick here is for a fixed activity coming from the smart tile logic,
                        // so fieldUsageBySlot is passed correctly to fillBlock for registration.
                            { divName: job.division, bunk, startTime: job.blockB.startMin, endTime: job.blockB.endMin, slots: slotsB },
                            { field: act, sport: null, _fixed: true, _h2h: false, _activity: act },
                            fieldUsageBySlot,
                            yesterdayHistory,
                            false,
                            activityProperties
                        );
                    }
                });
            }
        });

        // =======================================================================
        // 6. LEAGUES
        // =======================================================================

        const leagueContext = {
            schedulableSlotBlocks,
            fieldUsageBySlot,
            activityProperties,
            masterSpecialtyLeagues,
            disabledSpecialtyLeagues,
            masterLeagues,
            disabledLeagues,
            rotationHistory,
            yesterdayHistory,
            divisions,
            fieldsBySport,
            dailyLeagueSportsUsage,
            fillBlock
        };

        window.SchedulerCoreLeagues?.processSpecialtyLeagues?.(leagueContext);
        window.SchedulerCoreLeagues?.processRegularLeagues?.(leagueContext);

        // =======================================================================
        // 7. FILL
        // =======================================================================

        const remainingBlocks = schedulableSlotBlocks.filter(
            b => !['League Game', 'Specialty League'].includes(b.event) && !b.processed
        );

        remainingBlocks.sort((a, b) => {
            if (a.startTime !== b.startTime) return a.startTime - b.startTime;
            if (a.fromSmartTile && !b.fromSmartTile) return -1;
            if (!a.fromSmartTile && b.fromSmartTile) return 1;
            const sizeA = bunkMetaData[a.bunk]?.size || 0;
            const sizeB = bunkMetaData[b.bunk]?.size || 0;
            if (sizeA !== sizeB) return sizeB - sizeA;
            const countA = historicalCounts[a.bunk]?.['_totalSpecials'] || 0;
            const countB = historicalCounts[b.bunk]?.['_totalSpecials'] || 0;
            return countA - countB;
        });

        window.__transitionUsage = {};

        for (const block of remainingBlocks) {
            if (!block.slots?.length) continue;
            if (!window.scheduleAssignments[block.bunk]) continue;
            if (window.scheduleAssignments[block.bunk][block.slots[0]]?._activity !== TRANSITION_TYPE) continue;

            let pick = null;

            if (block.event === 'Special Activity' || block.event === 'Special Activity Slot') {
                // FIX #1 & #2: Removed fieldUsageBySlot and divisions. Corrected argument order.
                pick = window.findBestSpecial?.(
                    block,
                    allActivities,
                    yesterdayHistory,
                    activityProperties,
                    rotationHistory,
                    historicalCounts
                );
            } else if (block.event === 'Sports Slot' || block.event === 'Sports') {
                // FIX #1 & #2: Removed fieldUsageBySlot and divisions. Corrected argument order.
                pick = window.findBestSportActivity?.(
                    block,
                    allActivities,
                    yesterdayHistory,
                    activityProperties,
                    rotationHistory,
                    historicalCounts
                );
            }

            if (!pick) {
                // FIX #1 & #2: Removed fieldUsageBySlot and divisions. Corrected argument order.
                pick = window.findBestGeneralActivity(
                    block,
                    allActivities,
                    h2hActivities,
                    yesterdayHistory,
                    activityProperties,
                    rotationHistory,
                    historicalCounts
                );
            }

            // FIX #1: Corrected canBlockFit signature: fieldUsageBySlot removed.
            let fits = pick && window.SchedulerCoreUtils.canBlockFit(
                block,
                window.SchedulerCoreUtils.fieldLabel(pick.field),
                activityProperties,
                pick._activity,
                false
            );

            const transRules = window.SchedulerCoreUtils.getTransitionRules(fieldLabel(pick?.field), activityProperties);
            if (pick && (transRules.preMin > 0 || transRules.postMin > 0)) {
                const zone = transRules.zone;
                const maxConcurrent = masterZones[zone]?.maxConcurrent || 99;

                if (maxConcurrent < 99) {
                    const { blockStartMin } = window.SchedulerCoreUtils.getBlockTimeRange(block);
                    const isMerged = blockStartMin > 0 &&
                        window.scheduleAssignments[block.bunk]?.[block.slots[0] - 1]?._zone === zone;

                    if (!isMerged && (window.__transitionUsage[zone] || 0) + 1 > maxConcurrent) {
                        fits = false;
                    }
                }
            }

            if (!fits) pick = null;

            if (fits && pick) {
                if (transRules.preMin > 0 || transRules.postMin > 0) {
                    const { blockStartMin } = window.SchedulerCoreUtils.getBlockTimeRange(block);
                    const isMerged = blockStartMin > 0 &&
                        window.scheduleAssignments[block.bunk]?.[block.slots[0] - 1]?._zone === transRules.zone;

                    if (!isMerged) {
                        window.__transitionUsage[transRules.zone] = (window.__transitionUsage[transRules.zone] || 0) + 1;
                    }
                }

                fillBlock(block, pick, fieldUsageBySlot, yesterdayHistory, false, activityProperties);

                if (pick._activity && block.bunk) {
                    historicalCounts[block.bunk] ??= {};
                    historicalCounts[block.bunk][pick._activity] = (historicalCounts[block.bunk][pick._activity] || 0) + 1;

                    const isSpecial = masterSpecials.some(s => s.name === pick._activity);
                    if (isSpecial) {
                        historicalCounts[block.bunk]['_totalSpecials'] = (historicalCounts[block.bunk]['_totalSpecials'] || 0) + 1;
                    }
                }
            } else {
                if (window.scheduleAssignments[block.bunk]?.[block.slots[0]]?._activity === TRANSITION_TYPE) {
                    window.scheduleAssignments[block.bunk][block.slots[0]] = null;
                }
                fillBlock(
                    block,
                    { field: "Free", sport: null, _activity: "Free" },
                    fieldUsageBySlot,
                    yesterdayHistory,
                    false,
                    activityProperties
                );
            }
        }

        // =======================================================================
        // 8. ROTATION HISTORY
        // =======================================================================

        try {
            const historyToSave = { ...rotationHistory };
            const timestamp = Date.now();

            Object.keys(divisions).forEach(divName => {
                (divisions[divName]?.bunks || []).forEach(bunk => {
                    const schedule = window.scheduleAssignments[bunk] || [];
                    let lastActivity = null;

                    for (const entry of schedule) {
                        if (entry?._activity && entry._activity !== lastActivity && entry._activity !== TRANSITION_TYPE) {
                            const activityName = entry._activity;
                            lastActivity = activityName;

                            historyToSave.bunks ??= {};
                            historyToSave.bunks[bunk] ??= {};
                            historyToSave.bunks[bunk][activityName] = timestamp;

                            if (entry._h2h && !["League", "No Game"].includes(activityName)) {
                                const leagueEntry = Object.entries(masterLeagues).find(
                                    ([_, l]) => l.enabled && l.divisions?.includes(divName)
                                );
                                if (leagueEntry) {
                                    const lgName = leagueEntry[0];
                                    historyToSave.leagues ??= {};
                                    historyToSave.leagues[lgName] ??= {};
                                    historyToSave.leagues[lgName][activityName] = timestamp;
                                }
                            }
                        } else if (entry && !entry.continuation && entry._activity !== TRANSITION_TYPE) {
                            lastActivity = null;
                        }
                    }
                });
            });

            window.saveRotationHistory?.(historyToSave);
            console.log("Smart Scheduler: Rotation history updated.");
        } catch (e) {
            console.error("Smart Scheduler: Failed to update rotation history.", e);
        }

        window.saveCurrentDailyData?.("unifiedTimes", window.unifiedTimes);
        window.updateTable?.();
        window.saveSchedule?.();

        return true;
    };

    // =================================================================
    // usage tracking
    // =================================================================

    function registerSingleSlotUsage(slotIndex, fieldName, divName, bunkName, activityName, fieldUsageBySlot, activityProperties) {
        if (!fieldName || !window.allSchedulableNames?.includes(fieldName)) return;

        fieldUsageBySlot[slotIndex] ??= {};
        const usage = fieldUsageBySlot[slotIndex][fieldName] ?? { count: 0, divisions: [], bunks: {} };

        const props = activityProperties[fieldName];
        const sharableCap = props?.sharableWith?.capacity ??
            (props?.sharableWith?.type === "all" ? 2 : props?.sharable ? 2 : 1);

        if (usage.count < sharableCap) {
            usage.count++;
            if (bunkName) usage.bunks[bunkName] = activityName || fieldName;
            if (divName && !usage.divisions.includes(divName)) {
                usage.divisions.push(divName);
            }
            fieldUsageBySlot[slotIndex][fieldName] = usage;
        }
    }

})();
