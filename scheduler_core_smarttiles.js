/* ===========================================================================
   scheduler_core_smarttiles.js  (HARDENED VERSION)
   ---------------------------------------------------------------------------
   Fixes integrated:

   ✓ Prevent crash when division missing
   ✓ Prevent crash when blocks malformed
   ✓ Prevent crash when smartData missing
   ✓ Skip invalid Smart Tile groups safely
   ✓ Validate bunks exist before scheduling
   ✓ Validate field usage + ctx presence

   ALL logic unchanged — only stability fixes.
   =========================================================================== */

(function (global) {
    "use strict";

    const NS  = global.SchedulerCore = global.SchedulerCore || {};
    const U   = NS.utils;
    const F   = NS.field;
    const FR  = NS.fairness;

    if (!global.scheduleAssignments)
        global.scheduleAssignments = {};

    /* =======================================================================
       TRY TO ASSIGN ONE SMART TILE LABEL (sports, specials, swim, etc.)
       ======================================================================= */
    function tryAssignLabel(bunk, label, block, ctx) {
        if (!bunk || !label || !block || !ctx) return false;

        const {
            activityProps,
            unifiedTimes,
            fieldUsage,
            allActivities,
            findBestSpecial,
            findBestSport,
            findBestGeneral
        } = ctx;

        const norm = U.normalizeActivityName(label);

        // ensure bunk schedule exists
        if (!global.scheduleAssignments[bunk])
            global.scheduleAssignments[bunk] = [];

        let chosenField = null;
        let chosenSport = null;
        let chosenActivity = norm;

        /* --------------------------------------------------------------
           SPORTS
           -------------------------------------------------------------- */
        if (norm === "sports" || norm === "sports slot" || norm === "sport") {
            const pick = findBestSport?.(block, allActivities, fieldUsage, null, activityProps);
            if (!pick) return false;

            chosenField = pick.field;
            chosenSport = pick.sport;
            chosenActivity = pick._activity;
        }

        /* --------------------------------------------------------------
           SPECIAL ACTIVITIES
           -------------------------------------------------------------- */
        else if (norm === "special" || norm === "special activity") {
            const pick = findBestSpecial?.(block, allActivities, fieldUsage, null, activityProps);
            if (!pick) return false;

            chosenField = pick.field;
            chosenActivity = pick._activity;
        }

        /* --------------------------------------------------------------
           DIRECT FIELD NAME (Gameroom, Swim, Canteen, Library, etc.)
           -------------------------------------------------------------- */
        else {
            const props = activityProps[norm] || {};
            if (!F.canFit?.(block, norm, props, fieldUsage, unifiedTimes, norm))
                return false;

            chosenField = norm;
        }

        /* --------------------------------------------------------------
           Mark usage
           -------------------------------------------------------------- */
        F.markUsage?.(block, chosenField, fieldUsage, chosenActivity);

        /* --------------------------------------------------------------
           Apply schedule assignments
           -------------------------------------------------------------- */
        for (const idx of block.slots) {
            global.scheduleAssignments[bunk][idx] = {
                field: chosenField,
                sport: chosenSport,
                continuation: false,
                _fixed: false,
                _h2h: false,
                _activity: chosenActivity
            };
        }

        return true;
    }


    /* =======================================================================
       DETERMINE WHICH MAIN IS GENERATED VS PAIRED
       ======================================================================= */
    function determineSides(blocks, fallbackFor, fallbackActivity) {
        const first = blocks[0];
        if (!first || !first.smartData) {
            return { generated: null, placed: null };
        }

        const sd = first.smartData;

        const main1 = sd.main1;
        const main2 = sd.main2;

        if (!main1 || !main2)
            return { generated: main1, placed: main2 };

        const key = U.normalizeKey;

        const m1 = key(main1);
        const m2 = key(main2);
        const fb = key(fallbackFor);

        // user-specified fallbackFor
        if (fb && fb === m1) return { generated: main1, placed: main2 };
        if (fb && fb === m2) return { generated: main2, placed: main1 };

        // decide by category (special > non-special)
        const cat1 = FR.categoryForActivity?.(main1);
        const cat2 = FR.categoryForActivity?.(main2);

        if (cat1 && !cat2) return { generated: main1, placed: main2 };
        if (cat2 && !cat1) return { generated: main2, placed: main1 };

        // fallback
        return { generated: main1, placed: main2 };
    }


    /* =======================================================================
       RUN ONE SMART TILE GROUP
       ======================================================================= */
    function runGroup(blocks, ctx) {

        // -------- SAFETY CHECK 1: invalid block array --------
        if (!Array.isArray(blocks) || blocks.length === 0) {
            console.warn("SMART TILE: Empty or invalid block group:", blocks);
            return;
        }

        // sort blocks by time
        blocks.sort((a, b) => (a.startTime || 0) - (b.startTime || 0));

        const first = blocks[0];

        // -------- SAFETY CHECK 2: smartData exists --------
        if (!first.smartData) {
            console.warn("SMART TILE: Block missing smartData:", first);
            return;
        }

        const divName = first.divName;

        // -------- SAFETY CHECK 3: Division must exist --------
        if (!ctx.divisions || !ctx.divisions[divName]) {
            console.error("SMART TILE ERROR: Division not found:", divName, ctx.divisions);
            return;
        }

        const divObj = ctx.divisions[divName];
        const bunks = Array.isArray(divObj.bunks) ? divObj.bunks.slice() : [];

        if (bunks.length === 0) {
            console.warn("SMART TILE: No bunks found for division:", divName);
            return;
        }

        const sd = first.smartData;

        const { generated, placed } = determineSides(blocks, sd.fallbackFor, sd.fallbackActivity);

        const genCat = FR.categoryForActivity?.(generated);
        const fbCat  = sd.fallbackActivity ? FR.categoryForActivity?.(sd.fallbackActivity) : null;

        // track which bunks already got generated
        const gotGeneratedCount = {};
        bunks.forEach(b => gotGeneratedCount[b] = 0);

        // LOOP THROUGH BLOCKS
        blocks.forEach((block, idx) => {
            const isLast = (idx === blocks.length - 1);

            // fairness order based on category
            const fairOrder = genCat ? FR.order?.(bunks, genCat) : bunks.slice();

            const gotGenerationThisBlock = {};

            /* -----------------------------------------------------------
               PASS 1 — attempt generated side
            ----------------------------------------------------------- */
            for (const bunk of fairOrder) {
                if (gotGeneratedCount[bunk] >= 1) continue;
                if (gotGenerationThisBlock[bunk]) continue;

                if (tryAssignLabel(bunk, generated, block, ctx)) {
                    gotGenerationThisBlock[bunk] = true;
                    gotGeneratedCount[bunk]++;

                    if (genCat) FR.bump?.(bunk, genCat, 1);
                }
            }

            /* -----------------------------------------------------------
               PASS 2 — placed or fallback
            ----------------------------------------------------------- */
            for (const bunk of bunks) {
                if (gotGenerationThisBlock[bunk]) continue;

                const schedule = global.scheduleAssignments[bunk];
                const alreadyFilled = block.slots.some(s => schedule[s]);
                if (alreadyFilled) continue;

                // if previously got generated — must get placed now
                if (gotGeneratedCount[bunk] > 0) {
                    tryAssignLabel(bunk, placed, block, ctx);
                    continue;
                }

                // last block fallback
                if (isLast && sd.fallbackActivity) {
                    if (tryAssignLabel(bunk, sd.fallbackActivity, block, ctx)) {
                        if (fbCat) FR.bump?.(bunk, fbCat, 1);
                        continue;
                    }
                }

                // otherwise normal placed
                tryAssignLabel(bunk, placed, block, ctx);
            }
        });
    }


    /* =======================================================================
       MAIN EXPORT
       ======================================================================= */
    function run(groups, ctx) {
        if (!groups || typeof groups !== "object") return;

        Object.values(groups).forEach(blocks => {
            try {
                runGroup(blocks, ctx);
            } catch (err) {
                console.error("SMART TILE GROUP FAILED:", err, blocks);
            }
        });
    }

    NS.smarttiles = { run };

})(typeof window !== "undefined" ? window : global);
