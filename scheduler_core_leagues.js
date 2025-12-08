// ============================================================================
// scheduler_core_leagues.js (GCM FINAL: HOLISTIC MATRIX OPTIMIZATION)
// Integrated with league_scheduling.js
// 1. INVENTORY SCAN: Finds all valid (Sport + Field) combos.
// 2. SCARCITY ANALYSIS: Scores every option for every matchup.
// 3. PRIORITY ASSIGNMENT: Schedules the most restricted teams FIRST.
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
    // SCORING ALGORITHM
    // Returns a numeric score for how good this sport is for these teams.
    // ------------------------------------------------------------
    function calculateOptionScore(option, leagueName, teamA, teamB, totalSportsCount) {
        const sport = option.sport;
        const histA = getTeamSportHistory(leagueName, teamA);
        const histB = getTeamSportHistory(leagueName, teamB);

        const lastSportA = histA.length > 0 ? histA[histA.length - 1] : null;
        const lastSportB = histB.length > 0 ? histB[histB.length - 1] : null;

        // 1. FATAL PENALTY: Back-to-Back (Immediate disqualify in scoring)
        if (sport === lastSportA || sport === lastSportB) {
            return -1000; 
        }

        const cycleA = Math.floor(histA.length / totalSportsCount);
        const cycleB = Math.floor(histB.length / totalSportsCount);
        
        const currentCycleSportsA = histA.slice(cycleA * totalSportsCount);
        const currentCycleSportsB = histB.slice(cycleB * totalSportsCount);

        const playedByA = currentCycleSportsA.includes(sport);
        const playedByB = currentCycleSportsB.includes(sport);

        let score = 0;

        // 2. VARIETY BONUSES
        if (!playedByA && !playedByB) score += 100;      // GOLD: Fresh for both
        else if (!playedByA || !playedByB) score += 50;  // SILVER: Fresh for one
        else score += 10;                                // BRONZE: Repeat

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

            console.log("--- LEAGUE GENERATOR START (HOLISTIC MATRIX) ---");

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

                const proxyDivName = Array.from(group.involvedDivisions)[0] || "League";
                const leagueSports = league.sports || ["League Game"];

                // ----------------------------------------------------------------
                // STEP 1: GLOBAL INVENTORY SCAN
                // Find ALL physically possible (Sport + Field) combos for this time slot
                // ----------------------------------------------------------------
                const globalInventory = [];
                leagueSports.forEach(sport => {
                    const exactSportKey = Object.keys(fieldsBySport || {}).find(k => k.toLowerCase() === sport.toLowerCase());
                    const possibleFields = exactSportKey ? fieldsBySport[exactSportKey] : [];

                    possibleFields.forEach(field => {
                        const fits = window.SchedulerCoreUtils.canBlockFit(
                            {
                                divName: proxyDivName,
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

                        if (fits) {
                            globalInventory.push({ 
                                id: `${sport}-${field}`, // Unique ID for tracking usage
                                sport: sport, 
                                field: field 
                            });
                        }
                    });
                });

                // ----------------------------------------------------------------
                // STEP 2: GET PAIRS (MATCHUPS)
                // ----------------------------------------------------------------
                let pairs = [];
                if (typeof window.getLeagueMatchups === "function") {
                    pairs = window.getLeagueMatchups(leagueName, teams) || [];
                } else {
                    pairs = roundRobinPairs(teams);
                }
                if (!Array.isArray(pairs) || !pairs.length) return;

                // ----------------------------------------------------------------
                // STEP 3: BUILD THE "POSSIBILITY MATRIX"
                // For each pair, calculate scores for ALL available inventory options.
                // ----------------------------------------------------------------
                const matchupData = pairs.map((pair, index) => {
                    const A = pair[0] === "BYE" ? "BYE" : pair[0];
                    const B = pair[1] === "BYE" ? "BYE" : pair[1];

                    if (A === "BYE" || B === "BYE") {
                        return { index, A, B, isBye: true, possibleOptions: [] };
                    }

                    // Score all options in globalInventory for this specific pair
                    const optionsWithScores = globalInventory.map(opt => {
                        const score = calculateOptionScore(opt, leagueName, A, B, leagueSports.length);
                        return { ...opt, score };
                    }).filter(opt => opt.score > -500); // Filter out back-to-back immediately

                    // Sort options BEST to WORST
                    optionsWithScores.sort((a, b) => b.score - a.score);

                    return {
                        index,
                        A,
                        B,
                        isBye: false,
                        possibleOptions: optionsWithScores,
                        flexibility: optionsWithScores.length // Key metric for priority
                    };
                });

                // ----------------------------------------------------------------
                // STEP 4: PRIORITY SORT
                // Sort matchups by Flexibility (Ascending). 
                // Teams with FEWER options get to pick FIRST.
                // ----------------------------------------------------------------
                matchupData.sort((a, b) => {
                    if (a.isBye) return 1; // Byes go last
                    if (b.isBye) return -1;
                    return a.flexibility - b.flexibility;
                });

                // ----------------------------------------------------------------
                // STEP 5: ASSIGNMENT LOOP
                // ----------------------------------------------------------------
                const assignedFields = new Set();
                const finalMatchups = [];

                matchupData.forEach(match => {
                    if (match.isBye) {
                        finalMatchups.push({ teamA: match.A, teamB: match.B, sport: leagueSports[0], field: null });
                        return;
                    }

                    // Find first option where the FIELD is not yet taken
                    const bestAvailable = match.possibleOptions.find(opt => !assignedFields.has(opt.field));

                    if (bestAvailable) {
                        assignedFields.add(bestAvailable.field);
                        recordSportHistory(leagueName, match.A, bestAvailable.sport);
                        recordSportHistory(leagueName, match.B, bestAvailable.sport);
                        
                        finalMatchups.push({
                            teamA: match.A,
                            teamB: match.B,
                            sport: bestAvailable.sport,
                            field: bestAvailable.field
                        });
                    } else {
                        // NO VALID FIELD FOUND (Starvation or total lack of fields)
                        console.warn(`WARNING: Starvation! No fields left for ${match.A} vs ${match.B}`);
                        finalMatchups.push({
                            teamA: match.A,
                            teamB: match.B,
                            sport: "TBD",
                            field: "TBD"
                        });
                    }
                });

                // ----------------------------------------------------------------
                // STEP 6: FORMAT & OUTPUT
                // ----------------------------------------------------------------
                // Re-sort finalMatchups to original pair order if needed, or keep priority order?
                // Usually keeping them in processed order is fine, or we can just list them.
                
                let gameNumberLabel = "";
                if (typeof window.getLeagueCurrentRound === "function") {
                    gameNumberLabel = `Game ${window.getLeagueCurrentRound(leagueName)}`;
                } else {
                    gameNumberLabel = "Game ?";
                }

                const formattedMatchups = finalMatchups.map(m => {
                    if (m.teamA === "BYE" || m.teamB === "BYE") return `${m.teamA} vs ${m.teamB}`;
                    if (m.sport === "TBD" && m.field === "TBD") return `${m.teamA} vs ${m.teamB} — NO FIELDS AVAILABLE`;
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
                        matchups: finalMatchups
                    };
                });

                const lockedFields = finalMatchups.map(m => m.field).filter(f => f && f !== "TBD");

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
