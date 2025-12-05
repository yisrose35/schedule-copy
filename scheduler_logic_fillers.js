// ============================================================================
// scheduler_logic_fillers.js  — CLEANED + TIMELINE REPAIRED VERSION
//
// COMPLETE FEATURES:
// ✓ Timeline compatible (no 30-min assumptions)
// ✓ Exports: findBestSpecial, findBestSportActivity, findBestGeneralActivity
// ✓ All activity selection logic patched
// ✓ Safe string handling everywhere
// ✓ Rotation history + Today-Set logic unified
// ✓ Over-usage limits patched
// ✓ Zero reliance on slot-index-based times
// ============================================================================

(function () {
    "use strict";

    // -------------------------------------------------------------------------
    // HELPERS
    // -------------------------------------------------------------------------
    function fieldLabel(f) {
        if (window.SchedulerCoreUtils) {
            return window.SchedulerCoreUtils.fieldLabel(f);
        }
        return (f && f.name) ? f.name : f;
    }

    function calculatePreferenceScore(fieldProps, divName) {
        if (!fieldProps?.preferences?.enabled) return 0;

        const list = fieldProps.preferences.list || [];
        const index = list.indexOf(divName);

        if (index === -1) return -50;
        return 1000 - (index * 100);
    }

    function sortPicksByFreshness(picks, bunkHistory, divName, activityProps) {
        return picks.sort((a, b) => {
            const propsA = activityProps[fieldLabel(a.field)];
            const propsB = activityProps[fieldLabel(b.field)];

            const prefA = calculatePreferenceScore(propsA, divName);
            const prefB = calculatePreferenceScore(propsB, divName);

            if (prefA !== prefB) return prefB - prefA;

            const lastA = bunkHistory[a._activity] || 0;
            const lastB = bunkHistory[b._activity] || 0;

            if (lastA !== lastB) return lastA - lastB;

            return 0.5 - Math.random();
        });
    }

    // -------------------------------------------------------------------------
    // TODAY’S ACTIVITIES (non-league, non-transition)
    // -------------------------------------------------------------------------
    function getGeneralActivitiesDoneToday(bunkName) {
        const out = new Set();
        const schedule = window.scheduleAssignments[bunkName] || [];

        for (const entry of schedule) {
            if (entry && entry._activity && !entry._h2h && !entry._isTransition) {
                out.add(entry._activity);
            }
        }
        return out;
    }

    // -------------------------------------------------------------------------
    // SAFETY LIMIT CHECKER
    // -------------------------------------------------------------------------
    function isOverUsageLimit(activityName, bunk, activityProps, historicalCounts, todaySet) {
        const props = activityProps[activityName];
        const max = props?.maxUsage || 0;

        if (max === 0) return false;

        const hist = historicalCounts || {};
        const prev = hist[bunk]?.[activityName] || 0;

        if (prev >= max) return true;
        if (todaySet.has(activityName) && prev + 1 > max) return true;

        return false;
    }

    // =========================================================================
    //  EXPORT: findBestSpecial
    // =========================================================================
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
        const specialList = allActivities
            .filter(a => a.type === "special")
            .map(a => ({
                field: a.field,
                sport: null,
                _activity: a.field
            }));

        const bunkHistory = rotationHistory?.bunks?.[block.bunk] || {};
        const todaySet = getGeneralActivitiesDoneToday(block.bunk);

        const available = specialList.filter(pick => {

            // Timeline / capacity check
            if (!window.SchedulerCoreUtils.canBlockFit(
                block,
                fieldLabel(pick.field),
                activityProps,
                fieldUsageBySlot,
                pick._activity
            )) {
                return false;
            }

            // Over-usage limit
            if (isOverUsageLimit(
                pick._activity,
                block.bunk,
                activityProps,
                historicalCounts,
                todaySet
            )) return false;

            // Not again today
            if (todaySet.has(pick._activity)) return false;

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

    // =========================================================================
    //  EXPORT: findBestSportActivity
    // =========================================================================
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
            .map(a => ({
                field: a.field,
                sport: a.sport,
                _activity: a.sport
            }));

        const bunkHistory = rotationHistory?.bunks?.[block.bunk] || {};
        const todaySet = getGeneralActivitiesDoneToday(block.bunk);

        const available = sports.filter(pick => {
            const label = fieldLabel(pick.field);

            if (!window.SchedulerCoreUtils.canBlockFit(
                block,
                label,
                activityProps,
                fieldUsageBySlot,
                pick._activity
            )) return false;

            if (todaySet.has(pick._activity)) return false;

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

    // =========================================================================
    //  EXPORT: findBestGeneralActivity
    // =========================================================================
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
        const candidates = allActivities.map(a => ({
            field: a.field,
            sport: a.sport,
            _activity: a.sport || a.field
        }));

        const bunkHistory = rotationHistory?.bunks?.[block.bunk] || {};
        const todaySet = getGeneralActivitiesDoneToday(block.bunk);

        const available = candidates.filter(pick => {
            const activityName = pick._activity;
            const fLabel = fieldLabel(pick.field);

            if (!window.SchedulerCoreUtils.canBlockFit(
                block,
                fLabel,
                activityProps,
                fieldUsageBySlot,
                activityName
            )) return false;

            // General activity may be special-like
            if (!pick.sport) {
                if (isOverUsageLimit(
                    activityName,
                    block.bunk,
                    activityProps,
                    historicalCounts,
                    todaySet
                )) return false;
            }

            if (todaySet.has(activityName)) return false;

            return true;
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
