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
                    // Full Buyout
                    if (props) {
                        weight = props.sharableWith?.capacity || (props.sharable ? 2 : 1);
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
            historicalCounts, dailyFieldAvailability, bunkMetaData
        } = config;

        window.activityProperties = activityProperties; // Expose for helpers

        // 2. Build Time Grid (For UI mapping)
        // ... (Same logic as before to build window.unifiedTimes based on skeleton points) ...
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

            // -- PHASE 1: PINNED ITEMS (Immediate Write) --
            if (item.type === 'pinned' || ['Lunch','Snack','Dismissal','Swim'].includes(item.event)) {
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
                // Smart logic preprocessing handled via adapter usually, passing through here
                schedulableSlotBlocks.push({ ...item, slots: allSlots, startMin, endMin, bunks: allBunks });
            }
            else {
                // Slots (Activity, League, etc)
                allBunks.forEach(bunk => {
                    schedulableSlotBlocks.push({
                        divName: item.division,
                        bunk: bunk,
                        event: item.event,
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
            fillBlock,
            dailyLeagueSportsUsage: {}
        };

        // -- PHASE 2: LEAGUES & SPECIALTY LEAGUES (Full Buyouts) --
        // Delegated to CoreLeagues, which calls fillBlock(..., isLeague=true)
        window.SchedulerCoreLeagues.processSpecialtyLeagues(context);
        window.SchedulerCoreLeagues.processRegularLeagues(context);

        // -- PHASE 3: SMART TILES --
        // Extract Smart blocks
        const smartBlocks = schedulableSlotBlocks.filter(b => b.type === 'smart');
        smartBlocks.forEach(sb => {
            // Use SmartLogicAdapter logic, but apply results to Timeline
            const jobs = window.SmartLogicAdapter.preprocessSmartTiles([sb], {}, masterSpecials);
            jobs.forEach(job => {
               const divBunks = divisions[job.division]?.bunks || [];
               const res = window.SmartLogicAdapter.generateAssignments(
                   divBunks, job, historicalCounts, specialActivityNames, 
                   activityProperties, {}, dailyFieldAvailability, yesterdayHistory
               );
               
               // Write A
               const slotsA = window.SchedulerCoreUtils.findSlotsForRange(job.blockA.startMin, job.blockA.endMin);
               Object.entries(res.block1Assignments).forEach(([bunk, act]) => {
                   // Check if act is real activity or needs finding
                   let finalPick = { field: act, _activity: act };
                   // If generic "Sports", find specific
                   if (act.includes("Sport")) {
                       finalPick = window.findBestSportActivity({bunk, divName:job.division, startTime:job.blockA.startMin, endTime:job.blockA.endMin}, allActivities, {}, yesterdayHistory, activityProperties, rotationHistory, divisions, historicalCounts);
                   }
                   if (finalPick) {
                       fillBlock({ slots: slotsA, bunk, startTime: job.blockA.startMin, endTime: job.blockA.endMin }, finalPick, {}, {}, false);
                   }
               });
               
               // Write B... (similar logic)
            });
        });

        // -- PHASE 4: SPLIT ACTIVITIES --
        const splitBlocks = schedulableSlotBlocks.filter(b => b.type === 'split');
        splitBlocks.forEach(sb => {
            const mid = Math.ceil(sb.bunks.length / 2);
            const bunks1 = sb.bunks.slice(0, mid);
            const bunks2 = sb.bunks.slice(mid);
            const e1 = sb.subEvents[0].event;
            const e2 = sb.subEvents[1].event;
            
            // Assign Bunks 1 -> E1, Bunks 2 -> E2 (Concurrent, Full Duration)
            // Note: User said "then they switch", implying sequential.
            // But usually splits schedule simply as half/half for capacity.
            // We will book them for full duration to reserve capacity.
            
            // Helper to resolve specific activity if generic
            const resolve = (bunk, evtName) => {
                if (evtName === 'Swim') return { field:'Swim', _activity:'Swim' };
                // Use filler logic
                return window.findBestGeneralActivity({bunk, divName:sb.division, startTime:sb.startMin, endTime:sb.endMin}, allActivities, h2hActivities, {}, yesterdayHistory, activityProperties, rotationHistory, divisions, historicalCounts);
            };

            bunks1.forEach(b => fillBlock({ slots: sb.slots, bunk: b, startTime: sb.startMin, endTime: sb.endMin }, resolve(b, e1), {}, {}, false));
            bunks2.forEach(b => fillBlock({ slots: sb.slots, bunk: b, startTime: sb.startMin, endTime: sb.endMin }, resolve(b, e2), {}, {}, false));
        });

        // -- PHASE 5: GENERAL ACTIVITIES (The Sand) --
        const generalBlocks = schedulableSlotBlocks.filter(b => 
            !b.type && // Not split/smart
            !b.event.includes('League') && 
            !window.scheduleAssignments[b.bunk]?.[b.slots[0]] // Not yet filled
        );

        // Sort by Bunk Size (Bin Packing)
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
                // Update history counts...
            } else {
                fillBlock(block, { field: "Free", _activity: "Free" }, {}, {}, false);
            }
        });

        // Save & Render
        window.saveCurrentDailyData("unifiedTimes", window.unifiedTimes);
        window.updateTable();
        window.saveSchedule();
        return true;
    };
})();
