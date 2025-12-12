// ============================================================================
// scheduler_core_leagues.js (FIXED v4 - DAY-AWARE COUNTER)
//
// CRITICAL UPDATE:
// - Now uses GlobalFieldLocks to check/lock fields
// - Regular leagues process AFTER specialty leagues
// - Any field locked by specialty leagues is unavailable
// - Regular leagues lock their fields to prevent double-booking
// - Game counter only increments when day changes, not on regenerate
// ============================================================================

(function () {
    'use strict';

    const Leagues = {};

    // =========================================================================
    // PERSISTENT HISTORY
    // =========================================================================
    
    const LEAGUE_HISTORY_KEY = "campLeagueHistory_v2";
    
    function loadLeagueHistory() {
        try {
            const raw = localStorage.getItem(LEAGUE_HISTORY_KEY);
            if (!raw) return { teamSports: {}, matchupHistory: {}, roundCounters: {}, lastScheduledDay: {} };
            const history = JSON.parse(raw);
            // Ensure lastScheduledDay exists for backward compatibility
            if (!history.lastScheduledDay) history.lastScheduledDay = {};
            return history;
        } catch (e) {
            console.error("Failed to load league history:", e);
            return { teamSports: {}, matchupHistory: {}, roundCounters: {}, lastScheduledDay: {} };
        }
    }
    
    function saveLeagueHistory(history) {
        try {
            localStorage.setItem(LEAGUE_HISTORY_KEY, JSON.stringify(history));
        } catch (e) {
            console.error("Failed to save league history:", e);
        }
    }
    
    function getTeamSportHistory(leagueName, team, history) {
        const key = `${leagueName}|${team}`;
        return history.teamSports[key] || [];
    }
    
    function recordTeamSport(leagueName, team, sport, history) {
        const key = `${leagueName}|${team}`;
        if (!history.teamSports[key]) history.teamSports[key] = [];
        history.teamSports[key].push(sport);
    }

    // =========================================================================
    // ROUND-ROBIN MATCHUP GENERATION
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

    // =========================================================================
    // ★★★ FIELD AVAILABILITY - WITH GLOBAL LOCK CHECK ★★★
    // =========================================================================
    
    function buildAvailableFieldSportPool(leagueSports, context, divisionNames, timeKey, slots) {
        const pool = [];
        const { fields, disabledFields, activityProperties } = context;
        
        const allFields = fields || [];
        
        for (const field of allFields) {
            if (!field || !field.name) continue;
            if (field.available === false) continue;
            if (disabledFields && disabledFields.includes(field.name)) continue;
            
            // ★★★ CHECK GLOBAL LOCKS FIRST ★★★
            if (window.GlobalFieldLocks && slots && slots.length > 0) {
                const lockInfo = window.GlobalFieldLocks.isFieldLocked(field.name, slots);
                if (lockInfo) {
                    console.log(`[RegularLeagues] ⚠️ Field "${field.name}" locked by ${lockInfo.lockedBy} (${lockInfo.leagueName || lockInfo.activity})`);
                    continue;
                }
            }
            
            // Check division restrictions
            if (field.limitUsage?.enabled) {
                const allowedDivs = Object.keys(field.limitUsage.divisions || {});
                const hasAllowed = divisionNames.some(d => allowedDivs.includes(d));
                if (!hasAllowed) continue;
            }
            
            const fieldSports = field.activities || [];
            
            for (const sport of leagueSports) {
                if (!fieldSports.includes(sport)) continue;
                
                pool.push({
                    field: field.name,
                    sport: sport,
                    fieldObj: field
                });
            }
        }
        
        return pool;
    }

    // =========================================================================
    // SMART ASSIGNMENT ALGORITHM
    // =========================================================================
    
    function assignMatchupsToFieldsAndSports(matchups, availablePool, leagueName, history, slots) {
        const assignments = [];
        const usedFields = new Set();
        const usedSportsThisSlot = {};
        
        function getTeamSportNeed(team, sport) {
            const teamHistory = getTeamSportHistory(leagueName, team, history);
            const sportCount = teamHistory.filter(s => s === sport).length;
            
            if (sportCount === 0) return 1000;
            return Math.max(0, 100 - sportCount * 20);
        }
        
        const matchupsWithPriority = matchups.map(([t1, t2]) => {
            const h1 = getTeamSportHistory(leagueName, t1, history);
            const h2 = getTeamSportHistory(leagueName, t2, history);
            const uniqueSports1 = new Set(h1).size;
            const uniqueSports2 = new Set(h2).size;
            return { t1, t2, varietyScore: uniqueSports1 + uniqueSports2 };
        });
        
        matchupsWithPriority.sort((a, b) => a.varietyScore - b.varietyScore);
        
        for (const { t1, t2 } of matchupsWithPriority) {
            let bestOption = null;
            let bestScore = -Infinity;
            
            for (const option of availablePool) {
                if (usedFields.has(option.field)) continue;
                
                let score = 0;
                
                const need1 = getTeamSportNeed(t1, option.sport);
                const need2 = getTeamSportNeed(t2, option.sport);
                score += need1 + need2;
                
                const sportUsageThisSlot = usedSportsThisSlot[option.sport] || 0;
                if (sportUsageThisSlot === 0) {
                    score += 500;
                } else {
                    score -= sportUsageThisSlot * 100;
                }
                
                score += Math.random() * 10;
                
                if (score > bestScore) {
                    bestScore = score;
                    bestOption = option;
                }
            }
            
            if (bestOption) {
                assignments.push({
                    team1: t1,
                    team2: t2,
                    matchup: `${t1} vs ${t2}`,
                    field: bestOption.field,
                    sport: bestOption.sport
                });
                
                usedFields.add(bestOption.field);
                usedSportsThisSlot[bestOption.sport] = (usedSportsThisSlot[bestOption.sport] || 0) + 1;
                
                console.log(`   ✅ ${t1} vs ${t2} → ${bestOption.sport} @ ${bestOption.field}`);
            } else {
                console.log(`   ❌ No field available for ${t1} vs ${t2}`);
            }
        }
        
        return assignments;
    }

    // =========================================================================
    // ★★★ MAIN REGULAR LEAGUE PROCESSOR ★★★
    // =========================================================================
    
    Leagues.processRegularLeagues = function (context) {
        console.log("\n" + "=".repeat(60));
        console.log("★★★ REGULAR LEAGUE ENGINE START (PRIORITY 2) ★★★");
        console.log("=".repeat(60));
        
        const { 
            schedulableSlotBlocks, 
            masterLeagues, 
            disabledLeagues,
            divisions,
            fillBlock,
            fieldUsageBySlot,
            activityProperties,
            rotationHistory,
            currentDay  // ★★★ NEED THIS FROM CONTEXT ★★★
        } = context;

        if (!masterLeagues || Object.keys(masterLeagues).length === 0) {
            console.log("[RegularLeagues] No regular leagues configured.");
            return;
        }
        
        const history = loadLeagueHistory();
        
        // ★★★ GET CURRENT DAY IDENTIFIER ★★★
        // Try multiple sources for the day identifier
        const dayIdentifier = currentDay 
            || context.date 
            || context.dayOfWeek 
            || context.selectedDay 
            || window.currentScheduleDay 
            || new Date().toDateString();
        
        console.log(`[RegularLeagues] Current day identifier: "${dayIdentifier}"`);

        // Group blocks by time
        const blocksByTime = {};
        
        schedulableSlotBlocks
            .filter(b => b.type === 'league' || /league/i.test(b.event))
            .filter(b => !b.processed) // Skip already processed blocks
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
            
            console.log(`\n📅 Processing League Time Slot: ${timeKey}`);
            console.log(`   Divisions present: [${divisionsAtTime.join(", ")}]`);
            
            // Get slots for this time
            const sampleBlock = timeData.allBlocks[0];
            const slots = sampleBlock?.slots || [];
            
            const processedLeagues = new Set();

            const applicableLeagues = Object.values(masterLeagues).filter(l => {
                if (!l.enabled) return false;
                if (disabledLeagues?.includes(l.name)) return false;
                if (!l.divisions || l.divisions.length === 0) return false;
                return divisionsAtTime.some(div => l.divisions.includes(div));
            });

            for (const league of applicableLeagues) {
                if (processedLeagues.has(league.name)) continue;
                processedLeagues.add(league.name);

                const leagueDivisions = league.divisions.filter(div => divisionsAtTime.includes(div));
                if (leagueDivisions.length === 0) continue;

                console.log(`\n📋 League: "${league.name}"`);
                console.log(`   Teams: [${(league.teams || []).join(", ")}]`);
                console.log(`   Sports: [${(league.sports || []).join(", ")}]`);
                console.log(`   Active Divisions: [${leagueDivisions.join(", ")}]`);

                const leagueTeams = league.teams || [];
                if (leagueTeams.length < 2) {
                    console.log(`   ⚠️ Not enough teams`);
                    continue;
                }

                // ★★★ CHECK IF THIS IS A NEW DAY FOR THIS LEAGUE ★★★
                const lastDay = history.lastScheduledDay[league.name];
                const isNewDay = (lastDay !== dayIdentifier);
                
                let roundCounter = history.roundCounters[league.name] || 0;
                
                if (isNewDay) {
                    // New day - increment the counter
                    console.log(`   🆕 New day detected (last: "${lastDay || 'none'}", now: "${dayIdentifier}")`);
                    // Note: We'll increment AFTER processing, so the first day uses round 0
                    if (lastDay !== undefined) {
                        // Only increment if this isn't the very first time
                        roundCounter = (history.roundCounters[league.name] || 0) + 1;
                        history.roundCounters[league.name] = roundCounter;
                    }
                    history.lastScheduledDay[league.name] = dayIdentifier;
                } else {
                    console.log(`   🔄 Same day regeneration - keeping Game ${roundCounter + 1}`);
                }

                const fullSchedule = generateRoundRobinSchedule(leagueTeams);
                const roundIndex = roundCounter % fullSchedule.length;
                const matchups = fullSchedule[roundIndex] || [];
                
                console.log(`   Round: ${roundCounter + 1} (Index: ${roundIndex})`);
                console.log(`   Matchups: ${matchups.length}`);
                matchups.forEach(([t1, t2]) => console.log(`      • ${t1} vs ${t2}`));

                if (matchups.length === 0) continue;

                // ★★★ BUILD POOL - RESPECTS GLOBAL LOCKS ★★★
                const leagueSports = league.sports || ["General Sport"];
                const availablePool = buildAvailableFieldSportPool(
                    leagueSports, 
                    context, 
                    leagueDivisions, 
                    timeKey,
                    slots
                );
                
                console.log(`   Available Field/Sport Combinations: ${availablePool.length}`);
                availablePool.slice(0, 10).forEach(p => 
                    console.log(`      • ${p.sport} @ ${p.field}`)
                );

                if (availablePool.length === 0) {
                    console.log(`   🚨 No fields available for league sports!`);
                    continue;
                }

                const assignments = assignMatchupsToFieldsAndSports(
                    matchups, 
                    availablePool, 
                    league.name, 
                    history,
                    slots
                );

                if (assignments.length === 0) {
                    console.log(`   ❌ No assignments possible`);
                    continue;
                }

                // ★★★ CRITICAL: LOCK ALL USED FIELDS GLOBALLY ★★★
                const usedFields = [...new Set(assignments.map(a => a.field))];
                console.log(`\n   🔒 LOCKING FIELDS: ${usedFields.join(', ')}`);
                
                if (window.GlobalFieldLocks && slots.length > 0) {
                    window.GlobalFieldLocks.lockMultipleFields(usedFields, slots, {
                        lockedBy: 'regular_league',
                        leagueName: league.name,
                        division: leagueDivisions.join(', '),
                        activity: `${league.name} League Game`
                    });
                }

                // Also lock in fieldUsageBySlot for compatibility
                slots.forEach(slotIdx => {
                    usedFields.forEach(fieldName => {
                        if (!fieldUsageBySlot[slotIdx]) fieldUsageBySlot[slotIdx] = {};
                        fieldUsageBySlot[slotIdx][fieldName] = {
                            count: 999,
                            divisions: leagueDivisions,
                            bunks: {},
                            _lockedByRegularLeague: league.name
                        };
                    });
                });

                console.log(`\n   📝 Final Assignments:`);
                assignments.forEach(a => {
                    console.log(`      ✅ ${a.team1} vs ${a.team2} → ${a.sport} @ ${a.field}`);
                    
                    // ★★★ ONLY RECORD SPORT HISTORY ON NEW DAY ★★★
                    if (isNewDay) {
                        recordTeamSport(league.name, a.team1, a.sport, history);
                        recordTeamSport(league.name, a.team2, a.sport, history);
                    }
                });

                const gameNumber = roundCounter + 1;
                
                leagueDivisions.forEach(divName => {
                    const blocksForDiv = timeData.byDivision[divName];
                    if (!blocksForDiv) return;
                    
                    blocksForDiv.forEach(block => {
                        const pick = {
                            field: `League: ${league.name}`,
                            sport: `Game ${gameNumber}`,
                            _activity: `League: ${league.name}`,
                            _h2h: true,
                            _fixed: true,
                            _allMatchups: assignments.map(a => 
                                `${a.team1} vs ${a.team2} @ ${a.field} (${a.sport})`
                            ),
                            _gameLabel: `Game ${gameNumber}`
                        };

                        fillBlock(block, pick, fieldUsageBySlot, {}, true, activityProperties);
                        block.processed = true;
                    });
                });

                // ★★★ REMOVED: No longer increment here - done above only on new day ★★★
                // history.roundCounters[league.name] = roundCounter + 1;
                
                if (!window.leagueRoundState) window.leagueRoundState = {};
                window.leagueRoundState[league.name] = { currentRound: roundCounter + 1 };
            }
        }

        saveLeagueHistory(history);

        console.log("\n" + "=".repeat(60));
        console.log("★★★ REGULAR LEAGUE ENGINE COMPLETE ★★★");
        console.log("=".repeat(60));
        
        // Debug print current lock state
        if (window.GlobalFieldLocks) {
            window.GlobalFieldLocks.debugPrintLocks();
        }
    };

    // =========================================================================
    // SPECIALTY LEAGUES (Delegate to dedicated processor)
    // =========================================================================
    
    Leagues.processSpecialtyLeagues = function (context) {
        // Delegate to the dedicated specialty leagues processor
        if (window.SchedulerCoreSpecialtyLeagues?.processSpecialtyLeagues) {
            window.SchedulerCoreSpecialtyLeagues.processSpecialtyLeagues(context);
        } else {
            console.warn("[Leagues] SchedulerCoreSpecialtyLeagues not loaded!");
        }
    };

    // =========================================================================
    // DIAGNOSTIC UTILITIES
    // =========================================================================
    
    window.viewLeagueHistory = function() {
        const history = loadLeagueHistory();
        console.log("\n=== COMPLETE LEAGUE HISTORY ===");
        console.log(JSON.stringify(history, null, 2));
        return history;
    };
    
    window.resetLeagueHistory = function() {
        if (confirm("Reset ALL league history? This will start fresh.")) {
            localStorage.removeItem(LEAGUE_HISTORY_KEY);
            console.log("League history reset.");
        }
    };
    
    window.viewTeamSportBalance = function(leagueName) {
        const history = loadLeagueHistory();
        console.log(`\n=== Sport Balance for League: ${leagueName} ===`);
        
        const teamStats = {};
        Object.keys(history.teamSports).forEach(key => {
            if (!key.startsWith(leagueName + '|')) return;
            const team = key.split('|')[1];
            const sports = history.teamSports[key];
            
            const counts = {};
            sports.forEach(s => counts[s] = (counts[s] || 0) + 1);
            teamStats[team] = counts;
        });
        
        console.table(teamStats);
        return teamStats;
    };

    window.SchedulerCoreLeagues = Leagues;

    console.log('[RegularLeagues] Module loaded with Global Lock integration + Day-Aware Counter');

})();
