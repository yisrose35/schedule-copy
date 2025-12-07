// ============================================================================
// scheduler_core_loader.js
// FULL REWRITE — SPEC-COMPLIANT LOADER FOR ORCHESTRATOR V3
// ============================================================================

(function () {
    'use strict';

    // ------------------------------------------------------------------------
    // 0. SAFE GETTERS FOR app1 + GLOBALS
    // ------------------------------------------------------------------------
    const settings = (window.loadGlobalSettings?.() || {}).app1 || {};
    const app1 = window.app1 || settings || {};

    const rawDivisions = app1.divisions || [];
    const divisionsArray = Array.isArray(rawDivisions)
        ? rawDivisions
        : Object.values(rawDivisions || {});

    const bunks = app1.bunks || [];
    const fields = app1.fields || [];
    const specials = (window.specialActivities || []).slice();
    const defaultDurations = app1.defaultDurations || {};

    const increments = app1.increments || 30;
    const startTime = app1.startTime || "9:00";
    const endTime = app1.endTime || "17:00";

    // Daily override sources (if they are not present, default them)
    const disabledFieldsDaily =
        (window.loadCurrentDailyData?.().disabledFields) || [];
    const disabledSpecialsDaily =
        (window.loadCurrentDailyData?.().disabledSpecials) || [];
    const disabledLeaguesDaily =
        (window.loadCurrentDailyData?.().disabledLeagues) || [];
    const disabledSpecialtyLeaguesDaily =
        (window.loadCurrentDailyData?.().disabledSpecialtyLeagues) || [];

    const yesterdayHistory =
        window.loadYesterdayHistory?.() || {};
    const rotationHistory =
        window.loadRotationHistory?.() || {};

    const historicalCounts =
        window.loadHistoricalCounts?.() || {};

    const dailyFieldAvailability =
        window.loadCurrentDailyData?.().dailyFieldAvailability || {};

    const masterZones =
        window.loadZones?.() || {};

    // ------------------------------------------------------------------------
    // 1. BUILD MASTER ACTIVITIES
    // ------------------------------------------------------------------------
    function buildMasterActivities() {
        let list = [];

        if (Array.isArray(app1.activities)) {
            list = list.concat(app1.activities);
        }
        if (Array.isArray(specials)) {
            list = list.concat(specials);
        }

        return list
            .filter(a => a && a.name)
            .map(a => ({
                name: a.name,
                duration: a.duration || defaultDurations[a.name] || increments,
                type: a.type || "General",
                allowedFields: a.allowedFields || a.fields || null,
                divisions: a.divisions || null
            }));
    }

    const masterActivities = buildMasterActivities();
    const masterSpecials = masterActivities.filter(a => a.type === "Special");

    // ------------------------------------------------------------------------
    // 2. BUILD TIME MAPPINGS
    // ------------------------------------------------------------------------
    function toMin(t) {
        const [h, m] = t.split(":").map(Number);
        return h * 60 + m;
    }

    function buildTimeMappings() {
        const startMin = toMin(startTime);
        const endMin = toMin(endTime);

        const mappings = [];
        let cur = startMin;

        while (cur < endMin) {
            mappings.push({ start: cur, end: cur + increments });
            cur += increments;
        }
        return mappings;
    }

    const TimeMappings = buildTimeMappings();

    // ------------------------------------------------------------------------
    // 3. FILTER ACTIVITIES BY DIVISION
    // ------------------------------------------------------------------------
    function filterActivities() {
        if (!masterActivities.length) return [];

        return masterActivities.filter(act => {
            if (act.divisions && act.divisions.length) {
                return divisionsArray.some(d => act.divisions.includes(d.name));
            }
            return true;
        });
    }

    let __lastFilteredActivities = [];

    // ------------------------------------------------------------------------
    // 4. BUILD SCHEDULABLE BLOCKS
    // ------------------------------------------------------------------------
    function generateSchedulableBlocks(filtered) {
        const blocks = [];

        bunks.forEach(bunk => {
            if (!bunk?.name) return;
            const bunkName = bunk.name;

            filtered.forEach(act => {
                const dur = act.duration || increments;
                const slotsNeeded = Math.ceil(dur / increments);

                TimeMappings.forEach((tm, slotIndex) => {
                    const endSlot = slotIndex + slotsNeeded - 1;
                    if (endSlot < TimeMappings.length) {
                        blocks.push({
                            bunk: bunkName,
                            activity: act.name,
                            event: act.name,
                            duration: dur,
                            slots: Array.from(
                                { length: slotsNeeded },
                                (_, i) => slotIndex + i
                            ),
                            startTime: TimeMappings[slotIndex].start,
                            endTime: TimeMappings[endSlot].end
                        });
                    }
                });
            });
        });

        return blocks;
    }

    // ------------------------------------------------------------------------
    // 5. BUILD activityProperties + fieldsBySport + h2hActivities
    // ------------------------------------------------------------------------
    function buildActivityProperties() {
        const props = {};

        masterActivities.forEach(act => {
            const name = act.name;
            props[name] = {
                available: true,
                sharable: false,
                sharableWith: null,
                preferredDivisions: act.divisions || [],
                allowedDivisions: act.divisions || [],
                allowedFields: act.allowedFields || null,
                transition: act.transition || null,
                preferences: act.preferences || null,
                limitUsage: act.limitUsage || null,
                timeRules: act.timeRules || [],
                minDurationMin: act.minDurationMin || 0
            };
        });

        return props;
    }

    function buildFieldsBySport() {
        const map = {};

        masterActivities.forEach(a => {
            const type = a.type?.toLowerCase() || "";

            if (type === "field" || type === "sport") {
                const sport = a.name;
                const allowed = a.allowedFields || [];
                map[sport] = allowed.slice();
            }
        });

        return map;
    }

    function buildH2HActivities() {
        return masterActivities
            .filter(a => /league/i.test(a.type))
            .map(a => a.name);
    }

    // ------------------------------------------------------------------------
    // 6. MAIN LOADER PIPELINE
    // ------------------------------------------------------------------------
    function loadAndFilterData() {
        __lastFilteredActivities = filterActivities();
        window.__lastFilteredActivities = __lastFilteredActivities;

        const blocks = generateSchedulableBlocks(__lastFilteredActivities);
        window.__lastSchedulableBlocks = blocks;

        const activityProperties = buildActivityProperties();
        const fieldsBySport = buildFieldsBySport();
        const h2hActivities = buildH2HActivities();

        const specialActivityNames = masterSpecials.map(s => s.name);

        // Convert divisions array → division map
        const divisions = divisionsArray.reduce((m, d) => {
            if (d?.name) m[d.name] = d;
            return m;
        }, {});

        // Make final orchestrator-safe config object
        return {
            // core schedule data
            activities: __lastFilteredActivities,
            blocks,
            divisions,
            bunks,
            fields,
            masterActivities,
            masterSpecials,

            // orchestrator-required data
            activityProperties,
            allActivities: masterActivities,
            h2hActivities,
            fieldsBySport,

            // league systems
            masterLeagues: window.masterLeagues || {},
            masterSpecialtyLeagues: window.masterSpecialtyLeagues || {},

            // daily disabled sets
            disabledFields: disabledFieldsDaily,
            disabledSpecials: disabledSpecialsDaily,
            disabledLeagues: disabledLeaguesDaily,
            disabledSpecialtyLeagues: disabledSpecialtyLeaguesDaily,

            // historical + rotation
            historicalCounts,
            yesterdayHistory,
            rotationHistory,

            // smart tiles
            specialActivityNames,

            // field availability + zones
            dailyFieldAvailability,
            masterZones,

            // misc metadata
            bunkMetaData: window.bunkMetaData || {}
        };
    }

    // ------------------------------------------------------------------------
    // 7. EXPORT TO WINDOW
    // ------------------------------------------------------------------------
    window.masterActivities = masterActivities;
    window.masterSpecials = masterSpecials;
    window.divisionsByName = divisionsArray.reduce((m, d) => {
        if (d?.name) m[d.name] = d;
        return m;
    }, {});
    window.bunks = bunks;
    window.fields = fields;
    window.defaultDurations = defaultDurations;

    window.TimeMappings = TimeMappings;
    window.loadAndFilterData = loadAndFilterData;
    window.generateSchedulableBlocks = generateSchedulableBlocks;

})();
