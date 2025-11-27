
/* ===========================================================================
   scheduler_core_overrides.js

   Handles all **daily overrides**, including:
     ✔ Bunk-specific pinned activities
     ✔ Daily disabled fields
     ✔ Daily disabled specials
     ✔ Daily disabled sports by field
     ✔ Daily field availability changes (custom time rules)
     ✔ Pre-placing pinned blocks in the schedule before Smart Tiles
     ✔ Preventing any future overwrite of pinned blocks

   API:
     SchedulerCore.overrides.apply(allBlocks, ctx)

   ctx:
     {
        unifiedTimes,
        fieldUsage,
        activityProps,               // master props BEFORE daily overrides
        divisions,
        disabledFields,
        disabledSpecials,
        dailyFieldAvailability,
        dailyDisabledSportsByField,
        bunkOverrides               // [{ bunk, activity, startTime, endTime }]
     }

   =========================================================================== */

(function (global) {
    "use strict";

    const NS = global.SchedulerCore = global.SchedulerCore || {};
    const U  = NS.utils;
    const F  = NS.field;

    /* =======================================================================
       APPLY DAILY FIELD/SPECIAL DISABLES INTO activityProps
       ======================================================================= */

    function patchActivityProps(ctx) {
        const {
            activityProps,
            disabledFields,
            disabledSpecials,
            dailyFieldAvailability
        } = ctx;

        // Disable fields
        disabledFields.forEach(name => {
            if (activityProps[name]) {
                activityProps[name].available = false;
            }
        });

        // Disable specials
        disabledSpecials.forEach(name => {
            if (activityProps[name]) {
                activityProps[name].available = false;
            }
        });

        // Apply daily time rules
        Object.entries(dailyFieldAvailability).forEach(([field, rules]) => {
            if (!activityProps[field]) return;

            const parsedRules = [];
            for (const r of rules) {
                if (typeof r.startMin === "number" && typeof r.endMin === "number") {
                    parsedRules.push(r);
                } else {
                    const s = U.parseTimeToMinutes(r.start);
                    const e = U.parseTimeToMinutes(r.end);
                    if (s != null && e != null) {
                        parsedRules.push({
                            type: r.type,
                            startMin: s,
                            endMin: e
                        });
                    }
                }
            }

            activityProps[field].timeRules = parsedRules;
        });
    }


    /* =======================================================================
       APPLY DAILY DISABLED SPORTS
       ======================================================================= */

    function patchDailySports(ctx) {
        const { dailyDisabledSportsByField, activityProps } = ctx;

        Object.entries(dailyDisabledSportsByField).forEach(([field, disabledList]) => {
            const props = activityProps[field];
            if (!props) return;

            // Mark field unavailable for those sports
            props.disabledSports = new Set(disabledList);
        });
    }


    /* =======================================================================
       PLACE BUNK-SPECIFIC OVERRIDES
       ======================================================================= */

    function applyBunkOverrides(ctx) {
        const { bunkOverrides, unifiedTimes, divisions, fieldUsage, activityProps } = ctx;
        if (!Array.isArray(bunkOverrides)) return;

        bunkOverrides.forEach(ov => {
            const bunker = ov.bunk;
            const startMin = U.parseTimeToMinutes(ov.startTime);
            const endMin   = U.parseTimeToMinutes(ov.endTime);

            if (!bunker || startMin == null || endMin == null) return;

            const schedule = global.scheduleAssignments[bunker] || [];
            const slots = findSlotsForRange(unifiedTimes, startMin, endMin);

            slots.forEach((slotIndex, idx) => {
                if (!schedule[slotIndex]) {
                    schedule[slotIndex] = {
                        field: ov.activity,
                        sport: null,
                        continuation: idx > 0,
                        _fixed: true,
                        _h2h: false,
                        _activity: ov.activity
                    };
                }
            });

            // Mark usage (acts like pinned)
            F.markUsage(
                { slots, bunk: bunker, divName: findDiv(bunker, divisions) },
                ov.activity,
                fieldUsage,
                ov.activity
            );
        });
    }

    function findSlotsForRange(unifiedTimes, startMin, endMin) {
        const out = [];
        unifiedTimes.forEach((slot, idx) => {
            if (slot.startMin >= startMin && slot.startMin < endMin) {
                out.push(idx);
            }
        });
        return out;
    }

    function findDiv(bunk, divisions) {
        for (const d of Object.keys(divisions)) {
            if (divisions[d].bunks.includes(bunk)) return d;
        }
        return null;
    }


    /* =======================================================================
       MAIN EXPORT
       ======================================================================= */

    function apply(allBlocks, ctx) {
        // FIRST patch master activityProps based on daily rules
        patchActivityProps(ctx);
        patchDailySports(ctx);

        // THEN insert bunk overrides (pinned blocks)
        applyBunkOverrides(ctx);

        // RETURN remaining blocks to schedule normally
        // We *filter out* any pinned blocks from allBlocks
        return allBlocks.filter(b => b.type !== "pinned");
    }

    NS.overrides = { apply };

})(typeof window !== "undefined" ? window : global);
