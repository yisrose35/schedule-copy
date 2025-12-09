// ============================================================================
// scheduler_core_utils.js (FIXED v2)
// PART 1 of 3: THE FOUNDATION
//
// CRITICAL FIXES:
// 1. STRICT capacity enforcement (no exceeding max bunks)
// 2. SAME ACTIVITY requirement when sharing fields
// 3. Adjacent bunk preference scoring helper
// ============================================================================

(function () {
    'use strict';

    // ===== CONFIG =====
    const INCREMENT_MINS = 30;
    window.INCREMENT_MINS = INCREMENT_MINS;

    const TRANSITION_TYPE = "Transition/Buffer";
    window.TRANSITION_TYPE = TRANSITION_TYPE;

    const Utils = {};

    // =================================================================
    // 1. BASIC HELPERS
    // =================================================================

    Utils.parseTimeToMinutes = function (str) {
        if (str == null) return null;
        if (typeof str === "number") return str;
        if (typeof str !== "string") return null;

        let s = str.trim().toLowerCase();
        let mer = null;

        if (s.endsWith("am") || s.endsWith("pm")) {
            mer = s.endsWith("am") ? "am" : "pm";
            s = s.replace(/am|pm/gi, "").trim();
        }

        const m = s.match(/^(\d{1,2})\s*:\s*(\d{2})$/);
        if (!m) return null;

        let hh = parseInt(m[1], 10);
        const mm = parseInt(m[2], 10);

        if (mm < 0 || mm > 59) return null;

        if (mer) {
            if (hh === 12) hh = mer === "am" ? 0 : 12;
            else if (mer === "pm") hh += 12;
        }

        return hh * 60 + mm;
    };

    Utils.fieldLabel = function (f) {
        if (typeof f === "string") return f;
        if (f && typeof f === "object" && typeof f.name === "string") return f.name;
        return "";
    };

    Utils.fmtTime = function (d) {
        if (!d) return "";
        if (typeof d === 'string') d = new Date(d);
        let h = d.getHours();
        let m = d.getMinutes().toString().padStart(2, "0");
        const ap = h >= 12 ? "PM" : "AM";
        h = h % 12 || 12;
        return `${h}:${m} ${ap}`;
    };

    Utils.minutesToDate = function (mins) {
        const d = new Date(1970, 0, 1, 0, 0, 0);
        d.setMinutes(mins);
        return d;
    };

    Utils.findSlotsForRange = function (startMin, endMin) {
        const slots = [];
        if (!window.unifiedTimes || startMin == null || endMin == null) return slots;

        for (let i = 0; i < window.unifiedTimes.length; i++) {
            const slot = window.unifiedTimes[i];
            const slotStart = new Date(slot.start).getHours() * 60 + new Date(slot.start).getMinutes();
            if (slotStart >= startMin && slotStart < endMin) slots.push(i);
        }
        return slots;
    };

    Utils.getBlockTimeRange = function (block) {
        let blockStartMin = (typeof block.startTime === "number") ? block.startTime : null;
        let blockEndMin = (typeof block.endTime === "number") ? block.endTime : null;

        if ((!blockStartMin || !blockEndMin) && window.unifiedTimes && block.slots?.length) {
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
    // 2. TRANSITION / BUFFER LOGIC
    // =================================================================

    Utils.getTransitionRules = function (fieldName, activityProperties) {
        const base = {
            preMin: 0,
            postMin: 0,
            label: "Travel",
            zone: window.DEFAULT_ZONE_NAME || "default",
            occupiesField: false,
            minDurationMin: 0
        };

        if (!activityProperties) return base;

        const props = activityProperties[fieldName];
        if (!props?.transition) return base;

        return { ...base, ...props.transition };
    };

    Utils.getEffectiveTimeRange = function (block, rules) {
        const { blockStartMin, blockEndMin } = Utils.getBlockTimeRange(block);
        if (blockStartMin == null || blockEndMin == null) {
            return {
                blockStartMin,
                blockEndMin,
                effectiveStart: blockStartMin,
                effectiveEnd: blockEndMin,
                activityDuration: 0
            };
        }

        const pre = rules.preMin || 0;
        const post = rules.postMin || 0;

        const effectiveStart = blockStartMin + pre;
        const effectiveEnd = blockEndMin - post;

        return {
            blockStartMin,
            blockEndMin,
            effectiveStart,
            effectiveEnd,
            activityDuration: effectiveEnd - effectiveStart
        };
    };

    // =================================================================
    // 3. BUNK NUMBER EXTRACTION (for adjacent pairing)
    // =================================================================

    Utils.getBunkNumber = function (bunkName) {
        if (!bunkName) return Infinity;
        const match = String(bunkName).match(/(\d+)/);
        return match ? parseInt(match[1], 10) : Infinity;
    };

    Utils.getBunkDistance = function (bunk1, bunk2) {
        const num1 = Utils.getBunkNumber(bunk1);
        const num2 = Utils.getBunkNumber(bunk2);
        if (num1 === Infinity || num2 === Infinity) return Infinity;
        return Math.abs(num1 - num2);
    };

    // =================================================================
    // 4. FIELD USAGE HELPERS
    // =================================================================

    /**
     * Get current usage for a field at a slot
     * Returns: { count, bunks: {bunkName: activityName}, activities: Set }
     */
    function getFieldUsageAtSlot(slotIndex, fieldName, fieldUsageBySlot) {
        const result = { 
            count: 0, 
            bunks: {}, 
            activities: new Set(),
            bunkList: []
        };
        
        if (!fieldUsageBySlot || !fieldUsageBySlot[slotIndex]) return result;
        
        const slotData = fieldUsageBySlot[slotIndex];
        const fieldData = slotData[fieldName];
        
        if (!fieldData) return result;
        
        result.count = fieldData.count || 0;
        result.bunks = fieldData.bunks || {};
        result.bunkList = Object.keys(result.bunks);
        
        // Extract unique activities
        Object.values(result.bunks).forEach(actName => {
            if (actName) result.activities.add(actName.toLowerCase().trim());
        });
        
        return result;
    }

    /**
     * Also check window.scheduleAssignments for more accurate count
     */
    function getScheduleUsageAtSlot(slotIndex, fieldName) {
        const result = { 
            count: 0, 
            bunks: {}, 
            activities: new Set(),
            bunkList: []
        };
        
        const schedules = window.scheduleAssignments || {};
        
        for (const [bunk, slots] of Object.entries(schedules)) {
            const entry = slots?.[slotIndex];
            if (!entry) continue;
            
            const entryField = Utils.fieldLabel(entry.field) || entry._activity;
            if (!entryField) continue;
            
            // Check if this is the same field
            if (entryField.toLowerCase().trim() === fieldName.toLowerCase().trim()) {
                result.count++;
                result.bunks[bunk] = entry._activity || entry.sport || entryField;
                result.bunkList.push(bunk);
                
                const actName = entry._activity || entry.sport;
                if (actName) result.activities.add(actName.toLowerCase().trim());
            }
        }
        
        return result;
    }

    // =================================================================
    // 5. MAIN FIT LOGIC (STRICT ENFORCEMENT)
    // =================================================================

    Utils.isTimeAvailable = function (slotIndex, props) {
        if (!window.unifiedTimes?.[slotIndex]) return false;

        const slot = window.unifiedTimes[slotIndex];
        const slotStart = new Date(slot.start).getHours() * 60 + new Date(slot.start).getMinutes();
        const slotEnd = new Date(slot.end).getHours() * 60 + new Date(slot.end).getMinutes();

        const rules = (props.timeRules || []).map(r => {
            if (typeof r.startMin === "number") return r;
            return {
                ...r,
                startMin: Utils.parseTimeToMinutes(r.start),
                endMin: Utils.parseTimeToMinutes(r.end)
            };
        });

        if (rules.length === 0) return props.available !== false;

        if (!props.available) return false;

        let allowed = !rules.some(r => r.type === "Available");
        for (const rule of rules) {
            if (rule.type === "Available" &&
                slotStart >= rule.startMin &&
                slotEnd <= rule.endMin) {
                allowed = true;
                break;
            }
        }

        if (!allowed) return false;

        for (const rule of rules) {
            if (rule.type === "Unavailable" &&
                slotStart < rule.endMin &&
                slotEnd > rule.startMin) {
                return false;
            }
        }

        return true;
    };

    /**
     * MAIN FIT CHECK - Now with strict enforcement
     * 
     * @param block - The block to place
     * @param fieldName - The field/activity name
     * @param activityProperties - Properties lookup
     * @param fieldUsageBySlot - Usage tracking map
     * @param actName - The specific activity/sport being assigned
     * @param forceLeague - Whether this is a league placement
     */
    Utils.canBlockFit = function (block, fieldName, activityProperties, fieldUsageBySlot, actName, forceLeague = false) {
        if (!fieldUsageBySlot) fieldUsageBySlot = window.fieldUsageBySlot || {};
        if (!fieldName) return false;

        const baseProps = {
            available: true,
            sharable: false,
            sharableWith: { capacity: 1, type: "not_sharable" },
            timeRules: [],
            transition: { preMin: 0, postMin: 0, zone: "default", occupiesField: false }
        };

        const props = activityProperties?.[fieldName] || baseProps;

        // Get transition rules
        const rules = Utils.getTransitionRules(fieldName, activityProperties);
        const {
            blockStartMin, blockEndMin,
            effectiveStart, effectiveEnd,
            activityDuration
        } = Utils.getEffectiveTimeRange(block, rules);

        if (activityDuration <= 0 || activityDuration < (rules.minDurationMin || 0))
            return false;

        // =================================================================
        // CAPACITY CALCULATION (STRICT)
        // =================================================================
        let maxCapacity = 1;
        
        if (props.sharableWith?.capacity) {
            maxCapacity = parseInt(props.sharableWith.capacity) || 1;
        } else if (props.sharable || props.sharableWith?.type === "all" || props.sharableWith?.type === "custom") {
            maxCapacity = 2;
        }

        // Basic availability checks
        if (!props.available) return false;
        if (props.allowedDivisions?.length && !props.allowedDivisions.includes(block.divName)) return false;
        if (props.preferences?.enabled && props.preferences.exclusive &&
            !props.preferences.list.includes(block.divName)) return false;

        // LimitUsage check
        if (props.limitUsage?.enabled) {
            const rule = props.limitUsage.divisions[block.divName];
            if (!rule) return false;
            if (Array.isArray(rule) && !rule.includes(block.bunk)) return false;
        }

        // Get slots to check
        const slots = rules.occupiesField
            ? Utils.findSlotsForRange(blockStartMin, blockEndMin)
            : Utils.findSlotsForRange(effectiveStart, effectiveEnd);

        const uniqueSlots = [...new Set(slots)].sort((a, b) => a - b);

        // =================================================================
        // CHECK EACH SLOT
        // =================================================================
        for (const idx of uniqueSlots) {
            // Get usage from BOTH sources for accuracy
            const trackedUsage = getFieldUsageAtSlot(idx, fieldName, fieldUsageBySlot);
            const scheduleUsage = getScheduleUsageAtSlot(idx, fieldName);
            
            // Merge the two usage sources
            const allBunks = new Set([...trackedUsage.bunkList, ...scheduleUsage.bunkList]);
            const allActivities = new Set([...trackedUsage.activities, ...scheduleUsage.activities]);
            
            // Remove self if already counted
            allBunks.delete(block.bunk);
            
            const currentCount = allBunks.size;

            // =================================================================
            // FIX #1: STRICT CAPACITY CHECK
            // =================================================================
            if (currentCount >= maxCapacity) {
                // Field is FULL - reject
                return false;
            }

            // =================================================================
            // FIX #2: SAME ACTIVITY REQUIREMENT WHEN SHARING
            // =================================================================
            if (currentCount > 0 && actName) {
                const myActivity = actName.toLowerCase().trim();
                
                // If there are existing activities, we must match one of them
                if (allActivities.size > 0) {
                    const activitiesMatch = allActivities.has(myActivity);
                    
                    if (!activitiesMatch) {
                        // Different activity - reject sharing
                        console.log(`[SHARING BLOCKED] ${block.bunk} wants ${actName} on ${fieldName}, but existing bunks have: [${[...allActivities].join(', ')}]`);
                        return false;
                    }
                }
            }

            // Time availability check
            if (!Utils.isTimeAvailable(idx, props)) return false;

            // Headcount check (sport max capacity)
            const bunkMeta = window.bunkMetaData || Utils._bunkMetaData || {};
            const sportMeta = window.sportMetaData || Utils._sportMetaData || {};
            
            const maxHeadcount = sportMeta[actName]?.maxCapacity ?? Infinity;
            
            if (maxHeadcount !== Infinity) {
                let currentHeadcount = 0;
                allBunks.forEach(b => {
                    currentHeadcount += (bunkMeta[b]?.size || 0);
                });
                const mySize = bunkMeta[block.bunk]?.size || 0;
                
                if (currentHeadcount + mySize > maxHeadcount) {
                    return false;
                }
            }
        }

        return true;
    };

    /**
     * Calculate sharing score - HIGHER is better
     * Used by solver to prefer adjacent bunks
     */
    Utils.calculateSharingScore = function (block, fieldName, fieldUsageBySlot, actName) {
        if (!fieldUsageBySlot) fieldUsageBySlot = window.fieldUsageBySlot || {};
        
        let score = 0;
        const myBunkNum = Utils.getBunkNumber(block.bunk);
        
        const slots = Utils.findSlotsForRange(block.startTime, block.endTime);
        
        for (const idx of slots) {
            const scheduleUsage = getScheduleUsageAtSlot(idx, fieldName);
            
            if (scheduleUsage.count === 0) {
                // Empty field - good base score
                score += 100;
            } else {
                // Field has existing bunks - check adjacency
                let minDistance = Infinity;
                let sameActivity = true;
                
                for (const existingBunk of scheduleUsage.bunkList) {
                    const distance = Utils.getBunkDistance(block.bunk, existingBunk);
                    minDistance = Math.min(minDistance, distance);
                    
                    // Check activity match
                    const existingActivity = scheduleUsage.bunks[existingBunk];
                    if (existingActivity && actName) {
                        if (existingActivity.toLowerCase().trim() !== actName.toLowerCase().trim()) {
                            sameActivity = false;
                        }
                    }
                }
                
                // =================================================================
                // FIX #3: SCORING FOR ADJACENT BUNK PREFERENCE
                // =================================================================
                // Bunks 10 & 11 (distance 1) = +90 points
                // Bunks 10 & 12 (distance 2) = +80 points
                // Bunks 10 & 15 (distance 5) = +50 points
                // etc.
                
                if (minDistance < Infinity) {
                    score += Math.max(0, 100 - (minDistance * 10));
                }
                
                // Bonus for same activity
                if (sameActivity) {
                    score += 50;
                } else {
                    // Heavy penalty for different activities (shouldn't happen with canBlockFit check)
                    score -= 1000;
                }
            }
        }
        
        return score;
    };

    Utils.canLeagueGameFit = function (block, fieldName, usage, props) {
        return Utils.canBlockFit(block, fieldName, props, usage, "League Game", true);
    };

    // =================================================================
    // 6. TIMELINE
    // =================================================================

    Utils.timeline = {
        checkAvailability(resourceName, startMin, endMin, weight, capacity, excludeBunk) {
            const slots = Utils.findSlotsForRange(startMin, endMin);
            const assigns = window.scheduleAssignments || {};

            for (const s of slots) {
                let current = 0;
                for (const bunk of Object.keys(assigns)) {
                    if (bunk === excludeBunk) continue;
                    const entry = assigns[bunk][s];
                    if (!entry) continue;
                    const name = Utils.fieldLabel(entry.field) || entry._activity;
                    if (!name) continue;
                    if (name.toLowerCase() === resourceName.toLowerCase()) {
                        current++;
                    }
                }
                if (current + weight > capacity) return false;
            }
            return true;
        },

        getPeakUsage(resourceName, startMin, endMin, excludeBunk) {
            const slots = Utils.findSlotsForRange(startMin, endMin);
            const assigns = window.scheduleAssignments || {};
            let maxLoad = 0;
            for (const s of slots) {
                let current = 0;
                for (const bunk of Object.keys(assigns)) {
                    if (bunk === excludeBunk) continue;
                    const entry = assigns[bunk][s];
                    if (!entry) continue;
                    const name = Utils.fieldLabel(entry.field) || entry._activity;
                    if (!name) continue;
                    if (name.toLowerCase() === resourceName.toLowerCase()) {
                        current++;
                    }
                }
                maxLoad = Math.max(maxLoad, current);
            }
            return maxLoad;
        }
    };

    Utils.loadAndFilterData = function () {
        if (typeof window.loadAndFilterData !== "function") {
            console.error("ERROR: scheduler_core_loader.js not loaded before scheduler_core_utils.js");
            return {};
        }
        return window.loadAndFilterData();
    };

    window.SchedulerCoreUtils = Utils;

})();
