// =================================================================
// scheduler_logic_fillers.js
//
// HYBRID FILLER VERSION:
// - Architecture: IIFE (Isolated Scope)
// - Logic: Unified "Check Everything" Loop (Robustness)
// - Brain: AI Heuristic Scoring (Intelligence)
// - Physics: Relies on Core's GlobalAvailabilityManager
// =================================================================

(function() {
'use strict';

// =================================================================
// 1. HELPERS
// =================================================================
function fieldLabel(f) { return (f && typeof f==='object' && f.name) ? f.name : f; }

function getGeneralActivitiesDoneToday(bunkName) {
    const activities = new Set();
    const schedule = window.scheduleAssignments[bunkName] || [];
    for (const entry of schedule) {
        if (entry && entry._activity && !entry._h2h) activities.add(entry._activity);
    }
    return activities;
}

function isTimeAvailable(block, fieldProps) {
    const rules = fieldProps.timeRules || [];
    if (rules.length === 0) return fieldProps.available;
    if (!fieldProps.available) return false;

    const s = block.startTime;
    const e = block.endTime;

    // If any "Available" rule exists, default is closed unless inside one.
    const hasAvailableRules = rules.some(r => r.type === 'Available');
    let isAvailable = !hasAvailableRules;

    for (const rule of rules) {
        if (rule.type === 'Available') {
            if (s >= rule.startMin && e <= rule.endMin) { isAvailable = true; break; }
        }
    }
    for (const rule of rules) {
        if (rule.type === 'Unavailable') {
            if (s < rule.endMin && e > rule.startMin) { isAvailable = false; break; }
        }
    }
    return isAvailable;
}

// =================================================================
// 2. AI SCORING ENGINE
// =================================================================
function calculateAIScore(pick, block, bunkHistory, divName, activityProperties, historicalCounts) {
    let score = 1000; // Optimistic baseline
    const fieldName = fieldLabel(pick.field);
    const activityName = pick._activity;
    const props = activityProperties[fieldName];

    // A. SHARING / BIN PACKING (The "Smart" Logic)
    // Check Core's GlobalAvailabilityManager to see if we are joining a half-full bucket
    if (window.GlobalAvailabilityManager) {
        const reservations = window.GlobalAvailabilityManager.getReservationsForField(fieldName);
        // Overlap check
        const isShared = reservations.some(r => r.start < block.endTime && r.end > block.startTime);
        if (isShared) {
            score -= 200; // Penalty: We prefer empty fields...
        } else {
            score += 200; // Bonus: Pure empty field is better
        }
        // NOTE: While we penalize sharing slightly, the system naturally prefers it over "Free" (-Infinity).
        // If you want to FORCE sharing (Cluster packing), flip these: +200 for shared, -200 for empty.
    }

    // B. MAX USAGE LIMITS (Soft Rule)
    const max = props?.maxUsage || 0;
    if (max > 0) {
        const pastCount = (historicalCounts?.[block.bunk]?.[activityName] || 0);
        if (pastCount >= max) {
            score -= 5000; // Massive penalty. We only do this if the alternative is literally nothing.
        }
    }

    // C. PREFERENCES
    if (props?.preferences?.enabled) {
        const index = (props.preferences.list || []).indexOf(divName);
        if (index !== -1) {
            score += (1000 - (index * 100)); // High score for top preferences
        } else if (props.preferences.exclusive) {
            score -= 10000; // Should be caught by validity check, but just in case
        } else {
            score -= 50; // Slight penalty for non-preferred but allowed fields
        }
    }

    // D. FRESHNESS (Boredom Factor)
    const lastPlayed = bunkHistory[activityName] || 0;
    if (lastPlayed === 0) {
        score += 300; // Novelty bonus
    } else {
        // Recover 1 point of score for every hour since last played
        const hoursSince = (Date.now() - lastPlayed) / 3600000;
        score += Math.min(hoursSince, 100); 
    }

    // E. NOISE (Anti-Robot)
    // Prevents alphabetical sorting bias
    score += Math.random() * 10; 

    return score;
}

// =================================================================
// 3. MAIN FILLER LOGIC (The "Iterate Everything" Strategy)
// =================================================================

function runFiller(block, candidates, activityProperties, rotationHistory, historicalCounts) {
    const bunkHistory = rotationHistory?.bunks?.[block.bunk] || {};
    const activitiesDoneToday = getGeneralActivitiesDoneToday(block.bunk);

    // 1. Flatten candidates to a simple list
    const flatCandidates = candidates.map(a => ({
        field: a.field,
        sport: a.sport,
        _activity: a.sport || a.field
    }));

    const scoredMoves = [];

    // 2. Loop through EVERY option
    for (const pick of flatCandidates) {
        const name = pick._activity;

        // HARD RULE 1: Variety (Don't do the same thing twice today)
        if (activitiesDoneToday.has(name)) continue;

        // HARD RULE 2: Physics (Can it fit?)
        if (!window.findBestGeneralActivity.canBlockFit(block, fieldLabel(pick.field), activityProperties, null, name)) {
            continue;
        }

        // If it passes hard rules, calculate how "Happy" this move makes us
        const s = calculateAIScore(pick, block, bunkHistory, block.divName, activityProperties, historicalCounts);
        scoredMoves.push({ pick, score: s });
    }

    // 3. Sort by Happiness
    scoredMoves.sort((a, b) => b.score - a.score);

    // 4. Return the best one, or Free
    if (scoredMoves.length > 0) {
        return scoredMoves[0].pick;
    }
    
    return { field: "Free", sport: null, _activity: "Free" };
}

// Wrappers for specific slot types
window.findBestSpecial = function(block, allActivities, fieldUsageBySlot, yesterdayHistory, activityProperties, rotationHistory, divisions, historicalCounts) {
    const specials = allActivities.filter(a => a.type === 'special');
    return runFiller(block, specials, activityProperties, rotationHistory, historicalCounts);
};

window.findBestSportActivity = function(block, allActivities, fieldUsageBySlot, yesterdayHistory, activityProperties, rotationHistory, divisions, historicalCounts) {
    const sports = allActivities.filter(a => a.type === 'field');
    return runFiller(block, sports, activityProperties, rotationHistory, historicalCounts);
};

window.findBestGeneralActivity = function(block, allActivities, h2hActivities, fieldUsageBySlot, yesterdayHistory, activityProperties, rotationHistory, divisions, historicalCounts) {
    return runFiller(block, allActivities, activityProperties, rotationHistory, historicalCounts);
};

// =================================================================
// 4. VALIDITY CHECKER (Connecting to Core)
// =================================================================
window.findBestGeneralActivity.canBlockFit = function(block, fieldName, activityProperties, fieldUsageBySlot, proposedActivity) {
    const props = activityProperties[fieldName];
    if (!props) return false;

    // 1. Preference Exclusivity (Hard Rule)
    if (props.preferences?.enabled && props.preferences.exclusive && !props.preferences.list.includes(block.divName)) return false;
    
    // 2. Allowed Divisions (Hard Rule)
    if (props.allowedDivisions && props.allowedDivisions.length && !props.allowedDivisions.includes(block.divName)) return false;

    // 3. Hard Division Limits (Allowed Bunks List)
    if (props.limitUsage?.enabled) {
        const allowedBunks = props.limitUsage.divisions[block.divName];
        if (allowedBunks && allowedBunks.length > 0 && block.bunk && !allowedBunks.includes(block.bunk)) return false;
    }

    // 4. GLOBAL AVAILABILITY MANAGER CHECK (The Core Connection)
    if (!window.GlobalAvailabilityManager) {
        console.warn("GlobalAvailabilityManager missing. Core must run before Fillers.");
        return false;
    }

    // Ask the Core if this fits physics constraints
    const check = window.GlobalAvailabilityManager.checkAvailability(fieldName, block.startTime, block.endTime, {
        divName: block.divName,
        bunk: block.bunk,
        activity: proposedActivity,
        isLeague: false
    }, props);

    if (!check.valid) return false;

    // 5. Time Rules
    return isTimeAvailable(block, props);
};

})();
