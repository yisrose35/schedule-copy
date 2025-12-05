// ============================================================================
// scheduler_core_utils.js
// PART 1 of 3: THE FOUNDATION
//
// UPDATES:
// - Added Transition Logic, Zone Handshake, Buffer Occupancy, Concurrency Check
// - Implemented Minimum Duration Check (Issue 1)
// - Implemented Anchor Time Logic (User Requirement)
// - FIX: Added null check for 'props' in getTransitionRules to prevent crash.
// ============================================================================

(function () {
    'use strict';

    // ===== CONFIG =====
    const INCREMENT_MINS = 30;
    window.INCREMENT_MINS = INCREMENT_MINS;

    const TRANSITION_TYPE = "Transition/Buffer";
    window.TRANSITION_TYPE = TRANSITION_TYPE;

    const Utils = {};

    // =================================================================
    // 1. BASIC HELPERS
    // =================================================================

    Utils.parseTimeToMinutes = function (str) {
        if (str == null) return null;
        if (typeof str === "number") return str;
        if (typeof str !== "string") return null;

        let s = str.trim().toLowerCase();
        let mer = null;

        if (s.endsWith("am") || s.endsWith("pm")) {
            mer = s.endsWith("am") ? "am" : "pm";
            s = s.replace(/am|pm/gi, "").trim();
        } else {
            return null;
        }

        const m = s.match(/^(\d{1,2})\s*:\s*(\d{2})$/);
        if (!m) return null;

        let hh = parseInt(m[1], 10);
        const mm = parseInt(m[2], 10);

        if (Number.isNaN(hh) || Number.isNaN(mm) || mm < 0 || mm > 59) return null;

        if (mer) {
            if (hh === 12) hh = mer === "am" ? 0 : 12;
            else if (mer === "pm") hh += 12;
        }

        return hh * 60 + mm;
    };

    Utils.fieldLabel = function (f) {
        if (typeof f === "string") return f;
        if (f && typeof f === "object" && typeof f.name === "string") return f.name;
        return "";
    };

    Utils.fmtTime = function (d) {
        if (!d) return "";
        if (typeof d === 'string') d = new Date(d);

        let h = d.getHours();
        let m = d.getMinutes().toString().padStart(2, "0");
        const ap = h >= 12 ? "PM" : "AM";
        h = h % 12 || 12;
        return `${h}:${m} ${ap}`;
    };

    Utils.minutesToDate = function (mins) {
        const d = new Date(1970, 0, 1, 0, 0, 0);
        d.setMinutes(mins);
        return d;
    };

    Utils.findSlotsForRange = function (startMin, endMin) {
        const slots = [];
        if (!window.unifiedTimes || startMin == null || endMin == null) return slots;

        for (let i = 0; i < window.unifiedTimes.length; i++) {
            const slot = window.unifiedTimes[i];
            const slotStart = new Date(slot.start).getHours() * 60 + new Date(slot.start).getMinutes();

            // Overlap check: slot starts within [startMin, endMin)
            if (slotStart >= startMin && slotStart < endMin) {
                slots.push(i);
            }
        }
        return slots;
    };

    Utils.getBlockTimeRange = function (block) {
        let blockStartMin = (typeof block.startTime === "number") ? block.startTime : null;
        let blockEndMin = (typeof block.endTime === "number") ? block.endTime : null;

        // Fallback to slot-based time if minutes not provided
        if ((blockStartMin == null || blockEndMin == null) && window.unifiedTimes && Array.isArray(block.slots) && block.slots.length > 0) {
            const minIndex = Math.min(...block.slots);
            const maxIndex = Math.max(...block.slots);

            const firstSlot = window.unifiedTimes[minIndex];
            const lastSlot = window.unifiedTimes[maxIndex];

            if (firstSlot && lastSlot) {
                const firstStart = new Date(firstSlot.start);
                blockStartMin = firstStart.getHours() * 60 + firstStart.getMinutes();
                const lastEnd = new Date(lastSlot.end);
                blockEndMin = lastEnd.getHours() * 60 + lastEnd.getMinutes();
            }
        }

        return { blockStartMin, blockEndMin };
    };

    // =================================================================
    // 2. NEW TRANSITION / BUFFER LOGIC
    // =================================================================

    Utils.getTransitionRules = function (fieldName, activityProperties) {
        const defaultRules = {
            preMin: 0,
            postMin: 0,
            label: "Travel",
            zone: window.DEFAULT_ZONE_NAME || "default",
            occupiesField: false,
            minDurationMin: 0
        };

        if (!activityProperties || typeof activityProperties !== "object") {
            return defaultRules;
        }

        const props = activityProperties[fieldName];

        // FIX: Prevent crash if props or props.transition is missing
        if (!props || !props.transition) {
            return defaultRules;
        }

        return { ...defaultRules, ...props.transition };
    };

    // Implements Anchor Time Logic (User Requirement)
    Utils.getEffectiveTimeRange = function (block, transitionRules) {
        const { blockStartMin, blockEndMin } = Utils.getBlockTimeRange(block);

        if (blockStartMin === null || blockEndMin === null) {
            return {
                effectiveStart: blockStartMin,
                effectiveEnd: blockEndMin,
                blockStartMin,
                blockEndMin,
                activityDuration: 0,
                totalDuration: 0,
                totalBuffer: 0
            };
        }

        const preMin = transitionRules.preMin || 0;
        const postMin = transitionRules.postMin || 0;

        const totalDuration = blockEndMin - blockStartMin;
        const totalBuffer = preMin + postMin;

        const effectiveStart = blockStartMin + preMin;
        const effectiveEnd = blockEndMin - postMin;
        const activityDuration = effectiveEnd - effectiveStart;

        return {
            blockStartMin,
            blockEndMin,
            effectiveStart,
            effectiveEnd,
            activityDuration,
            totalDuration,
            totalBuffer
        };
    };

    // =================================================================
    // 3. CONSTRAINT LOGIC
    // =================================================================

    Utils.isTimeAvailable = function (slotIndex, fieldProps) {
        if (!window.unifiedTimes || !window.unifiedTimes[slotIndex]) return false;

        const slot = window.unifiedTimes[slotIndex];
        const slotStartMin = new Date(slot.start).getHours() * 60 + new Date(slot.start).getMinutes();
        const slotEndMin = new Date(slot.end).getHours() * 60 + new Date(slot.end).getMinutes();

        const rules = (fieldProps.timeRules || []).map(r => {
            if (typeof r.startMin === "number" && typeof r.endMin === "number") return r;
            return {
                ...r,
                startMin: Utils.parseTimeToMinutes(r.start),
                endMin: Utils.parseTimeToMinutes(r.end)
            };
        });

        if (rules.length === 0) return fieldProps.available !== false;

        if (!fieldProps.available) return false;

        const hasAvailableRules = rules.some(r => r.type === 'Available');
        let isAvailable = !hasAvailableRules;

        // Check Available rules
        for (const rule of rules) {
            if (rule.type === 'Available' && rule.startMin != null && rule.endMin != null) {
                if (slotStartMin >= rule.startMin && slotEndMin <= rule.endMin) {
                    isAvailable = true;
                    break;
                }
            }
        }

        if (!isAvailable) return false;

        // Check Unavailable rules
        for (const rule of rules) {
            if (rule.type === 'Unavailable' && rule.startMin != null && rule.endMin != null) {
                if (slotStartMin < rule.endMin && slotEndMin > rule.startMin) {
                    return false;
                }
            }
        }

        return true;
    };

    // --- INTERNAL HELPERS ---

    function isLeagueAssignment(assignmentObj, activityName) {
        if (assignmentObj) {
            if (assignmentObj._gameLabel || assignmentObj._allMatchups) return true;
            if (assignmentObj._activity && String(assignmentObj._activity).toLowerCase().includes("league")) return true;
        }
        const s = String(activityName || "").toLowerCase();
        return s.includes("league game") || s.includes("specialty league");
    }

    function calculateAssignmentWeight(activityName, assignmentObj, maxCapacity) {
        return isLeagueAssignment(assignmentObj, activityName) ? maxCapacity : 1;
    }

    function getRootFieldName(name) {
        if (!name) return "";
        const parts = String(name).split(/\s+[-–—]\s+/);
        return parts[0].trim().toLowerCase();
    }

    function getCombinedUsage(slotIndex, proposedFieldName, fieldUsageBySlot) {
        const combined = { count: 0, divisions: [], bunks: {} };
        const slotData = fieldUsageBySlot[slotIndex];
        if (!slotData) return combined;

        const targetRoot = getRootFieldName(proposedFieldName);

        Object.keys(slotData).forEach(key => {
            const keyRoot = getRootFieldName(key);
            if (keyRoot === targetRoot) {
                const u = slotData[key];
                combined.count += (u.count || 0);
                if (Array.isArray(u.divisions)) {
                    u.divisions.forEach(d => {
                        if (!combined.divisions.includes(d)) combined.divisions.push(d);
                    });
                }
                if (u.bunks) {
                    Object.assign(combined.bunks, u.bunks);
                }
            }
        });

        return combined;
    }

    function isFieldTakenByLeagueText(slotIndex, targetFieldName) {
        if (!window.scheduleAssignments) return false;

        const targetRoot = getRootFieldName(targetFieldName);
        const bunks = Object.keys(window.scheduleAssignments);

        for (const bunk of bunks) {
            const entry = window.scheduleAssignments[bunk]?.[slotIndex];
            if (!entry) continue;

            const textToCheck = [
                entry._allMatchups || "",
                entry._gameLabel || "",
                entry.description || ""
            ].join(" ");

            if (textToCheck.length > 5 && textToCheck.includes("@")) {
                const lower = textToCheck.toLowerCase();
                if (lower.includes(`@ ${targetRoot}`) || lower.includes(`@${targetRoot}`)) {
                    return true;
                }
            }
        }
        return false;
    }

    // =================================================================
    // MAIN CAPACITY CHECK (THE BOUNCER)
    // =================================================================

    Utils.canBlockFit = function (block, fieldName, activityProperties, fieldUsageBySlot, proposedActivity, isLeague = false) {
        if (!fieldName) return false;

        const props = activityProperties[fieldName];
        if (!props) return true; // No rules = allowed

        const transRules = Utils.getTransitionRules(fieldName, activityProperties);
        const {
            blockStartMin,
            blockEndMin,
            effectiveStart,
            effectiveEnd,
            activityDuration
        } = Utils.getEffectiveTimeRange(block, transRules);

        // --- 0. Minimum Duration Check ---
        if (activityDuration < transRules.minDurationMin || activityDuration <= 0) {
            return false;
        }

        // --- 0.5. Transition Concurrency Limit ---
        if (transRules.preMin > 0 || transRules.postMin > 0) {
            const zones = window.getZones?.() || {};
            const zone = zones[transRules.zone];
            const maxConcurrent = zone?.maxConcurrent || 99;

            if (maxConcurrent < 99) {
                const isMerged = blockStartMin > 0 &&
                    window.scheduleAssignments[block.bunk]?.[block.slots[0] - 1]?._zone === transRules.zone;

                if (!isMerged && (window.__transitionUsage?.[transRules.zone] || 0) >= maxConcurrent) {
                    return false;
                }
            }
        }

        // --- Capacity Setup ---
        let maxCapacity = 1;
        if (props.sharableWith) {
            if (props.sharableWith.capacity) {
                maxCapacity = parseInt(props.sharableWith.capacity);
            } else if (props.sharableWith.type === 'all' || props.sharableWith.type === 'custom') {
                maxCapacity = 2;
            }
        } else if (props.sharable) {
            maxCapacity = 2;
        }

        const bunkMetaData = window.SchedulerCoreUtils._bunkMetaData || {};
        const sportMetaData = window.SchedulerCoreUtils._sportMetaData || {};
        const maxHeadcount = sportMetaData[proposedActivity]?.maxCapacity || Infinity;
        const mySize = bunkMetaData[block.bunk]?.size || 0;

        // --- Division & Preference Checks ---
        if (props.preferences?.enabled && props.preferences.exclusive && !props.preferences.list.includes(block.divName)) {
            return false;
        }

        if (Array.isArray(props.allowedDivisions) && props.allowedDivisions.length > 0 && !props.allowedDivisions.includes(block.divName)) {
            return false;
        }

        if (props.limitUsage?.enabled && !props.limitUsage.divisions[block.divName]) {
            return false;
        }

        if (props.limitUsage?.enabled && Array.isArray(props.limitUsage.divisions[block.divName]) &&
            !props.limitUsage.divisions[block.divName].includes(block.bunk)) {
            return false;
        }

        // --- Time Availability Check ---
        if (blockStartMin != null && blockEndMin != null) {
            const rules = (props.timeRules || []).map(r => ({
                ...r,
                startMin: typeof r.startMin === "number" ? r.startMin : Utils.parseTimeToMinutes(r.start),
                endMin: typeof r.endMin === "number" ? r.endMin : Utils.parseTimeToMinutes(r.end)
            }));

            if (rules.length > 0 && !props.available) return false;

            const hasAvailableRules = rules.some(r => r.type === 'Available');
            let insideAvailable = !hasAvailableRules;

            if (hasAvailableRules) {
                for (const rule of rules) {
                    if (rule.type === 'Available' && rule.startMin != null && rule.endMin != null) {
                        if (blockStartMin >= rule.startMin && blockEndMin <= rule.endMin) {
                            insideAvailable = true;
                            break;
                        }
                    }
                }
                if (!insideAvailable) return false;
            }

            for (const rule of rules) {
                if (rule.type === 'Unavailable' && rule.startMin != null && rule.endMin != null) {
                    if (blockStartMin < rule.endMin && blockEndMin > rule.startMin) {
                        return false;
                    }
                }
            }
        } else if (!props.available) {
            return false;
        }

        // --- Slot-by-Slot Capacity Scan ---
        const slotsToScan = transRules.occupiesField
            ? Utils.findSlotsForRange(blockStartMin, blockEndMin)
            : Utils.findSlotsForRange(effectiveStart, effectiveEnd);

        const uniqueSlots = [...new Set(slotsToScan)].sort((a, b) => a - b);

        for (const slotIndex of uniqueSlots) {
            if (slotIndex === undefined) return false;

            // Text-based league conflict detection
            if (isFieldTakenByLeagueText(slotIndex, fieldName)) return false;

            const usage = getCombinedUsage(slotIndex, fieldName, fieldUsageBySlot);

            // Division firewall
            if (usage.divisions.length > 0 && usage.divisions.some(d => d !== block.divName)) {
                return false;
            }

            let currentWeight = 0;
            const existingBunks = Object.keys(usage.bunks);
            const myProposedObj = { _gameLabel: block._gameLabel, _activity: proposedActivity };
            const proposedIsLeague = isLeagueAssignment(myProposedObj, proposedActivity);

            for (const existingBunk of existingBunks) {
                if (existingBunk === block.bunk) continue;

                const activityName = usage.bunks[existingBunk];
                const actualAssignment = window.scheduleAssignments[existingBunk]?.[slotIndex];

                const myLabel = block._gameLabel || (String(proposedActivity).includes("League") ? proposedActivity : null);
                const theirLabel = actualAssignment?._gameLabel || actualAssignment?._activity;
                const isSameGame = myLabel && theirLabel && String(myLabel) === String(theirLabel);

                const existingIsLeague = isLeagueAssignment(actualAssignment, activityName);

                if ((existingIsLeague || proposedIsLeague) && !isSameGame) {
                    return false;
                }

                if (!isSameGame) {
                    currentWeight += calculateAssignmentWeight(activityName, actualAssignment, maxCapacity);
                }
            }

            const myWeight = proposedIsLeague ? maxCapacity : 1;
            if (currentWeight + myWeight > maxCapacity) return false;

            // Headcount limit
            if (maxHeadcount !== Infinity) {
                let currentHeadcount = 0;
                Object.keys(usage.bunks).forEach(bName => {
                    currentHeadcount += (bunkMetaData[bName]?.size || 0);
                });
                if (currentHeadcount + mySize > maxHeadcount) return false;
            }

            // Time availability per slot
            if (!Utils.isTimeAvailable(slotIndex, props)) return false;
        }

        return true;
    };

    Utils.canLeagueGameFit = function (block, fieldName, fieldUsageBySlot, activityProperties) {
        return Utils.canBlockFit(block, fieldName, activityProperties, fieldUsageBySlot, "League Game", true);
    };

    // =================================================================
    // 4. DATA LOADER
    // =================================================================

    function parseTimeRule(rule) {
        if (!rule) return null;
        if (typeof rule.startMin === "number" && typeof rule.endMin === "number") return rule;
        return {
            ...rule,
            startMin: Utils.parseTimeToMinutes(rule.start),
            endMin: Utils.parseTimeToMinutes(rule.end)
        };
    }

    Utils.loadAndFilterData = function () {
        const globalSettings = window.loadGlobalSettings?.() || {};
        const app1Data = globalSettings.app1 || {};

        const masterFields = app1Data.fields || [];
        const masterDivisions = app1Data.divisions || {};
        const masterSpecials = app1Data.specialActivities || [];
        const masterLeagues = globalSettings.leaguesByName || {};
        const masterSpecialtyLeagues = globalSettings.specialtyLeagues || {};
        const bunkMetaData = app1Data.bunkMetaData || {};
        const sportMetaData = app1Data.sportMetaData || {};

        Utils._bunkMetaData = bunkMetaData;
        Utils._sportMetaData = sportMetaData;

        const dailyData = window.loadCurrentDailyData?.() || {};
        const dailyFieldAvailability = dailyData.dailyFieldAvailability || {};
        const dailyOverrides = dailyData.overrides || {};
        const disabledLeagues = dailyOverrides.leagues || [];
        const disabledSpecialtyLeagues = dailyData.disabledSpecialtyLeagues || [];
        const dailyDisabledSportsByField = dailyData.dailyDisabledSportsByField || {};
        const disabledFields = dailyOverrides.disabledFields || [];
        const disabledSpecials = dailyOverrides.disabledSpecials || [];

        const rotationHistoryRaw = window.loadRotationHistory?.() || {};
        const rotationHistory = {
            bunks: rotationHistoryRaw.bunks || {},
            leagues: rotationHistoryRaw.leagues || {},
            leagueTeamSports: rotationHistoryRaw.leagueTeamSports || {},
            leagueTeamLastSport: rotationHistoryRaw.leagueTeamLastSport || {}
        };

        const historicalCounts = {};
        const specialActivityNames = [];
        const specialNamesSet = new Set();
        const specialRules = {};

        // Load special activity rules
        try {
            masterSpecials.forEach(s => {
                const name = s.name;
                specialActivityNames.push(name);
                specialNamesSet.add(name);
                specialRules[name] = {
                    frequencyWeeks: s.frequencyWeeks || 0,
                    limit: s.maxUsage || 0
                };
            });
        } catch (e) {
            console.error("Error loading special activity rules:", e);
        }

        // Historical usage calculation
        try {
            const rawHistory = {};
            const allDaily = window.loadAllDailyData?.() || {};
            const manualOffsets = globalSettings.manualUsageOffsets || {};

            Object.entries(allDaily).forEach(([dateStr, dayData]) => {
                const sched = dayData.scheduleAssignments || {};
                Object.keys(sched).forEach(b => {
                    rawHistory[b] ??= {};
                    (sched[b] || []).forEach(e => {
                        if (e?._activity && !e.continuation) {
                            rawHistory[b][e._activity] ??= [];
                            rawHistory[b][e._activity].push(dateStr);
                        }
                    });
                });
            });

            const todayStr = window.currentScheduleDate;
            const todayDate = new Date(todayStr);

            Object.keys(rawHistory).forEach(b => {
                historicalCounts[b] = {};
                Object.keys(rawHistory[b]).forEach(act => {
                    const dates = rawHistory[b][act].sort();
                    const rule = specialRules[act];

                    if (!rule || rule.frequencyWeeks === 0) {
                        historicalCounts[b][act] = dates.length;
                    } else {
                        const windowDays = rule.frequencyWeeks * 7;
                        let windowCount = 0;
                        let windowStart = null;

                        for (const dStr of dates) {
                            const d = new Date(dStr);
                            if (!windowStart || Math.abs(d - windowStart) > windowDays * 86400000) {
                                windowStart = d;
                                windowCount = 1;
                            } else {
                                windowCount++;
                            }
                        }

                        const daysSinceLast = windowStart ? Math.ceil((todayDate - windowStart) / 86400000) : Infinity;
                        historicalCounts[b][act] = daysSinceLast <= windowDays ? windowCount : 0;
                    }

                    if (specialNamesSet.has(act)) {
                        historicalCounts[b]['_totalSpecials'] = (historicalCounts[b]['_totalSpecials'] || 0) + 1;
                    }
                });
            });

            // Apply manual offsets
            Object.keys(manualOffsets).forEach(b => {
                historicalCounts[b] ??= {};
                Object.keys(manualOffsets[b]).forEach(act => {
                    const offset = manualOffsets[b][act] || 0;
                    historicalCounts[b][act] = Math.max(0, (historicalCounts[b][act] || 0) + offset);
                });
            });
        } catch (e) {
            console.error("Error calculating historical counts:", e);
        }

        // Build divisions with overrides
        const availableDivisions = (app1Data.availableDivisions || [])
            .filter(divName => !dailyOverrides.bunks?.includes(divName));

        const divisions = {};
        availableDivisions.forEach(divName => {
            if (!masterDivisions[divName]) return;
            divisions[divName] = JSON.parse(JSON.stringify(masterDivisions[divName]));
            divisions[divName].bunks = (divisions[divName].bunks || [])
                .filter(bunk => !dailyOverrides.bunks?.includes(bunk));
        });

        // Build activityProperties
        const activityProperties = {};
        const availableActivityNames = [];

        const allMasterActivities = [
            ...masterFields.filter(f => !disabledFields.includes(f.name)),
            ...masterSpecials.filter(s => !disabledSpecials.includes(s.name))
        ];

        allMasterActivities.forEach(f => {
            const dailyRules = dailyFieldAvailability[f.name] || [];
            const finalRules = dailyRules.length > 0
                ? dailyRules.map(parseTimeRule).filter(Boolean)
                : (f.timeRules || []).map(parseTimeRule).filter(Boolean);

            const isMasterAvailable = f.available !== false;

            let allowedDivisions = null;
            if (Array.isArray(f.allowedDivisions) && f.allowedDivisions.length > 0) {
                allowedDivisions = f.allowedDivisions;
            } else if (f.divisionAvailability?.mode === 'specific' && Array.isArray(f.divisionAvailability.divisions)) {
                allowedDivisions = f.divisionAvailability.divisions;
            } else if (Array.isArray(f.sharableWith?.divisions)) {
                allowedDivisions = f.sharableWith.divisions;
            }

            const safeLimitUsage = f.limitUsage?.enabled
                ? { enabled: true, divisions: f.limitUsage.divisions || {} }
                : { enabled: false, divisions: {} };

            let capacity = 1;
            if (f.sharableWith?.capacity) {
                capacity = parseInt(f.sharableWith.capacity);
            } else if (f.sharableWith?.type === 'all' || f.sharableWith?.type === 'custom' || f.sharable) {
                capacity = 2;
            }

            // Normalize sharableWith
            if (!f.sharableWith) f.sharableWith = {};
            f.sharableWith.capacity = capacity;

            const transition = f.transition || {
                preMin: 0,
                postMin: 0,
                label: "Travel",
                zone: window.DEFAULT_ZONE_NAME || "default",
                occupiesField: false,
                minDurationMin: 0
            };

            activityProperties[f.name] = {
                available: isMasterAvailable,
                sharable: !!f.sharable || f.sharableWith?.type === 'all' || f.sharableWith?.type === 'custom',
                sharableWith: f.sharableWith,
                maxUsage: f.maxUsage || 0,
                allowedDivisions,
                limitUsage: safeLimitUsage,
                preferences: f.preferences || { enabled: false, exclusive: false, list: [] },
                timeRules: finalRules,
                transition
            };

            if (isMasterAvailable) {
                availableActivityNames.push(f.name);
            }
        });

        window.allSchedulableNames = availableActivityNames;

        // Build fieldsBySport
        const fieldsBySport = {};
        masterFields
            .filter(f => availableActivityNames.includes(f.name))
            .forEach(f => {
                (f.activities || []).forEach(sport => {
                    if (dailyDisabledSportsByField[f.name]?.includes(sport)) return;
                    fieldsBySport[sport] ??= [];
                    fieldsBySport].push(f.name);
                });
            });

        // Build allActivities list
        const allActivities = [
            ...masterFields
                .filter(f => availableActivityNames.includes(f.name))
                .flatMap(f => (f.activities || []).map(act => ({
                    type: "field",
                    field: f.name,
                    sport: act
                })))
                .filter(a => !dailyDisabledSportsByField[a.field]?.includes(a.sport)),
            ...masterSpecials
                .filter(s => availableActivityNames.includes(s.name))
                .map(sa => ({
                    type: "special",
                    field: sa.name,
                    sport: null
                }))
        ];

        const h2hActivities = allActivities.filter(a => a.type === "field");

        const yesterdayData = window.loadPreviousDailyData?.() || {};
        const yesterdayHistory = {
            schedule: yesterdayData.scheduleAssignments || {},
            leagues: yesterdayData.leagueAssignments || {}
        };

        const masterZones = window.getZones?.() || {};

        return {
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
            dailyDisabledSportsByField,
            masterFields,
            bunkMetaData,
            sportMetaData,
            masterZones
        };
    };

    // Expose globally
    window.SchedulerCoreUtils = Utils;

})();
