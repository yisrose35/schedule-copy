// ============================================================================
// scheduler_logic_core.js
//
// "SUPER GEMINI" EDITION (Full Restoration):
// - RESTORED: The complex DFS Sport Optimizer (Smart Balancing).
// - FIXED: Syntax error (Illegal return) resolved by strictly scoping functions.
// - FIXED: Overlap Logic ensures 12:20pm blocks register in 12:00pm slots.
// - FIXED: ProcessLeagues logic fully integrated.
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
  // 1. GLOBAL AVAILABILITY MANAGER
  // =============================================================
  const GlobalAvailabilityManager = (function() {
    let reservations = {};

    function reset() { 
        reservations = {}; 
    }

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

    function getReservationsForField(field) { 
        return reservations[field] || []; 
    }

    function checkAvailability(field, start, end, meta, fieldProps) {
        if (!reservations[field]) return { valid: true };
        
        const existingBlocks = reservations[field];
        // Allow 2 bunks if sharable and not a league game. Otherwise 1.
        const capacityLimit = (fieldProps.sharable && !meta.isLeague) ? 2 : 1; 

        // Overlap Logic: (StartA < EndB) && (EndA > StartB)
        const overlaps = existingBlocks.filter(r => r.start < end && r.end > start);

        if (overlaps.length === 0) return { valid: true };

        if (overlaps.length >= capacityLimit) {
            return { valid: false, reason: "At Capacity" };
        }

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

  // =============================================================
  // 2. HELPERS
  // =============================================================
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

  function fieldLabel(f) { 
      return (f && typeof f === 'object' && f.name) ? f.name : f; 
  }

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
  // 3. LEAGUE LOGIC HELPERS
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

  // ====== SMART DFS SPORT OPTIMIZER (RESTORED) ======
  function assignSportsMultiRound(matchups, availableLeagueSports, existingTeamCounts) {
    const sports = availableLeagueSports.slice();
    const baseTeamCounts = existingTeamCounts || {};
    const allTeams = new Set();
    matchups.forEach(([a, b]) => { if(a && b) { allTeams.add(String(a)); allTeams.add(String(b)); }});

    const workCounts = {};
    allTeams.forEach(t => workCounts[t] = { ...baseTeamCounts[t] });
    
    // Track total usage of each sport to ensure variety
    const sportTotals = {};
    sports.forEach(s => sportTotals[s] = 0);
    for(const t in workCounts) {
        for(const s in workCounts[t]) sportTotals[s] = (sportTotals[s]||0) + workCounts[t][s];
    }

    let bestPlan = null;
    let bestScore = Infinity;
    let bestCounts = null;
    let nodesVisited = 0;
    const MAX_NODES = 5000; // Safety brake

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
        
        // Sort sports by current global usage to try least-used first
        const orderedSports = sports.slice().sort((a, b) => (sportTotals[a] - sportTotals[b]) || (Math.random() - 0.5));

        for (const sport of orderedSports) {
            const prevA = workCounts[teamA][sport] || 0;
            const prevB = workCounts[teamB][sport] || 0;
            let delta = 0;
            
            // High penalty for repeating sports
            if (prevA > 0) delta += 10 * prevA;
            if (prevB > 0) delta += 10 * prevB;
            
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

            workCounts[teamA][sport] = prevA;
            workCounts[teamB][sport] = prevB;
            sportTotals[sport]--;
            if(prevA===0) delete workCounts[teamA][sport];
            if(prevB===0) delete workCounts[teamB][sport];
        }
    }

    dfs(0, [], 0);

    // Fallback if DFS finds nothing (rare)
    if (!bestPlan) {
        const fallback = matchups.map((_, i) => ({ sport: sports[i % sports.length] }));
        return { assignments: fallback, updatedTeamCounts: baseTeamCounts };
    }
    return { assignments: bestPlan, updatedTeamCounts: bestCounts || baseTeamCounts };
  }

  // =====================================================================
  // 4. MAIN OPTIMIZER FUNCTION
  // =====================================================================
  window.runSkeletonOptimizer = function (manualSkeleton) {
    window.scheduleAssignments = {};
    window.leagueAssignments = {};
    window.unifiedTimes = [];
    
    window.GlobalAvailabilityManager.reset();

    if (!manualSkeleton || manualSkeleton.length === 0) return false;

    const data = loadAndFilterData();
    if (!data) return false;

    const {
      divisions, availableDivisions, activityProperties, allActivities, h2hActivities,
      fieldsBySport, masterLeagues, masterSpecialtyLeagues, yesterdayHistory,
      rotationHistory, disabledLeagues, disabledSpecialtyLeagues, historicalCounts
    } = data;

    let fieldUsageBySlot = {}; 
    window.fieldUsageBySlot = fieldUsageBySlot;
    window.activityProperties = activityProperties;

    const timestamp = Date.now();

    // --- Pass 0: Build Unified Time Grid ---
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
      let dStart = new Date(baseDate.getTime() + currentMin * 60000);
      let dEnd = new Date(baseDate.getTime() + nextMin * 60000);
      
      const fmt = (d) => {
          let h = d.getHours(), m = d.getMinutes(), ap = h >= 12 ? 'PM' : 'AM';
          h = h % 12 || 12;
          return `${h}:${m.toString().padStart(2, '0')} ${ap}`;
      };

      window.unifiedTimes.push({
        start: dStart,
        end: dEnd,
        label: `${fmt(dStart)} - ${fmt(dEnd)}`
      });
      currentMin = nextMin;
    }
    
    availableDivisions.forEach((divName) => {
      (divisions[divName]?.bunks || []).forEach((bunk) => {
        window.scheduleAssignments[bunk] = new Array(window.unifiedTimes.length);
      });
    });

    // --- Helper Functions ---
    function findSlotsForRange(startMin, endMin) {
        const slots = [];
        if (!window.unifiedTimes || startMin == null || endMin == null) return slots;
        window.unifiedTimes.forEach((slot, i) => {
            const slotStart = slot.start.getHours()*60 + slot.start.getMinutes();
            const slotEnd = slotStart + INCREMENT_MINS;
            // Overlap Logic: Max(startA, startB) < Min(endA, endB)
            if (Math.max(startMin, slotStart) < Math.min(endMin, slotEnd)) {
                slots.push(i);
            }
        });
        return slots;
    }

    function markFieldUsage(block, fieldName, usageMap) {
        if (!fieldName || fieldName === 'No Field' || !window.allSchedulableNames?.includes(fieldName)) return;
        
        const sMin = block.startTime;
        const eMin = block.endTime;
        
        if (sMin != null && eMin != null) {
            window.GlobalAvailabilityManager.addReservation(fieldName, sMin, eMin, {
                divName: block.divName, bunk: block.bunk, activity: block._activity || block.sport, isLeague: false
            });
        }

        (block.slots || []).forEach(i => {
            usageMap[i] = usageMap[i] || {};
            const u = usageMap[i][fieldName] || { count: 0, divisions: [], bunks: {} };
            u.count++;
            if (!u.divisions.includes(block.divName)) u.divisions.push(block.divName);
            if (block.bunk) u.bunks[block.bunk] = block._activity;
            usageMap[i][fieldName] = u;
        });
    }

    function fillBlock(block, pick, usageMap, history, isLeagueFill) {
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
            markFieldUsage({ ...block, _activity: pick._activity }, fieldName, usageMap);
        }
    }

    // --- Pass 1.5: Bunk Overrides (Pinned Activities) ---
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

    // --- Pass 2: Skeletons (Manual) ---
    const schedulableSlotBlocks = [];
    manualSkeleton.forEach((item) => {
        const allBunks = divisions[item.division]?.bunks || [];
        const startMin = parseTimeToMinutes(item.startTime);
        const endMin = parseTimeToMinutes(item.endTime);
        const allSlots = findSlotsForRange(startMin, endMin);
        
        if (!allBunks.length || !allSlots.length) return;

        let eventType = item.event;
        if(eventType.toLowerCase().includes('general')) eventType = 'General Activity Slot';
        else if(eventType.toLowerCase().includes('league') && !eventType.toLowerCase().includes('specialty')) eventType = 'League Game';
        else if(eventType.toLowerCase().includes('specialty')) eventType = 'Specialty League';

        const isGenerated = GENERATED_EVENTS.includes(eventType);

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
             // Split Logic (Swim / General)
             const midBunk = Math.ceil(allBunks.length/2);
             const midSlot = Math.ceil(allSlots.length/2);
             const bunksTop = allBunks.slice(0, midBunk);
             const bunksBot = allBunks.slice(midBunk);
             const slots1 = allSlots.slice(0, midSlot);
             const slots2 = allSlots.slice(midSlot);
             const midTime = startMin + (midSlot * INCREMENT_MINS);
             const gaName = 'General Activity Slot';

             bunksTop.forEach(b => {
                 slots1.forEach((s,i) => window.scheduleAssignments[b][s] = { field: {name:'Swim'}, _fixed:true, continuation:i>0, _activity:'Swim' });
                 markFieldUsage({divName:item.division, bunk:b, startTime:startMin, endTime:midTime, slots:slots1}, 'Swim', fieldUsageBySlot);
                 schedulableSlotBlocks.push({divName:item.division, bunk:b, event:gaName, startTime:midTime, endTime:endMin, slots:slots2});
             });
             bunksBot.forEach(b => {
                 schedulableSlotBlocks.push({divName:item.division, bunk:b, event:gaName, startTime:startMin, endTime:midTime, slots:slots1});
                 slots2.forEach((s,i) => window.scheduleAssignments[b][s] = { field: {name:'Swim'}, _fixed:true, continuation:i>0, _activity:'Swim' });
                 markFieldUsage({divName:item.division, bunk:b, startTime:midTime, endTime:endMin, slots:slots2}, 'Swim', fieldUsageBySlot);
             });
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

    // --- Pass 3: Leagues (Regular & Specialty) ---
    const processLeagues = (blocks, isSpecialty) => {
        const groups = {};
        blocks.forEach(b => {
            const k = `${b.divName}-${b.startTime}`;
            if (!groups[k]) groups[k] = { ...b, bunks: new Set() };
            groups[k].bunks.add(b.bunk);
        });

        Object.values(groups).sort((a,b)=>a.startTime-b.startTime).forEach(group => {
            const masterSource = isSpecialty ? masterSpecialtyLeagues : masterLeagues;
            const disabledSource = isSpecialty ? disabledSpecialtyLeagues : disabledLeagues;
            
            const leagueEntry = Object.values(masterSource).find(l => 
                l.enabled && !disabledSource.includes(l.name) && l.divisions.includes(group.divName)
            );
            
            if (!leagueEntry) return;

            const leagueTeams = (leagueEntry.teams || []).map(String);
            const bunks = Array.from(group.bunks).sort();
            const sports = (leagueEntry.sports || []).filter(s => fieldsBySport[s]);
            
            const matchups = isSpecialty 
                ? pairRoundRobin(leagueTeams) 
                : coreGetNextLeagueRound(leagueEntry.name, leagueTeams);
            
            const nonBye = matchups.filter(p => p[0] !== 'BYE' && p[1] !== 'BYE');
            
            // USE SMART OPTIMIZER
            const { assignments } = assignSportsMultiRound(nonBye, sports, {});

            const localUsedFields = new Set();
            const results = [];
            
            nonBye.forEach((pair, idx) => {
                const [teamA, teamB] = pair;
                const prefSport = assignments[idx]?.sport || sports[0];
                const candidateSports = [prefSport, ...sports.filter(s => s !== prefSport)];
                
                let foundField = null;
                let foundSport = null;

                for (const s of candidateSports) {
                    const fields = fieldsBySport[s] || [];
                    for (const f of fields) {
                        if (localUsedFields.has(f)) continue;
                        const props = activityProperties[f];
                        const avail = window.GlobalAvailabilityManager.checkAvailability(
                            f, group.startTime, group.endTime, 
                            { divName: group.divName, bunk: "league", activity: isSpecialty?"Specialty":"League", isLeague: true }, 
                            props
                        );
                        
                        // Simplified time check
                        let isTimeOk = true;
                        if(props.timeRules && props.timeRules.length > 0) {
                            const sm=group.startTime, em=group.endTime;
                            let hasAvailRule = props.timeRules.some(r=>r.type==='Available');
                            let timeAllowed = !hasAvailRule;
                            props.timeRules.forEach(r => {
                                if(r.type==='Available' && sm >= r.startMin && em <= r.endMin) timeAllowed = true;
                                if(r.type==='Unavailable' && sm < r.endMin && em > r.startMin) timeAllowed = false;
                            });
                            isTimeOk = timeAllowed;
                        }
                        
                        if (avail.valid && isTimeOk) {
                            foundField = f;
                            foundSport = s;
                            break; 
                        }
                    }
                    if (foundField) break;
                }
                
                if (foundField) {
                    localUsedFields.add(foundField);
                    results.push({ pair, field: foundField, sport: foundSport });
                } else {
                    results.push({ pair, field: null, sport: prefSport });
                }
            });

            const assignedMap = {};
            const labels = [];
            
            results.forEach(res => {
                const [tA, tB] = res.pair;
                let lbl, pick;
                if (res.field) {
                    lbl = `${tA} vs ${tB} (${res.sport}) @ ${res.field}`;
                    markFieldUsage({ ...group, _activity: "League", bunk: null }, res.field, fieldUsageBySlot);
                    pick = { field: res.field, sport: lbl, _h2h: true, _activity: "League", _leagueType: isSpecialty?"specialty":"regular" };
                } else {
                    lbl = `${tA} vs ${tB} (No Field)`;
                    pick = { field: "No Field", sport: lbl, _h2h: true, _activity: "League", _leagueType: isSpecialty?"specialty":"regular" };
                }
                labels.push(lbl);
                assignedMap[tA] = pick;
                assignedMap[tB] = pick;
            });
            
            // Assign Bye games to labels so they appear in print
            matchups.forEach(p => {
                if (p[0] === 'BYE' || p[1] === 'BYE') {
                    labels.push(`${p[0]} vs ${p[1]} (BYE)`);
                }
            });

            bunks.forEach(b => {
                const base = assignedMap[b] || { field: "No Game", sport: null, _h2h: true, _activity: "League" };
                fillBlock({ ...group, bunk: b }, { ...base, _allMatchups: labels }, fieldUsageBySlot, yesterdayHistory, true);
            });
        });
    };

    // Execute Leagues
    const specialtyBlocks = schedulableSlotBlocks.filter(b => b.event === 'Specialty League');
    if (specialtyBlocks.length > 0) processLeagues(specialtyBlocks, true);

    const leagueBlocks = schedulableSlotBlocks.filter(b => b.event === 'League Game');
    if (leagueBlocks.length > 0) processLeagues(leagueBlocks, false);

    // --- Pass 4: Fillers ---
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

    // --- Pass 5: Save & Finish ---
    try {
        availableDivisions.forEach((divName) => {
            (divisions[divName]?.bunks || []).forEach((bunk) => {
                const schedule = window.scheduleAssignments[bunk] || [];
                let lastActivity = null;
                schedule.forEach(entry => {
                    if (entry && entry._activity && entry._activity !== lastActivity) {
                        lastActivity = entry._activity;
                        rotationHistory.bunks[bunk] = rotationHistory.bunks[bunk] || {};
                        rotationHistory.bunks[bunk][lastActivity] = timestamp;
                    } else if (entry && !entry.continuation) lastActivity = null;
                });
            });
        });
        window.saveRotationHistory?.(rotationHistory);
    } catch(e) { console.error(e); }

    window.saveCurrentDailyData?.('unifiedTimes', window.unifiedTimes);
    window.updateTable?.();
    window.saveSchedule?.();

    return true;
  };

  // =====================================================================
  // 5. DATA LOADER
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
    const dailyOverrides = dailyData.overrides || {};
    const dailyFieldAvailability = dailyData.dailyFieldAvailability || {};
    const dailyDisabledSportsByField = dailyData.dailyDisabledSportsByField || {};
    
    const disabledLeagues = dailyOverrides.leagues || [];
    const disabledSpecialtyLeagues = dailyData.disabledSpecialtyLeagues || [];
    const disabledFields = dailyOverrides.disabledFields || [];
    const disabledSpecials = dailyOverrides.disabledSpecials || [];
    
    const rotationHistoryRaw = window.loadRotationHistory?.() || {};
    const rotationHistory = { bunks: rotationHistoryRaw.bunks || {}, leagues: rotationHistoryRaw.leagues || {} };
    
    const overrides = { bunks: dailyOverrides.bunks || [] };
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
    const yesterdayHistory = { schedule: window.loadPreviousDailyData?.().scheduleAssignments || {} };
    const historicalCounts = {};

    return { 
        divisions, availableDivisions, activityProperties, allActivities, h2hActivities, 
        fieldsBySport, masterLeagues, masterSpecialtyLeagues, yesterdayHistory, 
        rotationHistory, disabledLeagues, disabledSpecialtyLeagues, historicalCounts 
    };
  }

})();
