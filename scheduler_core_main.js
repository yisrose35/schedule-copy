// ============================================================================
// scheduler_core_main.js (FIXED v6 - GLOBAL LOCK INTEGRATION)
//
// ★★★ CRITICAL PROCESSING ORDER ★★★
// 1. Initialize GlobalFieldLocks (RESET)
// 2. Process Bunk Overrides (pinned specific bunks)
// 3. Process Skeleton Blocks - identify leagues, smart tiles, activities
// 4. ★ SPECIALTY LEAGUES FIRST ★ - Lock their fields globally
// 5. ★ REGULAR LEAGUES SECOND ★ - Lock their fields globally
// 6. Process Smart Tiles - respect all locks
// 7. Run Total Solver for remaining activities - respect all locks
//
// This ensures NO field double-booking across divisions!
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

    function isGeneratedType(name) {
        if (!name) return false;
        const s = name.toLowerCase().trim();
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
    // SMART TILES PROCESSOR
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

        const knownSpecialNames = new Set();
        (masterSpecials || []).forEach(s => {
            if (s.name) knownSpecialNames.add(s.name.toLowerCase().trim());
        });
        (specialActivityNames || []).forEach(name => {
            knownSpecialNames.add(name.toLowerCase().trim());
        });
        const globalSpecials = window.getGlobalSpecialActivities?.() || [];
        globalSpecials.forEach(s => {
            if (s.name) knownSpecialNames.add(s.name.toLowerCase().trim());
        });

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

            function needsGeneration(activityLabel) {
                if (!activityLabel) return false;
                const lower = activityLabel.toLowerCase().trim();
                const genericSlots = [
                    "sports slot", "general activity slot", "general activity",
                    "activity slot", "activity"
                ];
                if (genericSlots.includes(lower)) return true;
                if (lower === "sports") {
                    const isSportsConfigured = activityProperties?.["Sports"] || activityProperties?.["sports"];
                    if (!isSportsConfigured) return true;
                }
                return false;
            }

            function routeActivity(bunk, activityLabel, blockInfo) {
                const startMin = blockInfo.startMin;
                const endMin = blockInfo.endMin;
                const slots = Utils.findSlotsForRange(startMin, endMin);
                
                if (slots.length === 0) {
                    console.warn(`[SmartTile] No slots for ${bunk} at ${startMin}-${endMin}`);
                    return;
                }

                // ★★★ CHECK GLOBAL LOCKS - Don't generate for locked fields ★★★
                if (window.GlobalFieldLocks?.isFieldLocked(activityLabel, slots)) {
                    console.log(`[SmartTile] ${bunk} - ${activityLabel} is LOCKED, skipping`);
                    return;
                }

                if (needsGeneration(activityLabel)) {
                    let slotType = "General Activity Slot";
                    const lower = activityLabel.toLowerCase().trim();
                    if (lower.includes("sport")) slotType = "Sports Slot";

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
                    console.log(`[SmartTile] ${bunk} -> DIRECT FILL: ${activityLabel}`);
                    
                    window.fillBlock(
                        { divName, bunk, startTime: startMin, endTime: endMin, slots },
                        { field: activityLabel, sport: null, _fixed: true, _activity: activityLabel },
                        fieldUsageBySlot,
                        yesterdayHistory,
                        false,
                        activityProperties
                    );
                }
            }

            console.log(`[SmartTile] Block A (${job.blockA.startMin}-${job.blockA.endMin}):`);
            Object.entries(block1Assignments || {}).forEach(([bunk, act]) => {
                routeActivity(bunk, act, job.blockA);
            });

            if (job.blockB && block2Assignments) {
                console.log(`[SmartTile] Block B (${job.blockB.startMin}-${job.blockB.endMin}):`);
                Object.entries(block2Assignments).forEach(([bunk, act]) => {
                    routeActivity(bunk, act, job.blockB);
                });
            }
        });

        return schedulableSlotBlocks;
    }

    // =========================================================================
    // ★★★ MAIN ENTRY POINT ★★★
    // =========================================================================
    window.runSkeletonOptimizer = function (manualSkeleton, externalOverrides) {
        console.log("\n" + "=".repeat(70));
        console.log("★★★ OPTIMIZER STARTED (v6 - GLOBAL LOCK SYSTEM) ★★★");
        console.log("=".repeat(70));
        
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

        // =========================================================================
        // ★★★ STEP 0: INITIALIZE GLOBAL FIELD LOCKS ★★★
        // =========================================================================
        console.log("\n[INIT] Resetting GlobalFieldLocks...");
        if (window.GlobalFieldLocks) {
            window.GlobalFieldLocks.reset();
        } else {
            console.error("[INIT] ❌ GlobalFieldLocks not loaded! Field locking will not work!");
        }

        // Scan skeleton for field reservations
        window.fieldReservations = Utils.getFieldReservationsFromSkeleton(manualSkeleton);
        console.log("[INIT] Scanned skeleton for field reservations");

        // =========================================================================
        // STEP 1: Build Time Grid
        // =========================================================================
        const timePoints = new Set([540, 960]);
        manualSkeleton.forEach(item => {
            const s = Utils.parseTimeToMinutes(item.startTime);
            const e = Utils.parseTimeToMinutes(item.endTime);
            if (s != null) timePoints.add(s);
            if (e != null) timePoints.add(e);
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

        // =========================================================================
        // STEP 2: Process Bunk Overrides (Pinned specific bunks)
        // =========================================================================
        console.log("\n[STEP 2] Processing bunk overrides...");
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

        // =========================================================================
        // STEP 3: Categorize Skeleton Blocks
        // =========================================================================
        console.log("\n[STEP 3] Categorizing skeleton blocks...");
        const schedulableSlotBlocks = [];
        const leagueBlocks = [];
        const specialtyLeagueBlocks = [];
        const GENERATOR_TYPES = ["slot", "activity", "sports", "special", "league", "specialty_league"];

        manualSkeleton.forEach(item => {
            const divName = item.division;
            const bunkList = divisions[divName]?.bunks || [];
            if (bunkList.length === 0) return;

            const sMin = Utils.parseTimeToMinutes(item.startTime);
            const eMin = Utils.parseTimeToMinutes(item.endTime);
            
            // Skip slots that overlap with pinned events
            if (item.type === 'slot' || GENERATOR_TYPES.includes(item.type)) {
                const hasPinnedOverlap = manualSkeleton.some(other => 
                    other.division === divName &&
                    other.type === 'pinned' &&
                    Utils.parseTimeToMinutes(other.startTime) < eMin &&
                    Utils.parseTimeToMinutes(other.endTime) > sMin
                );
                
                if (hasPinnedOverlap) {
                    console.log(`[SKELETON] Skipping ${item.event} for ${divName} - overlaps with pinned event`);
                    return;
                }
            }

            // Split Tile Logic
            if (item.type === 'split') {
                const midMin = Math.floor(sMin + (eMin - sMin) / 2);
                const half = Math.ceil(bunkList.length / 2);
                const groupA = bunkList.slice(0, half);
                const groupB = bunkList.slice(half);
                
                const act1Name = item.subEvents?.[0]?.event || "Activity 1";
                const act2Name = item.subEvents?.[1]?.event || "Activity 2";

                const routeSplitActivity = (bunks, actName, start, end) => {
                    const slots = Utils.findSlotsForRange(start, end);
                    if (slots.length === 0) return;

                    const normName = normalizeGA(actName) || actName;
                    const isGen = isGeneratedType(normName);

                    bunks.forEach(b => {
                        if (isGen) {
                            schedulableSlotBlocks.push({ 
                                divName, bunk: b, event: normName, type: 'slot',
                                startTime: start, endTime: end, slots 
                            });
                        } else {
                            fillBlock(
                                { divName, bunk: b, startTime: start, endTime: end, slots }, 
                                { field: actName, sport: null, _fixed: true, _activity: actName }, 
                                fieldUsageBySlot, yesterdayHistory, false, activityProperties
                            );
                        }
                    });
                };

                routeSplitActivity(groupA, act1Name, sMin, midMin);
                routeSplitActivity(groupB, act2Name, sMin, midMin);
                routeSplitActivity(groupA, act2Name, midMin, eMin);
                routeSplitActivity(groupB, act1Name, midMin, eMin);
                return;
            }

            const slots = Utils.findSlotsForRange(sMin, eMin);
            if (slots.length === 0) return;

            const normGA = normalizeGA(item.event);
            const normLg = normalizeLeague(item.event);
            const normSL = normalizeSpecialtyLeague(item.event);
            const finalName = normGA || normLg || normSL || item.event;

            const isLeague = /league/i.test(finalName) || /league/i.test(item.event);
            const isSpecialtyLeague = item.type === 'specialty_league' || /specialty\s*league/i.test(item.event);
            const isRegularLeague = isLeague && !isSpecialtyLeague;

            // Categorize blocks
            if (isSpecialtyLeague) {
                bunkList.forEach(b => {
                    specialtyLeagueBlocks.push({ 
                        divName, bunk: b, event: finalName, type: 'specialty_league',
                        startTime: sMin, endTime: eMin, slots 
                    });
                });
            } else if (isRegularLeague) {
                bunkList.forEach(b => {
                    leagueBlocks.push({ 
                        divName, bunk: b, event: finalName, type: 'league',
                        startTime: sMin, endTime: eMin, slots 
                    });
                });
            } else {
                const isGenerated = /general|sport|special/i.test(finalName);
                const trans = Utils.getTransitionRules(finalName, activityProperties);
                const hasBuffer = (trans.preMin + trans.postMin) > 0;
                const isSchedulable = GENERATOR_TYPES.includes(item.type);

                if ((item.type === "pinned" || !isGenerated) && !isSchedulable && item.type !== "smart" && !hasBuffer) {
                    if (disabledFields.includes(finalName) || disabledSpecials.includes(finalName)) return;
                    bunkList.forEach(b => {
                        fillBlock({ divName, bunk: b, startTime: sMin, endTime: eMin, slots }, { field: finalName, sport: null, _fixed: true, _activity: finalName }, fieldUsageBySlot, yesterdayHistory, false, activityProperties);
                    });
                    return;
                }

                if ((isSchedulable && isGenerated) || hasBuffer) {
                    bunkList.forEach(b => {
                        schedulableSlotBlocks.push({ 
                            divName, bunk: b, event: finalName, type: item.type,
                            startTime: sMin, endTime: eMin, slots 
                        });
                    });
                }
            }
        });

        console.log(`[SKELETON] Categorized: ${specialtyLeagueBlocks.length} specialty league, ${leagueBlocks.length} regular league, ${schedulableSlotBlocks.length} general blocks`);

        // =========================================================================
        // ★★★ STEP 4: PROCESS SPECIALTY LEAGUES FIRST ★★★
        // =========================================================================
        console.log("\n" + "=".repeat(50));
        console.log("★★★ STEP 4: SPECIALTY LEAGUES (PRIORITY 1) ★★★");
        console.log("=".repeat(50));
        
        const leagueContext = {
            schedulableSlotBlocks: specialtyLeagueBlocks,
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
        
        if (window.SchedulerCoreSpecialtyLeagues?.processSpecialtyLeagues) {
            window.SchedulerCoreSpecialtyLeagues.processSpecialtyLeagues(leagueContext);
        }

        // =========================================================================
        // ★★★ STEP 5: PROCESS REGULAR LEAGUES SECOND ★★★
        // =========================================================================
        console.log("\n" + "=".repeat(50));
        console.log("★★★ STEP 5: REGULAR LEAGUES (PRIORITY 2) ★★★");
        console.log("=".repeat(50));
        
        leagueContext.schedulableSlotBlocks = leagueBlocks;
        if (window.SchedulerCoreLeagues?.processRegularLeagues) {
            window.SchedulerCoreLeagues.processRegularLeagues(leagueContext);
        }

        // =========================================================================
        // STEP 6: PROCESS SMART TILES
        // =========================================================================
        console.log("\n[STEP 6] Processing Smart Tiles...");
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

        // =========================================================================
        // STEP 7: RUN TOTAL SOLVER FOR REMAINING ACTIVITIES
        // =========================================================================
        console.log("\n[STEP 7] Running Total Solver for remaining activities...");
        
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

        console.log(`[SOLVER] Processing ${remainingActivityBlocks.length} activity blocks.`);
        
        if (window.totalSolverEngine && remainingActivityBlocks.length > 0) {
            window.totalSolverEngine.solveSchedule(remainingActivityBlocks, config);
        }

        // =========================================================================
        // STEP 8: Update History
        // =========================================================================
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
        
        console.log("\n" + "=".repeat(70));
        console.log("★★★ OPTIMIZER FINISHED SUCCESSFULLY ★★★");
        console.log("=".repeat(70));
        
        // Final lock debug
        if (window.GlobalFieldLocks) {
            window.GlobalFieldLocks.debugPrintLocks();
        }
        
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
        console.log(`   Capacity A: ${info.capacityA}`);
        console.log(`   Capacity B: ${info.capacityB}`);
        
        console.log(`\n   Block A Assignments:`);
        Object.entries(info.block1 || {}).forEach(([bunk, act]) => {
            console.log(`      ${bunk}: ${act}`);
        });

        if (info.block2) {
            console.log(`\n   Block B Assignments:`);
            Object.entries(info.block2 || {}).forEach(([bunk, act]) => {
                console.log(`      ${bunk}: ${act}`);
            });
        }
    });

    console.log("\n" + "=".repeat(70));
};

window.debugFieldLocks = function() {
    if (window.GlobalFieldLocks) {
        window.GlobalFieldLocks.debugPrintLocks();
    } else {
        console.log("GlobalFieldLocks not loaded");
    }
};

window.debugSpecialAvailability = function(startMin, endMin) {
    const activityProps = window.activityProperties || {};
    const allSpecials = window.getGlobalSpecialActivities?.() || [];
    
    console.log(`\n=== SPECIAL AVAILABILITY: ${startMin}-${endMin} ===`);
    
    const slots = window.SchedulerCoreUtils?.findSlotsForRange(startMin, endMin) || [];
    console.log(`Slots: ${slots.join(', ')}`);
    
    let totalCapacity = 0;
    
    allSpecials.forEach(special => {
        const props = activityProps[special.name] || special;
        const isAvailable = props.available !== false;
        
        // Check global lock
        let isLocked = false;
        if (window.GlobalFieldLocks && slots.length > 0) {
            isLocked = window.GlobalFieldLocks.isFieldLocked(special.name, slots) !== null;
        }
        
        let capacity = 1;
        if (props.sharableWith?.capacity) {
            capacity = parseInt(props.sharableWith.capacity) || 1;
        }
        
        console.log(`\n${special.name}:`);
        console.log(`  Available: ${isAvailable}`);
        console.log(`  Globally Locked: ${isLocked ? '🔒 YES' : 'No'}`);
        console.log(`  Capacity: ${capacity}`);
        
        if (isAvailable && !isLocked) {
            totalCapacity += capacity;
        }
    });
    
    console.log(`\n=== TOTAL AVAILABLE CAPACITY: ${totalCapacity} ===\n`);
};
