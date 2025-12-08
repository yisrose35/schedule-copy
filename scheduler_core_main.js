// ============================================================================
// scheduler_core_main.js (GCM PATCHED: FUZZY BUNK LOOKUP)
// PART 3 of 3: THE ORCHESTRATOR
//
// FIXES:
// ✓ Adds "Fuzzy Lookup" to find bunks even if Division names mismatch (3 vs 3rd Grade).
// ✓ LOGS the actual bunk count being added for every league block.
// ============================================================================

(function () {
    'use strict';

    const TRANSITION_TYPE = window.TRANSITION_TYPE || "Transition/Buffer";

    // -------------------------------------------------------------------------
    // Normalizers
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

    // -------------------------------------------------------------------------
    // Helper
    // -------------------------------------------------------------------------
    function fieldLabel(f) {
        return window.SchedulerCoreUtils.fieldLabel(f);
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
                const slotsToWipe = Utils.findSlotsForRange(blockStartMin - trans.postMin, blockStartMin);
                slotsToWipe.forEach(idx => {
                    if (window.scheduleAssignments[bunk][idx]?._transitionType === "Post") {
                        window.scheduleAssignments[bunk][idx] = null;
                    }
                });
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

    // -------------------------------------------------------------------------
    // MAIN ENTRY (GCM PATCHED)
    // -------------------------------------------------------------------------
    window.runSkeletonOptimizer = function (manualSkeleton, externalOverrides) {
        console.log(">>> OPTIMIZER STARTED (GCM PATCHED + FUZZY BUNKS)");
        const Utils = window.SchedulerCoreUtils;
        const config = Utils.loadAndFilterData();
        window.activityProperties = config.activityProperties;
        window.unifiedTimes = [];

        const { divisions, activityProperties, masterLeagues, masterSpecialtyLeagues, masterSpecials, yesterdayHistory, rotationHistory, disabledLeagues, disabledSpecialtyLeagues, disabledFields, disabledSpecials, historicalCounts, specialActivityNames, bunkMetaData, dailyFieldAvailability, fieldsBySport } = config;

        window.SchedulerCoreUtils._bunkMetaData = bunkMetaData;
        window.SchedulerCoreUtils._sportMetaData = config.sportMetaData || {};
        window.fieldUsageBySlot = {};
        let fieldUsageBySlot = window.fieldUsageBySlot;
        window.scheduleAssignments = {};
        window.leagueAssignments = {}; 

        if (!manualSkeleton || manualSkeleton.length === 0) return false;

        const timePoints = new Set([540, 960]);
        manualSkeleton.forEach(item => {
            const s = Utils.parseTimeToMinutes(item.startTime);
            const e = Utils.parseTimeToMinutes(item.endTime);
            if (s != null) timePoints.add(s);
            if (e != null) timePoints.add(e);
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

        // 4 — Pinned Overrides
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

        // === HELPER: FUZZY BUNK LOOKUP ===
        function getBunksForDivision(targetDiv) {
            // 1. Exact Match
            if (divisions[targetDiv]) return divisions[targetDiv].bunks || [];
            
            // 2. Fuzzy Match
            const cleanTarget = String(targetDiv).toLowerCase().replace(/[^a-z0-9]/g, '');
            const key = Object.keys(divisions).find(k => {
                const cleanKey = k.toLowerCase().replace(/[^a-z0-9]/g, '');
                return cleanKey.includes(cleanTarget) || cleanTarget.includes(cleanKey);
            });
            
            if (key) return divisions[key].bunks || [];
            return [];
        }

        // 5 — Collect blocks
        const schedulableSlotBlocks = [];
        const GENERATOR_TYPES = ["slot", "activity", "sports", "special", "league", "specialty_league"];

        manualSkeleton.forEach(item => {
            const divName = item.division;
            const bunkList = getBunksForDivision(divName); // Use Fuzzy Lookup

            if (bunkList.length === 0) {
                // Only warn if we haven't warned already
                if (!window._hasWarnedDiv) {
                    console.warn(`[SKIP] No bunks found for division '${divName}' (Lookup failed).`);
                    window._hasWarnedDiv = true;
                }
                return;
            }

            const sMin = Utils.parseTimeToMinutes(item.startTime);
            const eMin = Utils.parseTimeToMinutes(item.endTime);
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

            // === TRACE LOGGING ===
            if (isLeague) {
                console.log(`[MAIN TRACE] Found League Block "${item.event}" (Div: ${divName})`);
                if (bunkList.length > 0) {
                    console.log(`   -> Pushing ${bunkList.length} items to queue.`);
                } else {
                    console.error("   -> CRITICAL: Bunk List is EMPTY. Item NOT added.");
                }
            }
            // =====================

            // Pinned (Non-League)
            if (!isLeague && (item.type === "pinned" || !isGenerated) && !isSchedulable && item.type !== "smart" && !hasBuffer) {
                if (disabledFields.includes(finalName) || disabledSpecials.includes(finalName)) return;
                bunkList.forEach(b => {
                    fillBlock({ divName, bunk: b, startTime: sMin, endTime: eMin, slots }, { field: finalName, sport: null, _fixed: true, _activity: finalName }, fieldUsageBySlot, yesterdayHistory, false, activityProperties);
                });
                return;
            }

            // Generated (Including Leagues)
            if (isLeague || (isSchedulable && isGenerated) || hasBuffer) {
                bunkList.forEach(b => {
                    schedulableSlotBlocks.push({ divName, bunk: b, event: finalName, startTime: sMin, endTime: eMin, slots });
                });
            }
        });

        console.log(`Schedulable Slot Blocks Count: ${schedulableSlotBlocks.length}`);

        // 6 — Smart Tiles
        const smartJobs = window.SmartLogicAdapter?.preprocessSmartTiles?.(manualSkeleton, externalOverrides, masterSpecials) || [];
        smartJobs.forEach(job => {
            const divName = job.division;
            const bunkList = divisions[divName]?.bunks || [];
            if (bunkList.length === 0) return;

            const result = window.SmartLogicAdapter.generateAssignments(
                bunkList, job, historicalCounts, specialActivityNames,
                activityProperties, null, dailyFieldAvailability, yesterdayHistory
            );

            const { block1Assignments, block2Assignments } = result || {};

            function pushGen(bunk, ev, st, en) {
                const slots = Utils.findSlotsForRange(st, en);
                schedulableSlotBlocks.push({
                    divName,
                    bunk,
                    event: ev,
                    startTime: st,
                    endTime: en,
                    slots,
                    fromSmartTile: true
                });
            }

            const sA = Utils.findSlotsForRange(job.blockA.startMin, job.blockA.endMin);
            Object.entries(block1Assignments || {}).forEach(([b, act]) => {
                const L = act.toLowerCase();
                if (L.includes("sport")) pushGen(b, "Sports Slot", job.blockA.startMin, job.blockA.endMin);
                else if (L.includes("special")) pushGen(b, "Special Activity", job.blockA.startMin, job.blockA.endMin);
                else if (L.includes("general")) pushGen(b, "General Activity Slot", job.blockA.startMin, job.blockA.endMin);
                else fillBlock(
                    { divName, bunk: b, startTime: job.blockA.startMin, endTime: job.blockA.endMin, slots: sA },
                    { field: act, sport: null, _fixed: true, _activity: act },
                    fieldUsageBySlot, yesterdayHistory, false, activityProperties
                );
            });

            if (job.blockB) {
                const sB = Utils.findSlotsForRange(job.blockB.startMin, job.blockB.endMin);
                Object.entries(block2Assignments || {}).forEach(([b, act]) => {
                    const L = act.toLowerCase();
                    if (L.includes("sport")) pushGen(b, "Sports Slot", job.blockB.startMin, job.blockB.endMin);
                    else if (L.includes("special")) pushGen(b, "Special Activity", job.blockB.startMin, job.blockB.endMin);
                    else if (L.includes("general")) pushGen(b, "General Activity Slot", job.blockB.startMin, job.blockB.endMin);
                    else fillBlock(
                        { divName, bunk: b, startTime: job.blockB.startMin, endTime: job.blockB.endMin, slots: sB },
                        { field: act, sport: null, _fixed: true, _activity: act },
                        fieldUsageBySlot, yesterdayHistory, false, activityProperties
                    );
                });
            }
        });

        // 7 — Leagues
        const leagueContext = {
            schedulableSlotBlocks, fieldUsageBySlot, activityProperties, masterSpecialtyLeagues, disabledSpecialtyLeagues, masterLeagues, disabledLeagues, rotationHistory, yesterdayHistory, divisions, fieldsBySport, dailyLeagueSportsUsage: {}, fillBlock
        };
        window.SchedulerCoreLeagues?.processSpecialtyLeagues?.(leagueContext);
        window.SchedulerCoreLeagues?.processRegularLeagues?.(leagueContext);

        // 8 — Total Solver
        const remainingActivityBlocks = schedulableSlotBlocks
            .filter(b => !/league/i.test(b.event) && !b.processed)
            .filter(block => {
                const s = block.slots;
                if (!s || s.length === 0) return false;
                const existing = window.scheduleAssignments[block.bunk]?.[s[0]];
                return !existing || existing._activity === TRANSITION_TYPE;
            })
            .map(b => ({ ...b, _isLeague: false }));

        console.log(`>>> STARTING TOTAL SOLVER: ${remainingActivityBlocks.length} activity blocks to fill.`);
        if (window.totalSolverEngine && remainingActivityBlocks.length > 0) {
            window.totalSolverEngine.solveSchedule(remainingActivityBlocks, config);
        }

        // 9 — History Update
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
