
// ============================================================================
// scheduler_core_leagues.js (COMPLETE - With Field Restrictions)
// 
// FIXES APPLIED:
// 1. League teams independent of bunks ✅
// 2. Multi-division leagues work correctly ✅
// 3. Field restrictions respected (NEW) ✅
// ============================================================================

(function () {
    'use strict';

    const Leagues = {};
    const LEAGUE_WEIGHT = 2;

    // =========================================================================
    // FIELD RESOLUTION (UPDATED)
    // =========================================================================
    
    function getFieldsForSport(sportName, context, divisionNames = []) {
        // Get base fields for this sport
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

        // ✅ NEW: Filter by division restrictions
        if (divisionNames.length > 0) {
            candidateFields = candidateFields.filter(fieldName => 
                isFieldAllowedForDivisions(fieldName, divisionNames, context)
            );
        }

        return candidateFields;
    }

    // ✅ NEW: Check if field is allowed for specific divisions
    function isFieldAllowedForDivisions(fieldName, divisionNames, context) {
        const allFields = context.fields || [];
        const field = allFields.find(f => f.name === fieldName);
        
        if (!field) {
            console.warn(`⚠️ Field "${fieldName}" not found in context`);
            return false;
        }

        // Check if field is available at all
        if (field.available === false) {
            return false;
        }

        // Check field restrictions (limitUsage)
        const limitUsage = field.limitUsage || { enabled: false };
        
        // If no restrictions, field is available to all
        if (!limitUsage.enabled) {
            return true;
        }

        // If restrictions enabled, check if ANY of the league's divisions are allowed
        const allowedDivisions = Object.keys(limitUsage.divisions || {});
        
        // Check if at least one division in the league is allowed
        const hasAllowedDivision = divisionNames.some(divName => 
            allowedDivisions.includes(divName)
        );

        if (!hasAllowedDivision) {
            console.log(`   🚫 Field "${fieldName}" restricted - not allowed for divisions [${divisionNames.join(", ")}]`);
            return false;
        }

        return true;
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
    // SPECIALTY LEAGUES (UPDATED)
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
            
            // ✅ FIXED: Pass division for field restrictions
            const availableFields = getFieldsForSport(leagueSport, context, [divName]);

            console.log(`   Sport: ${leagueSport}`);
            console.log(`   Available fields: [${availableFields.join(", ")}]`);
            console.log(`   Matchups: ${matchups.length}, Blocks: ${blocks.length}`);

            if (availableFields.length === 0) {
                console.log(`   ⚠️ No fields available for ${leagueSport} in division ${divName}`);
                continue;
            }

            const divisionBunks = divisions[divName]?.bunks || [];
            const allMatchupsText = matchups.map(m => `${m[0]} vs ${m[1]}`);
            
            let fieldIdx = 0;
            const matchupAssignments = [];

            matchups.forEach((matchup, idx) => {
                const [team1, team2] = matchup;
                
                let assignedField = null;
                const testBlock = blocks[0];
                
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
    // REGULAR LEAGUES (UPDATED WITH FIELD RESTRICTIONS)
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

        const blocksByTime = {};
        
        schedulableSlotBlocks
            .filter(b => b.type === 'league' || /league/i.test(b.event))
            .forEach(block => {
                const key = block.startTime;
                if (!blocksByTime[key]) {
                    blocksByTime[key] = { byDivision: {}, allBlocks: [] };
                }
                
                if (!blocksByTime[key].byDivision[block.divName]) {
                    blocksByTime[key].byDivision[block.divName] = [];
                }
                
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

            if (!league) {
                console.log(`⚠️ No league for divisions [${divisionNames.join(", ")}] at ${timeKey}`);
                continue;
            }

            console.log(`\n📋 League: "${league.name}" (${divisionNames.join(", ")})`);

            const leagueTeams = league.teams || [];

            if (leagueTeams.length < 2) {
                console.log(`   ⚠️ Not enough teams in league (need 2+, have ${leagueTeams.length})`);
                console.log(`   Teams: [${leagueTeams.join(", ")}]`);
                continue;
            }

            const matchups = getMatchupsForLeague(league, context);
            
            if (matchups.length === 0) {
                console.log(`   No matchups available`);
                continue;
            }

            const requiredFieldCount = Math.ceil(matchups.length);
            const leagueSports = league.sports || ["General Sport"];
            
            // ✅ FIXED: Get fields with division restrictions
            const allAvailableFields = new Set();
            leagueSports.forEach(sport => {
                const fields = getFieldsForSport(sport, context, divisionNames);
                fields.forEach(f => allAvailableFields.add(f));
            });

            const availableFieldsArray = Array.from(allAvailableFields);
            
            console.log(`   Required fields: ${requiredFieldCount}`);
            console.log(`   Available fields: ${availableFieldsArray.length} [${availableFieldsArray.join(", ")}]`);
            console.log(`   Teams in league: ${leagueTeams.length}`);
            console.log(`   Matchups: ${matchups.length}`);

            if (availableFieldsArray.length === 0) {
                console.log(`   🚨 No fields available for divisions [${divisionNames.join(", ")}]!`);
                continue;
            }

            const matchupAssignments = [];
            let fieldIdx = 0;
            const gameNumber = getCurrentRoundIndex(league.name, context) + 1;

            matchups.forEach((matchup, idx) => {
                const [team1, team2] = matchup;
                
                const selectedSport = leagueSports[idx % leagueSports.length];
                
                // ✅ FIXED: Get fields with division restrictions
                const fieldsForSport = getFieldsForSport(selectedSport, context, divisionNames);

                let assignedField = null;
                const testBlock = timeData.allBlocks[0];
                
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

    // =========================================================================
    // DIAGNOSTIC TOOL
    // =========================================================================
    
    window.checkFieldRestrictions = function() {
        console.log("\n=== FIELD RESTRICTION DIAGNOSTIC ===");
        
        const fields = window.loadGlobalSettings?.().app1?.fields || [];
        const divisions = window.divisions || {};
        
        fields.forEach(field => {
            console.log(`\n🏟️  ${field.name}:`);
            console.log(`   Available: ${field.available !== false}`);
            console.log(`   Activities: [${(field.activities || []).join(", ")}]`);
            
            const limitUsage = field.limitUsage || { enabled: false };
            
            if (!limitUsage.enabled) {
                console.log(`   ✅ No restrictions - available to ALL divisions`);
            } else {
                const allowedDivisions = Object.keys(limitUsage.divisions || {});
                console.log(`   🚫 RESTRICTED to divisions: [${allowedDivisions.join(", ")}]`);
                
                const allDivisions = Object.keys(divisions);
                const blockedDivisions = allDivisions.filter(d => !allowedDivisions.includes(d));
                if (blockedDivisions.length > 0) {
                    console.log(`   ❌ BLOCKED for divisions: [${blockedDivisions.join(", ")}]`);
                }
            }
        });
        
        console.log("\n=== END DIAGNOSTIC ===\n");
    };

    // Export
    window.SchedulerCoreLeagues = Leagues;

})();
