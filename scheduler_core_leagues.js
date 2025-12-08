// ============================================================================
// scheduler_core_leagues.js (GCM FINAL: INVENTORY FIRST ARCHITECTURE)
// Integrated with league_scheduling.js
// 1. INVENTORY SCAN: Finds all valid (Sport + Field) combos FIRST.
// 2. MATCHUP LOGIC: Assigns best available option to teams based on history.
// ============================================================================

(function () {
    'use strict';

    const Leagues = {};

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
        if (!teamName || teamName === "BYE" || !sport || sport === "TBD") return;
        window.leagueSportHistory[leagueName] ??= {};
        window.leagueSportHistory[leagueName][teamName] ??= [];
        window.leagueSportHistory[leagueName][teamName].push(sport);
    }

    // ------------------------------------------------------------
    // SCORING ALGORITHM (Prioritizes the Inventory List)
    // ------------------------------------------------------------
    function scoreOptionForMatchup(option, leagueName, teamA, teamB, totalSportsCount) {
        // option = { sport: "Soccer", field: "Field 1" }
        const sport = option.sport;
        
        const histA = getTeamSportHistory(leagueName, teamA);
        const histB = getTeamSportHistory(leagueName, teamB);

        const lastSportA = histA.length > 0 ? histA[histA.length - 1] : null;
        const lastSportB = histB.length > 0 ? histB[histB.length - 1] : null;

        // 1. FATAL PENALTY: Back-to-Back (The same sport they just played)
        if (sport === lastSportA || sport === lastSportB) {
            return -1000; 
        }

        // 2. CYCLE CHECK: Have they played this recently?
        // We look at the "current cycle" (e.g., last X games where X = number of sports)
        const cycleA = Math.floor(histA.length / totalSportsCount);
        const cycleB = Math.floor(histB.length / totalSportsCount);
        
        const currentCycleSportsA = histA.slice(cycleA * totalSportsCount);
        const currentCycleSportsB = histB.slice(cycleB * totalSportsCount);

        const playedByA = currentCycleSportsA.includes(sport);
        const playedByB = currentCycleSportsB.includes(sport);

        let score = 0;

        if (!playedByA && !playedByB) score += 100;      // GOLD: Fresh for both
        else if (!playedByA || !playedByB) score += 50;  // SILVER: Fresh for one
        else score += 10;                                // BRONZE: Repeat (but valid)

        return score;
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
    // MAIN PROCESS
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

            console.log("--- LEAGUE GENERATOR START (INVENTORY FIRST) ---");

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
            // GROUP BY (LEAGUE + TIME)
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

                // 1. Define Proxy Identity (Div & Bunk) for Permissions
                const proxyDivName = Array.from(group.involvedDivisions)[0] || "League";

                // 2. INVENTORY SCAN: Build the "Menu" of valid options
                const validOptions = [];
                const leagueSports = league.sports || ["League Game"];

                leagueSports.forEach(sport => {
                    // Case-insensitive lookup
                    const exactSportKey = Object.keys(fieldsBySport || {}).find(k => k.toLowerCase() === sport.toLowerCase());
                    const possibleFields = exactSportKey ? fieldsBySport[exactSportKey] : [];

                    possibleFields.forEach(field => {
                        // STRICT VALIDATION: Is this field ACTUALLY available right now?
                        const fits = window.SchedulerCoreUtils.canBlockFit(
                            {
                                divName: proxyDivName,
                                bunk: "__LEAGUE__", // Use generic identity
                                startTime: group.startTime,
                                endTime: group.endTime,
                                slots: group.slots
                            },
                            field,
                            activityProperties,
                            fieldUsageBySlot,
                            sport,
                            true // Strict Mode
                        );

                        if (fits) {
                            validOptions.push({ sport: sport, field: field });
                        }
                    });
                });

                // 3. GET TEAM PAIRS
                let pairs = [];
                if (typeof window.getLeagueMatchups === "function") {
                    pairs = window.getLeagueMatchups(leagueName, teams) || [];
                } else {
                    pairs = roundRobinPairs(teams);
                }
                if (!Array.isArray(pairs) || !pairs.length) return;

                // 4. GET GAME LABEL
                let gameNumberLabel = "";
                if (typeof window.getLeagueCurrentRound === "function") {
                    gameNumberLabel = `Game ${window.getLeagueCurrentRound(leagueName)}`;
                } else {
                    gameNumberLabel = "Game ?";
                }

                const matchups = [];
                
                // 5. ASSIGN OPTIONS TO PAIRS
                pairs.forEach(pair => {
                    let A = pair[0];
                    let B = pair[1];

                    if (!A || A === "BYE") A = "BYE";
                    if (!B || B === "BYE") B = "BYE";

                    if (A === "BYE" || B === "BYE") {
                        matchups.push({
                            teamA: A, teamB: B, sport: leagueSports[0], field: null
                        });
                        return;
                    }

                    // Filter out options whose FIELDS are already taken by previous pairs in this loop
                    // (We don't need to check external usage because the Inventory Scan already did that)
                    const currentlyAvailable = validOptions.filter(opt => 
                        !matchups.some(m => m.field === opt.field)
                    );

                    let bestOption = null;
                    let bestScore = -9999;

                    if (currentlyAvailable.length > 0) {
                        // Score every available option for THIS specific matchup
                        currentlyAvailable.forEach(option => {
                            const score = scoreOptionForMatchup(option, leagueName, A, B, leagueSports.length);
                            if (score > bestScore) {
                                bestScore = score;
                                bestOption = option;
                            }
                        });
                    }

                    // Fallback
                    const finalSport = bestOption ? bestOption.sport : "TBD";
                    const finalField = bestOption ? bestOption.field : "TBD";

                    // Record History (only if valid)
                    if (bestOption) {
                        recordSportHistory(leagueName, A, finalSport);
                        recordSportHistory(leagueName, B, finalSport);
                    } else {
                        console.warn(`WARNING: No valid options left for ${A} vs ${B}`);
                    }

                    matchups.push({
                        teamA: A,
                        teamB: B,
                        sport: finalSport,
                        field: finalField
                    });
                });

                // ====================================================================
                // FORMAT & STORE
                // ====================================================================
                const formattedMatchups = matchups.map(m => {
                    if (m.teamA === "BYE" || m.teamB === "BYE") return `${m.teamA} vs ${m.teamB}`;
                    
                    if (m.sport === "TBD" && m.field === "TBD") {
                        return `${m.teamA} vs ${m.teamB} — NO FIELDS AVAILABLE`;
                    }
                    return `${m.teamA} vs ${m.teamB} — ${m.sport} @ ${m.field}`;
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
                const lockedFields = matchups.map(m => m.field).filter(f => f && f !== "TBD");

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

                // Lock fields globally for this block
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
