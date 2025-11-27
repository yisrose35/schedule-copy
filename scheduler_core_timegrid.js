/* ============================================================================
   scheduler_core_timegrid.js
   NEW TIMEGRID MODULE (required by engine)
   ----------------------------------------------------------------------------
   Responsibilities:
     • Convert division start/end times into a single unified time grid
     • Produce an array:
         unifiedTimes = [
           { start: Date, end: Date, index: 0 },
           { start: Date, end: Date, index: 1 },
           ...
         ]
     • Map each block to slot indices
============================================================================ */

(function (global) {
"use strict";

const NS = global.SchedulerCore = global.SchedulerCore || {};
const U  = NS.utils;

/* ============================================================================
   Convert "9:00am" → minutes since midnight
============================================================================ */
function toMin(str) {
    return U.parseTimeToMin(str);
}

/* ============================================================================
   Build unified times (required by engine)
============================================================================ */
function buildUnifiedTimes(divisions) {

    let earliest = null;
    let latest   = null;

    Object.values(divisions).forEach(div => {
        const s = toMin(div.startTime);
        const e = toMin(div.endTime);
        if (s != null && (earliest == null || s < earliest)) earliest = s;
        if (e != null && (latest == null || e > latest)) latest = e;
    });

    if (earliest == null) earliest = 9 * 60;
    if (latest   == null) latest   = 16 * 60;

    if (latest <= earliest) latest = earliest + 60;

    const slots = [];
    for (let m = earliest, i = 0; m < latest; m += 30, i++) {
        const start = new Date();
        start.setHours(Math.floor(m / 60), m % 60, 0, 0);

        const end = new Date(start.getTime() + 30 * 60000);

        slots.push({ start, end, index: i });
    }
    return slots;
}

/* ============================================================================
   Tag blocks with slot indices for efficient assignment
============================================================================ */
function tagBlocksWithSlots(blocks, unifiedTimes) {
    blocks.forEach(block => {
        const s = U.parseTimeToMin(block.startTime);
        const e = U.parseTimeToMin(block.endTime);
        if (s == null || e == null) {
            block.slots = [];
            return;
        }

        const indices = [];
        unifiedTimes.forEach((slot, idx) => {
            const st = slot.start.getHours() * 60 + slot.start.getMinutes();
            if (st >= s && st < e) indices.push(idx);
        });

        block.slots = indices;
        block.divName = block.division; // convenience for SmartTiles
    });
}

/* ============================================================================
   EXPORT
============================================================================ */
NS.timegrid = {
    buildUnifiedTimes,
    tagBlocksWithSlots
};

})(typeof window !== "undefined" ? window : global);
