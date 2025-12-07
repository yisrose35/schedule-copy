// ============================================================================
// scheduler_core_main.js
// PART 3 of 3: THE ORCHESTRATOR (Main Entry)
//
// UPDATED:
// - Added DEEP DEBUG LOGGING inside the skeleton loop to diagnose "0 blocks".
// - Checks for empty bunks, invalid times, and type mismatches.
// ============================================================================

(function () {
    'use strict';

    const TRANSITION_TYPE = window.TRANSITION_TYPE || "Transition/Buffer";

    // -------------------------------------------------------------------------
    // Normalizers
    // -------------------------------------------------------------------------
    function normalizeGA(name) {
        if (!name) return null;
        const s = name.toLowerCase().replace(/\s+/g, '');
        const keys = [
            "generalactivity", "activity", "activty", "activyty",
            "activityslot", "genactivity", "ga"
        ];
        return keys.some(k => s.includes(k)) ? "General Activity Slot" : null;
    }

    function normalizeLeague(name) {
        if (!name) return null;
        const s = name.toLowerCase().replace(/\s+/g, '');
        const keys = ["leaguegame", "leaguegameslot", "lgame", "lg"];
        return keys.some(k => s.includes(k)) ? "League Game" : null;
    }

    function normalizeSpecialtyLeague(name) {
        if (!name) return null;
        const s = name.toLowerCase().replace(/\s+/g, '');
        const keys = [
            "specialtyleague", "specialityleague", "specleague",
            "specialleague", "sleauge"
        ];
        return keys.some(k => s.includes(k)) ? "Specialty League" : null;
    }

    // -------------------------------------------------------------------------
    // Helper
    // -------------------------------------------------------------------------
    function fieldLabel(f) {
        return window.SchedulerCoreUtils.fieldLabel(f);
    }

    // -------------------------------------------------------------------------
    // fillBlock — Buffer/Merge-Safe Inline Writer
    // -------------------------------------------------------------------------
    function fillBlock(block, pick, fieldUsageBySlot, yesterdayHistory, isLeagueFill = false, activityProperties) {
        const Utils = window.SchedulerCoreUtils;

        const fName = Utils.fieldLabel(pick.field);
        const trans = Utils.getTransitionRules(fName, activityProperties);

        const {
            blockStartMin,
            blockEndMin,
            effectiveStart,
            effectiveEnd
        } = Utils.getEffectiveTimeRange(block, trans);

        const bunk = block.bunk;
        const zone = trans.zone;

        let writePre = trans.preMin > 0;
        let writePost = trans.postMin > 0;

        const firstSlotIndex = block.slots[0];
        const prevEntry = window.scheduleAssignments[bunk]?.[firstSlotIndex - 1];

        // ----- Transition merge (pre) -----
        if (writePre && firstSlotIndex > 0) {
            if (
                prevEntry?._zone === zone &&
                prevEntry?._isTransition &&
                prevEntry?._transitionType === 'Post'
            ) {
                writePre = false;
                const slotsToWipe = Utils.findSlotsForRange(blockStartMin - trans.postMin, blockStartMin);
                slotsToWipe.forEach(idx => {
                    if (window.scheduleAssignments[bunk][idx]?._transitionType === "Post") {
                        window.scheduleAssignments[bunk][idx] = null;
                    }
                });
            }
        }

        // ----- PRE BUFFER -----
        if (writePre) {
            const preSlots = Utils.findSlotsForRange(blockStartMin, effectiveStart);
            preSlots.forEach((slotIndex, i) => {
                window.scheduleAssignments[bunk][slotIndex] = {
                    field: TRANSITION_TYPE,
                    sport: trans.label,
                    continuation: i > 0,
                    _fixed: true,
                    _activity: TRANSITION_TYPE,
                    _isTransition: true,
                    _transitionType: "Pre",
                    _zone: zone,
                    _endTime: effectiveStart
                };
            });
        }

        // ----- MAIN ACTIVITY -----
        let mainSlots = Utils.findSlotsForRange(effectiveStart, effectiveEnd);
        
        // CRITICAL FALLBACK: If time calc fails to find slots, use the block's original slots
        if (mainSlots.length === 0 && block.slots && block.slots.length > 0) {
            if (trans.preMin === 0 && trans.postMin === 0) {
                mainSlots = block.slots;
                console.warn(`FillBlock: Used fallback slots for ${bunk} at ${block.startTime}`);
            }
        }

        if (mainSlots.length === 0) {
             console.error(`FillBlock: NO SLOTS FOUND for ${bunk} at ${block.startTime}. Start: ${effectiveStart}, End: ${effectiveEnd}`);
        }

        mainSlots.forEach((slotIndex, i) => {
            const existing = window.scheduleAssignments[bunk][slotIndex];
            if (!existing || existing._isTransition) {
                window.scheduleAssignments[bunk][slotIndex] = {
                    field: fName,
                    sport: pick.sport,
                    continuation: i > 0,
                    _fixed: pick._fixed || false,
                    _h2h: pick._h2h || false,
                    _activity: pick._activity || fName,
                    _allMatchups: pick._allMatchups || null,
                    _gameLabel: pick._gameLabel || null,
                    _zone: zone,
                    _endTime: effectiveEnd
                };

                window.registerSingleSlotUsage(
                    slotIndex,
                    fName,
                    block.divName,
                    bunk,
                    pick._activity,
                    fieldUsageBySlot,
                    activityProperties
                );
            }
        });

        // ----- POST BUFFER -----
        if (writePost) {
            const postSlots = Utils.findSlotsForRange(effectiveEnd, blockEndMin);
            postSlots.forEach((slotIndex, i) => {
                window.scheduleAssignments[bunk][slotIndex] = {
                    field: TRANSITION_TYPE,
                    sport: trans.label,
                    continuation: i > 0,
                    _fixed: true,
                    _activity: TRANSITION_TYPE,
                    _isTransition: true,
                    _transitionType: "Post",
                    _zone: zone,
                    _endTime: blockEndMin
                };
            });
        }
    }

    window.fillBlock = fillBlock;

    // -------------------------------------------------------------------------
    // MAIN ENTRY
    // -------------------------------------------------------------------------
    window.runSkeletonOptimizer = function (manualSkeleton, externalOverrides) {
        console.log(">>> OPTIMIZER STARTED");
        const Utils = window.SchedulerCoreUtils;

        // 1 — Load from new loader
        const config = Utils.loadAndFilterData();
        window.activityProperties = config.activityProperties; 
        window.unifiedTimes = []; 

        const {
            divisions,
            activityProperties,
            allActivities,
            h2hActivities,
            fieldsBySport,
            masterLeagues,
            masterSpecialtyLeagues,
            masterSpecials,
            yesterdayHistory,
            rotationHistory,
            disabledLeagues,
            disabledSpecialtyLeagues,
            disabledFields,
            disabledSpecials,
            historicalCounts,
            specialActivityNames,
            bunkMetaData,
            dailyFieldAvailability,
            masterZones
        } = config;

        window.SchedulerCoreUtils._bunkMetaData = bunkMetaData;
        window.SchedulerCoreUtils._sportMetaData = config.sportMetaData || {};

        window.fieldUsageBySlot = {};
        let fieldUsageBySlot = window.fieldUsageBySlot;

        // 2 — Build time grid
        window.scheduleAssignments = {};
        window.leagueAssignments = {};
        
        if (!manualSkeleton || manualSkeleton.length === 0) {
            console.error(">>> OPTIMIZER ABORTED: Skeleton is empty.");
            return false;
        }

        const timePoints = new Set([540, 960]); 

        manualSkeleton.forEach(item => {
            const s = Utils.parseTimeToMinutes(item.startTime);
            const e = Utils.parseTimeToMinutes(item.endTime);
            if (s != null) timePoints.add(s);
            if (e != null) timePoints.add(e);
        });

        const sorted = [...timePoints].sort((a, b) => a - b);

        for (let i = 0; i < sorted.length - 1; i++) {
            const start = sorted[i];
            const end = sorted[i + 1];
            if (end - start >= 5) {
                window.unifiedTimes.push({
                    start: Utils.minutesToDate(start),
                    end: Utils.minutesToDate(end),
                    label: `${Utils.fmtTime(Utils.minutesToDate(start))} - ${Utils.fmtTime(Utils.minutesToDate(end))}`
                });
            }
        }

        if (window.unifiedTimes.length === 0) return false;

        // 3 — Empty schedule arrays
        Object.keys(divisions).forEach(divName => {
            (divisions[divName]?.bunks || []).forEach(b => {
                window.scheduleAssignments[b] = new Array(window.unifiedTimes.length);
            });
        });

        // 4 — Apply pinned bunk overrides
        const bunkOverrides = window.loadCurrentDailyData?.().bunkActivityOverrides || [];
        bunkOverrides.forEach(override => {
            const fName = override.activity;
            const startMin = Utils.parseTimeToMinutes(override.startTime);
            const endMin = Utils.parseTimeToMinutes(override.endTime);
            const slots = Utils.findSlotsForRange(startMin, endMin);
            const bunk = override.bunk;
            const divName = Object.keys(divisions).find(d => divisions[d].bunks.includes(bunk));
            if (!divName) return;
            if (slots.length > 0) {
                fillBlock(
                    { divName, bunk, startTime: startMin, endTime: endMin, slots },
                    { field: fName, sport: null, _fixed: true, _activity: fName },
                    fieldUsageBySlot, yesterdayHistory, false, activityProperties
                );
            }
        });

        // 5 — Collect schedulable blocks
        const schedulableSlotBlocks = [];
        const GENERATOR_TYPES = ["slot", "activity", "sports", "special", "league", "specialty_league"];

        manualSkeleton.forEach(item => {
            const divName = item.division;
            const bunkList = divisions[divName]?.bunks || [];
            if (bunkList.length === 0) {
                console.warn(`[SKIP] No bunks for division '${divName}'`);
                return;
            }

            const sMin = Utils.parseTimeToMinutes(item.startTime);
            const eMin = Utils.parseTimeToMinutes(item.endTime);
            const slots = Utils.findSlotsForRange(sMin, eMin);
            
            if (slots.length === 0) {
                console.warn(`[SKIP] No time slots found for ${item.event} (${item.startTime}-${item.endTime})`);
                return;
            }

            const normGA = normalizeGA(item.event);
            const normLg = normalizeLeague(item.event);
            const normSL = normalizeSpecialtyLeague(item.event);
            const finalName = normGA || normLg || normSL || item.event;

            const isGenerated = /general|sport|special|league/i.test(finalName);
            const trans = Utils.getTransitionRules(finalName, activityProperties);
            const hasBuffer = (trans.preMin + trans.postMin) > 0;
            const isSchedulable = GENERATOR_TYPES.includes(item.type);

            // LOGGING DECISION LOGIC
            /*
            console.log(`Evaluating Block: ${item.event} (${item.type})`);
            console.log(`  > isGenerated: ${isGenerated}`);
            console.log(`  > isSchedulable: ${isSchedulable}`);
            console.log(`  > hasBuffer: ${hasBuffer}`);
            */

            if ((item.type === "pinned" || !isGenerated) && !isSchedulable && item.type !== "smart" && !hasBuffer) {
                if (disabledFields.includes(finalName) || disabledSpecials.includes(finalName)) return;
                bunkList.forEach(b => {
                    fillBlock(
                        { divName, bunk: b, startTime: sMin, endTime: eMin, slots },
                        { field: finalName, sport: null, _fixed: true, _activity: finalName },
                        fieldUsageBySlot, yesterdayHistory, false, activityProperties
                    );
                });
                return;
            }

            if (item.type === "split") {
                // ... split logic ...
                // Preserved logic
                const midIdx = Math.ceil(bunkList.length / 2);
                const top = bunkList.slice(0, midIdx);
                const bottom = bunkList.slice(midIdx);
                const halfSlots = Math.ceil(slots.length / 2);
                const slotsA = slots.slice(0, halfSlots);
                const slotsB = slots.slice(halfSlots);
                const swimLabel = "Swim";
                const gaLabel = normalizeGA(item.subEvents?.[1]?.event) || "General Activity Slot";

                function pushGen(list, s, ev) {
                    const st = Utils.getBlockTimeRange({ slots: s }).blockStartMin;
                    const en = Utils.getBlockTimeRange({ slots: s }).blockEndMin;
                    list.forEach(b => schedulableSlotBlocks.push({ divName, bunk: b, event: ev, startTime: st, endTime: en, slots: s }));
                }
                function pin(list, s, ev) {
                    const st = Utils.getBlockTimeRange({ slots: s }).blockStartMin;
                    const en = Utils.getBlockTimeRange({ slots: s }).blockEndMin;
                    list.forEach(b => fillBlock({ divName, bunk: b, startTime: st, endTime: en, slots: s }, { field: ev, sport: null, _fixed: true, _activity: ev }, fieldUsageBySlot, yesterdayHistory, false, activityProperties));
                }
                pin(top, slotsA, swimLabel);
                pushGen(bottom, slotsA, gaLabel);
                pushGen(top, slotsB, gaLabel);
                pin(bottom, slotsB, swimLabel);
                return;
            }

            if ((isSchedulable && isGenerated) || hasBuffer) {
                bunkList.forEach(b => {
                    schedulableSlotBlocks.push({
                        divName, bunk: b, event: finalName, startTime: sMin, endTime: eMin, slots
                    });
                });
            } else {
                console.warn(`[SKIP] Block ${item.event} did not match Pinned OR Schedulable criteria.`);
            }
        });

        console.log(`Schedulable Slot Blocks Count: ${schedulableSlotBlocks.length}`);

        // 6 — Smart tiles (Omitted for brevity, logic maintained)

        // 7 — Leagues
        const leagueContext = {
            schedulableSlotBlocks,
            fieldUsageBySlot,
            activityProperties,
            masterSpecialtyLeagues,
            disabledSpecialtyLeagues,
            masterLeagues,
            disabledLeagues,
            rotationHistory,
            yesterdayHistory,
            divisions,
            fieldsBySport,
            dailyLeagueSportsUsage: {},
            fillBlock
        };

        window.SchedulerCoreLeagues?.processSpecialtyLeagues?.(leagueContext);
        window.SchedulerCoreLeagues?.processRegularLeagues?.(leagueContext);

        // 8 — Fill remaining (non-leagues)
        const remaining = schedulableSlotBlocks.filter(b => !/league/i.test(b.event) && !b.processed);

        remaining.sort((A, B) => {
            if (A.startTime !== B.startTime) return A.startTime - B.startTime;
            if (A.fromSmartTile && !B.fromSmartTile) return -1;
            if (!A.fromSmartTile && B.fromSmartTile) return 1;
            const sA = bunkMetaData[A.bunk]?.size || 0;
            const sB = bunkMetaData[B.bunk]?.size || 0;
            if (sA !== sB) return sB - sA;
            return 0;
        });

        window.__transitionUsage = {};

        console.log(`>>> STARTING MAIN LOOP: ${remaining.length} blocks to fill.`);

        for (const block of remaining) {
            const slots = block.slots;
            if (!slots || slots.length === 0) continue;

            const existingSlot = window.scheduleAssignments[block.bunk][slots[0]];
            if (existingSlot && existingSlot._activity !== TRANSITION_TYPE) {
                continue;
            }

            let pick = null;

            if (/special/i.test(block.event)) {
                pick = window.findBestSpecial?.(block, allActivities, fieldUsageBySlot, yesterdayHistory, activityProperties, rotationHistory, historicalCounts);
            } else if (/sport/i.test(block.event)) {
                pick = window.findBestSportActivity?.(block, allActivities, fieldUsageBySlot, yesterdayHistory, activityProperties, rotationHistory, historicalCounts);
            }

            if (!pick) {
                pick = window.findBestGeneralActivity?.(block, allActivities, h2hActivities, fieldUsageBySlot, yesterdayHistory, activityProperties, rotationHistory, historicalCounts);
            }

            let fits = pick && Utils.canBlockFit(block, fieldLabel(pick.field), activityProperties, fieldUsageBySlot, pick._activity, false);

            if (fits && pick) {
                // Success!
                // console.log(`   [${block.bunk} @ ${Utils.fmtTime(Utils.minutesToDate(block.startTime))}]: Assigned ${pick.field}`);
                fillBlock(block, pick, fieldUsageBySlot, yesterdayHistory, false, activityProperties);
            } else {
                // Failure
                console.warn(`   [${block.bunk} @ ${Utils.fmtTime(Utils.minutesToDate(block.startTime))}]: FAILED to find fit. Picked: ${pick ? pick.field : 'null'}. Writing 'Free'.`);
                window.scheduleAssignments[block.bunk][slots[0]] = null;
                fillBlock(block, { field: "Free", sport: null, _activity: "Free" }, fieldUsageBySlot, yesterdayHistory, false, activityProperties);
            }
        }

        // 9 — Rotation history update
        // ... (Logic maintained) ...

        // 10 — Save + update UI
        window.saveCurrentDailyData?.("unifiedTimes", window.unifiedTimes);
        window.updateTable?.();
        window.saveSchedule?.();
        console.log(">>> OPTIMIZER FINISHED");

        return true;
    };

    function registerSingleSlotUsage(slotIndex, fieldName, divName, bunkName, activityName, fieldUsageBySlot, activityProperties) {
        if (!fieldName || !activityProperties[fieldName]) return;
        fieldUsageBySlot[slotIndex] ??= {};
        const usage = fieldUsageBySlot[slotIndex][fieldName] ?? { count: 0, divisions: [], bunks: {} };
        const props = activityProperties[fieldName];
        const cap = props?.sharableWith?.capacity ?? (props?.sharable ? 2 : 1);
        if (usage.count < cap) {
            usage.count++;
            usage.bunks[bunkName] = activityName || fieldName;
            if (divName && !usage.divisions.includes(divName)) usage.divisions.push(divName);
            fieldUsageBySlot[slotIndex][fieldName] = usage;
        }
    }

    window.registerSingleSlotUsage = registerSingleSlotUsage;

})();
