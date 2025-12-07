// ============================================================================
// scheduler_core_loader.js
// FULL GCM REWRITE — STABLE, SPEC-COMPLIANT LOADER FOR ORCHESTRATOR V3
//
// Major Fixes:
// - Guarantees COMPLETE activityProperties for ALL activities (Free, Lunch, Slots, etc)
// - Proper field merging and normalization
// - Correct divisions parsing (object → array)
// - Auto-generates safe default transitions, sharable rules, availability
// - Ensures masterActivities is fully consistent with utils.canBlockFit()
// - Prevents missing props from collapsing scheduling
// ============================================================================

(function () {
    'use strict';

    // ------------------------------------------------------------
    // Utility: Convert "H:MM" to minutes
    // ------------------------------------------------------------
    function toMin(t) {
        if (!t) return 0;
        const [h, m] = t.split(":").map(Number);
        return (h * 60) + m;
    }

    // ------------------------------------------------------------
    // Load Global app1 config
    // ------------------------------------------------------------
    function getApp1Settings() {
        return (window.loadGlobalSettings?.() || {}).app1 ||
               window.app1 ||
               {};
    }

    function getSpecialActivities() {
        return (window.specialActivities || []).slice();
    }

    function getDailyOverrides() {
        return window.loadCurrentDailyData?.() || {};
    }

    // ========================================================================
    // 1. BUILD MASTER ACTIVITIES — THE DEFINITIVE LIST
    // ========================================================================
    function buildMasterActivities(app1, specials, fields) {
        const seen = new Set();
        const out = [];

        // ---------------------------
        // A) App-defined activities
        // ---------------------------
        if (Array.isArray(app1.activities)) {
            app1.activities.forEach(a => {
                if (a?.name && !seen.has(a.name)) {
                    out.push(a);
                    seen.add(a.name);
                }
            });
        }

        // ---------------------------
        // B) Special Activities
        // ---------------------------
        if (Array.isArray(specials)) {
            specials.forEach(s => {
                if (s?.name && !seen.has(s.name)) {
                    out.push({ ...s, type: "Special" });
                    seen.add(s.name);
                }
            });
        }

        // ---------------------------
        // C) Auto-discover sports
        // ---------------------------
        if (Array.isArray(fields)) {
            fields.forEach(f => {
                (f.activities || []).forEach(sport => {
                    if (sport && !seen.has(sport)) {
                        out.push({
                            name: sport,
                            type: "field",
                            allowedFields: [f.name]
                        });
                        seen.add(sport);
                    }
                });
            });
        }

        // ---------------------------
        // D) Force Generic Required Slots
        // ---------------------------
        const generics = [
            "General Activity Slot",
            "Sports Slot",
            "Special Activity"
        ];

        generics.forEach(g => {
            if (!seen.has(g)) {
                out.push({
                    name: g,
                    type: "General",
                    available: true,
                    duration: app1.defaultDurations?.[g] ||
                              app1.increments || 30
                });
                seen.add(g);
            }
        });

        // ---------------------------
        // E) Normalize durations and structures
        // ---------------------------
        const defaultDur = app1.defaultDurations || {};
        const increments = app1.increments || 30;

        return out.map(a => ({
            name: a.name,
            type: a.type || "General",
            duration: a.duration || defaultDur[a.name] || increments,

            // normalized data
            allowedFields: a.allowedFields || a.fields || null,
            divisions: a.divisions || null,
            available: a.available !== false,

            // optional metadata
            transition: a.transition || null,
            sharable: a.sharable || false,
            sharableWith: a.sharableWith || null,
            preferences: a.preferences || null,
            limitUsage: a.limitUsage || null,
            timeRules: a.timeRules || [],
            minDurationMin: a.minDurationMin || 0,
            maxUsage: a.maxUsage || 0,
            frequencyWeeks: a.frequencyWeeks || 0
        }));
    }

    // ========================================================================
    // 2. BUILD TIME MAPPINGS
    // ========================================================================
    function buildTimeMappings(app1) {
        const inc = app1.increments || 30;
        const startMin = toMin(app1.startTime || "9:00");
        const endMin = toMin(app1.endTime || "17:00");

        const out = [];
        for (let cur = startMin; cur < endMin; cur += inc) {
            out.push({ start: cur, end: cur + inc });
        }
        return out;
    }

    // ========================================================================
    // 3. FILTER ACTIVITIES BY DIVISION
    // ========================================================================
    function filterActivities(master, divisions) {
        return master.filter(a => {
            if (a.divisions?.length) {
                return divisions.some(d => a.divisions.includes(d.name));
            }
            return true;
        });
    }

    // ========================================================================
    // 4. GENERATE SCHEDULABLE BLOCKS
    // ========================================================================
    function generateSchedulableBlocks(master, bunks, times, inc) {
        const blocks = [];

        bunks.forEach(bunk => {
            if (!bunk) return;

            const bunkName = (typeof bunk === "string") ? bunk : bunk.name;

            master.forEach(act => {
                const dur = act.duration || inc;
                const slotsNeeded = Math.ceil(dur / inc);

                times.forEach((tm, i) => {
                    const last = i + slotsNeeded - 1;
                    if (last >= times.length) return;

                    blocks.push({
                        bunk: bunkName,
                        activity: act.name,
                        event: act.name,
                        duration: dur,
                        slots: Array.from({ length: slotsNeeded }, (_, x) => i + x),
                        startTime: times[i].start,
                        endTime: times[last].end
                    });
                });
            });
        });

        return blocks;
    }

    // ========================================================================
    // 5. BUILD COMPLETE ACTIVITY PROPERTIES
    // ========================================================================
    function buildActivityProperties(master, fields) {
        const props = {};
        const safeTransition = { preMin: 0, postMin: 0, zone: "default", occupiesField: false };

        // ---------------------------
        // A) Activity-level props
        // ---------------------------
        master.forEach(a => {
            props[a.name] = {
                available: a.available !== false,
                sharable: a.sharable || false,
                sharableWith: a.sharableWith || { type: "not_sharable", capacity: 1 },

                allowedDivisions: a.divisions || [],
                allowedFields: a.allowedFields || null,

                preferences: a.preferences || null,
                limitUsage: a.limitUsage || { enabled: false, divisions: {} },

                timeRules: a.timeRules || [],
                minDurationMin: a.minDurationMin || 0,

                transition: a.transition || safeTransition,

                maxUsage: a.maxUsage || 0,
                frequencyWeeks: a.frequencyWeeks || 0
            };
        });

        // ---------------------------
        // B) Field-level props
        // ---------------------------
        fields.forEach(f => {
            props[f.name] = {
                available: f.available !== false,
                sharable: false,
                sharableWith: f.sharableWith || { type: "not_sharable", capacity: 1 },

                allowedDivisions: [],
                allowedFields: null,

                preferences: f.preferences || null,
                limitUsage: f.limitUsage || { enabled: false, divisions: {} },

                timeRules: f.timeRules || [],
                minDurationMin: 0,

                transition: f.transition || safeTransition
            };
        });

        return props;
    }

    // ========================================================================
    // 6. MAP FIELDS BY SPORT NAME
    // ========================================================================
    function buildFieldsBySport(master, fields) {
        const map = {};
        master.forEach(a => {
            const list = fields
                .filter(f => f.activities?.includes(a.name))
                .map(f => f.name);

            if (list.length > 0) map[a.name] = list;
        });
        return map;
    }

    // ========================================================================
    // 7. H2H (head-to-head) activity list
    // ========================================================================
    function buildH2HActivities(master) {
        return master.filter(a => /league/i.test(a.type)).map(a => a.name);
    }

    // ========================================================================
    // 8. MAIN LOADER
    // ========================================================================
    function loadAndFilterData() {
        const app1 = getApp1Settings();

        const bunks = app1.bunks || [];
        const fields = app1.fields || [];
        const specials = getSpecialActivities();

        // Normalize divisions: object → array
        const rawDivs = app1.divisions || {};
        const divisionsArray = Array.isArray(rawDivs)
            ? rawDivs
            : Object.keys(rawDivs).map(k => ({ name: k, ...rawDivs[k] }));

        const daily = getDailyOverrides();

        const master = buildMasterActivities(app1, specials, fields);
        const times = buildTimeMappings(app1);
        const filtered = filterActivities(master, divisionsArray);

        const blocks = generateSchedulableBlocks(filtered, bunks, times, app1.increments || 30);
        const props = buildActivityProperties(master, fields);
        const fieldsBySport = buildFieldsBySport(master, fields);
        const h2hActivities = buildH2HActivities(master);

        const masterSpecials = master.filter(a => a.type === "Special");
        const specialNames = masterSpecials.map(s => s.name);

        const divisions = divisionsArray.reduce((m, d) => {
            if (d?.name) m[d.name] = d;
            return m;
        }, {});

        // Daily override values
        const disabledFields = daily.disabledFields || [];
        const disabledSpecials = daily.disabledSpecials || [];
        const disabledLeagues = daily.disabledLeagues || [];
        const disabledSpecialtyLeagues = daily.disabledSpecialtyLeagues || [];
        const dailyFieldAvailability = daily.dailyFieldAvailability || {};

        // Histories
        const yesterdayHistory = window.loadYesterdayHistory?.() || {};
        const rotationHistory = window.loadRotationHistory?.() || {};
        const historicalCounts = window.loadHistoricalCounts?.() || {};

        const masterZones = window.loadZones?.() || {};
        const bunkMetaData = window.bunkMetaData || {};
        const sportMetaData = window.sportMetaData || {};

        // Debug visibility
        window.TimeMappings = times;
        window.__lastFilteredActivities = filtered;
        window.__lastSchedulableBlocks = blocks;

        return {
            activities: filtered,
            allActivities: master,
            blocks,
            bunks,
            fields,
            divisions,

            masterActivities: master,
            masterFields: fields,
            masterSpecials,
            specialActivityNames: specialNames,

            activityProperties: props,
            fieldsBySport,
            h2hActivities,

            masterLeagues: window.masterLeagues || {},
            masterSpecialtyLeagues: window.masterSpecialtyLeagues || {},

            disabledFields,
            disabledSpecials,
            disabledLeagues,
            disabledSpecialtyLeagues,

            dailyFieldAvailability,
            historicalCounts,
            yesterdayHistory,
            rotationHistory,
            masterZones,

            bunkMetaData,
            sportMetaData
        };
    }

    // Export
    window.loadAndFilterData = loadAndFilterData;
    window.generateSchedulableBlocks = generateSchedulableBlocks;

})();
