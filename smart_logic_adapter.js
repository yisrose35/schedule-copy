// ============================================================================
// SmartLogicAdapter V32 (PERFECT ROTATION + BULLET-PROOF YESTERDAY LOGIC)
// ---------------------------------------------------------------------------
// NEW IN V32:
//   • Safe didPlayYesterday() — cannot crash
//   • Per-division rotation history
//   • Persistent history stored under smartTileSpecialHistory_v1
//   • Rotation is FIRST priority
//   • Only specialAct increments rotation
//   • Fully deterministic sorting
//   • Works with ANY grade size (3–25 bunks)
// ============================================================================

(function () {
    "use strict";

    // ==============================================================
    // ROTATION STORAGE
    // ==============================================================
    const ROTATION_KEY = "smartTileSpecialHistory_v1";

    function loadRotation() {
        try {
            const raw = localStorage.getItem(ROTATION_KEY);
            return raw ? JSON.parse(raw) : {};
        } catch {
            return {};
        }
    }

    function saveRotation(hist) {
        try {
            localStorage.setItem(ROTATION_KEY, JSON.stringify(hist));
        } catch {}
    }

    function addSpecialPoint(hist, division, bunk, act) {
        if (!hist[division]) hist[division] = {};
        if (!hist[division][bunk]) hist[division][bunk] = {};
        if (!hist[division][bunk][act]) hist[division][bunk][act] = 0;

        hist[division][bunk][act] += 1;
    }

    function getSpecialPoints(hist, division, bunk, act) {
        if (!hist[division]) return 0;
        if (!hist[division][bunk]) return 0;
        return hist[division][bunk][act] || 0;
    }

    // ==============================================================
    // HELPERS
    // ==============================================================

    function parse(str) {
        if (!str) return 0;
        let s = str.trim().toLowerCase();
        let am = s.endsWith("am");
        let pm = s.endsWith("pm");
        s = s.replace(/am|pm/g, "").trim();
        const [h, m] = s.split(":").map(Number);
        let hh = h;
        if (pm && h !== 12) hh += 12;
        if (am && h === 12) hh = 0;
        return hh * 60 + (m || 0);
    }

    function isSameActivity(a, b) {
        return a && b && a.trim().toLowerCase() === b.trim().toLowerCase();
    }

    function isTimeAvailable(startMin, endMin, baseAvail, rules = []) {
        if (!rules || rules.length === 0) return baseAvail !== false;

        const parsed = rules.map(r => ({
            type: r.type,
            s: parse(r.start),
            e: parse(r.end)
        }));

        let available = !parsed.some(r => r.type === 'Available');

        for (const r of parsed) {
            if (r.type === 'Available') {
                if (startMin >= r.s && endMin <= r.e) available = true;
            }
        }
        for (const r of parsed) {
            if (r.type === 'Unavailable') {
                if (startMin < r.e && endMin > r.s) available = false;
            }
        }
        return available;
    }

    // BULLET-PROOF YESTERDAY CHECK (NEVER CRASHES)
    function safeDidPlayYesterday(bunk, yesterdayHistory, specialNames) {
        const sched = yesterdayHistory?.schedule?.[bunk];
        if (!Array.isArray(sched)) return 0;

        return sched.some(entry => {
            if (!entry || typeof entry !== "object") return false;
            const raw = entry._activity;
            if (!raw || typeof raw !== "string") return false;
            const act = raw.toLowerCase();

            return (
                act.includes("special") ||
                act.includes("sport") ||
                act.includes("general activity") ||
                specialNames.includes(raw)
            );
        }) ? 1 : 0;
    }

    // ==============================================================
    // PUBLIC EXPORT
    // ==============================================================
    window.SmartLogicAdapter = {

        // Required by your core scheduler
        needsGeneration(act) {
            if (!act) return false;
            const a = act.toLowerCase();
            return (
                a.includes("sport") ||
                a.includes("general activity") ||
                a.includes("special")
            );
        },

        preprocessSmartTiles(rawSkeleton, dailyAdj, specials) {
            const jobs = {};
            const byDiv = {};

            rawSkeleton.forEach(t => {
                if (t.type === "smart") {
                    if (!byDiv[t.division]) byDiv[t.division] = [];
                    byDiv[t.division].push(t);
                }
            });

            Object.keys(byDiv).forEach(div => {
                jobs[div] = [];
                const tiles = byDiv[div].sort((a, b) => parse(a.startTime) - parse(b.startTime));

                for (let i = 0; i < tiles.length; i += 2) {
                    const tileA = tiles[i];
                    const tileB = tiles[i + 1];
                    const sd = tileA.smartData || {};

                    jobs[div].push({
                        division: div,
                        main1: sd.main1,
                        main2: sd.main2,
                        fallbackFor: sd.fallbackFor,
                        fallbackActivity: sd.fallbackActivity,
                        blockA: { startMin: parse(tileA.startTime), endMin: parse(tileA.endTime) },
                        blockB: tileB ? {
                            startMin: parse(tileB.startTime),
                            endMin: parse(tileB.endTime)
                        } : null
                    });
                }
            });

            return Object.values(jobs).flat();
        },

        // ==============================================================
        // MAIN LOGIC — V32
        // ==============================================================
        generateAssignments(bunks, job, historical = {}, specialNames = [], activityProperties = {}, masterFields = [], dailyFieldAvailability = {}, yesterdayHistory = {}) {

            const division = job.division;
            let specialAct = job.main1.trim();
            let openAct = job.main2.trim();
            const fallbackFor = job.fallbackFor?.trim();
            const fbAct = job.fallbackActivity || "Sports";

            // Determine which activity is the "special" (limited)
            if (isSameActivity(fallbackFor, job.main2)) {
                specialAct = job.main2;
                openAct = job.main1;
            }

            // ==============================================================
            // LOAD ROTATION HISTORY (per division)
            // ==============================================================
            const rotHist = loadRotation();

            // ==============================================================
            // CAPACITY
            // ==============================================================
            function calcCapacity(startMin, endMin) {
                let total = 0;
                const lower = specialAct.toLowerCase();

                const getCap = (r) => {
                    if (r.sharableWith?.capacity) return parseInt(r.sharableWith.capacity) || 1;
                    if (r.sharableWith?.type === "not_sharable") return 1;
                    if (r.sharableWith?.type === "all") return 2;
                    if (r.sharable) return 2;
                    return 1;
                };

                if (lower.includes("sport")) {
                    masterFields.forEach(f => {
                        const rules = dailyFieldAvailability[f.name] || f.timeRules;
                        if (isTimeAvailable(startMin, endMin, f.available, rules)) {
                            total += getCap(f);
                        }
                    });
                } else {
                    const allSpecials = window.getGlobalSpecialActivities?.() || [];
                    allSpecials.forEach(s => {
                        const rules = dailyFieldAvailability[s.name] || s.timeRules;
                        if (isTimeAvailable(startMin, endMin, s.available, rules)) {
                            total += getCap(s);
                        }
                    });
                }

                return total;
            }

            // ==============================================================
            // SORTING — V32 PRIORITIES
            // ==============================================================
            const sorted = [...bunks].sort((a, b) => {

                // (1) Rotation count FIRST
                const rA = getSpecialPoints(rotHist, division, a, specialAct);
                const rB = getSpecialPoints(rotHist, division, b, specialAct);
                if (rA !== rB) return rA - rB;

                // (2) Yesterday penalty
                const yA = safeDidPlayYesterday(a, yesterdayHistory, specialNames);
                const yB = safeDidPlayYesterday(b, yesterdayHistory, specialNames);
                if (yA !== yB) return yA - yB;

                // (3) Total category fairness
                const totA = historical[a]?.total || 0;
                const totB = historical[b]?.total || 0;
                if (totA !== totB) return totA - totB;

                // (4) randomized tie breaker
                return 0.5 - Math.random();
            });

            // ==============================================================
            // BLOCK ASSIGNMENTS
            // ==============================================================

            const block1 = {};
            const block2 = {};
            const gotSpecialA = new Set();

            // ----- BLOCK A
            const capA = calcCapacity(job.blockA.startMin, job.blockA.endMin);

            let countA = 0;
            for (const bunk of sorted) {
                if (countA < capA) {
                    block1[bunk] = specialAct;

                    // ⭐ Increment rotation
                    addSpecialPoint(rotHist, division, bunk, specialAct);

                    gotSpecialA.add(bunk);
                    countA++;
                } else {
                    block1[bunk] = openAct;
                }
            }

            // ----- BLOCK B (if exists)
            if (job.blockB) {
                const capB = calcCapacity(job.blockB.startMin, job.blockB.endMin);
                let countB = 0;

                const mustOpen = [];
                const candidates = [];

                sorted.forEach(b => {
                    if (gotSpecialA.has(b)) mustOpen.push(b);
                    else candidates.push(b);
                });

                mustOpen.forEach(b => block2[b] = openAct);

                candidates.forEach(b => {
                    if (countB < capB) {
                        block2[b] = specialAct;

                        // ⭐ increment rotation
                        addSpecialPoint(rotHist, division, b, specialAct);

                        countB++;
                    } else {
                        block2[b] = fbAct;
                    }
                });
            }

            // ==============================================================
            // SAVE HISTORY
            // ==============================================================
            saveRotation(rotHist);

            return { block1Assignments: block1, block2Assignments: block2 };
        }
    };

})();
