/* ===========================================================================
   scheduler_core_smarttiles.js

   FULL SMART TILE ENGINE
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
        const { activityProps, unifiedTimes, fieldUsage,
                findBestSpecial, findBestSport, findBestGeneral } = ctx;

        if (!label) return false;

        const norm = U.normalizeActivityName(label);

        let chosenField = null;
        let chosenSport = null;
        let chosenActivity = norm;

        /* SPORTS */
        if (norm === "sports" || norm === "sports slot" || norm === "sport") {
            const pick = findBestSport(block, ctx.allActivities, fieldUsage, null, activityProps);
            if (!pick) return false;

            chosenField = pick.field;
            chosenSport = pick.sport;
            chosenActivity = pick._activity;
        }

        /* SPECIAL */
        else if (norm === "special" || norm === "special activity") {
            const pick = findBestSpecial(block, ctx.allActivities, fieldUsage, null, activityProps);
            if (!pick) return false;

            chosenField = pick.field;
            chosenActivity = pick._activity;
        }

        /* DIRECT FIELD NAME */
        else {
            if (!F.canFit(block, norm, activityProps[norm], fieldUsage, unifiedTimes, norm))
                return false;
            chosenField = norm;
        }

        /* MARK USAGE */
        F.markUsage(block, chosenField, fieldUsage, chosenActivity);

        const schedule = global.scheduleAssignments[bunk];
        for (const idx of block.slots) {
            if (!schedule[idx]) {
                schedule[idx] = {
                    field: chosenField,
                    sport: chosenSport,
                    continuation: false,
                    _fixed: false,
                    _h2h: false,
                    _activity: chosenActivity
                };
            }
        }

        return true;
    }


    /* =======================================================================
       DETERMINE GENERATED vs PLACED
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

        const cat1 = FR.categoryForActivity(main1);
        const cat2 = FR.categoryForActivity(main2);

        if (cat1 && !cat2) return { generated: main1, placed: main2 };
        if (cat2 && !cat1) return { generated: main2, placed: main1 };

        return { generated: main1, placed: main2 };
    }


    /* =======================================================================
       RUN ONE SMART TILE GROUP
       ======================================================================= */

    function runGroup(blocks, ctx) {
        blocks.sort((a, b) => a.startTime - b.startTime);

        const divName = blocks[0].divName;
        const bunks = ctx.divisions[divName].bunks.slice();

        const sd = blocks[0].smartData;
        const { generated, placed } =
            determineSides(blocks, sd.fallbackFor, sd.fallbackActivity);

        const genCat = FR.categoryForActivity(generated);
        const fallbackCat = sd.fallbackActivity
            ? FR.categoryForActivity(sd.fallbackActivity)
            : null;

        const gotGeneratedCount = {};
        bunks.forEach(b => gotGeneratedCount[b] = 0);

        blocks.forEach((block, blockIndex) => {
            const isLast = (blockIndex === blocks.length - 1);
            const fairOrder =
                genCat ? FR.order(bunks, genCat) : bunks.slice();

            const gotGenerationThisBlock = {};

            /* PASS 1: Generated side in fairness order */
            for (const bunk of fairOrder) {
                if (gotGeneratedCount[bunk] >= 1) continue;
                if (gotGenerationThisBlock[bunk]) continue;

                if (tryAssignLabel(bunk, generated, block, ctx)) {
                    gotGenerationThisBlock[bunk] = true;
                    gotGeneratedCount[bunk]++;

                    if (genCat) FR.bump(bunk, genCat, 1);
                }
            }

            /* PASS 2: Everyone else gets placed or fallback */
            for (const bunk of bunks) {
                if (gotGenerationThisBlock[bunk]) continue;

                const schedule = global.scheduleAssignments[bunk];
                const alreadyFilled = block.slots.some(s => schedule[s]);
                if (alreadyFilled) continue;

                /* If they got generated earlier → MUST get placed now */
                if (gotGeneratedCount[bunk] > 0) {
                    tryAssignLabel(bunk, placed, block, ctx);
                    continue;
                }

                /* Last block fallback */
                if (isLast && sd.fallbackActivity) {
                    if (tryAssignLabel(bunk, sd.fallbackActivity, block, ctx)) {
                        if (fallbackCat) FR.bump(bunk, fallbackCat, 1);
                        continue;
                    }
                }

                /* Normal path → placed side */
                tryAssignLabel(bunk, placed, block, ctx);
            }
        });
    }


    /* =======================================================================
       MAIN EXPORT
       ======================================================================= */

    function run(groups, ctx) {
        Object.values(groups).forEach(blocks =>
            runGroup(blocks, ctx)
        );
    }

    NS.smarttiles = { run };

})(typeof window !== "undefined" ? window : global);
