// =================================================================
// scheduler_logic_fillers.js
//
// UPDATED (Hierarchical Intelligence):
// - TIER 1: Perfect Picks (Open + Not Done Today + Under Weekly Limit).
// - TIER 2: Compromise Picks (Open + Not Done Today + IGNORE Weekly Limit).
// - TIER 3: Free (Only if Tiers 1 & 2 fail).
// - STRICT RULE: "Done Today" is never violated.
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

// --- Helper: Check if a field is currently empty ---
function isFieldEmpty(fieldName, blockStartMin, blockEndMin) {
    if (!window.GlobalAvailabilityManager || !window.GlobalAvailabilityManager.getReservationsForField) return true;
    const reservations = window.GlobalAvailabilityManager.getReservationsForField(fieldName);
    const overlaps = reservations.filter(r => r.start < blockEndMin && r.end > blockStartMin);
    return overlaps.length === 0;
}

// --- Find Sharable Fields ---
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

// --- Usage Limit Check (The Soft Rule) ---
function isOverUsageLimit(activityName, bunk, activityProperties, historicalCounts, activitiesDoneToday) {
    const props = activityProperties[activityName];
    const max = props?.maxUsage || 0;
    if (max === 0) return false; 
    const safeHistory = historicalCounts || {};
    const pastCount = safeHistory[bunk]?.[activityName] || 0;
    
    if (pastCount >= max) return true;
    return false;
}

// --- Time Availability ---
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
// SORTING
// =================================================================

function calculatePreferenceScore(fieldProps, divName) {
    if (!fieldProps?.preferences?.enabled) return 0;
    const index = (fieldProps.preferences.list || []).indexOf(divName);
    return index !== -1 ? 1000 - (index * 100) : -50;
}

function sortPicksByPriority(possiblePicks, block, bunkHistory, divName, activityProperties) {
    const { blockStartMin, blockEndMin } = getBlockTimeRange(block);

    return possiblePicks.sort((a, b) => {
        const fieldA = fieldLabel(a.field);
        const fieldB = fieldLabel(b.field);
        
        // 1. Emptiness (Individual Assignment Priority)
        const emptyA = isFieldEmpty(fieldA, blockStartMin, blockEndMin);
        const emptyB = isFieldEmpty(fieldB, blockStartMin, blockEndMin);
        if (emptyA !== emptyB) return emptyA ? -1 : 1; 

        // 2. Preferences
        const propsA = activityProperties[fieldA];
        const propsB = activityProperties[fieldB];
        const prefA = calculatePreferenceScore(propsA, divName);
        const prefB = calculatePreferenceScore(propsB, divName);
        if (prefA !== prefB) return prefB - prefA;

        // 3. Freshness (Usage History)
        // We prefer things played longest ago
        const lastA = bunkHistory[a._activity] || 0; 
        const lastB = bunkHistory[b._activity] || 0;
        if (lastA !== lastB) return lastA - lastB; 

        return 0.5 - Math.random();
    });
}

// =================================================================
// MAIN FILLER LOGIC
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

    // 1. Gather Candidates
    const joinPicks = findJoinableOpportunities(block, activityProperties);
    const standardPicks = allActivities.map(a => ({ field: a.field, sport: a.sport, _activity: a.sport || a.field }));
    const allCandidates = [...standardPicks, ...joinPicks];

    // 2. PRE-FILTER: Apply HARD Rules (Physics + Done Today)
    // These rules CANNOT be broken, not even in desperation.
    const physicallyValidPicks = allCandidates.filter(pick => {
        const name = pick._activity;

        // A. Physical Availability
        if (!window.findBestGeneralActivity.canBlockFit(block, fieldLabel(pick.field), activityProperties, fieldUsageBySlot, name)) return false;

        // B. Hard Rule: No Doubling in One Day
        if (activitiesDoneToday.has(name)) return false;

        return true;
    });

    // 3. TIER 1: The Perfect Picks
    // Apply Soft Rules (Weekly Limits)
    let finalCandidates = physicallyValidPicks.filter(pick => {
        const name = pick._activity;
        // Check Weekly Limit (Soft Rule)
        if (pick.field && !pick.sport) { 
             if (isOverUsageLimit(name, block.bunk, activityProperties, historicalCounts, activitiesDoneToday)) return false;
        }
        return true;
    });

    // 4. TIER 2: The Compromise Picks (Smart Fallback)
    // If Tier 1 found nothing, we go back to 'physicallyValidPicks'.
    // We implicitly Accept that we are breaking the Weekly Limit history rule 
    // because it is better than being Free.
    if (finalCandidates.length === 0) {
        finalCandidates = physicallyValidPicks;
    }

    // 5. Sorting & Selection
    const sortedPicks = sortPicksByPriority(finalCandidates, block, bunkHistory, block.divName, activityProperties);

    return sortedPicks[0] || { field: "Free", sport: null, _activity: "Free" };
};

// =================================================================
// CONFLICT CHECKER
// =================================================================
window.findBestGeneralActivity.canBlockFit = function(block, fieldName, activityProperties, fieldUsageBySlot, proposedActivity) {
    const props = activityProperties[fieldName];
    if (!props) return false;

    if (props.preferences?.enabled && props.preferences.exclusive && !props.preferences.list.includes(block.divName)) return false;
    if (props.allowedDivisions && props.allowedDivisions.length && !props.allowedDivisions.includes(block.divName)) return false;
    if (props.limitUsage?.enabled) {
        if (!props.limitUsage.divisions[block.divName]) return false;
        const allowedBunks = props.limitUsage.divisions[block.divName];
        if (allowedBunks.length > 0 && block.bunk && !allowedBunks.includes(block.bunk)) return false;
    }

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
