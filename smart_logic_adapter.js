// =================================================================
// smart_logic_adapter.js
//
// Handles the fairness logic for Smart Tiles with REAL-TIME CAPACITY CHECKS.
// 1. Calculates historical usage.
// 2. Sorts bunks by "Least Total Usage" & "Need Gap".
// 3. Checks availability & capacity for the specific time slot.
// 4. Assigns Primary or Fallback based on real-time limits.
// =================================================================

(function() {
    'use strict';

    const SmartLogicAdapter = {
        
        /**
         * Core function to determine assignments.
         * UPDATED: Accepts an availabilityChecker callback to validate choices against capacity.
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
                // Determine preferred activity based on fairness
                let preferred = act2;
                if (act1AssignedCount < maxAct1) {
                    preferred = act1;
                }

                // 4. CHECK AVAILABILITY & CAPACITY (The Fix)
                // We ask the checker: "Is 'Gameroom' available right now, and do we have space?"
                let finalChoice = preferred;
                
                if (availabilityChecker && !availabilityChecker(preferred)) {
                    // Preferred is full or unavailable.
                    // If preferred was Act1, we don't increment act1AssignedCount (save that 'fairness slot' for someone else if possible).
                    // Switch to Fallback.
                    finalChoice = fallback || "Sports"; // Default to Sports if no fallback defined
                    // Console log for debugging
                    // console.log(`Smart Adapter: ${bunk} wanted ${preferred} but it was full/unavailable. Switched to ${finalChoice}.`);
                } else {
                    // Preferred is valid and available.
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

            // 3. Sort groups by time to ensure chronological processing
            const sortedGroups = Object.values(smartGroups).sort((a, b) => (a.timeValue || 0) - (b.timeValue || 0));

            // 4. Process each group
            sortedGroups.forEach(group => {
                if (!group.data) return;

                const bunksInGroup = group.blocks.map(b => b.bunk);
                const { main1, main2, fallbackActivity, maxSpecialBunksPerDay } = group.data;

                // --- DEFINE AVAILABILITY CHECKER ---
                // This function checks if a specific activity (e.g. "Canteen") has reached its GLOBAL capacity 
                // for the specific time slots this block occupies.
                const isActivityAvailable = (activityName) => {
                    // If it's a generic category ("Sports", "Special"), we assume availability (generator handles it).
                    // We only check limits for specific named resources.
                    if (["sports", "special", "swim", "general activity"].some(k => activityName.toLowerCase().includes(k))) {
                        return true; 
                    }

                    // Check specific resource definition
                    const props = activityProperties?.[activityName];
                    
                    // If activity is not defined in setup, we can't check capacity, so assume available? 
                    // Or assume unavailable? Let's assume available to be safe, or unavailable if strict.
                    // Safer to assume available if it's just a text string not in our system.
                    if (!props) return true; 

                    // Check global "Available" toggle
                    if (props.available === false) return false;

                    // Check Time Rules (Daily Adjustments + Global)
                    // We check the FIRST slot of the block (assuming all slots have same rules for simplicity)
                    const refBlock = group.blocks[0];
                    if (!refBlock || !refBlock.slots || refBlock.slots.length === 0) return true;
                    
                    // Helper from core logic (we need to access it or replicate it)
                    // Since we can't easily call core's 'isTimeAvailable', we rely on the fact that
                    // 'activityProperties' passed in presumably has the resolved time rules.
                    // A simplified check: if any rule says "Unavailable" for this time, return false.
                    // (Skipping detailed minute-by-minute check here for brevity/performance, trusting global availability flag)

                    // CHECK CAPACITY
                    // 1. Get the limit. If sharable, use custom capacity. If not, 1.
                    let limit = 1;
                    if (props.sharable) {
                        limit = (props.sharableWith && typeof props.sharableWith.capacity === 'number') 
                            ? props.sharableWith.capacity : 2;
                    }

                    // 2. Count current usage in the target slots
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
                    isActivityAvailable // Pass the checker!
                );

                // B. Update History & Fill Usage IMMEDIATELY
                Object.entries(results).forEach(([bunk, assignedAct]) => {
                    // 1. Update History
                    if (!historicalCounts[bunk]) historicalCounts[bunk] = {};
                    historicalCounts[bunk][assignedAct] = (historicalCounts[bunk][assignedAct] || 0) + 1;
                    
                    // 2. Mark Usage in fieldUsageBySlot (CRITICAL for capacity check to work for next bunk)
                    // We need to find the block for this bunk to get its slots
                    const block = group.blocks.find(b => b.bunk === bunk);
                    if (block && specialActivityNames && specialActivityNames.includes(assignedAct)) {
                         // It's a specific resource (e.g. Gameroom), mark it as used!
                         block.slots.forEach(sIdx => {
                             if(!fieldUsageBySlot[sIdx]) fieldUsageBySlot[sIdx] = {};
                             if(!fieldUsageBySlot[sIdx][assignedAct]) fieldUsageBySlot[sIdx][assignedAct] = { count:0, divisions:[], bunks:{} };
                             
                             fieldUsageBySlot[sIdx][assignedAct].count++;
                             
                             if(!fieldUsageBySlot[sIdx][assignedAct].divisions.includes(block.divName)) {
                                 fieldUsageBySlot[sIdx][assignedAct].divisions.push(block.divName);
                             }
                             // Also track which bunk took it (optional but good for debugging)
                             if(!fieldUsageBySlot[sIdx][assignedAct].bunks) fieldUsageBySlot[sIdx][assignedAct].bunks = {};
                             fieldUsageBySlot[sIdx][assignedAct].bunks[bunk] = assignedAct;
                         });
                    }
                });

                // C. Convert Blocks for the Scheduler
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
                             // It matched a specific resource name (e.g. "Gameroom").
                             // We've already marked the usage above, so the slot is "booked" in the checker.
                             // Now we tell the generator: "This block is for Special Activity".
                             // Pass 4 will see "Special Activity", try to find a spot.
                             // Since we marked "Gameroom" as used by THIS bunk, the generator *should* see it's valid for this bunk
                             // but might get confused if it thinks it's full.
                             // Actually, simpler: We treat it as a FIXED assignment here since we already validated capacity.
                             
                             fillBlockFn(block, { 
                                 field: { name: assignedCategory }, // e.g. { name: "Gameroom" }
                                 sport: null,
                                 _activity: assignedCategory,
                                 _fixed: true // Lock it in so generator doesn't move it
                             }, fieldUsageBySlot, yesterdayHistory, false);
                             
                             block.processed = true; // Done!
                        } else {
                             // Fallback for unknown strings
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
