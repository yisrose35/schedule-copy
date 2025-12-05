// ============================================================================
// scheduler_logic_fillers.js  — CLEANED + REPAIRED
//
// Updates:
// - Timeline compatible (no fieldUsageBySlot).
// - All helper functions organized.
// - All findBest* functions exported correctly.
// - Fixed missing attach of findBestGeneralActivity.
// ============================================================================

(function () {
    "use strict";

    // ---------------------------------------------------------------------
    // UTIL HELPERS
    // ---------------------------------------------------------------------
    function fieldLabel(f) {
        if (window.SchedulerCoreUtils) {
            return window.SchedulerCoreUtils.fieldLabel(f);
        }
        return (f && f.name) ? f.name : f;
    }

    function calculatePreferenceScore(fieldProps, divName) {
        if (!fieldProps?.preferences?.enabled) return 0;
        const list = fieldProps.preferences.list || [];
        const idx = list.indexOf(divName);
        return idx !== -1 ? (1000 - idx * 100) : -50;
    }

    function sortPicksByFreshness(possible, bunkHistory = {}, divName, activityProps) {
        return possible.sort((a, b) => {

            const propsA = activityProps[fieldLabel(a.field)];
            const propsB = activityProps[fieldLabel(b.field)];

            const sA = calculatePreferenceScore(propsA, divName);
            const sB = calculatePreferenceScore(propsB, divName);

            if (sA !== sB) return sB - sA;

            const lastA = bunkHistory[a._activity] || 0;
            const lastB = bunkHistory[b._activity] || 0;

            if (lastA !== lastB) return lastA - lastB;

            return 0.5 - Math.random();
        });
    }

    // ---------------------------------------------------------------------
    // SAFETY LIMIT HELPER
    // ---------------------------------------------------------------------
    function isOverUsageLimit(activityName, bunk, activityProps, historicalCounts, todaySet) {
        const props = activityProps[activityName];
        const max = props?.maxUsage || 0;

        if (max === 0) return false;

        const safeHistory = historicalCounts || {};
        const previous = safeHistory[bunk]?.[activityName] || 0;

        if (previous >= max) return true;

        if (todaySet.has(activityName) && (previous + 1 > max)) return true;

        return false;
    }

    // ---------------------------------------------------------------------
    // TODAY'S ACTIVITIES (non-H2H)
    // ---------------------------------------------------------------------
    function getGeneralActivitiesDoneToday(bunkName) {
        const out = new Set();
        const schedule = window.scheduleAssignments[bunkName] || [];

        for (const entry of schedule) {
            if (entry && entry._activity && !entry._h2h) out.add(entry._activity);
        }
        return out;
    }

    // =====================================================================
    //  EXPORT: findBestSpecial
    // =====================================================================
    window.findBestSpecial = function (
        block,
        allActivities,
        fieldUsageBySlot,
        yesterdayHistory,
        activityProps,
        rotationHistory,
        divisions,
        historicalCounts
    ) {
        const specials = allActivities
            .filter(a => a.type === "special")
            .map(a => ({ field: a.field, sport: null, _activity: a.field }));

        const bunkHistory = rotationHistory?.bunks?.[block.bunk] || {};
        const doneToday = getGeneralActivitiesDoneToday(block.bunk);

        const available = specials.filter(pick => {

            // Timeline check (not a league)
            if (!window.SchedulerCoreUtils.canBlockFit(
                block,
                fieldLabel(pick.field),
                activityProps,
                pick._activity,
                false
            )) return false;

            // usage limit
            if (isOverUsageLimit(
                pick._activity,
                block.bunk,
                activityProps,
                historicalCounts,
                doneToday
            )) return false;

            // not again today
            if (doneToday.has(pick._activity)) return false;

            return true;
        });

        const sorted = sortPicksByFreshness(
            available,
            bunkHistory,
            block.divName,
            activityProps
        );

        return sorted[0] || null;
    };

    // =====================================================================
    //  EXPORT: findBestSportActivity
    // =====================================================================
    window.findBestSportActivity = function (
        block,
        allActivities,
        fieldUsageBySlot,
        yesterdayHistory,
        activityProps,
        rotationHistory,
        divisions,
        historicalCounts
    ) {
        const sports = allActivities
            .filter(a => a.type === "field")
            .map(a => ({ field: a.field, sport: a.sport, _activity: a.sport }));

        const bunkHistory = rotationHistory?.bunks?.[block.bunk] || {};
        const doneToday = getGeneralActivitiesDoneToday(block.bunk);

        const available = sports.filter(pick =>
            window.SchedulerCoreUtils.canBlockFit(
                block,
                fieldLabel(pick.field),
                activityProps,
                pick._activity,
                false
            ) &&
            !doneToday.has(pick._activity)
        );

        const sorted = sortPicksByFreshness(
            available,
            bunkHistory,
            block.divName,
            activityProps
        );

        return sorted[0] || null;
    };

    // =====================================================================
    //  EXPORT: findBestGeneralActivity  (THIS WAS **NOT** ATTACHED BEFORE)
    // =====================================================================
    window.findBestGeneralActivity = function (
        block,
        allActivities,
        h2hActivities,
        fieldUsageBySlot,
        yesterdayHistory,
        activityProps,
        rotationHistory,
        divisions,
        historicalCounts
    ) {
        const possible = allActivities.map(a => ({
            field: a.field,
            sport: a.sport,
            _activity: a.sport || a.field
        }));

        const bunkHistory = rotationHistory?.bunks?.[block.bunk] || {};
        const doneToday = getGeneralActivitiesDoneToday(block.bunk);

        const available = possible.filter(pick => {
            const name = pick._activity;

            if (!window.SchedulerCoreUtils.canBlockFit(
                block,
                fieldLabel(pick.field),
                activityProps,
                name,
                false
            )) return false;

            // Special-case: general activity might be a special
            if (pick.field && !pick.sport) {
                if (isOverUsageLimit(
                    name,
                    block.bunk,
                    activityProps,
                    historicalCounts,
                    doneToday
                )) return false;
            }

            return !doneToday.has(name);
        });

        const sorted = sortPicksByFreshness(
            available,
            bunkHistory,
            block.divName,
            activityProps
        );

        return sorted[0] || { field: "Free", sport: null, _activity: "Free" };
    };

})();
