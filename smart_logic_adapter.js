// ============================================================================
// SmartLogicAdapter V38 (UPDATED: PRIORITY DEBT SYSTEM & DYNAMIC CAPACITY)
// - Calculates "Special" capacity dynamically for Block A and Block B separately.
// - Tracks bunks pushed to "Fallback" due to Block B capacity squeeze.
// - Saves them to a Priority Queue for the next day.
// - Gives Priority Queue bunks first dibs in the lottery.
// ============================================================================

(function() {
    "use strict";

    const PRIORITY_KEY = "smartTilePriority_v1";

    function loadPriorityQueue() {
        try {
            const raw = localStorage.getItem(PRIORITY_KEY);
            return raw ? JSON.parse(raw) : {};
        } catch (e) {
            console.error("Failed to load Smart Priority:", e);
            return {};
        }
    }

    function savePriorityQueue(queue) {
        try {
            localStorage.setItem(PRIORITY_KEY, JSON.stringify(queue));
        } catch (e) {
            console.error("Failed to save Smart Priority:", e);
        }
    }

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

        // Groups smart tiles into pairs
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
                const tiles = byDiv[div].sort((a, b) => parse(a.startTime) - parse(b.startTime));
                for (let i = 0; i < tiles.length; i += 2) {
                    const A = tiles[i];
                    const B = tiles[i + 1];
                    const sd = A.smartData || {};

                    if (!B) {
                        jobs.push({
                            division: div,
                            main1: sd.main1,
                            main2: sd.main2,
                            fallbackFor: sd.fallbackFor,
                            fallbackActivity: sd.fallbackActivity,
                            blockA: {
                                startMin: parse(A.startTime),
                                endMin: parse(A.endTime),
                                division: div
                            },
                            blockB: null
                        });
                    } else {
                        jobs.push({
                            division: div,
                            main1: sd.main1,
                            main2: sd.main2,
                            fallbackFor: sd.fallbackFor,
                            fallbackActivity: sd.fallbackActivity,
                            blockA: {
                                startMin: parse(A.startTime),
                                endMin: parse(A.endTime),
                                division: div
                            },
                            blockB: {
                                startMin: parse(B.startTime),
                                endMin: parse(B.endTime),
                                division: div
                            }
                        });
                    }
                }
            });

            return jobs;
        },

        // ---------------------------------------------------------
        // GENERATE ASSIGNMENTS (With Priority Debt & Dynamic Capacity)
        // ---------------------------------------------------------
        generateAssignments(bunks, job, historical = {}, specialNames = [], activityProps = {}, masterFields = [], dailyFieldAvailability = {}, yesterdayHistory = {}) {

            const main1 = job.main1.trim();
            const main2 = job.main2.trim();
            const fbAct = job.fallbackActivity || "Sports";

            // Identify the Special Act (The "Limited" resource)
            const fbFor = job.fallbackFor || "";
            let specialAct, openAct;

            if (isSame(main1, fbFor)) {
                specialAct = main1;
                openAct = main2;
            } else if (isSame(main2, fbFor)) {
                specialAct = main2;
                openAct = main1;
            } else {
                // Default
                specialAct = main1;
                openAct = main2;
            }

            const allSpecials = window.getGlobalSpecialActivities ? window.getGlobalSpecialActivities() : [];

            // ---------------------------------------------------------
            // HELPER: Dynamic Capacity Calculation ("The Roll Call")
            // ---------------------------------------------------------
            function getDynamicCapacity(startMin, endMin) {
                // Fallback if core utils aren't ready
                if (!window.SchedulerCoreUtils) return 2;

                const slots = window.SchedulerCoreUtils.findSlotsForRange(startMin, endMin);
                if (slots.length === 0) return 0;

                // Check if specialAct is a SPECIFIC defined special (e.g. "Art Room")
                const specificSpecial = allSpecials.find(s => isSame(s.name, specialAct));

                if (specificSpecial) {
                    // It IS specific. Check ONLY its availability.
                    const props = activityProps[specificSpecial.name] || specificSpecial;
                    
                    // Check if open for ALL slots in the range
                    const isOpen = slots.every(slotIdx => 
                        window.SchedulerCoreUtils.isTimeAvailable(slotIdx, props)
                    );

                    if (!isOpen) return 0; // Closed for this time block

                    // Return its specific capacity
                    const cap = props.sharableWith?.capacity 
                        || (props.sharableWith?.type === 'all' ? 2 : 1);
                    return parseInt(cap) || 1;
                }

                // It is GENERIC (e.g. "Special Activity"). Run the Roll Call.
                let totalCapacity = 0;

                allSpecials.forEach(s => {
                    const props = activityProps[s.name] || s;

                    // 1. Is it globally enabled?
                    if (props.available === false) return;

                    // 2. Is it open for this SPECIFIC time block?
                    const isOpen = slots.every(slotIdx => 
                        window.SchedulerCoreUtils.isTimeAvailable(slotIdx, props)
                    );

                    if (isOpen) {
                        // 3. Add its capacity
                        let sCap = 1;
                        if (props.sharableWith?.capacity) {
                            sCap = parseInt(props.sharableWith.capacity);
                        } else if (props.sharableWith?.type === 'all' || props.sharable) {
                            sCap = 2;
                        }
                        totalCapacity += sCap;
                    }
                });

                return totalCapacity;
            }

            // ---------------------------------------------------------
            // 1. ELIGIBILITY PRE-SCREEN (Global Max Usage)
            // ---------------------------------------------------------
            const eligibleBunks = [];
            const forcedFallbackBunks = [];

            bunks.forEach(b => {
                let hasAtLeastOneOption = false;
                if (allSpecials.length === 0) {
                    hasAtLeastOneOption = true;
                } else {
                    for (const s of allSpecials) {
                        const limit = s.maxUsage || 0; 
                        const count = historical[b]?.[s.name] || 0;
                        if (limit === 0 || count < limit) {
                            hasAtLeastOneOption = true;
                            break; 
                        }
                    }
                }

                if (hasAtLeastOneOption) {
                    eligibleBunks.push(b);
                } else {
                    forcedFallbackBunks.push(b);
                }
            });

            // ---------------------------------------------------------
            // 2. SORTING with PRIORITY DEBT
            // ---------------------------------------------------------
            // Load Priority Queue
            const priorityQueue = loadPriorityQueue();
            const divPriority = priorityQueue[job.division] || [];

            function getCategoryHistory(bunk, actName) {
                if (!historical[bunk]) return 0;
                let sum = 0;
                const lower = actName.toLowerCase();
                const spec = allSpecials.some(s => s.name.toLowerCase() === lower);
                if (spec) {
                    allSpecials.forEach(s => {
                        if (historical[bunk][s.name]) sum += historical[bunk][s.name];
                    });
                }
                return sum;
            }

            function playedYesterday(bunk) {
                const sched = yesterdayHistory.schedule?.[bunk] || [];
                if (!Array.isArray(sched)) return 0;
                return sched.some(e => {
                    const act = (e?._activity || "").toLowerCase();
                    return allSpecials.some(s => s.name.toLowerCase() === act);
                }) ? 1 : 0;
            }

            const sorted = [...eligibleBunks].sort((a, b) => {
                // 1. Priority Debt (Previous Unlucky Bunks go first)
                const pA = divPriority.includes(a) ? 1 : 0;
                const pB = divPriority.includes(b) ? 1 : 0;
                if (pA !== pB) return pB - pA; // Higher priority first

                // 2. Least Played This Week
                const A = getCategoryHistory(a, specialAct);
                const B = getCategoryHistory(b, specialAct);
                if (A !== B) return A - B;

                // 3. Did not play yesterday
                const YA = playedYesterday(a);
                const YB = playedYesterday(b);
                if (YA !== YB) return YA - YB;

                return Math.random() - 0.5;
            });

            // ---------------------------------------------------------
            // 3. ASSIGNMENT (Block A)
            // ---------------------------------------------------------
            // Calculate capacity dynamically for the FIRST time block
            const capA = getDynamicCapacity(job.blockA.startMin, job.blockA.endMin);
            let countA = 0;
            const block1 = {};
            const winnersA = new Set();

            sorted.forEach(bunk => {
                if (countA < capA) {
                    block1[bunk] = specialAct;
                    winnersA.add(bunk);
                    countA++;
                } else {
                    block1[bunk] = openAct;
                }
            });

            forcedFallbackBunks.forEach(bunk => {
                block1[bunk] = openAct;
            });

            // ---------------------------------------------------------
            // 4. ASSIGNMENT (Block B) + DEBT TRACKING
            // ---------------------------------------------------------
            const block2 = {};
            // Start fresh list for next day's priority.
            // Remove bunks who "Won" in Block A (they are satisfied for today).
            let nextDayPriority = divPriority.filter(b => !winnersA.has(b)); 

            if (job.blockB) {
                // Re-calculate capacity dynamically for the SECOND time block (e.g. Canteen closed?)
                const capB = getDynamicCapacity(job.blockB.startMin, job.blockB.endMin);
                let countB = 0;

                const candidates = sorted.filter(b => !winnersA.has(b));
                const forcedOpen = [...winnersA]; 

                // Winners of A -> Forced to Open in B (Swap)
                forcedOpen.forEach(b => block2[b] = openAct);

                // Candidates (Losers of A) -> Try for Special in B
                candidates.forEach(b => {
                    if (countB < capB) {
                        block2[b] = specialAct;
                        countB++;
                        
                        // If they were priority, they got their spot. Remove from debt.
                        nextDayPriority = nextDayPriority.filter(p => p !== b);
                    } else {
                        // NO ROOM! Forced to Fallback.
                        block2[b] = fbAct;
                        
                        // ** CRITICAL: ADD TO PRIORITY DEBT **
                        // They were eligible but capacity squeezed them out.
                        if (!nextDayPriority.includes(b)) {
                            nextDayPriority.push(b);
                        }
                    }
                });

                forcedFallbackBunks.forEach(bunk => {
                    block2[bunk] = fbAct;
                });
            } else {
                // If no Block B, logic is simpler. Priority bunks who got in A are cleared above.
                // Those who missed A (and there is no B) remain in queue if they were already there.
                // We typically don't add new debt for single blocks unless explicit "Special Only" logic exists.
            }

            // ---------------------------------------------------------
            // 5. SAVE UPDATED PRIORITY
            // ---------------------------------------------------------
            priorityQueue[job.division] = nextDayPriority;
            savePriorityQueue(priorityQueue);

            // ---------------------------------------------------------
            // 6. CREATE EVENTS
            // ---------------------------------------------------------
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

            // ---------------------------------------------------------
            // Pre-save history
            // ---------------------------------------------------------
            window.__smartTileToday = window.__smartTileToday || {};
            window.__smartTileToday[job.division] = {
                specialAct,
                block1,
                block2
            };

            return {
                block1Assignments: block1,
                block2Assignments: block2,
                lockedEvents: locked
            };
        }
    };

    // Helpers
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

    function isSame(a, b) {
        if (!a || !b) return false;
        return a.trim().toLowerCase() === b.trim().toLowerCase();
    }

})();
