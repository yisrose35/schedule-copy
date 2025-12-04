// ============================================================================
// total_solver_engine.js
// (NEW CORE UTILITY: Backtracking Constraint Solver — Option 1)
//
// UPDATED: STRICT "ONE & DONE" VARIETY
// - Hard Cap: Disqualifies an activity immediately if it's already been played today.
// - Logic separates Field vs Activity (allows same field if different sport).
// - Random shuffle added to break "Hockey Arena" dominance.
// ============================================================================

(function() {
'use strict';

const Solver = {};
const MAX_ITERATIONS = 5000;

// -- Globals populated at runtime
let globalConfig = null;
let activityProperties = {};
let currentScorecard = null;
let allCandidateOptions = []; // Now stores objects: { field, sport, activityName, type }

// ============================================================================
// HELPERS
// ============================================================================

function isLeagueActivity(pick) {
    return pick && pick._isLeague;
}

// Fisher-Yates Shuffle to randomize picks
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

function calculatePenaltyCost(block, pick) {
    let penalty = 0;
    const bunk = block.bunk;
    const activityName = pick._activity;

    // 1. GET CURRENT STATE
    const todayAssign = window.scheduleAssignments[bunk] || {};
    const entries = Object.values(todayAssign);
    
    // Count how many times this activity is already scheduled TODAY
    let todayCount = 0;
    entries.forEach(e => {
        // Count exact matches (Same Activity Name), excluding current slot
        if (e._activity === activityName && e.startMin !== block.startTime) {
            todayCount++;
        }
    });

    // 2. STRICT "NO REPEATS" RULE
    // If not a league, you CANNOT do the same activity twice.
    // This forces the solver to find anything else.
    if (!pick._isLeague && todayCount >= 1) {
        return 9999; // DISQUALIFIED
    }

    // 3. CHECK MAX USAGE (Specific Special Limits)
    const specialRule = globalConfig.masterSpecials?.find(s => s.name === activityName);
    if (specialRule && specialRule.maxUsage > 0) {
        const histCount = globalConfig.historicalCounts?.[bunk]?.[activityName] || 0;
        if (histCount + todayCount >= specialRule.maxUsage) {
            return 9999; // DISQUALIFIED
        }
    }

    // 4. 360° ADJACENCY CHECK (Prevents Back-to-Back)
    // Looks for any entry ending near my start OR starting near my end
    const isAdjacent = entries.some(e => {
        const touchesPrev = Math.abs(e.endMin - block.startTime) <= 15;
        const touchesNext = Math.abs(e.startMin - block.endTime) <= 15;
        return (touchesPrev || touchesNext) && e._activity === activityName;
    });

    if (isAdjacent) {
        return 9999; // DISQUALIFIED (Redundant if limit is 1, but safe)
    }

    // 5. YESTERDAY REPEAT (ROTATION)
    const yesterdaySched = globalConfig.yesterdayHistory?.schedule?.[bunk] || {};
    const playedYesterday = Object.values(yesterdaySched).some(e => e._activity === activityName);
    if (playedYesterday) {
        penalty += 300; // Strong preference for new things
    }

    // 6. SEASON FAIRNESS
    const fair = currentScorecard.teamFairness[bunk] || {};
    const cum = fair.totalPenalties || 0;
    penalty += Math.floor(cum / 10);

    // 7. PREFERENCES
    // Uses the Field Name for preference lookup
    const props = activityProperties[pick.field]; 
    if (props?.preferences?.enabled) {
        const idx = (props.preferences.list || []).indexOf(block.divName);
        if (idx !== -1) {
            penalty -= (50 - (idx * 5)); // Bonus for preferred fields
        } else if (props.preferences.exclusive) {
            penalty += 2000; // Exclusive violation
        }
    }

    return penalty;
}

// ============================================================================
// LEAGUE MATCHUP GENERATION  (Round Robin)
// ============================================================================

function generateRoundRobin(teamList) {
    if (!teamList || teamList.length < 2) return [];

    const teams = [...teamList];
    let hasBye = false;

    if (teams.length % 2 !== 0) {
        teams.push("BYE");
        hasBye = true;
    }

    const schedule = [];
    const numRounds = teams.length - 1;

    const fixed = teams[0];
    const rotating = teams.slice(1);

    for (let r = 0; r < numRounds; r++) {
        const round = [];
        round.push([fixed, rotating[0]]);
        for (let i = 1; i < teams.length / 2; i++) {
            const t1 = rotating[i];
            const t2 = rotating[rotating.length - i];
            round.push([t1, t2]);
        }
        schedule.push(round);
        rotating.unshift(rotating.pop());
    }

    if (!hasBye) {
        return schedule.map(round =>
            round.filter(m => m[0] !== "BYE" && m[1] !== "BYE")
        );
    }
    return schedule;
}

Solver.getSpecificRoundMatchups = function(teams, roundIndex) {
    if (!teams || teams.length < 2) return [];
    const full = generateRoundRobin(teams);
    if (!full.length) return [];
    const idx = (roundIndex - 1) % full.length;
    return full[idx] || [];
};

Solver.solveLeagueMatchups = function(leagueName, teams, nextRound) {
    return Solver.getSpecificRoundMatchups(teams, nextRound);
};

// ============================================================================
// FAÇADE — Solve leagues FIRST
// ============================================================================

Solver.solveLeagueSchedule = function(leagueBlocks) {
    if (!leagueBlocks || leagueBlocks.length === 0) return [];

    const output = [];

    for (const b of leagueBlocks) {
        const matches = Solver.solveLeagueMatchups(
            b.leagueName,
            b.leagueTeams,
            b.nextRound
        );
        if (matches.length === 0) continue;

        const matchups = matches.map(m => ({ teamA: m[0], teamB: m[1] }));

        b._allMatchups = matchups;

        for (const match of matchups) {
            const fieldName = b.fieldName;
            const commonStart = b.startTime;
            const commonEnd = b.endTime;

            // --- A-block (teamA)
            const blockA = {
                bunk: match.teamA,
                divName: b.divName,
                startTime: commonStart,
                endTime: commonEnd
            };
            const pickA = {
                field: fieldName,
                _activity: fieldName,
                sport: b.sport,
                _isLeague: true,
                _allMatchups: b._allMatchups
            };
            window.fillBlock(blockA, pickA, globalConfig.yesterdayHistory, true, activityProperties);

            output.push({ block: blockA, solution: pickA });

            // --- B-block (teamB)
            const blockB = {
                bunk: match.teamB,
                divName: b.divName,
                startTime: commonStart,
                endTime: commonEnd
            };
            const pickB = {
                field: fieldName,
                _activity: fieldName,
                sport: b.sport,
                _isLeague: true,
                _allMatchups: b._allMatchups
            };
            window.fillBlock(blockB, pickB, globalConfig.yesterdayHistory, true, activityProperties);

            output.push({ block: blockB, solution: pickB });
        }
    }

    return output;
};

// ============================================================================
// GENERAL ACTIVITY BACKTRACKING SOLVER
// ============================================================================

Solver.sortBlocksByDifficulty = function(blocks, config) {
    const bunkMeta = config.bunkMetaData || {};

    return blocks.sort((a, b) => {
        if (a._isLeague && !b._isLeague) return -1;
        if (!a._isLeague && b._isLeague) return 1;
        
        const sa = bunkMeta[a.bunk]?.size || 0;
        const sb = bunkMeta[b.bunk]?.size || 0;
        // Add random shuffle for identical sizes to prevent "Pattern Lock"
        if (sa !== sb) return sb - sa;
        return Math.random() - 0.5; 
    });
};

Solver.getValidActivityPicks = function(block) {
    let picks = [];
    
    // Iterate over the PRE-CALCULATED candidates (Sports + Specials)
    // This list includes distinct {field, sport} combinations.
    for (const cand of allCandidateOptions) {
        
        // 1. Physical Fit Check (Time, Field Availability, Division Firewall)
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
            
            // 2. Logical Validity Check (Repeats, Limits, History)
            const cost = calculatePenaltyCost(block, pick);
            
            // Only add if not disqualified (9999 cost)
            if (cost < 9000) {
                picks.push({ pick, cost });
            }
        }
    }

    // Always allow "Free" as a fallback
    picks.push({
        pick: { field: "Free", sport: null, _activity: "Free" },
        cost: 9000
    });

    // Randomize candidates with same cost
    picks = shuffleArray(picks);

    return picks;
};

Solver.applyTentativePick = function(block, scoredPick) {
    const pick = scoredPick.pick;

    window.fillBlock(block, pick, globalConfig.yesterdayHistory, false, activityProperties);

    return {
        block,
        pick,
        startMin: block.startTime,
        bunk: block.bunk
    };
};

Solver.undoTentativePick = function(res) {
    const { startMin, bunk } = res;

    if (window.scheduleAssignments[bunk]) {
        delete window.scheduleAssignments[bunk][startMin];
    }

    window.fieldReservationLog = window.fieldReservationLog || {};
    Object.keys(window.fieldReservationLog).forEach(field => {
        window.fieldReservationLog[field] =
            window.fieldReservationLog[field].filter(
                r => !(r.bunk === bunk && r.startMin === startMin)
            );
    });
};

Solver.updateSeasonScorecard = function(assignments) {
    const sc = currentScorecard;

    for (const item of assignments) {
        const bunk = item.block.bunk;
        const cost = calculatePenaltyCost(item.block, item.solution);

        if (cost > 0 && cost < 9000) {
            if (!sc.teamFairness[bunk]) {
                sc.teamFairness[bunk] = { totalPenalties: 0 };
            }
            sc.teamFairness[bunk].totalPenalties += cost;
            sc.teamFairness[bunk].lastPenalty =
                new Date().toISOString().split("T")[0];
        }
    }

    window.DataPersistence.saveSolverScorecard(sc);
};

// ============================================================================
// MAIN ENTRY
// ============================================================================

Solver.solveSchedule = function(allBlocks, config) {
    globalConfig = config;
    activityProperties = config.activityProperties || {};

    // --- PREPARE CANDIDATES (Unique Field/Sport Combos) ---
    // This allows "Hockey" and "Handball" on the same "Hockey Arena"
    // to be treated as different activities.
    
    allCandidateOptions = [];

    // 1. SPORTS (Field + Sport combo)
    if (config.allActivities) {
        config.allActivities.forEach(a => {
            if (a.type === 'field' && a.sport) {
                allCandidateOptions.push({
                    field: a.field,
                    sport: a.sport,
                    activityName: a.sport, // Use SPORT name for uniqueness
                    type: 'sport'
                });
            }
        });
    }

    // 2. SPECIALS (Field/Name is activity)
    if (config.masterSpecials) {
        config.masterSpecials.forEach(s => {
            allCandidateOptions.push({
                field: s.name,
                sport: null,
                activityName: s.name,
                type: 'special'
            });
        });
    }

    currentScorecard = window.DataPersistence.loadSolverScorecard();

    const sorted = Solver.sortBlocksByDifficulty(allBlocks, config);
    const leagueBlocks = sorted.filter(b => b._isLeague);
    const activityBlocks = sorted.filter(b => !b._isLeague);

    // Step A: Solve leagues
    const solvedLeague = Solver.solveLeagueSchedule(leagueBlocks);

    // Step B: Backtracking for general activities
    let iterations = 0;

    function backtrack(idx, acc) {
        iterations++;
        // Limit depth
        if (iterations > MAX_ITERATIONS) return acc; 
        if (idx === activityBlocks.length) return acc;

        const block = activityBlocks[idx];
        
        // Get valid picks (SHUFFLED then SORTED by cost)
        const picks = Solver.getValidActivityPicks(block)
            .sort((a, b) => a.cost - b.cost);

        // Try the best 5 picks
        const bestPicks = picks.slice(0, 5);

        for (const p of bestPicks) {
            const res = Solver.applyTentativePick(block, p);
            
            const out = backtrack(idx + 1, [...acc, { block, solution: p.pick }]);
            if (out) return out;
            
            Solver.undoTentativePick(res);
        }

        return null; 
    }

    const finalAssignments = backtrack(0, solvedLeague);

    if (finalAssignments) {
        Solver.updateSeasonScorecard(finalAssignments);
        return finalAssignments.map(a => ({
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
