// =================================================================
// smart_logic_adapter.js
//
// Adapted from "SpecialActivityGridFixed" React component.
// Handles the fairness logic for Smart Tiles:
// 1. Calculates historical usage for the specific activities in the tile.
// 2. Sorts bunks by "Least Total Usage" first.
// 3. Sorts winners by "Need" (gap between Act 1 and Act 2).
// 4. Returns optimal assignments.
// =================================================================

(function() {
    'use strict';

    window.SmartLogicAdapter = {
        
        /**
         * Core function to determine which bunks get Activity A vs Activity B
         * based on historical fairness.
         * * @param {Array} bunks - Array of bunk names (strings)
         * @param {Object} activities - { act1: "Canteen", act2: "Gameroom", fallback: "Sports" }
         * @param {Object} history - The global rotationHistory object
         * @param {Object} constraints - { maxAct1: 2 } (Optional capacity limit for Act 1)
         */
        generateAssignments: function(bunks, activities, history, constraints) {
            const { act1, act2, fallback } = activities;
            const maxAct1 = constraints?.maxAct1 || 999; // Default to effectively infinite if 0/null

            // 1. Calculate Stats from History
            // We look at how many times each bunk has done Act1 vs Act2
            const stats = {};
            bunks.forEach(bunk => {
                const bunkHist = history.bunks?.[bunk] || {};
                
                // Count occurrences in history
                // Note: The main app stores history as { "ActivityName": timestamp }
                // To get a true "Count", we might need to rely on 'historicalCounts' calculated in analytics.js
                // OR we calculate simplistic "freshness" based on timestamps.
                
                // For this specific logic, let's look at the 'historicalCounts' passed in 
                // (Scheduler logic usually calculates this). 
                // If not available, we assume 0.
                
                const count1 = (window.debugHistoricalCounts?.[bunk]?.[act1] || 0);
                const count2 = (window.debugHistoricalCounts?.[bunk]?.[act2] || 0);
                
                stats[bunk] = {
                    act1Count: count1,
                    act2Count: count2,
                    total: count1 + count2
                };
            });

            // 2. Create Pool and Sort
            // Primary Sort: Fewest TOTAL specials (Act 1 + Act 2)
            // Secondary Sort: Random (to break ties)
            let pool = [...bunks];
            
            pool.sort((a, b) => {
                const statA = stats[a];
                const statB = stats[b];
                
                if (statA.total !== statB.total) {
                    return statA.total - statB.total; // Ascending (lowest usage first)
                }
                return 0.5 - Math.random();
            });

            // 3. Selection Logic (Capacity Aware)
            // We want to give Act 1 (usually the "scarce" one like Canteen) to those who need it most.
            
            const assignments = {};

            // Identify who "needs" Act 1 the most.
            // Sort the pool by the gap: (Act2_Count - Act1_Count). 
            // Positive gap = Has done Act 2 way more than Act 1 -> Needs Act 1.
            pool.sort((a, b) => {
                const gapA = stats[a].act2Count - stats[a].act1Count;
                const gapB = stats[b].act2Count - stats[b].act1Count;
                return gapB - gapA; // Descending gap
            });

            // Assign Act 1 up to the limit
            let act1Count = 0;
            const act1Bunks = [];
            const act2Bunks = [];

            pool.forEach(bunk => {
                if (act1Count < maxAct1) {
                    act1Bunks.push(bunk);
                    assignments[bunk] = act1;
                    act1Count++;
                } else {
                    // Overflow goes to Act 2
                    act2Bunks.push(bunk);
                    assignments[bunk] = act2;
                }
            });

            // 4. Return the map
            // Format: { "Bunk 1": "Canteen", "Bunk 2": "Gameroom" }
            return assignments;
        }
    };

})();
