// =================================================================
// scheduler_logic_fillers.js
//
// UPDATED (Interval-Based):
// - findBestGeneralActivity.canBlockFit now uses GlobalAvailabilityManager.
// - Ensures fillers respect the reservations made by the Core logic.
// - Removes redundant slot-counting logic.
// =================================================================

(function() {
'use strict';

// =================================================================
// HELPERS
// =================================================================

function fieldLabel(f) { return (f && typeof f==='object' && f.name) ? f.name : f; }

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
        if (scoreA !== scoreB) return scoreB - scoreA;
        
        const lastA = bunkHistory[a._activity] || 0; 
        const lastB = bunkHistory[b._activity] || 0;
        if (lastA !== lastB) return lastA - lastB; 
        return 0.5 - Math.random();
    });
}

// --- Check Max Usage Limit ---
function isOverUsageLimit(activityName, bunk, activityProperties, historicalCounts, activitiesDoneToday) {
    const props = activityProperties[activityName];
    const max = props?.maxUsage || 0;
    
    // 0 means unlimited
    if (max === 0) return false; 

    const safeHistory = historicalCounts || {};
    const pastCount = safeHistory[bunk]?.[activityName] || 0;
    
    // If they already hit the limit in past days
    if (pastCount >= max) return true;

    // If they are at limit-1, and they already did it today, they can't do it again
    if (activitiesDoneToday.has(activityName) && (pastCount + 1 >= max)) return true;

    return false;
}

// --- Check Time Availability (Is the facility Open/Closed?) ---
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
            // Check if slot fits entirely within Available rule
            if (slotStartMin >= rule.startMin && slotEndMin <= rule.endMin) {
                isAvailable = true;
                break;
            }
        }
    }
    for (const rule of rules) {
        if (rule.type === 'Unavailable' && rule.startMin != null && rule.endMin != null) {
            // Check if slot touches Unavailable rule
            if (slotStartMin < rule.endMin && slotEndMin > rule.startMin) {
                isAvailable = false;
                break;
            }
        }
    }
    return isAvailable;
}

// --- Get Block Time Range (Local version to ensure independence) ---
function getBlockTimeRange(block) {
    let blockStartMin = typeof block.startTime === 'number' ? block.startTime : null;
    let blockEndMin = typeof block.endTime === 'number' ? block.endTime : null;

    // If no explicit time, derive from slots
    if ((blockStartMin == null || blockEndMin == null) && window.unifiedTimes && Array.isArray(block.slots) && block.slots.length > 0) {
      const minIndex = Math.min(...block.slots);
      const maxIndex = Math.max(...block.slots);
      const firstSlot = window.unifiedTimes[minIndex];
      const lastSlot = window.unifiedTimes[maxIndex];

      if (firstSlot && lastSlot) {
        const firstStart = new Date(firstSlot.start);
        const lastStart = new Date(lastSlot.start);
        blockStartMin = firstStart.getHours() * 60 + firstStart.getMinutes();
        // End time is start of last slot + increment
        blockEndMin = lastStart.getHours() * 60 + lastStart.getMinutes() + (window.INCREMENT_MINS || 30);
      }
    }
    return { blockStartMin, blockEndMin };
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
        // 1. Check standard constraints (uses new Manager logic)
        if (!window.findBestGeneralActivity.canBlockFit(block, fieldLabel(pick.field), activityProperties, fieldUsageBySlot, name)) return false;
        
        // 2. Check Max Usage Limit
        if (isOverUsageLimit(name, block.bunk, activityProperties, historicalCounts, activitiesDoneToday)) return false;

        // 3. Check if done today
        if (activitiesDoneToday.has(name)) return false;

        return true;
    });
    
    const sortedPicks = sortPicksByFreshness(availablePicks, bunkHistory, block.divName, activityProperties);
    return sortedPicks[0] || null;
};

window.findBestSportActivity = function(block, allActivities, fieldUsageBySlot, yesterdayHistory, activityProperties, rotationHistory, divisions, historicalCounts) {
    const sports = allActivities.filter(a => a.type === 'field').map(a => ({ field: a.field, sport: a.sport, _activity: a.sport }));
    const bunkHistory = rotationHistory?.bunks?.[block.bunk] || {};
    const activitiesDoneToday = getGeneralActivitiesDoneToday(block.bunk);

    const availablePicks = sports.filter(pick => 
        window.findBestGeneralActivity.canBlockFit(block, fieldLabel(pick.field), activityProperties, fieldUsageBySlot, pick._activity) &&
        !activitiesDoneToday.has(pick._activity)
    );
    
    const sortedPicks = sortPicksByFreshness(availablePicks, bunkHistory, block.divName, activityProperties);
    return sortedPicks[0] || null;
};

window.findBestGeneralActivity = function(block, allActivities, h2hActivities, fieldUsageBySlot, yesterdayHistory, activityProperties, rotationHistory, divisions, historicalCounts) {
    const allPossiblePicks = allActivities.map(a => ({ field: a.field, sport: a.sport, _activity: a.sport || a.field }));
    const bunkHistory = rotationHistory?.bunks?.[block.bunk] || {};
    const activitiesDoneToday = getGeneralActivitiesDoneToday(block.bunk);

    const availablePicks = allPossiblePicks.filter(pick => {
        const name = pick._activity;
        // Use the centralized canBlockFit
        if (!window.findBestGeneralActivity.canBlockFit(block, fieldLabel(pick.field), activityProperties, fieldUsageBySlot, name)) return false;
        
        // Check limits for specials here too if general picks a special
        if (pick.field && !pick.sport) { 
             if (isOverUsageLimit(name, block.bunk, activityProperties, historicalCounts, activitiesDoneToday)) return false;
        }

        return !activitiesDoneToday.has(name);
    });

    const sortedPicks = sortPicksByFreshness(availablePicks, bunkHistory, block.divName, activityProperties);
    return sortedPicks[0] || { field: "Free", sport: null, _activity: "Free" };
};

// =================================================================
// UPDATED CONFLICT CHECKER (Uses GlobalAvailabilityManager)
// =================================================================
window.findBestGeneralActivity.canBlockFit = function(block, fieldName, activityProperties, fieldUsageBySlot, proposedActivity) {
    const props = activityProperties[fieldName];
    if (!props) return false;

    // 1. Check Preferences/Exclusivity
    if (props.preferences?.enabled && props.preferences.exclusive && !props.preferences.list.includes(block.divName)) return false;
    if (props.allowedDivisions && props.allowedDivisions.length && !props.allowedDivisions.includes(block.divName)) return false;
    
    if (props.limitUsage?.enabled) {
        if (!props.limitUsage.divisions[block.divName]) return false;
        const allowedBunks = props.limitUsage.divisions[block.divName];
        if (allowedBunks.length > 0 && block.bunk && !allowedBunks.includes(block.bunk)) return false;
    }

    // 2. CHECK INTERVAL AVAILABILITY (The new Logic)
    // We delegate to the Core's GlobalAvailabilityManager to ensure we respect pinned events and leagues
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

    // 3. CHECK TIME RULES (Open/Closed)
    // We still check slots to ensure the facility isn't closed for Lunch/etc during this specific block
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
