// ============================================================================
// total_solver_engine.js (FIXED v3 - WITH DEBUGGING)
// Backtracking Constraint Solver + League Engine
// ----------------------------------------------------------------------------
// CRITICAL FIXES:
// 1. Adjacent bunk preference when sharing fields (10+11 > 10+15)
// 2. Same activity requirement when sharing (enforced in scoring)
// 3. Proper capacity respect
// 4. EXTENSIVE DEBUGGING to find missing fields
// ============================================================================

(function () {
    'use strict';

    const Solver = {};
    const MAX_MATCHUP_ITERATIONS = 2000;
    
    // STRICT MODE - Enforce all constraints
    const FORCE_FIT_MODE = false; 
    
    // DEBUG MODE - Set to true to see why fields are rejected
    const DEBUG_MODE = true;

    // Runtime globals
    let globalConfig = null;
    let activityProperties = {};
    let allCandidateOptions = [];
    let fieldAvailabilityCache = {};

    // ============================================================================
    // HELPERS
    // ============================================================================

    function isSameActivity(a, b) {
        return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
    }

    function shuffleArray(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }

    function getBunkNumber(name) {
        const m = String(name).match(/(\d+)/);
        return m ? parseInt(m[1], 10) : null;
    }

    // ============================================================================
    // DEBUG LOGGING
    // ============================================================================
    
    function debugLog(...args) {
        if (DEBUG_MODE) {
            console.log('[SOLVER DEBUG]', ...args);
        }
    }

    // ============================================================================
    // PENALTY ENGINE (ENHANCED)
    // ============================================================================

    function calculatePenaltyCost(block, pick) {
        let penalty = 0;
        const bunk = block.bunk;
        const act = pick._activity;
        const fieldName = pick.field;

        // =================================================================
        // FIX: Use new sharing score from Utils
        // =================================================================
        const sharingScore = window.SchedulerCoreUtils?.calculateSharingScore?.(
            block, 
            fieldName, 
            window.fieldUsageBySlot, 
            act
        ) || 0;
        
        // Invert: Higher sharing score = lower penalty
        penalty -= sharingScore;

        // Check if field is already at capacity
        const schedules = window.scheduleAssignments || {};
        const slots = block.slots || [];
        
        for (const slotIdx of slots) {
            let fieldCount = 0;
            let existingActivities = new Set();
            
            for (const [otherBunk, otherSlots] of Object.entries(schedules)) {
                if (otherBunk === bunk) continue;
                const entry = otherSlots?.[slotIdx];
                if (!entry) continue;
                
                const entryField = window.SchedulerCoreUtils?.fieldLabel(entry.field) || entry._activity;
                if (entryField && entryField.toLowerCase().trim() === fieldName.toLowerCase().trim()) {
                    fieldCount++;
                    if (entry._activity) {
                        existingActivities.add(entry._activity.toLowerCase().trim());
                    }
                }
            }
            
            // Get capacity
            const props = activityProperties[fieldName] || {};
            let maxCapacity = 1;
            if (props.sharableWith?.capacity) {
                maxCapacity = parseInt(props.sharableWith.capacity) || 1;
            } else if (props.sharable || props.sharableWith?.type === "all") {
                maxCapacity = 2;
            }
            
            // =================================================================
            // FIX #1: HARD REJECT if at capacity
            // =================================================================
            if (fieldCount >= maxCapacity) {
                return 999999; // Impossible placement
            }
            
            // =================================================================
            // FIX #2: HARD REJECT if different activity on shared field
            // =================================================================
            if (fieldCount > 0 && existingActivities.size > 0) {
                const myActivity = (act || '').toLowerCase().trim();
                if (!existingActivities.has(myActivity)) {
                    debugLog(`Rejecting ${bunk} ${act} on ${fieldName} - existing activities: [${[...existingActivities].join(', ')}]`);
                    return 888888; // Different activity - reject
                }
            }
        }

        // =================================================================
        // FIX #3: ADJACENT BUNK BONUS
        // =================================================================
        const myNum = getBunkNumber(bunk);
        if (myNum !== null) {
            for (const slotIdx of slots) {
                for (const [otherBunk, otherSlots] of Object.entries(schedules)) {
                    if (otherBunk === bunk) continue;
                    const entry = otherSlots?.[slotIdx];
                    if (!entry) continue;
                    
                    const entryField = window.SchedulerCoreUtils?.fieldLabel(entry.field) || entry._activity;
                    if (entryField && entryField.toLowerCase().trim() === fieldName.toLowerCase().trim()) {
                        const otherNum = getBunkNumber(otherBunk);
                        if (otherNum !== null) {
                            const distance = Math.abs(myNum - otherNum);
                            // Adjacent bunks get bonus, far bunks get penalty
                            // Distance 1 = -50 penalty (good!)
                            // Distance 5 = +150 penalty (bad!)
                            penalty += (distance - 1) * 50;
                        }
                    }
                }
            }
        }

        // NO DOUBLE ACTIVITY (same bunk, same day)
        const today = window.scheduleAssignments[bunk] || {};
        let todayCount = 0;
        for (const e of Object.values(today)) {
            if (!e) continue;
            const existing = e._activity || e.activity || e.field;
            if (isSameActivity(existing, act)) {
                todayCount++;
            }
        }
        if (!pick._isLeague && todayCount >= 1) penalty += 15000;

        // SPECIAL MAX USAGE
        const specialRule = globalConfig.masterSpecials?.find(s => isSameActivity(s.name, act));
        if (specialRule && specialRule.maxUsage > 0) {
            const hist = globalConfig.historicalCounts?.[bunk]?.[act] || 0;
            if (hist + todayCount >= specialRule.maxUsage) penalty += 20000;
        }

        // FIELD PREFERENCES
        const props = activityProperties[fieldName];
        if (props?.preferences?.enabled) {
            const idx = (props.preferences.list || []).indexOf(block.divName);
            if (idx !== -1) {
                penalty -= (50 - idx * 5); 
            } else if (props.preferences.exclusive) {
                return 999999; 
            } else {
                penalty += 2000; 
            }
        }

        return penalty;
    }

    // ============================================================================
    // LEAGUE ENGINE
    // ============================================================================

    function getMatchupHistory(teamA, teamB, leagueName) {
        const hist = globalConfig.rotationHistory?.leagues || {};
        const key = [teamA, teamB].sort().join("|");
        const leagueKey = `${leagueName}|${key}`;
        const played = hist[leagueKey] || [];
        const sportCounts = {};
        for (const g of played) {
            sportCounts[g.sport] = (sportCounts[g.sport] || 0) + 1;
        }
        return { playCount: played.length, sportCounts };
    }

    function buildFieldConstraintCache(block, leagueSports) {
        const cache = {};
        for (const sport of leagueSports) {
            cache[sport] = [];
            const potentials = allCandidateOptions.filter(c => c.type === "sport" && isSameActivity(c.sport, sport));
            for (const cand of potentials) {
                const fits = window.SchedulerCoreUtils.canBlockFit(
                    block, cand.field, activityProperties, window.fieldUsageBySlot, cand.activityName, false
                );
                if (fits) cache[sport].push(cand.field);
            }
        }
        return cache;
    }

    function findOptimalSchedule(cands, current) {
        if (cands.length === 0) return current;
        if (current.length * 2 === globalConfig._totalLeagueTeams) return current;

        let best = null;
        let maxMatches = current.length;
        let iterations = 0;

        cands.sort((a, b) => {
            if (a.playCount !== b.playCount) return a.playCount - b.playCount;
            return Math.random() - 0.5;
        });

        const backtrack = (idx, cur) => {
            iterations++;
            if (iterations > MAX_MATCHUP_ITERATIONS) return;
            if (cur.length * 2 === globalConfig._totalLeagueTeams) {
                if (cur.length > maxMatches) { maxMatches = cur.length; best = cur; }
                return;
            }
            if (idx === cands.length) {
                if (cur.length > maxMatches) { maxMatches = cur.length; best = cur; }
                return;
            }

            const cand = cands[idx];
            const available = !cur.some(m =>
                m.t1 === cand.t1 || m.t1 === cand.t2 ||
                m.t2 === cand.t1 || m.t2 === cand.t2 ||
                m.field === cand.field
            );

            if (available) backtrack(idx + 1, [...cur, cand]);
            backtrack(idx + 1, cur);
        };

        backtrack(0, []);
        return best || [];
    }

    Solver.generateDailyMatchups = function (league, repBlock) {
        const teams = league.teams || [];
        if (teams.length < 2) return [];

        const allPairs = [];
        let minPlay = Infinity;

        for (let i = 0; i < teams.length; i++) {
            for (let j = i + 1; j < teams.length; j++) {
                const hist = getMatchupHistory(teams[i], teams[j], league.name);
                allPairs.push({
                    t1: teams[i], t2: teams[j],
                    playCount: hist.playCount, sportCounts: hist.sportCounts
                });
                minPlay = Math.min(minPlay, hist.playCount);
            }
        }

        globalConfig._totalLeagueTeams = teams.length;
        let candidates = allPairs.filter(p => p.playCount === minPlay);
        const leagueSports = league.sports || ["General Sport"];
        fieldAvailabilityCache = buildFieldConstraintCache(repBlock, leagueSports);

        const viable = [];
        for (const p of candidates) {
            let minSC = Infinity;
            for (const sport of leagueSports) {
                const c = p.sportCounts[sport] || 0;
                minSC = Math.min(minSC, c);
            }
            const validSports = leagueSports.filter(s => (p.sportCounts[s] || 0) === minSC && fieldAvailabilityCache[s] && fieldAvailabilityCache[s].length > 0);
            
            shuffleArray(validSports);
            for (const sport of validSports) {
                const fields = fieldAvailabilityCache[sport];
                shuffleArray(fields);
                for (const f of fields) {
                    viable.push({
                        t1: p.t1, t2: p.t2, playCount: p.playCount, sport: sport, field: f
                    });
                    if (viable.length > 50) break;
                }
            }
        }
        shuffleArray(viable);
        return findOptimalSchedule(viable, []);
    };

    Solver.solveLeagueSchedule = function (leagueBlocks) {
        if (!leagueBlocks?.length) return [];
        const output = [];
        const bucket = {};

        for (const b of leagueBlocks) {
            const key = `${b.divName}_${b.startTime}`;
            if (!bucket[key]) bucket[key] = [];
            bucket[key].push(b);
        }

        for (const key in bucket) {
            const blocks = bucket[key];
            const rep = blocks[0];
            const league = globalConfig.masterLeagues
                ? Object.values(globalConfig.masterLeagues).find(l => l.enabled && l.divisions?.includes(rep.divName))
                : null;

            if (!league) continue;

            const matches = Solver.generateDailyMatchups(league, rep);
            if (!matches.length) continue;

            const tier = matches[0].playCount;
            const gameLabel = `Round ${tier + 1}`;
            
            for (const b of blocks) {
                const myMatch = matches.find(m => m.t1 === b.bunk || m.t2 === b.bunk);
                if (!myMatch) continue;

                const opponent = (myMatch.t1 === b.bunk) ? myMatch.t2 : myMatch.t1;
                const pick = {
                    field: myMatch.field,
                    sport: myMatch.sport,
                    _activity: `vs ${opponent} (${myMatch.sport})`,
                    _isLeague: true,
                    _gameLabel: gameLabel
                };

                window.fillBlock(b, pick, window.fieldUsageBySlot, globalConfig.yesterdayHistory, true, activityProperties);
                output.push({ block: b, solution: pick });
            }
        }
        return output;
    };

    // ============================================================================
    // MAIN SOLVER (ENHANCED WITH DEBUGGING)
    // ============================================================================

    Solver.sortBlocksByDifficulty = function (blocks, config) {
        const meta = config.bunkMetaData || {};
        return blocks.sort((a, b) => {
            // Leagues first
            if (a._isLeague && !b._isLeague) return -1;
            if (!a._isLeague && b._isLeague) return 1;
            
            // Then by bunk number (lower first for better pairing)
            const numA = getBunkNumber(a.bunk) || Infinity;
            const numB = getBunkNumber(b.bunk) || Infinity;
            if (numA !== numB) return numA - numB;
            
            // Then by size
            const sa = meta[a.bunk]?.size || 0;
            const sb = meta[b.bunk]?.size || 0;
            if (sa !== sb) return sb - sa;
            
            return 0;
        });
    };

    /**
     * Build all candidate options from multiple sources
     */
    function buildAllCandidateOptions(config) {
        const options = [];
        const seenKeys = new Set();
        
        // Source 1: masterFields with activities
        debugLog('=== BUILDING CANDIDATE OPTIONS ===');
        debugLog('masterFields:', config.masterFields?.length || 0);
        
        config.masterFields?.forEach(f => {
            debugLog(`  Field: ${f.name}, activities:`, f.activities);
            (f.activities || []).forEach(sport => {
                const key = `${f.name}|${sport}`;
                if (!seenKeys.has(key)) {
                    seenKeys.add(key);
                    options.push({ 
                        field: f.name, 
                        sport, 
                        activityName: sport, 
                        type: "sport" 
                    });
                }
            });
        });
        
        // Source 2: masterSpecials
        debugLog('masterSpecials:', config.masterSpecials?.length || 0);
        config.masterSpecials?.forEach(s => {
            debugLog(`  Special: ${s.name}`);
            const key = `${s.name}|special`;
            if (!seenKeys.has(key)) {
                seenKeys.add(key);
                options.push({ 
                    field: s.name, 
                    sport: null, 
                    activityName: s.name, 
                    type: "special" 
                });
            }
        });
        
        // Source 3: activityProperties (fallback - in case fields are defined there but not in masterFields)
        debugLog('activityProperties keys:', Object.keys(activityProperties).length);
        for (const [fieldName, props] of Object.entries(activityProperties)) {
            if (!props.available) continue;
            
            // If this field has activities defined
            if (props.activities && Array.isArray(props.activities)) {
                props.activities.forEach(sport => {
                    const key = `${fieldName}|${sport}`;
                    if (!seenKeys.has(key)) {
                        debugLog(`  Adding from activityProperties: ${fieldName} -> ${sport}`);
                        seenKeys.add(key);
                        options.push({ 
                            field: fieldName, 
                            sport, 
                            activityName: sport, 
                            type: "sport" 
                        });
                    }
                });
            }
            
            // Also try to add the field itself as an activity if it's not a pure container
            // This catches fields like "Soccer Cage" that might host multiple sports
            const key = `${fieldName}|${fieldName}`;
            if (!seenKeys.has(key) && !fieldName.includes('Gym') && !fieldName.includes('Field')) {
                // Only if it looks like an activity name
                debugLog(`  Adding field as activity: ${fieldName}`);
                seenKeys.add(key);
                options.push({ 
                    field: fieldName, 
                    sport: fieldName, 
                    activityName: fieldName, 
                    type: "sport" 
                });
            }
        }
        
        // Source 4: fieldsBySport from loadAndFilterData
        const loadedData = window.SchedulerCoreUtils?.loadAndFilterData?.() || {};
        const fieldsBySport = loadedData.fieldsBySport || {};
        
        debugLog('fieldsBySport:', Object.keys(fieldsBySport));
        for (const [sport, fields] of Object.entries(fieldsBySport)) {
            (fields || []).forEach(fieldName => {
                const key = `${fieldName}|${sport}`;
                if (!seenKeys.has(key)) {
                    debugLog(`  Adding from fieldsBySport: ${fieldName} -> ${sport}`);
                    seenKeys.add(key);
                    options.push({ 
                        field: fieldName, 
                        sport, 
                        activityName: sport, 
                        type: "sport" 
                    });
                }
            });
        }
        
        debugLog('=== TOTAL CANDIDATE OPTIONS:', options.length, '===');
        debugLog('Options:', options.map(o => `${o.field}:${o.activityName}`).join(', '));
        
        return options;
    }

    Solver.getValidActivityPicks = function (block) {
        const picks = [];
        const rejectionReasons = {};
        
        for (const cand of allCandidateOptions) {
            // Use the new strict canBlockFit with activity name
            const fits = window.SchedulerCoreUtils.canBlockFit(
                block, 
                cand.field, 
                activityProperties, 
                window.fieldUsageBySlot,
                cand.activityName,
                false
            );
            
            if (fits) {
                const pick = { 
                    field: cand.field, 
                    sport: cand.sport, 
                    _activity: cand.activityName 
                };
                const cost = calculatePenaltyCost(block, pick);
                
                // Skip impossible placements
                if (cost < 500000) {
                    picks.push({ pick, cost });
                } else {
                    rejectionReasons[`${cand.field}:${cand.activityName}`] = `High penalty: ${cost}`;
                }
            } else {
                rejectionReasons[`${cand.field}:${cand.activityName}`] = 'canBlockFit=false';
            }
        }
        
        // DEBUG: Log rejections for this block if we have very few picks
        if (picks.length < 3 && DEBUG_MODE) {
            debugLog(`Block ${block.bunk} at ${block.startTime} has only ${picks.length} valid picks`);
            debugLog(`  Valid picks: ${picks.map(p => `${p.pick.field}:${p.pick._activity}`).join(', ')}`);
            debugLog(`  Sample rejections:`, Object.entries(rejectionReasons).slice(0, 5));
        }
        
        // Always have Free as fallback
        picks.push({ 
            pick: { field: "Free", sport: null, _activity: "Free" }, 
            cost: 50000 
        });
        
        return picks;
    };

    Solver.applyTentativePick = function (block, scored) {
        const pick = scored.pick;
        window.fillBlock(block, pick, window.fieldUsageBySlot, globalConfig.yesterdayHistory, false, activityProperties);
        return { block, pick, bunk: block.bunk, startMin: block.startTime };
    };

    Solver.undoTentativePick = function (res) {
        const { bunk, block } = res;
        const slots = block.slots || [];
        
        if (window.scheduleAssignments[bunk]) {
            for (const slotIdx of slots) {
                delete window.scheduleAssignments[bunk][slotIdx];
            }
        }
        
        // Also remove from fieldUsageBySlot
        if (window.fieldUsageBySlot && res.pick) {
            const fieldName = res.pick.field;
            for (const slotIdx of slots) {
                if (window.fieldUsageBySlot[slotIdx]?.[fieldName]) {
                    const usage = window.fieldUsageBySlot[slotIdx][fieldName];
                    if (usage.bunks) {
                        delete usage.bunks[bunk];
                    }
                    if (usage.count > 0) {
                        usage.count--;
                    }
                }
            }
        }
    };

    Solver.solveSchedule = function (allBlocks, config) {
        globalConfig = config;
        activityProperties = config.activityProperties || {};

        let iterations = 0;
        const SAFETY_LIMIT = 100000;

        // Build candidate options from ALL sources
        allCandidateOptions = buildAllCandidateOptions(config);
        
        // If we still have no options, something is very wrong
        if (allCandidateOptions.length === 0) {
            console.error('[SOLVER] NO CANDIDATE OPTIONS BUILT! Check masterFields and activityProperties.');
            console.error('  config.masterFields:', config.masterFields);
            console.error('  activityProperties keys:', Object.keys(activityProperties));
        }

        if (!window.leagueRoundState) window.leagueRoundState = {};
        if (!globalConfig.rotationHistory) globalConfig.rotationHistory = {};
        if (!globalConfig.rotationHistory.leagues) globalConfig.rotationHistory.leagues = {};

        // Sort blocks - IMPORTANT: Process by bunk number for better pairing
        const sorted = Solver.sortBlocksByDifficulty(allBlocks, config);
        const leagueBlocks = sorted.filter(b => b._isLeague);
        const activityBlocks = sorted.filter(b => !b._isLeague);

        console.log(`[SOLVER] Processing ${activityBlocks.length} activity blocks with ${allCandidateOptions.length} candidate options`);

        const solvedLeague = Solver.solveLeagueSchedule(leagueBlocks);

        let bestSchedule = [...solvedLeague];
        let maxDepthReached = 0;

        function backtrack(idx, acc) {
            iterations++;
            if (idx > maxDepthReached) { 
                maxDepthReached = idx; 
                bestSchedule = [...acc]; 
            }
            if (idx === activityBlocks.length) return acc;
            if (iterations > SAFETY_LIMIT) { 
                console.warn(`[SOLVER] Iteration limit ${SAFETY_LIMIT} hit.`); 
                return null; 
            }

            const block = activityBlocks[idx];
            
            // Get valid picks and sort by cost (lower is better)
            const picks = Solver.getValidActivityPicks(block)
                .sort((a, b) => a.cost - b.cost)
                .slice(0, 10); // Try top 10 options

            for (const p of picks) {
                const res = Solver.applyTentativePick(block, p);
                const out = backtrack(idx + 1, [...acc, { block, solution: p.pick }]);
                if (out) return out;
                Solver.undoTentativePick(res);
            }
            return null;
        }

        const final = backtrack(0, solvedLeague);

        if (final) {
            console.log(`[SOLVER] Solution found after ${iterations} iterations`);
            return final.map(a => ({ 
                bunk: a.block.bunk, 
                divName: a.block.divName, 
                startTime: a.block.startTime, 
                endTime: a.block.endTime, 
                solution: a.solution 
            }));
        } else {
            console.warn("[SOLVER] Optimal solution not found. Using best partial.");
            const solvedBlocksSet = new Set(bestSchedule.map(s => s.block));
            const missingBlocks = activityBlocks.filter(b => !solvedBlocksSet.has(b));
            
            // Fill missing with Free
            const fallback = [
                ...bestSchedule,
                ...missingBlocks.map(b => ({ 
                    block: b, 
                    solution: { field: "Free", sport: null, _activity: "Free (Timeout)" } 
                }))
            ];
            
            return fallback.map(a => ({ 
                bunk: a.block.bunk, 
                divName: a.block.divName, 
                startTime: a.block.startTime, 
                endTime: a.block.endTime, 
                solution: a.solution 
            }));
        }
    };
    
    // ============================================================================
    // DEBUG UTILITIES - Call from console to diagnose issues
    // ============================================================================
    
    Solver.debugFieldAvailability = function() {
        console.log('=== FIELD AVAILABILITY DEBUG ===');
        console.log('activityProperties:', activityProperties);
        console.log('allCandidateOptions:', allCandidateOptions);
        
        // Test a sample block
        const testBlock = {
            bunk: 'Test',
            divName: 'Test Division',
            startTime: 660, // 11:00 AM
            endTime: 720,   // 12:00 PM
            slots: [0, 1]
        };
        
        console.log('Testing field availability for sample block:', testBlock);
        
        for (const cand of allCandidateOptions) {
            const fits = window.SchedulerCoreUtils?.canBlockFit?.(
                testBlock, 
                cand.field, 
                activityProperties, 
                window.fieldUsageBySlot || {},
                cand.activityName,
                false
            );
            console.log(`  ${cand.field} (${cand.activityName}): ${fits ? 'AVAILABLE' : 'BLOCKED'}`);
        }
    };

    window.totalSolverEngine = Solver;

})();
