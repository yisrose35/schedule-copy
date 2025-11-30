// ============================================================================
// SmartLogicAdapter V21
// - PAIRING UPDATE: Treats distinct Smart Tiles as linked pairs (A & B).
// - SPECIAL DETECTION FIX: Purely based on 'fallbackFor'.
// - DYNAMIC CAPACITY: Sums capacity of all resources matching the category.
// - RECALCULATION FIX: Calculates capacity independently for Block A and Block B.
// - Swap & Fallback logic:
//   Block 1: Special fills to cap A, rest get Open.
//   Block 2: Swap (Ex-Special -> Open), New Candidates -> Special (cap B)/Fallback.
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

        preprocessSmartTiles(rawSkeleton, dailyAdj, specials) {
            const jobs = [];
            const tilesByDiv = {};
            rawSkeleton.forEach(t => {
                if (t.type === 'smart') {
                    if (!tilesByDiv[t.division]) tilesByDiv[t.division] = [];
                    tilesByDiv[t.division].push(t);
                }
            });

            Object.keys(tilesByDiv).forEach(div => {
                const tiles = tilesByDiv[div].sort((a, b) => parse(a.startTime) - parse(b.startTime));
                for (let i = 0; i < tiles.length; i += 2) {
                    const tileA = tiles[i];
                    const tileB = tiles[i + 1]; 
                    const sd = tileA.smartData || {};

                    if (!tileB) {
                        console.warn(`[SmartAdapter] Orphan Smart Tile found for ${div} at ${tileA.startTime}. No rotation partner.`);
                        jobs.push({
                            division: div,
                            main1: sd.main1,
                            main2: sd.main2,
                            fallbackFor: sd.fallbackFor,
                            fallbackActivity: sd.fallbackActivity,
                            blockA: { startMin: parse(tileA.startTime), endMin: parse(tileA.endTime), division: div },
                            blockB: null 
                        });
                    } else {
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
        generateAssignments(bunks, job, historical = {}, specialNames = [], activityProperties = {}, masterFields = [], dailyFieldAvailability = {}) {

            const main1 = job.main1.trim();
            const main2 = job.main2.trim();
            const fbAct = job.fallbackActivity || "Sports";

            // 1. Identify "Limited/Special" activity based on FALLBACK TARGET
            let specialAct = main1;
            let openAct = main2;

            const fbFor = job.fallbackFor ? job.fallbackFor.trim() : "";
            
            if (isSameActivity(fbFor, main1)) {
                specialAct = main1;
                openAct = main2;
            } else if (isSameActivity(fbFor, main2)) {
                specialAct = main2;
                openAct = main1;
            } else {
                console.warn(`[SmartAdapter] Fallback target '${fbFor}' mismatch. Defaulting Main 2 (${main2}) as Special.`);
                specialAct = main2;
                openAct = main1;
            }

            // Helper to calculate capacity for a specific time range
            const calculateCapacityForBlock = (startMin, endMin) => {
                let totalCapacity = 0;
                const specialLower = specialAct.toLowerCase();
                
                const getResourceCap = (res) => {
                    if (res.sharableWith && res.sharableWith.capacity) return parseInt(res.sharableWith.capacity) || 1;
                    if (res.sharableWith && res.sharableWith.type === 'not_sharable') return 1;
                    if (res.sharableWith && res.sharableWith.type === 'all') return 2; 
                    if (res.sharable) return 2;
                    return 1;
                };

                // --- CATEGORY: SPORTS ---
                if (specialLower.includes('sport') || specialLower.includes('sports slot')) {
                    masterFields.forEach(f => {
                        const dailyRules = dailyFieldAvailability[f.name];
                        const globalRules = f.timeRules;
                        if (isTimeAvailable(startMin, endMin, f.available, dailyRules || globalRules)) {
                            totalCapacity += getResourceCap(f);
                        }
                    });
                }
                // --- CATEGORY: SPECIAL ACTIVITIES (GENERIC) ---
                else if (specialLower.includes('special activity') || specialLower === 'general activity slot') {
                    const allSpecials = window.getGlobalSpecialActivities ? window.getGlobalSpecialActivities() : [];
                    allSpecials.forEach(s => {
                        const dailyRules = dailyFieldAvailability[s.name];
                        const globalRules = s.timeRules;
                        if (isTimeAvailable(startMin, endMin, s.available, dailyRules || globalRules)) {
                            totalCapacity += getResourceCap(s);
                        }
                    });
                }
                // --- SPECIFIC NAMED ACTIVITY ---
                else {
                    const allSpecials = window.getGlobalSpecialActivities ? window.getGlobalSpecialActivities() : [];
                    const res = [...masterFields, ...allSpecials].find(r => isSameActivity(r.name, specialAct));
                    
                    if (res) {
                        const dailyRules = dailyFieldAvailability[res.name];
                        const globalRules = res.timeRules;
                        if (isTimeAvailable(startMin, endMin, res.available, dailyRules || globalRules)) {
                            totalCapacity = getResourceCap(res);
                        } else {
                            totalCapacity = 0; 
                        }
                    } else {
                        totalCapacity = 2; // Default fallback if not found
                    }
                }
                
                if (totalCapacity < 0) totalCapacity = 0;
                return totalCapacity;
            };

            // 2. Calculate Capacity for Block A
            const capA = calculateCapacityForBlock(job.blockA.startMin, job.blockA.endMin);
            console.log(`[SmartAdapter] Div: ${job.division} | Block A Cap: ${capA} for ${specialAct}`);

            // 3. Sort bunks by fairness
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

            // 4. Block 1 Assignment
            let countB1 = 0;
            for (const bunk of sortedBunks) {
                if (countB1 < capA) {
                    block1[bunk] = specialAct;
                    bunksWhoGotSpecialInB1.add(bunk);
                    countB1++;
                } else {
                    block1[bunk] = openAct;
                    bunksWhoGotOpenInB1.add(bunk);
                }
            }

            // 5. Block 2 Assignment (Only if Block B exists)
            if (job.blockB) {
                // RECALCULATE CAPACITY FOR BLOCK B
                const capB = calculateCapacityForBlock(job.blockB.startMin, job.blockB.endMin);
                console.log(`[SmartAdapter] Div: ${job.division} | Block B Cap: ${capB} for ${specialAct}`);

                let countB2 = 0;
                
                // Group 1: People who had Special in B1 -> MUST go to Open (Swap)
                const groupFromSpecial = sortedBunks.filter(b => bunksWhoGotSpecialInB1.has(b));
                
                // Group 2: People who had Open in B1 -> Candidates for Special
                const groupFromOpen = sortedBunks.filter(b => bunksWhoGotOpenInB1.has(b));
                
                // Assign Group 1 (Swap to Open)
                for (const bunk of groupFromSpecial) {
                    block2[bunk] = openAct; 
                }

                // Assign Group 2 (Fill Special to NEW Capacity, then Fallback)
                for (const bunk of groupFromOpen) {
                    if (countB2 < capB) {
                        block2[bunk] = specialAct;
                        countB2++;
                    } else {
                        // Overflow -> Fallback
                        block2[bunk] = fbAct;
                    }
                }
            }

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

    function isSameActivity(a, b) {
        if (!a || !b) return false;
        return a.trim().toLowerCase() === b.trim().toLowerCase();
    }

    function isTimeAvailable(startMin, endMin, baseAvail, rules = []) {
        if (!rules.length) return baseAvail !== false;
        
        const parsedRules = rules.map(r => ({
            type: r.type,
            s: parse(r.start),
            e: parse(r.end)
        }));

        const hasAvailableRules = parsedRules.some(r => r.type === 'Available');
        let isAvailable = !hasAvailableRules; 

        for (const r of parsedRules) {
            if (r.type === 'Available') {
                if (startMin >= r.s && endMin <= r.e) {
                    isAvailable = true; break;
                }
            }
        }
        for (const r of parsedRules) {
            if (r.type === 'Unavailable') {
                if (startMin < r.e && endMin > r.s) {
                    isAvailable = false; break;
                }
            }
        }
        return isAvailable;
    }

})();
