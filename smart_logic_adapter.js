// =================================================================
// smart_logic_adapter.js
//
// Handles the fairness logic for Smart Tiles with REAL-TIME CAPACITY CHECKS.
//
// FIXED:
// - Per-activity capacity is enforced *within each Smart Tile group*.
// - We compute remaining capacity for each special (Gameroom, Canteen, etc.)
//   by looking at activityProperties + existing fieldUsageBySlot.
// - availabilityChecker decrements that remaining capacity as it assigns,
//   so you can never have more Gamerooms than its capacity in that window.
// =================================================================

(function() {
    'use strict';

    const SmartLogicAdapter = {

        // ---------- CORE ASSIGNMENT ENGINE ----------
        generateAssignments: function(bunks, activities, historicalCounts, constraints, availabilityChecker) {
            const { act1, act2, fallback } = activities;
            
            // Total number of "act1" (special) slots we are allowed to give out
            let maxAct1 = constraints?.maxAct1;
            if (maxAct1 === null || maxAct1 === undefined || maxAct1 === "" || isNaN(maxAct1)) {
                maxAct1 = Math.ceil(bunks.length / 2);
            } else {
                maxAct1 = parseInt(maxAct1, 10);
            }

            // 1. Stats per bunk
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

            // 2. Base pool sort by least total usage
            let pool = [...bunks];
            pool.sort((a, b) => {
                const statA = stats[a];
                const statB = stats[b];
                if (statA.total !== statB.total) {
                    return statA.total - statB.total;
                }
                return 0.5 - Math.random();
            });

            // 3. Sort again by "need gap" (who needs act1 vs act2)
            pool.sort((a, b) => {
                const gapA = stats[a].act2Count - stats[a].act1Count;
                const gapB = stats[b].act2Count - stats[b].act1Count;
                return gapB - gapA;
            });

            const assignments = {};
            let act1AssignedCount = 0;

            pool.forEach(bunk => {
                // Decide preferred "main" based on fairness + act1 budget
                let preferred = act2;
                if (act1AssignedCount < maxAct1) {
                    preferred = act1;
                }

                let finalChoice = preferred;

                if (availabilityChecker && !availabilityChecker(preferred)) {
                    // Can't use preferred (full/unavailable) → fallback
                    finalChoice = fallback || "Sports";
                } else {
                    // Preferred accepted; log act1 usage if applicable
                    if (preferred === act1) {
                        act1AssignedCount++;
                    }
                }

                assignments[bunk] = finalChoice;
            });

            return assignments;
        },

        // ---------- MAIN ENTRY POINT ----------
        processSmartTiles: function(
            schedulableSlotBlocks,
            historicalCounts,
            specialActivityNames,
            fillBlockFn,
            fieldUsageBySlot,
            yesterdayHistory,
            activityProperties
        ) {
            // Step 1: collect smart blocks
            const smartBlocks = schedulableSlotBlocks.filter(b => b.type === 'smart');
            if (smartBlocks.length === 0) return;

            const SLOT_MINUTES = typeof window.INCREMENT_MINS === 'number' ? window.INCREMENT_MINS : 30;

            // Helper: convert unifiedTimes index → minutes
            const getSlotMinuteRange = (slotIdx) => {
                if (!window.unifiedTimes || !window.unifiedTimes[slotIdx]) return null;
                const d = new Date(window.unifiedTimes[slotIdx].start);
                const startMin = d.getHours() * 60 + d.getMinutes();
                const endMin = startMin + SLOT_MINUTES;
                return { startMin, endMin };
            };

            // Helper: check if a slot is allowed by props.timeRules + available flag
            const isSlotAvailableForProps = (slotIdx, props) => {
                if (!props) return false;
                if (!window.unifiedTimes || !window.unifiedTimes[slotIdx]) return false;

                const range = getSlotMinuteRange(slotIdx);
                if (!range) return false;
                const slotStart = range.startMin;
                const slotEnd = range.endMin;

                const rules = props.timeRules || [];
                if (!props.available) return false;
                if (rules.length === 0) return true;

                // Available windows
                const hasAvailable = rules.some(r => r.type === 'Available');
                let ok = !hasAvailable;
                for (const r of rules) {
                    if (r.type !== 'Available') continue;
                    if (slotStart >= r.startMin && slotEnd <= r.endMin) {
                        ok = true;
                        break;
                    }
                }
                // Unavailable windows
                for (const r of rules) {
                    if (r.type !== 'Unavailable') continue;
                    if (slotStart < r.endMin && slotEnd > r.startMin) {
                        ok = false;
                        break;
                    }
                }
                return ok;
            };

            const areSlotsWithinAvailability = (slots, props) => {
                if (!props || !slots || !slots.length) return false;
                for (const sIdx of slots) {
                    if (!isSlotAvailableForProps(sIdx, props)) return false;
                }
                return true;
            };

            // Compute remaining capacity for each special in this group
            const computePerSpecialRemainingForGroup = (group) => {
                const result = {};
                const blocks = group.blocks || [];
                if (!blocks.length || !Array.isArray(specialActivityNames) || !activityProperties) {
                    return result;
                }
                const firstBlock = blocks[0];
                const slots = firstBlock.slots || [];
                const divName = firstBlock.divName;

                specialActivityNames.forEach(name => {
                    const props = activityProperties[name];
                    if (!props || props.available === false) return;

                    // Division constraints
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

                    // Time availability
                    if (!areSlotsWithinAvailability(slots, props)) return;

                    // Base capacity per slot
                    let baseLimit = 1;
                    if (props.sharable) {
                        const cap = (props.sharableWith && typeof props.sharableWith.capacity === 'number')
                            ? props.sharableWith.capacity
                            : 2;
                        baseLimit = cap;
                    }

                    // Already used in those slots
                    let minRemaining = Infinity;
                    slots.forEach(sIdx => {
                        const usage = fieldUsageBySlot[sIdx]?.[name];
                        const used = usage?.count || 0;
                        const rem = Math.max(baseLimit - used, 0);
                        if (rem < minRemaining) minRemaining = rem;
                    });
                    if (minRemaining === Infinity) minRemaining = 0;
                    if (minRemaining > 0) {
                        result[name] = minRemaining;
                    }
                });

                return result; // e.g. { Gameroom:2, Canteen:1 }
            };

            // Group smart blocks by (division + time + event)
            const smartGroups = {};
            const parseTime = (t) => (typeof t === 'number' ? t : t);

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

            const sortedGroups = Object.values(smartGroups)
                .sort((a, b) => (a.timeValue || 0) - (b.timeValue || 0));

            // Process each group in chronological order
            sortedGroups.forEach(group => {
                if (!group.data) return;

                const bunksInGroup = group.blocks.map(b => b.bunk);
                const { main1, main2, fallbackActivity, maxSpecialBunksPerDay } = group.data;

                // 1. Compute per-special remaining capacity for this time window
                const perSpecialRemaining = computePerSpecialRemainingForGroup(group);

                // Total special capacity across all specials in this block
                let dynamicTotalSpecialCap = Object.values(perSpecialRemaining)
                    .reduce((sum, v) => sum + v, 0);

                // Respect manual maxSpecialBunksPerDay if provided
                if (typeof maxSpecialBunksPerDay === 'number') {
                    dynamicTotalSpecialCap = Math.min(dynamicTotalSpecialCap, maxSpecialBunksPerDay);
                }

                if (!dynamicTotalSpecialCap && dynamicTotalSpecialCap !== 0) {
                    dynamicTotalSpecialCap = Math.ceil(bunksInGroup.length / 2);
                }

                // 2. availabilityChecker that also decrements perSpecialRemaining
                const isActivityAvailable = (activityName) => {
                    if (!activityName) return false;
                    const lower = String(activityName).toLowerCase();

                    // Generic categories → leave to main generator
                    if (["sport", "sports", "special activity", "special", "swim", "general activity"]
                        .some(k => lower.includes(k))) {
                        return true;
                    }

                    // Specific specials (Gameroom, Canteen...)
                    if (specialActivityNames &&
                        specialActivityNames.includes(activityName)) {
                        const left = perSpecialRemaining[activityName] || 0;
                        if (left > 0) {
                            perSpecialRemaining[activityName] = left - 1; // reserve one slot
                            return true;
                        }
                        return false; // out of capacity for this special
                    }

                    // Unknown label → don't block
                    return true;
                };

                // 3. Run fairness engine
                const results = this.generateAssignments(
                    bunksInGroup,
                    { act1: main1, act2: main2, fallback: fallbackActivity },
                    historicalCounts,
                    { maxAct1: dynamicTotalSpecialCap },
                    isActivityAvailable
                );

                // 4. Update history + global fieldUsageBySlot based on results
                Object.entries(results).forEach(([bunk, assignedAct]) => {
                    if (!historicalCounts[bunk]) historicalCounts[bunk] = {};
                    historicalCounts[bunk][assignedAct] = (historicalCounts[bunk][assignedAct] || 0) + 1;

                    // For specific special resources, mark usage now
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

                // 5. Convert blocks into core-friendly events / pinned assignments
                group.blocks.forEach(block => {
                    const assignedCategory = results[block.bunk];
                    const norm = String(assignedCategory || "").toLowerCase();

                    // SWIM (main2 case)
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
                    // SPORTS (generic land)
                    else if (norm.includes("sport")) {
                        block.event = "Sports Slot";
                        block.type = 'slot';
                    }
                    // GENERIC SPECIAL
                    else if (norm.includes("special") || norm.includes("activity")) {
                        block.event = "Special Activity";
                        block.type = 'slot';
                    }
                    // SPECIFIC SPECIAL / FALLBACK
                    else {
                        if (specialActivityNames &&
                            specialActivityNames.includes(assignedCategory)) {
                            // Specific special like "Gameroom", "Canteen"
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
                            // Unknown → GA slot
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
