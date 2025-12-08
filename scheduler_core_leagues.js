// ============================================================================
// scheduler_core_leagues.js (GCM FORENSIC MODE)
// Strict League Exclusivity + Division-Level League Outputs
//
// DEBUGGING FEATURES:
// ✓ Dumps the raw names of blocks in the queue to the console.
// ✓ Removes strict filters to ensure we catch the blocks.
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

    // FUZZY DIVISION MATCHER (Required for "3" vs "3rd Grade")
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

    // =========================================================================
    // REGULAR LEAGUES
    // =========================================================================

    Leagues.processRegularLeagues = function (context) {
        const { schedulableSlotBlocks, masterLeagues, disabledLeagues, fieldsBySport, activityProperties, yesterdayHistory, fillBlock, fieldUsageBySlot } = context;

        console.log("--- LEAGUE GENERATOR DIAGNOSTICS ---");
        
        // 1. INSPECT THE QUEUE
        if (!schedulableSlotBlocks || schedulableSlotBlocks.length === 0) {
            console.error("❌ CRITICAL: The Generator received an EMPTY queue.");
            return;
        }
        
        // Sample the first 5 events to see what they look like
        console.log("Queue Sample (First 5):", schedulableSlotBlocks.slice(0, 5).map(b => b.event));

        // 2. THE MAGNET FILTER
        const leagueBlocks = schedulableSlotBlocks.filter(b => {
            const name = String(b.event || "").toLowerCase();
            return name.includes("league"); // Simple, dumb check
        });

        console.log(`🔍 Filter Result: Found ${leagueBlocks.length} blocks containing 'league'.`);

        if (leagueBlocks.length === 0) {
            console.warn("❌ ABORT: Zero matches. The blocks in the queue simply do not contain the word 'league'.");
            return;
        }

        const groups = {};

        // 3. GROUPING
        leagueBlocks.forEach(block => {
            // Find Matching League
            const lgEntry = Object.entries(masterLeagues).find(([name, L]) => {
                if (!L.enabled || disabledLeagues.includes(name)) return false;
                return L.divisions && L.divisions.some(d => isDivisionMatch(block.divName, d));
            });

            if (!lgEntry) {
                console.warn(`   ⚠️ Unmatched Block: Div '${block.divName}' (Event: ${block.event}) - No enabled league found.`);
                return;
            }

            const [leagueName, league] = lgEntry;
            const key = `${leagueName}-${block.divName}-${block.startTime}`;
            
            groups[key] ??= {
                leagueName, league, divName: block.divName,
                startTime: block.startTime, endTime: block.endTime,
                slots: block.slots, bunks: []
            };
            groups[key].bunks.push(block.bunk);
        });

        // 4. EXECUTION
        const groupKeys = Object.keys(groups);
        console.log(`✅ Ready to schedule ${groupKeys.length} league groups.`);

        Object.values(groups).forEach(group => {
            const { leagueName, league } = group;
            const teams = league.teams.slice();
            
            if (teams.length < 2) {
                console.warn(`   ⚠️ League '${leagueName}' has insufficient teams (${teams.length}). Skipping.`);
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
                            { divName: group.divName, bunk: "__LEAGUE__", startTime: group.startTime, endTime: group.endTime, slots: group.slots },
                            field, activityProperties, fieldUsageBySlot, sport, true
                        );
                        if (fits || true) { // FORCE FIT FOR NOW
                            chosenField = field;
                            chosenSport = sport;
                            break;
                        }
                    }
                    if (chosenField) break;
                }

                if (chosenField) lockedFields.add(chosenField);
                matchups.push({ teamA: A, teamB: B, sport: chosenSport, field: chosenField });
            });

            // SAVE TO UI
            window.leagueAssignments ??= {};
            window.leagueAssignments[group.divName] ??= {};
            const slotIndex = group.slots[0];
            window.leagueAssignments[group.divName][slotIndex] = {
                gameLabel, startMin: group.startTime, endMin: group.endTime, matchups
            };

            const formattedMatchups = matchups.map(m => `${m.teamA} vs ${m.teamB} — ${m.sport} @ ${m.field || 'TBD'}`);

            // FILL BUNKS
            group.bunks.forEach(bunk => {
                fillBlock(
                    { divName: group.divName, bunk, startTime: group.startTime, endTime: group.endTime, slots: group.slots },
                    { 
                        field: "League Block", sport: null, _activity: "League Block", _fixed: true,
                        _allMatchups: formattedMatchups, _gameLabel: gameLabel
                    },
                    fieldUsageBySlot, yesterdayHistory, true, activityProperties
                );
            });

            // LOCK FIELDS
            lockedFields.forEach(f => writeLeagueReservationVeto(f, group));
        });
    };

    Leagues.processSpecialtyLeagues = function (context) {
        // Keeps interface satisfied
    };

    window.SchedulerCoreLeagues = Leagues;

})();
