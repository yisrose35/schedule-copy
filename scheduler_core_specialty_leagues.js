// ============================================================================
// scheduler_core_specialty_leagues.js
// 
// DEDICATED SCHEDULER CORE FOR SPECIALTY LEAGUES
// Similar to scheduler_core_leagues.js but tailored for specialty leagues:
// - Single sport per league
// - Multiple games per field per time slot
// - Conference system (East/West) with inter-conference play
// - Fairness algorithms: Wait Priority + Field Rotation
// ============================================================================

(function() {
    'use strict';

    const SpecialtyLeagues = {};

    // =========================================================================
    // PERSISTENT HISTORY KEY
    // =========================================================================
    const SPECIALTY_HISTORY_KEY = "campSpecialtyLeagueHistory_v1";

    // =========================================================================
    // LOAD/SAVE HISTORY
    // =========================================================================
    function loadSpecialtyHistory() {
        try {
            const raw = localStorage.getItem(SPECIALTY_HISTORY_KEY);
            if (!raw) return { 
                teamFieldRotation: {},    // { leagueId|team: [field1, field2, ...] }
                lastSlotOrder: {},        // { leagueId|team: slotOrder }
                roundCounters: {},        // { leagueId: roundNumber }
                conferenceRounds: {},     // { leagueId|conf: roundNumber }
                matchupHistory: {},       // { leagueId|teamA|teamB: [dates] }
                lastScheduledDate: {}     // { leagueId: "YYYY-MM-DD" } - tracks when round was last incremented
            };
            return JSON.parse(raw);
        } catch (e) {
            console.error("[SpecialtyLeagues] Failed to load history:", e);
            return { teamFieldRotation: {}, lastSlotOrder: {}, roundCounters: {}, conferenceRounds: {}, matchupHistory: {}, lastScheduledDate: {} };
        }
    }

    function saveSpecialtyHistory(history) {
        try {
            localStorage.setItem(SPECIALTY_HISTORY_KEY, JSON.stringify(history));
        } catch (e) {
            console.error("[SpecialtyLeagues] Failed to save history:", e);
        }
    }

    // =========================================================================
    // HELPER: Load specialty leagues from global settings
    // =========================================================================
    function loadSpecialtyLeagues() {
        const global = window.loadGlobalSettings?.() || {};
        return global.specialtyLeagues || {};
    }

    // =========================================================================
    // FAIRNESS ALGORITHM: Wait Priority Score
    // =========================================================================
    // Teams that played 2nd or 3rd in their slot yesterday get HIGHER priority to play first today
    function getWaitPriorityScore(teamA, teamB, lastSlotOrder, leagueId) {
        const keyA = `${leagueId}|${teamA}`;
        const keyB = `${leagueId}|${teamB}`;
        
        const slotA = lastSlotOrder[keyA] || 1;
        const slotB = lastSlotOrder[keyB] || 1;
        
        // Higher slot order = waited longer = higher priority
        // Slot 3 (waited most) = 100 points, Slot 2 = 50 points, Slot 1 = 0 points
        const scoreA = (slotA - 1) * 50;
        const scoreB = (slotB - 1) * 50;
        
        return scoreA + scoreB;
    }

    // =========================================================================
    // FAIRNESS ALGORITHM: Field Rotation Score
    // =========================================================================
    // Teams should play on all courts before repeating any court
    function getFieldRotationScore(teamA, teamB, fieldName, teamFieldRotation, allFields, leagueId) {
        const keyA = `${leagueId}|${teamA}`;
        const keyB = `${leagueId}|${teamB}`;
        
        const fieldsA = teamFieldRotation[keyA] || [];
        const fieldsB = teamFieldRotation[keyB] || [];
        
        // Count how many times each team has played on this field
        const countA = fieldsA.filter(f => f === fieldName).length;
        const countB = fieldsB.filter(f => f === fieldName).length;
        
        // If neither team has played on this field, big bonus
        if (countA === 0 && countB === 0) return 200;
        
        // If one team hasn't played on this field, medium bonus
        if (countA === 0 || countB === 0) return 100;
        
        // Check if both teams have played on all fields at least once
        const allFieldsSet = new Set(allFields);
        const uniqueA = new Set(fieldsA);
        const uniqueB = new Set(fieldsB);
        
        const missingA = [...allFieldsSet].filter(f => !uniqueA.has(f));
        const missingB = [...allFieldsSet].filter(f => !uniqueB.has(f));
        
        // Penalty if this field is being repeated before all fields are used
        if (missingA.length > 0 || missingB.length > 0) {
            return -100 * (countA + countB);
        }
        
        // Small penalty for repetition
        return -10 * (countA + countB);
    }

    // =========================================================================
    // ROUND ROBIN GENERATOR (within conference or full league)
    // =========================================================================
    function generateRoundRobin(teams) {
        if (!teams || teams.length < 2) return [];
        
        const rounds = [];
        const teamsCopy = [...teams];
        
        // Add dummy if odd number
        if (teamsCopy.length % 2 === 1) {
            teamsCopy.push(null); // bye
        }
        
        const numRounds = teamsCopy.length - 1;
        const half = teamsCopy.length / 2;
        
        for (let round = 0; round < numRounds; round++) {
            const matches = [];
            
            for (let i = 0; i < half; i++) {
                const team1 = teamsCopy[i];
                const team2 = teamsCopy[teamsCopy.length - 1 - i];
                
                if (team1 && team2) {
                    matches.push({ teamA: team1, teamB: team2 });
                }
            }
            
            rounds.push(matches);
            
            // Rotate teams (keep first team fixed)
            const last = teamsCopy.pop();
            teamsCopy.splice(1, 0, last);
        }
        
        return rounds;
    }

    // =========================================================================
    // GET TODAY'S MATCHUPS FOR A LEAGUE
    // =========================================================================
    function getLeagueMatchupsForToday(league, history) {
        const { id, teams, conferences, allowInterConference, interConferencePriority } = league;
        
        if (!teams || teams.length < 2) return [];
        
        let matchups = [];
        
        // Check if we have conferences
        const conferenceNames = Object.keys(conferences || {}).filter(c => (conferences[c]?.length || 0) > 0);
        
        if (conferenceNames.length > 0) {
            // Generate intra-conference matchups
            conferenceNames.forEach(confName => {
                const confTeams = conferences[confName] || [];
                const roundRobin = generateRoundRobin(confTeams);
                
                // Get current round for this conference
                const confKey = `${id}|${confName}`;
                const currentRound = (history.conferenceRounds[confKey] || 0) % Math.max(1, roundRobin.length);
                
                if (roundRobin[currentRound]) {
                    matchups.push(...roundRobin[currentRound].map(m => ({
                        ...m,
                        conference: confName,
                        isInterConference: false
                    })));
                }
            });
            
            // Optionally add inter-conference matchups
            if (allowInterConference && conferenceNames.length >= 2) {
                const conf1Teams = conferences[conferenceNames[0]] || [];
                const conf2Teams = conferences[conferenceNames[1]] || [];
                
                // Simple inter-conference round robin based on current round
                const interKey = `${id}|inter`;
                const interRound = (history.conferenceRounds[interKey] || 0) % Math.max(1, Math.max(conf1Teams.length, conf2Teams.length));
                
                conf1Teams.forEach((team1, idx) => {
                    const team2Idx = (idx + interRound) % conf2Teams.length;
                    const team2 = conf2Teams[team2Idx];
                    
                    if (team1 && team2) {
                        // Only add based on priority chance
                        if (Math.random() < (interConferencePriority || 0.3)) {
                            matchups.push({
                                teamA: team1,
                                teamB: team2,
                                conference: "Inter-Conference",
                                isInterConference: true
                            });
                        }
                    }
                });
            }
        } else {
            // No conferences - use all teams
            const roundRobin = generateRoundRobin(teams);
            const currentRound = (history.roundCounters[id] || 0) % Math.max(1, roundRobin.length);
            
            if (roundRobin[currentRound]) {
                matchups = roundRobin[currentRound].map(m => ({
                    ...m,
                    conference: null,
                    isInterConference: false
                }));
            }
        }
        
        return matchups;
    }

    // =========================================================================
    // ASSIGN MATCHUPS TO FIELDS WITH FAIRNESS
    // =========================================================================
    function assignMatchupsToFieldsAndSlots(matchups, league, history) {
        const { id, fields, gamesPerFieldSlot } = league;
        
        if (!fields || fields.length === 0) {
            console.warn(`[SpecialtyLeagues] No fields for league ${league.name}`);
            return [];
        }
        
        const totalSlotsAvailable = fields.length * (gamesPerFieldSlot || 3);
        
        console.log(`[SpecialtyLeagues] Fields: ${fields.join(', ')}`);
        console.log(`[SpecialtyLeagues] Total slots available: ${totalSlotsAvailable} (${fields.length} fields × ${gamesPerFieldSlot || 3} games)`);
        
        // Limit matchups to available slots if needed
        let workingMatchups = [...matchups];
        if (workingMatchups.length > totalSlotsAvailable) {
            // Score by wait priority and take highest
            workingMatchups = workingMatchups.map(m => ({
                ...m,
                waitScore: getWaitPriorityScore(m.teamA, m.teamB, history.lastSlotOrder, id)
            }));
            workingMatchups.sort((a, b) => b.waitScore - a.waitScore);
            workingMatchups = workingMatchups.slice(0, totalSlotsAvailable);
        }
        
        console.log(`[SpecialtyLeagues] Working matchups: ${workingMatchups.length}`);
        
        // STRATEGY: Distribute matchups across ALL fields first, then fill slot orders
        // This ensures all courts get used before any court gets multiple games
        
        const assignments = [];
        const assignedMatchups = new Set();
        const fieldGamesCount = {};  // Track games per field
        fields.forEach(f => fieldGamesCount[f] = 0);
        
        // Sort matchups by wait priority (highest first)
        workingMatchups = workingMatchups.map(m => ({
            ...m,
            waitScore: getWaitPriorityScore(m.teamA, m.teamB, history.lastSlotOrder, id)
        }));
        workingMatchups.sort((a, b) => b.waitScore - a.waitScore);
        
        // Assign matchups round-robin across fields to ensure even distribution
        for (const matchup of workingMatchups) {
            const matchupKey = `${matchup.teamA}-${matchup.teamB}`;
            if (assignedMatchups.has(matchupKey)) continue;
            
            // Find the field with the fewest games (ensures all fields get used)
            let bestField = null;
            let minGames = Infinity;
            
            for (const field of fields) {
                const currentGames = fieldGamesCount[field];
                const maxGames = gamesPerFieldSlot || 3;
                
                if (currentGames < maxGames && currentGames < minGames) {
                    // Also consider field rotation score
                    const rotationScore = getFieldRotationScore(matchup.teamA, matchup.teamB, field, history.teamFieldRotation, fields, id);
                    
                    // Prefer fields with fewer games, tie-break by rotation score
                    if (currentGames < minGames || (currentGames === minGames && rotationScore > 0)) {
                        minGames = currentGames;
                        bestField = field;
                    }
                }
            }
            
            if (bestField) {
                const slotOrder = fieldGamesCount[bestField] + 1;
                assignments.push({
                    teamA: matchup.teamA,
                    teamB: matchup.teamB,
                    field: bestField,
                    slotOrder: slotOrder,
                    conference: matchup.conference,
                    isInterConference: matchup.isInterConference
                });
                
                fieldGamesCount[bestField]++;
                assignedMatchups.add(matchupKey);
                console.log(`[SpecialtyLeagues] Assigned ${matchup.teamA} vs ${matchup.teamB} to ${bestField} (slot ${slotOrder})`);
            }
        }
        
        // Sort by field then slot order for display
        assignments.sort((a, b) => {
            if (a.field !== b.field) return a.field.localeCompare(b.field);
            return a.slotOrder - b.slotOrder;
        });
        
        // Log field distribution
        console.log(`[SpecialtyLeagues] Field distribution: ${Object.entries(fieldGamesCount).map(([f, c]) => `${f}:${c}`).join(', ')}`);
        
        return assignments;
    }

    // =========================================================================
    // UPDATE HISTORY AFTER SCHEDULING
    // =========================================================================
    function updateHistoryAfterScheduling(league, assignments, history) {
        const { id, conferences } = league;
        const currentDate = window.currentScheduleDate || new Date().toISOString().slice(0, 10);
        
        // Check if this is a new day for this league
        if (!history.lastScheduledDate) history.lastScheduledDate = {};
        const isNewDay = history.lastScheduledDate[id] !== currentDate;
        
        // Only update field rotation and slot order if it's a new day
        // (prevents duplicate history entries when regenerating same day)
        if (isNewDay) {
            // Update field rotation and slot order for each team
            assignments.forEach(game => {
                const keyA = `${id}|${game.teamA}`;
                const keyB = `${id}|${game.teamB}`;
                
                // Field rotation
                if (!history.teamFieldRotation[keyA]) history.teamFieldRotation[keyA] = [];
                if (!history.teamFieldRotation[keyB]) history.teamFieldRotation[keyB] = [];
                history.teamFieldRotation[keyA].push(game.field);
                history.teamFieldRotation[keyB].push(game.field);
                
                // Last slot order
                history.lastSlotOrder[keyA] = game.slotOrder;
                history.lastSlotOrder[keyB] = game.slotOrder;
                
                // Matchup history
                const matchupKey = [game.teamA, game.teamB].sort().join('|');
                const fullKey = `${id}|${matchupKey}`;
                if (!history.matchupHistory[fullKey]) history.matchupHistory[fullKey] = [];
                history.matchupHistory[fullKey].push(currentDate);
            });
            
            // Increment round counters ONLY on new day
            const conferenceNames = Object.keys(conferences || {}).filter(c => (conferences[c]?.length || 0) > 0);
            
            if (conferenceNames.length > 0) {
                conferenceNames.forEach(conf => {
                    const confKey = `${id}|${conf}`;
                    history.conferenceRounds[confKey] = (history.conferenceRounds[confKey] || 0) + 1;
                });
                
                if (league.allowInterConference) {
                    const interKey = `${id}|inter`;
                    history.conferenceRounds[interKey] = (history.conferenceRounds[interKey] || 0) + 1;
                }
            } else {
                history.roundCounters[id] = (history.roundCounters[id] || 0) + 1;
            }
            
            // Mark this date as scheduled for this league
            history.lastScheduledDate[id] = currentDate;
            
            console.log(`[SpecialtyLeagues] New day (${currentDate}) - incremented round counter`);
        } else {
            console.log(`[SpecialtyLeagues] Same day (${currentDate}) - round counter unchanged`);
        }
    }

    // =========================================================================
    // MAIN PROCESSOR: Process Specialty Leagues for Optimizer
    // =========================================================================
    SpecialtyLeagues.processSpecialtyLeagues = function(context) {
        console.log("\n=== SPECIALTY LEAGUE SCHEDULER START ===");
        
        const {
            schedulableSlotBlocks,
            divisions,
            fieldUsageBySlot,
            activityProperties,
            fillBlock,
            disabledSpecialtyLeagues
        } = context;

        // Load specialty leagues configuration
        const specialtyLeaguesConfig = loadSpecialtyLeagues();
        
        if (!specialtyLeaguesConfig || Object.keys(specialtyLeaguesConfig).length === 0) {
            console.log("[SpecialtyLeagues] No specialty leagues configured.");
            return;
        }
        
        // Load persistent history
        const history = loadSpecialtyHistory();
        
        // Find all specialty league blocks from skeleton
        const specialtyBlocks = schedulableSlotBlocks.filter(b => 
            b.type === 'specialty_league' || 
            (b.event && b.event.toLowerCase().includes('specialty league'))
        );
        
        if (specialtyBlocks.length === 0) {
            console.log("[SpecialtyLeagues] No specialty league blocks in skeleton.");
            return;
        }
        
        console.log(`[SpecialtyLeagues] Found ${specialtyBlocks.length} specialty league blocks`);
        
        // Group blocks by division and time
        const blocksByDivisionTime = {};
        specialtyBlocks.forEach(block => {
            const key = `${block.divName}_${block.startTime}`;
            if (!blocksByDivisionTime[key]) {
                blocksByDivisionTime[key] = [];
            }
            blocksByDivisionTime[key].push(block);
        });
        
        // Process each division/time combination
        for (const [key, blocks] of Object.entries(blocksByDivisionTime)) {
            const [divName, startTime] = key.split('_');
            
            console.log(`\n[SpecialtyLeagues] Processing ${divName} @ ${startTime}`);
            
            // Find applicable league for this division
            const league = Object.values(specialtyLeaguesConfig).find(l => {
                if (!l.enabled) return false;
                if (disabledSpecialtyLeagues?.includes(l.name)) return false;
                if (!l.divisions || !l.divisions.includes(divName)) return false;
                return true;
            });
            
            if (!league) {
                console.log(`[SpecialtyLeagues] No enabled league for division ${divName}`);
                continue;
            }
            
            console.log(`[SpecialtyLeagues] Using league: ${league.name}`);
            console.log(`[SpecialtyLeagues] Teams: ${(league.teams || []).join(', ')}`);
            console.log(`[SpecialtyLeagues] Fields: ${(league.fields || []).join(', ')}`);
            console.log(`[SpecialtyLeagues] Sport: ${league.sport}`);
            
            // Get today's matchups
            const matchups = getLeagueMatchupsForToday(league, history);
            
            if (matchups.length === 0) {
                console.log(`[SpecialtyLeagues] No matchups generated`);
                continue;
            }
            
            console.log(`[SpecialtyLeagues] Generated ${matchups.length} matchups`);
            matchups.forEach(m => console.log(`   • ${m.teamA} vs ${m.teamB} (${m.conference || 'No Conference'})`));
            
            // Assign matchups to fields with fairness
            const assignments = assignMatchupsToFieldsAndSlots(matchups, league, history);
            
            if (assignments.length === 0) {
                console.log(`[SpecialtyLeagues] No assignments made (no fields?)`);
                continue;
            }
            
            console.log(`\n[SpecialtyLeagues] Final Assignments:`);
            assignments.forEach(a => {
                console.log(`   ${a.teamA} vs ${a.teamB} @ ${a.field} (Slot ${a.slotOrder})`);
            });
            
            // Build matchup display strings - ONLY "TeamA vs TeamB — CourtName"
            // NO "undefined @" - just team names and court
            const matchupStrings = assignments.map(a => 
                `${a.teamA} vs ${a.teamB} — ${a.field}`
            );
            
            // Calculate current round (add 1 because counter is 0-indexed before first increment)
            const roundNum = (history.roundCounters[league.id] || 0) + 1;
            // Format: "{League Name} Game {X}" - NO "Specialty League" prefix
            const gameLabel = `${league.name} Game ${roundNum}`;
            
            // ============ LOCK FIELDS FOR SPECIALTY LEAGUE ============
            // Prevent other activities from using these fields during this time slot
            const usedFields = new Set(assignments.map(a => a.field));
            blocks.forEach(block => {
                block.slots.forEach(slotIdx => {
                    usedFields.forEach(fieldName => {
                        if (!fieldUsageBySlot[slotIdx]) fieldUsageBySlot[slotIdx] = {};
                        // Mark field as fully used (capacity exhausted)
                        fieldUsageBySlot[slotIdx][fieldName] = {
                            count: 999, // Max out usage
                            divisions: [divName],
                            bunks: {},
                            _lockedBySpecialtyLeague: league.name
                        };
                        console.log(`[SpecialtyLeagues] Locked field "${fieldName}" at slot ${slotIdx}`);
                    });
                });
            });
            
            // Fill all blocks in this division/time with the league data
            blocks.forEach(block => {
                const pick = {
                    field: gameLabel,  // Shows as "{League Name} Game {X}" - NO prefix
                    sport: league.sport || 'League',
                    _activity: gameLabel,
                    _h2h: true,
                    _fixed: true,
                    _allMatchups: matchupStrings,
                    _gameLabel: gameLabel,
                    _leagueName: league.name,
                    _isSpecialtyLeague: true,  // Flag for UI to NOT add "Specialty League" prefix
                    _assignments: assignments  // Store full assignment data
                };
                
                fillBlock(block, pick, fieldUsageBySlot, {}, true, activityProperties);
                block.processed = true;
            });
            
            // Update history for this league
            updateHistoryAfterScheduling(league, assignments, history);
            
            // Also store in leagueAssignments for UI
            if (!window.leagueAssignments) window.leagueAssignments = {};
            if (!window.leagueAssignments[divName]) window.leagueAssignments[divName] = {};
            
            const slotIdx = blocks[0]?.slots?.[0];
            if (slotIdx !== undefined) {
                window.leagueAssignments[divName][slotIdx] = {
                    leagueName: league.name,
                    sport: league.sport,
                    gameLabel: gameLabel,
                    isSpecialtyLeague: true,  // Flag for UI
                    matchups: assignments.map(a => ({
                        teamA: a.teamA,
                        teamB: a.teamB,
                        field: a.field,
                        slotOrder: a.slotOrder,
                        conference: a.conference || null
                    }))
                };
            }
        }
        
        // Save updated history
        saveSpecialtyHistory(history);
        
        console.log("\n=== SPECIALTY LEAGUE SCHEDULER COMPLETE ===");
    };

    // =========================================================================
    // UTILITY: Get schedule for today (for UI)
    // =========================================================================
    SpecialtyLeagues.getSpecialtyLeagueScheduleForToday = function(leagueId) {
        const config = loadSpecialtyLeagues();
        const league = config[leagueId];
        
        if (!league) return null;
        
        const history = loadSpecialtyHistory();
        const matchups = getLeagueMatchupsForToday(league, history);
        const assignments = assignMatchupsToFieldsAndSlots(matchups, league, history);
        
        return {
            leagueName: league.name,
            sport: league.sport,
            fields: league.fields,
            gamesPerField: league.gamesPerFieldSlot || 3,
            assignments: assignments
        };
    };

    // =========================================================================
    // UTILITY: Reset specialty league history
    // =========================================================================
    SpecialtyLeagues.resetHistory = function() {
        if (confirm("Reset ALL specialty league history? This will start fresh.")) {
            localStorage.removeItem(SPECIALTY_HISTORY_KEY);
            console.log("[SpecialtyLeagues] History reset.");
            alert("Specialty League history has been reset.");
        }
    };

    // =========================================================================
    // UTILITY: View history (for debugging)
    // =========================================================================
    SpecialtyLeagues.viewHistory = function() {
        const history = loadSpecialtyHistory();
        console.log("\n=== SPECIALTY LEAGUE HISTORY ===");
        console.log(JSON.stringify(history, null, 2));
        return history;
    };

    // =========================================================================
    // UTILITY: View team stats
    // =========================================================================
    SpecialtyLeagues.viewTeamStats = function(leagueId) {
        const history = loadSpecialtyHistory();
        const config = loadSpecialtyLeagues();
        const league = config[leagueId];
        
        if (!league) {
            console.log("League not found");
            return;
        }
        
        console.log(`\n=== TEAM STATS: ${league.name} ===`);
        
        const teams = league.teams || [];
        const stats = {};
        
        teams.forEach(team => {
            const key = `${leagueId}|${team}`;
            const fieldHistory = history.teamFieldRotation[key] || [];
            const lastSlot = history.lastSlotOrder[key] || 'N/A';
            
            // Count field usage
            const fieldCounts = {};
            fieldHistory.forEach(f => {
                fieldCounts[f] = (fieldCounts[f] || 0) + 1;
            });
            
            stats[team] = {
                gamesPlayed: fieldHistory.length,
                lastSlotOrder: lastSlot,
                fieldUsage: fieldCounts
            };
        });
        
        console.table(stats);
        return stats;
    };

    // =========================================================================
    // EXPOSE GLOBALLY
    // =========================================================================
    window.SchedulerCoreSpecialtyLeagues = SpecialtyLeagues;
    
    // Also add to existing SchedulerCoreLeagues for compatibility
    if (window.SchedulerCoreLeagues) {
        window.SchedulerCoreLeagues.processSpecialtyLeagues = SpecialtyLeagues.processSpecialtyLeagues;
    }

})();
