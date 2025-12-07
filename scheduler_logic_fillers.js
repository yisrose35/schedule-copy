// ============================================================================
// scheduler_logic_fillers.js — FINAL GCM VERSION
// Fully aligned with:
// - Updated Loader (masterActivities, fieldsBySport, activityProperties)
// - Updated Utils (new canBlockFit signature, transition logic)
// - Hybrid Sports Model (Option C)
// - Sports Slot = Fairness-Based Selection
// - Specials = Virtual Fields
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
    // Preference Score
    // ---------------------------------------------------------
    function calculatePreferenceScore(fieldProps, divName) {
        if (!fieldProps?.preferences?.enabled) return 0;

        const list = fieldProps.preferences.list || [];
        const idx = list.indexOf(divName);

        if (idx === -1) return -50;        // Not preferred
        return 1000 - idx * 100;           // Higher priority gets higher score
    }

    // ---------------------------------------------------------
    // Fairness Score (Sports Slot)
    // ---------------------------------------------------------
    function calculateFairnessScore(activityName, bunkName, rotationHistory, yesterdayHistory, doneToday) {
        const hist = rotationHistory?.bunks?.[bunkName] || {};
        const yesterday = yesterdayHistory?.[bunkName] || [];

        const count = hist[activityName] || 0;
        const didYesterday = yesterday.includes(activityName);
        const didToday = doneToday.has(activityName);

        let score = 0;

        // Prefer sports done least this week
        score -= count * 50;

        // Hard avoid yesterday unless no alternative
        if (didYesterday) score -= 600;

        // Never repeat today
        if (didToday) score -= 9999;

        return score;
    }

    // ---------------------------------------------------------
    // Freshness Sorting for Specials / General
    // ---------------------------------------------------------
    function sortPicksByFreshness(picks, bunkHist = {}, divName, activityProperties) {
        return picks.sort((a, b) => {
            const propsA = activityProperties[fieldLabel(a.field)] || {};
            const propsB = activityProperties[fieldLabel(b.field)] || {};

            const prefA = calculatePreferenceScore(propsA, divName);
            const prefB = calculatePreferenceScore(propsB, divName);

            if (prefA !== prefB) return prefB - prefA;

            const lastA = bunkHist[a._activity] || 0;
            const lastB = bunkHist[b._activity] || 0;

            if (lastA !== lastB) return lastA - lastB;

            return Math.random() - 0.5;
        });
    }

    // ---------------------------------------------------------
    // Determine activities already done today (no repeats)
    // ---------------------------------------------------------
    function getGeneralActivitiesDoneToday(bunkName, currentSlotIndex) {
        const set = new Set();
        const sched = window.scheduleAssignments?.[bunkName] || [];

        sched.forEach((e, idx) => {
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

    // ========================================================================
    // SPECIAL ACTIVITY SELECTOR
    // ========================================================================
    window.findBestSpecial = function (
        block,
        allActivities,
        fieldUsageBySlot,
        yesterdayHistory,
        activityProperties,
        rotationHistory,
        historicalCounts
    ) {
        const specials = allActivities
            .filter(a => a.type === 'Special' || a.type === 'special')
            .map(a => ({
                field: a.name,
                sport: null,
                _activity: a.name
            }));

        const bunkHist = rotationHistory?.bunks?.[block.bunk] || {};
        const currentSlotIndex = block.slots[0];
        const doneToday = getGeneralActivitiesDoneToday(block.bunk, currentSlotIndex);

        const available = specials.filter(pick => {
            const actName = pick._activity;

            // canBlockFit
            if (!window.SchedulerCoreUtils.canBlockFit(
                block,
                fieldLabel(pick.field),
                activityProperties,
                fieldUsageBySlot,
                actName,
                false
            )) return false;

            // max usage
            if (isOverUsageLimit(actName, block.bunk, activityProperties, historicalCounts, doneToday))
                return false;

            // today repeat
            if (doneToday.has(actName)) return false;

            return true;
        });

        const sorted = sortPicksByFreshness(available, bunkHist, block.divName, activityProperties);
        return sorted[0] || null;
    };

    // ========================================================================
    // SPORTS ACTIVITY SELECTOR (for named sports)
    // ========================================================================
    window.findBestSportActivity = function (
        block,
        allActivities,
        fieldUsageBySlot,
        yesterdayHistory,
        activityProperties,
        rotationHistory,
        historicalCounts
    ) {
        const bunkHist = rotationHistory?.bunks?.[block.bunk] || {};
        const fieldsBySport = window.SchedulerCoreUtils.loadAndFilterData().fieldsBySport || {};

        const currentSlotIndex = block.slots[0];
        const doneToday = getGeneralActivitiesDoneToday(block.bunk, currentSlotIndex);

        const sports = allActivities
            .filter(a => a.type === 'field' || a.type === 'sport')
            .flatMap(a => {
                const fields = fieldsBySport[a.name] || a.allowedFields || [a.name];
                return fields.map(f => ({
                    field: f,
                    sport: a.name,
                    _activity: a.name
                }));
            });

        const available = sports.filter(pick => {
            const actName = pick._activity;
            const fieldName = fieldLabel(pick.field);

            if (!activityProperties[fieldName]) return false;

            if (!window.SchedulerCoreUtils.canBlockFit(
                block,
                fieldName,
                activityProperties,
                fieldUsageBySlot,
                actName,
                false
            )) return false;

            if (doneToday.has(actName)) return false;

            return true;
        });

        const sorted = sortPicksByFreshness(available, bunkHist, block.divName, activityProperties);
        return sorted[0] || null;
    };

    // ========================================================================
    // SPORTS SLOT — FAIRNESS-BASED SELECTOR
    // ========================================================================
    function findBestSportsSlot(block, allActivities, fieldUsageBySlot, yesterdayHistory,
                                activityProperties, rotationHistory, historicalCounts) {

        const fieldsBySport = window.SchedulerCoreUtils.loadAndFilterData().fieldsBySport || {};

        const currentSlotIndex = block.slots[0];
        const doneToday = getGeneralActivitiesDoneToday(block.bunk, currentSlotIndex);

        const sports = allActivities.filter(a =>
            a.type === 'field' || a.type === 'sport'
        );

        const picks = [];

        sports.forEach(sport => {
            const sportName = sport.name;
            const fields = fieldsBySport[sportName] || sport.allowedFields || [sportName];

            fields.forEach(f => {
                const fieldName = fieldLabel(f);
                picks.push({
                    field: fieldName,
                    sport: sportName,
                    _activity: sportName
                });
            });
        });

        // Score with fairness
        const scored = picks
            .map(pick => {
                const actName = pick._activity;
                const fieldName = pick.field;

                if (!activityProperties[fieldName]) return null;

                if (!window.SchedulerCoreUtils.canBlockFit(
                    block,
                    fieldName,
                    activityProperties,
                    fieldUsageBySlot,
                    actName,
                    false
                )) return null;

                const fairnessScore = calculateFairnessScore(
                    actName,
                    block.bunk,
                    rotationHistory,
                    yesterdayHistory,
                    doneToday
                );

                return { ...pick, _score: fairnessScore };
            })
            .filter(Boolean);

        if (scored.length === 0) return null;

        scored.sort((a, b) => b._score - a._score);
        return scored[0];
    }

    // ========================================================================
    // GENERAL ACTIVITY SELECTOR
    // ========================================================================
    window.findBestGeneralActivity = function (
        block,
        allActivities,
        h2hActivities,
        fieldUsageBySlot,
        yesterdayHistory,
        activityProperties,
        rotationHistory,
        historicalCounts
    ) {
        const currentSlotIndex = block.slots[0];
        const doneToday = getGeneralActivitiesDoneToday(block.bunk, currentSlotIndex);

        // 1) Try SPECIALS FIRST
        const specialPick = window.findBestSpecial(
            block,
            allActivities,
            fieldUsageBySlot,
            yesterdayHistory,
            activityProperties,
            rotationHistory,
            historicalCounts
        );

        if (specialPick) return specialPick;

        // 2) Try SPORTS SLOT (fairness-based)
        const sportSlotPick = findBestSportsSlot(
            block,
            allActivities,
            fieldUsageBySlot,
            yesterdayHistory,
            activityProperties,
            rotationHistory,
            historicalCounts
        );

        if (sportSlotPick) return sportSlotPick;

        // 3) Try specific sport fallback
        const sportPick = window.findBestSportActivity(
            block,
            allActivities,
            fieldUsageBySlot,
            yesterdayHistory,
            activityProperties,
            rotationHistory,
            historicalCounts
        );

        if (sportPick) return sportPick;

        // 4) NOTHING FITS → Free
        return {
            field: "Free",
            sport: null,
            _activity: "Free"
        };
    };

})();
