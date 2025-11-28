(function(){
  'use strict';

  /* =====================================================================
     SMART LOGIC ADAPTER — STEP 3 (FINAL, DROP‑IN READY)
     ---------------------------------------------------------------------
     This module pre‑processes Smart Tiles BEFORE logic_core runs.

     It determines:
       • main1 / main2 activities
       • which blocks require generation
       • fallback relationship
       • special‑activity capacity per block
       • fairness ordering
       • final block1/block2 assignments per bunk

     It outputs a job object with block1/block2 assignments for logic_core.
  ====================================================================== */

  const SmartLogicAdapter = {

    /* --------------------------------------------------------------
       ENTRY POINT
       -------------------------------------------------------------- */
    preprocessSmartTiles: function(dailySkeleton, dailyAdjustments, specialDefinitions) {
      let smartTiles = dailySkeleton.filter(ev => ev.type === 'smart');
      if (!smartTiles.length) return [];

      let jobs = [];
      for (const tile of smartTiles) {
        const job = this.buildSmartJob(tile, dailyAdjustments, specialDefinitions);
        if (job) jobs.push(job);
      }
      return jobs;
    },


    /* --------------------------------------------------------------
       BUILD JOB FOR ONE SMART TILE
       -------------------------------------------------------------- */
    buildSmartJob: function(tile, dailyAdjustments, specialDefs) {
      const sd = tile.smartData;
      if (!sd) return null;

      const main1 = sd.main1.trim();
      const main2 = sd.main2.trim();
      const fallbackTarget = sd.fallbackFor.trim();
      const fallbackActivity = sd.fallbackActivity.trim();

      const main1IsGen = this.needsGeneration(main1);
      const main2IsGen = this.needsGeneration(main2);

      // Two blocks always
      const block1Cap = this.computeSpecialCapacityForBlock(main1, tile, dailyAdjustments, specialDefs);
      const block2Cap = this.computeSpecialCapacityForBlock(main2, tile, dailyAdjustments, specialDefs);

      return {
        tileId: tile.id,
        division: tile.division,
        startTime: tile.startTime,
        endTime: tile.endTime,

        main1,
        main2,
        generated1: main1IsGen,
        generated2: main2IsGen,

        fallbackTarget,
        fallbackActivity,

        block1Capacity: block1Cap,
        block2Capacity: block2Cap,

        isGeneratedBlock1: main1IsGen,
        isGeneratedBlock2: main2IsGen
      };
    },


    /* --------------------------------------------------------------
       CHECK WHETHER AN ACTIVITY REQUIRES GENERATION
       -------------------------------------------------------------- */
    needsGeneration: function(activityName) {
      const n = activityName.toLowerCase();
      if (n.includes('general activity') || n === 'activity') return true;
      if (n.includes('sports')) return true;
      if (n.includes('special')) return true;
      return false; // e.g. Swim, Lunch, Dismissal → pinned
    },


    /* --------------------------------------------------------------
       COMPUTE SPECIAL CAPACITY FOR ONE BLOCK
       -------------------------------------------------------------- */
    computeSpecialCapacityForBlock: function(activityName, tile, dailyAdjustments, specialDefs) {
      const isSpecial = activityName.toLowerCase().includes('special');
      if (!isSpecial) return Infinity;

      const specials = specialDefs || [];
      const disabled = dailyAdjustments?.disabledSpecials || [];

      let usable = specials.filter(s => s.available && !disabled.includes(s.name));
      if (!usable.length) return 0;

      let sum = 0;
      for (const s of usable) {
        let cap = s.sharableWith?.capacity || 1;
        sum += cap;
      }
      return sum;
    },


    /* --------------------------------------------------------------
       FINAL ASSIGNMENT LOGIC (FAIRNESS + PAIRING)
       -------------------------------------------------------------- */
    generateAssignments: function(bunks, job, historicalCounts) {
      const main1 = job.main1;
      const main2 = job.main2;
      const fallback = job.fallbackActivity;
      const fallbackTarget = job.fallbackTarget;

      // ------------------------------------------------------------
      // 1. FAIRNESS ORDERING
      // ------------------------------------------------------------
      let sorted = bunks.map(b => ({
        bunk: b,
        specialCount: historicalCounts[b]?.specialCount || 0
      }));

      sorted.sort((a,b) => a.specialCount - b.specialCount);

      // ------------------------------------------------------------
      // 2. BLOCK 1 ASSIGNMENT
      // ------------------------------------------------------------
      let block1 = {};
      let cap1 = job.block1Capacity;

      for (const obj of sorted) {
        const b = obj.bunk;

        if (job.isGeneratedBlock1 && main1.toLowerCase().includes('special')) {
          if (cap1 > 0) {
            block1[b] = main1;
            cap1--;
          } else {
            // fallback for main1
            block1[b] = fallback;
          }
        } else {
          // pinned or non-special
          block1[b] = main1;
        }
      }

      // ------------------------------------------------------------
      // 3. BLOCK 2 ASSIGNMENT (DEPENDENT ON BLOCK 1)
      // ------------------------------------------------------------
      let block2 = {};
      let cap2 = job.block2Capacity;

      for (const obj of sorted) {
        const b = obj.bunk;
        const got1 = block1[b];

        // ABSOLUTE PAIRING RULES
        if (got1 === main1) {
          // must get main2
          if (job.isGeneratedBlock2 && main2.toLowerCase().includes('special')) {
            if (cap2 > 0) {
              block2[b] = main2;
              cap2--;
            } else {
              block2[b] = fallback;
            }
          } else {
            block2[b] = main2;
          }
          continue;
        }

        if (got1 === fallback) {
          // treated like zero-credit main1 → must still get main2
          if (job.isGeneratedBlock2 && main2.toLowerCase().includes('special')) {
            if (cap2 > 0) {
              block2[b] = main2;
              cap2--;
            } else {
              block2[b] = fallback;
            }
          } else {
            block2[b] = main2;
          }
          continue;
        }

        // Standard case
        if (job.isGeneratedBlock2 && main2.toLowerCase().includes('special')) {
          if (cap2 > 0) {
            block2[b] = main2;
            cap2--;
          } else {
            block2[b] = fallback;
          }
        } else {
          block2[b] = main2;
        }
      }

      return {
        block1: block1,
        block2: block2
      };
    }
  };

  window.SmartLogicAdapter = SmartLogicAdapter;
})();
