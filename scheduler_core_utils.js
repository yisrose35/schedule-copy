// ============================================================================
// scheduler_core_utils.js (FIXED VERSION — OPTION B: DIVISION FIREWALL)
// PART 1 of 3: THE FOUNDATION (Continuous Minute Timeline)
//
// Includes:
// ✔ Division Firewall (no cross-division sharing)
// ✔ minutesToTime() helper added
// ✔ minutesToTimeLabel() alias added
// ✔ Safe handling of proposedActivity
// ✔ Accurate zone concurrency
// ✔ Accurate overlap & capacity checks
// ✔ Correct time-rule parsing & filtering
// ============================================================================

(function() {
    'use strict';

    // =============================================================
    // GLOBAL INITIALIZATION (CRITICAL)
    // =============================================================
    window.fieldReservationLog ||= {};
    window.__transitionUsage ||= {};
    window.DEFAULT_ZONE_NAME ||= "DefaultZone";

    const TRANSITION_TYPE = "Transition/Buffer";
    window.TRANSITION_TYPE = TRANSITION_TYPE;

    const Utils = {};

    // =================================================================
    // 1. BASIC HELPERS
    // =================================================================
    Utils.parseTimeToMinutes = function(str) {
        if (str == null) return null;
        if (typeof str === "number") return str;
        if (typeof str !== "string") return null;
        let s = str.trim().toLowerCase();
        let mer = null;

        if (s.endsWith("am") || s.endsWith("pm")) {
            mer = s.endsWith("am") ? "am" : "pm";
            s = s.replace(/am|pm/g, "").trim();
        } else {
            const m24 = s.match(/^(\d{1,2})\s*:\s*(\d{2})$/);
            if (m24) {
                const hh = parseInt(m24[1], 10);
                const mm = parseInt(m24[2], 10);
                if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) {
                    return hh * 60 + mm;
                }
            }
            return null;
        }

        const m = s.match(/^(\d{1,2})\s*:\s*(\d{2})$/);
        if (!m) return null;

        let hh = parseInt(m[1], 10);
        const mm = parseInt(m[2], 10);
        if (Number.isNaN(hh) || Number.isNaN(mm) || mm < 0 || mm > 59) return null;

        if (mer) {
            if (hh === 12) hh = (mer === "am") ? 0 : 12;
            else if (mer === "pm") hh += 12;
        }
        return hh * 60 + mm;
    };

    Utils.fieldLabel = function(f) {
        if (typeof f === "string") return f;
        if (f && typeof f === "object" && typeof f.name === "string") return f.name;
        return "";
    };

    Utils.fmtTime = function(d) {
        if (!d) return "";
        if (typeof d === 'string') d = new Date(d);
        let h = d.getHours();
        let m = d.getMinutes().toString().padStart(2, "0");
        const ap = h >= 12 ? "PM" : "AM";
        h = h % 12 || 12;
        return `${h}:${m} ${ap}`;
    };

    Utils.minutesToDate = function(mins) {
        const d = new Date(1970, 0, 1, 0, 0, 0);
        d.setMinutes(mins);
        return d;
    };

    // --------------------------------------------------------------
    // NEW: THE MISSING HELPER  
    // --------------------------------------------------------------
    Utils.minutesToTime = function(mins) {
        if (mins == null) return "";
        const d = Utils.minutesToDate(mins);
        return Utils.fmtTime(d);
    };

    // Alias (for Analytics / Print Center compatibility)
    Utils.minutesToTimeLabel = Utils.minutesToTime;

    // =================================================================
    // TIME RANGE HELPERS
    // =================================================================
    Utils.getRawMinuteRange = function(block) {
        const blockStartMin = Utils.parseTimeToMinutes(block.startTime);
        const blockEndMin = Utils.parseTimeToMinutes(block.endTime);

        if (blockStartMin === null || blockEndMin === null || blockEndMin <= blockStartMin) {
            return { blockStartMin: null, blockEndMin: null };
        }
        return { blockStartMin, blockEndMin };
    };

    Utils.getTransitionRules = function(fieldName, activityProperties) {
        const defaultRules = {
            preMin: 0,
            postMin: 0,
            label: "Travel",
            zone: window.DEFAULT_ZONE_NAME,
            occupiesField: false,
            minDurationMin: 0
        };

        if (!activityProperties || typeof activityProperties !== "object") {
            return defaultRules;
        }

        const props = activityProperties[fieldName];
        if (!props || !props.transition) return defaultRules;

        return { ...defaultRules, ...props.transition };
    };

    Utils.getEffectiveTimeRange = function(block, transitionRules) {
        const { blockStartMin, blockEndMin } = Utils.getRawMinuteRange(block);
        if (blockStartMin === null || blockEndMin === null) {
            return { effectiveStart: null, effectiveEnd: null, blockStartMin, blockEndMin };
        }

        const preMin = transitionRules.preMin || 0;
        const postMin = transitionRules.postMin || 0;

        const effectiveStart = blockStartMin + preMin;
        const effectiveEnd = blockEndMin - postMin;
        const activityDuration = effectiveEnd - effectiveStart;

        if (activityDuration <= 0) {
            return { effectiveStart: null, effectiveEnd: null, blockStartMin, blockEndMin, activityDuration: 0 };
        }

        return {
            blockStartMin,
            blockEndMin,
            effectiveStart,
            effectiveEnd,
            activityDuration
        };
    };

    // =================================================================
    // TIME-RULE AVAILABILITY CHECK
    // =================================================================
    Utils.isTimeAvailableMinuteAccurate = function(startMin, endMin, fieldProps) {
        const rules = (fieldProps.timeRules || []).map(r => {
            if (typeof r.startMin === "number" && typeof r.endMin === "number") return r;
            return {
                ...r,
                startMin: Utils.parseTimeToMinutes(r.start),
                endMin: Utils.parseTimeToMinutes(r.end)
            };
        }).filter(r => r.startMin !== null && r.endMin !== null);

        if (fieldProps.available === false) return false;
        if (rules.length === 0) return true;

        const hasAvailableRules = rules.some(r => r.type === 'Available');
        let isAvailable = !hasAvailableRules;

        if (hasAvailableRules) {
            isAvailable = rules.some(r =>
                r.type === 'Available' &&
                startMin >= r.startMin &&
                endMin <= r.endMin
            );
            if (!isAvailable) return false;
        }

        for (const rule of rules) {
            if (rule.type !== 'Unavailable') continue;
            if (startMin < rule.endMin && endMin > rule.startMin) {
                return false;
            }
        }

        return true;
    };

    // =================================================================
    // INTERNAL
    // =================================================================
    function isLeagueAssignment(name) {
        const s = String(name || "").toLowerCase();
        return s.includes("league game") || s.includes("specialty league");
    }

    // =================================================================
    // CAN A BLOCK FIT ON THIS FIELD?
    // =================================================================
    Utils.canBlockFit = function(block, fieldName, activityProperties, proposedActivity) {

        if (!proposedActivity || typeof proposedActivity !== "string") return false;

        const props = activityProperties[fieldName];
        if (!props) return false;

        const transRules = Utils.getTransitionRules(fieldName, activityProperties);
        const { blockStartMin, blockEndMin, effectiveStart, effectiveEnd, activityDuration } =
            Utils.getEffectiveTimeRange(block, transRules);

        if (blockStartMin === null || blockEndMin === null) return false;
        if (activityDuration <= 0) return false;
        if (activityDuration < transRules.minDurationMin) return false;

        const protectionStart = transRules.occupiesField ? blockStartMin : effectiveStart;
        const protectionEnd = transRules.occupiesField ? blockEndMin : effectiveEnd;

        if (!Utils.isTimeAvailableMinuteAccurate(blockStartMin, blockEndMin, props)) return false;

        // ALLOWED DIVISIONS
        if (props.allowedDivisions?.length > 0 &&
            !props.allowedDivisions.includes(block.divName)) {
            return false;
        }

        if (props.limitUsage?.enabled &&
            !props.limitUsage.divisions[block.divName]) {
            return false;
        }

        const reservationLog = window.fieldReservationLog[fieldName] || [];
        const bunkMeta = Utils._bunkMetaData || {};
        const sportMeta = Utils._sportMetaData || {};

        let headcount = bunkMeta[block.bunk]?.size || 0;
        const maxCapacity = props.sharableWith?.capacity || 1;
        let proposedWeight = isLeagueAssignment(proposedActivity) ? maxCapacity : 1;

        // =============================================================
        // DIVISION FIREWALL (STRICT)
        // =============================================================
        for (const existing of reservationLog) {

            const overlap =
                protectionStart < existing.endMin &&
                protectionEnd > existing.startMin;

            if (!overlap) continue;

            // STRICT: never share fields across divisions
            if (existing.divName !== block.divName) {
                return false;
            }

            // capacity
            const existingWeight = existing.isLeague ? maxCapacity : 1;
            if (existingWeight + proposedWeight > maxCapacity) {
                return false;
            }

            const addSize = bunkMeta[existing.bunk]?.size || 0;
            headcount += addSize;
        }

        // HEADCOUNT LIMIT
        const maxHeadcount = sportMeta[proposedActivity]?.maxCapacity || Infinity;
        if (headcount > maxHeadcount) return false;

        // =============================================================
        // ZONE CONCURRENCY CHECK
        // =============================================================
        if (transRules.preMin > 0 || transRules.postMin > 0) {

            const zoneName = transRules.zone || window.DEFAULT_ZONE_NAME;
            const zones = window.getZones?.() || {};
            const zone = zones[zoneName];
            const maxConcurrent = zone?.maxConcurrent ?? 99;

            if (maxConcurrent < 99) {

                const merged =
                    (window.__transitionUsage?.[zoneName + "_lastEnd"] === blockStartMin);

                if (!merged) {
                    const count = window.__transitionUsage[zoneName] || 0;
                    if (count >= maxConcurrent) {
                        return false;
                    }
                }
            }
        }

        return true;
    };

    // =================================================================
    // DATA LOADER (FULLY FIXED)
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

    Utils.loadAndFilterData = function() {
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

        // =============================================================
        // SPECIAL COUNTS (HISTORICAL)
        // =============================================================
        const historicalCounts = {};
        const lastUsedDates = {};
        const specialActivityNames = [];
        const specialNamesSet = new Set();
        const specialRules = {};

        try {
            masterSpecials.forEach(s => {
                specialActivityNames.push(s.name);
                specialNamesSet.add(s.name);
                specialRules[s.name] = {
                    frequencyWeeks: s.frequencyWeeks || 0,
                    limit: s.maxUsage || 0
                };
            });

            const rawHistory = {};
            const allDaily = window.loadAllDailyData?.() || {};
            const manualOffsets = globalSettings.manualUsageOffsets || {};

            const todayStr = window.currentScheduleDate;
            const todayDate = new Date(todayStr);

            Object.entries(allDaily).forEach(([dateStr, day]) => {
                const sched = day.scheduleAssignments || {};

                Object.keys(sched).forEach(b => {
                    if (!rawHistory[b]) rawHistory[b] = {};

                    Object.values(sched[b]).forEach(e => {
                        if (!e || !e._activity || e.continuation) return;

                        if (!rawHistory[b][e._activity])
                            rawHistory[b][e._activity] = [];

                        rawHistory[b][e._activity].push(dateStr);
                    });
                });
            });

            Object.keys(rawHistory).forEach(b => {
                if (!historicalCounts[b]) historicalCounts[b] = {};
                if (!lastUsedDates[b]) lastUsedDates[b] = {};

                Object.keys(rawHistory[b]).forEach(act => {
                    const dates = rawHistory[b][act].sort();

                    if (dates.length > 0) {
                        lastUsedDates[b][act] = dates.at(-1);
                    }

                    const rule = specialRules[act];
                    const windowDays = rule?.frequencyWeeks * 7;

                    let count = 0;
                    for (const dStr of dates) {
                        const d = new Date(dStr);
                        const diff = Math.ceil(Math.abs(todayDate - d) / 86400000);

                        if (!rule || rule.frequencyWeeks === 0 || diff <= windowDays) {
                            count++;
                        }
                    }
                    historicalCounts[b][act] = count;

                    if (specialNamesSet.has(act)) {
                        historicalCounts[b]['_totalSpecials'] =
                            (historicalCounts[b]['_totalSpecials'] || 0) + 1;
                    }
                });
            });

            Object.keys(manualOffsets).forEach(b => {
                if (!historicalCounts[b]) historicalCounts[b] = {};

                Object.keys(manualOffsets[b]).forEach(act => {
                    const offset = manualOffsets[b][act] || 0;
                    const base = historicalCounts[b][act] || 0;
                    historicalCounts[b][act] = Math.max(0, base + offset);
                });
            });

        } catch (e) {
            console.error("Error calculating historical counts:", e);
        }

        const overrides = {
            bunks: dailyOverrides.bunks || [],
            leagues: disabledLeagues
        };

        // =============================================================
        // DIVISIONS
        // =============================================================
        const availableDivisions =
            (app1Data.availableDivisions || [])
                .filter(d => !overrides.bunks.includes(d));

        const divisions = {};
        for (const div of availableDivisions) {
            if (!masterDivisions[div]) continue;
            divisions[div] = JSON.parse(JSON.stringify(masterDivisions[div]));

            divisions[div].bunks = divisions[div].bunks.filter(
                b => !overrides.bunks.includes(b)
            );
        }

        // =============================================================
        // ACTIVITY PROPS (THE FIXED SECTION)
        // =============================================================
        const activityProperties = {};
        const allMasterActivities = [
            ...masterFields.filter(f => !disabledFields.includes(f.name)),
            ...masterSpecials.filter(s => !disabledSpecials.includes(s.name))
        ];
        const availableActivityNames = [];

        allMasterActivities.forEach(f => {
            let finalRules;

            const dailyRules = dailyFieldAvailability[f.name];
            if (dailyRules && dailyRules.length > 0) {
                finalRules = dailyRules.map(parseTimeRule).filter(Boolean);
            } else {
                finalRules = (f.timeRules || []).map(parseTimeRule).filter(Boolean);
            }

            const isMasterAvailable = f.available !== false;

            let allowedDivisions = null;
            if (Array.isArray(f.allowedDivisions) && f.allowedDivisions.length > 0) {
                allowedDivisions = f.allowedDivisions.slice();
            } else if (f.divisionAvailability &&
                       f.divisionAvailability.mode === 'specific') {
                allowedDivisions = (f.divisionAvailability.divisions || []).slice();
            }

            let capacity = 1;
            if (f.sharableWith?.capacity) {
                capacity = parseInt(f.sharableWith.capacity);
            }

            f.sharableWith ||= {};
            f.sharableWith.capacity = capacity;

            const transition = f.transition || {
                preMin: 0,
                postMin: 0,
                label: "Travel",
                zone: window.DEFAULT_ZONE_NAME,
                occupiesField: false,
                minDurationMin: 0
            };

            activityProperties[f.name] = {
                available: isMasterAvailable,
                sharable: false, // STRICT FIREWALL
                sharableWith: f.sharableWith,
                allowedDivisions,
                limitUsage: f.limitUsage?.enabled
                    ? { enabled: true, divisions: f.limitUsage.divisions || {} }
                    : { enabled: false, divisions: {} },
                preferences: f.preferences || { enabled: false, exclusive: false, list: [] },
                timeRules: finalRules,
                transition
            };

            if (isMasterAvailable) {
                availableActivityNames.push(f.name);
            }
        });

        window.allSchedulableNames = availableActivityNames;

        const availFields = masterFields.filter(f => availableActivityNames.includes(f.name));
        const availSpecials = masterSpecials.filter(s => availableActivityNames.includes(s.name));

        const fieldsBySport = {};
        availFields.forEach(f => {
            if (Array.isArray(f.activities)) {
                f.activities.forEach(sport => {
                    const isDisabled = dailyDisabledSportsByField[f.name]?.includes(sport);
                    if (!isDisabled) {
                        fieldsBySport[sport] ||= [];
                        fieldsBySport[sport].push(f.name);
                    }
                });
            }
        });

        const allActivities = [
            ...availFields.flatMap(f =>
                (f.activities || []).map(act => ({
                    type: "field",
                    field: f.name,
                    sport: act
                }))
            ).filter(a =>
                !dailyDisabledSportsByField[a.field]?.includes(a.sport)
            ),
            ...availSpecials.map(sa => ({
                type: "special",
                field: sa.name,
                sport: null
            }))
        ];

        const h2hActivities = allActivities.filter(a => a.type === "field" && a.sport);

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
            lastUsedDates,
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

    window.SchedulerCoreUtils = Utils;

})();
