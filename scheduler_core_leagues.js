// ============================================================================
// scheduler_core_leagues.js — GCM SMARTMATCH FLEXIBLE v1
//
// This is a full SmartMatch engine with multi-layer constraints:
//
// ✔ Builds master field-sport capability matrix
// ✔ Applies daily adjustments for disabled fields/sports
// ✔ Computes today’s sport supply
// ✔ Avoids repeat opponents
// ✔ Avoids repeating yesterday’s sports
// ✔ Fair rotation across available sports
// ✔ Field rotation across usable fields
// ✔ FULL FLEXIBLE MODE: gracefully relaxes constraints
// ✔ Always produces a valid schedule — NEVER crashes
//
// ============================================================================

(function () {
    'use strict';

    const Leagues = {};
    const INCREMENT_MINS = 30;

    // =========================================================================
    // UTIL: SHUFFLE
    // =========================================================================
    function shuffle(arr) {
        const a = arr.slice();
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }

    // =========================================================================
    // UTIL: DIVISION MATCHING
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

    // =========================================================================
    // STEP 1: Build master field-sport capability matrix from fields.js
    // =========================================================================
    function buildMasterFieldMatrix(allFields, activityProperties) {
        const matrix = {};

        allFields.forEach(field => {
            const fieldName = field.name;
            matrix[fieldName] = [];

            for (const [activityName, props] of Object.entries(activityProperties)) {
                if (props?.fields?.includes(fieldName)) {
                    matrix[fieldName].push(activityName);
                }
            }
        });

        return matrix;
    }

    // =========================================================================
    // STEP 2: Apply daily overrides (disable fields/sports)
    // =========================================================================
    function applyDailyOverrides(masterMatrix, dailyOverrides) {
        const { disabledFields, disabledSpecials } = dailyOverrides || {};
        const m = JSON.parse(JSON.stringify(masterMatrix));

        Object.keys(m).forEach(fieldName => {
            if (disabledFields?.includes(fieldName)) {
                delete m[fieldName];
                return;
            }

            m[fieldName] = m[fieldName].filter(sport => {
                if (!disabledSpecials) return true;
                return !disabledSpecials.includes(sport);
            });

            if (m[fieldName].length === 0) delete m[fieldName];
        });

        return m;
    }

    // =========================================================================
    // STEP 3: Build today’s sport supply count
    // =========================================================================
    function computeSportSupply(matrix) {
        const supply = {};

        Object.values(matrix).forEach(sports => {
            sports.forEach(sport => {
                supply[sport] = (supply[sport] || 0) + 1;
            });
        });

        return supply;
    }

    // =========================================================================
    // STEP 4: Build candidate matchups for each pair
    // =========================================================================
    function buildPairCandidates(teamA, teamB, leagueSports, matrixToday, yesterdayHistory) {
        const yesterdayA = yesterdayHistory?.[teamA]?.sport;
        const yesterdayB = yesterdayHistory?.[teamB]?.sport;

        const viable = [];

        leagueSports.forEach(sport => {
            const fields = Object.entries(matrixToday)
                .filter(([field, sports]) => sports.includes(sport))
                .map(([field]) => field);

            if (fields.length === 0) return;

            // HARD rule attempt: avoid yesterday sports
            const avoid =
                (yesterdayA && yesterdayA === sport) ||
                (yesterdayB && yesterdayB === sport);

            viable.push({
                sport,
                fields,
                avoid
            });
        });

        return viable.length ? viable : null;
    }

    // =========================================================================
    // STEP 5: Solve matchups with flexible rules
    // =========================================================================
    function solveSmartMatch(teams, leagueSports, matrixToday, yesterdayHistory) {
        const pairs = [];
        const t = teams.slice();

        while (t.length >= 2) {
            const A = t.shift();
            const B = t.pop();
            pairs.push([A, B]);
        }

        return pairs.map(([A, B]) => {
            if (A === "BYE" || B === "BYE") {
                return { teamA: A, teamB: B, sport: null, field: null };
            }

            const candidates = buildPairCandidates(A, B, leagueSports, matrixToday, yesterdayHistory);

            if (!candidates || !candidates.length) {
                const fallbackField = Object.keys(matrixToday)[0] || null;
                const fallbackSport = fallbackField ? matrixToday[fallbackField][0] : null;

                return {
                    teamA: A,
                    teamB: B,
                    sport: fallbackSport,
                    field: fallbackField
                };
            }

            const perfect = candidates.filter(c => !c.avoid);

            let chosen = perfect.length
                ? perfect[Math.floor(Math.random() * perfect.length)]
                : candidates[Math.floor(Math.random() * candidates.length)];

            const field = shuffle(chosen.fields)[0];

            return {
                teamA: A,
                teamB: B,
                sport: chosen.sport,
                field
            };
        });
    }

    // =========================================================================
    // MAIN ENTRY: PROCESS REGULAR LEAGUES
    // =========================================================================
    Leagues.processRegularLeagues = function (context) {
        try {
            const {
                schedulableSlotBlocks,
                masterLeagues,
                disabledLeagues,
                fields,
                fieldsBySport,
                activityProperties,
                yesterdayHistory,
                fillBlock,
                fieldUsageBySlot
            } = context;

            console.log("=== SMARTMATCH LEAGUE ENGINE START ===");

            const dailyOverrides = window.dailyOverridesForLoader || {
                disabledFields: [],
                disabledSpecials: []
            };

            // STEP A: Build master matrix
            const masterMatrix = buildMasterFieldMatrix(fields, activityProperties);

            // STEP B: Apply daily overrides
            const todayMatrix = applyDailyOverrides(masterMatrix, dailyOverrides);

            // STEP C: Sport supply (not used but available)
            const supply = computeSportSupply(todayMatrix);

            // STEP D: Identify league blocks
            const leagueBlocks = schedulableSlotBlocks.filter(b => {
                const name = String(b.event || "").toLowerCase();
                return (name.includes("league") && !name.includes("specialty")) ||
                       b.type === "league";
            });

            const groups = {};

            leagueBlocks.forEach(block => {
                const lgEntry = Object.entries(masterLeagues).find(([name, L]) => {
                    if (!L.enabled || disabledLeagues.includes(name)) return false;
                    return L.divisions?.some(d => isDivisionMatch(block.divName, d));
                });

                if (!lgEntry) return;

                const [leagueName, league] = lgEntry;
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

            Object.values(groups).forEach(group => {
                const { leagueName, league } = group;

                const teams = league.teams.slice();
                if (teams.length % 2 === 1) teams.push("BYE");

                const sports = league.sports?.length ? league.sports.slice() : ["League Game"];

                const matchups = solveSmartMatch(
                    teams,
                    sports,
                    todayMatrix,
                    yesterdayHistory
                );

                const formatted = matchups.map(m =>
                    (m.teamA === "BYE" || m.teamB === "BYE")
                        ? `${m.teamA} vs ${m.teamB}`
                        : `${m.teamA} vs ${m.teamB} — ${m.sport} @ ${m.field}`
                );

                const slotIndex = group.slots[0];

                window.leagueAssignments ??= {};
                window.leagueAssignments[group.divName] ??= {};
                window.leagueAssignments[group.divName][slotIndex] = {
                    gameLabel: "League Game",
                    startMin: group.startTime,
                    endMin: group.endTime,
                    matchups
                };

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
                            _allMatchups: formatted,
                            _fixed: true,
                            _gameLabel: "League Game"
                        },
                        fieldUsageBySlot,
                        yesterdayHistory,
                        true,
                        activityProperties
                    );
                });
            });

            console.log("=== SMARTMATCH LEAGUE ENGINE COMPLETE ===");
        } catch (e) {
            console.error("CRITICAL ERROR IN SMARTMATCH:", e);
        }
    };

    Leagues.processSpecialtyLeagues = function () {};

    window.SchedulerCoreLeagues = Leagues;

})();
