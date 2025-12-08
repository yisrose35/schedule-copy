// ============================================================================
// scheduler_core_leagues.js — SMART ROTATION v3 (GCM FINAL)
// Full fix for undefined .filter and smart fairness engine
// ============================================================================

(function () {
    "use strict";

    const Leagues = {};

    // =========================================================================
    // UTILITY: SAFE FIELDS
    // =========================================================================
    function getSafeFields(ctx) {
        // loader provides "fields" but sometimes "masterFields"
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
    // 3. SPORT CHOOSER WITH FULL SMART ROTATION v3
    // =========================================================================
    function pickBestSport(teamA, teamB, league, history) {
        const sports = league.sports.slice();
        const playedA = history[teamA] || {};
        const playedB = history[teamB] || {};

        const pairHist =
            history.__pairs?.[`${teamA}-${teamB}`] ||
            history.__pairs?.[`${teamB}-${teamA}`] ||
            [];

        const lastPairSport = pairHist[pairHist.length - 1] || null;

        const lastA = playedA.__last || null;
        const lastB = playedB.__last || null;

        const scored = sports.map(s => {
            let score = 100;

            // strongest rule — avoid repeating pair's previous sport
            if (s === lastPairSport) score -= 80;

            // avoid back-to-back for either team
            if (s === lastA) score -= 30;
            if (s === lastB) score -= 30;

            // fairness: prefer low usage
            score -= ((playedA[s] || 0) + (playedB[s] || 0)) * 2;

            return { s, score };
        });

        scored.sort((a, b) => b.score - a.score);
        return scored[0].s;
    }

    // =========================================================================
    // 4. UPDATE SPORT HISTORY
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
    // 5. MAIN ENGINE
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

            const fields = getSafeFields(context);
            window.leagueAssignments ??= {};

            // extract only league blocks
            const leagueBlocks = schedulableSlotBlocks.filter(b => {
                const e = String(b.event || "").toLowerCase();
                if (e.includes("specialty")) return false;
                return e.includes("league") || b.type === "league";
            });

            if (!leagueBlocks.length) return;

            // group by league + division + slot
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

            // local round history for this run
            const history = {};

            // PROCESS EACH LEAGUE GROUP
            Object.values(groups).forEach(group => {
                const { leagueName, league, divName } = group;

                const pairs = window.getLeagueMatchups(leagueName, league.teams);
                const matchups = [];

                pairs.forEach(([teamA, teamB]) => {
                    // sport
                    const sport = pickBestSport(teamA, teamB, league, history);

                    // fields
                    const validFields = getValidFieldsForSport(sport, divName, context);
                    const chosenField = pickBestField(validFields, divName);

                    matchups.push({
                        teamA,
                        teamB,
                        sport,
                        field: chosenField ? chosenField.name : null
                    });

                    updateHistory(teamA, teamB, sport, history);
                });

                // label & save for UI
                const slotIndex = group.slots[0];
                const gameLabel = `Game ${window.getLeagueCurrentRound(leagueName) - 1}`;

                window.leagueAssignments[group.divName] ??= {};
                window.leagueAssignments[group.divName][slotIndex] = {
                    gameLabel,
                    startMin: group.startTime,
                    endMin: group.endTime,
                    matchups
                };

                // place block in schedule
                group.bunks.forEach(bunk => {
                    fillBlock(
                        {
                            divName,
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
