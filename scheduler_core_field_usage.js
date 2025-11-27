
/* ===========================================================================
   scheduler_core_field_usage.js

   Handles ALL rules involving:
     - field availability
     - sharability (limit 1 vs 2 bunks)
     - division restrictions
     - bunk restrictions
     - time-rule enforcement (Available / Unavailable windows)
     - daily disabled sports
     - capacity checks
     - marking usage when an assignment succeeds

   Exported API:
     SchedulerCore.field.canFit(block, fieldName, props, usageMap)
     SchedulerCore.field.canLeagueFit(block, fieldName, props, usageMap)
     SchedulerCore.field.markUsage(block, fieldName, usageMap, activityName)
     SchedulerCore.field.isTimeAllowed(slotIndex, props, unifiedTimes)

   Depends on:
     SchedulerCore.utils
   =========================================================================== */

(function (global) {
    "use strict";

    const NS = global.SchedulerCore = global.SchedulerCore || {};
    const U  = NS.utils;

    const DEFAULT_LIMIT = 1;    // normal activities
    const SHARED_LIMIT  = 2;    // sharable activities


    /* =======================================================================
       INTERNAL: TIME-RULE CHECKING
       ======================================================================= */

    function isTimeAllowed(slotIndex, props, unifiedTimes) {
        if (!props) return false;
        if (!props.available) return false;

        const slot = unifiedTimes[slotIndex];
        if (!slot) return false;

        const slotStart = slot.startMin;
        const slotEnd   = slot.endMin;

        const rules = props.timeRules || [];

        // If no time rules → default to "available"
        if (rules.length === 0) return true;

        // If there is at least one "Available" rule → start in "not available"
        const hasAvailableRule = rules.some(r => r.type === "Available");
        let allowed = !hasAvailableRule;

        // Check Available windows
        for (const rule of rules) {
            if (rule.type === "Available") {
                if (slotStart >= rule.startMin && slotEnd <= rule.endMin) {
                    allowed = true;
                }
            }
        }

        // Check Unavailable windows
        for (const rule of rules) {
            if (rule.type === "Unavailable") {
                if (U.rangesOverlap(slotStart, slotEnd, rule.startMin, rule.endMin)) {
                    return false;
                }
            }
        }

        return allowed;
    }


    /* =======================================================================
       INTERNAL: PROP RESTRICTIONS
       ======================================================================= */

    function passesDivisionRestrictions(block, props) {
        if (!props) return false;

        // Explicit division allowlist
        if (Array.isArray(props.allowedDivisions) && props.allowedDivisions.length > 0) {
            if (!props.allowedDivisions.includes(block.divName)) return false;
        }

        // Preferences exclusive rules
        if (props.preferences &&
            props.preferences.enabled &&
            props.preferences.exclusive) {
            if (!props.preferences.list.includes(block.divName)) return false;
        }

        // limitUsage rules
        const LU = props.limitUsage;
        if (LU && LU.enabled) {
            const divSet = LU.divisions || {};
            if (!divSet[block.divName]) return false;

            const allowedBunks = divSet[block.divName] || [];
            if (allowedBunks.length > 0 && block.bunk) {
                if (!allowedBunks.includes(block.bunk)) return false;
            }
        }

        return true;
    }


    /* =======================================================================
       INTERNAL: SHARABILITY CHECK
       ======================================================================= */

    function checkCapacityAtSlot(slotIndex, fieldName, usageMap, props, proposedActivity) {
        const slotUsage = (usageMap[slotIndex] || {})[fieldName] ||
            { count: 0, divisions: [], bunks: {} };

        const limit = props.sharable ? SHARED_LIMIT : DEFAULT_LIMIT;

        // Hard capacity stop
        if (slotUsage.count >= limit) return false;

        // If shared: must be same division OR empty
        if (slotUsage.count > 0) {
            // Can't mix divisions
            if (!slotUsage.divisions.includes(block.divName)) return false;

            // If “activity must match” rule:
            let existingActivity = null;
            for (const b in slotUsage.bunks) {
                if (slotUsage.bunks[b]) {
                    existingActivity = slotUsage.bunks[b];
                    break;
                }
            }
            if (existingActivity && proposedActivity && existingActivity !== proposedActivity)
                return false;
        }

        return true;
    }


    /* =======================================================================
       PUBLIC: CAN FIT (NON-LEAGUE)
       ======================================================================= */

    function canFit(block, fieldName, props, usageMap, unifiedTimes, proposedActivity) {
        if (!fieldName) return false;
        if (!props) return false;

        if (!passesDivisionRestrictions(block, props)) return false;

        // time rule check for each slot
        for (const slotIndex of block.slots) {
            if (!isTimeAllowed(slotIndex, props, unifiedTimes)) return false;
        }

        // sharability + capacity
        for (const slotIndex of block.slots) {
            const slotUsage = (usageMap[slotIndex] || {})[fieldName] ||
                { count: 0, divisions: [], bunks: {} };

            const limit = props.sharable ? SHARED_LIMIT : DEFAULT_LIMIT;

            if (slotUsage.count >= limit) return false;

            // Division mismatch → no share
            if (slotUsage.count > 0 && !slotUsage.divisions.includes(block.divName))
                return false;

            // Activity mismatch
            let existingActivity = null;
            for (const b in slotUsage.bunks) {
                if (slotUsage.bunks[b]) {
                    existingActivity = slotUsage.bunks[b];
                    break;
                }
            }
            if (existingActivity &&
                proposedActivity &&
                existingActivity !== proposedActivity) {
                return false;
            }
        }

        return true;
    }


    /* =======================================================================
       PUBLIC: LEAGUE FIT (STRICTER)
       ======================================================================= */

    function canLeagueFit(block, fieldName, props, usageMap, unifiedTimes) {
        if (!fieldName) return false;
        if (!props) return false;

        if (!passesDivisionRestrictions(block, props)) return false;

        // time rule check
        for (const slotIndex of block.slots) {
            if (!isTimeAllowed(slotIndex, props, unifiedTimes)) return false;
        }

        // league = hard limit 1
        for (const slotIndex of block.slots) {
            const slotUsage = (usageMap[slotIndex] || {})[fieldName] ||
                { count: 0 };
            if (slotUsage.count >= 1) return false;
        }

        return true;
    }


    /* =======================================================================
       PUBLIC: MARK USAGE
       ======================================================================= */

    function markUsage(block, fieldName, usageMap, activityName) {
        for (const slotIndex of block.slots) {
            usageMap[slotIndex] = usageMap[slotIndex] || {};

            const slotUsage = usageMap[slotIndex][fieldName] ||
                {
                    count: 0,
                    divisions: [],
                    bunks: {}
                };

            slotUsage.count++;
            if (!slotUsage.divisions.includes(block.divName))
                slotUsage.divisions.push(block.divName);

            if (block.bunk)
                slotUsage.bunks[block.bunk] = activityName;

            usageMap[slotIndex][fieldName] = slotUsage;
        }
    }


    /* =======================================================================
       EXPORT
       ======================================================================= */

    NS.field = {
        canFit,
        canLeagueFit,
        markUsage,
        isTimeAllowed
    };

})(typeof window !== "undefined" ? window : global);
