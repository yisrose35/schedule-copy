// =================================================================
// scheduler_logic_fillers.js
//
// UPDATED (AI Heuristic Scoring Engine):
// - Replaces binary filtering with weighted scoring.
// - HARD RULES (Unbreakable): Physics, Done Today.
// - SOFT RULES (Breakable with Penalty): Weekly Limits, Sharing, Boredom.
// - RESULT: The system effectively "thinks" to find the best compromise
//   instead of giving up and assigning "Free".
// =================================================================

(function() {
'use strict';

// =================================================================
// 1. DATA GATHERING HELPERS
// =================================================================

function fieldLabel(f) { return (f && typeof f==='object' && f.name) ? f.name : f; }

function getBlockTimeRange(block) {
    let blockStartMin = typeof block.startTime === 'number' ? block.startTime : null;
    let blockEndMin = typeof block.endTime === 'number' ? block.endTime : null;

    if ((blockStartMin == null || blockEndMin == null) && window.unifiedTimes && Array.isArray(block.slots) && block.slots.length > 0) {
      const minIndex = Math.min(...block.slots);
      const maxIndex = Math.max(...block.slots);
      const firstSlot = window.unifiedTimes[minIndex];
      const lastSlot = window.unifiedTimes[maxIndex];

      if (firstSlot && lastSlot) {
        const firstStart = new Date(firstSlot.start);
        const lastStart = new Date(lastSlot.start);
        blockStartMin = firstStart.getHours() * 60 + firstStart.getMinutes();
        blockEndMin = lastStart.getHours() * 60 + lastStart.getMinutes() + (window.INCREMENT_MINS || 30);
      }
    }
    return { blockStartMin, blockEndMin };
}

// --- Check if field is physically empty ---
function isFieldEmpty(fieldName, blockStartMin, blockEndMin) {
    if (!window.GlobalAvailabilityManager || !window.GlobalAvailabilityManager.getReservationsForField) return true;
    const reservations = window.GlobalAvailabilityManager.getReservationsForField(fieldName);
    const overlaps = reservations.filter(r => r.start < blockEndMin && r.end > blockStartMin);
    return overlaps.length === 0;
}

// --- Find Sharable Fields (Opportunities) ---
function findJoinableOpportunities(block, activityProperties) {
    if (!window.GlobalAvailabilityManager || !window.GlobalAvailabilityManager.getReservationsForField) return [];
    const { blockStartMin, blockEndMin } = getBlockTimeRange(block);
    if (blockStartMin == null || blockEndMin == null) return [];

    const joinablePicks = [];
    window.allSchedulableNames.forEach(fieldName => {
        const props = activityProperties[fieldName];
        if (!props || !props.sharable) return; 
        if (props.allowedDivisions && !props.allowedDivisions.includes(block.divName)) return;

        const reservations = window.GlobalAvailabilityManager.getReservationsForField(fieldName);
        const overlaps = reservations.filter(r => r.start < blockEndMin && r.end > blockStartMin);

        // Found a half-full bucket?
        if (overlaps.length === 1) {
            const match = overlaps[0];
            if (match.div === block.divName && !match.isLeague) {
                joinablePicks.push({
                    field: fieldName,
                    sport: match.activity,
                    _activity: match.activity,
                    _isJoinOpportunity: true
                });
            }
        }
    });
    return joinablePicks;
}

// =================================================================
// 2. THE AI BRAIN (SCORING ENGINE)
// =================================================================

/**
 * Calculates a "Happiness Score" for a potential move.
 * Higher is better. Negative is bad, but acceptable if no positive options exist.
 */
function calculateAIScore(pick, block, bunkHistory, divName, activityProperties, historicalCounts) {
    let score = 1000; // Start with a high base score (Optimism)
    const fieldName = fieldLabel(pick.field);
    const activityName = pick._activity;
    const props = activityProperties[fieldName];
    const { blockStartMin, blockEndMin } = getBlockTimeRange(block);

    // --- FACTOR 1: EMPTINESS vs SHARING ---
    // User preference: "Doubling WHEN NEEDED".
    // Strategy: Reward Empty, Penalize Sharing slightly.
    if (isFieldEmpty(fieldName, blockStartMin, blockEndMin)) {
        score += 500; // BIG BONUS for empty field
    } else {
        score -= 200; // Penalty for having to share (Survival mode)
    }

    // --- FACTOR 2: WEEKLY LIMITS (The "Smart" Compromise) ---
    // We hate breaking limits, but we hate "Free" more.
    const max = props?.maxUsage || 0;
    if (max > 0) {
        const safeHistory = historicalCounts || {};
        const pastCount = safeHistory[block.bunk]?.[activityName] || 0;
        if (pastCount >= max) {
            // WE ARE BREAKING THE RULE.
            // Massive penalty, pushing this option to the bottom of the list.
            // But it remains on the list (unlike filtering).
            score -= 5000; 
        }
    }

    // --- FACTOR 3: PREFERENCES ---
    if (props?.preferences?.enabled) {
        const index = (props.preferences.list || []).indexOf(divName);
        if (index !== -1) {
            score += (1000 - (index * 100)); // Highly desired
        } else {
            score -= 50; // Neutral/Meh
        }
    }

    // --- FACTOR 4: HISTORY (Freshness) ---
    // Look at the rotation history. The longer ago we played this, the better.
    const lastPlayedTime = bunkHistory[activityName] || 0;
    if (lastPlayedTime === 0) {
        score += 300; // Never played? Great!
    } else {
        // Add a small bonus for every hour since last played to encourage rotation
        // This acts as a tie-breaker between two valid fields
        const hoursSince = (Date.now() - lastPlayedTime) / 3600000; 
        score += Math.min(hoursSince, 100); 
    }

    // --- FACTOR 5: RANDOM NOISE ---
    // Prevents robotic patterns (Always picking Field A before Field B)
    score += Math.random() * 10;

    return score;
}

// =================================================================
// 3. MAIN LOGIC
// =================================================================

window.findBestSpecial = function(block, allActivities, fieldUsageBySlot, yesterdayHistory, activityProperties, rotationHistory, divisions, historicalCounts) {
    return window.findBestGeneralActivity(block, allActivities, [], fieldUsageBySlot, yesterdayHistory, activityProperties, rotationHistory, divisions, historicalCounts);
};

window.findBestSportActivity = function(block, allActivities, fieldUsageBySlot, yesterdayHistory, activityProperties, rotationHistory, divisions, historicalCounts) {
    const pick = window.findBestGeneralActivity(block, allActivities, [], fieldUsageBySlot, yesterdayHistory, activityProperties, rotationHistory, divisions, historicalCounts);
    if (pick._activity === "Free") return null;
    return pick;
};

window.findBestGeneralActivity = function(block, allActivities, h2hActivities, fieldUsageBySlot, yesterdayHistory, activityProperties, rotationHistory, divisions, historicalCounts) {
    const bunkHistory = rotationHistory?.bunks?.[block.bunk] || {};
    const activitiesDoneToday = getGeneralActivitiesDoneToday(block.bunk);

    // 1. Gather Candidates (Standard + Join Opportunities)
    const joinPicks = findJoinableOpportunities(block, activityProperties);
    const standardPicks = allActivities.map(a => ({ field: a.field, sport: a.sport, _activity: a.sport || a.field }));
    const allCandidates = [...standardPicks, ...joinPicks];

    // 2. HARD FILTERING (The Laws of Physics & Daily Constraints)
    // We absolutely remove options that are impossible.
    const possibleMoves = allCandidates.filter(pick => {
        const name = pick._activity;

        // A. HARD RULE: Done Today?
        // User requested this is unbreakable.
        if (activitiesDoneToday.has(name)) return false;

        // B. HARD RULE: Physical Availability (Core Check)
        // Note: For joinPicks, this returns true if we match the existing reservation
        if (!window.findBestGeneralActivity.canBlockFit(block, fieldLabel(pick.field), activityProperties, fieldUsageBySlot, name)) return false;

        return true;
    });

    // 3. SCORING (The "Thinking" Phase)
    // Map every valid move to a score
    const scoredMoves = possibleMoves.map(pick => {
        return {
            pick: pick,
            score: calculateAIScore(pick, block, bunkHistory, block.divName, activityProperties, historicalCounts)
        };
    });

    // 4. SORTING
    // Sort by Score Descending (Highest score wins)
    scoredMoves.sort((a, b) => b.score - a.score);

    // 5. SELECTION
    if (scoredMoves.length > 0) {
        // Even if the top score is negative (e.g., -4000 due to breaking weekly limit),
        // we take it because it beat -Infinity (Free).
        return scoredMoves[0].pick;
    }

    // 6. FAILURE (Free)
    return { field: "Free", sport: null, _activity: "Free" };
};

// =================================================================
// 4. CONFLICT CHECKER
// =================================================================
window.findBestGeneralActivity.canBlockFit = function(block, fieldName, activityProperties, fieldUsageBySlot, proposedActivity) {
    const props = activityProperties[fieldName];
    if (!props) return false;

    // Basic Prop Checks (Unbreakable)
    if (props.preferences?.enabled && props.preferences.exclusive && !props.preferences.list.includes(block.divName)) return false;
    if (props.allowedDivisions && props.allowedDivisions.length && !props.allowedDivisions.includes(block.divName)) return false;
    
    // NOTE: We moved Limit Usage checks to the SCORING ENGINE (Soft Rules). 
    // We only check HARD Division restrictions here.
    if (props.limitUsage?.enabled) {
         const allowedBunks = props.limitUsage.divisions[block.divName];
         // If a specific list is provided, and you aren't on it, that's a HARD NO.
         if (allowedBunks && allowedBunks.length > 0 && block.bunk && !allowedBunks.includes(block.bunk)) return false;
    }

    // Interval Check
    const { blockStartMin, blockEndMin } = getBlockTimeRange(block);
    if (blockStartMin == null || blockEndMin == null) return false;

    if (!window.GlobalAvailabilityManager) {
        console.error("GlobalAvailabilityManager not found! Core logic must run first.");
        return false;
    }

    const avail = window.GlobalAvailabilityManager.checkAvailability(fieldName, blockStartMin, blockEndMin, {
        divName: block.divName,
        bunk: block.bunk,
        activity: proposedActivity,
        isLeague: false
    }, props);

    if (!avail.valid) return false;

    // Time Rules (Open/Closed)
    if (props.timeRules && props.timeRules.length > 0) {
        if (!props.available) return false;
        for (const slotIndex of block.slots) {
            if (slotIndex === undefined) return false;
            if (!isTimeAvailable(slotIndex, props)) return false;
        }
    } else {
        if (!props.available) return false;
    }

    return true;
};

// --- Time Helper ---
function isTimeAvailable(slotIndex, fieldProps) {
    if (!window.unifiedTimes || !window.unifiedTimes[slotIndex]) return false;
    const slot = window.unifiedTimes[slotIndex];
    const slotStartMin = new Date(slot.start).getHours() * 60 + new Date(slot.start).getMinutes();
    const slotEndMin = slotStartMin + (window.INCREMENT_MINS || 30);
    const rules = (fieldProps.timeRules || []).map(r => {
        if (typeof r.startMin === "number") return r;
        return r; 
    });
    if (rules.length === 0) return fieldProps.available;
    if (!fieldProps.available) return false;
    const hasAvailableRules = rules.some(r => r.type === 'Available');
    let isAvailable = !hasAvailableRules;
    for (const rule of rules) {
        if (rule.type === 'Available' && rule.startMin != null && rule.endMin != null) {
            if (slotStartMin >= rule.startMin && slotEndMin <= rule.endMin) {
                isAvailable = true; break;
            }
        }
    }
    for (const rule of rules) {
        if (rule.type === 'Unavailable' && rule.startMin != null && rule.endMin != null) {
            if (slotStartMin < rule.endMin && slotEndMin > rule.startMin) {
                isAvailable = false; break;
            }
        }
    }
    return isAvailable;
}

function getGeneralActivitiesDoneToday(bunkName) {
    const activities = new Set();
    const schedule = window.scheduleAssignments[bunkName] || [];
    for (const entry of schedule) {
        if (entry && entry._activity && !entry._h2h) activities.add(entry._activity);
    }
    return activities;
}

})();
