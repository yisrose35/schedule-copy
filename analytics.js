// =================================================================
// analytics.js
// (UPDATED: Continuous Minute Timeline & Reservation Log Integration)
//
// CRITICAL UPDATES:
// - Added missing TRANSITION_TYPE constant.
// - Removed all obsolete slot/index helpers.
// - Availability Grid now uses minute-accurate Reservation Log.
// - Usage Manager updated for minute-keyed schedule.
// - Safe parsing added for legacy reservation formats.
// - Protected scheduleAssignments to avoid early-load crashes.
// =================================================================

(function() {
'use strict';

const MIN_USABLE_GAP = 5;

// --- Core Helper References ---
const parseTimeToMinutes = window.SchedulerCoreUtils?.parseTimeToMinutes;
const minutesToTime = window.SchedulerCoreUtils?.minutesToTime;
const fieldLabel = window.SchedulerCoreUtils?.fieldLabel;

// 🔥 FIX 1 — ensure TRANSITION_TYPE is defined
const TRANSITION_TYPE = window.TRANSITION_TYPE || "Transition/Buffer";

let container = null;
let allActivities = [];
let availableDivisions = [];
let divisions = {};


// =================================================================
// INIT
// =================================================================
function initReportTab() {
    container = document.getElementById("report-content");
    if (!container) return;

    container.innerHTML = `
        <div class="league-nav" style="background: #e3f2fd; border-color: #90caf9; padding: 10px; margin-bottom: 15px; border-radius: 8px;"> 
            <label for="report-view-select" style="color: #1565c0; font-weight: bold;">Select Report:</label>
            <select id="report-view-select" style="font-size: 1em; padding: 5px;">
                <option value="availability">Field Availability Grid</option>
                <option value="rotation">Bunk Rotation Report</option>
                <option value="usage">Usage Manager (Limits)</option>
            </select>
        </div>

        <div id="report-availability-content" class="league-content-pane active"></div>
        <div id="report-rotation-content" class="league-content-pane" style="display:none;"></div>
        <div id="report-usage-content" class="league-content-pane" style="display:none;"></div>
    `;

    loadMasterData();
    renderFieldAvailabilityGrid();
    renderBunkRotationUI();
    renderUsageManagerUI();

    const select = document.getElementById("report-view-select");
    select.onchange = (e) => {
        const val = e.target.value;
        document.querySelectorAll(".league-content-pane").forEach(el => el.style.display = "none");
        document.getElementById(`report-${val}-content`).style.display = "block";

        if (val === 'availability') renderFieldAvailabilityGrid();
        else if (val === 'usage') renderUsageManagerUI();
    };
}


// =================================================================
// LOAD MASTER DATA
// =================================================================
function loadMasterData() {
    try {
        const g = window.loadGlobalSettings?.() || {};
        divisions = window.divisions || {};
        availableDivisions = (window.availableDivisions || []).sort();

        const fields = g.app1?.fields || [];
        const specials = g.app1?.specialActivities || [];

        allActivities = [
            ...fields.flatMap(f => (f.activities || []).map(a => ({ name: a, type: 'sport' }))),
            ...specials.map(s => ({ name: s.name, type: 'special', max: s.maxUsage || 0 }))
        ];
    } catch(e) {
        console.error("Error loading master data:", e);
        allActivities = [];
    }
}



// =================================================================
// USAGE MANAGER (Updated for minute-keyed schedule)
// =================================================================
function renderUsageManagerUI() {
    const wrapper = document.getElementById("report-usage-content");
    if (!wrapper) return;

    wrapper.innerHTML = `
        <h2 class="report-title" style="border-bottom:2px solid #007BFF;">Usage Manager</h2>
        <p style="color:#666;">Adjust usage counts manually. Use -1 if a bunk missed an activity, +1 for extras.</p>

        <div style="margin-bottom:15px;">
            <label>Select Division: </label>
            <select id="usage-div-select" style="padding:5px;"><option value="">-- Select --</option></select>
        </div>

        <div id="usage-table-container"></div>
    `;

    const sel = document.getElementById("usage-div-select");
    availableDivisions.forEach(d => sel.innerHTML += `<option value="${d}">${d}</option>`);
    sel.onchange = () => renderUsageTable(sel.value);
}


function renderUsageTable(divName) {
    const container = document.getElementById("usage-table-container");
    if (!divName) { container.innerHTML = ""; return; }

    const bunks = divisions[divName]?.bunks || [];
    if (!bunks.length) { container.innerHTML = "No bunks."; return; }

    const limitedActivities = allActivities.filter(a => a.type === 'special');
    if (!limitedActivities.length) { container.innerHTML = "No special activities."; return; }

    const allDaily = window.loadAllDailyData?.() || {};
    const global = window.loadGlobalSettings?.() || {};
    const manualOffsets = global.manualUsageOffsets || {};

    // Calculate raw counts (minute-keyed)
    const rawCounts = {};

    Object.values(allDaily).forEach(day => {
        const sched = day.scheduleAssignments || {};
        Object.keys(sched).forEach(b => {
            if (!bunks.includes(b)) return;

            Object.values(sched[b] || {}).forEach(e => {
                if (e && e._activity && !e.continuation) {
                    if (!rawCounts[b]) rawCounts[b] = {};
                    rawCounts[b][e._activity] = (rawCounts[b][e._activity] || 0) + 1;
                }
            });
        });
    });

    window.debugAnalyticsRawCounts = rawCounts;

    let html = `
        <table class="report-table">
        <thead><tr>
            <th>Bunk</th>
            <th>Activity</th>
            <th>History</th>
            <th>Manual Adj</th>
            <th>Total</th>
            <th>Max</th>
        </tr></thead><tbody>
    `;

    bunks.forEach(bunk => {
        limitedActivities.forEach(act => {
            const hist = rawCounts[bunk]?.[act.name] || 0;
            const offset = manualOffsets[bunk]?.[act.name] || 0;
            const total = Math.max(0, hist + offset);
            const limit = act.max > 0 ? act.max : "∞";

            let style = "";
            if (act.max > 0 && total >= act.max) style = "background:#ffebee;";

            html += `
                <tr style="${style}">
                    <td><strong>${bunk}</strong></td>
                    <td>${act.name}</td>
                    <td style="text-align:center;">${hist}</td>
                    <td style="text-align:center;">
                        <input type="number" 
                            class="usage-adj-input"
                            data-bunk="${bunk}"
                            data-act="${act.name}"
                            value="${offset}"
                            style="width:55px; text-align:center;">
                    </td>
                    <td style="text-align:center; font-weight:bold;">${total}</td>
                    <td style="text-align:center;">${limit}</td>
                </tr>
            `;
        });
    });

    html += "</tbody></table>";
    container.innerHTML = html;

    // Bind inputs
    container.querySelectorAll(".usage-adj-input").forEach(inp => {
        inp.onchange = (e) => {
            const b = e.target.dataset.bunk;
            const a = e.target.dataset.act;
            const val = parseInt(e.target.value) || 0;

            if (!global.manualUsageOffsets) global.manualUsageOffsets = {};
            if (!global.manualUsageOffsets[b]) global.manualUsageOffsets[b] = {};
            global.manualUsageOffsets[b][a] = val;

            if (val === 0) delete global.manualUsageOffsets[b][a];

            window.saveGlobalSettings("manualUsageOffsets", global.manualUsageOffsets);
            renderUsageTable(divName);
        };
    });
}



// =================================================================
// FIELD AVAILABILITY GRID (FULLY REWRITTEN)
// =================================================================
function renderFieldAvailabilityGrid() {
    const wrapper = document.getElementById("report-availability-content");
    if (!wrapper) return;

    // First-time setup
    if (!document.getElementById("avail-filter-controls")) {
        wrapper.innerHTML = `
            <div id="avail-filter-controls" style="margin-bottom:15px; display:flex; gap:15px; align-items:center;">
                <h2 style="margin:0; font-size:1.5em; color:#1a5fb4;">Field Availability</h2>

                <select id="avail-type-filter" style="padding:5px; font-size:1rem;">
                    <option value="all">Show All</option>
                    <option value="field">Fields Only</option>
                    <option value="special">Special Activities Only</option>
                </select>

                <div style="font-size:0.9em; color:#555;">
                    <strong>Key:</strong>
                    <span style="color:#2e7d32; background:#e8f5e9; padding:2px;">✓ Free</span>
                    <span style="color:#c62828; background:#ffebee; padding:2px;">X Busy</span>
                </div>
            </div>

            <div id="avail-grid-wrapper"></div>
        `;

        document.getElementById("avail-type-filter").onchange = renderFieldAvailabilityGrid;
    }

    const gridDiv = document.getElementById("avail-grid-wrapper");
    const filter = document.getElementById("avail-type-filter").value;

    const reservationLog = window.fieldReservationLog || {};
    const hasRes = Object.values(reservationLog).some(v => v.length > 0);

    if (!hasRes) {
        gridDiv.innerHTML = `<p class='report-muted'>No schedule generated yet.</p>`;
        return;
    }

    const app1 = window.loadGlobalSettings?.().app1 || {};
    const fields = (app1.fields || []).map(f => ({ ...f, type: 'field' }));
    const specials = (app1.specialActivities || []).map(s => ({ ...s, type: 'special' }));

    let resources = [...fields, ...specials].sort((a, b) => a.name.localeCompare(b.name));
    if (filter === 'field') resources = fields;
    if (filter === 'special') resources = specials;

    // 🔥 FIX 2 — protect scheduleAssignments
    let maxEnd = 960; // fallback (4 PM)
    Object.values(window.scheduleAssignments || {}).forEach(sched => {
        Object.values(sched).forEach(entry => {
            const end = entry.endTime ? parseTimeToMinutes(entry.endTime) : null;
            if (end && end > maxEnd) maxEnd = end;
        });
    });

    const TIME_INCREMENT_MINS = 30;
    const MIN_VISUAL_TIME = 540;  // 9am
    const timeRows = [];

    let cur = MIN_VISUAL_TIME;
    while (cur < maxEnd) {
        const nxt = Math.min(cur + TIME_INCREMENT_MINS, maxEnd);
        timeRows.push({ start: cur, end: nxt, label: minutesToTime(cur) });
        cur = nxt;
    }

    if (timeRows.length === 0) {
        gridDiv.innerHTML = `<p class='report-muted'>No valid time range.</p>`;
        return;
    }

    // Build table
    let html = `<div class="schedule-view-wrapper"><table class="availability-grid"><thead><tr>`;
    html += `<th style="position:sticky; left:0; z-index:10;">Time</th>`;
    resources.forEach(r => html += `<th>${r.name}</th>`);
    html += `</tr></thead><tbody>`;

    timeRows.forEach(row => {
        const { start, end, label } = row;
        html += `<tr><td style="position:sticky; left:0; background:#fdfdfd; font-weight:bold;">${label}</td>`;

        resources.forEach(r => {
            const fName = r.name;
            const log = reservationLog[fName] || [];
            const transLog = reservationLog[TRANSITION_TYPE] || [];

            let blocked = false;

            // 🔥 FIX 3 — universal reservation parser
            const isOverlap = (res) => {
                const rStart = res.startMin ?? parseTimeToMinutes(res.startTime);
                const rEnd   = res.endMin   ?? parseTimeToMinutes(res.endTime);

                return (
                    rStart != null &&
                    rEnd != null &&
                    start < rEnd &&
                    end > rStart
                );
            };

            for (const res of log) {
                if (isOverlap(res)) { blocked = true; break; }
            }

            for (const res of transLog) {
                if (res.occupiesField && res.field === fName) {
                    if (isOverlap(res)) { blocked = true; break; }
                }
            }

            html += blocked
                ? `<td class="avail-x">X</td>`
                : `<td class="avail-check">✓</td>`;
        });

        html += `</tr>`;
    });

    html += `</tbody></table></div>`;
    gridDiv.innerHTML = html;
}



// =================================================================
// ROTATION UI (Placeholder)
// =================================================================
function renderBunkRotationUI() {
    const el = document.getElementById("report-rotation-content");
    if (el && !el.innerHTML) {
        el.innerHTML = `<p class="report-muted">Select 'Bunk Rotation Report' from the dropdown.</p>`;
    }
}


window.initReportTab = initReportTab;

})();
