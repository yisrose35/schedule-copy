// ============================================================================
// smart_tiles_engine.js
//
// SmartTilesEngine v5
//
// HYBRID FAIRNESS + FULLY GENERIC ACTIVITIES
// -----------------------------------------
// - Global fairness: which bunks get ANY constrained "special" today.
// - Per-special fairness: which specific special (Gameroom, Canteen, etc.)
//   each bunk gets across days.
// - Works with generic Smart Tiles configured in master_schedule_builder:
//
//   Each cfg:
//     {
//       id,
//       division,
//       bunkNames: [ "Bunk 1", "Bunk 2", ... ],
//       blocks: [
//         { id, startTime, endTime },
//         { id, startTime, endTime }   // Smart Tile pair
//       ],
//       main1: "Swim",                // activity for block A
//       main2: "Special Activity",    // activity for block B
//       fallbackFor: "Special Activity",  // which main is constrained
//       fallbackActivity: "Sports",   // if constrained activity not used
//       specialsPool: [ "Gameroom", "Canteen", ... ],
//       maxSpecialBunksPerDay: Number
//     }
//
// For each bunk in a Smart Tile pair:
//   - One block is the "constrained" block: either a Special or fallbackActivity.
//   - The other block stays at its base activity (e.g., Swim).
//   - No hard-coded assumptions about Swim vs Special; it uses whatever you
//     configured in the Smart Tile prompts.
// ============================================================================

(function() {
  'use strict';

  function genId() {
    return `smart_${Math.random().toString(36).slice(2, 9)}`;
  }

  function normName(name) {
    return (name || "").toString().trim().toLowerCase();
  }

  const SmartTilesEngine = {
    /**
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
     *        main1: "Swim",
     *        main2: "Special Activity",
     *        fallbackFor: "Special Activity",      // which of main1/main2 is constrained
     *        specialsPool: [ "Gameroom", "Canteen", ... ],
     *        fallbackActivity: "Sports",
     *        maxSpecialBunksPerDay: Number
     *      }
     *
     * @param {Object} masterSettings - global settings (currently not heavily used)
     * @param {Object} history - smartTileHistory object (mutated in place)
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

      // --- Normalize history shape ---
      if (!history || typeof history !== 'object') {
        history = { byBunk: {}, bySpecial: {} };
      }
      if (!history.byBunk) history.byBunk = {};
      if (!history.bySpecial) history.bySpecial = {};

      const byBunk = history.byBunk;
      const bySpecial = history.bySpecial;
      const today = window.currentScheduleDate || null;

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

      // Helper: which special should this bunk get (use all specials fairly)
      function pickSpecialForBunk(bunk, specialsPool) {
        if (!specialsPool.length) return null;

        const bunkHist = (byBunk[bunk] && byBunk[bunk].specials) || {};
        let best = null;

        specialsPool.forEach(name => {
          const bunkCount   = bunkHist[name] || 0;
          const globalCount = bySpecial[name] || 0;

          // Personal history is heavily weighted; then global usage
          const score = bunkCount * 1000 + globalCount;

          if (!best ||
              score < best.score ||
              (score === best.score && name < best.name)) {
            best = { name, score };
          }
        });

        return best ? best.name : null;
      }

      // Helper: decide what each block's activity is for a bunk
      function resolveActivitiesForBunk(cfg, isSpecialBunk, chosenSpecial) {
        const main1 = cfg.main1 || "Swim";                         // legacy-safe defaults
        const main2 = cfg.main2 || cfg.fallbackActivity || "Sports";
        const fallbackFor = cfg.fallbackFor || null;
        const fallbackActivity = cfg.fallbackActivity || "Sports";

        let actA = main1;
        let actB = main2;

        const normFallback = normName(fallbackFor);
        const normMain1 = normName(main1);
        const normMain2 = normName(main2);

        // If there's no constrained activity configured, then:
        // - special bunks: put the special in block B by default (if any)
        // - others: keep main1/main2 as-is
        if (!normFallback) {
          if (isSpecialBunk && chosenSpecial) {
            actB = chosenSpecial;
          }
          return { actA, actB };
        }

        // Block A is constrained?
        if (normFallback === normMain1) {
          if (isSpecialBunk && chosenSpecial) {
            actA = chosenSpecial;
          } else {
            actA = fallbackActivity;
          }
        }

        // Block B is constrained?
        if (normFallback === normMain2) {
          if (isSpecialBunk && chosenSpecial) {
            actB = chosenSpecial;
          } else {
            actB = fallbackActivity;
          }
        }

        return { actA, actB };
      }

      configs.forEach(cfg => {
        const division = cfg.division;
        let bunks = (cfg.bunkNames || []).slice();
        if (!bunks.length) return;

        const blocks = (cfg.blocks || []).slice();
        if (!blocks.length) return;

        // Use the first 2 blocks as the Smart Tile pair
        const blockA = blocks[0];
        const blockB = blocks[1] || blocks[0];

        const specialsPool = (cfg.specialsPool || []).slice();
        const fallbackActivity = cfg.fallbackActivity || "Sports";

        // --- 1. GLOBAL FAIRNESS: who gets ANY special today? ---
        // Sort bunks by how many specials they've had total.
        bunks.sort((a, b) => {
          const ha = byBunk[a] || {};
          const hb = byBunk[b] || {};
          const ca = ha.anySpecialCount || 0;
          const cb = hb.anySpecialCount || 0;
          if (ca !== cb) return ca - cb;
          // deterministic tie-breaker
          return String(a).localeCompare(String(b));
        });

        const maxSpecial = Math.min(
          cfg.maxSpecialBunksPerDay || bunks.length,
          bunks.length
        );

        const specialBunks = bunks.slice(0, maxSpecial);
        const nonSpecialBunks = bunks.slice(maxSpecial);

        // --- 2. PER-SPECIAL FAIRNESS: which special each "special bunk" gets? ---

        // Special bunks: constrained block = chosenSpecial or fallback
        specialBunks.forEach(bunk => {
          ensureBunkHist(bunk);

          const chosenSpecial = specialsPool.length
            ? pickSpecialForBunk(bunk, specialsPool)
            : null;

          // If somehow no special is available, treat like a non-special bunk
          const effectiveSpecial = chosenSpecial || null;

          const acts = resolveActivitiesForBunk(cfg, !!effectiveSpecial, effectiveSpecial);
          assignBunkPair(
            bunk,
            division,
            blockA,
            blockB,
            acts.actA,
            acts.actB,
            results
          );

          // Update fairness history ONLY if they actually got a real special
          if (effectiveSpecial) {
            const rec = byBunk[bunk];
            rec.anySpecialCount = (rec.anySpecialCount || 0) + 1;
            rec.specials[effectiveSpecial] =
              (rec.specials[effectiveSpecial] || 0) + 1;
            rec.lastDate = today;

            bySpecial[effectiveSpecial] = (bySpecial[effectiveSpecial] || 0) + 1;
          }
        });

        // Non-special bunks: constrained block = fallbackActivity only
        nonSpecialBunks.forEach(bunk => {
          ensureBunkHist(bunk);

          const acts = resolveActivitiesForBunk(cfg, false, null);
          assignBunkPair(
            bunk,
            division,
            blockA,
            blockB,
            acts.actA,
            acts.actB,
            results
          );
          // No special history increment (they didn't get a special today)
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

  // Expose globally
  window.SmartTilesEngine = SmartTilesEngine;

})();
