// ============================================================================
// smart_logic_adapter.js  (VERSION 7.0)
// ----------------------------------------------------------------------------
// FEATURES:
//  • Detects Smart Tiles and automatically PAIRS them
//  • Supports smartData OR smartConfig
//  • Reads main1 / main2 / fallbackFor / fallbackActivity
//  • Computes special-activity capacity PER BLOCK
//  • Enforces pairing rules (if main1 in block1 → main2 in block2, etc.)
//  • Fairness by specialCount (lowest gets special first)
//  • Fallback (e.g. Sports) does NOT count as a “special”
//  • Output matches logic_core expectations exactly
// ----------------------------------------------------------------------------
// OUTPUT SHAPE TO LOGIC_CORE:
//
//    {
//       block1Assignments: { bunk : activityString },
//       block2Assignments: { bunk : activityString },
//       debug: { ...full trace }
//    }
//
// ============================================================================

(function () {
    "use strict";

    // =========================================================================
    // PUBLIC EXPORT
    // =========================================================================
    window.SmartLogicAdapter = {
        needsGeneration,
        preprocessSmartTiles,
        generateAssignments
    };

    // =========================================================================
    // 0. NEEDS GENERATION
    // =========================================================================
    function needsGeneration(name) {
        if (!name) return false;
        name = name.toLowerCase();
        return (
            name.includes("general activity") ||
            name.includes("special") ||
            name.includes("sport")
        );
    }

    // =========================================================================
    // 1. PREPROCESS SMART TILES — PAIRS TWO TILES TOGETHER
    // =========================================================================
    function preprocessSmartTiles(rawSkeleton, dailyAdjustments, masterSpecials) {
        console.log("SMART-ADAPTER: preprocessSmartTiles running…");

        const smartTiles = rawSkeleton.filter(t => t.type === "smart");

        if (smartTiles.length < 2) {
            console.warn("SMART-ADAPTER: Fewer than 2 smart tiles → cannot pair.");
            return [];
        }

        // Group tiles by division
        const byDiv = {};
        smartTiles.forEach(t => {
            if (!byDiv[t.division]) byDiv[t.division] = [];
            byDiv[t.division].push(t);
        });

        const jobs = [];

        Object.keys(byDiv).forEach(div => {
            const tiles = byDiv[div];

            // Sort tiles by start time so they pair correctly
            tiles.sort((a, b) => parseTime(a.startTime) - parseTime(b.startTime));

            if (tiles.length % 2 !== 0) {
                console.error("SMART-ADAPTER: Odd number of smart tiles in division", div);
                return;
            }

            for (let i = 0; i < tiles.length; i += 2) {
                const t1 = tiles[i];
                const t2 = tiles[i+1];

                const cfg1 = t1.smartData || t1.smartConfig;
                const cfg2 = t2.smartData || t2.smartConfig;

                if (!cfg1 || !cfg2) {
                    console.error("SMART-ADAPTER: Missing smartData in tile", t1, t2);
                    continue;
                }

                const start1 = parseTime(t1.startTime);
                const end1   = parseTime(t1.endTime);
                const start2 = parseTime(t2.startTime);
                const end2   = parseTime(t2.endTime);

                const job = {
                    tileId1: t1.id,
                    tileId2: t2.id,
                    division: div,

                    // Use FIRST tile’s configuration as the parent
                    main1: cfg1.main1,
                    main2: cfg1.main2,
                    fallbackFor: cfg1.fallbackFor,
                    fallbackActivity: cfg1.fallbackActivity,

                    // two-block Smart Tile
                    block1: { startMin: start1, endMin: end1 },
                    block2: { startMin: start2, endMin: end2 },

                    // Special-activity capacity
                    specialsBlock1: computeSpecialCapBlock(start1, end1, dailyAdjustments, masterSpecials),
                    specialsBlock2: computeSpecialCapBlock(start2, end2, dailyAdjustments, masterSpecials)
                };

                console.log("SMART-ADAPTER: Built job =", job);
                jobs.push(job);
            }
        });

        return jobs;
    }

    // =========================================================================
    // 2. COMPUTE SPECIAL CAPACITY PER BLOCK
    // =========================================================================
    function computeSpecialCapBlock(startMin, endMin, dailyAdjustments, masterSpecials) {
        const disabled = dailyAdjustments.disabledSpecials || [];

        const available = masterSpecials.filter(sp => !disabled.includes(sp.name));

        return available.map(sp => ({
            field: sp.name,
            capacity: sp.sharableWith?.type === "all"
                ? (sp.sharableWith.capacity || 2)
                : 1
        }));
    }

    // =========================================================================
    // 3. MAIN ASSIGNMENT ENGINE
    // =========================================================================
    function generateAssignments(bunks, job, historicalCounts = {}) {
        console.log("SMART-ADAPTER: generateAssignments", job);

        const debug = { job, bunks, historicalCounts };

        const main1 = job.main1;
        const main2 = job.main2;
        const fallbackFor = job.fallbackFor;
        const fallbackActivity = job.fallbackActivity;

        // identify special blocks
        const isMain1Special = main1.toLowerCase().includes("special");
        const isMain2Special = main2.toLowerCase().includes("special");

        // capacity per block
        const cap1 = sumCapacity(job.specialsBlock1);
        const cap2 = sumCapacity(job.specialsBlock2);

        debug.capacity = { cap1, cap2 };

        // fairness sort
        const sorted = [...bunks].sort((a, b) => {
            const ca = historicalCounts[a]?.specialCount || 0;
            const cb = historicalCounts[b]?.specialCount || 0;
            return ca - cb;
        });

        debug.sorted = sorted;

        const block1 = {};
        const block2 = {};

        let used1 = 0;
        let used2 = 0;

        // PASS 1: assign specials
        sorted.forEach(b => {
            if (isMain1Special && used1 < cap1) {
                block1[b] = main1;
                used1++;
            }
        });

        sorted.forEach(b => {
            if (isMain2Special && used2 < cap2) {
                block2[b] = main2;
                used2++;
            }
        });

        debug.afterSpecials = { block1: {...block1}, block2: {...block2} };

        // PASS 2: Pairing
        sorted.forEach(b => {
            const g1 = block1[b];
            const g2 = block2[b];

            // If main2 in block1 → force main1 in block2
            if (g1 === main2) block2[b] = main1;

            // If main1(special) in block1 → main2 in block2
            if (g1 === main1 && isMain1Special) block2[b] = main2;

            // If main2 in block2 → main1 in block1
            if (g2 === main2) block1[b] = main1;

            // If main1(special) in block2 → main2 in block1
            if (g2 === main1 && isMain1Special) block1[b] = main2;
        });

        debug.afterPairing = { block1: {...block1}, block2: {...block2} };

        // PASS 3: fill gaps
        sorted.forEach(b => {
            const g1 = block1[b];
            const g2 = block2[b];

            // case A — none assigned
            if (!g1 && !g2) {
                if (fallbackFor === main1) {
                    block1[b] = fallbackActivity;
                    block2[b] = main2;
                } else if (fallbackFor === main2) {
                    block1[b] = main1;
                    block2[b] = fallbackActivity;
                } else {
                    block1[b] = main1;
                    block2[b] = main2;
                }
                return;
            }

            // case B — only block1 empty
            if (g1 && !g2) {
                if (g1 === fallbackActivity) {
                    block2[b] = main2;
                } else {
                    block2[b] = main2;
                }
                return;
            }

            // case C — only block2 empty
            if (!g1 && g2) {
                if (g2 === fallbackActivity) {
                    block1[b] = main1;
                } else {
                    block1[b] = main1;
                }
                return;
            }
        });

        debug.final = { block1, block2 };

        return {
            block1Assignments: block1,
            block2Assignments: block2,
            debug
        };
    }

    // =========================================================================
    // HELPERS
    // =========================================================================

    function sumCapacity(list) {
        return list.reduce((s, f) => s + (f.capacity || 1), 0);
    }

    function parseTime(str) {
        if (!str) return 0;
        str = str.toLowerCase().trim();
        let mer = str.endsWith("pm") ? "pm" : "am";
        str = str.replace(/am|pm/g, "").trim();
        const [h, m] = str.split(":").map(n => parseInt(n));
        let hh = h;
        if (mer === "pm" && h !== 12) hh = h + 12;
        if (mer === "am" && h === 12) hh = 0;
        return hh * 60 + m;
    }

})();

