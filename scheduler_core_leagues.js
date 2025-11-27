/* ===========================================================================
   scheduler_core_leagues.js

   Handles ALL league scheduling:
     ✔ Regular Leagues
     ✔ Specialty Leagues
     ✔ Round-robin matchup creation
     ✔ Multi-slot scheduling
     ✔ Field assignment (capacity + time rules)
     ✔ Daily league sports balancing
     ✔ H2H schedule placement
     ✔ “No Field” / “No Game” handling

   API:
     SchedulerCore.leagues.run(regularBlocks, specialtyBlocks, ctx)

   ctx:
     {
        divisions,
        unifiedTimes,
        fieldUsage,
        activityProps,
        fieldsBySport,
        masterLeagues,
        masterSpecialtyLeagues,
        rotationHistory,
        dailyLeagueSportsUsage,
        findMatchups,        // optional override
        pairRoundRobin,      // fallback
     }

   =========================================================================== */

(function (global) {
    "use strict";

    const NS  = global.SchedulerCore = global.SchedulerCore || {};
    const U   = NS.utils;
    const F   = NS.field;

    /* =======================================================================
       ROUND ROBIN HELPERS
       ======================================================================= */

    function defaultRoundRobin(teams) {
        const arr = teams.slice();
        const n = arr.length;
        if (n % 2 === 1) arr.push("BYE");

        const half = arr.length / 2;
        const rounds = [];

        for (let r = 0; r < arr.length - 1; r++) {
            const round = [];
            for (let i = 0; i < half; i++) {
                round.push([arr[i], arr[arr.length - 1 - i]]);
            }
            rounds.push(round);
            arr.splice(1, 0, arr.pop()); // rotate
        }
        return rounds;
    }


    /* =======================================================================
       INTERNAL: PLACE ONE GAME
       ======================================================================= */

    function tryPlaceGame(pair, sport, block, ctx) {
        const { fieldsBySport, activityProps, unifiedTimes, fieldUsage } = ctx;

        const fields = fieldsBySport[sport] || [];
        if (!fields.length) return null;

        const slotCount = block.slots.length;
        const slotIdx = 0; // leagues use full block, but field usage is per-slot

        for (const fieldName of fields) {
            const props = activityProps[fieldName];
            if (!props) continue;
            if (!F.canLeagueFit(block, fieldName, props, fieldUsage, unifiedTimes))
                continue;

            // Accept field
            return fieldName;
        }

        return null; // No field available
    }


    /* =======================================================================
       INTERNAL: WRITE GAME TO SCHEDULE
       ======================================================================= */

    function writeGame(pair, sport, field, block, ctx) {
        const bunkA = pair[0];
        const bunkB = pair[1];

        const { fieldUsage } = ctx;

        // Write schedule for BOTH bunks
        const assign = (bunk) => {
            const schedule = global.scheduleAssignments[bunk];
            block.slots.forEach((slotIndex, idx) => {
                if (!schedule[slotIndex]) {
                    schedule[slotIndex] = {
                        field: field || "No Field",
                        sport: `${bunkA} vs ${bunkB} (${sport})`,
                        continuation: idx > 0,
                        _fixed: false,
                        _h2h: true,
                        _activity: sport
                    };
                }
            });
        };

        assign(bunkA);
        assign(bunkB);

        // Field usage marking (if field is real)
        if (field && field !== "No Field") {
            F.markUsage(block, field, fieldUsage, sport);
        }
    }


    /* =======================================================================
       SPECIALTY LEAGUES
       ======================================================================= */

    function runSpecialtyGroups(groups, ctx) {
        const { masterSpecialtyLeagues, rotationHistory } = ctx;

        Object.values(groups).forEach(group => {
            const div = group.divName;

            // Find an enabled specialty league for this division
            const entry = Object.values(masterSpecialtyLeagues).find(
                l => l.enabled && l.divisions.includes(div)
            );
            if (!entry) return;

            const teams = entry.teams || [];
            const sport = entry.sport;

            // Build matchups
            let rounds = [];
            if (typeof global.getLeagueMatchups === "function") {
                rounds = global.getLeagueMatchups(entry.name, teams) || [];
            } else {
                rounds = defaultRoundRobin(teams);
            }

            const firstRound = rounds[0] || [];
            const matchups = firstRound.filter(p => p[0] !== "BYE" && p[1] !== "BYE");

            // For each matchup, attempt field placement
            matchups.forEach(pair => {
                const block = group;
                const field = tryPlaceGame(pair, sport, block, ctx);
                writeGame(pair, sport, field || "No Field", block, ctx);
            });

            // Bunks in this block not assigned get "No Game"
            const allBunks = Array.from(group.bunks);
            const assignedBunks = new Set();
            matchups.forEach(pair => pair.forEach(b => assignedBunks.add(b)));

            const leftover = allBunks.filter(b => !assignedBunks.has(b));
            leftover.forEach(bunk => {
                const schedule = global.scheduleAssignments[bunk];
                block.slots.forEach((slotIndex, idx) => {
                    if (!schedule[slotIndex]) {
                        schedule[slotIndex] = {
                            field: "No Game",
                            sport: null,
                            continuation: idx > 0,
                            _fixed: false,
                            _h2h: true,
                            _activity: "Specialty League"
                        };
                    }
                });
            });
        });
    }


    /* =======================================================================
       REGULAR LEAGUES
       ======================================================================= */

    function runRegularGroups(groups, ctx) {
        const {
            masterLeagues,
            fieldsBySport,
            activityProps,
            fieldUsage,
            unifiedTimes,
            dailyLeagueSportsUsage,
            rotationHistory,
            pairRoundRobin
        } = ctx;

        Object.values(groups).forEach(group => {
            const leagueName = group.leagueName;
            const league = masterLeagues[leagueName];
            if (!league) return;

            const teams = league.teams || [];
            if (teams.length < 2) return;

            const sports = league.sports || [];
            if (!sports.length) return;

            const baseDiv = group.divName;

            // Determine today's sports rotation
            const usedToday = dailyLeagueSportsUsage[leagueName] || new Set();
            let sportPool = sports.filter(s => !usedToday.has(s));
            if (!sportPool.length) sportPool = sports.slice();

            // Find matchups
            let matchups = [];
            if (typeof global.getLeagueMatchups === "function") {
                matchups = global.getLeagueMatchups(leagueName, teams);
            } else {
                matchups = pairRoundRobin
                    ? pairRoundRobin(teams)[0] || []
                    : defaultRoundRobin(teams)[0] || [];
            }

            const realPairs = matchups.filter(p => p[0] !== "BYE" && p[1] !== "BYE");

            // Assign games
            realPairs.forEach(pair => {
                // Pick best sport for fairness
                const chosenSport =
                    sportPool[Math.floor(Math.random() * sportPool.length)];

                const field = tryPlaceGame(pair, chosenSport, group, ctx);
                writeGame(pair, chosenSport, field || "No Field", group, ctx);

                // Track sport usage
                if (!dailyLeagueSportsUsage[leagueName])
                    dailyLeagueSportsUsage[leagueName] = new Set();
                dailyLeagueSportsUsage[leagueName].add(chosenSport);

                // Save rotation history
                const hist = rotationHistory.leagues[leagueName] || {};
                hist[chosenSport] = Date.now();
                rotationHistory.leagues[leagueName] = hist;
            });

            // Unassigned → No Game
            const allBunks = Array.from(group.bunks);
            const assigned = new Set();
            realPairs.forEach(p => assigned.add(p[0]) && assigned.add(p[1]));

            const leftover = allBunks.filter(b => !assigned.has(b));
            leftover.forEach(bunk => {
                const schedule = global.scheduleAssignments[bunk];
                group.slots.forEach((slotIndex, idx) => {
                    if (!schedule[slotIndex]) {
                        schedule[slotIndex] = {
                            field: "No Game",
                            sport: null,
                            continuation: idx > 0,
                            _fixed: false,
                            _h2h: true,
                            _activity: "League"
                        };
                    }
                });
            });
        });
    }


    /* =======================================================================
       PUBLIC ENTRY
       ======================================================================= */

    function run(regularBlocks, specialtyBlocks, ctx) {
        // Group specialty blocks
        const specGroups = {};
        specialtyBlocks.forEach(block => {
            const key = `${block.divName}-${block.startTime}`;
            if (!specGroups[key]) {
                specGroups[key] = {
                    ...block,
                    bunks: new Set()
                };
            }
            specGroups[key].bunks.add(block.bunk);
        });

        // Group regular league blocks
        const regGroups = {};
        regularBlocks.forEach(block => {
            const key = `${block.leagueName}-${block.startTime}`;
            if (!regGroups[key]) {
                regGroups[key] = {
                    ...block,
                    bunks: new Set()
                };
            }
            regGroups[key].bunks.add(block.bunk);
        });

        // Process groups
        runSpecialtyGroups(specGroups, ctx);
        runRegularGroups(regGroups, ctx);
    }

    /* =======================================================================
       EXPORT
       ======================================================================= */

    NS.leagues = {
        run
    };

})(typeof window !== "undefined" ? window : global);
