// ============================================================================
// scheduler_core_leagues.js (INTELLIGENT REWRITE)
// 
// CRITICAL FIXES:
// 1. Sport rotation tracking - prevents back-to-back same sport
// 2. Division isolation - leagues only apply to configured divisions
// 3. Field blocking - league fields unavailable to others during game time
// 4. Smart field rotation - variety in field assignments
// ============================================================================

(function () {
    'use strict';

    const Leagues = {};
    const LEAGUE_WEIGHT = 2;

    // =========================================================================
    // TRACKING STATE (NEW)
    // =========================================================================
    
    // Track what sports each team has played today
    if (!window.leagueSportHistory) {
        window.leagueSportHistory = {}; // { "leagueName|team": ["Baseball", "Basketball", ...] }
    }
    
    // Track what fields each team/league has used
    if (!window.leagueFieldHistory) {
        window.leagueFieldHistory = {}; // { "leagueName|team": ["Field A", "Grass", ...] }
    }
    
    // Track occupied fields by time slot
    if (!window.leagueFieldOccupancy) {
        window.leagueFieldOccupancy = {}; // { "timeKey": ["Field A", "Field B", ...] }
    }

    // =========================================================================
    // FIELD RESOLUTION (UPDATED WITH BLOCKING)
    // =========================================================================
    
    function getFieldsForSport(sportName, context, divisionNames = [], timeKey = null) {
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

        // Filter by division restrictions
        if (divisionNames.length > 0) {
            candidateFields = candidateFields.filter(fieldName => 
                isFieldAllowedForDivisions(fieldName, divisionNames, context)
            );
        }

        // ✅ NEW: Filter out fields already occupied by other leagues at this time
        if (timeKey && window.leagueFieldOccupancy[timeKey]) {
            const occupiedFields = window.leagueFieldOccupancy[timeKey];
            const beforeFilter = candidateFields.length;
            candidateFields = candidateFields.filter(f => !occupiedFields.includes(f));
            
            if (candidateFields.length < beforeFilter) {
                console.log(`   🚫 Filtered out ${beforeFilter - candidateFields.length} occupied fields`);
            }
        }

        return candidateFields;
    }

    function isFieldAllowedForDivisions(fieldName, divisionNames, context) {
        const allFields = context.fields || [];
        const field = allFields.find(f => f.name === fieldName);
        
        if (!field) return false;
        if (field.available === false) return false;

        const limitUsage = field.limitUsage || { enabled: false };
        if (!limitUsage.enabled) return true;

        const allowedDivisions = Object.keys(limitUsage.divisions || {});
        const hasAllowedDivision = divisionNames.some(divName => 
            allowedDivisions.includes(divName)
        );

        if (!hasAllowedDivision) {
            console.log(`   🚫 Field "${fieldName}" restricted - not allowed for divisions [${divisionNames.join(", ")}]`);
            return false;
        }

        return true;
    }

    // ✅ NEW: Block a field for a specific time slot
    function blockFieldForTime(fieldName, timeKey) {
        if (!window.leagueFieldOccupancy[timeKey]) {
            window.leagueFieldOccupancy[timeKey] = [];
        }
        
        if (!window.leagueFieldOccupancy[timeKey].includes(fieldName)) {
            window.leagueFieldOccupancy[timeKey].push(fieldName);
            console.log(`   🔒 Field "${fieldName}" blocked for time ${timeKey}`);
        }
    }

    // ✅ NEW: Check if field is available (not blocked by leagues)
    function isFieldAvailableForNonLeague(fieldName, timeKey) {
        if (!timeKey || !window.leagueFieldOccupancy[timeKey]) {
            return true;
        }
        
        return !window.leagueFieldOccupancy[timeKey].includes(fieldName);
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
    // SMART SPORT SELECTION (NEW)
    // =========================================================================
    
    function selectSportForTeam(team, leagueName, availableSports, preferredSport = null) {
        const historyKey = `${leagueName}|${team}`;
        const history = window.leagueSportHistory[historyKey] || [];
        
        // If a sport is preferred (e.g., from matchup algorithm), try it first
        if (preferredSport && !history.includes(preferredSport)) {
            return preferredSport;
        }
        
        // Find sports this team hasn't played yet
        const unplayedSports = availableSports.filter(sport => !history.includes(sport));
        
        if (unplayedSports.length > 0) {
            // Prefer unplayed sports
            return unplayedSports[0];
        }
        
        // All sports played - find least recently used
        const sportCounts = {};
        availableSports.forEach(sport => {
            sportCounts[sport] = history.filter(s => s === sport).length;
        });
        
        // Return sport with lowest count
        let minSport = availableSports[0];
        let minCount = sportCounts[minSport] || 0;
        
        availableSports.forEach(sport => {
            const count = sportCounts[sport] || 0;
            if (count < minCount) {
                minCount = count;
                minSport = sport;
            }
        });
        
        return minSport;
    }

    function recordSportUsage(team, leagueName, sport) {
        const historyKey = `${leagueName}|${team}`;
        if (!window.leagueSportHistory[historyKey]) {
            window.leagueSportHistory[historyKey] = [];
        }
        window.leagueSportHistory[historyKey].push(sport);
        console.log(`   📊 ${team} sport history: [${window.leagueSportHistory[historyKey].join(", ")}]`);
    }

    // =========================================================================
    // SMART FIELD SELECTION (NEW)
    // =========================================================================
    
    function selectFieldForTeam(team, leagueName, availableFields, testBlock, context) {
        const historyKey = `${leagueName}|${team}`;
        const history = window.leagueFieldHistory[historyKey] || [];
        
        // Find fields this team hasn't used yet
        const unusedFields = availableFields.filter(field => !history.includes(field));
        
        // Try unused fields first
        const candidatePool = unusedFields.length > 0 ? unusedFields : availableFields;
        
        // Test each candidate for availability
        for (let field of candidatePool) {
            if (canFieldHostLeague(field, testBlock, context)) {
                return field;
            }
        }
        
        // Fallback: return first available field
        return availableFields.find(f => canFieldHostLeague(f, testBlock, context)) || availableFields[0];
    }

    function recordFieldUsage(team, leagueName, field) {
        const historyKey = `${leagueName}|${team}`;
        if (!window.leagueFieldHistory[historyKey]) {
            window.leagueFieldHistory[historyKey] = [];
        }
        window.leagueFieldHistory[historyKey].push(field);
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

            if (!league) continue;

            console.log(`\n📋 Specialty League: "${league.name}" (${divName})`);

            const matchups = getMatchupsForLeague(league, context);
            if (matchups.length === 0) continue;

            const leagueSport = league.sport || (league.sports && league.sports[0]) || "General";
            const timeKey = startTime;
            
            const availableFields = getFieldsForSport(leagueSport, context, [divName], timeKey);

            if (availableFields.length === 0) {
                console.log(`   ⚠️ No fields available`);
                continue;
            }

            const matchupAssignments = [];

            matchups.forEach((matchup) => {
                const [team1, team2] = matchup;
                
                const field = selectFieldForTeam(team1, league.name, availableFields, blocks[0], context);
                
                if (field) {
                    matchupAssignments.push({
                        matchup: `${team1} vs ${team2}`,
                        field: field,
                        sport: leagueSport
                    });
                    
                    // Block field and record usage
                    blockFieldForTime(field, timeKey);
                    recordFieldUsage(team1, league.name, field);
                    recordFieldUsage(team2, league.name, field);
                    recordSportUsage(team1, league.name, leagueSport);
                    recordSportUsage(team2, league.name, leagueSport);
                    
                    console.log(`   ✅ ${team1} vs ${team2} @ ${field}`);
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
    // REGULAR LEAGUES (INTELLIGENT REWRITE)
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

        // ✅ FIXED: Group by TIME only, track divisions processed per league
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

        // Process each time slot
        for (const [timeKey, timeData] of Object.entries(blocksByTime)) {
            const divisionsAtTime = Object.keys(timeData.byDivision);
            
            // ✅ NEW: Track which leagues have been processed at this time
            const processedLeagues = new Set();
            
            // Find ALL leagues that have blocks at this time
            const applicableLeagues = Object.values(masterLeagues).filter(l => {
                if (!l.enabled) return false;
                if (disabledLeagues.includes(l.name)) return false;
                if (!l.divisions || l.divisions.length === 0) return false;
                
                // Check if this league applies to ANY division at this time
                return divisionsAtTime.some(div => l.divisions.includes(div));
            });

            // Process each league
            applicableLeagues.forEach(league => {
                // Skip if already processed
                if (processedLeagues.has(league.name)) return;
                processedLeagues.add(league.name);

                // ✅ CRITICAL: Only divisions that are BOTH:
                // 1. In this league's configuration
                // 2. Present at this time slot
                const leagueDivisions = league.divisions.filter(div => divisionsAtTime.includes(div));
                
                if (leagueDivisions.length === 0) return;

                console.log(`\n📋 League: "${league.name}" (${leagueDivisions.join(", ")})`);

                const leagueTeams = league.teams || [];

                if (leagueTeams.length < 2) {
                    console.log(`   ⚠️ Not enough teams (have ${leagueTeams.length})`);
                    return;
                }

                const matchups = getMatchupsForLeague(league, context);
                
                if (matchups.length === 0) {
                    console.log(`   No matchups available`);
                    return;
                }

                const requiredFieldCount = matchups.length;
                const leagueSports = league.sports || ["General Sport"];
                
                // Get available fields (with division restrictions and occupation filtering)
                const allAvailableFields = new Set();
                leagueSports.forEach(sport => {
                    const fields = getFieldsForSport(sport, context, leagueDivisions, timeKey);
                    fields.forEach(f => allAvailableFields.add(f));
                });

                const availableFieldsArray = Array.from(allAvailableFields);
                
                console.log(`   Required fields: ${requiredFieldCount}`);
                console.log(`   Available fields: ${availableFieldsArray.length} [${availableFieldsArray.join(", ")}]`);
                console.log(`   Teams: ${leagueTeams.length}, Matchups: ${matchups.length}`);

                if (availableFieldsArray.length === 0) {
                    console.log(`   🚨 No fields available!`);
                    return;
                }

                // ✅ NEW: Intelligent matchup assignment with sport and field rotation
                const matchupAssignments = [];
                const gameNumber = getCurrentRoundIndex(league.name, context) + 1;

                matchups.forEach((matchup, idx) => {
                    const [team1, team2] = matchup;
                    
                    // ✅ SMART SPORT SELECTION: Avoid back-to-back same sport
                    const preferredSport = leagueSports[idx % leagueSports.length];
                    const sport1 = selectSportForTeam(team1, league.name, leagueSports, preferredSport);
                    const sport2 = selectSportForTeam(team2, league.name, leagueSports, preferredSport);
                    
                    // Use the sport that both teams need most
                    const selectedSport = sport1 === sport2 ? sport1 : 
                                        (sport1 === preferredSport ? sport1 : sport2);
                    
                    const fieldsForSport = getFieldsForSport(selectedSport, context, leagueDivisions, timeKey);

                    // ✅ SMART FIELD SELECTION: Variety for teams
                    let assignedField = null;
                    const testBlock = timeData.allBlocks[0];
                    
                    // Try to get a field that team1 hasn't used yet
                    assignedField = selectFieldForTeam(team1, league.name, fieldsForSport, testBlock, context);
                    
                    // Fallback to any available field
                    if (!assignedField && availableFieldsArray.length > 0) {
                        assignedField = availableFieldsArray.find(f => 
                            canFieldHostLeague(f, testBlock, context)
                        ) || availableFieldsArray[0];
                    }

                    if (assignedField) {
                        matchupAssignments.push({
                            matchup: `${team1} vs ${team2}`,
                            field: assignedField,
                            sport: selectedSport
                        });
                        
                        // ✅ CRITICAL: Block field, record usage
                        blockFieldForTime(assignedField, timeKey);
                        recordFieldUsage(team1, league.name, assignedField);
                        recordFieldUsage(team2, league.name, assignedField);
                        recordSportUsage(team1, league.name, selectedSport);
                        recordSportUsage(team2, league.name, selectedSport);
                        
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

                // ✅ CRITICAL: Only assign to divisions in THIS league
                leagueDivisions.forEach(divName => {
                    const blocksForDiv = timeData.byDivision[divName];
                    
                    if (!blocksForDiv) {
                        console.log(`   ⚠️ No blocks found for division ${divName}`);
                        return;
                    }
                    
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
            });
        }

        console.log("=== UNIFIED LEAGUE ENGINE COMPLETE ===");
        console.log(`\n📊 Daily Sport Summary:`);
        Object.keys(window.leagueSportHistory).forEach(key => {
            const [league, team] = key.split('|');
            const sports = window.leagueSportHistory[key];
            console.log(`   ${league} - Team ${team}: [${sports.join(", ")}]`);
        });
    };

    // =========================================================================
    // EXPORT FIELD AVAILABILITY CHECKER
    // =========================================================================
    
    // This can be called by the main scheduler to check if a field is available
    window.isLeagueFieldBlocked = function(fieldName, timeKey) {
        return !isFieldAvailableForNonLeague(fieldName, timeKey);
    };

    // Diagnostic
    window.checkLeagueFieldBlocking = function() {
        console.log("\n=== LEAGUE FIELD BLOCKING STATUS ===");
        Object.keys(window.leagueFieldOccupancy).forEach(timeKey => {
            const blockedFields = window.leagueFieldOccupancy[timeKey];
            console.log(`\n${timeKey}:`);
            console.log(`  🔒 Blocked fields: [${blockedFields.join(", ")}]`);
        });
        console.log("\n=== END STATUS ===\n");
    };

    window.checkSportRotation = function() {
        console.log("\n=== SPORT ROTATION TRACKING ===");
        Object.keys(window.leagueSportHistory).forEach(key => {
            const [league, team] = key.split('|');
            const sports = window.leagueSportHistory[key];
            console.log(`${league} - Team ${team}: [${sports.join(", ")}]`);
        });
        console.log("\n=== END TRACKING ===\n");
    };

    // Export
    window.SchedulerCoreLeagues = Leagues;

})();
