// ============================================================================
// smart_logic_adapter.js  (FULL STEP 3 IMPLEMENTATION)
//
// PURPOSE:
//   Generates Main1/Main2/Fallback assignments for Smart Tiles based on:
//     • Daily availability from Daily Adjustments
//     • Special Activities & Field capacities
//     • Per-block capacity (morning vs afternoon)
//     • Fairness (who already got special)
//     • Absolute pairing rules:
//           - If a bunk gets Main1 in Block A → must get Main2 in Block B
//           - If a bunk gets Fallback for Main1 → still must get Main2 in Block B
//           - If a bunk gets Special (Main2) in Block A → must get Main1 in Block B
//     • Fallback does NOT count as a special for fairness
//     • Can handle unlimited-capacity activities (like Swim)
//
// INPUT:
//   Smart Tile block object containing:
//       {
//         main1: "Swim",                 // always allowed
//         main2: "Special Activity",      // requires capacity calc
//         fallbackFor: "Special Activity",
//         fallbackActivity: "Sports",     // fallback for Special
//         blocks: [
//             {startMin, endMin},         // block #1
//             {startMin, endMin}          // block #2
//         ]
//       }
//
//   Additional globals read:
//       window.currentOverrides.dailyFieldAvailability
//       window.getGlobalSpecialActivities()
//       window.divisions
//
// OUTPUT:
//   {
//       block1Assignments: { bunk → activity }
//       block2Assignments: { bunk → activity }
//       debug: { ... massive explanation ... }
//   }
//
// ============================================================================
(function() {
'use strict';

// ============================================================================
// ========== MAIN EXPORT ======================================================
// ============================================================================

window.SmartLogicAdapter = {
    needsGeneration: function(activityName) {
    if (!activityName) return false;
    const n = activityName.toLowerCase();
    if (n.includes("general activity") || n === "activity") return true;
    if (n.includes("sports") || n.includes("sport")) return true;
    if (n.includes("special")) return true;
    return false; // e.g. Swim, Lunch, etc.
},

    /**
     * Generates assignments for the Smart Tile pair.
     *
     * @param {Array<string>} bunks - bunks in this division
     * @param {Object} smartData     - smart tile definition
     * @param {Object} blockPair     - array of 2 blocks: [{startMin,endMin},{...}]
     * @param {Object} historical    - historicalCounts.bunks[bunk].special
     * @return {Object}
     */
    generate: function(bunks, smartData, blockPair, historical = {}) {
        const debug = {};

        const main1 = smartData.main1;
        const main2 = smartData.main2;
        const fallbackFor = smartData.fallbackFor;
        const fallbackActivity = smartData.fallbackActivity;

        debug.input = { bunks, smartData, blockPair, historical };

        // =====================================================================
        // 1. DETERMINE BLOCK CAPACITIES
        // =====================================================================
        const blockCaps = blockPair.map(block => {
            return computeBlockSpecialCapacity(block.startMin, block.endMin, debug);
        });

        const cap1 = blockCaps[0];
        const cap2 = blockCaps[1];
        debug.blockCaps = {cap1, cap2};

        // If main2 is not special activity, its capacity is unlimited
        const isMain2Special = (main2.toLowerCase() === 'special activity');

        // If fallback is special, treat same as main2 special
        const isFallbackSpecial = (fallbackActivity.toLowerCase() === 'special activity');

        // =====================================================================
        // 2. COUNT HOW MANY SPECIALS ARE POSSIBLE
        // =====================================================================
        let totalSpecialSlots = 0;
        if (isMain2Special) totalSpecialSlots += cap1 + cap2;
        else totalSpecialSlots = Infinity;

        debug.totalSpecialSlots = totalSpecialSlots;

        // =====================================================================
        // 3. SORT BUNKS BY FAIRNESS
        // =====================================================================
        const bunkStats = bunks.map(b => ({
            bunk: b,
           specialCount: (historical[b]?.specialCount || 0)

        }));

        bunkStats.sort((a,b) => a.specialCount - b.specialCount);

        debug.bunkStatsSortedForFairness = JSON.parse(JSON.stringify(bunkStats));

        // =====================================================================
        // 4. INITIAL ASSIGNMENT STRUCTURES
        // =====================================================================
        const block1Assign = {};
        const block2Assign = {};

        let specialsUsedBlock1 = 0;
        let specialsUsedBlock2 = 0;

        // =====================================================================
        // 5. FIRST PASS — ASSIGN MAIN2 (SPECIALS) TO THOSE WHO NEED MOST
        // =====================================================================
        for (const { bunk } of bunkStats) {
            if (!isMain2Special) break; // main2 not special → skip

            if (specialsUsedBlock1 < cap1) {
                block1Assign[bunk] = main2; // give Special
                specialsUsedBlock1++;
            } else if (specialsUsedBlock2 < cap2) {
                block2Assign[bunk] = main2; // give Special
                specialsUsedBlock2++;
            }
        }

        debug.afterSpecialPass = {
            block1Assign: {...block1Assign},
            block2Assign: {...block2Assign},
            specialsUsedBlock1, specialsUsedBlock2
        };

        // =====================================================================
        // 6. SECOND PASS — PAIRING ENFORCEMENT
        // =====================================================================
        for (const { bunk } of bunkStats) {
            const got1 = block1Assign[bunk];
            const got2 = block2Assign[bunk];

            // A. If a bunk got Main2 in block 1 → MUST get Main1 in block 2
            if (got1 === main2) {
                block2Assign[bunk] = main1;
            }

            // B. If a bunk got Main2 in block 2 → MUST get Main1 in block 1
            if (got2 === main2) {
                block1Assign[bunk] = main1;
            }
        }

        // =====================================================================
        // 7. THIRD PASS — ASSIGN REMAINING BUNKS
        // =====================================================================
        for (const { bunk } of bunkStats) {
            const b1 = block1Assign[bunk];
            const b2 = block2Assign[bunk];

            // ---- Case: neither block assigned yet ----
            if (!b1 && !b2) {
                // If main1 has fallback and bunk should receive fallback
                if (fallbackFor === main1) {
                    block1Assign[bunk] = fallbackActivity;
                    block2Assign[bunk] = main2;
                }
                // If main2 has fallback
                else if (fallbackFor === main2) {
                    block1Assign[bunk] = main1;
                    block2Assign[bunk] = fallbackActivity;
                }
                else {
                    // Standard: give main1 → main2
                    block1Assign[bunk] = main1;
                    block2Assign[bunk] = main2;
                }
            }

            // ---- Case: only block1 assigned ----
            else if (b1 && !b2) {
                if (b1 === main2) block2Assign[bunk] = main1;
                else if (b1 === fallbackActivity) block2Assign[bunk] = main2;
                else block2Assign[bunk] = main2;
            }

            // ---- Case: only block2 assigned ----
            else if (!b1 && b2) {
                if (b2 === main2) block1Assign[bunk] = main1;
                else if (b2 === fallbackActivity) block1Assign[bunk] = main1;
                else block1Assign[bunk] = main1;
            }
        }

        debug.finalAssignmentsBeforeTrim = {
            block1Assign: {...block1Assign},
            block2Assign: {...block2Assign}
        };

        // =====================================================================
        // 8. RETURN FINAL RESULTS
        // =====================================================================

        return {
            block1Assignments: block1Assign,
            block2Assignments: block2Assign,
            debug
        };
    }
};

// ============================================================================
// ========== SUPPORTING FUNCTIONS ============================================
// ============================================================================

/**
 * Computes how many "Special Activity" slots are available in this block.
 */
function computeBlockSpecialCapacity(startMin, endMin, debug) {
    const specials = window.getGlobalSpecialActivities?.() || [];
    const daily = window.currentOverrides?.dailyFieldAvailability || {};

    let totalCap = 0;
    const details = [];

    for (const sp of specials) {
        if (!sp.available) continue;

        const globalOK = isTimeAllowed(sp.timeRules, startMin, endMin);
        const dailyRules = daily[sp.name] || [];
        const dailyOK = isTimeAllowed(dailyRules, startMin, endMin);

        if (!globalOK || !dailyOK) continue;

        const cap = sp.sharableWith?.capacity || 1;
        totalCap += cap;
        details.push({ special: sp.name, cap });
    }

    if (debug) {
        if (!debug.specialByBlock) debug.specialByBlock = [];
        debug.specialByBlock.push({ block:{startMin,endMin}, details, totalCap });
    }

    return totalCap;
}

/**
 * Checks if time rules permit activity in this block.
 */
function isTimeAllowed(rules, startMin, endMin) {
    if (!rules || rules.length === 0) return true;

    let allow = false;

    for (const rule of rules) {
        const rStart = parseTime(rule.start);
        const rEnd   = parseTime(rule.end);
        if (rStart == null || rEnd == null) continue;

        const overlaps = !(rEnd <= startMin || rStart >= endMin);

        if (rule.type === 'Available' && overlaps) allow = true;
        if (rule.type === 'Unavailable' && overlaps) allow = false;
    }
    return allow;
}

/** Convert "9:00am" to minutes */
function parseTime(str) {
    if (!str || typeof str !== 'string') return null;
    let s = str.trim().toLowerCase();
    let mer = null;

    if (s.endsWith('am') || s.endsWith('pm')) {
        mer = s.endsWith('am') ? 'am' : 'pm';
        s = s.replace(/am|pm/g, '').trim();
    }

    const m = s.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;

    let hh = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);

    if (Number.isNaN(hh) || Number.isNaN(mm)) return null;

    if (mer) {
        if (hh === 12) hh = (mer === 'am') ? 0 : 12;
        else if (mer === 'pm') hh += 12;
    }

    return hh * 60 + mm;
}

})();
