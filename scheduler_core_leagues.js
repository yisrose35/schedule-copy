// ============================================================================
// scheduler_core_leagues.js (GCM FINAL — TRUE ROTATION + VALIDATION)
// ============================================================================
//
// Fixes in this release:
// - REMOVED the "fits || true" override (root cause of no rotation)
// - True field validation for each candidate sport
// - Clean fallback sport selection
// - Proper sport history tracking per team per league
// - Deterministic rotation, cycle detection, and anti-back-to-back logic
// - Fully compatible with league_scheduling.js
//
// ============================================================================

(function () {
    'use strict';

    const Leagues = {};
    const INCREMENT_MINS = 30;

    // ========================================================================
    // LEAGUE FIELD RESERVATION VETO LOGGER
    // ========================================================================
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

    // ========================================================================
    // SPORT HISTORY
    // ========================================================================
    window.leagueSportHistory ??= {};

    function getTeamSportHistory(leagueName, teamName) {
        if (!teamName || teamName === "BYE") return [];
        window.leagueSportHistory[leagueName] ??= {};
        window.leagueSportHistory[leagueName][teamName] ??= [];
        return window.leagueSportHistory[leagueName][teamName];
    }

    function recordSportHistory(leagueName, teamName, sport) {
        if (!teamName || teamName === "BYE" || !sport) return;
        window.leagueSportHistory[leagueName] ??= {};
        window.leagueSportHistory[leagueName][teamName] ??= [];
        window.leagueSportHistory[leagueName][teamName].push(sport);
    }

    // ========================================================================
    // SPORT PRIORITIZER (ROTATION ENGINE)
    // ========================================================================
    function getPrioritizedSports(leagueName, teamA, teamB, availableSports) {
        if (!teamA || !teamB || teamA === "BYE" || teamB === "BYE") {
            return availableSports;
        }

        const histA = getTeamSportHistory(leagueName, teamA);
        const histB = getTeamSportHistory(leagueName, teamB);

        const lastSportA = histA[histA.length - 1] || null;
        const lastSportB = histB[histB.length - 1] || null;

        const numSports = availableSports.length;

        const cycleA = Math.floor(histA.length / numSports);
        const cycleB = Math.floor(histB.length / numSports);

        const cycleSportsA = histA.slice(cycleA * numSports);
        const cycleSportsB = histB.slice(cycleB * numSports);

        const scored = availableSports.map(sport => {
            let score = 0;

            // Back-to-back block
            if (sport === lastSportA || sport === lastSportB) score -= 1000;

            const playedA = cycleSportsA.includes(sport);
            const playedB = cycleSportsB.includes(sport);

            if (!playedA && !playedB) score += 100;
            else if (!playedA || !playedB) score += 50;
            else score += 10;

            return { sport, score };
        });

        scored.sort((a, b) => b.score - a.score);
        return scored.map(s => s.sport);
    }

    // ========================================================================
    // FALLBACK ROUND ROBIN
    // ========================================================================
    function roundRobinPairs(teams) {
        if (teams.length < 2) return [];
        const arr = teams.slice();
        if (arr.length % 2) arr.push("BYE");

        const half = arr.length / 2;
        const top = arr.slice(0, half);
        const bottom = arr.slice(half).reverse();

        const out = [];
        for (let i = 0; i < half; i++) {
            out.push([top[i], bottom[i]]);
        }
        return out;
    }

    // ========================================================================
    // DIVISION MATCH
    // ========================================================================
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
    // MAIN REGULAR LEAGUES
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

            console.log("=== LEAGUE GENERATOR START (GCM TRUE ROTATION) ===");

            // Filter League slots
            const leagueBlocks = schedulableSlotBlocks.filter(b => {
                const name = (b.event || "").toLowerCase();
                const isLeagueName = name.includes("league") && !name.includes("specialty");
                const isLeagueType = b.type === "league";
                return isLeagueName || isLeagueType;
            });

            if (!leagueBlocks.length) return;

            // Group blocks
            const groups = {};
            leagueBlocks.forEach(b => {
                const lgEntry = Object.entries(masterLeagues)
                    .find(([n, L]) =>
                        L.enabled &&
                        !disabledLeagues.includes(n) &&
                        L.divisions &&
                        L.divisions.some(d => isDivisionMatch(b.divName, d))
                    );
                if (!lgEntry) return;

                const [lgName, league] = lgEntry;
                const key = `${lgName}-${b.divName}-${b.startTime}`;

                groups[key] ??= {
                    leagueName: lgName,
                    league,
                    divName: b.divName,
                    startTime: b.startTime,
                    endTime: b.endTime,
                    slots: b.slots,
                    bunks: []
                };

                groups[key].bunks.push(b.bunk);
            });

            // ====================================================================
            // PROCESS EACH GROUP
            // ====================================================================
            for (const group of Object.values(groups)) {
                const { leagueName, league } = group;

                const teams = (league.teams || []).slice();
                if (teams.length < 2) continue;

                let pairs = [];
                if (typeof window.getLeagueMatchups === "function") {
                    pairs = window.getLeagueMatchups(leagueName, teams) || [];
                } else {
                    pairs = roundRobinPairs(teams);
                }

                let gameLabel = "Game ?";
                if (typeof window.getLeagueCurrentRound === "function") {
                    gameLabel = `Game ${window.getLeagueCurrentRound(leagueName)}`;
                }

                const baseSports = league.sports?.length ? league.sports : ["League Game"];
                const matchups = [];
                const lockedFields = new Set();

                // ====================================================================
                // SPORT + FIELD PICKER (fixed)
                // ====================================================================
                for (const [Aorig, Borig] of pairs) {
                    const A = Aorig || "BYE";
                    const B = Borig || "BYE";

                    if (A === "BYE" || B === "BYE") {
                        matchups.push({
                            teamA: A,
                            teamB: B,
                            sport: baseSports[0],
                            field: null
                        });
                        continue;
                    }

                    const orderedSports = getPrioritizedSports(leagueName, A, B, baseSports);

                    let chosenSport = null;
                    let chosenField = null;

                    // Try sports in BEST → WORST order
                    for (const sport of orderedSports) {
                        const possibleFields = fieldsBySport?.[sport] || [];

                        for (const f of possibleFields) {
                            if (lockedFields.has(f)) continue;

                            const fits = window.SchedulerCoreUtils.canBlockFit(
                                {
                                    divName: group.divName,
                                    bunk: "__LEAGUE__",
                                    startTime: group.startTime,
                                    endTime: group.endTime,
                                    slots: group.slots
                                },
                                f,
                                activityProperties,
                                fieldUsageBySlot,
                                sport,
                                true
                            );

                            if (fits) {
                                chosenSport = sport;
                                chosenField = f;
                                break;
                            }
                        }

                        if (chosenField) break;
                    }

                    // Fallback: pick last resort sport
                    if (!chosenField) {
                        chosenSport = orderedSports[0];
                    }

                    recordSportHistory(leagueName, A, chosenSport);
                    recordSportHistory(leagueName, B, chosenSport);

                    if (chosenField) lockedFields.add(chosenField);

                    matchups.push({
                        teamA: A,
                        teamB: B,
                        sport: chosenSport,
                        field: chosenField
                    });
                }

                // ====================================================================
                // BUILD DISPLAY TEXT
                // ====================================================================
                const formattedMatchups = matchups.map(m => {
                    if (m.teamA === "BYE" || m.teamB === "BYE") {
                        return `${m.teamA} vs ${m.teamB}`;
                    }
                    return `${m.teamA} vs ${m.teamB} — ${m.sport} @ ${m.field || "TBD"}`;
                });

                // ====================================================================
                // STORE
                // ====================================================================
                const slotIndex = group.slots[0];
                window.leagueAssignments ??= {};
                window.leagueAssignments[group.divName] ??= {};
                window.leagueAssignments[group.divName][slotIndex] = {
                    gameLabel,
                    startMin: group.startTime,
                    endMin: group.endTime,
                    matchups
                };

                // ====================================================================
                // FILL BLOCKS
                // ====================================================================
                for (const bunk of group.bunks) {
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
                }

                lockedFields.forEach(f => writeLeagueReservationVeto(f, group));
            }

            console.log("=== LEAGUE GENERATOR COMPLETE (GCM TRUE ROTATION) ===");
        } catch (err) {
            console.error("❌ CRITICAL ERROR IN LEAGUE GENERATOR:", err);
        }
    };

    Leagues.processSpecialtyLeagues = function () {};

    window.SchedulerCoreLeagues = Leagues;

})();
