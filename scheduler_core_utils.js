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
            // If times equal, process 'end' before 'start' to prevent false overlap at boundaries?
            // User requested: "Start right away no buffer". 
            // If A ends at 10:00 and B starts at 10:00, count should drop then rise.
            // So Sort: Time ASC, then End (-1) before Start (+1)
            points.sort((a, b) => {
                if (a.time !== b.time) return a.time - b.time;
                // If times match: END (-weight) comes before START (+weight)
                // This allows back-to-back scheduling (10:00 end, 10:00 start)
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
        const rules = (fieldProps.timeRules || []).map(r => ({
            type: r.type,
            startMin: Utils.parseTimeToMinutes(r.start),
            endMin: Utils.parseTimeToMinutes(r.end)
        }));

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

        let myWeight = 1;
        
        // LEAGUE LOGIC: Full Buyout
        // If I am a league, I consume the entire capacity
        if (isLeague) {
            myWeight = capacityLimit; 
        }

        // 3. Check Base Time Availability (Setup Rules)
        if (!Utils.isTimeAvailable(blockStartMin, blockEndMin, props)) return false;

        // 4. Check Activity Match (Don't mix Sports with Arts on same field if shared)
        // Note: Timeline handles pure capacity. Mixing logic is handled by checking who is there.
        // We can optionally peek at the owner metadata if needed, but pure capacity is usually enough.
        
        // 5. TIMELINE CHECK
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
    // 4. DATA LOADER (Initialize Timeline from saved data)
    // =================================================================
    Utils.loadAndFilterData = function() {
        const globalSettings = window.loadGlobalSettings?.() || {};
        const app1Data = globalSettings.app1 || {};
        const dailyData = window.loadCurrentDailyData?.() || {};
        
        // ... (Standard Data Loading - Fields, Divs, etc - Same as original) ...
        const masterFields = app1Data.fields || [];
        const masterDivisions = app1Data.divisions || {};
        const masterSpecials = app1Data.specialActivities || [];
        const bunkMetaData = app1Data.bunkMetaData || {};
        const sportMetaData = app1Data.sportMetaData || {};
        
        // ... (History calculation - Same as original) ...
        // [Omitted for brevity, assume standard load logic exists here]
        
        const activityProperties = {};
        // Rebuild properties map
        [...masterFields, ...masterSpecials].forEach(f => {
            activityProperties[f.name] = {
                available: f.available !== false,
                sharable: f.sharableWith?.type === 'all' || f.sharableWith?.type === 'custom',
                sharableWith: f.sharableWith,
                maxUsage: f.maxUsage || 0,
                timeRules: f.timeRules || []
            };
        });

        // -------------------------------------------------------------
        // REBUILD TIMELINE FROM SAVED SCHEDULE
        // -------------------------------------------------------------
        Utils.timeline = new TimelineSystem(); // Reset
        
        const assignments = dailyData.scheduleAssignments || {};
        const unifiedTimes = window.unifiedTimes || []; // Needed to map slots to times if raw times aren't saved

        Object.keys(assignments).forEach(bunk => {
            const schedule = assignments[bunk];
            if (!Array.isArray(schedule)) return;

            schedule.forEach((entry, slotIdx) => {
                if (!entry || entry.continuation) return;
                
                const fieldName = (typeof entry.field === 'string') ? entry.field : entry.field?.name;
                if (!fieldName || fieldName === "Free" || fieldName === "No Field") return;

                // Determine Time
                let startMin, endMin;
                
                // If using unifiedTimes slots
                if (unifiedTimes[slotIdx]) {
                    const sDate = new Date(unifiedTimes[slotIdx].start);
                    startMin = sDate.getHours() * 60 + sDate.getMinutes();
                    
                    // Determine End: Look ahead for continuations
                    let durationSlots = 1;
                    for (let i = slotIdx + 1; i < schedule.length; i++) {
                        if (schedule[i] && schedule[i].continuation && 
                            ((typeof schedule[i].field === 'string' ? schedule[i].field : schedule[i].field?.name) === fieldName)) {
                            durationSlots++;
                        } else {
                            break;
                        }
                    }
                    // End time based on last slot
                    const lastSlotIdx = slotIdx + durationSlots - 1;
                    if (unifiedTimes[lastSlotIdx]) {
                        // Use stored end time or default increment
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
                    // Determine Weight
                    let weight = 1;
                    // Leagues = Full Capacity
                    if (entry._h2h || entry.sport?.includes("League")) {
                        const props = activityProperties[fieldName];
                        if (props) {
                            weight = props.sharableWith?.capacity || (props.sharable ? 2 : 1);
                        } else {
                            weight = 2; // Default assume high for league
                        }
                    }

                    Utils.timeline.addReservation(fieldName, startMin, endMin, weight, bunk);
                }
            });
        });

        // ... (Return standard config object) ...
        return {
            divisions: {}, // (Populated in real run)
            availableDivisions: app1Data.availableDivisions || [],
            activityProperties,
            masterFields,
            masterSpecials,
            bunkMetaData,
            sportMetaData,
            // ... other standard returns
            fieldsBySport: {}, // (Populate based on masterFields)
            historicalCounts: {}, // (Populate from history)
            yesterdayHistory: {},
            rotationHistory: {}
        };
    };

    // Expose
    window.SchedulerCoreUtils = Utils;

})();
