// ============================================================================
// smart_tiles_engine.js
//
// SMART TILE PRE-PROCESSOR
// - Decides per-bunk, per-block: Swim / Special / Fallback
// - Handles:
//      • Per-day pairing: each bunk gets exactly one Swim + one "Other"
//      • Scarcity of Specials: some bunks get Fallback instead
//      • Cross-day fairness: who gets Special vs Fallback
//      • Cross-day rotation of specific Special types (Gameroom, Canteen, etc.)
// - Output is a list of bunk/block activity assignments ("overrides")
//   that the main generator will consume.
// ============================================================================

(function () {
  "use strict";

  // --------------------------------------------------------------------------
  // HISTORY SHAPE
  // --------------------------------------------------------------------------
  // history = {
  //   byBunk: {
  //     "Bunk 1": {
  //       totalSpecials: 0,
  //       totalFallbacks: 0,
  //       specialsByName: {
  //         "Gameroom": 0,
  //         "Canteen": 0,
  //         // ...
  //       }
  //     },
  //     ...
  //   }
  // }
  //
  // This is meant to live across days (persist to localStorage/server).
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
  // PRIORITY FOR "WHO GETS SPECIAL TODAY"
  // --------------------------------------------------------------------------
  // Sort key:
  //   1) totalSpecials ASC  -> fewer specials gets priority
  //   2) totalFallbacks DESC -> more fallbacks gets priority
  //   3) bunkName ASC (stable tiebreaker)
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
      // final stable alphabetic tiebreaker
      if (a.bunkName < b.bunkName) return -1;
      if (a.bunkName > b.bunkName) return 1;
      return 0;
    });

    return arr.map((x) => x.bunkName);
  }

  // --------------------------------------------------------------------------
  // ASSIGN SPECIFIC SPECIAL TYPES (GAMEROOM, CANTEEN, ETC.)
  // --------------------------------------------------------------------------
  // We want:
  //   - For each special type, bunks with LOWER count of that type go first
  //   - Then fewer totalSpecials
  //   - Then more totalFallbacks
  // --------------------------------------------------------------------------
  function assignSpecificSpecials(bunkNames, specialsPool, history) {
    const assignments = {}; // bunkName -> specialName

    // Remaining bunks that still need a specialName for today
    const remaining = new Set(bunkNames);

    if (!specialsPool || specialsPool.length === 0) {
      // Fallback: no defined pool means generic "Special"
      bunkNames.forEach((b) => {
        assignments[b] = null; // null = generic special
      });
      return assignments;
    }

    // Continue cycling through specials until every bunk has one
    while (remaining.size > 0) {
      for (let i = 0; i < specialsPool.length; i++) {
        const specialName = specialsPool[i];
        if (remaining.size === 0) break;

        // Candidates are bunks still needing a special today
        const candidates = Array.from(remaining);
        if (candidates.length === 0) break;

        // Sort candidates for THIS specialName
        const sortedCandidates = candidates
          .map((bunkName) => {
            const h = ensureHistoryForBunk(history, bunkName);
            const thisSpecialCount = getSpecialCountForBunk(h, specialName);
            return {
              bunkName,
              thisSpecialCount,
              totalSpecials: h.totalSpecials || 0,
              totalFallbacks: h.totalFallbacks || 0
            };
          })
          .sort((a, b) => {
            if (a.thisSpecialCount !== b.thisSpecialCount) {
              return a.thisSpecialCount - b.thisSpecialCount;
            }
            if (a.totalSpecials !== b.totalSpecials) {
              return a.totalSpecials - b.totalSpecials;
            }
            if (a.totalFallbacks !== b.totalFallbacks) {
              return b.totalFallbacks - a.totalFallbacks;
            }
            if (a.bunkName < b.bunkName) return -1;
            if (a.bunkName > b.bunkName) return 1;
            return 0;
          });

        const chosen = sortedCandidates[0];
        if (!chosen) continue;

        assignments[chosen.bunkName] = specialName;
        remaining.delete(chosen.bunkName);

        if (remaining.size === 0) break;
      }
    }

    return assignments;
  }

  // --------------------------------------------------------------------------
  // RUN ONE SMART TILE CONFIG
  // --------------------------------------------------------------------------
  //
  // smartTileConfig = {
  //   id: "6th-grade-smart-1",
  //   division: "6th Grade",
  //   bunkNames: ["Bunk 1", "Bunk 2", ...],
  //   blocks: [
  //     { id: "block-2", label: "2nd Period" },
  //     { id: "block-4", label: "4th Period" }
  //   ],
  //   specialsPool: ["Gameroom", "Canteen", "Art Room"],
  //   fallbackActivity: "Sports Slot",
  //   // Max number of bunks that can get a Special today
  //   // (to model scarcity of special capacity)
  //   maxSpecialBunksPerDay: 3 // optional; default = all bunks
  // }
  //
  // Returns:
  // {
  //   overrides: [
  //     { bunkName, blockId, activityType: "Swim"|"Special"|"Fallback", specialName? },
  //     ...
  //   ],
  //   updatedHistory
  // }
  // --------------------------------------------------------------------------
  function runSmartTileConfig(smartTileConfig, history) {
    const cfg = smartTileConfig;
    const updatedHistory = JSON.parse(JSON.stringify(history || { byBunk: {} }));

    const bunkNames = (cfg.bunkNames || []).slice();
    if (!bunkNames.length) {
      return { overrides: [], updatedHistory };
    }

    if (!cfg.blocks || cfg.blocks.length !== 2) {
      console.warn(
        "[SmartTiles] Each smart tile must define exactly TWO blocks.",
        cfg
      );
      return { overrides: [], updatedHistory };
    }

    const blockA = cfg.blocks[0]; // earlier period (e.g., 2nd)
    const blockB = cfg.blocks[1]; // later period (e.g., 4th)
    const fallbackActivity = cfg.fallbackActivity || "Sports Slot";
    const specialsPool = cfg.specialsPool || [];
    const maxSpecialBunksPerDay =
      typeof cfg.maxSpecialBunksPerDay === "number"
        ? Math.max(0, Math.min(bunkNames.length, cfg.maxSpecialBunksPerDay))
        : bunkNames.length; // default: everyone can get special

    // --------------------------------------
    // STEP 1 – Decide who gets Special vs Fallback today
    // --------------------------------------
    const sortedForSpecial = sortBunksForSpecialToday(bunkNames, updatedHistory);
    const bunksThatGetSpecialToday = new Set(
      sortedForSpecial.slice(0, maxSpecialBunksPerDay)
    );
    const bunksThatGetFallbackToday = new Set(
      sortedForSpecial.slice(maxSpecialBunksPerDay)
    );

    // --------------------------------------
    // STEP 2 – Assign specific special types to the "special" bunks
    // --------------------------------------
    const specialBunkNames = Array.from(bunksThatGetSpecialToday);
    const specificSpecialAssignments = assignSpecificSpecials(
      specialBunkNames,
      specialsPool,
      updatedHistory
    );

    // --------------------------------------
    // STEP 3 – Build per-bunk, per-block activity assignments
    //
    // Rule:
    //   - Each bunk gets exactly ONE Swim, ONE Other (Special or Fallback)
    //   - To mix things up a bit:
    //       • even index bunks: blockA = Swim, blockB = Other
    //       • odd index bunks:  blockA = Other, blockB = Swim
    // --------------------------------------
    const overrides = [];

    bunkNames.forEach((bunkName, idx) => {
      const getsSpecial = bunksThatGetSpecialToday.has(bunkName);
      const getsFallback = bunksThatGetFallbackToday.has(bunkName);
      const even = idx % 2 === 0;

      let firstActivityType;
      let secondActivityType;
      let firstSpecialName = null;
      let secondSpecialName = null;

      if (getsSpecial) {
        const specialName = specificSpecialAssignments[bunkName] || null;
        if (even) {
          // blockA: Swim, blockB: Special
          firstActivityType = "Swim";
          secondActivityType = "Special";
          secondSpecialName = specialName;
        } else {
          // blockA: Special, blockB: Swim
          firstActivityType = "Special";
          secondActivityType = "Swim";
          firstSpecialName = specialName;
        }
      } else if (getsFallback) {
        if (even) {
          // blockA: Swim, blockB: Fallback
          firstActivityType = "Swim";
          secondActivityType = "Fallback";
        } else {
          // blockA: Fallback, blockB: Swim
          firstActivityType = "Fallback";
          secondActivityType = "Swim";
        }
      } else {
        // Should not happen, but just in case: default Swim+Fallback
        if (even) {
          firstActivityType = "Swim";
          secondActivityType = "Fallback";
        } else {
          firstActivityType = "Fallback";
          secondActivityType = "Swim";
        }
      }

      // blockA assignment
      overrides.push({
        bunkName,
        blockId: blockA.id,
        activityType: firstActivityType,
        specialName: firstSpecialName
      });

      // blockB assignment
      overrides.push({
        bunkName,
        blockId: blockB.id,
        activityType: secondActivityType,
        specialName: secondSpecialName
      });

      // --------------------------------------
      // STEP 4 – Update history (per bunk)
      // --------------------------------------
      const bunkHist = ensureHistoryForBunk(updatedHistory, bunkName);

      // Did they get a Special today?
      const hadSpecialToday =
        firstActivityType === "Special" || secondActivityType === "Special";
      let specialUsedName = null;
      if (firstActivityType === "Special" && firstSpecialName) {
        specialUsedName = firstSpecialName;
      } else if (secondActivityType === "Special" && secondSpecialName) {
        specialUsedName = secondSpecialName;
      }

      if (hadSpecialToday) {
        bunkHist.totalSpecials = (bunkHist.totalSpecials || 0) + 1;
        if (specialUsedName) {
          bumpSpecialCountForBunk(bunkHist, specialUsedName);
        }
      }

      // Did they get Fallback today?
      const hadFallbackToday =
        firstActivityType === "Fallback" || secondActivityType === "Fallback";

      if (hadFallbackToday) {
        bunkHist.totalFallbacks = (bunkHist.totalFallbacks || 0) + 1;
      }
    });

    return { overrides, updatedHistory };
  }

  // --------------------------------------------------------------------------
  // RUN MULTIPLE SMART TILE CONFIGS FOR THE DAY
  // --------------------------------------------------------------------------
  // smartTilesForDay = [smartTileConfig, ...]
  //
  // Returns:
  // {
  //   overrides: [ ... all overrides from all tiles ... ],
  //   updatedHistory
  // }
  // --------------------------------------------------------------------------
  function runSmartTilesForDay(smartTilesForDay, history) {
    let currentHistory = JSON.parse(JSON.stringify(history || { byBunk: {} }));
    const allOverrides = [];

    (smartTilesForDay || []).forEach((cfg) => {
      const result = runSmartTileConfig(cfg, currentHistory);
      allOverrides.push.apply(allOverrides, result.overrides);
      currentHistory = result.updatedHistory;
    });

    return {
      overrides: allOverrides,
      updatedHistory: currentHistory
    };
  }

  // --------------------------------------------------------------------------
  // EXPORT
  // --------------------------------------------------------------------------
  window.SmartTilesEngine = {
    runSmartTilesForDay
  };
})();
