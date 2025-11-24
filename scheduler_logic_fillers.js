// =================================================================
// scheduler_logic_fillers.js
//
// UPDATED (Smart Join / Opportunity Sniping):
// - Aggressively scans for half-full fields to join before picking empty ones.
// - Forces activity alignment (e.g., if Bunk A is playing Soccer, Bunk B
//   will adopt Soccer to share the field).
// - Drastically reduces "Free" slots by maximizing density.
// =================================================================

(function() {
'use strict';

// =================================================================
// HELPERS
// =================================================================

function fieldLabel(f) { return (f && typeof f==='object' && f.name) ? f.name : f; }

// --- NEW: Opportunity Sniping ---
// Scans active reservations to find a perfect "Joinable" slot.
// Returns a list of picks that match exactly what is already happening on a field.
function findJoinableOpportunities(block, activityProperties) {
    if (!window.GlobalAvailabilityManager || !window.GlobalAvailabilityManager.getReservationsForField) return [];
    if (!window.allSchedulableNames) return [];

    const { blockStartMin, blockEndMin } = getBlockTimeRange(block);
    if (blockStartMin == null || blockEndMin == null) return [];

    const joinablePicks = [];

    window.allSchedulableNames.forEach(fieldName => {
        const props = activityProperties[fieldName];
        if (!props || !props.sharable) return; // Cannot join if not sharable

        // Strict Division Check (if enabled in props)
        if (props.allowedDivisions && !props.allowedDivisions.includes(block.divName)) return;

        // Get what's happening NOW
        const reservations = window.GlobalAvailabilityManager.getReservationsForField(fieldName);
        const overlaps = reservations.filter(r => r.start < blockEndMin && r.end > blockStartMin);

        // We are looking for fields with EXACTLY 1 bunk (Capacity is usually 2)
        if (overlaps.length === 1) {
            const match = overlaps[0];

            // 1. Must be SAME Division
            if (match.div !== block.divName) return;

            // 2. Must NOT be a League (Leagues are exclusive)
            if (match.isLeague) return;

            // 3. Create a pick that clones the existing activity
            // This forces the filler to say "I'll do what they are doing"
            joinablePicks.push({
                field: fieldName,
                sport: match.activity, // Adopt their sport
                _activity: match.activity,
                _isJoinOpportunity: true, // Marker for sorting
                _scoreBoost: 99999 // Infinite priority
            });
        }
    });

    return joinablePicks;
}

function calculatePreferenceScore(fieldProps, divName) {
    if (!fieldProps?.preferences?.enabled) return 0;
    const index = (fieldProps.preferences.list || []).indexOf(divName);
    return index !== -1 ? 1000 - (index * 100) : -50;
}

// UPDATED SORTING: Priority is now: Join Opportunity > Preferences > History
function sortPicksByFreshness(possiblePicks, block, bunkHistory = {}, divName, activityProperties) {
    return possiblePicks.sort((a, b) => {
        // 1. OPPORTUNITY SNIPING (The "Smarter" Logic)
        const joinA = a._isJoinOpportunity ? 1 : 0;
        const joinB = b._isJoinOpportunity ? 1 : 0;
        if (joinA !== joinB) return joinB - joinA; // Joined picks ALWAYS win

        const fieldA = fieldLabel(a.field);
        const fieldB = fieldLabel(b.field);
        const propsA = activityProperties[fieldA];
        const propsB = activityProperties[fieldB];

        // 2. Preference Score
        const prefA = calculatePreferenceScore(propsA, divName);
        const prefB = calculatePreferenceScore(propsB, divName);
        if (prefA !== prefB) return prefB - prefA;
        
        // 3. History (Freshness)
        const lastA = bunkHistory[a._activity] || 0; 
        const lastB = bunkHistory[b._activity] || 0;
        if (lastA !== lastB) return lastA - lastB; 

        return 0.5 - Math.random();
    });
}

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

// =================================================================
// MAIN FILLER FUNCTIONS
// =================================================================

window.findBestSpecial = function(block, allActivities, fieldUsageBySlot, yesterdayHistory, activityProperties, rotationHistory, divisions, historicalCounts) {
    const specials = allActivities.filter(a => a.type === 'special').map(a => ({ field: a.field, sport: null, _activity: a.field }));
    const bunkHistory = rotationHistory?.bunks?.[block.bunk] || {};
    const activitiesDoneToday = getGeneralActivitiesDoneToday(block.bunk);

    // Specials usually aren't "joined", but if they were sharable, the logic would apply. 
    // Generally, specials are exclusive, so we stick to standard logic here.
    const availablePicks = specials.filter(pick => {
        const name = pick._activity;
        if (!window.findBestGeneralActivity.canBlockFit(block, fieldLabel(pick.field), activityProperties, fieldUsageBySlot, name)) return false;
        if (isOverUsageLimit(name, block.bunk, activityProperties, historicalCounts, activitiesDoneToday)) return false;
        if (activitiesDoneToday.has(name)) return false;
        return true;
    });
    
    const sortedPicks = sortPicksByFreshness(availablePicks, block, bunkHistory, block.divName, activityProperties);
    return sortedPicks[0] || null;
};

window.findBestSportActivity = function(block, allActivities, fieldUsageBySlot, yesterdayHistory, activityProperties, rotationHistory, divisions, historicalCounts) {
    const bunkHistory = rotationHistory?.bunks?.[block.bunk] || {};
    const activitiesDoneToday = getGeneralActivitiesDoneToday(block.bunk);

    // 1. TRY TO JOIN EXISTING GAMES FIRST
    const joinPicks = findJoinableOpportunities(block, activityProperties);
    
    // Filter join opportunities for validity (limits, done today)
    const validJoinPicks = joinPicks.filter(pick => 
        window.findBestGeneralActivity.canBlockFit(block, fieldLabel(pick.field), activityProperties, fieldUsageBySlot, pick._activity) &&
        !activitiesDoneToday.has(pick._activity)
    );

    // 2. GET STANDARD PICKS
    const sports = allActivities.filter(a => a.type === 'field').map(a => ({ field: a.field, sport: a.sport, _activity: a.sport }));
    const validStandardPicks = sports.filter(pick => 
        window.findBestGeneralActivity.canBlockFit(block, fieldLabel(pick.field), activityProperties, fieldUsageBySlot, pick._activity) &&
        !activitiesDoneToday.has(pick._activity)
    );
    
    // Combine: Join picks go first implicitly due to sorting flag
    const allPicks = [...validJoinPicks, ...validStandardPicks];
    
    const sortedPicks = sortPicksByFreshness(allPicks, block, bunkHistory, block.divName, activityProperties);
    return sortedPicks[0] || null;
};

window.findBestGeneralActivity = function(block, allActivities, h2hActivities, fieldUsageBySlot, yesterdayHistory, activityProperties, rotationHistory, divisions, historicalCounts) {
    const bunkHistory = rotationHistory?.bunks?.[block.bunk] || {};
    const activitiesDoneToday = getGeneralActivitiesDoneToday(block.bunk);

    // 1. OPPORTUNITY SNIPING: Find matches to join
    const joinPicks = findJoinableOpportunities(block, activityProperties);
    
    const validJoinPicks = joinPicks.filter(pick => {
        // Validation check for join picks
        if (!window.findBestGeneralActivity.canBlockFit(block, fieldLabel(pick.field), activityProperties, fieldUsageBySlot, pick._activity)) return false;
        if (isOverUsageLimit(pick._activity, block.bunk, activityProperties, historicalCounts, activitiesDoneToday)) return false;
        return !activitiesDoneToday.has(pick._activity);
    });

    // 2. STANDARD SEARCH: Find empty slots
    const allPossiblePicks = allActivities.map(a => ({ field: a.field, sport: a.sport, _activity: a.sport || a.field }));
    const validStandardPicks = allPossiblePicks.filter(pick => {
        const name = pick._activity;
        if (!window.findBestGeneralActivity.canBlockFit(block, fieldLabel(pick.field), activityProperties, fieldUsageBySlot, name)) return false;
        if (pick.field && !pick.sport) { 
             if (isOverUsageLimit(name, block.bunk, activityProperties, historicalCounts, activitiesDoneToday)) return false;
        }
        return !activitiesDoneToday.has(name);
    });

    // 3. MERGE & SORT
    const combinedPicks = [...validJoinPicks, ...validStandardPicks];

    const sortedPicks = sortPicksByFreshness(combinedPicks, block, bunkHistory, block.divName, activityProperties);
    return sortedPicks[0] || { field: "Free", sport: null, _activity: "Free" };
};

// =================================================================
// UPDATED CONFLICT CHECKER
// =================================================================
window.findBestGeneralActivity.canBlockFit = function(block, fieldName, activityProperties, fieldUsageBySlot, proposedActivity) {
    const props = activityProperties[fieldName];
    if (!props) return false;

    // 1. Basic Props Check
    if (props.preferences?.enabled && props.preferences.exclusive && !props.preferences.list.includes(block.divName)) return false;
    if (props.allowedDivisions && props.allowedDivisions.length && !props.allowedDivisions.includes(block.divName)) return false;
    
    if (props.limitUsage?.enabled) {
        if (!props.limitUsage.divisions[block.divName]) return false;
        const allowedBunks = props.limitUsage.divisions[block.divName];
        if (allowedBunks.length > 0 && block.bunk && !allowedBunks.includes(block.bunk)) return false;
    }

    // 2. CHECK INTERVAL AVAILABILITY
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

    // 3. CHECK TIME RULES
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
