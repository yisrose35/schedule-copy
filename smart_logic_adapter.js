// ============================================================================
// SmartLogicAdapter V10
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

            // 1. Identify which is the "Limited/Special" activity
            let specialAct = main1;
            let openAct = main2;

            const norm1 = main1.toLowerCase();
            const norm2 = main2.toLowerCase();
            
            const isSwim1 = norm1.includes('swim');
            const isSwim2 = norm2.includes('swim');
            
            const isSpec1 = specialNames.includes(main1) || norm1.includes('special');
            const isSpec2 = specialNames.includes(main2) || norm2.includes('special');

            if (isSpec1 && !isSpec2) {
                specialAct = main1; openAct = main2;
            } else if (isSpec2 && !isSpec1) {
                specialAct = main2; openAct = main1;
            } else if (isSwim1 && !isSwim2) {
                // If 1 is Swim, 2 is Special (Swim is almost always the Open one)
                specialAct = main2; openAct = main1;
            } else if (isSwim2 && !isSwim1) {
                // If 2 is Swim, 1 is Special
                specialAct = main1; openAct = main2;
            } else {
                // Default fallback: Main 2 is Special (arbitrary but consistent)
                specialAct = main2; openAct = main1;
            }

            const cap = 2; // Fixed capacity per division-block for the "Special" activity

            // 2. Sort bunks by history (least played special goes first)
            const sortedBunks = [...bunks].sort((a, b) => {
                const countA = historical[a]?.[specialAct] || 0;
                const countB = historical[b]?.[specialAct] || 0;
                return countA - countB;
            });

            const block1 = {};
            const block2 = {};
            const bunksWhoGotSpecialInB1 = new Set();

            // 3. Block 1 Assignment
            let countB1 = 0;
            for (const bunk of sortedBunks) {
                if (countB1 < cap) {
                    block1[bunk] = specialAct;
                    bunksWhoGotSpecialInB1.add(bunk);
                    countB1++;
                } else {
                    block1[bunk] = openAct;
                }
            }

            // 4. Block 2 Assignment
            let countB2 = 0;
            
            // Group 1: People who had Special in B1 -> MUST go to Open
            const groupFromSpecial = sortedBunks.filter(b => bunksWhoGotSpecialInB1.has(b));
            
            // Group 2: People who had Open in B1 -> Priority for Special
            // Re-sort them by fairness just in case, though original sort likely holds
            const groupFromOpen = sortedBunks.filter(b => !bunksWhoGotSpecialInB1.has(b));
            
            // Assign Group 1 (Swap to Open)
            for (const bunk of groupFromSpecial) {
                block2[bunk] = openAct; 
            }

            // Assign Group 2 (Fill Special, then Fallback)
            for (const bunk of groupFromOpen) {
                if (countB2 < cap) {
                    block2[bunk] = specialAct;
                    countB2++;
                } else {
                    // Overflow -> Fallback
                    block2[bunk] = fbAct;
                }
            }

            return { block1Assignments: block1, block2Assignments: block2 };
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
