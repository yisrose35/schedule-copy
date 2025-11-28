// ============================================================================
// smart_logic_adapter.js  (FINAL VERSION 5.0 — FIXED FOR LOGIC_CORE)
// ============================================================================
//
// - Matches logic_core’s call signature EXACTLY
// - Uses job.blocks[] properly (blockPair removed)
// - Uses job.main1 / job.main2 / job.fallback* consistently
// - Computes special capacity using masterSpecials + daily overrides
// - Fully enforces Smart Tile pairing rules
// - Safe, clean, drop-in
//
// ============================================================================

(function () {
    'use strict';

    // ============================================================================
    // PUBLIC API
    // ============================================================================
    window.SmartLogicAdapter = {

        //---------------------------------------------------------------------
        // REQUIRED BY LOGIC_CORE — determines if activity requires generation
        //---------------------------------------------------------------------
        needsGeneration(activityName) {
            if (!activityName) return false;
            const n = activityName.toLowerCase();

            if (n.includes("general activity") || n === "activity") return true;
            if (n.includes("sports") || n.includes("sport")) return true;
            if (n.includes("special")) return true;

            return false; // Swim / Lunch / Dismissal / etc.
        },

        //---------------------------------------------------------------------
        // MAIN ENTRY — CALLED FROM scheduler_logic_core.js Pass 2.5
        //---------------------------------------------------------------------
        generateAssignments(bunks, job, historical = {}) {

            // ---------------- MAIN PROPERTIES ----------------
            const main1 = job.main1.trim();
            const main2 = job.main2.trim();
            const fallbackFor = job.fallbackFor.trim();
            const fallbackActivity = job.fallbackActivity.trim();

            // The two Smart Tile blocks:
            const block1 = job.blocks[0];
            const block2 = job.blocks[1];

            const debug = {
                job,
                bunks,
                historical
            };

            const isMain1Special = (main1.toLowerCase() === "special activity");
            const isMain2Special = (main2.toLowerCase() === "special activity");

            // ---------------- CAPACITY PER BLOCK ----------------
            const cap1 = computeBlockSpecialCapacity(
                block1.startMin,
                block1.endMin,
                window.masterSpecials || [],
                window.currentOverrides || {},
                debug
            );

            const cap2 = computeBlockSpecialCapacity(
                block2.startMin,
                block2.endMin,
                window.masterSpecials || [],
                window.currentOverrides || {},
                debug
            );

            debug.blockCaps = { cap1, cap2 };

            // ---------------- FAIRNESS SORT ----------------
            const bunkStats = bunks.map(b => ({
                bunk: b,
                specialCount: historical[b]?.specialCount || 0
            }));

            bunkStats.sort((a, b) => a.specialCount - b.specialCount);
            debug.sorted = JSON.parse(JSON.stringify(bunkStats));

            // ---------------- INITIAL ASSIGNMENT MAPS ----------------
            const block1Assign = {};
            const block2Assign = {};

            let used1 = 0;
            let used2 = 0;

            // Which main is considered “special” in each block
            const specialBlock1 = isMain1Special ? main1 : (isMain2Special ? main2 : null);
            const specialBlock2 = isMain2Special ? main2 : (isMain1Special ? main1 : null);

            // ---------------- PASS 1: Give specials to lowest-count bunks ----------------
            for (const { bunk } of bunkStats) {

                if (!specialBlock1 && !specialBlock2) break; // No specials here

                // Block 1 special
                if (specialBlock1 && used1 < cap1) {
                    block1Assign[bunk] = specialBlock1;
                    used1++;
                    continue;
                }

                // Block 2 special
                if (specialBlock2 && used2 < cap2) {
                    block2Assign[bunk] = specialBlock2;
                    used2++;
                    continue;
                }
            }

            debug.afterSpecialPass = {
                block1Assign: { ...block1Assign },
                block2Assign: { ...block2Assign },
                used1, used2
            };

            // ---------------- PASS 2: Pairing Enforcement ----------------
            for (const { bunk } of bunkStats) {
                const g1 = block1Assign[bunk];
                const g2 = block2Assign[bunk];

                // If got main2 in block1 -> force main1 in block2
                if (g1 === main2) block2Assign[bunk] = main1;

                // If got main1 (special) in block1 -> force main2 in block2
                if (g1 === main1 && isMain1Special) block2Assign[bunk] = main2;

                // If got main2 in block2 -> force main1 in block1
                if (g2 === main2) block1Assign[bunk] = main1;

                // If got main1 (special) in block2 -> force main2 in block1
                if (g2 === main1 && isMain1Special) block1Assign[bunk] = main2;
            }

            // ---------------- PASS 3: Fill all remaining ----------------
            for (const { bunk } of bunkStats) {
                const g1 = block1Assign[bunk];
                const g2 = block2Assign[bunk];

                // CASE A — neither assigned
                if (!g1 && !g2) {
                    if (fallbackFor === main1) {
                        block1Assign[bunk] = fallbackActivity;
                        block2Assign[bunk] = main2;
                    }
                    else if (fallbackFor === main2) {
                        block1Assign[bunk] = main1;
                        block2Assign[bunk] = fallbackActivity;
                    }
                    else {
                        block1Assign[bunk] = main1;
                        block2Assign[bunk] = main2;
                    }
                    continue;
                }

                // CASE B — only block1 assigned
                if (g1 && !g2) {
                    if (g1 === main2) block2Assign[bunk] = main1;
                    else if (g1 === fallbackActivity) block2Assign[bunk] = main2;
                    else block2Assign[bunk] = main2;
                    continue;
                }

                // CASE C — only block2 assigned
                if (!g1 && g2) {
                    if (g2 === main2) block1Assign[bunk] = main1;
                    else if (g2 === fallbackActivity) block1Assign[bunk] = main1;
                    else block1Assign[bunk] = main1;
                    continue;
                }
            }

            debug.final = {
                block1: { ...block1Assign },
                block2: { ...block2Assign }
            };

            // ---------------- RETURN OUTPUT ----------------
            return {
                block1Assignments: block1Assign,
                block2Assignments: block2Assign,
                debug
            };
        }
    };

    // ============================================================================
    // SUPPORTING FUNCTIONS
    // ============================================================================

    function computeBlockSpecialCapacity(startMin, endMin, masterSpecials, dailyData, debug) {
        const disabled = dailyData.disabledSpecials || [];
        const dailyAvail = dailyData.dailyFieldAvailability || {};

        let total = 0;
        const detail = [];

        for (const sp of masterSpecials) {
            if (!sp.available) continue;
            if (disabled.includes(sp.name)) continue;

            const globalOK = isTimeAllowed(sp.timeRules, startMin, endMin);
            const dailyRules = dailyAvail[sp.name] || [];
            const dailyOK = isTimeAllowed(dailyRules, startMin, endMin);

            if (!globalOK || !dailyOK) continue;

            const cap = sp.sharableWith?.capacity || 1;
            total += cap;

            detail.push({ special: sp.name, cap });
        }

        if (debug) {
            debug.specialByBlock = debug.specialByBlock || [];
            debug.specialByBlock.push({
                startMin,
                endMin,
                detail,
                total
            });
        }

        return total;
    }

    function isTimeAllowed(rules, startMin, endMin) {
        if (!rules || rules.length === 0) return true;

        let allow = false;

        for (const rule of rules) {
            const rs = parseTime(rule.start);
            const re = parseTime(rule.end);
            if (rs == null || re == null) continue;

            const overlaps = !(re <= startMin || rs >= endMin);

            if (rule.type === "Available" && overlaps) allow = true;
            if (rule.type === "Unavailable" && overlaps) allow = false;
        }

        return allow;
    }

    function parseTime(str) {
        if (!str || typeof str !== "string") return null;
        let s = str.trim().toLowerCase();
        let mer = null;

        if (s.endsWith("am") || s.endsWith("pm")) {
            mer = s.endsWith("am") ? "am" : "pm";
            s = s.replace(/am|pm/g, "").trim();
        }

        const m = s.match(/^(\d{1,2}):(\d{2})$/);
        if (!m) return null;

        let hh = parseInt(m[1], 10);
        const mm = parseInt(m[2], 10);

        if (mer) {
            if (hh === 12) hh = (mer === "am") ? 0 : 12;
            else if (mer === "pm") hh += 12;
        }

        return hh * 60 + mm;
    }

})();
