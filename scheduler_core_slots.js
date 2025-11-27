/* ===========================================================================
   scheduler_core_slots.js

   Handles **standard** schedulable blocks:
     - General Activity Slot
     - Sports Slot
     - Special Activity
     - Fallback (General Activity)
     - "Free" if nothing fits

   Called AFTER:
     - Pinned blocks
     - Split blocks
     - Smart Tiles
     - League & Specialty League

   API:
     SchedulerCore.slots.assign(blocks, ctx)

   ctx includes:
     {
        unifiedTimes,
        fieldUsage,
        activityProps,
        allActivities,
        h2hActivities,
        fairness,
        findBestSpecial,
        findBestSport,
        findBestGeneral
     }

   =========================================================================== */

(function (global) {
    "use strict";

    const NS  = global.SchedulerCore = global.SchedulerCore || {};
    const U   = NS.utils;
    const F   = NS.field;

    /* =======================================================================
       INTERNAL: TRY PLACE BLOCK
       ======================================================================= */

    function placePick(block, bunk, pick, ctx) {
        if (!pick) return false;

        const { unifiedTimes, fieldUsage, activityProps } = ctx;
        const fieldName = pick.field;
        const activity = pick._activity || pick.field;

        if (!fieldName) return false;

        // Validate field-level fit
        if (!F.canFit(block, fieldName, activityProps[fieldName], fieldUsage, unifiedTimes, activity))
            return false;

        // Mark usage
        F.markUsage(block, fieldName, fieldUsage, activity);

        // Write into schedule
        const schedule = global.scheduleAssignments[bunk];
        block.slots.forEach((slotIndex, idx) => {
            if (!schedule[slotIndex]) {
                schedule[slotIndex] = {
                    field: fieldName,
                    sport: pick.sport || null,
                    continuation: idx > 0,
                    _activity: activity,
                    _h2h: false,
                    _fixed: false
                };
            }
        });

        return true;
    }


    /* =======================================================================
       INTERNAL: ASSIGN SINGLE BLOCK
       ======================================================================= */

    function assignSingle(block, ctx) {
        const bunk = block.bunk;
        if (!bunk) return;

        const schedule = global.scheduleAssignments[bunk];

        // Skip if first slot already filled (pinned, smart tile, league, etc.)
        if (schedule[block.slots[0]]) return;

        let pick = null;

        /* --------------------------------------------------------------
           1. SPECIAL ACTIVITY
           -------------------------------------------------------------- */
        if (block.event === "Special Activity") {
            pick = ctx.findBestSpecial(
                block,
                ctx.allActivities,
                ctx.fieldUsage,
                null,
                ctx.activityProps
            );
        }

        /* --------------------------------------------------------------
           2. SPORTS SLOT
           -------------------------------------------------------------- */
        else if (block.event === "Sports Slot") {
            pick = ctx.findBestSport(
                block,
                ctx.allActivities,
                ctx.fieldUsage,
                null,
                ctx.activityProps
            );
        }

        /* --------------------------------------------------------------
           3. GENERAL ACTIVITY SLOT
           -------------------------------------------------------------- */
        else if (block.event === "General Activity Slot") {
            pick = ctx.findBestGeneral(
                block,
                ctx.allActivities,
                ctx.h2hActivities,
                ctx.fieldUsage,
                null,
                ctx.activityProps
            );
        }

        /* --------------------------------------------------------------
           If pick exists but doesn't fit (capacity/time/etc.) → null
           -------------------------------------------------------------- */
        if (pick) {
            const fname = pick.field;
            if (!F.canFit(
                block,
                fname,
                ctx.activityProps[fname],
                ctx.fieldUsage,
                ctx.unifiedTimes,
                pick._activity || fname
            )) {
                pick = null;
            }
        }

        /* --------------------------------------------------------------
           4. Fallback chain:
              Special → Sports → General → Free
           -------------------------------------------------------------- */
        if (!pick) {
            // Try GA first for fallback
            const fallbackGA = ctx.findBestGeneral(
                block,
                ctx.allActivities,
                ctx.h2hActivities,
                ctx.fieldUsage,
                null,
                ctx.activityProps
            );
            if (fallbackGA) pick = fallbackGA;
        }

        if (pick) {
            if (placePick(block, bunk, pick, ctx)) return;
        }

        /* --------------------------------------------------------------
           5. Place FREE if EVERYTHING failed
           -------------------------------------------------------------- */
        for (const slotIndex of block.slots) {
            if (!schedule[slotIndex]) {
                schedule[slotIndex] = {
                    field: "Free",
                    sport: null,
                    continuation: false,
                    _activity: "Free",
                    _fixed: false,
                    _h2h: false
                };
            }
        }
    }


    /* =======================================================================
       PUBLIC: ASSIGN ALL REMAINING BLOCKS
       ======================================================================= */

    function assign(blocks, ctx) {
        // Sort by start-time so earlier items get priority
        blocks.sort((a, b) => a.startTime - b.startTime);

        for (const block of blocks) {
            if (!block.slots || !block.slots.length) continue;
            if (!global.scheduleAssignments[block.bunk]) continue;
            assignSingle(block, ctx);
        }
    }


    /* =======================================================================
       EXPORT
       ======================================================================= */

    NS.slots = {
        assign
    };

})(typeof window !== "undefined" ? window : global);
