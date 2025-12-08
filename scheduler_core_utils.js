// ============================================================================
// scheduler_core_utils.js
// PART 1 of 3: THE FOUNDATION (FULLY REWRITTEN — GCM VERSION)
//
// Fixes Included:
// - Safe default props for ALL activities (Free/Lunch/Snack/etc)
// - Correct League weight model (no capacity poisoning)
// - Correct headcount logic (no 0-capacity bug)
// - Eliminated division mismatch poisoning
// - Eliminated over-strict transition zone failures
// - Removed outdated league text veto
// - Deterministic canBlockFit()
// - Stable sharable/zone/minDuration handling
// - FIX: STRICT EXACT MATCH enforcement for sharable fields.
// - FIX: Robust Regex for field name matching.
// - CRITICAL PATCH: Argument mismatch handling.
// ============================================================================

(function () {
    'use strict';

    // ===== CONFIG =====
    const INCREMENT_MINS = 30;
    window.INCREMENT_MINS = INCREMENT_MINS;

    const TRANSITION_TYPE = "Transition/Buffer";
    window.TRANSITION_TYPE = TRANSITION_TYPE;

    const Utils = {};

    // =================================================================
    // 1. BASIC HELPERS
    // =================================================================

    Utils.parseTimeToMinutes = function (str) {
        if (str == null) return null;
        if (typeof str === "number") return str;
        if (typeof str !== "string") return null;

        let s = str.trim().toLowerCase();
        let mer = null;

        if (s.endsWith("am") || s.endsWith("pm")) {
            mer = s.endsWith("am") ? "am" : "pm";
            s = s.replace(/am|pm/gi, "").trim();
        }

        const m = s.match(/^(\d{1,2})\s*:\s*(\d{2})$/);
        if (!m) return null;

        let hh = parseInt(m[1], 10);
        const mm = parseInt(m[2], 10);

        if (mm < 0 || mm > 59) return null;

        if (mer) {
            if (hh === 12) hh = mer === "am" ? 0 : 12;
            else if (mer === "pm") hh += 12;
        }

        return hh * 60 + mm;
    };

    Utils.fieldLabel = function (f) {
        if (typeof f === "string") return f;
        if (f && typeof f === "object" && typeof f.name === "string") return f.name;
        return "";
    };
    Utils.fmtTime = function (d) {
        if (!d) return "";
        if (typeof d === 'string') d = new Date(d);
        let h = d.getHours();
        let m = d.getMinutes().toString().padStart(2, "0");
        const ap = h >= 12 ? "PM" : "AM";
        h = h % 12 || 12;
        return `${h}:${m} ${ap}`;
    };

    Utils.minutesToDate = function (mins) {
        const d = new Date(1970, 0, 1, 0, 0, 0);
        d.setMinutes(mins);
        return d;
    };

    Utils.findSlotsForRange = function (startMin, endMin) {
        const slots = [];
        if (!window.unifiedTimes || startMin == null || endMin == null) return slots;

        for (let i = 0; i < window.unifiedTimes.length; i++) {
            const slot = window.unifiedTimes[i];
            const slotStart = new Date(slot.start).getHours() * 60 + new Date(slot.start).getMinutes();
            if (slotStart >= startMin && slotStart < endMin) slots.push(i);
        }
        return slots;
    };

    Utils.getBlockTimeRange = function (block) {
        let blockStartMin = (typeof block.startTime === "number") ? block.startTime : null;
        let blockEndMin = (typeof block.endTime === "number") ? block.endTime : null;

        if ((!blockStartMin || !blockEndMin) && window.unifiedTimes && block.slots?.length) {
            const minIndex = Math.min(...block.slots);
            const maxIndex = Math.max(...block.slots);

            const firstSlot = window.unifiedTimes[minIndex];
            const lastSlot = window.unifiedTimes[maxIndex];

            if (firstSlot && lastSlot) {
                const firstStart = new Date(firstSlot.start);
                const lastEnd = new Date(lastSlot.end);
                blockStartMin = firstStart.getHours() * 60 + firstStart.getMinutes();
                blockEndMin = lastEnd.getHours() * 60 + lastEnd.getMinutes();
            }
        }

        return { blockStartMin, blockEndMin };
    };

    // =================================================================
    // 2. TRANSITION / BUFFER LOGIC
    // =================================================================

    Utils.getTransitionRules = function (fieldName, activityProperties) {
        const base = {
            preMin: 0,
            postMin: 0,
            label: "Travel",
            zone: window.DEFAULT_ZONE_NAME || "default",
            occupiesField: false,
            minDurationMin: 0
        };

        if (!activityProperties) return base;

        const props = activityProperties[fieldName];
        if (!props?.transition) return base;

        return { ...base, ...props.transition };
    };

    Utils.getEffectiveTimeRange = function (block, rules) {
        const { blockStartMin, blockEndMin } = Utils.getBlockTimeRange(block);
        if (blockStartMin == null || blockEndMin == null) {
            return {
                blockStartMin,
                blockEndMin,
                effectiveStart: blockStartMin,
                effectiveEnd: blockEndMin,
                activityDuration: 0
            };
        }

        const pre = rules.preMin || 0;
        const post = rules.postMin || 0;

        const effectiveStart = blockStartMin + pre;
        const effectiveEnd = blockEndMin - post;

        return {
            blockStartMin,
            blockEndMin,
            effectiveStart,
            effectiveEnd,
            activityDuration: effectiveEnd - effectiveStart
        };
    };

    // =================================================================
    // 3. HELPERS — League + Root fields + Usage
    // =================================================================

    function isLeagueAssignment(assignmentObj, actName) {
        if (assignmentObj?._gameLabel || assignmentObj?._allMatchups) return true;
        const s = String(actName || "").toLowerCase();
        return s.includes("league game") || s.includes("specialty league");
    }

    function calculateAssignmentWeight(activityName, assignmentObj) {
        return isLeagueAssignment(assignmentObj, activityName) ? 1 : 1;
    }

    function getRootFieldName(name) {
        if (!name) return "";
        // Robust splitter: Handles " - ", " – ", "-", with optional spaces
        return String(name).split(/\s*[-–—]\s*/)[0].trim().toLowerCase();
    }

    function getCombinedUsage(slotIndex, proposedFieldName, usageMap) {
        const combined = { count: 0, divisions: [], bunks: {} };
        const slotData = usageMap[slotIndex];
        if (!slotData) return combined;

        const target = getRootFieldName(proposedFieldName);

        for (const key of Object.keys(slotData)) {
            if (getRootFieldName(key) !== target) continue;

            const u = slotData[key];
            combined.count += (u.count || 0);

            if (Array.isArray(u.divisions))
                u.divisions.forEach(d => { if (!combined.divisions.includes(d)) combined.divisions.push(d); });

            Object.assign(combined.bunks, u.bunks || {});
        }

        return combined;
    }

    // Helper to safely normalize strings for strict comparison
    function normalizeActivityStrict(str) {
        if (!str) return "";
        // Remove known prefixes if they exist in the activity name itself (rare but possible)
        // e.g., "Gym A - Basketball" -> "basketball"
        // But also ensure we don't accidentally strip "Capture the Flag" -> "Flag"
        const s = String(str).trim();
        const parts = s.split(/\s*[-–—]\s*/);
        if (parts.length > 1) {
             // Heuristic: If it looks like "Field - Sport", take the last part.
             // If it's just "Sport", take it.
             return parts[parts.length - 1].trim().toLowerCase();
        }
        return s.toLowerCase();
    }

    // =================================================================
    // 4. MAIN FIT LOGIC (REWRITTEN)
    // =================================================================

    Utils.isTimeAvailable = function (slotIndex, props) {
        if (!window.unifiedTimes?.[slotIndex]) return false;

        const slot = window.unifiedTimes[slotIndex];
        const slotStart = new Date(slot.start).getHours() * 60 + new Date(slot.start).getMinutes();
        const slotEnd = new Date(slot.end).getHours() * 60 + new Date(slot.end).getMinutes();

        const rules = (props.timeRules || []).map(r => {
            if (typeof r.startMin === "number") return r;
            return {
                ...r,
                startMin: Utils.parseTimeToMinutes(r.start),
                endMin: Utils.parseTimeToMinutes(r.end)
            };
        });

        if (rules.length === 0) return props.available !== false;

        if (!props.available) return false;

        let allowed = !rules.some(r => r.type === "Available");
        for (const rule of rules) {
            if (rule.type === "Available" &&
                slotStart >= rule.startMin &&
                slotEnd <= rule.endMin) {
                allowed = true;
                break;
            }
        }

        if (!allowed) return false;

        for (const rule of rules) {
            if (rule.type === "Unavailable" &&
                slotStart < rule.endMin &&
                slotEnd > rule.startMin) {
                return false;
            }
        }

        return true;
    };

    Utils.canBlockFit = function (block, fieldName, activityProperties, fieldUsageBySlot, actName, forceLeague = false) {
        
        // --- PATCH FOR TOTAL SOLVER ARGUMENT MISMATCH ---
        if (typeof fieldUsageBySlot === 'string' && actName === undefined) {
            actName = fieldUsageBySlot;
            fieldUsageBySlot = window.fieldUsageBySlot; 
        }
        if (!fieldUsageBySlot) fieldUsageBySlot = window.fieldUsageBySlot || {};
        // ------------------------------------------------
        
        if (!fieldName) return false;

        const baseProps = {
            available: true,
            sharable: false,
            sharableWith: { capacity: 1, type: "not_sharable" },
            timeRules: [],
            transition: { preMin: 0, postMin: 0, zone: "default", occupiesField: false }
        };

        const props = activityProperties[fieldName] || baseProps;

        const rules = Utils.getTransitionRules(fieldName, activityProperties);
        const {
            blockStartMin, blockEndMin,
            effectiveStart, effectiveEnd,
            activityDuration
        } = Utils.getEffectiveTimeRange(block, rules);

        if (activityDuration <= 0 || activityDuration < (rules.minDurationMin || 0))
            return false;

        let maxCapacity = 1;
        if (props.sharableWith?.capacity) maxCapacity = parseInt(props.sharableWith.capacity);
        else if (props.sharable || props.sharableWith?.type === "all") maxCapacity = 2;

        const bunkMeta = window.bunkMetaData || {};
        const sportMeta = window.sportMetaData || {};

        const maxHeadcount =
            sportMeta[actName]?.maxCapacity ??
            props?.sharableWith?.capacity ??
            Infinity;

        const mySize = bunkMeta[block.bunk]?.size || 0;

        if (!props.available) return false;
        if (props.allowedDivisions?.length && !props.allowedDivisions.includes(block.divName)) return false;
        if (props.preferences?.enabled && props.preferences.exclusive &&
            !props.preferences.list.includes(block.divName)) return false;

        // LimitUsage check
        if (props.limitUsage?.enabled) {
            const rule = props.limitUsage.divisions[block.divName];
            if (!rule) return false;
            if (Array.isArray(rule) && !rule.includes(block.bunk)) return false;
        }

        const slots = rules.occupiesField
            ? Utils.findSlotsForRange(blockStartMin, blockEndMin)
            : Utils.findSlotsForRange(effectiveStart, effectiveEnd);

        const uniqueSlots = [...new Set(slots)].sort((a, b) => a - b);

        for (const idx of uniqueSlots) {
            const usage = getCombinedUsage(idx, fieldName, fieldUsageBySlot);

            let currentWeight = 0;
            const existing = Object.keys(usage.bunks);

            const myObj = { _gameLabel: block._gameLabel, _activity: actName };
            const isLeague = forceLeague || isLeagueAssignment(myObj, actName);

            for (const b of existing) {
                if (b === block.bunk) continue;

                const existingEntry = window.scheduleAssignments?.[b]?.[idx];
                const existingName = usage.bunks[b];

                const theirAssignment = window.scheduleAssignments[b]?.[idx];
                const theirLabel = theirAssignment?._gameLabel || theirAssignment?._activity;
                const myLabel = block._gameLabel || (String(actName).includes("League") ? actName : null);

                const sameGame = myLabel && theirLabel && (String(myLabel) === String(theirLabel));

                // === GCM FIX: STRICT SAME ACTIVITY CHECK ===
                // If capacity > 1, all occupants MUST play same sport (unless it's a league game match).
                if (maxCapacity > 1) {
                    const normExisting = normalizeActivityStrict(existingName);
                    const normProposed = normalizeActivityStrict(actName);

                    if (normExisting !== normProposed && !sameGame) {
                        return false; // Hard Reject: Different activities
                    }
                }
                // ===========================================

                // === GCM FIX: CAPACITY ENFORCEMENT ===
                // Count every existing occupant.
                currentWeight += calculateAssignmentWeight(existingName, existingEntry);
            }

            const myWeight = isLeague ? 1 : 1;
            if (currentWeight + myWeight > maxCapacity) return false;

            if (maxHeadcount !== Infinity) {
                let currHead = 0;
                for (const b of Object.keys(usage.bunks)) {
                    currHead += (bunkMeta[b]?.size || 0);
                }
                if (currHead + mySize > maxHeadcount) return false;
            }

            if (!Utils.isTimeAvailable(idx, props)) return false;
        }

        return true;
    };

    Utils.canLeagueGameFit = function (block, fieldName, usage, props) {
        return Utils.canBlockFit(block, fieldName, props, usage, "League Game", true);
    };

    // =================================================================
    // 5. TIMELINE
    // =================================================================

    Utils.timeline = {
        checkAvailability(resourceName, startMin, endMin, weight, capacity, excludeBunk) {
            const slots = Utils.findSlotsForRange(startMin, endMin);
            const assigns = window.scheduleAssignments || {};

            for (const s of slots) {
                let current = 0;
                for (const bunk of Object.keys(assigns)) {
                    if (bunk === excludeBunk) continue;
                    const entry = assigns[bunk][s];
                    if (!entry) continue;
                    const name = Utils.fieldLabel(entry.field) || entry._activity;
                    if (!name) continue;
                    if (name.toLowerCase() === resourceName.toLowerCase()) {
                        const isLeague = entry._h2h || String(entry._activity).includes("League");
                        current += (isLeague ? capacity : 1);
                    }
                }
                if (current + weight > capacity) return false;
            }
            return true;
        },

        getPeakUsage(resourceName, startMin, endMin, excludeBunk) {
            const slots = Utils.findSlotsForRange(startMin, endMin);
            const assigns = window.scheduleAssignments || {};
            let maxLoad = 0;
            for (const s of slots) {
                let current = 0;
                for (const bunk of Object.keys(assigns)) {
                    if (bunk === excludeBunk) continue;
                    const entry = assigns[bunk][s];
                    if (!entry) continue;
                    const name = Utils.fieldLabel(entry.field) || entry._activity;
                    if (!name) continue;
                    if (name.toLowerCase() === resourceName.toLowerCase()) {
                        const isLeague = entry._h2h || String(entry._activity).includes("League");
                        current += (isLeague ? 2 : 1);
                    }
                }
                maxLoad = Math.max(maxLoad, current);
            }
            return maxLoad;
        }
    };

    // =================================================================
    // 6. Delegated Loader
    // =================================================================

    Utils.loadAndFilterData = function () {
        if (typeof window.loadAndFilterData !== "function") {
            console.error("ERROR: scheduler_core_loader.js not loaded before scheduler_core_utils.js");
            return {};
        }
        return window.loadAndFilterData();
    };

    window.SchedulerCoreUtils = Utils;

})();
