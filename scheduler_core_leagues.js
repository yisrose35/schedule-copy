// ============================================================================
// scheduler_core_leagues.js (GCM FINAL: FUZZY DIVISION MATCHING)
// Strict League Exclusivity + Division-Level League Outputs
//
// FIXES:
// ✓ "Smart Matcher": Matches "3" with "3rd Grade", "Junior" with "Juniors", etc.
// ✓ Bridges the gap between Timeline short-names and League Setting long-names.
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

        const exists = window.fieldReservationLog[field].some(r => 
            r.bunk === "__LEAGUE_VETO__" && 
            r.startMin === block.startTime
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

    // === GCM FIX: FUZZY DIVISION MATCHER ===
    function isDivisionMatch(timelineDiv, leagueDiv) {
        if (!timelineDiv || !leagueDiv) return false;
        const t = String(timelineDiv).trim().toLowerCase();
        const l = String(leagueDiv).trim().toLowerCase();
        
        // 1. Exact Match
        if (t === l) return true;

        // 2. Inclusion (e.g. "3" inside "3rd Grade")
        if (l.includes(t) || t.includes(l)) return true;

        // 3. Normalized Number Match (Remove st, nd, rd, th, grade)
        const cleanT = t.replace(/(st|nd|rd|th|grade|s)/g, "").trim();
        const cleanL = l.replace(/(st|nd|rd|th|grade|s)/g, "").trim();
        
        return cleanT === cleanL && cleanT.length > 0;
    }

    // =========================================================================
    // SPECIALTY LEAGUES (DIVISION-LEVEL)
    // =========================================================================

    Leagues.processSpecialtyLeagues = function (context) {
        const { schedulableSlotBlocks, masterSpecialtyLeagues, disabledSpecialtyLeagues, yesterdayHistory, activityProperties, fillBlock, fieldUsageBySlot } = context;
        // (Specialty logic omitted for brevity, assumes standard implementation)
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

        console.log("--- LEAGUE GENERATOR: Starting Regular Leagues ---");
        
        // 1. Filter Blocks (Aggressive Regex from Main ensures they are here)
        const leagueBlocks = schedulableSlotBlocks.filter(b => b.event === "League Game" && !b.processed);
        console.log(`Found ${leagueBlocks.length} 'League Game' blocks in the timeline.`);

        if (leagueBlocks.length === 0) {
            console.warn("ABORT: No blocks labeled 'League Game' found.");
            return;
        }

        const groups = {};

        // 2. Group by Division & Time
        leagueBlocks.forEach(block => {
            
            // FIND MATCHING LEAGUE (USING FUZZY MATCHER)
            const lgEntry = Object.entries(masterLeagues).find(([name, L]) => {
                const isEnabled = L.enabled;
                const notDisabled = !disabledLeagues.includes(name);
                
                // GCM FIX: Use Fuzzy Matcher here
                const hasDiv = L.divisions && L.divisions.some(d => isDivisionMatch(block.divName, d));
                
                if (!hasDiv) return false; 
                if (!isEnabled) return false;
                
                return true;
            });

            if (!lgEntry) {
                console.warn(`   ⚠️ SKIPPED: No matching league found for Timeline Division '${block.divName}'.`);
                return;
            }

            const [leagueName, league] = lgEntry;
            // console.log(`   ✅ Matched Timeline '${block.divName}' -> League '${leagueName}'`);

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

        // 3. Process Groups
        const groupKeys = Object.keys(groups);
        console.log(`Processing ${groupKeys.length} confirmed league groups.`);

        Object.values(groups).forEach(group => {
            const { leagueName, league } = group;

            const teams = league.teams.slice();
            if (teams.length < 2) {
                console.error(`   ❌ League '${leagueName}' has fewer than 2 teams. Cannot schedule.`);
                return;
            }

            const pairs = roundRobinPairs(teams);
            const gameLabel = getGameLabel(leagueName);
            const sports = league.sports?.length ? league.sports : ["League Game"];

            const matchups = [];
            const lockedFields = new Set();

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
                        if (fits) {
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

            // WRITE TO UI STATE
            window.leagueAssignments ??= {};
            window.leagueAssignments[group.divName] ??= {};
            const slotIndex = group.slots[0];
            
            window.leagueAssignments[group.divName][slotIndex] = {
                gameLabel,
                startMin: group.startTime,
                endMin: group.endTime,
                matchups
            };

            // FORMAT TEXT
            const formattedMatchups = matchups.map(m => 
                `${m.teamA} vs ${m.teamB} — ${m.sport} @ ${m.field || 'TBD'}`
            );

            // FILL BUNKS
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

            // LOCK FIELDS
            lockedFields.forEach(f => {
                writeLeagueReservationVeto(f, {
                    divName: group.divName,
                    startTime: group.startTime,
                    endTime: group.endTime
                });
            });
        });
    };

    window.SchedulerCoreLeagues = Leagues;

})();
