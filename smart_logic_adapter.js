// ============================================================================
// smart_logic_adapter.js — FINAL STABLE VERSION (LOAD BEFORE logic_core)
// ============================================================================

(function () {
  "use strict";

  // ==========================================================================
  // MAIN OBJECT
  // ==========================================================================
  const SmartLogicAdapter = {

    // --------------------------------------------------------------
    // REQUIRED BY LOGIC_CORE — whether an activity must be generated
    // --------------------------------------------------------------
    needsGeneration(activityName) {
      if (!activityName) return false;
      const n = activityName.toLowerCase();
      if (n.includes("general activity")) return true;
      if (n === "activity") return true;
      if (n.includes("sports")) return true;
      if (n.includes("special")) return true;
      return false;
    },

    // --------------------------------------------------------------
    // MAIN GENERATE FUNCTION (logic_core calls this)
    // --------------------------------------------------------------
    generateAssignments(bunks, smartData, blockPair, historical = {}) {
      const main1 = smartData.main1.trim();
      const main2 = smartData.main2.trim();
      const fallbackTarget = smartData.fallbackFor.trim();
      const fallbackActivity = smartData.fallbackActivity.trim();

      const isMain1Special = (main1.toLowerCase() === "special activity");
      const isMain2Special = (main2.toLowerCase() === "special activity");

      // -------------------------------------------------------------
      // 1. Compute capacities (block 1 + block 2)
      // -------------------------------------------------------------
      const cap1 = computeSpecialCapacity(
        blockPair[0].startMin,
        blockPair[0].endMin
      );
      const cap2 = computeSpecialCapacity(
        blockPair[1].startMin,
        blockPair[1].endMin
      );

      // -------------------------------------------------------------
      // 2. Sort by fairness (lowest special count first)
      // -------------------------------------------------------------
      const order = bunks
        .map(b => ({
          bunk: b,
          specialCount: historical[b]?.specialCount || 0
        }))
        .sort((a, b) => a.specialCount - b.specialCount);

      const block1 = {};
      const block2 = {};

      let used1 = 0;
      let used2 = 0;

      const specialBlock1 = isMain1Special ? main1 : (isMain2Special ? main2 : null);
      const specialBlock2 = isMain2Special ? main2 : (isMain1Special ? main1 : null);

      // -------------------------------------------------------------
      // 3. First pass — distribute specials to lowest count
      // -------------------------------------------------------------
      for (const { bunk } of order) {
        if (!specialBlock1 && !specialBlock2) break;

        if (specialBlock1 && used1 < cap1) {
          block1[bunk] = specialBlock1;
          used1++;
          continue;
        }
        if (specialBlock2 && used2 < cap2) {
          block2[bunk] = specialBlock2;
          used2++;
          continue;
        }
      }

      // -------------------------------------------------------------
      // 4. Enforce main1 <-> main2 pairing rules
      // -------------------------------------------------------------
      for (const { bunk } of order) {
        const g1 = block1[bunk];
        const g2 = block2[bunk];

        // If got main2 in block1 → must get main1 in block2
        if (g1 === main2) block2[bunk] = main1;

        // If got main1 special in block1 → must get main2 block2
        if (g1 === main1 && isMain1Special) block2[bunk] = main2;

        // If got main2 in block2 → must get main1 in block1
        if (g2 === main2) block1[bunk] = main1;

        // If got main1 special in block2 → must get main2 block1
        if (g2 === main1 && isMain1Special) block1[bunk] = main2;
      }

      // -------------------------------------------------------------
      // 5. Fill remaining using fallback rules
      // -------------------------------------------------------------
      for (const { bunk } of order) {
        const g1 = block1[bunk];
        const g2 = block2[bunk];

        if (!g1 && !g2) {
          if (fallbackTarget === main1) {
            block1[bunk] = fallbackActivity;
            block2[bunk] = main2;
          } else if (fallbackTarget === main2) {
            block1[bunk] = main1;
            block2[bunk] = fallbackActivity;
          } else {
            block1[bunk] = main1;
            block2[bunk] = main2;
          }
          continue;
        }

        if (g1 && !g2) {
          if (g1 === main2) block2[bunk] = main1;
          else if (g1 === fallbackActivity) block2[bunk] = main2;
          else block2[bunk] = main2;
          continue;
        }

        if (!g1 && g2) {
          if (g2 === main2) block1[bunk] = main1;
          else if (g2 === fallbackActivity) block1[bunk] = main1;
          else block1[bunk] = main1;
          continue;
        }
      }

      return {
        block1Assignments: block1,
        block2Assignments: block2
      };
    },

    // --------------------------------------------------------------
    // BUILD JOBS FOR PASS 2.5
    // --------------------------------------------------------------
    preprocessSmartTiles(manualSkeleton, dailyAdjustments, specialDefs) {
      const jobs = [];

      manualSkeleton.forEach(ev => {
        if (ev.type !== "smart") return;

        const sd = ev.smartData;
        if (!sd) return;

        const startMin = parseTime(ev.startTime);
        const endMin = parseTime(ev.endTime);
        const mid = Math.floor((startMin + endMin) / 2);

        jobs.push({
          division: ev.division,
          main1: sd.main1.trim(),
          main2: sd.main2.trim(),
          fallbackFor: sd.fallbackFor.trim(),
          fallbackActivity: sd.fallbackActivity.trim(),
          startTime: ev.startTime,
          endTime: ev.endTime,
          blockPair: [
            { startMin, endMin: mid },
            { startMin: mid, endMin }
          ]
        });
      });

      return jobs;
    }
  };

  // ========================================================================
  // SUPPORT FUNCTIONS
  // ========================================================================

  function computeSpecialCapacity(startMin, endMin) {
    const specials = window.masterSpecials || [];
    const disabled = window.currentOverrides?.disabledSpecials || [];

    let cap = 0;

    for (const sp of specials) {
      if (!sp.available) continue;
      if (disabled.includes(sp.name)) continue;

      const ok = isTimeAllowed(sp.timeRules, startMin, endMin);
      if (!ok) continue;

      cap += sp.sharableWith?.capacity || 1;
    }

    return cap;
  }

  function isTimeAllowed(rules, startMin, endMin) {
    if (!rules || !rules.length) return true;

    let allow = false;

    for (const rule of rules) {
      const rs = parseTime(rule.start);
      const re = parseTime(rule.end);
      if (rs == null || re == null) continue;

      const overlap = !(re <= startMin || rs >= endMin);

      if (rule.type === "Available" && overlap) allow = true;
      if (rule.type === "Unavailable" && overlap) allow = false;
    }

    return allow;
  }

  function parseTime(str) {
    if (!str) return null;
    let s = str.toLowerCase();
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

  // ========================================================================
  // EXPORT TO GLOBAL
  // ========================================================================
  window.SmartLogicAdapter = SmartLogicAdapter;

})();
