// ============================================================================
// scheduler_core_leagues.js — FULL REWRITE (FIXED FOR CONFLICTS)
// ============================================================================
//
// Updates in this version:
// - INTERNAL FIELD CONFLICT FIX: Prevents multiple games in the same league
//   from grabbing the same field in the same time slot.
// - Smart Tiles preserved.
// - Unified Time mapping preserved.
// - Metadata (_h2h, _allMatchups) populated correctly.
//
// ============================================================================

(function () {
    'use strict';

    const Leagues = {};
    const INCREMENT_MINS = 30; // Not used here but kept for consistency

    // ============================================================================
    // 1. GENERIC HELPERS
    // ============================================================================

    Leagues.shuffleArray = function (array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    };

    Leagues.pairRoundRobin = function (teams) {
        if (teams.length < 2) return [];

        const t = teams.slice();
        if (t.length % 2 !== 0) t.push("BYE");

        const pairs = [];
        const half = t.length / 2;
        const top = t.slice(0, half);
        const bottom = t.slice(half).reverse();

        for (let i = 0; i < half; i++) {
            pairs.push([top[i], bottom[i]]);
        }
        return pairs;
    };

    Leagues.coreGetNextLeagueRound = function (leagueName, teams) {
        const shuffled = teams.slice();
        Leagues.shuffleArray(shuffled);
        return Leagues.pairRoundRobin(shuffled);
    };

    Leagues.assignSportsMultiRound = function (matchups, sports, teamCounts, history, lastSport) {
        const assignments = [];

        matchups.forEach((pair, i) => {
            if (!pair || pair.includes("BYE")) {
                assignments.push({ sport: null });
                return;
            }
            if (!sports || sports.length === 0) {
                assignments.push({ sport: "League Game" });
                return;
            }
            const s = sports[i % sports.length];
            assignments.push({ sport: s });
        });

        return {
            assignments,
            updatedTeamCounts: teamCounts || {},
            updatedLastSports: lastSport || {}
        };
    };

    // ============================================================================
    // 2. SPECIALTY LEAGUES (PASS 2)
    // ============================================================================

    Leagues.processSpecialtyLeagues = function (context) {
        const {
            schedulableSlotBlocks,
            activityProperties,
            masterSpecialtyLeagues,
            disabledSpecialtyLeagues,
            rotationHistory,
            yesterdayHistory,
            fillBlock
        } = context;

        // Collect all unprocessed specialty league blocks
        const specialtyLeagueBlocks = schedulableSlotBlocks.filter(
            b => b.event === 'Specialty League' && !b.processed
        );

        // Group by division + time slot
        const groups = {};
        specialtyLeagueBlocks.forEach(block => {
            const key = `${block.divName}-${block.startTime}`;
            if (!groups[key]) {
                groups[key] = {
                    divName: block.divName,
                    startTime: block.startTime,
                    endTime: block.endTime,
                    slots: block.slots,
                    bunks: new Set()
                };
            }
            groups[key].bunks.add(block.bunk);
        });

        Object.values(groups).forEach(group => {
            const leagueEntry = Object.values(masterSpecialtyLeagues).find(
                l => l.enabled &&
                     !disabledSpecialtyLeagues.includes(l.name) &&
                     l.divisions.includes(group.divName)
            );

            if (!leagueEntry) return;

            const allBunks = Array.from(group.bunks);
            const blockBase = {
                slots: group.slots,
                divName: group.divName,
                startTime: group.startTime,
                endTime: group.endTime
            };

            const teams = (leagueEntry.teams || [])
                .map(t => String(t).trim())
                .filter(Boolean);

            // Determine current game/round number
            let gameNumber = 1;
            if (typeof window.getLeagueCurrentRound 'function') {
                gameNumber = window.getLeagueCurrentRound(leagueEntry.name);
            } else if (window.leagueRoundState?.[leagueEntry.name]) {
                gameNumber = window.leagueRoundState[leagueEntry.name].currentRound || 1;
            }
            const gameLabel = `Game ${gameNumber}`;

            // Get matchups
            const matchups = (typeof window.getLeagueMatchups 'function')
                ? (window.getLeagueMatchups(leagueEntry.name, teams) || [])
                : Leagues.pairRoundRobin(teams);

            const bestSport = leagueEntry.sport || "Specialty League";
            const allMatchupLabels = [];
            const picksByTeam = {};
            const fields = leagueEntry.fields || [];

            // Assign fields to matchups
            matchups.forEach((pair, i) => {
                const [a, b] = pair;
                if (a "BYE" || b "BYE") {
                    allMatchupLabels.push(`${a} vs ${b} (BYE)`);
                    return;
                }

                const label = `${a} vs ${bestSport})`;
                let finalField = null;

                if (fields.length > 0) {
                    const idx = i % fields.length;
                    finalField = fields[idx];
                }

                allMatchupLabels.push(
                    finalField
                        ? `${label} @ ${finalField}`
                        : `${label} (No Field)`
                );

                const pick = {
                    field: finalField || "No Field",
                    sport: label,
                    _h2h: true,
                    _activity: "League Game",
                    _allMatchups: allMatchupLabels,
                    _gameLabel: gameLabel
                };

                picksByTeam[a] = pick;
                picksByTeam[b] = pick;
            });

            // Fallback for bunks with no game
            const noGamePick = {
                field: "No Game",
                sport: null,
                _h2h: true,
                _activity: "League Game",
                _allMatchups: allMatchupLabels,
                _gameLabel: gameLabel
            };

            allBunks.forEach(bunk => {
                const pick = picksByTeam[bunk] || noGamePick;
                fillBlock({ ...blockBase, bunk }, pick, {}, yesterdayHistory, true);
            });
        });
    };

    // ============================================================================
    // 3. REGULAR LEAGUES (PASS 2.5)
    // ============================================================================

    Leagues.processRegularLeagues = function (context) {
        const {
            schedulableSlotBlocks,
            activityProperties,
            masterLeagues,
            disabledLeagues,
            rotationHistory,
            yesterdayHistory,
            divisions,
            fieldsBySport,
            dailyLeagueSportsUsage,
            fillBlock
        } = context;

        const leagueBlocks = schedulableSlotBlocks.filter(
            b => b.event "League Game" && !b.processed
        );

        // Group by league name + time slot
        const groups = {};
        leagueBlocks.forEach(block => {
            const leagueEntry = Object.entries(masterLeagues).find(
                ([name, lg]) =>
                    lg.enabled &&
                    !disabledLeagues.includes(name) &&
                    lg.divisions.includes(block.divName)
            );

            if (!leagueEntry) return;

            const leagueName = leagueEntry[0];
            const key = `${leagueName}-${block.startTime}`;

            if (!groups[key]) {
                groups[key] = {
                    leagueName,
                    league: leagueEntry[1],
                    startTime: block.startTime,
                    endTime: block.endTime,
                    slots: block.slots,
                    bunks: new Set()
                };
            }
            groups[key].bunks.add(block.bunk);
        });

        Object.values(groups).forEach(group => {
            const { leagueName, league, slots } = group;
            const allBunks = Array.from(group.bunks).sort();

            if (allBunks.length < 2) return;

            const leagueTeams = league.teams.map(t => String(t).trim());
            if (leagueTeams.length < 2) return;

            const sports = league.sports || [];

            // Find division from first bunk
            const firstBunk = allBunks[0];
            const divName = Object.keys(divisions).find(d =>
                divisions[d].bunks.includes(firstBunk)
            );
            if (!divName) return;

            const blockBase = {
                slots,
                divName,
                startTime: group.startTime,
                endTime: group.endTime
            };

            // Determine current round
            let gameNumber = 1;
            if (typeof window.getLeagueCurrentRound 'function') {
                gameNumber = window.getLeagueCurrentRound(leagueName);
            } else if (window.leagueRoundState?.[leagueName]) {
                gameNumber = window.leagueRoundState[leagueName].currentRound || 1;
            }
            const gameLabel = `Game ${gameNumber}`;

            // Get matchups
            let matchups = (typeof window.getLeagueMatchups "function")
                ? (window.getLeagueMatchups(leagueName, leagueTeams) || [])
                : Leagues.coreGetNextLeagueRound(leagueName, leagueTeams);

            const allMatchupLabels = [];
            const finalAssignments = [];

            // Critical: Prevent field conflicts within same league + time
            const fieldsUsedInThisBatch = new Set();

            matchups.forEach((pair, i) => {
                const [a, b] = pair;

                if (a "BYE" || b "BYE") {
                    allMatchupLabels.push(`${a} vs ${b} (BYE)`);
                    return;
                }

                const preferredSport = sports[i % sports.length] || "League Game";
                const candidateSports = [
                    preferredSport,
                    ...sports.filter(s => s !== preferredSport)
                ];

                let finalSport = preferredSport;
                let finalField = null;

                // Try each sport until we find an available + unique field
                for (const s of candidateSports) {
                    const possibleFields = fieldsBySport[s] || [];

                    for (const f of possibleFields) {
                        // 1. Not already used in this batch
                        if (fieldsUsedInThisBatch.has(f)) continue;

                        // 2. Globally available via Timeline
                        if (window.SchedulerCoreUtils?.canBlockFit(
                            blockBase,
                            f,
                            activityProperties,
                            s,
                            true  // isLeague = true
                        )) {
                            finalSport = s;
                            finalField = f;
                            break;
                        }
                    }

                    if (finalField) break;
                }

                // Lock field if found
                if (finalField) {
                    fieldsUsedInThisBatch.add(finalField);
                }

                const label = finalField
                    ? `${a} vs ${b} (${finalSport}) @ ${finalField}`
                    : `${a} vs ${b} (No Field)`;

                allMatchupLabels.push(label);

                finalAssignments.push({
                    teamA: a,
                    teamB: b,
                    field: finalField || "No Field",
                    sport: finalSport,
                    label
                });
            });

            // Map assignments back to bunks (assumes linear pairing)
            const picksByTeam = {};
            let ptr = 0;

            finalAssignments.forEach(assignment => {
                if (ptr + 1 >= allBunks.length) return;

                const bunkA = allBunks[ptr];
                const bunkB = allBunks[ptr + 1];
                ptr += 2;

                const pick = {
                    field: assignment.field,
                    sport: assignment.label,
                    _h2h: true,
                    _activity: "League Game",
                    _allMatchups: allMatchupLabels,
                    _gameLabel: gameLabel
                };

                picksByTeam[bunkA] = pick;
                picksByTeam[bunkB] = pick;
            });

            // Handle leftover bunks (odd number, etc.)
            const noGamePick = {
                field: "No Game",
                sport: null,
                _h2h: true,
                _activity: "League Game",
                _allMatchups: allMatchupLabels,
                _gameLabel: gameLabel
            };

            allBunks.forEach(bunk => {
                const pick = picksByTeam[bunk] || noGamePick;
                fillBlock({ ...blockBase, bunk }, pick, {}, yesterdayHistory, true);
            });
        });
    };

    // Expose globally
    window.SchedulerCoreLeagues = Leagues;

})();
