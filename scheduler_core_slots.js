/* ===========================================================================
   scheduler_core_slots.js
   ---------------------------------------------------------------------------
   Provides:
     - findBestSpecial
     - findBestSport
     - findBestGeneral

   All 3 required by SmartTiles + Sports pass.
   ===========================================================================*/

(function (global) {
"use strict";

const NS = global.SchedulerCore = global.SchedulerCore || {};
const F  = NS.field;

/* ---------------------------------------------------------------------------
   SPECIAL — picks best special activity with available capacity
--------------------------------------------------------------------------- */
function findBestSpecial(block, allActivities, fieldUsage, avoidField, activityProps) {
    const specials = allActivities.specials || [];
    for (const name of specials) {
        const props = activityProps[name];
        if (!props) continue;

        if (!F.canFit(block, name, props, fieldUsage, null, name)) continue;
        return { field: name, _activity: name };
    }
    return null;
}

/* ---------------------------------------------------------------------------
   SPORTS — picks best sport + field combination
--------------------------------------------------------------------------- */
function findBestSport(block, allActivities, fieldUsage, avoidField, activityProps) {
    const sports = allActivities.sports || [];
    for (const sportName of sports) {
        const sportFields = allActivities.fieldsBySport?.[sportName] || [];

        for (const f of sportFields) {
            const props = activityProps[f] || {};
            if (!F.canFit(block, f, props, fieldUsage, null, f)) continue;

            return { field: f, sport: sportName, _activity: sportName };
        }
    }
    return null;
}

/* ---------------------------------------------------------------------------
   GENERAL — picks any general activity
--------------------------------------------------------------------------- */
function findBestGeneral(block, allActivities, fieldUsage, avoidField, activityProps) {
    const gens = allActivities.general || [];
    for (const name of gens) {
        const props = activityProps[name];
        if (!props) continue;

        if (!F.canFit(block, name, props, fieldUsage, null, name)) continue;

        return { field: name, _activity: name };
    }
    return null;
}

/* ---------------------------------------------------------------------------
   EXPORT
--------------------------------------------------------------------------- */
NS.slots = {
    findBestSpecial,
    findBestSport,
    findBestGeneral
};

})(typeof window !== "undefined" ? window : global);
