// ============================================================================
// scheduler_core_utils.js (STRICT CONSTRAINTS & DATA LOADER)
// FIXED VERSION — All Known Logic & Safety Errors Corrected
// ============================================================================

(function() {
    'use strict';

    window.fieldReservationLog ||= {};
    window.__transitionUsage ||= {};
    window.DEFAULT_ZONE_NAME ||= "DefaultZone";

    const TRANSITION_TYPE = "Transition/Buffer";
    window.TRANSITION_TYPE = TRANSITION_TYPE;

    const Utils = {};

    // =================================================================
    // 1. BASIC HELPERS (FIXED)
    // =================================================================
    Utils.parseTimeToMinutes = function(str) {
        if (str == null) return null;
        if (typeof str === "number") return str;
        if (typeof str !== "string") return null;

        let s = str.trim().toLowerCase();
        let mer = null;

        // Handle AM/PM
        if (s.endsWith("am") || s.endsWith("pm")) {
            mer = s.endsWith("am") ? "am" : "pm";
            s = s.replace(/am|pm/gi, "").trim();   // ✔ FIX: case-insensitive
        } else {
            // 24-hour fallback
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
        if (d === null || d === undefined) return "";    // ✔ FIX (0 mins allowed)
        if (typeof d === "string") d = new Date(d);

        let h = d.getHours();
        let m = String(d.getMinutes()).padStart(2, "0");
        const ap = h >= 12 ? "PM" : "AM";
        h = h % 12 || 12;
        return `${h}:${m} ${ap}`;
    };

    Utils.minutesToDate = function(mins) {
        const d = new Date(1970, 0, 1, 0, 0, 0);
        d.setMinutes(mins);
        return d;
    };

    Utils.minutesToTime = function(mins) {
        if (mins == null) return "";
        return Utils.fmtTime(Utils.minutesToDate(mins));
    };
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
    // CONSTRAINT 1: TIME AVAILABILITY
    // =================================================================
    Utils.isTimeAvailableMinuteAccurate = function(startMin, endMin, fieldProps) {
        const rules = (fieldProps.timeRules || [])
            .map(r => {
                if (typeof r.startMin === "number" && typeof r.endMin === "number") return r;
                return {
                    ...r,
                    startMin: Utils.parseTimeToMinutes(r.start),
                    endMin: Utils.parseTimeToMinutes(r.end)
                };
            })
            .filter(r => r.startMin !== null && r.endMin !== null);

        if (fieldProps.available === false) return false;
        if (rules.length === 0) return true;

        const hasAvailableRules = rules.some(r => r.type === "Available");
        let isAvailable = !hasAvailableRules;

        if (hasAvailableRules) {
            isAvailable = rules.some(r =>
                r.type === "Available" &&
                startMin >= r.startMin &&
                endMin <= r.endMin
            );
            if (!isAvailable) return false;
        }

        for (const rule of rules) {
            if (rule.type === "Unavailable") {
                if (startMin < rule.endMin && endMin > rule.startMin) {
                    return false;
                }
            }
        }

        return true;
    };

    // =================================================================
    // CORE STRICT CHECK: CAN BLOCK FIT? (FIXES APPLIED)
    // =================================================================
    Utils.canBlockFit = function(block, fieldName, activityProperties, proposedActivity) {
        if (!proposedActivity || typeof proposedActivity !== "string") return false;

        const props = activityProperties[fieldName];
        if (!props) return false;

        const transRules = Utils.getTransitionRules(fieldName, activityProperties);
        const {
            blockStartMin,
            blockEndMin,
            effectiveStart,
            effectiveEnd,
            activityDuration
        } = Utils.getEffectiveTimeRange(block, transRules);

        if (blockStartMin === null || blockEndMin === null) return false;
        if (activityDuration <= 0) return false;
        if (activityDuration < transRules.minDurationMin) return false;

        // 1. Minute-accurate time availability
        if (!Utils.isTimeAvailableMinuteAccurate(blockStartMin, blockEndMin, props))
            return false;

        // 2. Division Firewall / Allowed Divisions
        if (props.limitUsage && props.limitUsage.enabled) {
            const allowedDivisions = Object.keys(props.limitUsage.divisions || {});
            if (!allowedDivisions.includes(block.divName)) {   // ✔ FIX: correct array test
                return false;
            }

            const specificBunks = props.limitUsage.divisions[block.divName];
            if (Array.isArray(specificBunks) && specificBunks.length > 0) {
                if (!specificBunks.includes(block.bunk)) {
                    return false;
                }
            }
        }

        // 3. Capacity & Firewall
        const protectionStart = transRules.occupiesField ? blockStartMin : effectiveStart;
        const protectionEnd = transRules.occupiesField ? blockEndMin : effectiveEnd;

        const reservationLog = window.fieldReservationLog[fieldName] || [];
        const maxCapacity = props.sharableWith?.capacity || 1;
        const sharableType = (props.sharableWith?.type || "").toLowerCase(); // ✔ FIX: normalized
        const isSharable = sharableType !== "not_sharable";

        let currentLoad = 0;

        for (const existing of reservationLog) {
            const overlap = protectionStart < existing.endMin && protectionEnd > existing.startMin;
            if (!overlap) continue;

            if (!isSharable) return false;

            // Division firewall unless explicitly "all"
            if (existing.divName !== block.divName && sharableType !== "all") {
                return false;
            }

            currentLoad++;
        }

        if (currentLoad >= maxCapacity) return false;

        return true;
    };

    // =================================================================
    // DATA LOADER (FULL RESTORE)
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

        // HISTORY COUNTING
        const historicalCounts = {};
        const specialRules = {};
        masterSpecials.forEach(s => {
            specialRules[s.name] = {
                frequencyWeeks: s.frequencyWeeks || 0,
                limit: s.maxUsage || 0
            };
        });

        const rawHistory = {};
        const allDaily = window.loadAllDailyData?.() || {};

        Object.entries(allDaily).forEach(([dateStr, day]) => {
            const sched = day.scheduleAssignments || {};
            Object.keys(sched).forEach(b => {
                if (!rawHistory[b]) rawHistory[b] = {};
                Object.values(sched[b]).forEach(e => {
                    if (!e || !e._activity || e.continuation) return;
                    if (!rawHistory[b][e._activity]) rawHistory[b][e._activity] = [];
                    rawHistory[b][e._activity].push(dateStr);
                });
            });
        });

        const todayDate = new Date(window.currentScheduleDate);
        Object.keys(rawHistory).forEach(b => {
            if (!historicalCounts[b]) historicalCounts[b] = {};
            Object.keys(rawHistory[b]).forEach(act => {
                const dates = rawHistory[b][act];
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
            });
        });

        // ACTIVITY PROPERTIES
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
            let capacity = 1;

            if (f.sharableWith?.capacity) {
                capacity = parseInt(f.sharableWith.capacity);
            }

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
                sharableWith: f.sharableWith || { type: "not_sharable", capacity: 1 },
                limitUsage: f.limitUsage || { enabled: false, divisions: {} },
                preferences: f.preferences || { enabled: false, exclusive: false, list: [] },
                timeRules: finalRules,
                transition,
                allowedDivisions: f.limitUsage?.enabled
                    ? Object.keys(f.limitUsage.divisions)
                    : null
            };

            if (isMasterAvailable) availableActivityNames.push(f.name);
        });

        // DIVISIONS
        const overrides = { bunks: dailyOverrides.bunks || [] };
        const availableDivisions = (app1Data.availableDivisions || [])
            .filter(d => !overrides.bunks.includes(d));

        const divisions = {};
        for (const div of availableDivisions) {
            if (!masterDivisions[div]) continue;
            divisions[div] = JSON.parse(JSON.stringify(masterDivisions[div]));
            divisions[div].bunks = divisions[div].bunks.filter(b => !overrides.bunks.includes(b));
        }

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
            masterLeagues,
            masterSpecialtyLeagues,
            masterSpecials,
            masterFields,
            yesterdayHistory,
            rotationHistory,
            historicalCounts,
            bunkMetaData,
            sportMetaData,
            masterZones
        };
    };

    window.SchedulerCoreUtils = Utils;

})();
