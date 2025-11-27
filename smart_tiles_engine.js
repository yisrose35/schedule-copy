// ============================================================================
// smart_tiles_engine.js  (FIXED VERSION)
// ============================================================================

(function () {
  "use strict";

  // --------------------------------------------------------------------------
  // VALIDATION HELPERS — NEW
  // --------------------------------------------------------------------------

  function isActivityAllowed(activityName, bunkName, divName, slots, startTime, endTime) {
    if (!activityName) return false;

    const props = window.activityProperties?.[activityName];
    if (!props) return false;                              // disabled or unregistered

    if (!props.available) return false;                    // daily disabled

    if (props.allowedDivisions && Array.isArray(props.allowedDivisions)) {
      if (!props.allowedDivisions.includes(divName)) return false; // division blocked
    }

    // Build a mock block for canBlockFit
    const block = {
      divName,
      bunk: bunkName,
      slots,
      startTime,
      endTime
    };

    return window.canBlockFit?.(
      block,
      activityName,
      window.activityProperties,
      window.fieldUsageBySlot,
      activityName
    );
  }

  function pickValidSpecial(specialName, fallbackActivity, bunkName, divName, slots, startTime, endTime) {
    // Try specific special first
    if (specialName && isActivityAllowed(specialName, bunkName, divName, slots, startTime, endTime)) {
      return { type: "Special", name: specialName };
    }

    // Try generic "Special Activity" if valid
    if (isActivityAllowed("Special Activity", bunkName, divName, slots, startTime, endTime)) {
      return { type: "Special", name: "Special Activity" };
    }

    // Try fallback
    if (fallbackActivity && isActivityAllowed(fallbackActivity, bunkName, divName, slots, startTime, endTime)) {
      return { type: "Fallback", name: fallbackActivity };
    }

    // Nothing valid → Free period
    return { type: "Free", name: "Free" };
  }

  function pickValidFallback(fallbackActivity, bunkName, divName, slots, startTime, endTime) {
    if (fallbackActivity && isActivityAllowed(fallbackActivity, bunkName, divName, slots, startTime, endTime)) {
      return { type: "Fallback", name: fallbackActivity };
    }

    return { type: "Free", name: "Free" };
  }

  function pickValidSwim(bunkName, divName, slots, startTime, endTime) {
    if (isActivityAllowed("Swim", bunkName, divName, slots, startTime, endTime)) {
      return { type: "Swim", name: "Swim" };
    }

    return { type: "Free", name: "Free" };
  }

  // --------------------------------------------------------------------------
  // HISTORY HELPERS (unchanged)
  // --------------------------------------------------------------------------

  function ensureHistoryForBunk(history, bunkName) {
    if (!history.byBunk) history.byBunk = {};
    if (!history.byBunk[bunkName]) {
      history.byBunk[bunkName] = {
        totalSpecials: 0,
        totalFallbacks: 0,
        specialsByName: {}
      };
    }
    return history.byBunk[bunkName];
  }

  function getSpecialCountForBunk(bunkHist, specialName) {
    if (!bunkHist.specialsByName) bunkHist.specialsByName = {};
    return bunkHist.specialsByName[specialName] || 0;
  }

  function bumpSpecialCountForBunk(bunkHist, specialName) {
    if (!bunkHist.specialsByName) bunkHist.specialsByName = {};
    bunkHist.specialsByName[specialName] =
      (bunkHist.specialsByName[specialName] || 0) + 1;
  }

  // --------------------------------------------------------------------------
  // SORTING FOR SPECIAL PRIORITY (unchanged)
  // --------------------------------------------------------------------------

  function sortBunksForSpecialToday(bunkNames, history) {
    const arr = bunkNames.map((name) => {
      const h = ensureHistoryForBunk(history, name);
      return {
        bunkName: name,
        totalSpecials: h.totalSpecials || 0,
        totalFallbacks: h.totalFallbacks || 0
      };
    });

    arr.sort((a, b) => {
      if (a.totalSpecials !== b.totalSpecials) {
        return a.totalSpecials - b.totalSpecials;
      }
      if (a.totalFallbacks !== b.totalFallbacks) {
        return b.totalFallbacks - a.totalFallbacks;
      }
      return a.bunkName.localeCompare(b.bunkName);
    });

    return arr.map((x) => x.bunkName);
  }

  // --------------------------------------------------------------------------
  // ASSIGN SPECIFIC SPECIAL NAMES (unchanged)
  // --------------------------------------------------------------------------

  function assignSpecificSpecials(bunkNames, specialsPool, history) {
  const assignments = {};
  const remaining = new Set(bunkNames);

  if (!specialsPool || specialsPool.length === 0) {
    bunkNames.forEach(b => assignments[b] = null);
    return assignments;
  }

  // Track global usage of each special across ALL bunks
  const globalCounts = {};
  specialsPool.forEach(sp => globalCounts[sp] = 0);

  // Count historical totals globally
  for (const bunk in history.byBunk) {
    const h = history.byBunk[bunk];
    for (const sp of specialsPool) {
      const c = h.specialsByName?.[sp] || 0;
      globalCounts[sp] += c;
    }
  }

  while (remaining.size > 0) {
    const candidates = Array.from(remaining);

    // Build all (bunk, special) possible pairs
    const pairs = [];
    for (const bunkName of candidates) {
      const h = ensureHistoryForBunk(history, bunkName);
      for (const specialName of specialsPool) {
        const bunkSpecialCount = getSpecialCountForBunk(h, specialName);
        const bunkTotal = h.totalSpecials || 0;
        const bunkFallback = h.totalFallbacks || 0;
        const globalCount = globalCounts[specialName];

        // Score = fairness metric
        pairs.push({
          bunkName,
          specialName,
          score: (
            bunkSpecialCount * 10000 +   // huge weight: avoid repeating specific special
            bunkTotal * 200 +            // next: avoid repeating specials in general
            globalCount * 150 +          // next: rotate specials globally
            (100 - bunkFallback) * 1     // mild bonus for bunks that got fallback often
          )
        });
      }
    }

    // Sort by lowest score first (best candidate)
    pairs.sort((a, b) => a.score - b.score);

    const chosen = pairs[0];
    if (!chosen) break;

    // Assign
    assignments[chosen.bunkName] = chosen.specialName;
    remaining.delete(chosen.bunkName);

    // Update global counts
    globalCounts[chosen.specialName]++;
  }

  return assignments;
}

  // --------------------------------------------------------------------------
  // RUN ONE SMART TILE CONFIG  (fully patched)
  // --------------------------------------------------------------------------

  function runSmartTileConfig(cfg, history) {
    const updatedHistory = JSON.parse(JSON.stringify(history || { byBunk: {} }));
    const bunkNames = (cfg.bunkNames || []).slice();
    if (!bunkNames.length) return { overrides: [], updatedHistory };

    if (!cfg.blocks || cfg.blocks.length !== 2) return { overrides: [], updatedHistory };

    const blockA = cfg.blocks[0];
    const blockB = cfg.blocks[1];
    const divName = cfg.division;

    const fallbackActivity = cfg.fallbackActivity || "Sports Slot";
    const specialsPool = cfg.specialsPool || [];

    const maxSpecialBunksPerDay =
      typeof cfg.maxSpecialBunksPerDay === "number"
        ? Math.min(bunkNames.length, cfg.maxSpecialBunksPerDay)
        : bunkNames.length;

    const sortedForSpecial = sortBunksForSpecialToday(bunkNames, updatedHistory);
    const bunksThatGetSpecialToday = new Set(sortedForSpecial.slice(0, maxSpecialBunksPerDay));
    const bunksThatGetFallbackToday = new Set(sortedForSpecial.slice(maxSpecialBunksPerDay));

    const specialAssignments = assignSpecificSpecials(
      Array.from(bunksThatGetSpecialToday),
      specialsPool,
      updatedHistory
    );

    const overrides = [];

    bunkNames.forEach((bunkName, idx) => {
      const getsSpecial = bunksThatGetSpecialToday.has(bunkName);
      const getsFallback = bunksThatGetFallbackToday.has(bunkName);
      const even = idx % 2 === 0;

      // Helper to validate a chosen activity
      function validate(type, specialName, blockDef) {
        const slots = blockDef.slots || [];
        const startTime = blockDef.startTime;
        const endTime = blockDef.endTime;

        if (type === "Swim") {
          return pickValidSwim(bunkName, divName, slots, startTime, endTime);
        }

        if (type === "Special") {
          return pickValidSpecial(
            specialName,
            fallbackActivity,
            bunkName,
            divName,
            slots,
            startTime,
            endTime
          );
        }

        if (type === "Fallback") {
          return pickValidFallback(
            fallbackActivity,
            bunkName,
            divName,
            slots,
            startTime,
            endTime
          );
        }

        return { type: "Free", name: "Free" };
      }

      // FIRST BLOCK
      const firstType = getsSpecial
        ? (even ? "Swim" : "Special")
        : (even ? "Swim" : "Fallback");

      const firstSpecialName =
        getsSpecial && !even ? specialAssignments[bunkName] : null;

      const validA = validate(firstType, firstSpecialName, blockA);

      overrides.push({
        bunkName,
        blockId: blockA.id,
        activityType: validA.type,
        specialName: validA.name
      });

      // SECOND BLOCK
      const secondType = getsSpecial
        ? (even ? "Special" : "Swim")
        : (even ? "Fallback" : "Swim");

      const secondSpecialName =
        getsSpecial && even ? specialAssignments[bunkName] : null;

      const validB = validate(secondType, secondSpecialName, blockB);

      overrides.push({
        bunkName,
        blockId: blockB.id,
        activityType: validB.type,
        specialName: validB.name
      });

      // UPDATE HISTORY
      const bunkHist = ensureHistoryForBunk(updatedHistory, bunkName);

      if (validA.type === "Special" || validB.type === "Special") {
        bunkHist.totalSpecials++;
        const used = validA.type === "Special" ? validA.name :
                     validB.type === "Special" ? validB.name : null;
        if (used) bumpSpecialCountForBunk(bunkHist, used);
      }

      if (validA.type === "Fallback" || validB.type === "Fallback") {
        bunkHist.totalFallbacks++;
      }
    });

    return { overrides, updatedHistory };
  }

  // --------------------------------------------------------------------------
  // RUN MULTIPLE CONFIGS (unchanged)
  // --------------------------------------------------------------------------

  function runSmartTilesForDay(smartTilesForDay, history) {
    let currentHistory = JSON.parse(JSON.stringify(history || { byBunk: {} }));
    const allOverrides = [];

    (smartTilesForDay || []).forEach((cfg) => {
      const result = runSmartTileConfig(cfg, currentHistory);
      allOverrides.push(...result.overrides);
      currentHistory = result.updatedHistory;
    });

    return {
      overrides: allOverrides,
      updatedHistory: currentHistory
    };
  }

  window.SmartTilesEngine = { runSmartTilesForDay };
})();
