/* ===========================================================================
   scheduler_core_timegrid.js

   Responsible for:
   - Building the unified time grid
   - Handling start/end parsing
   - Splitting day into 30-minute increments
   - Removing illegal / tiny gaps
   - Producing slot objects:
       {
         index,
         startMin,
         endMin,
         label,         // "9:00 AM – 9:30 AM"
         startDate,     // Date object
         endDate
       }

   Exported API:
     SchedulerCore.timegrid.build(manualSkeleton, incrementMins = 30)

   Depends on:
     SchedulerCore.utils (from module 1)
   =========================================================================== */

(function (global) {
    "use strict";

    const NS = global.SchedulerCore = global.SchedulerCore || {};
    const U  = NS.utils;

    /* =======================================================================
       CONSTANTS
       ======================================================================= */

    const DEFAULT_INCREMENT = 30; // minutes


    /* =======================================================================
       INTERNAL HELPERS
       ======================================================================= */

    /** Convert minutes → Date object (Jan 1, 1970 baseline) */
    function minutesToDate(mins) {
        const d = new Date(1970, 0, 1, 0, 0, 0);
        d.setMinutes(mins);
        return d;
    }

    /** Build ranges from skeleton blocks */
    function collectRanges(manualSkeleton) {
        const ranges = [];

        manualSkeleton.forEach(item => {
            const s = U.parseTimeToMinutes(item.startTime);
            const e = U.parseTimeToMinutes(item.endTime);
            if (s != null && e != null && e > s) {
                ranges.push([s, e]);
            }
        });

        return ranges;
    }

    /** Find all distinct boundary points */
    function collectBoundaryPoints(ranges) {
        const pts = new Set();
        pts.add(8 * 60);   // force 8:00AM minimum safeguard (optional)
        pts.add(20 * 60);  // force 8:00PM max safeguard (optional)

        ranges.forEach(([s, e]) => {
            pts.add(s);
            pts.add(e);
        });

        return Array.from(pts).sort((a, b) => a - b);
    }

    /** Split into smaller increments */
    function explodeByIncrement(points, increment) {
        const exploded = [];

        for (let i = 0; i < points.length - 1; i++) {
            const start = points[i];
            const end   = points[i + 1];

            let cur = start;
            while (cur + increment <= end) {
                exploded.push([cur, cur + increment]);
                cur += increment;
            }
        }

        return exploded;
    }

    /** Remove micro-slots (less than full increment) */
    function filterTinySlots(exploded, increment) {
        return exploded.filter(([s, e]) => (e - s) >= increment);
    }


    /* =======================================================================
       MAIN BUILDER
       ======================================================================= */

    function buildTimeGrid(manualSkeleton, increment = DEFAULT_INCREMENT) {
        if (!Array.isArray(manualSkeleton) || manualSkeleton.length === 0) {
            return [];
        }

        // 1. Collect raw ranges
        const ranges = collectRanges(manualSkeleton);

        // 2. Collect distinct boundaries
        const boundaryPoints = collectBoundaryPoints(ranges);

        // 3. Explode ranges into consistent increment boundaries
        const exploded = explodeByIncrement(boundaryPoints, increment);

        // 4. Remove tiny gaps
        const cleaned = filterTinySlots(exploded, increment);

        // 5. Convert into final slot objects
        const grid = cleaned.map(([startMin, endMin], index) => ({
            index,
            startMin,
            endMin,
            startDate: minutesToDate(startMin),
            endDate: minutesToDate(endMin),
            label: `${U.minutesToLabel(startMin)} – ${U.minutesToLabel(endMin)}`
        }));

        return grid;
    }


    /* =======================================================================
       EXPORT
       ======================================================================= */

    NS.timegrid = {
        build: buildTimeGrid
    };

})(typeof window !== "undefined" ? window : global);
