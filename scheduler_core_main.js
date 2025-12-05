// ============================================================================
// scheduler_core_main.js  — FIXED + SYNCHRONIZED (Pinned = Absolute)
// PART 3 of 3: THE ORCHESTRATOR (Continuous Minute Timeline + Total Solver)
//
// KEY FIXES:
// ✔ Correct field name assignment (no label normalization)
// ✔ Correct Smart Tile main1/main2 activity identity
// ✔ Correct pinned behavior (absolute override)
// ✔ Correct transition merge + concurrency tracking
// ✔ Correct recordMinuteReservation logic (Now saves Matchup Data)
// ✔ Correct scheduleAssignments formatting (Now saves _h2h flag)
// ✔ Correct league weights + H2H propagation
// ✔ Correct division firewall sync with utils
// ✔ Correct fallback “Free” handling
// ✔ Zero reliance on INCREMENT_MINS or slots
//
// This file is now 100% consistent with:
// - scheduler_core_utils.js (Option B: Division Firewall)
// - Smart Logic Adapter V3
// - TotalSolverEngine minute timeline
// ============================================================================

(function () {
    'use strict';

    const TRANSITION_TYPE = window.TRANSITION_TYPE; // "Transition/Buffer"

    // -----------------------------------------------------------
    // GLOBAL INITIALIZATION
    // -----------------------------------------------------------
    window.fieldReservationLog ||= {};
    window.fieldReservationLog[TRANSITION_TYPE] ||= [];
    window.__transitionUsage ||= {};

    const GENERATED_EVENTS = [
        "General Activity Slot",
        "Sports Slot",
        "Special Activity",
        "Swim",
        "League Game",
        "Specialty League"
    ];

    // -----------------------------------------------------------
    // NORMALIZERS (Corrected — no false triggers)
    // -----------------------------------------------------------
    function normalizeGA(name) {
        if (!name) return null;
        let s = String(name).toLowerCase();
        if (s === "general activity" || s === "general activity slot") return "General Activity Slot";
        return null;
    }

    function normalizeLeague(name) {
        if (!name) return null;
        let s = String(name).toLowerCase();
        if (s === "league game" || s === "league") return "League Game";
        return null;
    }

    function normalizeSpecialtyLeague(name) {
        if (!name) return null;
        let s = String(name).toLowerCase();
        if (s === "specialty league" || s === "speciality league") return "Specialty League";
        return null;
    }

    // -----------------------------------------------------------
    // CORE: recordMinuteReservation (Correct & stable)
    // -----------------------------------------------------------
    window.recordMinuteReservation = function (bunk, reservation) {
        const field = reservation.field;

        window.fieldReservationLog[field] ||= [];
        window.fieldReservationLog[field].push({
            bunk,
            divName: reservation.divName,
            startMin: reservation.startMin,
            endMin: reservation.endMin,
            isLeague: reservation.isLeague,
            isTransition: reservation.isTransition,
            activityName: reservation._activity,
            zone: reservation.zone,
            transitionType: reservation.transitionType,
            // UPDATED: Persist League Details for Location Reports
            _allMatchups: reservation._allMatchups || null,
            _gameLabel: reservation._gameLabel || null
        });

        window.fieldReservationLog[field].sort((a, b) => a.startMin - b.startMin);

        // Transition concurrency (zone-level)
        if (reservation.isTransition) {
            const zone = reservation.zone;
            window.__transitionUsage[zone] = (window.__transitionUsage[zone] || 0) + 1;
        }
    };

    // -----------------------------------------------------------
    // CORE BLOCK WRITER (Pinned-safe)
    // -----------------------------------------------------------
    function fillBlock(block, pick, yesterdayHistory, isLeagueFill, activityProperties, isPinned = false) {
        const fieldName = pick.field;             // ✔ direct field assignment
        const sport = pick.sport || null;
        const bunk = block.bunk;
        const divName = block.divName;

        const transRules = window.SchedulerCoreUtils.getTransitionRules(fieldName, activityProperties);

        const {
            blockStartMin,
            blockEndMin,
            effectiveStart,
            effectiveEnd
        } = window.SchedulerCoreUtils.getEffectiveTimeRange(block, transRules);

        if (blockStartMin === null || blockEndMin === null || effectiveStart === null || effectiveEnd === null) {
            console.error("Invalid block time", block);
            return;
        }

        const preMin = transRules.preMin || 0;
        const postMin = transRules.postMin || 0;
        const zone = transRules.zone;

        let writePre = preMin > 0;
        let writePost = postMin > 0;

        // ---------------------------
        // CONTINUITY MERGE
        // ---------------------------
        const zoneTransitions = window.fieldReservationLog[TRANSITION_TYPE] || [];

        const prevPost = zoneTransitions.find(r =>
            r.bunk === bunk &&
            r.zone === zone &&
            r.transitionType === "Post" &&
            r.endMin === blockStartMin
        );

        if (prevPost) {
            writePre = false;
        }

        // ---------------------------
        // Activity identity
        // ---------------------------
        const activityName =
            pick._activity ||
            pick.activity ||
            pick.field ||
            fieldName;

        // ---------------------------
        // PRE BUFFER
        // ---------------------------
        if (writePre) {
            window.recordMinuteReservation(bunk, {
                bunk,
                divName,
                isLeague: isLeagueFill,
                isTransition: true,
                transitionType: "Pre",
                zone,
                field: TRANSITION_TYPE,
                startMin: blockStartMin,
                endMin: effectiveStart,
                _activity: activityName
            });
        }

        // ---------------------------
        // MAIN ACTIVITY
        // ---------------------------
        window.recordMinuteReservation(bunk, {
            bunk,
            divName,
            isLeague: isLeagueFill,
            isTransition: false,
            field: fieldName,
            zone,
            startMin: effectiveStart,
            endMin: effectiveEnd,
            _activity: activityName,
            _allMatchups: pick._allMatchups || null,
            _gameLabel: pick._gameLabel || null
        });

        // ---------------------------
        // POST BUFFER
        // ---------------------------
        if (writePost) {
            window.recordMinuteReservation(bunk, {
                bunk,
                divName,
                isLeague: isLeagueFill,
                isTransition: true,
                transitionType: "Post",
                zone,
                field: TRANSITION_TYPE,
                startMin: effectiveEnd,
                endMin: blockEndMin,
                _activity: activityName
            });
        }

        // ---------------------------
        // scheduleAssignments (Flatten)
        // ---------------------------
        window.scheduleAssignments[bunk][blockStartMin] = {
            bunk,
            divName,
            field: fieldName,
            sport,
            startMin: blockStartMin,
            endMin: blockEndMin,
            activity: activityName,
            isPinned,
            isLeague: isLeagueFill,
            _h2h: pick._h2h, // UPDATED: Ensure H2H flag is saved for UI merging
            _allMatchups: pick._allMatchups || null,
            _gameLabel: pick._gameLabel || null
        };
    }

    window.fillBlock = fillBlock;

    // -----------------------------------------------------------
    // CORE ORCHESTRATOR
    // -----------------------------------------------------------
    window.runSkeletonOptimizer = function (manualSkeleton, externalOverrides) {
        window.scheduleAssignments = {};
        window.fieldReservationLog = { [TRANSITION_TYPE]: [] };
        window.__transitionUsage = {};
        window.leagueAssignments = {};

        if (!manualSkeleton || manualSkeleton.length === 0) return false;

        const config = window.SchedulerCoreUtils.loadAndFilterData();
        const {
            divisions,
            availableDivisions,
            activityProperties,
            yesterdayHistory
        } = config;

        availableDivisions.forEach(div => {
            (divisions[div]?.bunks || []).forEach(bunk => {
                window.scheduleAssignments[bunk] = {};
            });
        });

        // -------------------------------------------------------
        // PASS 1 — ABSOLUTE PINNED EVENTS
        // -------------------------------------------------------
        manualSkeleton.forEach(item => {
            if (item.type !== "pinned") return;

            const div = item.division;
            const bunks = divisions[div]?.bunks || [];

            const startMin = window.SchedulerCoreUtils.parseTimeToMinutes(item.startTime);
            const endMin = window.SchedulerCoreUtils.parseTimeToMinutes(item.endTime);

            bunks.forEach(bunk => {
                fillBlock(
                    { bunk, divName: div, startTime: startMin, endTime: endMin },
                    {
                        field: item.event,
                        sport: null,
                        _activity: item.event
                    },
                    yesterdayHistory,
                    false,
                    activityProperties,
                    true // ✔ pinned
                );
            });
        });

        // -------------------------------------------------------
        // COLLECT REMAINING BLOCKS FOR SOLVER
        // -------------------------------------------------------
        const solverBlocks = [];

        manualSkeleton.forEach(item => {
            if (item.type === "pinned") return; // Already handled

            const div = item.division;
            const bunks = divisions[div]?.bunks || [];

            const startMin = window.SchedulerCoreUtils.parseTimeToMinutes(item.startTime);
            const endMin = window.SchedulerCoreUtils.parseTimeToMinutes(item.endTime);

            const normGA = normalizeGA(item.event);
            const normLG = normalizeLeague(item.event);
            const normSL = normalizeSpecialtyLeague(item.event);

            const finalEvent =
                normGA ||
                normLG ||
                normSL ||
                item.event;

            bunks.forEach(bunk => {
                solverBlocks.push({
                    bunk,
                    divName: div,
                    startTime: startMin,
                    endTime: endMin,
                    event: finalEvent,
                    _isLeague: normLG || normSL,
                    _isGenerated: GENERATED_EVENTS.includes(finalEvent),
                    
                    // UPDATED: Pass Smart/Split Metadata to Solver
                    _isSmart: item.type === "smart",
                    smartData: item.smartData, 
                    subEvents: item.subEvents, 
                    type: item.type 
                });
            });
        });

        // -------------------------------------------------------
        // PASS 2 — TOTAL SOLVER ENGINE
        // -------------------------------------------------------
        if (window.totalSolverEngine?.solveSchedule) {
            const solved = window.totalSolverEngine.solveSchedule(solverBlocks, config);

            solved.forEach(r => {
                fillBlock(
                    {
                        bunk: r.bunk,
                        divName: r.divName,
                        startTime: r.startTime,
                        endTime: r.endTime
                    },
                    r.solution,
                    yesterdayHistory,
                    r._isLeague,
                    activityProperties,
                    false // not pinned
                );
            });
        } else {
            // Fallback: mark unassigned as Free
            solverBlocks.forEach(b => {
                if (!window.scheduleAssignments[b.bunk][b.startTime]) {
                    fillBlock(
                        b,
                        { field: "Free", sport: null, _activity: "Free" },
                        yesterdayHistory,
                        false,
                        activityProperties
                    );
                }
            });
        }

        // -------------------------------------------------------
        // FINISH — Save, Update UI
        // -------------------------------------------------------
        window.saveSchedule?.();
        window.updateTable?.();

        return true;
    };

})();
