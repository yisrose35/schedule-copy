// ============================================================================
// smart_logic_adapter.js  (FINAL VERSION 4.0 — ALL PATCHES APPLIED)
//
// PURPOSE:
//   • Generates Main1/Main2/Fallback assignments for Smart Tiles
//   • Handles fairness, capacity, sharable specials
//   • Handles main1 or main2 being special
//   • Handles fallback logic
//   • Provides needsGeneration() for logic_core
//   • Fully synced with daily_adjustments + master_specials
//   • Absolutely guarantees Main1/Main2 pairing rules
//
// OUTPUT SHAPE:
//   {
//      block1Assignments: { bunkName : activity },
//      block2Assignments: { bunkName : activity },
//      debug: { ...full trace... }
//   }
//
// ============================================================================

(function() {
'use strict';

// ============================================================================
// PUBLIC API
// ============================================================================
window.SmartLogicAdapter = {

    // --------------------------------------------------------------
    // REQUIRED BY LOGIC_CORE — returns TRUE if activity must be auto-generated
    // --------------------------------------------------------------
    needsGeneration: function(activityName) {
        if (!activityName) return false;
        const n = activityName.toLowerCase();
        if (n.includes("general activity") || n === "activity") return true;
        if (n.includes("sports") || n.includes("sport")) return true;
        if (n.includes("special")) return true;
        return false; // example: Swim, Lunch, Dismissal
    },

    // --------------------------------------------------------------
    // MAIN ENTRY POINT CALLED BY LOGIC_CORE
    // --------------------------------------------------------------
    generate: function(bunks, smartData, blockPair, historical = {}) {

        const main1 = smartData.main1.trim();
        const main2 = smartData.main2.trim();
        const fallbackFor = smartData.fallbackFor.trim();
        const fallbackActivity = smartData.fallbackActivity.trim();

        const debug = {
            input: { bunks, smartData, blockPair, historical }
        };

        // Determine special types
        const isMain1Special = (main1.toLowerCase() === "special activity");
        const isMain2Special = (main2.toLowerCase() === "special activity");

        // ----------------------------------------------------------
        // 1. Capacity per block (via master specials + daily overrides)
        // ----------------------------------------------------------
        const cap1 = computeBlockSpecialCapacity(
            blockPair[0].startMin,
            blockPair[0].endMin,
            window.masterSpecials || [],
            window.currentOverrides || {},
            debug
        );

        const cap2 = computeBlockSpecialCapacity(
            blockPair[1].startMin,
            blockPair[1].endMin,
            window.masterSpecials || [],
            window.currentOverrides || {},
            debug
        );

        debug.blockCaps = { cap1, cap2 };

        // ----------------------------------------------------------
        // 2. FAIRNESS SORT (lower specialCount gets priority)
        // ----------------------------------------------------------
        const bunkStats = bunks.map(b => ({
            bunk: b,
            specialCount: historical[b]?.specialCount || 0
        }));

        bunkStats.sort((a, b) => a.specialCount - b.specialCount);
        debug.bunkStatsSortedForFairness = JSON.parse(JSON.stringify(bunkStats));

        // ----------------------------------------------------------
        // 3. INITIAL STRUCTURES
        // ----------------------------------------------------------
        const block1Assign = {};
        const block2Assign = {};

        let specialsUsed1 = 0;
        let specialsUsed2 = 0;

        // Determine which activity is special in each block
        const specialBlock1 = isMain1Special ? main1 : (isMain2Special ? main2 : null);
        const specialBlock2 = isMain2Special ? main2 : (isMain1Special ? main1 : null);

        // ----------------------------------------------------------
        // 4. FIRST PASS — GIVE SPECIALS TO LOWEST COUNT BUNKS
        // ----------------------------------------------------------
        for (const { bunk } of bunkStats) {

            // NOTHING is special → skip capacity handling
            if (!specialBlock1 && !specialBlock2) break;

            // Try block 1 first
            if (specialBlock1 && specialsUsed1 < cap1) {
                block1Assign[bunk] = specialBlock1;
                specialsUsed1++;
                continue;
            }

            // Then try block 2
            if (specialBlock2 && specialsUsed2 < cap2) {
                block2Assign[bunk] = specialBlock2;
                specialsUsed2++;
                continue;
            }
        }

        debug.afterSpecialPass = {
            block1Assign: { ...block1Assign },
            block2Assign: { ...block2Assign },
            specialsUsed1, specialsUsed2
        };

        // ----------------------------------------------------------
        // 5. PAIRING ENFORCEMENT (Smart Tile rule)
        // ----------------------------------------------------------
        for (const { bunk } of bunkStats) {
            const g1 = block1Assign[bunk];
            const g2 = block2Assign[bunk];

            // If got main2 in block1 → must get main1 in block2
            if (g1 === main2) block2Assign[bunk] = main1;

            // If got main1 (special) in block1 → must get main2 in block2
            if (g1 === main1 && isMain1Special) block2Assign[bunk] = main2;

            // If got main2 in block2 → must get main1 in block1
            if (g2 === main2) block1Assign[bunk] = main1;

            // If got main1 (special) in block2 → must get main2 in block1
            if (g2 === main1 && isMain1Special) block1Assign[bunk] = main2;
        }

        // ----------------------------------------------------------
        // 6. FILL REMAINING (fallback + standard logic)
        // ----------------------------------------------------------
        for (const { bunk } of bunkStats) {
            const g1 = block1Assign[bunk];
            const g2 = block2Assign[bunk];

            // CASE 1 — Neither block assigned yet
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

            // CASE 2 — Only block1 assigned
            if (g1 && !g2) {
                if (g1 === main2) block2Assign[bunk] = main1;
                else if (g1 === fallbackActivity) block2Assign[bunk] = main2;
                else block2Assign[bunk] = main2;
                continue;
            }

            // CASE 3 — Only block2 assigned
            if (!g1 && g2) {
                if (g2 === main2) block1Assign[bunk] = main1;
                else if (g2 === fallbackActivity) block1Assign[bunk] = main1;
                else block1Assign[bunk] = main1;
                continue;
            }
        }

        debug.finalAssignmentsBeforeReturn = {
            block1Assign: { ...block1Assign },
            block2Assign: { ...block2Assign }
        };

        // ----------------------------------------------------------
        // RETURN
        // ----------------------------------------------------------
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

function computeBlockSpecialCapacity(startMin, endMin, specialDefs, dailyAdjustments, debug) {

    const disabled = dailyAdjustments?.disabledSpecials || [];
    let totalCap = 0;
    const details = [];

    for (const sp of specialDefs) {
        if (!sp.available) continue;
        if (disabled.includes(sp.name)) continue;

        const globalOK = isTimeAllowed(sp.timeRules, startMin, endMin);
        const dailyRules = dailyAdjustments.dailyFieldAvailability?.[sp.name] || [];
        const dailyOK = isTimeAllowed(dailyRules, startMin, endMin);

        if (!globalOK || !dailyOK) continue;

        const cap = sp.sharableWith?.capacity || 1;
        totalCap += cap;

        details.push({
            special: sp.name,
            cap
        });
    }

    if (debug) {
        if (!debug.specialByBlock) debug.specialByBlock = [];
        debug.specialByBlock.push({
            block: { startMin, endMin },
            details,
            totalCap
        });
    }

    return totalCap;
}

function isTimeAllowed(rules, startMin, endMin) {
    if (!rules || !rules.length) return true;

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

    if (Number.isNaN(hh) || Number.isNaN(mm)) return null;

    if (mer) {
        if (hh === 12) hh = (mer === "am") ? 0 : 12;
        else if (mer === "pm") hh += 12;
    }

    return hh * 60 + mm;
}

})();
