// ============================================================================
// print_center.js
// (UPDATED: Continuous Minute Timeline Integration)
//
// CRITICAL UPDATES:
// - Uses SchedulerCoreUtils.minutesToTime exclusively.
// - Fully minute-accurate schedule reconstruction.
// - Location view uses reservationLog with merging.
// - Division view reconstructs minute rows dynamically.
// - Bunk view supports merged blocks and league matchups.
// ============================================================================

(function() {
'use strict';

// ----------------------------------------------------------
// CORE HELPERS (from Utils)
// ----------------------------------------------------------
const parseTimeToMinutes = window.SchedulerCoreUtils?.parseTimeToMinutes;
const minutesToTime = window.SchedulerCoreUtils?.minutesToTime;
const fieldLabel = window.SchedulerCoreUtils?.fieldLabel;

// ----------------------------------------------------------
// BASIC ACCESSOR
// ----------------------------------------------------------
function getEntry(bunk, startMin) {
    const assignments = window.scheduleAssignments || {};
    if (!assignments[bunk]) return null;
    return assignments[bunk][startMin] || null;
}

// ----------------------------------------------------------
// FORMAT ENTRY (unified output)
// ----------------------------------------------------------
function formatEntry(entry) {
    if (!entry) return "";

    if (entry._isDismissal) return "Dismissal";
    if (entry._isSnack) return "Snacks";

    let label = fieldLabel(entry.field) || "";

    // Leagues
    if (entry._h2h) return entry.sport || "League Game";

    // Fixed events
    if (entry._fixed) return label || entry._activity || "";

    // Sports: Field – Sport
    if (entry.sport) return `${label} – ${entry.sport}`;

    return label;
}

// ----------------------------------------------------------
// Natural Sort Helper
// ----------------------------------------------------------
function naturalSort(a, b) {
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

// ----------------------------------------------------------
// MAIN ENTRY: INIT PRINT CENTER
// ----------------------------------------------------------
function initPrintCenter() {
    const container = document.getElementById("print-content");
    if (!container) return;

    container.innerHTML = `
        <div class="print-dashboard">
            <h1 style="color:#1a5fb4;">🖨️ Print Center</h1>
            <p class="no-print">Select what you want to print or export.</p>

            <div class="print-cards no-print">
                
                <div class="print-card">
                    <h3>📅 Master Schedule</h3>
                    <p>Print the division-based grid view.</p>
                    
                    <div style="display:flex; gap:10px; margin-bottom:15px;">
                        <button onclick="window.printAllDivisions()" style="background:#28a745; flex:1;">Print All</button>
                        <button onclick="window.exportAllDivisionsToExcel()" style="background:#217346; flex:1;">Export to Excel</button>
                    </div>

                    <hr style="border-top:1px solid #ddd; margin:10px 0;">
                    
                    <label style="font-weight:bold;">Select Specific Divisions:</label>
                    <div id="print-div-list" class="print-list-box"></div>
                    <div style="display:flex; gap:10px;">
                        <button onclick="window.printSelectedDivisions()" style="flex:1;">Print Selected</button>
                        <button onclick="window.exportSelectedDivisionsToExcel()" style="background:#217346; flex:1;">Export Selected</button>
                    </div>
                </div>

                <div class="print-card">
                    <h3>👤 Individual Bunks</h3>
                    <p>Print per-bunk list views.</p>
                    <div id="print-bunk-list" class="print-list-box"></div>
                    <div style="display:flex; gap:10px;">
                        <button onclick="window.printSelectedBunks()" style="flex:1;">Print Selected</button>
                        <button onclick="window.exportSelectedBunksToExcel()" style="background:#217346; flex:1;">Export to Excel</button>
                    </div>
                </div>

                <div class="print-card">
                    <h3>📍 Locations / Fields</h3>
                    <p>Print full location calendars.</p>
                    <div id="print-loc-list" class="print-list-box"></div>
                    <div style="display:flex; gap:10px;">
                        <button onclick="window.printSelectedLocations()" style="flex:1;">Print Selected</button>
                        <button onclick="window.exportSelectedLocationsToExcel()" style="background:#217346; flex:1;">Export to Excel</button>
                    </div>
                </div>
            </div>

            <div id="printable-area"></div>
        </div>

        <style>
            .print-list-box {
                max-height: 200px;
                overflow-y: auto;
                border: 1px solid #ccc;
                background: white;
                padding: 10px;
                margin-bottom: 10px;
                border-radius: 4px;
            }
            .print-list-group {
                font-weight: bold;
                margin: 5px 0 3px;
                padding: 2px 5px;
                background: #eee;
                color: #555;
            }
            .print-list-item { display:block; margin-left: 5px; }
        </style>
    `;

    populateSelectors();
}

// ----------------------------------------------------------
// POPULATE UI CHECKBOX LISTS
// ----------------------------------------------------------
function populateSelectors() {
    const divList = document.getElementById("print-div-list");
    const bunkList = document.getElementById("print-bunk-list");
    const locList = document.getElementById("print-loc-list");
    
    const app1 = window.loadGlobalSettings?.().app1 || {};
    const divisions = app1.divisions || {};
    const availableDivisions = app1.availableDivisions || [];
    const fields = app1.fields || [];
    const specials = app1.specialActivities || [];

    // DIVISIONS
    divList.innerHTML = "";
    availableDivisions.forEach(div => {
        divList.innerHTML += `<label class="print-list-item">
            <input type="checkbox" value="${div}"> ${div}
        </label>`;
    });

    // BUNKS grouped by division
    bunkList.innerHTML = "";
    availableDivisions.forEach(div => {
        const bunks = (divisions[div].bunks || []).sort(naturalSort);
        if (bunks.length > 0) {
            bunkList.innerHTML += `<div class="print-list-group">${div}</div>`;
            bunks.forEach(b => {
                bunkList.innerHTML += `<label class="print-list-item">
                    <input type="checkbox" value="${b}"> ${b}
                </label>`;
            });
        }
    });

    // LOCATIONS
    locList.innerHTML = "";
    const allLocs = [...fields.map(f => f.name), ...specials.map(s=>s.name)].sort(naturalSort);
    allLocs.forEach(loc => {
        locList.innerHTML += `<label class="print-list-item">
            <input type="checkbox" value="${loc}"> ${loc}
        </label>`;
    });
}

// ============================================================================
// PART 1 END — NEXT MESSAGE WILL CONTAIN PART 2
// ============================================================================
// ============================================================================
// DIVISION HTML GENERATION (Minute-Accurate Daily Grid)
// ============================================================================

function generateDivisionHTML(divName) {
    const daily = window.loadCurrentDailyData?.() || {};
    const manualSkeleton = daily.manualSkeleton || [];
    const divisions = window.loadGlobalSettings?.().app1.divisions || {};
    const bunks = (divisions[divName]?.bunks || []).sort(naturalSort);

    if (bunks.length === 0) return "";

    // ----------------------------------------------------------
    // Collect all minute keys for division
    // ----------------------------------------------------------
    const divisionAssignments = {};  
    const allStartMinutes = new Set();

    bunks.forEach(bunk => {
        const sched = window.scheduleAssignments[bunk] || {};
        Object.keys(sched).forEach(startMinStr => {
            const startMin = parseInt(startMinStr);
            const entry = sched[startMin];

            if (!entry || !entry._activity) return;

            allStartMinutes.add(startMin);
            divisionAssignments[startMin] ||= [];
            divisionAssignments[startMin].push({ bunk, entry });
        });
    });

    const sortedStarts = Array.from(allStartMinutes).sort((a,b)=>a-b);
    const today = window.currentScheduleDate;

    // ----------------------------------------------------------
    // Begin HTML Output
    // ----------------------------------------------------------
    let html = `
        <div class="print-page landscape">
        <div class="print-header">
            <h2>📅 ${divName} Schedule</h2>
            <p>Date: ${today}</p>
        </div>
        <table class="print-table grid-table">
        <thead>
            <tr>
                <th style="width:130px;">Time</th>
                ${bunks.map(b => `<th>${b}</th>`).join('')}
            </tr>
        </thead>
        <tbody>
    `;

    if (sortedStarts.length === 0) {
        html += `
            <tr><td colspan="${bunks.length+1}" style="text-align:center; padding:20px;">
                No scheduled blocks found.
            </td></tr>
        `;
    }

    // Track active rowSpan merges per bunk
    const activeMerges = {};

    // =====================================================================
    // MAIN LOOP: Build rows for each start minute
    // =====================================================================
    sortedStarts.forEach(startMin => {
        const rowSet = divisionAssignments[startMin] || [];
        if (rowSet.length === 0) return;

        // Representative activity (first bunk found)
        const repEntry = rowSet[0].entry;
        if (!repEntry) return;

        // Skip rows where all bunks are merged
        const allCovered = bunks.every(b => {
            const e = getEntry(b, startMin);
            return e && e.startTime !== minutesToTime(startMin); 
        });
        if (allCovered) return;

        const repEndMin = repEntry.endTime || (startMin + 30);

        // TIME COLUMN
        let rowHTML = `
            <tr>
            <td class="time-col"><strong>${minutesToTime(startMin)} - ${minutesToTime(repEndMin)}</strong></td>
        `;

        // =================================================================
        // LEAGUE MATCHES: One merged cell across all bunks
        // =================================================================
        if (repEntry._h2h) {
            let matchups = repEntry._allMatchups || [];
            let text = `<strong>${repEntry.sport || "League Game"}</strong>`;

            if (matchups.length > 0) {
                text += `<ul style="margin:0; padding-left:15px; font-size:0.9em;">`;
                matchups.forEach(m => text += `<li>${m}</li>`);
                text += `</ul>`;
            }

            rowHTML += `
                <td colspan="${bunks.length}" style="background:#e8f4ff; vertical-align:top; text-align:left;">
                    ${text}
                </td>
            </tr>
            `;
            html += rowHTML;
            return;
        }

        // =================================================================
        // STANDARD CELLS — Per bunk, with rowSpan merging
        // =================================================================
        bunks.forEach(bunk => {
            const entry = getEntry(bunk, startMin);

            // If this bunk is merged from a previous row
            if (activeMerges[bunk] && activeMerges[bunk] > startMin) {
                return; 
            }

            let t = "";
            let bg = "";
            let rowSpan = 1;

            if (entry) {
                t = formatEntry(entry);
                if (entry._fixed) bg = "#fff8e1";

                // Row-span calculation:
                let cur = startMin;
                while (cur < entry.endTime) {
                    const next = sortedStarts.find(m => m > cur);
                    if (!next || next >= entry.endTime) break;
                    rowSpan++;
                    cur = next;
                }
                if (rowSpan > 1) activeMerges[bunk] = entry.endTime;
            } 
            else {
                // BUNK HAS NO ENTRY HERE — check manual skeleton pinned
                const block = manualSkeleton.find(m =>
                    m.division === divName &&
                    parseTimeToMinutes(m.startTime) <= startMin &&
                    parseTimeToMinutes(m.endTime) > startMin
                );
                if (block) {
                    if (["Lunch","Snack","Dismissal","Swim"]
                        .some(k => block.event.includes(k))) 
                    {
                        t = block.event;
                        bg = "#fff8e1";
                    }
                }
            }

            rowHTML += `<td rowspan="${rowSpan}" style="background:${bg};">${t}</td>`;
        });

        rowHTML += `</tr>`;
        html += rowHTML;
    });

    html += `
        </tbody></table>
        </div>
        <div class="page-break"></div>
    `;

    return html;
}

// ============================================================================
// INDIVIDUAL BUNK — Minute-Precise List View
// ============================================================================

function generateBunkHTML(bunk) {
    const daily = window.loadCurrentDailyData?.() || {};
    const schedule = daily.scheduleAssignments?.[bunk] || {};
    const startMinutes = Object.keys(schedule).map(Number).sort((a,b)=>a-b);

    let html = `
        <div class="print-page portrait">
        <div class="print-header">
            <h2>👤 Schedule: ${bunk}</h2>
            <p>Date: ${window.currentScheduleDate}</p>
        </div>
        <table class="print-table">
        <thead>
            <tr><th style="width:120px;">Time</th><th>Activity / Location</th></tr>
        </thead>
        <tbody>
    `;

    startMinutes.forEach(startMin => {
        const entry = schedule[startMin];
        if (!entry) return;
        if (entry.continuation) return;

        let endMin = entry.endTime || (startMin+30);
        // Merge
        let current = startMin;
        let next = startMinutes.find(m => m > current);

        while (next && next < endMin) {
            const nxtEntry = schedule[next];
            if (nxtEntry && nxtEntry._activity === entry._activity) {
                endMin = nxtEntry.endTime;
                next = startMinutes.find(m => m > next);
            } else break;
        }

        let label;
        if (entry._h2h) {
            // Entire league match
            if (entry._allMatchups?.length) {
                label = `<strong>${entry.sport || "League Game"}</strong><ul style="margin:5px 0 0 15px; padding:0; font-size:0.9em;">`;
                entry._allMatchups.forEach(m => label += `<li>${m}</li>`);
                label += `</ul>`;
            } else {
                label = `<strong>${entry.sport}</strong>`;
            }
        } else {
            label = formatEntry(entry);
        }

        html += `
            <tr>
                <td class="time-col"><strong>${minutesToTime(startMin)} - ${minutesToTime(endMin)}</strong></td>
                <td>${label}</td>
            </tr>
        `;
    });

    html += `
        </tbody></table>
        </div>
    `;

    return html;
}

// ============================================================================
// PART 2 END — LAST PART CONTAINS LOCATION VIEW + ACTIONS
// ============================================================================
// ============================================================================
// LOCATION VIEW (Field / Special Activity Schedule)
// Minute-accurate, merged reservations, transitions included
// ============================================================================

function generateLocationHTML(loc) {
    const daily = window.loadCurrentDailyData?.() || {};
    const assignments = daily.scheduleAssignments || {};
    const reservationLog = window.fieldReservationLog?.[loc] || [];

    // Include transitions that occupy the field
    const transLog = window.fieldReservationLog?.[window.TRANSITION_TYPE] || [];
    transLog.forEach(r => {
        if (r.field === loc && r.occupiesField) {
            reservationLog.push(r);
        }
    });

    reservationLog.sort((a,b) => a.startMin - b.startMin);

    let html = `
        <div class="print-page portrait">
        <div class="print-header">
            <h2>📍 Schedule: ${loc}</h2>
            <p>Date: ${window.currentScheduleDate}</p>
        </div>
        <table class="print-table">
        <thead>
            <tr><th style="width:120px;">Time</th><th>Event / Bunks</th></tr>
        </thead>
        <tbody>
    `;

    // Merge adjacent identical reservations
    const merged = [];
    reservationLog.forEach(r => {
        let last = merged[merged.length - 1];

        const sameEvent =
            last &&
            last.activityName === r.activityName &&
            last.isTransition === r.isTransition &&
            last.endMin === r.startMin;

        if (sameEvent) {
            last.endMin = r.endMin;
            last.bunks.push(r.bunk);
            last.uniqueBunks.add(r.bunk);
        } else {
            merged.push({
                startMin: r.startMin,
                endMin: r.endMin,
                activityName: r.activityName,
                isTransition: r.isTransition,
                bunks: [r.bunk],
                uniqueBunks: new Set([r.bunk]),
                sportLabel: r.sport || null,
                leagueMatchups: r._allMatchups || null
            });
        }
    });

    if (merged.length === 0) {
        html += `
            <tr>
                <td colspan="2" style="color:#999; font-style:italic; text-align:center;">
                    No scheduled use for this location.
                </td>
            </tr>
        `;
    } else {
        merged.forEach(m => {
            const label = `${minutesToTime(m.startMin)} - ${minutesToTime(m.endMin)}`;
            let content = "";
            let style = "";

            if (m.isTransition) {
                style = "background:#f3f4f6;";
                content = `🏃‍♂️ ${m.activityName}<br>Bunks: ${[...m.uniqueBunks].join(", ")}`;
            }
            else if (m.leagueMatchups) {
                style = "background:#e8f4ff;";
                content = `<strong>${m.sportLabel || m.activityName}</strong>`;
            }
            else {
                content = `${m.activityName}<br>Bunks: ${[...m.uniqueBunks].join(", ")}`;
            }

            html += `
                <tr>
                    <td class="time-col"><strong>${label}</strong></td>
                    <td style="${style}">${content}</td>
                </tr>
            `;
        });
    }

    html += `
        </tbody></table>
        </div>
    `;
    return html;
}

// ============================================================================
// ACTION HELPERS
// ============================================================================

function getSelectedDivisions() {
    return Array.from(document.querySelectorAll("#print-div-list input:checked"))
        .map(cb => cb.value);
}

function getSelectedBunks() {
    return Array.from(document.querySelectorAll("#print-bunk-list input:checked"))
        .map(cb => cb.value);
}

function getSelectedLocations() {
    return Array.from(document.querySelectorAll("#print-loc-list input:checked"))
        .map(cb => cb.value);
}

// ============================================================================
// PRINT ACTIONS
// ============================================================================

window.printAllDivisions = function() {
    const app1 = window.loadGlobalSettings?.().app1 || {};
    const allDivs = app1.availableDivisions || [];
    if (allDivs.length === 0) return alert("No divisions found.");

    let html = "";
    allDivs.forEach(div => html += generateDivisionHTML(div));
    triggerPrint(html);
};

window.printSelectedDivisions = function() {
    const chosen = getSelectedDivisions();
    if (chosen.length === 0) return alert("Please select at least one division.");
    
    let html = "";
    chosen.forEach(div => html += generateDivisionHTML(div));
    triggerPrint(html);
};

window.printSelectedBunks = function() {
    const chosen = getSelectedBunks();
    if (chosen.length === 0) return alert("Please select at least one bunk.");

    let html = "";
    chosen.forEach(b => html += generateBunkHTML(b));
    triggerPrint(html);
};

window.printSelectedLocations = function() {
    const chosen = getSelectedLocations();
    if (chosen.length === 0) return alert("Please select at least one location.");

    let html = "";
    chosen.forEach(loc => html += generateLocationHTML(loc));
    triggerPrint(html);
};

// ============================================================================
// EXCEL EXPORT (Simple HTML Excel Sheet)
// ============================================================================

function downloadXLS(htmlContent, fileName) {
    const blob = new Blob(
        ['<html xmlns:x="urn:schemas-microsoft-com:office:excel">' + htmlContent + '</html>'],
        { type: "application/vnd.ms-excel" }
    );
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

window.exportAllDivisionsToExcel = function() {
    const app1 = window.loadGlobalSettings?.().app1 || {};
    const allDivs = app1.availableDivisions || [];
    if (allDivs.length === 0) return alert("No divisions available.");

    let html = "";
    allDivs.forEach(div => html += generateDivisionHTML(div));
    downloadXLS(html, `Schedule_All_${window.currentScheduleDate}.xls`);
};

window.exportSelectedDivisionsToExcel = function() {
    const chosen = getSelectedDivisions();
    if (!chosen.length) return alert("Select at least one division.");

    let html = "";
    chosen.forEach(div => html += generateDivisionHTML(div));
    downloadXLS(html, `Schedule_Divisions_${window.currentScheduleDate}.xls`);
};

window.exportSelectedBunksToExcel = function() {
    const chosen = getSelectedBunks();
    if (!chosen.length) return alert("Select at least one bunk.");

    let html = "";
    chosen.forEach(b => html += generateBunkHTML(b));
    downloadXLS(html, `Schedule_Bunks_${window.currentScheduleDate}.xls`);
};

window.exportSelectedLocationsToExcel = function() {
    const chosen = getSelectedLocations();
    if (!chosen.length) return alert("Select at least one location.");

    let html = "";
    chosen.forEach(loc => html += generateLocationHTML(loc));
    downloadXLS(html, `Schedule_Locations_${window.currentScheduleDate}.xls`);
};

// ============================================================================
// PRINT TRIGGER
// ============================================================================

function triggerPrint(content) {
    const area = document.getElementById("printable-area");
    area.innerHTML = content;
    window.print();
}

// Export initializer
window.initPrintCenter = initPrintCenter;
    })();

