// ============================================================================
// SmartLogicAdapter V14
// - PAIRING UPDATE: Treats distinct Smart Tiles as linked pairs (A & B)
//   instead of splitting one tile. This respects gaps (lunch) and user layout.
// - Full fairness + special capacity
// - Swap & Fallback logic:
//   Block 1: Special fills to cap, rest get Open
//   Block 2: Swap (Ex-Special -> Open), New Candidates -> Special/Fallback
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

        // UPDATED: Find pairs of Smart Tiles and link them
        preprocessSmartTiles(rawSkeleton, dailyAdj, specials) {
            const jobs = [];

            // 1. Group by Division
            const tilesByDiv = {};
            rawSkeleton.forEach(t => {
                if (t.type === 'smart') {
                    if (!tilesByDiv[t.division]) tilesByDiv[t.division] = [];
                    tilesByDiv[t.division].push(t);
                }
            });

            // 2. Process Pairs
            Object.keys(tilesByDiv).forEach(div => {
                // Sort by start time to ensure Block A comes before Block B
                const tiles = tilesByDiv[div].sort((a, b) => parse(a.startTime) - parse(b.startTime));

                // Iterate in steps of 2
                for (let i = 0; i < tiles.length; i += 2) {
                    const tileA = tiles[i];
                    const tileB = tiles[i + 1]; // This is the linked partner

                    const sd = tileA.smartData || {};

                    if (!tileB) {
                        // Orphan tile (no partner). Treat as standalone Block A logic.
                        console.warn(`[SmartAdapter] Orphan Smart Tile found for ${div} at ${tileA.startTime}. No rotation partner.`);
                        jobs.push({
                            division: div,
                            main1: sd.main1,
                            main2: sd.main2,
                            fallbackFor: sd.fallbackFor,
                            fallbackActivity: sd.fallbackActivity,
                            blockA: { startMin: parse(tileA.startTime), endMin: parse(tileA.endTime), division: div },
                            blockB: null // No second block
                        });
                    } else {
                        // We have a pair! Link them.
                        // We use the config from Tile A for the pair.
                        jobs.push({
                            division: div,
                            main1: sd.main1,
                            main2: sd.main2,
                            fallbackFor: sd.fallbackFor,
                            fallbackActivity: sd.fallbackActivity,
                            blockA: { startMin: parse(tileA.startTime), endMin: parse(tileA.endTime), division: div },
                            blockB: { startMin: parse(tileB.startTime), endMin: parse(tileB.endTime), division: div }
                        });
                    }
                }
            });

            return jobs;
        },

        // MAIN LOGIC
        generateAssignments(bunks, job, historical = {}, specialNames = []) {

            const main1 = job.main1.trim();
            const main2 = job.main2.trim();
            // Safety: Ensure fallback exists
            const fbAct = job.fallbackActivity || "Sports";

            // 1. Identify which is the "Limited/Special" activity
            let specialAct = main1;
            let openAct = main2;

            const norm1 = main1.toLowerCase();
            const norm2 = main2.toLowerCase();
            
            const isSwim1 = norm1.includes('swim');
            const isSwim2 = norm2.includes('swim');
            
            // Explicit checks against known special names
            const isSpec1 = specialNames.includes(main1) || norm1.includes('special');
            const isSpec2 = specialNames.includes(main2) || norm2.includes('special');

            if (isSwim1 && !isSwim2) {
                // Strongest rule: If 1 is Swim, 2 MUST be Special (Open vs Special)
                specialAct = main2; 
                openAct = main1;
            } else if (isSwim2 && !isSwim1) {
                // Strongest rule: If 2 is Swim, 1 MUST be Special
                specialAct = main1; 
                openAct = main2;
            } else if (isSpec1 && !isSpec2) {
                specialAct = main1; 
                openAct = main2;
            } else if (isSpec2 && !isSpec1) {
                specialAct = main2; 
                openAct = main1;
            } else {
                // Default fallback: Main 2 is Special (arbitrary but consistent)
                specialAct = main2; 
                openAct = main1;
            }

            const cap = 2; // Fixed capacity per division-block for the "Special" activity

            // 2. Sort bunks by history (least played special goes first)
            // Added Math.random() for tie-breaking stability on identical history
            const sortedBunks = [...bunks].sort((a, b) => {
                const countA = historical[a]?.[specialAct] || 0;
                const countB = historical[b]?.[specialAct] || 0;
                if (countA !== countB) return countA - countB;
                return 0.5 - Math.random();
            });

            const block1 = {};
            const block2 = {};
            const bunksWhoGotSpecialInB1 = new Set();
            const bunksWhoGotOpenInB1 = new Set();

            // 3. Block 1 Assignment
            let countB1 = 0;
            for (const bunk of sortedBunks) {
                if (countB1 < cap) {
                    block1[bunk] = specialAct;
                    bunksWhoGotSpecialInB1.add(bunk);
                    countB1++;
                } else {
                    block1[bunk] = openAct;
                    bunksWhoGotOpenInB1.add(bunk);
                }
            }

            // 4. Block 2 Assignment (Only if Block B exists)
            if (job.blockB) {
                let countB2 = 0;
                
                // Group 1: People who had Special in B1 -> MUST go to Open (Swap)
                // They just had Special, so they go to Open.
                const groupFromSpecial = sortedBunks.filter(b => bunksWhoGotSpecialInB1.has(b));
                
                // Group 2: People who had Open in B1.
                // They CANNOT go to Open again. They want Special.
                const groupFromOpen = sortedBunks.filter(b => bunksWhoGotOpenInB1.has(b));
                
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
            }

            console.log(`[SmartAdapter] Div: ${job.division} | Special: ${specialAct} | Open: ${openAct} | Fallback: ${fbAct}`);
            console.log("Block 1:", block1);
            console.log("Block 2:", block2);

            return { block1Assignments: block1, block2Assignments: block2 };
        }
    };

    // ==============================================================
    // HELPERS
    // ==============================================================

    function parse(str) {
        if (!str) return 0;
        let s = str.trim().toLowerCase();
        let am = s.endsWith("am");
        let pm = s.endsWith("pm");
        s = s.replace(/am|pm/g, "").trim();
        const [h, m] = s.split(":").map(Number);
        let hh = h;
        if (pm && h !== 12) hh += 12;
        if (am && h === 12) hh = 0;
        return hh * 60 + (m || 0);
    }

})();
