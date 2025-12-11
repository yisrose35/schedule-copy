// ============================================================================
// scheduler_core_main.js (UPDATED V4: ROTATING SPLIT TILES + RESERVATIONS)
//
// UPDATES:
// 1. Intercepts 'split' tiles in the optimizer.
// 2. Rotates bunks: Group A does Act 1 while Group B does Act 2, then switch.
// 3. Intelligently routes "Pinned" (Swim) vs "Generated" (Sports) sub-activities.
// 4. Scans skeleton for Field Reservations early.
// 5. Skips slots that overlap with Pinned events (priority filtering).
// ============================================================================

(function () {
    'use strict';

    const TRANSITION_TYPE = window.TRANSITION_TYPE || "Transition/Buffer";

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------
    function normalizeGA(name) {
        if (!name) return null;
        const s = name.toLowerCase().replace(/\s+/g, '');
        const keys = ["generalactivity", "activity", "activty", "ga", "activityslot"];
        return keys.some(k => s.includes(k)) ? "General Activity Slot" : null;
    }

    function normalizeLeague(name) {
        if (!name) return null;
        const s = name.toLowerCase().replace(/\s+/g, '');
        if (s.includes("league") && !s.includes("specialty")) return "League Game";
        return null;
    }

    function normalizeSpecialtyLeague(name) {
        if (!name) return null;
        const s = name.toLowerCase().replace(/\s+/g, '');
        if (s.includes("specialtyleague") || s.includes("specleague")) return "Specialty League";
        return null;
    }

    // Check if an activity string represents a Generated Slot or a Fixed Event
    function isGeneratedType(name) {
        if (!name) return false;
        const s = name.toLowerCase().trim();
        // User defined list of generated types
        return (
            s.includes("sport") ||
            s.includes("general") ||
            s.includes("activity") ||
            s.includes("special") ||
            s.includes("league")
        );
    }

    // -------------------------------------------------------------------------
    // fillBlock — Buffer/Merge-Safe Inline Writer
    // -------------------------------------------------------------------------
    function fillBlock(block, pick, fieldUsageBySlot, yesterdayHistory, isLeagueFill = false, activityProperties) {
        const Utils = window.SchedulerCoreUtils;
        const fName = Utils.fieldLabel(pick.field);
        const trans = Utils.getTransitionRules(fName, activityProperties);
        const { blockStartMin, blockEndMin, effectiveStart, effectiveEnd } = Utils.getEffectiveTimeRange(block, trans);
        const bunk = block.bunk;
        const zone = trans.zone;

        let writePre = trans.preMin > 0;
        let writePost = trans.postMin > 0;
        const firstSlotIndex = block.slots[0];
        const prevEntry = window.scheduleAssignments[bunk]?.[firstSlotIndex - 1];

        if (writePre && firstSlotIndex > 0) {
            if (prevEntry?._zone === zone && prevEntry?._isTransition && prevEntry?._transitionType === 'Post') {
                writePre = false;
                // Merge logic omitted for brevity, standard behavior applies
            }
        }

        if (writePre) {
            const preSlots = Utils.findSlotsForRange(blockStartMin, effectiveStart);
            preSlots.forEach((slotIndex, i) => {
                window.scheduleAssignments[bunk][slotIndex] = {
                    field: TRANSITION_TYPE, sport: trans.label, continuation: i > 0,
                    _fixed: true, _activity: TRANSITION_TYPE, _isTransition: true,
                    _transitionType: "Pre", _zone: zone, _endTime: effectiveStart
                };
            });
        }

        let mainSlots = Utils.findSlotsForRange(effectiveStart, effectiveEnd);
        if (mainSlots.length === 0 && block.slots && block.slots.length > 0) {
            if (trans.preMin === 0 && trans.postMin === 0) mainSlots = block.slots;
        }

        if (mainSlots.length === 0) {
            console.error(`FillBlock: NO SLOTS for ${bunk} @ ${block.startTime}`);
            return;
        }

        mainSlots.forEach((slotIndex, i) => {
            const existing = window.scheduleAssignments[bunk][slotIndex];
            if (!existing || existing._isTransition) {
                window.scheduleAssignments[bunk][slotIndex] = {
                    field: fName, sport: pick.sport, continuation: i > 0,
                    _fixed: pick._fixed || false, _h2h: pick._h2h || false,
                    _activity: pick._activity || fName,
                    _allMatchups: pick._allMatchups || null,
                    _gameLabel: pick._gameLabel || null,
                    _zone: zone, _endTime: effectiveEnd
                };
                window.registerSingleSlotUsage(slotIndex, fName, block.divName, bunk, pick._activity || fName, fieldUsageBySlot, activityProperties);
            }
        });

        if (writePost) {
            const postSlots = Utils.findSlotsForRange(effectiveEnd, blockEndMin);
            postSlots.forEach((slotIndex, i) => {
                window.scheduleAssignments[bunk][slotIndex] = {
                    field: TRANSITION_TYPE, sport: trans.label, continuation: i > 0,
                    _fixed: true, _activity: TRANSITION_TYPE, _isTransition: true,
                    _transitionType: "Post", _zone: zone, _endTime: blockEndMin
                };
            });
        }
    }
    window.fillBlock = fillBlock;

    // ============================================================================
    // 4. SMART TILES (UPDATED INTEGRATION)
    // ============================================================================

    function processSmartTiles(manualSkeleton, externalOverrides, config) {
        const Utils = window.SchedulerCoreUtils;
        const {
            divisions,
            activityProperties,
            masterSpecials,
            dailyFieldAvailability,
            historicalCounts,
            specialActivityNames,
            yesterdayHistory,
            fieldUsageBySlot
        } = config;

        const schedulableSlotBlocks = [];
        const TRANSITION_TYPE = window.TRANSITION_TYPE || "Transition/Buffer";

        // Build a set of known special activity names for quick lookup
        const knownSpecialNames = new Set();
        
        // From masterSpecials
        (masterSpecials || []).forEach(s => {
            if (s.name) knownSpecialNames.add(s.name.toLowerCase().trim());
        });
        
        // From specialActivityNames
        (specialActivityNames || []).forEach(name => {
            knownSpecialNames.add(name.toLowerCase().trim());
        });
        
        // From getGlobalSpecialActivities
        const globalSpecials = window.getGlobalSpecialActivities?.() || [];
        globalSpecials.forEach(s => {
            if (s.name) knownSpecialNames.add(s.name.toLowerCase().trim());
        });
        
        console.log(`[SmartTile] Known special names: ${[...knownSpecialNames].join(', ')}`);

        // Get smart tile jobs from adapter
        const smartJobs = window.SmartLogicAdapter?.preprocessSmartTiles?.(
            manualSkeleton, 
            externalOverrides, 
            masterSpecials
        ) || [];

        console.log(`[SmartTile] Processing ${smartJobs.length} smart tile jobs`);

        smartJobs.forEach((job, jobIdx) => {
            console.log(`\n[SmartTile] Job ${jobIdx + 1}: ${job.division}`);
            
            const divName = job.division;
            const bunkList = divisions[divName]?.bunks || [];
            
            if (bunkList.length === 0) {
                console.warn(`[SmartTile] No bunks in division ${divName}`);
                return;
            }

            // Generate assignments using the adapter
            const result = window.SmartLogicAdapter.generateAssignments(
                bunkList,
                job,
                historicalCounts,
                specialActivityNames,
                activityProperties,
                null,
                dailyFieldAvailability,
                yesterdayHistory
            );

            if (!result) {
                console.error(`[SmartTile] Failed to generate assignments for ${divName}`);
                return;
            }

            const { block1Assignments, block2Assignments } = result;

            /**
             * Helper: Check if an activity needs to go to the solver/generator
             * * Returns TRUE for generic slots that need the solver:
             * - "Sports", "Sports Slot"
             * - "General Activity", "General Activity Slot"
             * - "Activity"
             * * Returns FALSE for:
             * - Actual special names like "Canteen", "Gameroom", "Woodworking"
             * - Pinned activities like "Swim", "Lunch"
             * - Fallback activities like "Sports" when used as actual assignment
             */
            function needsGeneration(activityLabel) {
                if (!activityLabel) return false;
                
                const lower = activityLabel.toLowerCase().trim();
                
                // These are the ONLY things that need the solver
                const genericSlots = [
                    "sports slot",
                    "general activity slot",
                    "general activity",
                    "activity slot",
                    "activity"
                ];
                
                // Check if it's a generic slot
                if (genericSlots.includes(lower)) {
                    return true;
                }
                
                // "Sports" alone could be either:
                // - A slot type (needs generation) 
                // - An actual fallback assignment (fill directly)
                // We treat it as needing generation only if it's exactly "sports"
                // AND there's no sport with that exact name configured
                if (lower === "sports") {
                    // Check if "Sports" is a configured field/activity
                    const isSportsConfigured = activityProperties?.["Sports"] || 
                                               activityProperties?.["sports"];
                    if (!isSportsConfigured) {
                        return true; // Generic slot, needs generation
                    }
                }
                
                return false;
            }

            /**
             * Helper: Check if activity is a known special
             */
            function isKnownSpecial(activityLabel) {
                if (!activityLabel) return false;
                return knownSpecialNames.has(activityLabel.toLowerCase().trim());
            }

            /**
             * Route activity to generator or fill directly
             */
            function routeActivity(bunk, activityLabel, blockInfo) {
                const startMin = blockInfo.startMin;
                const endMin = blockInfo.endMin;
                const slots = Utils.findSlotsForRange(startMin, endMin);
                
                if (slots.length === 0) {
                    console.warn(`[SmartTile] No slots for ${bunk} at ${startMin}-${endMin}`);
                    return;
                }

                // Check what type of activity this is
                if (needsGeneration(activityLabel)) {
                    // Route to the solver/generator
                    let slotType = "General Activity Slot";
                    const lower = activityLabel.toLowerCase().trim();
                    
                    if (lower.includes("sport")) {
                        slotType = "Sports Slot";
                    }

                    console.log(`[SmartTile] ${bunk} -> GENERATE: ${slotType}`);
                    
                    schedulableSlotBlocks.push({
                        divName,
                        bunk,
                        event: slotType,
                        startTime: startMin,
                        endTime: endMin,
                        slots,
                        fromSmartTile: true
                    });
                } else {
                    // Direct fill - this is an actual activity name
                    // Could be: "Canteen", "Swim", "Gameroom", etc.
                    console.log(`[SmartTile] ${bunk} -> DIRECT FILL: ${activityLabel}`);
                    
                    window.fillBlock(
                        { divName, bunk, startTime: startMin, endTime: endMin, slots },
                        { 
                            field: activityLabel, 
                            sport: null, 
                            _fixed: true, 
                            _activity: activityLabel 
                        },
                        fieldUsageBySlot,
                        yesterdayHistory,
                        false,
                        activityProperties
                    );
                    
                    // Verify the fill worked
                    const check = window.scheduleAssignments[bunk]?.[slots[0]];
                    if (!check) {
                        console.error(`[SmartTile] VERIFY FAILED: ${bunk} slot ${slots[0]} is empty after fillBlock!`);
                    } else {
                        console.log(`[SmartTile] VERIFIED: ${bunk} slot ${slots[0]} = ${check._activity || check.field}`);
                    }
                }
            }

            // Process Block A assignments
            console.log(`[SmartTile] Block A (${job.blockA.startMin}-${job.blockA.endMin}):`);
            Object.entries(block1Assignments || {}).forEach(([bunk, act]) => {
                routeActivity(bunk, act, job.blockA);
            });

            // Process Block B assignments (if exists)
            if (job.blockB && block2Assignments) {
                console.log(`[SmartTile] Block B (${job.blockB.startMin}-${job.blockB.endMin}):`);
                Object.entries(block2Assignments).forEach(([bunk, act]) => {
                    routeActivity(bunk, act, job.blockB);
                });
            }
        });

        return schedulableSlotBlocks;
    }

    // -------------------------------------------------------------------------
    // MAIN ENTRY
    // -------------------------------------------------------------------------
    window.runSkeletonOptimizer = function (manualSkeleton, externalOverrides) {
        console.log(">>> OPTIMIZER STARTED (Split Logic v2)");
        const Utils = window.SchedulerCoreUtils;
        const config = Utils.loadAndFilterData();
        window.activityProperties = config.activityProperties;
        window.unifiedTimes = [];

        const { 
            divisions, 
            activityProperties, 
            masterLeagues, 
            masterSpecialtyLeagues, 
            masterSpecials, 
            yesterdayHistory, 
            rotationHistory, 
            disabledLeagues, 
            disabledSpecialtyLeagues, 
            disabledFields, 
            disabledSpecials, 
            historicalCounts, 
            specialActivityNames, 
            bunkMetaData, 
            dailyFieldAvailability,
            fieldsBySport
        } = config;

        window.SchedulerCoreUtils._bunkMetaData = bunkMetaData;
        window.SchedulerCoreUtils._sportMetaData = config.sportMetaData || {};
        window.fieldUsageBySlot = {};
        let fieldUsageBySlot = window.fieldUsageBySlot;
        window.scheduleAssignments = {};
        window.leagueAssignments = {}; 

        if (!manualSkeleton || manualSkeleton.length === 0) return false;

        // ===== SCAN SKELETON FOR FIELD RESERVATIONS =====
        window.fieldReservations = Utils.getFieldReservationsFromSkeleton(manualSkeleton);
        console.log("[RESERVATION] Scanned skeleton, found reservations:", window.fieldReservations);

        // 1. Build Time Grid
        const timePoints = new Set([540, 960]); // 9am, 4pm defaults
        manualSkeleton.forEach(item => {
            const s = Utils.parseTimeToMinutes(item.startTime);
            const e = Utils.parseTimeToMinutes(item.endTime);
            if (s != null) timePoints.add(s);
            if (e != null) timePoints.add(e);
            // Add midpoints for split tiles to ensure slots exist
            if (item.type === 'split' && s != null && e != null) {
                timePoints.add(Math.floor(s + (e - s) / 2));
            }
        });

        const sorted = [...timePoints].sort((a, b) => a - b);
        for (let i = 0; i < sorted.length - 1; i++) {
            if (sorted[i + 1] - sorted[i] >= 5) {
                const s = Utils.minutesToDate(sorted[i]);
                const e = Utils.minutesToDate(sorted[i + 1]);
                window.unifiedTimes.push({ start: s, end: e, label: `${Utils.fmtTime(s)} - ${Utils.fmtTime(e)}` });
            }
        }

        Object.keys(divisions).forEach(divName => {
            (divisions[divName]?.bunks || []).forEach(b => window.scheduleAssignments[b] = new Array(window.unifiedTimes.length));
        });

        // 2. Process Bunk Overrides (Pinned specific bunks)
        (window.loadCurrentDailyData?.().bunkActivityOverrides || []).forEach(override => {
            const fName = override.activity;
            const startMin = Utils.parseTimeToMinutes(override.startTime);
            const endMin = Utils.parseTimeToMinutes(override.endTime);
            const slots = Utils.findSlotsForRange(startMin, endMin);
            const bunk = override.bunk;
            const divName = Object.keys(divisions).find(d => divisions[d].bunks.includes(bunk));
            if (divName && slots.length > 0) {
                fillBlock({ divName, bunk, startTime: startMin, endTime: endMin, slots }, { field: fName, sport: null, _fixed: true, _activity: fName }, fieldUsageBySlot, yesterdayHistory, false, activityProperties);
            }
        });

        // 3. Process Skeleton Blocks
        const schedulableSlotBlocks = [];
        const GENERATOR_TYPES = ["slot", "activity", "sports", "special", "league", "specialty_league"];

        manualSkeleton.forEach(item => {
            const divName = item.division;
            const bunkList = divisions[divName]?.bunks || [];
            if (bunkList.length === 0) return;

            const sMin = Utils.parseTimeToMinutes(item.startTime);
            const eMin = Utils.parseTimeToMinutes(item.endTime);
            
            // ===== SKIP SLOTS THAT OVERLAP WITH PINNED EVENTS IN THE SAME DIVISION =====
            // This prevents "General Activity Slot" from showing when there's a pinned event
            if (item.type === 'slot' || GENERATOR_TYPES.includes(item.type)) {
                const hasPinnedOverlap = manualSkeleton.some(other => 
                    other.division === divName &&
                    other.type === 'pinned' &&
                    Utils.parseTimeToMinutes(other.startTime) < eMin &&
                    Utils.parseTimeToMinutes(other.endTime) > sMin
                );
                
                if (hasPinnedOverlap) {
                    console.log(`[SKELETON] Skipping ${item.event} for ${divName} - overlaps with pinned event`);
                    return; // Skip this slot, the pinned event takes priority
                }
            }

            // --- SPLIT TILE LOGIC ---
            if (item.type === 'split') {
                const midMin = Math.floor(sMin + (eMin - sMin) / 2);
                
                // Split bunks into two groups
                const half = Math.ceil(bunkList.length / 2);
                const groupA = bunkList.slice(0, half);
                const groupB = bunkList.slice(half);
                
                const act1Name = item.subEvents?.[0]?.event || "Activity 1";
                const act2Name = item.subEvents?.[1]?.event || "Activity 2";

                // Function to route activity (Pinned vs Generated)
                const routeSplitActivity = (bunks, actName, start, end) => {
                    const slots = Utils.findSlotsForRange(start, end);
                    if (slots.length === 0) return;

                    const normName = normalizeGA(actName) || actName;
                    const isGen = isGeneratedType(normName);

                    bunks.forEach(b => {
                        if (isGen) {
                            // Send to generator
                            schedulableSlotBlocks.push({ 
                                divName, 
                                bunk: b, 
                                event: normName,
                                type: 'slot', // Force to slot type
                                startTime: start, 
                                endTime: end, 
                                slots 
                            });
                        } else {
                            // Directly fill pinned (Swim, Lunch, etc)
                            fillBlock(
                                { divName, bunk: b, startTime: start, endTime: end, slots }, 
                                { field: actName, sport: null, _fixed: true, _activity: actName }, 
                                fieldUsageBySlot, yesterdayHistory, false, activityProperties
                            );
                        }
                    });
                };

                // First Half: Group A -> Act 1, Group B -> Act 2
                routeSplitActivity(groupA, act1Name, sMin, midMin);
                routeSplitActivity(groupB, act2Name, sMin, midMin);

                // Second Half: Group A -> Act 2, Group B -> Act 1
                routeSplitActivity(groupA, act2Name, midMin, eMin);
                routeSplitActivity(groupB, act1Name, midMin, eMin);

                return; // Done with this split block
            }

            // --- STANDARD LOGIC ---
            const slots = Utils.findSlotsForRange(sMin, eMin);
            if (slots.length === 0) return;

            const normGA = normalizeGA(item.event);
            const normLg = normalizeLeague(item.event);
            const normSL = normalizeSpecialtyLeague(item.event);
            const finalName = normGA || normLg || normSL || item.event;

            const isGenerated = /general|sport|special|league/i.test(finalName);
            const isLeague = /league/i.test(finalName) || /league/i.test(item.event);
            const trans = Utils.getTransitionRules(finalName, activityProperties);
            const hasBuffer = (trans.preMin + trans.postMin) > 0;
            const isSchedulable = GENERATOR_TYPES.includes(item.type);

            if (!isLeague && (item.type === "pinned" || !isGenerated) && !isSchedulable && item.type !== "smart" && !hasBuffer) {
                if (disabledFields.includes(finalName) || disabledSpecials.includes(finalName)) return;
                bunkList.forEach(b => {
                    fillBlock({ divName, bunk: b, startTime: sMin, endTime: eMin, slots }, { field: finalName, sport: null, _fixed: true, _activity: finalName }, fieldUsageBySlot, yesterdayHistory, false, activityProperties);
                });
                return;
            }

            if (isLeague || (isSchedulable && isGenerated) || hasBuffer) {
                bunkList.forEach(b => {
                    schedulableSlotBlocks.push({ 
                        divName, 
                        bunk: b, 
                        event: finalName,
                        type: item.type,
                        startTime: sMin, 
                        endTime: eMin, 
                        slots 
                    });
                });
            }
        });

        // ====== CALL processSmartTiles ======
        const smartTileBlocks = processSmartTiles(manualSkeleton, externalOverrides, {
            divisions,
            activityProperties,
            masterSpecials,
            dailyFieldAvailability,
            historicalCounts,
            specialActivityNames,
            yesterdayHistory,
            fieldUsageBySlot
        });
        schedulableSlotBlocks.push(...smartTileBlocks);
        console.log(`[SmartTile] Added ${smartTileBlocks.length} blocks to scheduler`);
        
        // 5. Leagues
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
            dailyLeagueSportsUsage: {}, 
            fillBlock,
            fields: config.masterFields || []
        };
        window.SchedulerCoreLeagues?.processSpecialtyLeagues?.(leagueContext);
        window.SchedulerCoreLeagues?.processRegularLeagues?.(leagueContext);

        // 6. Total Solver
        const remainingActivityBlocks = schedulableSlotBlocks
            .filter(b => {
                const isLeague = /league/i.test(b.event) || b.type === 'league' || b.type === 'specialty_league';
                return !isLeague && !b.processed;
            })
            .filter(block => {
                const s = block.slots;
                if (!s || s.length === 0) return false;
                const existing = window.scheduleAssignments[block.bunk]?.[s[0]];
                return !existing || existing._activity === TRANSITION_TYPE;
            })
            .map(b => ({ ...b, _isLeague: false }));

        console.log(`>>> STARTING TOTAL SOLVER: ${remainingActivityBlocks.length} activity blocks.`);
        if (window.totalSolverEngine && remainingActivityBlocks.length > 0) {
            window.totalSolverEngine.solveSchedule(remainingActivityBlocks, config);
        }

        // 7. History Update
        try {
            const newHistory = { ...rotationHistory };
            const timestamp = Date.now();
            Object.keys(divisions).forEach(divName => {
                divisions[divName].bunks.forEach(b => {
                    let lastActivity = null;
                    for (const entry of window.scheduleAssignments[b] || []) {
                        if (entry?._activity && entry._activity !== TRANSITION_TYPE && entry._activity !== lastActivity) {
                            lastActivity = entry._activity;
                            newHistory.bunks ??= {}; newHistory.bunks[b] ??= {};
                            newHistory.bunks[b][entry._activity] = timestamp;
                        }
                    }
                });
            });
            window.saveRotationHistory?.(newHistory);
        } catch (e) { console.error("History update failed:", e); }

        window.saveCurrentDailyData?.("unifiedTimes", window.unifiedTimes);
        window.updateTable?.();
        window.saveSchedule?.();
        console.log(">>> OPTIMIZER FINISHED");
        return true;
    };

    function registerSingleSlotUsage(slotIndex, fieldName, divName, bunkName, activityName, fieldUsageBySlot, activityProperties) {
        if (slotIndex == null || !fieldName) return;
        const key = typeof fieldName === 'string' ? fieldName : (fieldName?.name || String(fieldName));
        const rawProps = (activityProperties && activityProperties[key]) || { available: true, sharable: false, sharableWith: { type: 'not_sharable', capacity: 1 } };
        const cap = rawProps?.sharableWith?.capacity || (rawProps?.sharable ? 2 : 1);
        
        if (!fieldUsageBySlot[slotIndex]) fieldUsageBySlot[slotIndex] = {};
        const existingUsage = fieldUsageBySlot[slotIndex][key] || { count: 0, divisions: [], bunks: {} };
        if (existingUsage.count >= cap) return;

        existingUsage.count++;
        if (bunkName) existingUsage.bunks[bunkName] = activityName || key;
        if (divName && !existingUsage.divisions.includes(divName)) existingUsage.divisions.push(divName);
        fieldUsageBySlot[slotIndex][key] = existingUsage;
    }
    window.registerSingleSlotUsage = registerSingleSlotUsage;
})();

