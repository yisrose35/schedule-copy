// ============================================================================
// scheduler_core_leagues.js
// PART 2 of 3: THE SPECIALIST (TIMELINE EDITION)
//
// Role:
// - League Matchmaking Math (Round Robin, Shuffling)
// - Specialty League Placement (Pass 2)
// - Regular League Placement (Pass 2.5)
// - UPDATED: Calls fillBlock with isLeague=true for Full Buyouts.
// - FIX: Generates matchups even if no fields are defined (assigns "No Field").
// ============================================================================

(function() {
    'use strict';

    const Leagues = {};
    const INCREMENT_MINS = 30; // Matches global config

    // =================================================================
    // 1. MATH HELPERS
    // =================================================================
    Leagues.shuffleArray = function(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    };

    Leagues.pairRoundRobin = function(teams) {
        if (teams.length < 2) return [];
        const t = teams.slice();
        if (t.length % 2 !== 0) t.push("BYE");
        const pairs = [];
        const half = t.length / 2;
        const top = t.slice(0, half);
        const bottom = t.slice(half).reverse();
        for (let i = 0; i < half; i++) {
            pairs.push([top[i], bottom[i]]);
        }
        return pairs;
    };

    Leagues.coreGetNextLeagueRound = function(leagueName, teams) {
        const shuffled = teams.slice();
        Leagues.shuffleArray(shuffled);
        return Leagues.pairRoundRobin(shuffled);
    };

    Leagues.assignSportsMultiRound = function(matchups, sports, teamCounts, history, lastSport) {
        const assignments = [];
        matchups.forEach((pair, i) => {
            if (!pair || pair.includes("BYE")) {
                assignments.push({ sport: null });
                return;
            }
            if (!sports || sports.length === 0) {
                assignments.push({ sport: "League Game" });
                return;
            }
            const s = sports[i % sports.length];
            assignments.push({ sport: s });
        });
        return {
            assignments,
            updatedTeamCounts: teamCounts || {},
            updatedLastSports: lastSport || {}
        };
    };

    // =================================================================
    // 2. PASS 2: SPECIALTY LEAGUES
    // =================================================================
    Leagues.processSpecialtyLeagues = function(context) {
        const {
            schedulableSlotBlocks, activityProperties,
            masterSpecialtyLeagues, disabledSpecialtyLeagues, rotationHistory,
            yesterdayHistory, fillBlock
        } = context;

        const specialtyLeagueBlocks = schedulableSlotBlocks.filter(
            b => b.event === 'Specialty League' && !b.processed
        );

        const groups = {};
        specialtyLeagueBlocks.forEach(block => {
            const key = `${block.divName}-${block.startTime}`;
            if (!groups[key]) {
                groups[key] = {
                    divName: block.divName,
                    startTime: block.startTime,
                    endTime: block.endTime,
                    slots: block.slots,
                    bunks: new Set()
                };
            }
            groups[key].bunks.add(block.bunk);
        });

        Object.values(groups).forEach(group => {
            const leagueEntry = Object.values(masterSpecialtyLeagues).find(
                l => l.enabled &&
                     !disabledSpecialtyLeagues.includes(l.name) &&
                     l.divisions.includes(group.divName)
            );
            
            // If no league config found, we can't schedule matchups.
            // Consider logging this or handling graceful failure.
            if (!leagueEntry) return;

            const allBunksInGroup = Array.from(group.bunks);
            const blockBase = {
                slots: group.slots,
                divName: group.divName,
                startTime: group.startTime,
                endTime: group.endTime
            };
            const leagueName = leagueEntry.name;
            const bestSport = leagueEntry.sport || "Specialty League";
            
            const leagueTeams = (leagueEntry.teams || []).map(t => String(t).trim()).filter(Boolean);
            let matchups = [];
            if (typeof window.getLeagueMatchups === 'function') {
                matchups = window.getLeagueMatchups(leagueEntry.name, leagueTeams) || [];
            } else {
                matchups = Leagues.pairRoundRobin(leagueTeams);
            }

            let gameNumber = 1;
            if (typeof window.getLeagueCurrentRound === 'function') {
                 gameNumber = window.getLeagueCurrentRound(leagueEntry.name);
            } else if (window.leagueRoundState && window.leagueRoundState[leagueEntry.name]) {
                 gameNumber = window.leagueRoundState[leagueEntry.name].currentRound || 1;
            }
            const gameLabel = `Game ${gameNumber}`;

            const allMatchupLabels = [];
            const picksByTeam = {};

            const leagueFields = leagueEntry.fields || [];
            
            // Generate matchups if we have teams, regardless of fields
            if (leagueTeams.length >= 2) {
                const gamesPerField = (leagueFields.length > 0) ? Math.ceil(matchups.length / leagueFields.length) : matchups.length;
                const slotCount = group.slots.length || 1;
                const usedFieldsInThisBlock = Array.from({ length: slotCount }, () => new Set());

                for (let i = 0; i < matchups.length; i++) {
                    const [teamA, teamB] = matchups[i];
                    if (teamA === "BYE" || teamB === "BYE") continue;

                    let fieldName = null;
                    if (leagueFields.length > 0) {
                        const fieldIndex = Math.floor(i / gamesPerField);
                        fieldName = leagueFields[fieldIndex % leagueFields.length];
                    }
                    
                    const baseLabel = `${teamA} vs ${teamB} (${bestSport})`;

                    let isFieldAvailable = true;
                    if (fieldName) {
                        // TIMELINE CHECK: Pass isLeague=true for Full Buyout check
                        if (!window.SchedulerCoreUtils.canBlockFit(blockBase, fieldName, activityProperties, bestSport, true)) {
                            isFieldAvailable = false;
                        }
                        if (usedFieldsInThisBlock[i % slotCount].has(fieldName)) isFieldAvailable = false;
                    } else {
                        isFieldAvailable = false;
                    }

                    let pick;
                    if (fieldName && isFieldAvailable) {
                        pick = {
                            field: fieldName,
                            sport: baseLabel,
                            _h2h: true,
                            vs: null,
                            _activity: bestSport
                        };
                        usedFieldsInThisBlock[i % slotCount].add(fieldName);
                        allMatchupLabels.push(`${baseLabel} @ ${fieldName}`);
                    } else {
                        pick = {
                            field: "No Field",
                            sport: baseLabel,
                            _h2h: true,
                            vs: null,
                            _activity: bestSport
                        };
                        allMatchupLabels.push(`${baseLabel} (No Field)`);
                    }
                    picksByTeam[teamA] = pick;
                    picksByTeam[teamB] = pick;
                }
            }

            const noGamePick = {
                field: "No Game",
                sport: null,
                _h2h: true,
                _activity: bestSport || "Specialty League",
                _allMatchups: allMatchupLabels
            };

            allBunksInGroup.forEach(bunk => {
                const pickToAssign = picksByTeam[bunk] || noGamePick;
                pickToAssign._allMatchups = allMatchupLabels;
                pickToAssign._gameLabel = gameLabel;
                // PASS TRUE FOR IS_LEAGUE (Full Buyout)
                fillBlock({ ...blockBase, bunk }, pickToAssign, {}, yesterdayHistory, true);
            });
        });
    };

    // =================================================================
    // 3. PASS 2.5: REGULAR LEAGUES
    // =================================================================
    Leagues.processRegularLeagues = function(context) {
        const {
            schedulableSlotBlocks, activityProperties,
            masterLeagues, disabledLeagues, rotationHistory,
            yesterdayHistory, divisions, fieldsBySport, dailyLeagueSportsUsage,
            fillBlock
        } = context;

        const leagueBlocks = schedulableSlotBlocks.filter(
            b => b.event === 'League Game' && !b.processed
        );

        const groups = {};
        leagueBlocks.forEach(block => {
            const leagueEntry = Object.entries(masterLeagues).find(
                ([name, l]) => l.enabled && !disabledLeagues.includes(name) && l.divisions.includes(block.divName)
            );
            if (!leagueEntry) return;

            const leagueName = leagueEntry[0];
            const key = `${leagueName}-${block.startTime}`;
            if (!groups[key]) {
                groups[key] = {
                    leagueName,
                    league: leagueEntry[1],
                    startTime: block.startTime,
                    endTime: block.endTime,
                    slots: block.slots,
                    bunks: new Set()
                };
            }
            groups[key].bunks.add(block.bunk);
        });

        const sortedGroups = Object.values(groups).sort((a, b) => a.startTime - b.startTime);

        sortedGroups.forEach(group => {
            const { leagueName, league, slots } = group;
            const leagueTeams = (league.teams || []).map(t => String(t).trim()).filter(Boolean);
            if (leagueTeams.length < 2) return;

            const allBunksInGroup = Array.from(group.bunks).sort();
            if (allBunksInGroup.length === 0) return;

            // Find base division
            let baseDivName = null;
            const firstBunk = allBunksInGroup[0];
            baseDivName = Object.keys(divisions).find(div => (divisions[div].bunks || []).includes(firstBunk));
            if (!baseDivName) return;

            const blockBase = { slots, divName: baseDivName, startTime: group.startTime, endTime: group.endTime };
            
            // Allow processing even if no sports/fields are mapped yet
            const sports = (league.sports || []);
            
            const usedToday = dailyLeagueSportsUsage[leagueName] || new Set();
            let optimizerSports = sports.filter(s => !usedToday.has(s));
            if (optimizerSports.length === 0) optimizerSports = sports;

            const leagueHistory = rotationHistory.leagues[leagueName] || {};
            rotationHistory.leagues[leagueName] = leagueHistory;
            const leagueTeamCounts = rotationHistory.leagueTeamSports[leagueName] || {};
            rotationHistory.leagueTeamSports[leagueName] = leagueTeamCounts;
            rotationHistory.leagueTeamLastSport = rotationHistory.leagueTeamLastSport || {};
            const leagueTeamLastSport = rotationHistory.leagueTeamLastSport[leagueName] || {};
            rotationHistory.leagueTeamLastSport[leagueName] = leagueTeamLastSport;

            // Generate Matchups
            let standardMatchups = [];
            if (typeof window.getLeagueMatchups === "function") {
                standardMatchups = window.getLeagueMatchups(leagueName, leagueTeams) || [];
            } else {
                standardMatchups = Leagues.coreGetNextLeagueRound(leagueName, leagueTeams) || [];
            }

            // Get Game Number
            let gameNumber = 1;
            if (typeof window.getLeagueCurrentRound === 'function') {
                 gameNumber = window.getLeagueCurrentRound(leagueName);
            } else if (window.leagueRoundState && window.leagueRoundState[leagueName]) {
                 gameNumber = window.leagueRoundState[leagueName].currentRound || 1;
            }
            const gameLabel = `Game ${gameNumber}`;

            const slotCount = slots.length || 1;

            const evaluateMatchups = (candidateMatchups) => {
                const nonBye = candidateMatchups.filter(p => p && p[0] !== "BYE" && p[1] !== "BYE");
                const { assignments } = Leagues.assignSportsMultiRound(
                    nonBye, optimizerSports, leagueTeamCounts, leagueHistory, leagueTeamLastSport
                );
                const simUsedFields = Array.from({ length: slotCount }, () => new Set());
                let successCount = 0;
                const results = [];

                nonBye.forEach((pair, idx) => {
                    const [teamA, teamB] = pair;
                    const preferredSport = assignments[idx]?.sport || (optimizerSports.length ? optimizerSports[idx % optimizerSports.length] : "League Game");
                    const candidateSports = [
                        preferredSport,
                        ...sports.filter(s => s !== preferredSport && !usedToday.has(s)),
                        ...sports.filter(s => s !== preferredSport && usedToday.has(s))
                    ];
                    
                    // Always try preferred sport if candidates are empty
                    if (candidateSports.length === 0) candidateSports.push(preferredSport);

                    let foundField = null;
                    let foundSport = preferredSport;
                    const slotIdx = idx % slotCount;

                    for (const s of candidateSports) {
                        const possibleFields = fieldsBySport[s] || [];
                        let found = null;
                        for (const f of possibleFields) {
                            // Timeline Check via canBlockFit
                            if (!simUsedFields[slotIdx].has(f) &&
                                window.SchedulerCoreUtils.canBlockFit(blockBase, f, activityProperties, s, true)) {
                                found = f;
                                break;
                            }
                        }
                        if (found) {
                            foundField = found;
                            foundSport = s;
                            simUsedFields[slotIdx].add(found);
                            break;
                        }
                    }
                    if (foundField) successCount++;
                    results.push({ pair, sport: foundSport, field: foundField, assignments: assignments[idx] });
                });
                return { successCount, results, matchups: candidateMatchups, assignments };
            };

            let bestResult = evaluateMatchups(standardMatchups);
            const nonByeCount = standardMatchups.filter(p => p && p[0] !== "BYE" && p[1] !== "BYE").length;

            if (bestResult.successCount < nonByeCount) {
                const teamListCopy = [...leagueTeams];
                for (let i = 0; i < 50; i++) {
                    Leagues.shuffleArray(teamListCopy);
                    const shuffledMatchups = Leagues.pairRoundRobin(teamListCopy);
                    const res = evaluateMatchups(shuffledMatchups);
                    if (res.successCount > bestResult.successCount) {
                        bestResult = res;
                        if (res.successCount === nonByeCount) break;
                    }
                }
            }

            const winningMatchups = bestResult.matchups.filter(p => p && p[0] !== "BYE" && p[1] !== "BYE");
            const finalOpt = Leagues.assignSportsMultiRound(winningMatchups, optimizerSports, leagueTeamCounts, leagueHistory, leagueTeamLastSport);
            rotationHistory.leagueTeamSports[leagueName] = finalOpt.updatedTeamCounts;
            rotationHistory.leagueTeamLastSport[leagueName] = finalOpt.updatedLastSports;

            const allMatchupLabels = [];
            const usedForAssignments = [];
            const usedFieldsPerSlot = Array.from({ length: slotCount }, () => new Set());

            winningMatchups.forEach((pair, idx) => {
                const [teamA, teamB] = pair;
                const preferredSport = finalOpt.assignments[idx]?.sport || (optimizerSports.length ? optimizerSports[idx % optimizerSports.length] : "League Game");
                const candidateSports = [
                    preferredSport,
                    ...sports.filter(s => s !== preferredSport && !usedToday.has(s)),
                    ...sports.filter(s => s !== preferredSport && usedToday.has(s))
                ];
                if (candidateSports.length === 0) candidateSports.push(preferredSport);

                let finalSport = preferredSport;
                let finalField = null;
                const slotIdx = idx % slotCount;

                for (const s of candidateSports) {
                    const possibleFields = fieldsBySport[s] || [];
                    let found = null;
                    for (const f of possibleFields) {
                        if (!usedFieldsPerSlot[slotIdx].has(f) &&
                            window.SchedulerCoreUtils.canBlockFit(blockBase, f, activityProperties, s, true)) {
                            found = f;
                            break;
                        }
                    }
                    if (!found && possibleFields.length > 0) {
                        // Fallback logic
                    }
                    if (found) {
                        finalSport = s;
                        finalField = found;
                        usedFieldsPerSlot[slotIdx].add(found);
                        break;
                    }
                }

                let label = finalField ? `${teamA} vs ${teamB} (${finalSport}) @ ${finalField}` : `${teamA} vs ${teamB} (No Field)`;
                if (finalField) {
                    if (!dailyLeagueSportsUsage[leagueName]) dailyLeagueSportsUsage[leagueName] = new Set();
                    dailyLeagueSportsUsage[leagueName].add(finalSport);
                }
                leagueHistory[finalSport] = Date.now();
                usedForAssignments.push({ label, sport: finalSport, field: finalField || "No Field", teamA, teamB });
                allMatchupLabels.push(label);
            });

            bestResult.matchups.forEach(pair => {
                if (!pair) return;
                const [teamA, teamB] = pair;
                if (teamA === "BYE" || teamB === "BYE") {
                    allMatchupLabels.push(`${teamA} vs ${teamB} (BYE)`);
                }
            });

            const noGamePick = { field: "No Game", sport: null, _h2h: true, _activity: "League", _allMatchups: allMatchupLabels };

            let bunkPtr = 0;
            usedForAssignments.forEach(game => {
                if (bunkPtr + 1 >= allBunksInGroup.length) return;
                const bunkA = allBunksInGroup[bunkPtr];
                const bunkB = allBunksInGroup[bunkPtr + 1];
                bunkPtr += 2;

                const pick = {
                    field: game.field, sport: game.label, _h2h: true, vs: null,
                    _activity: game.sport, _allMatchups: allMatchupLabels, _gameLabel: gameLabel
                };

                const bunkADiv = Object.keys(divisions).find(div => (divisions[div].bunks || []).includes(bunkA)) || baseDivName;
                const bunkBDiv = Object.keys(divisions).find(div => (divisions[div].bunks || []).includes(bunkB)) || baseDivName;

                // PASS TRUE FOR IS_LEAGUE
                fillBlock({ slots, bunk: bunkA, divName: bunkADiv, startTime: group.startTime, endTime: group.endTime + INCREMENT_MINS * slots.length }, pick, {}, yesterdayHistory, true);
                fillBlock({ slots, bunk: bunkB, divName: bunkBDiv, startTime: group.startTime, endTime: group.endTime + INCREMENT_MINS * slots.length }, pick, {}, yesterdayHistory, true);
            });

            while (bunkPtr < allBunksInGroup.length) {
                const leftoverBunk = allBunksInGroup[bunkPtr++];
                const bunkDivName = Object.keys(divisions).find(div => (divisions[div].bunks || []).includes(leftoverBunk)) || baseDivName;
                const leftoverPick = { ...noGamePick, _gameLabel: gameLabel };
                fillBlock({ slots, bunk: leftoverBunk, divName: bunkDivName, startTime: group.startTime, endTime: group.endTime + INCREMENT_MINS * slots.length }, leftoverPick, {}, yesterdayHistory, true);
            }
        });
    };

    window.SchedulerCoreLeagues = Leagues;

})();
