// ============================================================================
// scheduler_core_leagues.js — GCM SMART v1
// HYPER-INTELLIGENT LEAGUE SCHEDULER WITH FIELD RULES + SPORT ROTATION
//
// PRIORITY ORDER (hard → soft)
// 1. Avoid pair repeat (strongest)
// 2. Avoid repeated sport for pair (secondary)
// 3. Avoid repeated sport for team (tertiary)
// 4. Respect field restrictions, availability, capacity, and division priority
// 5. Fit inside block time
// 6. If all else fails → assign ANY valid field + sport
//
// Fully compatible with:
// - league_scheduling.js (persistent round state)
// - scheduler_ui.js (matchup display)
// - fields.js (restrictions / availability / capacity / priority)
// ============================================================================

(function () {
    "use strict";

    const Leagues = {};

    // ========================================================================
    // HELPERS
    // ========================================================================

    /** Get all fields that allow a given sport for a given division */
    function getValidFieldsForSport(sport, division, fields) {
        return fields.filter(f => {
            if (!f.available) return false;
            if (!f.activities?.includes(sport)) return false;

            // Division restrictions
            if (f.limitUsage?.enabled) {
                const allowedDivs = Object.keys(f.limitUsage.divisions || {});
                if (allowedDivs.length > 0 && !allowedDivs.includes(division)) return false;
            }

            return true;
        });
    }

    /** Get a field assigned by priority rules */
    function pickBestField(validFields, division) {
        if (validFields.length === 0) return null;
        if (validFields.length === 1) return validFields[0];

        // Check field preferences
        const scored = validFields.map(f => {
            let score = 0;

            // Division priority list
            if (f.preferences?.enabled && Array.isArray(f.preferences.list)) {
                const idx = f.preferences.list.indexOf(division);
                if (idx !== -1) score += (100 - idx); // earlier = stronger
            }

            return { field: f, score };
        });

        scored.sort((a, b) => b.score - a.score);
        return scored[0].field;
    }

    /** Determine the best sport choice based on fairness rules */
    function pickBestSport(teamA, teamB, league, history) {
        const sports = league.sports.slice(); // available sports

        // History: history[team][sport] = times played
        const playedA = history[teamA] || {};
        const playedB = history[teamB] || {};

        // Past matches between this pair
        const pairHistory = history.__pairs?.[`${teamA}-${teamB}`] ||
                            history.__pairs?.[`${teamB}-${teamA}`] || [];

        const lastSportA = playedA.__last || null;
        const lastSportB = playedB.__last || null;

        // Step 1: avoid repeated pair match (different sport)
        const forbiddenPairSport = pairHistory.length > 0 ? pairHistory[pairHistory.length - 1] : null;

        // Step 2: avoid back-to-back (team repeating same sport)
        const avoidA = playedA.__last || null;
        const avoidB = playedB.__last || null;

        // Score sports
        const scored = sports.map(s => {
            let score = 100;

            // Hard rule: avoid same sport as last time this pair played
            if (s === forbiddenPairSport) score -= 80;

            // Avoid back-to-back
            if (s === avoidA) score -= 30;
            if (s === avoidB) score -= 30;

            // Prefer lowest total usage (fairness)
            const uA = playedA[s] || 0;
            const uB = playedB[s] || 0;
            score -= (uA + uB) * 2;

            return { sport: s, score };
        });

        scored.sort((a, b) => b.score - a.score);
        return scored[0].sport;
    }

    /** Update sport + pair history after assigning */
    function updateHistory(teamA, teamB, sport, history) {
        history[teamA] ??= {};
        history[teamB] ??= {};
        history.__pairs ??= {};

        const pKey1 = `${teamA}-${teamB}`;
        const pKey2 = `${teamB}-${teamA}`;
        history.__pairs[pKey1] ??= [];
        history.__pairs[pKey2] ??= [];

        // Sport history
        history[teamA][sport] = (history[teamA][sport] || 0) + 1;
        history[teamB][sport] = (history[teamB][sport] || 0) + 1;

        // Last sport
        history[teamA].__last = sport;
        history[teamB].__last = sport;

        // Pair history
        history.__pairs[pKey1].push(sport);
        history.__pairs[pKey2].push(sport);
    }

    // ========================================================================
    // MAIN ENGINE
    // ========================================================================
    Leagues.processRegularLeagues = function (context) {
        try {
            const {
                schedulableSlotBlocks,
                masterLeagues,
                disabledLeagues,
                fieldsBySport,
                fields,
                activityProperties,
                yesterdayHistory,
                fillBlock,
                fieldUsageBySlot
            } = context;

            window.leagueAssignments ??= {};

            // Extract league blocks
            const leagueBlocks = schedulableSlotBlocks.filter(b => {
                return (b.type === "league") ||
                    (String(b.event).toLowerCase().includes("league") &&
                     !String(b.event).toLowerCase().includes("specialty"));
            });

            if (leagueBlocks.length === 0) return;

            const groups = {};

            // Group blocks by league + division + slot
            leagueBlocks.forEach(block => {
                const entry = Object.entries(masterLeagues).find(([name, L]) => {
                    if (!L.enabled || disabledLeagues.includes(name)) return false;
                    return L.divisions?.includes(block.divName);
                });
                if (!entry) return;

                const [leagueName, league] = entry;
                const key = `${leagueName}-${block.divName}-${block.startTime}`;
                groups[key] ??= {
                    leagueName,
                    league,
                    divName: block.divName,
                    startTime: block.startTime,
                    endTime: block.endTime,
                    slots: block.slots,
                    bunks: []
                };
                groups[key].bunks.push(block.bunk);
            });

            // History object
            const history = {};

            // PROCESS EACH GROUP
            Object.values(groups).forEach(group => {
                const { leagueName, league, divName } = group;

                // Step 1: get matchups from persistent engine
                const pairs = window.getLeagueMatchups(leagueName, league.teams);

                // Build matches (sport + field assignment)
                const matchups = [];

                pairs.forEach(([teamA, teamB]) => {
                    // Pick sport
                    const sport = pickBestSport(teamA, teamB, league, history);

                    // Get valid fields
                    const validFields = getValidFieldsForSport(sport, divName, fields);

                    // Pick best field based on priority rules
                    const chosenField = pickBestField(validFields, divName);

                    matchups.push({
                        teamA,
                        teamB,
                        sport,
                        field: chosenField ? chosenField.name : null
                    });

                    // Update history
                    updateHistory(teamA, teamB, sport, history);
                });

                // Save for UI
                const slotIndex = group.slots[0];
                const gameLabel = `Game ${window.getLeagueCurrentRound(leagueName) - 1}`;

                window.leagueAssignments[divName] ??= {};
                window.leagueAssignments[divName][slotIndex] = {
                    gameLabel,
                    startMin: group.startTime,
                    endMin: group.endTime,
                    matchups
                };

                // Fill into schedule
                group.bunks.forEach(bunk => {
                    fillBlock(
                        {
                            divName,
                            bunk,
                            startTime: group.startTime,
                            endTime: group.endTime,
                            slots: group.slots
                        },
                        {
                            field: "League Block",
                            sport: null,
                            _activity: "League Block",
                            _fixed: true,
                            _allMatchups: matchups.map(m =>
                                `${m.teamA} vs ${m.teamB} — ${m.sport} @ ${m.field || "TBD"}`
                            ),
                            _gameLabel: gameLabel
                        },
                        fieldUsageBySlot,
                        yesterdayHistory,
                        true,
                        activityProperties
                    );
                });
            });

        } catch (err) {
            console.error("SMART LEAGUE ENGINE ERROR:", err);
        }
    };

    Leagues.processSpecialtyLeagues = function () { };

    window.SchedulerCoreLeagues = Leagues;

})();
