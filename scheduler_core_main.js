// ============================================================================
// scheduler_core_main.js  — FULL REWRITE (Option A: LEAGUE ABSOLUTE LOCK)
// ============================================================================
//
// ROLE OF THIS FILE
// This is the master orchestrator responsible for:
//   • Parsing the daily skeleton
//   • Creating the unified time grid for UI
//   • Executing the scheduling pipeline in strict priority order:
//       1. Pinned (non-generated)
//       2. Leagues  (ABSOLUTE LOCK — cannot be overwritten by ANY other pass)
//       3. Specialty Leagues (same as above)
//       4. Smart Tiles
//       5. Split Blocks
//       6. General Activities
//   • Writing assignments to both:
//       - The scheduleAssignments grid (UI-facing)
//       - The Timeline engine (constraint solver)
//
// KEY GUARANTEES (Option A):
//   • Once a league is placed for a bunk, no other pass overwrites it.
//   • fillBlock() preserves all league metadata.
//   • League timeline reservations block fields completely.
//   • Split blocks and Smart Tiles skip any bunk that already has league.
//   • General activity fill respects locked league slots completely.
//
// ============================================================================

(function() {
    'use strict';

    // Events that are "generated" by logic passes
    const GENERATED_EVENTS = [
        'General Activity Slot',
        'Sports Slot',
        'Special Activity',
        'Swim',
        'League Game',
        'Specialty League'
    ];

    // ============================================================================
    // NORMALIZERS — turns messy names into canonical labels
    // ============================================================================
    function normalizeGA(name) {
        if (!name) return null;
        const s = String(name).toLowerCase().replace(/\s+/g, '');
        const keys = ["generalactivity","activity","activyty","activityslot","genactivity","genact","ga"];
        return keys.some(k => s.includes(k)) ? "General Activity Slot" : null;
    }

    function normalizeLeague(name) {
        if (!name) return null;
        const s = String(name).toLowerCase().replace(/\s+/g, '');
        const keys = ["leaguegame","leaguegameslot","leagame","lg","lgame"];
        return keys.some(k => s.includes(k)) ? "League Game" : null;
    }

    function normalizeSpecialtyLeague(name) {
        if (!name) return null;
        const s = String(name).toLowerCase().replace(/\s+/g, '');
        const keys = ["specialtyleague","specialityleague","specleague","specialleague","sleauge"];
        return keys.some(k => s.includes(k)) ? "Specialty League" : null;
    }

    // ============================================================================
    // FILL BLOCK — THE WRITER (WITH LEAGUE LOCK PROTECTION)
    // ============================================================================
    //
    // THIS IS THE CORE FIX.
    //
    // RULES (Option A):
    //   • If a slot already contains a league event (_h2h == true),
    //       NO OTHER PASS MAY OVERWRITE IT.
    //
    //   • Otherwise, the slot is MERGED with new data — never replaced.
    //       This preserves metadata such as _allMatchups, _gameLabel, etc.
    //
    //   • Timeline is updated AFTER the scheduleAssignments grid.
    //
    // ============================================================================

    function fillBlock(block, pick, fieldUsageBySlot, yesterdayHistory, isLeague = false) {
        const fieldName = window.SchedulerCoreUtils.fieldLabel(pick.field);

        // ---------------------------------------------------------------------
        // 1. Write to scheduleAssignments (UI grid)
        // ---------------------------------------------------------------------
        (block.slots || []).forEach((slotIndex, idx) => {
            if (slotIndex === undefined || !window.scheduleAssignments[block.bunk])
                return;

            const existing = window.scheduleAssignments[block.bunk][slotIndex];

            // LEAGUE ABSOLUTE LOCK
            if (existing && existing._h2h) {
                // A league lives here — nothing overwrites this slot.
                return;
            }

            // Merge new + old
            const merged = {
                ...existing,
                field: fieldName ?? existing?.field,
                sport: pick.sport ?? existing?.sport,
                continuation: (idx > 0),

                // Preserve fixed markers
                _fixed: existing?._fixed || !!pick._fixed,

                // Preserve League Metadata
                _h2h: existing?._h2h || !!pick._h2h,
                _allMatchups: pick._allMatchups || existing?._allMatchups || null,
                _gameLabel: pick._gameLabel || existing?._gameLabel || null,

                // Activity label
                _activity: pick._activity || existing?._activity || null
            };

            window.scheduleAssignments[block.bunk][slotIndex] = merged;
        });

        // ---------------------------------------------------------------------
        // 2. Write to TIMELINE
        // ---------------------------------------------------------------------
        if (fieldName && !["Free","No Game","No Field"].includes(fieldName)) {
            const { blockStartMin, blockEndMin } = window.SchedulerCoreUtils.getBlockTimeRange(block);

            if (blockStartMin != null && blockEndMin != null) {
                let weight = 1;
                const props = window.activityProperties[fieldName];

                // League = BUYOUT
                if (isLeague) {
                    weight = props?.sharableWith?.capacity || (props?.sharable ? 2 : 2);
                    if (weight < 2) weight = 2;
                }

                window.SchedulerCoreUtils.timeline.addReservation(
                    fieldName,
                    blockStartMin,
                    blockEndMin,
                    weight,
                    block.bunk
                );
            }
        }
    }

    // ============================================================================
    // MAIN RUN FUNCTION (This controls the entire scheduling pipeline)
    // ============================================================================

    window.runSkeletonOptimizer = function(manualSkeleton, externalOverrides) {

        // ---------------------------------------------------------
        // Reset global state
        // ---------------------------------------------------------
        window.scheduleAssignments = {};
        window.unifiedTimes = [];

        if (!manualSkeleton || manualSkeleton.length === 0)
            return false;

        // ---------------------------------------------------------
        // Load system data from core
        // ---------------------------------------------------------
        const config = window.SchedulerCoreUtils.loadAndFilterData();

        const {
            divisions, availableDivisions, activityProperties, allActivities,
            h2hActivities, fieldsBySport, masterLeagues, masterSpecialtyLeagues,
            masterSpecials, yesterdayHistory, rotationHistory,
            disabledLeagues, disabledSpecialtyLeagues,
            historicalCounts, dailyFieldAvailability, bunkMetaData,
            specialActivityNames
        } = config;

        window.activityProperties = activityProperties;

        // ---------------------------------------------------------
        // Build unified UI time grid
        // ---------------------------------------------------------
        let timePoints = new Set();
        timePoints.add(540);  // 9:00
        timePoints.add(960);  // 16:00

        manualSkeleton.forEach(item => {
            const s = window.SchedulerCoreUtils.parseTimeToMinutes(item.startTime);
            const e = window.SchedulerCoreUtils.parseTimeToMinutes(item.endTime);
            if (s != null) timePoints.add(s);
            if (e != null) timePoints.add(e);
        });

        const sortedPoints = [...timePoints].sort((a,b)=>a-b);

        window.unifiedTimes = [];
        for (let i = 0; i < sortedPoints.length - 1; i++) {
            const start = sortedPoints[i];
            const end = sortedPoints[i+1];
            if (end - start >= 5) {
                window.unifiedTimes.push({
                    start: window.SchedulerCoreUtils.minutesToDate(start),
                    end: window.SchedulerCoreUtils.minutesToDate(end),
                    label: `${window.SchedulerCoreUtils.fmtTime(window.SchedulerCoreUtils.minutesToDate(start))} - ${window.SchedulerCoreUtils.fmtTime(window.SchedulerCoreUtils.minutesToDate(end))}`
                });
            }
        }

        // ---------------------------------------------------------
        // Init all bunk assignment arrays
        // ---------------------------------------------------------
        availableDivisions.forEach(divName => {
            (divisions[divName]?.bunks || []).forEach(bunk => {
                window.scheduleAssignments[bunk] = new Array(window.unifiedTimes.length);
            });
        });

        // ---------------------------------------------------------
        // Convert skeleton to schedulable blocks
        // ---------------------------------------------------------
        const schedulableSlotBlocks = [];

        manualSkeleton.forEach(item => {
            const bunks = divisions[item.division]?.bunks || [];
            if (!bunks.length) return;

            const startMin = window.SchedulerCoreUtils.parseTimeToMinutes(item.startTime);
            const endMin = window.SchedulerCoreUtils.parseTimeToMinutes(item.endTime);
            const slots = window.SchedulerCoreUtils.findSlotsForRange(startMin, endMin);

            const normGA = normalizeGA(item.event);
            const normLeague = normalizeLeague(item.event);
            const normSpec = normalizeSpecialtyLeague(item.event);
            const finalEventName = normGA || normSpec || normLeague || item.event;

            const isGen = GENERATED_EVENTS.includes(finalEventName)
                       || normGA === "General Activity Slot"
                       || normLeague === "League Game"
                       || normSpec === "Specialty League";

            // -------- PINNED (non-generated) --------
            if ((item.type === 'pinned' || !isGen) &&
                item.type !== 'smart' &&
                item.type !== 'split' &&
                !item.event.toLowerCase().includes("league"))
            {
                bunks.forEach(bunk => {
                    const pick = {
                        field: item.event,
                        sport: null,
                        _activity: item.event,
                        _fixed: true
                    };
                    fillBlock(
                        { slots, bunk, startTime: startMin, endTime: endMin },
                        pick, {}, {}, false
                    );
                });
                return;
            }

            // -------- Split --------
            if (item.type === 'split') {
                schedulableSlotBlocks.push({
                    ...item, slots, startMin, endMin, bunks
                });
                return;
            }

            // -------- Smart Tile --------
            if (item.type === 'smart') {
                schedulableSlotBlocks.push({
                    ...item, slots, startMin, endMin, bunks
                });
                return;
            }

            // -------- General or Generated --------
            bunks.forEach(bunk => {
                schedulableSlotBlocks.push({
                    divName: item.division,
                    bunk,
                    event: finalEventName,
                    startTime: startMin,
                    endTime: endMin,
                    slots
                });
            });
        });


        // ============================================================================
        // PHASE 2: LEAGUES & SPECIALTY LEAGUES
        // (ABSOLUTE LOCK — highest priority except pinned)
        // ============================================================================
        const context = {
            schedulableSlotBlocks,
            activityProperties,
            masterLeagues,
            masterSpecialtyLeagues,
            rotationHistory,
            yesterdayHistory,
            divisions,
            fieldsBySport,
            fillBlock,
            dailyLeagueSportsUsage: {}
        };

        if (window.SchedulerCoreLeagues) {
            window.SchedulerCoreLeagues.processSpecialtyLeagues(context);
            window.SchedulerCoreLeagues.processRegularLeagues(context);
        }


        // ============================================================================
        // PHASE 3: SMART TILES
        // ============================================================================
        const smartBlocks = schedulableSlotBlocks.filter(b => b.type === 'smart');

        if (smartBlocks.length > 0 && window.SmartLogicAdapter) {

            const jobs = window.SmartLogicAdapter.preprocessSmartTiles(
                smartBlocks, {}, masterSpecials
            );

            const writeAssignments = (assignments, blockInfo) => {
                if (!assignments || !blockInfo) return;

                const slots =
                    window.SchedulerCoreUtils.findSlotsForRange(
                        blockInfo.startMin,
                        blockInfo.endMin
                    );

                Object.entries(assignments).forEach(([bunk, act]) => {

                    // If bunk already has LEAGUE → skip (absolute lock)
                    const firstSlot = slots[0];
                    const existing =
                        window.scheduleAssignments[bunk]?.[firstSlot];
                    if (existing && existing._h2h) return;

                    let pick = { field: act, _activity: act };

                    // Map generic "Sport" → specific best sport
                    if (act.includes("Sport")) {
                        pick = window.findBestSportActivity(
                            { bunk, divName: blockInfo.division,
                              startTime: blockInfo.startMin,
                              endTime: blockInfo.endMin },
                            allActivities, {}, yesterdayHistory,
                            activityProperties, rotationHistory, divisions,
                            historicalCounts
                        );
                    }
                    else {
                        // Validate specific pick with Timeline
                        const isValid = window.SchedulerCoreUtils.canBlockFit(
                            { bunk, divName: blockInfo.division,
                              startTime: blockInfo.startMin,
                              endTime: blockInfo.endMin,
                              slots },
                            window.SchedulerCoreUtils.fieldLabel(act),
                            activityProperties,
                            act,
                            false
                        );

                        if (!isValid) return;
                    }

                    if (pick) {
                        fillBlock(
                            { slots, bunk,
                              startTime: blockInfo.startMin,
                              endTime: blockInfo.endMin },
                            pick, {}, {}, false
                        );
                    }
                });
            };

            // Write smart tile results for each block pair
            jobs.forEach(job => {
                writeAssignments(job.block1Assignments, job.blockA);
                writeAssignments(job.block2Assignments, job.blockB);
            });
        }


        // ============================================================================
        // PHASE 4: SPLIT BLOCKS  (Skip any bunk locked by league)
        // ============================================================================

        const splitBlocks = schedulableSlotBlocks.filter(b => b.type === 'split');

        splitBlocks.forEach(sb => {
            const mid = Math.floor(sb.startMin + (sb.endMin - sb.startMin) / 2);

            const midIdx = Math.ceil(sb.bunks.length / 2);
            const group1 = sb.bunks.slice(0, midIdx);
            const group2 = sb.bunks.slice(midIdx);

            const e1 = sb.subEvents[0].event;
            const e2 = sb.subEvents[1].event;

            const resolvePick = (bunk, evt, st, et) => {
                const norm = normalizeGA(evt);
                if (evt === 'Swim')
                    return { field: 'Swim', _activity: 'Swim' };

                if (norm === "General Activity Slot" || evt.includes("Sport")) {
                    return window.findBestGeneralActivity(
                        { bunk, divName: sb.division, startTime: st, endTime: et },
                        allActivities, h2hActivities, {},
                        yesterdayHistory, activityProperties, rotationHistory,
                        divisions, historicalCounts
                    );
                }

                return { field: evt, _activity: evt };
            };

            // First Half
            const slots1 =
                window.SchedulerCoreUtils.findSlotsForRange(sb.startMin, mid);

            group1.forEach(bunk => {
                const exists =
                    window.scheduleAssignments[bunk]?.[slots1[0]];
                if (exists && exists._h2h) return; // league lock

                fillBlock(
                    { slots: slots1, bunk, startTime: sb.startMin, endTime: mid },
                    resolvePick(bunk, e1, sb.startMin, mid), {}, {}, false
                );
            });

            group2.forEach(bunk => {
                const exists =
                    window.scheduleAssignments[bunk]?.[slots1[0]];
                if (exists && exists._h2h) return;

                fillBlock(
                    { slots: slots1, bunk, startTime: sb.startMin, endTime: mid },
                    resolvePick(bunk, e2, sb.startMin, mid), {}, {}, false
                );
            });

            // Second Half
            const slots2 =
                window.SchedulerCoreUtils.findSlotsForRange(mid, sb.endMin);

            group1.forEach(bunk => {
                const exists =
                    window.scheduleAssignments[bunk]?.[slots2[0]];
                if (exists && exists._h2h) return;

                fillBlock(
                    { slots: slots2, bunk, startTime: mid, endTime: sb.endMin },
                    resolvePick(bunk, e2, mid, sb.endMin), {}, {}, false
                );
            });

            group2.forEach(bunk => {
                const exists =
                    window.scheduleAssignments[bunk]?.[slots2[0]];
                if (exists && exists._h2h) return;

                fillBlock(
                    { slots: slots2, bunk, startTime: mid, endTime: sb.endMin },
                    resolvePick(bunk, e1, mid, sb.endMin), {}, {}, false
                );
            });
        });


        // ============================================================================
        // PHASE 5: GENERAL ACTIVITIES  (Skip locked league cells)
        // ============================================================================

        const generalBlocks = schedulableSlotBlocks.filter(b =>
            !b.type &&
            !b.event.includes('League') &&
            !b.event.includes('Specialty League')
        );

        // Larger bunks first (stabilizes fairness)
        generalBlocks.sort((a,b) =>
            (bunkMetaData[b.bunk]?.size || 0) -
            (bunkMetaData[a.bunk]?.size || 0)
        );

        generalBlocks.forEach(block => {
            const exists =
                window.scheduleAssignments[block.bunk]?.[block.slots[0]];

            if (exists && exists._h2h) return; // league lock

            let pick = null;

            if (block.event.includes('Special')) {
                pick = window.findBestSpecial(
                    block, allActivities, {}, yesterdayHistory,
                    activityProperties, rotationHistory, divisions,
                    historicalCounts
                );
            }
            else if (block.event.includes('Sport')) {
                pick = window.findBestSportActivity(
                    block, allActivities, {}, yesterdayHistory,
                    activityProperties, rotationHistory,
                    divisions, historicalCounts
                );
            }
            else {
                pick = window.findBestGeneralActivity(
                    block, allActivities, h2hActivities, {}, yesterdayHistory,
                    activityProperties, rotationHistory, divisions,
                    historicalCounts
                );
            }

            if (pick) {
                fillBlock(block, pick, {}, yesterdayHistory, false);

                // Update historical usage
                if (pick._activity && block.bunk) {
                    historicalCounts[block.bunk] =
                        historicalCounts[block.bunk] || {};
                    historicalCounts[block.bunk][pick._activity] =
                        (historicalCounts[block.bunk][pick._activity] || 0) + 1;

                    const isSpecial =
                        masterSpecials.some(s => s.name === pick._activity);
                    if (isSpecial) {
                        historicalCounts[block.bunk]['_totalSpecials'] =
                            (historicalCounts[block.bunk]['_totalSpecials'] || 0) + 1;
                    }
                }
            }
            else {
                fillBlock(
                    block,
                    { field: "Free", sport: null, _activity: "Free" },
                    {}, {}, false
                );
            }
        });

        // ============================================================================
        // SAVE HISTORY + UPDATE UI
        // ============================================================================

        try {
            const historyToSave = rotationHistory;
            const timestamp = Date.now();

            availableDivisions.forEach(divName => {
                (divisions[divName]?.bunks || []).forEach(bunk => {
                    const schedule = window.scheduleAssignments[bunk] || [];
                    let lastActivity = null;

                    for (const entry of schedule) {
                        if (entry && entry._activity && entry._activity !== lastActivity) {
                            lastActivity = entry._activity;
                            historyToSave.bunks[bunk] =
                                historyToSave.bunks[bunk] || {};
                            historyToSave.bunks[bunk][lastActivity] = timestamp;

                            // League-specific historical tracker
                            if (entry._h2h && lastActivity !== "League") {
                                const leagueEntry =
                                    Object.entries(masterLeagues).find(
                                        ([lgName, lg]) =>
                                            lg.enabled &&
                                            lg.divisions &&
                                            lg.divisions.includes(divName)
                                    );
                                if (leagueEntry) {
                                    const lgName = leagueEntry[0];
                                    historyToSave.leagues[lgName] =
                                        historyToSave.leagues[lgName] || {};
                                    historyToSave.leagues[lgName][lastActivity] = timestamp;
                                }
                            }
                        }
                    }
                });
            });

            window.saveRotationHistory?.(historyToSave);
        }
        catch(e) {
            console.error("Failed to update rotation history:", e);
        }

        // Save grid + UI refresh
        window.saveCurrentDailyData("unifiedTimes", window.unifiedTimes);
        window.updateTable?.();
        window.saveSchedule?.();

        return true;
    };

})();
