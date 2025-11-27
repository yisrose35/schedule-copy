/* ===========================================================================
   scheduler_core_engine.js
   Master Orchestrator for the 10-Module SchedulerCore Engine
   =========================================================================== */

(function (global) {
    "use strict";

    const NS = global.SchedulerCore = global.SchedulerCore || {};

    const U  = NS.utils;
    const TG = NS.timegrid;
    const F  = NS.field;
    const FR = NS.fairness;
    const ST = NS.smarttiles;
    const SL = NS.slots;
    const LG = NS.leagues;
    const OV = NS.overrides;
    const HI = NS.history;

    /* =======================================================================
       BUILD FULL CONTEXT
       ======================================================================= */
    function getFullContext() {
        try {
            const divisions        = global.divisions               || {};
            const allActivities    = global.allActivities           || {};
            const activityProps    = global.activityProperties      || {};
            const fieldsBySport    = global.fieldsBySport           || {};
            const masterLeagues    = global.masterLeagues           || {};
            const masterSpecialty  = global.masterSpecialtyLeagues  || {};
            const rotationHistory  = HI.getRotationHistory()        || {};
            const yesterdayHistory = HI.getYesterdayHistory()       || {};
            const disabledLeagues  = global.disabledLeagues         || [];
            const disabledSL       = global.disabledSpecialtyLeagues|| [];

            const unifiedTimes = TG.buildUnifiedTimeGrid(divisions);

            return {
                divisions,
                unifiedTimes,
                allActivities,
                activityProps,
                fieldsBySport,
                masterLeagues,
                masterSpecialtyLeagues: masterSpecialty,
                rotationHistory,
                yesterdayHistory,
                disabledLeagues,
                disabledSpecialtyLeagues: disabledSL,
                fieldUsage: F.createUsageTracker(unifiedTimes),

                /* engine injectors */
                findBestSpecial: SL.findBestSpecial,
                findBestSport:   SL.findBestSport,
                findBestGeneral: SL.findBestGeneral
            };
        }
        catch (e) {
            console.error("getFullContext ERROR:", e);
            return null;
        }
    }


    /* =======================================================================
       MAIN ENGINE RUN
       ======================================================================= */
    NS.run = async function (blocks, ctx) {
        if (!ctx) throw new Error("Context missing. Engine cannot run.");

        // Create storage
        global.scheduleAssignments = {};
        const divisions = ctx.divisions;

        Object.keys(divisions).forEach(div => {
            divisions[div].bunks.forEach(b => {
                global.scheduleAssignments[b] = new Array(ctx.unifiedTimes.length);
            });
        });

        /* --------------------------------------------
           1. FIELD USAGE INITIALIZATION
        -------------------------------------------- */
        ctx.fieldUsage = F.createUsageTracker(ctx.unifiedTimes);

        /* --------------------------------------------
           2. SPLIT BLOCK EXPANSION
        -------------------------------------------- */
        blocks = SL.expandSplits(blocks);

        /* --------------------------------------------
           3. GROUP SMART TILES
        -------------------------------------------- */
        const smartGroups = SL.groupSmartTiles(blocks);

        /* --------------------------------------------
           4. REMOVE SMART TILE BLOCKS FROM MAIN
        -------------------------------------------- */
        const normalBlocks = blocks.filter(b => b.type !== "smart");

        /* --------------------------------------------
           5. RUN SMART TILE ENGINE
        -------------------------------------------- */
        ST.run(smartGroups, ctx);

        /* --------------------------------------------
           6. RUN STANDARD SLOTS (Activity / Special / Sports / Swim fallback)
        -------------------------------------------- */
        SL.run(normalBlocks, ctx);

        /* --------------------------------------------
           7. LEAGUES (REGULAR)
        -------------------------------------------- */
        LG.run(normalBlocks, ctx);

        /* --------------------------------------------
           8. SPECIALTY LEAGUES
        -------------------------------------------- */
        LG.runSpecialty(normalBlocks, ctx);

        /* --------------------------------------------
           9. OVERRIDES FROM DAILY ADJUSTMENTS
        -------------------------------------------- */
        OV.apply(normalBlocks, ctx);

        /* --------------------------------------------
           10. SAVE HISTORY
        -------------------------------------------- */
        const newHistory = HI.computeNewHistory(ctx.rotationHistory, global.scheduleAssignments);
        HI.saveRotationHistory(newHistory);

        /* --------------------------------------------
           11. RETURN
        -------------------------------------------- */
        return {
            schedule: global.scheduleAssignments,
            rotationHistory: newHistory
        };
    };


    /* =======================================================================
       EXPORT PUBLIC API
       ======================================================================= */

    NS.getFullContext = getFullContext;
    NS.engine = NS;       // alias for clarity
    global.SchedulerCore = NS;

})(typeof window !== "undefined" ? window : global);
