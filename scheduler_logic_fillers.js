// =================================================================
// scheduler_logic_fillers.js
//
// UPDATED (Human-Level Intelligence):
// - Implements a "Weighted Scoring Engine" to mimic human decision making.
// - Factors: Efficiency (Joining), Boredom (No back-to-back), 
//   Fairness (Weekly counts), and Scarcity (Hard-to-get fields).
// =================================================================

(function() {
'use strict';

// =================================================================
// HELPERS
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

// --- NEW: Peek at the PREVIOUS slot to prevent boredom ---
function getPreviousActivity(bunk, currentSlots) {
    if (!window.scheduleAssignments || !window.scheduleAssignments[bunk]) return null;
    
    // Find the slot immediately preceding this block
    const firstSlot = Math.min(...currentSlots);
    if (firstSlot <= 0) return null; // Start of day

    const prevSlotIdx = firstSlot - 1;
    const prevEntry = window.scheduleAssignments[bunk][prevSlotIdx];
    
    // If it was a continuation, trace back to the source (optional, but usually prevEntry._activity is enough)
    if (prevEntry && prevEntry._activity) {
        return prevEntry._activity;
    }
    return null;
}

// --- NEW: Calculate Field Scarcity ---
// A human prioritizes "Art Room" (1 room) over "Soccer" (5 fields).
function getScarcityScore(activityName, activityProperties) {
    // Simple heuristic: If it's a "Special" (usually unique), boost it.
    // If it's a field with many sub-sports, lower priority.
    const props = activityProperties[activityName];
    if (!props) return 0;
    
    // If it is NOT sharable, it's scarcer (harder to fit later)
    if (!props.sharable) return 100;

    return 0; 
}

// --- NEW: Opportunity Sniping (Bin Packing) ---
function findJoinableOpportunities(block, activityProperties) {
    if (!window.GlobalAvailabilityManager || !window.GlobalAvailabilityManager.getReservationsForField) return [];
    if (!window.allSchedulableNames) return [];

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
// THE HUMAN BRAIN (Scoring Engine)
// =================================================================

function calculateHumanScore(pick, block, bunkHistory, divName, activityProperties, historicalCounts) {
    let score = 0;
    const activityName = pick._activity;
    const props = activityProperties[fieldLabel(pick.field)];

    // 1. EFFICIENCY (Bin Packing) - "Top off the bucket"
    // Huge bonus because this creates space for others.
    if (pick._isJoinOpportunity) {
        score += 50000;
    }

    // 2. PREFERENCES (Explicit Rules)
    if (props?.preferences?.enabled) {
        const index = (props.preferences.list || []).indexOf(divName);
        if (index !== -1) {
            score += (1000 - (index * 100)); // Prioritize top preferences
        } else if (props.preferences.exclusive) {
            score -= 10000; // Should have been filtered out, but safety net
        } else {
            score -= 50; // Not on pref list, low priority
        }
    }

    // 3. BOREDOM PREVENTION (No Back-to-Back)
    // A human says: "You just did Soccer, do something else."
    const prevActivity = getPreviousActivity(block.bunk, block.slots);
    if (prevActivity && prevActivity === activityName) {
        score -= 10000; // Massive penalty for repetition
    }

    // 4. FAIRNESS (Weekly Fatigue)
    // A human says: "You've done this 5 times this week, stop hogging it."
    const weeklyCount = (historicalCounts?.[block.bunk]?.[activityName] || 0);
    score -= (weeklyCount * 500); // Penalty increases with usage

    // 5. FRESHNESS (Rotation)
    // A human says: "You haven't done this in a while."
    const lastTimePlayed = bunkHistory[activityName] || 0;
    // We want smaller 'lastTimePlayed' (long ago) to yield HIGHER score? 
    // Actually, we want (Now - LastTime). The larger the gap, the better.
    // Since 'lastTimePlayed' is a timestamp, 0 means never played.
    if (lastTimePlayed === 0) {
        score += 2000; // Never played? High priority!
    } else {
        // Add small random noise to prevent rigid patterns
        score += Math.random() * 10; 
    }

    // 6. SCARCITY (Opportunity Cost)
    // A human says: "Grab the Art Room while it's free!"
    score += getScarcityScore(fieldLabel(pick.field), activityProperties);

    return score;
}

function sortPicksByHumanLogic(possiblePicks, block, bunkHistory, divName, activityProperties, historicalCounts) {
    // Pre-calculate scores for performance
    const scoredPicks = possiblePicks.map(pick => {
        return {
            pick,
            score: calculateHumanScore(pick, block, bunkHistory, divName, activityProperties, historicalCounts)
        };
    });

    // Sort descending by score
    scoredPicks.sort((a, b) => b.score - a.score);

    return scoredPicks.map(item => item.pick);
}

// --- Usage Limit Check ---
function isOverUsageLimit(activityName, bunk, activityProperties, historicalCounts, activitiesDoneToday) {
    const props = activityProperties[activityName];
    const max = props?.maxUsage || 0;
    if (max === 0) return false; 
    const safeHistory = historicalCounts || {};
    const pastCount = safeHistory[bunk]?.[activityName] || 0;
    if (pastCount >= max) return true;
    if (activitiesDoneToday.has(activityName) && (pastCount + 1 >= max)) return true;
    return false;
}

// --- Time Check ---
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

// =================================================================
// MAIN FILLER FUNCTIONS
// =================================================================

window.findBestSpecial = function(block, allActivities, fieldUsageBySlot, yesterdayHistory, activityProperties, rotationHistory, divisions, historicalCounts) {
    const specials = allActivities.filter(a => a.type === 'special').map(a => ({ field: a.field, sport: null, _activity: a.field }));
    const bunkHistory = rotationHistory?.bunks?.[block.bunk] || {};
    const activitiesDoneToday = getGeneralActivitiesDoneToday(block.bunk);

    const availablePicks = specials.filter(pick => {
        const name = pick._activity;
        if (!window.findBestGeneralActivity.canBlockFit(block, fieldLabel(pick.field), activityProperties, fieldUsageBySlot, name)) return false;
        if (isOverUsageLimit(name, block.bunk, activityProperties, historicalCounts, activitiesDoneToday)) return false;
        if (activitiesDoneToday.has(name)) return false;
        return true;
    });
    
    // USE HUMAN SORTING
    const sortedPicks = sortPicksByHumanLogic(availablePicks, block, bunkHistory, block.divName, activityProperties, historicalCounts);
    return sortedPicks[0] || null;
};

window.findBestSportActivity = function(block, allActivities, fieldUsageBySlot, yesterdayHistory, activityProperties, rotationHistory, divisions, historicalCounts) {
    const bunkHistory = rotationHistory?.bunks?.[block.bunk] || {};
    const activitiesDoneToday = getGeneralActivitiesDoneToday(block.bunk);

    // 1. OPPORTUNITY SNIPING
    const joinPicks = findJoinableOpportunities(block, activityProperties);
    
    // 2. STANDARD PICKS
    const sports = allActivities.filter(a => a.type === 'field').map(a => ({ field: a.field, sport: a.sport, _activity: a.sport }));
    
    const allPicks = [...joinPicks, ...sports];

    const validPicks = allPicks.filter(pick => 
        window.findBestGeneralActivity.canBlockFit(block, fieldLabel(pick.field), activityProperties, fieldUsageBySlot, pick._activity) &&
        !activitiesDoneToday.has(pick._activity)
    );
    
    // USE HUMAN SORTING
    const sortedPicks = sortPicksByHumanLogic(validPicks, block, bunkHistory, block.divName, activityProperties, historicalCounts);
    return sortedPicks[0] || null;
};

window.findBestGeneralActivity = function(block, allActivities, h2hActivities, fieldUsageBySlot, yesterdayHistory, activityProperties, rotationHistory, divisions, historicalCounts) {
    const bunkHistory = rotationHistory?.bunks?.[block.bunk] || {};
    const activitiesDoneToday = getGeneralActivitiesDoneToday(block.bunk);

    // 1. OPPORTUNITY SNIPING
    const joinPicks = findJoinableOpportunities(block, activityProperties);
    
    // 2. STANDARD SEARCH
    const allPossiblePicks = allActivities.map(a => ({ field: a.field, sport: a.sport, _activity: a.sport || a.field }));
    const allPicks = [...joinPicks, ...allPossiblePicks];

    const validPicks = allPicks.filter(pick => {
        const name = pick._activity;
        if (!window.findBestGeneralActivity.canBlockFit(block, fieldLabel(pick.field), activityProperties, fieldUsageBySlot, name)) return false;
        // Check limits
        if (pick.field && !pick.sport) { 
             if (isOverUsageLimit(name, block.bunk, activityProperties, historicalCounts, activitiesDoneToday)) return false;
        }
        return !activitiesDoneToday.has(name);
    });

    // USE HUMAN SORTING
    const sortedPicks = sortPicksByHumanLogic(validPicks, block, bunkHistory, block.divName, activityProperties, historicalCounts);
    return sortedPicks[0] || { field: "Free", sport: null, _activity: "Free" };
};

// =================================================================
// UPDATED CONFLICT CHECKER (Uses GlobalAvailabilityManager)
// =================================================================
window.findBestGeneralActivity.canBlockFit = function(block, fieldName, activityProperties, fieldUsageBySlot, proposedActivity) {
    const props = activityProperties[fieldName];
    if (!props) return false;

    // 1. Basic Props
    if (props.preferences?.enabled && props.preferences.exclusive && !props.preferences.list.includes(block.divName)) return false;
    if (props.allowedDivisions && props.allowedDivisions.length && !props.allowedDivisions.includes(block.divName)) return false;
    if (props.limitUsage?.enabled) {
        if (!props.limitUsage.divisions[block.divName]) return false;
        const allowedBunks = props.limitUsage.divisions[block.divName];
        if (allowedBunks.length > 0 && block.bunk && !allowedBunks.includes(block.bunk)) return false;
    }

    // 2. INTERVAL AVAILABILITY
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

    // 3. TIME RULES
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

function getGeneralActivitiesDoneToday(bunkName) {
    const activities = new Set();
    const schedule = window.scheduleAssignments[bunkName] || [];
    for (const entry of schedule) {
        if (entry && entry._activity && !entry._h2h) activities.add(entry._activity);
    }
    return activities;
}

})();
