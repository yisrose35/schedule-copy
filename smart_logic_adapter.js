// =================================================================
// smart_logic_adapter.js
//
// Smart Tiles adapter (Main1/Main2):
//  • PHASED PAIRING: Phase 1 assigns fairly between main1/main2.
//    Phase 2 forces the opposite main for every bunk.
//  • REAL-TIME CAPACITY for specific specials (Gameroom/Canteen/...)
//  • Availability & disabled lists respected
//  • Per-main fallback (fallbackActivity tied to main1 or main2)
// =================================================================

(function () {
  'use strict';

  // ---- helpers ---------------------------------------------------
  const isSwim = (x) => !!x && /swim/i.test(String(x));
  const isString = (v) => typeof v === 'string' && v.trim().length > 0;

  const normalizeCategory = (val) => {
    const s = String(val || '').trim().toLowerCase();
    if (!s) return null;
    if (s.includes('sport')) return 'Sports Slot';
    if (s.includes('special') && !s.includes('league')) return 'Special Activity';
    if (s === 'general' || s.includes('general activity')) return 'General Activity Slot';
    if (s.includes('swim')) return 'Swim';
    return val; // specific resource name, leave as-is
  };

  const isGenericCategory = (val) => {
    const n = normalizeCategory(val);
    return n === 'Sports Slot' || n === 'Special Activity' || n === 'General Activity Slot';
  };

  // day-scoped pairing memory by division
  window.__smartPairState = window.__smartPairState || {}; // { [divName]: { phase:1|2, memo:{bunk:'main1'|'main2'} } }

  // ----------------------------------------------------------------
  const SmartLogicAdapter = {
    // Fairness engine between two mains, with capacity/availability guard.
    generateAssignments(bunks, config, hist, checker) {
      const { main1, main2, fallbackActivity, fallbackFor, maxMain1Count } = config;

      // tally counts of "main1" and "main2" from history (include fallback in that main's count)
      const stats = {};
      bunks.forEach((b) => {
        const bc = hist?.[b] || {};
        const c1 = (bc[main1] || 0) + ((fallbackFor === 'main1' && fallbackActivity) ? (bc[fallbackActivity] || 0) : 0);
        const c2 = (bc[main2] || 0) + ((fallbackFor === 'main2' && fallbackActivity) ? (bc[fallbackActivity] || 0) : 0);
        stats[b] = { m1: c1, m2: c2, total: c1 + c2 };
      });

      // sort by fewest total, then biggest need-gap (m2 - m1)
      const pool = [...bunks]
        .sort((a, b) => stats[a].total - stats[b].total)
        .sort((a, b) => (stats[b].m2 - stats[b].m1) - (stats[a].m2 - stats[a].m1));

      const out = {};
      let main1Given = 0;

      for (const bunk of pool) {
        // preferred alternation (roughly half main1, half main2)
        let prefer = main1Given < (maxMain1Count ?? Math.ceil(bunks.length / 2)) ? 'main1' : 'main2';
        // pick the string to try first
        let first = prefer === 'main1' ? main1 : main2;
        let second = null;

        // fallback only applies to whichever main it belongs to
        if (prefer === fallbackFor && isString(fallbackActivity)) {
          second = fallbackActivity;
        }

        // try preferred; if not available, try its fallback if defined; otherwise accept generic category (always allowed)
        const tryPick = (name) => (!!checker ? checker(name) : true);

        let chosen = null;
        if (tryPick(first)) {
          chosen = first;
          if (prefer === 'main1') main1Given++;
        } else if (second && tryPick(second)) {
          chosen = second; // counts for the same main
          if (prefer === 'main1') main1Given++;
        } else {
          // last resort: normalize to generic so Pass 4 can fill it
          const generic = normalizeCategory(first) || 'General Activity Slot';
          chosen = generic;
          if (prefer === 'main1') main1Given++;
        }

        out[bunk] = { chosen, main: prefer };
      }

      return out; // { bunk: { chosen: 'Gameroom'|'Sports Slot'|..., main:'main1'|'main2' } }
    },

    processSmartTiles(
      schedulableSlotBlocks,
      historicalCounts,
      specialActivityNames,
      fillBlockFn,
      fieldUsageBySlot,
      yesterdayHistory,
      activityProperties,
      { disabledFields = [], disabledSpecials = [] } = {}
    ) {
      const smartBlocks = schedulableSlotBlocks.filter((b) => b.type === 'smart');
      if (!smartBlocks.length) return;

      const SLOT_MIN = typeof window.INCREMENT_MINS === 'number' ? window.INCREMENT_MINS : 30;

      const slotStartMin = (slotIdx) => {
        if (!window.unifiedTimes || !window.unifiedTimes[slotIdx]) return null;
        const d = new Date(window.unifiedTimes[slotIdx].start);
        return d.getHours() * 60 + d.getMinutes();
      };

      const isSlotAllowed = (slotIdx, props) => {
        if (!props) return false;
        if (props.available === false) return false;
        if (!window.unifiedTimes || !window.unifiedTimes[slotIdx]) return false;

        const start = slotStartMin(slotIdx);
        const end = start + SLOT_MIN;
        const rules = props.timeRules || [];
        const hasAvail = rules.some((r) => r.type === 'Available');
        let ok = !hasAvail;
        for (const r of rules) {
          if (r.type === 'Available' && start >= r.startMin && end <= r.endMin) { ok = true; break; }
        }
        for (const r of rules) {
          if (r.type === 'Unavailable' && start < r.endMin && end > r.startMin) { ok = false; break; }
        }
        return ok;
      };

      const allSlotsAllowed = (slots, props) => slots && slots.length && slots.every((s) => isSlotAllowed(s, props));

      const computeRemainingBySpecial = (group) => {
        const first = group.blocks[0];
        const slots = first?.slots || [];
        const divName = first?.divName;
        const remaining = {};

        (specialActivityNames || []).forEach((name) => {
          if (!name) return;
          if (disabledFields.includes(name) || disabledSpecials.includes(name)) return;
          const props = activityProperties?.[name];
          if (!props) return;

          // division restrictions
          if (props.limitUsage?.enabled && props.limitUsage.divisions && !props.limitUsage.divisions[divName]) return;
          if (!allSlotsAllowed(slots, props)) return;

          let cap = 1;
          if (props.sharable) {
            cap = (props.sharableWith && typeof props.sharableWith.capacity === 'number') ? props.sharableWith.capacity : 2;
          }
          let minRemain = Infinity;
          slots.forEach((sIdx) => {
            const used = fieldUsageBySlot[sIdx]?.[name]?.count || 0;
            minRemain = Math.min(minRemain, Math.max(cap - used, 0));
          });
          if (minRemain === Infinity) minRemain = 0;
          if (minRemain > 0) remaining[name] = minRemain;
        });

        return remaining; // e.g., { Gameroom:2, Canteen:1 }
      };

      const keyOf = (b) => `${b.divName}_${b.startTime}_${b.event}`;
      const groups = {};
      smartBlocks.forEach((b) => {
        (groups[keyOf(b)] ||= { blocks: [], data: b.smartData, timeValue: b.startTime, divName: b.divName }).blocks.push(b);
      });

      const sorted = Object.values(groups).sort((a, b) => (a.timeValue || 0) - (b.timeValue || 0));

      sorted.forEach((group) => {
        if (!group.data) return;

        const divName = group.divName;
        const bunks = group.blocks.map((b) => b.bunk);
        const ps = (window.__smartPairState[divName] ||= { phase: 1, memo: {} });

        const rawMain1 = group.data.main1;
        const rawMain2 = group.data.main2;
        const main1 = normalizeCategory(rawMain1) || rawMain1;
        const main2 = normalizeCategory(rawMain2) || rawMain2;

        const fallbackActivity = group.data.fallbackActivity ? (normalizeCategory(group.data.fallbackActivity) || group.data.fallbackActivity) : null;
        const fallbackFor = group.data.fallbackFor === 'main2' ? 'main2' : 'main1'; // default main1
        const maxSpecialBunksPerDay = group.data.maxSpecialBunksPerDay;

        // recompute remaining per special for this exact time
        const remainingBySpecial = computeRemainingBySpecial(group);
        const sumRemaining = Object.values(remainingBySpecial).reduce((a, b) => a + b, 0);
        const maxMain1Count = Math.min(
          Number.isFinite(sumRemaining) ? Math.max(sumRemaining, 0) : Math.ceil(bunks.length / 2),
          typeof maxSpecialBunksPerDay === 'number' ? maxSpecialBunksPerDay : Infinity
        );

        const availabilityChecker = (activityName) => {
          if (!isString(activityName)) return false;

          // disabled?
          if (disabledFields.includes(activityName) || disabledSpecials.includes(activityName)) return false;

          // generics and Swim are always “available” here (resolved later)
          if (isGenericCategory(activityName) || isSwim(activityName)) return true;

          // specific resource (Gameroom/Canteen/etc.)
          if ((specialActivityNames || []).includes(activityName)) {
            const left = remainingBySpecial[activityName] || 0;
            if (left > 0) {
              remainingBySpecial[activityName] = left - 1; // reserve one
              return true;
            }
            return false;
          }

          return true;
        };

        // ---------- PHASE 1: fair split between main1 and main2 ----------
        if (ps.phase === 1) {
          const results = SmartLogicAdapter.generateAssignments(
            bunks,
            { main1, main2, fallbackActivity, fallbackFor, maxMain1Count },
            historicalCounts,
            availabilityChecker
          );

          for (const [bunk, info] of Object.entries(results)) {
            const { chosen, main } = info;
            ps.memo[bunk] = main; // remember which main they effectively got

            if (!historicalCounts[bunk]) historicalCounts[bunk] = {};
            historicalCounts[bunk][chosen] = (historicalCounts[bunk][chosen] || 0) + 1;

            const block = group.blocks.find((x) => x.bunk === bunk);
            if (!block) continue;

            // specific resource → pin; Swim → pin; generic → convert to slot
            const lower = String(chosen).toLowerCase();

            if ((specialActivityNames || []).includes(chosen)) {
              fillBlockFn(block, { field: { name: chosen }, sport: null, _activity: chosen, _fixed: true }, fieldUsageBySlot, yesterdayHistory, false);
              block.processed = true;

              // mark usage so Pass 4 & later groups see exact capacity
              block.slots.forEach((sIdx) => {
                (fieldUsageBySlot[sIdx] ||= {});
                const u = (fieldUsageBySlot[sIdx][chosen] ||= { count: 0, divisions: [], bunks: {} });
                u.count++;
                if (!u.divisions.includes(block.divName)) u.divisions.push(block.divName);
                u.bunks[bunk] = chosen;
              });
            } else if (isSwim(lower)) {
              fillBlockFn(block, { field: 'Swim', _fixed: true, _activity: 'Swim' }, fieldUsageBySlot, yesterdayHistory, false);
              block.processed = true;
            } else {
              // generic → convert to slot for core generator
              const cat = normalizeCategory(chosen) || 'General Activity Slot';
              block.event = cat;
              block.type = 'slot';
            }
          }

          ps.phase = 2;
          return;
        }

        // ---------- PHASE 2: everyone must get the other main ----------
        if (ps.phase === 2) {
          // recompute remaining (phase 1 may have consumed capacity)
          const remainingNow = computeRemainingBySpecial(group);
          Object.assign(remainingBySpecial, remainingNow);

          const wantMain2 = bunks.filter((b) => ps.memo[b] === 'main1');
          const wantMain1 = bunks.filter((b) => ps.memo[b] === 'main2');

          const pickForPreferred = (preferred) => {
            // Try preferred, then its fallback (if any), else generic of preferred
            const fb = preferred === 'main1'
              ? (fallbackFor === 'main1' ? fallbackActivity : null)
              : (fallbackFor === 'main2' ? fallbackActivity : null);

            const firstName = preferred === 'main1' ? main1 : main2;
            if (availabilityChecker(firstName)) return firstName;
            if (fb && availabilityChecker(fb)) return fb;
            return normalizeCategory(firstName) || 'General Activity Slot';
          };

          const assignSet = (bunkList, preferredMainKey) => {
            bunkList.forEach((bunk) => {
              const chosen = pickForPreferred(preferredMainKey);
              if (!historicalCounts[bunk]) historicalCounts[bunk] = {};
              historicalCounts[bunk][chosen] = (historicalCounts[bunk][chosen] || 0) + 1;

              const block = group.blocks.find((x) => x.bunk === bunk);
              if (!block) return;

              if ((specialActivityNames || []).includes(chosen)) {
                fillBlockFn(block, { field: { name: chosen }, sport: null, _activity: chosen, _fixed: true }, fieldUsageBySlot, yesterdayHistory, false);
                block.processed = true;
                block.slots.forEach((sIdx) => {
                  (fieldUsageBySlot[sIdx] ||= {});
                  const u = (fieldUsageBySlot[sIdx][chosen] ||= { count: 0, divisions: [], bunks: {} });
                  u.count++;
                  if (!u.divisions.includes(block.divName)) u.divisions.push(block.divName);
                  u.bunks[bunk] = chosen;
                });
              } else if (isSwim(chosen)) {
                fillBlockFn(block, { field: 'Swim', _fixed: true, _activity: 'Swim' }, fieldUsageBySlot, yesterdayHistory, false);
                block.processed = true;
              } else {
                const cat = normalizeCategory(chosen) || 'General Activity Slot';
                block.event = cat;
                block.type = 'slot';
              }
            });
          };

          // give the opposite main
          assignSet(wantMain2, 'main2');
          assignSet(wantMain1, 'main1');

          // reset pair for this division
          window.__smartPairState[divName] = { phase: 1, memo: {} };
        }
      });
    },
  };

  window.SmartLogicAdapter = SmartLogicAdapter;
})();
