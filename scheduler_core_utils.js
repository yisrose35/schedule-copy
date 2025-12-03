// ============================================================================
// scheduler_core_utils.js
// PART 1 of 3: THE FOUNDATION (TIMELINE EDITION)
//
// Updates:
// - Added TIMELINE CLASS: Minute-by-minute capacity tracking.
// - Removed Slot-Based Logic in favor of Timeline "Sweep" checks.
// - Added "Full Buyout" logic for Leagues.
// ============================================================================

(function() {
    'use strict';

    const Utils = {};
    const INCREMENT_MINS = 30; // Still used for grid visualization defaults

    // =================================================================
    // 1. TIMELINE LOGIC (THE GATEKEEPER)
    // =================================================================
    
    class TimelineSystem {
        constructor() {
            this.resources = {}; // { "Field Name": [ {start, end, weight, owner} ] }
        }

        // Initialize a resource timeline if missing
        _ensureResource(name) {
            if (!this.resources[name]) {
                this.resources[name] = [];
            }
        }

        // Add a reservation (No checks here, just storage)
        addReservation(resourceName, startMin, endMin, weight, owner) {
            if (!resourceName) return;
            this._ensureResource(resourceName);
            this.resources[resourceName].push({
                start: startMin,
                end: endMin,
                weight: weight,
                owner: owner
            });
        }

        // The "Sweep" Algorithm: Calculates Peak Load in a given window
        getPeakUsage(resourceName, startMin, endMin, excludeOwner = null) {
            if (!this.resources[resourceName]) return 0;

            // 1. Filter relevant events (Overlap Logic)
            // Event must start before window ends AND end after window starts
            const relevant = this.resources[resourceName].filter(r => {
                if (excludeOwner && r.owner === excludeOwner) return false;
                return (r.start < endMin && r.end > startMin);
            });

            if (relevant.length === 0) return 0;

            // 2. Create Time Points (Start = +Weight, End = -Weight)
            const points = [];
            relevant.forEach(r => {
                // Clamp points to the requested window for accurate graph
                const s = Math.max(startMin, r.start);
                const e = Math.min(endMin, r.end);
                
                if (s < e) {
                    points.push({ time: s, type: 'start', val: r.weight });
                    points.push({ time: e, type: 'end', val: -r.weight });
                }
            });

            // 3. Sort Points
            points.sort((a, b) => {
                if (a.time !== b.time) return a.time - b.time;
                // If times match: END (-weight) comes before START (+weight)
                // This allows back-to-back scheduling (10:00 end, 10:00 start) without buffer
                if (a.type === 'end' && b.type === 'start') return -1;
                if (a.type === 'start' && b.type === 'end') return 1;
                return 0;
            });

            // 4. Sweep
            let maxLoad = 0;
            let currentLoad = 0;

            points.forEach(p => {
                currentLoad += p.val;
                if (currentLoad > maxLoad) maxLoad = currentLoad;
            });

            return maxLoad;
        }

        // Main Check Function
        checkAvailability(resourceName, startMin, endMin, myWeight, capacityLimit, excludeOwner = null) {
            const peak = this.getPeakUsage(resourceName, startMin, endMin, excludeOwner);
            return (peak + myWeight) <= capacityLimit;
        }
    }

    // Global Timeline Instance
    Utils.timeline = new TimelineSystem();

    // =================================================================
    // 2. BASIC HELPERS
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
        } else return null;
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

    // Keep for legacy slot finding if needed, but not primary logic
    Utils.findSlotsForRange = function(startMin, endMin) {
        const slots = [];
        if (!window.unifiedTimes || startMin == null || endMin == null) return slots;
        for (let i = 0; i < window.unifiedTimes.length; i++) {
            const slot = window.unifiedTimes[i];
            const d = new Date(slot.start);
            const slotStart = d.getHours() * 60 + d.getMinutes();
            if (slotStart >= startMin && slotStart < endMin) {
                slots.push(i);
            }
        }
        return slots;
    };

    Utils.getBlockTimeRange = function(block) {
        // Prefer explicit start/end
        if (block.startTime !== undefined && block.endTime !== undefined) {
            return {
                blockStartMin: Utils.parseTimeToMinutes(block.startTime),
                blockEndMin: Utils.parseTimeToMinutes(block.endTime)
            };
        }
        // Fallback to slots (Old System)
        if (window.unifiedTimes && Array.isArray(block.slots) && block.slots.length > 0) {
            const minIndex = Math.min(...block.slots);
            const maxIndex = Math.max(...block.slots);
            const firstSlot = window.unifiedTimes[minIndex];
            const lastSlot = window.unifiedTimes[maxIndex];
            if (firstSlot && lastSlot) {
                const firstStart = new Date(firstSlot.start);
                const lastStart = new Date(lastSlot.start);
                return {
                    blockStartMin: firstStart.getHours() * 60 + firstStart.getMinutes(),
                    blockEndMin: lastStart.getHours() * 60 + lastStart.getMinutes() + INCREMENT_MINS
                };
            }
        }
        return { blockStartMin: null, blockEndMin: null };
    };

    // =================================================================
    // 3. CONSTRAINT LOGIC (TIMELINE ADAPTER)
    // =================================================================
    
    // Check if time window is legally open in the Field Definition
    Utils.isTimeAvailable = function(startMin, endMin, fieldProps) {
        if (!fieldProps) return true;
        
        // Parse Rules
        const rules = (fieldProps.timeRules || []).map(r => {
            if (typeof r.startMin === "number" && typeof r.endMin === "number") return r;
            return {
                type: r.type,
                startMin: Utils.parseTimeToMinutes(r.start),
                endMin: Utils.parseTimeToMinutes(r.end)
            };
        });

        if (rules.length === 0) return fieldProps.available;
        if (!fieldProps.available) return false;

        const hasAvailableRules = rules.some(r => r.type === 'Available');
        
        // 1. If "Available" rules exist, current time MUST be inside one
        if (hasAvailableRules) {
            let insideAvailable = false;
            for (const rule of rules) {
                if (rule.type === 'Available') {
                    // Check if block fits entirely inside available window
                    if (startMin >= rule.startMin && endMin <= rule.endMin) {
                        insideAvailable = true;
                        break;
                    }
                }
            }
            if (!insideAvailable) return false;
        }

        // 2. If "Unavailable" rules exist, current time MUST NOT overlap
        for (const rule of rules) {
            if (rule.type === 'Unavailable') {
                // Overlap check
                if (startMin < rule.endMin && endMin > rule.startMin) {
                    return false;
                }
            }
        }

        return true;
    };

    // NEW: The Timeline-Based Check
    Utils.canBlockFit = function(block, fieldName, activityProperties, proposedActivity, isLeague = false) {
        if (!fieldName) return false;
        const props = activityProperties[fieldName];
        if (!props) return true; // No rules, assume open

        // 1. Parse Block Time
        const { blockStartMin, blockEndMin } = Utils.getBlockTimeRange(block);
        if (blockStartMin == null || blockEndMin == null) return false;

        // 2. Determine Limits & Weights
        let capacityLimit = 1; // Default Exclusive
        
        // Check Sharable
        if (props.sharableWith) {
            if (props.sharableWith.capacity) capacityLimit = parseInt(props.sharableWith.capacity);
            else if (props.sharable || props.sharableWith.type === 'all' || props.sharableWith.type === 'custom') capacityLimit = 2;
        } else if (props.sharable) {
            capacityLimit = 2;
        }

        // Check Division/Bunk Restrictions (Strict)
        if (props.preferences && props.preferences.enabled && props.preferences.exclusive && !props.preferences.list.includes(block.divName)) return false;
        if (props && Array.isArray(props.allowedDivisions) && props.allowedDivisions.length > 0 && !props.allowedDivisions.includes(block.divName)) return false;
        
        const limitRules = props.limitUsage;
        if (limitRules && limitRules.enabled) {
            if (!limitRules.divisions[block.divName]) return false; // Division not allowed
            const allowedBunks = limitRules.divisions[block.divName];
            if (allowedBunks.length > 0 && block.bunk && !allowedBunks.includes(block.bunk)) return false; // Specific bunk check
        }

        let myWeight = 1;
        
        // LEAGUE LOGIC: Full Buyout
        // If I am a league, I consume the entire capacity
        if (isLeague) {
            myWeight = capacityLimit; 
        }

        // 3. Check Base Time Availability (Setup Rules)
        if (!Utils.isTimeAvailable(blockStartMin, blockEndMin, props)) return false;

        // 4. TIMELINE CHECK
        // Check if adding 'myWeight' to the current peak load exceeds 'capacityLimit'
        return Utils.timeline.checkAvailability(
            fieldName, 
            blockStartMin, 
            blockEndMin, 
            myWeight, 
            capacityLimit,
            block.bunk // Exclude myself (for resizing/moving logic)
        );
    };

    // =================================================================
    // 4. DATA LOADER (With Timeline Rebuild)
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

            Object.entries(allDaily).forEach(([dateStr, dayData]) => {
                const sched = dayData.scheduleAssignments || {};
                Object.keys(sched).forEach(b => {
                    if (!rawHistory[b]) rawHistory[b] = {};
                    (sched[b] || []).forEach(e => {
                        if (e && e._activity && !e.continuation) {
                            if (!rawHistory[b][e._activity]) rawHistory[b][e._activity] = [];
                            rawHistory[b][e._activity].push(dateStr);
                        }
                    });
                });
            });

            const todayStr = window.currentScheduleDate; 
            const todayDate = new Date(todayStr);

            Object.keys(rawHistory).forEach(b => {
                if (!historicalCounts[b]) historicalCounts[b] = {};
                if (!lastUsedDates[b]) lastUsedDates[b] = {};
                
                Object.keys(rawHistory[b]).forEach(act => {
                    const dates = rawHistory[b][act].sort(); 
                    if (dates.length > 0) {
                        lastUsedDates[b][act] = dates[dates.length - 1];
                    }

                    const rule = specialRules[act];
                    if (!rule || !rule.frequencyWeeks || rule.frequencyWeeks === 0) {
                        historicalCounts[b][act] = dates.length;
                    } else {
                        const windowDays = rule.frequencyWeeks * 7;
                        let windowStart = null;
                        let windowCount = 0;

                        for (const dStr of dates) {
                            const d = new Date(dStr);
                            if (!windowStart) {
                                windowStart = d;
                                windowCount = 1;
                            } else {
                                const diffTime = Math.abs(d - windowStart);
                                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
                                if (diffDays <= windowDays) {
                                    windowCount++;
                                } else {
                                    windowStart = d;
                                    windowCount = 1;
                                }
                            }
                        }

                        if (windowStart) {
                            const diffTime = Math.abs(todayDate - windowStart);
                            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                            if (diffDays <= windowDays) {
                                historicalCounts[b][act] = windowCount;
                            } else {
                                historicalCounts[b][act] = 0;
                            }
                        } else {
                            historicalCounts[b][act] = 0;
                        }
                    }
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
                    const current = historicalCounts[b][act] || 0;
                    historicalCounts[b][act] = Math.max(0, current + offset);
                });
            });

        } catch (e) {
            console.error("Error calculating historical counts:", e);
        }

        const overrides = {
            bunks: dailyOverrides.bunks || [],
            leagues: disabledLeagues
        };

        const availableDivisions = (app1Data.availableDivisions || []).filter(
            divName => !overrides.bunks.includes(divName)
        );

        const divisions = {};
        for (const divName of availableDivisions) {
            if (!masterDivisions[divName]) continue;
            divisions[divName] = JSON.parse(JSON.stringify(masterDivisions[divName]));
            divisions[divName].bunks =
                (divisions[divName].bunks || [])
                    .filter(bunkName => !overrides.bunks.includes(bunkName));
        }

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
            } else if (f.divisionAvailability && f.divisionAvailability.mode === 'specific' && Array.isArray(f.divisionAvailability.divisions) && f.divisionAvailability.divisions.length > 0) {
                allowedDivisions = f.divisionAvailability.divisions.slice();
            } else if (Array.isArray(f.sharableWith?.divisions) && f.sharableWith.divisions.length > 0) {
                allowedDivisions = f.sharableWith.divisions.slice();
            }

            const safeLimitUsage = (f.limitUsage && f.limitUsage.enabled) 
                ? { enabled: true, divisions: f.limitUsage.divisions || {} }
                : { enabled: false, divisions: {} };

            let capacity = 1;
            if (f.sharableWith) {
                if (f.sharableWith.capacity) capacity = parseInt(f.sharableWith.capacity);
                else if (f.sharableWith.type === 'all' || f.sharableWith.type === 'custom') capacity = 2;
            } else if (f.sharable) {
                capacity = 2;
            }
            if(!f.sharableWith) f.sharableWith = { capacity: capacity };
            else f.sharableWith.capacity = capacity;

            activityProperties[f.name] = {
                available: isMasterAvailable,
                sharable: f.sharableWith?.type === 'all' || f.sharableWith?.type === 'custom',
                sharableWith: f.sharableWith,
                maxUsage: f.maxUsage || 0, 
                allowedDivisions,
                limitUsage: safeLimitUsage,
                preferences: f.preferences || { enabled: false, exclusive: false, list: [] },
                timeRules: finalRules
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
                    const isDisabledToday = dailyDisabledSportsByField[f.name]?.includes(sport);
                    if (!isDisabledToday) {
                        fieldsBySport[sport] = fieldsBySport[sport] || [];
                        fieldsBySport[sport].push(f.name);
                    }
                });
            }
        });

        const allActivities = [
            ...availFields.flatMap(f => (f.activities || []).map(act => ({
                type: "field", field: f.name, sport: act
            }))).filter(a =>
                !a.field || !a.sport || !dailyDisabledSportsByField[a.field]?.includes(a.sport)
            ),
            ...availSpecials.map(sa => ({
                type: "special", field: sa.name, sport: null
            }))
        ];

        const h2hActivities = allActivities.filter(a => a.type === "field" && a.sport);

        const yesterdayData = window.loadPreviousDailyData?.() || {};
        const yesterdayHistory = {
            schedule: yesterdayData.scheduleAssignments || {},
            leagues: yesterdayData.leagueAssignments || {}
        };

        // -------------------------------------------------------------
        // REBUILD TIMELINE FROM SAVED SCHEDULE
        // -------------------------------------------------------------
        Utils.timeline = new TimelineSystem(); // Reset
        
        const assignments = dailyData.scheduleAssignments || {};
        const unifiedTimes = window.unifiedTimes || []; 

        Object.keys(assignments).forEach(bunk => {
            const schedule = assignments[bunk];
            if (!Array.isArray(schedule)) return;

            schedule.forEach((entry, slotIdx) => {
                if (!entry || entry.continuation) return;
                
                const fieldName = (typeof entry.field === 'string') ? entry.field : entry.field?.name;
                if (!fieldName || fieldName === "Free" || fieldName === "No Field") return;

                let startMin, endMin;
                
                if (unifiedTimes[slotIdx]) {
                    const sDate = new Date(unifiedTimes[slotIdx].start);
                    startMin = sDate.getHours() * 60 + sDate.getMinutes();
                    
                    let durationSlots = 1;
                    for (let i = slotIdx + 1; i < schedule.length; i++) {
                        if (schedule[i] && schedule[i].continuation && 
                            ((typeof schedule[i].field === 'string' ? schedule[i].field : schedule[i].field?.name) === fieldName)) {
                            durationSlots++;
                        } else {
                            break;
                        }
                    }
                    const lastSlotIdx = slotIdx + durationSlots - 1;
                    if (unifiedTimes[lastSlotIdx]) {
                        if (unifiedTimes[lastSlotIdx].end) {
                            const eDate = new Date(unifiedTimes[lastSlotIdx].end);
                            endMin = eDate.getHours() * 60 + eDate.getMinutes();
                        } else {
                            const lsDate = new Date(unifiedTimes[lastSlotIdx].start);
                            endMin = (lsDate.getHours() * 60 + lsDate.getMinutes()) + INCREMENT_MINS;
                        }
                    }
                }

                if (startMin != null && endMin != null) {
                    let weight = 1;
                    if (entry._h2h || (entry.sport && entry.sport.includes("League"))) {
                        const props = activityProperties[fieldName];
                        if (props) {
                            weight = props.sharableWith?.capacity || (props.sharable ? 2 : 1);
                        } else {
                            weight = 2; 
                        }
                    }
                    Utils.timeline.addReservation(fieldName, startMin, endMin, weight, bunk);
                }
            });
        });

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
            sportMetaData
        };
    };

    // Expose
    window.SchedulerCoreUtils = Utils;

})();
