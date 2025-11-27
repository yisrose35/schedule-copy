/* ============================================================================
   scheduler_core_field_usage.js
   FIELD + RESOURCE CAPACITY ENGINE
   --------------------------------
   Responsibilities:
     • Initialize field usage grid
     • Track per-slot usage counts
     • Check sharability rules
     • Enforce capacity
     • Expose reservation data for fillers / smart tiles
   ============================================================================ */

(function (global) {
    "use strict";

    const NS = global.SchedulerCore = global.SchedulerCore || {};
    NS.field = NS.field || {};

    const U = NS.utils;

    /* ======================================================================
       1) INITIALIZE FIELD USAGE STRUCTURE
       ====================================================================== */
    NS.field.createFieldUsage = function (unifiedTimes) {
        const usage = {};

        unifiedTimes.forEach((slot, i) => {
            usage[i] = {};               // e.g.  usage[i]["Main Field"] = 2
        });

        return usage;
    };

    /* ======================================================================
       2) RESERVATION LOOKUP (USED BY FILLERS + SMART TILES)
       ====================================================================== */
    NS.field.getReservationsForField = function (fieldUsage, fieldName, slotIndices) {
        const out = [];

        slotIndices.forEach(i => {
            const slotUsage = fieldUsage[i] || {};
            out.push(slotUsage[fieldName] || 0);
        });

        return out;
    };

    /* ======================================================================
       3) CHECK IF FIELD CAN FIT (CAPACITY + SHARABILITY)
       ====================================================================== */
    NS.field.canFit = function (block, fieldName, props, fieldUsage, unifiedTimes, activityName) {
        if (!props) return false;

        const sharability = props.sharability || { type: "exclusive" };
        const cap = props.capacity || 1;

        const slots = block.slots;

        for (const idx of slots) {
            const slotUsage = fieldUsage[idx] || {};
            const current = slotUsage[fieldName] || 0;

            /* -------------------------------------------
               EXCLUSIVE FIELD
               ------------------------------------------- */
            if (sharability.type === "exclusive") {
                if (current > 0) return false;
            }

            /* -------------------------------------------
               SHARED FIELD w/ LIMIT
               ------------------------------------------- */
            else if (sharability.type === "limited") {
                const max = sharability.max || cap;
                if (current >= max) return false;
            }

            /* -------------------------------------------
               SHARABLE BY "ALL" TYPE (e.g., Gameroom)
               ------------------------------------------- */
            else if (sharability.type === "all") {
                if (current >= cap) return false;
            }

            /* -------------------------------------------
               FALLBACK
               ------------------------------------------- */
            else {
                if (current >= cap) return false;
            }
        }

        return true;
    };

    /* ======================================================================
       4) MARK FIELD USAGE (AFTER SUCCESSFUL ASSIGNMENT)
       ====================================================================== */
    NS.field.markUsage = function (block, fieldName, fieldUsage, activityName) {
        block.slots.forEach(idx => {
            if (!fieldUsage[idx]) fieldUsage[idx] = {};
            fieldUsage[idx][fieldName] = (fieldUsage[idx][fieldName] || 0) + 1;
        });
    };

})(typeof window !== "undefined" ? window : global);

