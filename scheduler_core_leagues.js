// ============================================================================
// scheduler_core_leagues.js (COMPLETE REWRITE - Teams ≠ Bunks)
// 
// CRITICAL CHANGES:
// 1. League teams are independent entities (not tied to bunk names)
// 2. Multi-division leagues show same matchups to all divisions
// 3. Schedule displays all matchups with field/sport information
// ============================================================================

(function () {
    'use strict';

    const Leagues = {};
    const LEAGUE_WEIGHT = 2;

    // =========================================================================
    // FIELD RESOLUTION
    // =========================================================================
    
    function getFieldsForSport(sportName, context) {
        if (context.fieldsBySport && context.fieldsBySport[sportName]) {
            const mappedFields = context.fieldsBySport[sportName];
            const disabledFields = context.disabledFields || [];
            return mappedFields.filter(f => !disabledFields.includes(f));
        }

        const allFields = context.fields || [];
        const disabledFields = context.disabledFields || [];
        
        return allFields
            .filter(f => f.activities && f.activities.includes(sportName))
            .filter(f => !disabledFields.includes(f.name))
            .map(f => f.name);
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
            schedulableSlotBlocks, 
            masterSpecialtyLeagues, 
            disabledSpecialtyLeagues,
            activityProperties,
            fieldUsageBySlot,
            fillBlock,
            divisions
        } = context;

        if (!masterSpecialtyLeagues || Object.keys(masterSpecialtyLeagues).length === 0) {
            console.log("No specialty leagues configured.");
            return;
        }

        const blocksByDivisionTime = {};
        
        schedulableSlotBlocks
            .filter(b => b.type === 'specialty_league')
            .forEach(block => {
                const key = `${block.divName}_${block.startTime}`;
                if (!blocksByDivisionTime[key]) {
                    blocksByDivisionTime[key] = [];
                }
                blocksByDivisionTime[key].push(block);
            });

        for (const [key, blocks] of Object.entries(blocksByDivisionTime)) {
            const [divName, startTime] = key.split('_');
            
            const league = Object.values(masterSpecialtyLeagues).find(l => {
                if (disabledSpecialtyLeagues.includes(l.name)) return false;
                if (!l.divisions || !l.divisions.includes(divName)) return false;
                return true;
            });

            if (!league) {
                console.log(`⚠️ No specialty league for ${divName} at ${startTime}`);
                continue;
            }

            console.log(`\n📋 Specialty League: "${league.name}" (${divName})`);

            const matchups = getMatchupsForLeague(league, context);
            if (matchups.length === 0) {
                console.log(`   No matchups for ${league.name}`);
                continue;
            }

            const leagueSport = league.sport || (league.sports && league.sports[0]) || "General";
            const availableFields = getFieldsForSport(leagueSport, context);

            console.log(`   Sport: ${leagueSport}`);
            console.log(`   Available fields: [${availableFields.join(", ")}]`);
            console.log(`   Matchups: ${matchups.length}, Blocks: ${blocks.length}`);

            if (availableFields.length === 0) {
                console.log(`   ⚠️ No fields available for ${leagueSport}`);
                continue;
            }

            // ✅ NEW: Assign ALL matchups to ALL bunks in division
            const divisionBunks = divisions[divName]?.bunks || [];
            const allMatchupsText = matchups.map(m => `${m[0]} vs ${m[1]}`);
            
            let fieldIdx = 0;
            const matchupAssignments = [];

            matchups.forEach((matchup, idx) => {
                const [team1, team2] = matchup;
                
                // Try to find a field
                let assignedField = null;
                const testBlock = blocks[0]; // Use first block for field testing
                
                for (let i = 0; i < availableFields.length; i++) {
                    const testField = availableFields[(fieldIdx + i) % availableFields.length];
                    
                    if (canFieldHostLeague(testField, testBlock, context)) {
                        assignedField = testField;
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
                    console.log(`   ✅ ${team1} vs ${team2} @ ${assignedField}`);
                } else {
                    console.log(`   ❌ Could not assign field for ${team1} vs ${team2}`);
                }
            });

            // ✅ CRITICAL: Assign to ALL bunks in the division
            blocks.forEach(block => {
                const pick = {
                    field: `Specialty League: ${league.name}`,
                    sport: leagueSport,
                    _activity: `Specialty League: ${league.name}`,
                    _h2h: true,
                    _fixed: true,
                    _allMatchups: matchupAssignments.map(m => 
                        `${m.matchup} @ ${m.field} (${m.sport})`
                    ),
                    _gameLabel: `Specialty League`
                };

                fillBlock(block, pick, fieldUsageBySlot, {}, true, activityProperties);
                block.processed = true;
            });
        }

        console.log("=== SPECIALTY LEAGUE ENGINE COMPLETE ===");
    };

    // =========================================================================
    // REGULAR LEAGUES (COMPLETE REWRITE)
    // =========================================================================

    Leagues.processRegularLeagues = function (context) {
        console.log("=== UNIFIED LEAGUE ENGINE START ===");
        
        const { 
            schedulableSlotBlocks, 
            masterLeagues, 
            disabledLeagues,
            divisions,
            fillBlock,
            fieldUsageBySlot,
            activityProperties,
            rotationHistory
        } = context;

        if (!masterLeagues || Object.keys(masterLeagues).length === 0) {
            console.log("No regular leagues configured.");
            return;
        }

        // ✅ NEW: Group by TIME only (not by division)
        // This allows multi-division leagues to share matchups
        const blocksByTime = {};
        
        schedulableSlotBlocks
            .filter(b => b.type === 'league' || /league/i.test(b.event))
            .forEach(block => {
                const key = block.startTime; // Just time, not division
                if (!blocksByTime[key]) {
                    blocksByTime[key] = { byDivision: {}, allBlocks: [] };
                }
                
                if (!blocksByTime[key].byDivision[block.divName]) {
                    blocksByTime[key].byDivision[block.divName] = [];
                }
                
                blocksByTime[key].byDivision[block.divName].push(block);
                blocksByTime[key].allBlocks.push(block);
            });

        // Process each time slot
        for (const [timeKey, timeData] of Object.entries(blocksByTime)) {
            const divisionNames = Object.keys(timeData.byDivision);
            
            // ✅ NEW: Find league that covers ANY of these divisions
            const league = Object.values(masterLeagues).find(l => {
                if (!l.enabled) return false;
                if (disabledLeagues.includes(l.name)) return false;
                if (!l.divisions || l.divisions.length === 0) return false;
                
                // Check if this league covers any of the divisions at this time
                return divisionNames.some(div => l.divisions.includes(div));
            });

            if (!league) {
                console.log(`⚠️ No league for divisions [${divisionNames.join(", ")}] at ${timeKey}`);
                continue;
            }

            console.log(`\n📋 League: "${league.name}" (${divisionNames.join(", ")})`);

            // ✅ CRITICAL: Use league teams directly (NOT bunk names)
            const leagueTeams = league.teams || [];

            if (leagueTeams.length < 2) {
                console.log(`   ⚠️ Not enough teams in league (need 2+, have ${leagueTeams.length})`);
                console.log(`   Teams: [${leagueTeams.join(", ")}]`);
                continue;
            }

            // Generate matchups
            const matchups = getMatchupsForLeague(league, context);
            
            if (matchups.length === 0) {
                console.log(`   No matchups available`);
                continue;
            }

            // Determine required fields
            const requiredFieldCount = Math.ceil(matchups.length);
            const leagueSports = league.sports || ["General Sport"];
            
            // Get all available fields for league sports
            const allAvailableFields = new Set();
            leagueSports.forEach(sport => {
                const fields = getFieldsForSport(sport, context);
                fields.forEach(f => allAvailableFields.add(f));
            });

            const availableFieldsArray = Array.from(allAvailableFields);
            
            console.log(`   Required fields: ${requiredFieldCount}`);
            console.log(`   Available fields: ${availableFieldsArray.length} [${availableFieldsArray.join(", ")}]`);
            console.log(`   Teams in league: ${leagueTeams.length}`);
            console.log(`   Matchups: ${matchups.length}`);

            if (availableFieldsArray.length === 0) {
                console.log(`   🚨 No fields available for league!`);
                continue;
            }

            // ✅ NEW: Assign matchups to fields (independent of bunks)
            const matchupAssignments = [];
            let fieldIdx = 0;
            const gameNumber = getCurrentRoundIndex(league.name, context) + 1;

            matchups.forEach((matchup, idx) => {
                const [team1, team2] = matchup;
                
                // Select sport (rotate through league sports)
                const selectedSport = leagueSports[idx % leagueSports.length];
                const fieldsForSport = getFieldsForSport(selectedSport, context);

                // Try to assign a field
                let assignedField = null;
                const testBlock = timeData.allBlocks[0]; // Use first block for testing
                
                for (let i = 0; i < fieldsForSport.length; i++) {
                    const testField = fieldsForSport[(fieldIdx + i) % fieldsForSport.length];
                    
                    if (canFieldHostLeague(testField, testBlock, context)) {
                        assignedField = testField;
                        fieldIdx = (fieldIdx + i + 1) % fieldsForSport.length;
                        break;
                    }
                }

                if (!assignedField && availableFieldsArray.length > 0) {
                    assignedField = availableFieldsArray[fieldIdx % availableFieldsArray.length];
                    fieldIdx = (fieldIdx + 1) % availableFieldsArray.length;
                }

                if (assignedField) {
                    matchupAssignments.push({
                        matchup: `${team1} vs ${team2}`,
                        field: assignedField,
                        sport: selectedSport
                    });
                    
                    console.log(`   ✅ ${team1} vs ${team2} @ ${assignedField} (${selectedSport})`);

                    // Update rotation history
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
                    console.log(`   ❌ Could not assign field for ${team1} vs ${team2}`);
                }
            });

            // ✅ CRITICAL: Assign to ALL bunks in ALL divisions in this league
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

            // Increment league round counter
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
