// ============================================================================
// scheduler_core_main.js
// PART 3 of 3: THE ORCHESTRATOR (Main Entry)
//
// UPDATED:
// - Implemented Continuous Transition Merging (Zone Handshake).
// - Implemented Atomic Block Filling (Pre/Activity/Post).
// - Added Transition Concurrency Tracking.
// - FIXED: Bracketing/Syntax to ensure runSkeletonOptimizer loads.
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
    const TRANSITION_TYPE = "Transition/Buffer"; 

    // =================================================================
    // LOCAL HELPERS
    // =================================================================
    
    function fieldLabel(f) {
        return window.SchedulerCoreUtils ? window.SchedulerCoreUtils.fieldLabel(f) : (f && f.name ? f.name : f);
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

    // =================================================================
    // FILL BLOCK (The Atomic Writer - UPDATED for Buffers and Continuity)
    // =================================================================
    function fillBlock(block, pick, fieldUsageBySlot, yesterdayHistory, isLeagueFill = false, activityProperties) {
        const fieldName = window.SchedulerCoreUtils.fieldLabel(pick.field);
        const sport = pick.sport;
        const bunk = block.bunk;
        
        // Safety check for activityProperties
        const safeProps = activityProperties || window.activityProperties || {};
        const transRules = window.SchedulerCoreUtils.getTransitionRules(fieldName, safeProps);
        
        const { blockStartMin, blockEndMin, effectiveStart, effectiveEnd } = window.SchedulerCoreUtils.getEffectiveTimeRange(block, transRules);
        
        const preMin = transRules.preMin || 0;
        const postMin = transRules.postMin || 0;
        const zone = transRules.zone;
        
        let writePre = preMin > 0;
        let writePost = postMin > 0;

        // --- CONTINUITY CHECK (Zone Handshake) ---
        const firstSlotIndex = block.slots[0];
        const prevEntry = window.scheduleAssignments[bunk]?.[firstSlotIndex - 1];
        
        // 1. Check previous block's Post-Buffer
        if (writePre && firstSlotIndex > 0) {
            if (prevEntry?._zone === zone && prevEntry?._activity === TRANSITION_TYPE && prevEntry?._transitionType === 'Post') {
                writePre = false; // Merge!
                
                // Delete the previous Post-Buffer slots to merge the two activities
                const prevPostSlots = window.SchedulerCoreUtils.findSlotsForRange(blockStartMin - postMin, blockStartMin);
                prevPostSlots.forEach(slotIndex => {
                    if (window.scheduleAssignments[bunk][slotIndex]?._transitionType === 'Post') {
                        window.scheduleAssignments[bunk][slotIndex] = null;
                    }
                });
            }
        }

        // --- ATOMIC BLOCK WRITING ---
        
        // 1. Write Pre-Buffer
        if (writePre) {
            const preSlots = window.SchedulerCoreUtils.findSlotsForRange(blockStartMin, effectiveStart);
            preSlots.forEach((slotIndex, idx) => {
                window.scheduleAssignments[bunk][slotIndex] = {
                    field: TRANSITION_TYPE,
                    sport: transRules.label,
                    continuation: (idx > 0),
                    _fixed: true,
                    _activity: TRANSITION_TYPE,
                    _isTransition: true,
                    _transitionType: 'Pre',
                    _zone: zone,
                    _endTime: effectiveStart
                };
            });
        }
        
        // 2. Write Activity
        const activitySlots = window.SchedulerCoreUtils.findSlotsForRange(effectiveStart, effectiveEnd);
        activitySlots.forEach((slotIndex, idx) => {
            // Overwrite only if empty or if it was a transition we just cleared
            if (!window.scheduleAssignments[bunk][slotIndex] || window.scheduleAssignments[bunk][slotIndex]._isTransition) { 
                 window.scheduleAssignments[bunk][slotIndex] = {
                    field: fieldName,
                    sport: sport,
                    continuation: (idx > 0),
                    _fixed: pick._fixed || false,
                    _h2h: pick._h2h || false,
                    _activity: pick._activity || fieldName,
                    _allMatchups: pick._allMatchups || null,
                    _gameLabel: pick._gameLabel || null,
                    _zone: zone,
                    _endTime: effectiveEnd
                 };
                 
                 // If buffer occupies field, we register usage during buffer time too (handled in scan),
                 // but here we register the actual activity slot usage
                 if (!isLeagueFill && transRules.occupiesField) {
                     registerSingleSlotUsage(slotIndex, fieldName, block.divName, bunk, pick._activity, fieldUsageBySlot, safeProps);
                 }
            }
        });

        // 3. Write Post-Buffer
        if (writePost) {
            const postSlots = window.SchedulerCoreUtils.findSlotsForRange(effectiveEnd, blockEndMin);
            postSlots.forEach((slotIndex, idx) => {
                 window.scheduleAssignments[bunk][slotIndex] = {
                    field: TRANSITION_TYPE,
                    sport: transRules.label,
                    continuation: (idx > 0),
                    _fixed: true,
                    _activity: TRANSITION_TYPE,
                    _isTransition: true,
                    _transitionType: 'Post',
                    _zone: zone,
                    _endTime: blockEndMin
                };
            });
        }

        // If buffer does NOT occupy field, we still register the activity usage for the activity slots
        if (!isLeagueFill && !transRules.occupiesField) {
            activitySlots.forEach(slotIndex => {
                 registerSingleSlotUsage(slotIndex, fieldName, block.divName, bunk, pick._activity, fieldUsageBySlot, safeProps);
            });
        }
    }

    // Helper exposed by fillBlock
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

    // Expose fillBlock and register globally
    window.fillBlock = fillBlock;
    window.registerSingleSlotUsage = registerSingleSlotUsage;

    // =================================================================
    // MAIN EXPORT (UPDATED)
    // =================================================================
    window.runSkeletonOptimizer = function(manualSkeleton, externalOverrides) {
        window.scheduleAssignments = {};
        window.leagueAssignments = {};
        window.unifiedTimes = [];
        // const dailyLeagueSportsUsage = {}; // Unused in this scope

        if (!manualSkeleton || manualSkeleton.length === 0) return false;

        // 1. Load Data
        const config = window.SchedulerCoreUtils.loadAndFilterData();
        const {
            divisions, availableDivisions, activityProperties, allActivities, h2hActivities,
            fieldsBySport, masterLeagues, masterSpecialtyLeagues, masterSpecials,
            yesterdayHistory, rotationHistory, disabledLeagues, disabledSpecialtyLeagues,
            historicalCounts, specialActivityNames, disabledFields, disabledSpecials,
            dailyFieldAvailability, bunkMetaData, masterZones
        } = config;

        let fieldUsageBySlot = {};
        window.fieldUsageBySlot = fieldUsageBySlot;
        window.activityProperties = activityProperties;

        // 2. Build Time Grid
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
            const fieldName = override.activity;
            const transRules = window.SchedulerCoreUtils.getTransitionRules(fieldName, activityProperties);
            const startMin = window.SchedulerCoreUtils.parseTimeToMinutes(override.startTime);
            const endMin = window.SchedulerCoreUtils.parseTimeToMinutes(override.endTime);
            
            const slots = window.SchedulerCoreUtils.findSlotsForRange(startMin, endMin);
            const bunk = override.bunk;
            const divName = Object.keys(divisions).find(d => divisions[d].bunks.includes(bunk));

            if (window.scheduleAssignments[bunk] && slots.length > 0) {
                 fillBlock({
                    divName, bunk,
                    startTime: startMin, endTime: endMin,
                    slots
                 }, {
                    field: fieldName,
                    sport: null,
                    _fixed: true,
                    _h2h: false,
                    _activity: fieldName
                 }, fieldUsageBySlot, yesterdayHistory, false, activityProperties);
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
                // Split handling
                const mid = Math.ceil(allBunks.length / 2);
                const bunksTop = allBunks.slice(0, mid);
                const bunksBottom = allBunks.slice(mid);

                const slotMid = Math.ceil(allSlots.length / 2);
                const slotsFirst = allSlots.slice(0, slotMid);
                const slotsSecond = allSlots.slice(slotMid);

                const swimLabel = "Swim";
                const gaLabel = normalizeGA(item.subEvents[1].event) || "General Activity Slot";

                function pinEvent(bunks, slots, eventName) {
                    const { blockStartMin, blockEndMin } = window.SchedulerCoreUtils.getBlockTimeRange({slots: slots});
                    bunks.forEach(bunk => {
                        fillBlock({
                           divName: item.division, bunk,
                           startTime: blockStartMin, endTime: blockEndMin,
                           slots
                        }, {
                           field: eventName, sport: null, _fixed: true, _h2h: false, _activity: eventName
                        }, fieldUsageBySlot, yesterdayHistory, false, activityProperties);
                    });
                }

                function pushGenerated(bunks, slots, eventName) {
                    const { blockStartMin, blockEndMin } = window.SchedulerCoreUtils.getBlockTimeRange({slots: slots});
                    bunks.forEach(bunk => {
                        schedulableSlotBlocks.push({
                            divName: item.division,
                            bunk: bunk,
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

            } else if (item.type === 'slot' && isGeneratedEvent || hasBuffer) {
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
                        slots: allSlots,
                        _transRules: transRules
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

            const adapterResult = window.SmartLogicAdapter.generateAssignments(
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
                     fillBlock({
                        divName: job.division, bunk,
                        startTime: job.blockA.startMin, endTime: job.blockA.endMin,
                        slots: slotsA
                     }, {
                        field: act, sport: null, _fixed: true, _h2h: false, _activity: act
                     }, fieldUsageBySlot, yesterdayHistory, false, activityProperties);
                }
            });

            if (job.blockB) {
                const slotsB = window.SchedulerCoreUtils.findSlotsForRange(job.blockB.startMin, job.blockB.endMin);
                Object.entries(block2Assignments).forEach(([bunk, act]) => {
                    if (act.toLowerCase().includes("sport")) pushGenerated(bunk, "Sports Slot", job.blockB.startMin, job.blockB.endMin);
                    else if (act.toLowerCase().includes("special")) pushGenerated(bunk, "Special Activity Slot", job.blockB.startMin, job.blockB.endMin);
                    else if (act.toLowerCase().includes("general activity")) pushGenerated(bunk, "General Activity Slot", job.blockB.startMin, job.blockB.endMin);
                    else {
                        fillBlock({
                            divName: job.division, bunk,
                            startTime: job.blockB.startMin, endTime: job.blockB.endMin,
                            slots: slotsB
                        }, {
                            field: act, sport: null, _fixed: true, _h2h: false, _activity: act
                        }, fieldUsageBySlot, yesterdayHistory, false, activityProperties);
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
            // dailyLeagueSportsUsage,
            fillBlock
        };

        if (window.SchedulerCoreLeagues) {
            window.SchedulerCoreLeagues.processSpecialtyLeagues(leagueContext);
            window.SchedulerCoreLeagues.processRegularLeagues(leagueContext);
        } else {
            console.warn("SchedulerCoreLeagues not loaded. Skipping leagues.");
        }

        // 7. Pass 4 - Remaining Blocks
        const remainingBlocks = schedulableSlotBlocks.filter(b =>
            b.event !== 'League Game' &&
            b.event !== 'Specialty League' &&
            !b.processed
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
            if (!block.slots || block.slots.length === 0) continue;
            if (!window.scheduleAssignments[block.bunk]) continue;
            // Don't overwrite transitions
            if (window.scheduleAssignments[block.bunk][block.slots[0]] && window.scheduleAssignments[block.bunk][block.slots[0]]._activity !== TRANSITION_TYPE) continue;

            let pick = null;
            if (block.event === 'Special Activity' || block.event === 'Special Activity Slot') {
                pick = window.findBestSpecial(block, allActivities, fieldUsageBySlot, yesterdayHistory, activityProperties, rotationHistory, divisions, historicalCounts);
            } else if (block.event === 'Sports Slot' || block.event === 'Sports') {
                pick = window.findBestSportActivity(block, allActivities, fieldUsageBySlot, yesterdayHistory, activityProperties, rotationHistory, divisions, historicalCounts);
            }

            if (!pick) {
                pick = window.findBestGeneralActivity(block, allActivities, h2hActivities, fieldUsageBySlot, yesterdayHistory, activityProperties, rotationHistory, divisions, historicalCounts);
            }

            let fits = pick && window.SchedulerCoreUtils.canBlockFit(block, window.SchedulerCoreUtils.fieldLabel(pick.field), activityProperties, fieldUsageBySlot, pick._activity);

            // --- CHECK TRANSITION CONCURRENCY ---
            let transRules = window.SchedulerCoreUtils.getTransitionRules(fieldLabel(pick?.field), activityProperties);
            if (pick && (transRules.preMin > 0 || transRules.postMin > 0)) {
                const zone = transRules.zone;
                const zones = masterZones;
                const maxConcurrent = zones[zone]?.maxConcurrent || 99;
                
                if (maxConcurrent < 99) {
                     const { blockStartMin } = window.SchedulerCoreUtils.getBlockTimeRange(block);
                     const isMerged = blockStartMin > 0 && window.scheduleAssignments[block.bunk]?.[block.slots[0]-1]?._zone === zone;
                     
                     if (!isMerged) {
                         if ((window.__transitionUsage[zone] || 0) + 1 > maxConcurrent) {
                              fits = false;
                          }
                     }
                }
            }

            if (!fits) {
                pick = null;
            }

            if (fits && pick) {
                if (transRules.preMin > 0 || transRules.postMin > 0) {
                    const { blockStartMin } = window.SchedulerCoreUtils.getBlockTimeRange(block);
                    const isMerged = blockStartMin > 0 && window.scheduleAssignments[block.bunk][block.slots[0]-1]?._zone === transRules.zone;
                    if (!isMerged) {
                         window.__transitionUsage[transRules.zone] = (window.__transitionUsage[transRules.zone] || 0) + 1;
                    }
                }
                
                fillBlock(block, pick, fieldUsageBySlot, yesterdayHistory, false, activityProperties);

                if (pick._activity && block.bunk) {
                    if (!historicalCounts[block.bunk]) historicalCounts[block.bunk] = {};
                    historicalCounts[block.bunk][pick._activity] = (historicalCounts[block.bunk][pick._activity] || 0) + 1;
                    
                    const isSpecial = masterSpecials.some(s => s.name === pick._activity);
                    if (isSpecial) {
                         historicalCounts[block.bunk]['_totalSpecials'] = (historicalCounts[block.bunk]['_totalSpecials'] || 0) + 1;
                    }
                }
            } else {
                // If failed, ensure we clear any pre-filled transition slot to be blank
                if (window.scheduleAssignments[block.bunk]?.[block.slots[0]]?._activity === TRANSITION_TYPE) {
                     window.scheduleAssignments[block.bunk][block.slots[0]] = null;
                }
                fillBlock(block, { field: "Free", sport: null, _activity: "Free" }, fieldUsageBySlot, yesterdayHistory, false, activityProperties);
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
                        if (entry && entry._activity && entry._activity !== lastActivity && entry._activity !== TRANSITION_TYPE) {
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

})();
