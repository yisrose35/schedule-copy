// ============================================================================
// scheduler_core_loader.js
// REBUILT COMPLETE DATA LOADER FOR CAMP SCHEDULER
// ============================================================================
// Responsibilities:
// 1) Load divisions, bunks, fields, specials, activities from app1 + other files
// 2) Normalize activities & specials into master lists
// 3) Build TimeMappings (slot -> minute ranges)
// 4) Filter activities per settings
// 5) Build schedulable blocks for all bunks
// 6) Export everything to window.* for all other modules
// ============================================================================

(function () {
    'use strict';

    // ========================================================================
    // 0. SAFE GETTERS FOR app1
    // ========================================================================
    const settings = (window.loadGlobalSettings?.() || {}).app1 || {};
    const app1 = window.app1 || settings || {};

    const divisions = app1.divisions || [];
    const bunks = app1.bunks || [];
    const fields = app1.fields || [];
    const specials = (window.specialActivities || []).slice();
    const defaultDurations = app1.defaultDurations || {};


    // ========================================================================
    // 1. BUILD MASTER ACTIVITIES + SPECIALS
    // ========================================================================

    function buildMasterActivities() {
        let list = [];

        // Standard activities inside app1?
        if (Array.isArray(app1.activities)) {
            list = list.concat(app1.activities);
        }

        // Special activities from special_activities.js
        if (Array.isArray(specials)) {
            list = list.concat(specials);
        }

        // Normalize: ensure each has name, duration, type
        return list
            .filter(a => a && a.name)
            .map(a => ({
                name: a.name,
                duration: a.duration || defaultDurations[a.name] || 30,
                type: a.type || "General",
                allowedFields: a.allowedFields || a.fields || null,
                divisions: a.divisions || null
            }));
    }

    const masterActivities = buildMasterActivities();

    // Build masterSpecials as any activity flagged type = "Special"
    const masterSpecials = masterActivities.filter(a => a.type === "Special");


    // ========================================================================
    // 2. BUILD TimeMappings (slot index → time range)
    // ========================================================================

    // The scheduler_core_main expects a standard 30-minute increment mapping.
    // We replicate the format used by Utils.findSlotsForRange(...)
    function buildTimeMappings() {
        const increments = app1.increments || 30; // default 30 min slots
        const startTime = app1.startTime || "9:00";
        const endTime = app1.endTime || "17:00";

        const toMin = t => {
            const [h, m] = t.split(":").map(Number);
            return h * 60 + m;
        };

        const startMin = toMin(startTime);
        const endMin = toMin(endTime);

        const mappings = [];
        let cur = startMin;

        while (cur < endMin) {
            mappings.push({
                start: cur,
                end: cur + increments
            });
            cur += increments;
        }

        return mappings;
    }

    const TimeMappings = buildTimeMappings();


    // ========================================================================
    // 3. FILTER ACTIVITIES (older pipeline logic and modern version)
    // ========================================================================

    function filterActivities() {
        if (!masterActivities.length) return [];

        const allowed = [];

        masterActivities.forEach(act => {
            // Division-based filtering
            if (act.divisions && act.divisions.length) {
                // only keep if at least one division exists in app1
                const ok = divisions.some(d => act.divisions.includes(d.name));
                if (!ok) return;
            }

            allowed.push(act);
        });

        return allowed;
    }

    let __lastFilteredActivities = [];


    // ========================================================================
    // 4. BUILD SCHEDULABLE BLOCKS
    // ========================================================================
    function generateSchedulableBlocks(filtered) {
        const blocks = [];

        bunks.forEach(bunk => {
            if (!bunk || !bunk.name) return;

            const bunkName = bunk.name;

            // Each activity -> available times (simple version)
            filtered.forEach(act => {
                const dur = act.duration || 30;
                const slotsNeeded = Math.ceil(dur / (app1.increments || 30));

                TimeMappings.forEach((tm, slotIndex) => {
                    const endSlot = slotIndex + slotsNeeded - 1;
                    if (endSlot < TimeMappings.length) {
                        blocks.push({
                            bunk: bunkName,
                            activity: act.name,
                            event: act.name,
                            duration: dur,
                            slots: Array.from({ length: slotsNeeded }, (_, i) => slotIndex + i),
                            startTime: TimeMappings[slotIndex].start,
                            endTime: TimeMappings[endSlot].end
                        });
                    }
                });
            });
        });

        return blocks;
    }


    // ========================================================================
    // 5. loadAndFilterData(): full main pipeline
    // ========================================================================

    function loadAndFilterData() {
        __lastFilteredActivities = filterActivities();
        window.__lastFilteredActivities = __lastFilteredActivities;

        const blocks = generateSchedulableBlocks(__lastFilteredActivities);
        window.__lastSchedulableBlocks = blocks;

        return { activities: __lastFilteredActivities, blocks };
    }


    // ========================================================================
    // 6. EXPORT EVERYTHING TO window.*
    // ========================================================================

    window.masterActivities = masterActivities;
    window.masterSpecials = masterSpecials;
    window.divisionsByName = divisions.reduce((m, d) => { m[d.name] = d; return m; }, {});
    window.bunks = bunks;
    window.fields = fields;
    window.defaultDurations = defaultDurations;

    window.TimeMappings = TimeMappings;
    window.loadAndFilterData = loadAndFilterData;
    window.generateSchedulableBlocks = generateSchedulableBlocks;

    window.__lastFilteredActivities = __lastFilteredActivities;
    window.__lastSchedulableBlocks = null;

})();
