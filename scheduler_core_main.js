// ============================================================================
// scheduler_core_main.js
// PART 3 of 3: THE ORCHESTRATOR (Main Entry)
//
// UPDATED:
// - Ensures loadAndFilterData is called and results are globally exposed.
// - Fixed registerSingleSlotUsage (Removed missing global check).
// - Correctly uses activityProperties for validation.
// - Robust transition and fillBlock logic.
// - INJECTS METADATA into Utils for capacity checks.
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
        const keys = [
            "generalactivity", "activity", "activty", "activyty",
            "activityslot", "genactivity", "ga"
        ];
        return keys.some(k => s.includes(k)) ? "General Activity Slot" : null;
    }

    function normalizeLeague(name) {
        if (!name) return null;
        const s = name.toLowerCase().replace(/\s+/g, '');
        const keys = ["leaguegame", "leaguegameslot", "lgame", "lg"];
        return keys.some(k => s.includes(k)) ? "League Game" : null;
    }

    function normalizeSpecialtyLeague(name) {
        if (!name) return null;
        const s = name.toLowerCase().replace(/\s+/g, '');
        const keys = [
            "specialtyleague", "specialityleague", "specleague",
            "specialleague", "sleauge"
        ];
        return keys.some(k => s.includes(k)) ? "Specialty League" : null;
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

        const {
            blockStartMin,
            blockEndMin,
            effectiveStart,
            effectiveEnd
        } = Utils.getEffectiveTimeRange(block, trans);

        const bunk = block.bunk;
        const zone = trans.zone;

        let writePre = trans.preMin > 0;
        let writePost = trans.postMin > 0;

        const firstSlotIndex = block.slots[0];
        const prevEntry = window.scheduleAssignments[bunk]?.[firstSlotIndex - 1];

        // ----- Transition merge (pre) -----
        if (writePre && firstSlotIndex > 0) {
            if (
                prevEntry?._zone === zone &&
                prevEntry?._isTransition &&
                prevEntry?._transitionType === 'Post'
            ) {
                writePre = false;
                const slotsToWipe = Utils.findSlotsForRange(blockStartMin - trans.postMin, blockStartMin);
                slotsToWipe.forEach(idx => {
                    if (window.scheduleAssignments[bunk][idx]?._transitionType === "Post") {
                        window.scheduleAssignments[bunk][idx] = null;
                    }
                });
            }
        }

        // ----- PRE BUFFER -----
        if (writePre) {
            const preSlots = Utils.findSlotsForRange(blockStartMin, effectiveStart);
            preSlots.forEach((slotIndex, i) => {
                window.scheduleAssignments[bunk][slotIndex] = {
                    field: TRANSITION_TYPE,
                    sport: trans.label,
                    continuation: i > 0,
                    _fixed: true,
                    _activity: TRANSITION_TYPE,
                    _isTransition: true,
                    _transitionType: "Pre",
                    _zone: zone,
                    _endTime: effectiveStart
                };
            });
        }

        // ----- MAIN ACTIVITY -----
        const mainSlots = Utils.findSlotsForRange(effectiveStart, effectiveEnd);
        mainSlots.forEach((slotIndex, i) => {
            const existing = window.scheduleAssignments[bunk][slotIndex];
            if (!existing || existing._isTransition) {
                window.scheduleAssignments[bunk][slotIndex] = {
                    field: fName,
                    sport: pick.sport,
                    continuation: i > 0,
                    _fixed: pick._fixed || false,
                    _h2h: pick._h2h || false,
                    _activity: pick._activity || fName,
                    _allMatchups: pick._allMatchups || null,
                    _gameLabel: pick._gameLabel || null,
                    _zone: zone,
                    _endTime: effectiveEnd
                };

                // FIXED: Use activityProperties to validate, not missing global array
                window.registerSingleSlotUsage(
                    slotIndex,
                    fName,
                    block.divName,
                    bunk,
                    pick._activity,
                    fieldUsageBySlot,
                    activityProperties
                );
            }
        });

        // ----- POST BUFFER -----
        if (writePost) {
            const postSlots = Utils.findSlotsForRange(effectiveEnd, blockEndMin);
            postSlots.forEach((slotIndex, i) => {
                window.scheduleAssignments[bunk][slotIndex] = {
                    field: TRANSITION_TYPE,
                    sport: trans.label,
                    continuation: i > 0,
                    _fixed: true,
                    _activity: TRANSITION_TYPE,
                    _isTransition: true,
                    _transitionType: "Post",
                    _zone: zone,
                    _endTime: blockEndMin
                };
            });
        }
    }

    window.fillBlock = fillBlock;

    // -------------------------------------------------------------------------
    // MAIN ENTRY
    // -------------------------------------------------------------------------
    window.runSkeletonOptimizer = function (manualSkeleton, externalOverrides) {
        const Utils = window.SchedulerCoreUtils;

        // 1 — Load from new loader
        const config = Utils.loadAndFilterData();

        // 1.1 -- EXPOSE PROPERTIES GLOBALLY IMMEDIATELY
        // This ensures subsequent calls (like in Logic Fillers or UI probes) see valid data.
        window.activityProperties = config.activityProperties; 
        window.unifiedTimes = []; // Will be populated below

        const {
            divisions,
            activityProperties,
            allActivities,
            h2hActivities,
            fieldsBySport,
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
            masterZones
        } = config;

        // --- INJECT METADATA INTO UTILS FOR CAPACITY CHECKS ---
        window.SchedulerCoreUtils._bunkMetaData = bunkMetaData;
        window.SchedulerCoreUtils._sportMetaData = config.sportMetaData || {};

        window.fieldUsageBySlot = {};
        let fieldUsageBySlot = window.fieldUsageBySlot;

        // 2 — Build time grid
        window.scheduleAssignments = {};
        window.leagueAssignments = {};
        
        if (!manualSkeleton || manualSkeleton.length === 0) return false;

        const timePoints = new Set([540, 960]); // default 9:00 – 16:00

        manualSkeleton.forEach(item => {
            const s = Utils.parseTimeToMinutes(item.startTime);
            const e = Utils.parseTimeToMinutes(item.endTime);
            if (s != null) timePoints.add(s);
            if (e != null) timePoints.add(e);
        });

        const sorted = [...timePoints].sort((a, b) => a - b);

        for (let i = 0; i < sorted.length - 1; i++) {
            const start = sorted[i];
            const end = sorted[i + 1];
            if (end - start >= 5) {
                window.unifiedTimes.push({
                    start: Utils.minutesToDate(start),
                    end: Utils.minutesToDate(end),
                    label: `${Utils.fmtTime(Utils.minutesToDate(start))} - ${Utils.fmtTime(Utils.minutesToDate(end))}`
                });
            }
        }

        if (window.unifiedTimes.length === 0) return false;

        // 3 — Empty schedule arrays
        Object.keys(divisions).forEach(divName => {
            (divisions[divName]?.bunks || []).forEach(b => {
                window.scheduleAssignments[b] = new Array(window.unifiedTimes.length);
            });
        });

        // 4 — Apply pinned bunk overrides
        const bunkOverrides = window.loadCurrentDailyData?.().bunkActivityOverrides || [];

        bunkOverrides.forEach(override => {
            const fName = override.activity;
            const startMin = Utils.parseTimeToMinutes(override.startTime);
            const endMin = Utils.parseTimeToMinutes(override.endTime);
            const slots = Utils.findSlotsForRange(startMin, endMin);
            const bunk = override.bunk;
            const divName = Object.keys(divisions)
                .find(d => divisions[d].bunks.includes(bunk));

            if (!divName) return;

            if (slots.length > 0) {
                fillBlock(
                    { divName, bunk, startTime: startMin, endTime: endMin, slots },
                    { field: fName, sport: null, _fixed: true, _activity: fName },
                    fieldUsageBySlot,
                    yesterdayHistory,
                    false,
                    activityProperties
                );
            }
        });

        // 5 — Collect schedulable blocks
        const schedulableSlotBlocks = [];

        // Valid types that should trigger the Generator (Optimizer)
        const GENERATOR_TYPES = ["slot", "activity", "sports", "special", "league", "specialty_league"];

        manualSkeleton.forEach(item => {
            const divName = item.division;
            const bunkList = divisions[divName]?.bunks || [];
            if (bunkList.length === 0) return;

            const sMin = Utils.parseTimeToMinutes(item.startTime);
            const eMin = Utils.parseTimeToMinutes(item.endTime);
            const slots = Utils.findSlotsForRange(sMin, eMin);
            if (slots.length === 0) return;

            const normGA = normalizeGA(item.event);
            const normLg = normalizeLeague(item.event);
            const normSL = normalizeSpecialtyLeague(item.event);
            const finalName = normGA || normLg || normSL || item.event;

            const isGenerated =
                /general|sport|special|league/i.test(finalName);

            const trans = Utils.getTransitionRules(finalName, activityProperties);
            const hasBuffer = (trans.preMin + trans.postMin) > 0;

            const isSchedulable = GENERATOR_TYPES.includes(item.type);

            // ----- Manual pinned fields (if NOT schedulable type)
            if ((item.type === "pinned" || !isGenerated) && !isSchedulable && item.type !== "smart" && !hasBuffer) {
                if (disabledFields.includes(finalName) || disabledSpecials.includes(finalName)) return;

                bunkList.forEach(b => {
                    fillBlock(
                        { divName, bunk: b, startTime: sMin, endTime: eMin, slots },
                        { field: finalName, sport: null, _fixed: true, _activity: finalName },
                        fieldUsageBySlot,
                        yesterdayHistory,
                        false,
                        activityProperties
                    );
                });
                return;
            }

            // ----- Split blocks (Swim / GA)
            if (item.type === "split") {
                const midIdx = Math.ceil(bunkList.length / 2);
                const top = bunkList.slice(0, midIdx);
                const bottom = bunkList.slice(midIdx);

                const halfSlots = Math.ceil(slots.length / 2);
                const slotsA = slots.slice(0, halfSlots);
                const slotsB = slots.slice(halfSlots);

                const swimLabel = "Swim";
                const gaLabel = normalizeGA(item.subEvents?.[1]?.event) || "General Activity Slot";

                function pushGen(list, slots, ev) {
                    const st = Utils.getBlockTimeRange({ slots }).blockStartMin;
                    const en = Utils.getBlockTimeRange({ slots }).blockEndMin;
                    list.forEach(b => {
                        schedulableSlotBlocks.push({
                            divName,
                            bunk: b,
                            event: ev,
                            startTime: st,
                            endTime: en,
                            slots
                        });
                    });
                }

                function pin(list, slots, ev) {
                    const st = Utils.getBlockTimeRange({ slots }).blockStartMin;
                    const en = Utils.getBlockTimeRange({ slots }).blockEndMin;
                    list.forEach(b => {
                        fillBlock(
                            { divName, bunk: b, startTime: st, endTime: en, slots },
                            { field: ev, sport: null, _fixed: true, _activity: ev },
                            fieldUsageBySlot,
                            yesterdayHistory,
                            false,
                            activityProperties
                        );
                    });
                }

                pin(top, slotsA, swimLabel);
                pushGen(bottom, slotsA, gaLabel);

                pushGen(top, slotsB, gaLabel);
                pin(bottom, slotsB, swimLabel);
                return;
            }

            // ----- Normal block (generated or buffered)
            if ((isSchedulable && isGenerated) || hasBuffer) {
                bunkList.forEach(b => {
                    schedulableSlotBlocks.push({
                        divName,
                        bunk: b,
                        event: finalName,
                        startTime: sMin,
                        endTime: eMin,
                        slots
                    });
                });
            }
        });

        // 6 — Smart tiles
        const smartJobs =
            window.SmartLogicAdapter?.preprocessSmartTiles?.(
                manualSkeleton,
                externalOverrides,
                masterSpecials
            ) || [];

        smartJobs.forEach(job => {
            const divName = job.division;
            const bunkList = divisions[divName]?.bunks || [];
            if (bunkList.length === 0) return;

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
                if (L.includes("sport")) {
                    pushGen(b, "Sports Slot", job.blockA.startMin, job.blockA.endMin);
                } else if (L.includes("special")) {
                    pushGen(b, "Special Activity Slot", job.blockA.startMin, job.blockA.endMin);
                } else if (L.includes("general")) {
                    pushGen(b, "General Activity Slot", job.blockA.startMin, job.blockA.endMin);
                } else {
                    fillBlock(
                        { divName, bunk: b, startTime: job.blockA.startMin, endTime: job.blockA.endMin, slots: sA },
                        { field: act, sport: null, _fixed: true, _activity: act },
                        fieldUsageBySlot,
                        yesterdayHistory,
                        false,
                        activityProperties
                    );
                }
            });

            if (job.blockB) {
                const sB = Utils.findSlotsForRange(job.blockB.startMin, job.blockB.endMin);
                Object.entries(block2Assignments || {}).forEach(([b, act]) => {
                    const L = act.toLowerCase();
                    if (L.includes("sport")) {
                        pushGen(b, "Sports Slot", job.blockB.startMin, job.blockB.endMin);
                    } else if (L.includes("special")) {
                        pushGen(b, "Special Activity Slot", job.blockB.startMin, job.blockB.endMin);
                    } else if (L.includes("general")) {
                        pushGen(b, "General Activity Slot", job.blockB.startMin, job.blockB.endMin);
                    } else {
                        fillBlock(
                            { divName, bunk: b, startTime: job.blockB.startMin, endTime: job.blockB.endMin, slots: sB },
                            { field: act, sport: null, _fixed: true, _activity: act },
                            fieldUsageBySlot,
                            yesterdayHistory,
                            false,
                            activityProperties
                        );
                    }
                });
            }
        });

        // 7 — Leagues
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
            fillBlock
        };

        window.SchedulerCoreLeagues?.processSpecialtyLeagues?.(leagueContext);
        window.SchedulerCoreLeagues?.processRegularLeagues?.(leagueContext);

        // 8 — Fill remaining (non-leagues)
        const remaining = schedulableSlotBlocks.filter(
            b => !/league/i.test(b.event) && !b.processed
        );

        remaining.sort((A, B) => {
            if (A.startTime !== B.startTime) return A.startTime - B.startTime;
            if (A.fromSmartTile && !B.fromSmartTile) return -1;
            if (!A.fromSmartTile && B.fromSmartTile) return 1;

            const sA = bunkMetaData[A.bunk]?.size || 0;
            const sB = bunkMetaData[B.bunk]?.size || 0;
            if (sA !== sB) return sB - sA;

            const cA = historicalCounts[A.bunk]?.['_totalSpecials'] || 0;
            const cB = historicalCounts[B.bunk]?.['_totalSpecials'] || 0;
            return cA - cB;
        });

        window.__transitionUsage = {};

        for (const block of remaining) {
            const slots = block.slots;
            if (!slots || slots.length === 0) continue;

            // *** FIXED LOGIC ***
            // We check the first slot of the block.
            // If it is occupied (truthy) AND that occupation is NOT a transition, we skip.
            // This means:
            // - If it is undefined/null (Empty) -> Proceed (Don't skip)
            // - If it is "Transition" -> Proceed (Don't skip, we can merge)
            // - If it is "Sports" -> Skip (Already filled)
            
            const existingSlot = window.scheduleAssignments[block.bunk][slots[0]];

            if (existingSlot && existingSlot._activity !== TRANSITION_TYPE) {
                continue;
            }

            let pick = null;

            if (/special/i.test(block.event)) {
                pick = window.findBestSpecial?.(
                    block,
                    allActivities,
                    fieldUsageBySlot,
                    yesterdayHistory,
                    activityProperties,
                    rotationHistory,
                    historicalCounts
                );
            } else if (/sport/i.test(block.event)) {
                pick = window.findBestSportActivity?.(
                    block,
                    allActivities,
                    fieldUsageBySlot,
                    yesterdayHistory,
                    activityProperties,
                    rotationHistory,
                    historicalCounts
                );
            }

            if (!pick) {
                pick = window.findBestGeneralActivity?.(
                    block,
                    allActivities,
                    h2hActivities,
                    fieldUsageBySlot,
                    yesterdayHistory,
                    activityProperties,
                    rotationHistory,
                    historicalCounts
                );
            }

            // ---- Corrected canBlockFit call ----
            let fits = pick && Utils.canBlockFit(
                block,
                fieldLabel(pick.field),
                activityProperties,
                fieldUsageBySlot,
                pick._activity,
                false
            );

            const trans = Utils.getTransitionRules(fieldLabel(pick?.field), activityProperties);
            if (pick && (trans.preMin > 0 || trans.postMin > 0)) {
                const zone = trans.zone;
                const maxConcurrent = masterZones[zone]?.maxConcurrent || 99;

                const { blockStartMin } = Utils.getBlockTimeRange(block);

                const merged =
                    blockStartMin > 0 &&
                    window.scheduleAssignments[block.bunk][slots[0] - 1]?._zone === zone;

                if (!merged && (window.__transitionUsage[zone] || 0) + 1 > maxConcurrent) {
                    fits = false;
                }
            }

            if (!fits) pick = null;

            if (fits && pick) {
                const trans = Utils.getTransitionRules(fieldLabel(pick.field), activityProperties);

                if (trans.preMin > 0 || trans.postMin > 0) {
                    const { blockStartMin } = Utils.getBlockTimeRange(block);

                    const merged =
                        blockStartMin > 0 &&
                        window.scheduleAssignments[block.bunk][slots[0] - 1]?._zone === trans.zone;

                    if (!merged) {
                        window.__transitionUsage[trans.zone] = (window.__transitionUsage[trans.zone] || 0) + 1;
                    }
                }

                fillBlock(block, pick, fieldUsageBySlot, yesterdayHistory, false, activityProperties);

                if (pick._activity) {
                    historicalCounts[block.bunk] ??= {};
                    historicalCounts[block.bunk][pick._activity] =
                        (historicalCounts[block.bunk][pick._activity] || 0) + 1;

                    const isSpecial = masterSpecials.some(s => s.name === pick._activity);
                    if (isSpecial) {
                        historicalCounts[block.bunk]['_totalSpecials'] =
                            (historicalCounts[block.bunk]['_totalSpecials'] || 0) + 1;
                    }
                }

            } else {
                window.scheduleAssignments[block.bunk][slots[0]] = null;

                fillBlock(
                    block,
                    { field: "Free", sport: null, _activity: "Free" },
                    fieldUsageBySlot,
                    yesterdayHistory,
                    false,
                    activityProperties
                );
            }
        }

        // 9 — Rotation history update
        try {
            const newHistory = { ...rotationHistory };
            const timestamp = Date.now();

            Object.keys(divisions).forEach(divName => {
                divisions[divName].bunks.forEach(b => {
                    let lastActivity = null;

                    for (const entry of window.scheduleAssignments[b] || []) {
                        if (entry?._activity && entry._activity !== TRANSITION_TYPE && entry._activity !== lastActivity) {
                            lastActivity = entry._activity;

                            newHistory.bunks ??= {};
                            newHistory.bunks[b] ??= {};
                            newHistory.bunks[b][entry._activity] = timestamp;

                        } else if (entry && !entry.continuation && entry._activity !== TRANSITION_TYPE) {
                            lastActivity = null;
                        }
                    }
                });
            });

            window.saveRotationHistory?.(newHistory);
        } catch (e) {
            console.error("Rotation history update failed:", e);
        }

        // 10 — Save + update UI
        window.saveCurrentDailyData?.("unifiedTimes", window.unifiedTimes);
        window.updateTable?.();
        window.saveSchedule?.();

        return true;
    };

    // -------------------------------------------------------------------------
    // registerSingleSlotUsage (FIXED)
    // -------------------------------------------------------------------------
    function registerSingleSlotUsage(slotIndex, fieldName, divName, bunkName, activityName, fieldUsageBySlot, activityProperties) {
        // FIXED: Check against activityProperties instead of missing global
        if (!fieldName || !activityProperties[fieldName]) return;

        fieldUsageBySlot[slotIndex] ??= {};
        const usage = fieldUsageBySlot[slotIndex][fieldName] ?? {
            count: 0,
            divisions: [],
            bunks: {}
        };

        const props = activityProperties[fieldName];
        const cap =
            props?.sharableWith?.capacity ??
            (props?.sharable ? 2 : 1);

        if (usage.count < cap) {
            usage.count++;
            usage.bunks[bunkName] = activityName || fieldName;
            if (divName && !usage.divisions.includes(divName)) usage.divisions.push(divName);
            fieldUsageBySlot[slotIndex][fieldName] = usage;
        }
    }

    window.registerSingleSlotUsage = registerSingleSlotUsage;

})();
