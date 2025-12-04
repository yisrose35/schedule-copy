// ============================================================================
// total_solver_engine.js
// (NEW CORE UTILITY: Backtracking Constraint Solver — Option 1)
//
// UPDATED: DYNAMIC LEAGUE GENERATOR & BUG FIXES
// - Fixed ReferenceError: availableSpecials is not defined
// - No pre-set schedule. Matchups are created daily based on availability.
// - Enforces Round Robin (A vs B only once per cycle).
// - Enforces Sport Rotation (A vs B never play same sport twice in a row).
// - Strict "One & Done" Variety Rules.
// ============================================================================

(function() {
'use strict';

const Solver = {};
const MAX_ITERATIONS = 5000;

// ============================================================================
// GLOBALS POPULATED AT RUNTIME
// ============================================================================
let globalConfig = null;
let activityProperties = {};
let currentScorecard = null;
let allCandidateOptions = []; 
let availableSports = [];
let availableSpecials = [];

// ============================================================================
// HELPERS
// ============================================================================

function isSameActivity(a, b) {
    return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

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

    const todayAssign = window.scheduleAssignments[bunk] || {};
    const entries = Object.values(todayAssign);
    
    // Repeats today
    let todayCount = 0;
    entries.forEach(e => {
        const exist = e._activity || e.activity || e.field;
        if (isSameActivity(exist, activityName) && e.startMin !== block.startTime) {
            todayCount++;
        }
    });

    // Strict No-Repeats Rule
    if (!pick._isLeague && todayCount >= 1) {
        return 9999;
    }

    // Max Special Usage
    const specialRule = globalConfig.masterSpecials?.find(s => isSameActivity(s.name, activityName));
    if (specialRule && specialRule.maxUsage > 0) {
        const histCount = globalConfig.historicalCounts?.[bunk]?.[activityName] || 0;
        if (histCount + todayCount >= specialRule.maxUsage) {
            return 9999;
        }
    }

    // Adjacency rule
    const isAdjacent = entries.some(e => {
        const touchesPrev = Math.abs(e.endMin - block.startTime) <= 15;
        const touchesNext = Math.abs(e.startMin - block.endTime) <= 15;
        const exist = e._activity || e.activity || e.field;
        return (touchesPrev || touchesNext) && isSameActivity(exist, activityName);
    });
    if (isAdjacent) return 9999;

    // Yesterday repeat
    const yesterdaySched = globalConfig.yesterdayHistory?.schedule?.[bunk] || {};
    const playedYesterday = Object.values(yesterdaySched).some(e => {
        const act = e._activity || e.activity;
        return isSameActivity(act, activityName);
    });
    if (playedYesterday) penalty += 300;

    // Preference scoring
    const props = activityProperties[pick.field]; 
    if (props?.preferences?.enabled) {
        const idx = (props.preferences.list || []).indexOf(block.divName);
        if (idx !== -1) {
            penalty -= (50 - (idx * 5)); 
        } else if (props.preferences.exclusive) {
            penalty += 2000;
        }
    }

    return penalty;
}

// ============================================================================
// DYNAMIC LEAGUE GENERATOR
// ============================================================================

Solver.generateDailyMatchups = function(league, availableFields) {
    const teams = league.teams || [];
    if (teams.length < 2) return [];

    const state = window.leagueRoundState?.[league.name] || { 
        matchupsPlayed: [],
        matchupSports: {}
    };

    const candidates = [];
    const playedSet = new Set(state.matchupsPlayed || []);

    for (let i = 0; i < teams.length; i++) {
        for (let j = i + 1; j < teams.length; j++) {
            const pairKey = [teams[i], teams[j]].sort().join("|");
            if (!playedSet.has(pairKey)) {
                candidates.push({ t1: teams[i], t2: teams[j], key: pairKey });
            }
        }
    }

    // Reset cycle if no matchups left
    if (candidates.length === 0 && teams.length > 1) {
        state.matchupsPlayed = [];
        window.leagueRoundState[league.name] = state;
        window.saveGlobalSettings?.('leagueRoundState', window.leagueRoundState);
        return Solver.generateDailyMatchups(league, availableFields);
    }

    const todays = [];
    const teamsToday = new Set();
    const shuffled = shuffleArray(candidates);

    for (const pair of shuffled) {
        if (teamsToday.has(pair.t1) || teamsToday.has(pair.t2)) continue;

        const history = state.matchupSports?.[pair.key] || [];
        const leagueSports = league.sports || ["General Sport"];

        let chosenSport = null;

        for (const s of leagueSports) {
            if (!history.includes(s)) {
                chosenSport = s;
                break;
            }
        }

        if (!chosenSport) {
            chosenSport = leagueSports[0];
        }

        const validField = allCandidateOptions.find(c => c.sport === chosenSport);
        if (validField) {
            todays.push({
                teamA: pair.t1,
                teamB: pair.t2,
                sport: chosenSport,
                pairKey: pair.key
            });

            teamsToday.add(pair.t1);
            teamsToday.add(pair.t2);
        }
    }

    return todays;
};

// ============================================================================
// LEAGUE SCHEDULING FACADE
// ============================================================================

Solver.solveLeagueSchedule = function(leagueBlocks) {
    if (!leagueBlocks || leagueBlocks.length === 0) return [];

    const output = [];
    const taskGroups = {};

    leagueBlocks.forEach(b => {
        const key = `${b.divName}_${b.startTime}`;
        if (!taskGroups[key]) taskGroups[key] = [];
        taskGroups[key].push(b);
    });

    for (const key in taskGroups) {
        const blocks = taskGroups[key];
        const rep = blocks[0];

        let league = null;
        if (globalConfig.masterLeagues) {
            league = Object.values(globalConfig.masterLeagues).find(l =>
                l.enabled && l.divisions && l.divisions.includes(rep.divName)
            );
        }
        if (!league) continue;

        const matches = Solver.generateDailyMatchups(league, allCandidateOptions);
        if (matches.length === 0) continue;

        const formatted = matches.map(m => `${m.teamA} vs ${m.teamB} (${m.sport})`);

        if (!window.leagueRoundState[league.name]) window.leagueRoundState[league.name] = {};
        const state = window.leagueRoundState[league.name];

        matches.forEach(m => {
            if (!state.matchupsPlayed) state.matchupsPlayed = [];
            if (!state.matchupSports) state.matchupSports = {};

            if (!state.matchupsPlayed.includes(m.pairKey)) {
                state.matchupsPlayed.push(m.pairKey);
            }
            if (!state.matchupSports[m.pairKey]) state.matchupSports[m.pairKey] = [];
            state.matchupSports[m.pairKey].push(m.sport);
        });

        const primarySport = matches[0]?.sport || "League";
        let selectedField = "Sports Field";

        const candidates = allCandidateOptions.filter(c => c.sport === primarySport);
        for (const c of candidates) {
            if (window.SchedulerCoreUtils.canBlockFit(rep, c.field, activityProperties, c.activityName)) {
                selectedField = c.field;
                break;
            }
        }

        const gameLabel = `Matchups`;

        for (const b of blocks) {
            const pick = {
                field: selectedField,
                _activity: "League Game",
                sport: primarySport,
                _isLeague: true,
                _allMatchups: formatted,
                _gameLabel: gameLabel
            };

            window.fillBlock(b, pick, globalConfig.yesterdayHistory, true, activityProperties);
            output.push({ block: b, solution: pick });
        }
    }

    window.saveGlobalSettings?.('leagueRoundState', window.leagueRoundState);
    return output;
};

// ============================================================================
// ACTIVITY SOLVER HELPERS
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
    let picks = [];
    const allActs = availableSpecials.concat(availableSports);

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
            if (cost < 9000) picks.push({ pick, cost });
        }
    }

    picks.push({
        pick: { field: "Free", sport: null, _activity: "Free" },
        cost: 9000
    });

    return shuffleArray(picks);
};

