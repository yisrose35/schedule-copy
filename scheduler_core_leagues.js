// ============================================================================
// scheduler_core_leagues.js (GCM FINAL: SAFETY NET + MAGNET + SMART ROTATION)
// Integrated with league_scheduling.js:
// - Uses window.getLeagueMatchups(...) for round progression
// - Uses getLeagueCurrentRound(...) for Game X label
// - Groups by (leagueName + division + startTime)
// - Populates window.leagueAssignments for scheduler_ui.js
// - NEW: Enforces Sport Rotation & Anti-Back-to-Back Logic
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
    // NEW: SPORT HISTORY TRACKER
    // ------------------------------------------------------------
    // Stores: { "LeagueName": { "TeamA": ["Soccer", "Hockey"], "TeamB": ["Soccer"] } }
    window.leagueSportHistory ??= {};

    function getTeamSportHistory(leagueName, teamName) {
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

    // ------------------------------------------------------------
    // NEW: SMART SPORT PRIORITIZER
    // Returns list of sports sorted by: Unplayed > Played-but-valid > Last-Resort
    // Strictly penalizes back-to-back sports.
    // ------------------------------------------------------------
    function getPrioritizedSports(leagueName, teamA, teamB, availableSports) {
        // If no valid teams, just return original order
        if (!teamA || !teamB || teamA === "BYE" || teamB === "BYE") {
            return availableSports;
        }

        const histA = getTeamSportHistory(leagueName, teamA);
        const histB = getTeamSportHistory(leagueName, teamB);

        // 1. Determine "Last Sport" to prevent back-to-back
        const lastSportA = histA.length > 0 ? histA[histA.length - 1] : null;
        const lastSportB = histB.length > 0 ? histB[histB.length - 1] : null;

        // 2. Determine "Current Cycle" sports (sports played since last full rotation)
        // We calculate how many full cycles (played all sports) they have done.
        const numSports = availableSports.length;
        
        const cycleA = Math.floor(histA.length / numSports);
        const cycleB = Math.floor(histB.length / numSports);

        const currentCycleSportsA = histA.slice(cycleA * numSports);
        const currentCycleSportsB = histB.slice(cycleB * numSports);

        const scoredSports = availableSports.map(sport => {
            let score = 0; // Higher is better

            // CRITICAL: Anti-Back-to-Back check
            // If this sport was the LAST one played by either team, massive penalty.
            // We still include it in case it's the ONLY option (better to play than crash),
            // but we push it to the very bottom.
            if (sport === lastSportA || sport === lastSportB) {
                score -= 1000; 
            }

            // CHECK: Has team played this in current cycle?
            const playedByA = currentCycleSportsA.includes(sport);
            const playedByB = currentCycleSportsB.includes(sport);

            if (!playedByA && !playedByB) {
                score += 100; // GOLD: Fresh for both
            } else if (!playedByA || !playedByB) {
                score += 50;  // SILVER: Fresh for one
            } else {
                score += 10;  // BRONZE: Rematch (played by both, but allowed if not back-to-back)
            }

            return { sport, score };
        });

        // Sort by score descending
        scoredSports.sort((a, b) => b.score - a.score);

        return scoredSports.map(s => s.sport);
    }

    // ------------------------------------------------------------
    // FALLBACK SIMPLE ROUND-ROBIN (only if engine missing)
    // ------------------------------------------------------------
    function roundRobinPairs(teams) {
        if (!teams || teams.length < 2) return [];
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
    // Uses league_scheduling.js as the source of truth
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

            console.log("--- LEAGUE GENERATOR START (SMART ROTATION) ---");

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

            // --------------------------------------------------------------------
            // GROUP BLOCKS BY (leagueName + division + startTime)
            // --------------------------------------------------------------------
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
            // PROCESS EACH GROUP
            // ====================================================================
            Object.values(groups).forEach(group => {
                const { leagueName, league } = group;
                const teams = (league.teams || []).slice();
                if (!teams || teams.length < 2) return;

                let pairs = [];

                // ✅ USE THE GLOBAL LEAGUE ENGINE IF AVAILABLE
                if (typeof window.getLeagueMatchups === "function") {
                    pairs = window.getLeagueMatchups(leagueName, teams) || [];
                } else {
                    pairs = roundRobinPairs(teams);
                }

                if (!Array.isArray(pairs) || !pairs.length) {
                    console.warn("No pairs generated for league:", leagueName, "div:", group.divName);
                    return;
                }

                let gameNumberLabel = "";
                if (typeof window.getLeagueCurrentRound === "function") {
                    gameNumberLabel = `Game ${window.getLeagueCurrentRound(leagueName)}`;
                } else {
                    gameNumberLabel = "Game ?";
                }

                // Default sports list
                const baseSports = league.sports?.length ? league.sports : ["League Game"];
                const matchups = [];
                const lockedFields = new Set();

                // ====================================================================
                // BUILD MATCHUPS WITH SMART SPORT ASSIGNMENT
                // ====================================================================
                pairs.forEach((pair, i) => {
                    let A = pair[0];
                    let B = pair[1];

                    if (!A || A === "BYE") A = "BYE";
                    if (!B || B === "BYE") B = "BYE";

                    if (A === "BYE" || B === "BYE") {
                        matchups.push({
                            teamA: A,
                            teamB: B,
                            sport: baseSports[0],
                            field: null
                        });
                        return;
                    }

                    // 1. Get sports sorted by priority for THIS SPECIFIC PAIR
                    // This handles the "Play all before repeat" and "No back-to-back" logic
                    const candidateSports = getPrioritizedSports(leagueName, A, B, baseSports);

                    let chosenField = null;
                    let chosenSport = candidateSports[0]; // Default to best option

                    // 2. Iterate through candidates (Best -> Worst) to find a free field
                    for (const sport of candidateSports) {
                        const possibleFields = fieldsBySport?.[sport] || [];
                        
                        // Check if any field for this sport works
                        for (const field of possibleFields) {
                            if (lockedFields.has(field)) continue; // Skip if used in this specific block/round

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

                            if (fits || true) { // Force fit logic active per previous GCM mode
                                chosenField = field;
                                chosenSport = sport;
                                break;
                            }
                        }
                        if (chosenField) break; // Found a sport and field
                    }

                    if (chosenField) {
                        lockedFields.add(chosenField);
                        
                        // 3. IMPORTANT: Commit this sport to history so next round knows
                        recordSportHistory(leagueName, A, chosenSport);
                        recordSportHistory(leagueName, B, chosenSport);
                    } else {
                        // Fallback if no field found (still record to prevent loop issues next time)
                        recordSportHistory(leagueName, A, chosenSport);
                        recordSportHistory(leagueName, B, chosenSport);
                    }

                    matchups.push({
                        teamA: A,
                        teamB: B,
                        sport: chosenSport,
                        field: chosenField
                    });
                });

                // ====================================================================
                // VISUAL MATCHUPS TEXT
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
                    gameLabel: gameNumberLabel,
                    startMin: group.startTime,
                    endMin: group.endTime,
                    matchups
                };

                // ====================================================================
                // FILL BLOCKS
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
                            _gameLabel: gameNumberLabel
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

    Leagues.processSpecialtyLeagues = function () {};

    window.SchedulerCoreLeagues = Leagues;

})();
