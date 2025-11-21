// =================================================================
// scheduler_ui.js
//
// Renders the main "Daily Schedule" view.
// UPDATED: Matches the provided screenshot layout with:
// - Grouped Division Headers (colored bars spanning bunks).
// - Secondary Bunk Headers.
// - Sticky columns and rows for scrolling.
// =================================================================

(function() {
    'use strict';

    // --- Main Initialization Function (Called by welcome.js) ---
    function initScheduleSystem() {
        console.log("Initializing Schedule System...");
        
        // Ensure data is loaded from the current day
        if (window.loadCurrentDailyData) {
            window.loadCurrentDailyData();
        }
        
        // Render the table
        updateTable();
    }

    // --- Render Logic ---
    function updateTable() {
        const container = document.getElementById("scheduleTable");
        if (!container) return;

        // 1. Retrieve Data
        const unifiedTimes = window.unifiedTimes || window.currentDailyData?.unifiedTimes || [];
        const assignments = window.scheduleAssignments || window.currentDailyData?.scheduleAssignments || {};
        
        const divisions = window.divisions || {}; 
        const availableDivisions = window.availableDivisions || [];

        // 2. Check if Schedule Exists
        if (!unifiedTimes || unifiedTimes.length === 0) {
            container.innerHTML = `
                <div style="padding: 30px; text-align: center; color: #666; background: #f8f9fa; border-radius: 8px; border: 1px dashed #ccc; margin-top: 10px;">
                    <h3>No Schedule Generated Yet</h3>
                    <p style="margin-bottom: 15px;">To create a schedule for today:</p>
                    <ol style="display: inline-block; text-align: left;">
                        <li>Go to the <strong>Daily Adjustments</strong> tab.</li>
                        <li>Load a <strong>Skeleton Template</strong> or drag tiles to build one.</li>
                        <li>Click the green <strong>"Run Optimizer"</strong> button.</li>
                    </ol>
                </div>`;
            return;
        }

        // 3. Build HTML Table
        // We need a double header: Row 1 for Divisions, Row 2 for Bunks.
        
        let html = `
        <div class="schedule-container">
            <table class="schedule-table">
                <thead>
                    <tr>
                        <th class="time-header sticky-corner" rowspan="2">Time</th>
        `;

        // -- Header Row 1: Divisions (Colspan) --
        availableDivisions.forEach(divName => {
            const div = divisions[divName];
            if (div && div.bunks && div.bunks.length > 0) {
                const bunkCount = div.bunks.length;
                const color = div.color || '#4CAF50'; // Default to green if no color
                // Inline style for the division bar look
                html += `<th colspan="${bunkCount}" class="div-header" style="background-color: ${color}; border-color: ${color};">${divName}</th>`;
            }
        });

        html += `</tr><tr>`;

        // -- Header Row 2: Bunks & Column Mapping --
        const colMap = []; // Maps flat column index to specific bunk data for the body
        
        availableDivisions.forEach(divName => {
            const div = divisions[divName];
            if (div && div.bunks && div.bunks.length > 0) {
                div.bunks.forEach(bunk => {
                    colMap.push({ bunk: bunk, div: divName });
                    html += `<th class="bunk-header">${bunk}</th>`;
                });
            }
        });

        html += `</tr></thead><tbody>`;

        // -- Data Rows (Time Slots) --
        unifiedTimes.forEach((slot, slotIndex) => {
            const timeLabel = slot.label;
            html += `<tr>`;
            html += `<td class="time-col sticky-col">${timeLabel}</td>`;

            colMap.forEach(col => {
                const bunk = col.bunk;
                const bunkSchedule = assignments[bunk];
                const entry = bunkSchedule ? bunkSchedule[slotIndex] : null;

                let cellText = "";
                let cellStyle = "";
                
                if (entry) {
                    if (entry.continuation) {
                        // Merged block visual (lighter text)
                        cellText = `<span style="opacity: 0.0;">&darr;</span>`; // Hidden but takes space
                        // We inherit background from the start of the block usually, 
                        // but here we'll just keep it clean or apply same style
                        // For now, simple background matching is best:
                        if (entry._h2h) cellStyle = "background-color: #e3f2fd;"; // Match league
                        else if (entry._fixed) cellStyle = "background-color: #fff8e1;"; // Match pinned
                        else cellStyle = "background-color: #ffffff;";
                    } else {
                        // Determine Content Label
                        if (entry._h2h) {
                            // --- LEAGUE GAME ---
                            // Only show specific text if it's not generic
                            const label = entry.sport || "League Game";
                            // Strip " (Sport)" if redundant for cleaner look
                            cellText = label;
                            
                            // Special styling for League
                            cellStyle = "background-color: #e3f2fd; color: #0d47a1;"; // Light Blue
                        } else {
                            // --- REGULAR ACTIVITY ---
                            let fName = entry.field;
                            if (typeof fName === 'object') fName = fName.name;
                            
                            cellText = fName;
                            
                            // Color Coding based on Screenshot cues
                            if (fName === "Lunch") {
                                cellStyle = "background-color: #fff9c4; font-weight: bold; color: #555;"; // Yellowish
                            } else if (fName === "Snacks") {
                                cellStyle = "background-color: #dcedc8; font-weight: bold; color: #33691e;"; // Light Green
                            } else if (fName === "Dismissal") {
                                cellStyle = "background-color: #ffebee; font-weight: bold; color: #b71c1c;"; // Light Red
                            } else if (fName === "Swim" || fName.includes("Swim")) {
                                cellStyle = "background-color: #ffffff; color: #0277bd;"; // White/Blue text
                            } else if (fName === "Regroup") {
                                cellStyle = "background-color: #fff3e0; font-weight: bold; color: #e65100;"; // Orange-ish
                            } else if (fName === "General Activity Slot") {
                                cellStyle = "background-color: #ffffff; color: #333;";
                            } else if (fName === "Free" || fName === "No Field") {
                                cellStyle = "background-color: #f5f5f5; color: #bbb; font-style: italic;";
                            } else {
                                // Default Generated Activity
                                cellStyle = "background-color: #ffffff;";
                            }
                        }
                    }
                } else {
                    cellText = "";
                    cellStyle = "background: #fcfcfc;";
                }

                html += `<td style="${cellStyle}">${cellText}</td>`;
            });

            html += `</tr>`;
        });

        html += `</tbody></table></div>`;
        
        // -- Inject CSS for this table --
        // Note: We use position:sticky for headers to replicate the freeze-pane effect
        html += `
        <style>
            .schedule-container {
                overflow: auto;
                border: 1px solid #ccc;
                border-radius: 4px;
                max-height: 80vh; /* Allow vertical scrolling */
                background: white;
            }
            .schedule-table {
                width: 100%;
                border-collapse: separate; /* Required for sticky borders to render nicely */
                border-spacing: 0;
                font-family: system-ui, -apple-system, sans-serif;
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
            }

            /* Header Row 1: Division Bar */
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

            /* Header Row 2: Bunks */
            .bunk-header {
                background-color: #f1f1f1;
                color: #333;
                font-weight: 600;
                position: sticky;
                top: 35px; /* Approx height of div header */
                z-index: 15;
                border-bottom: 2px solid #ccc !important;
            }

            /* Time Column */
            .time-header {
                background-color: #fff;
                z-index: 30; /* Highest to sit on top of corner */
                position: sticky;
                top: 0;
                left: 0;
                min-width: 120px;
                border-right: 2px solid #ddd !important;
                border-bottom: 2px solid #ccc !important;
            }
            
            .time-col {
                background-color: #fff;
                font-weight: 600;
                color: #444;
                position: sticky;
                left: 0;
                z-index: 10;
                border-right: 2px solid #ddd !important;
            }

            /* Hover Effects */
            .schedule-table tbody tr:hover td {
                background-color: rgba(0,0,0,0.02) !important; /* Very subtle hover row */
            }
        </style>
        `;

        container.innerHTML = html;
    }

    // --- Expose to Window ---
    window.initScheduleSystem = initScheduleSystem;
    window.updateTable = updateTable;

})();
