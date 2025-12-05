// =================================================================
// scheduler_logic_fillers.js
//
// UPDATED:
// - Adapted for Timeline Architecture.
// - Removed 'fieldUsageBySlot' from canBlockFit calls (Timeline handles state).
// - Added 'isLeague = false' flag to canBlockFit calls.
// =================================================================

(function () {
    'use strict';

    // Delegate to the central Utilities for field name resolution
    function fieldLabel(f) {
        return window.SchedulerCoreUtils
            ? window.SchedulerCoreUtils.fieldLabel(f)
            : (f && f.name ? f.name : f);
    }

    function calculatePreferenceScore(fieldProps, divName) {
        if (!fieldProps?.preferences?.enabled) return 0;

        const index = (fieldProps.preferences.list || []).indexOf(divName);
        return index !== -1 ? 1000 - (index * 100) : -50;
    }

    function sortPicksByFreshness(possiblePicks, bunkHistory = {}, divName, activityProperties) {
        return possiblePicks.sort((a, b) => {
            const propsA = activityProperties[fieldLabel(a.field)];
            const propsB = activityProperties[fieldLabel(b.field)];

            const scoreA = calculatePreferenceScore(propsA, divName);
            const scoreB = calculatePreferenceScore(propsB, divName);

            if (scoreA !== scoreB) return scoreB - scoreA; // Higher preference first

            const lastA = bunkHistory[a._activity] || 0;
            const lastB = bunkHistory[b._activity] || 0;

            if (lastA !== lastB) return lastA - lastB; // Less recent = better

            return 0.5 - Math.random(); // Random tiebreaker
        });
    }

    // --- HELPER: Check Usage Limit (Safety Net for Generator) ---
    function isOverUsageLimit(activityName, bunk, activityProperties, historicalCounts, activitiesDoneToday) {
        const props = activityProperties[activityName];
        const max = props?.maxUsage || 0; // 0 means unlimited

        if (max === 0) return false;

        // SAFETY: Handle missing historical data gracefully
        const safeHistory = historicalCounts || {};
        const pastCount = safeHistory[bunk]?.[activityName] || 0;

        // Already hit limit in previous days?
        if (pastCount >= max) return true;

        // About to exceed limit today?
        if (activitiesDoneToday.has(activityName) && pastCount + 1 >= max) {
            return true;
        }

        return false;
    }

    function getGeneralActivitiesDoneToday(bunkName) {
        const activities = new Set();
        const schedule = window.scheduleAssignments?.[bunkName] || [];

        for (const entry of schedule) {
            if (entry?._activity && !entry._h2h) {
                activities.add(entry._activity);
            }
        }
        return activities;
    }

    // ================================================================
    // Exported Functions
    // ================================================================

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

        const bunkHistory = rotationHistory?.bunks?.[block.bunk] || {};
        const activitiesDoneToday = getGeneralActivitiesDoneToday(block.bunk);

        const availablePicks = specials.filter(pick => {
            const name = pick._activity;

            // 1. Timeline constraint check (not a league)
            if (!window.SchedulerCoreUtils?.canBlockFit(
                block,
                fieldLabel(pick.field),
                activityProperties,
                name,
                false // isLeague
            )) {
                return false;
            }

            // 2. Max usage limit
            if (isOverUsageLimit(name, block.bunk, activityProperties, historicalCounts, activitiesDoneToday)) {
                return false;
            }

            // 3. Already done today
            if (activitiesDoneToday.has(name)) {
                return false;
            }

            return true;
        });

        const sortedPicks = sortPicksByFreshness(availablePicks, bunkHistory, block.divName, activityProperties);
        return sortedPicks[0] || null;
    };

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

        const bunkHistory = rotationHistory?.bunks?.[block.bunk] || {};
        const activitiesDoneToday = getGeneralActivitiesDoneToday(block.bunk);

        const availablePicks = sports.filter(pick =>
            window.SchedulerCoreUtils?.canBlockFit(
                block,
                fieldLabel(pick.field),
                activityProperties,
                pick._activity,
                false
            ) && !activitiesDoneToday.has(pick._activity)
        );

        const sortedPicks = sortPicksByFreshness(availablePicks, bunkHistory, block.divName, activityProperties);
        return sortedPicks[0] || null;
    };

    window.findBestGeneralActivity = function (
        block,
        allActivities,
        h2hActivities,
        yesterdayHistory,
        activityProperties,
        rotationHistory,
        historicalCounts
    ) {
        const allPossiblePicks = allActivities.map(a => ({
            field: a.field,
            sport: a.sport,
            _activity: a.sport || a.field
        }));

        const bunkHistory = rotationHistory?.bunks?.[block.bunk] || {};
        const activitiesDoneToday = getGeneralActivitiesDoneToday(block.bunk);

        const availablePicks = allPossiblePicks.filter(pick => {
            const name = pick._activity;

            // Core Timeline validation
            if (!window.SchedulerCoreUtils?.canBlockFit(
                block,
                fieldLabel(pick.field),
                activityProperties,
                name,
                false
            )) {
                return false;
            }

            // Special-case: if this is a special activity (no sport), check maxUsage
            if (pick.field && !pick.sport) {
                if (isOverUsageLimit(name, block.bunk, activityProperties, historicalCounts, activitiesDoneToday)) {
                    return false;
                }
            }

            return !activitiesDoneToday.has(name);
        });

        const sortedPicks = sortPicksByFreshness(availablePicks, bunkHistory, block.divName, activityProperties);

        return sortedPicks[0] || { field: "Free", sport: null, _activity: "Free" };
    };

})();
