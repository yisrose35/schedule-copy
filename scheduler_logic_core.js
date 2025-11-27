// ============================================================================
// scheduler_logic_core.js
//
// UPDATED (FIXED for CAPACITY, FAIRNESS & ANTI-DOUBLE ASSIGNMENT):
// - canBlockFit now correctly handles { type: 'all' } style sharability objects.
// - Smart Tile Logic (Pass 2.5) is fully capacity-aware: it checks fieldUsageBySlot
//   before assigning. If full, it forces fallback.
// - Strict logic ensures a bunk cannot get "Gameroom" twice in one Smart Tile pair.
// - Fairness uses historical counts correctly.
// - Includes internal pairRoundRobin + assignSportsMultiRound helpers.
// ============================================================================

(function() {
  'use strict';

  // ===== CONFIG =====
  const INCREMENT_MINS = 30;
  window.INCREMENT_MINS = INCREMENT_MINS;

  const GENERATED_EVENTS = [
    'General Activity Slot',
    'Sports Slot',
    'Special Activity',
    'Swim',
    'League Game',
    'Specialty League',
    'Smart Tile'
  ];

  // ===== BASIC HELPERS =====
  function parseTimeToMinutes(str) {
    if (str == null) return null;
    if (typeof str === 'number') return str;
    if (typeof str !== 'string') return null;
    let s = str.trim().toLowerCase();
    let mer = null;
    if (s.endsWith('am') || s.endsWith('pm')) {
      mer = s.endsWith('am') ? 'am' : 'pm';
      s = s.replace(/am|pm/g, '').trim();
    } else return null;
    const m = s.match(/^(\d{1,2})\s*:\s*(\d{2})$/);
    if (!m) return null;
    let hh = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    if (Number.isNaN(hh) || Number.isNaN(mm) || mm < 0 || mm > 59) return null;
    if (mer) {
      if (hh === 12) hh = (mer === 'am') ? 0 : 12;
      else if (mer === 'pm') hh += 12;
    }
    return hh * 60 + mm;
  }

  function fieldLabel(f) {
    if (typeof f === 'string') return f;
    if (f && typeof f === 'object' && typeof f.name === 'string') return f.name;
    return '';
  }

  function fmtTime(d) {
    if (!d) return '';
    if (typeof d === 'string') d = new Date(d);
    let h = d.getHours();
    let m = d.getMinutes().toString().padStart(2, '0');
    const ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${m} ${ap}`;
  }

  function minutesToDate(mins) {
    const d = new Date(1970, 0, 1, 0, 0, 0);
    d.setMinutes(mins);
    return d;
  }

  // =====================================================================
  // MAIN ENTRY POINT
  // =====================================================================
  window.runSkeletonOptimizer = function(manualSkeleton) {
    window.scheduleAssignments = {};
    window.leagueAssignments = {};
    window.unifiedTimes = [];

    if (!manualSkeleton || manualSkeleton.length === 0) return false;

    const {
      divisions,
      availableDivisions,
      activityProperties,
      allActivities,
      h2hActivities,
      fieldsBySport,
      masterLeagues,
      masterSpecialtyLeagues,
      yesterdayHistory,
      rotationHistory,
      disabledLeagues,
      disabledSpecialtyLeagues,
      historicalCounts,
      specialActivityNames,
      disabledFields,
      disabledSpecials,
      dailyFieldAvailability,
      dailyDisabledSportsByField
    } = loadAndFilterData();

    let fieldUsageBySlot = {};
    window.fieldUsageBySlot = fieldUsageBySlot;

    // Track which sports have already been used today per league
    const dailyLeagueSportsUsage = window.dailyLeagueSportsUsage || {};
    window.dailyLeagueSportsUsage = dailyLeagueSportsUsage;

    window.activityProperties = activityProperties;

    // ============================================================
    // FAIRNESS ENGINE (Global Usage Buckets)
    // ============================================================
    const bunkCategoryBaseUsage = {};
    const bunkCategoryTodayUsage = {};

    function ensureBunkCategory(bunk) {
      if (!bunkCategoryBaseUsage[bunk]) bunkCategoryBaseUsage[bunk] = {};
      if (!bunkCategoryTodayUsage[bunk]) bunkCategoryTodayUsage[bunk] = {};
    }

    (availableDivisions || []).forEach(divName => {
      const bunksInDiv = divisions[divName]?.bunks || [];
      bunksInDiv.forEach(bunk => {
        ensureBunkCategory(bunk);
        const hist = historicalCounts[bunk] || {};
        let totalSpecials = 0;
        (specialActivityNames || []).forEach(actName => {
          const c = hist[actName] || 0;
          totalSpecials += c;
          if (c > 0) {
            bunkCategoryBaseUsage[bunk][`special:${actName}`] =
              (bunkCategoryBaseUsage[bunk][`special:${actName}`] || 0) + c;
          }
        });
        bunkCategoryBaseUsage[bunk]['special:any'] =
          (bunkCategoryBaseUsage[bunk]['special:any'] || 0) + totalSpecials;
      });
    });

    function getCategoryUsage(bunk, categoryKey) {
      ensureBunkCategory(bunk);
      const base = bunkCategoryBaseUsage[bunk][categoryKey] || 0;
      const today = bunkCategoryTodayUsage[bunk][categoryKey] || 0;
      return base + today;
    }

    function bumpCategoryUsage(bunk, categoryKey, amount = 1) {
      ensureBunkCategory(bunk);
      bunkCategoryTodayUsage[bunk][categoryKey] =
        (bunkCategoryTodayUsage[bunk][categoryKey] || 0) + amount;
    }

    function getFairnessOrderForCategory(categoryKey, bunksList) {
      const arr = (bunksList || []).slice();
      arr.sort((a, b) => {
        const ua = getCategoryUsage(a, categoryKey);
        const ub = getCategoryUsage(b, categoryKey);
        if (ua !== ub) return ua - ub; // lowest usage first

        // Secondary sort by total specials to break ties
        const ta = getCategoryUsage(a, 'special:any');
        const tb = getCategoryUsage(b, 'special:any');
        if (ta !== tb) return ta - tb;

        return Math.random() - 0.5;
      });
      return arr;
    }

    function getFairnessCategoryForSmartLabel(label) {
      if (!label) return null;
      const s = String(label).trim().toLowerCase();
      if (s.includes('sports')) return 'sport:any';
      if (s.includes('special')) return 'special:any';
      const exact = specialActivityNames || [];
      for (const name of exact) {
        if (s === String(name).trim().toLowerCase()) return `special:${name}`;
      }
      return null;
    }

    // =================================================================
    // PASS 1: TIME GRID
    // =================================================================
    let timePoints = new Set();
    timePoints.add(540);
    timePoints.add(960);
    manualSkeleton.forEach(item => {
      const s = parseTimeToMinutes(item.startTime);
      const e = parseTimeToMinutes(item.endTime);
      if (s !== null) timePoints.add(s);
      if (e !== null) timePoints.add(e);
    });
    const sortedPoints = Array.from(timePoints).sort((a, b) => a - b);
    window.unifiedTimes = [];
    for (let i = 0; i < sortedPoints.length - 1; i++) {
      const start = sortedPoints[i];
      const end = sortedPoints[i + 1];
      if (end - start >= 5) {
        window.unifiedTimes.push({
          start: minutesToDate(start),
          end: minutesToDate(end),
          label: `${fmtTime(minutesToDate(start))} - ${fmtTime(minutesToDate(end))}`
        });
      }
    }
    if (window.unifiedTimes.length === 0) {
      window.updateTable?.();
      return false;
    }

    availableDivisions.forEach(divName => {
      (divisions[divName]?.bunks || []).forEach(bunk => {
        window.scheduleAssignments[bunk] = new Array(window.unifiedTimes.length);
      });
    });

    // =================================================================
    // PASS 1.5 — Bunk-Specific Pinned Overrides
    // =================================================================
    try {
      const dailyData = window.loadCurrentDailyData?.() || {};
      const bunkOverrides = dailyData.bunkActivityOverrides || [];
      bunkOverrides.forEach(override => {
        const startMin = parseTimeToMinutes(override.startTime);
        const endMin = parseTimeToMinutes(override.endTime);
        const slots = findSlotsForRange(startMin, endMin);
        const bunk = override.bunk;
        if (window.scheduleAssignments[bunk] && slots.length > 0) {
          slots.forEach((slotIndex, idx) => {
            if (!window.scheduleAssignments[bunk][slotIndex]) {
              window.scheduleAssignments[bunk][slotIndex] = {
                field: { name: override.activity },
                sport: null,
                continuation: (idx > 0),
                _fixed: true,
                _h2h: false,
                vs: null,
                _activity: override.activity,
                _endTime: endMin
              };
            }
          });
        }
      });
    } catch (e) {
      console.error('Error placing bunk-specific overrides:', e);
    }

    function normalizeGA(name) {
      if (!name) return null;
      const s = String(name).toLowerCase().replace(/\s+/g, '');
      const keys = [
        'generalactivity',
        'activity',
        'activyty',
        'activty',
        'activityslot',
        'genactivity',
        'genact',
        'ga'
      ];
      if (keys.some(k => s.includes(k))) return 'General Activity Slot';
      return null;
    }
    function normalizeLeague(name) {
      if (!name) return null;
      const s = String(name).toLowerCase().replace(/\s+/g, '');
      const keys = ['leaguegame', 'leaguegameslot', 'leagame', 'lg', 'lgame'];
      if (keys.some(k => s.includes(k))) return 'League Game';
      return null;
    }
    function normalizeSpecialtyLeague(name) {
      if (!name) return null;
      const s = String(name).toLowerCase().replace(/\s+/g, '');
      const keys = ['specialtyleague', 'specialityleague', 'specleague', 'specialleague', 'sleauge'];
      if (keys.some(k => s.includes(k))) return 'Specialty League';
      return null;
    }

    // =================================================================
    // PASS 2 — Pinned / Split / Slot Skeleton Blocks
    // =================================================================
    const schedulableSlotBlocks = [];
    const smartTileGroups = {};

    manualSkeleton.forEach(item => {
      const allBunks = divisions[item.division]?.bunks || [];
      if (!allBunks || allBunks.length === 0) return;
      const startMin = parseTimeToMinutes(item.startTime);
      const endMin = parseTimeToMinutes(item.endTime);
      const allSlots = findSlotsForRange(startMin, endMin);
      if (allSlots.length === 0) return;

      const normGA = normalizeGA(item.event);
      const normLeague = normalizeLeague(item.event);
      const normSpecLg = normalizeSpecialtyLeague(item.event);
      const finalEventName = normGA || normSpecLg || normLeague || item.event;
      const isGeneratedEvent =
        GENERATED_EVENTS.includes(finalEventName) ||
        normGA === 'General Activity Slot' ||
        normLeague === 'League Game' ||
        normSpecLg === 'Specialty League' ||
        item.type === 'smart';

      // Pinned or non-generated events (respect disabled lists)
      if (item.type === 'pinned' || !isGeneratedEvent) {
        const isDisabledField =
          Array.isArray(disabledFields) && disabledFields.includes(item.event);
        const isDisabledSpecial =
          Array.isArray(disabledSpecials) && disabledSpecials.includes(item.event);
        if (isDisabledField || isDisabledSpecial) return;

        allBunks.forEach(bunk => {
          allSlots.forEach((slotIndex, idx) => {
            if (!window.scheduleAssignments[bunk][slotIndex]) {
              window.scheduleAssignments[bunk][slotIndex] = {
                field: { name: item.event },
                sport: null,
                continuation: idx > 0,
                _fixed: true,
                _h2h: false,
                vs: null,
                _activity: item.event,
                _endTime: endMin
              };
            }
          });
        });
      } else if (item.type === 'split') {
        if (!item.subEvents || item.subEvents.length < 2) return;
        const swimLabel = 'Swim';
        const rawGAEvent = item.subEvents[1].event;
        const gaLabel = normalizeGA(rawGAEvent) || 'General Activity Slot';

        const mid = Math.ceil(allBunks.length / 2);
        const bunksTop = allBunks.slice(0, mid);
        const bunksBottom = allBunks.slice(mid);
        const slotMid = Math.ceil(allSlots.length / 2);
        const slotsFirst = allSlots.slice(0, slotMid);
        const slotsSecond = allSlots.slice(slotMid);

        function pinSwim(bunks, slots) {
          bunks.forEach(bunk => {
            slots.forEach((slotIndex, idx) => {
              window.scheduleAssignments[bunk][slotIndex] = {
                field: { name: swimLabel },
                sport: null,
                continuation: idx > 0,
                _fixed: true,
                _h2h: false,
                vs: null,
                _activity: swimLabel
              };
            });
          });
        }
        function pushGA(bunks, slots) {
          bunks.forEach(bunk => {
            schedulableSlotBlocks.push({
              divName: item.division,
              bunk,
              event: gaLabel,
              startTime: startMin,
              endTime: endMin,
              slots
            });
          });
        }

        pinSwim(bunksTop, slotsFirst);
        pushGA(bunksBottom, slotsFirst);
        pushGA(bunksTop, slotsSecond);
        pinSwim(bunksBottom, slotsSecond);
      } else if (item.type === 'smart' && item.smartData) {
        const signature = [item.smartData.main1, item.smartData.main2].sort().join('|');
        const key = `${item.division}::${signature}`;
        if (!smartTileGroups[key]) smartTileGroups[key] = [];
        smartTileGroups[key].push({
          divName: item.division,
          startTime: startMin,
          endTime: endMin,
          slots: allSlots,
          smartData: item.smartData,
          bunks: allBunks
        });
      } else if (item.type === 'slot' && isGeneratedEvent) {
        let normalizedEvent = null;
        if (normalizeSpecialtyLeague(item.event)) normalizedEvent = 'Specialty League';
        else if (normalizeLeague(item.event)) normalizedEvent = 'League Game';
        else if (normalizeGA(item.event)) normalizedEvent = 'General Activity Slot';
        else normalizedEvent = item.event;
        allBunks.forEach(bunk => {
          schedulableSlotBlocks.push({
            divName: item.division,
            bunk,
            event: normalizedEvent,
            startTime: startMin,
            endTime: endMin,
            slots: allSlots
          });
        });
      }
    });

    // =================================================================
    // PASS 2.5 — SMART TILE LOGIC (Fairness for Generated Sides)
    // =================================================================
    Object.entries(smartTileGroups).forEach(([, blocks]) => {
      blocks.sort((a, b) => a.startTime - b.startTime);

      const divName = blocks[0].divName;
      const bunks = divisions[divName]?.bunks || [];
      if (!bunks.length) return;

      const smartDataSample = blocks[0].smartData || {};
      const main1 = smartDataSample.main1;
      const main2 = smartDataSample.main2;
      const fallbackFor = smartDataSample.fallbackFor;
      const fallbackAct = smartDataSample.fallbackActivity;

      const toKey = v => (v ? String(v).trim().toLowerCase() : '');
      const main1Key = toKey(main1);
      const main2Key = toKey(main2);
      const fbKey = toKey(fallbackFor);

      let generatedLabel = null;
      let placedLabel = null;

      if (fbKey && fbKey === main1Key) {
        generatedLabel = main1;
        placedLabel = main2;
      } else if (fbKey && fbKey === main2Key) {
        generatedLabel = main2;
        placedLabel = main1;
      } else {
        const cat1 = getFairnessCategoryForSmartLabel(main1);
        const cat2 = getFairnessCategoryForSmartLabel(main2);
        if (cat1 && !cat2) {
          generatedLabel = main1;
          placedLabel = main2;
        } else if (cat2 && !cat1) {
          generatedLabel = main2;
          placedLabel = main1;
        } else {
          generatedLabel = main1;
          placedLabel = main2;
        }
      }

      const generatedCategory = getFairnessCategoryForSmartLabel(generatedLabel);
      const fallbackCategory = fallbackAct ? getFairnessCategoryForSmartLabel(fallbackAct) : null;

      const groupGeneratedCount = {};
      bunks.forEach(b => {
        groupGeneratedCount[b] = 0;
      });

      const attemptSchedule = (bunk, activity, block) => {
        if (!activity) return false;
        const normAct = String(activity).trim().toLowerCase();
        let finalField = activity;
        let finalSport = null;
        let finalActivityType = activity;
        let success = false;

        if (normAct === 'sports' || normAct === 'sport' || normAct === 'sports slot') {
          const pick = window.findBestSportActivity?.(
            {
              divName,
              bunk,
              slots: block.slots,
              startTime: block.startTime,
              endTime: block.endTime
            },
            allActivities,
            fieldUsageBySlot,
            yesterdayHistory,
            activityProperties,
            rotationHistory,
            divisions,
            historicalCounts
          );
          if (pick) {
            finalField = pick.field;
            finalSport = pick.sport;
            if (pick._activity) finalActivityType = pick._activity;
            success = true;
          }
        } else if (normAct === 'special' || normAct === 'special activity') {
          const candidates = allActivities
            .filter(a => a.type === 'special')
            .slice()
            .sort((a, b) => {
              const ca = historicalCounts[bunk]?.[a.field] || 0;
              const cb = historicalCounts[bunk]?.[b.field] || 0;
              return ca - cb;
            });
          for (const cand of candidates) {
            if (
              canBlockFit(
                {
                  divName,
                  bunk,
                  slots: block.slots,
                  startTime: block.startTime,
                  endTime: block.endTime
                },
                cand.field,
                activityProperties,
                fieldUsageBySlot,
                cand.field
              )
            ) {
              finalField = cand.field;
              finalActivityType = cand.field;
              success = true;
              break;
            }
          }
        } else {
          if (
            canBlockFit(
              {
                divName,
                bunk,
                slots: block.slots,
                startTime: block.startTime,
                endTime: block.endTime
              },
              finalField,
              activityProperties,
              fieldUsageBySlot,
              finalActivityType
            )
          ) {
            success = true;
          }
        }

        if (success) {
          fillBlock(
            {
              divName,
              bunk,
              slots: block.slots,
              startTime: block.startTime,
              endTime: block.endTime
            },
            {
              field: finalField,
              sport: finalSport,
              _activity: finalActivityType,
              _fixed: false,
              _h2h: false
            },
            fieldUsageBySlot,
            yesterdayHistory,
            false
          );
          return true;
        }
        return false;
      };

      blocks.forEach((block, blockIndex) => {
        const isLastBlock = blockIndex === blocks.length - 1;

        if (!generatedLabel && !placedLabel) {
          bunks.forEach(bunk => {
            attemptSchedule(bunk, main1, block);
          });
          return;
        }

        const fairOrder = generatedCategory
          ? getFairnessOrderForCategory(generatedCategory, bunks)
          : bunks.slice();

        const gotGeneratedHere = {};
        fairOrder.forEach(bunk => {
          if (groupGeneratedCount[bunk] >= 1) return;
          if (gotGeneratedHere[bunk]) return;
          if (attemptSchedule(bunk, generatedLabel, block)) {
            gotGeneratedHere[bunk] = true;
            groupGeneratedCount[bunk] += 1;
            if (generatedCategory) {
              bumpCategoryUsage(bunk, generatedCategory, 1);
              if (
                generatedCategory !== 'special:any' &&
                generatedCategory.startsWith('special:')
              ) {
                bumpCategoryUsage(bunk, 'special:any', 1);
              }
            }
          }
        });

        bunks.forEach(bunk => {
          if (gotGeneratedHere[bunk]) return;

          const gotSomethingAlready =
            window.scheduleAssignments[bunk] &&
            block.slots.some(idx => window.scheduleAssignments[bunk][idx]);
          if (gotSomethingAlready) return;

          if (groupGeneratedCount[bunk] > 0 && placedLabel) {
            attemptSchedule(bunk, placedLabel, block);
            return;
          }

          if (isLastBlock && fallbackAct) {
            if (attemptSchedule(bunk, fallbackAct, block)) {
              if (fallbackCategory) {
                bumpCategoryUsage(bunk, fallbackCategory, 1);
                if (
                  fallbackCategory !== 'special:any' &&
                  fallbackCategory.startsWith('special:')
                ) {
                  bumpCategoryUsage(bunk, 'special:any', 1);
                }
              }
              return;
            }
          }

          if (placedLabel) {
            attemptSchedule(bunk, placedLabel, block);
          }
        });
      });
    });

    // =================================================================
    // PASS 3 — SPECIALTY LEAGUES
    // =================================================================
    const leagueBlocks = schedulableSlotBlocks.filter(b => b.event === 'League Game');
    const specialtyLeagueBlocks = schedulableSlotBlocks.filter(
      b => b.event === 'Specialty League'
    );
    const remainingBlocks = schedulableSlotBlocks.filter(
      b => b.event !== 'League Game' && b.event !== 'Specialty League'
    );

    const specialtyLeagueGroups = {};
    specialtyLeagueBlocks.forEach(block => {
      const key = `${block.divName}-${block.startTime}`;
      if (!specialtyLeagueGroups[key])
        specialtyLeagueGroups[key] = {
          divName: block.divName,
          startTime: block.startTime,
          endTime: block.endTime,
          slots: block.slots,
          bunks: new Set()
        };
      specialtyLeagueGroups[key].bunks.add(block.bunk);
    });

    Object.values(specialtyLeagueGroups).forEach(group => {
      const leagueEntry = Object.values(masterSpecialtyLeagues).find(
        l =>
          l.enabled &&
          !disabledSpecialtyLeagues.includes(l.name) &&
          l.divisions.includes(group.divName)
      );
      if (!leagueEntry) return;
      const allBunksInGroup = Array.from(group.bunks);
      const blockBase = {
        slots: group.slots,
        divName: group.divName,
        startTime: group.startTime,
        endTime: group.endTime
      };
      const leagueName = leagueEntry.name;
      const leagueHistory = rotationHistory.leagues[leagueName] || {};
      rotationHistory.leagues[leagueName] = leagueHistory;
      const sport = leagueEntry.sport;
      if (!sport) return;
      const bestSport = sport;
      const allMatchupLabels = [];
      const picksByTeam = {};

      if (bestSport) {
        const leagueFields = leagueEntry.fields || [];
        const leagueTeams = (leagueEntry.teams || [])
          .map(t => String(t).trim())
          .filter(Boolean);
        if (leagueFields.length !== 0 && leagueTeams.length >= 2) {
          let matchups = [];
          if (typeof window.getLeagueMatchups === 'function')
            matchups = window.getLeagueMatchups(leagueEntry.name, leagueTeams) || [];
          else matchups = pairRoundRobin(leagueTeams);

          const gamesPerField = Math.ceil(matchups.length / leagueFields.length);
          const slotCount = group.slots.length || 1;
          const usedFieldsInThisBlock = Array.from(
            { length: slotCount },
            () => new Set()
          );

          for (let i = 0; i < matchups.length; i++) {
            const [teamA, teamB] = matchups[i];
            if (teamA === 'BYE' || teamB === 'BYE') continue;
            const fieldIndex = Math.floor(i / gamesPerField);
            const fieldName = leagueFields[fieldIndex % leagueFields.length];
            const baseLabel = `${teamA} vs ${teamB} (${bestSport})`;
            let isFieldAvailable = true;
            const slotIndex = group.slots[i % slotCount];
            if (fieldUsageBySlot[slotIndex]?.[fieldName]?.count >= 1)
              isFieldAvailable = false;
            if (usedFieldsInThisBlock[i % slotCount].has(fieldName))
              isFieldAvailable = false;

            const props = activityProperties[fieldName];
            if (props) {
              if (!isTimeAvailable(slotIndex, props)) isFieldAvailable = false;
              if (
                props.preferences?.enabled &&
                props.preferences.exclusive &&
                !props.preferences.list.includes(group.divName)
              )
                isFieldAvailable = false;
              if (
                props.limitUsage?.enabled &&
                !props.limitUsage.divisions[group.divName]
              )
                isFieldAvailable = false;
            }

            let pick;
            if (fieldName && isFieldAvailable) {
              pick = {
                field: fieldName,
                sport: baseLabel,
                _h2h: true,
                vs: null,
                _activity: bestSport
              };
              markFieldUsage(
                {
                  ...blockBase,
                  _activity: bestSport,
                  bunk: 'league'
                },
                fieldName,
                fieldUsageBySlot
              );
              usedFieldsInThisBlock[i % slotCount].add(fieldName);
              allMatchupLabels.push(`${baseLabel} @ ${fieldName}`);
            } else {
              pick = {
                field: 'No Field',
                sport: baseLabel,
                _h2h: true,
                vs: null,
                _activity: bestSport
              };
              allMatchupLabels.push(`${baseLabel} (No Field)`);
            }
            picksByTeam[teamA] = pick;
            picksByTeam[teamB] = pick;
          }
        }
      }

      const noGamePick = {
        field: 'No Game',
        sport: null,
        _h2h: true,
        _activity: bestSport || 'Specialty League',
        _allMatchups: allMatchupLabels
      };
      allBunksInGroup.forEach(bunk => {
        const pickToAssign = picksByTeam[bunk] || noGamePick;
        pickToAssign._allMatchups = allMatchupLabels;
        fillBlock(
          { ...blockBase, bunk },
          pickToAssign,
          fieldUsageBySlot,
          yesterdayHistory,
          true
        );
      });
    });

    // =================================================================
    // PASS 3.5 — REGULAR LEAGUES
    // =================================================================
    const leagueGroups = {};
    leagueBlocks.forEach(block => {
      const leagueEntry = Object.entries(masterLeagues).find(
        ([name, l]) =>
          l.enabled && !disabledLeagues.includes(name) && l.divisions.includes(block.divName)
      );
      if (!leagueEntry) return;
      const leagueName = leagueEntry[0];
      if (!leagueGroups[`${leagueName}-${block.startTime}`]) {
        leagueGroups[`${leagueName}-${block.startTime}`] = {
          leagueName,
          league: leagueEntry[1],
          startTime: block.startTime,
          endTime: block.endTime,
          slots: block.slots,
          bunks: new Set()
        };
      }
      leagueGroups[`${leagueName}-${block.startTime}`].bunks.add(block.bunk);
    });

    const sortedLeagueGroups = Object.values(leagueGroups).sort(
      (a, b) => a.startTime - b.startTime
    );

    sortedLeagueGroups.forEach(group => {
      const { leagueName, league, slots } = group;
      const leagueTeams = (league.teams || [])
        .map(t => String(t).trim())
        .filter(Boolean);
      if (leagueTeams.length < 2) return;

      const allBunksInGroup = Array.from(group.bunks).sort();
      if (allBunksInGroup.length === 0) return;

      const firstBunk = allBunksInGroup[0];
      const baseDivName =
        Object.keys(divisions).find(div =>
          (divisions[div].bunks || []).includes(firstBunk)
        ) || null;
      if (!baseDivName) return;

      const blockBase = { slots, divName: baseDivName, endTime: group.endTime };

      const sports = (league.sports || []).filter(s => fieldsBySport[s]);
      if (sports.length === 0) return;

      const usedToday = dailyLeagueSportsUsage[leagueName] || new Set();
      let optimizerSports = sports.filter(s => !usedToday.has(s));
      if (optimizerSports.length === 0) optimizerSports = sports;

      const leagueHistory = rotationHistory.leagues[leagueName] || {};
      rotationHistory.leagues[leagueName] = leagueHistory;

      const leagueTeamCounts = rotationHistory.leagueTeamSports[leagueName] || {};
      rotationHistory.leagueTeamSports[leagueName] = leagueTeamCounts;

      rotationHistory.leagueTeamLastSport = rotationHistory.leagueTeamLastSport || {};
      const leagueTeamLastSport =
        rotationHistory.leagueTeamLastSport[leagueName] || {};
      rotationHistory.leagueTeamLastSport[leagueName] = leagueTeamLastSport;

      let standardMatchups = [];
      if (typeof window.getLeagueMatchups === 'function') {
        standardMatchups = window.getLeagueMatchups(leagueName, leagueTeams) || [];
      } else if (typeof window.coreGetNextLeagueRound === 'function') {
        standardMatchups =
          window.coreGetNextLeagueRound(leagueName, leagueTeams) || [];
      } else {
        standardMatchups = pairRoundRobin(leagueTeams) || [];
      }

      const slotCount = slots.length || 1;

      const evaluateMatchups = candidateMatchups => {
        const nonBye = candidateMatchups.filter(
          p => p && p[0] !== 'BYE' && p[1] !== 'BYE'
        );
        const { assignments } = assignSportsMultiRound(
          nonBye,
          optimizerSports,
          leagueTeamCounts,
          leagueHistory,
          leagueTeamLastSport
        );

        const simUsedFields = Array.from({ length: slotCount }, () => new Set());
        let successCount = 0;
        const results = [];

        nonBye.forEach((pair, idx) => {
          const [teamA, teamB] = pair;
          const preferredSport =
            assignments[idx]?.sport || optimizerSports[idx % optimizerSports.length];

          const candidateSports = [
            preferredSport,
            ...sports.filter(s => s !== preferredSport && !usedToday.has(s)),
            ...sports.filter(s => s !== preferredSport && usedToday.has(s))
          ];

          let foundField = null;
          let foundSport = preferredSport;
          const slotIdx = idx % slotCount;

          for (const s of candidateSports) {
            const possibleFields = fieldsBySport[s] || [];
            let found = null;
            for (const f of possibleFields) {
              if (
                !simUsedFields[slotIdx].has(f) &&
                (fieldUsageBySlot[slots[slotIdx]]?.[f]?.count || 0) === 0 &&
                canLeagueGameFit(blockBase, f, fieldUsageBySlot, activityProperties)
              ) {
                found = f;
                break;
              }
            }
            if (found) {
              foundField = found;
              foundSport = s;
              simUsedFields[slotIdx].add(found);
              break;
            }
          }

          if (foundField) successCount++;

          results.push({
            pair,
            sport: foundSport,
            field: foundField,
            assignments: assignments[idx]
          });
        });

        return { successCount, results, matchups: candidateMatchups, assignments };
      };

      let bestResult = evaluateMatchups(standardMatchups);
      const nonByeCount = standardMatchups.filter(
        p => p && p[0] !== 'BYE' && p[1] !== 'BYE'
      ).length;

      if (bestResult.successCount < nonByeCount) {
        const teamListCopy = [...leagueTeams];
        for (let i = 0; i < 50; i++) {
          shuffleArray(teamListCopy);
          const shuffledMatchups = pairRoundRobin(teamListCopy);
          const res = evaluateMatchups(shuffledMatchups);
          if (res.successCount > bestResult.successCount) {
            bestResult = res;
            if (res.successCount === nonByeCount) break;
          }
        }
      }

      const winningMatchups = bestResult.matchups.filter(
        p => p && p[0] !== 'BYE' && p[1] !== 'BYE'
      );

      const finalOpt = assignSportsMultiRound(
        winningMatchups,
        optimizerSports,
        leagueTeamCounts,
        leagueHistory,
        leagueTeamLastSport
      );

      rotationHistory.leagueTeamSports[leagueName] = finalOpt.updatedTeamCounts;
      rotationHistory.leagueTeamLastSport[leagueName] = finalOpt.updatedLastSports;

      const allMatchupLabels = [];
      const usedForAssignments = [];
      const usedFieldsPerSlot = Array.from({ length: slotCount }, () => new Set());

      winningMatchups.forEach((pair, idx) => {
        const [teamA, teamB] = pair;
        const preferredSport =
          finalOpt.assignments[idx]?.sport ||
          optimizerSports[idx % optimizerSports.length];

        const candidateSports = [
          preferredSport,
          ...sports.filter(s => s !== preferredSport && !usedToday.has(s)),
          ...sports.filter(s => s !== preferredSport && usedToday.has(s))
        ];

        let finalSport = preferredSport;
        let finalField = null;
        const slotIdx = idx % slotCount;

        for (const s of candidateSports) {
          const possibleFields = fieldsBySport[s] || [];
          let found = null;
          for (const f of possibleFields) {
            if (
              !usedFieldsPerSlot[slotIdx].has(f) &&
              canLeagueGameFit(blockBase, f, fieldUsageBySlot, activityProperties)
            ) {
              found = f;
              break;
            }
          }
          if (!found && possibleFields.length > 0) {
            const fallbackField =
              possibleFields[usedFieldsPerSlot[slotIdx].size % possibleFields.length];
            if (
              canLeagueGameFit(blockBase, fallbackField, fieldUsageBySlot, activityProperties)
            ) {
              found = fallbackField;
            }
          }
          if (found) {
            finalSport = s;
            finalField = found;
            usedFieldsPerSlot[slotIdx].add(found);
            break;
          }
        }

        let label = finalField
          ? `${teamA} vs ${teamB} (${finalSport}) @ ${finalField}`
          : `${teamA} vs ${teamB} (No Field)`;

        if (finalField) {
          markFieldUsage(
            {
              ...blockBase,
              _activity: finalSport,
              bunk: 'league'
            },
            finalField,
            fieldUsageBySlot
          );
          if (!dailyLeagueSportsUsage[leagueName]) {
            dailyLeagueSportsUsage[leagueName] = new Set();
          }
          dailyLeagueSportsUsage[leagueName].add(finalSport);
        }

        leagueHistory[finalSport] = Date.now();

        usedForAssignments.push({
          label,
          sport: finalSport,
          field: finalField || 'No Field',
          teamA,
          teamB
        });

        allMatchupLabels.push(label);
      });

      bestResult.matchups.forEach(pair => {
        if (!pair) return;
        const [teamA, teamB] = pair;
        if (teamA === 'BYE' || teamB === 'BYE') {
          allMatchupLabels.push(`${teamA} vs ${teamB} (BYE)`);
        }
      });

      const noGamePick = {
        field: 'No Game',
        sport: null,
        _h2h: true,
        _activity: 'League',
        _allMatchups: allMatchupLabels
      };

      let bunkPtr = 0;

      usedForAssignments.forEach(game => {
        if (bunkPtr + 1 >= allBunksInGroup.length) return;
        const bunkA = allBunksInGroup[bunkPtr];
        const bunkB = allBunksInGroup[bunkPtr + 1];
        bunkPtr += 2;

        const pick = {
          field: game.field,
          sport: game.label,
          _h2h: true,
          vs: null,
          _activity: game.sport,
          _allMatchups: allMatchupLabels
        };

        const bunkADiv =
          Object.keys(divisions).find(div =>
            (divisions[div].bunks || []).includes(bunkA)
          ) || baseDivName;
        const bunkBDiv =
          Object.keys(divisions).find(div =>
            (divisions[div].bunks || []).includes(bunkB)
          ) || baseDivName;

        fillBlock(
          {
            slots,
            bunk: bunkA,
            divName: bunkADiv,
            startTime: group.startTime,
            endTime: group.endTime + INCREMENT_MINS * slots.length
          },
          pick,
          fieldUsageBySlot,
          yesterdayHistory,
          true
        );

        fillBlock(
          {
            slots,
            bunk: bunkB,
            divName: bunkBDiv,
            startTime: group.startTime,
            endTime: group.endTime + INCREMENT_MINS * slots.length
          },
          pick,
          fieldUsageBySlot,
          yesterdayHistory,
          true
        );
      });

      while (bunkPtr < allBunksInGroup.length) {
        const leftoverBunk = allBunksInGroup[bunkPtr++];
        const bunkDivName =
          Object.keys(divisions).find(div =>
            (divisions[div].bunks || []).includes(leftoverBunk)
          ) || baseDivName;
        fillBlock(
          {
            slots,
            bunk: leftoverBunk,
            divName: bunkDivName,
            startTime: group.startTime,
            endTime: group.endTime + INCREMENT_MINS * slots.length
          },
          noGamePick,
          fieldUsageBySlot,
          yesterdayHistory,
          true
        );
      }
    });

    // =================================================================
    // PASS 4 — Remaining Schedulable Slots
    // =================================================================
    remainingBlocks.sort((a, b) => a.startTime - b.startTime);
    for (const block of remainingBlocks) {
      if (!block.slots || block.slots.length === 0) continue;
      if (!window.scheduleAssignments[block.bunk]) continue;
      if (window.scheduleAssignments[block.bunk][block.slots[0]]) continue;

      let pick = null;
      if (block.event === 'League Game' || block.event === 'Specialty League') {
        pick = { field: 'Unassigned League', sport: null, _activity: 'Free' };
      } else if (block.event === 'Special Activity') {
        pick = window.findBestSpecial?.(
          block,
          allActivities,
          fieldUsageBySlot,
          yesterdayHistory,
          activityProperties,
          rotationHistory,
          divisions,
          historicalCounts
        );
      } else if (block.event === 'Sports Slot') {
        pick = window.findBestSportActivity?.(
          block,
          allActivities,
          fieldUsageBySlot,
          yesterdayHistory,
          activityProperties,
          rotationHistory,
          divisions,
          historicalCounts
        );
      }
      if (!pick) {
        pick = window.findBestGeneralActivity?.(
          block,
          allActivities,
          h2hActivities,
          fieldUsageBySlot,
          yesterdayHistory,
          activityProperties,
          rotationHistory,
          divisions,
          historicalCounts
        );
      }
      if (pick && !isPickValidForBlock(block, pick, activityProperties, fieldUsageBySlot)) {
        pick = null;
      }
      if (pick) {
        fillBlock(block, pick, fieldUsageBySlot, yesterdayHistory, false);
      } else {
        fillBlock(
          block,
          {
            field: 'Free',
            sport: null,
            _activity: 'Free'
          },
          fieldUsageBySlot,
          yesterdayHistory,
          false
        );
      }
    }

    // =================================================================
    // PASS 5 — Update Rotation History
    // =================================================================
    try {
      const timestamp = Date.now();
      const historyToSave = rotationHistory;
      availableDivisions.forEach(divName => {
        (divisions[divName]?.bunks || []).forEach(bunk => {
          const schedule = window.scheduleAssignments[bunk] || [];
          let lastActivity = null;
          for (const entry of schedule) {
            if (entry && entry._activity && entry._activity !== lastActivity) {
              const activityName = entry._activity;
              lastActivity = activityName;
              historyToSave.bunks[bunk] = historyToSave.bunks[bunk] || {};
              historyToSave.bunks[bunk][activityName] = timestamp;
              if (
                entry._h2h &&
                entry._activity !== 'League' &&
                entry._activity !== 'No Game'
              ) {
                const leagueEntry = Object.entries(masterLeagues).find(
                  ([, l]) => l.enabled && l.divisions.includes(divName)
                );
                if (leagueEntry) {
                  const lgName = leagueEntry[0];
                  historyToSave.leagues[lgName] = historyToSave.leagues[lgName] || {};
                  historyToSave.leagues[lgName][entry._activity] = timestamp;
                }
              }
            } else if (entry && !entry.continuation) {
              lastActivity = null;
            }
          }
        });
      });
      window.saveRotationHistory?.(historyToSave);
      console.log('Smart Scheduler: Rotation history updated.');
    } catch (e) {
      console.error('Smart Scheduler: Failed to update rotation history.', e);
    }

    window.saveCurrentDailyData?.('unifiedTimes', window.unifiedTimes);
    window.updateTable?.();
    window.saveSchedule?.();
    return true;
  };

  // =====================================================================
  // HELPER FUNCTIONS
  // =====================================================================
  function findSlotsForRange(startMin, endMin) {
    const slots = [];
    if (!window.unifiedTimes || startMin == null || endMin == null) return slots;
    for (let i = 0; i < window.unifiedTimes.length; i++) {
      const slot = window.unifiedTimes[i];
      const date = new Date(slot.start);
      const slotStart = date.getHours() * 60 + date.getMinutes();
      if (slotStart >= startMin && slotStart < endMin) slots.push(i);
    }
    return slots;
  }

  function markFieldUsage(block, fieldName, fieldUsageBySlot) {
    if (!fieldName || fieldName === 'No Field' || !window.allSchedulableNames.includes(fieldName))
      return;
    for (const slotIndex of block.slots || []) {
      if (slotIndex === undefined) continue;
      fieldUsageBySlot[slotIndex] = fieldUsageBySlot[slotIndex] || {};
      const usage =
       
