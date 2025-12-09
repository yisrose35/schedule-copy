// ============================================================================
// scheduler_core_leagues.js (COMPLETE - With Concurrency Fix)
// 
// FIXES APPLIED:
// 1. League teams independent of bunks ✅
// 2. Multi-division leagues work correctly ✅
// 3. Field restrictions respected (Strict Mode) ✅
// 4. FIX: Prevents "Double Booking" inside the same loop (New) ✅
//    - Tracks fields assigned within the current calculation cycle
// ============================================================================

(function () {
    'use strict';

    const Leagues = {};

    // =========================================================================
    // HELPER: Team Division Lookup
    // =========================================================================

    function getDivisionForTeam(teamName, context) {
        if (!context.divisions) return null;
        for (const [divName, data] of Object.entries(context.divisions)) {
            if (data.teams && data.teams.includes(teamName)) {
                return divName;
            }
        }
        return null;
    }

    // =========================================================================
    // FIELD RESOLUTION
    // =========================================================================
    
    function getFieldsForSport(sportName, context, divisionNames = [], requireAll = false) {
        let candidateFields = [];
        
        if (context.fieldsBySport && context.fieldsBySport[sportName]) {
            const mappedFields = context.fieldsBySport[sportName];
            const disabledFields = context.disabledFields || [];
            candidateFields = mappedFields.filter(f => !disabledFields.includes(f));
        } else {
            const allFields = context.fields || [];
            const disabledFields = context.disabledFields || [];
            
            candidateFields = allFields
                .filter(f => f.activities && f.activities.includes(sportName))
                .filter(f => !disabledFields.includes(f.name))
                .map(f => f.name);
        }

        // Filter by division restrictions
        if (divisionNames.length > 0) {
            candidateFields = candidateFields.filter(fieldName => 
                isFieldAllowedForDivisions(fieldName, divisionNames, context, requireAll)
            );
        }

        return candidateFields;
    }

    function isFieldAllowedForDivisions(fieldName, divisionNames, context, requireAll = false) {
        const allFields = context.fields || [];
        const field = allFields.find(f => f.name === fieldName);
        
        if (!field) return false;
        if (field.available === false) return false;

        const limitUsage = field.limitUsage || { enabled: false };
        if (!limitUsage.enabled) return true;

        const allowedDivisions = Object.keys(limitUsage.divisions || {});
        
        if (requireAll) {
            // STRICT: Must be allowed for ALL listed divisions
            return divisionNames.every(divName => allowedDivisions.includes(divName));
        } else {
            // LOOSE: Must be allowed for AT LEAST ONE division
            return divisionNames.some(divName => allowedDivisions.includes(divName));
        }
    }

    function canFieldHostLeague(fieldName, block, context) {
        const { activityProperties, fieldUsageBySlot } = context;
        return window.SchedulerCoreUtils.canLeagueGameFit(
            block,
            fieldName,
            fieldUsageBySlot,
            activityProperties
        );
    }

    // =========================================================================
    // MATCHUP GENERATION
    // =========================================================================

    function generateRoundRobinSchedule(teams) {
        if (teams.length < 2) return [];
        
        const schedule = [];
        const n = teams.length;
        const isOdd = n % 2 === 1;
        
        const workingTeams = isOdd ? [...teams, 'BYE'] : [...teams];
        const rounds = workingTeams.length - 1;

        for (let round = 0; round < rounds; round++) {
            const roundMatches = [];
            for (let i = 0; i < workingTeams.length / 2; i++) {
                const home = workingTeams[i];
                const away = workingTeams[workingTeams.length - 1 - i];
                if (home !== 'BYE' && away !== 'BYE') {
                    roundMatches.push([home, away]);
                }
            }
            schedule.push(roundMatches);
            const last = workingTeams.pop();
            workingTeams.splice(1, 0, last);
        }
        return schedule;
    }

    function getCurrentRoundIndex(leagueName, context) {
        const state = window.leagueRoundState || {};
        const leagueState = state[leagueName] || { currentRound: 0 };
        return leagueState.currentRound || 0;
    }

    function getMatchupsForLeague(league, context) {
        const teams = league.teams || [];
        if (teams.length < 2) return [];
        const fullSchedule = generateRoundRobinSchedule(teams);
        const roundIndex = getCurrentRoundIndex(league.name, context);
        return fullSchedule[roundIndex % fullSchedule.length] || [];
    }

    // =========================================================================
    // SPECIALTY LEAGUES
    // =========================================================================

    Leagues.processSpecialtyLeagues = function (context) {
        console.log("=== SPECIALTY LEAGUE ENGINE START ===");
        
        const { 
            schedulableSlotBlocks, masterSpecialtyLeagues, disabledSpecialtyLeagues,
            activityProperties, fieldUsageBySlot, fillBlock
        } = context;

        if (!masterSpecialtyLeagues) return;

        const blocksByDivisionTime = {};
        schedulableSlotBlocks
            .filter(b => b.type === 'specialty_league')
            .forEach(block => {
                const key = `${block.divName}_${block.startTime}`;
                if (!blocksByDivisionTime[key]) blocksByDivisionTime[key] = [];
                blocksByDivisionTime[key].push(block);
            });

        for (const [key, blocks] of Object.entries(blocksByDivisionTime)) {
            const [divName, startTime] = key.split('_');
            
            const league = Object.values(masterSpecialtyLeagues).find(l => {
                if (disabledSpecialtyLeagues.includes(l.name)) return false;
                if (!l.divisions || !l.divisions.includes(divName)) return false;
                return true;
            });

            if (!league) continue;

            const matchups = getMatchupsForLeague(league, context);
            const leagueSport = league.sport || (league.sports && league.sports[0]) || "General";
            const availableFields = getFieldsForSport(leagueSport, context, [divName], true);

            const matchupAssignments = [];
            const reservedFieldsThisSlot = new Set(); // ✅ Prevent double booking
            let fieldIdx = 0;

            matchups.forEach((matchup) => {
                const [team1, team2] = matchup;
                let assignedField = null;
                const testBlock = blocks[0];
                
                for (let i = 0; i < availableFields.length; i++) {
                    const testField = availableFields[(fieldIdx + i) % availableFields.length];
                    
                    // Check global usage AND local usage
                    if (!reservedFieldsThisSlot.has(testField) && canFieldHostLeague(testField, testBlock, context)) {
                        assignedField = testField;
                        reservedFieldsThisSlot.add(testField); // ✅ Mark as used immediately
                        fieldIdx = (fieldIdx + i + 1) % availableFields.length;
                        break;
                    }
                }

                if (assignedField) {
                    matchupAssignments.push({
                        matchup: `${team1} vs ${team2}`,
                        field: assignedField,
                        sport: leagueSport
                    });
                }
            });

            blocks.forEach(block => {
                const pick = {
                    field: `Specialty League: ${league.name}`,
                    sport: leagueSport,
                    _activity: `Specialty League: ${league.name}`,
                    _h2h: true,
                    _fixed: true,
                    _allMatchups: matchupAssignments.map(m => `${m.matchup} @ ${m.field} (${m.sport})`),
                    _gameLabel: `Specialty League`
                };
                fillBlock(block, pick, fieldUsageBySlot, {}, true, activityProperties);
                block.processed = true;
            });
        }
    };

    // =========================================================================
    // REGULAR LEAGUES (UPDATED)
    // =========================================================================

    Leagues.processRegularLeagues = function (context) {
        console.log("=== UNIFIED LEAGUE ENGINE START ===");
        
        const { 
            schedulableSlotBlocks, masterLeagues, disabledLeagues,
            fillBlock, fieldUsageBySlot, activityProperties, rotationHistory
        } = context;

        if (!masterLeagues) return;

        const blocksByTime = {};
        schedulableSlotBlocks
            .filter(b => b.type === 'league' || /league/i.test(b.event))
            .forEach(block => {
                const key = block.startTime;
                if (!blocksByTime[key]) blocksByTime[key] = { byDivision: {}, allBlocks: [] };
                if (!blocksByTime[key].byDivision[block.divName]) blocksByTime[key].byDivision[block.divName] = [];
                blocksByTime[key].byDivision[block.divName].push(block);
                blocksByTime[key].allBlocks.push(block);
            });

        for (const [timeKey, timeData] of Object.entries(blocksByTime)) {
            const divisionNames = Object.keys(timeData.byDivision);
            
            const league = Object.values(masterLeagues).find(l => {
                if (!l.enabled) return false;
                if (disabledLeagues.includes(l.name)) return false;
                if (!l.divisions || l.divisions.length === 0) return false;
                return divisionNames.some(div => l.divisions.includes(div));
            });

            if (!league) continue;

            const matchups = getMatchupsForLeague(league, context);
            if (matchups.length === 0) continue;

            const leagueSports = league.sports || ["General Sport"];
            const matchupAssignments = [];
            
            // ✅ KEY FIX: Local Reservation Set for this time slot
            const reservedFieldsThisSlot = new Set(); 
            
            let globalFieldIdx = 0;
            const gameNumber = getCurrentRoundIndex(league.name, context) + 1;

            matchups.forEach((matchup, idx) => {
                const [team1, team2] = matchup;
                const selectedSport = leagueSports[idx % leagueSports.length];
                
                // Determine divisions for these specific teams
                const div1 = getDivisionForTeam(team1, context);
                const div2 = getDivisionForTeam(team2, context);
                
                const gameDivisions = [];
                if (div1) gameDivisions.push(div1);
                if (div2 && div2 !== div1) gameDivisions.push(div2);
                
                // If lookup fails, fallback to general league divisions
                const divsToCheck = gameDivisions.length > 0 ? gameDivisions : divisionNames;

                // Get fields strictly for THESE divisions
                const validFieldsForGame = getFieldsForSport(selectedSport, context, divsToCheck, true);

                let assignedField = null;
                const testBlock = timeData.allBlocks[0]; 
                
                for (let i = 0; i < validFieldsForGame.length; i++) {
                    const testField = validFieldsForGame[(globalFieldIdx + i) % validFieldsForGame.length];
                    
                    // ✅ CHECK RESERVED SET
                    if (!reservedFieldsThisSlot.has(testField) && canFieldHostLeague(testField, testBlock, context)) {
                        assignedField = testField;
                        reservedFieldsThisSlot.add(testField); // ✅ RESERVE IMMEDIATELY
                        globalFieldIdx = (globalFieldIdx + 1); 
                        break;
                    }
                }

                if (assignedField) {
                    matchupAssignments.push({
                        matchup: `${team1} vs ${team2}`,
                        field: assignedField,
                        sport: selectedSport
                    });
                    
                    console.log(`   ✅ ${team1} vs ${team2} @ ${assignedField} (${selectedSport})`);

                    if (rotationHistory && rotationHistory.leagues) {
                        const key = [team1, team2].sort().join("|");
                        const leagueKey = `${league.name}|${key}`;
                        if (!rotationHistory.leagues[leagueKey]) {
                            rotationHistory.leagues[leagueKey] = [];
                        }
                        rotationHistory.leagues[leagueKey].push({
                            date: window.currentScheduleDate,
                            sport: selectedSport,
                            field: assignedField
                        });
                    }
                } else {
                    console.log(`   ❌ No valid field for ${team1} vs ${team2}`);
                }
            });

            // Assign to blocks
            divisionNames.forEach(divName => {
                const blocksForDiv = timeData.byDivision[divName];
                blocksForDiv.forEach(block => {
                    const pick = {
                        field: `League: ${league.name}`,
                        sport: `Game ${gameNumber}`,
                        _activity: `League: ${league.name}`,
                        _h2h: true,
                        _fixed: true,
                        _allMatchups: matchupAssignments.map(m => 
                            `${m.matchup} @ ${m.field} (${m.sport})`
                        ),
                        _gameLabel: `Game ${gameNumber}`
                    };
                    fillBlock(block, pick, fieldUsageBySlot, {}, true, activityProperties);
                    block.processed = true;
                });
            });

            if (!window.leagueRoundState) window.leagueRoundState = {};
            if (!window.leagueRoundState[league.name]) {
                window.leagueRoundState[league.name] = { currentRound: 0 };
            }
            window.leagueRoundState[league.name].currentRound++;
        }
        
        console.log("=== UNIFIED LEAGUE ENGINE COMPLETE ===");
    };

    // Export
    window.SchedulerCoreLeagues = Leagues;

})();