Solver.applyTentativePick = function(block, scoredPick) {
    const pick = scoredPick.pick;
    window.fillBlock(block, pick, globalConfig.yesterdayHistory, false, activityProperties);
    return { block, pick, startMin: block.startTime, bunk: block.bunk };
};

Solver.undoTentativePick = function(res) {
    const { bunk, startMin } = res;

    if (window.scheduleAssignments[bunk])
        delete window.scheduleAssignments[bunk][startMin];

    window.fieldReservationLog = window.fieldReservationLog || {};
    Object.keys(window.fieldReservationLog).forEach(field => {
        window.fieldReservationLog[field] = window.fieldReservationLog[field].filter(
            r => !(r.bunk === bunk && r.startMin === startMin)
        );
    });
};

// ============================================================================
// SCORECARD UPDATE (OPTION A — LEGACY COMPAT)
// ============================================================================

Solver.updateSeasonScorecard = function(assignments) {
    try {
        if (window.DataPersistence &&
            typeof window.DataPersistence.updateSeasonScorecard === "function") {
            window.DataPersistence.updateSeasonScorecard(assignments);
        }
    } catch (e) {
        console.warn("updateSeasonScorecard failed:", e);
    }
};

// ============================================================================
// MAIN SOLVER
// ============================================================================

Solver.solveSchedule = function(allBlocks, config) {
    globalConfig = config;
    activityProperties = config.activityProperties || {};

    availableSports = config.allActivities
        .filter(a => a.type === 'field' && a.sport)
        .map(a => a.field);

    availableSpecials = config.masterSpecials.map(s => s.name);

    // Candidate options
    allCandidateOptions = [];
    config.allActivities?.forEach(a => {
        if (a.type === 'field' && a.sport) {
            allCandidateOptions.push({
                field: a.field,
                sport: a.sport,
                activityName: a.sport,
                type: 'sport'
            });
        }
    });
    config.masterSpecials?.forEach(s => {
        allCandidateOptions.push({
            field: s.name,
            sport: null,
            activityName: s.name,
            type: 'special'
        });
    });

    currentScorecard = window.DataPersistence.loadSolverScorecard();

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
        const picks = Solver.getValidActivityPicks(block).sort((a, b) => a.cost - b.cost);
        const best = picks.slice(0, 5);

        for (const p of best) {
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

// ============================================================================
// EXPORT
// ============================================================================

window.totalSolverEngine = Solver;

})();
