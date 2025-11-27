/* ===========================================================================
   scheduler_core_fairness.js

   Handles:
     • Long-term activity usage (historicalCounts)
     • Today’s temporary activity usage (todayCounts)
     • Category keys like:
           "special:any"
           "special:<name>"
           "sport:any"
     • Building fairness order for Smart Tiles
     • Incrementing usage when a bunk receives an activity

   Exported API:

     SchedulerCore.fairness = {
         init(bunks, historicalCounts, specialNames),
         getUsage(bunk, category),
         bump(bunk, category, amount),
         order(bunks, category),
         categoryForActivity(activityLabel)
     }

   Depends on:
     SchedulerCore.utils
   =========================================================================== */

(function (global) {
    "use strict";

    const NS = global.SchedulerCore = global.SchedulerCore || {};
    const U  = NS.utils;

    /* =======================================================================
       INTERNAL STATE
       ======================================================================= */

    let baseCounts  = {};   // historicalCounts
    let todayCounts = {};   // usage just for today
    let specials    = [];   // list of special activity names


    /* =======================================================================
       INITIALIZER
       ======================================================================= */

    function init(bunks, historicalCounts, specialActivityNames) {
        baseCounts = {};
        todayCounts = {};
        specials = specialActivityNames ? specialActivityNames.slice() : [];

        // Deep copy historical
        bunks.forEach(b => {
            baseCounts[b] = {};
            todayCounts[b] = {};

            const hist = historicalCounts[b] || {};
            Object.keys(hist).forEach(a => {
                baseCounts[b][a] = hist[a];
            });

            // Compute "special:any" aggregate
            let totalSpecials = 0;
            specials.forEach(s => {
                totalSpecials += (hist[s] || 0);
            });
            baseCounts[b]["special:any"] = totalSpecials;
        });
    }


    /* =======================================================================
       CATEGORY RESOLUTION
       ======================================================================= */

    function categoryForActivity(label) {
        if (!label) return null;
        const s = U.normalizeKey(label);

        // sports bucket
        if (s.includes("sport")) return "sport:any";

        // generic special
        if (s.includes("special")) return "special:any";

        // specific special match
        for (const name of specials) {
            if (s === U.normalizeKey(name)) {
                return `special:${name}`;
            }
        }

        return null;
    }


    /* =======================================================================
       LOOKUP & BUMP
       ======================================================================= */

    function getUsage(bunk, category) {
        const base = baseCounts[bunk]?.[category] || 0;
        const today = todayCounts[bunk]?.[category] || 0;
        return base + today;
    }

    function bump(bunk, category, amount = 1) {
        todayCounts[bunk] = todayCounts[bunk] || {};
        todayCounts[bunk][category] = (todayCounts[bunk][category] || 0) + amount;

        // If this is a specific special, bump "special:any" too
        if (category.startsWith("special:") && category !== "special:any") {
            todayCounts[bunk]["special:any"] =
                (todayCounts[bunk]["special:any"] || 0) + amount;
        }
    }


    /* =======================================================================
       FAIRNESS SORTING
       ======================================================================= */

    /** Return bunks sorted by lowest category usage first */
    function order(bunks, category) {
        const arr = bunks.slice();

        arr.sort((a, b) => {
            const ua = getUsage(a, category);
            const ub = getUsage(b, category);
            if (ua !== ub) return ua - ub;

            // second-level tiebreak: total specials
            const ta = getUsage(a, "special:any");
            const tb = getUsage(b, "special:any");
            if (ta !== tb) return ta - tb;

            // final random tiebreak
            return Math.random() - 0.5;
        });

        return arr;
    }


    /* =======================================================================
       EXPORT
       ======================================================================= */

    NS.fairness = {
        init,
        getUsage,
        bump,
        order,
        categoryForActivity
    };

})(typeof window !== "undefined" ? window : global);
