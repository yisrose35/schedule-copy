// ============================================================================
// scheduler_logic_fillers.js
//
// Updated for Continuous Timeline + Total Solver Architecture
//
// FIXED:
// ✔ Correct _activity naming rules for sport/special/general
// ✔ Division Firewall (even if sharable)
// ✔ Correct canBlockFit 5-argument signature
// ✔ Full allowedDivisions + availability filtering
// ✔ Correct daily-done tracking (ignores transitions)
// ✔ Correct usage-limit logic (historical + today)
// ✔ Prevents duplicate specials or GA in same block
// ✔ Correct preferred-field scoring
// ✔ Integrates solver-ready pick sorting
// ============================================================================

(function() {
'use strict';

const TRANSITION_TYPE = window.TRANSITION_TYPE || "Transition/Buffer";

/* --------------------------------------------------------------------------
   FIELD LABEL WRAPPER
-------------------------------------------------------------------------- */
function fieldLabel(f) { 
    return window.SchedulerCoreUtils
        ? window.SchedulerCoreUtils.fieldLabel(f)
        : (typeof f === "string" ? f : (f?.name || ""));
}

/* --------------------------------------------------------------------------
   PREFERENCE SCORING
-------------------------------------------------------------------------- */
function calculatePreferenceScore(fieldProps, divName) {
    if (!fieldProps?.preferences?.enabled) return 0;
    const list = fieldProps.preferences.list || [];
    const idx = list.indexOf(divName);
    if (idx === -1) return -50;           // excluded or disfavored
    return 1000 - idx * 100;             // strong ranking bias
}

/* --------------------------------------------------------------------------
   SORT BY FRESHNESS + PREFERENCES
   (Used across all fillers)
-------------------------------------------------------------------------- */
function sortPicksByFreshness(picks, bunkHistory, divName, activityProps) {
    return picks.sort((a, b) => {
        const fA = activityProps[fieldLabel(a.field)];
        const fB = activityProps[fieldLabel(b.field)];

        const prefA = calculatePreferenceScore(fA, divName);
        const prefB = calculatePreferenceScore(fB, divName);

        if (prefA !== prefB) return prefB - prefA;

        const lastA = bunkHistory[a._activity] || 0;
        const lastB = bunkHistory[b._activity] || 0;

        if (lastA !== lastB) return lastA - lastB;

        return 0.5 - Math.random();
    });
}

/* --------------------------------------------------------------------------
   GET ACTIVITIES DONE TODAY (ignores transitions)
-------------------------------------------------------------------------- */
function getGeneralActivitiesDoneToday(bunkName) {
    const out = new Set();
    const sched = window.scheduleAssignments?.[bunkName] || {};

    Object.values(sched).forEach(entry => {
        if (!entry) return;
        if (entry.field === TRANSITION_TYPE) return;
        if (!entry._activity) return;
        if (entry._h2h) return;
        out.add(entry._activity);
    });
    return out;
}

/* --------------------------------------------------------------------------
   USAGE LIMIT CHECK
-------------------------------------------------------------------------- */
function isOverUsageLimit(activityName, bunk, activityProps, historicalCounts, doneToday) {
    const props = activityProps[activityName];
    const max = props?.maxUsage || 0;

    if (max === 0) return false;

    const hist = (historicalCounts?.[bunk]?.[activityName]) || 0;

    if (hist >= max) return true;

    if (doneToday.has(activityName) && hist + 1 > max) return true;

    return false;
}

/* ==========================================================================
   DIVISION FIREWALL CHECK
   (Enforces Option B — No overlapping fields across divisions)
========================================================================== */
function violatesDivisionFirewall(block, fieldName, startMin, endMin) {
    const log = window.fieldReservationLog?.[fieldName] || [];
    for (const r of log) {
        const overlap = (startMin < r.endMin && endMin > r.startMin);
        if (overlap && r.divName !== block.divName) return true;
    }
    return false;
}

/* ==========================================================================
   CORE CANDIDATE VALIDATOR
   (Used consistently by all three fillers)
========================================================================== */
function isValidPick(block, pick, activityName, activityProps, historicalCounts, doneToday) {
    const fieldName = fieldLabel(pick.field);
    const prop = activityProps[fieldName];

    if (!prop) return false;

    const startMin = block.startTime;
    const endMin   = block.endTime;

    // 1. Allowed divisions
    if (prop.allowedDivisions?.length > 0) {
        if (!prop.allowedDivisions.includes(block.divName)) return false;
    }

    // 2. Daily availability rules
    if (!window.SchedulerCoreUtils.isTimeAvailableMinuteAccurate(startMin, endMin, prop)) {
        return false;
    }

    // 3. Division firewall
    if (violatesDivisionFirewall(block, fieldName, startMin, endMin)) {
        return false;
    }

    // 4. Max-usage rules
    if (isOverUsageLimit(activityName, block.bunk, activityProps, historicalCounts, doneToday)) {
        return false;
    }

    // 5. Already done today
    if (doneToday.has(activityName)) return false;

    // 6. Final timeline/capacity check
    const ok = window.SchedulerCoreUtils.canBlockFit(
        block,
        fieldName,
        activityProps,
        activityName,
        true                         // <-- critical missing param
    );
    if (!ok) return false;

    return true;
}

/* ==========================================================================
   SPECIALS PICKER
========================================================================== */
window.findBestSpecial = function(block, allActivities, yesterdayHistory, activityProps, rotationHistory, divisions, historicalCounts) {
    const specials = allActivities
        .filter(a => a.type === "special")
        .map(a => ({
            field: a.field,
            sport: null,
            _activity: fieldLabel(a.field)
        }));

    const bunkHistory = rotationHistory?.bunks?.[block.bunk] || {};
    const doneToday   = getGeneralActivitiesDoneToday(block.bunk);

    const valid = specials.filter(pick =>
        isValidPick(block, pick, pick._activity, activityProps, historicalCounts, doneToday)
    );

    const sorted = sortPicksByFreshness(valid, bunkHistory, block.divName, activityProps);
    return sorted[0] || null;
};

/* ==========================================================================
   SPORTS PICKER
========================================================================== */
window.findBestSportActivity = function(block, allActivities, yesterdayHistory, activityProps, rotationHistory, divisions, historicalCounts) {
    const sports = allActivities
        .filter(a => a.type === "field" && a.sport)
        .map(a => ({
            field: a.field,
            sport: a.sport,
            _activity: fieldLabel(a.field)    // important: field, NOT sport
        }));

    const bunkHistory = rotationHistory?.bunks?.[block.bunk] || {};
    const doneToday   = getGeneralActivitiesDoneToday(block.bunk);

    const valid = sports.filter(pick =>
        isValidPick(block, pick, pick._activity, activityProps, historicalCounts, doneToday)
    );

    const sorted = sortPicksByFreshness(valid, bunkHistory, block.divName, activityProps);
    return sorted[0] || null;
};

/* ==========================================================================
   GENERAL ACTIVITY PICKER
========================================================================== */
window.findBestGeneralActivity = function(block, allActivities, h2hActivities, yesterdayHistory, activityProps, rotationHistory, divisions, historicalCounts) {
    const candidates = allActivities.map(a => ({
        field: a.field,
        sport: a.sport,
        _activity: fieldLabel(a.field)
    }));

    const bunkHistory = rotationHistory?.bunks?.[block.bunk] || {};
    const doneToday   = getGeneralActivitiesDoneToday(block.bunk);

    const valid = candidates.filter(pick =>
        isValidPick(block, pick, pick._activity, activityProps, historicalCounts, doneToday)
    );

    const sorted = sortPicksByFreshness(valid, bunkHistory, block.divName, activityProps);
    return sorted[0] || { field: "Free", sport: null, _activity: "Free" };
};

})();
