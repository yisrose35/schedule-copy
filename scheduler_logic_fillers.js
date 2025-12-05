// ============================================================================
// scheduler_logic_fillers.js (FULLY FIXED & SYNCED WITH 5-ARG canBlockFit)
// ============================================================================
//
// - Correctly calls canBlockFit(block, fieldName, activityProperties, activityName, isLeague)
// - Removes ALL uses of fieldUsageBySlot inside canBlockFit
// - Removes all invalid 6-arg calls
// - Ensures consistent fieldLabeling
// - Ensures SmartTiles + General/Special/Sport flows work
// ============================================================================

(function () {
    'use strict';

    // ---------------------------------------------------------
    // Safe fieldLabel wrapper
    // ---------------------------------------------------------
    function fieldLabel(f) {
        if (window.SchedulerCoreUtils?.fieldLabel) {
            return window.SchedulerCoreUtils.fieldLabel(f);
        }
        return (f && f.name) ? f.name : f;
    }

    // ---------------------------------------------------------
    // Preferences Score
    // ---------------------------------------------------------
    function calculatePreferenceScore(fieldProps, divName) {
        if (!fieldProps?.preferences?.enabled) return 0;

        const idx = (fieldProps.preferences.list || []).indexOf(divName);
        return idx !== -1 ? (1000 - idx * 100) : -50;
    }

    // ---------------------------------------------------------
    // Freshness Sorting
    // ---------------------------------------------------------
    function sortPicksByFreshness(picks, bunkHistory = {}, divName, activityProperties) {
        return picks.sort((a, b) => {
            const propsA = activityProperties[fieldLabel(a.field)];
            const propsB = activityProperties[fieldLabel(b.field)];

            const prefA = calculatePreferenceScore(propsA, divName);
            const prefB = calculatePreferenceScore(propsB, divName);

            if (prefA !== prefB) return prefB - prefA;

            const lastA = bunkHistory[a._activity] || 0;
            const lastB = bunkHistory[b._activity] || 0;

            if (lastA !== lastB) return lastA - lastB;

            return Math.random() - 0.5;
        });
    }

    // ---------------------------------------------------------
    // Daily Activity Tracker (GA/Special/Sport)
    // ---------------------------------------------------------
    function getGeneralActivitiesDoneToday(bunkName) {
        const set = new Set();
        const sched = window.scheduleAssignments?.[bunkName] || [];

        sched.forEach(e => {
            if (e?._activity && !e._isTransition) {
                set.add(e._activity);
            }
        });

        return set;
    }

    // ---------------------------------------------------------
    // Max Usage Guard
    // ---------------------------------------------------------
    function isOverUsageLimit(activityName, bunk, activityProperties, historicalCounts, todaySet) {
        const props = activityProperties[activityName];
        const max = props?.maxUsage || 0;

        if (max === 0) return false;

        const history = historicalCounts?.[bunk]?.[activityName] || 0;
        if (history >= max) return true;

        if (todaySet.has(activityName) && history + 1 >= max) return true;

        return false;
    }

    // ============================================================================
    // SPECIAL ACTIVITY SELECTOR
    // ============================================================================
    window.findBestSpecial = function (
        block,
        allActivities,
        yesterdayHistory,
        activityProperties,
        rotationHistory,
        historicalCounts
    ) {
        const specials = allActivities
            .filter(a => a.type === 'special')
            .map(a => ({
                field: a.field,
                sport: null,
                _activity: a.field
            }));

        const bunkHist = rotationHistory?.bunks?.[block.bunk] || {};
        const doneToday = getGeneralActivitiesDoneToday(block.bunk);

        const available = specials.filter(pick => {
            const actName = pick._activity;

            // --- timeline/capacity check (correct 5-arg form) ---
            if (!window.SchedulerCoreUtils.canBlockFit(
                block,
                fieldLabel(pick.field),
                activityProperties,
                actName,
                false
            )) {
                return false;
            }

            // --- max usage ---
            if (isOverUsageLimit(actName, block.bunk, activityProperties, historicalCounts, doneToday))
                return false;

            // --- already done today ---
            if (doneToday.has(actName)) return false;

            return true;
        });

        const sorted = sortPicksByFreshness(available, bunkHist, block.divName, activityProperties);
        return sorted[0] || null;
    };

    // ============================================================================
    // SPORTS ACTIVITY SELECTOR
    // ============================================================================
    window.findBestSportActivity = function (
        block,
        allActivities,
        yesterdayHistory,
        activityProperties,
        rotationHistory,
        historicalCounts
    ) {
        const sports = allActivities
            .filter(a => a.type === 'field')
            .map(a => ({
                field: a.field,
                sport: a.sport,
                _activity: a.sport
            }));

        const bunkHist = rotationHistory?.bunks?.[block.bunk] || {};
        const doneToday = getGeneralActivitiesDoneToday(block.bunk);

        const available = sports.filter(pick => {
            if (!window.SchedulerCoreUtils.canBlockFit(
                block,
                fieldLabel(pick.field),
                activityProperties,
                pick._activity,
                false
            )) return false;

            return !doneToday.has(pick._activity);
        });

        const sorted = sortPicksByFreshness(available, bunkHist, block.divName, activityProperties);
        return sorted[0] || null;
    };

    // ============================================================================
    // GENERAL ACTIVITY SELECTOR
    // ============================================================================
    window.findBestGeneralActivity = function (
        block,
        allActivities,
        h2hActivities,
        yesterdayHistory,
        activityProperties,
        rotationHistory,
        historicalCounts
    ) {
        const picks = allActivities.map(a => ({
            field: a.field,
            sport: a.sport,
            _activity: a.sport || a.field
        }));

        const bunkHist = rotationHistory?.bunks?.[block.bunk] || {};
        const doneToday = getGeneralActivitiesDoneToday(block.bunk);

        const available = picks.filter(pick => {
            const actName = pick._activity;

            // timeline/capacity check
            if (!window.SchedulerCoreUtils.canBlockFit(
                block,
                fieldLabel(pick.field),
                activityProperties,
                actName,
                false
            )) return false;

            // max usage (only if special i.e. field but no sport)
            const isSpecial = pick.field && !pick.sport;
            if (isSpecial) {
                if (isOverUsageLimit(actName, block.bunk, activityProperties, historicalCounts, doneToday))
                    return false;
            }

            // already used today
            return !doneToday.has(actName);
        });

        const sorted = sortPicksByFreshness(available, bunkHist, block.divName, activityProperties);

        return sorted[0] || { field: "Free", sport: null, _activity: "Free" };
    };

})();
