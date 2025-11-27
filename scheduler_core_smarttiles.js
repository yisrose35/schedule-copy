/* ===========================================================================
   scheduler_core_smarttiles.js  —  FIXED VERSION
   ---------------------------------------------------------------------------
   Fixes:
   - Uses event.division (not divName!)
   - Full safety for missing divisions or bunks
   - Prevents crashes when smartData is incomplete
   - Logs detailed errors but does NOT abort engine
   ===========================================================================*/

(function (global) {
"use strict";

const NS = global.SchedulerCore = global.SchedulerCore || {};
const U  = NS.utils;
const F  = NS.field;
const FR = NS.fairness;

/* ---------------------------------------------------------------------------
   TRY ASSIGN LABEL
--------------------------------------------------------------------------- */
function tryAssignLabel(bunk, label, block, ctx) {
    if (!label) return false;

    const { activityProps, unifiedTimes, fieldUsage,
            findBestSpecial, findBestSport } = ctx;

    const norm = U.normalizeActivityName(label);
    let chosenField = null;
    let chosenSport = null;
    let chosenActivity = norm;

    /* SPORTS */
    if (norm === "sports" || norm === "sport" || norm === "sports slot") {
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

    /* DIRECT FIELD NAME (Gameroom, Swim, etc.) */
    else {
        if (!F.canFit(block, norm, activityProps[norm], fieldUsage, unifiedTimes, norm))
            return false;

        chosenField = norm;
    }

    /* Mark usage */
    F.markUsage(block, chosenField, fieldUsage, chosenActivity);

    /* Write assignment */
    const schedule = global.scheduleAssignments[bunk];
    for (const i of block.slots) {
        if (!schedule[i]) {
            schedule[i] = {
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

/* ---------------------------------------------------------------------------
   DETERMINE GENERATED VS PAIRED SIDE
--------------------------------------------------------------------------- */
function determineSides(blocks, fallbackFor, fallbackActivity) {
    const sd = blocks[0].smartData;
    if (!sd) {
        console.warn("SMART TILE WARNING: smartData missing:", blocks);
        return { generated: null, placed: null };
    }

    const main1 = sd.main1;
    const main2 = sd.main2;
    const key   = U.normalizeKey;

    const m1 = key(main1);
    const m2 = key(main2);
    const fb = key(fallbackFor);

    /* Fallback target decides generated side */
    if (fb === m1) return { generated: main1, placed: main2 };
    if (fb === m2) return { generated: main2, placed: main1 };

    /* Heuristic fallback: special beats general */
    const cat1 = FR.categoryForActivity(main1);
    const cat2 = FR.categoryForActivity(main2);

    if (cat1 && !cat2) return { generated: main1, placed: main2 };
    if (cat2 && !cat1) return { generated: main2, placed: main1 };

    return { generated: main1, placed: main2 };
}

/* ---------------------------------------------------------------------------
   RUN ONE SMART TILE GROUP
--------------------------------------------------------------------------- */
function runGroup(blocks, ctx) {
    if (!blocks || !blocks.length) return;

    blocks.sort((a, b) => a.startTime - b.startTime);

    // FIX: builder produces "division", NOT "divName"
    const divName = blocks[0].division;

    // SAFETY:
    if (!divName || !ctx.divisions || !ctx.divisions[divName]) {
        console.error("SMART TILE ERROR: Division not found:", divName, ctx.divisions);
        return; // do NOT crash engine
    }

    const bunks = ctx.divisions[divName].bunks || [];
    if (!Array.isArray(bunks) || bunks.length === 0) {
        console.warn("SMART TILE: No bunks found in division:", divName);
        return;
    }

    const sd = blocks[0].smartData;
    if (!sd) {
        console.error("SMART TILE ERROR: smartData missing:", blocks[0]);
        return;
    }

    const { generated, placed } = determineSides(blocks, sd.fallbackFor, sd.fallbackActivity);

    const genCat = FR.categoryForActivity(generated);
    const fallbackCat = sd.fallbackActivity
        ? FR.categoryForActivity(sd.fallbackActivity)
        : null;

    const gotGeneratedCount = {};
    bunks.forEach(b => gotGeneratedCount[b] = 0);

    blocks.forEach((block, idx) => {
        const isLast = (idx === blocks.length - 1);

        const fairOrder = genCat ? FR.order(bunks, genCat) : bunks.slice();
        const givenGenerated = {};

        /* PASS 1 — give generated */
        for (const bunk of fairOrder) {
            if (gotGeneratedCount[bunk] >= 1) continue;
            if (givenGenerated[bunk]) continue;

            if (tryAssignLabel(bunk, generated, block, ctx)) {
                givenGenerated[bunk] = true;
                gotGeneratedCount[bunk]++;

                if (genCat) FR.bump(bunk, genCat, 1);
            }
        }

        /* PASS 2 — fill everyone else */
        for (const bunk of bunks) {
            if (givenGenerated[bunk]) continue;

            const sched = global.scheduleAssignments[bunk];
            const alreadyFilled = block.slots.some(s => sched[s]);
            if (alreadyFilled) continue;

            if (gotGeneratedCount[bunk] > 0) {
                tryAssignLabel(bunk, placed, block, ctx);
                continue;
            }

            if (isLast && sd.fallbackActivity) {
                if (tryAssignLabel(bunk, sd.fallbackActivity, block, ctx)) {
                    if (fallbackCat) FR.bump(bunk, fallbackCat, 1);
                    continue;
                }
            }

            tryAssignLabel(bunk, placed, block, ctx);
        }
    });
}

/* ---------------------------------------------------------------------------
   EXPORT
--------------------------------------------------------------------------- */
NS.smarttiles = {
    run(groups, ctx) {
        Object.values(groups).forEach(g => runGroup(g, ctx));
    }
};

})(typeof window !== "undefined" ? window : global);
