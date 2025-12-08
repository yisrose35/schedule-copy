// ============================================================================
// scheduler_core_leagues.js — SMART ROTATION v4 (MAGNUS CARLSEN ENGINE)
// Implements Constraint Satisfaction with Forward Checking for perfect rotation
// ============================================================================

(function () {
    "use strict";

    const Leagues = {};

    // =========================================================================
    // UTILITY: SAFE FIELDS
    // =========================================================================
    function getSafeFields(ctx) {
        const f = ctx.fields || ctx.masterFields || [];
        return Array.isArray(f) ? f : [];
    }

    // =========================================================================
    // 1. VALID FIELDS FOR SPORT + DIVISION
    // =========================================================================
    function getValidFieldsForSport(sport, division, ctx) {
        const fields = getSafeFields(ctx);
        if (!fields.length) return [];

        return fields.filter(f => {
            if (!f || !f.available) return false;
            if (!Array.isArray(f.activities)) return false;
            if (!f.activities.includes(sport)) return false;

            // Division restrictions
            if (f.limitUsage?.enabled) {
                const allowedDivs = Object.keys(f.limitUsage.divisions || {});
                if (allowedDivs.length > 0 && !allowedDivs.includes(division)) {
                    return false;
                }
            }
            return true;
        });
    }

    // =========================================================================
    // 2. FIELD PRIORITY CHOOSER
    // =========================================================================
    function pickBestField(validFields, division) {
        if (!validFields || validFields.length === 0) return null;
        if (validFields.length === 1) return validFields[0];

        const scored = validFields.map(f => {
            let score = 0;
            if (f.preferences?.enabled && Array.isArray(f.preferences.list)) {
                const idx = f.preferences.list.indexOf(division);
                if (idx !== -1) score += (100 - idx);
            }
            return { f, score };
        });

        scored.sort((a, b) => b.score - a.score);
        return scored[0].f;
    }

    // =========================================================================
    // 3. LEGACY SPORT CHOOSER (FALLBACK)
    // =========================================================================
    function pickBestSportGreedy(teamA, teamB, league, history) {
        const sports = league.sports.slice();
        const playedA = history[teamA] || {};
        const playedB = history[teamB] || {};
        
        // Check pair history
        const k1 = `${teamA}-${teamB}`;
        const k2 = `${teamB}-${teamA}`;
        const pairHist = history.__pairs?.[k1] || history.__pairs?.[k2] || [];
        const lastPairSport = pairHist[pairHist.length - 1] || null;

        const lastA = playedA.__last || null;
        const lastB = playedB.__last || null;

        const scored = sports.map(s => {
            let score = 100;
            if (s === lastPairSport) score -= 80; // Avoid rematch sport
            if (s === lastA) score -= 1000;       // CRITICAL: No back-to-back
            if (s === lastB) score -= 1000;       // CRITICAL: No back-to-back
            score -= ((playedA[s] || 0) + (playedB[s] || 0)) * 2; // Fairness
            return { s, score };
        });

        scored.sort((a, b) => b.score - a.score);
        return scored[0].s;
    }

    // =========================================================================
    // 4. THE MAGNUS CARLSEN SOLVER (Constraint Programming Class)
    // =========================================================================
    class MagnusSportSolver {
        constructor(timelineGroups, globalHistory, context) {
            this.groups = timelineGroups; // Sorted by time
            this.history = JSON.parse(JSON.stringify(globalHistory)); // Clone to avoid side effects
            this.context = context;
            
            // Build the "Board" (Schedule Structure)
            // We need to know every match that needs a sport assigned
            this.schedule = []; 
            this.domains = []; // 3D Matrix: [roundIndex][matchIndex] = Set(ValidSports)

            this.initializeDomains();
        }

        initializeDomains() {
            // Pre-calculate valid sports for every single match based on Field Availability
            this.groups.forEach((group, groupIdx) => {
                const groupDomains = [];
                const groupMatches = [];

                group.pendingMatchups.forEach(match => {
                    // Check which sports actually have valid fields at this time
                    const validSports = group.league.sports.filter(sport => {
                        const fields = getValidFieldsForSport(sport, group.divName, this.context);
                        return fields && fields.length > 0;
                    });
                    
                    groupDomains.push(new Set(validSports));
                    groupMatches.push({ ...match, assignedSport: null });
                });

                this.domains.push(groupDomains);
                this.schedule.push(groupMatches);
            });
        }

        // --- THE ENGINE ---

        solve(roundIdx = 0) {
            // ENDGAME: Schedule Complete
            if (roundIdx >= this.schedule.length) return true;

            const currentRoundMatches = this.schedule[roundIdx];
            
            // OPENING: Sort matches by "Most Constrained" (fewest valid sport options)
            // We create indices to track which match is which
            const matchIndices = currentRoundMatches.map((_, i) => i);
            matchIndices.sort((a, b) => {
                return this.domains[roundIdx][a].size - this.domains[roundIdx][b].size;
            });

            return this.assignRoundRecursively(roundIdx, matchIndices, 0);
        }

        assignRoundRecursively(roundIdx, sortedIndices, sortedIdx) {
            // Round Complete, move to next round
            if (sortedIdx >= sortedIndices.length) {
                return this.solve(roundIdx + 1);
            }

            const matchRealIdx = sortedIndices[sortedIdx];
            const match = this.schedule[roundIdx][matchRealIdx];
            const domain = this.domains[roundIdx][matchRealIdx];

            // Heuristic Sort: Try sports that avoid rematches first
            const options = Array.from(domain);
            this.sortOptionsByHeuristics(options, match.teamA, match.teamB);

            for (const sport of options) {
                // 1. TACTICAL CHECK (Immediate Consistency)
                if (!this.isSafe(roundIdx, match.teamA, match.teamB, sport)) continue;

                // 2. FORWARD CHECKING (The Magnus Vision)
                // If we pick this sport, does it kill the timeline for these teams in the future?
                if (!this.forwardCheck(roundIdx, match.teamA, match.teamB, sport)) continue;

                // 3. MAKE MOVE
                match.assignedSport = sport;
                this.updateTempHistory(match.teamA, match.teamB, sport);

                // 4. DEEP RECURSION
                if (this.assignRoundRecursively(roundIdx, sortedIndices, sortedIdx + 1)) {
                    return true;
                }

                // 5. UNDO (Backtrack)
                match.assignedSport = null;
                this.revertTempHistory(match.teamA, match.teamB);
            }

            return false; // Checkmate: No valid moves
        }

        isSafe(roundIdx, teamA, teamB, sport) {
            // Check Last Sport Played (from Global History OR previous rounds in this batch)
            const lastA = this.getLastSport(roundIdx, teamA);
            const lastB = this.getLastSport(roundIdx, teamB);
            
            if (lastA === sport) return false; // Violation: Back-to-Back
            if (lastB === sport) return false; // Violation: Back-to-Back
            return true;
        }

        forwardCheck(currentRound, teamA, teamB, sport) {
            // Look ahead to the very next round
            const nextRound = currentRound + 1;
            if (nextRound >= this.schedule.length) return true;

            // Find matches involving Team A or Team B in the next round
            const nextMatches = this.schedule[nextRound];
            
            for (let i = 0; i < nextMatches.length; i++) {
                const m = nextMatches[i];
                if (m.teamA === teamA || m.teamB === teamA || m.teamA === teamB || m.teamB === teamB) {
                    
                    // What if we removed 'sport' from this future match's domain?
                    // (Because a team can't play it again immediately)
                    const futureDomain = this.domains[nextRound][i];
                    
                    if (futureDomain.has(sport)) {
                        // If 'sport' was their ONLY option, this current move is fatal.
                        if (futureDomain.size <= 1) return false; 
                    }
                }
            }
            return true;
        }

        getLastSport(currentRound, team) {
            // 1. Check current batch (previous rounds 0 to currentRound-1)
            for (let r = currentRound - 1; r >= 0; r--) {
                const match = this.schedule[r].find(m => m.teamA === team || m.teamB === team);
                if (match && match.assignedSport) return match.assignedSport;
            }
            // 2. Check global history (yesterday/previous batches)
            return this.history[team]?.__last || null;
        }

        updateTempHistory(teamA, teamB, sport) {
            // We just track this locally for simple isSafe checks within recursion
            // The real history update happens only on success
        }

        revertTempHistory(teamA, teamB) {
            // No-op required logic handled by dynamic lookup in getLastSport
        }

        sortOptionsByHeuristics(options, teamA, teamB) {
            // Prefer sports NOT played recently by the Pair (Rematch rule)
            const k1 = `${teamA}-${teamB}`;
            const k2 = `${teamB}-${teamA}`;
            const pairHist = this.history.__pairs?.[k1] || this.history.__pairs?.[k2] || [];
            const lastPairSport = pairHist[pairHist.length - 1];

            options.sort((a, b) => {
                let scoreA = 0; 
                let scoreB = 0;
                if (a !== lastPairSport) scoreA += 50;
                if (b !== lastPairSport) scoreB += 50;
                return scoreB - scoreA;
            });
        }

        getResults() {
            return this.schedule;
        }
    }

    // =========================================================================
    // 5. UPDATE HISTORY UTILITY
    // =========================================================================
    function updateHistory(teamA, teamB, sport, history) {
        history[teamA] ??= {};
        history[teamB] ??= {};
        history.__pairs ??= {};

        const k1 = `${teamA}-${teamB}`;
        const k2 = `${teamB}-${teamA}`;

        history.__pairs[k1] ??= [];
        history.__pairs[k2] ??= [];

        // increments
        history[teamA][sport] = (history[teamA][sport] || 0) + 1;
        history[teamB][sport] = (history[teamB][sport] || 0) + 1;

        history[teamA].__last = sport;
        history[teamB].__last = sport;

        history.__pairs[k1].push(sport);
        history.__pairs[k2].push(sport);
    }

    // =========================================================================
    // 6. MAIN ENGINE
    // =========================================================================
    Leagues.processRegularLeagues = function (context) {
        try {
            const {
                schedulableSlotBlocks,
                masterLeagues,
                disabledLeagues,
                fillBlock,
                yesterdayHistory,
                fieldUsageBySlot,
                activityProperties
            } = context;

            window.leagueAssignments ??= {};

            // A. EXTRACT LEAGUE BLOCKS
            const leagueBlocks = schedulableSlotBlocks.filter(b => {
                const e = String(b.event || "").toLowerCase();
                if (e.includes("specialty")) return false;
                return e.includes("league") || b.type === "league";
            });

            if (!leagueBlocks.length) return;

            // B. GROUP BLOCKS (Round Logic)
            const groups = {};
            leagueBlocks.forEach(block => {
                const match = Object.entries(masterLeagues).find(([ln, L]) => {
                    if (!L.enabled) return false;
                    if (disabledLeagues.includes(ln)) return false;
                    return L.divisions?.includes(block.divName);
                });
                if (!match) return;

                const [leagueName, league] = match;
                const key = `${leagueName}-${block.divName}-${block.startTime}`;

                groups[key] ??= {
                    id: key,
                    leagueName,
                    league,
                    divName: block.divName,
                    startTime: block.startTime,
                    endTime: block.endTime,
                    slots: block.slots,
                    bunks: [],
                    pendingMatchups: [] 
                };
                groups[key].bunks.push(block.bunk);
            });

            // C. GENERATE PAIRINGS & SORT CHRONOLOGICALLY
            // We need a timeline to run the Magnus engine effectively
            const timeline = Object.values(groups).sort((a, b) => a.startTime - b.startTime);
            const history = JSON.parse(JSON.stringify(yesterdayHistory || {}));

            // Generate matchups for all groups first
            timeline.forEach(group => {
                const pairs = window.getLeagueMatchups(group.leagueName, group.league.teams);
                group.pendingMatchups = pairs.map(([teamA, teamB]) => ({ teamA, teamB }));
            });

            // D. EXECUTE MAGNUS CARLSEN SOLVER
            console.log(`[MagnusEngine] Initializing for ${timeline.length} groups...`);
            const solver = new MagnusSportSolver(timeline, history, context);
            const success = solver.solve();

            if (success) {
                console.log("[MagnusEngine] Solution Found via Forward Checking.");
            } else {
                console.warn("[MagnusEngine] No perfect solution found. Fallback to Greedy.");
            }

            const solvedSchedule = solver.getResults();

            // E. APPLY RESULTS & ASSIGN FIELDS
            timeline.forEach((group, idx) => {
                const matchups = [];
                const solvedMatches = solvedSchedule[idx]; // Matches for this specific group

                solvedMatches.forEach(match => {
                    let sport = match.assignedSport;

                    // Fallback: If Magnus failed, use Greedy logic
                    if (!sport) {
                        sport = pickBestSportGreedy(match.teamA, match.teamB, group.league, history);
                    }

                    // Field Assignment (Physical Constraint)
                    const validFields = getValidFieldsForSport(sport, group.divName, context);
                    const chosenField = pickBestField(validFields, group.divName);

                    matchups.push({
                        teamA: match.teamA,
                        teamB: match.teamB,
                        sport: sport,
                        field: chosenField ? chosenField.name : null
                    });

                    // Update History (Commit the move)
                    updateHistory(match.teamA, match.teamB, sport, history);
                });

                // F. SAVE & RENDER
                const slotIndex = group.slots[0];
                const gameLabel = `Game ${window.getLeagueCurrentRound(group.leagueName) - 1}`;

                window.leagueAssignments[group.divName] ??= {};
                window.leagueAssignments[group.divName][slotIndex] = {
                    gameLabel,
                    startMin: group.startTime,
                    endMin: group.endTime,
                    matchups
                };

                // Fill Bunks
                group.bunks.forEach(bunk => {
                    fillBlock(
                        {
                            divName: group.divName,
                            bunk,
                            startTime: group.startTime,
                            endTime: group.endTime,
                            slots: group.slots
                        },
                        {
                            field: "League Block",
                            sport: null,
                            _activity: "League Block",
                            _fixed: true,
                            _allMatchups: matchups.map(
                                m => `${m.teamA} vs ${m.teamB} — ${m.sport} @ ${m.field || "TBD"}`
                            ),
                            _gameLabel: gameLabel
                        },
                        fieldUsageBySlot,
                        yesterdayHistory,
                        true,
                        activityProperties
                    );
                });
            });

        } catch (err) {
            console.error("SMART LEAGUE ENGINE ERROR:", err);
        }
    };

    Leagues.processSpecialtyLeagues = function () { };

    window.SchedulerCoreLeagues = Leagues;

})();
