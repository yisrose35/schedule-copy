// ============================================================================
// scheduler_logic_core.js
//
// HYBRID CORE VERSION:
// - Architecture: GlobalAvailabilityManager (Precise Time/Collision)
// - Logic: Dynamic Matchup Shuffler (Restored from Old Version)
// - Logic: Iterative Sport Fallback (Restored from Old Version)
// ============================================================================

(function () {
  'use strict';

  // ===== CONFIG =====
  const INCREMENT_MINS = 30;
  window.INCREMENT_MINS = INCREMENT_MINS;

  const GENERATED_EVENTS = [
    'General Activity Slot',
    'Sports Slot',
    'Special Activity',
    'Swim',
    'League Game',
    'Specialty League'
  ];

  // =============================================================
  // 1. GLOBAL AVAILABILITY MANAGER (The "New" Precision Engine)
  // =============================================================
  const GlobalAvailabilityManager = (function() {
    let reservations = {};

    function reset() { reservations = {}; }

    function addReservation(field, start, end, meta) {
        if (!reservations[field]) reservations[field] = [];
        reservations[field].push({
            start: start,
            end: end,
            div: meta.divName,
            bunk: meta.bunk,
            activity: meta.activity, 
            isLeague: meta.isLeague || false
        });
    }

    function getReservationsForField(field) { return reservations[field] || []; }

    function checkAvailability(field, start, end, meta, fieldProps) {
        if (!fieldProps) return { valid: false, reason: "No Props" };
        if (!reservations[field]) return { valid: true };
        
        const existingBlocks = reservations[field];
        const capacityLimit = (fieldProps.sharable && !meta.isLeague) ? 2 : 1; 

        // Strict overlap check: (StartA < EndB) && (EndA > StartB)
        const overlaps = existingBlocks.filter(r => r.start < end && r.end > start);

        if (overlaps.length === 0) return { valid: true };

        // HARD FAIL: Capacity
        if (overlaps.length >= capacityLimit) return { valid: false, reason: "At Capacity" };

        // LOGIC FAIL: Compatibility
        for (const overlap of overlaps) {
            if (overlap.isLeague || meta.isLeague) return { valid: false, reason: "League Exclusive" };
            if (overlap.div !== meta.divName) return { valid: false, reason: "Division Mismatch" };
            if (overlap.activity !== meta.activity) return { valid: false, reason: "Activity Mismatch" };
        }
        return { valid: true };
    }

    return { reset, addReservation, checkAvailability, getReservationsForField };
  })();

  window.GlobalAvailabilityManager = GlobalAvailabilityManager;

  // ===== BASIC HELPERS =====
  function parseTimeToMinutes(str) {
    if (str == null) return null;
    if (typeof str === 'number') return str;
    let s = str.trim().toLowerCase().replace(/am|pm/g, (m) => (m === 'am' ? 'am' : 'pm')).replace(/\s+/g, '');
    let mer = s.includes('pm') ? 'pm' : s.includes('am') ? 'am' : null;
    s = s.replace(/am|pm/, '');
    const m = s.match(/^(\d{1,2}):?(\d{2})?$/); 
    if (!m) return null;
    let hh = parseInt(m[1], 10);
    const mm = m[2] ? parseInt(m[2], 10) : 0;
    if (mer) {
      if (hh === 12) hh = mer === 'am' ? 0 : 12;
      else if (mer === 'pm') hh += 12;
    }
    return hh * 60 + mm;
  }

  function fieldLabel(f) { return (f && typeof f === 'object' && f.name) ? f.name : f; }

  function fmtTime(d) {
    if (!d) return '';
    if (typeof d === 'string') d = new Date(d);
    let h = d.getHours();
    let m = d.getMinutes().toString().padStart(2, '0');
    const ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${m} ${ap}`;
  }

  function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  // ======================================================
  // LEAGUE ROUND STATE
  // ======================================================
  let coreLeagueRoundState = window.coreLeagueRoundState || {};

  (function initCoreLeagueRoundState() {
    try {
      const daily = window.loadCurrentDailyData?.() || {};
      coreLeagueRoundState = daily.coreLeagueRoundState || {};
    } catch (e) { coreLeagueRoundState = {}; }
    window.coreLeagueRoundState = coreLeagueRoundState;
  })();

  function saveCoreLeagueRoundState() {
    window.saveCurrentDailyData?.('coreLeagueRoundState', coreLeagueRoundState);
  }

  function coreFullRoundRobin(teamList) {
    if (!teamList || teamList.length < 2) return [];
    const teams = teamList.map(String);
    const t = [...teams];
    if (t.length % 2 !== 0) t.push('BYE');
    const n = t.length;
    const fixed = t[0];
    let rotating = t.slice(1);
    const rounds = [];
    for (let r = 0; r < n - 1; r++) {
      const pairings = [];
      pairings.push([fixed, rotating[0]]);
      for (let i = 1; i < n / 2; i++) {
        pairings.push([rotating[i], rotating[rotating.length - i]]);
      }
      rounds.push(pairings.filter(([a, b]) => a !== 'BYE' && b !== 'BYE'));
      rotating.unshift(rotating.pop());
    }
    return rounds;
  }

  function coreGetNextLeagueRound(leagueName, teams) {
    const key = String(leagueName || '');
    if (!key || !teams || teams.length < 2) return [];
    const teamKey = teams.map(String).sort().join('|');
    const rounds = coreFullRoundRobin(teams);
    if (rounds.length === 0) return [];
    
    let state = coreLeagueRoundState[key] || { idx: 0, teamKey };
    if (state.teamKey !== teamKey) state = { idx: 0, teamKey };
    
    const idx = state.idx % rounds.length;
    const matchups = rounds[idx];
    state.idx = (idx + 1) % rounds.length;
    coreLeagueRoundState[key] = state;
    saveCoreLeagueRoundState();
    return matchups;
  }

  function pairRoundRobin(teamList) {
    const arr = teamList.map(String);
    if (arr.length < 2) return [];
    if (arr.length % 2 === 1) arr.push('BYE');
    const n = arr.length;
    const pairs = [];
    for (let i = 0; i < n / 2; i++) {
      const A = arr[i];
      const B = arr[n - 1 - i];
      if (A !== 'BYE' && B !== 'BYE') pairs.push([A, B]);
    }
    return pairs;
  }

  // ====== LEAGUE SPORT OPTIMIZER (DFS) ======
  function assignSportsMultiRound(matchups, availableLeagueSports, existingTeamCounts, leagueHistory, lastSportByTeamBase) {
    const sports = availableLeagueSports.slice();
    const baseTeamCounts = existingTeamCounts || {};
    const allTeams = new Set();
    matchups.forEach(([a, b]) => { if(a && b) { allTeams.add(String(a)); allTeams.add(String(b)); }});

    const workCounts = {};
    allTeams.forEach(t => workCounts[t] = { ...baseTeamCounts[t] });
    
    const sportTotals = {};
    sports.forEach(s => sportTotals[s] = 0);
    for(const t in workCounts) {
        for(const s in workCounts[t]) sportTotals[s] = (sportTotals[s]||0) + workCounts[t][s];
    }

    let bestPlan = null;
    let bestScore = Infinity;
    let bestCounts = null;
    let nodesVisited = 0;
    const MAX_NODES = 10000; // Limit for speed

    function dfs(idx, plan, currentCost) {
        if (currentCost >= bestScore) return;
        if (nodesVisited > MAX_NODES) return;
        if (idx === matchups.length) {
            if (currentCost < bestScore) {
                bestScore = currentCost;
                bestPlan = plan.slice();
                bestCounts = JSON.parse(JSON.stringify(workCounts));
            }
            return;
        }
        nodesVisited++;
        const [teamA, teamB] = matchups[idx];
        
        // Sort sports by global usage (balance) + randomness to prevent stagnation
        const orderedSports = sports.slice().sort((a, b) => (sportTotals[a] - sportTotals[b]) || (Math.random() - 0.5));

        for (const sport of orderedSports) {
            const prevA = workCounts[teamA][sport] || 0;
            const prevB = workCounts[teamB][sport] || 0;
            let delta = 0;
            
            // Penalize repetition
            if (prevA > 0) delta += 10 * prevA;
            if (prevB > 0) delta += 10 * prevB;
            
            // Penalize global imbalance
            const avg = Object.values(sportTotals).reduce((a,b)=>a+b,0) / sports.length;
            if (sportTotals[sport] > avg) delta += 5;

            workCounts[teamA][sport] = prevA + 1;
            workCounts[teamB][sport] = prevB + 1;
            sportTotals[sport]++;

            if (currentCost + delta < bestScore) {
                plan.push({ sport });
                dfs(idx + 1, plan, currentCost + delta);
                plan.pop();
            }

            // Backtrack
            workCounts[teamA][sport] = prevA;
            workCounts[teamB][sport] = prevB;
            sportTotals[sport]--;
            if(prevA===0) delete workCounts[teamA][sport];
            if(prevB===0) delete workCounts[teamB][sport];
        }
    }

    dfs(0, [], 0);

    if (!bestPlan) {
        const fallback = matchups.map((_, i) => ({ sport: sports[i % sports.length] }));
        return { assignments: fallback, updatedTeamCounts: baseTeamCounts };
    }
    return { assignments: bestPlan, updatedTeamCounts: bestCounts || baseTeamCounts };
  }

  // =====================================================================
  // MAIN ENTRY POINT
  // =====================================================================
  window.runSkeletonOptimizer = function (manualSkeleton) {
    window.scheduleAssignments = {};
    window.leagueAssignments = {};
    window.unifiedTimes = [];
    
    window.GlobalAvailabilityManager.reset();

    if (!manualSkeleton || manualSkeleton.length === 0) return false;

    const {
      divisions, availableDivisions, activityProperties, allActivities, h2hActivities,
      fieldsBySport, masterLeagues, masterSpecialtyLeagues, yesterdayHistory,
      rotationHistory, disabledLeagues, disabledSpecialtyLeagues, historicalCounts
    } = loadAndFilterData();

    let fieldUsageBySlot = {}; // Keep for legacy fills if needed, but GAM is primary
    window.fieldUsageBySlot = fieldUsageBySlot;
    window.activityProperties = activityProperties;

    const timestamp = Date.now();

    // ===== PASS 1: Unified Time Grid =====
    let earliestMin = null, latestMin = null;
    Object.values(divisions).forEach((div) => {
      const s = parseTimeToMinutes(div.startTime);
      const e = parseTimeToMinutes(div.endTime);
      if (s !== null && (earliestMin === null || s < earliestMin)) earliestMin = s;
      if (e !== null && (latestMin === null || e > latestMin)) latestMin = e;
    });
    if (earliestMin === null) earliestMin = 540; 
    if (latestMin === null) latestMin = 960; 
    if (latestMin <= earliestMin) latestMin = earliestMin + 60;

    const baseDate = new Date(1970, 0, 1, 0, 0, 0);
    let currentMin = earliestMin;
    while (currentMin < latestMin) {
      const nextMin = currentMin + INCREMENT_MINS;
      window.unifiedTimes.push({
        start: new Date(baseDate.getTime() + currentMin * 60000),
        end: new Date(baseDate.getTime() + nextMin * 60000),
        label: `${fmtTime(new Date(baseDate.getTime() + currentMin * 60000))} - ${fmtTime(new Date(baseDate.getTime() + nextMin * 60000))}`
      });
      currentMin = nextMin;
    }
    
    availableDivisions.forEach((divName) => {
      (divisions[divName]?.bunks || []).forEach((bunk) => {
        window.scheduleAssignments[bunk] = new Array(window.unifiedTimes.length);
      });
    });

    // =================================================================
    // PASS 1.5: Bunk-Specific Overrides
    // =================================================================
    try {
        const dailyData = window.loadCurrentDailyData?.() || {};
        (dailyData.bunkActivityOverrides || []).forEach((override) => {
            const startMin = parseTimeToMinutes(override.startTime);
            const endMin = parseTimeToMinutes(override.endTime);
            const slots = findSlotsForRange(startMin, endMin);
            const bunk = override.bunk;
            if (window.scheduleAssignments[bunk] && slots.length > 0) {
                slots.forEach((slotIndex, idx) => {
                    if (!window.scheduleAssignments[bunk][slotIndex]) {
                        window.scheduleAssignments[bunk][slotIndex] = {
                            field: { name: override.activity },
                            sport: null,
                            continuation: idx > 0,
                            _fixed: true,
                            _h2h: false,
                            _activity: override.activity,
                            _endTime: endMin
                        };
                    }
                });
                const block = { divName: override.division, bunk, startTime: startMin, endTime: endMin, slots, _activity: override.activity };
                markFieldUsage(block, override.activity, fieldUsageBySlot);
            }
        });
    } catch(e) { console.error(e); }

    // Helpers
    function normalizeGA(name) { return name && name.toLowerCase().includes('general') ? 'General Activity Slot' : null; }
    function normalizeLeague(name) { return name && name.toLowerCase().includes('league') && !name.toLowerCase().includes('specialty') ? 'League Game' : null; }
    function normalizeSpecialtyLeague(name) { return name && name.toLowerCase().includes('specialty') ? 'Specialty League' : null; }

    // =================================================================
    // PASS 2: Skeletons
    // =================================================================
    const schedulableSlotBlocks = [];
    manualSkeleton.forEach((item) => {
        const allBunks = divisions[item.division]?.bunks || [];
        const startMin = parseTimeToMinutes(item.startTime);
        const endMin = parseTimeToMinutes(item.endTime);
        const allSlots = findSlotsForRange(startMin, endMin);
        
        if (!allBunks.length || !allSlots.length) return;

        const normSpec = normalizeSpecialtyLeague(item.event);
        const normLg = normalizeLeague(item.event);
        const normGA = normalizeGA(item.event);
        const eventType = normSpec || normLg || normGA || item.event;
        
        const isGenerated = GENERATED_EVENTS.includes(eventType) || eventType === 'General Activity Slot' || eventType.includes('League');

        if (item.type === 'pinned' || !isGenerated) {
            allBunks.forEach(bunk => {
                allSlots.forEach((idx, i) => {
                    if (!window.scheduleAssignments[bunk][idx]) {
                        window.scheduleAssignments[bunk][idx] = {
                            field: { name: item.event },
                            _fixed: true,
                            continuation: i > 0,
                            _activity: item.event
                        };
                    }
                });
                markFieldUsage({ divName: item.division, bunk, startTime: startMin, endTime: endMin, slots: allSlots }, item.event, fieldUsageBySlot);
            });
        } else if (item.type === 'split') {
             // Split logic
             const mid = Math.ceil(allBunks.length/2);
             const midSlot = Math.ceil(allSlots.length/2);
             const bunksTop = allBunks.slice(0, mid);
             const bunksBot = allBunks.slice(mid);
             const slots1 = allSlots.slice(0, midSlot);
             const slots2 = allSlots.slice(midSlot);
             
             const pin = (bunks, slots, act) => {
                 bunks.forEach(b => {
                     slots.forEach((idx, i) => {
                         window.scheduleAssignments[b][idx] = {
                             field: { name: act },
                             _fixed: true, continuation: i>0, _activity: act
                         };
                     });
                     markFieldUsage({divName:item.division, bunk:b, startTime:startMin, endTime:endMin, slots}, act, fieldUsageBySlot);
                 });
             };
             const push = (bunks, slots, act) => {
                 bunks.forEach(b => schedulableSlotBlocks.push({
                     divName: item.division, bunk:b, event:act, startTime:startMin, endTime:endMin, slots
                 }));
             };

             const gaName = normalizeGA(item.subEvents?.[1]?.event) || 'General Activity Slot';
             pin(bunksTop, slots1, 'Swim');
             push(bunksBot, slots1, gaName);
             push(bunksTop, slots2, gaName);
             pin(bunksBot, slots2, 'Swim');

        } else {
            allBunks.forEach(bunk => {
                schedulableSlotBlocks.push({
                    divName: item.division,
                    bunk,
                    event: eventType,
                    startTime: startMin,
                    endTime: endMin,
                    slots: allSlots
                });
            });
        }
    });

    // =================================================================
    // PASS 3 & 3.5: LEAGUES (Robust Hybrid Logic)
    // =================================================================
    const processLeagues = (blocks, isSpecialty) => {
        const groups = {};
        blocks.forEach(b => {
            const k = `${b.divName}-${b.startTime}`;
            if(!groups[k]) groups[k] = { ...b, bunks: new Set() };
            groups[k].bunks.add(b.bunk);
        });

        Object.values(groups).sort((a,b) => a.startTime - b.startTime).forEach(group => {
            const masterSource = isSpecialty ? masterSpecialtyLeagues : masterLeagues;
            const disabledSource = isSpecialty ? disabledSpecialtyLeagues : disabledLeagues;
            
            const leagueEntry = Object.values(masterSource).find(l => 
                l.enabled && !disabledSource.includes(l.name) && l.divisions.includes(group.divName)
            );
            if (!leagueEntry) return;

            const leagueTeams = (leagueEntry.teams || []).map(String);
            const bunks = Array.from(group.bunks).sort();
            const sports = (leagueEntry.sports || []).filter(s => fieldsBySport[s]);
            
            let bestResult = { successCount: -1, assignments: [] };
            
            // 1. Matchups
            let matchups = isSpecialty ? pairRoundRobin(leagueTeams) : coreGetNextLeagueRound(leagueEntry.name, leagueTeams);
            
            // 2. Simulation
            const simulate = (candidateMatchups) => {
                const nonBye = candidateMatchups.filter(p => p[0] !== 'BYE' && p[1] !== 'BYE');
                const { assignments } = assignSportsMultiRound(nonBye, sports, {}, {}, {}); 
                
                let successes = 0;
                const localUsedFields = new Set();
                const results = [];

                nonBye.forEach((pair, idx) => {
                    const prefSport = assignments[idx]?.sport || sports[0];
                    // ITERATIVE FALLBACK: Try preferred, then ALL others
                    const candidateSports = [prefSport, ...sports.filter(s => s !== prefSport)];
                    
                    let foundField = null;
                    let foundSport = null;

                    for (const s of candidateSports) {
                        const fields = fieldsBySport[s] || [];
                        for (const f of fields) {
                            if (localUsedFields.has(f)) continue;
                            const props = activityProperties[f];
                            
                            // Strict GAM Check
                            const avail = window.GlobalAvailabilityManager.checkAvailability(f, group.startTime, group.endTime, {
                                divName: group.divName, bunk: "league", activity: "League", isLeague: true
                            }, props);
                            
                            // Plus Time Rules Check
                            const isTimeOk = isTimeAvailable({startTime: group.startTime, endTime: group.endTime}, props);

                            if (avail.valid && isTimeOk) {
                                foundField = f;
                                foundSport = s;
                                break;
                            }
                        }
                        if (foundField) break;
                    }

                    if (foundField) {
                        successes++;
                        localUsedFields.add(foundField);
                        results.push({ pair, field: foundField, sport: foundSport });
                    } else {
                        results.push({ pair, field: null, sport: prefSport }); 
                    }
                });
                return { successes, results, matchups: candidateMatchups };
            };

            bestResult = simulate(matchups);

            // 3. Shuffle on Failure
            if (!isSpecialty && bestResult.successes < matchups.filter(p=>p[0]!=='BYE'&&p[1]!=='BYE').length) {
                console.log(`Reshuffling league ${leagueEntry.name}...`);
                const teamsCopy = [...leagueTeams];
                for(let i=0; i<50; i++) {
                    shuffleArray(teamsCopy);
                    const shufMatchups = pairRoundRobin(teamsCopy);
                    const res = simulate(shufMatchups);
                    if (res.successes > bestResult.successes) {
                        bestResult = res;
                        if (res.successes === res.matchups.filter(p=>p[0]!=='BYE'&&p[1]!=='BYE').length) break;
                    }
                }
            }

            // 4. Commit
            const allMatchupLabels = [];
            const assignedMap = {}; 

            bestResult.results.forEach(res => {
                const [teamA, teamB] = res.pair;
                let label, pick;
                
                if (res.field) {
                    label = `${teamA} vs ${teamB} (${res.sport}) @ ${res.field}`;
                    markFieldUsage({ ...group, _activity: res.sport }, res.field, fieldUsageBySlot);
                    pick = { field: res.field, sport: label, _h2h: true, _activity: res.sport };
                } else {
                    label = `${teamA} vs ${teamB} (No Field)`;
                    pick = { field: "No Field", sport: label, _h2h: true, _activity: "League" };
                }
                allMatchupLabels.push(label);
                assignedMap[teamA] = pick;
                assignedMap[teamB] = pick;
            });

            bestResult.matchups.forEach(p => {
                if (p[0]==='BYE' || p[1]==='BYE') allMatchupLabels.push(`${p[0]} vs ${p[1]} (BYE)`);
            });

            const noGamePick = { field: "No Game", sport: null, _h2h: true, _activity: "League" };

            bunks.forEach(bunk => {
                const p = assignedMap[bunk] || noGamePick;
                p._allMatchups = allMatchupLabels;
                fillBlock({ ...group, bunk }, p, fieldUsageBySlot, yesterdayHistory, true);
            });
        });
    };

    const leagueBlocks = schedulableSlotBlocks.filter(b => b.event === 'League Game');
    const specialtyBlocks = schedulableSlotBlocks.filter(b => b.event === 'Specialty League');
    processLeagues(specialtyBlocks, true);
    processLeagues(leagueBlocks, false);

    // =================================================================
    // PASS 4: FILLERS
    // =================================================================
    const remainingBlocks = schedulableSlotBlocks.filter(b => !b.event.includes('League'));
    remainingBlocks.sort((a, b) => a.startTime - b.startTime);

    remainingBlocks.forEach(block => {
        if (!block.slots.length || window.scheduleAssignments[block.bunk][block.slots[0]]) return;

        let pick = null;
        if (block.event === 'Special Activity') {
            pick = window.findBestSpecial?.(block, allActivities, fieldUsageBySlot, yesterdayHistory, activityProperties, rotationHistory, divisions, historicalCounts);
        } else if (block.event === 'Sports Slot') {
            pick = window.findBestSportActivity?.(block, allActivities, fieldUsageBySlot, yesterdayHistory, activityProperties, rotationHistory, divisions, historicalCounts);
        }
        
        if (!pick) {
            pick = window.findBestGeneralActivity?.(block, allActivities, h2hActivities, fieldUsageBySlot, yesterdayHistory, activityProperties, rotationHistory, divisions, historicalCounts);
        }

        if (pick) fillBlock(block, pick, fieldUsageBySlot, yesterdayHistory, false);
        else fillBlock(block, { field: "Free", sport: null, _activity: "Free" }, fieldUsageBySlot, yesterdayHistory, false);
    });

    // =================================================================
    // PASS 5/6: HISTORY & UI
    // =================================================================
    try {
        const historyToSave = rotationHistory;
        availableDivisions.forEach((divName) => {
            (divisions[divName]?.bunks || []).forEach((bunk) => {
                const schedule = window.scheduleAssignments[bunk] || [];
                let lastActivity = null;
                schedule.forEach(entry => {
                    if (entry && entry._activity && entry._activity !== lastActivity) {
                        lastActivity = entry._activity;
                        historyToSave.bunks[bunk] = historyToSave.bunks[bunk] || {};
                        historyToSave.bunks[bunk][lastActivity] = timestamp;
                    } else if (entry && !entry.continuation) lastActivity = null;
                });
            });
        });
        window.saveRotationHistory?.(historyToSave);
    } catch(e) { console.error(e); }

    window.saveCurrentDailyData?.('unifiedTimes', window.unifiedTimes);
    window.updateTable?.();
    window.saveSchedule?.();

    return true;
  };

  // =====================================================================
  // HELPERS
  // =====================================================================
  function findSlotsForRange(startMin, endMin) {
    const slots = [];
    if (startMin == null || endMin == null) return slots;
    window.unifiedTimes.forEach((slot, i) => {
        const s = slot.start.getHours()*60 + slot.start.getMinutes();
        if (s >= startMin && s < endMin) slots.push(i);
    });
    return slots;
  }

  function markFieldUsage(block, fieldName, fieldUsageBySlotLocal) {
    if (!fieldName || fieldName === 'No Field' || !window.allSchedulableNames?.includes(fieldName)) return;
    
    window.GlobalAvailabilityManager.addReservation(fieldName, block.startTime, block.endTime, {
        divName: block.divName, bunk: block.bunk, activity: block._activity || block.sport, isLeague: false
    });

    block.slots.forEach(i => {
        fieldUsageBySlotLocal[i] = fieldUsageBySlotLocal[i] || {};
        const u = fieldUsageBySlotLocal[i][fieldName] || { count: 0, divisions: [], bunks: {} };
        u.count++;
        if (!u.divisions.includes(block.divName)) u.divisions.push(block.divName);
        if (block.bunk) u.bunks[block.bunk] = block._activity;
        fieldUsageBySlotLocal[i][fieldName] = u;
    });
  }

  function fillBlock(block, pick, fieldUsageBySlotLocal, yesterdayHistory, isLeagueFill) {
    const fieldName = fieldLabel(pick.field);
    block.slots.forEach((idx, i) => {
        if (!window.scheduleAssignments[block.bunk][idx]) {
            window.scheduleAssignments[block.bunk][idx] = {
                field: fieldName,
                sport: pick.sport,
                continuation: i > 0,
                _fixed: !!pick._fixed,
                _h2h: pick._h2h || false,
                vs: pick.vs || null,
                _activity: pick._activity || null,
                _allMatchups: pick._allMatchups || null
            };
        }
    });
    if (!isLeagueFill && fieldName) {
        markFieldUsage({ ...block, _activity: pick._activity }, fieldName, fieldUsageBySlotLocal);
    }
  }

  // --- Re-Check Logic for Fillers ---
  function isTimeAvailable(block, fieldProps) {
    const rules = fieldProps.timeRules || [];
    if (rules.length === 0) return fieldProps.available;
    if (!fieldProps.available) return false;

    const s = block.startTime;
    const e = block.endTime;

    const hasAvailableRules = rules.some(r => r.type === 'Available');
    let isAvailable = !hasAvailableRules;

    for (const rule of rules) {
        if (rule.type === 'Available') {
            if (s >= rule.startMin && e <= rule.endMin) { isAvailable = true; break; }
        }
    }
    for (const rule of rules) {
        if (rule.type === 'Unavailable') {
            if (s < rule.endMin && e > rule.startMin) { isAvailable = false; break; }
        }
    }
    return isAvailable;
  }

  // =====================================================================
  // DATA LOADER
  // =====================================================================
  function loadAndFilterData() {
    const globalSettings = window.loadGlobalSettings?.() || {};
    const app1Data = globalSettings.app1 || {};
    const masterFields = app1Data.fields || [];
    const masterDivisions = app1Data.divisions || {};
    const masterAvailableDivs = app1Data.availableDivisions || [];
    const masterSpecials = app1Data.specialActivities || [];
    const masterLeagues = globalSettings.leaguesByName || {};
    const masterSpecialtyLeagues = globalSettings.specialtyLeagues || {};
    const dailyData = window.loadCurrentDailyData?.() || {};
    const dailyFieldAvailability = dailyData.dailyFieldAvailability || {};
    const dailyOverrides = dailyData.overrides || {};
    const disabledLeagues = dailyOverrides.leagues || [];
    const disabledSpecialtyLeagues = dailyData.disabledSpecialtyLeagues || [];
    const dailyDisabledSportsByField = dailyData.dailyDisabledSportsByField || {};
    const disabledFields = dailyOverrides.disabledFields || [];
    const disabledSpecials = dailyOverrides.disabledSpecials || [];
    const rotationHistoryRaw = window.loadRotationHistory?.() || {};
    const rotationHistory = { bunks: rotationHistoryRaw.bunks || {}, leagues: rotationHistoryRaw.leagues || {}, leagueTeamSports: rotationHistoryRaw.leagueTeamSports || {}, leagueTeamLastSport: rotationHistoryRaw.leagueTeamLastSport || {} };
    
    const historicalCounts = {};
    try {
        const allDaily = window.loadAllDailyData?.() || {};
        const manualOffsets = globalSettings.manualUsageOffsets || {};
        Object.values(allDaily).forEach(day => {
            const sched = day.scheduleAssignments || {};
            Object.keys(sched).forEach(b => {
                if (!historicalCounts[b]) historicalCounts[b] = {};
                (sched[b] || []).forEach(e => {
                    if (e && e._activity && !e.continuation && !e._h2h) {
                        historicalCounts[b][e._activity] = (historicalCounts[b][e._activity] || 0) + 1;
                    }
                });
            });
        });
        Object.keys(manualOffsets).forEach(b => {
            if (!historicalCounts[b]) historicalCounts[b] = {};
            Object.keys(manualOffsets[b]).forEach(act => {
                const offset = manualOffsets[b][act] || 0;
                const current = historicalCounts[b][act] || 0;
                historicalCounts[b][act] = Math.max(0, current + offset);
            });
        });
    } catch (e) { console.error(e); }

    const overrides = { bunks: dailyOverrides.bunks || [], leagues: disabledLeagues };
    const availableDivisions = masterAvailableDivs.filter(divName => !overrides.bunks.includes(divName));
    const divisions = {};
    for (const divName of availableDivisions) {
        if (!masterDivisions[divName]) continue;
        divisions[divName] = JSON.parse(JSON.stringify(masterDivisions[divName]));
        divisions[divName].bunks = (divisions[divName].bunks || []).filter(bunkName => !overrides.bunks.includes(bunkName));
    }

    function parseTimeRule(rule) {
        if (!rule || !rule.type) return null;
        if (typeof rule.startMin === "number") return { type: rule.type, startMin: rule.startMin, endMin: rule.endMin };
        const startMin = parseTimeToMinutes(rule.start);
        const endMin   = parseTimeToMinutes(rule.end);
        if (startMin == null || endMin == null) return null;
        return { type: rule.type, startMin, endMin, start: rule.start, end: rule.end };
    }

    const activityProperties = {};
    const allMasterActivities = [...masterFields.filter(f => !disabledFields.includes(f.name)), ...masterSpecials.filter(s => !disabledSpecials.includes(s.name))];
    const availableActivityNames = [];
    allMasterActivities.forEach(f => {
        let finalRules;
        const dailyRules = dailyFieldAvailability[f.name];
        if (dailyRules && dailyRules.length > 0) finalRules = dailyRules.map(parseTimeRule).filter(Boolean);
        else finalRules = (f.timeRules || []).map(parseTimeRule).filter(Boolean);
        
        const isMasterAvailable = f.available !== false;
        const hasCustomDivList = Array.isArray(f.sharableWith?.divisions) && f.sharableWith.divisions.length > 0;
        activityProperties[f.name] = {
            available: isMasterAvailable,
            sharable: f.sharableWith?.type === 'all' || f.sharableWith?.type === 'custom',
            allowedDivisions: hasCustomDivList ? f.sharableWith.divisions.slice() : null,
            limitUsage: f.limitUsage || { enabled: false, divisions: {} },
            preferences: f.preferences || { enabled: false, exclusive: false, list: [] },
            maxUsage: f.maxUsage || 0,
            timeRules: finalRules
        };
        if (isMasterAvailable) availableActivityNames.push(f.name);
    });

    window.allSchedulableNames = availableActivityNames;
    const availFields = masterFields.filter(f => availableActivityNames.includes(f.name));
    const availSpecials = masterSpecials.filter(s => availableActivityNames.includes(s.name));
    const fieldsBySport = {};
    availFields.forEach(f => {
        if (Array.isArray(f.activities)) {
            f.activities.forEach(sport => {
                const isDisabledToday = dailyDisabledSportsByField[f.name]?.includes(sport);
                if (!isDisabledToday) {
                    fieldsBySport[sport] = fieldsBySport[sport] || [];
                    fieldsBySport[sport].push(f.name);
                }
            });
        }
    });

    const allActivities = [
        ...availFields.flatMap(f => (f.activities || []).map(act => ({ type: "field", field: f.name, sport: act }))).filter(a => !a.field || !a.sport || !dailyDisabledSportsByField[a.field]?.includes(a.sport)),
        ...availSpecials.map(sa => ({ type: "special", field: sa.name, sport: null }))
    ];
    const h2hActivities = allActivities.filter(a => a.type === "field" && a.sport);
    const yesterdayData = window.loadPreviousDailyData?.() || {};
    const yesterdayHistory = { schedule: yesterdayData.scheduleAssignments || {}, leagues: yesterdayData.leagueAssignments || {} };

    return { divisions, availableDivisions, activityProperties, allActivities, h2hActivities, fieldsBySport, masterLeagues, masterSpecialtyLeagues, yesterdayHistory, rotationHistory, disabledLeagues, disabledSpecialtyLeagues, historicalCounts };
  }

})();
