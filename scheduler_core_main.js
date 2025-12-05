// ============================================================================
// scheduler_core_main.js
// PART 3 of 3: THE ORCHESTRATOR (Main Entry)
//
// UPDATES:
// - Continuous Transition Merging (Zone Handshake).
// - Atomic Block Filling (Pre/Activity/Post).
// - Transition Concurrency Tracking.
// - Smart Tile Integration (Pass 2.5 restored).
// ============================================================================

(function () {
    "use strict";

    // ========================================================================
    // CONSTANTS
    // ========================================================================
    const GENERATED_EVENTS = [
        "General Activity Slot",
        "Sports Slot",
        "Special Activity",
        "Swim",
        "League Game",
        "Specialty League"
    ];

    const INCREMENT_MINS = 30;
    const TRANSITION_TYPE = window.TRANSITION_TYPE; // "Transition/Buffer"

    // ========================================================================
    // LOCAL HELPERS
    // ========================================================================

    function fieldLabel(f) {
        return window.SchedulerCoreUtils.fieldLabel(f);
    }

    function normalizeGA(name) {
        if (!name) return null;
        const s = String(name).toLowerCase().replace(/\s+/g, "");
        const keys = [
            "generalactivity",
            "activity",
            "activyty",
            "activty",
            "activityslot",
            "genactivity",
            "genact",
            "ga"
        ];
        return keys.some(k => s.includes(k)) ? "General Activity Slot" : null;
    }

    function normalizeLeague(name) {
        if (!name) return null;
        const s = String(name).toLowerCase().replace(/\s+/g, "");
        const keys = ["leaguegame", "leaguegameslot", "leagame", "lg", "lgame"];
        return keys.some(k => s.includes(k)) ? "League Game" : null;
    }

    function normalizeSpecialtyLeague(name) {
        if (!name) return null;
        const s = String(name).toLowerCase().replace(/\s+/g, "");
        const keys = [
            "specialtyleague",
            "specialityleague",
            "specleague",
            "specialleague",
            "sleauge"
        ];
        return keys.some(k => s.includes(k)) ? "Specialty League" : null;
    }

    function shuffleArray(arr) {
        if (!Array.isArray(arr)) return [];
        const a = arr.slice();
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }

    function getGeneralActivitiesDoneToday(bunkName) {
        const set = new Set();
        const sched = window.scheduleAssignments[bunkName];
        if (Array.isArray(sched)) {
            sched.forEach(s => {
                if (s && s._activity) set.add(s._activity);
            });
        }
        return set;
    }

    function sortPicksByFreshness(picks, bunkHistory) {
        return picks.sort((a, b) => {
            const tA = bunkHistory[a._activity] || 0;
            const tB = bunkHistory[b._activity] || 0;
            if (tA !== tB) return tA - tB;
            return Math.random() - 0.5;
        });
    }

    function sortPicksByIsolation(picks, slotIndex, fieldUsageBySlot) {
        return picks.sort((a, b) => {
            const nameA = fieldLabel(a.field);
            const nameB = fieldLabel(b.field);
            const usageA = fieldUsageBySlot[slotIndex]?.[nameA]?.count || 0;
            const usageB = fieldUsageBySlot[slotIndex]?.[nameB]?.count || 0;
            return usageA - usageB; // emptier fields preferred
        });
    }

    // ========================================================================
    // FILL BLOCK
    // ========================================================================
    function fillBlock(
        block,
        pick,
        fieldUsageBySlot,
        yesterdayHistory,
        isLeagueFill = false,
        activityProperties
    ) {
        const fieldName = fieldLabel(pick.field);
        const sport = pick.sport;
        const bunk = block.bunk;

        const transRules = window.SchedulerCoreUtils.getTransitionRules(
            fieldName,
            activityProperties
        );

        const {
            blockStartMin,
            blockEndMin,
            effectiveStart,
            effectiveEnd
        } = window.SchedulerCoreUtils.getEffectiveTimeRange(block, transRules);

        const preMin = transRules.preMin || 0;
        const postMin = transRules.postMin || 0;
        const zone = transRules.zone;

        let writePre = preMin > 0;
        let writePost = postMin > 0;

        // --------------------------------------------------------------------
        // CONTINUITY MERGE CHECK (Zone Handshake)
        // --------------------------------------------------------------------
        const firstSlot = block.slots[0];
        const prev = window.scheduleAssignments[bunk]?.[firstSlot - 1];

        if (writePre && firstSlot > 0) {
            if (
                prev?._zone === zone &&
                prev?._activity === TRANSITION_TYPE &&
                prev?._transitionType === "Post"
            ) {
                writePre = false;

                // Remove prior Post-buffer to merge transitions
                const prevSlots = window.SchedulerCoreUtils.findSlotsForRange(
                    blockStartMin - postMin,
                    blockStartMin
                );

                prevSlots.forEach(idx => {
                    if (
                        window.scheduleAssignments[bunk][idx]?._transitionType ===
                        "Post"
                    ) {
                        window.scheduleAssignments[bunk][idx] = null;
                    }
                });
            }
        }

        // --------------------------------------------------------------------
        // 1. PRE-BUFFER
        // --------------------------------------------------------------------
        if (writePre) {
            const preSlots = window.SchedulerCoreUtils.findSlotsForRange(
                blockStartMin,
                effectiveStart
            );

            preSlots.forEach((idx, i) => {
                window.scheduleAssignments[bunk][idx] = {
                    field: TRANSITION_TYPE,
                    sport: transRules.label,
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

        // --------------------------------------------------------------------
        // 2. ACTIVITY
        // --------------------------------------------------------------------
        const activitySlots = window.SchedulerCoreUtils.findSlotsForRange(
            effectiveStart,
            effectiveEnd
        );

        activitySlots.forEach((idx, i) => {
            const existing = window.scheduleAssignments[bunk][idx];

            if (!existing || existing._isTransition) {
                window.scheduleAssignments[bunk][idx] = {
                    field: fieldName,
                    sport: sport,
                    continuation: i > 0,
                    _fixed: pick._fixed || false,
                    _h2h: pick._h2h || false,
                    _activity: pick._activity || fieldName,
                    _allMatchups: pick._allMatchups || null,
                    _gameLabel: pick._gameLabel || null,
                    _zone: zone,
                    _endTime: effectiveEnd
                };

                if (!isLeagueFill && transRules.occupiesField) {
                    window.registerSingleSlotUsage(
                        idx,
                        fieldName,
                        block.divName,
                        block.bunk,
                        pick._activity,
                        fieldUsageBySlot,
                        activityProperties
                    );
                }
            }
        });

        // --------------------------------------------------------------------
        // 3. POST-BUFFER
        // --------------------------------------------------------------------
        if (writePost) {
            const postSlots = window.SchedulerCoreUtils.findSlotsForRange(
                effectiveEnd,
                blockEndMin
            );

            postSlots.forEach((idx, i) => {
                window.scheduleAssignments[bunk][idx] = {
                    field: TRANSITION_TYPE,
                    sport: transRules.label,
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

        // Field usage for non-buffer-occupying activities
        if (!isLeagueFill && !transRules.occupiesField) {
            activitySlots.forEach(idx => {
                window.registerSingleSlotUsage(
                    idx,
                    fieldName,
                    block.divName,
                    bunk,
                    pick._activity,
                    fieldUsageBySlot,
                    activityProperties
                );
            });
        }
    }

    window.fillBlock = fillBlock;

    // ========================================================================
    // MAIN EXPORT
    // ========================================================================
    window.runSkeletonOptimizer = function (manualSkeleton, externalOverrides) {
        // --------------------------------------------------------------------
        // INITIALIZE GLOBAL STATE
        // --------------------------------------------------------------------
        window.scheduleAssignments = {};
        window.leagueAssignments = {};
        window.unifiedTimes = [];

        if (!manualSkeleton || manualSkeleton.length === 0) return false;

        // --------------------------------------------------------------------
        // 1. LOAD ALL CONFIG
        // --------------------------------------------------------------------
        const config = window.SchedulerCoreUtils.loadAndFilterData();

        const {
            divisions,
            availableDivisions,
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
            historicalCounts,
            specialActivityNames,
            disabledFields,
            disabledSpecials,
            dailyFieldAvailability,
            bunkMetaData,
            masterZones
        } = config;

        let fieldUsageBySlot = {};
        window.fieldUsageBySlot = fieldUsageBySlot;
        window.activityProperties = activityProperties;
        window.registerSingleSlotUsage = registerSingleSlotUsage;

        // --------------------------------------------------------------------
        // 2. BUILD TIME GRID
        // --------------------------------------------------------------------
        const timePoints = new Set();
        timePoints.add(540); // 9:00
        timePoints.add(960); // 16:00

        manualSkeleton.forEach(item => {
            const s = window.SchedulerCoreUtils.parseTimeToMinutes(item.startTime);
            const e = window.SchedulerCoreUtils.parseTimeToMinutes(item.endTime);
            if (s !== null) timePoints.add(s);
            if (e !== null) timePoints.add(e);
        });

        const sorted = Array.from(timePoints).sort((a, b) => a - b);
        window.unifiedTimes = [];

        for (let i = 0; i < sorted.length - 1; i++) {
            const start = sorted[i];
            const end = sorted[i + 1];

            if (end - start >= 5) {
                window.unifiedTimes.push({
                    start: window.SchedulerCoreUtils.minutesToDate(start),
                    end: window.SchedulerCoreUtils.minutesToDate(end),
                    label:
                        `${window.SchedulerCoreUtils.fmtTime(
                            window.SchedulerCoreUtils.minutesToDate(start)
                        )} - ${window.SchedulerCoreUtils.fmtTime(
                            window.SchedulerCoreUtils.minutesToDate(end)
                        )}`
                });
            }
        }

        if (window.unifiedTimes.length === 0) return false;

        // Allocate schedule arrays
        availableDivisions.forEach(div => {
            const bunks = divisions[div]?.bunks || [];
            bunks.forEach(bunk => {
                window.scheduleAssignments[bunk] = new Array(
                    window.unifiedTimes.length
                );
            });
        });

        // --------------------------------------------------------------------
        // 3. PASS 1.5 — DAILY OVERRIDES
        // --------------------------------------------------------------------
        const bunkOverrides =
            window.loadCurrentDailyData?.().bunkActivityOverrides || [];

        bunkOverrides.forEach(override => {
            const fieldName = override.activity;
            const transRules = window.SchedulerCoreUtils.getTransitionRules(
                fieldName,
                activityProperties
            );

            const startMin = window.SchedulerCoreUtils.parseTimeToMinutes(
                override.startTime
            );
            const endMin = window.SchedulerCoreUtils.parseTimeToMinutes(
                override.endTime
            );

            const slots = window.SchedulerCoreUtils.findSlotsForRange(
                startMin,
                endMin
            );

            const bunk = override.bunk;
            const divName = Object.keys(divisions).find(d =>
                divisions[d].bunks.includes(bunk)
            );

            if (window.scheduleAssignments[bunk] && slots.length > 0) {
                fillBlock(
                    {
                        divName,
                        bunk,
                        startTime: startMin,
                        endTime: endMin,
                        slots
                    },
                    {
                        field: fieldName,
                        sport: null,
                        _fixed: true,
                        _h2h: false,
                        _activity: fieldName
                    },
                    fieldUsageBySlot,
                    yesterdayHistory,
                    false,
                    activityProperties
                );
            }
        });

        // --------------------------------------------------------------------
        // 4. PASS 2 — PARSE SKELETON
        // --------------------------------------------------------------------
        const schedulableSlotBlocks = [];

        manualSkeleton.forEach(item => {
            const bunks = divisions[item.division]?.bunks || [];
            if (!bunks.length) return;

            const startMin = window.SchedulerCoreUtils.parseTimeToMinutes(
                item.startTime
            );
            const endMin = window.SchedulerCoreUtils.parseTimeToMinutes(
                item.endTime
            );

            const slots = window.SchedulerCoreUtils.findSlotsForRange(
                startMin,
                endMin
            );

            if (!slots.length) return;

            const normGA = normalizeGA(item.event);
            const normLg = normalizeLeague(item.event);
            const normSL = normalizeSpecialtyLeague(item.event);

            const finalEvent =
                normGA || normSL || normLg || item.event;

            const isGeneratedEvent =
                GENERATED_EVENTS.includes(finalEvent) ||
                normGA ||
                normLg ||
                normSL;

            const transRules = window.SchedulerCoreUtils.getTransitionRules(
                item.event,
                activityProperties
            );

            const hasBuffer = transRules.preMin > 0 || transRules.postMin > 0;

            // ----------------------------------------------------------------
            // Pinned/manual events
            // ----------------------------------------------------------------
            if (
                (item.type === "pinned" || !isGeneratedEvent) &&
                item.type !== "smart" &&
                !hasBuffer
            ) {
                if (disabledFields.includes(item.event)) return;
                if (disabledSpecials.includes(item.event)) return;

                bunks.forEach(bunk => {
                    slots.forEach((idx, i) => {
                        if (!window.scheduleAssignments[bunk][idx]) {
                            window.scheduleAssignments[bunk][idx] = {
                                field: { name: item.event },
                                sport: null,
                                continuation: i > 0,
                                _fixed: true,
                                _h2h: false,
                                vs: null,
                                _activity: item.event,
                                _endTime: endMin
                            };

                            registerSingleSlotUsage(
                                idx,
                                item.event,
                                item.division,
                                bunk,
                                item.event,
                                fieldUsageBySlot,
                                activityProperties
                            );
                        }
                    });
                });

                return;
            }

            // ----------------------------------------------------------------
            // SPLIT BLOCK HANDLING
            // ----------------------------------------------------------------
            if (item.type === "split") {
                const midB = Math.ceil(bunks.length / 2);
                const bunksTop = bunks.slice(0, midB);
                const bunksBot = bunks.slice(midB);

                const midS = Math.ceil(slots.length / 2);
                const slotsFirst = slots.slice(0, midS);
                const slotsSecond = slots.slice(midS);

                const swimLabel = "Swim";
                const gaLabel =
                    normalizeGA(item.subEvents[1].event) ||
                    "General Activity Slot";

                function pinEvent(bunksArr, slotArr, evName) {
                    const { blockStartMin, blockEndMin } =
                        window.SchedulerCoreUtils.getBlockTimeRange({
                            slots: slotArr
                        });

                    bunksArr.forEach(bunk => {
                        fillBlock(
                            {
                                divName: item.division,
                                bunk,
                                startTime: blockStartMin,
                                endTime: blockEndMin,
                                slots: slotArr
                            },
                            {
                                field: evName,
                                sport: null,
                                _fixed: true,
                                _h2h: false,
                                _activity: evName
                            },
                            fieldUsageBySlot,
                            yesterdayHistory,
                            false,
                            activityProperties
                        );
                    });
                }

                function pushGenerated(bunksArr, slotArr, evName) {
                    const { blockStartMin, blockEndMin } =
                        window.SchedulerCoreUtils.getBlockTimeRange({
                            slots: slotArr
                        });

                    bunksArr.forEach(bunk => {
                        schedulableSlotBlocks.push({
                            divName: item.division,
                            bunk,
                            event: evName,
                            startTime: blockStartMin,
                            endTime: blockEndMin,
                            slots: slotArr
                        });
                    });
                }

                // TOP/Bottom schedule invert
                pinEvent(bunksTop, slotsFirst, swimLabel);
                pushGenerated(bunksBot, slotsFirst, gaLabel);
                pushGenerated(bunksTop, slotsSecond, gaLabel);
                pinEvent(bunksBot, slotsSecond, swimLabel);

                return;
            }

            // ----------------------------------------------------------------
            // GENERATED BLOCKS + BUF-FEATURE BLOCKS
            // ----------------------------------------------------------------
            const normalized =
                normalizeSpecialtyLeague(item.event) ||
                normalizeLeague(item.event) ||
                normalizeGA(item.event) ||
                item.event;

            if (item.type === "slot" && isGeneratedEvent || hasBuffer) {
                bunks.forEach(bunk => {
                    schedulableSlotBlocks.push({
                        divName: item.division,
                        bunk,
                        event: normalized,
                        startTime: startMin,
                        endTime: endMin,
                        slots,
                        _transRules: transRules
                    });
                });
            }
        });

        // --------------------------------------------------------------------
        // 5. PASS 2.5 — SMART TILE INTEGRATION
        // --------------------------------------------------------------------
        let smartJobs = [];

        if (
            window.SmartLogicAdapter &&
            typeof window.SmartLogicAdapter.preprocessSmartTiles === "function"
        ) {
            smartJobs = window.SmartLogicAdapter.preprocessSmartTiles(
                manualSkeleton,
                externalOverrides,
                masterSpecials
            );
        }

        smartJobs.forEach(job => {
            const bunks = window.divisions[job.division]?.bunks || [];
            if (!bunks.length) return;

            const adapterResult = SmartLogicAdapter.generateAssignments(
                bunks,
                job,
                historicalCounts,
                specialActivityNames,
                activityProperties,
                config.masterFields,
                dailyFieldAvailability,
                yesterdayHistory
            );

            const { block1Assignments, block2Assignments } = adapterResult;
            if (!block1Assignments || !block2Assignments) return;

            function pushGenerated(bunk, event, startMin, endMin) {
                const slots = window.SchedulerCoreUtils.findSlotsForRange(
                    startMin,
                    endMin
                );

                schedulableSlotBlocks.push({
                    divName: job.division,
                    bunk,
                    event,
                    startTime: startMin,
                    endTime: endMin,
                    slots,
                    fromSmartTile: true
                });
            }

            // ----- BLOCK A -----
            const slotsA = window.SchedulerCoreUtils.findSlotsForRange(
                job.blockA.startMin,
                job.blockA.endMin
            );

            Object.entries(block1Assignments).forEach(([bunk, act]) => {
                const lower = act.toLowerCase();

                if (lower.includes("sport"))
                    pushGenerated(bunk, "Sports Slot", job.blockA.startMin, job.blockA.endMin);
                else if (lower.includes("special"))
                    pushGenerated(bunk, "Special Activity Slot", job.blockA.startMin, job.blockA.endMin);
                else if (lower.includes("general activity"))
                    pushGenerated(bunk, "General Activity Slot", job.blockA.startMin, job.blockA.endMin);
                else {
                    fillBlock(
                        {
                            divName: job.division,
                            bunk,
                            startTime: job.blockA.startMin,
                            endTime: job.blockA.endMin,
                            slots: slotsA
                        },
                        {
                            field: act,
                            sport: null,
                            _fixed: true,
                            _h2h: false,
                            _activity: act
                        },
                        fieldUsageBySlot,
                        yesterdayHistory,
                        false,
                        activityProperties
                    );
                }
            });

            // ----- BLOCK B -----
            if (job.blockB) {
                const slotsB = window.SchedulerCoreUtils.findSlotsForRange(
                    job.blockB.startMin,
                    job.blockB.endMin
                );

                Object.entries(block2Assignments).forEach(([bunk, act]) => {
                    const lower = act.toLowerCase();

                    if (lower.includes("sport"))
                        pushGenerated(bunk, "Sports Slot", job.blockB.startMin, job.blockB.endMin);
                    else if (lower.includes("special"))
                        pushGenerated(bunk, "Special Activity Slot", job.blockB.startMin, job.blockB.endMin);
                    else if (lower.includes("general activity"))
                        pushGenerated(bunk, "General Activity Slot", job.blockB.startMin, job.blockB.endMin);
                    else {
                        fillBlock(
                            {
                                divName: job.division,
                                bunk,
                                startTime: job.blockB.startMin,
                                endTime: job.blockB.endMin,
                                slots: slotsB
                            },
                            {
                                field: act,
                                sport: null,
                                _fixed: true,
                                _h2h: false,
                                _activity: act
                            },
                            fieldUsageBySlot,
                            yesterdayHistory,
                            false,
                            activityProperties
                        );
                    }
                });
            }
        });

        // --------------------------------------------------------------------
        // 6. PASS 3 & 3.5 — LEAGUES
        // --------------------------------------------------------------------
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

        window.SchedulerCoreLeagues.processSpecialtyLeagues(leagueContext);
        window.SchedulerCoreLeagues.processRegularLeagues(leagueContext);

        // --------------------------------------------------------------------
        // 7. PASS 4 — REMAINING GENERATED BLOCKS
        // --------------------------------------------------------------------
        const remainingBlocks = schedulableSlotBlocks.filter(
            b =>
                b.event !== "League Game" &&
                b.event !== "Specialty League" &&
                !b.processed
        );

        remainingBlocks.sort((a, b) => {
            if (a.startTime !== b.startTime) return a.startTime - b.startTime;

            if (a.fromSmartTile && !b.fromSmartTile) return -1;
            if (!a.fromSmartTile && b.fromSmartTile) return 1;

            const sizeA = bunkMetaData[a.bunk]?.size || 0;
            const sizeB = bunkMetaData[b.bunk]?.size || 0;
            if (sizeA !== sizeB) return sizeB - sizeA;

            const countA = historicalCounts[a.bunk]?.["_totalSpecials"] || 0;
            const countB = historicalCounts[b.bunk]?.["_totalSpecials"] || 0;
            return countA - countB;
        });

        window.__transitionUsage = {};

        for (const block of remainingBlocks) {
            if (!block.slots?.length) continue;
            if (!window.scheduleAssignments[block.bunk]) continue;

            const first = window.scheduleAssignments[block.bunk][block.slots[0]];
            if (first && first._activity !== TRANSITION_TYPE) continue;

            let pick = null;

            if (
                block.event === "Special Activity" ||
                block.event === "Special Activity Slot"
            ) {
                pick = window.findBestSpecial(
                    block,
                    allActivities,
                    fieldUsageBySlot,
                    yesterdayHistory,
                    activityProperties,
                    rotationHistory,
                    divisions,
                    historicalCounts
                );
            } else if (block.event === "Sports Slot" || block.event === "Sports") {
                pick = window.findBestSportActivity(
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
                pick = window.findBestGeneralActivity(
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

            let fits =
                pick &&
                window.SchedulerCoreUtils.canBlockFit(
                    block,
                    fieldLabel(pick.field),
                    activityProperties,
                    fieldUsageBySlot,
                    pick._activity
                );

            // ----------------------------------------------------------------
            // TRANSITION CONCURRENCY CHECK
            // ----------------------------------------------------------------
            const transRules = window.SchedulerCoreUtils.getTransitionRules(
                fieldLabel(pick?.field),
                activityProperties
            );

            if (pick && (transRules.preMin > 0 || transRules.postMin > 0)) {
                const zone = transRules.zone;
                const maxConcurrent = masterZones[zone]?.maxConcurrent || 99;

                if (maxConcurrent < 99) {
                    const { blockStartMin } =
                        window.SchedulerCoreUtils.getBlockTimeRange(block);

                    const merged =
                        blockStartMin > 0 &&
                        window.scheduleAssignments[block.bunk]?.[block.slots[0] - 1]
                            ?._zone === zone;

                    if (!merged) {
                        if ((window.__transitionUsage[zone] || 0) + 1 > maxConcurrent) {
                            fits = false;
                        }
                    }
                }
            }

            // ----------------------------------------------------------------
            // APPLY PICK OR MARK FREE
            // ----------------------------------------------------------------
            if (fits && pick) {
                // count transition
                if (transRules.preMin > 0 || transRules.postMin > 0) {
                    const { blockStartMin } =
                        window.SchedulerCoreUtils.getBlockTimeRange(block);

                    const merged =
                        blockStartMin > 0 &&
                        window.scheduleAssignments[block.bunk]?.[
                            block.slots[0] - 1
                        ]?._zone === transRules.zone;

                    if (!merged) {
                        window.__transitionUsage[transRules.zone] =
                            (window.__transitionUsage[transRules.zone] || 0) + 1;
                    }
                }

                fillBlock(
                    block,
                    pick,
                    fieldUsageBySlot,
                    yesterdayHistory,
                    false,
                    activityProperties
                );

                // Update historical counts
                if (pick._activity && block.bunk) {
                    historicalCounts[block.bunk] =
                        historicalCounts[block.bunk] || {};

                    historicalCounts[block.bunk][pick._activity] =
                        (historicalCounts[block.bunk][pick._activity] || 0) + 1;

                    if (masterSpecials.some(s => s.name === pick._activity)) {
                        historicalCounts[block.bunk]["_totalSpecials"] =
                            (historicalCounts[block.bunk]["_totalSpecials"] || 0) + 1;
                    }
                }
            } else {
                if (
                    window.scheduleAssignments[block.bunk]?.[block.slots[0]]
                        ?._activity === TRANSITION_TYPE
                ) {
                    window.scheduleAssignments[block.bunk][block.slots[0]] = null;
                }

                fillBlock(
                    block,
                    { field: "Free", sport: null, _activity: "Free" },
                    fieldUsageBySlot,
                    yesterdayHistory,
                    false,
                    activityProperties
                );
            }
        }

        // --------------------------------------------------------------------
        // 8. PASS 5 — ROTATION HISTORY SAVE
        // --------------------------------------------------------------------
        try {
            const history = rotationHistory;
            const stamp = Date.now();

            availableDivisions.forEach(div => {
                divisions[div]?.bunks?.forEach(bunk => {
                    const schedule = window.scheduleAssignments[bunk] || [];
                    let last = null;

                    schedule.forEach(entry => {
                        if (
                            entry &&
                            entry._activity &&
                            entry._activity !== last &&
                            entry._activity !== TRANSITION_TYPE
                        ) {
                            const name = entry._activity;
                            last = name;

                            history.bunks[bunk] = history.bunks[bunk] || {};
                            history.bunks[bunk][name] = stamp;

                            if (
                                entry._h2h &&
                                name !== "League" &&
                                name !== "No Game"
                            ) {
                                const leagueEntry = Object.entries(masterLeagues).find(
                                    ([lg, obj]) =>
                                        obj.enabled &&
                                        obj.divisions &&
                                        obj.divisions.includes(div)
                                );

                                if (leagueEntry) {
                                    const lgName = leagueEntry[0];
                                    history.leagues[lgName] =
                                        history.leagues[lgName] || {};
                                    history.leagues[lgName][name] = stamp;
                                }
                            }
                        } else if (
                            entry &&
                            !entry.continuation &&
                            entry._activity !== TRANSITION_TYPE
                        ) {
                            last = null;
                        }
                    });
                });
            });

            window.saveRotationHistory?.(history);
            console.log("Smart Scheduler: Rotation history updated.");
        } catch (e) {
            console.error("Smart Scheduler: Failed to update rotation history.", e);
        }

        window.saveCurrentDailyData?.("unifiedTimes", window.unifiedTimes);
        window.updateTable?.();
        window.saveSchedule?.();

        return true;
    };

    // ========================================================================
    // REGISTER FIELD USAGE
    // ========================================================================
    function registerSingleSlotUsage(
        slotIndex,
        fieldName,
        divName,
        bunkName,
        activityName,
        fieldUsageBySlot,
        activityProperties
    ) {
        if (
            !fieldName ||
            !window.allSchedulableNames ||
            !window.allSchedulableNames.includes(fieldName)
        )
            return;

        fieldUsageBySlot[slotIndex] = fieldUsageBySlot[slotIndex] || {};

        const usage =
            fieldUsageBySlot[slotIndex][fieldName] || {
                count: 0,
                divisions: [],
                bunks: {}
            };

        const props = activityProperties[fieldName];
        const cap =
            props?.sharableWith?.capacity ??
            (props?.sharableWith?.type === "all"
                ? 2
                : props?.sharable
                ? 2
                : 1);

        if (usage.count < cap) {
            usage.count++;
            if (bunkName) usage.bunks[bunkName] = activityName || fieldName;
            if (divName && !usage.divisions.includes(divName)) {
                usage.divisions.push(divName);
            }
            fieldUsageBySlot[slotIndex][fieldName] = usage;
        }
    }
})();
