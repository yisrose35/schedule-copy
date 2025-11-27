/* ============================================================================
   scheduler_core_utils.js
   Shared helper functions for all SchedulerCore modules
============================================================================ */

(function (global) {
"use strict";

const NS = global.SchedulerCore = global.SchedulerCore || {};

/* ============================================================================
   TIME PARSING
============================================================================ */

/**
 * Parse "9:30am" → minutes since midnight
 */
function parseTimeToMin(str) {
    if (!str || typeof str !== "string") return null;

    let s = str.trim().toLowerCase();
    let mer = null;

    if (s.endsWith("am") || s.endsWith("pm")) {
        mer = s.endsWith("am") ? "am" : "pm";
        s = s.replace(/am|pm/g, "").trim();
    }

    const m = s.match(/^(\d{1,2})\s*:\s*(\d{2})$/);
    if (!m) return null;

    let hh = parseInt(m[1], 10);
    let mm = parseInt(m[2], 10);

    if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
    if (mm < 0 || mm > 59) return null;

    if (mer) {
        if (hh === 12) hh = (mer === "am" ? 0 : 12);
        else if (mer === "pm") hh += 12;
    }

    return hh * 60 + mm;
}

/**
 * Format minutes → "h:mmam"
 */
function minToTime(min) {
    const hh = Math.floor(min / 60);
    const mm = min % 60;
    const h12 = (hh % 12 === 0 ? 12 : hh % 12);
    const ap = hh < 12 ? "am" : "pm";
    return `${h12}:${String(mm).padStart(2, "0")}${ap}`;
}

/* ============================================================================
   NORMALIZATION HELPERS
============================================================================ */

/**
 * Normalize activity names internally
 */
function normalizeActivityName(name) {
    if (!name) return "";
    return String(name).trim().toLowerCase();
}

/**
 * Normalize for dictionary keys
 */
function normalizeKey(name) {
    return normalizeActivityName(name).replace(/\s+/g, "_");
}

/* ============================================================================
   EXPORT
============================================================================ */

NS.utils = {
    parseTimeToMin,
    minToTime,
    normalizeActivityName,
    normalizeKey
};

})(typeof window !== "undefined" ? window : global);
