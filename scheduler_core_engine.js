/* ===========================================================================
   scheduler_core_engine.js

   MASTER ORCHESTRATOR
   -------------------
   This module ties the entire scheduler together:

     1. Build unified time grid
     2. Initialize global scheduleAssignments
     3. Apply overrides (pinned activities, disabled fields/specials/sports)
     4. Group Smart Tiles & run Smart Tile engine
     5. Group + run leagues (regular + specialty)
     6. Assign remaining GA / Sports / Specials
     7. Update rotation history
     8. Return final schedule state

   API:
     SchedulerCore.engine.run(allBlocks, fullContext)

   fullContext:
     {
       divisions,
       yesterdayHistory,
       historicalCounts,
       allActivities,
       h2hActivities,
       fieldsBySport,
       masterLeagues,
       masterSpecialtyLeagues,
       activityProperties,
       dailyOverrides: {
           disabledFields,
           disabledSpecials,
           dailyDisabledSportsByField,
           dailyFieldAvailability,
           bunkOverrides
       },
       rotationHistory,
       findBestSpecial,
       findBestSport,
       findBestGeneral
     }

   =========================================================================== */

(function (global) {
  "use strict";

  const NS = global.SchedulerCore = global.SchedulerCore || {};
  const U  = NS.utils;

  /* =======================================================================
     MAIN ENTRY
     ======================================================================= */

  async function run(allBlocks, fullCtx) {

    /* -------------------------------------------------------------------
       0. Prepare context copies (so we don't mutate the original objects)
       ------------------------------------------------------------------- */
    const ctx = JSON.parse(JSON.stringify(fullCtx));

    // activityProperties must be a MUTABLE map, not a clone inside JSON.parse
    ctx.activityProps = fullCtx.activityProperties;

    /* -------------------------------------------------------------------
       1. Build unified timegrid
       ------------------------------------------------------------------- */
    ctx.unifiedTimes = NS.timegrid.build(allBlocks, 30);

    /* -------------------------------------------------------------------
       2. Prepare scheduleAssignments
       ------------------------------------------------------------------- */
    global.scheduleAssignments = {};
    Object.keys(ctx.divisions).forEach(div => {
      ctx.divisions[div].bunks.forEach(bunk => {
        global.scheduleAssignments[bunk] = [];
      });
    });

    /* -------------------------------------------------------------------
       3. Apply Overrides (pinned activities, disabled fields, etc.)
          The override module PATCHES ctx.activityProps
          AND inserts pinned blocks into schedule
       ------------------------------------------------------------------- */
    const blocksAfterOverrides = NS.overrides.apply(allBlocks, ctx);

    /* -------------------------------------------------------------------
       4. Pre-compute fairness engine state (SPECIALS ONLY)
       ------------------------------------------------------------------- */
    const specialNames =
      ctx.allActivities.specials ||
      Object.keys(ctx.activityProps).filter(x =>
        U.normalizeKey(x).includes("special")
      );

    NS.fairness.init(
      Object.values(ctx.divisions).flatMap(d => d.bunks),
      ctx.historicalCounts,
      specialNames
    );

    /* -------------------------------------------------------------------
       5. Group + Run Smart Tiles
       ------------------------------------------------------------------- */
    const smartGroups = {};
    blocksAfterOverrides
      .filter(b => b.event === "Smart Tile")
      .forEach(b => {
        const d = b.divName;
        const sd = b.smartData;
        const key = `${d}-${sd.main1}-${sd.main2}`;
        if (!smartGroups[key]) smartGroups[key] = [];
        smartGroups[key].push(b);
      });

    NS.smarttiles.run(smartGroups, {
      ...ctx,
      activityProps: ctx.activityProps,
      fieldUsage: (ctx.fieldUsage = ctx.fieldUsage || {})
    });

    /* -------------------------------------------------------------------
       6. Group + Run Leagues (Regular + Specialty)
       ------------------------------------------------------------------- */
    const regularBlocks = blocksAfterOverrides.filter(b => b.event === "League Game");
    const specialtyBlocks = blocksAfterOverrides.filter(b => b.event === "Specialty League");

    NS.leagues.run(
      regularBlocks,
      specialtyBlocks,
      {
        ...ctx,
        fieldUsage: ctx.fieldUsage,
        dailyLeagueSportsUsage: (ctx.dailyLeagueSportsUsage = {})
      }
    );

    /* -------------------------------------------------------------------
       7. Assign remaining blocks
       ------------------------------------------------------------------- */
    const remaining = blocksAfterOverrides.filter(b =>
      ["General Activity Slot", "Sports Slot", "Special Activity"].includes(b.event)
    );

    NS.slots.assign(remaining, {
      ...ctx,
      fieldUsage: ctx.fieldUsage,
      activityProps: ctx.activityProps
    });

    /* -------------------------------------------------------------------
       8. Update rotation + usage history
       ------------------------------------------------------------------- */
    const updatedHistory = NS.history.update({
      ...ctx,
      scheduleAssignments: global.scheduleAssignments
    });

    /* -------------------------------------------------------------------
       9. Return final output
       ------------------------------------------------------------------- */
    return {
      schedule: global.scheduleAssignments,
      rotationHistory: updatedHistory,
      fieldUsage: ctx.fieldUsage,
      activityProps: ctx.activityProps,
      timegrid: ctx.unifiedTimes
    };
  }

  /* =======================================================================
     EXPORT
     ======================================================================= */
  NS.engine = { run };

})(typeof window !== "undefined" ? window : global);
