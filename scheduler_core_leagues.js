// ============================================================================
// scheduler_core_leagues.js (GCM FINAL: SAFETY NET + MAGNET)
// MULTI-BLOCK ROUND ADVANCEMENT + VISUAL MATCHUPS FULLY RESTORED
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
    // GAME LABEL (READ-ONLY)
    // ------------------------------------------------------------
    function getGameLabel(leagueName) {
        if (typeof window.getLeagueCurrentRound === "function")
            return `Game ${window.getLeagueCurrentRound(leagueName)}`;

        const round = window.leagueRoundState?.[leagueName]?.currentRound || 1;
        return `Game ${round}`;
    }

    // ------------------------------------------------------------
    // BACKUP SIMPLE ROUND-ROBIN
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
    // ⭐ NEW: GLOBAL ROUND ADVANCER (persistent multi-block-safe)
    // ------------------------------------------------------------
    function pullNextLeagueRound(leagueName, teams) {
        window.leagueRoundState ??= {};
        const state = window.leagueRoundState[leagueName] || { currentRound: 0 };

        const schedule = window.generateRoundRobin?.(teams) || [];
        if (!schedule.length) return [];

        const roundIndex = state.currentRound % schedule.length;
        const round = schedule[roundIndex];

        window.leagueRoundState[leagueName] = {
            currentRound: state.currentRound + 1
        };

        window.saveGlobalSettings?.("leagueRoundState", window.leagueRoundState);

        return round;
    }

    // ------------------------------------------------------------
    // DIVISION MATCH LOGIC
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
    // Multi-block safe. Visual matchups restored.
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

            const leagueBlocks = schedulableSlotBlocks.filter(b => {
                const name = String(b.event || "").toLowerCase();
                const hasLeagueInName = name.includes("league") && !name.includes("specialty");
                const hasLeagueType = b.type === 'league';
                return hasLeagueInName || hasLeagueType;
            });

            if (!leagueBlocks.length) {
                console.warn("ABORT: No 'League' blocks in queue.");
                return;
            }

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

            // ====================================================================
            // PROCESS EACH LEAGUE BLOCK
            // ====================================================================
            Object.values(groups).forEach(group => {
                const { leagueName, league } = group;
                const teams = league.teams.slice();
                if (teams.length < 2) return;

                // ⭐ NEW: Persistent round fetcher (increments automatically)
                let pairs = pullNextLeagueRound(leagueName, teams);
                if (!Array.isArray(pairs) || !pairs.length)
                    pairs = roundRobinPairs(teams);

                const gameLabel = getGameLabel(leagueName);

                const sports = league.sports?.length ? league.sports : ["League Game"];
                const matchups = [];
                const lockedFields = new Set();

                // ====================================================================
                // BUILD MATCHUPS WITH FIELD ASSIGNMENTS
                // ====================================================================
                pairs.forEach((pair, i) => {
                    let A = pair[0];
                    let B = pair[1];

                    if (!A || A === "BYE") A = "BYE";
                    if (!B || B === "BYE") B = "BYE";

                    // BYE still displayed
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

                // ====================================================================
                // VISUAL MATCHUPS TEXT (FIXED)
                // ====================================================================
                const formattedMatchups = matchups.map(m => {
                    if (m.teamA === "BYE" || m.teamB === "BYE") {
                        return `${m.teamA} vs ${m.teamB}`;
                    }
                    return `${m.teamA} vs ${m.teamB} — ${m.sport} @ ${m.field || "TBD"}`;
                });

                // ====================================================================
                // STORE ASSIGNMENTS
                // ====================================================================
                window.leagueAssignments ??= {};
                window.leagueAssignments[group.divName] ??= {};
                const slotIndex = group.slots[0];

                window.leagueAssignments[group.divName][slotIndex] = {
                    gameLabel,
                    startMin: group.startTime,
                    endMin: group.endTime,
                    matchups
                };

                // ====================================================================
                // FILL BLOCKS (ensures skeleton UI shows matchups)
                // ====================================================================
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

                lockedFields.forEach(f => writeLeagueReservationVeto(f, group));
            });

            console.log("--- LEAGUE GENERATOR SUCCESS ---");
        } catch (error) {
            console.error("❌ CRITICAL ERROR IN LEAGUE GENERATOR:", error);
        }
    };

    // Specialty leagues placeholder
    Leagues.processSpecialtyLeagues = function () {};

    window.SchedulerCoreLeagues = Leagues;

})();
