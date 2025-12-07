// ============================================================================
// scheduler_core_loader.js
// FULL REWRITE — SPEC-COMPLIANT LOADER FOR ORCHESTRATOR V3
//
// UPDATES:
// - FIXED: Handles app1.divisions structure (Name as Key vs Name as Property).
// - Ensures masterActivities includes generics to prevent "0 Properties" error.
// ============================================================================

(function () {
    'use strict';

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
    // 1. BUILD MASTER ACTIVITIES
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

        // 3. AUTO-DISCOVER SPORTS FROM FIELDS
        if (Array.isArray(fields)) {
            fields.forEach(f => {
                if (Array.isArray(f.activities)) {
                    f.activities.forEach(sportName => {
                        if (sportName && !seenNames.has(sportName)) {
                            list.push({
                                name: sportName,
                                type: 'field',
                                allowedFields: [f.name]
                            });
                            seenNames.add(sportName);
                        }
                    });
                }
            });
        }
        
        // 4. FORCE-INJECT GENERIC SLOTS
        const generics = ["General Activity Slot", "Sports Slot", "Special Activity"];
        generics.forEach(genName => {
             if (!seenNames.has(genName)) {
                list.push({
                    name: genName,
                    type: 'General',
                    duration: 60,
                    available: true
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
                ...a
            }));
    }

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

    function filterActivities(masterActivities, divisionsArray) {
        if (!masterActivities.length) return [];
        return masterActivities.filter(act => {
            if (act.divisions && act.divisions.length) {
                return divisionsArray.some(d => act.divisions.includes(d.name));
            }
            return true;
        });
    }

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

    function buildActivityProperties(masterActivities, fields) {
        const props = {};
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
                maxUsage: act.maxUsage || 0, 
                frequencyWeeks: act.frequencyWeeks || 0
            };
        });
        if (Array.isArray(fields)) {
            fields.forEach(f => {
                props[f.name] = {
                    available: f.available !== false,
                    sharable: false,
                    sharableWith: f.sharableWith || { type: 'not_sharable' },
                    allowedDivisions: [],
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
            if (a.type === 'field' || (a.allowedFields && a.allowedFields.length > 0)) {
                const relevantFields = fields.filter(f => 
                    f.activities && f.activities.includes(a.name)
                ).map(f => f.name);
                if (relevantFields.length > 0) map[a.name] = relevantFields;
            }
        });
        return map;
    }

    function buildH2HActivities(masterActivities) {
        return masterActivities.filter(a => /league/i.test(a.type)).map(a => a.name);
    }

    function loadAndFilterData() {
        const app1 = getApp1Settings();
        const bunks = app1.bunks || [];
        const fields = app1.fields || [];
        const specials = getSpecialActivities();
        const rawDivisions = app1.divisions || {};
        
        // --- FIXED DIVISION PARSING ---
        // Normalizes { "Junior": { bunks:[] } } -> [ { name: "Junior", bunks:[] } ]
        let divisionsArray = [];
        if (Array.isArray(rawDivisions)) {
            divisionsArray = rawDivisions;
        } else {
            divisionsArray = Object.keys(rawDivisions).map(key => ({
                name: key,
                ...rawDivisions[key]
            }));
        }
            
        const dailyOverrides = getDailyOverrides();
        const masterActivities = buildMasterActivities(app1, specials, fields);
        const TimeMappings = buildTimeMappings(app1);
        const filteredActivities = filterActivities(masterActivities, divisionsArray);
        const blocks = generateSchedulableBlocks(filteredActivities, bunks, TimeMappings, app1.increments || 30);
        const activityProperties = buildActivityProperties(masterActivities, fields);
        const fieldsBySport = buildFieldsBySport(masterActivities, fields);
        const h2hActivities = buildH2HActivities(masterActivities);
        const masterSpecials = masterActivities.filter(a => a.type === "Special");
        const specialActivityNames = masterSpecials.map(s => s.name);

        // Build Division Map
        const divisions = divisionsArray.reduce((m, d) => {
            if (d?.name) m[d.name] = d;
            return m;
        }, {});
        
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

        window.__lastFilteredActivities = filteredActivities;
        window.__lastSchedulableBlocks = blocks;
        window.TimeMappings = TimeMappings; 

        return {
            activities: filteredActivities,
            blocks,
            divisions,
            bunks,
            fields,
            masterActivities,
            masterSpecials,
            masterFields: fields, 
            activityProperties,
            allActivities: masterActivities,
            h2hActivities,
            fieldsBySport,
            masterLeagues: window.masterLeagues || {},
            masterSpecialtyLeagues: window.masterSpecialtyLeagues || {},
            disabledFields,
            disabledSpecials,
            disabledLeagues,
            disabledSpecialtyLeagues,
            historicalCounts,
            yesterdayHistory,
            rotationHistory,
            specialActivityNames,
            dailyFieldAvailability,
            masterZones,
            bunkMetaData,
            sportMetaData: window.sportMetaData || {} 
        };
    }

    window.loadAndFilterData = loadAndFilterData;
    window.generateSchedulableBlocks = generateSchedulableBlocks; 

})();
