/* ============================================================================
   scheduler_core_engine.js
   MASTER ENGINE ORCHESTRATOR (For 10-Module Architecture)

   Modules expected:
     scheduler_core_utils.js           → NS.utils
     scheduler_core_timegrid.js        → NS.timegrid
     scheduler_core_field_usage.js     → NS.field
     scheduler_core_fairness.js        → NS.fairness
     scheduler_core_smarttiles.js      → NS.smarttiles
     scheduler_core_slots.js           → NS.slots
     scheduler_core_leagues.js         → NS.leagues
     scheduler_core_overrides.js       → NS.overrides
     scheduler_core_history.js         → NS.history

   This file orchestrates:
     1. Build master block list from master skeleton + daily overrides
     2. Build unifiedTimes grid
     3. Build fieldUsage grid
     4. Smart Tiles pass
     5. Slots pass (Sports, Specials, Activity, Swim)
     6. League pass
     7. Overrides pass
     8. Save scheduleAssignments + unifiedTimes

   ============================================================================ */
(function (global) {
"use strict";

const NS = global.SchedulerCore = global.SchedulerCore || {};

/* ============================================================================
   CORE: BUILD FULL CONTEXT
   ============================================================================ */
NS.getFullContext = function () {
    return {
        divisions:        window.divisions || {},
        allActivities:    window.allActivities || {},
        activityProps:    window.activityProperties || {},

        unifiedTimes:     [],
        fieldUsage:       {},

        fairness:         NS.fairness,
        history:          NS.history,

        field:            NS.field,

        findBestGeneral:  NS.slots.findBestGeneral,
        findBestSpecial:  NS.slots.findBestSpecial,
        findBestSport:    NS.slots.findBestSport,

        leagues:          NS.leagues,
        overrides:        NS.overrides
    };
};

/* ============================================================================
   CORE: EXPAND MASTER SKELETON INTO BLOCK OBJECTS
   ============================================================================ */
function expandSkeletonToBlocks(masterSkeleton, ctx) {
    const blocks = [];

    masterSkeleton.forEach(ev => {
        const start = ev.start;
        const end   = ev.end;
        const div   = ev.division;

        if (!ctx.divisions[div]) return; // unknown division

        blocks.push({
            divName: div,
            startTime: start,
            endTime: end,
            type: ev.type,
            event: ev.event,
            smartData: ev.smartData ? { ...ev.smartData } : null,
            subEvents: ev.subEvents ? ev.subEvents.map(se => ({ ...se })) : null,
            slots: [] // filled after unified timegrid
        });
    });

    return blocks;
}

/* ============================================================================
   CORE: ATTACH SLOT INDICES TO EACH BLOCK
   ============================================================================ */
function attachSlotsToBlocks(blocks, unifiedTimes) {
    blocks.forEach(block => {
        block.slots = [];
        for (let i = 0; i < unifiedTimes.length; i++) {
            const slot = unifiedTimes[i];
            const sMin =
                slot.start.getHours() * 60 + slot.start.getMinutes();
            if (sMin >= block.startTime && sMin < block.endTime) {
                block.slots.push(i);
            }
        }
    });
}

/* ============================================================================
   CORE: GROUP SMART TILES
   ============================================================================ */
function groupSmartTiles(blocks) {
    const groups = {};
    blocks.forEach(b => {
        if (b.type !== "smart") return;

        const sd = b.smartData || {};
        const key = `${b.divName}__${sd.main1 || ""}__${sd.main2 || ""}`;
        if (!groups[key]) groups[key] = [];
        groups[key].push(b);
    });
    return groups;
}

/* ============================================================================ 
   CLEAR SCHEDULE 
   ============================================================================ */
function prepareEmptyScheduleAssignments(ctx) {
    const assignments = {};
    Object.values(ctx.divisions).forEach(div => {
        (div.bunks || []).forEach(b => {
            assignments[b] = new Array(ctx.unifiedTimes.length)
                .fill(null);
        });
    });
    return assignments;
}

/* ============================================================================
   MAIN ENGINE RUN
   ============================================================================ */
NS.run = function () {

    console.log("ENGINE START");

    /* --------------------------------------------
       1. Context
       -------------------------------------------- */
    const ctx = NS.getFullContext();

    /* --------------------------------------------
       2. Load master skeleton from the builder
       -------------------------------------------- */
    if (typeof window.getMasterSkeleton !== "function") {
        throw new Error("Master Scheduler missing getMasterSkeleton()");
    }
    const masterSkeleton = window.getMasterSkeleton();

    /* --------------------------------------------
       3. Expand skeleton to block objects
       -------------------------------------------- */
    let blocks = expandSkeletonToBlocks(masterSkeleton, ctx);

    /* --------------------------------------------
       4. Build unifiedTimes grid
       -------------------------------------------- */
    ctx.unifiedTimes = NS.timegrid.buildUnifiedTimes(ctx, blocks);

    /* --------------------------------------------
       5. Attach slots to blocks
       -------------------------------------------- */
    attachSlotsToBlocks(blocks, ctx.unifiedTimes);

    /* --------------------------------------------
       6. Build fieldUsage grid
       -------------------------------------------- */
    ctx.fieldUsage = NS.field.buildFieldUsage(ctx);

    /* --------------------------------------------
       7. Prepare empty scheduleAssignments
       -------------------------------------------- */
    global.scheduleAssignments = prepareEmptyScheduleAssignments(ctx);

    /* --------------------------------------------
       8. SMART TILES PASS
       -------------------------------------------- */
    const smartGroups = groupSmartTiles(blocks);
    NS.smarttiles.run(smartGroups, ctx);

    /* --------------------------------------------
       9. SLOT ASSIGNMENT PASS (Sports / Special / Activity / Swim)
       -------------------------------------------- */
    NS.slots.assign(blocks, ctx);

    /* --------------------------------------------
       10. LEAGUES PASS
       -------------------------------------------- */
    NS.leagues.run(blocks, ctx);

    /* --------------------------------------------
       11. OVERRIDES PASS (User daily-adjustment overrides)
       -------------------------------------------- */
    NS.overrides.apply(blocks, ctx);

    /* --------------------------------------------
       12. SAVE RESULTS
       -------------------------------------------- */
    window.saveCurrentDailyData?.("scheduleAssignments", global.scheduleAssignments);
    window.saveCurrentDailyData?.("unifiedTimes", ctx.unifiedTimes);

    console.log("ENGINE COMPLETE");
};

/* ============================================================================
   EXPORT
   ============================================================================ */

// Public API for the new 10-module engine
NS.runEngine     = NS.run;             // legacy alias
NS.run           = NS.run;             // main engine entry point
NS.getFullContext = getFullContext;    // expose context builder

// attach to window/global
global.SchedulerCore = NS;

