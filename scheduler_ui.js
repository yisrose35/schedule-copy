// =================================================================
// scheduler_ui.js
//
// Renders the main "Daily Schedule" view (read-only grid).
// Defines initScheduleSystem which is required by welcome.js.
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
        // Try global vars first (set by logic core), fall back to daily data storage
        const unifiedTimes = window.unifiedTimes || window.currentDailyData?.unifiedTimes || [];
        const assignments = window.scheduleAssignments || window.currentDailyData?.scheduleAssignments || {};
        
        // Setup data
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
        let html = `
        <div style="overflow-x: auto; border: 1px solid #ddd; border-radius: 4px; box-shadow: 0 2px 5px rgba(0,0,0,0.05);">
            <table class="schedule-table">
                <thead>
                    <tr>
                        <th class="sticky-col-header">Time</th>
        `;

        // -- Column Headers (Bunks grouped by Division) --
        const colMap = []; // Maps column index to specific bunk data
        
        availableDivisions.forEach(divName => {
            const div = divisions[divName];
            if (div && div.bunks && div.bunks.length > 0) {
                div.bunks.forEach(bunk => {
                    colMap.push({ bunk: bunk, div: divName });
                    const color = div.color || '#333';
                    html += `<th style="border-top: 4px solid ${color}; min-width: 110px;">${bunk}</th>`;
                });
            }
        });

        html += `</tr></thead><tbody>`;

        // -- Data Rows (Time Slots) --
        unifiedTimes.forEach((slot, slotIndex) => {
            const timeLabel = slot.label;
            html += `<tr>`;
            html += `<td class="sticky-col">${timeLabel}</td>`;

            colMap.forEach(col => {
                const bunk = col.bunk;
                const bunkSchedule = assignments[bunk];
                const entry = bunkSchedule ? bunkSchedule[slotIndex] : null;

                let cellText = "";
                let cellStyle = "";
                
                if (entry) {
                    if (entry.continuation) {
                        // Merged block visual
                        cellText = `<span style="opacity: 0.2; font-size: 1.2em;">&darr;</span>`;
                        cellStyle = "background-color: #fafafa; color: #ccc;";
                    } else {
                        // Determine Content Label
                        if (entry._h2h) {
                            // --- LEAGUE GAME ---
                            cellText = `<strong>${entry.sport || "League Game"}</strong>`;
                            
                            // Add Field Name if exists
                            let fName = "";
                            if (entry.field && typeof entry.field === 'object') fName = entry.field.name;
                            else if (typeof entry.field === 'string') fName = entry.field;
                            
                            if(fName && fName !== "No Field") {
                                cellText += `<div style="font-size:0.8em; color:#444; margin-top:2px;">@ ${fName}</div>`;
                            }
                            
                            cellStyle = "background-color: #e3f2fd; border-left: 3px solid #2196F3;";
                        } else {
                            // --- REGULAR ACTIVITY ---
                            let fName = entry.field;
                            if (typeof fName === 'object') fName = fName.name;
                            
                            cellText = fName;
                            
                            if (entry._fixed) {
                                // Pinned (Lunch, Swim, etc)
                                cellStyle = "background-color: #fff8e1; border-left: 3px solid #ff9800;";
                            } else if (fName === "Free" || fName === "No Field") {
                                // Empty Slot
                                cellStyle = "background-color: #f5f5f5; color: #bbb; font-style: italic;";
                            } else {
                                // Generated Activity
                                cellStyle = "background-color: #ffffff;";
                            }
                        }
                    }
                } else {
                    // No data for this slot
                    cellText = "--";
                    cellStyle = "color: #eee; background: #fcfcfc;";
                }

                html += `<td style="${cellStyle}">${cellText}</td>`;
            });

            html += `</tr>`;
        });

        html += `</tbody></table></div>`;
        
        // -- Inject CSS for this table --
        html += `
        <style>
            .schedule-table {
                width: 100%;
                border-collapse: collapse;
                font-family: system-ui, -apple-system, sans-serif;
                font-size: 0.9rem;
            }
            .schedule-table th, .schedule-table td {
                padding: 8px 6px;
                border: 1px solid #e0e0e0;
                text-align: center;
                vertical-align: middle;
            }
            .schedule-table th {
                background-color: #f8f9fa;
                font-weight: 600;
                position: sticky;
                top: 0;
                z-index: 15;
                box-shadow: 0 1px 2px rgba(0,0,0,0.1);
            }
            .sticky-col {
                position: sticky;
                left: 0;
                background-color: #fff;
                z-index: 10;
                font-weight: 600;
                color: #555;
                border-right: 2px solid #ddd;
                min-width: 80px;
            }
            .sticky-col-header {
                position: sticky;
                left: 0;
                z-index: 20;
                background-color: #f8f9fa;
                border-right: 2px solid #ddd;
            }
        </style>
        `;

        container.innerHTML = html;
    }

    // --- Expose to Window ---
    window.initScheduleSystem = initScheduleSystem;
    window.updateTable = updateTable;

})();
