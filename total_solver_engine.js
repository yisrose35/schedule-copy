// ============================================================================
// total_solver_engine.js
// (NEW CORE UTILITY: Backtracking Constraint Solver — Option 1)
//
// IMPORTANT:
// - League activity uses the *field name* as activityName (Option 1).
// - fillBlock() handles actual reservation; solver only chooses fields.
// - Fully compatible with scheduler_core_utils.js (Division Firewall Version)
// ============================================================================

(function() {
'use strict';

const Solver = {};
const MAX_ITERATIONS = 5000;

// -- Globals populated at runtime
let globalConfig = null;
let activityProperties = {};
let currentScorecard = null;
let availableSports = [];
let availableSpecials = [];
let leagueData = {};

// ============================================================================
// HELPERS
// ============================================================================

function isLeagueActivity(pick) {
    return pick && pick._isLeague;
}

function calculatePenaltyCost(block, pick) {
    let penalty = 0;
    const bunk = block.bunk;
    const activityName = pick._activity;

    // ------------- Penalty: Duplicate Today (50) --------------
    const todayAssign = window.scheduleAssignments[bunk] || {};
    const isDupToday = Object.values(todayAssign)
        .some(e => e._activity === activityName && e.startTime !== block.startTime);
    if (isDupToday) penalty += 50;

    // ------------- League duplicate has extra hit --------------
    if (pick._isLeague && isDupToday) penalty += 100;

    // ------------- Season-long fairness penalty --------------
    const fair = currentScorecard.teamFairness[bunk] || {};
    const cum = fair.totalPenalties || 0;
    penalty += Math.floor(cum / 10);

    // ------------- Preferences bonus/penalty --------------
    const props = activityProperties[activityName];
    if (props?.preferences?.enabled) {
        const idx = (props.preferences.list || []).indexOf(block.divName);
        if (idx !== -1) {
            // Preferred: negative = bonus
            penalty -= (10 - idx);
        } else if (props.preferences.exclusive) {
            // Should not assign
            penalty += 1000;
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
        return sb - sa;
    });
};

Solver.getValidActivityPicks = function(block) {
    const picks = [];
    const allActs = availableSpecials.concat(availableSports);

    for (const act of allActs) {
        const fits = window.SchedulerCoreUtils.canBlockFit(
            block,
            act,
            activityProperties,
            act
        );
        if (fits) {
            const pick = {
                field: act,
                sport: null,
                _activity: act
            };
            const cost = calculatePenaltyCost(block, pick);
            picks.push({ pick, cost });
        }
    }

    picks.push({
        pick: { field: "Free", sport: null, _activity: "Free" },
        cost: 9999
    });

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

        if (cost > 0 && cost < 9999) {
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

    availableSports = config.allActivities
        .filter(a => a.type === "field" && a.sport)
        .map(a => a.field);

    availableSpecials = config.masterSpecials.map(s => s.name);

    currentScorecard = window.DataPersistence.loadSolverScorecard();

    const sorted = Solver.sortBlocksByDifficulty(allBlocks, config);
    const leagueBlocks = sorted.filter(b => b._isLeague);
    const activityBlocks = sorted.filter(b => !b._isLeague);

    // Step A: Solve leagues
    const solvedLeague = Solver.solveLeagueSchedule(leagueBlocks);

    // Step B: Backtracking for general activities
    let solvedActivity = [];
    let iterations = 0;

    function backtrack(idx, acc) {
        iterations++;
        if (iterations > MAX_ITERATIONS) return acc;
        if (idx === activityBlocks.length) return acc;

        const block = activityBlocks[idx];
        const picks = Solver.getValidActivityPicks(block)
            .sort((a, b) => a.cost - b.cost);

        for (const p of picks) {
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

    console.error("Total Solver: failed to fully solve — returning empty array.");
    return [];
};

window.totalSolverEngine = Solver;

})();
