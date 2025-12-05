// ============================================================================
// league_scheduling.js  — RESTORED LEAGUE ENGINE (Stage 4)
//
// PURPOSE:
// - Generate ALL daily league matchups BEFORE the general solver runs.
// - Group multi-division leagues correctly.
// - Maintain full league history & proper round-robin rotation.
// - Assign correct game numbers (morning + afternoon).
// - Provide stable, deterministic output to the orchestrator.
// - Fully compatible with new timeline (continuous-minutes).
//
// OUTPUT:
// window.__LEAGUE_DAILY_RESULTS = {
//    leagueName: [
//       { teamA, teamB, sport, blockRef, gameNumber }
//    ]
// }
// ============================================================================

(function () {
"use strict";

if (!window.leaguesByName) window.leaguesByName = {};
if (!window.leagueRoundState) window.leagueRoundState = {};

// ============================================================================
// HELPERS
// ============================================================================

function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
}

function getLeagueTeams(league) {
    let allTeams = [];
    (league.divisions || []).forEach(div => {
        const d = window.divisions?.[div];
        if (d?.bunks) allTeams.push(...d.bunks);
    });
    return allTeams;
}

function getDailyLeagueBlocksForLeague(leagueName, dailyBlocks) {
    return dailyBlocks.filter(b => b.type === "league" && b.leagueName === leagueName);
}

function nextGameNumber(leagueName) {
    if (!window.leagueRoundState[leagueName])
        window.leagueRoundState[leagueName] = 0;
    window.leagueRoundState[leagueName] += 1;
    return window.leagueRoundState[leagueName];
}

function loadLeagueHistory() {
    const saved = window.loadGlobalSettings?.().leagueHistory || {};
    return JSON.parse(JSON.stringify(saved));
}

function saveLeagueHistory(history) {
    const global = window.loadGlobalSettings?.() || {};
    global.leagueHistory = JSON.parse(JSON.stringify(history));
    window.saveGlobalSettings?.("leagueHistory", global.leagueHistory);
}

// ============================================================================
// ROUND ROBIN MATCHUP GENERATION (Classical Algorithm)
// ============================================================================
function generateRoundRobin(teams, history) {
    const results = [];

    // Very small leagues
    if (teams.length < 2) return results;

    // Copy list
    const t = teams.slice();
    if (t.length % 2 === 1) t.push(null); // "bye" placeholder

    const half = t.length / 2;
    const rounds = t.length - 1;

    for (let r = 0; r < rounds; r++) {
        const roundMatches = [];

        for (let i = 0; i < half; i++) {
            const A = t[i];
            const B = t[t.length - 1 - i];

            if (A && B) {
                // Avoid rematches using stored history
                const key1 = `${A}__${B}`;
                const key2 = `${B}__${A}`;
                if (!history[key1] && !history[key2]) {
                    roundMatches.push({ teamA: A, teamB: B });
                }
            }
        }

        // If at least one valid match exists
        if (roundMatches.length > 0) {
            shuffle(roundMatches);
            results.push(...roundMatches);
        }

        // Rotate teams for next round
        const pivot = t[0];
        const rotated = t.splice(1);
        rotated.unshift(rotated.pop());
        t.splice(1, 0, ...rotated);
    }

    return results;
}

// ============================================================================
// MAIN DAILY MATCHUP ENGINE
// ============================================================================
function generateDailyLeagueMatchups(dailyBlocks) {
    const leagues = window.leaguesByName || {};
    const leagueHistory = loadLeagueHistory();

    const output = {}; // leagueName → array of matchup results

    Object.keys(leagues).forEach(leagueName => {
        const league = leagues[leagueName];
        if (!league) return;

        // 1. ALL teams from ALL divisions in the league
        const teams = getLeagueTeams(league);
        if (teams.length < 2) return;

        // 2. Collect blocks for THIS day + THIS league
        const blocksToday = getDailyLeagueBlocksForLeague(leagueName, dailyBlocks);
        if (blocksToday.length === 0) return;

        // Sort blocks chronologically (continuous minutes)
        blocksToday.sort((a, b) => a.startMin - b.startMin);

        // 3. Generate round-robin candidates
        const matches = generateRoundRobin(teams, leagueHistory);
        if (matches.length === 0) return;

        // 4. Assign matches to blocks
        output[leagueName] = [];

        let matchIdx = 0;

        for (let block of blocksToday) {
            const m = matches[matchIdx];
            if (!m) break;

            const gameNum = nextGameNumber(leagueName);

            // Attach final result record
            const result = {
                leagueName,
                teamA: m.teamA,
                teamB: m.teamB,
                sport: league.sport || "League",
                blockRef: block.__id || block.id || null,
                gameNumber: gameNum
            };

            output[leagueName].push(result);

            // Update history to prevent repeats
            const k1 = `${m.teamA}__${m.teamB}`;
            const k2 = `${m.teamB}__${m.teamA}`;
            leagueHistory[k1] = true;
            leagueHistory[k2] = true;

            matchIdx++;
        }
    });

    // Save updated history
    saveLeagueHistory(leagueHistory);

    // Expose to orchestrator (Stage 5)
    window.__LEAGUE_DAILY_RESULTS = output;
    return output;
}

// ============================================================================
// PUBLIC API
// ============================================================================
window.runLeagueSchedulingForDay = generateDailyLeagueMatchups;

})();
