// ============================================================================
// scheduler_core_utils.js
// PART 1 of 3: THE FOUNDATION (V2.1 — TIMELINE ENGINE PATCHED)
// ============================================================================

(function () {
    "use strict";

    // ============================================================
    // GLOBAL CONSTANTS
    // ============================================================
    const INCREMENT_MINS = 30;
    window.INCREMENT_MINS = INCREMENT_MINS;

    const TRANSITION_TYPE = "Transition/Buffer";
    window.TRANSITION_TYPE = TRANSITION_TYPE;

    const Utils = {};

    // ============================================================
    // 1. BASIC HELPERS
    // ============================================================
    Utils.parseTimeToMinutes = function (str) {
        if (str == null) return null;
        if (typeof str === "number") return str;
        if (typeof str !== "string") return null;

        let s = str.trim().toLowerCase();
        let mer = null;

        if (s.endsWith("am") || s.endsWith("pm")) {
            mer = s.endsWith("am") ? "am" : "pm";
            s = s.replace(/am|pm/g, "").trim();
        } else {
            return null;
        }

        const m = s.match(/^(\d{1,2})\s*:\s*(\d{2})$/);
        if (!m) return null;

        let hh = parseInt(m[1], 10);
        const mm = parseInt(m[2], 10);

        if (Number.isNaN(hh) || Number.isNaN(mm) || mm < 0 || mm > 59) return null;

        if (mer) {
            if (hh === 12) hh = (mer === "am") ? 0 : 12;
            else if (mer === "pm") hh += 12;
        }

        return hh * 60 + mm;
    };

    Utils.fieldLabel = function (f) {
        if (typeof f === "string") return f;
        if (f && typeof f === "object" && typeof f.name === "string") return f.name;
        return "";
    };

    Utils.minutesToDate = function (mins) {
        const d = new Date(1970, 0, 1, 0, 0, 0);
        d.setMinutes(mins);
        return d;
    };

    Utils.fmtTime = function (d) {
        if (!d) return "";
        if (typeof d === "string") d = new Date(d);
        let h = d.getHours();
        const m = String(d.getMinutes()).padStart(2, "0");
        const ap = h >= 12 ? "PM" : "AM";
        h = h % 12 || 12;
        return `${h}:${m} ${ap}`;
    };

    Utils.findSlotsForRange = function (startMin, endMin) {
        const out = [];
        if (!window.unifiedTimes) return out;

        for (let i = 0; i < window.unifiedTimes.length; i++) {
            const slot = window.unifiedTimes[i];
            const ss = new Date(slot.start);
            const es = new Date(slot.end);
            const slotStart = ss.getHours() * 60 + ss.getMinutes();
            const slotEnd = es.getHours() * 60 + es.getMinutes();

            if (slotStart < endMin && slotEnd > startMin) {
                out.push(i);
            }
        }
        return out;
    };

    Utils.getBlockTimeRange = function (block) {
        let start = (typeof block.startTime === "number") ? block.startTime : null;
        let end = (typeof block.endTime === "number") ? block.endTime : null;

        if ((start == null || end == null) &&
            Array.isArray(block.slots) &&
            block.slots.length > 0 &&
            window.unifiedTimes) {

            const minIndex = Math.min(...block.slots);
            const maxIndex = Math.max(...block.slots);

            const slotA = window.unifiedTimes[minIndex];
            const slotB = window.unifiedTimes[maxIndex];

            const dA = new Date(slotA.start);
            const dB = new Date(slotB.end);

            start = dA.getHours() * 60 + dA.getMinutes();
            end = dB.getHours() * 60 + dB.getMinutes();
        }

        return { blockStartMin: start, blockEndMin: end };
    };

    // ============================================================
    // 2. TRANSITION RULES
    // ============================================================
    Utils.getTransitionRules = function (name, props) {
        const defaults = {
            preMin: 0,
            postMin: 0,
            label: "Travel",
            zone: window.DEFAULT_ZONE_NAME,
            occupiesField: false,
            minDurationMin: 0
        };

        if (!props || !props[name] || !props[name].transition) return defaults;
        return { ...defaults, ...props[name].transition };
    };

    Utils.getEffectiveTimeRange = function (block, transRules) {
        const { blockStartMin, blockEndMin } = Utils.getBlockTimeRange(block);
        if (blockStartMin == null || blockEndMin == null)
            return { blockStartMin, blockEndMin, effectiveStart: blockStartMin, effectiveEnd: blockEndMin };

        const pre = transRules.preMin || 0;
        const post = transRules.postMin || 0;

        const effectiveStart = blockStartMin + pre;
        const effectiveEnd = blockEndMin - post;

        return {
            blockStartMin,
            blockEndMin,
            effectiveStart,
            effectiveEnd,
            activityDuration: effectiveEnd - effectiveStart,
            totalDuration: blockEndMin - blockStartMin
        };
    };

    // ============================================================
    // 3. LEAGUE & FIELD SHARING
    // ============================================================
    function isLeagueAssignment(assignObj, activityName) {
        const s = String(activityName || "").toLowerCase();
        if (assignObj) {
            if (assignObj._h2h) return true;
            if (assignObj._gameLabel) return true;
            if (String(assignObj._activity || "").toLowerCase().includes("league")) return true;
        }
        if (s.includes("league")) return true;
        if (s.includes("specialty league")) return true;
        return false;
    }

    function calculateAssignmentWeight(activityName, assignObj, maxCap) {
        return isLeagueAssignment(assignObj, activityName) ? maxCap : 1;
    }

    function getRootFieldName(name) {
        if (!name) return "";
        return String(name).split(/\s+[-–]\s+/)[0].trim().toLowerCase();
    }

    function getCombinedUsage(slotIndex, fieldName, usageMap) {
        const out = { count: 0, divisions: [], bunks: {} };
        const entry = usageMap[slotIndex];
        if (!entry) return out;

        const root = getRootFieldName(fieldName);

        for (const k of Object.keys(entry)) {
            const r = getRootFieldName(k);
            if (root !== r) continue;

            const u = entry[k];
            out.count += (u.count || 0);

            if (Array.isArray(u.divisions)) {
                for (const d of u.divisions) {
                    if (!out.divisions.includes(d)) out.divisions.push(d);
                }
            }

            if (u.bunks) Object.assign(out.bunks, u.bunks);
        }

        return out;
    }

    function isFieldTakenByLeagueText(slotIdx, fieldName) {
        const sched = window.scheduleAssignments || {};
        const root = getRootFieldName(fieldName);

        for (const bunk of Object.keys(sched)) {
            const entry = sched[bunk][slotIdx];
            if (!entry) continue;

            if (!isLeagueAssignment(entry, entry._activity)) continue;

            const txt = (
                (entry._allMatchups || "") + " " +
                (entry._gameLabel || "") + " " +
                (entry.description || "")
            ).toLowerCase();

            if (txt.includes(`@${root}`) || txt.includes(`@ ${root}`)) {
                return true;
            }
        }

        return false;
    }

    // ============================================================
    // 4. TIME AVAILABILITY
    // ============================================================
    Utils.isTimeAvailable = function (slotIndex, props) {
        if (!props) return true;
        if (!props.available) return false;

        const slot = window.unifiedTimes?.[slotIndex];
        if (!slot) return false;

        const s = new Date(slot.start);
        const e = new Date(slot.end);

        const start = s.getHours() * 60 + s.getMinutes();
        const end = e.getHours() * 60 + e.getMinutes();

        const rules = (props.timeRules || []).map(r => {
            if (typeof r.startMin === "number" && typeof r.endMin === "number") return r;
            return {
                ...r,
                startMin: Utils.parseTimeToMinutes(r.start),
                endMin: Utils.parseTimeToMinutes(r.end)
            };
        });

        if (rules.length === 0) return true;

        const hasAvail = rules.some(r => r.type === "Available");
        let isOk = !hasAvail;

        for (const r of rules) {
            if (r.type === "Available") {
                if (start >= r.startMin && end <= r.endMin) {
                    isOk = true;
                    break;
                }
            }
        }

        for (const r of rules) {
            if (r.type === "Unavailable") {
                if (start < r.endMin && end > r.startMin) {
                    isOk = false;
                    break;
                }
            }
        }

        return isOk;
    };

    // ============================================================
    // 5. CAN BLOCK FIT — MAIN ENGINE CHECK
    // ============================================================
    Utils.canBlockFit = function (
        block,
        fieldName,
        activityProps,
        fieldUsageBySlot,
        proposedActivity
    ) {
        if (!fieldName) return false;

        const props = activityProps[fieldName];
        const proposedStr = String(proposedActivity || "").toLowerCase();
        const isLeague = isLeagueAssignment(
            { _activity: proposedActivity, _h2h: proposedStr.includes("league") },
            proposedStr
        );

        const transRules = Utils.getTransitionRules(fieldName, activityProps);
        const {
            blockStartMin,
            blockEndMin,
            effectiveStart,
            effectiveEnd,
            activityDuration
        } = Utils.getEffectiveTimeRange(block, transRules);

        if (activityDuration <= 0) return false;
        if (activityDuration < transRules.minDurationMin) return false;

        // Zone concurrency
        if (transRules.preMin > 0 || transRules.postMin > 0) {
            const zones = window.getZones?.() || {};
            const zoneInfo = zones[transRules.zone];
            const maxConc = zoneInfo?.maxConcurrent || 99;

            if (maxConc < 99) {
                const prevSlot = block.slots[0] - 1;
                const merged =
                    blockStartMin > 0 &&
                    window.scheduleAssignments[block.bunk]?.[prevSlot]?._zone === transRules.zone;

                if (!merged) {
                    const used = window.__transitionUsage?.[transRules.zone] || 0;
                    if (used >= maxConc) return false;
                }
            }
        }

        let maxCap = 1;
        const share = props?.sharableWith || {};
        if (share.capacity) maxCap = parseInt(share.capacity);
        else if (share.type === "all" || props?.sharable) maxCap = 2;

        const slots = transRules.occupiesField
            ? Utils.findSlotsForRange(blockStartMin, blockEndMin)
            : Utils.findSlotsForRange(effectiveStart, effectiveEnd);

        const bunkMeta = window.SchedulerCoreUtils?._bunkMetaData || {};
        const sportMeta = window.SchedulerCoreUtils?._sportMetaData || {};
        const mySize = bunkMeta[block.bunk]?.size || 0;
        const maxHead = sportMeta[proposedActivity]?.maxCapacity || Infinity;

        for (const slotIndex of slots) {
            if (slotIndex == null) continue;

            if (isFieldTakenByLeagueText(slotIndex, fieldName)) return false;

            const combined = getCombinedUsage(slotIndex, fieldName, fieldUsageBySlot);

            if (combined.divisions.length > 0 && maxCap === 1) {
                if (combined.divisions.some(d => d !== block.divName)) return false;
            }

            let currentWeight = 0;

            for (const otherBunk of Object.keys(combined.bunks)) {
                if (otherBunk === block.bunk) continue;

                const otherName = combined.bunks[otherBunk];
                const otherAssign = window.scheduleAssignments[otherBunk]?.[slotIndex];

                const myLabel = isLeague ? proposedActivity : null;
                const theirLabel = otherAssign?._gameLabel || otherAssign?._activity;
                const isSameGame = myLabel && theirLabel && (String(myLabel) === String(theirLabel));

                const otherIsLeague = isLeagueAssignment(otherAssign, otherName);

                if (otherIsLeague && !isSameGame) return false;
                if (isLeague && !otherIsLeague) return false;

                if (!isSameGame) {
                    currentWeight += calculateAssignmentWeight(otherName, otherAssign, maxCap);
                }
            }

            const myWeight = isLeague ? maxCap : 1;
            if (currentWeight + myWeight > maxCap) return false;

            let currentHead = 0;
            for (const b of Object.keys(combined.bunks)) {
                currentHead += bunkMeta[b]?.size || 0;
            }
            if (currentHead + mySize > maxHead) return false;

            if (!Utils.isTimeAvailable(slotIndex, props)) return false;
        }

        return true;
    };

    Utils.canLeagueGameFit = function (block, fieldName, usageMap, activityProps) {
        return Utils.canBlockFit(block, fieldName, activityProps, usageMap, "League Game");
    };

    // ============================================================
    // 6. DATA LOADER (placeholder – FULL version next message)
    // ============================================================
    Utils.loadAndFilterData = function () {
        // Will receive the FULL patched version in upcoming message.
        return {};
    };

    window.SchedulerCoreUtils = Utils;
})();
