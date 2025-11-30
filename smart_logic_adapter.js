// ============================================================================
// SmartLogicAdapter V29
// - TIERED FAIRNESS (STREAK BREAKER): 
//   Introduced "Banded" sorting. Instead of strict A < B, we treat counts
//   within a small range (e.g., 0 vs 1) as EQUAL and use a random tie-breaker.
//   This prevents the same bunk from winning Block 1 four days in a row just
//   to "catch up" by 1 point.
// - BAND WIDTHS:
//   * Activity History: Bands of 2 (0-1, 2-3, etc. are ties).
//   * Total History: Bands of 4 (Breaks ties based on general fairness).
// - ROBUST CATEGORIES: Retains V28's "Sports" vs "Special" grouping.
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
            
            // 1. Group by Division
            rawSkeleton.forEach(t => {
                if (t.type === 'smart') {
                    if (!tilesByDiv[t.division]) tilesByDiv[t.division] = [];
                    tilesByDiv[t.division].push(t);
                }
            });

            // 2. Process Pairs
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

            // Helper to calculate capacity
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
                        totalCapacity = 2; // Default if unknown
                    }
                }
                
                if (totalCapacity < 0) totalCapacity = 0;
                return totalCapacity;
            };

            // --------------------------------------------------------
            // HISTORY & FAIRNESS LOGIC (UPGRADED)
            // --------------------------------------------------------
            
            const getCategoryHistory = (bunk, activityName) => {
                if (!historical[bunk]) return 0;
                
                let sum = 0;
                const lowerName = activityName.toLowerCase();
                const allSpecials = window.getGlobalSpecialActivities ? window.getGlobalSpecialActivities() : [];

                const isSpecialType = 
                    specialNames.includes(activityName) || 
                    allSpecials.some(s => isSameActivity(s.name, activityName)) ||
                    lowerName.includes('special');

                const isSportType = 
                    !isSpecialType && (
                        lowerName.includes('sport') ||
                        masterFields.some(f => isSameActivity(f.name, activityName))
                    );

                if (isSpecialType) {
                    allSpecials.forEach(s => {
                        if (historical[bunk][s.name]) sum += historical[bunk][s.name];
                    });
                    if (historical[bunk]["Special Activity"]) sum += historical[bunk]["Special Activity"];
                    if (historical[bunk]["Special Activity Slot"]) sum += historical[bunk]["Special Activity Slot"];
                    if (historical[bunk][activityName]) sum += historical[bunk][activityName];
                } 
                else if (isSportType) {
                    masterFields.forEach(f => {
                        if (historical[bunk][f.name]) sum += historical[bunk][f.name];
                    });
                    if (historical[bunk]["Sports"]) sum += historical[bunk]["Sports"];
                    if (historical[bunk]["Sports Slot"]) sum += historical[bunk]["Sports Slot"];
                    if (historical[bunk][activityName] && !masterFields.some(f => isSameActivity(f.name, activityName))) {
                         sum += historical[bunk][activityName];
                    }
                } 
                else {
                    if (historical[bunk][activityName]) sum += historical[bunk][activityName];
                }
                return sum;
            };

            const getTotalHistory = (bunk) => {
                if (!historical[bunk]) return 0;
                let total = 0;
                if (historical[bunk]["Sports"]) total += historical[bunk]["Sports"];
                if (historical[bunk]["Special Activity"]) total += historical[bunk]["Special Activity"];
                masterFields.forEach(f => {
                    if (historical[bunk][f.name]) total += historical[bunk][f.name];
                });
                const allSpecials = window.getGlobalSpecialActivities ? window.getGlobalSpecialActivities() : [];
                allSpecials.forEach(s => {
                    if (historical[bunk][s.name]) total += historical[bunk][s.name];
                });
                return total;
            };

            // SORT: 1. Category Count (TIERED) -> 2. Total Count (TIERED) -> 3. Random
            // This prevents the "Sticky Winner" problem.
            const sortedBunks = [...bunks].sort((a, b) => {
                const catA = getCategoryHistory(a, specialAct);
                const catB = getCategoryHistory(b, specialAct);
                
                // TIER 1: Activity Fairness (Band size: 2)
                // Treat 0 and 1 as equal. Treat 2 and 3 as equal.
                // This stops 0 from beating 1 100% of the time, allowing for rotation.
                const bandCat = 2;
                const diffCat = Math.floor(catA / bandCat) - Math.floor(catB / bandCat);
                if (diffCat !== 0) return diffCat;
                
                // TIER 2: Global Fairness (Band size: 4)
                // If activity history is "tied" (fuzzy), look at total history.
                // Treat 20, 21, 22, 23 as equal.
                const totA = getTotalHistory(a);
                const totB = getTotalHistory(b);
                const bandTot = 4;
                const diffTot = Math.floor(totA / bandTot) - Math.floor(totB / bandTot);
                if (diffTot !== 0) return diffTot;

                // TIER 3: Coin Flip
                // If both are in the same fairness bands, randomize it.
                return 0.5 - Math.random();
            });

            // --------------------------------------------------------
            // ASSIGNMENT LOGIC
            // --------------------------------------------------------

            const block1 = {};
            const block2 = {};
            const bunksWhoGotSpecialInB1 = new Set();
            
            // 3. Block 1 Assignment
            const capA = calculateCapacityForBlock(job.blockA.startMin, job.blockA.endMin);
            console.log(`[SmartAdapter] Div: ${job.division} | Block A Cap: ${capA} for ${specialAct}`);

            let countB1 = 0;
            for (const bunk of sortedBunks) {
                if (countB1 < capA) {
                    block1[bunk] = specialAct;
                    bunksWhoGotSpecialInB1.add(bunk);
                    countB1++;
                } else {
                    block1[bunk] = openAct;
                }
            }

            // 4. Block 2 Assignment
            if (job.blockB) {
                const capB = calculateCapacityForBlock(job.blockB.startMin, job.blockB.endMin);
                console.log(`[SmartAdapter] Div: ${job.division} | Block B Cap: ${capB} for ${specialAct}`);

                let countB2 = 0;
                
                const mustSwapToOpen = [];
                const candidatesForSpecial = [];

                // Strict Rotation for Block 2: 
                // B1 winners go to back of line. Everyone else fights for B2 spots.
                sortedBunks.forEach(bunk => {
                    if (bunksWhoGotSpecialInB1.has(bunk)) {
                        mustSwapToOpen.push(bunk);
                    } else {
                        candidatesForSpecial.push(bunk);
                    }
                });

                // Step A: Force swappers to Open
                mustSwapToOpen.forEach(bunk => {
                    block2[bunk] = openAct;
                });

                // Step B: Fill Special from the Candidates list
                candidatesForSpecial.forEach(bunk => {
                    if (countB2 < capB) {
                        block2[bunk] = specialAct;
                        countB2++;
                    } else {
                        block2[bunk] = fbAct;
                    }
                });
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
        if (!rules || !rules.length) return baseAvail !== false;
        
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
