// ============================================================================
// scheduler_core_leagues.js (FIXED - Field Visibility Bug)
// PART 2 of 3: LEAGUE PROCESSOR
//
// CRITICAL FIX:
// - Properly accesses fields from context.fields (not window.app1.fields)
// - Uses fieldsBySport mapping for sport-to-field resolution
// - Correctly filters available fields before league assignment
// ============================================================================

(function () {
    'use strict';

    const Leagues = {};
    const LEAGUE_WEIGHT = 2; // Leagues take 2x capacity (buyout mode)

    // =========================================================================
    // FIELD RESOLUTION - FIXED
    // =========================================================================
    
    /**
     * Get available fields for a sport (FIXED VERSION)
     * Previously: Accessed window.app1.fields directly (WRONG)
     * Now: Uses context.fields and context.fieldsBySport (CORRECT)
     */
    function getFieldsForSport(sportName, context) {
        // Method 1: Use fieldsBySport mapping (preferred)
        if (context.fieldsBySport && context.fieldsBySport[sportName]) {
            const mappedFields = context.fieldsBySport[sportName];
            
            // Filter out disabled fields
            const disabledFields = context.disabledFields || [];
            return mappedFields.filter(f => !disabledFields.includes(f));
        }

        // Method 2: Fallback - scan all fields for this sport
        const allFields = context.fields || [];
        const disabledFields = context.disabledFields || [];
        
        return allFields
            .filter(f => f.activities && f.activities.includes(sportName))
            .filter(f => !disabledFields.includes(f.name))
            .map(f => f.name);
    }

    /**
     * Check if a field can accommodate a league game at a specific time
     */
    function canFieldHostLeague(fieldName, block, context) {
        const { activityProperties, fieldUsageBySlot } = context;
        
        // Check field availability using Utils
        const canFit = window.SchedulerCoreUtils.canLeagueGameFit(
            block,
            fieldName,
            fieldUsageBySlot,
            activityProperties
        );

        return canFit;
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
            
            // Rotate (keep first team fixed)
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
            fillBlock
        } = context;

        if (!masterSpecialtyLeagues || Object.keys(masterSpecialtyLeagues).length === 0) {
            console.log("No specialty leagues configured.");
            return;
        }

        // Group blocks by division and time
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

        // Process each time slot
        for (const [key, blocks] of Object.entries(blocksByDivisionTime)) {
            const [divName, startTime] = key.split('_');
            
            // Find applicable league
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

            // Get matchups
            const matchups = getMatchupsForLeague(league, context);
            if (matchups.length === 0) {
                console.log(`   No matchups for ${league.name}`);
                continue;
            }

            // Get available fields - FIXED
            const leagueSport = league.sport || (league.sports && league.sports[0]) || "General";
            const availableFields = getFieldsForSport(leagueSport, context);

            console.log(`   Sport: ${leagueSport}`);
            console.log(`   Available fields: [${availableFields.join(", ")}]`);
            console.log(`   Matchups: ${matchups.length}, Blocks: ${blocks.length}`);

            if (availableFields.length === 0) {
                console.log(`   ⚠️ No fields available for ${leagueSport}`);
                continue;
            }

            // Assign matchups to blocks
            let fieldIdx = 0;
            matchups.forEach((matchup, idx) => {
                const [team1, team2] = matchup;
                
                // Find blocks for these teams
                const block1 = blocks.find(b => b.bunk === team1);
                const block2 = blocks.find(b => b.bunk === team2);

                if (!block1 || !block2) return;

                // Try to find a field
                let assignedField = null;
                for (let i = 0; i < availableFields.length; i++) {
                    const testField = availableFields[(fieldIdx + i) % availableFields.length];
                    
                    if (canFieldHostLeague(testField, block1, context)) {
                        assignedField = testField;
                        fieldIdx = (fieldIdx + i + 1) % availableFields.length;
                        break;
                    }
                }

                if (assignedField) {
                    const pick = {
                        field: assignedField,
                        sport: leagueSport,
                        _activity: `vs ${team2} @ ${assignedField}`,
                        _h2h: true,
                        _fixed: true,
                        _allMatchups: [`${team1} vs ${team2}`],
                        _gameLabel: `Specialty Game ${idx + 1}`
                    };

                    fillBlock(block1, pick, fieldUsageBySlot, {}, true, activityProperties);
                    
                    // Team 2 sees opponent
                    const pick2 = { ...pick, _activity: `vs ${team1} @ ${assignedField}` };
                    fillBlock(block2, pick2, fieldUsageBySlot, {}, true, activityProperties);

                    block1.processed = true;
                    block2.processed = true;

                    console.log(`   ✅ ${team1} vs ${team2} @ ${assignedField}`);
                } else {
                    console.log(`   ❌ Could not assign field for ${team1} vs ${team2}`);
                }
            });
        }

        console.log("=== SPECIALTY LEAGUE ENGINE COMPLETE ===");
    };

    // =========================================================================
    // REGULAR LEAGUES
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

        // Group blocks by division and time
        const blocksByDivisionTime = {};
        
        schedulableSlotBlocks
            .filter(b => b.type === 'league' || /league/i.test(b.event))
            .forEach(block => {
                const key = `${block.divName}_${block.startTime}`;
                if (!blocksByDivisionTime[key]) {
                    blocksByDivisionTime[key] = [];
                }
                blocksByDivisionTime[key].push(block);
            });

        // Process each league slot
        for (const [key, blocks] of Object.entries(blocksByDivisionTime)) {
            const [divName, startTime] = key.split('_');
            
            // Find applicable league
            const league = Object.values(masterLeagues).find(l => {
                if (!l.enabled) return false;
                if (disabledLeagues.includes(l.name)) return false;
                if (!l.divisions || !l.divisions.includes(divName)) return false;
                return true;
            });

            if (!league) {
                console.log(`⚠️ No league for ${divName} at ${startTime}`);
                continue;
            }

            console.log(`\n📋 League: "${league.name}" (${divName})`);

            // Get teams from division bunks
            const divisionBunks = divisions[divName]?.bunks || [];
            const leagueTeams = league.teams.filter(t => divisionBunks.includes(t));

            if (leagueTeams.length < 2) {
                console.log(`   ⚠️ Not enough teams in ${divName} (need 2+, have ${leagueTeams.length})`);
                continue;
            }

            // Generate matchups
            const matchups = getMatchupsForLeague({ ...league, teams: leagueTeams }, context);
            
            if (matchups.length === 0) {
                console.log(`   No matchups available`);
                continue;
            }

            // Determine required fields - FIXED
            const requiredFieldCount = Math.ceil(matchups.length);
            const leagueSports = league.sports || ["General Sport"];
            
            // Get all available fields for league sports - FIXED
            const allAvailableFields = new Set();
            leagueSports.forEach(sport => {
                const fields = getFieldsForSport(sport, context);
                fields.forEach(f => allAvailableFields.add(f));
            });

            const availableFieldsArray = Array.from(allAvailableFields);
            
            console.log(`   Required fields: ${requiredFieldCount}`);
            console.log(`   Available fields: ${availableFieldsArray.length} [${availableFieldsArray.join(", ")}]`);

            if (availableFieldsArray.length === 0) {
                console.log(`   🚨 League "${league.name}": Need ${requiredFieldCount} fields, only ${availableFieldsArray.length} available!`);
                continue;
            }

            // Assign matchups to fields
            let fieldIdx = 0;
            const gameNumber = getCurrentRoundIndex(league.name, context) + 1;

            matchups.forEach((matchup, idx) => {
                const [team1, team2] = matchup;
                
                const block1 = blocks.find(b => b.bunk === team1);
                const block2 = blocks.find(b => b.bunk === team2);

                if (!block1 || !block2) {
                    console.log(`   ⚠️ Missing blocks for ${team1} vs ${team2}`);
                    return;
                }

                // Select sport (rotate through league sports)
                const selectedSport = leagueSports[idx % leagueSports.length];
                const fieldsForSport = getFieldsForSport(selectedSport, context);

                // Try to assign a field
                let assignedField = null;
                for (let i = 0; i < fieldsForSport.length; i++) {
                    const testField = fieldsForSport[(fieldIdx + i) % fieldsForSport.length];
                    
                    if (canFieldHostLeague(testField, block1, context)) {
                        assignedField = testField;
                        fieldIdx = (fieldIdx + i + 1) % fieldsForSport.length;
                        break;
                    }
                }

                if (!assignedField && availableFieldsArray.length > 0) {
                    // Fallback: try any available field
                    assignedField = availableFieldsArray[fieldIdx % availableFieldsArray.length];
                    fieldIdx = (fieldIdx + 1) % availableFieldsArray.length;
                }

                if (assignedField) {
                    const matchupText = `${team1} vs ${team2}`;
                    
                    const pick1 = {
                        field: assignedField,
                        sport: selectedSport,
                        _activity: `League: ${matchupText}`,
                        _h2h: true,
                        _fixed: true,
                        _allMatchups: [matchupText],
                        _gameLabel: `Game ${gameNumber}`
                    };

                    fillBlock(block1, pick1, fieldUsageBySlot, {}, true, activityProperties);
                    
                    const pick2 = { ...pick1 };
                    fillBlock(block2, pick2, fieldUsageBySlot, {}, true, activityProperties);

                    block1.processed = true;
                    block2.processed = true;

                    console.log(`   ✅ ${matchupText} @ ${assignedField} (${selectedSport})`);

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
