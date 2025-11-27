// =================================================================
// smart_logic_adapter.js
//
// Handles the fairness logic for Smart Tiles with REAL-TIME CAPACITY CHECKS.
//
// NEW:
// - For each Smart Tile group (time + division + event), we:
//   1. Look at all special activities (e.g. Gameroom, Canteen).
//   2. Use activityProperties (which already includes Daily Adjustments)
//      to see which specials are available for that time window & division.
//   3. Read each special's capacity (e.g. Gameroom=2, Canteen=1) and
//      subtract current usage from fieldUsageBySlot.
//   4. Sum those remaining capacities to get "how many SPECIAL slots
//      actually exist for this block" and feed that into maxAct1.
// - Availability checker also respects time rules, division rules and capacity.
// =================================================================

(function() {
    'use strict';

    // Small helper: get increment from core
    const SLOT_MINUTES = typeof window.INCREMENT_MINS === 'number' ? window.INCREMENT_MINS : 30;

    const SmartLogicAdapter = {
        
        /**
         * Core function to determine assignments.
         * constraints.maxAct1 is the total number of "special" (act1) slots
         * allowed for this Smart Tile block (computed from real capacity).
         */
        generateAssignments: function(bunks, activities, historicalCounts, constraints, availabilityChecker) {
            const { act1, act2, fallback } = activities;
            
            // Default to half the bunks if no limit set
            let maxAct1 = constraints?.maxAct1;
            if (maxAct1 === null || maxAct1 === undefined || maxAct1 === "" || isNaN(maxAct1)) {
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

            // 2. Create Pool and Sort (Least Total Usage)
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
                // Determine preferred activity based on fairness + capacity budget
                let preferred = act2;
                if (act1AssignedCount < maxAct1) {
                    preferred = act1;
                }

                let finalChoice = preferred;

                // 4. CHECK AVAILABILITY & CAPACITY
                if (availabilityChecker && !availabilityChecker(preferred)) {
                    // Preferred is full or unavailable.
                    // Do NOT increment act1AssignedCount if we failed to place act1.
                    finalChoice = fallback || "Sports"; // Default fallback
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
         * Main entry point:
         * - schedulableSlotBlocks: all blocks (including type:'smart')
         * - historicalCounts: "how many times bunk X did activity Y"
         * - specialActivityNames: list of all special activity names (Gameroom, Canteen, etc.)
         * - fillBlockFn: core's fillBlock
         * - fieldUsageBySlot: shared capacity tracker from core
         * - yesterdayHistory: not used here but passed through
         * - activityProperties: merged properties (fields + specials) with Daily Adjustments
         */
        processSmartTiles: function(
            schedulableSlotBlocks,
            historicalCounts,
            specialActivityNames,
            fillBlockFn,
            fieldUsageBySlot,
            yesterdayHistory,
            activityProperties
        ) {
            // 1. Filter out smart blocks
            const smartBlocks = schedulableSlotBlocks.filter(b => b.type === 'smart');
            if (smartBlocks.length === 0) return;

            // ---- Local helpers that use core data ----

            // Returns {startMin, endMin} for a unifiedTimes slot index
            const getSlotMinuteRange = (slotIdx) => {
                if (!window.unifiedTimes || !window.unifiedTimes[slotIdx]) return null;
                const s = new Date(window.unifiedTimes[slotIdx].start);
                const startMin = s.getHours() * 60 + s.getMinutes();
                const endMin = startMin + SLOT_MINUTES;
                return { startMin, endMin };
            };

            // Check if a single slot index is allowed for a given props.timeRules & available flag.
            const isSlotAvailableForProps = (slotIdx, props) => {
                if (!props) return false;
                if (!window.unifiedTimes || !window.unifiedTimes[slotIdx]) return false;

                const range = getSlotMinuteRange(slotIdx);
                if (!range) return false;
                const slotStartMin = range.startMin;
                const slotEndMin = range.endMin;

                const rules = props.timeRules || [];
                if (rules.length === 0) {
                    return !!props.available;
                }

                if (!props.available) return false;

                const hasAvailable = rules.some(r => r.type === 'Available');

                let ok = !hasAvailable; // if there's an "Available" rule, default false until matched
                for (const rule of rules) {
                    if (rule.type !== 'Available') continue;
                    const rStart = rule.startMin;
                    const rEnd = rule.endMin;
                    if (rStart == null || rEnd == null) continue;
                    if (slotStartMin >= rStart && slotEndMin <= rEnd) {
                        ok = true;
                        break;
                    }
                }

                // Apply Unavailable windows
                for (const rule of rules) {
                    if (rule.type !== 'Unavailable') continue;
                    const rStart = rule.startMin;
                    const rEnd = rule.endMin;
                    if (rStart == null || rEnd == null) continue;
                    if (slotStartMin < rEnd && slotEndMin > rStart) {
                        ok = false;
                        break;
                    }
                }

                return ok;
            };

            // Check if ALL slots in this block are allowed for a given props object.
            const areSlotsWithinAvailability = (slots, props) => {
                if (!props) return false;
                if (!slots || slots.length === 0) return false;
                for (const slotIdx of slots) {
                    if (!isSlotAvailableForProps(slotIdx, props)) {
                        return false;
                    }
                }
                return true;
            };

            // Compute TOTAL remaining capacity across ALL special activities
            // that are:
            // - enabled / available
            // - allowed for this division
            // - allowed at the time window (via timeRules / Daily Adjustments)
            // - not already full according to fieldUsageBySlot.
            const computeTotalSpecialCapacityForGroup = (group) => {
                const blocks = group.blocks || [];
                if (blocks.length === 0) return 0;

                const firstBlock = blocks[0];
                const slots = firstBlock.slots || [];
                const divName = firstBlock.divName;

                if (!slots.length ||
                    !Array.isArray(specialActivityNames) ||
                    !activityProperties) {
                    return 0;
                }

                let totalCapacity = 0;

                specialActivityNames.forEach(specialName => {
                    const props = activityProperties[specialName];
                    if (!props || props.available === false) return;

                    // Division-level constraints
                    if (Array.isArray(props.allowedDivisions) &&
                        props.allowedDivisions.length > 0 &&
                        !props.allowedDivisions.includes(divName)) {
                        return;
                    }

                    if (props.limitUsage?.enabled &&
                        props.limitUsage.divisions &&
                        !props.limitUsage.divisions[divName]) {
                        return;
                    }

                    // Check time availability for all slots in this block
                    if (!areSlotsWithinAvailability(slots, props)) return;

                    // Base capacity per time-slice: sharable -> capacity, else 1
                    let baseLimit = 1;
                    if (props.sharable) {
                        const cap = props.sharableWith && typeof props.sharableWith.capacity === 'number'
                            ? props.sharableWith.capacity
                            : 2;
                        baseLimit = cap;
                    }

                    // For a block that spans multiple slots, the capacity is the MIN
                    // remaining capacity across all slots, otherwise we'd overcount.
                    let remainingForThisSpecial = Infinity;
                    slots.forEach(slotIdx => {
                        const usageObj = fieldUsageBySlot[slotIdx]?.[specialName];
                        const used = usageObj?.count || 0;
                        const rem = Math.max(baseLimit - used, 0);
                        if (rem < remainingForThisSpecial) {
                            remainingForThisSpecial = rem;
                        }
                    });

                    if (remainingForThisSpecial === Infinity) {
                        remainingForThisSpecial = 0;
                    }

                    totalCapacity += remainingForThisSpecial;
                });

                return totalCapacity;
            };

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
            const sortedGroups = Object.values(smartGroups)
                .sort((a, b) => (a.timeValue || 0) - (b.timeValue || 0));

            // 4. Process each group
            sortedGroups.forEach(group => {
                if (!group.data) return;

                const bunksInGroup = group.blocks.map(b => b.bunk);
                const { main1, main2, fallbackActivity, maxSpecialBunksPerDay } = group.data;

                // ---- Compute REAL total special capacity for this time window ----
                // Example:
                //   Gameroom (cap 2, available) + Canteen (cap 1, available)
                //   => totalSpecialCapacity = 3.
                const dynamicSpecialCapacity = computeTotalSpecialCapacityForGroup(group);

                // If designer also set a manual maxSpecialBunksPerDay, be safe and NOT exceed it.
                let effectiveMaxSpecial = dynamicSpecialCapacity;
                if (typeof maxSpecialBunksPerDay === 'number') {
                    effectiveMaxSpecial = Math.min(effectiveMaxSpecial || 0, maxSpecialBunksPerDay);
                }
                // Fallbacks so we never get NaN or 0 when there *are* bunks
                if (!effectiveMaxSpecial && effectiveMaxSpecial !== 0) {
                    effectiveMaxSpecial = Math.ceil(bunksInGroup.length / 2);
                }

                // --- DEFINE AVAILABILITY CHECKER ---
                // Checks if a specific activity (e.g. "Gameroom") is available
                // and not at capacity for THIS block's slots.
                const isActivityAvailable = (activityName) => {
                    if (!activityName) return false;

                    const nameLower = String(activityName).toLowerCase();

                    // For generic categories ("sports", "special activity", etc.),
                    // we let the main generator handle resource picking.
                    if (["sports", "sport", "special activity", "special", "swim", "general activity"]
                        .some(k => nameLower.includes(k))) {
                        return true;
                    }

                    const props = activityProperties?.[activityName];
                    if (!props) return true; // Unknown text label -> don't block

                    // Global "Available" flag
                    if (props.available === false) return false;

                    const refBlock = group.blocks[0];
                    if (!refBlock || !refBlock.slots || refBlock.slots.length === 0) return true;
                    const slots = refBlock.slots;
                    const divName = refBlock.divName;

                    // Division / limitUsage checks
                    if (Array.isArray(props.allowedDivisions) &&
                        props.allowedDivisions.length > 0 &&
                        !props.allowedDivisions.includes(divName)) {
                        return false;
                    }
                    if (props.limitUsage?.enabled &&
                        props.limitUsage.divisions &&
                        !props.limitUsage.divisions[divName]) {
                        return false;
                    }

                    // Time windows
                    if (!areSlotsWithinAvailability(slots, props)) return false;

                    // Capacity per slot (like Gameroom=2 at a time)
                    let baseLimit = 1;
                    if (props.sharable) {
                        const cap = props.sharableWith && typeof props.sharableWith.capacity === 'number'
                            ? props.sharableWith.capacity
                            : 2;
                        baseLimit = cap;
                    }

                    // If any slot is already full for this activity, it's unavailable
                    for (const slotIdx of slots) {
                        const usageObj = fieldUsageBySlot[slotIdx]?.[activityName];
                        const used = usageObj?.count || 0;
                        if (used >= baseLimit) {
                            return false;
                        }
                    }
                    return true;
                };

                // A. Run Fairness Logic with Availability Check
                const results = this.generateAssignments(
                    bunksInGroup,
                    { act1: main1, act2: main2, fallback: fallbackActivity }, 
                    historicalCounts, 
                    { maxAct1: effectiveMaxSpecial },
                    isActivityAvailable
                );

                // B. Update History & Fill Usage IMMEDIATELY
                Object.entries(results).forEach(([bunk, assignedAct]) => {
                    // 1. Update History
                    if (!historicalCounts[bunk]) historicalCounts[bunk] = {};
                    historicalCounts[bunk][assignedAct] =
                        (historicalCounts[bunk][assignedAct] || 0) + 1;
                    
                    // 2. Mark Usage in fieldUsageBySlot (for specific special resources)
                    const block = group.blocks.find(b => b.bunk === bunk);
                    if (block &&
                        specialActivityNames &&
                        specialActivityNames.includes(assignedAct)) {
                        block.slots.forEach(sIdx => {
                            if (!fieldUsageBySlot[sIdx]) fieldUsageBySlot[sIdx] = {};
                            if (!fieldUsageBySlot[sIdx][assignedAct]) {
                                fieldUsageBySlot[sIdx][assignedAct] = {
                                    count: 0,
                                    divisions: [],
                                    bunks: {}
                                };
                            }
                            const usage = fieldUsageBySlot[sIdx][assignedAct];
                            usage.count++;
                            if (!usage.divisions.includes(block.divName)) {
                                usage.divisions.push(block.divName);
                            }
                            usage.bunks[bunk] = assignedAct;
                        });
                    }
                });

                // C. Convert Blocks for the Scheduler
                group.blocks.forEach(block => {
                    const assignedCategory = results[block.bunk];
                    const norm = String(assignedCategory || "").toLowerCase();

                    // CASE 1: SWIM
                    if (norm.includes("swim")) {
                        fillBlockFn(
                            block,
                            { field: "Swim", _fixed: true, _activity: "Swim" },
                            fieldUsageBySlot,
                            yesterdayHistory,
                            false
                        );
                        block.processed = true; 
                    }
                    // CASE 2: SPORTS
                    else if (norm.includes("sport")) {
                        block.event = "Sports Slot";
                        block.type = 'slot'; 
                    } 
                    // CASE 3: SPECIAL (Generic Category)
                    else if (norm.includes("special") || norm.includes("activity")) {
                        block.event = "Special Activity";
                        block.type = 'slot'; 
                    } 
                    // CASE 4: SPECIFIC NAMED SPECIAL / FALLBACK
                    else {
                        if (specialActivityNames &&
                            specialActivityNames.includes(assignedCategory)) {
                            // Specific special like "Gameroom", "Canteen" chosen.
                            // We already validated capacity + time; pin it as fixed.
                            fillBlockFn(
                                block,
                                { 
                                    field: { name: assignedCategory },
                                    sport: null,
                                    _activity: assignedCategory,
                                    _fixed: true
                                },
                                fieldUsageBySlot,
                                yesterdayHistory,
                                false
                            );
                            block.processed = true;
                        } else {
                            // Unknown string -> treat as General Activity
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
