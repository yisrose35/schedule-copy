// ============================================================================
// scheduler_core_leagues.js (GCM FINAL: UNIFIED DIVS + STRICT RULE RESPECT)
// Integrated with league_scheduling.js:
// - Uses window.getLeagueMatchups(...) for round progression
// - Groups by (leagueName + startTime) -> MERGES DIVISIONS
// - RESPECTS DAILY ADJUSTMENTS (No Force Overrides)
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
        const divLabel = Array.from(block.involvedDivisions)[0] || "League";
        const exists = window.fieldReservationLog[field].some(
            r => r.bunk === "__LEAGUE_VETO__" && r.startMin === block.startTime
        );
        if (!exists) {
            window.fieldReservationLog[field].push({
                bunk: "__LEAGUE_VETO__",
                divName: divLabel,
                startMin: block.startTime,
                endMin: block.endTime,
                exclusive: true,
                reason: "League Field Lock"
            });
        }
    }

    // ------------------------------------------------------------
    // SPORT HISTORY TRACKER
    // ------------------------------------------------------------
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
    // SMART SPORT PRIORITIZER
    // ------------------------------------------------------------
    function getPrioritizedSports(leagueName, teamA, teamB, availableSports) {
        if (!teamA || !teamB || teamA === "BYE" || teamB === "BYE") {
            return availableSports;
        }

        const histA = getTeamSportHistory(leagueName, teamA);
        const histB = getTeamSportHistory(leagueName, teamB);

        const lastSportA = histA.length > 0 ? histA[histA.length - 1] : null;
        const lastSportB = histB.length > 0 ? histB[histB.length - 1] : null;

        const numSports = availableSports.length;
        const cycleA = Math.floor(histA.length / numSports);
        const cycleB = Math.floor(histB.length / numSports);

        const currentCycleSportsA = histA.slice(cycleA * numSports);
        const currentCycleSportsB = histB.slice(cycleB * numSports);

        const scoredSports = availableSports.map(sport => {
            let score = 0; 
            
            // PENALTY: Back-to-Back (Last Resort)
            if (sport === lastSportA || sport === lastSportB) score -= 1000; 

            const playedByA = currentCycleSportsA.includes(sport);
            const playedByB = currentCycleSportsB.includes(sport);

            // BONUS: Freshness
            if (!playedByA && !playedByB) score += 100;      // Gold
            else if (!playedByA || !playedByB) score += 50;  // Silver
            else score += 10;                                // Bronze

            return { sport, score };
        });

        scoredSports.sort((a, b) => b.score - a.score);
        return scoredSports.map(s => s.sport);
    }

    // ------------------------------------------------------------
    // UTILS
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

            console.log("--- LEAGUE GENERATOR START (STRICT RULES) ---");

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
            // GROUP BY (LEAGUE + TIME) -> Unified Divisions
            // --------------------------------------------------------------------
            const groups = {};
            leagueBlocks.forEach(block => {
                const lgEntry = Object.entries(masterLeagues).find(([name, L]) => {
                    if (!L.enabled || disabledLeagues.includes(name)) return false;
                    return L.divisions && L.divisions.some(d => isDivisionMatch(block.divName, d));
                });
                if (!lgEntry) return;

                const [leagueName, league] = lgEntry;
                const key = `${leagueName}-${block.startTime}`;

                groups[key] ??= {
                    leagueName,
                    league,
                    involvedDivisions: new Set(),
                    startTime: block.startTime,
                    endTime: block.endTime,
                    slots: block.slots,
                    bunkData: []
                };
                
                groups[key].involvedDivisions.add(block.divName);
                groups[key].bunkData.push({ 
                    bunk: block.bunk, 
                    divName: block.divName 
                });
            });

            // ====================================================================
            // PROCESS EACH GROUP
            // ====================================================================
            Object.values(groups).forEach(group => {
                const { leagueName, league } = group;
                const teams = (league.teams || []).slice();
                if (!teams || teams.length < 2) return;

                // 1. Get Pairs
                let pairs = [];
                if (typeof window.getLeagueMatchups === "function") {
                    pairs = window.getLeagueMatchups(leagueName, teams) || [];
                } else {
                    pairs = roundRobinPairs(teams);
                }

                if (!Array.isArray(pairs) || !pairs.length) return;

                // 2. Get Label
                let gameNumberLabel = "";
                if (typeof window.getLeagueCurrentRound === "function") {
                    gameNumberLabel = `Game ${window.getLeagueCurrentRound(leagueName)}`;
                } else {
                    gameNumberLabel = "Game ?";
                }

                const baseSports = league.sports?.length ? league.sports : ["League Game"];
                const matchups = [];
                const lockedFields = new Set(); 

                // ====================================================================
                // ASSIGN SPORTS & FIELDS
                // ====================================================================
                pairs.forEach((pair) => {
                    let A = pair[0];
                    let B = pair[1];

                    if (!A || A === "BYE") A = "BYE";
                    if (!B || B === "BYE") B = "BYE";

                    if (A === "BYE" || B === "BYE") {
                        matchups.push({
                            teamA: A, teamB: B, sport: baseSports[0], field: null
                        });
                        return;
                    }

                    // 1. Sort Sports by Preference
                    const candidateSports = getPrioritizedSports(leagueName, A, B, baseSports);
                    
                    let chosenField = null;
                    let chosenSport = candidateSports[0]; 

                    // 2. FIND FIRST VALID FIELD
                    for (const sport of candidateSports) {
                        const possibleFields = fieldsBySport?.[sport] || [];
                        
                        for (const field of possibleFields) {
                            if (lockedFields.has(field)) continue; 

                            // STRICT CHECK: Verify field is physically available
                            const fits = window.SchedulerCoreUtils.canBlockFit(
                                {
                                    divName: Array.from(group.involvedDivisions)[0],
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

                            // 🛑 FIXED: Removed "|| true" override. 
                            // Now strictly enforces daily adjustments/exclusions.
                            if (fits) { 
                                chosenField = field;
                                chosenSport = sport;
                                break; 
                            }
                        }
                        if (chosenField) break; 
                    }

                    if (chosenField) {
                        lockedFields.add(chosenField);
                    }
                    
                    recordSportHistory(leagueName, A, chosenSport);
                    recordSportHistory(leagueName, B, chosenSport);

                    matchups.push({
                        teamA: A, teamB: B, sport: chosenSport, field: chosenField
                    });
                });

                // ====================================================================
                // STORE DATA
                // ====================================================================
                const formattedMatchups = matchups.map(m => {
                    if (m.teamA === "BYE" || m.teamB === "BYE") return `${m.teamA} vs ${m.teamB}`;
                    return `${m.teamA} vs ${m.teamB} — ${m.sport} @ ${m.field || "TBD"}`;
                });

                window.leagueAssignments ??= {};
                const slotIndex = group.slots[0];
                
                group.involvedDivisions.forEach(divName => {
                    window.leagueAssignments[divName] ??= {};
                    window.leagueAssignments[divName][slotIndex] = {
                        gameLabel: gameNumberLabel,
                        startMin: group.startTime,
                        endMin: group.endTime,
                        matchups
                    };
                });

                // ====================================================================
                // FILL BUNKS
                // ====================================================================
                group.bunkData.forEach(item => {
                    fillBlock(
                        {
                            divName: item.divName,
                            bunk: item.bunk,
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
