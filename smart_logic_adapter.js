// =================================================================
// smart_logic_adapter.js
//
// Handles the fairness logic for Smart Tiles:
// 1. Calculates historical usage for the specific activities in the tile.
// 2. Sorts bunks by "Least Total Usage" first.
// 3. Sorts winners by "Need" (gap between Act 1 and Act 2).
// 4. Returns optimal assignments.
// =================================================================

(function() {
    'use strict';

    const SmartLogicAdapter = {
        
        /**
         * Core function to determine which bunks get Activity A vs Activity B
         * based on historical fairness.
         */
        generateAssignments: function(bunks, activities, historicalCounts, constraints) {
            const { act1, act2 } = activities;
            
            // Default to half the bunks if no limit set
            let maxAct1 = constraints?.maxAct1;
            if (maxAct1 === null || maxAct1 === undefined || maxAct1 === "") {
                maxAct1 = Math.ceil(bunks.length / 2); 
            } else {
                maxAct1 = parseInt(maxAct1, 10);
            }

            // 1. Calculate Stats from History
            const stats = {};
            bunks.forEach(bunk => {
                const bunkCounts = historicalCounts?.[bunk] || {};
                const count1 = bunkCounts[act1] || 0;
                const count2 = bunkCounts[act2] || 0;
                
                stats[bunk] = {
                    act1Count: count1,
                    act2Count: count2,
                    total: count1 + count2
                };
            });

            // 2. Create Pool and Sort (Least Total Usage -> Fairness)
            let pool = [...bunks];
            
            pool.sort((a, b) => {
                const statA = stats[a];
                const statB = stats[b];
                if (statA.total !== statB.total) {
                    return statA.total - statB.total; 
                }
                return 0.5 - Math.random();
            });

            // 3. Selection Logic (Need Gap)
            const assignments = {};
            pool.sort((a, b) => {
                const gapA = stats[a].act2Count - stats[a].act1Count;
                const gapB = stats[b].act2Count - stats[b].act1Count;
                return gapB - gapA; 
            });

            let act1AssignedCount = 0;
            pool.forEach(bunk => {
                if (act1AssignedCount < maxAct1) {
                    assignments[bunk] = act1;
                    act1AssignedCount++;
                } else {
                    assignments[bunk] = act2;
                }
            });

            return assignments;
        },

        /**
         * Main entry point for the Scheduler Core.
         * Processes all smart tiles in the skeleton, decides activities, 
         * updates history, and converts them to standard slots.
         */
        processSmartTiles: function(schedulableSlotBlocks, historicalCounts, specialActivityNames, fillBlockFn, fieldUsageBySlot, yesterdayHistory) {
            // 1. Filter out smart blocks
            const smartBlocks = schedulableSlotBlocks.filter(b => b.type === 'smart');
            if (smartBlocks.length === 0) return;

            // 2. Group by Tile (Time + Division + Event)
            const smartGroups = {};
            smartBlocks.forEach(b => {
                // Simple helper to parse time for sorting
                const parseTime = (t) => {
                    if (typeof t === 'number') return t;
                    // Basic parser if string (HH:MM am/pm) logic needed, 
                    // but usually core passes formatted time or minutes. 
                    // Assuming core passed raw minutes or comparable string.
                    return t; 
                };

                const key = `${b.divName}_${b.startTime}_${b.event}`;
                if (!smartGroups[key]) {
                    smartGroups[key] = { 
                        blocks: [], 
                        data: b.smartData,
                        timeValue: b.startTime // Assuming simple sortable value
                    };
                }
                smartGroups[key].blocks.push(b);
            });

            // 3. Sort groups by time (Morning first)
            const sortedGroups = Object.values(smartGroups).sort((a, b) => (a.timeValue || 0) - (b.timeValue || 0));

            // 4. Process each group
            sortedGroups.forEach(group => {
                if (!group.data) return;

                const bunksInGroup = group.blocks.map(b => b.bunk);
                const { main1, main2, fallbackActivity, maxSpecialBunksPerDay } = group.data;

                // A. Run Fairness Logic
                const results = this.generateAssignments(
                    bunksInGroup,
                    { act1: main1, act2: main2 }, 
                    historicalCounts, 
                    { maxAct1: maxSpecialBunksPerDay }
                );

                // B. Update History Immediately
                Object.entries(results).forEach(([bunk, assignedAct]) => {
                    if (!historicalCounts[bunk]) historicalCounts[bunk] = {};
                    historicalCounts[bunk][assignedAct] = (historicalCounts[bunk][assignedAct] || 0) + 1;
                });

                // C. Convert Blocks
                group.blocks.forEach(block => {
                    const assignedCategory = results[block.bunk];
                    const norm = String(assignedCategory).toLowerCase();

                    // CASE 1: SWIM (Fixed)
                    if (norm.includes("swim")) {
                        fillBlockFn(block, { field: "Swim", _fixed: true, _activity: "Swim" }, fieldUsageBySlot, yesterdayHistory, false);
                        block.processed = true; 
                    }
                    // CASE 2: SPORTS (Generator)
                    else if (norm.includes("sport")) {
                        block.event = "Sports Slot";
                        block.type = 'slot'; 
                    } 
                    // CASE 3: SPECIAL (Generator)
                    else if (norm.includes("special") || norm.includes("activity")) {
                        block.event = "Special Activity";
                        block.type = 'slot'; 
                    } 
                    // CASE 4: SPECIFIC / FALLBACK
                    else {
                        if (specialActivityNames && specialActivityNames.includes(assignedCategory)) {
                             block.event = "Special Activity"; // Map specific requests to generic special slot for now
                             block.type = 'slot';
                        } else {
                             block.event = "General Activity Slot";
                             block.type = 'slot';
                        }
                    }
                });
            });
        }
    };

    window.SmartLogicAdapter = SmartLogicAdapter;

})();
