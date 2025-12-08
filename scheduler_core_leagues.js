// ============================================================================
// scheduler_core_loader.js (MAGNUS CARLSEN "GRANDMASTER" EDITION)
// v3.0 - STRATEGIC DATA PREPARATION & HEURISTIC WEIGHTING
// ============================================================================

(function () {
    'use strict';

    // ------------------------------------------------------------------------
    // GRANDMASTER UTILS: HEURISTICS & WEIGHTS
    // ------------------------------------------------------------------------
    const GM_WEIGHTS = {
        SPECIAL: 100,      // The "Queen" - Must be scheduled if requested
        LEAGUE: 50,        // The "Rook" - Major structural element
        WATERFRONT: 30,    // The "Bishop" - highly constrained resource
        SPORT_FIELD: 15,   // The "Knight" - flexible but needs specific squares
        GENERAL: 5,        // The "Pawn" - filler, moves forward
        DEFAULT: 1
    };

    /**
     * Calculates the "Piece Value" of an activity for the scheduler engine.
     * Higher value = higher priority in the search tree.
     */
    function calculateStrategicValue(activity) {
        if (activity.type === "Special") return GM_WEIGHTS.SPECIAL;
        if (/league/i.test(activity.name) || /league/i.test(activity.type)) return GM_WEIGHTS.LEAGUE;
        if (/swim|boat|lake|pool/i.test(activity.name)) return GM_WEIGHTS.WATERFRONT;
        if (activity.allowedFields && activity.allowedFields.length > 0) return GM_WEIGHTS.SPORT_FIELD;
        if (activity.type === "General") return GM_WEIGHTS.GENERAL;
        return GM_WEIGHTS.DEFAULT;
    }

    // ------------------------------------------------------------------------
    // BASIC GETTERS
    // ------------------------------------------------------------------------
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
    // 1. BUILD MASTER ACTIVITIES (THE PIECES)
    // ------------------------------------------------------------------------
    function buildMasterActivities(app1, specials, fields) {
        let list = [];
        const seenNames = new Set();

        // Helper to push unique
        const add = (item, typeOverride = null) => {
            if (item && item.name && !seenNames.has(item.name)) {
                // MAGNUS UPGRADE: Attach Strategic Value immediately
                const type = typeOverride || item.type || 'General';
                const baseObj = { ...item, type };
                
                list.push({
                    ...baseObj,
                    strategicValue: calculateStrategicValue(baseObj) // Pre-calc weight
                });
                seenNames.add(item.name);
            }
        };

        // 1. App-defined activities
        if (Array.isArray(app1.activities)) {
            app1.activities.forEach(a => add(a));
        }

        // 2. Special Activities
        if (Array.isArray(specials)) {
            specials.forEach(s => add(s, s.type || 'Special'));
        }

        // 3. SPORTS FROM FIELDS (critical for league mapping)
        fields.forEach(f => {
            if (!f || !Array.isArray(f.activities)) return;
            f.activities.forEach(sportName => {
                if (sportName && !seenNames.has(sportName)) {
                    add({
                        name: sportName,
                        type: 'field',
                        allowedFields: [f.name]
                    });
                }
            });
        });

        // 4. GENERIC SLOTS (The Pawns)
        ["General Activity Slot", "Sports Slot", "Special Activity"].forEach(gen => {
            add({
                name: gen,
                type: "General",
                duration: 60,
                available: true
            });
        });

        const defaultDurations = app1.defaultDurations || {};
        const increments = app1.increments || 30;

        // Final normalization
        return list.map(a => ({
            name: a.name,
            duration: a.duration || defaultDurations[a.name] || increments,
            type: a.type || "General",
            allowedFields: a.allowedFields || a.fields || null,
            divisions: a.divisions || null,
            strategicValue: a.strategicValue || 1, // Ensure weight exists
            ...a
        }));
    }

    // ------------------------------------------------------------------------
    // 2. TIME MAPPINGS (THE CLOCK)
    // ------------------------------------------------------------------------
    function toMin(t) {
        if (!t) return 0;
        const [h, m] = t.split(":").map(Number);
        return h * 60 + m;
    }

    function buildTimeMappings(app1) {
        const increments = app1.increments || 30;
        const startMin = toMin(app1.startTime || "9:00");
        const endMin = toMin(app1.endTime || "17:00");

        const arr = [];
        let cur = startMin;
        while (cur < endMin) {
            arr.push({ start: cur, end: cur + increments });
            cur += increments;
        }
        return arr;
    }

    // ------------------------------------------------------------------------
    // 3. ACTIVITY FILTERING & PRUNING
    // ------------------------------------------------------------------------
    function filterActivities(masterActivities, divisionsArray) {
        return masterActivities.filter(a => {
            // "Opening Theory": If a move is impossible (no division can do it), prune it now.
            if (a.divisions?.length) {
                return divisionsArray.some(d => a.divisions.includes(d.name));
            }
            return true;
        });
    }

    // ------------------------------------------------------------------------
    // 4. GENERATE SCHEDULABLE BLOCKS (THE MOVE LIST)
    // ------------------------------------------------------------------------
    function generateSchedulableBlocks(filtered, bunks, TimeMappings, increments, divisionsMap) {
        const blocks = [];
        
        // Cache divisions for O(1) lookups during generation
        const bunkDivCache = {}; 
        
        bunks.forEach(bunk => {
            const bunkName = typeof bunk === "string" ? bunk : bunk.name;
            const bunkObj = typeof bunk === "string" ? { name: bunk } : bunk; // Normalize
            
            // "Board Awareness": Determine bunk's division once
            if (!bunkDivCache[bunkName] && bunkObj.division) {
                bunkDivCache[bunkName] = bunkObj.division;
            }

            filtered.forEach(act => {
                // MAGNUS OPTIMIZATION: "Pruning Bad Lines"
                // If this activity is restricted to specific divisions, and this bunk 
                // isn't in one of them, do not generate blocks. Save memory.
                if (act.divisions && act.divisions.length > 0) {
                    const myDiv = bunkDivCache[bunkName];
                    if (myDiv && !act.divisions.includes(myDiv)) {
                        return; // Skip generation
                    }
                }

                const dur = act.duration || increments;
                const slotsNeeded = Math.ceil(dur / increments);

                TimeMappings.forEach((tm, idx) => {
                    const end = idx + slotsNeeded - 1;
                    if (end < TimeMappings.length) {
                        blocks.push({
                            id: `${bunkName}_${act.name}_${tm.start}`, // Unique ID for engine tracking
                            bunk: bunkName,
                            activity: act.name,
                            event: act.name,
                            type: act.type,
                            strategicValue: act.strategicValue, // Pass weight to the block
                            duration: dur,
                            slots: Array.from({ length: slotsNeeded }, (_, i) => idx + i),
                            startTime: TimeMappings[idx].start,
                            endTime: TimeMappings[end].end
                        });
                    }
                });
            });
        });
        return blocks;
    }

    // ------------------------------------------------------------------------
    // 5. ACTIVITY PROPERTIES (THE PIECE STATS)
    // ------------------------------------------------------------------------
    function buildActivityProperties(masterActivities, fields) {
        const props = {};

        function base(over) {
            return {
                available: true,
                sharable: false,
                sharableWith: { type: "not_sharable", capacity: 999 },
                preferredDivisions: [],
                allowedDivisions: [],
                allowedFields: null,
                transition: null,
                preferences: null,
                limitUsage: null,
                timeRules: [],
                minDurationMin: 0,
                maxUsage: 0,
                frequencyWeeks: 0,
                exhaustionScore: 0, // NEW: Fatigue management
                ...over
            };
        }

        masterActivities.forEach(a => {
            // Heuristic: Sports cause more exhaustion than Arts
            const exhaustion = /sport|run|swim/i.test(a.type) ? 10 : 2;
            
            props[a.name] = base({
                available: a.available !== false,
                sharable: a.sharable || false,
                sharableWith: a.sharableWith || null,
                preferredDivisions: a.divisions || [],
                allowedDivisions: a.divisions || [],
                allowedFields: a.allowedFields || null,
                transition: a.transition || null,
                preferences: a.preferences || null,
                limitUsage: a.limitUsage || null,
                timeRules: a.timeRules || [],
                minDurationMin: a.minDurationMin || 0,
                maxUsage: a.maxUsage || 0,
                strategicValue: a.strategicValue,
                exhaustionScore: a.exhaustionScore || exhaustion
            });
        });

        fields.forEach(f => {
            const cap = f.sharableWith?.capacity || 999;
            props[f.name] = base({
                available: f.available !== false,
                sharableWith: { ...f.sharableWith, capacity: cap },
                allowedDivisions: [],
                transition: f.transition || null,
                preferences: f.preferences || null,
                limitUsage: f.limitUsage || null,
                timeRules: f.timeRules || []
            });
        });

        return props;
    }

    // ------------------------------------------------------------------------
    // 6. FIELDS BY SPORT (THE BOARD CONTROL)
    // ------------------------------------------------------------------------
    function buildFieldsBySport(masterActivities, fields) {
        const map = {};

        masterActivities.forEach(a => {
            if (a?.name) map[a.name] = [];
        });

        fields.forEach(f => {
            if (!f?.activities) return;
            f.activities.forEach(sport => {
                if (!map[sport]) map[sport] = [];
                map[sport].push(f.name);
            });
        });
        
        // GCM PATCH: Ensure duplicates are removed if multiple entries exist
        Object.keys(map).forEach(k => {
            map[k] = [...new Set(map[k])];
        });

        return map;
    }

    // ------------------------------------------------------------------------
    // 7. H2H / LEAGUE NAMES
    // ------------------------------------------------------------------------
    function buildH2HActivities(masterActivities) {
        return masterActivities.filter(a => /league/i.test(a.type)).map(a => a.name);
    }

    // ------------------------------------------------------------------------
    // 8. MAIN DATA LOADER
    // ------------------------------------------------------------------------
    function loadAndFilterData() {
        // PERFORMANCE: Start Timer
        const t0 = performance.now();

        const app1 = getApp1Settings();
        const bunks = app1.bunks || [];
        const fields = app1.fields || [];
        const specials = getSpecialActivities();

        const rawDivs = app1.divisions || {};
        const divisionsArray = Array.isArray(rawDivs)
            ? rawDivs
            : Object.keys(rawDivs).map(name => ({ name, ...rawDivs[name] }));
        
        const divisionsMap = divisionsArray.reduce((m, d) => {
            if (d?.name) m[d.name] = d;
            return m;
        }, {});

        const dailyOverrides = getDailyOverrides();
        const masterActivities = buildMasterActivities(app1, specials, fields);
        const TimeMappings = buildTimeMappings(app1);

        const filteredActivities = filterActivities(masterActivities, divisionsArray);
        
        // Pass divisionsMap for "Opening Theory" Pruning
        const blocks = generateSchedulableBlocks(
            filteredActivities,
            bunks,
            TimeMappings,
            app1.increments || 30,
            divisionsMap
        );

        const activityProperties = buildActivityProperties(masterActivities, fields);
        const fieldsBySport = buildFieldsBySport(masterActivities, fields);
        const h2hActivities = buildH2HActivities(masterActivities);

        const masterSpecials = masterActivities.filter(a => a.type === "Special");
        const specialActivityNames = masterSpecials.map(s => s.name);

        console.log(`[MagnusLoader] Loaded ${blocks.length} moves in ${(performance.now() - t0).toFixed(2)}ms.`);

        return {
            activities: filteredActivities,
            blocks,
            divisions: divisionsMap,
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

            disabledFields: dailyOverrides.disabledFields || [],
            disabledSpecials: dailyOverrides.disabledSpecials || [],
            disabledLeagues: dailyOverrides.disabledLeagues || [],
            disabledSpecialtyLeagues: dailyOverrides.disabledSpecialtyLeagues || [],

            historicalCounts: window.loadHistoricalCounts?.() || {},
            yesterdayHistory: window.loadYesterdayHistory?.() || {},
            rotationHistory: window.loadRotationHistory?.() || {},
            specialActivityNames,
            dailyFieldAvailability: dailyOverrides.dailyFieldAvailability || {},
            masterZones: window.loadZones?.() || {},
            bunkMetaData: window.bunkMetaData || {},
            sportMetaData: window.sportMetaData || {}
        };
    }

    window.loadAndFilterData = loadAndFilterData;
    window.generateSchedulableBlocks = generateSchedulableBlocks;

})();
