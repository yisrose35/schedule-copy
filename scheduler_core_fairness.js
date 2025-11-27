/* ============================================================================
   scheduler_core_fairness.js
   FIXED VERSION — FULL FILE
   ---------------------------------------------------------------------------
   ✔ Handles ANY input type: arrays OR objects
   ✔ Prevents slice() errors
   ✔ Normalizes all activity names
   ✔ Provides category and ordering engine for Smart Tiles + Slots
   ✔ Exported as SchedulerCore.fairness
   ============================================================================ */

(function (global) {
    "use strict";

    const NS = global.SchedulerCore = global.SchedulerCore || {};
    const U  = NS.utils;

    /* =======================================================================
       INTERNAL STORAGE
       ======================================================================= */
    let SPORTS = [];
    let SPECIALS = [];
    let GENERAL = [];

    let history = {}; // { bunk: { sport: x, special: y, general: z } }


    /* =======================================================================
       UTILITY: Convert array OR object → array of normalized names
       ======================================================================= */
    function toArray(input) {
        if (!input) return [];

        // Already array
        if (Array.isArray(input)) {
            return input.map(a => U.normalizeActivityName(a)).filter(Boolean);
        }

        // Object → values
        if (typeof input === "object") {
            return Object.keys(input)
                .map(a => U.normalizeActivityName(a))
                .filter(Boolean);
        }

        return [];
    }


    /* =======================================================================
       INIT FAIRNESS CATEGORIES
       ======================================================================= */
    function init(allActivities) {
        // Ensure clean structure
        SPORTS = toArray(allActivities.sports);
        SPECIALS = toArray(allActivities.specials);
        GENERAL = toArray(allActivities.general);

        console.log("FAIRNESS INIT — categories:", {
            SPORTS,
            SPECIALS,
            GENERAL
        });
    }


    /* =======================================================================
       DETERMINE CATEGORY FOR ACTIVITY
       ======================================================================= */
    function categoryForActivity(name) {
        if (!name) return null;

        const norm = U.normalizeActivityName(name);

        if (SPORTS.includes(norm)) return "sport";
        if (SPECIALS.includes(norm)) return "special";
        if (GENERAL.includes(norm)) return "general";

        // Unknown → treat as general
        return "general";
    }


    /* =======================================================================
       BUILD ORDERING LIST FOR A CATEGORY
       ======================================================================= */
    function order(bunks, category) {
        if (!category) return bunks.slice();

        return bunks
            .slice()
            .sort((a, b) => {
                const ha = history[a]?.[category] || 0;
                const hb = history[b]?.[category] || 0;
                return ha - hb;
            });
    }


    /* =======================================================================
       RECORD USAGE
       ======================================================================= */
    function bump(bunk, category, amount = 1) {
        if (!history[bunk]) {
            history[bunk] = { sport: 0, special: 0, general: 0 };
        }

        if (!history[bunk][category]) {
            history[bunk][category] = 0;
        }

        history[bunk][category] += amount;
    }


    /* =======================================================================
       LOAD / SAVE
       (hooked into SchedulerCore.history)
       ======================================================================= */
    function loadRotation(obj) {
        history = obj || {};
    }

    function saveRotation() {
        return history;
    }


    /* =======================================================================
       EXPORT
       ======================================================================= */
    NS.fairness = {
        init,
        order,
        bump,
        categoryForActivity,
        loadRotation,
        saveRotation
    };

})(typeof window !== "undefined" ? window : global);
