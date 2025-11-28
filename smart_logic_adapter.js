// ============================================================================
// smart_logic_adapter.js  (SMART TILES v7 — Pairs of Tiles, Not Split Tiles)
// ============================================================================
//
// RULES:
//  • Smart Tiles are not split.
//  • Consecutive Smart Tiles for the SAME division become a block pair.
//  • jobs[] contains: block1 = tile1, block2 = tile2
//  • Odd leftover Smart Tiles are ignored.
//  • main1 / main2 / fallback apply normally.
//  • Capacity is based on special sharability.
//
// ============================================================================

(function () {
    "use strict";

    // ---------------------------------------------
    // PUBLIC API
    // ---------------------------------------------
    window.SmartLogicAdapter = {
        needsGeneration,
        preprocessSmartTiles,
        generateAssignments
    };

    // ---------------------------------------------
    // Does this activity require scheduling logic?
    // ---------------------------------------------
    function needsGeneration(actName) {
        if (!actName) return false;
        const s = actName.toLowerCase();
        return (
            s.includes("sport") ||
            s.includes("general activity") ||
            s.includes("ga") ||
            s.includes("special")
        );
    }

    // ---------------------------------------------
    // STEP 1:
    // Group Smart Tiles → Pair consecutive ones → Create Block1 + Block2 SmartJobs
    // ---------------------------------------------
    function preprocessSmartTiles(rawSkeleton, dailyAdjustments, masterSpecials) {
        console.log("ADAPTER-DEBUG: Preprocess SmartTiles — pairing mode");

        const allSmart = rawSkeleton.filter(x => x.type === "smart");
        if (allSmart.length === 0) return [];

        // Sort by division + time
        const byDivision = {};

        allSmart.forEach(item => {
            if (!byDivision[item.division]) byDivision[item.division] = [];
            byDivision[item.division].push(item);
        });

        // sort per division by startTime
        Object.values(byDivision).forEach(list => {
            list.sort((a, b) => parseTime(a.startTime) - parseTime(b.startTime));
        });

        const jobs = [];

        // pair them
        for (const [div, tiles] of Object.entries(byDivision)) {
            for (let i = 0; i < tiles.length - 1; i += 2) {

                const t1 = tiles[i];
                const t2 = tiles[i + 1];

                if (!t1.smartData || !t2.smartData) continue;

                const start1 = parseTime(t1.startTime);
                const end1   = parseTime(t1.endTime);
                const start2 = parseTime(t2.startTime);
                const end2   = parseTime(t2.endTime);

                jobs.push({
                    tileId1: t1.id,
                    tileId2: t2.id,
                    division: div,

                    main1 : t1.smartData.main1,
                    main2 : t1.smartData.main2,
                    fallbackFor     : t1.smartData.fallbackFor,
                    fallbackActivity: t1.smartData.fallbackActivity,

                    block1: { startMin: start1, endMin: end1 },
                    block2: { startMin: start2, endMin: end2 },

                    specialsBlock1: computeSpecialCapacity(start1, end1, dailyAdjustments, masterSpecials),
                    specialsBlock2: computeSpecialCapacity(start2, end2, dailyAdjustments, masterSpecials)
                });
            }
        }

        console.log("ADAPTER-DEBUG: SmartJobs =", jobs);
        return jobs;
    }

    // ---------------------------------------------
    // SPECIAL CAPACITY for each block
    // ---------------------------------------------
    function computeSpecialCapacity(startMin, endMin, dailyAdjustments, masterSpecials) {

        const disabled = dailyAdjustments.disabledSpecials || [];

        return masterSpecials
            .filter(s => !disabled.includes(s.name))
            .map(s => ({
                name: s.name,
                capacity: (s.sharableWith?.type === "all") ? 2 : 1
            }));
    }

    // ---------------------------------------------
    // STEP 2:
    // Build block1Assignments + block2Assignments using Fairness + Capacity
    // ---------------------------------------------
    function generateAssignments(bunks, job, historical = {}) {

        const { main1, main2, fallbackFor, fallbackActivity } = job;

        const block1Assign = {};
        const block2Assign = {};

        // FAIRNESS sort (lowest specials first)
        const sorted = [...bunks].sort(
            (a, b) =>
                (historical[a]?.specialCount || 0) -
                (historical[b]?.specialCount || 0)
        );

        const cap1 = job.specialsBlock1.reduce((s, o) => s + o.capacity, 0);
        const cap2 = job.specialsBlock2.reduce((s, o) => s + o.capacity, 0);

        let used1 = 0;
        let used2 = 0;

        const isSpecial1 = main1.toLowerCase().includes("special");
        const isSpecial2 = main2.toLowerCase().includes("special");

        // PASS 1: Assign specials by fairness
        for (const bunk of sorted) {
            if (isSpecial1 && used1 < cap1) {
                block1Assign[bunk] = main1;
                used1++;
            } else {
                block1Assign[bunk] =
                    fallbackFor === main1 ? fallbackActivity : main2;
            }

            if (isSpecial2 && used2 < cap2) {
                block2Assign[bunk] = main2;
                used2++;
            } else {
                block2Assign[bunk] =
                    fallbackFor === main2 ? fallbackActivity : main1;
            }
        }

        return {
            block1Assignments: block1Assign,
            block2Assignments: block2Assign,
            debug: { used1, used2, cap1, cap2 }
        };
    }

    // Helpers
    function parseTime(str) {
        if (!str) return 0;
        let s = str.trim().toLowerCase();
        let mer = null;
        if (s.endsWith("am") || s.endsWith("pm")) {
            mer = s.endsWith("am") ? "am" : "pm";
            s = s.replace(/am|pm/, "").trim();
        }
        const m = s.match(/^(\d\d?):(\d\d)$/);
        if (!m) return 0;
        let hh = parseInt(m[1], 10);
        const mm = parseInt(m[2], 10);
        if (mer === "pm" && hh !== 12) hh += 12;
        if (mer === "am" && hh === 12) hh = 0;
        return hh * 60 + mm;
    }

})();
