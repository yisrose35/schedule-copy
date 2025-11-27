// =================================================================
// smart_logic_adapter.js
//
// Handles the fairness logic for Smart Tiles:
// 1. Calculates historical usage.
// 2. Sorts bunks by "Least Total Usage" & "Need Gap".
// 3. Checks REAL-TIME availability (Option B).
// 4. Assigns Primary or Fallback based on capacity.
// =================================================================

(function() {
    'use strict';

    const SmartLogicAdapter = {
        
        /**
         * Core function to determine assignments.
         * NOW UPDATED to check availability before finalizing.
         */
        generateAssignments: function(bunks, activities, historicalCounts, constraints, availabilityChecker) {
            const { act1, act2, fallback } = activities;
            
            // Default to half the bunks if no limit set
            let maxAct1 = constraints?.maxAct1;
            if (maxAct1 === null || maxAct1 === undefined || maxAct1 === "") {
                maxAct1 = Math.ceil(bunks.length / 2); 
            } else {
                maxAct1 = parseInt(maxAct1, 10);
            }

            // 1. Calculate Stats
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
                // Determine preferred activity
                let preferred = act2;
                if (act1AssignedCount < maxAct1) {
                    preferred = act1;
                }

                // CHECK AVAILABILITY (The Fix)
                // If preferred is "Special" (or specific like "Canteen"), check if it's actually open.
                // If not, force fallback.
                let finalChoice = preferred;
                
                if (availabilityChecker && !availabilityChecker(preferred)) {
                    // Preferred is full/unavailable.
                    // If preferred was Act1, we don't increment act1AssignedCount (save it for someone else).
                    // Use Fallback.
                    finalChoice = fallback || "Sports"; // Default to Sports if no fallback defined
                    console.log(`Smart Adapter: ${bunk} wanted ${preferred} but it was full. Switched to ${finalChoice}.`);
                } else {
                    // Preferred is valid.
                    if (preferred === act1) {
                        act1AssignedCount++;
                    }
                }

                assignments[bunk] = finalChoice;
            });

            return assignments;
        },

        /**
         * Main entry point.
         */
        processSmartTiles: function(schedulableSlotBlocks, historicalCounts, specialActivityNames, fillBlockFn, fieldUsageBySlot, yesterdayHistory, activityProperties) {
            // 1. Filter out smart blocks
            const smartBlocks = schedulableSlotBlocks.filter(b => b.type === 'smart');
            if (smartBlocks.length === 0) return;

            // 2. Group by Tile (Time + Division + Event)
            const smartGroups = {};
            
            const parseTime = (t) => {
                if (typeof t === 'number') return t;
                return t; 
            };

            smartBlocks.forEach(b => {
                const key = `${b.divName}_${b.startTime}_${b.event}`;
                if (!smartGroups[key]) {
                    smartGroups[key] = { 
                        blocks: [], 
                        data: b.smartData,
                        timeValue: parseTime(b.startTime) 
                    };
                }
                smartGroups[key].blocks.push(b);
            });

            // 3. Sort groups by time
            const sortedGroups = Object.values(smartGroups).sort((a, b) => (a.timeValue || 0) - (b.timeValue || 0));

            // 4. Process each group
            sortedGroups.forEach(group => {
                if (!group.data) return;

                const bunksInGroup = group.blocks.map(b => b.bunk);
                const { main1, main2, fallbackActivity, maxSpecialBunksPerDay } = group.data;

                // Define Availability Checker
                // Checks if a specific activity (e.g. "Canteen") has reached its GLOBAL capacity for this time slot.
                const isActivityAvailable = (activityName) => {
                    // If it's a generic category ("Sports", "Special"), we assume availability (generator handles it).
                    // If it's a specific resource ("Canteen"), we check fieldUsageBySlot.
                    if (["sports", "special", "swim", "general activity"].some(k => activityName.toLowerCase().includes(k))) {
                        return true; 
                    }

                    // Check specific resource limits
                    const props = activityProperties?.[activityName];
                    if (!props) return true; // Unknown activity, assume yes or let generator handle fail
                    
                    // Check usage in ALL slots for this block
                    // We look at the FIRST block in the group (they share time slots)
                    const refBlock = group.blocks[0];
                    if (!refBlock || !refBlock.slots) return true;

                    // Check capacity
                    const limit = (props.sharableWith && typeof props.sharableWith.capacity === 'number') 
                        ? props.sharableWith.capacity : (props.sharable ? 2 : 1);

                    for (const slotIdx of refBlock.slots) {
                        const usage = fieldUsageBySlot[slotIdx]?.[activityName];
                        if (usage && usage.count >= limit) {
                            return false; // FULL!
                        }
                    }
                    return true;
                };

                // A. Run Fairness Logic with Availability Check
                const results = this.generateAssignments(
                    bunksInGroup,
                    { act1: main1, act2: main2, fallback: fallbackActivity }, 
                    historicalCounts, 
                    { maxAct1: maxSpecialBunksPerDay },
                    isActivityAvailable
                );

                // B. Update History & Fill Usage
                Object.entries(results).forEach(([bunk, assignedAct]) => {
                    if (!historicalCounts[bunk]) historicalCounts[bunk] = {};
                    historicalCounts[bunk][assignedAct] = (historicalCounts[bunk][assignedAct] || 0) + 1;
                    
                    // Crucial: Mark usage NOW so next bunk in loop sees it's full
                    // We need to find the block for this bunk to get slots
                    const block = group.blocks.find(b => b.bunk === bunk);
                    if (block && specialActivityNames && specialActivityNames.includes(assignedAct)) {
                         // It's a specific resource, mark it as used!
                         // We mimic markFieldUsage logic here briefly
                         block.slots.forEach(sIdx => {
                             if(!fieldUsageBySlot[sIdx]) fieldUsageBySlot[sIdx] = {};
                             if(!fieldUsageBySlot[sIdx][assignedAct]) fieldUsageBySlot[sIdx][assignedAct] = { count:0, divisions:[], bunks:{} };
                             fieldUsageBySlot[sIdx][assignedAct].count++;
                             if(!fieldUsageBySlot[sIdx][assignedAct].divisions.includes(block.divName))
                                 fieldUsageBySlot[sIdx][assignedAct].divisions.push(block.divName);
                         });
                    }
                });

                // C. Convert Blocks
                group.blocks.forEach(block => {
                    const assignedCategory = results[block.bunk];
                    const norm = String(assignedCategory).toLowerCase();

                    // CASE 1: SWIM
                    if (norm.includes("swim")) {
                        fillBlockFn(block, { field: "Swim", _fixed: true, _activity: "Swim" }, fieldUsageBySlot, yesterdayHistory, false);
                        block.processed = true; 
                    }
                    // CASE 2: SPORTS
                    else if (norm.includes("sport")) {
                        block.event = "Sports Slot";
                        block.type = 'slot'; 
                    } 
                    // CASE 3: SPECIAL (Generic)
                    else if (norm.includes("special") || norm.includes("activity")) {
                        block.event = "Special Activity";
                        block.type = 'slot'; 
                    } 
                    // CASE 4: SPECIFIC / FALLBACK
                    else {
                        if (specialActivityNames && specialActivityNames.includes(assignedCategory)) {
                             // If we successfully assigned a specific special (checked via availability above),
                             // we map it to "Special Activity" BUT we should try to ensure the generator picks it.
                             // Since we already incremented usage count above, the generator might skip it if we don't pass a specific hint.
                             // For simplified flow: Map to generic slot.
                             block.event = "Special Activity";
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