// ============================================================================
// DEBUG UTILITIES
// ============================================================================

/**
 * Call this after running the optimizer to see Smart Tile results
 */
window.debugSmartTiles = function() {
    const data = window.__smartTileToday;
    if (!data) {
        console.log("No smart tile data available. Run the optimizer first.");
        return;
    }

    console.log("\n" + "=".repeat(70));
    console.log("SMART TILE DEBUG REPORT");
    console.log("=".repeat(70));

    Object.entries(data).forEach(([division, info]) => {
        console.log(`\n📋 DIVISION: ${division}`);
        console.log(`   Special Config: ${info.specialConfig}`);
        console.log(`   Open Activity: ${info.openAct}`);
        console.log(`   Fallback: ${info.fallbackAct}`);
        console.log(`   Capacity A: ${info.capacityA} (from: ${info.availableSpecialsA?.join(', ') || 'none'})`);
        console.log(`   Capacity B: ${info.capacityB} (from: ${info.availableSpecialsB?.join(', ') || 'none'})`);
        
        console.log(`\n   Block A Assignments:`);
        Object.entries(info.block1 || {}).forEach(([bunk, act]) => {
            const marker = info.specialWinnersA?.includes(bunk) ? "⭐" : "  ";
            console.log(`   ${marker} ${bunk}: ${act}`);
        });

        if (info.block2) {
            console.log(`\n   Block B Assignments:`);
            Object.entries(info.block2 || {}).forEach(([bunk, act]) => {
                const isFallback = act === info.fallbackAct;
                const marker = isFallback ? "⚠️" : "  ";
                console.log(`   ${marker} ${bunk}: ${act}`);
            });
        }

        if (info.ineligibleBunks?.length > 0) {
            console.log(`\n   ❌ Ineligible (maxed out): ${info.ineligibleBunks.join(', ')}`);
        }

        if (info.nextDayPriority?.length > 0) {
            console.log(`\n   🔜 Priority for tomorrow: ${info.nextDayPriority.join(', ')}`);
        }
    });

    console.log("\n" + "=".repeat(70));
};


