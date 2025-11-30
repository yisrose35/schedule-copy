// ============================================================================
// SmartLogicAdapter V31 (PERFECT ROTATION EDITION + PERSISTENT HISTORY)
// - NEW: Persistent Smart Tile history saved per bunk (localStorage)
// - NEW: Special rotation ALWAYS gives special to bunks with lowest history
// - STRICT SORTING remains (lowest wins)
// - Yesterday penalty still included
// - Category and total history still included
// ============================================================================

(function () {
    "use strict";

    // ==============================================================
    // ⭐ ROTATION ADDED — Persistent Smart Tile History
    // ==============================================================

    const ROTATION_KEY = "smartTileSpecialHistory_v1";

    function loadRotationHistory() {
        try {
            const raw = localStorage.getItem(ROTATION_KEY);
            if (!raw) return {};
            return JSON.parse(raw);
        } catch {
            return {};
        }
    }

    function saveRotationHistory(hist) {
        try {
            localStorage.setItem(ROTATION_KEY, JSON.stringify(hist));
        } catch {}
    }

    function addSpecialPoint(hist, bunk, actName) {
        if (!hist[bunk]) hist[bunk] = {};
        if (!hist[bunk][actName]) hist[bunk][actName] = 0;
        hist[bunk][actName] += 1;
    }

    function getSpecialPoints(hist, bunk, actName) {
        if (!hist[bunk]) return 0;
        return hist[bunk][actName] || 0;
    }

    // ==============================================================


    // ==============================================================  
    // PUBLIC EXPORT  
    // ==============================================================  
    window.SmartLogicAdapter = {

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
            const jobs = [];
            const tilesByDiv = {};

            rawSkeleton.forEach(t => {
                if (t.type === 'smart') {
                    if (!tilesByDiv[t.division]) tilesByDiv[t.division] = [];
                    tilesByDiv[t.division].push(t);
                }
            });

            Object.keys(tilesByDiv).forEach(div => {
                const tiles = tilesByDiv[div].sort((a, b) => parse(a.startTime) - parse(b.startTime));

                for (let i = 0; i < tiles.length; i += 2) {
                    const tileA = tiles[i];
                    const tileB = tiles[i + 1];
                    const sd = tileA.smartData || {};

                    if (!tileB) {
                        console.warn(`[SmartAdapter] Orphan Smart Tile found for ${div} at ${tileA.startTime}.`);
                        jobs.push({
                            division: div,
                            main1: sd.main1,
                            main2: sd.main2,
                            fallbackFor: sd.fallbackFor,
                            fallbackActivity: sd.fallbackActivity,
                            blockA: { startMin: parse(tileA.startTime), endMin: parse(tileA.endTime), division: div },
                            blockB: null
                        });
                    } else {
                        jobs.push({
                            division: div,
                            main1: sd.main1,
                            main2: sd.main2,
                            fallbackFor: sd.fallbackFor,
                            fallbackActivity: sd.fallbackActivity,
                            blockA: { startMin: parse(tileA.startTime), endMin: parse(tileA.endTime), division: div },
                            blockB: { startMin: parse(tileB.startTime), endMin: parse(tileB.endTime), division: div }
                        });
                    }
                }
            });
            return jobs;
        },

        // MAIN LOGIC
        generateAssignments(bunks, job, historical = {}, specialNames = [], activityProperties = {}, masterFields = [], dailyFieldAvailability = {}, yesterdayHistory = {}) {

            // ==============================================================
            // ⭐ ROTATION ADDED — Load persistent history
            // ==============================================================
            const rotationHistory = loadRotationHistory();
            // ==============================================================

            const main1 = job.main1.trim();
            const main2 = job.main2.trim();
            const fbAct = job.fallbackActivity || "Sports";

            let specialAct = main1;
            let openAct = main2;

            const fbFor = job.fallbackFor ? job.fallbackFor.trim() : "";

            if (isSameActivity(fbFor, main1)) {
                specialAct = main1;
                openAct = main2;
            } else if (isSameActivity(fbFor, main2)) {
                specialAct = main2;
                openAct = main1;
            }

            // CAPACITY CALCULATOR...
            const calculateCapacityForBlock = (startMin, endMin) => {
                let totalCapacity = 0;
                const specialLower = specialAct.toLowerCase();

                const getCap = (r) => {
                    if (r.sharableWith && r.sharableWith.capacity) return parseInt(r.sharableWith.capacity) || 1;
                    if (r.sharableWith && r.sharableWith.type === 'not_sharable') return 1;
                    if (r.sharableWith && r.sharableWith.type === 'all') return 2;
                    if (r.sharable) return 2;
                    return 1;
                };

                if (specialLower.includes('sport')) {
                    masterFields.forEach(f => {
                        const dailyRules = dailyFieldAvailability[f.name];
                        if (isTimeAvailable(startMin, endMin, f.available, dailyRules || f.timeRules)) {
                            totalCapacity += getCap(f);
                        }
                    });
                } else {
                    const allSpecials = window.getGlobalSpecialActivities?.() || [];
                    allSpecials.forEach(s => {
                        const dailyRules = dailyFieldAvailability[s.name];
                        if (isTimeAvailable(startMin, endMin, s.available, dailyRules || s.timeRules)) {
                            totalCapacity += getCap(s);
                        }
                    });
                }

                return totalCapacity;
            };

            // YESTERDAY CHECK (unchanged)
            const didPlayYesterday = (bunk) => {
                const sched = yesterdayHistory.schedule?.[bunk] || [];
                return sched.some(e => {
                    const act = e?._activity?.toLowerCase() || "";
                    return (
                        act.includes("special") ||
                        act.includes("sport") ||
                        act.includes("general activity") ||
                        specialNames.includes(e._activity)
                    );
                }) ? 1 : 0;
            };

            // ==============================================================
            // ⭐ ROTATION ADDED — FIRST SORT PRIORITY IS rotationHistory
            // ==============================================================
            const sortedBunks = [...bunks].sort((a, b) => {

                // (1) Persistent Special Rotation History — **NEW**
                const rotA = getSpecialPoints(rotationHistory, a, specialAct);
                const rotB = getSpecialPoints(rotationHistory, b, specialAct);
                if (rotA !== rotB) return rotA - rotB;

                // (2) Yesterday penalty
                const yA = didPlayYesterday(a);
                const yB = didPlayYesterday(b);
                if (yA !== yB) return yA - yB;

                // (3) Total historical fairness (existing)
                const totA = historical[a]?.total || 0;
                const totB = historical[b]?.total || 0;
                if (totA !== totB) return totA - totB;

                return 0.5 - Math.random();
            });
            // ==============================================================


            // --------------------------------------------------------
            // ASSIGNMENT PHASE
            // --------------------------------------------------------

            const block1 = {};
            const block2 = {};
            const gotSpecialB1 = new Set();

            const capA = calculateCapacityForBlock(job.blockA.startMin, job.blockA.endMin);
            let countA = 0;

            for (const bunk of sortedBunks) {
                if (countA < capA) {
                    block1[bunk] = specialAct;
                    gotSpecialB1.add(bunk);

                    // ⭐ ROTATION ADDED — record history
                    addSpecialPoint(rotationHistory, bunk, specialAct);

                    countA++;
                } else {
                    block1[bunk] = openAct;
                }
            }

            // Block B (unchanged except rotation addition)
            if (job.blockB) {
                const capB = calculateCapacityForBlock(job.blockB.startMin, job.blockB.endMin);
                let countB = 0;

                const mustOpen = [];
                const candidates = [];

                sortedBunks.forEach(b => {
                    if (gotSpecialB1.has(b)) mustOpen.push(b);
                    else candidates.push(b);
                });

                mustOpen.forEach(b => { block2[b] = openAct; });

                candidates.forEach(b => {
                    if (countB < capB) {
                        block2[b] = specialAct;

                        // ⭐ ROTATION ADDED — record history
                        addSpecialPoint(rotationHistory, b, specialAct);

                        countB++;
                    } else {
                        block2[b] = fbAct;
                    }
                });
            }

            // ⭐ ROTATION ADDED — Save updated rotation history
            saveRotationHistory(rotationHistory);

            return { block1Assignments: block1, block2Assignments: block2 };
        }
    };

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

})();
