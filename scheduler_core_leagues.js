// ============================================================================
// scheduler_core_leagues.js — UNIFIED LEAGUE ENGINE (FIXED)
// Combines round-robin logic + field availability + capacity management
// ============================================================================

(function () {
    'use strict';

    const Leagues = {};
    const INCREMENT_MINS = 30;

    // =========================================================================
    // PERSISTENT ROUND STATE (Cross-Day Game Counter)
    // =========================================================================
    let leagueRoundState = {};
    window.leagueRoundState = leagueRoundState;

    function loadRoundState() {
        try {
            const global = window.loadGlobalSettings?.() || {};
            leagueRoundState = global.leagueRoundState || {};
            window.leagueRoundState = leagueRoundState;
        } catch (e) {
            console.error("Failed to load league state:", e);
            leagueRoundState = {};
            window.leagueRoundState = leagueRoundState;
        }
    }

    function saveRoundState() {
        try {
            window.saveGlobalSettings?.("leagueRoundState", leagueRoundState);
        } catch (e) {
            console.error("Failed to save league state:", e);
        }
    }

    // =========================================================================
    // ROUND-ROBIN GENERATOR
    // =========================================================================
    function generateRoundRobin(teamList) {
        if (!teamList || teamList.length < 2) return [];

        const teams = [...teamList];

        // NO BYES - System should never create odd-numbered leagues
        if (teams.length % 2 !== 0) {
            console.error("⚠️ League has odd number of teams - this should not happen!");
            return [];
        }

        const schedule = [];
        const numRounds = teams.length - 1;

        const fixed = teams[0];
        const rotating = teams.slice(1);

        for (let r = 0; r < numRounds; r++) {
            const round = [];

            round.push([fixed, rotating[0]]);

            for (let i = 1; i < teams.length / 2; i++) {
                const t1 = rotating[i];
                const t2 = rotating[rotating.length - i];
                round.push([t1, t2]);
            }

            schedule.push(round);

            // Rotate teams
            rotating.unshift(rotating.pop());
        }

        return schedule;
    }

    // =========================================================================
    // MATCHUP HISTORY TRACKING
    // =========================================================================
    function getMatchupHistory(teamA, teamB, leagueName, rotationHistory) {
        const hist = rotationHistory?.leagues || {};
        const key = [teamA, teamB].sort().join("|");
        const leagueKey = `${leagueName}|${key}`;
        const played = hist[leagueKey] || [];
        
        const sportCounts = {};
        for (const g of played) {
            sportCounts[g.sport] = (sportCounts[g.sport] || 0) + 1;
        }
        
        return { 
            playCount: played.length, 
            sportCounts,
            lastPlayed: played.length > 0 ? played[played.length - 1] : null
        };
    }

    function saveMatchupToHistory(teamA, teamB, leagueName, sport, date, rotationHistory) {
        if (!rotationHistory.leagues) rotationHistory.leagues = {};
        
        const key = [teamA, teamB].sort().join("|");
        const leagueKey = `${leagueName}|${key}`;
        
        if (!rotationHistory.leagues[leagueKey]) {
            rotationHistory.leagues[leagueKey] = [];
        }
        
        rotationHistory.leagues[leagueKey].push({
            sport,
            date,
            timestamp: Date.now()
        });
    }

    // =========================================================================
    // FIELD AVAILABILITY MATRIX
    // =========================================================================
    function buildMasterFieldMatrix(contextFields, activityProperties) {
        const matrix = {};

        let fieldList = [];

        if (Array.isArray(contextFields)) {
            fieldList = contextFields.map(f => f.name);
        } else if (typeof contextFields === "object" && contextFields !== null) {
            fieldList = Object.values(contextFields).map(f =>
                (typeof f === "string") ? f : f.name
            );
        }

        if (!fieldList.length) {
            const set = new Set();
            Object.values(activityProperties).forEach(props => {
                (props.fields || []).forEach(f => set.add(f));
            });
            fieldList = Array.from(set);
        }

        fieldList.forEach(fieldName => {
            matrix[fieldName] = [];

            for (const [activityName, props] of Object.entries(activityProperties)) {
                const allowedFields = props.fields || [];
                if (allowedFields.includes(fieldName)) {
                    matrix[fieldName].push(activityName);
                }
            }
        });

        return matrix;
    }

    function applyDailyOverrides(masterMatrix, dailyOverrides) {
        const { disabledFields, disabledSpecials, dailyDisabledSportsByField } = dailyOverrides || {};
        const m = JSON.parse(JSON.stringify(masterMatrix));

        Object.keys(m).forEach(fieldName => {
            // Fully disabled field
            if (disabledFields?.includes(fieldName)) {
                delete m[fieldName];
                return;
            }

            // Remove specific sports disabled for this field
            const disabledSports = dailyDisabledSportsByField?.[fieldName] || [];
            m[fieldName] = m[fieldName].filter(sport => {
                if (disabledSpecials?.includes(sport)) return false;
                if (disabledSports.includes(sport)) return false;
                return true;
            });

            if (m[fieldName].length === 0) delete m[fieldName];
        });

        return m;
    }

    // =========================================================================
    // FIELD SUPPLY CALCULATOR (with Time Rules & Capacity)
    // =========================================================================
    function calculateFieldSupply(leagueSports, todayMatrix, startMin, endMin, activityProperties) {
        const supply = {};

        leagueSports.forEach(sport => {
            supply[sport] = [];

            Object.entries(todayMatrix).forEach(([fieldName, sports]) => {
                if (!sports.includes(sport)) return;

                const props = activityProperties[fieldName];
                if (!props) return;

                // ✅ Check time rules
                if (!isFieldAvailableAtTime(fieldName, startMin, endMin, props)) return;

                // ✅ Check existing capacity
                const capacity = getFieldCapacityAtTime(fieldName, startMin, endMin, props);
                if (capacity.available <= 0) return;

                supply[sport].push(fieldName);
            });
        });

        return supply;
    }

    function isFieldAvailableAtTime(fieldName, startMin, endMin, props) {
        if (!props.available) return false;

        const rules = props.timeRules || [];
        if (rules.length === 0) return true;

        // Check if any "Available" rule covers this time
        const hasAvailableRule = rules.some(rule => {
            if (rule.type !== "Available") return false;
            const ruleStart = parseTimeToMinutes(rule.start);
            const ruleEnd = parseTimeToMinutes(rule.end);
            return startMin >= ruleStart && endMin <= ruleEnd;
        });

        if (!hasAvailableRule) return false;

        // Check if any "Unavailable" rule blocks this time
        const hasUnavailableRule = rules.some(rule => {
            if (rule.type !== "Unavailable") return false;
            const ruleStart = parseTimeToMinutes(rule.start);
            const ruleEnd = parseTimeToMinutes(rule.end);
            return startMin < ruleEnd && endMin > ruleStart;
        });

        return !hasUnavailableRule;
    }

    function getFieldCapacityAtTime(fieldName, startMin, endMin, props) {
        const reservations = (window.fieldReservationLog || []).filter(r => {
            if (r.field !== fieldName) return false;
            return r.startMin < endMin && r.endMin > startMin;
        });

        const maxCapacity = props?.sharableWith?.capacity || 1;

        return {
            used: reservations.length,
            available: maxCapacity - reservations.length,
            maxCapacity,
            reservations
        };
    }

    // =========================================================================
    // FIELD RESERVATION SYSTEM
    // =========================================================================
    function reserveFieldOnTimeline(fieldName, startMin, endMin, metadata = {}) {
        if (!window.fieldReservationLog) window.fieldReservationLog = [];

        window.fieldReservationLog.push({
            field: fieldName,
            startMin,
            endMin,
            timestamp: Date.now(),
            ...metadata
        });
    }

    // =========================================================================
    // SMART SPORT & FIELD PICKER
    // =========================================================================
    function findBestSportAndField(
        teamA, 
        teamB, 
        leagueName,
        leagueSports, 
        fieldSupply, 
        yesterdayHistory,
        rotationHistory,
        activityProperties
    ) {
        const candidates = [];
        const matchupHistory = getMatchupHistory(teamA, teamB, leagueName, rotationHistory);

        leagueSports.forEach(sport => {
            const fields = fieldSupply[sport] || [];
            if (fields.length === 0) return;

            // Check if teams played this sport yesterday
            const yesterdayA = yesterdayHistory?.[teamA]?.sport;
            const yesterdayB = yesterdayHistory?.[teamB]?.sport;
            const playedYesterday = (yesterdayA === sport || yesterdayB === sport);

            // Check if this matchup already played this sport
            const timesPlayedThisSport = matchupHistory.sportCounts[sport] || 0;

            // Scoring logic:
            let score = 1000; // Base score

            // 🔴 HARD PENALTY: Playing same sport back-to-back
            if (playedYesterday) score -= 800;

            // 🟡 SOFT PENALTY: Already played this sport together
            score -= timesPlayedThisSport * 200;

            // 🟢 BONUS: Prefer sports they haven't played together
            if (timesPlayedThisSport === 0) score += 300;

            // Evaluate each field for this sport
            fields.forEach(field => {
                const props = activityProperties[field];
                let fieldScore = score;

                // ✅ Field preference bonus
                if (props?.preferences?.enabled) {
                    const preferenceList = props.preferences.list || [];
                    const teamADiv = findDivisionForBunk(teamA);
                    const teamBDiv = findDivisionForBunk(teamB);

                    const idxA = preferenceList.indexOf(teamADiv);
                    const idxB = preferenceList.indexOf(teamBDiv);

                    if (idxA !== -1) fieldScore += (100 - idxA * 10);
                    if (idxB !== -1) fieldScore += (100 - idxB * 10);
                }

                candidates.push({
                    sport,
                    field,
                    score: fieldScore,
                    playedYesterday,
                    timesPlayedThisSport
                });
            });
        });

        if (candidates.length === 0) {
            return { sport: null, field: null, score: -Infinity };
        }

        // Sort by score (higher = better)
        candidates.sort((a, b) => b.score - a.score);

        return candidates[0];
    }

    // =========================================================================
    // REMATCH HANDLER
    // =========================================================================
    function handleRematch(
        teamA,
        teamB,
        leagueName,
        leagueSports,
        fieldSupply,
        rotationHistory,
        activityProperties
    ) {
        const matchupHistory = getMatchupHistory(teamA, teamB, leagueName, rotationHistory);
        
        if (matchupHistory.playCount === 0) {
            // Not a rematch - proceed normally
            return null;
        }

        // This IS a rematch - find a DIFFERENT sport than last time
        const lastSport = matchupHistory.lastPlayed?.sport;

        const candidates = [];

        leagueSports.forEach(sport => {
            if (sport === lastSport) return; // Must be different

            const fields = fieldSupply[sport] || [];
            if (fields.length === 0) return;

            const timesPlayed = matchupHistory.sportCounts[sport] || 0;

            fields.forEach(field => {
                candidates.push({
                    sport,
                    field,
                    score: 1000 - (timesPlayed * 100),
                    isRematchDifferentSport: true
                });
            });
        });

        if (candidates.length === 0) {
            console.warn(`⚠️ Rematch: ${teamA} vs ${teamB} but no alternative sports available`);
            return null;
        }

        candidates.sort((a, b) => b.score - a.score);
        return candidates[0];
    }

    // =========================================================================
    // DIVISION MATCHER
    // =========================================================================
    function isDivisionMatch(timelineDiv, leagueDiv) {
        if (!timelineDiv || !leagueDiv) return false;
        const t = String(timelineDiv).trim().toLowerCase();
        const l = String(leagueDiv).trim().toLowerCase();

        if (t === l) return true;
        if (l.includes(t) || t.includes(l)) return true;

        const cleanT = t.replace(/(st|nd|rd|th|grade|s)/g, "").trim();
        const cleanL = l.replace(/(st|nd|rd|th|grade|s)/g, "").trim();
        return cleanT === cleanL && cleanT.length > 0;
    }

    function findDivisionForBunk(bunkName) {
        const divisions = window.divisions || {};
        for (const [divName, div] of Object.entries(divisions)) {
            if (div.bunks && div.bunks.includes(bunkName)) {
                return divName;
            }
        }
        return null;
    }

    // =========================================================================
    // TIME PARSER
    // =========================================================================
    function parseTimeToMinutes(str) {
        if (!str || typeof str !== "string") return null;
        let s = str.trim().toLowerCase();
        let mer = null;

        if (s.endsWith("am") || s.endsWith("pm")) {
            mer = s.endsWith("am") ? "am" : "pm";
            s = s.replace(/am|pm/g, "").trim();
        }

        const m = s.match(/^(\d{1,2})\s*:\s*(\d{2})$/);
        if (!m) return null;

        let hh = parseInt(m[1], 10);
        const mm = parseInt(m[2], 10);

        if (mer) {
            if (hh === 12) hh = mer === "am" ? 0 : 12;
            else if (mer === "pm") hh += 12;
        }

        return hh * 60 + mm;
    }

    // =========================================================================
    // MAIN: PROCESS REGULAR LEAGUES (UNIFIED)
    // =========================================================================
    Leagues.processRegularLeagues = function (context) {
        try {
            const {
                schedulableSlotBlocks,
                masterLeagues,
                disabledLeagues,
                fields,
                activityProperties,
                yesterdayHistory,
                rotationHistory,
                fillBlock,
                fieldUsageBySlot
            } = context;

            console.log("=== UNIFIED LEAGUE ENGINE START ===");

            // 1. Load persistent round state
            loadRoundState();

            // 2. Initialize field reservation log (ALWAYS RESET - CRITICAL FIX)
            window.fieldReservationLog = [];

            // 3. Build field availability matrix
            const dailyOverrides = window.dailyOverridesForLoader || {
                disabledFields: [],
                disabledSpecials: [],
                dailyDisabledSportsByField: {}
            };

            const masterMatrix = buildMasterFieldMatrix(fields || {}, activityProperties);
            const todayMatrix = applyDailyOverrides(masterMatrix, dailyOverrides);

            // 4. Filter and group league blocks
            const leagueBlocks = schedulableSlotBlocks.filter(b => {
                const name = String(b.event || "").toLowerCase();
                return (name.includes("league") && !name.includes("specialty")) ||
                       b.type === "league";
            });

            const groups = {};

            leagueBlocks.forEach(block => {
                const leagueEntry = Object.entries(masterLeagues).find(([name, lg]) => {
                    if (!lg.enabled || disabledLeagues.includes(name)) return false;
                    return lg.divisions?.some(d => isDivisionMatch(block.divName, d));
                });

                if (!leagueEntry) return;

                const [leagueName, league] = leagueEntry;
                const key = `${leagueName}-${block.divName}-${block.startTime}`;

                groups[key] ??= {
                    leagueName,
                    league,
                    divName: block.divName,
                    startTime: block.startTime,
                    endTime: block.endTime,
                    slots: block.slots,
                    bunks: []
                };

                groups[key].bunks.push(block.bunk);
            });

            // 5. Process each league group
            Object.values(groups).forEach(group => {
                const { leagueName, league, divName, startTime, endTime, slots, bunks } = group;

                // 5a. Get round-robin matchups
                const state = leagueRoundState[leagueName] || { currentRound: 0 };
                const fullSchedule = generateRoundRobin(league.teams);
                
                if (fullSchedule.length === 0) {
                    console.warn(`⚠️ League "${leagueName}": Cannot generate round-robin (odd teams?)`);
                    return;
                }

                const roundIndex = state.currentRound % fullSchedule.length;
                const pairings = fullSchedule[roundIndex];

                // 5b. Calculate field supply
                const leagueSports = league.sports?.length ? league.sports : ["General Sport"];
                const fieldSupply = calculateFieldSupply(
                    leagueSports,
                    todayMatrix,
                    startTime,
                    endTime,
                    activityProperties
                );

                // 5c. Validate sufficient fields
                const totalGames = pairings.length;
                const totalAvailableFields = Object.values(fieldSupply).flat().length;

                if (totalAvailableFields < totalGames) {
                    console.error(`🚨 League "${leagueName}": Need ${totalGames} fields, only ${totalAvailableFields} available!`);
                    // This should NEVER happen if leagues are scheduled first
                }

                // 5d. Assign sport + field to each pairing
                const assignments = [];
                const usedFields = new Set();

                pairings.forEach(([teamA, teamB]) => {
                    // Check if this is a rematch
                    const rematchChoice = handleRematch(
                        teamA,
                        teamB,
                        leagueName,
                        leagueSports,
                        fieldSupply,
                        rotationHistory,
                        activityProperties
                    );

                    let best;
                    if (rematchChoice) {
                        best = rematchChoice;
                        console.log(`🔄 Rematch: ${teamA} vs ${teamB} → ${best.sport} (different from last time)`);
                    } else {
                        best = findBestSportAndField(
                            teamA,
                            teamB,
                            leagueName,
                            leagueSports,
                            fieldSupply,
                            yesterdayHistory,
                            rotationHistory,
                            activityProperties
                        );
                    }

                    if (!best || !best.field) {
                        console.error(`❌ Could not assign field for ${teamA} vs ${teamB}`);
                        return;
                    }

                    assignments.push({
                        teamA,
                        teamB,
                        sport: best.sport,
                        field: best.field
                    });

                    // Remove used field from supply (each field used once per time slot)
                    if (fieldSupply[best.sport]) {
                        fieldSupply[best.sport] = fieldSupply[best.sport].filter(f => f !== best.field);
                    }

                    // Reserve on timeline
                    reserveFieldOnTimeline(best.field, startTime, endTime, {
                        isLeague: true,
                        exclusive: true,
                        matchup: `${teamA} vs ${teamB}`,
                        sport: best.sport,
                        leagueName
                    });

                    // Save to history
                    const today = window.currentScheduleDate || new Date().toISOString().split('T')[0];
                    saveMatchupToHistory(teamA, teamB, leagueName, best.sport, today, rotationHistory);
                });

                // 5e. Increment round counter
                leagueRoundState[leagueName] = { currentRound: state.currentRound + 1 };

                // 5f. Format for display
                const gameLabel = `Game ${state.currentRound + 1}`;
                const formatted = assignments.map(m =>
                    `${m.teamA} vs ${m.teamB} — ${m.sport} @ ${m.field}`
                );

                const slotIndex = slots[0];

                // 5g. Save to master storage
                window.leagueAssignments = window.leagueAssignments || {};
                window.leagueAssignments[divName] = window.leagueAssignments[divName] || {};
                window.leagueAssignments[divName][slotIndex] = {
                    gameLabel,
                    roundNumber: state.currentRound + 1,
                    startMin: startTime,
                    endMin: endTime,
                    matchups: assignments,
                    _formatted: formatted
                };

                // 5h. Fill individual bunk schedules
                bunks.forEach(bunk => {
                    const myMatch = assignments.find(m =>
                        m.teamA === bunk || m.teamB === bunk
                    );

                    if (!myMatch) return;

                    const opponent = (myMatch.teamA === bunk) ? myMatch.teamB : myMatch.teamA;

                    fillBlock(
                        { divName, bunk, startTime, endTime, slots },
                        {
                            field: myMatch.field,  // ✅ ACTUAL FIELD NAME
                            sport: myMatch.sport,
                            _activity: `League: vs ${opponent}`,
                            _fixed: true,
                            _isLeague: true,
                            _h2h: true,
                            _gameLabel: gameLabel,
                            _allMatchups: formatted
                        },
                        fieldUsageBySlot,
                        yesterdayHistory,
                        true,
                        activityProperties
                    );
                });
            });

            // 6. Save updated round state
            saveRoundState();

            // 7. Save updated rotation history
            window.saveRotationHistory?.(rotationHistory);

            console.log("=== UNIFIED LEAGUE ENGINE COMPLETE ===");

        } catch (err) {
            console.error("CRITICAL ERROR IN UNIFIED LEAGUE ENGINE:", err);
        }
    };

    // Placeholder for specialty leagues
    Leagues.processSpecialtyLeagues = function () {};

    window.SchedulerCoreLeagues = Leagues;

})();
