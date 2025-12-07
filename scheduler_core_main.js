// ============================================================================
// scheduler_core_main.js — FINAL GCM VERSION
// PART 3 OF 3 — THE ORCHESTRATOR
//
// Fully compatible with:
//   • Loader v3
//   • Utils v3 (new canBlockFit, transitions, slot mapping)
//   • Fillers v3 (Fairness-based Sports Slot, Hybrid model, Specials-as-fields)
//   • Leagues engine (regular + specialty)
//   • Smart Tiles (ON)
//   • Total Solver Engine (backtracking)
// ============================================================================

(function () {
    'use strict';

    const TRANSITION_TYPE = window.TRANSITION_TYPE || "Transition/Buffer";
    const Utils = () => window.SchedulerCoreUtils;

    // -------------------------------------------------------------------------
    // **Field Label Safe Wrapper**
    // -------------------------------------------------------------------------
    function fieldLabel(f) {
        return window.SchedulerCoreUtils.fieldLabel(f);
    }

    // -------------------------------------------------------------------------
    // **Normalize Event Names**
    // -------------------------------------------------------------------------
    function normalizeGA(name) {
        if (!name) return null;
        const s = name.toLowerCase().replace(/\s+/g, '');
        return /(generalactivity|activityslot|genactivity|ga)/.test(s)
            ? "General Activity Slot"
            : null;
    }

    function normalizeLeague(name) {
        if (!name) return null;
        const s = name.toLowerCase().replace(/\s+/g, '');
        return /(leaguegame|leaguegameslot|lgame|lg)/.test(s)
            ? "League Game"
            : null;
    }

    function normalizeSpecialtyLeague(name) {
        if (!name) return null;
        const s = name.toLowerCase().replace(/\s+/g, '');
        return /(specialtyleague|specialityleague|specleague|specialleague)/.test(s)
            ? "Specialty League"
            : null;
    }

    // -------------------------------------------------------------------------
    // **fillBlock — SAFEST VERSION**
    // Handles transitions, merging, and writing usage into fieldUsageBySlot
    // -------------------------------------------------------------------------
    function fillBlock(block, pick, fieldUsageBySlot, yesterdayHistory, isLeagueFill, activityProperties) {
        const U = window.SchedulerCoreUtils;

        const fName = fieldLabel(pick.field);
        const trans = U.getTransitionRules(fName, activityProperties);
        const {
            blockStartMin,
            blockEndMin,
            effectiveStart,
            effectiveEnd
        } = U.getEffectiveTimeRange(block, trans);

        const bunk = block.bunk;
        const zone = trans.zone;

        let writePre = trans.preMin > 0;
        let writePost = trans.postMin > 0;

        const firstSlotIndex = block.slots[0];
        const prevEntry = window.scheduleAssignments[bunk]?.[firstSlotIndex - 1];

        // Transition Merging (Pre)
        if (writePre && firstSlotIndex > 0) {
            if (
                prevEntry?._zone === zone &&
                prevEntry?._isTransition &&
                prevEntry?._transitionType === 'Post'
            ) {
                writePre = false;

                const wipeSlots = U.findSlotsForRange(blockStartMin - trans.postMin, blockStartMin);
                wipeSlots.forEach(idx => {
                    if (window.scheduleAssignments[bunk][idx]?._transitionType === "Post") {
                        window.scheduleAssignments[bunk][idx] = null;
                    }
                });
            }
        }

        // ----- PRE BUFFER -----
        if (writePre) {
            const preSlots = U.findSlotsForRange(blockStartMin, effectiveStart);
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
        let mainSlots = U.findSlotsForRange(effectiveStart, effectiveEnd);

        if (mainSlots.length === 0 && block.slots?.length > 0) {
            if (trans.preMin === 0 && trans.postMin === 0) {
                mainSlots = block.slots;
            }
        }

        if (mainSlots.length === 0) {
            console.error(`fillBlock: NO MAIN SLOTS for ${bunk}, f=${fName}`);
        }

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

                registerSingleSlotUsage(
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
            const postSlots = U.findSlotsForRange(effectiveEnd, blockEndMin);
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
    // MAIN ENTRYPOINT: runSkeletonOptimizer
    // -------------------------------------------------------------------------
    window.runSkeletonOptimizer = function (manualSkeleton, externalOverrides) {
        console.log(">>> OPTIMIZER START");

        const U = Utils();

        // 1 — LOAD DATA
        const config = U.loadAndFilterData();
        window.activityProperties = config.activityProperties;
        window.fieldUsageBySlot = {};
        let fieldUsageBySlot = window.fieldUsageBySlot;

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
            dailyFieldAvailability
        } = config;

        window.SchedulerCoreUtils._bunkMetaData = bunkMetaData;
        window.SchedulerCoreUtils._sportMetaData = config.sportMetaData || {};

        // 2 — BUILD TIME GRID
        if (!manualSkeleton?.length) {
            console.error("Empty skeleton, aborting.");
            return false;
        }

        const points = new Set();
        manualSkeleton.forEach(i => {
            const s = U.parseTimeToMinutes(i.startTime);
            const e = U.parseTimeToMinutes(i.endTime);
            if (s != null) points.add(s);
            if (e != null) points.add(e);
        });

        const sorted = [...points].sort((a, b) => a - b);
        window.unifiedTimes = [];

        for (let i = 0; i < sorted.length - 1; i++) {
            const s = sorted[i], e = sorted[i + 1];
            if (e - s >= 5) {
                window.unifiedTimes.push({
                    start: U.minutesToDate(s),
                    end: U.minutesToDate(e),
                    label: `${U.fmtTime(U.minutesToDate(s))} - ${U.fmtTime(U.minutesToDate(e))}`
                });
            }
        }

        if (!window.unifiedTimes.length) {
            console.error("No usable time slots");
            return false;
        }

        // 3 — INIT SCHEDULE ARRAYS
        window.scheduleAssignments = {};
        Object.keys(divisions).forEach(div => {
            divisions[div]?.bunks?.forEach(bunk => {
                window.scheduleAssignments[bunk] = new Array(window.unifiedTimes.length);
            });
        });

        // 4 — APPLY PINNED OVERRIDES
        const bunkOverrides = window.loadCurrentDailyData?.().bunkActivityOverrides || [];
        bunkOverrides.forEach(o => {
            const fName = o.activity;
            const sMin = U.parseTimeToMinutes(o.startTime);
            const eMin = U.parseTimeToMinutes(o.endTime);
            const slots = U.findSlotsForRange(sMin, eMin);

            const divName = Object.keys(divisions)
                .find(d => divisions[d]?.bunks?.includes(o.bunk));
            if (!divName) return;

            fillBlock(
                { divName, bunk: o.bunk, startTime: sMin, endTime: eMin, slots },
                { field: fName, sport: null, _fixed: true, _activity: fName },
                fieldUsageBySlot,
                yesterdayHistory,
                false,
                activityProperties
            );
        });

        // 5 — BUILD SCHEDULABLE BLOCKS
        const schedulableBlocks = [];
        const GEN_TYPES = ["slot", "activity", "sports", "special", "league", "specialty_league"];

        manualSkeleton.forEach(item => {
            const divName = item.division;
            const bunkList = divisions[divName]?.bunks || [];
            if (!bunkList.length) return;

            const sMin = U.parseTimeToMinutes(item.startTime);
            const eMin = U.parseTimeToMinutes(item.endTime);
            const slots = U.findSlotsForRange(sMin, eMin);
            if (!slots.length) return;

            const normGA = normalizeGA(item.event);
            const normLg = normalizeLeague(item.event);
            const normSL = normalizeSpecialtyLeague(item.event);
            const finalName = normGA || normLg || normSL || item.event;

            const isGenerated = /general|sport|special|league/i.test(finalName);
            const trans = U.getTransitionRules(finalName, activityProperties);
            const hasBuffer = (trans.preMin + trans.postMin) > 0;
            const schedulable = GEN_TYPES.includes(item.type);

            // Pinned & static events
            if ((item.type === "pinned" || !isGenerated) && !schedulable && item.type !== "smart" && !hasBuffer) {
                if (disabledFields.includes(finalName) || disabledSpecials.includes(finalName)) return;
                bunkList.forEach(b => {
                    fillBlock(
                        { divName, bunk: b, startTime: sMin, endTime: eMin, slots },
                        { field: finalName, sport: null, _fixed: true, _activity: finalName },
                        fieldUsageBySlot, yesterdayHistory, false, activityProperties
                    );
                });
                return;
            }

            // Split blocks (swim/GA)
            if (item.type === "split") {
                const mid = Math.ceil(bunkList.length / 2);
                const top = bunkList.slice(0, mid);
                const bottom = bunkList.slice(mid);

                const half = Math.ceil(slots.length / 2);
                const sA = slots.slice(0, half);
                const sB = slots.slice(half);

                const swim = "Swim";
                const ga = normalizeGA(item.subEvents?.[1]?.event) || "General Activity Slot";

                function addGen(list, s, ev) {
                    const br = U.getBlockTimeRange({ slots: s });
                    schedulableBlocks.push({
                        divName, bunk: null, event: ev,
                        startTime: br.blockStartMin, endTime: br.blockEndMin, slots: s
                    });
                    list.forEach(bunk =>
                        schedulableBlocks.push({
                            divName, bunk, event: ev,
                            startTime: br.blockStartMin, endTime: br.blockEndMin, slots: s
                        })
                    );
                }

                function pin(list, s, ev) {
                    const br = U.getBlockTimeRange({ slots: s });
                    list.forEach(bunk =>
                        fillBlock(
                            { divName, bunk, startTime: br.blockStartMin, endTime: br.blockEndMin, slots: s },
                            { field: ev, sport: null, _fixed: true, _activity: ev },
                            fieldUsageBySlot,
                            yesterdayHistory,
                            false,
                            activityProperties
                        )
                    );
                }

                pin(top, sA, swim);
                addGen(bottom, sA, ga);

                addGen(top, sB, ga);
                pin(bottom, sB, swim);
                return;
            }

            // Normal schedulable block
            if (schedulable || hasBuffer) {
                bunkList.forEach(bunk => {
                    schedulableBlocks.push({
                        divName,
                        bunk,
                        event: finalName,
                        startTime: sMin,
                        endTime: eMin,
                        slots
                    });
                });
            }
        });

        console.log(`Schedulable Blocks = ${schedulableBlocks.length}`);

        // 6 — SMART TILES
        const smartJobs = window.SmartLogicAdapter?.preprocessSmartTiles?.(
            manualSkeleton,
            externalOverrides,
            masterSpecials
        ) || [];

        smartJobs.forEach(job => {
            const divName = job.division;
            const bunkList = divisions[divName]?.bunks || [];
            if (!bunkList.length) return;

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
                const slots = U.findSlotsForRange(st, en);
                schedulableBlocks.push({
                    divName,
                    bunk,
                    event: ev,
                    startTime: st,
                    endTime: en,
                    slots,
                    fromSmartTile: true
                });
            }

            // Block A
            const sA = U.findSlotsForRange(job.blockA.startMin, job.blockA.endMin);
            Object.entries(block1Assignments || {}).forEach(([bunk, ev]) => {
                const L = ev.toLowerCase();
                if (L.includes("sport")) pushGen(bunk, "Sports Slot", job.blockA.startMin, job.blockA.endMin);
                else if (L.includes("special")) pushGen(bunk, "Special Activity Slot", job.blockA.startMin, job.blockA.endMin);
                else if (L.includes("general")) pushGen(bunk, "General Activity Slot", job.blockA.startMin, job.blockA.endMin);
                else {
                    fillBlock(
                        { divName, bunk, startTime: job.blockA.startMin, endTime: job.blockA.endMin, slots: sA },
                        { field: ev, sport: null, _fixed: true, _activity: ev },
                        fieldUsageBySlot,
                        yesterdayHistory,
                        false,
                        activityProperties
                    );
                }
            });

            // Block B
            if (job.blockB) {
                const sB = U.findSlotsForRange(job.blockB.startMin, job.blockB.endMin);
                Object.entries(block2Assignments || {}).forEach(([bunk, ev]) => {
                    const L = ev.toLowerCase();
                    if (L.includes("sport")) pushGen(bunk, "Sports Slot", job.blockB.startMin, job.blockB.endMin);
                    else if (L.includes("special")) pushGen(bunk, "Special Activity Slot", job.blockB.startMin, job.blockB.endMin);
                    else if (L.includes("general")) pushGen(bunk, "General Activity Slot", job.blockB.startMin, job.blockB.endMin);
                    else {
                        fillBlock(
                            { divName, bunk, startTime: job.blockB.startMin, endTime: job.blockB.endMin, slots: sB },
                            { field: ev, sport: null, _fixed: true, _activity: ev },
                            fieldUsageBySlot,
                            yesterdayHistory,
                            false,
                            activityProperties
                        );
                    }
                });
            }
        });

        // 7 — LEAGUES
        const leagueCtx = {
            schedulableSlotBlocks: schedulableBlocks,
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

        window.SchedulerCoreLeagues?.processSpecialtyLeagues?.(leagueCtx);
        window.SchedulerCoreLeagues?.processRegularLeagues?.(leagueCtx);

        // 8 — FILL NON-LEAGUE WITH TOTAL SOLVER
        const remaining = schedulableBlocks
            .filter(b => !/league/i.test(b.event) && !b.processed)
            .filter(b => {
                const s0 = window.scheduleAssignments[b.bunk]?.[b.slots[0]];
                return !s0 || s0._isTransition;
            })
            .map(b => ({ ...b, _isLeague: false }));

        console.log(`>>> TOTAL SOLVER START: ${remaining.length} blocks`);

        window.__transitionUsage = {};

        if (window.totalSolverEngine && remaining.length > 0) {
            window.totalSolverEngine.solveSchedule(remaining, config);
        }

        // 9 — UPDATE ROTATION HISTORY
        try {
            const newHist = { ...rotationHistory };
            const stamp = Date.now();

            Object.keys(divisions).forEach(div => {
                divisions[div].bunks.forEach(bunk => {
                    let last = null;
                    for (const entry of window.scheduleAssignments[bunk] || []) {
                        if (entry?._activity && entry._activity !== TRANSITION_TYPE && entry._activity !== last) {
                            last = entry._activity;
                            newHist.bunks ??= {};
                            newHist.bunks[bunk] ??= {};
                            newHist.bunks[bunk][entry._activity] = stamp;
                        } else if (entry && !entry.continuation && entry._activity !== TRANSITION_TYPE) {
                            last = null;
                        }
                    }
                });
            });

            window.saveRotationHistory?.(newHist);
        } catch (err) {
            console.error("Rotation history update failed:", err);
        }

        // 10 — SAVE + REFRESH UI
        window.saveCurrentDailyData?.("unifiedTimes", window.unifiedTimes);
        window.updateTable?.();
        window.saveSchedule?.();

        console.log(">>> OPTIMIZER COMPLETE");
        return true;
    };

    // -------------------------------------------------------------------------
    // registerSingleSlotUsage — Enforce sharable caps and usage logs
    // -------------------------------------------------------------------------
    function registerSingleSlotUsage(slotIndex, fieldName, divName, bunkName, activityName, fieldUsageBySlot, activityProperties) {
        if (!fieldName || !activityProperties[fieldName]) return;

        fieldUsageBySlot[slotIndex] ??= {};
        const usage = fieldUsageBySlot[slotIndex][fieldName] ?? { count: 0, divisions: [], bunks: {} };

        const props = activityProperties[fieldName];
        const cap = props?.sharableWith?.capacity ?? (props?.sharable ? 2 : 1);

        if (usage.count < cap) {
            usage.count++;
            usage.bunks[bunkName] = activityName || fieldName;
            if (divName && !usage.divisions.includes(divName)) usage.divisions.push(divName);
            fieldUsageBySlot[slotIndex][fieldName] = usage;
        }
    }

    window.registerSingleSlotUsage = registerSingleSlotUsage;

})();
