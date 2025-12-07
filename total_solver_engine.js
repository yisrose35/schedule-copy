// ============================================================================
// total_solver_engine.js (GCM PATCHED VERSION)
// Backtracking Constraint Solver + League Engine
// ----------------------------------------------------------------------------
// FEATURES (Modern Architecture):
// ✓ League Exclusivity Lockout (absolute unshareable fields)
// ✓ Smart Neighbor Sharing & Distance Penalties
// ✓ No updateSeasonScorecard() required (history handled in fillBlock)
// ✓ League-first solving (Guaranteed priority)
// ✓ Mixed Sports Support (Matchups within a round can vary)
// ✓ Complete compatibility with Smart Tiles & Minute Timeline
// ✓ Clean modern design: no legacy scoring, no legacy history writes
// ✓ FIXED: Field Collision Check in League Matchups
// ✓ FIXED: Timeout Safety (Returns partial schedule instead of blank)
// ============================================================================

(function () {
    'use strict';

    const Solver = {};
    const MAX_MATCHUP_ITERATIONS = 2000;

    // Runtime globals
    let globalConfig = null;
    let activityProperties = {};
    let allCandidateOptions = [];
    let fieldAvailabilityCache = {};

    // ============================================================================
    // HELPERS
    // ============================================================================

    function isSameActivity(a, b) {
        return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
    }

    function shuffleArray(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }

    // Extract bunk number ("Bunk 7" → 7)
    function getBunkNumber(name) {
        const m = String(name).match(/(\d+)/);
        return m ? parseInt(m[1], 10) : null;
    }

    // ============================================================================
    // PENALTY ENGINE (MODERN)
    // ============================================================================

    function calculatePenaltyCost(block, pick) {
        let penalty = 0;
        const bunk = block.bunk;
        const act = pick._activity;

        // ---------------------------------------------------------
        // 1. EXCLUSIVE LOCKOUT CHECK
        // ---------------------------------------------------------
        const fieldLog = window.fieldReservationLog?.[pick.field] || [];
        let currentOccupancy = 0;
        let closestNeighborDistance = Infinity;

        const myNum = getBunkNumber(bunk);

        for (const r of fieldLog) {
            const overlap =
                r.startMin < block.endTime &&
                r.endMin > block.startTime;

            if (!overlap) continue;

            // Exclusive = absolute reject
            if (r.exclusive === true) {
                return 99999;
            }

            currentOccupancy++;

            const theirNum = getBunkNumber(r.bunk);
            if (myNum !== null && theirNum !== null) {
                const dist = Math.abs(myNum - theirNum);
                if (dist < closestNeighborDistance) {
                    closestNeighborDistance = dist;
                }
            }
        }

        // ---------------------------------------------------------
        // 2. NO DOUBLE ACTIVITY IN SAME DAY (unless league)
        // ---------------------------------------------------------
        const today = window.scheduleAssignments[bunk] || {};
        let todayCount = 0;

        for (const e of Object.values(today)) {
            const existing = e._activity || e.activity || e.field;
            if (isSameActivity(existing, act) && e.startMin !== block.startTime) {
                todayCount++;
            }
        }

        if (!pick._isLeague && todayCount >= 1) {
            penalty += 15000;
        }

        // ---------------------------------------------------------
        // 3. SPECIAL MAX USAGE (per bunk)
        // ---------------------------------------------------------
        const specialRule = globalConfig.masterSpecials?.find(s => isSameActivity(s.name, act));
        if (specialRule && specialRule.maxUsage > 0) {
            const hist = globalConfig.historicalCounts?.[bunk]?.[act] || 0;
            if (hist + todayCount >= specialRule.maxUsage) {
                penalty += 20000;
            }
        }

        // ---------------------------------------------------------
        // 4. ADJACENT-BLOCK PENALTY (same activity next to itself)
        // ---------------------------------------------------------
        for (const e of Object.values(today)) {
            const adjacent =
                Math.abs(e.endMin - block.startTime) <= 15 ||
                Math.abs(e.startMin - block.endTime) <= 15;

            if (adjacent) {
                const existing = e._activity || e.activity || e.field;
                if (isSameActivity(existing, act)) {
                    penalty += 15000;
                }
            }
        }

        // ---------------------------------------------------------
        // 5. YESTERDAY REPEAT PENALTY (Anti-Streak)
        // ---------------------------------------------------------
        const yHist = globalConfig.yesterdayHistory?.schedule?.[bunk] || {};
        const playedYesterday = Object.values(yHist).some(e =>
            isSameActivity(e._activity || e.activity, act)
        );

        if (playedYesterday) penalty += 300;

        // ---------------------------------------------------------
        // 6. FIELD PREFERENCES (if configured)
        // ---------------------------------------------------------
        const props = activityProperties[pick.field];
        if (props?.preferences?.enabled) {
            const idx = (props.preferences.list || []).indexOf(block.divName);
            if (idx !== -1) {
                penalty -= (50 - idx * 5);
            } else if (props.preferences.exclusive) {
                penalty += 2000;
            }
        }

        // ---------------------------------------------------------
        // 7. SMART SHARING LOGIC (Dispersal Fix)
        // ---------------------------------------------------------
        if (currentOccupancy === 0) { // EXCLUSIVE USE (Primary Goal)
            penalty -= 10000;

        } else if (currentOccupancy === 1) { // SHARING WITH ONE OTHER BUNK
            let shareCost = 15000; // Base penalty

            if (closestNeighborDistance === 1) {
                shareCost = 500; // Low cost for neighbor
            } else if (closestNeighborDistance > 1 && closestNeighborDistance <= 5) {
                shareCost = 5000; // Medium cost for nearby
            }
            penalty += shareCost;

        } else if (currentOccupancy >= 2) { // Already two or more
            penalty += 20000;
        }

        return penalty;
    }

    // ============================================================================
    // LEAGUE HELPERS
    // ============================================================================

    function getMatchupHistory(teamA, teamB, leagueName) {
        const hist = globalConfig.rotationHistory?.leagues || {};
        const key = [teamA, teamB].sort().join("|");
        const leagueKey = `${leagueName}|${key}`;
        const played = hist[leagueKey] || [];

        const sportCounts = {};
        for (const g of played) {
            sportCounts[g.sport] = (sportCounts[g.sport] || 0) + 1;
        }

        return {
            playCount: played.length,
            sportCounts
        };
    }

    function buildFieldConstraintCache(block, leagueSports) {
        const cache = {};

        for (const sport of leagueSports) {
            cache[sport] = [];

            const potentials = allCandidateOptions
                .filter(c => c.type === "sport" && isSameActivity(c.sport, sport));

            for (const cand of potentials) {
                const fits = window.SchedulerCoreUtils.canBlockFit(
                    block,
                    cand.field,
                    activityProperties,
                    cand.activityName
                );
                if (fits) cache[sport].push(cand.field);
            }
        }

        return cache;
    }

    // ============================================================================
    // MATCHUP GENERATOR (Non-greedy)
    // ============================================================================

    function findOptimalSchedule(cands, current) {
        if (cands.length === 0) return current;
        if (current.length * 2 === globalConfig._totalLeagueTeams) return current;

        let best = null;
        let maxMatches = current.length;
        let iterations = 0;

        cands.sort((a, b) => {
            if (a.playCount !== b.playCount) return a.playCount - b.playCount;
            if (a._sportConstraintCount !== b._sportConstraintCount)
                return a._sportConstraintCount - b._sportConstraintCount;
            return Math.random() - 0.5;
        });

        const backtrack = (idx, cur) => {
            iterations++;
            if (iterations > MAX_MATCHUP_ITERATIONS) return;
            if (cur.length * 2 === globalConfig._totalLeagueTeams) {
                if (cur.length > maxMatches) {
                    maxMatches = cur.length;
                    best = cur;
                }
                return;
            }
            if (idx === cands.length) {
                if (cur.length > maxMatches) {
                    maxMatches = cur.length;
                    best = cur;
                }
                return;
            }

            const cand = cands[idx];
            const available =
                !cur.some(m =>
                    m.t1 === cand.t1 || m.t1 === cand.t2 ||
                    m.t2 === cand.t1 || m.t2 === cand.t2 ||
                    m.field === cand.field
                );

            if (available) backtrack(idx + 1, [...cur, cand]);
            backtrack(idx + 1, cur);
        };

        backtrack(0, []);
        return best || [];
    }

    // ============================================================================
    // LEAGUE FIRST SOLVING
    // ============================================================================

    Solver.generateDailyMatchups = function (league, repBlock) {
        const teams = league.teams || [];
        if (teams.length < 2) return [];

        const allPairs = [];
        let minPlay = Infinity;

        // Build matchup history
        for (let i = 0; i < teams.length; i++) {
            for (let j = i + 1; j < teams.length; j++) {
                const hist = getMatchupHistory(teams[i], teams[j], league.name);
                allPairs.push({
                    t1: teams[i],
                    t2: teams[j],
                    playCount: hist.playCount,
                    sportCounts: hist.sportCounts
                });
                minPlay = Math.min(minPlay, hist.playCount);
            }
        }

        globalConfig._totalLeagueTeams = teams.length;

        let candidates = allPairs.filter(p => p.playCount === minPlay);
        const leagueSports = league.sports || ["General Sport"];

        fieldAvailabilityCache = buildFieldConstraintCache(repBlock, leagueSports);

        const viable = [];

        // MIXED SPORTS LOGIC
        for (const p of candidates) {
            let minSC = Infinity;
            for (const sport of leagueSports) {
                const c = p.sportCounts[sport] || 0;
                minSC = Math.min(minSC, c);
            }

            let equalBest = leagueSports.filter(s => (p.sportCounts[s] || 0) === minSC);
            const validSports = equalBest.filter(s => fieldAvailabilityCache[s] && fieldAvailabilityCache[s].length > 0);

            if (validSports.length === 0) continue;

            shuffleArray(validSports);
            let optionsAdded = 0;

            for (const sport of validSports) {
                const fields = fieldAvailabilityCache[sport];
                shuffleArray(fields);

                for (const f of fields) {
                    viable.push({
                        t1: p.t1,
                        t2: p.t2,
                        playCount: p.playCount,
                        sport: sport,
                        field: f,
                        _sportConstraintCount: fields.length,
                        key: [p.t1, p.t2].sort().join("|")
                    });
                    optionsAdded++;
                    if (optionsAdded >= 3) break;
                }
                if (optionsAdded >= 3) break;
            }
        }

        shuffleArray(viable);
        return findOptimalSchedule(viable, []);
    };

    Solver.solveLeagueSchedule = function (leagueBlocks) {
        if (!leagueBlocks?.length) return [];

        const output = [];
        const bucket = {};

        for (const b of leagueBlocks) {
            const key = `${b.divName}_${b.startTime}`;
            if (!bucket[key]) bucket[key] = [];
            bucket[key].push(b);
        }

        const fieldsUsed = new Set();

        for (const key in bucket) {
            const blocks = bucket[key];
            const rep = blocks[0];

            const league = globalConfig.masterLeagues
                ? Object.values(globalConfig.masterLeagues)
                .find(l => l.enabled && l.divisions?.includes(rep.divName))
                : null;

            if (!league) continue;

            const matches = Solver.generateDailyMatchups(league, rep);
            if (!matches.length) continue;

            const available = matches.filter(m => !fieldsUsed.has(m.field));
            if (!available.length) continue;

            const tier = available[0].playCount;
            const gameLabel = `Round ${tier + 1}`;

            const formatted = available.map(m =>
                `${m.t1} vs ${m.t2} — ${m.sport} @ ${m.field}`
            );

            for (const b of blocks) {
                const pick = {
                    field: available[0].field,
                    sport: available[0].sport,
                    _activity: "League Game",
                    _isLeague: true,
                    _rawMatchups: available,
                    _allMatchups: formatted,
                    _gameLabel: gameLabel
                };

                window.fillBlock(b, pick, globalConfig.yesterdayHistory, true, activityProperties);

                const state = window.leagueRoundState[league.name] || {};
                state.currentRound = tier + 1;

                for (const m of available) {
                    const key = m.key;
                    if (!state.matchupsPlayed) state.matchupsPlayed = [];
                    if (!state.matchupSports) state.matchupSports = {};

                    if (!state.matchupsPlayed.includes(key)) state.matchupsPlayed.push(key);
                    if (!state.matchupSports[key]) state.matchupSports[key] = [];
                    state.matchupSports[key].push(m.sport);

                    fieldsUsed.add(m.field);

                    window.fieldReservationLog = window.fieldReservationLog || {};
                    if (!window.fieldReservationLog[m.field]) window.fieldReservationLog[m.field] = [];
                    window.fieldReservationLog[m.field].push({
                        bunk: `__LEAGUE_EXCLUSIVE__${b.divName}`,
                        divName: b.divName,
                        startMin: b.startTime,
                        endMin: b.endTime,
                        exclusive: true,
                        reason: "League Unshareable Field"
                    });
                }

                window.leagueRoundState[league.name] = state;
                window.saveGlobalSettings?.("leagueRoundState", window.leagueRoundState);

                output.push({ block: b, solution: pick });
            }
        }

        return output;
    };
// ... existing code ...
    config.masterSpecials?.forEach(s => {
        allCandidateOptions.push({ field: s.name, sport: null, activityName: s.name, type: "special" });
    });

    // === INSERT DEBUG LOG HERE ===
    console.log("DEBUG: All Candidate Options:", allCandidateOptions);
    // =============================

    if (!window.leagueRoundState) window.leagueRoundState = {};
    // ...
    // ============================================================================
    // ACTIVITY (NON-LEAGUE) SOLVER
    // ============================================================================

    Solver.sortBlocksByDifficulty = function (blocks, config) {
        const meta = config.bunkMetaData || {};

        return blocks.sort((a, b) => {
            // LEAGUE PRIORITY: Always sort leagues to the top
            if (a._isLeague && !b._isLeague) return -1;
            if (!a._isLeague && b._isLeague) return 1;

            const sa = meta[a.bunk]?.size || 0;
            const sb = meta[b.bunk]?.size || 0;

            if (sa !== sb) return sb - sa;

            return Math.random() - 0.5;
        });
    };

    Solver.getValidActivityPicks = function (block) {
        const picks = [];

        // 1. Try real activities
        for (const cand of allCandidateOptions) {
            const fits = window.SchedulerCoreUtils.canBlockFit(
                block,
                cand.field,
                activityProperties,
                cand.activityName
            );

            if (fits) {
                const pick = {
                    field: cand.field,
                    sport: cand.sport,
                    _activity: cand.activityName
                };
                const cost = calculatePenaltyCost(block, pick);

                // STRICTER FILTER: Don't even attempt impossible/exclusive slots
                // Normal cutoff is high, but we strictly reject "Exclusive" (99999)
                if (cost < 90000) {
                    picks.push({ pick, cost });
                }
            }
        }

        // 2. ALWAYS add "Free" as a fallback (guarantees the branch never dies)
        picks.push({
            pick: { field: "Free", sport: null, _activity: "Free" },
            cost: 50000
        });

        // 3. Shuffle to mix up equal-cost options
        return shuffleArray(picks);
    };

    Solver.applyTentativePick = function (block, scored) {
        const pick = scored.pick;
        window.fillBlock(block, pick, globalConfig.yesterdayHistory, false, activityProperties);

        return {
            block,
            pick,
            bunk: block.bunk,
            startMin: block.startTime
        };
    };

    Solver.undoTentativePick = function (res) {
        const { bunk, startMin } = res;

        if (window.scheduleAssignments[bunk]) {
            delete window.scheduleAssignments[bunk][startMin];
        }

        // Remove reservation entries
        window.fieldReservationLog = window.fieldReservationLog || {};
        for (const f in window.fieldReservationLog) {
            window.fieldReservationLog[f] =
                window.fieldReservationLog[f].filter(r =>
                    !(r.bunk === bunk && r.startMin === startMin)
                );
        }
    };

    // ============================================================================
    // MAIN SOLVER ENTRY (PATCHED)
    // ============================================================================

    Solver.solveSchedule = function (allBlocks, config) {
        globalConfig = config;
        activityProperties = config.activityProperties || {};

        // Reset Counters
        let iterations = 0;
        const SAFETY_LIMIT = 100000; // Increased from 5000

        // Build options
        allCandidateOptions = [];
        config.masterFields?.forEach(f => {
            (f.activities || []).forEach(sport => {
                allCandidateOptions.push({ field: f.name, sport, activityName: sport, type: "sport" });
            });
        });

        config.masterSpecials?.forEach(s => {
            allCandidateOptions.push({ field: s.name, sport: null, activityName: s.name, type: "special" });
        });

        if (!window.leagueRoundState) window.leagueRoundState = {};
        if (!globalConfig.rotationHistory) globalConfig.rotationHistory = {};
        if (!globalConfig.rotationHistory.leagues) globalConfig.rotationHistory.leagues = {};

        const sorted = Solver.sortBlocksByDifficulty(allBlocks, config);

        // Explicit Separation
        const leagueBlocks = sorted.filter(b => b._isLeague);
        const activityBlocks = sorted.filter(b => !b._isLeague);

        // 1. SOLVE LEAGUES FIRST (Guarantees priority)
        const solvedLeague = Solver.solveLeagueSchedule(leagueBlocks);

        // 2. BACKTRACK SOLVER (With Timeout Protection)
        let bestSchedule = [...solvedLeague];
        let maxDepthReached = 0;

        function backtrack(idx, acc) {
            iterations++;

            // Track progress to save "best effort"
            if (idx > maxDepthReached) {
                maxDepthReached = idx;
                bestSchedule = [...acc];
            }

            // TERMINATION: Success
            if (idx === activityBlocks.length) {
                return acc;
            }

            // TERMINATION: Timeout - RETURN NULL (trigger fallback)
            if (iterations > SAFETY_LIMIT) {
                console.warn(`Total Solver: Iteration limit ${SAFETY_LIMIT} hit.`);
                return null;
            }

            const block = activityBlocks[idx];

            const picks = Solver.getValidActivityPicks(block)
                .sort((a, b) => a.cost - b.cost)
                .slice(0, 8); // Look at top 8 candidates

            for (const p of picks) {
                const res = Solver.applyTentativePick(block, p);

                const out = backtrack(idx + 1, [...acc, { block, solution: p.pick }]);
                if (out) return out;

                Solver.undoTentativePick(res);
            }

            return null;
        }

        const final = backtrack(0, solvedLeague);

        // 3. FINALIZATION LOGIC
        if (final) {
            return final.map(a => ({
                bunk: a.block.bunk,
                divName: a.block.divName,
                startTime: a.block.startTime,
                endTime: a.block.endTime,
                solution: a.solution
            }));
        } else {
            console.warn("Total Solver: Optimal solution not found. Filling gaps with Free.");
            
            // Reconstruct best partial solution
            const solvedBlocksSet = new Set(bestSchedule.map(s => s.block));
            const missingBlocks = activityBlocks.filter(b => !solvedBlocksSet.has(b));

            const fallback = [
                ...bestSchedule,
                ...missingBlocks.map(b => ({
                    block: b,
                    solution: { field: "Free", sport: null, _activity: "Free (Timeout)" }
                }))
            ];

            return fallback.map(a => ({
                bunk: a.block.bunk,
                divName: a.block.divName,
                startTime: a.block.startTime,
                endTime: a.block.endTime,
                solution: a.solution
            }));
        }
    };

    window.totalSolverEngine = Solver;

})();
