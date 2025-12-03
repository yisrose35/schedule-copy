// ============================================================================
// scheduler_core_main.js
// PART 3 of 3: THE ORCHESTRATOR (Main Entry)
//
// Role:
// - Entry point (runSkeletonOptimizer)
// - Custom Pickers (Sports, General, Special)
// - STRICT ISOLATION PREFERENCE (Empty First -> Then Share)
// - Rescue Strategy
// ============================================================================

(function() {
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

    // =================================================================
    // LOCAL HELPERS
    // =================================================================
    
    function fieldLabel(f) {
        return window.SchedulerCoreUtils.fieldLabel(f);
    }

    function normalizeGA(name) {
        if (!name) return null;
        const s = String(name).toLowerCase().replace(/\s+/g, '');
        const keys = ["generalactivity", "activity", "activyty", "activty", "activityslot", "genactivity", "genact", "ga"];
        if (keys.some(k => s.includes(k))) return "General Activity Slot";
        return null;
    }
    function normalizeLeague(name) {
        if (!name) return null;
        const s = String(name).toLowerCase().replace(/\s+/g, '');
        const keys = ["leaguegame", "leaguegameslot", "leagame", "lg", "lgame"];
        if (keys.some(k => s.includes(k))) return "League Game";
        return null;
    }
    function normalizeSpecialtyLeague(name) {
        if (!name) return null;
        const s = String(name).toLowerCase().replace(/\s+/g, '');
        const keys = ["specialtyleague", "specialityleague", "specleague", "specialleague", "sleauge"];
        if (keys.some(k => s.includes(k))) return "Specialty League";
        return null;
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
                if (s && s._activity) done.add(s._activity);
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

    // === THE SORTER: Prioritizes EMPTY fields, then SHARED fields ===
    function sortPicksByIsolation(picks, slotIndex, fieldUsageBySlot, activityProperties) {
        return picks.sort((a, b) => {
            const nameA = fieldLabel(a.field);
            const nameB = fieldLabel(b.field);

            const usageA = fieldUsageBySlot[slotIndex]?.[nameA] || { count: 0 };
            const usageB = fieldUsageBySlot[slotIndex]?.[nameB] || { count: 0 };

            // We want the LOWEST usage count first.
            // 0 (Empty) < 1 (Semi-Full)
            // This naturally forces "Everyone by themselves" first.
            // If no 0s exist, it falls back to 1s (Sharing).
            return usageA.count - usageB.count;
        });
    }

    // =================================================================
    // CUSTOM PICKER LOGIC (Updated for Isolation)
    // =================================================================

    // 1. SPORTS PICKER
    window.findBestSportActivity = function (block, allActivities, fieldUsageBySlot, yesterdayHistory, activityProperties, rotationHistory, divisions, historicalCounts) {
        const bunkHistory = rotationHistory?.bunks?.[block.bunk] || {};
        const activitiesDoneToday = getGeneralActivitiesDoneToday(block.bunk);

        const sports = allActivities
            .filter(a => a.type === 'field' && a.sport)
            .map(a => ({ field: a.field, sport: a.sport, _activity: a.sport }));

        let valid = sports.filter(pick => {
            const fits = window.SchedulerCoreUtils.canBlockFit(block, fieldLabel(pick.field), activityProperties, fieldUsageBySlot, pick._activity);
            if (activitiesDoneToday.has(pick._activity)) return false;
            return fits;
        });

        // 1. Sort by Freshness first (Global Preference)
        valid = sortPicksByFreshness(valid, bunkHistory);

        // 2. STABLE SORT: Apply Isolation Priority (Empty fields float to top)
        if (block.slots.length > 0) {
            valid = sortPicksByIsolation(valid, block.slots[0], fieldUsageBySlot, activityProperties);
        }

        return valid[0] || null;
    };

    // 2. SPECIALS PICKER
    window.findBestSpecial = function (block, allActivities, fieldUsageBySlot, yesterdayHistory, activityProperties, rotationHistory, divisions, historicalCounts) {
        const bunkHistory = rotationHistory?.bunks?.[block.bunk] || {};
        const activitiesDoneToday = getGeneralActivitiesDoneToday(block.bunk);
        
        const specials = allActivities
            .filter(a => a.type === 'special')
            .map(a => ({ field: a.field, sport: null, _activity: a.field })); 

        let valid = specials.filter(pick => {
            const fits = window.SchedulerCoreUtils.canBlockFit(block, fieldLabel(pick.field), activityProperties, fieldUsageBySlot, pick._activity);
            if (activitiesDoneToday.has(pick._activity)) return false;
            return fits;
        });

        valid = sortPicksByFreshness(valid, bunkHistory);

        if (block.slots.length > 0) {
            valid = sortPicksByIsolation(valid, block.slots[0], fieldUsageBySlot, activityProperties);
        }

        return valid[0] || null;
    };

    // 3. GENERAL ACTIVITY PICKER
    window.findBestGeneralActivity = function (block, allActivities, h2hActivities, fieldUsageBySlot, yesterdayHistory, activityProperties, rotationHistory, divisions, historicalCounts) {
        const activitiesDoneToday = getGeneralActivitiesDoneToday(block.bunk);
        const bunkHistory = rotationHistory?.bunks?.[block.bunk] || {};

        const candidates = allActivities
            .filter(a => a.type === 'field' && a.sport)
            .map(a => ({ field: a.field, sport: a.sport, _activity: a.sport }));

        let valid = candidates.filter(pick => {
            return window.SchedulerCoreUtils.canBlockFit(block, fieldLabel(pick.field), activityProperties, fieldUsageBySlot, pick._activity);
        });

        valid = shuffleArray(valid);
        valid = sortPicksByFreshness(valid, bunkHistory);

        if (block.slots.length > 0) {
            valid = sortPicksByIsolation(valid, block.slots[0], fieldUsageBySlot, activityProperties);
        }

        return valid[0] || null;
    };

    // =================================================================
    // FILL BLOCK (The Writer)
    // =================================================================
    function fillBlock(block, pick, fieldUsageBySlot, yesterdayHistory, isLeagueFill = false) {
        const fieldName = window.SchedulerCoreUtils.fieldLabel(pick.field);
        const sport = pick.sport;
        (block.slots || []).forEach((slotIndex, idx) => {
            if (slotIndex === undefined || slotIndex >= (window.unifiedTimes || []).length) return;
            if (!window.scheduleAssignments[block.bunk]) return;
            if (!window.scheduleAssignments[block.bunk][slotIndex]) {
                window.scheduleAssignments[block.bunk][slotIndex] = {
                    field: fieldName,
                    sport: sport,
                    continuation: (idx > 0),
                    _fixed: !!pick._fixed,
                    _h2h: !!pick._h2h,
                    _activity: pick._activity || null,
                    _allMatchups: pick._allMatchups || null,
                    _gameLabel: pick._gameLabel || null
                };
                if (!isLeagueFill &&
                    fieldName &&
                    window.allSchedulableNames &&
                    window.allSchedulableNames.includes(fieldName)) {
                    
                    fieldUsageBySlot[slotIndex] = fieldUsageBySlot[slotIndex] || {};
                    const usage = fieldUsageBySlot[slotIndex][fieldName] || { count: 0, divisions: [], bunks: {} };
                    
                    usage.count++;
                    if (!usage.divisions.includes(block.divName)) usage.divisions.push(block.divName);
                    if (block.bunk && pick._activity) usage.bunks[block.bunk] = pick._activity;
                    
                    fieldUsageBySlot[slotIndex][fieldName] = usage;
                }
            }
        });
    }

    function registerSingleSlotUsage(slotIndex, fieldName, divName, bunkName, activityName, fieldUsageBySlot, activityProperties) {
        if (!fieldName || !window.allSchedulableNames || !window.allSchedulableNames.includes(fieldName)) return;
        
        fieldUsageBySlot[slotIndex] = fieldUsageBySlot[slotIndex] || {};
        const usage = fieldUsageBySlot[slotIndex][fieldName] || { count: 0, divisions: [], bunks: {} };
        
        const props = activityProperties[fieldName];
        const sharableCap = props?.sharableWith?.capacity ?? (props?.sharableWith?.type === "all" ? 2 : props?.sharable ? 2 : 1);

        if (usage.count < sharableCap) {
            usage.count++;
            if (bunkName) usage.bunks[bunkName] = activityName || fieldName;
            if (divName && !usage.divisions.includes(divName)) {
                usage.divisions.push(divName);
            }
            fieldUsageBySlot[slotIndex][fieldName] = usage;
        }
    }

    // =================================================================
    // MAIN EXPORT
    // =================================================================
    window.runSkeletonOptimizer = function(manualSkeleton, externalOverrides) {
        window.scheduleAssignments = {};
        window.leagueAssignments = {};
        window.unifiedTimes = [];
        const dailyLeagueSportsUsage = {};

        if (!manualSkeleton || manualSkeleton.length === 0) return false;

        // 1. Load Data
        const config = window.SchedulerCoreUtils.loadAndFilterData();
        const {
            divisions, availableDivisions, activityProperties, allActivities, h2hActivities,
            fieldsBySport, masterLeagues, masterSpecialtyLeagues, masterSpecials,
            yesterdayHistory, rotationHistory, disabledLeagues, disabledSpecialtyLeagues,
            historicalCounts, specialActivityNames, disabledFields, disabledSpecials,
            dailyFieldAvailability, bunkMetaData 
        } = config;

        let fieldUsageBySlot = {};
        window.fieldUsageBySlot = fieldUsageBySlot;
        window.activityProperties = activityProperties;

        // 2. Build Time Grid (Pass 1)
        let timePoints = new Set();
        timePoints.add(540); // 9:00
        timePoints.add(960); // 16:00
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

        availableDivisions.forEach(divName => {
            (divisions[divName]?.bunks || []).forEach(bunk => {
                window.scheduleAssignments[bunk] = new Array(window.unifiedTimes.length);
            });
        });

        // 3. Pass 1.5 - Bunk Overrides
        const bunkOverrides = window.loadCurrentDailyData?.().bunkActivityOverrides || [];
        bunkOverrides.forEach(override => {
            const startMin = window.SchedulerCoreUtils.parseTimeToMinutes(override.startTime);
            const endMin = window.SchedulerCoreUtils.parseTimeToMinutes(override.endTime);
            const slots = window.SchedulerCoreUtils.findSlotsForRange(startMin, endMin);
            const bunk = override.bunk;
            const divName = Object.keys(divisions).find(d => divisions[d].bunks.includes(bunk));

            if (window.scheduleAssignments[bunk] && slots.length > 0) {
                slots.forEach((slotIndex, idx) => {
                    if (!window.scheduleAssignments[bunk][slotIndex]) {
                        window.scheduleAssignments[bunk][slotIndex] = {
                            field: { name: override.activity },
                            sport: null,
                            continuation: (idx > 0),
                            _fixed: true,
                            _h2h: false,
                            vs: null,
                            _activity: override.activity,
                            _endTime: endMin
                        };
                        registerSingleSlotUsage(slotIndex, override.activity, divName, bunk, override.activity, fieldUsageBySlot, activityProperties);
                    }
                });
            }
        });

        // 4. Pass 2 - Skeleton Parsing
        const schedulableSlotBlocks = [];
        manualSkeleton.forEach(item => {
            const allBunks = divisions[item.division]?.bunks || [];
            if (!allBunks || allBunks.length === 0) return;

            const startMin = window.SchedulerCoreUtils.parseTimeToMinutes(item.startTime);
            const endMin = window.SchedulerCoreUtils.parseTimeToMinutes(item.endTime);
            const allSlots = window.SchedulerCoreUtils.findSlotsForRange(startMin, endMin);
            if (allSlots.length === 0) return;

            const normGA = normalizeGA(item.event);
            const normLeague = normalizeLeague(item.event);
            const normSpecLg = normalizeSpecialtyLeague(item.event);
            const finalEventName = normGA || normSpecLg || normLeague || item.event;
            const isGeneratedEvent = GENERATED_EVENTS.includes(finalEventName) || normGA === "General Activity Slot" || normLeague === "League Game" || normSpecLg === "Specialty League";

            if ((item.type === 'pinned' || !isGeneratedEvent) && item.type !== 'smart') {
                if (disabledFields.includes(item.event) || disabledSpecials.includes(item.event)) return;
                allBunks.forEach(bunk => {
                    allSlots.forEach((slotIndex, idx) => {
                        if (!window.scheduleAssignments[bunk][slotIndex]) {
                            window.scheduleAssignments[bunk][slotIndex] = {
                                field: { name: item.event },
                                sport: null,
                                continuation: (idx > 0),
                                _fixed: true,
                                _h2h: false,
                                vs: null,
                                _activity: item.event,
                                _endTime: endMin
                            };
                            registerSingleSlotUsage(slotIndex, item.event, item.division, bunk, item.event, fieldUsageBySlot, activityProperties);
                        }
                    });
                });
            } else if (item.type === 'split') {
                if (!item.subEvents || item.subEvents.length < 2) return;
                const mid = Math.ceil(allBunks.length / 2);
                const bunksTop = allBunks.slice(0, mid);
                const bunksBottom = allBunks.slice(mid);
                const slotMid = Math.ceil(allSlots.length / 2);
                const slotsFirst = allSlots.slice(0, slotMid);
                const slotsSecond = allSlots.slice(slotMid);

                const swimLabel = "Swim";
                const gaLabel = normalizeGA(item.subEvents[1].event) || "General Activity Slot";

                function pinSwim(bunks, slots) {
                    bunks.forEach(bunk => {
                        slots.forEach((slotIndex, idx) => {
                            window.scheduleAssignments[bunk][slotIndex] = {
                                field: { name: swimLabel },
                                sport: null,
                                continuation: (idx > 0),
                                _fixed: true,
                                _h2h: false,
                                vs: null,
                                _activity: swimLabel
                            };
                            registerSingleSlotUsage(slotIndex, swimLabel, item.division, bunk, swimLabel, fieldUsageBySlot, activityProperties);
                        });
                    });
                }
                function pushGA(bunks, slots) {
                    bunks.forEach(bunk => {
                        schedulableSlotBlocks.push({
                            divName: item.division,
                            bunk: bunk,
                            event: gaLabel,
                            startTime: startMin,
                            endTime: endMin,
                            slots
                        });
                    });
                }
                pinSwim(bunksTop, slotsFirst);
                pushGA(bunksBottom, slotsFirst);
                pushGA(bunksTop, slotsSecond);
                pinSwim(bunksBottom, slotsSecond);

            } else if (item.type === 'slot' && isGeneratedEvent) {
                let normalizedEvent = null;
                if (normalizeSpecialtyLeague(item.event)) normalizedEvent = "Specialty League";
                else if (normalizeLeague(item.event)) normalizedEvent = "League Game";
                else if (normalizeGA(item.event)) normalizedEvent = "General Activity Slot";
                else normalizedEvent = item.event;

                allBunks.forEach(bunk => {
                    schedulableSlotBlocks.push({
                        divName: item.division,
                        bunk: bunk,
                        event: normalizedEvent,
                        startTime: startMin,
                        endTime: endMin,
                        slots: allSlots
                    });
                });
            }
        });

        // 5. Pass 2.5 - Smart Tiles
        let smartJobs = [];
        if (window.SmartLogicAdapter && typeof window.SmartLogicAdapter.preprocessSmartTiles === 'function') {
            smartJobs = window.SmartLogicAdapter.preprocessSmartTiles(manualSkeleton, externalOverrides, masterSpecials);
        }
        smartJobs.forEach(job => {
            const bunks = window.divisions[job.division]?.bunks || [];
            if (!bunks.length) return;
            const adapterResult = SmartLogicAdapter.generateAssignments(
                bunks, job, historicalCounts, specialActivityNames, activityProperties, 
                config.masterFields, dailyFieldAvailability, yesterdayHistory
            );
            const { block1Assignments, block2Assignments } = adapterResult;
            if (!block1Assignments || !block2Assignments) return;

            function pushGenerated(bunk, event, startMin, endMin) {
                const slots = window.SchedulerCoreUtils.findSlotsForRange(startMin, endMin);
                schedulableSlotBlocks.push({
                    divName: job.division,
                    bunk, event, startTime: startMin, endTime: endMin, slots, fromSmartTile: true
                });
            }

            const slotsA = window.SchedulerCoreUtils.findSlotsForRange(job.blockA.startMin, job.blockA.endMin);
            Object.entries(block1Assignments).forEach(([bunk, act]) => {
                if (act.toLowerCase().includes("sport")) pushGenerated(bunk, "Sports Slot", job.blockA.startMin, job.blockA.endMin);
                else if (act.toLowerCase().includes("special")) pushGenerated(bunk, "Special Activity Slot", job.blockA.startMin, job.blockA.endMin);
                else if (act.toLowerCase().includes("general activity")) pushGenerated(bunk, "General Activity Slot", job.blockA.startMin, job.blockA.endMin);
                else {
                    slotsA.forEach((slotIndex, idx) => {
                        if (!window.scheduleAssignments[bunk]) window.scheduleAssignments[bunk] = [];
                        if (!window.scheduleAssignments[bunk][slotIndex]) {
                            window.scheduleAssignments[bunk][slotIndex] = {
                                field: { name: act }, sport: null, continuation: (idx > 0),
                                _fixed: true, _h2h: false, vs: null, _activity: act, _endTime: job.blockA.endMin
                            };
                            registerSingleSlotUsage(slotIndex, act, job.division, bunk, act, fieldUsageBySlot, activityProperties);
                        }
                    });
                }
            });

            if (job.blockB) {
                const slotsB = window.SchedulerCoreUtils.findSlotsForRange(job.blockB.startMin, job.blockB.endMin);
                Object.entries(block2Assignments).forEach(([bunk, act]) => {
                    if (act.toLowerCase().includes("sport")) pushGenerated(bunk, "Sports Slot", job.blockB.startMin, job.blockB.endMin);
                    else if (act.toLowerCase().includes("special")) pushGenerated(bunk, "Special Activity Slot", job.blockB.startMin, job.blockB.endMin);
                    else if (act.toLowerCase().includes("general activity")) pushGenerated(bunk, "General Activity Slot", job.blockB.startMin, job.blockB.endMin);
                    else {
                        slotsB.forEach((slotIndex, idx) => {
                            if (!window.scheduleAssignments[bunk]) window.scheduleAssignments[bunk] = [];
                            if (!window.scheduleAssignments[bunk][slotIndex]) {
                                window.scheduleAssignments[bunk][slotIndex] = {
                                    field: { name: act }, sport: null, continuation: (idx > 0),
                                    _fixed: true, _h2h: false, vs: null, _activity: act, _endTime: job.blockB.endMin
                                };
                                registerSingleSlotUsage(slotIndex, act, job.division, bunk, act, fieldUsageBySlot, activityProperties);
                            }
                        });
                    }
                });
            }
        });

        // 6. Pass 3 & 3.5 - Leagues
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

        window.SchedulerCoreLeagues.processSpecialtyLeagues(leagueContext);
        window.SchedulerCoreLeagues.processRegularLeagues(leagueContext);

        // 7. Pass 4 - Remaining Blocks (General Logic)
        const remainingBlocks = schedulableSlotBlocks.filter(b =>
            b.event !== 'League Game' &&
            b.event !== 'Specialty League' &&
            !b.processed
        );

        // --- SORTING LOGIC: FIRST FIT DECREASING ---
        remainingBlocks.sort((a, b) => {
            // 1. Time (Morning First)
            if (a.startTime !== b.startTime) return a.startTime - b.startTime;
            
            // 2. Smart Tiles Priority
            if (a.fromSmartTile && !b.fromSmartTile) return -1;
            if (!a.fromSmartTile && b.fromSmartTile) return 1;
            
            // 3. Bunk Size (Largest First) - "Bin Packing"
            const sizeA = bunkMetaData[a.bunk]?.size || 0;
            const sizeB = bunkMetaData[b.bunk]?.size || 0;
            if (sizeA !== sizeB) return sizeB - sizeA; // Descending
            
            // 4. Fairness (Fewest specials first)
            const countA = historicalCounts[a.bunk]?.['_totalSpecials'] || 0;
            const countB = historicalCounts[b.bunk]?.['_totalSpecials'] || 0;
            return countA - countB;
        });

        for (const block of remainingBlocks) {
            if (!block.slots || block.slots.length === 0) continue;
            if (!window.scheduleAssignments[block.bunk]) continue;
            if (window.scheduleAssignments[block.bunk][block.slots[0]]) continue;

            let pick = null;
            if (block.event === 'League Game' || block.event === 'Specialty League') {
                pick = { field: "Unassigned League", sport: null, _activity: "Free" };
            } else if (block.event === 'Special Activity' || block.event === 'Special Activity Slot') {
                pick = window.findBestSpecial(block, allActivities, fieldUsageBySlot, yesterdayHistory, activityProperties, rotationHistory, divisions, historicalCounts);
            } else if (block.event === 'Sports Slot' || block.event === 'Sports') {
                pick = window.findBestSportActivity(block, allActivities, fieldUsageBySlot, yesterdayHistory, activityProperties, rotationHistory, divisions, historicalCounts);
            }

            if (!pick) {
                pick = window.findBestGeneralActivity(block, allActivities, h2hActivities, fieldUsageBySlot, yesterdayHistory, activityProperties, rotationHistory, divisions, historicalCounts);
            }

            // --- STRICT VALIDATION ---
            if (pick && window.allSchedulableNames && !window.allSchedulableNames.includes(pick.field)) {
                pick = null; 
            }

            // 1. Check if the "Best" pick actually fits (and is valid)
            // Note: canBlockFit in Utils now has strict League Locking.
            let fits = pick && window.SchedulerCoreUtils.canBlockFit(block, window.SchedulerCoreUtils.fieldLabel(pick.field), activityProperties, fieldUsageBySlot, pick._activity);

            // 2. RESCUE STRATEGY: If "Best" failed, try ALL combinations.
            if (!fits) {
                let candidates = [];
                if (block.event === 'Sports Slot' || block.event === 'Sports') {
                    candidates = allActivities.filter(a => a.type === 'field' && a.sport);
                } else if (block.event === 'Special Activity' || block.event === 'Special Activity Slot') {
                    candidates = allActivities.filter(a => a.type === 'special');
                } else {
                    candidates = allActivities.slice();
                }

                candidates = shuffleArray(candidates);

                // Apply Isolation Sort to Rescue Candidates too (Empty First)
                if (block.slots.length > 0) {
                    candidates = sortPicksByIsolation(candidates, block.slots[0], fieldUsageBySlot, activityProperties);
                }

                for (const cand of candidates) {
                    const tempFieldName = cand.field;
                    const tempActivity = cand.type === 'special' ? cand.field : (cand.sport || cand.field);
                    
                    if (window.SchedulerCoreUtils.canBlockFit(block, tempFieldName, activityProperties, fieldUsageBySlot, tempActivity)) {
                        pick = {
                            field: tempFieldName, 
                            sport: cand.sport || null,
                            _activity: tempActivity,
                            _h2h: (cand.type === 'field' && !!cand.sport)
                        };
                        fits = true;
                        break;
                    }
                }
            }

            if (fits && pick) {
                fillBlock(block, pick, fieldUsageBySlot, yesterdayHistory, false);
                if (pick._activity && block.bunk) {
                    if (!historicalCounts[block.bunk]) historicalCounts[block.bunk] = {};
                    historicalCounts[block.bunk][pick._activity] = (historicalCounts[block.bunk][pick._activity] || 0) + 1;
                    const isSpecial = masterSpecials.some(s => s.name === pick._activity);
                    if (isSpecial) {
                         historicalCounts[block.bunk]['_totalSpecials'] = (historicalCounts[block.bunk]['_totalSpecials'] || 0) + 1;
                    }
                }
            } else {
                fillBlock(block, { field: "Free", sport: null, _activity: "Free" }, fieldUsageBySlot, yesterdayHistory, false);
            }
        }

        // 8. Pass 5 - History Update
        try {
            const historyToSave = rotationHistory;
            const timestamp = Date.now();
            availableDivisions.forEach(divName => {
                (divisions[divName]?.bunks || []).forEach(bunk => {
                    const schedule = window.scheduleAssignments[bunk] || [];
                    let lastActivity = null;
                    for (const entry of schedule) {
                        if (entry && entry._activity && entry._activity !== lastActivity) {
                            const activityName = entry._activity;
                            lastActivity = activityName;
                            historyToSave.bunks[bunk] = historyToSave.bunks[bunk] || {};
                            historyToSave.bunks[bunk][activityName] = timestamp;

                            if (entry._h2h && activityName !== "League" && activityName !== "No Game") {
                                const leagueEntry = Object.entries(masterLeagues).find(
                                    ([name, l]) => l.enabled && l.divisions && l.divisions.includes(divName)
                                );
                                if (leagueEntry) {
                                    const lgName = leagueEntry[0];
                                    historyToSave.leagues[lgName] = historyToSave.leagues[lgName] || {};
                                    historyToSave.leagues[lgName][activityName] = timestamp;
                                }
                            }
                        } else if (entry && !entry.continuation) {
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

})();