/**
 * Check what specials are available at a specific time
 * Usage: window.debugSpecialAvailability(660, 720) // 11am-12pm
 */
window.debugSpecialAvailability = function(startMin, endMin) {
    const activityProps = window.activityProperties || {};
    const dailyData = window.loadCurrentDailyData?.() || {};
    const dailyFieldAvailability = dailyData.dailyFieldAvailability || {};
    
    const allSpecials = window.getGlobalSpecialActivities?.() || [];
    
    console.log(`\n=== SPECIAL AVAILABILITY: ${startMin}-${endMin} ===`);
    
    const slots = window.SchedulerCoreUtils?.findSlotsForRange(startMin, endMin) || [];
    console.log(`Slots: ${slots.join(', ')}`);
    
    let totalCapacity = 0;
    
    allSpecials.forEach(special => {
        const props = activityProps[special.name] || special;
        const dailyRules = dailyFieldAvailability[special.name] || [];
        const effectiveRules = dailyRules.length > 0 ? dailyRules : (props.timeRules || []);
        
        let capacity = 1;
        if (props.sharableWith?.capacity) {
            capacity = parseInt(props.sharableWith.capacity) || 1;
        } else if (props.sharableWith?.type === 'all' || props.sharable) {
            capacity = 2;
        }
        
        const isAvailable = props.available !== false;
        
        console.log(`\n${special.name}:`);
        console.log(`  Available: ${isAvailable}`);
        console.log(`  Capacity: ${capacity}`);
        console.log(`  Time Rules: ${effectiveRules.length > 0 ? JSON.stringify(effectiveRules) : 'none (all day)'}`);
        console.log(`  Max Usage: ${props.maxUsage || 'unlimited'}`);
        
        if (isAvailable) {
            totalCapacity += capacity;
        }
    });
    
    console.log(`\n=== TOTAL CAPACITY: ${totalCapacity} ===\n`);
};


/**
 * Check a specific bunk's special usage history
 */
window.debugBunkHistory = function(bunkName) {
    const config = window.SchedulerCoreUtils?.loadAndFilterData?.() || {};
    const historical = config.historicalCounts || {};
    const bunkHist = historical[bunkName] || {};
    
    console.log(`\nHistory for ${bunkName}:`);
    
    if (Object.keys(bunkHist).length === 0) {
        console.log("  (no history)");
        return;
    }
    
    Object.entries(bunkHist).forEach(([activity, count]) => {
        console.log(`  ${activity}: ${count}`);
    });
};
