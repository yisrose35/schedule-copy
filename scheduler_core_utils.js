/* ===========================================================================
   scheduler_core_utils.js
   Shared helper functions for all Scheduler Core modules.

   Provides:
   - time parsing / formatting
   - range & slot helpers
   - deep clone / safe merge
   - fairness-safe sorting + shuffling
   - normalization helpers
   - global namespace initializer
   =========================================================================== */

(function (global) {
    "use strict";

    // Create root namespace if not present
    const NS = global.SchedulerCore = global.SchedulerCore || {};

    /* =======================================================================
       TIME HELPERS
       ======================================================================= */

    /** Parse "8:30am" → minutes since midnight */
    function parseTimeToMinutes(str) {
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

        if (Number.isNaN(hh) || Number.isNaN(mm) || mm < 0 || mm > 59)
            return null;

        if (mer) {
            if (hh === 12) hh = (mer === "am") ? 0 : 12;
            else if (mer === "pm") hh += 12;
        }

        return hh * 60 + mm;
    }

    /** Convert minutes → {hours, minutes} */
    function minutesToObj(mins) {
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        return { hours: h, minutes: m };
    }

    /** Convert minutes → "8:30 AM" string */
    function minutesToLabel(mins) {
        if (mins == null) return "";
        let h = Math.floor(mins / 60);
        let m = mins % 60;
        const ap = h >= 12 ? "PM" : "AM";
        h = h % 12 || 12;
        return `${h}:${String(m).padStart(2, "0")} ${ap}`;
    }


    /* =======================================================================
       OBJECT HELPERS
       ======================================================================= */

    /** Deep clone (safe for JSON-ready objects) */
    function deepClone(obj) {
        return obj ? JSON.parse(JSON.stringify(obj)) : obj;
    }

    /** Shallow merge */
    function mergeShallow(a, b) {
        return Object.assign({}, a || {}, b || {});
    }


    /* =======================================================================
       ARRAY HELPERS
       ======================================================================= */

    /** Fisher–Yates shuffle */
    function shuffle(array) {
        const arr = array.slice();
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }

    /** Randomize tie-breaks in a sorted list */
    function randomizeTies(arr, keyFn) {
        let groups = [];
        let current = [arr[0]];

        for (let i = 1; i < arr.length; i++) {
            if (keyFn(arr[i]) === keyFn(current[0])) {
                current.push(arr[i]);
            } else {
                groups.push(shuffle(current));
                current = [arr[i]];
            }
        }
        groups.push(shuffle(current));

        return groups.flat();
    }


    /* =======================================================================
       RANGE / SLOT HELPERS
       ======================================================================= */

    function rangesOverlap(startA, endA, startB, endB) {
        return (startA < endB) && (startB < endA);
    }

    function clamp(min, val, max) {
        return Math.max(min, Math.min(max, val));
    }

    function within(min, val, max) {
        return val >= min && val <= max;
    }

    /** 
     * Given a unifiedTimes array, find slots covering [startMin, endMin) 
     */
    function findSlotsForRange(unifiedTimes, startMin, endMin) {
        const slots = [];
        if (!unifiedTimes || startMin == null || endMin == null) return slots;

        for (let i = 0; i < unifiedTimes.length; i++) {
            const slot = unifiedTimes[i];
            const slotStart = slot.startMin;
            if (slotStart >= startMin && slotStart < endMin) slots.push(i);
        }
        return slots;
    }


    /* =======================================================================
       NORMALIZATION HELPERS
       ======================================================================= */

    function normalizeKey(str) {
        return String(str || "").trim().toLowerCase();
    }

    function normalizeActivityName(str) {
        if (!str) return "";
        return String(str).trim();
    }


    /* =======================================================================
       LOGGING HELPERS
       ======================================================================= */

    const LOG_PREFIX = "[SchedulerCore]";

    function log(...args) {
        console.log(LOG_PREFIX, ...args);
    }

    function warn(...args) {
        console.warn(LOG_PREFIX, ...args);
    }

    function error(...args) {
        console.error(LOG_PREFIX, ...args);
    }


    /* =======================================================================
       EXPORTED API
       ======================================================================= */

    NS.utils = {
        parseTimeToMinutes,
        minutesToObj,
        minutesToLabel,
        deepClone,
        mergeShallow,
        shuffle,
        randomizeTies,
        rangesOverlap,
        clamp,
        within,
        findSlotsForRange,
        normalizeKey,
        normalizeActivityName,
        log,
        warn,
        error
    };

})(typeof window !== "undefined" ? window : global);
