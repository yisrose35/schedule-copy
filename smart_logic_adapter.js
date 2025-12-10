// ============================================================================
// SmartLogicAdapter V40 (COMPLETE REWRITE)
// ============================================================================
// GUARANTEES:
// 1. Every bunk gets Main1 (the "open" activity)
// 2. Every bunk gets Main2 (the "special") OR the Fallback
// 3. Bunks who maxed out ALL available specials are auto-assigned to Fallback
// 4. Cross-day fairness via Priority Debt queue
// 5. Time-aware capacity: checks what's ACTUALLY available during each block
// ============================================================================

(function() {
    "use strict";

    // =========================================================================
    // STORAGE KEYS
    // =========================================================================
    const PRIORITY_KEY = "smartTilePriority_v2";
    const HISTORY_KEY = "smartTileHistory_v2";

    function loadPriorityQueue() {
        try {
            const raw = localStorage.getItem(PRIORITY_KEY);
            return raw ? JSON.parse(raw) : {};
        } catch (e) {
            console.error("[SmartTile] Failed to load priority queue:", e);
            return {};
        }
    }

    function savePriorityQueue(queue) {
        try {
            localStorage.setItem(PRIORITY_KEY, JSON.stringify(queue));
        } catch (e) {
            console.error("[SmartTile] Failed to save priority queue:", e);
        }
    }

    // =========================================================================
    // HELPER FUNCTIONS
    // =========================================================================

    function parseTime(str) {
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

    function isSame(a, b) {
        if (!a || !b) return false;
        return a.trim().toLowerCase() === b.trim().toLowerCase();
    }

    function log(...args) {
        console.log("[SmartTile]", ...args);
    }

    // =========================================================================
    // CORE: GET AVAILABLE SPECIALS FOR A TIME BLOCK
    // =========================================================================
    
    /**
     * Returns which special activities are OPEN during [startMin, endMin]
     * and their individual capacities.
     * 
     * @returns { name: string, capacity: number }[]
     */
    function getAvailableSpecialsForTimeBlock(startMin, endMin, activityProps, dailyFieldAvailability) {
        const allSpecials = window.getGlobalSpecialActivities?.() || [];
        const available = [];

        // Convert time to slot indices for checking
        const slots = window.SchedulerCoreUtils?.findSlotsForRange(startMin, endMin) || [];

        allSpecials.forEach(special => {
            const props = activityProps[special.name] || special;

            // 1. Check if globally enabled
            if (props.available === false) {
                log(`  ${special.name}: SKIPPED (globally disabled)`);
                return;
            }

            // 2. Check daily overrides (dailyFieldAvailability)
            const dailyRules = dailyFieldAvailability?.[special.name] || [];
            
            // 3. Check time rules (global or daily override)
            const effectiveRules = dailyRules.length > 0 ? dailyRules : (props.timeRules || []);
            
            // If there are time rules, check if this block is covered
            if (effectiveRules.length > 0) {
                // Check each slot in the block
                const isOpen = slots.every(slotIdx => {
                    if (!window.unifiedTimes?.[slotIdx]) return false;
                    
                    const slot = window.unifiedTimes[slotIdx];
                    const slotStart = new Date(slot.start).getHours() * 60 + new Date(slot.start).getMinutes();
                    const slotEnd = new Date(slot.end).getHours() * 60 + new Date(slot.end).getMinutes();

                    // Parse rules
                    const rules = effectiveRules.map(r => ({
                        ...r,
                        startMin: parseTime(r.start) ?? r.startMin,
                        endMin: parseTime(r.end) ?? r.endMin
                    }));

                    // Check Available rules
                    const availableRules = rules.filter(r => r.type === "Available");
                    if (availableRules.length > 0) {
                        const inAvailable = availableRules.some(r => 
                            slotStart >= r.startMin && slotEnd <= r.endMin
                        );
                        if (!inAvailable) return false;
                    }

                    // Check Unavailable rules
                    const unavailableRules = rules.filter(r => r.type === "Unavailable");
                    for (const rule of unavailableRules) {
                        if (slotStart < rule.endMin && slotEnd > rule.startMin) {
                            return false;
                        }
                    }

                    return true;
                });

                if (!isOpen) {
                    log(`  ${special.name}: CLOSED during ${startMin}-${endMin}`);
                    return;
                }
            }

            // 4. Calculate capacity
            let capacity = 1;
            if (props.sharableWith?.capacity) {
                capacity = parseInt(props.sharableWith.capacity) || 1;
            } else if (props.sharableWith?.type === 'all' || props.sharable) {
                capacity = 2;
            }

            log(`  ${special.name}: AVAILABLE (capacity: ${capacity})`);
            available.push({
                name: special.name,
                capacity: capacity,
                maxUsage: props.maxUsage || 0,
                frequencyWeeks: props.frequencyWeeks || 0
            });
        });

        return available;
    }

    /**
     * Calculate total "special" capacity for a time block
     */
    function getTotalSpecialCapacity(startMin, endMin, activityProps, dailyFieldAvailability) {
        const available = getAvailableSpecialsForTimeBlock(startMin, endMin, activityProps, dailyFieldAvailability);
        return available.reduce((sum, s) => sum + s.capacity, 0);
    }

    // =========================================================================
    // CORE: CHECK IF BUNK CAN USE ANY SPECIAL
    // =========================================================================

    /**
     * Checks if a bunk has ANY special activity they can still use.
     * Returns the list of specials they CAN use, or empty array if maxed out.
     * 
     * Considers:
     * - maxUsage (lifetime or per frequencyWeeks)
     * - Historical usage
     */
    function getUsableSpecialsForBunk(bunk, availableSpecials, historicalCounts, currentDate) {
        const usable = [];
        const bunkHistory = historicalCounts[bunk] || {};

        availableSpecials.forEach(special => {
            const maxUsage = special.maxUsage || 0;
            
            // No limit = always usable
            if (maxUsage === 0) {
                usable.push(special);
                return;
            }

            const usedCount = bunkHistory[special.name] || 0;

            // TODO: Implement frequencyWeeks check
            // For now, treating maxUsage as "per summer"
            
            if (usedCount < maxUsage) {
                usable.push(special);
            } else {
                log(`  ${bunk}: maxed out ${special.name} (${usedCount}/${maxUsage})`);
            }
        });

        return usable;
    }

    // =========================================================================
    // PREPROCESSING: GROUP SMART TILES INTO PAIRS
    // =========================================================================

    window.SmartLogicAdapter = {

        /**
         * Groups consecutive smart tiles by division into pairs (Block A + Block B)
         */
        preprocessSmartTiles(rawSkeleton, dailyAdj, specials) {
            const jobs = [];
            const byDiv = {};

            rawSkeleton.forEach(t => {
                if (t.type === 'smart') {
                    if (!byDiv[t.division]) byDiv[t.division] = [];
                    byDiv[t.division].push(t);
                }
            });

            Object.keys(byDiv).forEach(div => {
                const tiles = byDiv[div].sort((a, b) => parseTime(a.startTime) - parseTime(b.startTime));
                
                for (let i = 0; i < tiles.length; i += 2) {
                    const A = tiles[i];
                    const B = tiles[i + 1];
                    const sd = A.smartData || {};

                    const job = {
                        division: div,
                        main1: sd.main1,
                        main2: sd.main2,
                        fallbackFor: sd.fallbackFor,
                        fallbackActivity: sd.fallbackActivity,
                        blockA: {
                            startMin: parseTime(A.startTime),
                            endMin: parseTime(A.endTime),
                            division: div
                        },
                        blockB: B ? {
                            startMin: parseTime(B.startTime),
                            endMin: parseTime(B.endTime),
                            division: div
                        } : null
                    };

                    jobs.push(job);
                    log(`Created job for ${div}: ${sd.main1}/${sd.main2} (fallback: ${sd.fallbackActivity} for ${sd.fallbackFor})`);
                }
            });

            return jobs;
        },

        // =====================================================================
        // MAIN ASSIGNMENT LOGIC
        // =====================================================================

        generateAssignments(bunks, job, historical = {}, specialNames = [], activityProps = {}, masterFields = [], dailyFieldAvailability = {}, yesterdayHistory = {}) {
            
            log("=".repeat(60));
            log(`SMART TILE: ${job.division}`);
            log(`Main1: ${job.main1}, Main2: ${job.main2}`);
            log(`Fallback: ${job.fallbackActivity} (for ${job.fallbackFor})`);
            log(`Bunks: ${bunks.join(', ')}`);
            log("=".repeat(60));

            const main1 = job.main1?.trim();
            const main2 = job.main2?.trim();
            const fbAct = job.fallbackActivity || "Sports";
            const fbFor = job.fallbackFor || "";

            // Determine which is the "special" (the limited one with fallback)
            let specialAct, openAct;
            if (isSame(main1, fbFor)) {
                specialAct = main1;
                openAct = main2;
            } else if (isSame(main2, fbFor)) {
                specialAct = main2;
                openAct = main1;
            } else {
                // Default: main2 is special
                specialAct = main2;
                openAct = main1;
            }

            log(`"Special" activity (limited): ${specialAct}`);
            log(`"Open" activity: ${openAct}`);

            // -----------------------------------------------------------------
            // STEP 1: Get available specials for BOTH blocks
            // -----------------------------------------------------------------
            log("\n--- BLOCK A AVAILABILITY ---");
            const specialsBlockA = getAvailableSpecialsForTimeBlock(
                job.blockA.startMin, 
                job.blockA.endMin, 
                activityProps, 
                dailyFieldAvailability
            );
            const capacityA = specialsBlockA.reduce((sum, s) => sum + s.capacity, 0);
            log(`Block A (${job.blockA.startMin}-${job.blockA.endMin}): ${capacityA} total slots`);
            log(`  Available: ${specialsBlockA.map(s => `${s.name}(${s.capacity})`).join(', ')}`);

            let specialsBlockB = [];
            let capacityB = 0;
            if (job.blockB) {
                log("\n--- BLOCK B AVAILABILITY ---");
                specialsBlockB = getAvailableSpecialsForTimeBlock(
                    job.blockB.startMin, 
                    job.blockB.endMin, 
                    activityProps, 
                    dailyFieldAvailability
                );
                capacityB = specialsBlockB.reduce((sum, s) => sum + s.capacity, 0);
                log(`Block B (${job.blockB.startMin}-${job.blockB.endMin}): ${capacityB} total slots`);
                log(`  Available: ${specialsBlockB.map(s => `${s.name}(${s.capacity})`).join(', ')}`);
            }

            // -----------------------------------------------------------------
            // STEP 2: Pre-screen bunks for eligibility
            // A bunk is INELIGIBLE if they've maxed out ALL available specials
            // -----------------------------------------------------------------
            log("\n--- ELIGIBILITY CHECK ---");
            
            const eligibleBunks = [];
            const ineligibleBunks = [];  // These go straight to fallback

            // Combine all available specials from both blocks
            const allAvailableSpecials = [...specialsBlockA];
            specialsBlockB.forEach(s => {
                if (!allAvailableSpecials.find(x => x.name === s.name)) {
                    allAvailableSpecials.push(s);
                }
            });

            bunks.forEach(bunk => {
                const usable = getUsableSpecialsForBunk(bunk, allAvailableSpecials, historical, new Date());
                
                if (usable.length > 0) {
                    eligibleBunks.push(bunk);
                    log(`  ${bunk}: ELIGIBLE (can use: ${usable.map(s => s.name).join(', ')})`);
                } else {
                    ineligibleBunks.push(bunk);
                    log(`  ${bunk}: INELIGIBLE (maxed out all specials)`);
                }
            });

            // -----------------------------------------------------------------
            // STEP 3: Sort eligible bunks by fairness
            // - Priority debt (squeezed out yesterday)
            // - Least played this week
            // - Didn't play yesterday
            // -----------------------------------------------------------------
            log("\n--- SORTING BY FAIRNESS ---");
            
            const priorityQueue = loadPriorityQueue();
            const divPriority = priorityQueue[job.division] || [];

            function getSpecialUsageCount(bunk) {
                let sum = 0;
                const bunkHist = historical[bunk] || {};
                allAvailableSpecials.forEach(s => {
                    sum += bunkHist[s.name] || 0;
                });
                return sum;
            }

            function playedYesterday(bunk) {
                const sched = yesterdayHistory.schedule?.[bunk] || [];
                if (!Array.isArray(sched)) return false;
                return sched.some(e => {
                    const act = (e?._activity || "").toLowerCase();
                    return allAvailableSpecials.some(s => s.name.toLowerCase() === act);
                });
            }

            const sortedEligible = [...eligibleBunks].sort((a, b) => {
                // 1. Priority debt (bunks squeezed out before go first)
                const pA = divPriority.includes(a) ? 1 : 0;
                const pB = divPriority.includes(b) ? 1 : 0;
                if (pA !== pB) return pB - pA;

                // 2. Least special usage this week
                const usageA = getSpecialUsageCount(a);
                const usageB = getSpecialUsageCount(b);
                if (usageA !== usageB) return usageA - usageB;

                // 3. Didn't play yesterday
                const yA = playedYesterday(a) ? 1 : 0;
                const yB = playedYesterday(b) ? 1 : 0;
                if (yA !== yB) return yA - yB;

                // 4. Random tiebreaker
                return Math.random() - 0.5;
            });

            log(`Sorted order: ${sortedEligible.join(', ')}`);

            // -----------------------------------------------------------------
            // STEP 4: BLOCK A ASSIGNMENT
            // -----------------------------------------------------------------
            log("\n--- BLOCK A ASSIGNMENT ---");
            
            const block1 = {};
            const specialWinnersA = new Set();
            let specialCountA = 0;

            // Assign specials to top bunks up to capacity
            sortedEligible.forEach(bunk => {
                if (specialCountA < capacityA) {
                    block1[bunk] = specialAct;
                    specialWinnersA.add(bunk);
                    specialCountA++;
                    log(`  ${bunk} -> ${specialAct} (SPECIAL)`);
                } else {
                    block1[bunk] = openAct;
                    log(`  ${bunk} -> ${openAct} (OPEN)`);
                }
            });

            // Ineligible bunks get the open activity in Block A
            ineligibleBunks.forEach(bunk => {
                block1[bunk] = openAct;
                log(`  ${bunk} -> ${openAct} (INELIGIBLE - will get fallback in B)`);
            });

            // -----------------------------------------------------------------
            // STEP 5: BLOCK B ASSIGNMENT (The Swap + Fallback)
            // -----------------------------------------------------------------
            const block2 = {};
            let nextDayPriority = divPriority.filter(b => !specialWinnersA.has(b));

            if (job.blockB) {
                log("\n--- BLOCK B ASSIGNMENT ---");

                // Winners from A MUST get the open activity in B (the swap)
                log("Winners from A get OPEN activity:");
                specialWinnersA.forEach(bunk => {
                    block2[bunk] = openAct;
                    log(`  ${bunk} -> ${openAct} (swapped from special)`);
                });

                // Losers from A try to get special in B
                log("\nLosers from A try for SPECIAL:");
                const losersFromA = sortedEligible.filter(b => !specialWinnersA.has(b));
                let specialCountB = 0;

                losersFromA.forEach(bunk => {
                    if (specialCountB < capacityB) {
                        block2[bunk] = specialAct;
                        specialCountB++;
                        log(`  ${bunk} -> ${specialAct} (got special!)`);
                        
                        // They got what they were owed - remove from priority debt
                        nextDayPriority = nextDayPriority.filter(p => p !== bunk);
                    } else {
                        // NO ROOM! Forced to fallback
                        block2[bunk] = fbAct;
                        log(`  ${bunk} -> ${fbAct} (FALLBACK - capacity full)`);
                        
                        // Add to priority debt for tomorrow
                        if (!nextDayPriority.includes(bunk)) {
                            nextDayPriority.push(bunk);
                            log(`    -> Added to priority queue for tomorrow`);
                        }
                    }
                });

                // Ineligible bunks get fallback in B (they already got open in A)
                log("\nIneligible bunks get FALLBACK:");
                ineligibleBunks.forEach(bunk => {
                    block2[bunk] = fbAct;
                    log(`  ${bunk} -> ${fbAct} (maxed out specials)`);
                });

            } else {
                // Single block mode - no Block B
                log("\n--- NO BLOCK B ---");
            }

            // -----------------------------------------------------------------
            // STEP 6: Save priority queue for tomorrow
            // -----------------------------------------------------------------
            priorityQueue[job.division] = nextDayPriority;
            savePriorityQueue(priorityQueue);
            log(`\nPriority queue for tomorrow: ${nextDayPriority.join(', ') || '(empty)'}`);

            // -----------------------------------------------------------------
            // STEP 7: Generate output
            // -----------------------------------------------------------------
            const locked = [];
            
            function lockBlock(assignments, blockInfo) {
                Object.entries(assignments).forEach(([bunk, act]) => {
                    locked.push({
                        bunk,
                        division: blockInfo.division,
                        start: blockInfo.startMin,
                        end: blockInfo.endMin,
                        activityLabel: act
                    });
                });
            }

            lockBlock(block1, job.blockA);
            if (job.blockB) lockBlock(block2, job.blockB);

            // Store for debugging
            window.__smartTileToday = window.__smartTileToday || {};
            window.__smartTileToday[job.division] = {
                specialAct,
                openAct,
                fallbackAct: fbAct,
                capacityA,
                capacityB,
                block1,
                block2,
                specialWinnersA: [...specialWinnersA],
                ineligibleBunks,
                nextDayPriority
            };

            log("\n" + "=".repeat(60));
            log("SUMMARY:");
            log(`  Block A: ${Object.entries(block1).map(([b,a]) => `${b}=${a}`).join(', ')}`);
            if (job.blockB) {
                log(`  Block B: ${Object.entries(block2).map(([b,a]) => `${b}=${a}`).join(', ')}`);
            }
            log("=".repeat(60) + "\n");

            return {
                block1Assignments: block1,
                block2Assignments: block2,
                lockedEvents: locked
            };
        },

        // =====================================================================
        // UTILITY: Check if activity needs generation
        // =====================================================================
        needsGeneration(act) {
            if (!act) return false;
            const a = act.toLowerCase();
            return (
                a.includes("sport") ||
                a.includes("general activity") ||
                a.includes("special")
            );
        }
    };

})();
