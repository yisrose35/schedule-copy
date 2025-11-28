// ============================================================================
// SmartLogicAdapter V9
// - Supports separate Smart Tile blocks (block A, block B)
// - Full fairness + special capacity
// - Updated for "Swap & Fallback" logic:
//   Block 1: Special fills to cap, rest get Open
//   Block 2: Swaps! Open people get Special (to cap), rest get Fallback
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
        generateAssignments(bunks, job, historical = {}, specialNames = []) {

            const main1 = job.main1.trim();
            const main2 = job.main2.trim();
            const fbFor = job.fallbackFor;
            const fbAct = job.fallbackActivity;

            // Determine which activity is the "Special" one (limited capacity)
            // It could be Main 1 or Main 2.
            // Priority: Explicit match in specialNames list, OR includes 'special' in text.
            const isSpecial1 = specialNames.includes(main1) || main1.toLowerCase().includes("special");
            const isSpecial2 = specialNames.includes(main2) || main2.toLowerCase().includes("special");

            let specialAct = null;
            let openAct = null;

            // Heuristic: If both special, pick one? Or if only one is special?
            // Usually Smart Tiles are "Open vs Special".
            // If both are open (e.g. Swim vs Sports), treating one as "Special" forces strict rotation.
            if (isSpecial1 && !isSpecial2) {
                specialAct = main1;
                openAct = main2;
            } else if (isSpecial2 && !isSpecial1) {
                specialAct = main2;
                openAct = main1;
            } else {
                // Both special or both open. Treat Main 2 as the "Special" target for logic purposes
                specialAct = main2;
                openAct = main1;
            }

            const cap = 2; // Hardcoded limit for the "Special" activity (per division)

            const block1 = {};
            const block2 = {};

            // FAIRNESS SORT
            // Sort by who has done the "Special" activity the least
            const sorted = [...bunks].sort(
                (a, b) =>
                    (historical[a]?.[specialAct] || 0) -
                    (historical[b]?.[specialAct] || 0)
            );

            // TRACKING
            const assignedToSpecialInBlock1 = new Set();

            // === BLOCK 1 LOGIC ===
            // Fill Special up to capacity. Rest go to Open.
            let usedCap1 = 0;
            
            for (const bunk of sorted) {
                if (usedCap1 < cap) {
                    block1[bunk] = specialAct;
                    assignedToSpecialInBlock1.add(bunk);
                    usedCap1++;
                } else {
                    block1[bunk] = openAct;
                }
            }

            // === BLOCK 2 LOGIC ===
            // 1. People who did Special in Block 1 MUST go to Open/Swap (Priority 1)
            // 2. People who did Open in Block 1 SHOULD go to Special (Priority 2)
            //    BUT if Special is full, they go to Fallback.
            
            let usedCap2 = 0;

            // We iterate bunks again to assign Block 2. 
            // We want to prioritize filling the Special with NEW people.
            
            // Filter bunks who didn't get special in Block 1
            const waitingForSpecial = bunks.filter(b => !assignedToSpecialInBlock1.has(b));
            // Sort them again by fairness just in case (though list order is roughly fair already)
            waitingForSpecial.sort(
                (a, b) => (historical[a]?.[specialAct] || 0) - (historical[b]?.[specialAct] || 0)
            );

            // Assign them first
            for (const bunk of waitingForSpecial) {
                if (usedCap2 < cap) {
                    block2[bunk] = specialAct;
                    usedCap2++;
                } else {
                    // Special is full! They must take fallback.
                    // If the Special matches the 'fallbackFor' target, give fallback.
                    // Otherwise give the fallback activity directly.
                    block2[bunk] = fbAct;
                }
            }

            // Now handle the people who DID get special in Block 1
            const hadSpecial = bunks.filter(b => assignedToSpecialInBlock1.has(b));
            for (const bunk of hadSpecial) {
                // They swap to Open
                block2[bunk] = openAct;
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

})();
