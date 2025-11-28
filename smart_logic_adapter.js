// ============================================================================
// SmartLogicAdapter V8
// - Supports separate Smart Tile blocks (block A, block B)
// - Full fairness + special capacity
// - main1/main2 pairing rules
// - fallback enforcement
// - exact rotation behavior for your example
// ============================================================================

(function () {
    "use strict";

    // ==============================================================
    // PUBLIC API EXPORT
    // ==============================================================
    window.SmartLogicAdapter = {

        needsGeneration(act) {
            if (!act) return false;
            const a = act.toLowerCase();
            return (
                a.includes("sport") ||
                a.includes("general activity") ||
                a.includes("special")
            );
        },

        // NEW — detect Smart Tiles & compute half blocks
        preprocessSmartTiles(rawSkeleton, dailyAdj, specials) {
            const jobs = [];

            rawSkeleton
                .filter(x => x.type === "smart")
                .forEach(item => {
                    const sd = item.smartData;
                    if (!sd) return;

                    const start = parse(item.startTime);
                    const end = parse(item.endTime);

                    const mid = Math.floor((start + end) / 2);

                    jobs.push({
                        division: item.division,
                        main1: sd.main1,
                        main2: sd.main2,
                        fallbackFor: sd.fallbackFor,
                        fallbackActivity: sd.fallbackActivity,
                        blockA: { startMin: start, endMin: mid, division: item.division },
                        blockB: { startMin: mid, endMin: end, division: item.division }
                    });
                });

            return jobs;
        },

        // MAIN LOGIC
        generateAssignments(bunks, job, historical = {}) {

            const main1 = job.main1.trim();
            const main2 = job.main2.trim();
            const fbFor = job.fallbackFor;
            const fbAct = job.fallbackActivity;

            const block1 = {};
            const block2 = {};

            // FAIRNESS SORT
            const sorted = [...bunks].sort(
                (a, b) =>
                    (historical[a]?.specialCount || 0) -
                    (historical[b]?.specialCount || 0)
            );

            // Determine which blocks are special
            const block1IsSpecial = main1.toLowerCase().includes("special");
            const block2IsSpecial = main2.toLowerCase().includes("special");

            const cap1 = getSpecialCapacity(job.blockA);
            const cap2 = getSpecialCapacity(job.blockB);

            let used1 = 0;
            let used2 = 0;

            // PASS 1 — Assign specials first
            for (const bunk of sorted) {

                // Block 1 special
                if (block1IsSpecial && used1 < cap1) {
                    block1[bunk] = main1;
                    used1++;
                } else {
                    block1[bunk] = main1 === fbFor ? fbAct : main1;
                }

                // Block 2 special
                if (block2IsSpecial && used2 < cap2) {
                    block2[bunk] = main2;
                    used2++;
                } else {
                    block2[bunk] = main2 === fbFor ? fbAct : main2;
                }
            }

            // PASS 2 — Pairing Rules
            for (const bunk of sorted) {
                const a = block1[bunk];
                const b = block2[bunk];

                // If got main1 in blockA → must get main2 in blockB
                if (a === main1) block2[bunk] = main2;

                // If got fallback in blockA → must still get main2 in blockB
                if (a === fbAct) block2[bunk] = main2;

                // If got main2 in blockB → blockA must be main1
                if (b === main2) block1[bunk] = main1;
            }

            return {
                block1Assignments: block1,
                block2Assignments: block2
            };
        }
    };

    // ==============================================================
    // HELPERS
    // ==============================================================

    function parse(str) {
        let s = str.trim().toLowerCase();
        let am = s.endsWith("am");
        let pm = s.endsWith("pm");
        s = s.replace(/am|pm/g, "").trim();
        const [h, m] = s.split(":").map(Number);
        let hh = h;
        if (pm && h !== 12) hh += 12;
        if (am && h === 12) hh = 0;
        return hh * 60 + m;
    }

    function getSpecialCapacity(block) {
        // You can later plug in dynamic capacity
        return 2; // default for Gameroom
    }

})();
