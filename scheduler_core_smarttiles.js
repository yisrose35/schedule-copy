/* ===========================================================================
   scheduler_core_smarttiles.js

   FULL SMART TILE ENGINE
   ----------------------
   Handles:
     - Grouping Smart Tile blocks by (division + main1/main2 signature)
     - Determining which side is "generated" (special/gameroom/etc.)
     - Determining which side is "paired" (swim, sports, etc.)
     - Fairness ordering: lowest historical usage → gets generated side first
     - Preventing double-generated assignments within same Smart Tile group
     - Enforcing rule: "If a bunk got generated in block A, they MUST get paired in block B"
     - Last-block fallback logic (use fallbackActivity if no generated was given)
     - Capacity & rule checking via SchedulerCore.field.canFit
     - Usage marking via SchedulerCore.field.markUsage
     - Fairness usage bumping via SchedulerCore.fairness.bump

   API:
     SchedulerCore.smarttiles.run(groups, ctx)

   ctx contains:
     {
        divisions,
        unifiedTimes,
        fieldUsage,
        activityProps,
        fairness,
        allActivities,
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
    const FR  = NS.fairness;

    /* =======================================================================
       TRY TO ASSIGN ONE SMART TILE LABEL
       ======================================================================= */

    function tryAssignLabel(bunk, label, block, ctx) {
        const { activityProps, unifiedTimes, fieldUsage, findBestSpecial, findBestSport, findBestGeneral } = ctx;

        if (!label) return false;
        const norm = U.normalizeActivityName(label);

        let chosenField = null;
        let chosenSport = null;
        let chosenActivity = norm;

        /* --------------------------------------------------------------
           1. SPORTS TILE
           -------------------------------------------------------------- */
        if (norm === "sports" || norm === "sports slot" || norm === "sport") {
            const pick = findBestSport(block, ctx.allActivities, fieldUsage, null, activityProps);
            if (!pick) return false;

            chosenField = pick.field;
            chosenSport = pick.sport;
            chosenActivity = pick._activity;
        }

        /* --------------------------------------------------------------
           2. GENERIC SPECIAL BUCKET (Special Activity)
           -------------------------------------------------------------- */
        else if (norm === "special" || norm === "special activity") {
            const pick = findBestSpecial(block, ctx.allActivities, fieldUsage, null, activityProps);
            if (!pick) return false;

            chosenField = pick.field;
            chosenActivity = pick._activity;
        }

        /* --------------------------------------------------------------
           3. DIRECT FIELD NAME (Gameroom, Swim, Canteen, etc.)
           -------------------------------------------------------------- */
        else {
            if (!F.canFit(block, norm, activityProps[norm], fieldUsage, unifiedTimes, norm))
                return false;
            chosenField = norm;
        }

        /* --------------------------------------------------------------
           If fully valid, mark usage
           -------------------------------------------------------------- */
        F.markUsage(block, chosenField, fieldUsage, chosenActivity);

        // Place schedule tile
        const schedule = global.scheduleAssignments[bunk];
        for (const idx of block.slots) {
            if (!schedule[idx]) {
                schedule[idx] = {
                    field: chosenField,
                    sport: chosenSport,
                    continuation: false, // continuation handled upstream
                    _fixed: false,
                    _h2h: false,
                    _activity: chosenActivity
                };
            }
        }

        return true;
    }


    /* =======================================================================
       DETERMINE WHICH MAIN IS GENERATED VS PAIRED
       ======================================================================= */

    function determineSides(blocks, fallbackFor, fallbackActivity) {
        const first = blocks[0];
        const sd = first.smartData;

        const main1 = sd.main1;
        const main2 = sd.main2;

        const key = U.normalizeKey;

        const m1 = key(main1);
        const m2 = key(main2);
        const fb = key(fallbackFor);

        if (fb && fb === m1) return { generated: main1, placed: main2 };
        if (fb && fb === m2) return { generated: main2, placed: main1 };

        // Heuristic: special vs non-special
        const cat1 = FR.categoryForActivity(main1);
        const cat2 = FR.categoryForActivity(main2);

        if (cat1 && !cat2) return { generated: main1, placed: main2 };
        if (cat2 && !cat1) return { generated: main2, placed: main1 };

        // Default fallback
        return { generated: main1, placed: main2 };
    }


    /* =======================================================================
       RUN SMART TILE GROUP
       ======================================================================= */

    function runGroup(blocks, ctx) {
        blocks.sort((a, b) => a.startTime - b.startTime);

        const divName = blocks[0].divName;
        const bunks = ctx.divisions[divName].bunks.slice();

        const sd = blocks[0].smartData;
        const { generated, placed } = determineSides(blocks, sd.fallbackFor, sd.fallbackActivity);

        const genCat = FR.categoryForActivity(generated);
        const fallbackCat = sd.fallbackActivity
            ? FR.categoryForActivity(sd.fallbackActivity)
            : null;

        // Track if bunk has already received the generated side
        const gotGeneratedCount = {};
        bunks.forEach(b => gotGeneratedCount[b] = 0);

        blocks.forEach((block, blockIndex) => {
            const isLast = (blockIndex === blocks.length - 1);
            const fairOrder = genCat ? FR.order(bunks, genCat) : bunks.slice();
            const gotGenerationThisBlock = {};

            /* -----------------------------------------------------------
               PASS 1: Try to give generated side in fairness order
               ----------------------------------------------------------- */
            for (const bunk of fairOrder) {
                if (gotGeneratedCount[bunk] >= 1) continue; // can't double-generate
                if (gotGenerationThisBlock[bunk]) continue;

                if (tryAssignLabel(bunk, generated, block, ctx)) {
                    gotGenerationThisBlock[bunk] = true;
                    gotGeneratedCount[bunk] += 1;

                    if (genCat) FR.bump(bunk, genCat, 1);
                }
            }

            /* -----------------------------------------------------------
               PASS 2: Everyone else gets placed / fallback
               ----------------------------------------------------------- */
            for (const bunk of bunks) {
                if (gotGenerationThisBlock[bunk]) continue;

                const schedule = global.scheduleAssignments[bunk];
                const alreadyFilled = block.slots.some(s => schedule[s]);
                if (alreadyFilled) continue;

                // If they got generated earlier → MUST get placed now
                if (gotGeneratedCount[bunk] > 0) {
                    tryAssignLabel(bunk, placed, block, ctx);
                    continue;
                }

                // If they never got generated, and this is the last Smart block
                if (isLast && sd.fallbackActivity) {
                    if (tryAssignLabel(bunk, sd.fallbackActivity, block, ctx)) {
                        if (fallbackCat) FR.bump(bunk, fallbackCat, 1);
                        continue;
                    }
                }

                // Normal behavior → give placed side
                tryAssignLabel(bunk, placed, block, ctx);
            });
        });
    }


    /* =======================================================================
       MAIN EXPORT
       ======================================================================= */

    function run(groups, ctx) {
        Object.values(groups).forEach(blocks => runGroup(blocks, ctx));
    }

    NS.smarttiles = { run };

})(typeof window !== "undefined" ? window : global);
