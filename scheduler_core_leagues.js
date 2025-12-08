// ============================================================================
// scheduler_core_leagues.js (GCM FINAL — TRUE ROTATION + FIELD LOCKS)
// FIXED FOR:
//
// ✔ Real Sport Rotation
// ✔ Real Field Rotation
// ✔ NO MORE "same field every game"
// ✔ NO MORE "same sport every round"
// ✔ Locked fields per slot enforced
// ✔ BYE-safe
// ✔ Compatible with loader v3, utils vFinal, master builder
// ✔ Uses correct 6-arg canBlockFit signature
//
// Integrated with league_scheduling.js:
// - Uses window.getLeagueMatchups(...) for round progression
// - Uses getLeagueCurrentRound(...) for Game X label
// - Groups by (leagueName + division + startTime)
// - Populates window.leagueAssignments for scheduler_ui.js
// ============================================================================

(function () {
    'use strict';

    const Leagues = {};
    const INCREMENT_MINS = 30;

    // =========================================================================
    // GLOBAL LEAGUE VETO LOGGER
    // =========================================================================
    function writeLeagueReservationVeto(field, block) {
        window.fieldReservationLog ??= {};
        window.fieldReservationLog[field] ??= [];

        const exists = window.fieldReservationLog[field].some(
            r => r.bunk === "__LEAGUE_VETO__" && r.startMin === block.startTime
        );

        if (!exists) {
            window.fieldReservationLog[field].push({
                bunk: "__LEAGUE_VETO__",
                divName: block.divName,
                startMin: block.startTime,
                endMin: block.endTime,
                exclusive: true,
                reason: "League Field Lock"
            });
        }
    }

    // =========================================================================
    // DIVISION MATCH LOGIC (kept verbatim — works perfectly)
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
    // SAFE SHUFFLE (ensures fairness but still deterministic enough)
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
    // MAIN ENGINE
    // =========================================================================
    Leagues.processRegularLeagues = function (context) {
        try {
            const {
                schedulableSlotBlocks,
                masterLeagues,
                disabledLeagues,
                fieldsBySport,
                activityProperties,
                yesterdayHistory,
                fillBlock,
                fieldUsageBySlot
            } = context;

            console.log("=== LEAGUE GENERATOR START ===");

            // --------------------------------------------------------------
            // Filter "League" blocks
            // --------------------------------------------------------------
            const leagueBlocks = schedulableSlotBlocks.filter(b => {
                const name = String(b.event || "").toLowerCase();
                return (name.includes("league") && !name.includes("specialty")) ||
                       b.type === 'league';
            });

            if (!leagueBlocks.length) {
                console.warn("No league blocks found.");
                return;
            }

            // --------------------------------------------------------------
            // Group by (leagueName + divName + startTime)
            // --------------------------------------------------------------
            const groups = {};

            leagueBlocks.forEach(block => {
                const lgEntry = Object.entries(masterLeagues).find(([name, L]) => {
                    if (!L.enabled || disabledLeagues.includes(name)) return false;
                    return L.divisions && L.divisions.some(d => isDivisionMatch(block.divName, d));
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

            // =========================================================================
            // PROCESS EACH GROUP (1 league round per division/time)
            // =========================================================================
            Object.values(groups).forEach(group => {
                const { leagueName, league } = group;

                const teams = (league.teams || []).slice();
                if (teams.length < 2) return;

                // ----------------------------------------------------------
                // Get Matchups (Round-Robin or custom)
                // ----------------------------------------------------------
                let pairs = [];

                if (typeof window.getLeagueMatchups === "function") {
                    pairs = window.getLeagueMatchups(leagueName, teams);
                } else {
                    // Fallback round robin
                    pairs = [];
                    const copy = teams.slice();
                    if (copy.length % 2 !== 0) copy.push("BYE");
                    const half = copy.length / 2;
                    for (let i = 0; i < half; i++) {
                        pairs.push([copy[i], copy[copy.length - 1 - i]]);
                    }
                }

                if (!pairs || !pairs.length) return;

                // ----------------------------------------------------------
                // Get "Game X" label AFTER matchups
                // ----------------------------------------------------------
                const gameNumber = (typeof window.getLeagueCurrentRound === "function")
                    ? `Game ${window.getLeagueCurrentRound(leagueName)}`
                    : "Game ?";

                // ----------------------------------------------------------
                // SPORT ROTATION
                // ----------------------------------------------------------
                const sports = league.sports?.length ? league.sports.slice() : ["League Game"];

                // Shuffle sports per round
                const rotatedSports = shuffle(sports);

                // ----------------------------------------------------------
                // FIELD ROTATION
                // ----------------------------------------------------------
                const lockedFields = new Set();

                const matchups = [];

                pairs.forEach((pair, idx) => {
                    let A = pair[0] || "BYE";
                    let B = pair[1] || "BYE";

                    if (A === "BYE" || B === "BYE") {
                        matchups.push({
                            teamA: A,
                            teamB: B,
                            sport: rotatedSports[0],
                            field: null
                        });
                        return;
                    }

                    const baseSport = rotatedSports[idx % rotatedSports.length];

                    // Try sports in a rotated order
                    const sportCandidates = shuffle([
                        baseSport,
                        ...rotatedSports.filter(s => s !== baseSport)
                    ]);

                    let chosenField = null;
                    let chosenSport = null;

                    // ------------------------------------------------------
                    // FIELD PICKING (now correct, no || true)
                    // ------------------------------------------------------
                    outerSportLoop:
                    for (const sport of sportCandidates) {
                        const possibleFields = shuffle(fieldsBySport?.[sport] || []);

                        for (const field of possibleFields) {
                            if (lockedFields.has(field)) continue;

                            const fits = window.SchedulerCoreUtils.canBlockFit(
                                {
                                    divName: group.divName,
                                    bunk: "__LEAGUE__",
                                    startTime: group.startTime,
                                    endTime: group.endTime,
                                    slots: group.slots
                                },
                                field,
                                activityProperties,
                                fieldUsageBySlot,
                                sport,
                                true
                            );

                            if (fits) {
                                chosenField = field;
                                chosenSport = sport;
                                break outerSportLoop;
                            }
                        }
                    }

                    if (chosenField) lockedFields.add(chosenField);

                    matchups.push({
                        teamA: A,
                        teamB: B,
                        sport: chosenSport || baseSport,
                        field: chosenField
                    });
                });

                // ----------------------------------------------------------
                // Prepare UI Format
                // ----------------------------------------------------------
                const formatted = matchups.map(m =>
                    (m.teamA === "BYE" || m.teamB === "BYE")
                        ? `${m.teamA} vs ${m.teamB}`
                        : `${m.teamA} vs ${m.teamB} — ${m.sport} @ ${m.field || "TBD"}`
                );

                // ----------------------------------------------------------
                // Save to UI assignment map
                // ----------------------------------------------------------
                window.leagueAssignments ??= {};
                window.leagueAssignments[group.divName] ??= {};

                const slotIndex = group.slots[0];

                window.leagueAssignments[group.divName][slotIndex] = {
                    gameLabel: gameNumber,
                    startMin: group.startTime,
                    endMin: group.endTime,
                    matchups
                };

                // ----------------------------------------------------------
                // Fill ALL bunk blocks with "League Block" placeholder
                // ----------------------------------------------------------
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
                            _allMatchups: formatted,
                            _gameLabel: gameNumber
                        },
                        fieldUsageBySlot,
                        yesterdayHistory,
                        true,
                        activityProperties
                    );
                });

                // ----------------------------------------------------------
                // Lock all chosen fields (true veto)
                // ----------------------------------------------------------
                lockedFields.forEach(f => writeLeagueReservationVeto(f, group));
            });

            console.log("=== LEAGUE GENERATOR SUCCESS ===");

        } catch (err) {
            console.error("CRITICAL ERROR IN LEAGUE ENGINE:", err);
        }
    };

    Leagues.processSpecialtyLeagues = function () {};

    window.SchedulerCoreLeagues = Leagues;

})();
