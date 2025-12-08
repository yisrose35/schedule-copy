// ============================================================================
// total_solver_engine.js (ORIGINAL / REVERTED)
// Backtracking Constraint Solver + League Engine
// ----------------------------------------------------------------------------
// Reverted to original state:
// - FORCE_FIT_MODE = true (Permissive)
// - Original argument passing (No explicit usage map)
// ============================================================================

(function () {
    'use strict';

    const Solver = {};
    const MAX_MATCHUP_ITERATIONS = 2000;
    
    // !!! GCM CONFIGURATION !!!
    const FORCE_FIT_MODE = true; 

    // Runtime globals
    let globalConfig = null;
    let activityProperties = {};
    let allCandidateOptions = [];
    let fieldAvailabilityCache = {};
    let hasLoggedConstraintIssue = false;

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

    function getBunkNumber(name) {
        const m = String(name).match(/(\d+)/);
        return m ? parseInt(m[1], 10) : null;
    }

    // ============================================================================
    // PENALTY ENGINE
    // ============================================================================

    function calculatePenaltyCost(block, pick) {
        let penalty = 0;
        const bunk = block.bunk;
        const act = pick._activity;

        // 1. EXCLUSIVE LOCKOUT CHECK
        const fieldLog = window.fieldReservationLog?.[pick.field] || [];
        let currentOccupancy = 0;
        const myNum = getBunkNumber(bunk);

        for (const r of fieldLog) {
            const overlap = r.startMin < block.endTime && r.endMin > block.startTime;
            if (!overlap) continue;
            if (r.exclusive === true) return 99999; 
            currentOccupancy++;
        }

        // 2. NO DOUBLE ACTIVITY
        const today = window.scheduleAssignments[bunk] || {};
        let todayCount = 0;
        for (const e of Object.values(today)) {
            const existing = e._activity || e.activity || e.field;
            if (isSameActivity(existing, act) && e.startMin !== block.startTime) {
                todayCount++;
            }
        }
        if (!pick._isLeague && todayCount >= 1) penalty += 15000;

        // 3. SPECIAL MAX USAGE
        const specialRule = globalConfig.masterSpecials?.find(s => isSameActivity(s.name, act));
        if (specialRule && specialRule.maxUsage > 0) {
            const hist = globalConfig.historicalCounts?.[bunk]?.[act] || 0;
            if (hist + todayCount >= specialRule.maxUsage) penalty += 20000;
        }

        // 4. FIELD PREFERENCES
        const props = activityProperties[pick.field];
        if (props?.preferences?.enabled) {
            const idx = (props.preferences.list || []).indexOf(block.divName);
            if (idx !== -1) {
                penalty -= (50 - idx * 5); 
            } else if (props.preferences.exclusive) {
                return 99999; 
            } else {
                penalty += 2000; 
            }
        }

        // 5. SHARING LOGIC
        if (currentOccupancy === 0) { 
            penalty -= 10000;
        } else if (currentOccupancy >= 1) { 
            penalty += 15000;
        }

        return penalty;
    }

    // ============================================================================
    // LEAGUE ENGINE
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
        return { playCount: played.length, sportCounts };
    }

    function buildFieldConstraintCache(block, leagueSports) {
        const cache = {};
        for (const sport of leagueSports) {
            cache[sport] = [];
            const potentials = allCandidateOptions.filter(c => c.type === "sport" && isSameActivity(c.sport, sport));
            for (const cand of potentials) {
                // Reverted to original arguments
                const fits = window.SchedulerCoreUtils.canBlockFit(block, cand.field, activityProperties, cand.activityName);
                if (fits || FORCE_FIT_MODE) cache[sport].push(cand.field);
            }
        }
        return cache;
    }

    function findOptimalSchedule(cands, current) {
        if (cands.length === 0) return current;
        if (current.length * 2 === globalConfig._totalLeagueTeams) return current;

        let best = null;
        let maxMatches = current.length;
        let iterations = 0;

        cands.sort((a, b) => {
            if (a.playCount !== b.playCount) return a.playCount - b.playCount;
            return Math.random() - 0.5;
        });

        const backtrack = (idx, cur) => {
            iterations++;
            if (iterations > MAX_MATCHUP_ITERATIONS) return;
            if (cur.length * 2 === globalConfig._totalLeagueTeams) {
                if (cur.length > maxMatches) { maxMatches = cur.length; best = cur; }
                return;
            }
            if (idx === cands.length) {
                if (cur.length > maxMatches) { maxMatches = cur.length; best = cur; }
                return;
            }

            const cand = cands[idx];
            const available = !cur.some(m =>
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

    Solver.generateDailyMatchups = function (league, repBlock) {
        const teams = league.teams || [];
        if (teams.length < 2) return [];

        const allPairs = [];
        let minPlay = Infinity;

        for (let i = 0; i < teams.length; i++) {
            for (let j = i + 1; j < teams.length; j++) {
                const hist = getMatchupHistory(teams[i], teams[j], league.name);
                allPairs.push({
                    t1: teams[i], t2: teams[j],
                    playCount: hist.playCount, sportCounts: hist.sportCounts
                });
                minPlay = Math.min(minPlay, hist.playCount);
            }
        }

        globalConfig._totalLeagueTeams = teams.length;
        let candidates = allPairs.filter(p => p.playCount === minPlay);
        const leagueSports = league.sports || ["General Sport"];
        fieldAvailabilityCache = buildFieldConstraintCache(repBlock, leagueSports);

        const viable = [];
        for (const p of candidates) {
            let minSC = Infinity;
            for (const sport of leagueSports) {
                const c = p.sportCounts[sport] || 0;
                minSC = Math.min(minSC, c);
            }
            const validSports = leagueSports.filter(s => (p.sportCounts[s] || 0) === minSC && fieldAvailabilityCache[s] && fieldAvailabilityCache[s].length > 0);
            
            shuffleArray(validSports);
            for (const sport of validSports) {
                const fields = fieldAvailabilityCache[sport];
                shuffleArray(fields);
                for (const f of fields) {
                    viable.push({
                        t1: p.t1, t2: p.t2, playCount: p.playCount, sport: sport, field: f
                    });
                    if (viable.length > 50) break;
                }
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

        for (const key in bucket) {
            const blocks = bucket[key];
            const rep = blocks[0];
            const league = globalConfig.masterLeagues
                ? Object.values(globalConfig.masterLeagues).find(l => l.enabled && l.divisions?.includes(rep.divName))
                : null;

            if (!league) continue;

            const matches = Solver.generateDailyMatchups(league, rep);
            if (!matches.length) continue;

            const tier = matches[0].playCount;
            const gameLabel = `Round ${tier + 1}`;
            
            for (const b of blocks) {
                const myMatch = matches.find(m => m.t1 === b.bunk || m.t2 === b.bunk);
                if (!myMatch) continue;

                const opponent = (myMatch.t1 === b.bunk) ? myMatch.t2 : myMatch.t1;
                const pick = {
                    field: myMatch.field,
                    sport: myMatch.sport,
                    _activity: `vs ${opponent} (${myMatch.sport})`,
                    _isLeague: true,
                    _gameLabel: gameLabel
                };

                window.fillBlock(b, pick, globalConfig.yesterdayHistory, true, activityProperties);
                output.push({ block: b, solution: pick });
            }
        }
        return output;
    };

    // ============================================================================
    // MAIN SOLVER
    // ============================================================================

    Solver.sortBlocksByDifficulty = function (blocks, config) {
        const meta = config.bunkMetaData || {};
        return blocks.sort((a, b) => {
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
        for (const cand of allCandidateOptions) {
            // Reverted to original arguments
            const fits = window.SchedulerCoreUtils.canBlockFit(block, cand.field, activityProperties, cand.activityName);
            
            // Log rejection diagnostic
            if (!fits && !hasLoggedConstraintIssue && !cand.field.includes("Gym")) {
                console.warn(`[GCM DIAGNOSTIC] Rejected ${cand.field} for ${block.bunk}.`);
                hasLoggedConstraintIssue = true;
            }

            if (fits || FORCE_FIT_MODE) {
                const pick = { field: cand.field, sport: cand.sport, _activity: cand.activityName };
                const cost = calculatePenaltyCost(block, pick);
                if (cost < 90000) picks.push({ pick, cost });
            }
        }
        picks.push({ pick: { field: "Free", sport: null, _activity: "Free" }, cost: 50000 });
        return shuffleArray(picks);
    };

    Solver.applyTentativePick = function (block, scored) {
        const pick = scored.pick;
        window.fillBlock(block, pick, globalConfig.yesterdayHistory, false, activityProperties);
        return { block, pick, bunk: block.bunk, startMin: block.startTime };
    };

    Solver.undoTentativePick = function (res) {
        const { bunk, startMin } = res;
        if (window.scheduleAssignments[bunk]) delete window.scheduleAssignments[bunk][startMin];
    };

    Solver.solveSchedule = function (allBlocks, config) {
        globalConfig = config;
        activityProperties = config.activityProperties || {};
        hasLoggedConstraintIssue = false; 

        let iterations = 0;
        const SAFETY_LIMIT = 100000;

        allCandidateOptions = [];
        config.masterFields?.forEach(f => {
            (f.activities || []).forEach(sport => allCandidateOptions.push({ field: f.name, sport, activityName: sport, type: "sport" }));
        });
        config.masterSpecials?.forEach(s => {
            allCandidateOptions.push({ field: s.name, sport: null, activityName: s.name, type: "special" });
        });

        if (!window.leagueRoundState) window.leagueRoundState = {};
        if (!globalConfig.rotationHistory) globalConfig.rotationHistory = {};
        if (!globalConfig.rotationHistory.leagues) globalConfig.rotationHistory.leagues = {};

        const sorted = Solver.sortBlocksByDifficulty(allBlocks, config);
        const leagueBlocks = sorted.filter(b => b._isLeague);
        const activityBlocks = sorted.filter(b => !b._isLeague);

        const solvedLeague = Solver.solveLeagueSchedule(leagueBlocks);

        let bestSchedule = [...solvedLeague];
        let maxDepthReached = 0;

        function backtrack(idx, acc) {
            iterations++;
            if (idx > maxDepthReached) { maxDepthReached = idx; bestSchedule = [...acc]; }
            if (idx === activityBlocks.length) return acc;
            if (iterations > SAFETY_LIMIT) { console.warn(`Total Solver: Iteration limit ${SAFETY_LIMIT} hit.`); return null; }

            const block = activityBlocks[idx];
            const picks = Solver.getValidActivityPicks(block).sort((a, b) => a.cost - b.cost).slice(0, 8);

            for (const p of picks) {
                const res = Solver.applyTentativePick(block, p);
                const out = backtrack(idx + 1, [...acc, { block, solution: p.pick }]);
                if (out) return out;
                Solver.undoTentativePick(res);
            }
            return null;
        }

        const final = backtrack(0, solvedLeague);

        if (final) {
            return final.map(a => ({ bunk: a.block.bunk, divName: a.block.divName, startTime: a.block.startTime, endTime: a.block.endTime, solution: a.solution }));
        } else {
            console.warn("Total Solver: Optimal solution not found. Filling gaps with Free.");
            const solvedBlocksSet = new Set(bestSchedule.map(s => s.block));
            const missingBlocks = activityBlocks.filter(b => !solvedBlocksSet.has(b));
            const fallback = [
                ...bestSchedule,
                ...missingBlocks.map(b => ({ block: b, solution: { field: "Free", sport: null, _activity: "Free (Timeout)" } }))
            ];
            return fallback.map(a => ({ bunk: a.block.bunk, divName: a.block.divName, startTime: a.block.startTime, endTime: a.block.endTime, solution: a.solution }));
        }
    };

    window.totalSolverEngine = Solver;

})();
