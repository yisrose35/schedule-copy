// ============================================================================
// scheduler_core_leagues.js (GCM FINAL: SAFETY NET + MAGNET)
// UPDATED: Multi-Block League Round Advancement (pullNextLeagueRound)
// ============================================================================

(function () {
    'use strict';

    const Leagues = {};
    const INCREMENT_MINS = 30;

    // ------------------------------------------------------------
    // GLOBAL LEAGUE VETO LOGGER
    // ------------------------------------------------------------
    function writeLeagueReservationVeto(field, block) {
        window.fieldReservationLog ??= {};
        window.fieldReservationLog[field] ??= [];
        const exists = window.fieldReservationLog[field].some(
            r => r.bunk === "__LEAGUE_VETO__" && r.startMin === block.startTime
        );
        if (!exists) {
            window.fieldReservationLog[field].push({
                bunk: "__LEAGUE_VETO__",
                divName: block.divName,
                startMin: block.startTime,
                endMin: block.endTime,
                exclusive: true,
                reason: "League Field Lock"
            });
        }
    }

    // ------------------------------------------------------------
    // GAME LABEL (READ-ONLY, AFTER COUNTER MOVES)
    // ------------------------------------------------------------
    function getGameLabel(leagueName) {
        if (typeof window.getLeagueCurrentRound === "function")
            return `Game ${window.getLeagueCurrentRound(leagueName)}`;

        const round = window.leagueRoundState?.[leagueName]?.currentRound || 1;
        return `Game ${round}`;
    }

    // ------------------------------------------------------------
    // OLD QUICK ROUND-ROBIN (kept only for emergency fallback)
    // ------------------------------------------------------------
    function roundRobinPairs(teams) {
        if (teams.length < 2) return [];
        const arr = teams.slice();
        if (arr.length % 2 !== 0) arr.push("BYE");
        const half = arr.length / 2;
        const round = [];
        const top = arr.slice(0, half);
        const bottom = arr.slice(half).reverse();
        for (let i = 0; i < half; i++) round.push([top[i], bottom[i]]);
        return round;
    }

    // ------------------------------------------------------------
    // NEW: GLOBAL ROUND ADVANCER (PERSISTENT, MULTI-BLOCK SAFE)
    // Each block consumes one round, increments global season counter.
    // ------------------------------------------------------------
    function pullNextLeagueRound(leagueName, teams) {

        window.leagueRoundState ??= {};
        const state = window.leagueRoundState[leagueName] || { currentRound: 0 };

        // Must use your global full schedule generator
        const schedule = window.generateRoundRobin?.(teams) || [];
        if (!schedule.length) return [];

        const roundIndex = state.currentRound % schedule.length;
        const round = schedule[roundIndex];

        // Increment persistent global counter immediately
        window.leagueRoundState[leagueName] = {
            currentRound: state.currentRound + 1
        };

        window.saveGlobalSettings?.("leagueRoundState", window.leagueRoundState);
        return round;
    }

    // ------------------------------------------------------------
    // DIVISION MATCH HELPER
    // ------------------------------------------------------------
    function isDivisionMatch(timelineDiv, leagueDiv) {
        if (!timelineDiv || !leagueDiv) return false;
        const t = String(timelineDiv).trim().toLowerCase();
        const l = String(leagueDiv).trim().toLowerCase();
        if (t === l) return true;
        if (l.includes(t) || t.includes(l)) return true;
        const cleanT = t.replace(/(st|nd|rd|th|grade|s)/g, "").trim();
        const cleanL = l.replace(/(st|nd|rd|th|grade|s)/g, "").trim();
        return cleanT === cleanL && cleanT.length > 0;
    }

    // ========================================================================
    // MAIN: PROCESS REGULAR LEAGUES
    // MULTI-BLOCK SAFE LEAGUE MATCHUP GENERATOR
    // ========================================================================
    Leagues.processRegularLeagues = function (context) {
        try {
            const {
                schedulableSlotBlocks,
                masterLeagues,
                disabledLeagues,
                fieldsBySport,
                activityProperties,
                yesterdayHistory,
                fillBlock,
                fieldUsageBySlot
            } = context;

            console.log("--- LEAGUE GENERATOR START ---");

            // Identify League Blocks
            const leagueBlocks = schedulableSlotBlocks.filter(b => {
                const name = String(b.event || "").toLowerCase();
                const hasLeagueInName = name.includes("league") && !name.includes("specialty");
                const hasLeagueType = b.type === 'league';
                return hasLeagueInName || hasLeagueType;
            });

            if (leagueBlocks.length === 0) {
                console.warn("ABORT: No 'League' blocks in queue.");
                return;
            }

            // Group blocks by: leagueName + division + startTime
            const groups = {};
            leagueBlocks.forEach(block => {
                const lgEntry = Object.entries(masterLeagues).find(([name, L]) => {
                    if (!L.enabled || disabledLeagues.includes(name)) return false;
                    return L.divisions && L.divisions.some(d => isDivisionMatch(block.divName, d));
                });
                if (!lgEntry) return;

                const [leagueName, league] = lgEntry;
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

            // Process each grouped league block individually
            Object.values(groups).forEach(group => {
                const { leagueName, league } = group;
                const teams = league.teams.slice();
                if (teams.length < 2) return;

                // ⭐ NEW: Use persistent, incrementing matchups
                const pairs = pullNextLeagueRound(leagueName, teams);

                // After increment we read correct label
                const gameLabel = getGameLabel(leagueName);

                const sports = league.sports?.length ? league.sports : ["League Game"];
                const matchups = [];
                const lockedFields = new Set();

                // Allocate fields
                pairs.forEach((pair, i) => {
                    const [A, B] = pair;

                    if (A === "BYE" || B === "BYE") {
                        matchups.push({
                            teamA: A,
                            teamB: B,
                            sport: sports[0],
                            field: null
                        });
                        return;
                    }

                    const preferredSport = sports[i % sports.length];
                    const candidates = [preferredSport, ...sports.filter(s => s !== preferredSport)];
                    let chosenField = null;
                    let chosenSport = preferredSport;

                    for (const sport of candidates) {
                        const possibleFields = fieldsBySport?.[sport] || [];
                        for (const field of possibleFields) {
                            const fits = window.SchedulerCoreUtils.canBlockFit(
                                { divName: group.divName, bunk: "__LEAGUE__", startTime: group.startTime, endTime: group.endTime, slots: group.slots },
                                field,
                                activityProperties,
                                fieldUsageBySlot,
                                sport,
                                true
                            );
                            if (fits || true) {
                                chosenField = field;
                                chosenSport = sport;
                                break;
                            }
                        }
                        if (chosenField) break;
                    }

                    if (chosenField) lockedFields.add(chosenField);
                    matchups.push({
                        teamA: A,
                        teamB: B,
                        sport: chosenSport,
                        field: chosenField
                    });
                });

                // Store summary on global assignment map
                window.leagueAssignments ??= {};
                window.leagueAssignments[group.divName] ??= {};
                const slotIndex = group.slots[0];
                window.leagueAssignments[group.divName][slotIndex] = {
                    gameLabel,
                    startMin: group.startTime,
                    endMin: group.endTime,
                    matchups
                };

                // Format for UI display in skeleton
                const formattedMatchups = matchups.map(
                    m => `${m.teamA} vs ${m.teamB} — ${m.sport} @ ${m.field || 'TBD'}`
                );

                // Write into every bunk’s schedule block
                group.bunks.forEach(bunk => {
                    fillBlock(
                        { divName: group.divName, bunk, startTime: group.startTime, endTime: group.endTime, slots: group.slots },
                        {
                            field: "League Block",
                            sport: null,
                            _activity: "League Block",
                            _fixed: true,
                            _allMatchups: formattedMatchups,
                            _gameLabel: gameLabel
                        },
                        fieldUsageBySlot,
                        yesterdayHistory,
                        true,
                        activityProperties
                    );
                });

                // Lock fields globally
                lockedFields.forEach(f => writeLeagueReservationVeto(f, group));
            });

            console.log("--- LEAGUE GENERATOR SUCCESS ---");
        } catch (error) {
            console.error("❌ CRITICAL ERROR IN LEAGUE GENERATOR:", error);
        }
    };

    // Specialty leagues (not yet implemented)
    Leagues.processSpecialtyLeagues = function (context) {};

    window.SchedulerCoreLeagues = Leagues;

})();
