// ============================================================================
// scheduler_logic_core.js
//
// UPDATED (Smart Tiles v16 + Global Fairness Engine):
// - DYNAMIC RE-CALCULATION: Scores are updated instantly after every block assignment.
// - ONE SPOT RULE (UPGRADED): Generated specials are handed out to bunks with the
//   lowest historical+today usage for that category (no doubling before others catch up).
// - FAIRNESS ENGINE: Re-usable bunk/category usage model (e.g. "special:any").
// - SMART TILES: Use the fairness engine to decide which bunks get generated
//   specials/sports first; placed tiles (Swim/Lunch/Snack) just get placed.
// ============================================================================

(function() {
    'use strict';

    // ===== CONFIG =====
    const INCREMENT_MINS = 30;
    window.INCREMENT_MINS = INCREMENT_MINS;

    // Events that REQUIRE scheduling/generation
    const GENERATED_EVENTS = [
        'General Activity Slot',
        'Sports Slot',
        'Special Activity',
        'Swim',
        'League Game',
        'Specialty League',
        'Smart Tile'
    ];

    // ===== BASIC HELPERS =====
    function parseTimeToMinutes(str) {
        if (str == null) return null;
        if (typeof str === "number") return str;

        if (typeof str !== "string") return null;
        let s = str.trim().toLowerCase();
        let mer = null;
        if (s.endsWith("am") || s.endsWith("pm")) {
            mer = s.endsWith("am") ? "am" : "pm";
            s = s.replace(/am|pm/g, "").trim();
        } else {
            return null;
        }
        const m = s.match(/^(\d{1,2})\s*:\s*(\d{2})$/);
        if (!m) return null;
        let hh = parseInt(m[1], 10);
        const mm = parseInt(m[2], 10);
        if (Number.isNaN(hh) || Number.isNaN(mm) || mm < 0 || mm > 59) return null;
        if (mer) {
            if (hh === 12) hh = (mer === "am") ? 0 : 12;
            else if (mer === "pm") hh += 12;
        }
        return hh * 60 + mm;
    }

    function fieldLabel(f) {
        if (typeof f === "string") return f;
        if (f && typeof f === "object" && typeof f.name === "string") return f.name;
        return "";
    }

    function fmtTime(d) {
        if (!d) return "";
        if (typeof d === 'string') d = new Date(d);
        let h = d.getHours();
        let m = d.getMinutes().toString().padStart(2, "0");
        const ap = h >= 12 ? "PM" : "AM";
        h = h % 12 || 12;
        return `${h}:${m} ${ap}`;
    }

    function minutesToDate(mins) {
        const d = new Date(1970, 0, 1, 0, 0, 0);
        d.setMinutes(mins);
        return d;
    }

    // ======================================================
    // LEAGUE ROUND STATE (IN-CORE ROUND-ROBIN ENGINE)
    // ======================================================

    let coreLeagueRoundState = (window.coreLeagueRoundState || {});

    (function initCoreLeagueRoundState() {
        try {
            const daily = window.loadCurrentDailyData?.() || {};
            if (daily && daily.coreLeagueRoundState && typeof daily.coreLeagueRoundState === "object") {
                coreLeagueRoundState = daily.coreLeagueRoundState;
            }
        } catch (e) {
            console.error("Failed to load core league round state:", e);
            coreLeagueRoundState = {};
        }
        window.coreLeagueRoundState = coreLeagueRoundState;
    })();

    function saveCoreLeagueRoundState() {
        try {
            window.saveCurrentDailyData?.("coreLeagueRoundState", coreLeagueRoundState);
        } catch (e) {
            console.error("Failed to save core league round state:", e);
        }
    }

    function coreFullRoundRobin(teamList) {
        if (!teamList || teamList.length < 2) return [];
        const teams = teamList.map(String);
        const t = [...teams];
        if (t.length % 2 !== 0) t.push("BYE");
        const n = t.length;
        const fixed = t[0];
        let rotating = t.slice(1);
        const rounds = [];
        for (let r = 0; r < n - 1; r++) {
            const pairings = [];
            pairings.push([fixed, rotating[0]]);
            for (let i = 1; i < n / 2; i++) {
                const a = rotating[i];
                const b = rotating[rotating.length - i];
                pairings.push([a, b]);
            }
            const clean = pairings.filter(([a, b]) => a !== "BYE" && b !== "BYE");
            rounds.push(clean);
            rotating.unshift(rotating.pop());
        }
        return rounds;
    }

    function coreGetNextLeagueRound(leagueName, teams) {
        const key = String(leagueName || "");
        if (!key || !teams || teams.length < 2) return [];
        const teamKey = teams.map(String).sort().join("|");
        const rounds = coreFullRoundRobin(teams);
        if (rounds.length === 0) return [];
        let state = coreLeagueRoundState[key] || { idx: 0, teamKey };
        if (state.teamKey !== teamKey) state = { idx: 0, teamKey };
        const idx = state.idx % rounds.length;
        const matchups = rounds[idx];
        state.idx = (idx + 1) % rounds.length;
        coreLeagueRoundState[key] = state;
        saveCoreLeagueRoundState();
        return matchups;
    }

    // ====== LEAGUE "QUANTUM-ISH" SPORT OPTIMIZER (FULL) ======
    function assignSportsMultiRound(
        matchups,
        availableLeagueSports,
        existingTeamCounts,
        leagueHistory,
        lastSportByTeamBase
    ) {
        const sports = availableLeagueSports.slice();
        const baseTeamCounts = existingTeamCounts || {};
        const baseLastSports = lastSportByTeamBase || {};

        const allTeams = new Set();
        matchups.forEach(([a, b]) => {
            if (!a || !b) return;
            allTeams.add(String(a));
            allTeams.add(String(b));
        });

        const workCounts = {};
        allTeams.forEach(t => {
            workCounts[t] = {};
            const src = baseTeamCounts[t] || {};
            for (const key in src) {
                if (Object.prototype.hasOwnProperty.call(src, key)) {
                    workCounts[t][key] = src[key];
                }
            }
        });

        const workLastSport = {};
        allTeams.forEach(t => {
            workLastSport[t] = baseLastSports[t] || null;
        });

        const sportTotals = {};
        sports.forEach(s => {
            sportTotals[s] = 0;
        });
        for (const team in workCounts) {
            if (!Object.prototype.hasOwnProperty.call(workCounts, team)) continue;
            const counts = workCounts[team];
            for (const s in counts) {
                if (Object.prototype.hasOwnProperty.call(counts, s)) {
                    sportTotals[s] = (sportTotals[s] || 0) + counts[s];
                }
            }
        }

        let bestPlan = null;
        let bestScore = Infinity;
        let bestCounts = null;
        let bestLastSports = null;
        let nodesVisited = 0;
        const MAX_NODES = 30000;

        function teamDistinctSports(team) { return Object.keys(workCounts[team] || {}).length; }
        function teamTotalGames(team) {
            const counts = workCounts[team] || {};
            let total = 0;
            for (const s in counts) {
                if (Object.prototype.hasOwnProperty.call(counts, s)) total += counts[s];
            }
            return total;
        }
        function teamImbalance(team) {
            if (sports.length === 0) return 0;
            const counts = workCounts[team] || {};
            let min = Infinity;
            let max = -Infinity;
            sports.forEach(s => {
                const v = counts[s] || 0;
                if (v < min) min = v;
                if (v > max) max = v;
            });
            return max - min;
        }
        function globalImbalance() {
            if (sports.length === 0) return 0;
            let min = Infinity;
            let max = -Infinity;
            sports.forEach(s => {
                const v = sportTotals[s] || 0;
                if (v < min) min = v;
                if (v > max) max = v;
            });
            return max - min;
        }

        function dfs(idx, plan, currentCost) {
            if (currentCost >= bestScore) return;
            if (nodesVisited > MAX_NODES) return;

            if (idx === matchups.length) {
                const totalCost = currentCost + globalImbalance() * 4;
                if (totalCost < bestScore) {
                    bestScore = totalCost;
                    bestPlan = plan.slice();
                    bestCounts = JSON.parse(JSON.stringify(workCounts));
                    bestLastSports = JSON.parse(JSON.stringify(workLastSport));
                }
                return;
            }

            nodesVisited++;

            const [rawA, rawB] = matchups[idx];
            const teamA = String(rawA);
            const teamB = String(rawB);

            const orderedSports = sports.slice().sort((s1, s2) => {
                const c1 = (workCounts[teamA][s1] || 0) + (workCounts[teamB][s1] || 0);
                const c2 = (workCounts[teamA][s2] || 0) + (workCounts[teamB][s2] || 0);
                if (c1 !== c2) return c1 - c2;

                const h1 = leagueHistory[s1] || 0;
                const h2 = leagueHistory[s2] || 0;
                return h1 - h2;
            });

            for (const sport of orderedSports) {
                const prevA = workCounts[teamA][sport] || 0;
                const prevB = workCounts[teamB][sport] || 0;

                let delta = 0;
                if (prevA > 0) delta += 5;
                if (prevB > 0) delta += 5;
                if (workLastSport[teamA] === sport) delta += 40;
                if (workLastSport[teamB] === sport) delta += 40;

                workCounts[teamA][sport] = prevA + 1;
                workCounts[teamB][sport] = prevB + 1;
                sportTotals[sport] = (sportTotals[sport] || 0) + 2;

                workLastSport[teamA] = sport;
                workLastSport[teamB] = sport;

                const newCost = currentCost + delta;

                if (newCost < bestScore) {
                    plan.push({ sport });
                    dfs(idx + 1, plan, newCost);
                    plan.pop();
                }

                workCounts[teamA][sport] = prevA;
                workCounts[teamB][sport] = prevB;
                sportTotals[sport] = (sportTotals[sport] || 0) - 2;
                if (prevA === 0) delete workCounts[teamA][sport];
                if (prevB === 0) delete workCounts[teamB][sport];

                workLastSport[teamA] = baseLastSports[teamA] || null; 
                workLastSport[teamB] = baseLastSports[teamB] || null;
            }
        }

        dfs(0, [], 0);

        if (!bestPlan) {
            const fallback = matchups.map((_, i) => ({
                sport: sports[i % sports.length]
            }));
            return {
                assignments: fallback,
                updatedTeamCounts: baseTeamCounts,
                updatedLastSports: baseLastSports
            };
        }

        return {
            assignments: bestPlan,
            updatedTeamCounts: bestCounts || baseTeamCounts,
            updatedLastSports: bestLastSports || baseLastSports
        };
    }

    function pairRoundRobin(teamList) {
        const arr = teamList.map(String);
        if (arr.length < 2) return [];
        if (arr.length % 2 === 1) arr.push("BYE");
        const n = arr.length;
        const half = n / 2;
        const pairs = [];
        for (let i = 0; i < half; i++) {
            const A = arr[i];
            const B = arr[n - 1 - i];
            if (A !== "BYE" && B !== "BYE") pairs.push([A, B]);
        }
        return pairs;
    }

    function shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }

    // =====================================================================
    // MAIN ENTRY POINT
    // =====================================================================
    window.runSkeletonOptimizer = function(manualSkeleton) {
        window.scheduleAssignments = {};
        window.leagueAssignments = {};
        window.unifiedTimes = [];

        if (!manualSkeleton || manualSkeleton.length === 0) {
            return false;
        }

        const {
            divisions,
            availableDivisions,
            activityProperties,
            allActivities,
            h2hActivities,
            fieldsBySport,
            masterLeagues,
            masterSpecialtyLeagues,
            yesterdayHistory,
            rotationHistory,
            disabledLeagues,
            disabledSpecialtyLeagues,
            historicalCounts,
            specialActivityNames 
        } = loadAndFilterData();

        let fieldUsageBySlot = {};
        window.fieldUsageBySlot = fieldUsageBySlot;
        window.activityProperties = activityProperties;

        const timestamp = Date.now();
        const dailyLeagueSportsUsage = {};

        // ============================================================
        // FAIRNESS ENGINE (Global Usage Buckets for Generated Stuff)
        // - Tracks usage by bunk + category, e.g. "special:any"
        // - Used initially for Smart Tiles (specials), and can be reused
        //   for sports slots, regular Special Activity slots, etc.
        // ============================================================
        const bunkCategoryBaseUsage = {};   // from history + manual offsets
        const bunkCategoryTodayUsage = {};  // updated as we generate today

        function ensureBunkCategory(bunk) {
            if (!bunkCategoryBaseUsage[bunk]) bunkCategoryBaseUsage[bunk] = {};
            if (!bunkCategoryTodayUsage[bunk]) bunkCategoryTodayUsage[bunk] = {};
        }

        // Build base usage from historicalCounts + known specials
        (availableDivisions || []).forEach(divName => {
            const bunksInDiv = divisions[divName]?.bunks || [];
            bunksInDiv.forEach(bunk => {
                ensureBunkCategory(bunk);

                const hist = historicalCounts[bunk] || {};
                let totalSpecials = 0;

                // Aggregate all specials into "special:any"
                (specialActivityNames || []).forEach(actName => {
                    const c = hist[actName] || 0;
                    totalSpecials += c;

                    // Also track per-special category: "special:Gameroom", etc.
                    if (c > 0) {
                        const key = `special:${actName}`;
                        bunkCategoryBaseUsage[bunk][key] =
                            (bunkCategoryBaseUsage[bunk][key] || 0) + c;
                    }
                });

                bunkCategoryBaseUsage[bunk]["special:any"] =
                    (bunkCategoryBaseUsage[bunk]["special:any"] || 0) + totalSpecials;
            });
        });

        function getCategoryUsage(bunk, categoryKey) {
            ensureBunkCategory(bunk);
            const base = bunkCategoryBaseUsage[bunk][categoryKey] || 0;
            const today = bunkCategoryTodayUsage[bunk][categoryKey] || 0;
            return base + today;
        }

        function bumpCategoryUsage(bunk, categoryKey, amount = 1) {
            ensureBunkCategory(bunk);
            bunkCategoryTodayUsage[bunk][categoryKey] =
                (bunkCategoryTodayUsage[bunk][categoryKey] || 0) + amount;
        }

        // Helper: when we care about fairness for a category, we can
        // sort bunks by effective usage:
        function getFairnessOrderForCategory(categoryKey, bunksList) {
            const arr = (bunksList || []).slice();
            arr.sort((a, b) => {
                const ua = getCategoryUsage(a, categoryKey);
                const ub = getCategoryUsage(b, categoryKey);
                if (ua !== ub) return ua - ub; // LOWEST usage first

                // Tie-break: by total specials (keeps global special spread fair)
                const ta = getCategoryUsage(a, "special:any");
                const tb = getCategoryUsage(b, "special:any");
                if (ta !== tb) return ta - tb;

                // Final tie-break: random to prevent fixed patterns
                return Math.random() - 0.5;
            });
            return arr;
        }

        // Map Smart Tile labels / events into fairness categories
        function getFairnessCategoryForSmartLabel(label) {
            if (!label) return null;
            const s = String(label).trim().toLowerCase();

            // Sports tile: all generated sports share "sport:any"
            if (s === "sports" || s === "sport" || s === "sports slot") {
                return "sport:any";
            }

            // Generic "Special Activity" bucket
            if (s === "special" || s === "special activity") {
                return "special:any";
            }

            // If it's one of the named specials, prioritize that specifically
            const exact = specialActivityNames || [];
            for (const name of exact) {
                if (s === String(name).trim().toLowerCase()) {
                    return `special:${name}`;
                }
            }

            // Swim / Lunch / Snack etc → placed, no fairness category
            if (s === "swim" || s === "lunch" || s === "snack") {
                return null;
            }

            // Default: no category (treated as placed-only for now)
            return null;
        }

        // =================================================================
        // PASS 1: DYNAMIC TIME GRID (Atomic Intervals)
        // =================================================================
        let timePoints = new Set();
        timePoints.add(540); // 9:00 AM
        timePoints.add(960); // 4:00 PM

        manualSkeleton.forEach(item => {
            const s = parseTimeToMinutes(item.startTime);
            const e = parseTimeToMinutes(item.endTime);
            if (s !== null) timePoints.add(s);
            if (e !== null) timePoints.add(e);
        });

        const sortedPoints = Array.from(timePoints).sort((a, b) => a - b);

        window.unifiedTimes = [];
        for (let i = 0; i < sortedPoints.length - 1; i++) {
            const start = sortedPoints[i];
            const end = sortedPoints[i + 1];
            if (end - start >= 5) {
                window.unifiedTimes.push({
                    start: minutesToDate(start),
                    end: minutesToDate(end),
                    label: `${fmtTime(minutesToDate(start))} - ${fmtTime(minutesToDate(end))}`
                });
            }
        }

        if (window.unifiedTimes.length === 0) {
            window.updateTable?.();
            return false;
        }

        availableDivisions.forEach(divName => {
            (divisions[divName]?.bunks || []).forEach(bunk => {
                window.scheduleAssignments[bunk] = new Array(window.unifiedTimes.length);
            });
        });

        // =================================================================
        // PASS 1.5 — Bunk-Specific Pinned Overrides
        // =================================================================
        try {
            const dailyData = window.loadCurrentDailyData?.() || {};
            const bunkOverrides = dailyData.bunkActivityOverrides || [];
            bunkOverrides.forEach(override => {
                const startMin = parseTimeToMinutes(override.startTime);
                const endMin = parseTimeToMinutes(override.endTime);
                const slots = findSlotsForRange(startMin, endMin);
                const bunk = override.bunk;
                if (window.scheduleAssignments[bunk] && slots.length > 0) {
                    slots.forEach((slotIndex, idx) => {
                        if (!window.scheduleAssignments[bunk][slotIndex]) {
                            window.scheduleAssignments[bunk][slotIndex] = {
                                field: { name: override.activity },
                                sport: null,
                                continuation: (idx > 0),
                                _fixed: true,
                                _h2h: false,
                                vs: null,
                                _activity: override.activity,
                                _endTime: endMin
                            };
                        }
                    });
                }
            });
        } catch (e) { console.error("Error placing bunk-specific overrides:", e); }

        function normalizeGA(name) {
            if (!name) return null;
            const s = String(name).toLowerCase().replace(/\s+/g, '');
            const keys = ["generalactivity", "activity", "activyty", "activty", "activityslot", "genactivity", "genact", "ga"];
            if (keys.some(k => s.includes(k))) return "General Activity Slot";
            return null;
        }
        function normalizeLeague(name) {
            if (!name) return null;
            const s = String(name).toLowerCase().replace(/\s+/g, '');
            const keys = ["leaguegame", "leaguegameslot", "leagame", "lg", "lgame"];
            if (keys.some(k => s.includes(k))) return "League Game";
            return null;
        }
        function normalizeSpecialtyLeague(name) {
            if (!name) return null;
            const s = String(name).toLowerCase().replace(/\s+/g, '');
            const keys = ["specialtyleague", "specialityleague", "specleague", "specialleague", "sleauge"];
            if (keys.some(k => s.includes(k))) return "Specialty League";
            return null;
        }

        // =================================================================
        // PASS 2 — Pinned / Split / Slot Skeleton Blocks
        // =================================================================
        const schedulableSlotBlocks = [];
        const smartTileGroups = {}; 

        manualSkeleton.forEach(item => {
            const allBunks = divisions[item.division]?.bunks || [];
            if (!allBunks || allBunks.length === 0) return;
            const startMin = parseTimeToMinutes(item.startTime);
            const endMin = parseTimeToMinutes(item.endTime);
            
            const allSlots = findSlotsForRange(startMin, endMin);
            if (allSlots.length === 0) return;

            const normGA = normalizeGA(item.event);
            const normLeague = normalizeLeague(item.event);
            const normSpecLg = normalizeSpecialtyLeague(item.event);
            const finalEventName = normGA || normSpecLg || normLeague || item.event;
            const isGeneratedEvent = GENERATED_EVENTS.includes(finalEventName) || normGA === "General Activity Slot" || normLeague === "League Game" || normSpecLg === "Specialty League" || item.type === 'smart';

            if (item.type === 'pinned' || !isGeneratedEvent) {
                // Fully pinned: every bunk, every slot = same fixed tile
                allBunks.forEach(bunk => {
                    allSlots.forEach((slotIndex, idx) => {
                        if (!window.scheduleAssignments[bunk][slotIndex]) {
                            window.scheduleAssignments[bunk][slotIndex] = {
                                field: { name: item.event },
                                sport: null,
                                continuation: (idx > 0),
                                _fixed: true,
                                _h2h: false,
                                vs: null,
                                _activity: item.event,
                                _endTime: endMin
                            };
                        }
                    });
                });
            }
            else if (item.type === 'split') {
                if (!item.subEvents || item.subEvents.length < 2) return;
                const swimLabel = "Swim";
                const rawGAEvent = item.subEvents[1].event;
                const gaLabel = normalizeGA(rawGAEvent) || "General Activity Slot";
                
                const mid = Math.ceil(allBunks.length / 2);
                const bunksTop = allBunks.slice(0, mid);
                const bunksBottom = allBunks.slice(mid);
                const slotMid = Math.ceil(allSlots.length / 2);
                const slotsFirst = allSlots.slice(0, slotMid);
                const slotsSecond = allSlots.slice(slotMid);
                
                function pinSwim(bunks, slots) {
                    bunks.forEach(bunk => {
                        slots.forEach((slotIndex, idx) => {
                            window.scheduleAssignments[bunk][slotIndex] = {
                                field: { name: swimLabel },
                                sport: null,
                                continuation: (idx > 0),
                                _fixed: true,
                                _h2h: false,
                                vs: null,
                                _activity: swimLabel
                            };
                        });
                    });
                }
                function pushGA(bunks, slots) {
                    bunks.forEach(bunk => {
                        schedulableSlotBlocks.push({ divName: item.division, bunk: bunk, event: gaLabel, startTime: startMin, endTime: endMin, slots });
                    });
                }
                pinSwim(bunksTop, slotsFirst);
                pushGA(bunksBottom, slotsFirst);
                pushGA(bunksTop, slotsSecond);
                pinSwim(bunksBottom, slotsSecond);
            }
            else if (item.type === 'smart' && item.smartData) {
                const signature = [item.smartData.main1, item.smartData.main2].sort().join('|');
                const key = `${item.division}::${signature}`;
                if (!smartTileGroups[key]) smartTileGroups[key] = [];
                smartTileGroups[key].push({
                    divName: item.division,
                    startTime: startMin,
                    endTime: endMin,
                    slots: allSlots,
                    smartData: item.smartData,
                    bunks: allBunks
                });
            }
            else if (item.type === 'slot' && isGeneratedEvent) {
                let normalizedEvent = null;
                if (normalizeSpecialtyLeague(item.event)) normalizedEvent = "Specialty League";
                else if (normalizeLeague(item.event)) normalizedEvent = "League Game";
                else if (normalizeGA(item.event)) normalizedEvent = "General Activity Slot";
                else normalizedEvent = item.event;
                allBunks.forEach(bunk => {
                    schedulableSlotBlocks.push({ divName: item.division, bunk: bunk, event: normalizedEvent, startTime: startMin, endTime: endMin, slots: allSlots });
                });
            }
        });

        // =================================================================
        // PASS 2.5 — SMART TILE LOGIC (Fairness for Generated Sides)
        // =================================================================
        Object.entries(smartTileGroups).forEach(([key, blocks]) => {
            // All Smart Tile blocks sharing the same (division + main labels)
            blocks.sort((a, b) => a.startTime - b.startTime);

            const divName = blocks[0].divName;
            const bunks = divisions[divName]?.bunks || [];
            if (!bunks.length) return;

            const smartDataSample = blocks[0].smartData || {};
            const main1 = smartDataSample.main1;
            const main2 = smartDataSample.main2;
            const fallbackFor = smartDataSample.fallbackFor;
            const fallbackAct = smartDataSample.fallbackActivity;

            const cat1 = getFairnessCategoryForSmartLabel(main1);
            const cat2 = getFairnessCategoryForSmartLabel(main2);
    // Track, per Smart Tile group, how many times each bunk has gotten
    // the "generated" side (e.g., Special Activity) within THIS group.
    const groupGeneratedCount = {};
    bunks.forEach(b => { groupGeneratedCount[b] = 0; });

            // Helper: schedule a specific activity label inside a Smart block
            const attemptSchedule = (bunk, activity, block) => {
                if (!activity) return false;

                const normAct = String(activity).trim();
                let finalField = normAct;
                let finalSport = null;
                let finalActivityType = normAct;
                let success = false;

                // SPORTS side (Sports tile or fallback)
                if (normAct.toLowerCase() === 'sports' ||
                    normAct.toLowerCase() === 'sport' ||
                    normAct.toLowerCase() === 'sports slot') {

                    const pick = window.findBestSportActivity?.({
                        divName,
                        bunk,
                        slots: block.slots,
                        startTime: block.startTime,
                        endTime: block.endTime
                    }, allActivities, fieldUsageBySlot, yesterdayHistory,
                       activityProperties, rotationHistory, divisions, historicalCounts);

                    if (pick) {
                        finalField = pick.field;
                        finalSport = pick.sport;
                        if (pick._activity) finalActivityType = pick._activity;
                        success = true;
                    }
                }
                // GENERIC SPECIAL BUCKET
                else if (normAct.toLowerCase() === 'special' ||
                         normAct.toLowerCase() === 'special activity') {

                    const candidates = allActivities
                        .filter(a => a.type === 'special')
                        .slice()
                        .sort((a, b) => {
                            const ca = historicalCounts[bunk]?.[a.field] || 0;
                            const cb = historicalCounts[bunk]?.[b.field] || 0;
                            return ca - cb;
                        });

                    for (const cand of candidates) {
                        if (canBlockFit({
                            divName,
                            bunk,
                            slots: block.slots,
                            startTime: block.startTime,
                            endTime: block.endTime
                        }, cand.field, activityProperties, fieldUsageBySlot, cand.field)) {
                            finalField = cand.field;
                            finalActivityType = cand.field;
                            success = true;
                            break;
                        }
                    }
                }
                // DIRECT FIELD NAME (Gameroom, Swim, Canteen, etc.)
                else {
                    if (canBlockFit({
                        divName,
                        bunk,
                        slots: block.slots,
                        startTime: block.startTime,
                        endTime: block.endTime
                    }, finalField, activityProperties, fieldUsageBySlot, finalActivityType)) {
                        success = true;
                    }
                }

                if (success) {
                    fillBlock({
                        divName,
                        bunk,
                        slots: block.slots,
                        startTime: block.startTime,
                        endTime: block.endTime
                    }, {
                        field: finalField,
                        sport: finalSport,
                        _activity: finalActivityType,
                        _fixed: false,
                        _h2h: false
                    }, fieldUsageBySlot, yesterdayHistory, false);

                    return true;
                }
                return false;
            };

            // Process each Smart Tile block in time order
            blocks.forEach((block, blockIndex) => {
                const isLastBlock = (blockIndex === blocks.length - 1);

                // Determine which label we are *generating* in this block
                // For now:
                // - If one main has a fairness category (generated) and the other doesn't,
                //   that one is "generated", the other is "placed".
                // - If both have categories, we default to main1 as generated here
                //   (you can later alternate by blockIndex if you want).
                let generatedLabel = null;
                let generatedCategory = null;
                let placedLabel = null;

                if (cat1 && !cat2) {
                    generatedLabel = main1;
                    generatedCategory = cat1;
                    placedLabel = main2;
                } else if (cat2 && !cat1) {
                    generatedLabel = main2;
                    generatedCategory = cat2;
                    placedLabel = main1;
                } else if (cat1 && cat2) {
                    generatedLabel = main1;
                    generatedCategory = cat1;
                    placedLabel = main2;
                } else {
                    // Neither side is generated: just place main1 for all bunks
                    bunks.forEach(bunk => {
                        attemptSchedule(bunk, main1, block);
                    });
                    return;
                }

                // 1) FAIRNESS ORDER: who should get the generatedLabel in THIS block?
                const fairOrder = getFairnessOrderForCategory(generatedCategory, bunks);

                       // 2) Try to give generatedLabel (e.g. "Special Activity") to bunks in fairness order.
        const gotGeneratedHere = {};
        fairOrder.forEach(bunk => {
            // 🚫 Don't give the generated side to the same bunk twice
            // within this Smart Tile group (e.g. they can't get Special twice).
            if (groupGeneratedCount[bunk] >= 1) return;
            if (gotGeneratedHere[bunk]) return;

            if (attemptSchedule(bunk, generatedLabel, block)) {
                gotGeneratedHere[bunk] = true;
                groupGeneratedCount[bunk] += 1;   // ✅ mark they got the special once

                bumpCategoryUsage(bunk, generatedCategory, 1);

                // Also let it contribute to special:any if it's a specific special
                if (generatedCategory.startsWith("special:")) {
                    bumpCategoryUsage(bunk, "special:any", 1);
                }
            }
        });


                // 3) For bunks that did NOT get the generatedLabel here:
                //    - If we have a fallback (*and* this is the last block), try fallback.
                //    - Otherwise, place the other side (Swim, etc.) if it isn't generated.
                //    - If everything fails, they remain open for later filler.
                // NOTE: we iterate in bunk order; fairness for fallback is less critical,
                //       but you can upgrade later by using getFairnessOrderForCategory
                //       with the fallback category as well.
                bunks.forEach(bunk => {
                    if (gotGeneratedHere[bunk]) return;

                    const gotSomethingAlready =
                        window.scheduleAssignments[bunk] &&
                        block.slots.some(idx => window.scheduleAssignments[bunk][idx]);

                    if (gotSomethingAlready) return;

                    // LAST BLOCK + fallback: treat as generated category (e.g. sport:any)
                    if (isLastBlock && fallbackAct) {
                        if (attemptSchedule(bunk, fallbackAct, block)) {
                            const fbCat = getFairnessCategoryForSmartLabel(fallbackAct);
                            if (fbCat) {
                                bumpCategoryUsage(bunk, fbCat, 1);
                                if (fbCat.startsWith("special:")) {
                                    bumpCategoryUsage(bunk, "special:any", 1);
                                }
                            }
                            return;
                        }
                    }

                    // Otherwise, place the "placed" side if available.
                    if (placedLabel) {
                        attemptSchedule(bunk, placedLabel, block);
                    }
                });
            });
        });

        // =================================================================
        // PASS 3 — SPECIALTY LEAGUES
        // =================================================================
        const leagueBlocks = schedulableSlotBlocks.filter(b => b.event === 'League Game');
        const specialtyLeagueBlocks = schedulableSlotBlocks.filter(b => b.event === 'Specialty League');
        const remainingBlocks = schedulableSlotBlocks.filter(b => b.event !== 'League Game' && b.event !== 'Specialty League');

        const specialtyLeagueGroups = {};
        specialtyLeagueBlocks.forEach(block => {
            const key = `${block.divName}-${block.startTime}`;
            if (!specialtyLeagueGroups[key]) specialtyLeagueGroups[key] = { divName: block.divName, startTime: block.startTime, endTime: block.endTime, slots: block.slots, bunks: new Set() };
            specialtyLeagueGroups[key].bunks.add(block.bunk);
        });

        Object.values(specialtyLeagueGroups).forEach(group => {
            const leagueEntry = Object.values(masterSpecialtyLeagues).find(l => l.enabled && !disabledSpecialtyLeagues.includes(l.name) && l.divisions.includes(group.divName));
            if (!leagueEntry) return;
            const allBunksInGroup = Array.from(group.bunks);
            const blockBase = { slots: group.slots, divName: group.divName, startTime: group.startTime, endTime: group.endTime };
            const leagueName = leagueEntry.name;
            const leagueHistory = rotationHistory.leagues[leagueName] || {};
            rotationHistory.leagues[leagueName] = leagueHistory;
            const sport = leagueEntry.sport;
            if (!sport) return;
            const bestSport = sport;
            const allMatchupLabels = [];
            const picksByTeam = {};

            if (bestSport) {
                const leagueFields = leagueEntry.fields || [];
                const leagueTeams = (leagueEntry.teams || []).map(t => String(t).trim()).filter(Boolean);
                if (leagueFields.length !== 0 && leagueTeams.length >= 2) {
                     let matchups = [];
                     if (typeof window.getLeagueMatchups === 'function') matchups = window.getLeagueMatchups(leagueEntry.name, leagueTeams) || [];
                     else matchups = pairRoundRobin(leagueTeams);
                     
                     const gamesPerField = Math.ceil(matchups.length / leagueFields.length);
                     const slotCount = group.slots.length || 1;
                     const usedFieldsInThisBlock = Array.from({ length: slotCount }, () => new Set());
                     
                     for (let i = 0; i < matchups.length; i++) {
                         const [teamA, teamB] = matchups[i];
                         if (teamA === "BYE" || teamB === "BYE") continue;
                         const fieldIndex = Math.floor(i / gamesPerField);
                         const fieldName = leagueFields[fieldIndex % leagueFields.length];
                         const baseLabel = `${teamA} vs ${teamB} (${bestSport})`;
                         let isFieldAvailable = true;
                         const slotIndex = group.slots[i % slotCount];
                         if (fieldUsageBySlot[slotIndex]?.[fieldName]?.count >= 1) isFieldAvailable = false;
                         if (usedFieldsInThisBlock[i % slotCount].has(fieldName)) isFieldAvailable = false;
                         
                         const props = activityProperties[fieldName];
                         if (props) {
                             if (!isTimeAvailable(slotIndex, props)) isFieldAvailable = false;
                             if (props.preferences?.enabled && props.preferences.exclusive && !props.preferences.list.includes(group.divName)) isFieldAvailable = false;
                             if (props.limitUsage?.enabled && !props.limitUsage.divisions[group.divName]) isFieldAvailable = false;
                         }

                         let pick;
                         if (fieldName && isFieldAvailable) {
                             pick = { field: fieldName, sport: baseLabel, _h2h: true, vs: null, _activity: bestSport };
                             markFieldUsage({ ...blockBase, _activity: bestSport, bunk: 'league' }, fieldName, fieldUsageBySlot);
                             usedFieldsInThisBlock[i % slotCount].add(fieldName);
                             allMatchupLabels.push(`${baseLabel} @ ${fieldName}`);
                         } else {
                             pick = { field: "No Field", sport: baseLabel, _h2h: true, vs: null, _activity: bestSport };
                             allMatchupLabels.push(`${baseLabel} (No Field)`);
                         }
                         picksByTeam[teamA] = pick;
                         picksByTeam[teamB] = pick;
                     }
                }
            }
            const noGamePick = { field: "No Game", sport: null, _h2h: true, _activity: bestSport || "Specialty League", _allMatchups: allMatchupLabels };
            allBunksInGroup.forEach(bunk => {
                const pickToAssign = picksByTeam[bunk] || noGamePick;
                pickToAssign._allMatchups = allMatchupLabels;
                fillBlock({ ...blockBase, bunk }, pickToAssign, fieldUsageBySlot, yesterdayHistory, true);
            });
        });

        // =================================================================
        // PASS 3.5 — REGULAR LEAGUES
        // =================================================================
        const leagueGroups = {};
        leagueBlocks.forEach(block => {
            const leagueEntry = Object.entries(masterLeagues).find(([name, l]) => l.enabled && !disabledLeagues.includes(name) && l.divisions.includes(block.divName));
            if (!leagueEntry) return;
            const leagueName = leagueEntry[0];
            const key = `${leagueName}-${block.startTime}`;
            if (!leagueGroups[key]) leagueGroups[key] = { leagueName, league: leagueEntry[1], startTime: block.startTime, endTime: block.endTime, slots: block.slots, bunks: new Set() };
            leagueGroups[key].bunks.add(block.bunk);
        });
        const sortedLeagueGroups = Object.values(leagueGroups).sort((a, b) => a.startTime - b.startTime);
        sortedLeagueGroups.forEach(group => {
            const { leagueName, league, slots } = group;
            const leagueTeams = (league.teams || []).map(t => String(t).trim()).filter(Boolean);
            if (leagueTeams.length < 2) return;
            const allBunksInGroup = Array.from(group.bunks).sort();
            if (allBunksInGroup.length === 0) return;
            let baseDivName = null;
            const firstBunk = allBunksInGroup[0];
            baseDivName = Object.keys(divisions).find(div => (divisions[div].bunks || []).includes(firstBunk));
            if (!baseDivName) return;
            const blockBase = { slots, divName: baseDivName, endTime: group.endTime };
            const sports = (league.sports || []).filter(s => fieldsBySport[s]);
            if (sports.length === 0) return;
            
            const usedToday = dailyLeagueSportsUsage[leagueName] || new Set();
            let optimizerSports = sports.filter(s => !usedToday.has(s));
            if (optimizerSports.length === 0) optimizerSports = sports;
            
            const leagueHistory = rotationHistory.leagues[leagueName] || {};
            rotationHistory.leagues[leagueName] = leagueHistory;
            const leagueTeamCounts = rotationHistory.leagueTeamSports[leagueName] || {};
            rotationHistory.leagueTeamSports[leagueName] = leagueTeamCounts;
            rotationHistory.leagueTeamLastSport = rotationHistory.leagueTeamLastSport || {};
            const leagueTeamLastSport = rotationHistory.leagueTeamLastSport[leagueName] || {};
            rotationHistory.leagueTeamLastSport[leagueName] = leagueTeamLastSport;

            let standardMatchups = [];
            if (typeof window.getLeagueMatchups === "function") standardMatchups = window.getLeagueMatchups(leagueName, leagueTeams) || [];
            else standardMatchups = coreGetNextLeagueRound(leagueName, leagueTeams) || [];
            
            const slotCount = slots.length || 1;
            
            const evaluateMatchups = (candidateMatchups) => {
                const nonBye = candidateMatchups.filter(p => p && p[0] !== "BYE" && p[1] !== "BYE");
                const { assignments } = assignSportsMultiRound(nonBye, optimizerSports, leagueTeamCounts, leagueHistory, leagueTeamLastSport);
                const simUsedFields = Array.from({ length: slotCount }, () => new Set());
                let successCount = 0;
                const results = [];
                nonBye.forEach((pair, idx) => {
                     const [teamA, teamB] = pair;
                     const preferredSport = assignments[idx]?.sport || optimizerSports[idx % optimizerSports.length];
                     const candidateSports = [preferredSport, ...sports.filter(s => s !== preferredSport && !usedToday.has(s)), ...sports.filter(s => s !== preferredSport && usedToday.has(s))];
                     let foundField = null, foundSport = preferredSport, slotIdx = idx % slotCount;
                     for (const s of candidateSports) {
                         const possibleFields = fieldsBySport[s] || [];
                         let found = null;
                         for (const f of possibleFields) {
                             if (!simUsedFields[slotIdx].has(f) && (fieldUsageBySlot[slots[slotIdx]]?.[f]?.count || 0) === 0 && canLeagueGameFit(blockBase, f, fieldUsageBySlot, activityProperties)) {
                                 found = f; break;
                             }
                         }
                         if (found) { foundField = found; foundSport = s; simUsedFields[slotIdx].add(found); break; }
                     }
                     if (foundField) successCount++;
                     results.push({ pair, sport: foundSport, field: foundField, assignments: assignments[idx] });
                });
                return { successCount, results, matchups: candidateMatchups, assignments };
            };

            let bestResult = evaluateMatchups(standardMatchups);
            const nonByeCount = standardMatchups.filter(p => p && p[0] !== "BYE" && p[1] !== "BYE").length;
            if (bestResult.successCount < nonByeCount) {
                 const teamListCopy = [...leagueTeams];
                 for (let i = 0; i < 50; i++) {
                     shuffleArray(teamListCopy);
                     const shuffledMatchups = pairRoundRobin(teamListCopy);
                     const res = evaluateMatchups(shuffledMatchups);
                     if (res.successCount > bestResult.successCount) {
                         bestResult = res; if (res.successCount === nonByeCount) break;
                     }
                 }
            }

            const { assignments } = bestResult;
            const winningMatchups = bestResult.matchups.filter(p => p && p[0] !== "BYE" && p[1] !== "BYE");
            const finalOpt = assignSportsMultiRound(winningMatchups, optimizerSports, leagueTeamCounts, leagueHistory, leagueTeamLastSport);
            rotationHistory.leagueTeamSports[leagueName] = finalOpt.updatedTeamCounts;
            rotationHistory.leagueTeamLastSport[leagueName] = finalOpt.updatedLastSports;

            const allMatchupLabels = [], usedForAssignments = [], usedFieldsPerSlot = Array.from({ length: slotCount }, () => new Set());
            winningMatchups.forEach((pair, idx) => {
                 const [teamA, teamB] = pair;
                 const preferredSport = finalOpt.assignments[idx]?.sport || optimizerSports[idx % optimizerSports.length];
                 const candidateSports = [preferredSport, ...sports.filter(s => s !== preferredSport && !usedToday.has(s)), ...sports.filter(s => s !== preferredSport && usedToday.has(s))];
                 let finalSport = preferredSport, finalField = null, slotIdx = idx % slotCount;
                 for (const s of candidateSports) {
                     const possibleFields = fieldsBySport[s] || [];
                     let found = null;
                     for (const f of possibleFields) {
                         if (!usedFieldsPerSlot[slotIdx].has(f) && canLeagueGameFit(blockBase, f, fieldUsageBySlot, activityProperties)) {
                             found = f; break;
                         }
                     }
                     if (!found && possibleFields.length > 0) {
                         const f = possibleFields[usedFieldsPerSlot[slotIdx].size % possibleFields.length];
                         if (canLeagueGameFit(blockBase, f, fieldUsageBySlot, activityProperties)) found = f;
                     }
                     if (found) { finalSport = s; finalField = found; usedFieldsPerSlot[slotIdx].add(found); break; }
                 }
                 let label = finalField ? `${teamA} vs ${teamB} (${finalSport}) @ ${finalField}` : `${teamA} vs ${teamB} (No Field)`;
                 if (finalField) {
                     markFieldUsage({ ...blockBase, _activity: finalSport, bunk: 'league' }, finalField, fieldUsageBySlot);
                     if (!dailyLeagueSportsUsage[leagueName]) dailyLeagueSportsUsage[leagueName] = new Set();
                     dailyLeagueSportsUsage[leagueName].add(finalSport);
                 }
                 leagueHistory[finalSport] = Date.now();
                 usedForAssignments.push({ label, sport: finalSport, field: finalField || "No Field", teamA, teamB });
                 allMatchupLabels.push(label);
            });
            
            bestResult.matchups.forEach(pair => {
                 if (!pair) return;
                 const [teamA, teamB] = pair;
                 if (teamA === "BYE" || teamB === "BYE") allMatchupLabels.push(`${teamA} vs ${teamB} (BYE)`);
            });
            const noGamePick = { field: "No Game", sport: null, _h2h: true, _activity: "League", _allMatchups: allMatchupLabels };
            let bunkPtr = 0;
            usedForAssignments.forEach(game => {
                 if (bunkPtr + 1 >= allBunksInGroup.length) return;
                 const bunkA = allBunksInGroup[bunkPtr], bunkB = allBunksInGroup[bunkPtr+1]; bunkPtr += 2;
                 const pick = { field: game.field, sport: game.label, _h2h: true, vs: null, _activity: game.sport, _allMatchups: allMatchupLabels };
                 const bunkADiv = Object.keys(divisions).find(div => (divisions[div].bunks || []).includes(bunkA)) || baseDivName;
                 const bunkBDiv = Object.keys(divisions).find(div => (divisions[div].bunks || []).includes(bunkB)) || baseDivName;
                 fillBlock({ slots, bunk: bunkA, divName: bunkADiv, startTime: group.startTime, endTime: group.endTime + INCREMENT_MINS * slots.length }, pick, fieldUsageBySlot, yesterdayHistory, true);
                 fillBlock({ slots, bunk: bunkB, divName: bunkBDiv, startTime: group.startTime, endTime: group.endTime + INCREMENT_MINS * slots.length }, pick, fieldUsageBySlot, yesterdayHistory, true);
            });
            while (bunkPtr < allBunksInGroup.length) {
                 const leftoverBunk = allBunksInGroup[bunkPtr++];
                 const bunkDivName = Object.keys(divisions).find(div => (divisions[div].bunks || []).includes(leftoverBunk)) || baseDivName;
                 fillBlock({ slots, bunk: leftoverBunk, divName: bunkDivName, startTime: group.startTime, endTime: group.endTime + INCREMENT_MINS * slots.length }, noGamePick, fieldUsageBySlot, yesterdayHistory, true);
            }
        });

        // =================================================================
        // PASS 4 — Remaining Schedulable Slots
        // =================================================================
        remainingBlocks.sort((a, b) => a.startTime - b.startTime);
        for (const block of remainingBlocks) {
            if (!block.slots || block.slots.length === 0) continue;
            if (!window.scheduleAssignments[block.bunk]) continue;
            if (window.scheduleAssignments[block.bunk][block.slots[0]]) continue; 

            let pick = null;
            if (block.event === 'League Game' || block.event === 'Specialty League') {
                pick = { field: "Unassigned League", sport: null, _activity: "Free" };
            } else if (block.event === 'Special Activity') {
                pick = window.findBestSpecial?.(block, allActivities, fieldUsageBySlot, yesterdayHistory, activityProperties, rotationHistory, divisions, historicalCounts);
            } else if (block.event === 'Sports Slot') {
                pick = window.findBestSportActivity?.(block, allActivities, fieldUsageBySlot, yesterdayHistory, activityProperties, rotationHistory, divisions, historicalCounts);
            }
            if (!pick) {
                pick = window.findBestGeneralActivity?.(block, allActivities, h2hActivities, fieldUsageBySlot, yesterdayHistory, activityProperties, rotationHistory, divisions, historicalCounts);
            }
            if (pick && !isPickValidForBlock(block, pick, activityProperties, fieldUsageBySlot)) pick = null;
            if (pick) fillBlock(block, pick, fieldUsageBySlot, yesterdayHistory, false);
            else fillBlock(block, { field: "Free", sport: null, _activity: "Free" }, fieldUsageBySlot, false);
        }

        // =================================================================
        // PASS 5 — Update Rotation History
        // =================================================================
        try {
            const historyToSave = rotationHistory;
            availableDivisions.forEach(divName => {
                (divisions[divName]?.bunks || []).forEach(bunk => {
                    const schedule = window.scheduleAssignments[bunk] || [];
                    let lastActivity = null;
                    for (const entry of schedule) {
                        if (entry && entry._activity && entry._activity !== lastActivity) {
                            const activityName = entry._activity;
                            lastActivity = activityName;
                            historyToSave.bunks[bunk] = historyToSave.bunks[bunk] || {};
                            historyToSave.bunks[bunk][activityName] = timestamp;
                            if (entry._h2h && entry._activity !== "League" && entry._activity !== "No Game") {
                                const leagueEntry = Object.entries(masterLeagues).find(([name, l]) => l.enabled && l.divisions.includes(divName));
                                if (leagueEntry) {
                                    const lgName = leagueEntry[0];
                                    historyToSave.leagues[lgName] = historyToSave.leagues[lgName] || {};
                                    historyToSave.leagues[lgName][entry._activity] = timestamp;
                                }
                            }
                        } else if (entry && !entry.continuation) lastActivity = null;
                    }
                });
            });
            window.saveRotationHistory?.(historyToSave);
            console.log("Smart Scheduler: Rotation history updated.");
        } catch (e) { console.error("Smart Scheduler: Failed to update rotation history.", e); }

        window.saveCurrentDailyData?.("unifiedTimes", window.unifiedTimes);
        window.updateTable?.();
        window.saveSchedule?.();
        return true;
    };

    // =====================================================================
    // HELPER FUNCTIONS
    // =====================================================================
    function findSlotsForRange(startMin, endMin) {
        const slots = [];
        if (!window.unifiedTimes || startMin == null || endMin == null) return slots;
        for (let i = 0; i < window.unifiedTimes.length; i++) {
            const slot = window.unifiedTimes[i];
            const slotStart = new Date(slot.start).getHours() * 60 + new Date(slot.start).getMinutes();
            if (slotStart >= startMin && slotStart < endMin) slots.push(i);
        }
        return slots;
    }

    function markFieldUsage(block, fieldName, fieldUsageBySlot) {
        if (!fieldName || fieldName === "No Field" || !window.allSchedulableNames.includes(fieldName)) return;
        for (const slotIndex of block.slots || []) {
            if (slotIndex === undefined) continue;
            fieldUsageBySlot[slotIndex] = fieldUsageBySlot[slotIndex] || {};
            const usage = fieldUsageBySlot[slotIndex][fieldName] || { count: 0, divisions: [], bunks: {} };
            usage.count++;
            if (!usage.divisions.includes(block.divName)) usage.divisions.push(block.divName);
            const blockActivity = block._activity || block.sport || (block.event === 'League Game' ? 'League' : block.event);
            if (block.bunk && blockActivity) usage.bunks[block.bunk] = blockActivity;
            fieldUsageBySlot[slotIndex][fieldName] = usage;
        }
    }

    function isTimeAvailable(slotIndex, fieldProps) {
        if (!window.unifiedTimes || !window.unifiedTimes[slotIndex]) return false;
        const slot = window.unifiedTimes[slotIndex];
        const slotStartMin = new Date(slot.start).getHours() * 60 + new Date(slot.start).getMinutes();
        const slotEndMin = slotStartMin + INCREMENT_MINS;
        const rules = (fieldProps.timeRules || []).map(r => {
            if (typeof r.startMin === "number" && typeof r.endMin === "number") return r;
            return { ...r, startMin: parseTimeToMinutes(r.start), endMin: parseTimeToMinutes(r.end) };
        });
        if (rules.length === 0) return fieldProps.available;
        if (!fieldProps.available) return false;
        const hasAvailableRules = rules.some(r => r.type === 'Available');
        let isAvailable = !hasAvailableRules;
        for (const rule of rules) {
            if (rule.type === 'Available') {
                if (rule.startMin == null || rule.endMin == null) continue;
                if (slotStartMin >= rule.startMin && slotEndMin <= rule.endMin) { isAvailable = true; break; }
            }
        }
        for (const rule of rules) {
            if (rule.type === 'Unavailable') {
                if (rule.startMin == null || rule.endMin == null) continue;
                if (slotStartMin < rule.endMin && slotEndMin > rule.startMin) { isAvailable = false; break; }
            }
        }
        return isAvailable;
    }

    function getBlockTimeRange(block) {
        let blockStartMin = (typeof block.startTime === "number") ? block.startTime : null;
        let blockEndMin = (typeof block.endTime === "number") ? block.endTime : null;
        if ((blockStartMin == null || blockEndMin == null) && window.unifiedTimes && Array.isArray(block.slots) && block.slots.length > 0) {
            const minIndex = Math.min(...block.slots);
            const maxIndex = Math.max(...block.slots);
            const firstSlot = window.unifiedTimes[minIndex];
            const lastSlot = window.unifiedTimes[maxIndex];
            if (firstSlot && lastSlot) {
                const firstStart = new Date(firstSlot.start);
                const lastStart = new Date(lastSlot.start);
                blockStartMin = firstStart.getHours() * 60 + firstStart.getMinutes();
                blockEndMin = lastStart.getHours() * 60 + lastStart.getMinutes() + INCREMENT_MINS;
            }
        }
        return { blockStartMin, blockEndMin };
    }

    function canBlockFit(block, fieldName, activityProperties, fieldUsageBySlot, proposedActivity) {
        if (!fieldName) return false;
        const props = activityProperties[fieldName];
        
        // --- VIRTUAL ACTIVITY FIX ---
        if (!props) return true;

        const limit = (props && props.sharable) ? 2 : 1;
        if (props.preferences && props.preferences.enabled && props.preferences.exclusive && !props.preferences.list.includes(block.divName)) return false;
        if (props && Array.isArray(props.allowedDivisions) && props.allowedDivisions.length > 0 && !props.allowedDivisions.includes(block.divName)) return false;
        const limitRules = props.limitUsage;
        if (limitRules && limitRules.enabled) {
            if (!limitRules.divisions[block.divName]) return false;
            const allowedBunks = limitRules.divisions[block.divName];
            if (allowedBunks.length > 0 && block.bunk && !allowedBunks.includes(block.bunk)) return false;
        }

        const { blockStartMin, blockEndMin } = getBlockTimeRange(block);
        const rules = (props.timeRules || []).map(r => {
            if (typeof r.startMin === "number" && typeof r.endMin === "number") return r;
            return { ...r, startMin: parseTimeToMinutes(r.start), endMin: parseTimeToMinutes(r.end) };
        });

        if (rules.length > 0) {
            if (!props.available) return false;
            const hasAvailableRules = rules.some(r => r.type === 'Available');
            if (blockStartMin != null && blockEndMin != null) {
                if (hasAvailableRules) {
                    let insideAvailable = false;
                    for (const rule of rules) {
                        if (rule.type !== 'Available' || rule.startMin == null || rule.endMin == null) continue;
                        if (blockStartMin >= rule.startMin && blockEndMin <= rule.endMin) { insideAvailable = true; break; }
                    }
                    if (!insideAvailable) return false;
                }
                for (const rule of rules) {
                    if (rule.type !== 'Unavailable' || rule.startMin == null || rule.endMin == null) continue;
                    if (blockStartMin < rule.endMin && blockEndMin > rule.startMin) return false;
                }
            }
            for (const slotIndex of block.slots || []) {
                if (slotIndex === undefined) return false;
                const usage = fieldUsageBySlot[slotIndex]?.[fieldName] || { count: 0, divisions: [], bunks: {} };
                if (usage.count >= limit) return false;
                if (usage.count > 0) {
                    if (!usage.divisions.includes(block.divName)) return false;
                    let existingActivity = null;
                    for (const bunkName in usage.bunks) { if (usage.bunks[bunkName]) { existingActivity = usage.bunks[bunkName]; break; } }
                    if (existingActivity && proposedActivity && existingActivity !== proposedActivity) return false;
                }
                if (!isTimeAvailable(slotIndex, props)) return false;
            }
        } else {
            if (!props.available) return false;
            for (const slotIndex of block.slots || []) {
                if (slotIndex === undefined) return false;
                const usage = fieldUsageBySlot[slotIndex]?.[fieldName] || { count: 0, divisions: [], bunks: {} };
                if (usage.count >= limit) return false;
                if (usage.count > 0) {
                    if (!usage.divisions.includes(block.divName)) return false;
                    let existingActivity = null;
                    for (const bunkName in usage.bunks) { if (usage.bunks[bunkName]) { existingActivity = usage.bunks[bunkName]; break; } }
                    if (existingActivity && proposedActivity && existingActivity !== proposedActivity) return false;
                }
            }
        }
        return true;
    }

    function canLeagueGameFit(block, fieldName, fieldUsageBySlot, activityProperties) {
        if (!fieldName) return false;
        const props = activityProperties[fieldName];
        if (!props) return false;
        const limit = 1;
        if (props.preferences && props.preferences.enabled && props.preferences.exclusive && !props.preferences.list.includes(block.divName)) return false;
        if (props && Array.isArray(props.allowedDivisions) && props.allowedDivisions.length > 0 && !props.allowedDivisions.includes(block.divName)) return false;
        const limitRules = props.limitUsage;
        if (limitRules && limitRules.enabled) { if (!limitRules.divisions[block.divName]) return false; }
        const { blockStartMin, blockEndMin } = getBlockTimeRange(block);
        const rules = (props.timeRules || []).map(r => {
            if (typeof r.startMin === "number" && typeof r.endMin === "number") return r;
            return { ...r, startMin: parseTimeToMinutes(r.start), endMin: parseTimeToMinutes(r.end) };
        });
        if (rules.length > 0) {
            if (!props.available) return false;
            const hasAvailableRules = rules.some(r => r.type === 'Available');
            if (blockStartMin != null && blockEndMin != null) {
                if (hasAvailableRules) {
                    let insideAvailable = false;
                    for (const rule of rules) {
                        if (rule.type !== 'Available' || rule.startMin == null || rule.endMin == null) continue;
                        if (blockStartMin >= rule.startMin && blockEndMin <= rule.endMin) { insideAvailable = true; break; }
                    }
                    if (!insideAvailable) return false;
                }
                for (const rule of rules) {
                    if (rule.type !== 'Unavailable' || rule.startMin == null || rule.endMin == null) continue;
                    if (blockStartMin < rule.endMin && blockEndMin > rule.startMin) return false;
                }
            }
            for (const slotIndex of block.slots || []) {
                if (slotIndex === undefined) return false;
                const usage = fieldUsageBySlot[slotIndex]?.[fieldName] || { count: 0, divisions: [] };
                if (usage.count >= limit) return false;
                if (!isTimeAvailable(slotIndex, props)) return false;
            }
        } else {
            if (!props.available) return false;
            for (const slotIndex of block.slots || []) {
                if (slotIndex === undefined) return false;
                const usage = fieldUsageBySlot[slotIndex]?.[fieldName] || { count: 0, divisions: [] };
                if (usage.count >= limit) return false;
            }
        }
        return true;
    }

    function isPickValidForBlock(block, pick, activityProperties, fieldUsageBySlot) {
        if (!pick) return false;
        const fname = fieldLabel(pick.field);
        if (!fname) return true;
        if (!window.allSchedulableNames || !window.allSchedulableNames.includes(fname)) return true;
        return canBlockFit(block, fname, activityProperties, fieldUsageBySlot, pick._activity);
    }

    function fillBlock(block, pick, fieldUsageBySlot, yesterdayHistory, isLeagueFill = false) {
        const fieldName = fieldLabel(pick.field);
        const sport = pick.sport;
        (block.slots || []).forEach((slotIndex, idx) => {
            if (slotIndex === undefined || slotIndex >= (window.unifiedTimes || []).length) return;
            if (!window.scheduleAssignments[block.bunk]) return;
            if (!window.scheduleAssignments[block.bunk][slotIndex]) {
                window.scheduleAssignments[block.bunk][slotIndex] = {
                    field: fieldName,
                    sport: sport,
                    continuation: (idx > 0),
                    _fixed: !!pick._fixed,
                    _h2h: pick._h2h || false,
                    vs: pick.vs || null,
                    _activity: pick._activity || null,
                    _allMatchups: pick._allMatchups || null
                };
                if (!isLeagueFill && fieldName && window.allSchedulableNames.includes(fieldName)) {
                    fieldUsageBySlot[slotIndex] = fieldUsageBySlot[slotIndex] || {};
                    const usage = fieldUsageBySlot[slotIndex][fieldName] || { count: 0, divisions: [], bunks: {} };
                    usage.count++;
                    if (!usage.divisions.includes(block.divName)) usage.divisions.push(block.divName);
                    if (block.bunk && pick._activity) usage.bunks[block.bunk] = pick._activity;
                    fieldUsageBySlot[slotIndex][fieldName] = usage;
                }
            }
        });
    }

    function loadAndFilterData() {
        const globalSettings = window.loadGlobalSettings?.() || {};
        const app1Data = globalSettings.app1 || {};
        const masterFields = app1Data.fields || [];
        const masterDivisions = app1Data.divisions || {};
        const masterAvailableDivs = app1Data.availableDivisions || [];
        const masterSpecials = app1Data.specialActivities || [];
        const masterLeagues = globalSettings.leaguesByName || {};
        const masterSpecialtyLeagues = globalSettings.specialtyLeagues || {};
        const dailyData = window.loadCurrentDailyData?.() || {};
        const dailyFieldAvailability = dailyData.dailyFieldAvailability || {};
        const dailyOverrides = dailyData.overrides || {};
        const disabledLeagues = dailyOverrides.leagues || [];
        const disabledSpecialtyLeagues = dailyData.disabledSpecialtyLeagues || [];
        const dailyDisabledSportsByField = dailyData.dailyDisabledSportsByField || {};
        const disabledFields = dailyOverrides.disabledFields || [];
        const disabledSpecials = dailyOverrides.disabledSpecials || [];
        const rotationHistoryRaw = window.loadRotationHistory?.() || {};
        const rotationHistory = {
            bunks: rotationHistoryRaw.bunks || {},
            leagues: rotationHistoryRaw.leagues || {},
            leagueTeamSports: rotationHistoryRaw.leagueTeamSports || {},
            leagueTeamLastSport: rotationHistoryRaw.leagueTeamLastSport || {}
        };

        const historicalCounts = {};
        const specialActivityNames = [];

        try {
            const allDaily = window.loadAllDailyData?.() || {};
            const manualOffsets = globalSettings.manualUsageOffsets || {};
            
            Object.values(allDaily).forEach(day => {
                const sched = day.scheduleAssignments || {};
                Object.keys(sched).forEach(b => {
                    if (!historicalCounts[b]) historicalCounts[b] = {};
                    (sched[b] || []).forEach(e => {
                        if (e && e._activity && !e.continuation) {
                            historicalCounts[b][e._activity] = (historicalCounts[b][e._activity] || 0) + 1;
                        }
                    });
                });
            });
            
            Object.keys(manualOffsets).forEach(b => {
                if (!historicalCounts[b]) historicalCounts[b] = {};
                Object.keys(manualOffsets[b]).forEach(act => {
                    const offset = manualOffsets[b][act] || 0;
                    const current = historicalCounts[b][act] || 0;
                    historicalCounts[b][act] = Math.max(0, current + offset);
                });
            });
            
            masterSpecials.forEach(s => specialActivityNames.push(s.name));

        } catch (e) { console.error("Error calculating historical counts:", e); }

        const overrides = { bunks: dailyOverrides.bunks || [], leagues: disabledLeagues };
        const availableDivisions = masterAvailableDivs.filter(divName => !overrides.bunks.includes(divName));
        const divisions = {};
        for (const divName of availableDivisions) {
            if (!masterDivisions[divName]) continue;
            divisions[divName] = JSON.parse(JSON.stringify(masterDivisions[divName]));
            divisions[divName].bunks = (divisions[divName].bunks || []).filter(bunkName => !overrides.bunks.includes(bunkName));
        }

        function parseTimeRule(rule) {
            if (!rule || !rule.type) return null;
            if (typeof rule.startMin === "number" && typeof rule.endMin === "number") return { type: rule.type, startMin: rule.startMin, endMin: rule.endMin };
            const startMin = parseTimeToMinutes(rule.start);
            const endMin = parseTimeToMinutes(rule.end);
            if (startMin == null || endMin == null) return null;
            return { type: rule.type, startMin, endMin, start: rule.start, end: rule.end };
        }

        const activityProperties = {};
        const allMasterActivities = [
            ...masterFields.filter(f => !disabledFields.includes(f.name)),
            ...masterSpecials.filter(s => !disabledSpecials.includes(s.name))
        ];
        const availableActivityNames = [];
        
        allMasterActivities.forEach(f => {
            let finalRules;
            const dailyRules = dailyFieldAvailability[f.name];
            if (dailyRules && dailyRules.length > 0) finalRules = dailyRules.map(parseTimeRule).filter(Boolean);
            else finalRules = (f.timeRules || []).map(parseTimeRule).filter(Boolean);
            const isMasterAvailable = f.available !== false;
            const hasCustomDivList = Array.isArray(f.sharableWith?.divisions) && f.sharableWith.divisions.length > 0;
            activityProperties[f.name] = {
                available: isMasterAvailable,
                sharable: f.sharableWith?.type === 'all' || f.sharableWith?.type === 'custom',
                allowedDivisions: hasCustomDivList ? f.sharableWith.divisions.slice() : null,
                limitUsage: f.limitUsage || { enabled: false, divisions: {} },
                preferences: f.preferences || { enabled: false, exclusive: false, list: [] },
                timeRules: finalRules
            };
            if (isMasterAvailable) availableActivityNames.push(f.name);
        });

        window.allSchedulableNames = availableActivityNames;
        const availFields = masterFields.filter(f => availableActivityNames.includes(f.name));
        const availSpecials = masterSpecials.filter(s => availableActivityNames.includes(s.name));
        const fieldsBySport = {};
        availFields.forEach(f => {
            if (Array.isArray(f.activities)) {
                f.activities.forEach(sport => {
                    const isDisabledToday = dailyDisabledSportsByField[f.name]?.includes(sport);
                    if (!isDisabledToday) {
                        fieldsBySport[sport] = fieldsBySport[sport] || [];
                        fieldsBySport[sport].push(f.name);
                    }
                });
            }
        });

        const allActivities = [
            ...availFields
                .flatMap(f => (f.activities || [])
                    .map(act => ({ type: "field", field: f.name, sport: act })))
                .filter(a => !a.field || !a.sport || !dailyDisabledSportsByField[a.field]?.includes(a.sport)),
            ...availSpecials.map(sa => ({ type: "special", field: sa.name, sport: null }))
        ];
        const h2hActivities = allActivities.filter(a => a.type === "field" && a.sport);
        const yesterdayData = window.loadPreviousDailyData?.() || {};
        const yesterdayHistory = { schedule: yesterdayData.scheduleAssignments || {}, leagues: yesterdayData.leagueAssignments || {} };

        return {
            divisions,
            availableDivisions,
            activityProperties,
            allActivities,
            h2hActivities,
            fieldsBySport,
            masterLeagues,
            masterSpecialtyLeagues,
            yesterdayHistory,
            rotationHistory,
            disabledLeagues,
            disabledSpecialtyLeagues,
            historicalCounts,
            specialActivityNames
        };
    }

})();
