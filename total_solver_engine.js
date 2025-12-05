// ============================================================================
// total_solver_engine.js
// (Backtracking Constraint Solver + Dynamic League Engine)
// ----------------------------------------------------------------------------
// UPDATED: LEAGUE EXCLUSIVITY LOCKOUT
// 1. League games now place an "exclusive: true" reservation on their field.
// 2. calculatePenaltyCost checks this flag immediately.
// 3. If a field is "exclusive", it is REJECTED (Cost 99,999) regardless of sharing rules.
// ============================================================================

(function() {
'use strict';

const Solver = {};
const MAX_ITERATIONS = 5000;
const MAX_MATCHUP_ITERATIONS = 500;

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

function calculatePenaltyCost(block, pick) {
    let penalty = 0;
    const bunk = block.bunk;
    const act = pick._activity;

    // ---------------------------------------------------------
    // 1. CRITICAL: CHECK FOR EXCLUSIVE LOCKS (League Games)
    // ---------------------------------------------------------
    const fieldLog = window.fieldReservationLog?.[pick.field] || [];
    let currentOccupancy = 0;
    let closestNeighborDistance = Infinity;

    // Helper to extract number from "Bunk 10" -> 10
    const getBunkNumber = (bName) => {
        const m = String(bName).match(/(\d+)/);
        return m ? parseInt(m[1], 10) : null;
    };
    const myNum = getBunkNumber(bunk);
    
    for (const r of fieldLog) {
        // Check for time overlap
        if (r.startMin < block.endTime && r.endMin > block.startTime) {
            
            // --- THE FIX: If ANY overlap is marked exclusive, reject immediately ---
            if (r.exclusive) {
                return 99999; // Absolute blockage (higher than any valid cost)
            }

            currentOccupancy++;
            
            // Check neighbor distance
            const theirNum = getBunkNumber(r.bunk);
            if (myNum !== null && theirNum !== null) {
                const dist = Math.abs(myNum - theirNum);
                if (dist < closestNeighborDistance) {
                    closestNeighborDistance = dist;
                }
            }
        }
    }

    // ---------------------------------------------------------
    // 2. REPEAT PENALTIES (Fairness)
    // ---------------------------------------------------------
    const todayAssign = window.scheduleAssignments[bunk] || {};
    const entries = Object.values(todayAssign);

    // No repeat of same activity today
    let todayCount = 0;
    for (const e of entries) {
        const existing = e._activity || e.activity || e.field;
        if (isSameActivity(existing, act) && e.startMin !== block.startTime) {
            todayCount++;
        }
    }
    if (!pick._isLeague && todayCount >= 1) penalty += 15000; 

    // Max usage (specials)
    const rule = globalConfig.masterSpecials?.find(s => isSameActivity(s.name, act));
    if (rule && rule.maxUsage > 0) {
        const hist = globalConfig.historicalCounts?.[bunk]?.[act] || 0;
        if (hist + todayCount >= rule.maxUsage) penalty += 20000;
    }

    // Adjacent block check
    for (const e of entries) {
        const prev = Math.abs(e.endMin - block.startTime) <= 15;
        const next = Math.abs(e.startMin - block.endTime) <= 15;
        const existing = e._activity || e.activity || e.field;
        if ((prev || next) && isSameActivity(existing, act)) {
            penalty += 15000;
        }
    }

    // Yesterday repeat penalty
    const yest = globalConfig.yesterdayHistory?.schedule?.[bunk] || {};
    const playedYesterday = Object.values(yest).some(e => {
        const ya = e._activity || e.activity;
        return isSameActivity(ya, act);
    });
    if (playedYesterday) penalty += 300;

    // Preferences
    const props = activityProperties[pick.field];
    if (props?.preferences?.enabled) {
        const idx = (props.preferences.list || []).indexOf(block.divName);
        if (idx !== -1) penalty -= (50 - idx * 5);
        else if (props.preferences.exclusive) penalty += 2000;
    }

    // ---------------------------------------------------------
    // 3. SMART NEIGHBOR SHARING LOGIC (If not excluded)
    // ---------------------------------------------------------
    // TIERED COST SYSTEM:
    // 0 Occupants (Exclusive) -> Cost +0
    // 1 Occupant  (Sharing)   -> Variable Cost based on Neighbor Distance
    
    if (currentOccupancy === 1) {
        let shareCost = 5000; // Base "Stranger" Penalty
        
        // Apply Massive Bonus for Neighbors
        if (closestNeighborDistance === 1) {
            shareCost = 500; // Excellent! (1 & 2)
        } else if (closestNeighborDistance === 2) {
            shareCost = 2500; // Acceptable (1 & 3)
        }
        // Distance > 2 remains 5000 (1 & 4)

        penalty += shareCost; 

    } else if (currentOccupancy >= 2) {
        penalty += 10000; // Crowding Penalty
        if (closestNeighborDistance === 1) penalty -= 2000;
    }

    return penalty;
}

// ============================================================================
// LEAGUE LOGIC HELPERS
// ============================================================================

function getMatchupHistory(teamA, teamB, leagueName) {
    const history = globalConfig.rotationHistory?.leagues || {}; 
    const key = [teamA, teamB].sort().join("|");
    const leagueKey = `${leagueName}|${key}`;
    const playedGames = history[leagueKey] || [];
    const playCount = playedGames.length;
    
    const sportCounts = {};
    for (const game of playedGames) {
        sportCounts[game.sport] = (sportCounts[game.sport] || 0) + 1;
    }

    return { playCount, sportCounts };
}

function buildFieldConstraintCache(block, leagueSports) {
    const cache = {};
    for (const sport of leagueSports) {
        cache[sport] = [];
        const potentialFields = allCandidateOptions
            .filter(c => isSameActivity(c.sport, sport) && c.type === 'sport');

        for (const cand of potentialFields) {
            if (window.SchedulerCoreUtils.canBlockFit(
                block,
                cand.field,
                activityProperties,
                cand.activityName
            )) {
                cache[sport].push(cand.field);
            }
        }
    }
    return cache;
}

// ============================================================================
// NON-GREEDY MATCHUP SEARCH
// ============================================================================

function findOptimalSchedule(remainingCandidates, currentSchedule) {
    if (remainingCandidates.length === 0) return currentSchedule;
    if (currentSchedule.length * 2 === globalConfig._totalLeagueTeams) return currentSchedule;

    let bestResult = null;
    let maxMatchups = currentSchedule.length;
    let iterations = 0;

    remainingCandidates.sort((a, b) => {
        if (a.playCount !== b.playCount) return a.playCount - b.playCount; 
        if (a._sportConstraintCount !== b._sportConstraintCount) return a._sportConstraintCount - b._sportConstraintCount;
        return 0.5 - Math.random();
    });

    const backtrackingSearch = (index, currentMatches) => {
        iterations++;
        if (iterations > MAX_MATCHUP_ITERATIONS) return;

        if (currentMatches.length * 2 === globalConfig._totalLeagueTeams) {
            if (currentMatches.length > maxMatchups) {
                maxMatchups = currentMatches.length;
                bestResult = currentMatches;
            }
            return; 
        }

        if (index === remainingCandidates.length) {
            if (currentMatches.length > maxMatchups) {
                maxMatchups = currentMatches.length;
                bestResult = currentMatches;
            }
            return;
        }

        const candidate = remainingCandidates[index];
        const isTeamAvailable = !currentMatches.some(m => m.teamA === candidate.t1 || m.teamB === candidate.t1 ||
                                                           m.teamA === candidate.t2 || m.teamB === candidate.t2);

        if (isTeamAvailable) {
            const nextMatches = [...currentMatches, candidate];
            backtrackingSearch(index + 1, nextMatches);
        }

        backtrackingSearch(index + 1, currentMatches);
    };

    backtrackingSearch(0, []);
    return bestResult || [];
}

Solver.generateDailyMatchups = function(league, repBlock) {
    const teams = league.teams || [];
    if (teams.length < 2) return [];

    const allPairs = [];
    let minPlayCount = Infinity;

    for (let i = 0; i < teams.length; i++) {
        for (let j = i + 1; j < teams.length; j++) {
            const history = getMatchupHistory(teams[i], teams[j], league.name);
            allPairs.push({
                t1: teams[i],
                t2: teams[j],
                playCount: history.playCount,
                sportCounts: history.sportCounts
            });
            minPlayCount = Math.min(minPlayCount, history.playCount);
        }
    }
    
    globalConfig._totalLeagueTeams = teams.length;
    let candidates = allPairs.filter(p => p.playCount === minPlayCount);
    if (candidates.length === 0) return []; 
    
    const availableSports = league.sports || ["General Sport"];
    fieldAvailabilityCache = buildFieldConstraintCache(repBlock, availableSports);

    const viableCandidates = [];

    for (const pair of candidates) {
        let sportPicks = [];
        let minSportCount = Infinity;

        for (const sport of availableSports) {
            const sportCount = pair.sportCounts[sport] || 0;
            minSportCount = Math.min(minSportCount, sportCount);
        }

        for (const sport of availableSports) {
            if ((pair.sportCounts[sport] || 0) === minSportCount) {
                sportPicks.push(sport);
            }
        }
        
        let viableSportPicks = sportPicks.filter(sport => fieldAvailabilityCache[sport]?.length > 0);

        if (viableSportPicks.length === 0) continue;

        let bestSport = viableSportPicks[0];
        if (viableSportPicks.length > 1) {
            for (const sport of viableSportPicks) {
                const constraintCount = fieldAvailabilityCache[sport].length; 
                if (constraintCount < fieldAvailabilityCache[bestSport].length) { 
                     bestSport = sport;
                }
            }
        }
        
        const selectedField = shuffleArray(fieldAvailabilityCache[bestSport])[0]; 

        viableCandidates.push({
            t1: pair.t1,
            t2: pair.t2,
            playCount: pair.playCount,
            sport: bestSport,
            field: selectedField,
            _sportConstraintCount: fieldAvailabilityCache[bestSport].length,
            key: [pair.t1, pair.t2].sort().join("|")
        });
    }

    return findOptimalSchedule(viableCandidates, []);
};


// ============================================================================
// SOLVE LEAGUES FIRST
// ============================================================================

Solver.solveLeagueSchedule = function(leagueBlocks) {
    if (!leagueBlocks?.length) return [];

    const output = [];
    const bucket = {};

    for (const b of leagueBlocks) {
        const key = `${b.divName}_${b.startTime}`;
        if (!bucket[key]) bucket[key] = [];
        bucket[key].push(b);
    }
    
    const fieldsUsedByLeague = new Set(); 

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
        
        const availableMatches = matches.filter(m => !fieldsUsedByLeague.has(m.field));
        
        if (!availableMatches.length) continue;

        const tier = availableMatches[0].playCount;
        const gameLabel = `Round ${tier + 1}`;
        
        const formattedMatchups = availableMatches.map(m =>
            `${m.t1} vs ${m.t2} — ${m.sport} @ ${m.field}`
        );

        for (const b of blocks) {
            const pick = {
                field: availableMatches[0].field,
                _activity: "League Game",
                sport: availableMatches[0].sport,
                _isLeague: true,
                _rawMatchups: availableMatches,
                _allMatchups: formattedMatchups,
                _gameLabel: gameLabel
            };

            window.fillBlock(b, pick, globalConfig.yesterdayHistory, true, activityProperties);
            
            const state = window.leagueRoundState[league.name] || {};
            state.currentRound = tier + 1; 
            
            for (const m of availableMatches) {
                const pairKey = m.key;
                if (!state.matchupsPlayed) state.matchupsPlayed = [];
                if (!state.matchupSports) state.matchupSports = {};

                if (!state.matchupsPlayed.includes(pairKey))
                    state.matchupsPlayed.push(pairKey);

                if (!state.matchupSports[pairKey])
                    state.matchupSports[pairKey] = [];

                state.matchupSports[pairKey].push(m.sport);
                
                fieldsUsedByLeague.add(m.field); 
                
                // --- CRITICAL: MARK FIELD AS EXCLUSIVE ---
                window.fieldReservationLog = window.fieldReservationLog || {};
                if (!window.fieldReservationLog[m.field]) {
                    window.fieldReservationLog[m.field] = [];
                }
                window.fieldReservationLog[m.field].push({
                    bunk: `__LEAGUE_EXCLUSIVE__${b.divName}`,
                    divName: b.divName,
                    startMin: b.startTime,
                    endMin: b.endTime,
                    exclusive: true, // <--- This flag triggers the reject
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

// ============================================================================
// NON-LEAGUE ACTIVITY SOLVER
// ============================================================================

Solver.sortBlocksByDifficulty = function(blocks, config) {
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

Solver.getValidActivityPicks = function(block) {
    const picks = [];

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
            // 99000 allows for high costs (sharing) but REJECTS exclusive (99999)
            if (cost < 99000) picks.push({ pick, cost });
        }
    }

    // Free block fallback - NUCLEAR OPTION
    picks.push({
        pick: { field: "Free", sport: null, _activity: "Free" },
        cost: 50000 // High cost, but lower than Exclusive Conflict
    });

    return shuffleArray(picks);
};

Solver.applyTentativePick = function(block, scored) {
    const pick = scored.pick;
    window.fillBlock(block, pick, globalConfig.yesterdayHistory, false, activityProperties);
    return {
        block,
        pick,
        bunk: block.bunk,
        startMin: block.startTime
    };
};

Solver.undoTentativePick = function(res) {
    const { bunk, startMin } = res;

    if (window.scheduleAssignments[bunk])
        delete window.scheduleAssignments[bunk][startMin];

    window.fieldReservationLog = window.fieldReservationLog || {};
    for (const f in window.fieldReservationLog) {
        window.fieldReservationLog[f] =
            window.fieldReservationLog[f].filter(r =>
                !(r.bunk === bunk && r.startMin === startMin)
            );
    }
};

// ============================================================================
// MAIN SOLVER ENTRY
// ============================================================================

Solver.solveSchedule = function(allBlocks, config) {
    globalConfig = config;
    activityProperties = config.activityProperties || {};

    allCandidateOptions = [];
    config.masterFields?.forEach(f => {
        if (f.activities) {
            f.activities.forEach(sport => {
                allCandidateOptions.push({
                    field: f.name,
                    sport: sport,
                    activityName: sport,
                    type: "sport"
                });
            });
        }
    });
    config.masterSpecials?.forEach(s => {
        allCandidateOptions.push({
            field: s.name,
            sport: null,
            activityName: s.name,
            type: "special"
        });
    });

    if (!window.leagueRoundState) window.leagueRoundState = {};
    if (!globalConfig.rotationHistory) globalConfig.rotationHistory = {};
    if (!globalConfig.rotationHistory.leagues) globalConfig.rotationHistory.leagues = {};

    const sorted = Solver.sortBlocksByDifficulty(allBlocks, config);
    const leagueBlocks = sorted.filter(b => b._isLeague);
    const activityBlocks = sorted.filter(b => !b._isLeague);

    const solvedLeague = Solver.solveLeagueSchedule(leagueBlocks);

    let iterations = 0;

    function backtrack(idx, acc) {
        iterations++;
        if (iterations > MAX_ITERATIONS) return acc;
        if (idx === activityBlocks.length) return acc;

        const block = activityBlocks[idx];

        const picks = Solver.getValidActivityPicks(block)
            .sort((a, b) => a.cost - b.cost)
            .slice(0, 5);

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
        Solver.updateSeasonScorecard(final);
        return final.map(a => ({
            bunk: a.block.bunk,
            divName: a.block.divName,
            startTime: a.block.startTime,
            endTime: a.block.endTime,
            solution: a.solution
        }));
    }

    console.error("Total Solver: failed to fully solve.");
    return [];
};

window.totalSolverEngine = Solver;

})();
