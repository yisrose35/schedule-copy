// ============================================================================
// scheduler_core_loader.js
// FULL REWRITE — SPEC-COMPLIANT LOADER FOR ORCHESTRATOR V3
//
// UPDATES:
// - Automatically scrapes 'fields' to populate 'masterActivities' with sports.
// - CRITICAL FIX: Loads Fields into 'activityProperties' so Fillers can validate them.
// - Ensures allActivities list is complete so the solver has options.
// - Added defensive checks to ensure data is loaded before processing.
// ============================================================================

(function () {
    'use strict';

    // ------------------------------------------------------------------------
    // 0. SAFE GETTERS FOR app1 + GLOBALS
    // ------------------------------------------------------------------------
    // We defer fetching these until loadAndFilterData is called to ensure
    // global settings have been loaded.
    
    function getApp1Settings() {
        return (window.loadGlobalSettings?.() || {}).app1 || window.app1 || {};
    }

    function getSpecialActivities() {
        return (window.specialActivities || []).slice();
    }

    function getDailyOverrides() {
        return window.loadCurrentDailyData?.() || {};
    }

    // ------------------------------------------------------------------------
    // 1. BUILD MASTER ACTIVITIES (Fixed to include Field Sports)
    // ------------------------------------------------------------------------
    function buildMasterActivities(app1, specials, fields) {
        let list = [];
        const seenNames = new Set();

        // 1. App defined activities
        if (Array.isArray(app1.activities)) {
            app1.activities.forEach(a => {
                if(a && a.name && !seenNames.has(a.name)) {
                    list.push(a);
                    seenNames.add(a.name);
                }
            });
        }

        // 2. Special Activities
        if (Array.isArray(specials)) {
            specials.forEach(s => {
                if(s && s.name && !seenNames.has(s.name)) {
                    list.push({ ...s, type: 'Special' });
                    seenNames.add(s.name);
                }
            });
        }

        // 3. AUTO-DISCOVER SPORTS FROM FIELDS (Crucial Fix)
        if (Array.isArray(fields)) {
            fields.forEach(f => {
                if (Array.isArray(f.activities)) {
                    f.activities.forEach(sportName => {
                        if (sportName && !seenNames.has(sportName)) {
                            list.push({
                                name: sportName,
                                type: 'field', // treated as sport/field activity
                                allowedFields: [f.name] // initially just this field, normalized later
                            });
                            seenNames.add(sportName);
                        }
                    });
                }
            });
        }
        
        // 4. Add generic slots if missing (to ensure properties exist for them)
        const generics = ["General Activity Slot", "Sports Slot", "Special Activity"];
        generics.forEach(genName => {
             if (!seenNames.has(genName)) {
                list.push({
                    name: genName,
                    type: 'General',
                    duration: 60 
                });
                seenNames.add(genName);
            }
        });

        const defaultDurations = app1.defaultDurations || {};
        const increments = app1.increments || 30;

        return list
            .filter(a => a && a.name)
            .map(a => ({
                name: a.name,
                duration: a.duration || defaultDurations[a.name] || increments,
                type: a.type || "General",
                allowedFields: a.allowedFields || a.fields || null,
                divisions: a.divisions || null,
                // Pass through properties for utils
                ...a
            }));
    }

    // ------------------------------------------------------------------------
    // 2. BUILD TIME MAPPINGS
    // ------------------------------------------------------------------------
    function toMin(t) {
        if (!t) return 0;
        const [h, m] = t.split(":").map(Number);
        return h * 60 + m;
    }

    function buildTimeMappings(app1) {
        const increments = app1.increments || 30;
        const startTime = app1.startTime || "9:00";
        const endTime = app1.endTime || "17:00";

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

    // ------------------------------------------------------------------------
    // 3. FILTER ACTIVITIES BY DIVISION
    // ------------------------------------------------------------------------
    function filterActivities(masterActivities, divisionsArray) {
        if (!masterActivities.length) return [];

        return masterActivities.filter(act => {
            if (act.divisions && act.divisions.length) {
                return divisionsArray.some(d => act.divisions.includes(d.name));
            }
            return true;
        });
    }

    // ------------------------------------------------------------------------
    // 4. BUILD SCHEDULABLE BLOCKS
    // ------------------------------------------------------------------------
    function generateSchedulableBlocks(filtered, bunks, TimeMappings, increments) {
        const blocks = [];

        bunks.forEach(bunk => {
            if (!bunk) return;
            const bunkName = (typeof bunk === 'string') ? bunk : bunk.name;

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
    function buildActivityProperties(masterActivities, fields) {
        const props = {};

        // 1. Load Activities
        masterActivities.forEach(act => {
            const name = act.name;
            props[name] = {
                available: act.available !== false,
                sharable: act.sharable || false,
                sharableWith: act.sharableWith || null,
                preferredDivisions: act.divisions || [],
                allowedDivisions: act.divisions || [],
                allowedFields: act.allowedFields || null,
                transition: act.transition || null,
                preferences: act.preferences || null,
                limitUsage: act.limitUsage || null,
                timeRules: act.timeRules || [],
                minDurationMin: act.minDurationMin || 0,
                maxUsage: act.maxUsage || 0, // Ensure limits pass through
                frequencyWeeks: act.frequencyWeeks || 0
            };
        });

        // 2. Load FIELDS (Crucial for Fillers to validate field existence)
        if (Array.isArray(fields)) {
            fields.forEach(f => {
                props[f.name] = {
                    available: f.available !== false,
                    sharable: false, // Fields handle sharing via sharableWith usually
                    sharableWith: f.sharableWith || { type: 'not_sharable' },
                    allowedDivisions: [], // Fields usually open unless restricted by preferences
                    transition: f.transition || null,
                    preferences: f.preferences || null,
                    limitUsage: f.limitUsage || null,
                    timeRules: f.timeRules || [],
                    minDurationMin: 0
                };
            });
        }

        return props;
    }

    function buildFieldsBySport(masterActivities, fields) {
        const map = {};

        masterActivities.forEach(a => {
            // Check 'field' type (auto-discovered) OR explicit field list
            if (a.type === 'field' || (a.allowedFields && a.allowedFields.length > 0)) {
                
                // Re-scan fields to be sure we get ALL fields for this sport
                // (The auto-discovery might have only caught the first one)
                const relevantFields = fields.filter(f => 
                    f.activities && f.activities.includes(a.name)
                ).map(f => f.name);

                if (relevantFields.length > 0) {
                    map[a.name] = relevantFields;
                }
            }
        });

        return map;
    }

    function buildH2HActivities(masterActivities) {
        return masterActivities
            .filter(a => /league/i.test(a.type))
            .map(a => a.name);
    }

    // ------------------------------------------------------------------------
    // 6. MAIN LOADER PIPELINE
    // ------------------------------------------------------------------------
    function loadAndFilterData() {
        const app1 = getApp1Settings();
        const bunks = app1.bunks || [];
        const fields = app1.fields || [];
        const specials = getSpecialActivities();
        const rawDivisions = app1.divisions || [];
        const divisionsArray = Array.isArray(rawDivisions) 
            ? rawDivisions 
            : Object.values(rawDivisions || {});
            
        const dailyOverrides = getDailyOverrides();

        // 1. Build Data
        const masterActivities = buildMasterActivities(app1, specials, fields);
        const TimeMappings = buildTimeMappings(app1);
        
        // 2. Filter & Process
        const filteredActivities = filterActivities(masterActivities, divisionsArray);
        const blocks = generateSchedulableBlocks(filteredActivities, bunks, TimeMappings, app1.increments || 30);
        const activityProperties = buildActivityProperties(masterActivities, fields);
        const fieldsBySport = buildFieldsBySport(masterActivities, fields);
        const h2hActivities = buildH2HActivities(masterActivities);

        const masterSpecials = masterActivities.filter(a => a.type === "Special");
        const specialActivityNames = masterSpecials.map(s => s.name);

        // Convert divisions array → division map
        const divisions = divisionsArray.reduce((m, d) => {
            if (d?.name) m[d.name] = d;
            return m;
        }, {});
        
        // Load Histories & Overrides
        const disabledFields = dailyOverrides.disabledFields || [];
        const disabledSpecials = dailyOverrides.disabledSpecials || [];
        const disabledLeagues = dailyOverrides.disabledLeagues || [];
        const disabledSpecialtyLeagues = dailyOverrides.disabledSpecialtyLeagues || [];
        
        const yesterdayHistory = window.loadYesterdayHistory?.() || {};
        const rotationHistory = window.loadRotationHistory?.() || {};
        const historicalCounts = window.loadHistoricalCounts?.() || {};
        const dailyFieldAvailability = dailyOverrides.dailyFieldAvailability || {};
        const masterZones = window.loadZones?.() || {};
        const bunkMetaData = window.bunkMetaData || {};

        // Expose for debugging
        window.__lastFilteredActivities = filteredActivities;
        window.__lastSchedulableBlocks = blocks;
        window.TimeMappings = TimeMappings; // Ensure global access

        // Make final orchestrator-safe config object
        return {
            // core schedule data
            activities: filteredActivities,
            blocks,
            divisions,
            bunks,
            fields,
            masterActivities,
            masterSpecials,
            masterFields: fields, // Explicitly pass for solver

            // orchestrator-required data
            activityProperties,
            allActivities: masterActivities,
            h2hActivities,
            fieldsBySport,

            // league systems
            masterLeagues: window.masterLeagues || {},
            masterSpecialtyLeagues: window.masterSpecialtyLeagues || {},

            // daily disabled sets
            disabledFields,
            disabledSpecials,
            disabledLeagues,
            disabledSpecialtyLeagues,

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
            bunkMetaData,
            sportMetaData: window.sportMetaData || {} 
        };
    }

    // ------------------------------------------------------------------------
    // 7. EXPORT TO WINDOW
    // ------------------------------------------------------------------------
    window.loadAndFilterData = loadAndFilterData;
    // We expose these for individual testing if needed, though loadAndFilterData is the main entry point
    window.generateSchedulableBlocks = generateSchedulableBlocks; 

})();
