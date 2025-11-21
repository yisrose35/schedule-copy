
// ============================================================================
// scheduler_logic_core.js
//
// UPDATED (Dynamic Matchup Shuffler):
// - "No Field" Fix: Iterates through ALL valid sports to find an open field.
// - "No Repeats" Fix: Tracks daily usage per league. Prioritizes sports
//   NOT played today.
// - "Dynamic Shuffling": If the standard round results in failures (games
//   without fields), the system shuffles teams to find a matchup combination
//   that fits the available resources.
// ============================================================================

(function() {
'use strict';

// ===== CONFIG =====
const INCREMENT_MINS = 30;
window.INCREMENT_MINS = INCREMENT_MINS;

// Events that REQUIRE scheduling/generation
const GENERATED_EVENTS = [
    'General Activity Slot',
    'Sports Slot',
    'Special Activity',
    'Swim',
    'League Game',
    'Specialty League'
];

// ===== BASIC HELPERS =====
function parseTimeToMinutes(str) {
    if (str == null) return null;
    if (typeof str === "number") return str;

    if (typeof str !== "string") return null;
    let s = str.trim().toLowerCase();
    let mer = null;
    if (s.endsWith("am") || s.endsWith("pm")) {
        mer = s.endsWith("am") ? "am" : "pm";
        s = s.replace(/am|pm/g, "").trim();
    } else {
        // require am/pm to avoid ambiguity
        return null;
    }
    const m = s.match(/^(\d{1,2})\s*:\s*(\d{2})$/);
    if (!m) return null;
    let hh = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    if (Number.isNaN(hh) || Number.isNaN(mm) || mm < 0 || mm > 59) return null;
    if (mer) {
        if (hh === 12) hh = (mer === "am") ? 0 : 12;
        else if (mer === "pm") hh += 12;
    }
    return hh * 60 + mm;
}

function fieldLabel(f) {
    if (typeof f === "string") return f;
    if (f && typeof f === "object" && typeof f.name === "string") return f.name;
    return "";
}

function fmtTime(d) {
    if (!d) return "";
    if (typeof d === 'string') d = new Date(d);
    let h = d.getHours();
    let m = d.getMinutes().toString().padStart(2, "0");
    const ap = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    return `${h}:${m} ${ap}`;
}

// ======================================================
// LEAGUE ROUND STATE (IN-CORE ROUND-ROBIN ENGINE)
// ======================================================

// Global-ish state for this file (per day), but saved to daily data
let coreLeagueRoundState = (window.coreLeagueRoundState || {});

// Load round state from today's daily data (if present)
(function initCoreLeagueRoundState() {
    try {
        const daily = window.loadCurrentDailyData?.() || {};
        if (daily && daily.coreLeagueRoundState && typeof daily.coreLeagueRoundState === "object") {
            coreLeagueRoundState = daily.coreLeagueRoundState;
        }
    } catch (e) {
        console.error("Failed to load core league round state:", e);
        coreLeagueRoundState = {};
    }
    window.coreLeagueRoundState = coreLeagueRoundState;
})();

// Save round state back into today's daily data
function saveCoreLeagueRoundState() {
    try {
        window.saveCurrentDailyData?.("coreLeagueRoundState", coreLeagueRoundState);
    } catch (e) {
        console.error("Failed to save core league round state:", e);
    }
}

// Full round-robin (ALL rounds) using circle method + BYE
function coreFullRoundRobin(teamList) {
    if (!teamList || teamList.length < 2) return [];

    const teams = teamList.map(String);
    const t = [...teams];

    if (t.length % 2 !== 0) {
        t.push("BYE");
    }

    const n = t.length;
    const fixed = t[0];
    let rotating = t.slice(1);
    const rounds = [];

    for (let r = 0; r < n - 1; r++) {
        const pairings = [];

        // fixed team matches first rotating slot
        pairings.push([fixed, rotating[0]]);

        // pair remaining
        for (let i = 1; i < n / 2; i++) {
            const a = rotating[i];
            const b = rotating[rotating.length - i];
            pairings.push([a, b]);
        }

        // remove BYE pairs
        const clean = pairings.filter(([a, b]) => a !== "BYE" && b !== "BYE");
        rounds.push(clean);

        // rotate
        rotating.unshift(rotating.pop());
    }

    return rounds;
}

/**
 * Get the NEXT round of matchups for a league, guaranteed to advance.
 */
function coreGetNextLeagueRound(leagueName, teams) {
    const key = String(leagueName || "");
    if (!key || !teams || teams.length < 2) return [];

    const teamKey = teams.map(String).sort().join("|"); // identity of the team set
    const rounds = coreFullRoundRobin(teams);
    if (rounds.length === 0) return [];

    let state = coreLeagueRoundState[key] || { idx: 0, teamKey };

    if (state.teamKey !== teamKey) {
        state = { idx: 0, teamKey };
    }

    const idx = state.idx % rounds.length;
    const matchups = rounds[idx];

    // advance pointer
    state.idx = (idx + 1) % rounds.length;
    coreLeagueRoundState[key] = state;

    saveCoreLeagueRoundState();

    return matchups;
}

// ====== LEAGUE "QUANTUM-ISH" SPORT OPTIMIZER ======
function assignSportsMultiRound(
    matchups,
    availableLeagueSports,
    existingTeamCounts,
    leagueHistory,
    lastSportByTeamBase
) {
    const sports = availableLeagueSports.slice();
    const baseTeamCounts = existingTeamCounts || {};
    const baseLastSports = lastSportByTeamBase || {};

    const allTeams = new Set();
    matchups.forEach(([a, b]) => {
        if (!a || !b) return;
        allTeams.add(String(a));
        allTeams.add(String(b));
    });

    const workCounts = {};
    allTeams.forEach(t => {
        workCounts[t] = {};
        const src = baseTeamCounts[t] || {};
        for (const key in src) {
            if (Object.prototype.hasOwnProperty.call(src, key)) {
                workCounts[t][key] = src[key];
            }
        }
    });

    const workLastSport = {};
    allTeams.forEach(t => {
        workLastSport[t] = baseLastSports[t] || null;
    });

    const sportTotals = {};
    sports.forEach(s => { sportTotals[s] = 0; });
    for (const team in workCounts) {
        if (!Object.prototype.hasOwnProperty.call(workCounts, team)) continue;
        const counts = workCounts[team];
        for (const s in counts) {
            if (Object.prototype.hasOwnProperty.call(counts, s)) {
                sportTotals[s] = (sportTotals[s] || 0) + counts[s];
            }
        }
    }

    let bestPlan = null;
    let bestScore = Infinity;
    let bestCounts = null;
    let bestLastSports = null;
    let nodesVisited = 0;
    const MAX_NODES = 30000; 

    function teamDistinctSports(team) {
        return Object.keys(workCounts[team] || {}).length;
    }

    function teamTotalGames(team) {
        const counts = workCounts[team] || {};
        let total = 0;
        for (const s in counts) {
            if (Object.prototype.hasOwnProperty.call(counts, s)) {
                total += counts[s];
            }
        }
        return total;
    }

    function teamImbalance(team) {
        if (sports.length === 0) return 0;
        const counts = workCounts[team] || {};
        let min = Infinity;
        let max = -Infinity;
        sports.forEach(s => {
            const v = counts[s] || 0;
            if (v < min) min = v;
            if (v > max) max = v;
        });
        return max - min;
    }

    function globalImbalance() {
        if (sports.length === 0) return 0;
        let min = Infinity;
        let max = -Infinity;
        sports.forEach(s => {
            const v = sportTotals[s] || 0;
            if (v < min) min = v;
            if (v > max) max = v;
        });
        return max - min;
    }

    function dfs(idx, plan, currentCost) {
        if (currentCost >= bestScore) return;
        if (nodesVisited > MAX_NODES) return;

        if (idx === matchups.length) {
            const totalCost = currentCost + globalImbalance() * 4;
            if (totalCost < bestScore) {
                bestScore = totalCost;
                bestPlan = plan.slice();
                bestCounts = JSON.parse(JSON.stringify(workCounts));
                bestLastSports = JSON.parse(JSON.stringify(workLastSport));
            }
            return;
        }

        nodesVisited++;

        const [rawA, rawB] = matchups[idx];
        const teamA = String(rawA);
        const teamB = String(rawB);

        const orderedSports = sports.slice().sort((s1, s2) => {
            const c1 = (workCounts[teamA][s1] || 0) + (workCounts[teamB][s1] || 0);
            const c2 = (workCounts[teamA][s2] || 0) + (workCounts[teamB][s2] || 0);
            if (c1 !== c2) return c1 - c2;

            const h1 = leagueHistory[s1] || 0;
            const h2 = leagueHistory[s2] || 0;
            return h1 - h2;
        });

        const beforeGlobalImb = globalImbalance();
        const beforeTeamImbA = teamImbalance(teamA);
        const beforeTeamImbB = teamImbalance(teamB);
        const beforeLastA = workLastSport[teamA] || null;
        const beforeLastB = workLastSport[teamB] || null;

        for (const sport of orderedSports) {
            const prevA = workCounts[teamA][sport] || 0;
            const prevB = workCounts[teamB][sport] || 0;

            let delta = 0;

            const distinctBeforeA = teamDistinctSports(teamA);
            const distinctBeforeB = teamDistinctSports(teamB);

            const totalGamesA = teamTotalGames(teamA);
            const totalGamesB = teamTotalGames(teamB);

            const idealCoverageA = Math.min(sports.length, Math.ceil(totalGamesA / Math.max(1, sports.length)));
            const idealCoverageB = Math.min(sports.length, Math.ceil(totalGamesB / Math.max(1, sports.length)));

            if (prevA > 0) {
                delta += 5;
                if (distinctBeforeA < sports.length) delta += 15;
                if (distinctBeforeA < idealCoverageA) delta += 6;
            }
            if (prevB > 0) {
                delta += 5;
                if (distinctBeforeB < sports.length) delta += 15;
                if (distinctBeforeB < idealCoverageB) delta += 6;
            }

            if (beforeLastA === sport) {
                delta += 40;
            }
            if (beforeLastB === sport) {
                delta += 40;
            }

            workCounts[teamA][sport] = prevA + 1;
            workCounts[teamB][sport] = prevB + 1;
            sportTotals[sport] = (sportTotals[sport] || 0) + 2;

            workLastSport[teamA] = sport;
            workLastSport[teamB] = sport;

            const afterGlobalImb = globalImbalance();
            if (afterGlobalImb > beforeGlobalImb) {
                delta += (afterGlobalImb - beforeGlobalImb) * 4;
            }

            const afterTeamImbA = teamImbalance(teamA);
            const afterTeamImbB = teamImbalance(teamB);
            if (afterTeamImbA > beforeTeamImbA) {
                delta += (afterTeamImbA - beforeTeamImbA) * 3;
            }
            if (afterTeamImbB > beforeTeamImbB) {
                delta += (afterTeamImbB - beforeTeamImbB) * 3;
            }

            const lastUsed = leagueHistory[sport] || 0;
            if (lastUsed > 0) {
                delta += (Date.now() - lastUsed) * 0.00000003;
            }

            const newCost = currentCost + delta;

            if (newCost < bestScore) {
                plan.push({ sport });
                dfs(idx + 1, plan, newCost);
                plan.pop();
            }

            workCounts[teamA][sport] = prevA;
            workCounts[teamB][sport] = prevB;
            sportTotals[sport] = (sportTotals[sport] || 0) - 2;
            if (prevA === 0) delete workCounts[teamA][sport];
            if (prevB === 0) delete workCounts[teamB][sport];

            workLastSport[teamA] = beforeLastA;
            workLastSport[teamB] = beforeLastB;
        }
    }

    dfs(0, [], 0);

    if (!bestPlan) {
        const fallback = matchups.map((_, i) => ({
            sport: sports[i % sports.length]
        }));
        return {
            assignments: fallback,
            updatedTeamCounts: baseTeamCounts,
            updatedLastSports: baseLastSports
        };
    }

    return {
        assignments: bestPlan,
        updatedTeamCounts: bestCounts || baseTeamCounts,
        updatedLastSports: bestLastSports || baseLastSports
    };
}

// Simple round-robin for specialty fallback & Shuffling
function pairRoundRobin(teamList) {
    const arr = teamList.map(String);
    if (arr.length < 2) return [];
    if (arr.length % 2 === 1) arr.push("BYE");
    const n = arr.length;
    const half = n / 2;
    const pairs = [];
    for (let i = 0; i < half; i++) {
        const A = arr[i];
        const B = arr[n - 1 - i];
        if (A !== "BYE" && B !== "BYE") pairs.push([A, B]);
    }
    return pairs;
}

// Shuffles array in place
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// =====================================================================
// MAIN ENTRY POINT
// =====================================================================
window.runSkeletonOptimizer = function(manualSkeleton) {
    window.scheduleAssignments = {};
    window.leagueAssignments = {};
    window.unifiedTimes = [];

    if (!manualSkeleton || manualSkeleton.length === 0) {
        return false;
    }

    const {
        divisions,
        availableDivisions,
        activityProperties,
        allActivities,
        h2hActivities,
        fieldsBySport,
        masterLeagues,
        masterSpecialtyLeagues,
        yesterdayHistory,
        rotationHistory,
        disabledLeagues,
        disabledSpecialtyLeagues
    } = loadAndFilterData();

    let fieldUsageBySlot = {};
    window.fieldUsageBySlot = fieldUsageBySlot;
    window.activityProperties = activityProperties;

    const timestamp = Date.now();
    
    // --- NEW: Track which sports a league has played TODAY ---
    const dailyLeagueSportsUsage = {}; // { "LeagueName": Set(["Baseball", "Kickball"]) }

    // ===== PASS 1: Build unified time grid =====
    let earliestMin = null;
    let latestMin = null;

    Object.values(divisions).forEach(div => {
        const s = parseTimeToMinutes(div.startTime);
        const e = parseTimeToMinutes(div.endTime);
        if (s !== null && (earliestMin === null || s < earliestMin)) earliestMin = s;
        if (e !== null && (latestMin === null || e > latestMin)) latestMin = e;
    });

    if (earliestMin === null) earliestMin = 540; // 9:00am
    if (latestMin === null) latestMin = 960; // 4:00pm
    if (latestMin <= earliestMin) latestMin = earliestMin + 60;

    const baseDate = new Date(1970, 0, 1, 0, 0, 0);
    let currentMin = earliestMin;
    while (currentMin < latestMin) {
        const nextMin = currentMin + INCREMENT_MINS;
        const startDate = new Date(baseDate.getTime() + currentMin * 60000);
        const endDate   = new Date(baseDate.getTime() + nextMin   * 60000);
        window.unifiedTimes.push({
            start: startDate,
            end:   endDate,
            label: `${fmtTime(startDate)} - ${fmtTime(endDate)}`
        });
        currentMin = nextMin;
    }
    if (window.unifiedTimes.length === 0) {
        window.updateTable?.();
        return false;
    }

    // Create empty schedule arrays per bunk
    availableDivisions.forEach(divName => {
        (divisions[divName]?.bunks || []).forEach(bunk => {
            window.scheduleAssignments[bunk] = new Array(window.unifiedTimes.length);
        });
    });

    // =================================================================
    // PASS 1.5 — Bunk-Specific Pinned Overrides
    // =================================================================
    try {
        const dailyData = window.loadCurrentDailyData?.() || {};
        const bunkOverrides = dailyData.bunkActivityOverrides || [];

        bunkOverrides.forEach(override => {
            const startMin = parseTimeToMinutes(override.startTime);
            const endMin   = parseTimeToMinutes(override.endTime);
            const slots    = findSlotsForRange(startMin, endMin);
            const bunk     = override.bunk;

            if (window.scheduleAssignments[bunk] && slots.length > 0) {
                slots.forEach((slotIndex, idx) => {
                    if (!window.scheduleAssignments[bunk][slotIndex]) {
                        window.scheduleAssignments[bunk][slotIndex] = {
                            field: { name: override.activity },
                            sport: null,
                            continuation: (idx > 0),
                            _fixed: true,
                            _h2h: false,
                            vs: null,
                            _activity: override.activity,
                            _endTime: endMin 
                        };
                    }
                });
            }
        });
    } catch (e) {
        console.error("Error placing bunk-specific overrides:", e);
    }

    // =================================================================
    // NORMALIZATION HELPERS (GA / LEAGUE / SPECIALTY LEAGUE)
    // =================================================================

    /**
     * Normalize ANY spelling of General Activity → "General Activity Slot"
     */
    function normalizeGA(name) {
        if (!name) return null;
        const s = String(name).toLowerCase().replace(/\s+/g, '');

        const keys = [
            "generalactivity", "generalactivyt",
            "activity", "activyty", "activty", "activyt",
            "activityslot", "generalactivityslot",
            "genactivity", "genact", "ga"
        ];

        if (keys.some(k => s.includes(k))) {
            return "General Activity Slot";
        }
        return null;
    }

    /**
     * Normalize ANY spelling of League Game → "League Game"
     * (does NOT match plain "specialty league" text)
     */
    function normalizeLeague(name) {
        if (!name) return null;
        const s = String(name).toLowerCase().replace(/\s+/g, '');

        const keys = [
            "leaguegame",      // "League Game", "League Game 1"
            "leaguegameslot",  // "League Game Slot"
            "leagame",         // typos
            "lg",              // "LG 1", etc.
            "lgame"            // more typos
        ];

        if (keys.some(k => s.includes(k))) {
            return "League Game";
        }
        return null;
    }

    /**
     * Normalize ANY spelling of Specialty League → "Specialty League"
     */
    function normalizeSpecialtyLeague(name) {
        if (!name) return null;
        const s = String(name).toLowerCase().replace(/\s+/g, '');

        const keys = [
            "specialtyleague", "specialityleague",
            "specleague", "specialleague", "sleauge"
        ];

        if (keys.some(k => s.includes(k))) {
            return "Specialty League";
        }
        return null;
    }

    // =================================================================
    // PASS 2 — Pinned / Split / Slot Skeleton Blocks
    // =================================================================
    const schedulableSlotBlocks = [];

    manualSkeleton.forEach(item => {

        const allBunks = divisions[item.division]?.bunks || [];
        if (!allBunks || allBunks.length === 0) return;

        const startMin = parseTimeToMinutes(item.startTime);
        const endMin   = parseTimeToMinutes(item.endTime);

        const allSlots = findSlotsForRange(startMin, endMin);
        if (allSlots.length === 0) return;

        // Normalize everything
        const normGA       = normalizeGA(item.event);
        const normLeague   = normalizeLeague(item.event);
        const normSpecLg   = normalizeSpecialtyLeague(item.event);

        const finalEventName =
            normGA ||
            normSpecLg ||   // ✅ SPECIALTY FIRST
            normLeague ||
            item.event;

        const isGeneratedEvent =
            GENERATED_EVENTS.includes(finalEventName) ||
            normGA === "General Activity Slot" ||
            normLeague === "League Game" ||
            normSpecLg === "Specialty League";

        // -------------------------------------------------------------
        // 1. PURE PINNED — Lunch, Cleanup, Dismissal, Snacks, Custom
        // -------------------------------------------------------------
        if (item.type === 'pinned' || !isGeneratedEvent) {
            allBunks.forEach(bunk => {
                allSlots.forEach((slotIndex, idx) => {
                    if (!window.scheduleAssignments[bunk][slotIndex]) {
                        window.scheduleAssignments[bunk][slotIndex] = {
                            field: { name: item.event },
                            sport: null,
                            continuation: (idx > 0),
                            _fixed: true,
                            _h2h: false,
                            vs: null,
                            _activity: item.event,
                            _endTime: endMin 
                        };
                    }
                });
            });
        }

        // -------------------------------------------------------------
        // 2. SPLIT BLOCK — FULLY GENERATED GA + PINNED SWIM
        // -------------------------------------------------------------
        else if (item.type === 'split') {

            if (!item.subEvents || item.subEvents.length < 2) return;

            // Swim is ALWAYS pinned
            const swimLabel = "Swim";

            // Normalize GA half
            const rawGAEvent = item.subEvents[1].event;
            const gaLabel =
                normalizeGA(rawGAEvent) ||
                "General Activity Slot";

            // --- Split bunks ---
            const mid = Math.ceil(allBunks.length / 2);
            const bunksTop    = allBunks.slice(0, mid);
            const bunksBottom = allBunks.slice(mid);

            // --- Split time ---
            const slotMid = Math.ceil(allSlots.length / 2);
            const slotsFirst  = allSlots.slice(0, slotMid);
            const slotsSecond = allSlots.slice(slotMid);

            // ---- PIN SWIM ----
            function pinSwim(bunks, slots) {
                bunks.forEach(bunk => {
                    slots.forEach((slotIndex, idx) => {
                        window.scheduleAssignments[bunk][slotIndex] = {
                            field: { name: swimLabel },
                            sport: null,
                            continuation: (idx > 0),
                            _fixed: true,
                            _h2h: false,
                            vs: null,
                            _activity: swimLabel
                        };
                    });
                });
            }

            // ---- GA GENERATED ----
            function pushGA(bunks, slots) {
                bunks.forEach(bunk => {
                    schedulableSlotBlocks.push({
                        divName:   item.division,
                        bunk:      bunk,
                        event:     gaLabel,
                        startTime: startMin,
                        endTime:   endMin,
                        slots
                    });
                });
            }

            // FIRST HALF
            pinSwim(bunksTop, slotsFirst);
            pushGA(bunksBottom, slotsFirst);

            // SECOND HALF
            pushGA(bunksTop, slotsSecond);
            pinSwim(bunksBottom, slotsSecond);
        }

        // -------------------------------------------------------------
        // 3. NORMAL GENERATED SLOTS
        // -------------------------------------------------------------
        else if (item.type === 'slot' && isGeneratedEvent) {

            let normalizedEvent = null;

            // ✅ SPECIALTY FIRST, then Regular League, then GA
            if (normalizeSpecialtyLeague(item.event)) {
                normalizedEvent = "Specialty League";     // Specialty leagues
            } else if (normalizeLeague(item.event)) {
                normalizedEvent = "League Game";          // Regular leagues
            } else if (normalizeGA(item.event)) {
                normalizedEvent = "General Activity Slot";
            } else {
                normalizedEvent = item.event;
            }

            allBunks.forEach(bunk => {
                schedulableSlotBlocks.push({
                    divName:   item.division,
                    bunk:      bunk,
                    event:     normalizedEvent,
                    startTime: startMin,
                    endTime:   endMin,
                    slots:     allSlots
                });
            });
        }

    });  // END manualSkeleton.forEach

        // =================================================================
    // PASS 3 — SPECIALTY LEAGUES (HIGHEST FIELD PRIORITY)
    // =================================================================
    const leagueBlocks = schedulableSlotBlocks.filter(b => b.event === 'League Game');
    const specialtyLeagueBlocks = schedulableSlotBlocks.filter(b => b.event === 'Specialty League');
    const remainingBlocks = schedulableSlotBlocks.filter(
        b => b.event !== 'League Game' && b.event !== 'Specialty League'
    );

    // --- FIRST: SPECIALTY LEAGUES ---
    const specialtyLeagueGroups = {};
    specialtyLeagueBlocks.forEach(block => {
        const key = `${block.divName}-${block.startTime}`;
        if (!specialtyLeagueGroups[key]) {
            specialtyLeagueGroups[key] = {
                divName: block.divName,
                startTime: block.startTime,
                endTime: block.endTime, // --- NEW: Capture End Time
                slots: block.slots,
                bunks: new Set()
            };
        }
        specialtyLeagueGroups[key].bunks.add(block.bunk);
    });

    Object.values(specialtyLeagueGroups).forEach(group => {
        const leagueEntry = Object.values(masterSpecialtyLeagues).find(l =>
            l.enabled &&
            !disabledSpecialtyLeagues.includes(l.name) &&
            l.divisions.includes(group.divName)
        );
        if (!leagueEntry) return;

        const allBunksInGroup = Array.from(group.bunks);
        const blockBase = {
            slots: group.slots,
            divName: group.divName,
            startTime: group.startTime,
            endTime: group.endTime
        };

        const leagueName = leagueEntry.name;
        const leagueHistory = rotationHistory.leagues[leagueName] || {};
        rotationHistory.leagues[leagueName] = leagueHistory;

        const sport = leagueEntry.sport;
        if (!sport) return;

        // 🔒 HARD LOCK: specialty league = exactly this sport, no optimizer
        const bestSport = sport;

        const allMatchupLabels = [];
        const picksByTeam = {};

        if (bestSport) {
            const leagueFields = leagueEntry.fields || [];
            const leagueTeams = (leagueEntry.teams || []).map(t => String(t).trim()).filter(Boolean);
            if (leagueFields.length === 0 || leagueTeams.length < 2) return;

            let matchups = [];
            if (typeof window.getLeagueMatchups === 'function') {
                matchups = window.getLeagueMatchups(leagueEntry.name, leagueTeams) || [];
            } else {
                matchups = pairRoundRobin(leagueTeams);
            }

            const gamesPerField = Math.ceil(matchups.length / leagueFields.length);
            const slotCount = group.slots.length || 1;
            const usedFieldsInThisBlock = Array.from({ length: slotCount }, () => new Set());

            for (let i = 0; i < matchups.length; i++) {
                const [teamA, teamB] = matchups[i];
                if (teamA === "BYE" || teamB === "BYE") continue;

                const fieldIndex = Math.floor(i / gamesPerField);
                const fieldName = leagueFields[fieldIndex % leagueFields.length];

                const baseLabel = `${teamA} vs ${teamB} (${bestSport})`;

                let isFieldAvailable = true;
                const slotIndex = group.slots[i % slotCount];

                if (fieldUsageBySlot[slotIndex]?.[fieldName]?.count >= 1) {
                    isFieldAvailable = false;
                }
                if (usedFieldsInThisBlock[i % slotCount].has(fieldName)) {
                    isFieldAvailable = false;
                }

                const props = activityProperties[fieldName];
                if (props) {
                    if (!isTimeAvailable(slotIndex, props)) {
                        isFieldAvailable = false;
                    }
                    
                    // --- UPDATED: Exclusive Preference Check ---
                    if (props.preferences && props.preferences.enabled && props.preferences.exclusive) {
                        if (!props.preferences.list.includes(group.divName)) {
                             isFieldAvailable = false;
                        }
                    }
                    // -------------------------------------------

                    if (props.limitUsage && props.limitUsage.enabled) {
                        if (!props.limitUsage.divisions[group.divName]) {
                            isFieldAvailable = false;
                        }
                    }
                }

                let pick, fullLabel;
                if (fieldName && isFieldAvailable) {
                    fullLabel = `${baseLabel} @ ${fieldName}`;
                    pick = {
                        field: fieldName,
                        sport: baseLabel,
                        _h2h: true,
                        vs: null,
                        _activity: bestSport
                    };
                    markFieldUsage(
                        { ...blockBase, _activity: bestSport, bunk: 'league' },
                        fieldName,
                        fieldUsageBySlot
                    );
                    usedFieldsInThisBlock[i % slotCount].add(fieldName);
                } else {
                    fullLabel = `${baseLabel} (No Field)`;
                    pick = {
                        field: "No Field",
                        sport: baseLabel,
                        _h2h: true,
                        vs: null,
                        _activity: bestSport
                    };
                }

                allMatchupLabels.push(fullLabel);
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
            fillBlock(
                { ...blockBase, bunk },
                pickToAssign,
                fieldUsageBySlot,
                yesterdayHistory,
                true // isLeagueFill = true
            );
        });
    });

    // =================================================================
    // PASS 3.5 — REGULAR LEAGUES (SECOND PRIORITY)
    // =================================================================
    const leagueGroups = {};
    leagueBlocks.forEach(block => {
        const leagueEntry = Object.entries(masterLeagues).find(([name, l]) =>
            l.enabled &&
            !disabledLeagues.includes(name) &&
            l.divisions.includes(block.divName)
        );
        if (!leagueEntry) return;

        const leagueName = leagueEntry[0];
        const league     = leagueEntry[1];
        const key = `${leagueName}-${block.startTime}`;

        if (!leagueGroups[key]) {
            leagueGroups[key] = {
                leagueName,
                league,
                startTime: block.startTime,
                endTime: block.endTime, // --- NEW: Capture End Time
                slots: block.slots,
                bunks: new Set()
            };
        }
        leagueGroups[key].bunks.add(block.bunk);
    });

    const sortedLeagueGroups = Object.values(leagueGroups).sort((a, b) => a.startTime - b.startTime);

    sortedLeagueGroups.forEach(group => {
        const { leagueName, league, slots } = group;

        const leagueTeams = (league.teams || []).map(t => String(t).trim()).filter(Boolean);
        if (leagueTeams.length < 2) return;

        const allBunksInGroup = Array.from(group.bunks).sort();
        if (allBunksInGroup.length === 0) return;

        // determine a base division for field rules
        let baseDivName = null;
        {
            const firstBunk = allBunksInGroup[0];
            baseDivName = Object.keys(divisions).find(div =>
                (divisions[div].bunks || []).includes(firstBunk)
            );
        }
        if (!baseDivName) return;

        const blockBase = { slots, divName: baseDivName, endTime: group.endTime };

        const sports = (league.sports || []).filter(s => fieldsBySport[s]);
        if (sports.length === 0) return;
        
        // --- 1. PRE-OPTIMIZER FILTER: EXCLUDE SPORTS PLAYED TODAY ---
        const usedToday = dailyLeagueSportsUsage[leagueName] || new Set();
        
        // Default: Only feed the optimizer sports that have NOT been played today.
        let optimizerSports = sports.filter(s => !usedToday.has(s));
        
        // Fallback: If ALL sports have been played today (e.g. 3rd game, 2 sports),
        // then we MUST repeat something. Feed it everything.
        if (optimizerSports.length === 0) {
            optimizerSports = sports;
        }
        // ------------------------------------------------------------

        const leagueHistory = rotationHistory.leagues[leagueName] || {};
        rotationHistory.leagues[leagueName] = leagueHistory;

        // Per-team totals by sport
        const leagueTeamCounts = rotationHistory.leagueTeamSports[leagueName] || {};
        rotationHistory.leagueTeamSports[leagueName] = leagueTeamCounts;

        // Per-team last sport
        rotationHistory.leagueTeamLastSport = rotationHistory.leagueTeamLastSport || {};
        const leagueTeamLastSport = rotationHistory.leagueTeamLastSport[leagueName] || {};
        rotationHistory.leagueTeamLastSport[leagueName] = leagueTeamLastSport;

        // Get round-robin matchups from league_scheduling.js if available,
        // otherwise fall back to our own engine
        let standardMatchups = [];
        if (typeof window.getLeagueMatchups === "function") {
            standardMatchups = window.getLeagueMatchups(leagueName, leagueTeams) || [];
        } else {
            standardMatchups = coreGetNextLeagueRound(leagueName, leagueTeams) || [];
        }
        
        const slotCount = slots.length || 1;

        // --- NEW: DYNAMIC MATCHUP SHUFFLER ---
        // Helper: Simulate scheduling for a set of matchups to count successful field assignments.
        const evaluateMatchups = (candidateMatchups) => {
            const nonBye = candidateMatchups.filter(p => p && p[0] !== "BYE" && p[1] !== "BYE");
            
            // Use Optimizer to assign sports
            const { assignments } = assignSportsMultiRound(
                nonBye,
                optimizerSports,
                leagueTeamCounts,
                leagueHistory,
                leagueTeamLastSport
            );

            // Use local tracking sets for simulation (don't pollute global)
            const simUsedFields = Array.from({ length: slotCount }, () => new Set());
            let successCount = 0;
            const results = [];

            nonBye.forEach((pair, idx) => {
                const [teamA, teamB] = pair;
                const preferredSport = assignments[idx]?.sport || optimizerSports[idx % optimizerSports.length];

                // Sport Priority Logic (Same as final assignment)
                const candidateSports = [];
                candidateSports.push(preferredSport);
                sports.forEach(s => { if (s !== preferredSport && !usedToday.has(s)) candidateSports.push(s); });
                sports.forEach(s => { if (usedToday.has(s) && s !== preferredSport) candidateSports.push(s); });

                let foundField = null;
                let foundSport = preferredSport;
                let slotIdx = idx % slotCount;

                for (const s of candidateSports) {
                    const possibleFields = fieldsBySport[s] || [];
                    let found = null;

                    // A. Unused
                    for (const f of possibleFields) {
                        if (!simUsedFields[slotIdx].has(f) &&
                            // Use global fieldUsage for *other* blocks, but assume current block is empty for simulation
                            // Note: We check global usage, but ignore 'usedFieldsPerSlot' because that's what we are building
                            (fieldUsageBySlot[slots[slotIdx]]?.[f]?.count || 0) === 0 && 
                            canLeagueGameFit(blockBase, f, fieldUsageBySlot, activityProperties)) {
                            found = f; break;
                        }
                    }
                    // B. Squeeze (not ideal for simulation, stick to strict for now)
                    
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

        // 1. Try Standard Round
        let bestResult = evaluateMatchups(standardMatchups);
        
        // 2. If failures exist, try Shuffling
        const nonByeCount = standardMatchups.filter(p => p && p[0] !== "BYE" && p[1] !== "BYE").length;
        
        if (bestResult.successCount < nonByeCount) {
            console.log(`League ${leagueName}: Standard round failed (${bestResult.successCount}/${nonByeCount}). Attempting shuffle...`);
            
            const teamListCopy = [...leagueTeams];
            
            // Try 50 random shuffles
            for (let i = 0; i < 50; i++) {
                shuffleArray(teamListCopy);
                const shuffledMatchups = pairRoundRobin(teamListCopy);
                const res = evaluateMatchups(shuffledMatchups);
                
                if (res.successCount > bestResult.successCount) {
                    bestResult = res;
                    if (res.successCount === nonByeCount) break; // Found perfect solution
                }
            }
            console.log(`League ${leagueName}: Shuffle result (${bestResult.successCount}/${nonByeCount}).`);
        }

        // 3. Apply Best Result
        const { assignments } = bestResult; // Use the assignments from the best run
        
        rotationHistory.leagueTeamSports[leagueName] = updatedTeamCounts; // This assumes assignments from standard run... 
        // Wait, updatedTeamCounts comes from `assignSportsMultiRound` return. 
        // We need to re-run assignSportsMultiRound one last time with the WINNING matchups to update stats correctly.
        
        const winningMatchups = bestResult.matchups.filter(p => p && p[0] !== "BYE" && p[1] !== "BYE");
        
        const finalOpt = assignSportsMultiRound(
            winningMatchups,
            optimizerSports,
            leagueTeamCounts,
            leagueHistory,
            leagueTeamLastSport
        );
        
        // Commit stats
        rotationHistory.leagueTeamSports[leagueName] = finalOpt.updatedTeamCounts;
        rotationHistory.leagueTeamLastSport[leagueName] = finalOpt.updatedLastSports;

        const allMatchupLabels = [];
        const usedForAssignments = [];
        const usedFieldsPerSlot = Array.from({ length: slotCount }, () => new Set());

        winningMatchups.forEach((pair, idx) => {
            const [teamA, teamB] = pair;
            const preferredSport = finalOpt.assignments[idx]?.sport || optimizerSports[idx % optimizerSports.length];
            
            const candidateSports = [];
            candidateSports.push(preferredSport);
            sports.forEach(s => { if (s !== preferredSport && !usedToday.has(s)) candidateSports.push(s); });
            sports.forEach(s => { if (usedToday.has(s) && s !== preferredSport) candidateSports.push(s); });

            let finalSport = preferredSport;
            let finalField = null;
            let slotIdx = idx % slotCount;

            for (const s of candidateSports) {
                const possibleFields = fieldsBySport[s] || [];
                let found = null;

                for (const f of possibleFields) {
                    if (!usedFieldsPerSlot[slotIdx].has(f) &&
                        canLeagueGameFit(blockBase, f, fieldUsageBySlot, activityProperties)) {
                        found = f;
                        break;
                    }
                }

                if (!found && possibleFields.length > 0) {
                    const f = possibleFields[usedFieldsPerSlot[slotIdx].size % possibleFields.length];
                    if (canLeagueGameFit(blockBase, f, fieldUsageBySlot, activityProperties)) {
                        found = f;
                    }
                }

                if (found) {
                    finalSport = s;
                    finalField = found;
                    usedFieldsPerSlot[slotIdx].add(found);
                    break; 
                }
            }

            let label;
            if (finalField) {
                label = `${teamA} vs ${teamB} (${finalSport}) @ ${finalField}`;
                markFieldUsage({ ...blockBase, _activity: finalSport, bunk: 'league' }, finalField, fieldUsageBySlot);
                
                if (!dailyLeagueSportsUsage[leagueName]) {
                    dailyLeagueSportsUsage[leagueName] = new Set();
                }
                dailyLeagueSportsUsage[leagueName].add(finalSport);

            } else {
                label = `${teamA} vs ${teamB} (No Field)`;
            }

            leagueHistory[finalSport] = Date.now();

            usedForAssignments.push({
                label,
                sport: finalSport,
                field: finalField || "No Field",
                teamA,
                teamB
            });

            allMatchupLabels.push(label);
        });

        bestResult.matchups.forEach(pair => {
             if (!pair) return;
             const [teamA, teamB] = pair;
             if (teamA === "BYE" || teamB === "BYE") {
                 const label = `${teamA} vs ${teamB} (BYE)`;
                 allMatchupLabels.push(label);
             }
        });

        const noGamePick = {
            field: "No Game",
            sport: null,
            _h2h: true,
            _activity: "League",
            _allMatchups: allMatchupLabels
        };

        let bunkPtr = 0;

        usedForAssignments.forEach(game => {
            if (bunkPtr + 1 >= allBunksInGroup.length) {
                return;
            }

            const bunkA = allBunksInGroup[bunkPtr];
            const bunkB = allBunksInGroup[bunkPtr + 1];
            bunkPtr += 2;

            const pick = {
                field: game.field,
                sport: game.label,
                _h2h: true,
                vs: null,
                _activity: game.sport,
                _allMatchups: allMatchupLabels
            };

            const bunkADiv = Object.keys(divisions).find(div =>
                (divisions[div].bunks || []).includes(bunkA)
            ) || baseDivName;
            const bunkBDiv = Object.keys(divisions).find(div =>
                (divisions[div].bunks || []).includes(bunkB)
            ) || baseDivName;

            fillBlock(
                { slots, bunk: bunkA, divName: bunkADiv, startTime: group.startTime, endTime: group.endTime + INCREMENT_MINS * slots.length },
                pick,
                fieldUsageBySlot,
                yesterdayHistory,
                true // isLeagueFill = true
            );
            fillBlock(
                { slots, bunk: bunkB, divName: bunkBDiv, startTime: group.startTime, endTime: group.endTime + INCREMENT_MINS * slots.length },
                pick,
                fieldUsageBySlot,
                yesterdayHistory,
                true // isLeagueFill = true
            );
        });

        while (bunkPtr < allBunksInGroup.length) {
            const leftoverBunk = allBunksInGroup[bunkPtr++];
            const bunkDivName = Object.keys(divisions).find(div =>
                (divisions[div].bunks || []).includes(leftoverBunk)
            ) || baseDivName;

            fillBlock(
                { slots, bunk: leftoverBunk, divName: bunkDivName, startTime: group.startTime, endTime: group.endTime + INCREMENT_MINS * slots.length },
                noGamePick,
                fieldUsageBySlot,
                yesterdayHistory,
                true // isLeagueFill = true
            );
        }
    });

    // =================================================================
    // PASS 4 — Remaining Schedulable Slots (Smart Activities, LOWEST)
    // =================================================================
    remainingBlocks.sort((a, b) => a.startTime - b.startTime);

    for (const block of remainingBlocks) {
        if (!block.slots || block.slots.length === 0) continue;
        if (!window.scheduleAssignments[block.bunk]) continue;
        if (window.scheduleAssignments[block.bunk][block.slots[0]]) continue; // already filled

        let pick = null;

        // If a league block falls through (e.g., no teams/fields assigned),
        // do NOT let it be filled by findBestGeneralActivity.
        if (block.event === 'League Game' || block.event === 'Specialty League') {
            pick = { field: "Unassigned League", sport: null, _activity: "Free" };
        }
        // 1) Specific buckets
        else if (block.event === 'Special Activity') {
            pick = window.findBestSpecial?.(
                block,
                allActivities,
                fieldUsageBySlot,
                yesterdayHistory,
                activityProperties,
                rotationHistory,
                divisions
            );
        } else if (block.event === 'Sports Slot') {
            pick = window.findBestSportActivity?.(
                block,
                allActivities,
                fieldUsageBySlot,
                yesterdayHistory,
                activityProperties,
                rotationHistory,
                divisions
            );
        } else if (block.event === 'Swim') {
            pick = { field: "Swim", sport: null, _activity: "Swim" };
        }

        // 2) Fallback to general
        if (!pick) {
            pick = window.findBestGeneralActivity?.(
                block,
                allActivities,
                h2hActivities,
                fieldUsageBySlot,
                yesterdayHistory,
                activityProperties,
                rotationHistory,
                divisions
            );
        }

        // 3) Validate the pick
        if (pick && !isPickValidForBlock(block, pick, activityProperties, fieldUsageBySlot)) {
            pick = null;
        }

        // 4) Final assignment
        if (pick) {
            fillBlock(block, pick, fieldUsageBySlot, yesterdayHistory, false);
        } else {
            // No valid fields/activities -> Free
            fillBlock(block, { field: "Free", sport: null, _activity: "Free" }, fieldUsageBySlot, false);
        }
    }

    // =================================================================
    // PASS 5 — Update Rotation History
    // =================================================================
    try {
        const historyToSave = rotationHistory;

        availableDivisions.forEach(divName => {
            (divisions[divName]?.bunks || []).forEach(bunk => {
                const schedule = window.scheduleAssignments[bunk] || [];
                let lastActivity = null;

                for (const entry of schedule) {
                    if (entry && entry._activity && entry._activity !== lastActivity) {
                        const activityName = entry._activity;
                        lastActivity = activityName;

                        historyToSave.bunks[bunk] = historyToSave.bunks[bunk] || {};
                        historyToSave.bunks[bunk][activityName] = timestamp;

                        if (entry._h2h && entry._activity !== "League" && entry._activity !== "No Game") {
                            const leagueEntry = Object.entries(masterLeagues).find(([name, l]) =>
                                l.enabled && l.divisions.includes(divName)
                            );
                            if (leagueEntry) {
                                const lgName = leagueEntry[0];
                                historyToSave.leagues[lgName] = historyToSave.leagues[lgName] || {};
                                historyToSave.leagues[lgName][entry._activity] = timestamp;
                            }
                        }
                    } else if (entry && !entry.continuation) {
                        lastActivity = null;
                    }
                }
            });
        });

        window.saveRotationHistory?.(historyToSave);
        console.log("Smart Scheduler: Rotation history updated.");
    } catch (e) {
        console.error("Smart Scheduler: Failed to update rotation history.", e);
    }

    // =================================================================
    // PASS 6 — Persist unifiedTimes + update UI
    // =================================================================
    window.saveCurrentDailyData?.("unifiedTimes", window.unifiedTimes);
    window.updateTable?.();
    window.saveSchedule?.();

    return true;
};

// =====================================================================
// HELPER FUNCTIONS USED BY PASSES
// =====================================================================
function findSlotsForRange(startMin, endMin) {
    const slots = [];
    if (!window.unifiedTimes || startMin == null || endMin == null) return slots;
    for (let i = 0; i < window.unifiedTimes.length; i++) {
        const slot = window.unifiedTimes[i];
        const slotStart = new Date(slot.start).getHours() * 60 +
                          new Date(slot.start).getMinutes();
        if (slotStart >= startMin && slotStart < endMin) {
            slots.push(i);
        }
    }
    return slots;
}

/**
 * --- MODIFIED: 'usage' object now includes 'bunks' ---
 */
function markFieldUsage(block, fieldName, fieldUsageBySlot) {
    if (!fieldName || fieldName === "No Field" || !window.allSchedulableNames.includes(fieldName)) {
        return;
    }
    for (const slotIndex of block.slots || []) {
        if (slotIndex === undefined) continue;
        fieldUsageBySlot[slotIndex] = fieldUsageBySlot[slotIndex] || {};
        const usage = fieldUsageBySlot[slotIndex][fieldName] || { count: 0, divisions: [], bunks: {} };
        usage.count++;
        if (!usage.divisions.includes(block.divName)) {
            usage.divisions.push(block.divName);
        }
        const blockActivity = block._activity || block.sport || (block.event === 'League Game' ? 'League' : block.event);
        if (block.bunk && blockActivity) {
            usage.bunks[block.bunk] = blockActivity;
        }
        fieldUsageBySlot[slotIndex][fieldName] = usage;
    }
}

function isTimeAvailable(slotIndex, fieldProps) {
    if (!window.unifiedTimes || !window.unifiedTimes[slotIndex]) return false;
    const slot = window.unifiedTimes[slotIndex];
    const slotStartMin = new Date(slot.start).getHours() * 60 + new Date(slot.start).getMinutes();
    const slotEndMin   = slotStartMin + INCREMENT_MINS;

    // fieldProps.timeRules from loadAndFilterData already have numeric mins,
    // but some callers may still use .start/.end, so we normalize here.
    const rules = (fieldProps.timeRules || []).map(r => {
        if (typeof r.startMin === "number" && typeof r.endMin === "number") return r;
        return {
            ...r,
            startMin: parseTimeToMinutes(r.start),
            endMin: parseTimeToMinutes(r.end)
        };
    });

    if (rules.length === 0) {
        return fieldProps.available;
    }
    if (!fieldProps.available) {
        return false;
    }

    const hasAvailableRules = rules.some(r => r.type === 'Available');
    let isAvailable = !hasAvailableRules;

    for (const rule of rules) {
        if (rule.type === 'Available') {
            if (rule.startMin == null || rule.endMin == null) continue;
            if (slotStartMin >= rule.startMin && slotEndMin <= rule.endMin) {
                isAvailable = true;
                break;
            }
        }
    }
    for (const rule of rules) {
        if (rule.type === 'Unavailable') {
            if (rule.startMin == null || rule.endMin == null) continue;
            if (slotStartMin < rule.endMin && slotEndMin > rule.startMin) {
                isAvailable = false;
                break;
            }
        }
    }
    return isAvailable;
}

// Compute the true start/end minutes for a block, even if slots are misaligned
function getBlockTimeRange(block) {
    let blockStartMin = (typeof block.startTime === "number") ? block.startTime : null;
    let blockEndMin   = (typeof block.endTime === "number") ? block.endTime   : null;

    if ((blockStartMin == null || blockEndMin == null) &&
        window.unifiedTimes &&
        Array.isArray(block.slots) &&
        block.slots.length > 0) {

        const minIndex = Math.min(...block.slots);
        const maxIndex = Math.max(...block.slots);

        const firstSlot = window.unifiedTimes[minIndex];
        const lastSlot  = window.unifiedTimes[maxIndex];

        if (firstSlot && lastSlot) {
            const firstStart = new Date(firstSlot.start);
            const lastStart  = new Date(lastSlot.start);

            blockStartMin = firstStart.getHours() * 60 + firstStart.getMinutes();
            blockEndMin   = lastStart.getHours() * 60 + lastStart.getMinutes() + INCREMENT_MINS;
        }
    }

    return { blockStartMin, blockEndMin };
}

/**
 * --- MODIFIED: Added 'proposedActivity' arg and sharing logic ---
 */
function canBlockFit(block, fieldName, activityProperties, fieldUsageBySlot, proposedActivity) {
    if (!fieldName) return false;
    const props = activityProperties[fieldName];
    if (!props) {
        console.warn(`No properties found for field: ${fieldName}`);
        return false;
    }
    const limit = (props && props.sharable) ? 2 : 1;

    // --- NEW: Preference Exclusivity Check ---
    if (props.preferences && props.preferences.enabled && props.preferences.exclusive) {
        if (!props.preferences.list.includes(block.divName)) {
            return false; 
        }
    }
    // ----------------------------------------

    // Division filter
    if (
        props &&
        Array.isArray(props.allowedDivisions) &&
        props.allowedDivisions.length > 0 &&
        !props.allowedDivisions.includes(block.divName)
    ) {
        return false;
    }

    const limitRules = props.limitUsage;
    if (limitRules && limitRules.enabled) {
        if (!limitRules.divisions[block.divName]) {
            return false;
        }
        const allowedBunks = limitRules.divisions[block.divName];
        if (allowedBunks.length > 0 && block.bunk && !allowedBunks.includes(block.bunk)) {
            return false;
        }
    }

    const { blockStartMin, blockEndMin } = getBlockTimeRange(block);
    const rules = (props.timeRules || []).map(r => {
        if (typeof r.startMin === "number" && typeof r.endMin === "number") return r;
        return {
            ...r,
            startMin: parseTimeToMinutes(r.start),
            endMin: parseTimeToMinutes(r.end)
        };
    });

    if (rules.length > 0) {
        if (!props.available) return false;

        const hasAvailableRules = rules.some(r => r.type === 'Available');

        if (blockStartMin != null && blockEndMin != null) {
            if (hasAvailableRules) {
                let insideAvailable = false;
                for (const rule of rules) {
                    if (rule.type !== 'Available' || rule.startMin == null || rule.endMin == null) continue;
                    if (blockStartMin >= rule.startMin && blockEndMin <= rule.endMin) {
                        insideAvailable = true;
                        break;
                    }
                }
                if (!insideAvailable) {
                    return false;
                }
            }

            for (const rule of rules) {
                if (rule.type !== 'Unavailable' || rule.startMin == null || rule.endMin == null) continue;
                if (
                    blockStartMin < rule.endMin &&
                    blockEndMin   > rule.startMin
                ) {
                    return false;
                }
            }
        }

        for (const slotIndex of block.slots || []) {
            if (slotIndex === undefined) return false;
            const usage = fieldUsageBySlot[slotIndex]?.[fieldName] || { count: 0, divisions: [], bunks: {} };
            if (usage.count >= limit) return false;

            // Sharing rules
            if (usage.count > 0) {
                if (!usage.divisions.includes(block.divName)) {
                    return false; // Can't share across divisions
                }
                let existingActivity = null;
                for (const bunkName in usage.bunks) {
                    if (usage.bunks[bunkName]) {
                        existingActivity = usage.bunks[bunkName];
                        break;
                    }
                }
                if (existingActivity && proposedActivity && existingActivity !== proposedActivity) {
                    return false; // Mismatched activity
                }
            }

            if (!isTimeAvailable(slotIndex, props)) return false;
        }
    } else {
        if (!props.available) return false;
        for (const slotIndex of block.slots || []) {
            if (slotIndex === undefined) return false;
            const usage = fieldUsageBySlot[slotIndex]?.[fieldName] || { count: 0, divisions: [], bunks: {} };
            if (usage.count >= limit) return false;

            if (usage.count > 0) {
                if (!usage.divisions.includes(block.divName)) {
                    return false;
                }
                let existingActivity = null;
                for (const bunkName in usage.bunks) {
                    if (usage.bunks[bunkName]) {
                        existingActivity = usage.bunks[bunkName];
                        break;
                    }
                }
                if (existingActivity && proposedActivity && existingActivity !== proposedActivity) {
                    return false;
                }
            }
        }
    }

    return true;
}

function canLeagueGameFit(block, fieldName, fieldUsageBySlot, activityProperties) {
    if (!fieldName) return false;
    const props = activityProperties[fieldName];
    if (!props) {
        console.warn(`No properties found for field: ${fieldName}`);
        return false;
    }
    const limit = 1; // leagues never sharable

    // --- NEW: Preference Exclusivity Check ---
    if (props.preferences && props.preferences.enabled && props.preferences.exclusive) {
        if (!props.preferences.list.includes(block.divName)) {
            return false; 
        }
    }
    // ----------------------------------------

    if (
        props &&
        Array.isArray(props.allowedDivisions) &&
        props.allowedDivisions.length > 0 &&
        !props.allowedDivisions.includes(block.divName)
    ) {
        return false;
    }

    const limitRules = props.limitUsage;
    if (limitRules && limitRules.enabled) {
        if (!limitRules.divisions[block.divName]) {
            return false;
        }
    }

    const { blockStartMin, blockEndMin } = getBlockTimeRange(block);
    const rules = (props.timeRules || []).map(r => {
        if (typeof r.startMin === "number" && typeof r.endMin === "number") return r;
        return {
            ...r,
            startMin: parseTimeToMinutes(r.start),
            endMin: parseTimeToMinutes(r.end)
        };
    });

    if (rules.length > 0) {
        if (!props.available) return false;

        const hasAvailableRules = rules.some(r => r.type === 'Available');

        if (blockStartMin != null && blockEndMin != null) {
            if (hasAvailableRules) {
                let insideAvailable = false;
                for (const rule of rules) {
                    if (rule.type !== 'Available' || rule.startMin == null || rule.endMin == null) continue;
                    if (blockStartMin >= rule.startMin && blockEndMin <= rule.endMin) {
                        insideAvailable = true;
                        break;
                    }
                }
                if (!insideAvailable) {
                    return false;
                }
            }

            for (const rule of rules) {
                if (rule.type !== 'Unavailable' || rule.startMin == null || rule.endMin == null) continue;
                if (
                    blockStartMin < rule.endMin &&
                    blockEndMin   > rule.startMin
                ) {
                    return false;
                }
            }
        }

        for (const slotIndex of block.slots || []) {
            if (slotIndex === undefined) return false;
            const usage = fieldUsageBySlot[slotIndex]?.[fieldName] || { count: 0, divisions: [] };
            if (usage.count >= limit) return false;
            if (!isTimeAvailable(slotIndex, props)) return false;
        }
    } else {
        if (!props.available) return false;
        for (const slotIndex of block.slots || []) {
            if (slotIndex === undefined) return false;
            const usage = fieldUsageBySlot[slotIndex]?.[fieldName] || { count: 0, divisions: [] };
            if (usage.count >= limit) return false;
        }
    }

    return true;
}

// Validate a chosen pick against block + field rules
function isPickValidForBlock(block, pick, activityProperties, fieldUsageBySlot) {
    if (!pick) return false;

    const fname = fieldLabel(pick.field);

    // If no real field name, or it's a pin/custom name
    if (!fname) return true;
    if (!window.allSchedulableNames || !window.allSchedulableNames.includes(fname)) {
        return true;
    }

    return canBlockFit(block, fname, activityProperties, fieldUsageBySlot, pick._activity);
}

/**
 * --- MODIFIED: 'usage' object now includes 'bunks' ---
 */
function fillBlock(block, pick, fieldUsageBySlot, yesterdayHistory, isLeagueFill = false) {
    const fieldName = fieldLabel(pick.field);
    const sport     = pick.sport;

    (block.slots || []).forEach((slotIndex, idx) => {
        if (slotIndex === undefined || slotIndex >= (window.unifiedTimes || []).length) return;
        if (!window.scheduleAssignments[block.bunk]) return;
        if (!window.scheduleAssignments[block.bunk][slotIndex]) {
            window.scheduleAssignments[block.bunk][slotIndex] = {
                field: fieldName,
                sport: sport,
                continuation: (idx > 0),
                _fixed: !!pick._fixed,
                _h2h: pick._h2h || false,
                vs: pick.vs || null,
                _activity: pick._activity || null,
                _allMatchups: pick._allMatchups || null
            };

            if (!isLeagueFill && fieldName && window.allSchedulableNames.includes(fieldName)) {
                fieldUsageBySlot[slotIndex] = fieldUsageBySlot[slotIndex] || {};
                const usage = fieldUsageBySlot[slotIndex][fieldName] || { count: 0, divisions: [], bunks: {} };
                usage.count++;
                if (!usage.divisions.includes(block.divName)) {
                    usage.divisions.push(block.divName);
                }
                if (block.bunk && pick._activity) {
                    usage.bunks[block.bunk] = pick._activity;
                }
                fieldUsageBySlot[slotIndex][fieldName] = usage;
            }
        }
    });
}

// =====================================================================
// DATA LOADER / FILTER
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
    const rotationHistory = {
        bunks: rotationHistoryRaw.bunks || {},
        leagues: rotationHistoryRaw.leagues || {},
        leagueTeamSports: rotationHistoryRaw.leagueTeamSports || {}
        // leagueTeamLastSport is added lazily in league pass
    };

    const overrides = {
        bunks: dailyOverrides.bunks || [],
        leagues: disabledLeagues
    };

    const availableDivisions = masterAvailableDivs.filter(
        divName => !overrides.bunks.includes(divName)
    );

    const divisions = {};
    for (const divName of availableDivisions) {
        if (!masterDivisions[divName]) continue;
        divisions[divName] = JSON.parse(JSON.stringify(masterDivisions[divName]));
        divisions[divName].bunks = (divisions[divName].bunks || []).filter(
            bunkName => !overrides.bunks.includes(bunkName)
        );
    }

    function parseTimeRule(rule) {
        if (!rule || !rule.type) return null;

        if (typeof rule.startMin === "number" && typeof rule.endMin === "number") {
            return {
                type: rule.type,
                startMin: rule.startMin,
                endMin: rule.endMin
            };
        }

        const startMin = parseTimeToMinutes(rule.start);
        const endMin   = parseTimeToMinutes(rule.end);
        if (startMin == null || endMin == null) return null;

        return {
            type: rule.type,
            startMin,
            endMin,
            start: rule.start,
            end: rule.end
        };
    }

    const activityProperties = {};
    const allMasterActivities = [
        ...masterFields.filter(f => !disabledFields.includes(f.name)),
        ...masterSpecials.filter(s => !disabledSpecials.includes(s.name))
    ];

    const availableActivityNames = [];
    allMasterActivities.forEach(f => {
        let finalRules;
        const dailyRules = dailyFieldAvailability[f.name];
        if (dailyRules && dailyRules.length > 0) {
            finalRules = dailyRules.map(parseTimeRule).filter(Boolean);
        } else {
            finalRules = (f.timeRules || []).map(parseTimeRule).filter(Boolean);
        }

        const isMasterAvailable = f.available !== false;

        const hasCustomDivList =
            Array.isArray(f.sharableWith?.divisions) &&
            f.sharableWith.divisions.length > 0;

        activityProperties[f.name] = {
            available: isMasterAvailable,
            sharable:
                f.sharableWith?.type === 'all' ||
                f.sharableWith?.type === 'custom',
            allowedDivisions: hasCustomDivList
                ? f.sharableWith.divisions.slice()
                : null,
            limitUsage: f.limitUsage || { enabled: false, divisions: {} },
            preferences: f.preferences || { enabled: false, exclusive: false, list: [] }, // --- NEW: Load Preferences
            timeRules: finalRules
        };

        if (isMasterAvailable) {
            availableActivityNames.push(f.name);
        }
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
        ...availFields
            .flatMap(f =>
                (f.activities || []).map(act => ({
                    type: "field",
                    field: f.name,
                    sport: act
                }))
            )
            .filter(a => !a.field || !a.sport || !dailyDisabledSportsByField[a.field]?.includes(a.sport)),
        ...availSpecials.map(sa => ({ type: "special", field: sa.name, sport: null }))
    ];

    const h2hActivities = allActivities.filter(a => a.type === "field" && a.sport);

    const yesterdayData = window.loadPreviousDailyData?.() || {};
    const yesterdayHistory = {
        schedule: yesterdayData.scheduleAssignments || {},
        leagues: yesterdayData.leagueAssignments || {}
    };

    return {
        divisions,
        availableDivisions,
        activityProperties,
        allActivities,
        h2hActivities,
        fieldsBySport,
        masterLeagues,
        masterSpecialtyLeagues,
        yesterdayHistory,
        rotationHistory,
        disabledLeagues,
        disabledSpecialtyLeagues
    };
}

// END IIFE
})();// ============================================================================
// scheduler_logic_core.js
//
// UPDATED (Smart League Field Fallback):
// - If the optimized sport has no fields available, the system now
//   iterates through ALL other allowed sports for that league to find
//   an open field before defaulting to "(No Field)".
// - canBlockFit: Checks Field Preferences (Exclusive Mode).
// - canLeagueGameFit: Checks Field Preferences (Exclusive Mode).
// - loadAndFilterData: Loads 'preferences' from field data.
// ============================================================================

(function() {
'use strict';

// ===== CONFIG =====
const INCREMENT_MINS = 30;
window.INCREMENT_MINS = INCREMENT_MINS;

// Events that REQUIRE scheduling/generation
const GENERATED_EVENTS = [
    'General Activity Slot',
    'Sports Slot',
    'Special Activity',
    'Swim',
    'League Game',
    'Specialty League'
];

// ===== BASIC HELPERS =====
function parseTimeToMinutes(str) {
    if (str == null) return null;
    if (typeof str === "number") return str;

    if (typeof str !== "string") return null;
    let s = str.trim().toLowerCase();
    let mer = null;
    if (s.endsWith("am") || s.endsWith("pm")) {
        mer = s.endsWith("am") ? "am" : "pm";
        s = s.replace(/am|pm/g, "").trim();
    } else {
        // require am/pm to avoid ambiguity
        return null;
    }
    const m = s.match(/^(\d{1,2})\s*:\s*(\d{2})$/);
    if (!m) return null;
    let hh = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    if (Number.isNaN(hh) || Number.isNaN(mm) || mm < 0 || mm > 59) return null;
    if (mer) {
        if (hh === 12) hh = (mer === "am") ? 0 : 12;
        else if (mer === "pm") hh += 12;
    }
    return hh * 60 + mm;
}

function fieldLabel(f) {
    if (typeof f === "string") return f;
    if (f && typeof f === "object" && typeof f.name === "string") return f.name;
    return "";
}

function fmtTime(d) {
    if (!d) return "";
    if (typeof d === 'string') d = new Date(d);
    let h = d.getHours();
    let m = d.getMinutes().toString().padStart(2, "0");
    const ap = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    return `${h}:${m} ${ap}`;
}

// ======================================================
// LEAGUE ROUND STATE (IN-CORE ROUND-ROBIN ENGINE)
// ======================================================

// Global-ish state for this file (per day), but saved to daily data
let coreLeagueRoundState = (window.coreLeagueRoundState || {});

// Load round state from today's daily data (if present)
(function initCoreLeagueRoundState() {
    try {
        const daily = window.loadCurrentDailyData?.() || {};
        if (daily && daily.coreLeagueRoundState && typeof daily.coreLeagueRoundState === "object") {
            coreLeagueRoundState = daily.coreLeagueRoundState;
        }
    } catch (e) {
        console.error("Failed to load core league round state:", e);
        coreLeagueRoundState = {};
    }
    window.coreLeagueRoundState = coreLeagueRoundState;
})();

// Save round state back into today's daily data
function saveCoreLeagueRoundState() {
    try {
        window.saveCurrentDailyData?.("coreLeagueRoundState", coreLeagueRoundState);
    } catch (e) {
        console.error("Failed to save core league round state:", e);
    }
}

// Full round-robin (ALL rounds) using circle method + BYE
function coreFullRoundRobin(teamList) {
    if (!teamList || teamList.length < 2) return [];

    const teams = teamList.map(String);
    const t = [...teams];

    if (t.length % 2 !== 0) {
        t.push("BYE");
    }

    const n = t.length;
    const fixed = t[0];
    let rotating = t.slice(1);
    const rounds = [];

    for (let r = 0; r < n - 1; r++) {
        const pairings = [];

        // fixed team matches first rotating slot
        pairings.push([fixed, rotating[0]]);

        // pair remaining
        for (let i = 1; i < n / 2; i++) {
            const a = rotating[i];
            const b = rotating[rotating.length - i];
            pairings.push([a, b]);
        }

        // remove BYE pairs
        const clean = pairings.filter(([a, b]) => a !== "BYE" && b !== "BYE");
        rounds.push(clean);

        // rotate
        rotating.unshift(rotating.pop());
    }

    return rounds;
}

/**
 * Get the NEXT round of matchups for a league, guaranteed to advance.
 * - Each call moves to the next round.
 * - After the last round, wraps back to round 1.
 * - If teams set changes, round index resets.
 */
function coreGetNextLeagueRound(leagueName, teams) {
    const key = String(leagueName || "");
    if (!key || !teams || teams.length < 2) return [];

    const teamKey = teams.map(String).sort().join("|"); // identity of the team set
    const rounds = coreFullRoundRobin(teams);
    if (rounds.length === 0) return [];

    let state = coreLeagueRoundState[key] || { idx: 0, teamKey };

    // If team set changed, reset the round index
    if (state.teamKey !== teamKey) {
        state = { idx: 0, teamKey };
    }

    const idx = state.idx % rounds.length;
    const matchups = rounds[idx];

    // advance pointer
    state.idx = (idx + 1) % rounds.length;
    coreLeagueRoundState[key] = state;

    saveCoreLeagueRoundState();

    return matchups;
}

// ====== LEAGUE "QUANTUM-ISH" SPORT OPTIMIZER ======
function assignSportsMultiRound(
    matchups,
    availableLeagueSports,
    existingTeamCounts,
    leagueHistory,
    lastSportByTeamBase
) {
    const sports = availableLeagueSports.slice();
    const baseTeamCounts = existingTeamCounts || {};
    const baseLastSports = lastSportByTeamBase || {};

    // collect all teams
    const allTeams = new Set();
    matchups.forEach(([a, b]) => {
        if (!a || !b) return;
        allTeams.add(String(a));
        allTeams.add(String(b));
    });

    // working per-team counts (mutated in DFS)
    const workCounts = {};
    allTeams.forEach(t => {
        workCounts[t] = {};
        const src = baseTeamCounts[t] || {};
        for (const key in src) {
            if (Object.prototype.hasOwnProperty.call(src, key)) {
                workCounts[t][key] = src[key];
            }
        }
    });

    // working "last sport" per team
    const workLastSport = {};
    allTeams.forEach(t => {
        workLastSport[t] = baseLastSports[t] || null;
    });

    // global totals per sport
    const sportTotals = {};
    sports.forEach(s => { sportTotals[s] = 0; });
    for (const team in workCounts) {
        if (!Object.prototype.hasOwnProperty.call(workCounts, team)) continue;
        const counts = workCounts[team];
        for (const s in counts) {
            if (Object.prototype.hasOwnProperty.call(counts, s)) {
                sportTotals[s] = (sportTotals[s] || 0) + counts[s];
            }
        }
    }

    let bestPlan = null;
    let bestScore = Infinity;
    let bestCounts = null;
    let bestLastSports = null;
    let nodesVisited = 0;
    const MAX_NODES = 30000; // safety

    function teamDistinctSports(team) {
        return Object.keys(workCounts[team] || {}).length;
    }

    function teamTotalGames(team) {
        const counts = workCounts[team] || {};
        let total = 0;
        for (const s in counts) {
            if (Object.prototype.hasOwnProperty.call(counts, s)) {
                total += counts[s];
            }
        }
        return total;
    }

    function teamImbalance(team) {
        if (sports.length === 0) return 0;
        const counts = workCounts[team] || {};
        let min = Infinity;
        let max = -Infinity;
        sports.forEach(s => {
            const v = counts[s] || 0;
            if (v < min) min = v;
            if (v > max) max = v;
        });
        return max - min;
    }

    function globalImbalance() {
        if (sports.length === 0) return 0;
        let min = Infinity;
        let max = -Infinity;
        sports.forEach(s => {
            const v = sportTotals[s] || 0;
            if (v < min) min = v;
            if (v > max) max = v;
        });
        return max - min;
    }

    function dfs(idx, plan, currentCost) {
        if (currentCost >= bestScore) return;
        if (nodesVisited > MAX_NODES) return;

        if (idx === matchups.length) {
            const totalCost = currentCost + globalImbalance() * 4;
            if (totalCost < bestScore) {
                bestScore = totalCost;
                bestPlan = plan.slice();
                bestCounts = JSON.parse(JSON.stringify(workCounts));
                bestLastSports = JSON.parse(JSON.stringify(workLastSport));
            }
            return;
        }

        nodesVisited++;

        const [rawA, rawB] = matchups[idx];
        const teamA = String(rawA);
        const teamB = String(rawB);

        const orderedSports = sports.slice().sort((s1, s2) => {
            const c1 = (workCounts[teamA][s1] || 0) + (workCounts[teamB][s1] || 0);
            const c2 = (workCounts[teamA][s2] || 0) + (workCounts[teamB][s2] || 0);
            if (c1 !== c2) return c1 - c2;

            const h1 = leagueHistory[s1] || 0;
            const h2 = leagueHistory[s2] || 0;
            return h1 - h2;
        });

        const beforeGlobalImb = globalImbalance();
        const beforeTeamImbA = teamImbalance(teamA);
        const beforeTeamImbB = teamImbalance(teamB);
        const beforeLastA = workLastSport[teamA] || null;
        const beforeLastB = workLastSport[teamB] || null;

        for (const sport of orderedSports) {
            const prevA = workCounts[teamA][sport] || 0;
            const prevB = workCounts[teamB][sport] || 0;

            let delta = 0;

            const distinctBeforeA = teamDistinctSports(teamA);
            const distinctBeforeB = teamDistinctSports(teamB);

            const totalGamesA = teamTotalGames(teamA);
            const totalGamesB = teamTotalGames(teamB);

            const idealCoverageA = Math.min(sports.length, Math.ceil(totalGamesA / Math.max(1, sports.length)));
            const idealCoverageB = Math.min(sports.length, Math.ceil(totalGamesB / Math.max(1, sports.length)));

            // Per-team repeat penalties (ever played this sport)
            if (prevA > 0) {
                delta += 5;
                if (distinctBeforeA < sports.length) delta += 15;
                if (distinctBeforeA < idealCoverageA) delta += 6;
            }
            if (prevB > 0) {
                delta += 5;
                if (distinctBeforeB < sports.length) delta += 15;
                if (distinctBeforeB < idealCoverageB) delta += 6;
            }

            // Consecutive-repeat penalty
            if (beforeLastA === sport) {
                delta += 40;
            }
            if (beforeLastB === sport) {
                delta += 40;
            }

            // Apply
            workCounts[teamA][sport] = prevA + 1;
            workCounts[teamB][sport] = prevB + 1;
            sportTotals[sport] = (sportTotals[sport] || 0) + 2;

            workLastSport[teamA] = sport;
            workLastSport[teamB] = sport;

            const afterGlobalImb = globalImbalance();
            if (afterGlobalImb > beforeGlobalImb) {
                delta += (afterGlobalImb - beforeGlobalImb) * 4;
            }

            const afterTeamImbA = teamImbalance(teamA);
            const afterTeamImbB = teamImbalance(teamB);
            if (afterTeamImbA > beforeTeamImbA) {
                delta += (afterTeamImbA - beforeTeamImbA) * 3;
            }
            if (afterTeamImbB > beforeTeamImbB) {
                delta += (afterTeamImbB - beforeTeamImbB) * 3;
            }

            const lastUsed = leagueHistory[sport] || 0;
            if (lastUsed > 0) {
                delta += (Date.now() - lastUsed) * 0.00000003;
            }

            const newCost = currentCost + delta;

            if (newCost < bestScore) {
                plan.push({ sport });
                dfs(idx + 1, plan, newCost);
                plan.pop();
            }

            // revert
            workCounts[teamA][sport] = prevA;
            workCounts[teamB][sport] = prevB;
            sportTotals[sport] = (sportTotals[sport] || 0) - 2;
            if (prevA === 0) delete workCounts[teamA][sport];
            if (prevB === 0) delete workCounts[teamB][sport];

            workLastSport[teamA] = beforeLastA;
            workLastSport[teamB] = beforeLastB;
        }
    }

    dfs(0, [], 0);

    if (!bestPlan) {
        const fallback = matchups.map((_, i) => ({
            sport: sports[i % sports.length]
        }));
        return {
            assignments: fallback,
            updatedTeamCounts: baseTeamCounts,
            updatedLastSports: baseLastSports
        };
    }

    return {
        assignments: bestPlan,
        updatedTeamCounts: bestCounts || baseTeamCounts,
        updatedLastSports: bestLastSports || baseLastSports
    };
}

// Simple round-robin for specialty fallback
function pairRoundRobin(teamList) {
    const arr = teamList.map(String);
    if (arr.length < 2) return [];
    if (arr.length % 2 === 1) arr.push("BYE");
    const n = arr.length;
    const half = n / 2;
    const pairs = [];
    for (let i = 0; i < half; i++) {
        const A = arr[i];
        const B = arr[n - 1 - i];
        if (A !== "BYE" && B !== "BYE") pairs.push([A, B]);
    }
    return pairs;
}

// =====================================================================
// MAIN ENTRY POINT
// =====================================================================
window.runSkeletonOptimizer = function(manualSkeleton) {
    window.scheduleAssignments = {};
    window.leagueAssignments = {};
    window.unifiedTimes = [];

    if (!manualSkeleton || manualSkeleton.length === 0) {
        return false;
    }

    const {
        divisions,
        availableDivisions,
        activityProperties,
        allActivities,
        h2hActivities,
        fieldsBySport,
        masterLeagues,
        masterSpecialtyLeagues,
        yesterdayHistory,
        rotationHistory,
        disabledLeagues,
        disabledSpecialtyLeagues
    } = loadAndFilterData();

    let fieldUsageBySlot = {};
    window.fieldUsageBySlot = fieldUsageBySlot;
    window.activityProperties = activityProperties;

    const timestamp = Date.now();

    // ===== PASS 1: Build unified time grid =====
    let earliestMin = null;
    let latestMin = null;

    Object.values(divisions).forEach(div => {
        const s = parseTimeToMinutes(div.startTime);
        const e = parseTimeToMinutes(div.endTime);
        if (s !== null && (earliestMin === null || s < earliestMin)) earliestMin = s;
        if (e !== null && (latestMin === null || e > latestMin)) latestMin = e;
    });

    if (earliestMin === null) earliestMin = 540; // 9:00am
    if (latestMin === null) latestMin = 960; // 4:00pm
    if (latestMin <= earliestMin) latestMin = earliestMin + 60;

    const baseDate = new Date(1970, 0, 1, 0, 0, 0);
    let currentMin = earliestMin;
    while (currentMin < latestMin) {
        const nextMin = currentMin + INCREMENT_MINS;
        const startDate = new Date(baseDate.getTime() + currentMin * 60000);
        const endDate   = new Date(baseDate.getTime() + nextMin   * 60000);
        window.unifiedTimes.push({
            start: startDate,
            end:   endDate,
            label: `${fmtTime(startDate)} - ${fmtTime(endDate)}`
        });
        currentMin = nextMin;
    }
    if (window.unifiedTimes.length === 0) {
        window.updateTable?.();
        return false;
    }

    // Create empty schedule arrays per bunk
    availableDivisions.forEach(divName => {
        (divisions[divName]?.bunks || []).forEach(bunk => {
            window.scheduleAssignments[bunk] = new Array(window.unifiedTimes.length);
        });
    });

    // =================================================================
    // PASS 1.5 — Bunk-Specific Pinned Overrides
    // =================================================================
    try {
        const dailyData = window.loadCurrentDailyData?.() || {};
        const bunkOverrides = dailyData.bunkActivityOverrides || [];

        bunkOverrides.forEach(override => {
            const startMin = parseTimeToMinutes(override.startTime);
            const endMin   = parseTimeToMinutes(override.endTime);
            const slots    = findSlotsForRange(startMin, endMin);
            const bunk     = override.bunk;

            if (window.scheduleAssignments[bunk] && slots.length > 0) {
                slots.forEach((slotIndex, idx) => {
                    if (!window.scheduleAssignments[bunk][slotIndex]) {
                        window.scheduleAssignments[bunk][slotIndex] = {
                            field: { name: override.activity },
                            sport: null,
                            continuation: (idx > 0),
                            _fixed: true,
                            _h2h: false,
                            vs: null,
                            _activity: override.activity,
                            _endTime: endMin 
                        };
                    }
                });
            }
        });
    } catch (e) {
        console.error("Error placing bunk-specific overrides:", e);
    }

    // =================================================================
    // NORMALIZATION HELPERS (GA / LEAGUE / SPECIALTY LEAGUE)
    // =================================================================

    /**
     * Normalize ANY spelling of General Activity → "General Activity Slot"
     */
    function normalizeGA(name) {
        if (!name) return null;
        const s = String(name).toLowerCase().replace(/\s+/g, '');

        const keys = [
            "generalactivity", "generalactivyt",
            "activity", "activyty", "activty", "activyt",
            "activityslot", "generalactivityslot",
            "genactivity", "genact", "ga"
        ];

        if (keys.some(k => s.includes(k))) {
            return "General Activity Slot";
        }
        return null;
    }

    /**
     * Normalize ANY spelling of League Game → "League Game"
     * (does NOT match plain "specialty league" text)
     */
    function normalizeLeague(name) {
        if (!name) return null;
        const s = String(name).toLowerCase().replace(/\s+/g, '');

        const keys = [
            "leaguegame",      // "League Game", "League Game 1"
            "leaguegameslot",  // "League Game Slot"
            "leagame",         // typos
            "lg",              // "LG 1", etc.
            "lgame"            // more typos
        ];

        if (keys.some(k => s.includes(k))) {
            return "League Game";
        }
        return null;
    }

    /**
     * Normalize ANY spelling of Specialty League → "Specialty League"
     */
    function normalizeSpecialtyLeague(name) {
        if (!name) return null;
        const s = String(name).toLowerCase().replace(/\s+/g, '');

        const keys = [
            "specialtyleague", "specialityleague",
            "specleague", "specialleague", "sleauge"
        ];

        if (keys.some(k => s.includes(k))) {
            return "Specialty League";
        }
        return null;
    }

    // =================================================================
    // PASS 2 — Pinned / Split / Slot Skeleton Blocks
    // =================================================================
    const schedulableSlotBlocks = [];

    manualSkeleton.forEach(item => {

        const allBunks = divisions[item.division]?.bunks || [];
        if (!allBunks || allBunks.length === 0) return;

        const startMin = parseTimeToMinutes(item.startTime);
        const endMin   = parseTimeToMinutes(item.endTime);

        const allSlots = findSlotsForRange(startMin, endMin);
        if (allSlots.length === 0) return;

        // Normalize everything
        const normGA       = normalizeGA(item.event);
        const normLeague   = normalizeLeague(item.event);
        const normSpecLg   = normalizeSpecialtyLeague(item.event);

        const finalEventName =
            normGA ||
            normSpecLg ||   // ✅ SPECIALTY FIRST
            normLeague ||
            item.event;

        const isGeneratedEvent =
            GENERATED_EVENTS.includes(finalEventName) ||
            normGA === "General Activity Slot" ||
            normLeague === "League Game" ||
            normSpecLg === "Specialty League";

        // -------------------------------------------------------------
        // 1. PURE PINNED — Lunch, Cleanup, Dismissal, Snacks, Custom
        // -------------------------------------------------------------
        if (item.type === 'pinned' || !isGeneratedEvent) {
            allBunks.forEach(bunk => {
                allSlots.forEach((slotIndex, idx) => {
                    if (!window.scheduleAssignments[bunk][slotIndex]) {
                        window.scheduleAssignments[bunk][slotIndex] = {
                            field: { name: item.event },
                            sport: null,
                            continuation: (idx > 0),
                            _fixed: true,
                            _h2h: false,
                            vs: null,
                            _activity: item.event,
                            _endTime: endMin 
                        };
                    }
                });
            });
        }

        // -------------------------------------------------------------
        // 2. SPLIT BLOCK — FULLY GENERATED GA + PINNED SWIM
        // -------------------------------------------------------------
        else if (item.type === 'split') {

            if (!item.subEvents || item.subEvents.length < 2) return;

            // Swim is ALWAYS pinned
            const swimLabel = "Swim";

            // Normalize GA half
            const rawGAEvent = item.subEvents[1].event;
            const gaLabel =
                normalizeGA(rawGAEvent) ||
                "General Activity Slot";

            // --- Split bunks ---
            const mid = Math.ceil(allBunks.length / 2);
            const bunksTop    = allBunks.slice(0, mid);
            const bunksBottom = allBunks.slice(mid);

            // --- Split time ---
            const slotMid = Math.ceil(allSlots.length / 2);
            const slotsFirst  = allSlots.slice(0, slotMid);
            const slotsSecond = allSlots.slice(slotMid);

            // ---- PIN SWIM ----
            function pinSwim(bunks, slots) {
                bunks.forEach(bunk => {
                    slots.forEach((slotIndex, idx) => {
                        window.scheduleAssignments[bunk][slotIndex] = {
                            field: { name: swimLabel },
                            sport: null,
                            continuation: (idx > 0),
                            _fixed: true,
                            _h2h: false,
                            vs: null,
                            _activity: swimLabel
                        };
                    });
                });
            }

            // ---- GA GENERATED ----
            function pushGA(bunks, slots) {
                bunks.forEach(bunk => {
                    schedulableSlotBlocks.push({
                        divName:   item.division,
                        bunk:      bunk,
                        event:     gaLabel,
                        startTime: startMin,
                        endTime:   endMin,
                        slots
                    });
                });
            }

            // FIRST HALF
            pinSwim(bunksTop, slotsFirst);
            pushGA(bunksBottom, slotsFirst);

            // SECOND HALF
            pushGA(bunksTop, slotsSecond);
            pinSwim(bunksBottom, slotsSecond);
        }

        // -------------------------------------------------------------
        // 3. NORMAL GENERATED SLOTS
        // -------------------------------------------------------------
        else if (item.type === 'slot' && isGeneratedEvent) {

            let normalizedEvent = null;

            // ✅ SPECIALTY FIRST, then Regular League, then GA
            if (normalizeSpecialtyLeague(item.event)) {
                normalizedEvent = "Specialty League";     // Specialty leagues
            } else if (normalizeLeague(item.event)) {
                normalizedEvent = "League Game";          // Regular leagues
            } else if (normalizeGA(item.event)) {
                normalizedEvent = "General Activity Slot";
            } else {
                normalizedEvent = item.event;
            }

            allBunks.forEach(bunk => {
                schedulableSlotBlocks.push({
                    divName:   item.division,
                    bunk:      bunk,
                    event:     normalizedEvent,
                    startTime: startMin,
                    endTime:   endMin,
                    slots:     allSlots
                });
            });
        }

    });  // END manualSkeleton.forEach

        // =================================================================
    // PASS 3 — SPECIALTY LEAGUES (HIGHEST FIELD PRIORITY)
    // =================================================================
    const leagueBlocks = schedulableSlotBlocks.filter(b => b.event === 'League Game');
    const specialtyLeagueBlocks = schedulableSlotBlocks.filter(b => b.event === 'Specialty League');
    const remainingBlocks = schedulableSlotBlocks.filter(
        b => b.event !== 'League Game' && b.event !== 'Specialty League'
    );

    // --- FIRST: SPECIALTY LEAGUES ---
    const specialtyLeagueGroups = {};
    specialtyLeagueBlocks.forEach(block => {
        const key = `${block.divName}-${block.startTime}`;
        if (!specialtyLeagueGroups[key]) {
            specialtyLeagueGroups[key] = {
                divName: block.divName,
                startTime: block.startTime,
                endTime: block.endTime, // --- NEW: Capture End Time
                slots: block.slots,
                bunks: new Set()
            };
        }
        specialtyLeagueGroups[key].bunks.add(block.bunk);
    });

    Object.values(specialtyLeagueGroups).forEach(group => {
        const leagueEntry = Object.values(masterSpecialtyLeagues).find(l =>
            l.enabled &&
            !disabledSpecialtyLeagues.includes(l.name) &&
            l.divisions.includes(group.divName)
        );
        if (!leagueEntry) return;

        const allBunksInGroup = Array.from(group.bunks);
        const blockBase = {
            slots: group.slots,
            divName: group.divName,
            startTime: group.startTime,
            endTime: group.endTime
        };

        const leagueName = leagueEntry.name;
        const leagueHistory = rotationHistory.leagues[leagueName] || {};
        rotationHistory.leagues[leagueName] = leagueHistory;

        const sport = leagueEntry.sport;
        if (!sport) return;

        // 🔒 HARD LOCK: specialty league = exactly this sport, no optimizer
        const bestSport = sport;

        const allMatchupLabels = [];
        const picksByTeam = {};

        if (bestSport) {
            const leagueFields = leagueEntry.fields || [];
            const leagueTeams = (leagueEntry.teams || []).map(t => String(t).trim()).filter(Boolean);
            if (leagueFields.length === 0 || leagueTeams.length < 2) return;

            let matchups = [];
            if (typeof window.getLeagueMatchups === 'function') {
                matchups = window.getLeagueMatchups(leagueEntry.name, leagueTeams) || [];
            } else {
                matchups = pairRoundRobin(leagueTeams);
            }

            const gamesPerField = Math.ceil(matchups.length / leagueFields.length);
            const slotCount = group.slots.length || 1;
            const usedFieldsInThisBlock = Array.from({ length: slotCount }, () => new Set());

            for (let i = 0; i < matchups.length; i++) {
                const [teamA, teamB] = matchups[i];
                if (teamA === "BYE" || teamB === "BYE") continue;

                const fieldIndex = Math.floor(i / gamesPerField);
                const fieldName = leagueFields[fieldIndex % leagueFields.length];

                const baseLabel = `${teamA} vs ${teamB} (${bestSport})`;

                let isFieldAvailable = true;
                const slotIndex = group.slots[i % slotCount];

                if (fieldUsageBySlot[slotIndex]?.[fieldName]?.count >= 1) {
                    isFieldAvailable = false;
                }
                if (usedFieldsInThisBlock[i % slotCount].has(fieldName)) {
                    isFieldAvailable = false;
                }

                const props = activityProperties[fieldName];
                if (props) {
                    if (!isTimeAvailable(slotIndex, props)) {
                        isFieldAvailable = false;
                    }
                    
                    // --- UPDATED: Exclusive Preference Check ---
                    if (props.preferences && props.preferences.enabled && props.preferences.exclusive) {
                        if (!props.preferences.list.includes(group.divName)) {
                             isFieldAvailable = false;
                        }
                    }
                    // -------------------------------------------

                    if (props.limitUsage && props.limitUsage.enabled) {
                        if (!props.limitUsage.divisions[group.divName]) {
                            isFieldAvailable = false;
                        }
                    }
                }

                let pick, fullLabel;
                if (fieldName && isFieldAvailable) {
                    fullLabel = `${baseLabel} @ ${fieldName}`;
                    pick = {
                        field: fieldName,
                        sport: baseLabel,
                        _h2h: true,
                        vs: null,
                        _activity: bestSport
                    };
                    markFieldUsage(
                        { ...blockBase, _activity: bestSport, bunk: 'league' },
                        fieldName,
                        fieldUsageBySlot
                    );
                    usedFieldsInThisBlock[i % slotCount].add(fieldName);
                } else {
                    fullLabel = `${baseLabel} (No Field)`;
                    pick = {
                        field: "No Field",
                        sport: baseLabel,
                        _h2h: true,
                        vs: null,
                        _activity: bestSport
                    };
                }

                allMatchupLabels.push(fullLabel);
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
            fillBlock(
                { ...blockBase, bunk },
                pickToAssign,
                fieldUsageBySlot,
                yesterdayHistory,
                true // isLeagueFill = true
            );
        });
    });

    // =================================================================
    // PASS 3.5 — REGULAR LEAGUES (SECOND PRIORITY)
    // =================================================================
    const leagueGroups = {};
    leagueBlocks.forEach(block => {
        const leagueEntry = Object.entries(masterLeagues).find(([name, l]) =>
            l.enabled &&
            !disabledLeagues.includes(name) &&
            l.divisions.includes(block.divName)
        );
        if (!leagueEntry) return;

        const leagueName = leagueEntry[0];
        const league     = leagueEntry[1];
        const key = `${leagueName}-${block.startTime}`;

        if (!leagueGroups[key]) {
            leagueGroups[key] = {
                leagueName,
                league,
                startTime: block.startTime,
                endTime: block.endTime, // --- NEW: Capture End Time
                slots: block.slots,
                bunks: new Set()
            };
        }
        leagueGroups[key].bunks.add(block.bunk);
    });

    const sortedLeagueGroups = Object.values(leagueGroups).sort((a, b) => a.startTime - b.startTime);

    sortedLeagueGroups.forEach(group => {
        const { leagueName, league, slots } = group;

        const leagueTeams = (league.teams || []).map(t => String(t).trim()).filter(Boolean);
        if (leagueTeams.length < 2) return;

        const allBunksInGroup = Array.from(group.bunks).sort();
        if (allBunksInGroup.length === 0) return;

        // determine a base division for field rules
        let baseDivName = null;
        {
            const firstBunk = allBunksInGroup[0];
            baseDivName = Object.keys(divisions).find(div =>
                (divisions[div].bunks || []).includes(firstBunk)
            );
        }
        if (!baseDivName) return;

        const blockBase = { slots, divName: baseDivName, endTime: group.endTime };

        const sports = (league.sports || []).filter(s => fieldsBySport[s]);
        if (sports.length === 0) return;

        const leagueHistory = rotationHistory.leagues[leagueName] || {};
        rotationHistory.leagues[leagueName] = leagueHistory;

        // Per-team totals by sport
        const leagueTeamCounts = rotationHistory.leagueTeamSports[leagueName] || {};
        rotationHistory.leagueTeamSports[leagueName] = leagueTeamCounts;

        // Per-team last sport
        rotationHistory.leagueTeamLastSport = rotationHistory.leagueTeamLastSport || {};
        const leagueTeamLastSport = rotationHistory.leagueTeamLastSport[leagueName] || {};
        rotationHistory.leagueTeamLastSport[leagueName] = leagueTeamLastSport;

        // Get round-robin matchups from league_scheduling.js if available,
        // otherwise fall back to our own engine
        let rawMatchups = [];
        if (typeof window.getLeagueMatchups === "function") {
            rawMatchups = window.getLeagueMatchups(leagueName, leagueTeams) || [];
        } else {
            rawMatchups = coreGetNextLeagueRound(leagueName, leagueTeams) || [];
        }

        const nonByeMatchups = rawMatchups.filter(p => p && p[0] !== "BYE" && p[1] !== "BYE");

        const {
            assignments,
            updatedTeamCounts,
            updatedLastSports
        } = assignSportsMultiRound(
            nonByeMatchups,
            sports,
            leagueTeamCounts,
            leagueHistory,
            leagueTeamLastSport
        );

        rotationHistory.leagueTeamSports[leagueName] = updatedTeamCounts;
        rotationHistory.leagueTeamLastSport[leagueName] = updatedLastSports;

        const allMatchupLabels = [];
        const usedForAssignments = [];

        const slotCount = slots.length || 1;
        const usedFieldsPerSlot = Array.from({ length: slotCount }, () => new Set());

        nonByeMatchups.forEach((pair, idx) => {
            const [teamA, teamB] = pair;
            
            // 1. Determine preference order: Optimizer pick -> Round Robin fallback -> All other sports
            const preferredSport = assignments[idx]?.sport || sports[idx % sports.length];
            
            // Set of all sports available to this league
            const candidateSports = [preferredSport];
            sports.forEach(s => {
                if (s !== preferredSport) candidateSports.push(s);
            });

            let finalSport = preferredSport;
            let finalField = null;
            let slotIdx = idx % slotCount;

            // 2. Try to find a field for the preferred sport, then fallbacks
            for (const s of candidateSports) {
                const possibleFields = fieldsBySport[s] || [];
                let found = null;

                // A. Try unused fields first
                for (const f of possibleFields) {
                    if (!usedFieldsPerSlot[slotIdx].has(f) &&
                        canLeagueGameFit(blockBase, f, fieldUsageBySlot, activityProperties)) {
                        found = f;
                        break;
                    }
                }

                // B. If no unused, try to squeeze in (if logic permits)
                if (!found && possibleFields.length > 0) {
                    const f = possibleFields[usedFieldsPerSlot[slotIdx].size % possibleFields.length];
                    if (canLeagueGameFit(blockBase, f, fieldUsageBySlot, activityProperties)) {
                        found = f;
                    }
                }

                if (found) {
                    finalSport = s;
                    finalField = found;
                    usedFieldsPerSlot[slotIdx].add(found);
                    break; // Success!
                }
            }

            // 3. Construct label
            let label;
            if (finalField) {
                label = `${teamA} vs ${teamB} (${finalSport}) @ ${finalField}`;
                markFieldUsage({ ...blockBase, _activity: finalSport, bunk: 'league' }, finalField, fieldUsageBySlot);
            } else {
                // If absolutely no fields for ANY sport, we must flag it
                label = `${teamA} vs ${teamB} (No Field)`;
            }

            // Update history for the sport we actually chose
            leagueHistory[finalSport] = Date.now();

            usedForAssignments.push({
                label,
                sport: finalSport,
                field: finalField || "No Field",
                teamA,
                teamB
            });

            allMatchupLabels.push(label);
        });

        rawMatchups.forEach(pair => {
            if (!pair) return;
            const [teamA, teamB] = pair;
            if (teamA === "BYE" || teamB === "BYE") {
                const label = `${teamA} vs ${teamB} (BYE)`;
                allMatchupLabels.push(label);
            }
        });

        const noGamePick = {
            field: "No Game",
            sport: null,
            _h2h: true,
            _activity: "League",
            _allMatchups: allMatchupLabels
        };

        let bunkPtr = 0;

        usedForAssignments.forEach(game => {
            if (bunkPtr + 1 >= allBunksInGroup.length) {
                return;
            }

            const bunkA = allBunksInGroup[bunkPtr];
            const bunkB = allBunksInGroup[bunkPtr + 1];
            bunkPtr += 2;

            const pick = {
                field: game.field,
                sport: game.label,
                _h2h: true,
                vs: null,
                _activity: game.sport,
                _allMatchups: allMatchupLabels
            };

            const bunkADiv = Object.keys(divisions).find(div =>
                (divisions[div].bunks || []).includes(bunkA)
            ) || baseDivName;
            const bunkBDiv = Object.keys(divisions).find(div =>
                (divisions[div].bunks || []).includes(bunkB)
            ) || baseDivName;

            fillBlock(
                { slots, bunk: bunkA, divName: bunkADiv, startTime: group.startTime, endTime: group.endTime + INCREMENT_MINS * slots.length },
                pick,
                fieldUsageBySlot,
                yesterdayHistory,
                true // isLeagueFill = true
            );
            fillBlock(
                { slots, bunk: bunkB, divName: bunkBDiv, startTime: group.startTime, endTime: group.endTime + INCREMENT_MINS * slots.length },
                pick,
                fieldUsageBySlot,
                yesterdayHistory,
                true // isLeagueFill = true
            );
        });

        while (bunkPtr < allBunksInGroup.length) {
            const leftoverBunk = allBunksInGroup[bunkPtr++];
            const bunkDivName = Object.keys(divisions).find(div =>
                (divisions[div].bunks || []).includes(leftoverBunk)
            ) || baseDivName;

            fillBlock(
                { slots, bunk: leftoverBunk, divName: bunkDivName, startTime: group.startTime, endTime: group.endTime + INCREMENT_MINS * slots.length },
                noGamePick,
                fieldUsageBySlot,
                yesterdayHistory,
                true // isLeagueFill = true
            );
        }
    });

    // =================================================================
    // PASS 4 — Remaining Schedulable Slots (Smart Activities, LOWEST)
    // =================================================================
    remainingBlocks.sort((a, b) => a.startTime - b.startTime);

    for (const block of remainingBlocks) {
        if (!block.slots || block.slots.length === 0) continue;
        if (!window.scheduleAssignments[block.bunk]) continue;
        if (window.scheduleAssignments[block.bunk][block.slots[0]]) continue; // already filled

        let pick = null;

        // If a league block falls through (e.g., no teams/fields assigned),
        // do NOT let it be filled by findBestGeneralActivity.
        if (block.event === 'League Game' || block.event === 'Specialty League') {
            pick = { field: "Unassigned League", sport: null, _activity: "Free" };
        }
        // 1) Specific buckets
        else if (block.event === 'Special Activity') {
            pick = window.findBestSpecial?.(
                block,
                allActivities,
                fieldUsageBySlot,
                yesterdayHistory,
                activityProperties,
                rotationHistory,
                divisions
            );
        } else if (block.event === 'Sports Slot') {
            pick = window.findBestSportActivity?.(
                block,
                allActivities,
                fieldUsageBySlot,
                yesterdayHistory,
                activityProperties,
                rotationHistory,
                divisions
            );
        } else if (block.event === 'Swim') {
            pick = { field: "Swim", sport: null, _activity: "Swim" };
        }

        // 2) Fallback to general
        if (!pick) {
            pick = window.findBestGeneralActivity?.(
                block,
                allActivities,
                h2hActivities,
                fieldUsageBySlot,
                yesterdayHistory,
                activityProperties,
                rotationHistory,
                divisions
            );
        }

        // 3) Validate the pick
        if (pick && !isPickValidForBlock(block, pick, activityProperties, fieldUsageBySlot)) {
            pick = null;
        }

        // 4) Final assignment
        if (pick) {
            fillBlock(block, pick, fieldUsageBySlot, yesterdayHistory, false);
        } else {
            // No valid fields/activities -> Free
            fillBlock(block, { field: "Free", sport: null, _activity: "Free" }, fieldUsageBySlot, false);
        }
    }

    // =================================================================
    // PASS 5 — Update Rotation History
    // =================================================================
    try {
        const historyToSave = rotationHistory;

        availableDivisions.forEach(divName => {
            (divisions[divName]?.bunks || []).forEach(bunk => {
                const schedule = window.scheduleAssignments[bunk] || [];
                let lastActivity = null;

                for (const entry of schedule) {
                    if (entry && entry._activity && entry._activity !== lastActivity) {
                        const activityName = entry._activity;
                        lastActivity = activityName;

                        historyToSave.bunks[bunk] = historyToSave.bunks[bunk] || {};
                        historyToSave.bunks[bunk][activityName] = timestamp;

                        if (entry._h2h && entry._activity !== "League" && entry._activity !== "No Game") {
                            const leagueEntry = Object.entries(masterLeagues).find(([name, l]) =>
                                l.enabled && l.divisions.includes(divName)
                            );
                            if (leagueEntry) {
                                const lgName = leagueEntry[0];
                                historyToSave.leagues[lgName] = historyToSave.leagues[lgName] || {};
                                historyToSave.leagues[lgName][entry._activity] = timestamp;
                            }
                        }
                    } else if (entry && !entry.continuation) {
                        lastActivity = null;
                    }
                }
            });
        });

        window.saveRotationHistory?.(historyToSave);
        console.log("Smart Scheduler: Rotation history updated.");
    } catch (e) {
        console.error("Smart Scheduler: Failed to update rotation history.", e);
    }

    // =================================================================
    // PASS 6 — Persist unifiedTimes + update UI
    // =================================================================
    window.saveCurrentDailyData?.("unifiedTimes", window.unifiedTimes);
    window.updateTable?.();
    window.saveSchedule?.();

    return true;
};

// =====================================================================
// HELPER FUNCTIONS USED BY PASSES
// =====================================================================
function findSlotsForRange(startMin, endMin) {
    const slots = [];
    if (!window.unifiedTimes || startMin == null || endMin == null) return slots;
    for (let i = 0; i < window.unifiedTimes.length; i++) {
        const slot = window.unifiedTimes[i];
        const slotStart = new Date(slot.start).getHours() * 60 +
                          new Date(slot.start).getMinutes();
        if (slotStart >= startMin && slotStart < endMin) {
            slots.push(i);
        }
    }
    return slots;
}

/**
 * --- MODIFIED: 'usage' object now includes 'bunks' ---
 */
function markFieldUsage(block, fieldName, fieldUsageBySlot) {
    if (!fieldName || fieldName === "No Field" || !window.allSchedulableNames.includes(fieldName)) {
        return;
    }
    for (const slotIndex of block.slots || []) {
        if (slotIndex === undefined) continue;
        fieldUsageBySlot[slotIndex] = fieldUsageBySlot[slotIndex] || {};
        const usage = fieldUsageBySlot[slotIndex][fieldName] || { count: 0, divisions: [], bunks: {} };
        usage.count++;
        if (!usage.divisions.includes(block.divName)) {
            usage.divisions.push(block.divName);
        }
        const blockActivity = block._activity || block.sport || (block.event === 'League Game' ? 'League' : block.event);
        if (block.bunk && blockActivity) {
            usage.bunks[block.bunk] = blockActivity;
        }
        fieldUsageBySlot[slotIndex][fieldName] = usage;
    }
}

function isTimeAvailable(slotIndex, fieldProps) {
    if (!window.unifiedTimes || !window.unifiedTimes[slotIndex]) return false;
    const slot = window.unifiedTimes[slotIndex];
    const slotStartMin = new Date(slot.start).getHours() * 60 + new Date(slot.start).getMinutes();
    const slotEndMin   = slotStartMin + INCREMENT_MINS;

    // fieldProps.timeRules from loadAndFilterData already have numeric mins,
    // but some callers may still use .start/.end, so we normalize here.
    const rules = (fieldProps.timeRules || []).map(r => {
        if (typeof r.startMin === "number" && typeof r.endMin === "number") return r;
        return {
            ...r,
            startMin: parseTimeToMinutes(r.start),
            endMin: parseTimeToMinutes(r.end)
        };
    });

    if (rules.length === 0) {
        return fieldProps.available;
    }
    if (!fieldProps.available) {
        return false;
    }

    const hasAvailableRules = rules.some(r => r.type === 'Available');
    let isAvailable = !hasAvailableRules;

    for (const rule of rules) {
        if (rule.type === 'Available') {
            if (rule.startMin == null || rule.endMin == null) continue;
            if (slotStartMin >= rule.startMin && slotEndMin <= rule.endMin) {
                isAvailable = true;
                break;
            }
        }
    }
    for (const rule of rules) {
        if (rule.type === 'Unavailable') {
            if (rule.startMin == null || rule.endMin == null) continue;
            if (slotStartMin < rule.endMin && slotEndMin > rule.startMin) {
                isAvailable = false;
                break;
            }
        }
    }
    return isAvailable;
}

// Compute the true start/end minutes for a block, even if slots are misaligned
function getBlockTimeRange(block) {
    let blockStartMin = (typeof block.startTime === "number") ? block.startTime : null;
    let blockEndMin   = (typeof block.endTime === "number") ? block.endTime   : null;

    if ((blockStartMin == null || blockEndMin == null) &&
        window.unifiedTimes &&
        Array.isArray(block.slots) &&
        block.slots.length > 0) {

        const minIndex = Math.min(...block.slots);
        const maxIndex = Math.max(...block.slots);

        const firstSlot = window.unifiedTimes[minIndex];
        const lastSlot  = window.unifiedTimes[maxIndex];

        if (firstSlot && lastSlot) {
            const firstStart = new Date(firstSlot.start);
            const lastStart  = new Date(lastSlot.start);

            blockStartMin = firstStart.getHours() * 60 + firstStart.getMinutes();
            blockEndMin   = lastStart.getHours() * 60 + lastStart.getMinutes() + INCREMENT_MINS;
        }
    }

    return { blockStartMin, blockEndMin };
}

/**
 * --- MODIFIED: Added 'proposedActivity' arg and sharing logic ---
 */
function canBlockFit(block, fieldName, activityProperties, fieldUsageBySlot, proposedActivity) {
    if (!fieldName) return false;
    const props = activityProperties[fieldName];
    if (!props) {
        console.warn(`No properties found for field: ${fieldName}`);
        return false;
    }
    const limit = (props && props.sharable) ? 2 : 1;

    // --- NEW: Preference Exclusivity Check ---
    if (props.preferences && props.preferences.enabled && props.preferences.exclusive) {
        if (!props.preferences.list.includes(block.divName)) {
            return false; 
        }
    }
    // ----------------------------------------

    // Division filter
    if (
        props &&
        Array.isArray(props.allowedDivisions) &&
        props.allowedDivisions.length > 0 &&
        !props.allowedDivisions.includes(block.divName)
    ) {
        return false;
    }

    const limitRules = props.limitUsage;
    if (limitRules && limitRules.enabled) {
        if (!limitRules.divisions[block.divName]) {
            return false;
        }
        const allowedBunks = limitRules.divisions[block.divName];
        if (allowedBunks.length > 0 && block.bunk && !allowedBunks.includes(block.bunk)) {
            return false;
        }
    }

    const { blockStartMin, blockEndMin } = getBlockTimeRange(block);
    const rules = (props.timeRules || []).map(r => {
        if (typeof r.startMin === "number" && typeof r.endMin === "number") return r;
        return {
            ...r,
            startMin: parseTimeToMinutes(r.start),
            endMin: parseTimeToMinutes(r.end)
        };
    });

    if (rules.length > 0) {
        if (!props.available) return false;

        const hasAvailableRules = rules.some(r => r.type === 'Available');

        if (blockStartMin != null && blockEndMin != null) {
            if (hasAvailableRules) {
                let insideAvailable = false;
                for (const rule of rules) {
                    if (rule.type !== 'Available' || rule.startMin == null || rule.endMin == null) continue;
                    if (blockStartMin >= rule.startMin && blockEndMin <= rule.endMin) {
                        insideAvailable = true;
                        break;
                    }
                }
                if (!insideAvailable) {
                    return false;
                }
            }

            for (const rule of rules) {
                if (rule.type !== 'Unavailable' || rule.startMin == null || rule.endMin == null) continue;
                if (
                    blockStartMin < rule.endMin &&
                    blockEndMin   > rule.startMin
                ) {
                    return false;
                }
            }
        }

        for (const slotIndex of block.slots || []) {
            if (slotIndex === undefined) return false;
            const usage = fieldUsageBySlot[slotIndex]?.[fieldName] || { count: 0, divisions: [], bunks: {} };
            if (usage.count >= limit) return false;

            // Sharing rules
            if (usage.count > 0) {
                if (!usage.divisions.includes(block.divName)) {
                    return false; // Can't share across divisions
                }
                let existingActivity = null;
                for (const bunkName in usage.bunks) {
                    if (usage.bunks[bunkName]) {
                        existingActivity = usage.bunks[bunkName];
                        break;
                    }
                }
                if (existingActivity && proposedActivity && existingActivity !== proposedActivity) {
                    return false; // Mismatched activity
                }
            }

            if (!isTimeAvailable(slotIndex, props)) return false;
        }
    } else {
        if (!props.available) return false;
        for (const slotIndex of block.slots || []) {
            if (slotIndex === undefined) return false;
            const usage = fieldUsageBySlot[slotIndex]?.[fieldName] || { count: 0, divisions: [], bunks: {} };
            if (usage.count >= limit) return false;

            if (usage.count > 0) {
                if (!usage.divisions.includes(block.divName)) {
                    return false;
                }
                let existingActivity = null;
                for (const bunkName in usage.bunks) {
                    if (usage.bunks[bunkName]) {
                        existingActivity = usage.bunks[bunkName];
                        break;
                    }
                }
                if (existingActivity && proposedActivity && existingActivity !== proposedActivity) {
                    return false;
                }
            }
        }
    }

    return true;
}

function canLeagueGameFit(block, fieldName, fieldUsageBySlot, activityProperties) {
    if (!fieldName) return false;
    const props = activityProperties[fieldName];
    if (!props) {
        console.warn(`No properties found for field: ${fieldName}`);
        return false;
    }
    const limit = 1; // leagues never sharable

    // --- NEW: Preference Exclusivity Check ---
    if (props.preferences && props.preferences.enabled && props.preferences.exclusive) {
        if (!props.preferences.list.includes(block.divName)) {
            return false; 
        }
    }
    // ----------------------------------------

    if (
        props &&
        Array.isArray(props.allowedDivisions) &&
        props.allowedDivisions.length > 0 &&
        !props.allowedDivisions.includes(block.divName)
    ) {
        return false;
    }

    const limitRules = props.limitUsage;
    if (limitRules && limitRules.enabled) {
        if (!limitRules.divisions[block.divName]) {
            return false;
        }
    }

    const { blockStartMin, blockEndMin } = getBlockTimeRange(block);
    const rules = (props.timeRules || []).map(r => {
        if (typeof r.startMin === "number" && typeof r.endMin === "number") return r;
        return {
            ...r,
            startMin: parseTimeToMinutes(r.start),
            endMin: parseTimeToMinutes(r.end)
        };
    });

    if (rules.length > 0) {
        if (!props.available) return false;

        const hasAvailableRules = rules.some(r => r.type === 'Available');

        if (blockStartMin != null && blockEndMin != null) {
            if (hasAvailableRules) {
                let insideAvailable = false;
                for (const rule of rules) {
                    if (rule.type !== 'Available' || rule.startMin == null || rule.endMin == null) continue;
                    if (blockStartMin >= rule.startMin && blockEndMin <= rule.endMin) {
                        insideAvailable = true;
                        break;
                    }
                }
                if (!insideAvailable) {
                    return false;
                }
            }

            for (const rule of rules) {
                if (rule.type !== 'Unavailable' || rule.startMin == null || rule.endMin == null) continue;
                if (
                    blockStartMin < rule.endMin &&
                    blockEndMin   > rule.startMin
                ) {
                    return false;
                }
            }
        }

        for (const slotIndex of block.slots || []) {
            if (slotIndex === undefined) return false;
            const usage = fieldUsageBySlot[slotIndex]?.[fieldName] || { count: 0, divisions: [] };
            if (usage.count >= limit) return false;
            if (!isTimeAvailable(slotIndex, props)) return false;
        }
    } else {
        if (!props.available) return false;
        for (const slotIndex of block.slots || []) {
            if (slotIndex === undefined) return false;
            const usage = fieldUsageBySlot[slotIndex]?.[fieldName] || { count: 0, divisions: [] };
            if (usage.count >= limit) return false;
        }
    }

    return true;
}

// Validate a chosen pick against block + field rules
function isPickValidForBlock(block, pick, activityProperties, fieldUsageBySlot) {
    if (!pick) return false;

    const fname = fieldLabel(pick.field);

    // If no real field name, or it's a pin/custom name
    if (!fname) return true;
    if (!window.allSchedulableNames || !window.allSchedulableNames.includes(fname)) {
        return true;
    }

    return canBlockFit(block, fname, activityProperties, fieldUsageBySlot, pick._activity);
}

/**
 * --- MODIFIED: 'usage' object now includes 'bunks' ---
 */
function fillBlock(block, pick, fieldUsageBySlot, yesterdayHistory, isLeagueFill = false) {
    const fieldName = fieldLabel(pick.field);
    const sport     = pick.sport;

    (block.slots || []).forEach((slotIndex, idx) => {
        if (slotIndex === undefined || slotIndex >= (window.unifiedTimes || []).length) return;
        if (!window.scheduleAssignments[block.bunk]) return;
        if (!window.scheduleAssignments[block.bunk][slotIndex]) {
            window.scheduleAssignments[block.bunk][slotIndex] = {
                field: fieldName,
                sport: sport,
                continuation: (idx > 0),
                _fixed: !!pick._fixed,
                _h2h: pick._h2h || false,
                vs: pick.vs || null,
                _activity: pick._activity || null,
                _allMatchups: pick._allMatchups || null
            };

            if (!isLeagueFill && fieldName && window.allSchedulableNames.includes(fieldName)) {
                fieldUsageBySlot[slotIndex] = fieldUsageBySlot[slotIndex] || {};
                const usage = fieldUsageBySlot[slotIndex][fieldName] || { count: 0, divisions: [], bunks: {} };
                usage.count++;
                if (!usage.divisions.includes(block.divName)) {
                    usage.divisions.push(block.divName);
                }
                if (block.bunk && pick._activity) {
                    usage.bunks[block.bunk] = pick._activity;
                }
                fieldUsageBySlot[slotIndex][fieldName] = usage;
            }
        }
    });
}

// =====================================================================
// DATA LOADER / FILTER
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
    const rotationHistory = {
        bunks: rotationHistoryRaw.bunks || {},
        leagues: rotationHistoryRaw.leagues || {},
        leagueTeamSports: rotationHistoryRaw.leagueTeamSports || {}
        // leagueTeamLastSport is added lazily in league pass
    };

    const overrides = {
        bunks: dailyOverrides.bunks || [],
        leagues: disabledLeagues
    };

    const availableDivisions = masterAvailableDivs.filter(
        divName => !overrides.bunks.includes(divName)
    );

    const divisions = {};
    for (const divName of availableDivisions) {
        if (!masterDivisions[divName]) continue;
        divisions[divName] = JSON.parse(JSON.stringify(masterDivisions[divName]));
        divisions[divName].bunks = (divisions[divName].bunks || []).filter(
            bunkName => !overrides.bunks.includes(bunkName)
        );
    }

    function parseTimeRule(rule) {
        if (!rule || !rule.type) return null;

        if (typeof rule.startMin === "number" && typeof rule.endMin === "number") {
            return {
                type: rule.type,
                startMin: rule.startMin,
                endMin: rule.endMin
            };
        }

        const startMin = parseTimeToMinutes(rule.start);
        const endMin   = parseTimeToMinutes(rule.end);
        if (startMin == null || endMin == null) return null;

        return {
            type: rule.type,
            startMin,
            endMin,
            start: rule.start,
            end: rule.end
        };
    }

    const activityProperties = {};
    const allMasterActivities = [
        ...masterFields.filter(f => !disabledFields.includes(f.name)),
        ...masterSpecials.filter(s => !disabledSpecials.includes(s.name))
    ];

    const availableActivityNames = [];
    allMasterActivities.forEach(f => {
        let finalRules;
        const dailyRules = dailyFieldAvailability[f.name];
        if (dailyRules && dailyRules.length > 0) {
            finalRules = dailyRules.map(parseTimeRule).filter(Boolean);
        } else {
            finalRules = (f.timeRules || []).map(parseTimeRule).filter(Boolean);
        }

        const isMasterAvailable = f.available !== false;

        const hasCustomDivList =
            Array.isArray(f.sharableWith?.divisions) &&
            f.sharableWith.divisions.length > 0;

        activityProperties[f.name] = {
            available: isMasterAvailable,
            sharable:
                f.sharableWith?.type === 'all' ||
                f.sharableWith?.type === 'custom',
            allowedDivisions: hasCustomDivList
                ? f.sharableWith.divisions.slice()
                : null,
            limitUsage: f.limitUsage || { enabled: false, divisions: {} },
            preferences: f.preferences || { enabled: false, exclusive: false, list: [] }, // --- NEW: Load Preferences
            timeRules: finalRules
        };

        if (isMasterAvailable) {
            availableActivityNames.push(f.name);
        }
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
        ...availFields
            .flatMap(f =>
                (f.activities || []).map(act => ({
                    type: "field",
                    field: f.name,
                    sport: act
                }))
            )
            .filter(a => !a.field || !a.sport || !dailyDisabledSportsByField[a.field]?.includes(a.sport)),
        ...availSpecials.map(sa => ({ type: "special", field: sa.name, sport: null }))
    ];

    const h2hActivities = allActivities.filter(a => a.type === "field" && a.sport);

    const yesterdayData = window.loadPreviousDailyData?.() || {};
    const yesterdayHistory = {
        schedule: yesterdayData.scheduleAssignments || {},
        leagues: yesterdayData.leagueAssignments || {}
    };

    return {
        divisions,
        availableDivisions,
        activityProperties,
        allActivities,
        h2hActivities,
        fieldsBySport,
        masterLeagues,
        masterSpecialtyLeagues,
        yesterdayHistory,
        rotationHistory,
        disabledLeagues,
        disabledSpecialtyLeagues
    };
}

// END IIFE
})(); 
