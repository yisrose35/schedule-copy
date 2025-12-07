// ============================================================================
// scheduler_core_leagues.js — FULL REWRITE (FORMAT B)
// Strict League Exclusivity + Division-Level League Outputs
//
// FINAL BEHAVIOR:
// • Bunks DO NOT receive team assignments.
// • Bunks only receive “League Block” as their event during league time.
// • The REAL league info is stored in:
//
//     window.leagueAssignments[division][slotIndex] = {
//        gameLabel,
//        startMin,
//        endMin,
//        matchups: [
//           { teamA, teamB, sport, field },
//           ...
//        ]
//     }
//
// • Main UI uses leagueAssignments to render:
//
//     Game 3:
//     • Team A vs Team B — Basketball @ Court 1
//     • Team C vs Team D — Soccer @ Field 2
//
// • Enforces strict field exclusivity using reservation veto.
// ============================================================================

(function () {
    'use strict';

    const Leagues = {};
    const INCREMENT_MINS = 30;

    // =========================================================================
    // HELPERS
    // =========================================================================

    function writeLeagueReservationVeto(field, block) {
        window.fieldReservationLog ??= {};
        window.fieldReservationLog[field] ??= [];

        window.fieldReservationLog[field].push({
            bunk: "__LEAGUE_VETO__",
            divName: block.divName,
            startMin: block.startTime,
            endMin: block.endTime,
            exclusive: true,
            reason: "League Field Lock"
        });
    }

    function getGameLabel(leagueName) {
        if (typeof window.getLeagueCurrentRound === "function") {
            return `Game ${window.getLeagueCurrentRound(leagueName)}`;
        }
        const round = window.leagueRoundState?.[leagueName]?.currentRound || 1;
        return `Game ${round}`;
    }

    function roundRobinPairs(teams) {
        if (teams.length < 2) return [];

        const arr = teams.slice();
        if (arr.length % 2 !== 0) arr.push("BYE");

        const half = arr.length / 2;
        const round = [];

        const top = arr.slice(0, half);
        const bottom = arr.slice(half).reverse();

        for (let i = 0; i < half; i++) {
            round.push([top[i], bottom[i]]);
        }
        return round;
    }

    // =========================================================================
    // SPECIALTY LEAGUES (DIVISION-LEVEL)
    // =========================================================================

    Leagues.processSpecialtyLeagues = function (context) {
        const {
            schedulableSlotBlocks,
            masterSpecialtyLeagues,
            disabledSpecialtyLeagues,
            yesterdayHistory,
            activityProperties,
            fillBlock,
            fieldUsageBySlot
        } = context;

        const groups = {};

        schedulableSlotBlocks
            .filter(b => b.event === "Specialty League" && !b.processed)
            .forEach(block => {
                const key = `${block.divName}-${block.startTime}`;
                groups[key] ??= {
                    divName: block.divName,
                    startTime: block.startTime,
                    endTime: block.endTime,
                    slots: block.slots,
                    bunks: []
                };
                groups[key].bunks.push(block.bunk);
            });

        Object.values(groups).forEach(group => {
            const entry = Object.values(masterSpecialtyLeagues).find(
                l =>
                    l.enabled &&
                    !disabledSpecialtyLeagues.includes(l.name) &&
                    l.divisions.includes(group.divName)
            );
            if (!entry) return;

            const block = {
                divName: group.divName,
                startTime: group.startTime,
                endTime: group.endTime,
                slots: group.slots
            };

            const teams = entry.teams.slice();
            const pairs = roundRobinPairs(teams);
            const gameLabel = getGameLabel(entry.name);

            const matchups = [];
            let vetoField = null;

            pairs.forEach((pair, i) => {
                const [A, B] = pair;

                if (A === "BYE" || B === "BYE") {
                    matchups.push({
                        teamA: A,
                        teamB: B,
                        sport: entry.sport || "League Game",
                        field: null
                    });
                    return;
                }

                const field = entry.fields?.[i % entry.fields.length] || null;
                if (!vetoField && field) vetoField = field;

                matchups.push({
                    teamA: A,
                    teamB: B,
                    sport: entry.sport || "League Game",
                    field
                });
            });

            // Write to leagueAssignments (UI)
            window.leagueAssignments ??= {};
            window.leagueAssignments[group.divName] ??= {};

            matchups.forEach(m => {
                const slotIndex = group.slots[0];
                window.leagueAssignments[group.divName][slotIndex] = {
                    gameLabel,
                    startMin: group.startTime,
                    endMin: group.endTime,
                    matchups
                };
            });

            // Fill bunks with only “League Block”
            group.bunks.forEach(bunk => {
                fillBlock(
                    { ...block, bunk },
                    {
                        field: "League Block",
                        sport: null,
                        _activity: "League Block",
                        _fixed: true
                    },
                    fieldUsageBySlot,
                    yesterdayHistory,
                    true,                // isLeague
                    activityProperties
                );
            });

            // Apply hard veto to field
            if (vetoField) writeLeagueReservationVeto(vetoField, block);
        });
    };

    // =========================================================================
    // REGULAR LEAGUES (DIVISION-LEVEL)
    // =========================================================================

    Leagues.processRegularLeagues = function (context) {
        const {
            schedulableSlotBlocks,
            masterLeagues,
            disabledLeagues,
            divisions,
            fieldsBySport,
            activityProperties,
            yesterdayHistory,
            fillBlock,
            fieldUsageBySlot
        } = context;

        const groups = {};

        schedulableSlotBlocks
            .filter(b => b.event === "League Game" && !b.processed)
            .forEach(block => {
                const lg = Object.entries(masterLeagues).find(
                    ([name, L]) =>
                        L.enabled &&
                        !disabledLeagues.includes(name) &&
                        L.divisions.includes(block.divName)
                );
                if (!lg) return;

                const [leagueName, league] = lg;
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

        Object.values(groups).forEach(group => {
            const { leagueName, league } = group;

            const teams = league.teams.slice();
            if (teams.length < 2) return;

            const pairs = roundRobinPairs(teams);
            const gameLabel = getGameLabel(leagueName);
            const sports = league.sports?.length ? league.sports : ["League Game"];

            const matchups = [];
            let vetoField = null;

            pairs.forEach((pair, i) => {
                const [A, B] = pair;

                if (A === "BYE" || B === "BYE") {
                    matchups.push({ teamA: A, teamB: B, sport: sports[0], field: null });
                    return;
                }

                const preferredSport = sports[i % sports.length];
                const candidates = [preferredSport, ...sports.filter(s => s !== preferredSport)];

                let chosenField = null;
                let chosenSport = preferredSport;

                for (const sport of candidates) {
                    const possibleFields = fieldsBySport[sport] || [];

                    for (const field of possibleFields) {
                        if (
                            window.SchedulerCoreUtils.canBlockFit(
                                {
                                    divName: group.divName,
                                    bunk: "__LEAGUE__",
                                    startTime: group.startTime,
                                    endTime: group.endTime,
                                    slots: group.slots
                                },
                                field,
                                activityProperties,
                                fieldUsageBySlot,
                                sport,
                                true
                            )
                        ) {
                            chosenField = field;
                            chosenSport = sport;
                            break;
                        }
                    }
                    if (chosenField) break;
                }

                if (chosenField && !vetoField) vetoField = chosenField;

                matchups.push({
                    teamA: A,
                    teamB: B,
                    sport: chosenSport,
                    field: chosenField
                });
            });

            // Save league assignments for UI
            window.leagueAssignments ??= {};
            window.leagueAssignments[group.divName] ??= {};

            const slotIndex = group.slots[0];
            window.leagueAssignments[group.divName][slotIndex] = {
                gameLabel,
                startMin: group.startTime,
                endMin: group.endTime,
                matchups
            };

            // Fill bunks with “League Block”
            group.bunks.forEach(bunk => {
                fillBlock(
                    {
                        divName: group.divName,
                        bunk,
                        startTime: group.startTime,
                        endTime: group.endTime,
                        slots: group.slots
                    },
                    {
                        field: "League Block",
                        sport: null,
                        _activity: "League Block",
                        _fixed: true
                    },
                    fieldUsageBySlot,
                    yesterdayHistory,
                    true,
                    activityProperties
                );
            });

            // Apply strict field veto
            if (vetoField) {
                writeLeagueReservationVeto(vetoField, {
                    divName: group.divName,
                    startTime: group.startTime,
                    endTime: group.endTime
                });
            }
        });
    };

    // Export
    window.SchedulerCoreLeagues = Leagues;

})();
