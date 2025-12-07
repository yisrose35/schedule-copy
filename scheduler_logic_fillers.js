// ============================================================================
// scheduler_logic_fillers.js (FULLY FIXED & SYNCED)
// ============================================================================
//
// - Aligns arguments EXACTLY with scheduler_core_main.js
// - Passes fieldUsageBySlot to canBlockFit (Fixes validation)
// - Corrects 6-argument call to canBlockFit
// - Ensures proper fallback if no activities match
// - FIXED: "Time Paradox" bug where future activities blocked current slots.
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
    // *** FIXED: Now ignores future slots to prevent time paradoxes ***
    // ---------------------------------------------------------
    function getGeneralActivitiesDoneToday(bunkName, currentSlotIndex) {
        const set = new Set();
        const sched = window.scheduleAssignments?.[bunkName] || [];

        sched.forEach((e, idx) => {
            // Only look at slots BEFORE the current one
            if (idx < currentSlotIndex && e?._activity && !e._isTransition) {
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
        fieldUsageBySlot,   // Correct Arg 3
        yesterdayHistory,   // Correct Arg 4
        activityProperties, // Correct Arg 5
        rotationHistory,    // Correct Arg 6
        historicalCounts    // Correct Arg 7
    ) {
        const specials = allActivities
            .filter(a => a.type === 'Special' || a.type === 'special')
            .map(a => ({
                field: a.name, // Usually specials don't have fields, the name IS the field
                sport: null,
                _activity: a.name
            }));

        const bunkHist = rotationHistory?.bunks?.[block.bunk] || {};
        
        // Pass current slot index to avoid checking future
        const currentSlotIndex = block.slots[0];
        const doneToday = getGeneralActivitiesDoneToday(block.bunk, currentSlotIndex);

        const available = specials.filter(pick => {
            const actName = pick._activity;

            // --- timeline/capacity check (Fixed 6-arg call) ---
            if (!window.SchedulerCoreUtils.canBlockFit(
                block,
                fieldLabel(pick.field),
                activityProperties,
                fieldUsageBySlot, // PASSED CORRECTLY
                actName,
                false
            )) {
                return false;
            }

            // --- max usage ---
            if (isOverUsageLimit(actName, block.bunk, activityProperties, historicalCounts, doneToday))
                return false;

            // --- already done today (before now) ---
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
        fieldUsageBySlot,   // Correct Arg 3
        yesterdayHistory,   // Correct Arg 4
        activityProperties, // Correct Arg 5
        rotationHistory,    // Correct Arg 6
        historicalCounts    // Correct Arg 7
    ) {
        // Look for things marked 'field' (Auto-discovered sports)
        const sports = allActivities
            .filter(a => a.type === 'field' || a.type === 'sport')
            .flatMap(a => {
                // Expand to allowed fields
                const fields = a.allowedFields || [a.name];
                return fields.map(f => ({
                    field: f,
                    sport: a.name,
                    _activity: a.name
                }));
            });

        const bunkHist = rotationHistory?.bunks?.[block.bunk] || {};
        
        // Pass current slot index
        const currentSlotIndex = block.slots[0];
        const doneToday = getGeneralActivitiesDoneToday(block.bunk, currentSlotIndex);

        const available = sports.filter(pick => {
            
            // Validate field exists in properties
            if(!activityProperties[fieldLabel(pick.field)]) return false;

            if (!window.SchedulerCoreUtils.canBlockFit(
                block,
                fieldLabel(pick.field),
                activityProperties,
                fieldUsageBySlot, // PASSED CORRECTLY
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
        fieldUsageBySlot,   // Correct Arg 4
        yesterdayHistory,   // Correct Arg 5
        activityProperties, // Correct Arg 6
        rotationHistory,    // Correct Arg 7
        historicalCounts    // Correct Arg 8
    ) {
        // Combine Sports + Specials
        const picks = [];
        
        if (Array.isArray(allActivities)) {
            allActivities.forEach(a => {
                if(a.type === 'Special' || a.type === 'special') {
                    picks.push({
                        field: a.name,
                        sport: null,
                        _activity: a.name
                    });
                } else if (a.type === 'field' || a.type === 'sport') {
                    const fields = a.allowedFields || [a.name];
                    fields.forEach(f => {
                        picks.push({
                            field: f,
                            sport: a.name,
                            _activity: a.name
                        });
                    });
                }
            });
        }

        const bunkHist = rotationHistory?.bunks?.[block.bunk] || {};
        
        // Pass current slot index
        const currentSlotIndex = block.slots[0];
        const doneToday = getGeneralActivitiesDoneToday(block.bunk, currentSlotIndex);

        const available = picks.filter(pick => {
            const actName = pick._activity;

            // skip if undefined property
            if(!activityProperties[fieldLabel(pick.field)]) return false;

            // timeline/capacity check
            if (!window.SchedulerCoreUtils.canBlockFit(
                block,
                fieldLabel(pick.field),
                activityProperties,
                fieldUsageBySlot, // PASSED CORRECTLY
                actName,
                false
            )) return false;

            // max usage (for specials)
            const isSpecial = pick.field && !pick.sport;
            if (isSpecial) {
                if (isOverUsageLimit(actName, block.bunk, activityProperties, historicalCounts, doneToday))
                    return false;
            }

            // already used today (before now)
            return !doneToday.has(actName);
        });

        const sorted = sortPicksByFreshness(available, bunkHist, block.divName, activityProperties);

        // Fallback to "Free" if nothing fits
        return sorted[0] || { field: "Free", sport: null, _activity: "Free" };
    };

})();
