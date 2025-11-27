/* ============================================================================
   scheduler_core_engine.js
   COMPLETE REBUILD — 10-MODULE CORE ORCHESTRATOR
   ----------------------------------------------------------------------------
   This file coordinates all core modules:

     utils               → NS.utils
     timegrid            → NS.timegrid
     field_usage         → NS.field
     fairness            → NS.fairness
     smarttiles          → NS.smarttiles
     slots               → NS.slots
     leagues             → NS.leagues
     overrides           → NS.overrides
     history             → NS.history

   Produces:
     - unifiedTimes
     - scheduleAssignments (per bunk)
     - rotationHistory updates
     - validated + optimized schedule output

   Public API:
       SchedulerCore.getFullContext()
       SchedulerCore.engine.run(blocks, ctx)

   And also exposed globally as:
       window.getFullContext()
       window.SchedulerCore
============================================================================ */

(function (global) {
"use strict";

const NS = global.SchedulerCore = global.SchedulerCore || {};

/* ============================================================================
   1) strong reference to all internal subsystems
============================================================================ */
const U  = NS.utils;
const TG = NS.timegrid;
const F  = NS.field;
const FR = NS.fairness;
const ST = NS.smarttiles;
const SL = NS.slots;
const LG = NS.leagues;
const OV = NS.overrides;
const HI = NS.history;

/* ============================================================================
   GLOBAL SCHEDULE STORAGE
============================================================================ */
if (!global.scheduleAssignments) {
    global.scheduleAssignments = {};
}

/* ============================================================================
   2) Build full context from current app state
============================================================================ */
function getFullContext() {

    const divisions     = global.divisions || {};
    const activityProps = global.activityProperties || {};
    const allActivities = global.allActivities || {};
    const fieldsBySport = global.fieldsBySport || {};

    // History (rotation, fairness, counts)
    const rotationHistory   = global.rotationHistory || {};
    const yesterdayHistory  = global.yesterdayHistory || {};
    const historicalCounts  = global.historicalCounts || {};

    // disabled leagues
    const disabledLeagues         = global.disabledLeagues || [];
    const disabledSpecialtyLeagues = global.disabledSpecialtyLeagues || [];

    // Daily adjustments (fields disabled / special disabled)
    const dailyDA = global.currentDailyOverrides || {};
    const dailyFieldAvailability    = dailyDA.dailyFieldAvailability || {};
    const dailyDisabledSportsByField = dailyDA.dailyDisabledSportsByField || {};
    const disabledFields            = dailyDA.disabledFields || [];
    const disabledSpecials          = dailyDA.disabledSpecials || [];

    /* -------------------------------------------------------
       TIMEGRID — produces unifiedTimes + slot mapping
    ------------------------------------------------------- */
    const unifiedTimes = TG.buildUnifiedTimes(divisions);

    /* -------------------------------------------------------
       FIELD-USAGE — initial empty structure
    ------------------------------------------------------- */
    const fieldUsage = F.createFieldUsage(unifiedTimes);

    /* -------------------------------------------------------
       FAIRNESS CONTEXT
    ------------------------------------------------------- */
    FR.init(divisions, rotationHistory, historicalCounts);

    return {
        /* structure */
        divisions,
        activityProps,
        allActivities,
        fieldsBySport,

        /* timegrid */
        unifiedTimes,

        /* field usage */
        fieldUsage,

        /* fairness systems */
        rotationHistory,
        yesterdayHistory,
        historicalCounts,

        /* daily overrides */
        dailyFieldAvailability,
        disabledFields,
        disabledSpecials,
        dailyDisabledSportsByField,

        /* leagues */
        disabledLeagues,
        disabledSpecialtyLeagues,

        /* finders used by SmartTiles + Slots */
        findBestSpecial  : SL.findBestSpecial,
        findBestSport    : SL.findBestSport,
        findBestGeneral  : SL.findBestGeneral
    };
}

/* ============================================================================
   3) Reset assignment table based on bunk lists
============================================================================ */
function resetScheduleAssignments(divisions, unifiedTimes) {
    global.scheduleAssignments = global.scheduleAssignments || {};

    const slots = unifiedTimes.length;

    Object.values(divisions).forEach(div => {
        (div.bunks || []).forEach(b => {
            if (!global.scheduleAssignments[b]) {
                global.scheduleAssignments[b] = new Array(slots);
            }
        });
    });
}

/* ============================================================================
   4) ENGINE RUN — MAIN ENTRY
============================================================================ */
async function run(blocks, ctx) {

    if (!blocks || blocks.length === 0) {
        console.warn("ENGINE: No master skeleton blocks provided.");
        return {
            schedule: global.scheduleAssignments,
            rotationHistory: ctx.rotationHistory
        };
    }

    /* --------------------------------------------
       1. fresh scheduleAssignments
    -------------------------------------------- */
    resetScheduleAssignments(ctx.divisions, ctx.unifiedTimes);

    /* --------------------------------------------
       2. TAG SLOTS in each block
    -------------------------------------------- */
    TG.tagBlocksWithSlots(blocks, ctx.unifiedTimes);

    /* --------------------------------------------
       3. GROUP SMART TILES
    -------------------------------------------- */
    const smartGroups = {};
    blocks.forEach(b => {
        if (b.type === "smart") {
            // signature is main1+main2 normalized
            const sd = b.smartData || {};
            const sig = U.normalizeKey(sd.main1) + "|" + U.normalizeKey(sd.main2);
            const key = b.division + "::" + sig;
            if (!smartGroups[key]) smartGroups[key] = [];
            smartGroups[key].push(b);
        }
    });

    /* --------------------------------------------
       4. SMART TILE PASS
    -------------------------------------------- */
    ST.run(smartGroups, ctx);

    /* --------------------------------------------
       5. REGULAR SLOT PASS (Sports, Specials, GA)
    -------------------------------------------- */
    SL.run(blocks, ctx);

    /* --------------------------------------------
       6. LEAGUE + SPECIALTY LEAGUE PASS
    -------------------------------------------- */
    LG.run(blocks, ctx);

    /* --------------------------------------------
       7. OVERRIDES (from Daily Adjustments)
    -------------------------------------------- */
    OV.apply(blocks, ctx);

    /* --------------------------------------------
       8. UPDATE ROTATION HISTORY
    -------------------------------------------- */
    HI.update(ctx);

    /* --------------------------------------------
       9. SAVE RESULTS
    -------------------------------------------- */
    global.saveCurrentDailyData?.("scheduleAssignments", global.scheduleAssignments);
    global.saveCurrentDailyData?.("unifiedTimes", ctx.unifiedTimes);
    global.saveRotationHistory?.(ctx.rotationHistory);

    console.log("ENGINE COMPLETE");

    return {
        schedule: global.scheduleAssignments,
        rotationHistory: ctx.rotationHistory
    };
}

/* ============================================================================
   5) PUBLIC EXPORTS
============================================================================ */

NS.getFullContext = getFullContext;
NS.engine = { run };

/* Also export to global for UI */
global.getFullContext = getFullContext;
global.SchedulerCore = NS;

})(typeof window !== "undefined" ? window : global);
