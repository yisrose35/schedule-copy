// ============================================================================
// total_solver_engine.js
// (Backtracking Constraint Solver + Dynamic League Engine)
// ----------------------------------------------------------------------------
// UPDATES:
// • FIXED: League Game NaN (proper round counter)
// • ADDED: Sport + Field shown for each matchup
// • ADDED: formatted + raw matchup arrays
// • PERFECT compatibility with your existing UI & fillBlock()
// ============================================================================

(function() {
'use strict';

const Solver = {};
const MAX_ITERATIONS = 5000;

// Runtime globals
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

    const todayAssign = window.scheduleAssignments[bunk] || {};
    const entries = Object.values(todayAssign);

    // No repeat
    let todayCount = 0;
    for (const e of entries) {
        const existing = e._activity || e.activity || e.field;
        if (isSameActivity(existing, act) && e.startMin !== block.startTime) {
            todayCount++;
        }
    }
    if (!pick._isLeague && todayCount >= 1) return 9999;

    // Max usage (specials)
    const rule = globalConfig.masterSpecials?.find(s => isSameActivity(s.name, act));
    if (rule && rule.maxUsage > 0) {
        const hist = globalConfig.historicalCounts?.[bunk]?.[act] || 0;
        if (hist + todayCount >= rule.maxUsage) return 9999;
    }

    // Adjacent block check
    for (const e of entries) {
        const prev = Math.abs(e.endMin - block.startTime) <= 15;
        const next = Math.abs(e.startMin - block.endTime) <= 15;
        const existing = e._activity || e.activity || e.field;
        if ((prev || next) && isSameActivity(existing, act)) {
            return 9999;
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

    return penalty;
}

// ============================================================================
// GENERATE DAILY MATCHUPS FOR ONE LEAGUE
// ============================================================================

Solver.generateDailyMatchups = function(league) {
    const teams = league.teams || [];
    if (teams.length < 2) return [];

    const state = window.leagueRoundState?.[league.name] || {
        matchupsPlayed: [],
        matchupSports: {}
    };

    const used = new Set(state.matchupsPlayed);
    const candidates = [];

    for (let i = 0; i < teams.length; i++) {
        for (let j = i + 1; j < teams.length; j++) {
            const key = [teams[i], teams[j]].sort().join("|");
            if (!used.has(key)) {
                candidates.push({ t1: teams[i], t2: teams[j], key });
            }
        }
    }

    // Reset if cycle completed
    if (candidates.length === 0 && teams.length > 1) {
        state.matchupsPlayed = [];
        window.leagueRoundState[league.name] = state;
        window.saveGlobalSettings?.("leagueRoundState", window.leagueRoundState);
        return Solver.generateDailyMatchups(league);
    }

    const todays = [];
    const playingNow = new Set();
    const shuffled = shuffleArray(candidates);

    for (const pair of shuffled) {
        if (playingNow.has(pair.t1) || playingNow.has(pair.t2)) continue;

        const history = state.matchupSports?.[pair.key] || [];
        const sports = league.sports || ["General Sport"];

        let sport = sports.find(s => !history.includes(s)) || sports[0];

        // Ensure a field exists
        const valid = allCandidateOptions.find(c => c.sport === sport);
        if (!valid) continue;

        todays.push({
            teamA: pair.t1,
            teamB: pair.t2,
            sport,
            pairKey: pair.key
        });

        playingNow.add(pair.t1);
        playingNow.add(pair.t2);
    }

    return todays;
};

// ============================================================================
// SOLVE LEAGUES FIRST
// ============================================================================

Solver.solveLeagueSchedule = function(leagueBlocks) {
    if (!leagueBlocks?.length) return [];

    const output = [];
    const bucket = {};

    // Group blocks by (division + time)
    for (const b of leagueBlocks) {
        const key = `${b.divName}_${b.startTime}`;
        if (!bucket[key]) bucket[key] = [];
        bucket[key].push(b);
    }

    for (const key in bucket) {
        const blocks = bucket[key];
        const rep = blocks[0];

        // FIND LEAGUE
        const league = globalConfig.masterLeagues
            ? Object.values(globalConfig.masterLeagues)
                .find(l => l.enabled && l.divisions?.includes(rep.divName))
            : null;

        if (!league) continue;

        // -------- Round Counter Fix --------
        if (!window.leagueRoundState) window.leagueRoundState = {};
        if (!window.leagueRoundState[league.name]) window.leagueRoundState[league.name] = {};

        const roundState = window.leagueRoundState[league.name];
        if (!roundState.currentRound) roundState.currentRound = 0;
        roundState.currentRound++;
        const gameLabel = `Game ${roundState.currentRound}`;
        // -----------------------------------

        // Generate matchups
        const matches = Solver.generateDailyMatchups(league);
        if (!matches.length) continue;

        // Determine primary sport
        const primarySport = matches[0]?.sport || "League";

        // Pick a field for this sport
        let selectedField = "Sports Field";
        const sportFields = allCandidateOptions.filter(c => c.sport === primarySport);

        for (const f of sportFields) {
            if (window.SchedulerCoreUtils.canBlockFit(
                rep,
                f.field,
                activityProperties,
                f.activityName
            )) {
                selectedField = f.field;
                break;
            }
        }

        // SAVE updated matchup state
        const state = window.leagueRoundState[league.name];
        for (const m of matches) {
            if (!state.matchupsPlayed) state.matchupsPlayed = [];
            if (!state.matchupSports) state.matchupSports = {};

            if (!state.matchupsPlayed.includes(m.pairKey))
                state.matchupsPlayed.push(m.pairKey);

            if (!state.matchupSports[m.pairKey])
                state.matchupSports[m.pairKey] = [];

            state.matchupSports[m.pairKey].push(m.sport);
        }

        // -------- Build formatted text for UI --------
        const formattedMatchups = matches.map(m =>
            `${m.teamA} vs ${m.teamB} — ${m.sport} @ ${selectedField}`
        );
        // ----------------------------------------------

        // Assign to each block (each division participating at this time)
        for (const b of blocks) {
            const pick = {
                field: selectedField,
                _activity: "League Game",
                sport: primarySport,
                _isLeague: true,

                _rawMatchups: matches,          // Raw objects
                _allMatchups: formattedMatchups, // UI strings
                _gameLabel: gameLabel
            };

            window.fillBlock(b, pick, globalConfig.yesterdayHistory, true, activityProperties);
            // ------------------------------------------------------------
// MAKE FIELD 100% EXCLUSIVE DURING THIS LEAGUE BLOCK
// ------------------------------------------------------------
window.fieldReservationLog = window.fieldReservationLog || {};
if (!window.fieldReservationLog[selectedField]) {
    window.fieldReservationLog[selectedField] = [];
}

window.fieldReservationLog[selectedField].push({
    bunk: "__LEAGUE_EXCLUSIVE__",   // special marker
    startMin: b.startTime,
    endMin: b.endTime,
    exclusive: true,
    reason: "League Unshareable Field"
});

            output.push({ block: b, solution: pick });
        }
    }

    window.saveGlobalSettings?.("leagueRoundState", window.leagueRoundState);
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
            if (cost < 9000) picks.push({ pick, cost });
        }
    }

    // Free block fallback
    picks.push({
        pick: { field: "Free", sport: null, _activity: "Free" },
        cost: 9000
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
// SEASON SCORECARD (LEGACY SAFE)
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
// MAIN SOLVER ENTRY
// ============================================================================

Solver.solveSchedule = function(allBlocks, config) {
    globalConfig = config;
    activityProperties = config.activityProperties || {};

    availableSports = config.allActivities
        .filter(a => a.type === "field" && a.sport)
        .map(a => a.field);

    availableSpecials = config.masterSpecials.map(s => s.name);

    // Build candidate list
    allCandidateOptions = [];
    config.allActivities?.forEach(a => {
        if (a.type === "field" && a.sport) {
            allCandidateOptions.push({
                field: a.field,
                sport: a.sport,
                activityName: a.sport,
                type: "sport"
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

// ============================================================================
// EXPORT
// ============================================================================
window.totalSolverEngine = Solver;

})();
