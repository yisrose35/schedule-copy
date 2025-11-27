// ============================================================================
// smart_tiles_engine.js
//
// SmartTilesEngine v4.1
// - Hybrid fairness:
//     • Global: Who gets ANY special today
//     • Per-special: Which special each bunk gets
// - For each Smart Tile pair (usually 2 blocks per division):
//     • Every bunk gets exactly 1 Swim
//     • Some bunks get 1 Special, others get 1 Fallback
//     • No bunk gets 2 specials or 2 swims
// - Uses all specials from `specialsPool` and rotates them fairly
// - Integrates with daily_adjustments.js applySmartTileOverridesForToday()
// - NEW:
//     • Per-day hash tie-breaker so "Bunk 1" and "Bunk 2" don't always win.
//     • runSmartTilesForDay(configs, historyIn) → {overrides, updatedHistory}
//       so daily_adjustments can persist counts cleanly.
// ============================================================================

(function() {
  'use strict';

  function genId() {
    return `smart_${Math.random().toString(36).slice(2, 9)}`;
  }

  // Simple deterministic hash for tie-breaking
  function hashString(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = ((h << 5) - h) + str.charCodeAt(i);
      h |= 0; // keep 32-bit
    }
    return h;
  }

  const SmartTilesEngine = {
    /**
     * Core runner
     *
     * @param {Array} configs - Smart tile configs built in applySmartTileOverridesForToday()
     *    Each cfg:
     *      {
     *        id,
     *        division,
     *        bunkNames: [ "Bunk 1", "Bunk 2", ... ],
     *        blocks: [
     *          { id, startTime, endTime },
     *          { id, startTime, endTime }
     *        ],
     *        specialsPool: [ "Gameroom", "Canteen", ... ],
     *        fallbackActivity: "Sports",
     *        maxSpecialBunksPerDay: Number
     *      }
     *
     * @param {Object} masterSettings - global settings (not heavily used here)
     * @param {Object} history - smartTileHistory object (MUTATED IN PLACE)
     *
     * @returns {Array} overrides:
     *      [
     *        {
     *          id,
     *          bunk,
     *          activity,
     *          startTime,
     *          endTime,
     *          divName
     *        },
     *        ...
     *      ]
     */
    run(configs, masterSettings, history) {
      const results = [];
      if (!Array.isArray(configs) || configs.length === 0) return results;

      // --- Normalize / create history object ---
      if (!history || typeof history !== 'object') {
        history = { byBunk: {}, bySpecial: {} };
      }
      if (!history.byBunk) history.byBunk = {};
      if (!history.bySpecial) history.bySpecial = {};

      const byBunk = history.byBunk;
      const bySpecial = history.bySpecial;
      const today = window.currentScheduleDate || null;
      const todayKey = today || 'no-date';

      configs.forEach(cfg => {
        const division = cfg.division;
        let bunks = (cfg.bunkNames || []).slice();
        if (!bunks.length) return;

        const blocks = (cfg.blocks || []).slice();
        if (!blocks.length) return;

        // We use the FIRST TWO blocks as the Smart Tile pair
        const blockA = blocks[0];
        const blockB = blocks[1] || blocks[0]; // if only one, double-use it

        const specialsPool = (cfg.specialsPool || []).slice();
        if (!specialsPool.length) {
          // If no specials, everyone just gets Swim + fallback
          assignNoSpecialScenario(bunks, division, blockA, blockB, cfg.fallbackActivity, results);
          return;
        }

        const fallbackActivity = cfg.fallbackActivity || "Sports";

        // --- 1. GLOBAL FAIRNESS: who gets ANY special today? ---
        bunks.sort((a, b) => {
          const ha = byBunk[a] || {};
          const hb = byBunk[b] || {};
          const ca = ha.anySpecialCount || 0;
          const cb = hb.anySpecialCount || 0;

          if (ca !== cb) return ca - cb;

          // Per-day tie-breaker so "Bunk 1" & "Bunk 2" don't always win.
          const ka = hashString(todayKey + "::" + String(a));
          const kb = hashString(todayKey + "::" + String(b));
          if (ka === kb) return 0;
          return ka < kb ? -1 : 1;
        });

        const maxSpecial = Math.min(
          cfg.maxSpecialBunksPerDay || bunks.length,
          bunks.length
        );

        const specialBunks    = bunks.slice(0, maxSpecial);
        const nonSpecialBunks = bunks.slice(maxSpecial);

        // --- 2. PER-SPECIAL FAIRNESS: which special does each "special bunk" get? ---
        function pickSpecialForBunk(bunk) {
          if (!specialsPool.length) return null;

          const bunkHist = (byBunk[bunk] && byBunk[bunk].specials) || {};
          let best = null;

          specialsPool.forEach(name => {
            const bunkCount   = bunkHist[name] || 0;
            const globalCount = bySpecial[name] || 0;

            // Lower is better; weight personal history more heavily
            const score = bunkCount * 1000 + globalCount;

            if (!best ||
                score < best.score ||
                (score === best.score && name < best.name)) {
              best = { name, score };
            }
          });

          return best ? best.name : null;
        }

        // Helper: ensure bunk has history record
        function ensureBunkHist(bunkName) {
          if (!byBunk[bunkName]) {
            byBunk[bunkName] = {
              anySpecialCount: 0,
              specials: {},
              lastDate: null
            };
          } else if (!byBunk[bunkName].specials) {
            byBunk[bunkName].specials = {};
          }
        }

        // --- 3. Build per-bunk assignments (2 blocks each) ---

        // Special bunks: 1 Swim + 1 Special
        specialBunks.forEach(bunk => {
          ensureBunkHist(bunk);

          const chosenSpecial = pickSpecialForBunk(bunk);
          if (!chosenSpecial) {
            // If somehow no special is available, fall back to "no special" behavior for this bunk.
            assignBunkPair(bunk, division, blockA, blockB, "Swim", fallbackActivity, results);
            return;
          }

          // 1 Swim + 1 Special
          assignBunkPair(bunk, division, blockA, blockB, "Swim", chosenSpecial, results);

          // Update fairness history
          byBunk[bunk].anySpecialCount = (byBunk[bunk].anySpecialCount || 0) + 1;
          byBunk[bunk].specials[chosenSpecial] =
            (byBunk[bunk].specials[chosenSpecial] || 0) + 1;
          byBunk[bunk].lastDate = today;

          bySpecial[chosenSpecial] = (bySpecial[chosenSpecial] || 0) + 1;
        });

        // Non-special bunks: 1 Swim + 1 Fallback (never special)
        nonSpecialBunks.forEach(bunk => {
          assignBunkPair(bunk, division, blockA, blockB, "Swim", fallbackActivity, results);
        });
      });

      return results;
    }
  };

  // Helper: assign 2 blocks to a bunk (first + second activity)
  function assignBunkPair(bunk, division, blockA, blockB, firstActivity, secondActivity, results) {
    // Block A
    results.push({
      id: genId(),
      bunk: bunk,
      activity: firstActivity,
      startTime: blockA.startTime,
      endTime: blockA.endTime,
      divName: division
    });

    // Block B
    results.push({
      id: genId(),
      bunk: bunk,
      activity: secondActivity,
      startTime: blockB.startTime,
      endTime: blockB.endTime,
      divName: division
    });
  }

  // Helper: scenario where there are no specials (just Swim + fallback)
  function assignNoSpecialScenario(bunks, division, blockA, blockB, fallbackActivity, results) {
    const fb = fallbackActivity || "Sports";
    bunks.forEach(bunk => {
      assignBunkPair(bunk, division, blockA, blockB, "Swim", fb, results);
    });
  }

  // ---------------------------------------------------------------------------
  // Convenience wrapper for daily_adjustments:
  // returns BOTH the overrides and the updated history object.
  // ---------------------------------------------------------------------------
  SmartTilesEngine.runSmartTilesForDay = function(configs, historyIn) {
    // Ensure we always pass a real object into run()
    const history =
      historyIn && typeof historyIn === "object"
        ? historyIn
        : { byBunk: {}, bySpecial: {} };

    const overrides = SmartTilesEngine.run(configs, null, history);
    return {
      overrides: Array.isArray(overrides) ? overrides : [],
      updatedHistory: history
    };
  };

  // Expose globally
  window.SmartTilesEngine = SmartTilesEngine;

})();
