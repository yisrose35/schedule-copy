// ============================================================================
// scheduler_core_utils.js
// PART 1 of 3: THE FOUNDATION
//
// UPDATED (V2.0 FIXES):
// - FIXED: Overly strict Division Firewall removed, replaced with rule-based logic.
// - NEW: League Exclusivity Enforcement: If an assignment is League-related, it consumes 
//        maxCapacity, making the field unshareable for that slot.
// - Fixed several capacity and division restriction checks for accuracy.
// ============================================================================
(function() {
    'use strict';

    // ===== CONFIG =====
    const INCREMENT_MINS = 30;
    window.INCREMENT_MINS = INCREMENT_MINS;
    
    // --- New Constants for Transition Blocks ---
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

    Utils.findSlotsForRange = function(startMin, endMin) {
        const slots = [];
        if (!window.unifiedTimes || startMin == null || endMin == null) return slots;
        for (let i = 0; i < window.unifiedTimes.length; i++) {
            const slot = window.unifiedTimes[i];
            const d = new Date(slot.start);
            const slotStart = d.getHours() * 60 + d.getMinutes();
            const slotEnd = new Date(slot.end).getHours() * 60 + new Date(slot.end).getMinutes();
            if (slotStart < endMin && slotEnd > startMin) {
                slots.push(i);
            }
        }
        return slots;
    };

    Utils.getBlockTimeRange = function(block) {
        let blockStartMin = (typeof block.startTime === "number") ? block.startTime : null;
        let blockEndMin = (typeof block.endTime === "number") ? block.endTime : null;

        if ((blockStartMin == null || blockEndMin == null) &&
            window.unifiedTimes &&
            Array.isArray(block.slots) &&
            block.slots.length > 0) {
            const minIndex = Math.min(...block.slots);
            const maxIndex = Math.max(...block.slots);
            const firstSlot = window.unifiedTimes[minIndex];
            const lastSlot = window.unifiedTimes[maxIndex];
            if (firstSlot && lastSlot) {
                const firstStart = new Date(firstSlot.start);
                const lastEnd = new Date(lastSlot.end);
                blockStartMin = firstStart.getHours() * 60 + firstStart.getMinutes();
                blockEndMin = lastEnd.getHours() * 60 + lastEnd.getMinutes();
            }
        }
        return { blockStartMin, blockEndMin };
    };

    // =================================================================
    // 2. NEW TRANSITION/BUFFER LOGIC
    // =================================================================
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
        const { blockStartMin, blockEndMin } = Utils.getBlockTimeRange(block);
        
        if (blockStartMin === null || blockEndMin === null) {
            return { effectiveStart: blockStartMin, effectiveEnd: blockEndMin };
        }

        const preMin = transitionRules.preMin || 0;
        const postMin = transitionRules.postMin || 0;

        const effectiveStart = blockStartMin + preMin;
        const effectiveEnd = blockEndMin - postMin;

        const activityDuration = effectiveEnd - effectiveStart;
        const totalDuration = blockEndMin - blockStartMin;

        return { blockStartMin, blockEndMin, effectiveStart, effectiveEnd, activityDuration, totalDuration };
    };

    // =================================================================
    // 3. CONSTRAINT LOGIC
    // =================================================================
    Utils.isTimeAvailable = function(slotIndex, fieldProps) {
        if (!window.unifiedTimes || !window.unifiedTimes[slotIndex]) return false;
        const slot = window.unifiedTimes[slotIndex];
        const slotStartMin = new Date(slot.start).getHours() * 60 + new Date(slot.start).getMinutes();
        const slotEndMin = new Date(slot.end).getHours() * 60 + new Date(slot.end).getMinutes();

        const rules = (fieldProps.timeRules || []).map(r => {
            if (typeof r.startMin === "number" && typeof r.endMin === "number") return r;
            return { ...r, startMin: Utils.parseTimeToMinutes(r.start), endMin: Utils.parseTimeToMinutes(r.end) };
        });

        if (rules.length === 0) return fieldProps.available;
        if (!fieldProps.available) return false;

        const hasAvailableRules = rules.some(r => r.type === 'Available');
        let isAvailable = !hasAvailableRules;

        for (const rule of rules) {
            if (rule.type === 'Available') {
                if (slotStartMin >= rule.startMin && slotEndMin <= rule.endMin) {
                    isAvailable = true;
                    break;
                }
            }
        }

        for (const rule of rules) {
            if (rule.type === 'Unavailable') {
                if (slotStartMin < rule.endMin && slotEndMin > rule.startMin) {
                    isAvailable = false;
                    break;
                }
            }
        }

        return isAvailable;
    };

    function isLeagueAssignment(assignmentObj, activityName) {
        if (assignmentObj) {
            if (assignmentObj._h2h || assignmentObj._gameLabel) return true;
            if (assignmentObj._activity && String(assignmentObj._activity).toLowerCase().includes("league")) return true;
        }
        const s = String(activityName || "").toLowerCase();
        if (s.includes("league game") || s.includes("specialty league") || s.includes("h2h")) return true;
        return false;
    }

    function calculateAssignmentWeight(activityName, assignmentObj, maxCapacity) {
        if (isLeagueAssignment(assignmentObj, activityName)) return maxCapacity;
        return 1;
    }

    function getRootFieldName(name) {
        if (!name) return "";
        const parts = String(name).split(/\s+[-–]\s+/);
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
                if (u.bunks) Object.assign(combined.bunks, u.bunks);
            }
        });
        return combined;
    }

    function isFieldTakenByLeagueText(slotIndex, targetFieldName) {
        if (!window.scheduleAssignments) return false;

        const targetRoot = getRootFieldName(targetFieldName);
        const bunks = Object.keys(window.scheduleAssignments);

        for (const bunk of bunks) {
            const entry = window.scheduleAssignments[bunk][slotIndex];
            if (entry) {
                const textToCheck = (entry._allMatchups || "") + " " + (entry._gameLabel || "") + " " + (entry.description || "");
                if (isLeagueAssignment(entry, entry._activity)) {
                    const lower = textToCheck.toLowerCase();
                    if (lower.includes("@ " + targetRoot) || lower.includes("@" + targetRoot)) {
                        return true;
                    }
                }
            }
        }

        return false;
    }

    // =================================================================
    // MAIN CAPACITY CHECK (THE BOUNCER)
    // =================================================================
    Utils.canBlockFit = function(block, fieldName, activityProperties, fieldUsageBySlot, proposedActivity) {
        if (!fieldName) return false;
        const props = activityProperties[fieldName];
        if (!props) return true;

        // FIX: Only one declaration now
        const transRules = Utils.getTransitionRules(fieldName, activityProperties);

        const { blockStartMin, blockEndMin, effectiveStart, effectiveEnd, activityDuration } =
            Utils.getEffectiveTimeRange(block, transRules);

        const proposedIsLeague = isLeagueAssignment({_activity: proposedActivity, _h2h: proposedActivity?.toLowerCase()?.includes('league')}, proposedActivity);

        if (activityDuration < transRules.minDurationMin) return false;
        if (activityDuration <= 0) return false;

        if (transRules.preMin > 0 || transRules.postMin > 0) {
            const zones = window.getZones?.() || {};
            const zone = zones[transRules.zone];
            const maxConcurrent = zone?.maxConcurrent || 99;

            if (maxConcurrent < 99) {
                const isMerged = blockStartMin > 0 &&
                    window.scheduleAssignments[block.bunk]?.[block.slots[0] - 1]?._zone === transRules.zone;

                if (!isMerged) {
                    const currentTransitionCount = window.__transitionUsage?.[transRules.zone] || 0;
                    if (currentTransitionCount >= maxConcurrent) return false;
                }
            }
        }

        let maxCapacity = 1;
        const sharableWith = props.sharableWith || {};

        if (sharableWith.capacity) maxCapacity = parseInt(sharableWith.capacity);
        else if (sharableWith.type === 'all' || sharableWith.type === 'custom' || props.sharable) maxCapacity = 2;

        const bunkMetaData = window.SchedulerCoreUtils._bunkMetaData || {};
        const sportMetaData = window.SchedulerCoreUtils._sportMetaData || {};
        const maxHeadcount = sportMetaData[proposedActivity]?.maxCapacity || Infinity;
        const mySize = bunkMetaData[block.bunk]?.size || 0;

        if (props.preferences && props.preferences.enabled && props.preferences.exclusive && !props.preferences.list.includes(block.divName)) return false;

        if (props && Array.isArray(props.allowedDivisions) && props.allowedDivisions.length > 0 &&
            !props.allowedDivisions.includes(block.divName)) return false;

        const limitRules = props.limitUsage;
        if (limitRules && limitRules.enabled) {
            if (!limitRules.divisions[block.divName]) return false;
            const allowedBunks = limitRules.divisions[block.divName];
            if (allowedBunks.length > 0 && block.bunk && !allowedBunks.includes(block.bunk)) return false;
        }

        const rules = (props.timeRules || []).map(r => {
            if (typeof r.startMin === "number" && typeof r.endMin === "number") return r;
            return { ...r, startMin: Utils.parseTimeToMinutes(r.start), endMin: Utils.parseTimeToMinutes(r.end) };
        });

        if (rules.length > 0) {
            if (!props.available) return false;

            if (blockStartMin != null && blockEndMin != null) {
                const hasAvailableRules = rules.some(r => r.type === 'Available');
                let insideAvailable = !hasAvailableRules;

                if (hasAvailableRules) {
                    for (const r of rules) {
                        if (r.type !== 'Available' || r.startMin == null || r.endMin == null) continue;
                        if (blockStartMin >= r.startMin && blockEndMin <= r.endMin) {
                            insideAvailable = true;
                            break;
                        }
                    }
                    if (!insideAvailable) return false;
                }

                for (const r of rules) {
                    if (r.type !== 'Unavailable' || r.startMin == null || r.endMin == null) continue;
                    if (blockStartMin < r.endMin && blockEndMin > r.startMin) return false;
                }
            }
        } else {
            if (!props.available) return false;
        }

        const scanSlots =
            transRules.occupiesField
                ? Utils.findSlotsForRange(blockStartMin, blockEndMin)
                : Utils.findSlotsForRange(effectiveStart, effectiveEnd);

        const uniqueSlots = [...new Set(scanSlots)].sort((a, b) => a - b);

        for (const slotIndex of uniqueSlots) {
            if (slotIndex === undefined) return false;

            if (isFieldTakenByLeagueText(slotIndex, fieldName)) return false;

            const usage = getCombinedUsage(slotIndex, fieldName, fieldUsageBySlot);

            if (usage.divisions && usage.divisions.length > 0) {
                const sharableDivs = sharableWith.divisions || [];
                const isCustom = sharableWith.type === 'custom';

                if (isCustom && !sharableDivs.includes(block.divName)) return false;

                if (maxCapacity > 1 && isCustom) {
                    for (const existingDiv of usage.divisions) {
                        if (existingDiv !== block.divName && !sharableDivs.includes(existingDiv)) {
                            return false;
                        }
                    }
                } else if (maxCapacity === 1) {
                    if (usage.divisions.some(d => d !== block.divName)) return false;
                }
            }

            let currentWeight = 0;
            const existingBunks = Object.keys(usage.bunks);

            for (const existingBunk of existingBunks) {
                if (existingBunk === block.bunk) continue;

                const activityName = usage.bunks[existingBunk];
                const actualAssignment = window.scheduleAssignments[existingBunk]?.[slotIndex];

                const myLabel = block._gameLabel || (proposedIsLeague ? proposedActivity : null);
                const theirLabel = actualAssignment?._gameLabel || actualAssignment?._activity;
                const isSameGame = (myLabel && theirLabel && String(myLabel) === String(theirLabel));

                const existingIsLeague = isLeagueAssignment(actualAssignment, activityName);

                if (existingIsLeague && !isSameGame) return false;
                if (proposedIsLeague && !existingIsLeague) return false;

                if (!isSameGame) {
                    currentWeight += calculateAssignmentWeight(activityName, actualAssignment, maxCapacity);
                }
            }

            let myWeight = proposedIsLeague ? maxCapacity : 1;

            if (currentWeight + myWeight > maxCapacity) return false;

            if (maxHeadcount !== Infinity) {
                let currentHeadcount = 0;
                Object.keys(usage.bunks).forEach(b => {
                    currentHeadcount += (bunkMetaData[b]?.size || 0);
                });
                if (currentHeadcount + mySize > maxHeadcount) return false;
            }

            if (!Utils.isTimeAvailable(slotIndex, props)) return false;
        }

        return true;
    };


    Utils.canLeagueGameFit = function(block, fieldName, fieldUsageBySlot, activityProperties) {
        return Utils.canBlockFit(block, fieldName, activityProperties, fieldUsageBySlot, "League Game");
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
                    
                    const events = Array.isArray(sched[b]) ? sched[b] : [];
                    
                    events.forEach(e => {
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
            if(!f.sharableWith) f.sharableWith = { capacity, type: 'not_sharable', divisions: [] };
            else f.sharableWith.capacity = capacity;
            
            const transition = f.transition || {
                preMin: 0, postMin: 0, label: "Travel", zone: window.DEFAULT_ZONE_NAME, occupiesField: false, minDurationMin: 0
            };

            activityProperties[f.name] = {
                available: isMasterAvailable,
                sharable: f.sharableWith?.type === 'all' || f.sharableWith?.type === 'custom',
                sharableWith: f.sharableWith,
                maxUsage: f.maxUsage || 0,
                allowedDivisions,
                limitUsage: safeLimitUsage,
                preferences: f.preferences || { enabled: false, exclusive: false, list: [] },
                timeRules: finalRules,
                transition
            };

            if (isMasterAvailable) availableActivityNames.push(f.name);
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
