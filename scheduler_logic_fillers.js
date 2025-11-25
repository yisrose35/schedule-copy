// ============================================================================
// scheduler_logic_fillers.js
//
// CLASSIC (GOOD) FILLER — CORE-COMPATIBLE
// Restored to behave EXACTLY like your working version.
// Uses NO custom physics. Defers everything to CORE.
// ============================================================================

(function(){
'use strict';

// ============================================================================
// Helpers
// ============================================================================

function fieldLabel(f) {
    return (f && typeof f === "object" && f.name) ? f.name : f;
}

// ============================================================================
// Base evaluator (Core decides physics; filler only evaluates preference)
// ============================================================================

function tryAssign(block, candidate, activityProperties, rotationHistory, historicalCounts) {
    const fieldName = fieldLabel(candidate.field);
    const act = candidate._activity;

    // Reject if Core says no
    if (!window.findBestGeneralActivity_coreFit(block, fieldName, act)) {
        return null;
    }

    // Basic cooldown scoring: prefer NEW activities
    const bunkHistory = rotationHistory?.bunks?.[block.bunk] || {};
    const lastPlayed = bunkHistory[act] || 0;

    // simple scoring: new > old
    const freshness = lastPlayed === 0 ? 100 : ((Date.now() - lastPlayed) / 3600000);

    return { pick: candidate, score: freshness };
}

// This function will be used to call CORE physics (no override!)
window.findBestGeneralActivity_coreFit = function(block, fieldName, activityName) {
    if (!fieldName) return true; // Free, No Field etc.
    if (!window.allSchedulableNames.includes(fieldName)) return true;

    const props = window.activityProperties[fieldName];
    if (!props) return false;

    // Ask the Core if it fits
    const ok = window.GlobalAvailabilityManager.checkAvailability(
        fieldName,
        block.startTime,
        block.endTime,
        {
            divName: block.divName,
            bunk: block.bunk,
            activity: activityName,
            isLeague: false
        },
        props
    );

    if (!ok.valid) return false;

    // Time rules by core
    if (props.timeRules?.length > 0) {
        for (const slot of block.slots || []) {
            const slotObj = window.unifiedTimes[slot];
            if (!slotObj) return false;
            const start = new Date(slotObj.start).getHours()*60 + new Date(slotObj.start).getMinutes();
            const end = start + window.INCREMENT_MINS;

            let allowed = false;
            let hasAvail = props.timeRules.some(r => r.type === "Available");
            let isAvail = !hasAvail;

            for (const r of props.timeRules) {
                if (r.type === "Available") {
                    if (start >= r.startMin && end <= r.endMin) { isAvail = true; break; }
                }
            }
            for (const r of props.timeRules) {
                if (r.type === "Unavailable") {
                    if (start < r.endMin && end > r.startMin) { isAvail = false; break; }
                }
            }

            if (!isAvail) return false;
        }
    }

    return true;
};

// ============================================================================
// Filler core logic
// ============================================================================

function runFiller(block, candidates, activityProperties, rotationHistory, historicalCounts) {
    const bunkHistory = rotationHistory?.bunks?.[block.bunk] || {};
    const usedToday = new Set();

    // Build “today’s used” list
    const todaySched = window.scheduleAssignments[block.bunk] || [];
    todaySched.forEach(e => {
        if (e && e._activity && !e._h2h) usedToday.add(e._activity);
    });

    let best = null;

    for (const c of candidates) {
        const pick = {
            field: c.field,
            sport: c.sport,
            _activity: c.sport || c.field
        };

        // Reject if used already today
        if (usedToday.has(pick._activity)) continue;

        const evalResult = tryAssign(block, pick, activityProperties, rotationHistory, historicalCounts);
        if (!evalResult) continue;

        if (!best || evalResult.score > best.score) {
            best = evalResult;
        }
    }

    return best ? best.pick : { field: "Free", sport: null, _activity: "Free" };
}

// ============================================================================
// Public wrappers — EXACT OLD SIGNATURES
// ============================================================================

window.findBestSpecial = function(block, allActivities, fieldUsageBySlot, yesterdayHistory, activityProperties, rotationHistory, divisions, historicalCounts) {
    const candidates = allActivities.filter(a => a.type === "special");
    return runFiller(block, candidates, activityProperties, rotationHistory, historicalCounts);
};

window.findBestSportActivity = function(block, allActivities, fieldUsageBySlot, yesterdayHistory, activityProperties, rotationHistory, divisions, historicalCounts) {
    const candidates = allActivities.filter(a => a.type === "field");
    return runFiller(block, candidates, activityProperties, rotationHistory, historicalCounts);
};

window.findBestGeneralActivity = function(block, allActivities, h2hActivities, fieldUsageBySlot, yesterdayHistory, activityProperties, rotationHistory, divisions, historicalCounts) {
    return runFiller(block, allActivities, activityProperties, rotationHistory, historicalCounts);
};

})();
