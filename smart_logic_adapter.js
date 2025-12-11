// ============================================================================
// SmartLogicAdapter V43 (DIVISION RESTRICTIONS FIX)
// ============================================================================
// CRITICAL FIXES FROM V42:
// 1. NOW CHECKS DIVISION RESTRICTIONS (limitUsage, preferences.exclusive)
// 2. Filters available specials BY DIVISION before calculating capacity
// 3. Only specials that THIS division can use count toward capacity
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
    // CORE: CHECK IF DIVISION CAN USE A SPECIAL (NEW!)
    // =========================================================================
    
    /**
     * Checks if a specific division is allowed to use this special activity.
     * 
     * Checks:
     * 1. limitUsage.enabled + limitUsage.divisions
     * 2. preferences.exclusive + preferences.list
     * 
     * @param {string} divisionName - The division to check
     * @param {object} props - The activity properties
     * @returns {boolean} - True if division can use this special
     */
    function canDivisionUseSpecial(divisionName, props) {
        if (!props) return true; // No props = no restrictions
        
        // Check limitUsage restrictions
        if (props.limitUsage?.enabled) {
            const allowedDivisions = props.limitUsage.divisions || {};
            
            // If limitUsage is enabled, division must be in the allowed list
            if (!(divisionName in allowedDivisions)) {
                return false;
            }
            
            // If there are specific bunks listed, we'll check that separately
            // For now, division is in the list = allowed
        }
        
        // Check preferences.exclusive
        if (props.preferences?.enabled && props.preferences?.exclusive) {
            const preferredList = props.preferences.list || [];
            
            // If exclusive mode is on, division must be in the preference list
            if (!preferredList.includes(divisionName)) {
                return false;
            }
        }
        
        // Check allowedDivisions (another common pattern)
        if (props.allowedDivisions?.length > 0) {
            if (!props.allowedDivisions.includes(divisionName)) {
                return false;
            }
        }
        
        return true;
    }

    /**
     * Checks if a specific BUNK can use this special activity.
     * 
     * Checks:
     * 1. Division-level access (via canDivisionUseSpecial)
     * 2. Bunk-level restrictions (limitUsage.divisions[div] array)
     * 
     * @param {string} bunkName - The bunk to check
     * @param {string} divisionName - The division this bunk belongs to
     * @param {object} props - The activity properties
     * @returns {boolean} - True if bunk can use this special
     */
    function canBunkAccessSpecial(bunkName, divisionName, props) {
        if (!props) return true;
        
        // First check division-level
        if (!canDivisionUseSpecial(divisionName, props)) {
            return false;
        }
        
        // Then check bunk-level restrictions
        if (props.limitUsage?.enabled) {
            const allowedDivisions = props.limitUsage.divisions || {};
            const bunkRestrictions = allowedDivisions[divisionName];
            
            // If there's an array of specific bunks, check if this bunk is in it
            if (Array.isArray(bunkRestrictions) && bunkRestrictions.length > 0) {
                const bunkStr = String(bunkName);
                const bunkNum = parseInt(bunkName);
                const inList = bunkRestrictions.some(b => 
                    String(b) === bunkStr || parseInt(b) === bunkNum
                );
                
                if (!inList) {
                    return false;
                }
            }
            // If it's an empty array [], all bunks in that division are allowed
        }
        
        return true;
    }

    // =========================================================================
    // CORE: GET AVAILABLE SPECIALS WITH CAPACITY FOR A TIME BLOCK
    // =========================================================================
    
    /**
     * Returns which special activities are OPEN during [startMin, endMin]
     * AND available to the specified division.
     * 
     * This queries:
     * 1. window.getGlobalSpecialActivities() - master list
     * 2. activityProps - for availability, time rules, capacity, restrictions
     * 3. dailyFieldAvailability - for daily overrides
     * 
     * @param {number} startMin - Block start time in minutes
     * @param {number} endMin - Block end time in minutes
     * @param {string} divisionName - The division to check access for
     * @param {object} activityProps - Activity properties map
     * @param {object} dailyFieldAvailability - Daily overrides
     * @returns {{ name: string, capacity: number, maxUsage: number, remainingSlots: number }[]}
     */
    function getAvailableSpecialsForTimeBlock(startMin, endMin, divisionName, activityProps, dailyFieldAvailability) {
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

        log(`\n  Checking specials for ${divisionName} at ${startMin}-${endMin}:`);
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

            // 2. CHECK DIVISION RESTRICTIONS (NEW!)
            if (!canDivisionUseSpecial(divisionName, props)) {
                log(`    ❌ ${specialName}: NOT ALLOWED for division "${divisionName}"`);
                return;
            }

            // 3. Check daily overrides (from daily_adjustments.js)
            const dailyRules = dailyFieldAvailability?.[specialName] || [];
            
            // 4. Check time rules (daily override takes precedence over global)
            const effectiveRules = dailyRules.length > 0 ? dailyRules : (props.timeRules || []);
            
            if (effectiveRules.length > 0) {
                const isOpen = checkTimeRulesForBlock(startMin, endMin, effectiveRules, slots);
                
                if (!isOpen) {
                    log(`    ❌ ${specialName}: closed during ${startMin}-${endMin} (time rules)`);
                    return;
                }
            }

            // 5. Calculate capacity from special_activities.js / fields.js
            let capacity = 1; // Default
            
            if (props.sharableWith?.capacity) {
                capacity = parseInt(props.sharableWith.capacity) || 1;
            } else if (props.sharableWith?.type === 'all' || props.sharable) {
                capacity = 2;
            }

            log(`    ✅ ${specialName}: AVAILABLE for ${divisionName} (capacity: ${capacity})`);
            
            available.push({
                name: specialName,
                capacity: capacity,
                maxUsage: props.maxUsage || 0,
                frequencyWeeks: props.frequencyWeeks || 0,
                remainingSlots: capacity,
                props: props // Keep reference for bunk-level checks
            });
        });

        const totalCap = available.reduce((s, a) => s + a.capacity, 0);
        log(`  TOTAL FOR ${divisionName}: ${available.length} specials, ${totalCap} slots`);
        return available;
    }

    /**
     * Check if a time block passes time rules
     */
    function checkTimeRulesForBlock(startMin, endMin, rules, slots) {
        const parsedRules = rules.map(r => ({
            ...r,
            startMin: parseTime(r.start) ?? r.startMin,
            endMin: parseTime(r.end) ?? r.endMin
        }));

        const availableRules = parsedRules.filter(r => r.type === "Available");
        if (availableRules.length > 0) {
            const inAvailable = availableRules.some(r => 
                startMin >= r.startMin && endMin <= r.endMin
            );
            if (!inAvailable) return false;
        }

        const unavailableRules = parsedRules.filter(r => r.type === "Unavailable");
        for (const rule of unavailableRules) {
            if (startMin < rule.endMin && endMin > rule.startMin) {
                return false;
            }
        }

        return true;
    }

    /**
     * Calculate total capacity for available specials
     */
    function getTotalSpecialCapacity(availableSpecials) {
        return availableSpecials.reduce((sum, s) => sum + s.capacity, 0);
    }

    // =========================================================================
    // CORE: CHECK IF BUNK CAN USE A SPECIFIC SPECIAL (UPDATED)
    // =========================================================================

    /**
     * Checks if a bunk can use a specific special activity.
     * 
     * Checks:
     * 1. Bunk-level access (limitUsage.divisions[div] array)
     * 2. maxUsage limits from historical counts
     */
    function canBunkUseSpecial(bunk, divisionName, special, historicalCounts, activityProps) {
        const props = activityProps?.[special.name] || special.props || special;
        
        // Check bunk-level access restrictions
        if (!canBunkAccessSpecial(bunk, divisionName, props)) {
            log(`      ${bunk}: not allowed to use ${special.name} (bunk restriction)`);
            return false;
        }
        
        // Check maxUsage
        const maxUsage = special.maxUsage || 0;
        if (maxUsage === 0) return true; // No limit

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
    function getUsableSpecialsForBunk(bunk, divisionName, availableSpecials, historicalCounts, activityProps) {
        return availableSpecials.filter(special => 
            special.remainingSlots > 0 && 
            canBunkUseSpecial(bunk, divisionName, special, historicalCounts, activityProps)
        );
    }

    /**
     * Pick the best special for a bunk (least used by this bunk)
     */
    function pickBestSpecialForBunk(bunk, usableSpecials, historicalCounts) {
        if (usableSpecials.length === 0) return null;
        
        const bunkHistory = historicalCounts[bunk] || {};
        
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
        // MAIN ASSIGNMENT LOGIC (V43 - DIVISION AWARE)
        // =====================================================================

        generateAssignments(bunks, job, historical = {}, specialNames = [], activityProps = {}, masterFields = [], dailyFieldAvailability = {}, yesterdayHistory = {}) {
            
            log("\n" + "=".repeat(70));
            log(`SMART TILE V43: ${job.division}`);
            log(`Main1: ${job.main1}, Main2: ${job.main2}`);
            log(`Fallback: ${job.fallbackActivity} (for ${job.fallbackFor})`);
            log(`Bunks: ${bunks.join(', ')}`);
            log("=".repeat(70));

            const divisionName = job.division;
            const main1 = job.main1?.trim();
            const main2 = job.main2?.trim();
            const fbAct = job.fallbackActivity || "Sports";
            const fbFor = job.fallbackFor || "";

            // Determine which is the "special" and which is "open"
            let specialConfig, openAct;
            if (isSame(main1, fbFor)) {
                specialConfig = main1;
                openAct = main2;
            } else if (isSame(main2, fbFor)) {
                specialConfig = main2;
                openAct = main1;
            } else {
                specialConfig = main2;
                openAct = main1;
            }

            const needsResolution = isSpecialType(specialConfig);
            
            log(`\nConfiguration:`);
            log(`  "Special" config: ${specialConfig} (needs resolution: ${needsResolution})`);
            log(`  "Open" activity: ${openAct}`);
            log(`  Division: ${divisionName}`);

            // -----------------------------------------------------------------
            // STEP 1: Get available specials for BLOCK A (DIVISION-FILTERED!)
            // -----------------------------------------------------------------
            log("\n--- BLOCK A: QUERYING AVAILABLE SPECIALS FOR " + divisionName + " ---");
            
            let specialsBlockA = getAvailableSpecialsForTimeBlock(
                job.blockA.startMin, 
                job.blockA.endMin,
                divisionName,  // PASS DIVISION!
                activityProps, 
                dailyFieldAvailability
            );
            
            if (!needsResolution) {
                specialsBlockA = specialsBlockA.filter(s => isSame(s.name, specialConfig));
            }
            
            const capacityA = getTotalSpecialCapacity(specialsBlockA);
            log(`Block A capacity for ${divisionName}: ${capacityA} slots from ${specialsBlockA.map(s => `${s.name}(${s.capacity})`).join(', ') || 'none'}`);

            // -----------------------------------------------------------------
            // STEP 2: Get available specials for BLOCK B (DIVISION-FILTERED!)
            // -----------------------------------------------------------------
            let specialsBlockB = [];
            let capacityB = 0;
            
            if (job.blockB) {
                log("\n--- BLOCK B: QUERYING AVAILABLE SPECIALS FOR " + divisionName + " ---");
                
                specialsBlockB = getAvailableSpecialsForTimeBlock(
                    job.blockB.startMin, 
                    job.blockB.endMin,
                    divisionName,  // PASS DIVISION!
                    activityProps, 
                    dailyFieldAvailability
                );
                
                if (!needsResolution) {
                    specialsBlockB = specialsBlockB.filter(s => isSame(s.name, specialConfig));
                }
                
                capacityB = getTotalSpecialCapacity(specialsBlockB);
                log(`Block B capacity for ${divisionName}: ${capacityB} slots from ${specialsBlockB.map(s => `${s.name}(${s.capacity})`).join(', ') || 'none'}`);
            }

            // -----------------------------------------------------------------
            // STEP 3: Pre-screen bunks for eligibility
            // -----------------------------------------------------------------
            log("\n--- ELIGIBILITY CHECK ---");
            
            const eligibleBunks = [];
            const ineligibleBunks = [];

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
                    canBunkUseSpecial(bunk, divisionName, s, historical, activityProps)
                );
                
                if (usable.length > 0) {
                    eligibleBunks.push(bunk);
                    log(`  ${bunk}: ELIGIBLE (can use: ${usable.map(s => s.name).join(', ')})`);
                } else {
                    ineligibleBunks.push(bunk);
                    log(`  ${bunk}: INELIGIBLE (maxed out or restricted)`);
                }
            });

            // -----------------------------------------------------------------
            // STEP 4: Sort eligible bunks by fairness
            // -----------------------------------------------------------------
            log("\n--- SORTING BY FAIRNESS ---");
            
            const priorityQueue = loadPriorityQueue();
            const divPriority = priorityQueue[divisionName] || [];

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
                const pA = divPriority.includes(a) ? 1 : 0;
                const pB = divPriority.includes(b) ? 1 : 0;
                if (pA !== pB) return pB - pA;

                const usageA = getSpecialUsageCount(a);
                const usageB = getSpecialUsageCount(b);
                if (usageA !== usageB) return usageA - usageB;

                const yA = playedYesterday(a) ? 1 : 0;
                const yB = playedYesterday(b) ? 1 : 0;
                if (yA !== yB) return yA - yB;

                return Math.random() - 0.5;
            });

            log(`Sorted order: ${sortedEligible.join(', ')}`);

            // -----------------------------------------------------------------
            // STEP 5: BLOCK A ASSIGNMENT
            // -----------------------------------------------------------------
            log("\n--- BLOCK A ASSIGNMENT ---");
            
            const block1 = {};
            const specialWinnersA = new Set();
            
            // Reset remaining slots
            specialsBlockA.forEach(s => s.remainingSlots = s.capacity);

            sortedEligible.forEach(bunk => {
                const usable = getUsableSpecialsForBunk(bunk, divisionName, specialsBlockA, historical, activityProps);
                
                if (usable.length > 0) {
                    const chosen = pickBestSpecialForBunk(bunk, usable, historical);
                    
                    if (chosen) {
                        block1[bunk] = chosen.name;
                        specialWinnersA.add(bunk);
                        chosen.remainingSlots--;
                        log(`  ${bunk} -> ${chosen.name} ⭐ (${chosen.remainingSlots} left for ${chosen.name})`);
                    } else {
                        block1[bunk] = openAct;
                        log(`  ${bunk} -> ${openAct}`);
                    }
                } else {
                    block1[bunk] = openAct;
                    log(`  ${bunk} -> ${openAct} (no capacity)`);
                }
            });

            ineligibleBunks.forEach(bunk => {
                block1[bunk] = openAct;
                log(`  ${bunk} -> ${openAct} (INELIGIBLE)`);
            });

            log(`\n  Block A Summary: ${specialWinnersA.size} got specials, ${bunks.length - specialWinnersA.size} got ${openAct}`);

            // -----------------------------------------------------------------
            // STEP 6: BLOCK B ASSIGNMENT
            // -----------------------------------------------------------------
            const block2 = {};
            let nextDayPriority = divPriority.filter(b => !specialWinnersA.has(b));

            if (job.blockB) {
                log("\n--- BLOCK B ASSIGNMENT ---");
                
                // Reset remaining slots for Block B
                specialsBlockB.forEach(s => s.remainingSlots = s.capacity);

                // Winners from A get the open activity
                log("Winners from A get OPEN activity:");
                specialWinnersA.forEach(bunk => {
                    block2[bunk] = openAct;
                    log(`  ${bunk} -> ${openAct} (swapped)`);
                });

                // Losers from A try for specials
                log("\nLosers from A try for SPECIAL:");
                const losersFromA = sortedEligible.filter(b => !specialWinnersA.has(b));

                losersFromA.forEach(bunk => {
                    const usable = getUsableSpecialsForBunk(bunk, divisionName, specialsBlockB, historical, activityProps);
                    
                    if (usable.length > 0) {
                        const chosen = pickBestSpecialForBunk(bunk, usable, historical);
                        
                        if (chosen) {
                            block2[bunk] = chosen.name;
                            chosen.remainingSlots--;
                            log(`  ${bunk} -> ${chosen.name} ⭐ (${chosen.remainingSlots} left)`);
                            nextDayPriority = nextDayPriority.filter(p => p !== bunk);
                        } else {
                            block2[bunk] = fbAct;
                            log(`  ${bunk} -> ${fbAct} (FALLBACK)`);
                            if (!nextDayPriority.includes(bunk)) {
                                nextDayPriority.push(bunk);
                            }
                        }
                    } else {
                        block2[bunk] = fbAct;
                        log(`  ${bunk} -> ${fbAct} (FALLBACK - no usable)`);
                        if (!nextDayPriority.includes(bunk)) {
                            nextDayPriority.push(bunk);
                        }
                    }
                });

                ineligibleBunks.forEach(bunk => {
                    block2[bunk] = fbAct;
                    log(`  ${bunk} -> ${fbAct} (INELIGIBLE)`);
                });

                const specialsInB = Object.values(block2).filter(act => 
                    specialsBlockB.some(s => s.name === act)
                ).length;
                log(`\n  Block B Summary: ${specialsInB} got specials, ${bunks.length - specialsInB} got ${openAct}/${fbAct}`);
            }

            // -----------------------------------------------------------------
            // STEP 7: Save priority queue
            // -----------------------------------------------------------------
            priorityQueue[divisionName] = nextDayPriority;
            savePriorityQueue(priorityQueue);
            log(`\nPriority queue for tomorrow: ${nextDayPriority.join(', ') || '(empty)'}`);

            // -----------------------------------------------------------------
            // STEP 8: Store debug info and return
            // -----------------------------------------------------------------
            window.__smartTileToday = window.__smartTileToday || {};
            window.__smartTileToday[divisionName] = {
                specialConfig,
                openAct,
                fallbackAct: fbAct,
                capacityA,
                capacityB,
                availableSpecialsA: specialsBlockA.map(s => `${s.name}(cap:${s.capacity})`),
                availableSpecialsB: specialsBlockB.map(s => `${s.name}(cap:${s.capacity})`),
                block1,
                block2,
                specialWinnersA: [...specialWinnersA],
                ineligibleBunks,
                nextDayPriority
            };

            log("\n" + "=".repeat(70));
            log("FINAL SUMMARY:");
            log(`  Block A: ${Object.entries(block1).map(([b,a]) => `${b}=${a}`).join(', ')}`);
            if (job.blockB) {
                log(`  Block B: ${Object.entries(block2).map(([b,a]) => `${b}=${a}`).join(', ')}`);
            }
            log("=".repeat(70) + "\n");

            return {
                block1Assignments: block1,
                block2Assignments: block2,
                lockedEvents: []
            };
        },

        needsGeneration(act) {
            if (!act) return false;
            const a = act.toLowerCase().trim();
            return (
                a === "sports" ||
                a === "sports slot" ||
                a === "general activity" ||
                a === "general activity slot" ||
                a === "activity"
            );
        }
    };

    // =========================================================================
    // DEBUG UTILITY
    // =========================================================================

    window.debugSmartTileCapacity = function(divisionName, startMin, endMin) {
        const activityProps = window.activityProperties || {};
        const dailyData = window.loadCurrentDailyData?.() || {};
        const dailyFieldAvailability = dailyData.dailyFieldAvailability || {};
        
        console.log(`\n=== SMART TILE CAPACITY FOR ${divisionName} ===`);
        console.log(`Time: ${startMin} - ${endMin} minutes`);
        
        const available = getAvailableSpecialsForTimeBlock(
            startMin, 
            endMin,
            divisionName,
            activityProps, 
            dailyFieldAvailability
        );
        
        console.log(`\nAvailable Specials for ${divisionName}:`);
        available.forEach(s => {
            console.log(`  ${s.name}: capacity=${s.capacity}, maxUsage=${s.maxUsage}`);
        });
        
        const total = available.reduce((s, a) => s + a.capacity, 0);
        console.log(`\nTOTAL CAPACITY FOR ${divisionName}: ${total}`);
        
        return available;
    };

})();
