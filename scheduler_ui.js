// =================================================================
// scheduler_ui.js
//
// Renders the main "Daily Schedule" view.
// FEATURES:
// - Layout matches the "Double Header" screenshot (Division Bar -> Bunks).
// - Single unified table with sticky headers and columns.
// - Edit-on-click functionality for all cells.
// - Specific color coding for activities (Lunch, Snacks, etc.).
// =================================================================

(function() {
    'use strict';

    // ===== HELPERS =====
    const INCREMENT_MINS = 30; 

    function parseTimeToMinutes(str) {
        if (!str || typeof str !== "string") return null;
        let s = str.trim().toLowerCase();
        let mer = null;
        if (s.endsWith("am") || s.endsWith("pm")) {
            mer = s.endsWith("am") ? "am" : "pm";
            s = s.replace(/am|pm/g, "").trim();
        }
        const m = s.match(/^(\d{1,2})\s*:\s*(\d{2})$/);
        if (!m) return null;
        let hh = parseInt(m[1], 10);
        const mm = parseInt(m[2], 10);
        if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
        if (mer) {
            if (hh === 12) hh = mer === "am" ? 0 : 12; 
            else if (mer === "pm") hh += 12; 
        } else {
            return null; 
        }
        return hh * 60 + mm;
    }

    function fieldLabel(f) {
        if (typeof f === "string") return f;
        if (f && typeof f === "object" && typeof f.name === "string") return f.name;
        return "";
    }

    function minutesToTimeLabel(min) {
        if (min == null || Number.isNaN(min)) return "Invalid"; 
        let h = Math.floor(min / 60);
        const m = (min % 60).toString().padStart(2, "0");
        const ap = h >= 12 ? "PM" : "AM";
        h = h % 12 || 12;
        return `${h}:${m} ${ap}`;
    }

    // ===== INIT =====
    function initScheduleSystem() {
        console.log("Initializing Schedule System...");
        if (window.loadCurrentDailyData) {
            window.loadCurrentDailyData();
        }
        updateTable();
    }

    // ===== EDITING =====
    function findSlotsForRange(startMin, endMin) {
        const slots = [];
        if (!window.unifiedTimes) return slots;
        for (let i = 0; i < window.unifiedTimes.length; i++) {
            const slot = window.unifiedTimes[i];
            const slotStart = new Date(slot.start).getHours() * 60 + new Date(slot.start).getMinutes();
            if (slotStart >= startMin && slotStart < endMin) {
                slots.push(i);
            }
        }
        return slots;
    }

    function editCell(bunkName, startMin, endMin, currentActivity) {
        if (!bunkName) return;
        const newActivityName = prompt(
            `Edit activity for ${bunkName}\n(${minutesToTimeLabel(startMin)} - ${minutesToTimeLabel(endMin)}):\n\n(Enter 'CLEAR' or 'FREE' to empty)`,
            currentActivity
        );
        if (newActivityName === null) return;

        const finalActivityName = newActivityName.trim();
        const slotsToUpdate = findSlotsForRange(startMin, endMin);

        if (!window.scheduleAssignments[bunkName]) {
            window.scheduleAssignments[bunkName] = new Array(window.unifiedTimes.length);
        }

        if (finalActivityName === "" || finalActivityName.toUpperCase() === "CLEAR" || finalActivityName.toUpperCase() === "FREE") {
            slotsToUpdate.forEach((slotIndex, idx) => {
                window.scheduleAssignments[bunkName][slotIndex] = {
                    field: "Free", sport: null, continuation: idx > 0, _fixed: true, _h2h: false, _activity: "Free"
                };
            });
        } else {
            slotsToUpdate.forEach((slotIndex, idx) => {
                window.scheduleAssignments[bunkName][slotIndex] = {
                    field: finalActivityName, sport: null, continuation: idx > 0, _fixed: true, _h2h: false, vs: null, _activity: finalActivityName
                };
            });
        }
        saveSchedule();
        updateTable();
    }

    // ===== RENDERING =====
    function updateTable() {
        const container = document.getElementById("scheduleTable");
        if (!container) return;

        const unifiedTimes = window.unifiedTimes || window.currentDailyData?.unifiedTimes || [];
        const assignments = window.scheduleAssignments || window.currentDailyData?.scheduleAssignments || {};
        const divisions = window.divisions || {}; 
        const availableDivisions = window.availableDivisions || [];

        if (!unifiedTimes || unifiedTimes.length === 0) {
            container.innerHTML = `<div style="padding:20px;text-align:center;color:#666;">No schedule generated yet.</div>`;
            return;
        }

        // --- Build HTML Structure ---
        let html = `
        <div class="schedule-container">
            <table class="schedule-table">
                <thead>
                    <!-- Row 1: Division Headers -->
                    <tr>
                        <th class="time-header sticky-corner" rowspan="2">Time</th>
        `;

        // Header Row 1: Division Bars
        availableDivisions.forEach(divName => {
            const div = divisions[divName];
            if (div && div.bunks && div.bunks.length > 0) {
                const bunkCount = div.bunks.length;
                // Use division color if available, else default green
                const color = div.color || '#4CAF50'; 
                html += `<th colspan="${bunkCount}" class="div-header" style="background-color: ${color}; border-color: ${color};">${divName}</th>`;
            }
        });

        html += `</tr><!-- Row 2: Bunk Headers --><tr>`;

        // Header Row 2: Bunks & Column Mapping
        const colMap = []; 
        
        availableDivisions.forEach(divName => {
            const div = divisions[divName];
            if (div && div.bunks && div.bunks.length > 0) {
                // Sort bunks naturally if needed, or use existing order
                const bunks = div.bunks.slice().sort((a,b) => a.localeCompare(b, undefined, {numeric: true}));
                bunks.forEach(bunk => {
                    colMap.push({ bunk: bunk, div: divName });
                    html += `<th class="bunk-header">${bunk}</th>`;
                });
            }
        });

        html += `</tr></thead><tbody>`;

        // Data Rows
        unifiedTimes.forEach((slot, slotIndex) => {
            // Helper to calculate start/end minutes for the edit function
            const startMin = new Date(slot.start).getHours() * 60 + new Date(slot.start).getMinutes();
            const endMin = startMin + INCREMENT_MINS;
            const timeLabel = slot.label; // e.g., "11:00 AM - 11:30 AM"

            html += `<tr>`;
            html += `<td class="time-col sticky-col">${timeLabel}</td>`;

            colMap.forEach(col => {
                const bunk = col.bunk;
                const bunkSchedule = assignments[bunk];
                const entry = bunkSchedule ? bunkSchedule[slotIndex] : null;

                let cellText = "";
                let cellStyle = "";
                let cellTitle = "Click to edit";
                let activityNameForEdit = "";

                if (entry) {
                    if (entry.continuation) {
                        // Merged block visual - empty text but same bg
                        cellText = ""; 
                        // Match styling of the parent block
                        if (entry._h2h) cellStyle = "background-color: #e3f2fd;"; 
                        else if (entry.field === "Lunch") cellStyle = "background-color: #fff9c4;";
                        else if (entry.field === "Snacks") cellStyle = "background-color: #dcedc8;";
                        else if (entry.field === "Dismissal") cellStyle = "background-color: #ffebee;";
                        else if (entry._fixed) cellStyle = "background-color: #fff8e1;"; 
                        else cellStyle = "background-color: #ffffff;";
                        
                        activityNameForEdit = entry.field; // Still editable
                    } else {
                        activityNameForEdit = fieldLabel(entry.field);
                        
                        // --- Content & Styling Logic ---
                        if (entry._h2h) {
                            // League Game
                            const label = entry.sport || "League Game";
                            cellText = label;
                            cellStyle = "background-color: #e3f2fd; color: #0d47a1;"; 
                        } else {
                            // Regular Activity
                            let fName = fieldLabel(entry.field);
                            cellText = fName;

                            // Specific Activity Colors (Matching Screenshot)
                            if (fName === "Lunch") {
                                cellStyle = "background-color: #fff9c4; font-weight: bold; color: #555;"; // Yellow
                            } else if (fName === "Snacks") {
                                cellStyle = "background-color: #dcedc8; font-weight: bold; color: #33691e;"; // Green
                            } else if (fName === "Dismissal") {
                                cellStyle = "background-color: #ffebee; font-weight: bold; color: #b71c1c;"; // Red
                            } else if (fName === "Regroup") {
                                cellStyle = "background-color: #fff3e0; font-weight: bold; color: #e65100;"; // Orange
                            } else if (fName && (fName.includes("Swim") || fName === "Swim")) {
                                cellStyle = "background-color: #ffffff; color: #0277bd;"; 
                            } else if (fName === "Free" || fName === "No Field") {
                                cellStyle = "background-color: #f9f9f9; color: #ccc; font-style: italic;";
                            } else {
                                // Default White for activities
                                cellStyle = "background-color: #ffffff; color: #333;";
                            }
                        }
                    }
                } else {
                    cellText = "";
                    cellStyle = "background: #fcfcfc;";
                }

                // Add the cell with click handler
                // Note: passing arguments to onclick requires escaping quotes carefully
                const safeActivity = (activityNameForEdit || "").replace(/'/g, "\\'");
                
                html += `<td style="${cellStyle} cursor:pointer;" title="${cellTitle}" 
                             onclick="window.triggerEditCell('${col.bunk}', ${startMin}, ${endMin}, '${safeActivity}')">
                             ${cellText}
                         </td>`;
            });

            html += `</tr>`;
        });

        html += `</tbody></table></div>`;
        
        // --- Inject CSS ---
        html += `
        <style>
            .schedule-container {
                overflow: auto;
                border: 1px solid #ccc;
                border-radius: 4px;
                max-height: 85vh;
                background: white;
                font-family: system-ui, -apple-system, sans-serif;
            }
            .schedule-table {
                width: 100%;
                border-collapse: separate; /* Needed for sticky headers */
                border-spacing: 0;
                font-size: 0.85rem;
            }
            
            /* Borders */
            .schedule-table td, .schedule-table th {
                border-right: 1px solid #e0e0e0;
                border-bottom: 1px solid #e0e0e0;
                padding: 8px 4px;
                text-align: center;
                vertical-align: middle;
                min-width: 100px;
                height: 40px; /* Consistent row height */
            }

            /* 1. Division Header (Top Bar) */
            .div-header {
                color: white;
                font-weight: bold;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                position: sticky;
                top: 0;
                z-index: 20;
                border-left: 1px solid rgba(255,255,255,0.2);
            }

            /* 2. Bunk Header (Secondary Row) */
            .bunk-header {
                background-color: #f1f1f1;
                color: #333;
                font-weight: 600;
                position: sticky;
                top: 37px; /* Height of the row above it */
                z-index: 15;
                border-bottom: 2px solid #ccc !important;
            }

            /* 3. Time Column (Left) */
            .time-header {
                background-color: #fff;
                z-index: 30; /* Corner piece sits on top */
                position: sticky;
                top: 0;
                left: 0;
                min-width: 120px;
                border-right: 2px solid #ddd !important;
                border-bottom: 2px solid #ccc !important;
                font-weight: bold;
                color: #444;
            }
            
            .time-col {
                background-color: #fff;
                font-weight: 700;
                color: #333;
                position: sticky;
                left: 0;
                z-index: 10;
                border-right: 2px solid #ddd !important;
                font-size: 0.8em;
            }

            /* Hover Effects */
            .schedule-table tbody tr:hover td {
                filter: brightness(0.98);
            }
        </style>
        `;

        container.innerHTML = html;
    }

    // ===== DATA PERSISTENCE =====
    function saveSchedule() {
        try {
            window.saveCurrentDailyData?.("scheduleAssignments", window.scheduleAssignments);
            window.saveCurrentDailyData?.("leagueAssignments", window.leagueAssignments);
            window.saveCurrentDailyData?.("unifiedTimes", window.unifiedTimes);
        } catch (e) { console.error("Save failed", e); }
    }

    // ===== EXPORTS =====
    // Expose edit function globally so the inline onclick can find it
    window.triggerEditCell = editCell;
    window.initScheduleSystem = initScheduleSystem;
    window.updateTable = updateTable;
    window.saveSchedule = saveSchedule;

})();
