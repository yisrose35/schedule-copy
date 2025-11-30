// ============================================================================
// SmartLogicAdapter V28
// - EVEN SPREAD UPGRADE: Added a "Total History" tie-breaker.
//   If two bunks are tied for the specific activity (e.g. both 0 Tennis),
//   the one with LESS total history (across all sports/specials) wins.
// - ROBUST BUCKETING: "Tennis" counts as "Sports". "Art" counts as "Special".
//   Prevents kids from hopping between categories daily while others get nothing.
// - PAIRING & CAPACITY: Retains V27 logic for A/B blocks and dynamic summing.
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
            
            // Helper: Get counts for the SPECIFIC category (Sports vs Special)
            const getCategoryHistory = (bunk, activityName) => {
                if (!historical[bunk]) return 0;
                
                let sum = 0;
                const lowerName = activityName.toLowerCase();
                const allSpecials = window.getGlobalSpecialActivities ? window.getGlobalSpecialActivities() : [];

                // Detect Type
                const isSpecialType = 
                    specialNames.includes(activityName) || 
                    allSpecials.some(s => isSameActivity(s.name, activityName)) ||
                    lowerName.includes('special');

                // It is a sport if it matches masterFields OR has 'sport' in name
                const isSportType = 
                    !isSpecialType && (
                        lowerName.includes('sport') ||
                        masterFields.some(f => isSameActivity(f.name, activityName))
                    );

                if (isSpecialType) {
                    // Sum ALL special activities
                    allSpecials.forEach(s => {
                        if (historical[bunk][s.name]) sum += historical[bunk][s.name];
                    });
                    if (historical[bunk]["Special Activity"]) sum += historical[bunk]["Special Activity"];
                    if (historical[bunk]["Special Activity Slot"]) sum += historical[bunk]["Special Activity Slot"];
                    // Catch-all for specific name
                    if (historical[bunk][activityName]) sum += historical[bunk][activityName];
                } 
                else if (isSportType) {
                    // Sum ALL sports
                    masterFields.forEach(f => {
                        if (historical[bunk][f.name]) sum += historical[bunk][f.name];
                    });
                    if (historical[bunk]["Sports"]) sum += historical[bunk]["Sports"];
                    if (historical[bunk]["Sports Slot"]) sum += historical[bunk]["Sports Slot"];
                    // Catch-all
                    if (historical[bunk][activityName] && !masterFields.some(f => isSameActivity(f.name, activityName))) {
                         sum += historical[bunk][activityName];
                    }
                } 
                else {
                    // Exact Match Only (Unknown category)
                    if (historical[bunk][activityName]) sum += historical[bunk][activityName];
                }

                return sum;
            };

            // Helper: Get TOTAL history of "Good Stuff" (Tie-Breaker)
            // This ensures if Bunk A got Tennis (Sport) and Bunk B got nothing, Bunk B wins the Art (Special) slot.
            const getTotalHistory = (bunk) => {
                if (!historical[bunk]) return 0;
                let total = 0;
                
                // Sum generic buckets
                if (historical[bunk]["Sports"]) total += historical[bunk]["Sports"];
                if (historical[bunk]["Special Activity"]) total += historical[bunk]["Special Activity"];
                
                // Sum all known sports
                masterFields.forEach(f => {
                    if (historical[bunk][f.name]) total += historical[bunk][f.name];
                });
                
                // Sum all known specials
                const allSpecials = window.getGlobalSpecialActivities ? window.getGlobalSpecialActivities() : [];
                allSpecials.forEach(s => {
                    if (historical[bunk][s.name]) total += historical[bunk][s.name];
                });

                return total;
            };

            // SORT: 1. Category Count -> 2. Total Count -> 3. Random
            const sortedBunks = [...bunks].sort((a, b) => {
                // Priority 1: Have you done THIS specific type of thing?
                const catA = getCategoryHistory(a, specialAct);
                const catB = getCategoryHistory(b, specialAct);
                if (catA !== catB) return catA - catB;
                
                // Priority 2: Have you done ANYTHING cool recently? (Spread the wealth)
                const totA = getTotalHistory(a);
                const totB = getTotalHistory(b);
                if (totA !== totB) return totA - totB;

                // Priority 3: Random Shuffle
                return 0.5 - Math.random();
            });

            // --------------------------------------------------------
            // ASSIGNMENT LOGIC
            // --------------------------------------------------------

            const block1 = {};
            const block2 = {};
            const bunksWhoGotSpecialInB1 = new Set();
            const bunksWhoGotOpenInB1 = new Set();
            
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
                    bunksWhoGotOpenInB1.add(bunk);
                }
            }

            // 4. Block 2 Assignment
            if (job.blockB) {
                const capB = calculateCapacityForBlock(job.blockB.startMin, job.blockB.endMin);
                console.log(`[SmartAdapter] Div: ${job.division} | Block B Cap: ${capB} for ${specialAct}`);

                let countB2 = 0;
                
                const mustSwapToOpen = [];
                const candidatesForSpecial = [];

                // Sort candidates by the SAME fairness logic
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
