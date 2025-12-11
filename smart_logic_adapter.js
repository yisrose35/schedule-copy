// ============================================================================
// SmartLogicAdapter V42 (CAPACITY-AWARE + ACTUAL ACTIVITY NAMES)
// ============================================================================
// CRITICAL FIXES:
// 1. Resolves "Special" to ACTUAL activity names (Canteen, Gameroom, etc.)
// 2. Dynamically calculates capacity by querying:
//    - daily_adjustments.js for time-based availability
//    - special_activities.js for per-activity capacity
// 3. Tracks per-special usage within each block
// 4. Re-queries availability for Block B (capacities are time-dependent)
// 5. Respects maxUsage limits per bunk
// ============================================================================

(function() {
    "use strict";

    // =========================================================================
    // STORAGE KEYS
    // =========================================================================
    const PRIORITY_KEY = "smartTilePriority_v2";

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
        if (typeof str === 'number') return str;
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

    function isSpecialType(name) {
        if (!name) return false;
        const lower = name.toLowerCase().trim();
        return lower === "special" || 
               lower === "special activity" || 
               lower.includes("special");
    }

    function log(...args) {
        console.log("[SmartTile]", ...args);
    }

    // =========================================================================
    // CORE: GET AVAILABLE SPECIALS WITH CAPACITY FOR A TIME BLOCK
    // =========================================================================
    
    /**
     * Returns which special activities are OPEN during [startMin, endMin]
     * and their individual capacities.
     * 
     * This queries:
     * 1. window.getGlobalSpecialActivities() - master list
     * 2. activityProps - for availability, time rules, capacity
     * 3. dailyFieldAvailability - for daily overrides
     * 
     * @returns { name: string, capacity: number, maxUsage: number, remainingSlots: number }[]
     */
    function getAvailableSpecialsForTimeBlock(startMin, endMin, activityProps, dailyFieldAvailability) {
        // Get all specials from the global registry
        const allSpecials = window.getGlobalSpecialActivities?.() || [];
        
        // Also check activityProperties for specials (backup source)
        const propsSpecials = [];
        if (activityProps) {
            Object.entries(activityProps).forEach(([name, props]) => {
                if (props.type === 'Special' || props.type === 'special') {
                    if (!allSpecials.find(s => s.name === name)) {
                        propsSpecials.push({ name, ...props });
                    }
                }
            });
        }
        
        const combinedSpecials = [...allSpecials, ...propsSpecials];
        const available = [];

        log(`\n  Checking specials for time ${startMin}-${endMin}:`);
        log(`  Found ${combinedSpecials.length} total specials to check`);

        // Get slots for this time block
        const slots = window.SchedulerCoreUtils?.findSlotsForRange(startMin, endMin) || [];
        
        if (slots.length === 0) {
            log(`  WARNING: No slots found for ${startMin}-${endMin}`);
        }

        combinedSpecials.forEach(special => {
            const specialName = special.name;
            const props = activityProps?.[specialName] || special;

            // 1. Check if globally enabled
            if (props.available === false) {
                log(`    ❌ ${specialName}: globally disabled`);
                return;
            }

            // 2. Check daily overrides (from daily_adjustments.js)
            const dailyRules = dailyFieldAvailability?.[specialName] || [];
            
            // 3. Check time rules (daily override takes precedence over global)
            const effectiveRules = dailyRules.length > 0 ? dailyRules : (props.timeRules || []);
            
            // If there are time rules, check if this block is covered
            if (effectiveRules.length > 0) {
                const isOpen = checkTimeRulesForBlock(startMin, endMin, effectiveRules, slots);
                
                if (!isOpen) {
                    log(`    ❌ ${specialName}: closed during ${startMin}-${endMin} (time rules)`);
                    return;
                }
            }

            // 4. Calculate capacity from special_activities.js / fields.js
            let capacity = 1; // Default
            
            if (props.sharableWith?.capacity) {
                capacity = parseInt(props.sharableWith.capacity) || 1;
            } else if (props.sharableWith?.type === 'all' || props.sharable) {
                capacity = 2;
            }

            log(`    ✅ ${specialName}: AVAILABLE (capacity: ${capacity})`);
            
            available.push({
                name: specialName,
                capacity: capacity,
                maxUsage: props.maxUsage || 0,
                frequencyWeeks: props.frequencyWeeks || 0,
                remainingSlots: capacity // Will be decremented as we assign
            });
        });

        log(`  TOTAL: ${available.length} specials available, ${available.reduce((s,a) => s + a.capacity, 0)} total slots`);
        return available;
    }

    /**
     * Check if a time block passes time rules
     */
    function checkTimeRulesForBlock(startMin, endMin, rules, slots) {
        // Parse rules
        const parsedRules = rules.map(r => ({
            ...r,
            startMin: parseTime(r.start) ?? r.startMin,
            endMin: parseTime(r.end) ?? r.endMin
        }));

        // Check Available rules - if any exist, block must be within one
        const availableRules = parsedRules.filter(r => r.type === "Available");
        if (availableRules.length > 0) {
            const inAvailable = availableRules.some(r => 
                startMin >= r.startMin && endMin <= r.endMin
            );
            if (!inAvailable) return false;
        }

        // Check Unavailable rules - block must not overlap any
        const unavailableRules = parsedRules.filter(r => r.type === "Unavailable");
        for (const rule of unavailableRules) {
            if (startMin < rule.endMin && endMin > rule.startMin) {
                return false; // Overlap with unavailable
            }
        }

        return true;
    }

    /**
     * Calculate total "special" capacity for a time block
     */
    function getTotalSpecialCapacity(availableSpecials) {
        return availableSpecials.reduce((sum, s) => sum + s.capacity, 0);
    }

    // =========================================================================
    // CORE: CHECK IF BUNK CAN USE A SPECIFIC SPECIAL
    // =========================================================================

    /**
     * Checks if a bunk can use a specific special activity.
     * Considers maxUsage limits from historical counts.
     */
    function canBunkUseSpecial(bunk, special, historicalCounts) {
        const maxUsage = special.maxUsage || 0;
        
        // No limit = always usable
        if (maxUsage === 0) return true;

        const bunkHistory = historicalCounts[bunk] || {};
        const usedCount = bunkHistory[special.name] || 0;
        
        if (usedCount >= maxUsage) {
            log(`      ${bunk}: maxed out ${special.name} (${usedCount}/${maxUsage})`);
            return false;
        }
        
        return true;
    }

    /**
     * Find which specials a bunk can use from the available list
     */
    function getUsableSpecialsForBunk(bunk, availableSpecials, historicalCounts) {
        return availableSpecials.filter(special => 
            special.remainingSlots > 0 && 
            canBunkUseSpecial(bunk, special, historicalCounts)
        );
    }

    /**
     * Pick the best special for a bunk (least used by this bunk)
     */
    function pickBestSpecialForBunk(bunk, usableSpecials, historicalCounts) {
        if (usableSpecials.length === 0) return null;
        
        const bunkHistory = historicalCounts[bunk] || {};
        
        // Sort by: least used by this bunk, then random
        const sorted = [...usableSpecials].sort((a, b) => {
            const countA = bunkHistory[a.name] || 0;
            const countB = bunkHistory[b.name] || 0;
            if (countA !== countB) return countA - countB;
            return Math.random() - 0.5;
        });
        
        return sorted[0];
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
        // MAIN ASSIGNMENT LOGIC (V42 - CAPACITY AWARE)
        // =====================================================================

        generateAssignments(bunks, job, historical = {}, specialNames = [], activityProps = {}, masterFields = [], dailyFieldAvailability = {}, yesterdayHistory = {}) {
            
            log("\n" + "=".repeat(70));
            log(`SMART TILE V42: ${job.division}`);
            log(`Main1: ${job.main1}, Main2: ${job.main2}`);
            log(`Fallback: ${job.fallbackActivity} (for ${job.fallbackFor})`);
            log(`Bunks: ${bunks.join(', ')}`);
            log("=".repeat(70));

            const main1 = job.main1?.trim();
            const main2 = job.main2?.trim();
            const fbAct = job.fallbackActivity || "Sports";
            const fbFor = job.fallbackFor || "";

            // Determine which is the "special" (the limited one with fallback)
            // and which is the "open" activity
            let specialConfig, openAct;
            if (isSame(main1, fbFor)) {
                specialConfig = main1; // This might be "Special" or an actual name
                openAct = main2;
            } else if (isSame(main2, fbFor)) {
                specialConfig = main2;
                openAct = main1;
            } else {
                // Default: main2 is the special/limited one
                specialConfig = main2;
                openAct = main1;
            }

            // Check if specialConfig is a generic "Special" that needs resolution
            const needsResolution = isSpecialType(specialConfig);
            
            log(`\nConfiguration:`);
            log(`  "Special" config: ${specialConfig} (needs resolution: ${needsResolution})`);
            log(`  "Open" activity: ${openAct}`);

            // -----------------------------------------------------------------
            // STEP 1: Get available specials for BLOCK A
            // -----------------------------------------------------------------
            log("\n--- BLOCK A: QUERYING AVAILABLE SPECIALS ---");
            
            let specialsBlockA = getAvailableSpecialsForTimeBlock(
                job.blockA.startMin, 
                job.blockA.endMin, 
                activityProps, 
                dailyFieldAvailability
            );
            
            // If specialConfig is a specific activity (not generic "Special"),
            // filter to just that one
            if (!needsResolution) {
                specialsBlockA = specialsBlockA.filter(s => isSame(s.name, specialConfig));
                if (specialsBlockA.length === 0) {
                    log(`  WARNING: Specific special "${specialConfig}" not available!`);
                }
            }
            
            const capacityA = getTotalSpecialCapacity(specialsBlockA);
            log(`Block A capacity: ${capacityA} total slots from ${specialsBlockA.length} specials`);

            // -----------------------------------------------------------------
            // STEP 2: Get available specials for BLOCK B (SEPARATE QUERY!)
            // -----------------------------------------------------------------
            let specialsBlockB = [];
            let capacityB = 0;
            
            if (job.blockB) {
                log("\n--- BLOCK B: QUERYING AVAILABLE SPECIALS ---");
                
                specialsBlockB = getAvailableSpecialsForTimeBlock(
                    job.blockB.startMin, 
                    job.blockB.endMin, 
                    activityProps, 
                    dailyFieldAvailability
                );
                
                if (!needsResolution) {
                    specialsBlockB = specialsBlockB.filter(s => isSame(s.name, specialConfig));
                }
                
                capacityB = getTotalSpecialCapacity(specialsBlockB);
                log(`Block B capacity: ${capacityB} total slots from ${specialsBlockB.length} specials`);
            }

            // -----------------------------------------------------------------
            // STEP 3: Pre-screen bunks for eligibility
            // -----------------------------------------------------------------
            log("\n--- ELIGIBILITY CHECK ---");
            
            const eligibleBunks = [];
            const ineligibleBunks = [];

            // Combine all available specials from both blocks for eligibility check
            const allAvailableNames = new Set([
                ...specialsBlockA.map(s => s.name),
                ...specialsBlockB.map(s => s.name)
            ]);
            
            const allAvailableSpecials = [];
            allAvailableNames.forEach(name => {
                const fromA = specialsBlockA.find(s => s.name === name);
                const fromB = specialsBlockB.find(s => s.name === name);
                allAvailableSpecials.push(fromA || fromB);
            });

            bunks.forEach(bunk => {
                const usable = allAvailableSpecials.filter(s => 
                    canBunkUseSpecial(bunk, s, historical)
                );
                
                if (usable.length > 0) {
                    eligibleBunks.push(bunk);
                    log(`  ${bunk}: ELIGIBLE (can use: ${usable.map(s => s.name).join(', ')})`);
                } else {
                    ineligibleBunks.push(bunk);
                    log(`  ${bunk}: INELIGIBLE (maxed out all specials)`);
                }
            });

            // -----------------------------------------------------------------
            // STEP 4: Sort eligible bunks by fairness
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
            // STEP 5: BLOCK A ASSIGNMENT (with ACTUAL activity names)
            // -----------------------------------------------------------------
            log("\n--- BLOCK A ASSIGNMENT ---");
            
            const block1 = {};
            const specialWinnersA = new Set();
            
            // Reset remaining slots for Block A
            specialsBlockA.forEach(s => s.remainingSlots = s.capacity);

            // Assign specials to top bunks
            sortedEligible.forEach(bunk => {
                // Find usable specials for this bunk that still have capacity
                const usable = getUsableSpecialsForBunk(bunk, specialsBlockA, historical);
                
                if (usable.length > 0) {
                    // Pick the best special for this bunk
                    const chosen = pickBestSpecialForBunk(bunk, usable, historical);
                    
                    if (chosen) {
                        block1[bunk] = chosen.name; // ACTUAL NAME like "Canteen"
                        specialWinnersA.add(bunk);
                        chosen.remainingSlots--;
                        log(`  ${bunk} -> ${chosen.name} ⭐ (${chosen.remainingSlots} slots left)`);
                    } else {
                        block1[bunk] = openAct;
                        log(`  ${bunk} -> ${openAct} (no special available)`);
                    }
                } else {
                    block1[bunk] = openAct;
                    log(`  ${bunk} -> ${openAct} (capacity full or maxed out)`);
                }
            });

            // Ineligible bunks get the open activity in Block A
            ineligibleBunks.forEach(bunk => {
                block1[bunk] = openAct;
                log(`  ${bunk} -> ${openAct} (INELIGIBLE)`);
            });

            // -----------------------------------------------------------------
            // STEP 6: BLOCK B ASSIGNMENT (with ACTUAL activity names)
            // -----------------------------------------------------------------
            const block2 = {};
            let nextDayPriority = divPriority.filter(b => !specialWinnersA.has(b));

            if (job.blockB) {
                log("\n--- BLOCK B ASSIGNMENT ---");
                
                // Reset remaining slots for Block B (FRESH query!)
                specialsBlockB.forEach(s => s.remainingSlots = s.capacity);

                // Winners from A MUST get the open activity in B (the swap)
                log("Winners from A get OPEN activity:");
                specialWinnersA.forEach(bunk => {
                    block2[bunk] = openAct;
                    log(`  ${bunk} -> ${openAct} (swapped)`);
                });

                // Losers from A try to get special in B
                log("\nLosers from A try for SPECIAL:");
                const losersFromA = sortedEligible.filter(b => !specialWinnersA.has(b));

                losersFromA.forEach(bunk => {
                    const usable = getUsableSpecialsForBunk(bunk, specialsBlockB, historical);
                    
                    if (usable.length > 0) {
                        const chosen = pickBestSpecialForBunk(bunk, usable, historical);
                        
                        if (chosen) {
                            block2[bunk] = chosen.name; // ACTUAL NAME
                            chosen.remainingSlots--;
                            log(`  ${bunk} -> ${chosen.name} ⭐ (${chosen.remainingSlots} slots left)`);
                            
                            // They got what they were owed - remove from priority debt
                            nextDayPriority = nextDayPriority.filter(p => p !== bunk);
                        } else {
                            // Fallback
                            block2[bunk] = fbAct;
                            log(`  ${bunk} -> ${fbAct} (FALLBACK - no capacity)`);
                            
                            if (!nextDayPriority.includes(bunk)) {
                                nextDayPriority.push(bunk);
                            }
                        }
                    } else {
                        // NO ROOM! Forced to fallback
                        block2[bunk] = fbAct;
                        log(`  ${bunk} -> ${fbAct} (FALLBACK - no usable specials)`);
                        
                        if (!nextDayPriority.includes(bunk)) {
                            nextDayPriority.push(bunk);
                            log(`    -> Added to priority queue`);
                        }
                    }
                });

                // Ineligible bunks get fallback in B
                log("\nIneligible bunks get FALLBACK:");
                ineligibleBunks.forEach(bunk => {
                    block2[bunk] = fbAct;
                    log(`  ${bunk} -> ${fbAct}`);
                });

            } else {
                log("\n--- NO BLOCK B ---");
            }

            // -----------------------------------------------------------------
            // STEP 7: Save priority queue for tomorrow
            // -----------------------------------------------------------------
            priorityQueue[job.division] = nextDayPriority;
            savePriorityQueue(priorityQueue);
            log(`\nPriority queue for tomorrow: ${nextDayPriority.join(', ') || '(empty)'}`);

            // -----------------------------------------------------------------
            // STEP 8: Generate output
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
                specialConfig,
                openAct,
                fallbackAct: fbAct,
                capacityA,
                capacityB,
                availableSpecialsA: specialsBlockA.map(s => s.name),
                availableSpecialsB: specialsBlockB.map(s => s.name),
                block1,
                block2,
                specialWinnersA: [...specialWinnersA],
                ineligibleBunks,
                nextDayPriority
            };

            log("\n" + "=".repeat(70));
            log("SUMMARY:");
            log(`  Block A: ${Object.entries(block1).map(([b,a]) => `${b}=${a}`).join(', ')}`);
            if (job.blockB) {
                log(`  Block B: ${Object.entries(block2).map(([b,a]) => `${b}=${a}`).join(', ')}`);
            }
            log("=".repeat(70) + "\n");

            return {
                block1Assignments: block1,
                block2Assignments: block2,
                lockedEvents: locked
            };
        },

        // =====================================================================
        // UTILITY: Check if activity needs generation by solver
        // =====================================================================
        needsGeneration(act) {
            if (!act) return false;
            const a = act.toLowerCase().trim();
            // Only generic slots need generation
            // Actual special names like "Canteen" should be filled directly
            return (
                a === "sports" ||
                a === "sports slot" ||
                a === "general activity" ||
                a === "general activity slot" ||
                a === "activity"
                // NOTE: "Special" is no longer here because we resolve it!
            );
        }
    };

    // =========================================================================
    // DEBUG UTILITIES
    // =========================================================================

    window.debugSmartTileCapacity = function(startMin, endMin) {
        const activityProps = window.activityProperties || {};
        const dailyData = window.loadCurrentDailyData?.() || {};
        const dailyFieldAvailability = dailyData.dailyFieldAvailability || {};
        
        console.log(`\n=== SMART TILE CAPACITY DEBUG ===`);
        console.log(`Time: ${startMin} - ${endMin} minutes`);
        
        const available = getAvailableSpecialsForTimeBlock(
            startMin, 
            endMin, 
            activityProps, 
            dailyFieldAvailability
        );
        
        console.log(`\nAvailable Specials:`);
        available.forEach(s => {
            console.log(`  ${s.name}: capacity=${s.capacity}, maxUsage=${s.maxUsage}`);
        });
        
        console.log(`\nTOTAL CAPACITY: ${getTotalSpecialCapacity(available)}`);
        
        return available;
    };

})();
