// ============================================================================
// scheduler_core_main.js
// PART 3 of 3: THE ORCHESTRATOR (TIMELINE EDITION)
//
// Role:
// - Manages the "Most Constrained First" execution order.
// - Pinned -> Leagues -> Smart Tiles -> Split -> General.
// - Syncs decisions to the Timeline immediately.
// ============================================================================

(function() {
    'use strict';

    const GENERATED_EVENTS = [
        'General Activity Slot', 'Sports Slot', 'Special Activity', 
        'Swim', 'League Game', 'Specialty League'
    ];

    // =================================================================
    // LOCAL HELPERS
    // =================================================================
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
    // FILL BLOCK (The Writer)
    // =================================================================
    function fillBlock(block, pick, fieldUsageBySlot, yesterdayHistory, isLeague = false) {
        const fieldName = window.SchedulerCoreUtils.fieldLabel(pick.field);
        
        // 1. Write to Visual Grid (scheduleAssignments) - For UI
        (block.slots || []).forEach((slotIndex, idx) => {
            if (slotIndex === undefined || !window.scheduleAssignments[block.bunk]) return;
            
            // Only write if empty
            if (!window.scheduleAssignments[block.bunk][slotIndex]) {
                window.scheduleAssignments[block.bunk][slotIndex] = {
                    field: fieldName,
                    sport: pick.sport,
                    continuation: (idx > 0),
                    _fixed: !!pick._fixed,
                    _h2h: !!pick._h2h,
                    _activity: pick._activity || null,
                    _allMatchups: pick._allMatchups || null,
                    _gameLabel: pick._gameLabel || null
                };
            }
        });

        // 2. Write to TIMELINE (The Logic Brain)
        // If it's a real field (not "Free" or "No Game")
        if (fieldName && fieldName !== "Free" && fieldName !== "No Game" && fieldName !== "No Field") {
            const { blockStartMin, blockEndMin } = window.SchedulerCoreUtils.getBlockTimeRange(block);
            
            if (blockStartMin != null && blockEndMin != null) {
                // Determine Weight
                let weight = 1;
                const props = window.activityProperties[fieldName];
                
                if (isLeague) {
                    // Full Buyout: Weight equals the max capacity of the resource
                    if (props) {
                        weight = props.sharableWith?.capacity || (props.sharable ? 2 : 1);
                        // Force at least 2 if it's a league, to block sharable fields
                        if (weight < 2) weight = 2; 
                    } else {
                        weight = 2; // Default safe max
                    }
                }

                window.SchedulerCoreUtils.timeline.addReservation(
                    fieldName, 
                    blockStartMin, 
                    blockEndMin, 
                    weight, 
                    block.bunk
                );
            }
        }
    }

    // =================================================================
    // MAIN RUN FUNCTION
    // =================================================================
    window.runSkeletonOptimizer = function(manualSkeleton, externalOverrides) {
        // Reset System
        window.scheduleAssignments = {};
        window.unifiedTimes = [];
        
        if (!manualSkeleton || manualSkeleton.length === 0) return false;

        // 1. Load Data & Initialize Timeline
        const config = window.SchedulerCoreUtils.loadAndFilterData(); // Creates new empty Timeline
        const {
            divisions, availableDivisions, activityProperties, allActivities, h2hActivities,
            fieldsBySport, masterLeagues, masterSpecialtyLeagues, masterSpecials,
            yesterdayHistory, rotationHistory, disabledLeagues, disabledSpecialtyLeagues,
            historicalCounts, dailyFieldAvailability, bunkMetaData, specialActivityNames
        } = config;

        window.activityProperties = activityProperties; // Expose for helpers

        // 2. Build Time Grid (For UI mapping)
        let timePoints = new Set();
        timePoints.add(540); // 9:00
        timePoints.add(960); // 16:00
        manualSkeleton.forEach(item => {
            const s = window.SchedulerCoreUtils.parseTimeToMinutes(item.startTime);
            const e = window.SchedulerCoreUtils.parseTimeToMinutes(item.endTime);
            if (s != null) timePoints.add(s);
            if (e != null) timePoints.add(e);
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
        
        // Init Assignments Array
        availableDivisions.forEach(divName => {
            (divisions[divName]?.bunks || []).forEach(bunk => {
                window.scheduleAssignments[bunk] = new Array(window.unifiedTimes.length);
            });
        });

        // 3. Process Skeleton into "Schedulable Blocks"
        const schedulableSlotBlocks = [];
        
        manualSkeleton.forEach(item => {
            const allBunks = divisions[item.division]?.bunks || [];
            if (!allBunks.length) return;

            const startMin = window.SchedulerCoreUtils.parseTimeToMinutes(item.startTime);
            const endMin = window.SchedulerCoreUtils.parseTimeToMinutes(item.endTime);
            const allSlots = window.SchedulerCoreUtils.findSlotsForRange(startMin, endMin);

            const normGA = normalizeGA(item.event);
            const normLeague = normalizeLeague(item.event);
            const normSpecLg = normalizeSpecialtyLeague(item.event);
            const finalEventName = normGA || normSpecLg || normLeague || item.event;
            const isGeneratedEvent = GENERATED_EVENTS.includes(finalEventName) || normGA === "General Activity Slot" || normLeague === "League Game" || normSpecLg === "Specialty League";

            // -- PHASE 1: PINNED ITEMS (Immediate Write) --
            // Note: Leagues are NOT pinned items here, they are generated in Phase 2
            if ((item.type === 'pinned' || !isGeneratedEvent) && item.type !== 'smart' && item.type !== 'split' && !item.event.toLowerCase().includes("league")) {
                allBunks.forEach(bunk => {
                    const pick = { field: item.event, sport: null, _activity: item.event, _fixed: true };
                    // Write directly to timeline/assignments
                    fillBlock({ slots: allSlots, bunk, startTime: startMin, endTime: endMin }, pick, {}, {}, false);
                });
            } 
            // Collect others for processing
            else if (item.type === 'split') {
                schedulableSlotBlocks.push({ ...item, slots: allSlots, startMin, endMin, bunks: allBunks });
            } 
            else if (item.type === 'smart') {
                // Ensure bunks are attached for the adapter
                schedulableSlotBlocks.push({ ...item, slots: allSlots, startMin, endMin, bunks: allBunks });
            }
            else {
                // Slots (Activity, League, etc)
                let normalizedEvent = finalEventName;
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

        const context = {
            schedulableSlotBlocks,
            activityProperties,
            masterLeagues, masterSpecialtyLeagues,
            rotationHistory, yesterdayHistory, divisions, fieldsBySport,
            fillBlock, // Pass the writer function
            dailyLeagueSportsUsage: {}
        };

        // -- PHASE 2: LEAGUES & SPECIALTY LEAGUES (Full Buyouts) --
        // This relies on SchedulerCoreLeagues to use fillBlock with isLeague=true
        if (window.SchedulerCoreLeagues) {
            window.SchedulerCoreLeagues.processSpecialtyLeagues(context);
            window.SchedulerCoreLeagues.processRegularLeagues(context);
        }

        // -- PHASE 3: SMART TILES --
        const smartBlocks = schedulableSlotBlocks.filter(b => b.type === 'smart');
        if (smartBlocks.length > 0 && window.SmartLogicAdapter) {
            const jobs = window.SmartLogicAdapter.preprocessSmartTiles(smartBlocks, {}, masterSpecials);
            jobs.forEach(job => {
               const divBunks = divisions[job.division]?.bunks || [];
               const res = window.SmartLogicAdapter.generateAssignments(
                   divBunks, job, historicalCounts, specialActivityNames, 
                   activityProperties, {}, dailyFieldAvailability, yesterdayHistory
               );
               
               const writeAssignments = (assignments, blockInfo) => {
                   if (!assignments || !blockInfo) return;
                   const slots = window.SchedulerCoreUtils.findSlotsForRange(blockInfo.startMin, blockInfo.endMin);
                   
                   Object.entries(assignments).forEach(([bunk, act]) => {
                       let finalPick = { field: act, _activity: act };
                       
                       // If fallback was generic "Sports", find a specific one
                       if (act.includes("Sport")) {
                           finalPick = window.findBestSportActivity(
                               {bunk, divName: job.division, startTime: blockInfo.startMin, endTime: blockInfo.endMin}, 
                               allActivities, {}, yesterdayHistory, activityProperties, rotationHistory, divisions, historicalCounts
                           );
                       } else {
                           // [FIX]: For Specific Activities (e.g. Woodworking), check Constraints!
                           // We skip this check for generic "Sports" because findBestSportActivity handles it internally.
                           const isValid = window.SchedulerCoreUtils.canBlockFit(
                               { bunk, divName: job.division, startTime: blockInfo.startMin, endTime: blockInfo.endMin, slots }, 
                               window.SchedulerCoreUtils.fieldLabel(act), 
                               activityProperties, 
                               act, 
                               false // Not a league
                           );
                           
                           if (!isValid) {
                               // If specific assignment fails validation (e.g. Bunk not allowed), drop it.
                               // In a smarter system, we might fallback to Sports here, but for now we safeguard against illegal placements.
                               finalPick = null;
                           }
                       }
                       
                       if (finalPick) {
                           fillBlock({ slots: slots, bunk, startTime: blockInfo.startMin, endTime: blockInfo.endMin }, finalPick, {}, {}, false);
                       }
                   });
               };

               writeAssignments(res.block1Assignments, job.blockA);
               writeAssignments(res.block2Assignments, job.blockB);
            });
        }

        // -- PHASE 4: SPLIT ACTIVITIES (FIXED: Halftime Switch) --
        const splitBlocks = schedulableSlotBlocks.filter(b => b.type === 'split');
        splitBlocks.forEach(sb => {
            // Find Midpoint
            const midTime = Math.floor(sb.startMin + (sb.endMin - sb.startMin) / 2);
            
            // Divide Bunks
            const midIdx = Math.ceil(sb.bunks.length / 2);
            const bunksGroup1 = sb.bunks.slice(0, midIdx);
            const bunksGroup2 = sb.bunks.slice(midIdx);
            const e1 = sb.subEvents[0].event;
            const e2 = sb.subEvents[1].event;
            
            const resolve = (bunk, evtName, startTime, endTime) => {
                const norm = normalizeGA(evtName);
                if (evtName === 'Swim') return { field:'Swim', _activity:'Swim' };
                if (norm === "General Activity Slot" || evtName.includes("Sport")) {
                    return window.findBestGeneralActivity({bunk, divName:sb.division, startTime, endTime}, allActivities, h2hActivities, {}, yesterdayHistory, activityProperties, rotationHistory, divisions, historicalCounts);
                }
                return { field: evtName, _activity: evtName };
            };

            const slots1 = window.SchedulerCoreUtils.findSlotsForRange(sb.startMin, midTime);
            bunksGroup1.forEach(b => fillBlock({ slots: slots1, bunk: b, startTime: sb.startMin, endTime: midTime }, resolve(b, e1, sb.startMin, midTime), {}, {}, false));
            bunksGroup2.forEach(b => fillBlock({ slots: slots1, bunk: b, startTime: sb.startMin, endTime: midTime }, resolve(b, e2, sb.startMin, midTime), {}, {}, false));

            const slots2 = window.SchedulerCoreUtils.findSlotsForRange(midTime, sb.endMin);
            bunksGroup1.forEach(b => fillBlock({ slots: slots2, bunk: b, startTime: midTime, endTime: sb.endMin }, resolve(b, e2, midTime, sb.endMin), {}, {}, false));
            bunksGroup2.forEach(b => fillBlock({ slots: slots2, bunk: b, startTime: midTime, endTime: sb.endMin }, resolve(b, e1, midTime, sb.endMin), {}, {}, false));
        });

        // -- PHASE 5: GENERAL ACTIVITIES --
        const generalBlocks = schedulableSlotBlocks.filter(b => 
            !b.type && 
            !b.event.includes('League') && 
            !b.event.includes('Specialty League') &&
            !window.scheduleAssignments[b.bunk]?.[b.slots[0]]
        );

        generalBlocks.sort((a, b) => (bunkMetaData[b.bunk]?.size || 0) - (bunkMetaData[a.bunk]?.size || 0));

        generalBlocks.forEach(block => {
            let pick = null;
            if (block.event.includes('Special')) {
                pick = window.findBestSpecial(block, allActivities, {}, yesterdayHistory, activityProperties, rotationHistory, divisions, historicalCounts);
            } else if (block.event.includes('Sport')) {
                pick = window.findBestSportActivity(block, allActivities, {}, yesterdayHistory, activityProperties, rotationHistory, divisions, historicalCounts);
            } else {
                pick = window.findBestGeneralActivity(block, allActivities, h2hActivities, {}, yesterdayHistory, activityProperties, rotationHistory, divisions, historicalCounts);
            }

            if (pick) {
                fillBlock(block, pick, {}, yesterdayHistory, false);
                if (pick._activity && block.bunk) {
                    if (!historicalCounts[block.bunk]) historicalCounts[block.bunk] = {};
                    historicalCounts[block.bunk][pick._activity] = (historicalCounts[block.bunk][pick._activity] || 0) + 1;
                    const isSpecial = masterSpecials.some(s => s.name === pick._activity);
                    if (isSpecial) {
                         historicalCounts[block.bunk]['_totalSpecials'] = (historicalCounts[block.bunk]['_totalSpecials'] || 0) + 1;
                    }
                }
            } else {
                fillBlock(block, { field: "Free", sport: null, _activity: "Free" }, {}, {}, false);
            }
        });

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
        } catch (e) {
            console.error("Smart Scheduler: Failed to update rotation history.", e);
        }

        window.saveCurrentDailyData("unifiedTimes", window.unifiedTimes);
        window.updateTable?.();
        window.saveSchedule?.();
        return true;
    };
})();
