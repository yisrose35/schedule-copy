// ============================================================================
// smart_logic_adapter.js  (VERSION 6.0 — FINAL)
// ============================================================================
//
// PURPOSE:
//   • Preprocess Smart Tiles (split into 2 blocks)
//   • Determine special capacities (block1 & block2)
//   • Assign Main1 / Main2 / Fallback correctly
//   • Enforce strict pairing rules:
//         - If bunk gets Main2 → must get Main1 in the other block
//         - If bunk gets fallback for Main2 → also must get Main1
//         - If bunk gets Main1 and main1 is special → must get Main2
//   • Ensure Main1 NEVER disappears (Swim stays Swim)
//   • Fairness: lowest specialCount bunks get special first
//
// Exports:
//      SmartLogicAdapter = {
//          needsGeneration()
//          preprocessSmartTiles()
//          generateAssignments()
//      }
// ============================================================================

(function () {
    "use strict";

    // ---------------------------------------------------------------
    // #1 — Identify activities that require generation
    // ---------------------------------------------------------------
    function needsGeneration(name) {
        if (!name) return false;
        const n = name.toLowerCase();
        return (
            n.includes("special") ||
            n.includes("general activity") ||
            n.includes("ga") ||
            n.includes("sport")
        );
    }

    // ---------------------------------------------------------------
    // #2 — Convert "11:00am" → minutes
    // ---------------------------------------------------------------
    function parseTime(str) {
        if (!str) return null;
        let s = str.toLowerCase().trim();
        let mer = null;

        if (s.endsWith("am") || s.endsWith("pm")) {
            mer = s.endsWith("am") ? "am" : "pm";
            s = s.replace(/am|pm/g, "").trim();
        }

        const m = s.match(/^(\d{1,2}):(\d{2})$/);
        if (!m) return null;

        let hh = parseInt(m[1]);
        const mm = parseInt(m[2]);

        if (mer) {
            if (hh === 12) hh = (mer === "am") ? 0 : 12;
            else if (mer === "pm") hh += 12;
        }
        return hh * 60 + mm;
    }

    // ---------------------------------------------------------------
    // #3 — Compute Special Capacity for a specific block
    // ---------------------------------------------------------------
    function computeBlockSpecialCapacity(startMin, endMin, masterSpecials, dailyAdjustments) {
        const disabled = dailyAdjustments.disabledSpecials || [];
        const daily = dailyAdjustments.dailyFieldAvailability || {};

        let total = 0;

        masterSpecials.forEach(sp => {
            if (!sp.available) return;
            if (disabled.includes(sp.name)) return;

            const globalOK = isAllowed(sp.timeRules, startMin, endMin);
            const localOK = isAllowed(daily[sp.name] || [], startMin, endMin);
            if (!globalOK || !localOK) return;

            const cap = sp.sharableWith?.capacity || 1;
            total += cap;
        });

        return total;
    }

    function isAllowed(rules, startMin, endMin) {
        if (!rules || rules.length === 0) return true;

        let allow = false;
        rules.forEach(rule => {
            const rs = parseTime(rule.start);
            const re = parseTime(rule.end);
            if (rs == null || re == null) return;

            const overlaps = !(re <= startMin || rs >= endMin);

            if (rule.type === "Available" && overlaps) allow = true;
            if (rule.type === "Unavailable" && overlaps) allow = false;
        });

        return allow;
    }

    // ---------------------------------------------------------------
    // #4 — Preprocess Smart Tiles (splits each into 2 blocks)
    // ---------------------------------------------------------------
    function preprocessSmartTiles(rawSkeleton, dailyAdjustments, masterSpecials) {
        const jobs = [];

        rawSkeleton.forEach(item => {
            if (item.type !== "smart") return;
            if (!item.smartData) return;

            const startMin = parseTime(item.startTime);
            const endMin   = parseTime(item.endTime);
            const mid      = Math.floor((startMin + endMin) / 2);

            const block1 = { startMin, endMin: mid };
            const block2 = { startMin: mid, endMin };

            jobs.push({
                tileId: item.id,
                division: item.division,

                main1: item.smartData.main1.trim(),
                main2: item.smartData.main2.trim(),
                fallbackFor: item.smartData.fallbackFor.trim(),
                fallbackActivity: item.smartData.fallbackActivity.trim(),

                blocks: [ block1, block2 ],

                masterSpecials,
                dailyAdjustments
            });
        });

        return jobs;
    }

    // ---------------------------------------------------------------
    // #5 — Main Assignment Engine
    // ---------------------------------------------------------------
    function generateAssignments(bunks, job, historical = {}) {

        const { main1, main2, fallbackFor, fallbackActivity } = job;
        const block1 = job.blocks[0];
        const block2 = job.blocks[1];

        const isMain1Special = main1.toLowerCase().includes("special");
        const isMain2Special = main2.toLowerCase().includes("special");

        // Compute capacities
        const cap1 = computeBlockSpecialCapacity(
            block1.startMin, block1.endMin, job.masterSpecials, job.dailyAdjustments
        );
        const cap2 = computeBlockSpecialCapacity(
            block2.startMin, block2.endMin, job.masterSpecials, job.dailyAdjustments
        );

        // Sort bunks by fairness (lowest special count first)
        const stats = bunks
            .map(b => ({ bunk: b, specialCount: historical[b]?.specialCount || 0 }))
            .sort((a, b) => a.specialCount - b.specialCount);

        const block1Assign = {};
        const block2Assign = {};

        let used1 = 0;
        let used2 = 0;

        const block1WantsSpecial = isMain1Special;
        const block2WantsSpecial = isMain2Special;

        // -------- PASS 1 — Give limited special slots to lowest-count bunks ----------
        for (const { bunk } of stats) {
            // Try block1 special
            if (block1WantsSpecial && used1 < cap1) {
                block1Assign[bunk] = main1;
                used1++;
                continue;
            }
            // Try block2 special
            if (block2WantsSpecial && used2 < cap2) {
                block2Assign[bunk] = main2;
                used2++;
                continue;
            }
        }

        // -------- PASS 2 — Enforce absolute pairing rules ----------
        for (const { bunk } of stats) {
            const g1 = block1Assign[bunk];
            const g2 = block2Assign[bunk];

            // SPECIAL IN BLOCK1 → MUST GET MAIN1 IN BLOCK2
            if (g1 === main2 || g1 === fallbackActivity) {
                block2Assign[bunk] = main1;
            }

            // SPECIAL IN BLOCK2 → MUST GET MAIN1 IN BLOCK1
            if (g2 === main2 || g2 === fallbackActivity) {
                block1Assign[bunk] = main1;
            }
        }

        // -------- PASS 3 — Fill remaining bunks ----------
        for (const { bunk } of stats) {
            const g1 = block1Assign[bunk];
            const g2 = block2Assign[bunk];

            if (!g1 && !g2) {
                // Fallback rules
                if (fallbackFor === main1) {
                    block1Assign[bunk] = fallbackActivity;
                    block2Assign[bunk] = main2;
                } else if (fallbackFor === main2) {
                    block1Assign[bunk] = main1;
                    block2Assign[bunk] = fallbackActivity;
                } else {
                    // Default Main1 → Main2
                    block1Assign[bunk] = main1;
                    block2Assign[bunk] = main2;
                }
                continue;
            }

            if (g1 && !g2) {
                if (g1 === main2 || g1 === fallbackActivity) {
                    block2Assign[bunk] = main1;
                } else {
                    block2Assign[bunk] = main2;
                }
                continue;
            }

            if (!g1 && g2) {
                if (g2 === main2 || g2 === fallbackActivity) {
                    block1Assign[bunk] = main1;
                } else {
                    block1Assign[bunk] = main1;
                }
                continue;
            }
        }

        return {
            block1Assignments: block1Assign,
            block2Assignments: block2Assign
        };
    }

    // ---------------------------------------------------------------
    // EXPORT
    // ---------------------------------------------------------------
    window.SmartLogicAdapter = {
        needsGeneration,
        preprocessSmartTiles,
        generateAssignments
    };

})();
