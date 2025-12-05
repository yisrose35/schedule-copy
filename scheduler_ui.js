// ============================================================================
// scheduler_ui.js (FIXED: RESTORED RENDERER)
//
// Updates:
// 1. Restored missing renderStaggeredView logic to fix blank schedule screen.
// 2. Implements Wrapper Block display logic for transitions.
// 3. Buffer-aware manual edits.
// ============================================================================

(function () {
"use strict";

const INCREMENT_MINS = 30; // fallback only
const TRANSITION_TYPE = window.TRANSITION_TYPE || "Transition/Buffer";

// ==========================================================================
// TIME HELPERS
// ==========================================================================
function parseTimeToMinutes(str) {
    if (!str || typeof str !== "string") return null;
    let s = str.trim().toLowerCase();
    let mer = null;
    if (s.endsWith("am") || s.endsWith("pm")) {
        mer = s.endsWith("am") ? "am" : "pm";
        s = s.replace(/am|pm/g, "").trim();
    } else return null;

    const m = s.match(/^(\d{1,2})\s*[:]\s*(\d{2})$/);
    if (!m) return null;

    let h = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    if (mm < 0 || mm > 59) return null;

    if (h === 12) h = (mer === "am" ? 0 : 12);
    else if (mer === "pm") h += 12;

    return h * 60 + mm;
}

function minutesToTimeLabel(min) {
    const h24 = Math.floor(min / 60);
    const m = String(min % 60).padStart(2, "0");
    const ap = h24 >= 12 ? "PM" : "AM";
    const h12 = h24 % 12 || 12;
    return `${h12}:${m} ${ap}`;
}

// ==========================================================================
// RESOURCE RESOLVER
// ==========================================================================
function resolveResourceName(input, knownNames) {
    if (!input || !knownNames) return null;
    const cleanInput = String(input).toLowerCase().trim();

    if (knownNames.includes(input)) return input;

    const sorted = [...knownNames].sort((a,b)=>b.length-a.length);
    for (const name of sorted) {
        const cleanName = name.toLowerCase().trim();
        if (cleanInput.startsWith(cleanName)) return name;
    }
    return null;
}

// ==========================================================================
// SLOT FINDER
// ==========================================================================
function findSlotsForRange(startMin, endMin) {
    const slots = [];
    const times = window.unifiedTimes || [];
    if (!times.length) return slots;

    for (let i=0;i<times.length;i++) {
        const slotStart = new Date(times[i].start).getHours()*60 + new Date(times[i].start).getMinutes();
        const slotEnd   = new Date(times[i].end).getHours()*60 + new Date(times[i].end).getMinutes();
        if (startMin < slotEnd && endMin > slotStart) slots.push(i);
    }
    return slots;
}

// ==========================================================================
// EDIT CELL
// ==========================================================================
window.editCell = function(bunk, startMin, endMin, current) {
    if (!bunk) return;

    // Normalize start/end mins if they come in as Date strings (depends on caller)
    // Here we assume integers are passed.

    const newName = prompt(
        `Edit activity for ${bunk}\n${minutesToTimeLabel(startMin)} - ${minutesToTimeLabel(endMin)}\n(Enter CLEAR or FREE to empty)`,
        current
    );
    if (newName === null) return;

    const value = newName.trim();
    const isClear = (value === "" || value.toUpperCase()==="CLEAR" || value.toUpperCase()==="FREE");

    let resolvedName = value;

    // ---------------- VALIDATION / RULES ----------------
    if (!isClear && window.SchedulerCoreUtils && typeof window.SchedulerCoreUtils.loadAndFilterData === "function") {
        const warnings = [];

        const config = window.SchedulerCoreUtils.loadAndFilterData();
        const { activityProperties, historicalCounts, lastUsedDates, divisions } = config;

        const allKnown = Object.keys(activityProperties);
        resolvedName = resolveResourceName(value, allKnown) || value;

        const props = activityProperties[resolvedName];
        const targetSlots = findSlotsForRange(startMin, endMin);

        // ---- Same bunk duplicate check ----
        const schedule = window.scheduleAssignments[bunk] || [];
        schedule.forEach((entry, idx) => {
            if (targetSlots.includes(idx)) return;
            if (!entry || entry.continuation) return;

            const existing = entry.field || entry._activity;
            if (String(existing).trim().toLowerCase() === String(value).trim().toLowerCase()) {
                const label = window.unifiedTimes[idx]?.label || "another time";
                warnings.push(`⚠️ DUPLICATE: ${bunk} already has "${existing}" at ${label}.`);
            }
        });

        // ---- Blocker prompt ----
        if (warnings.length > 0) {
            const msg = warnings.join("\n\n") + "\n\nOverride and schedule anyway?";
            if (!confirm(msg)) return;
        }
    }

    // ---------------- APPLY EDIT ----------------
    const slots = findSlotsForRange(startMin, endMin);
    if (!slots.length) {
        alert("Grid alignment error. Refresh page.");
        return;
    }

    if (!window.scheduleAssignments[bunk])
        window.scheduleAssignments[bunk] = new Array(window.unifiedTimes.length);

    if (isClear) {
        slots.forEach((idx,i)=>{
            window.scheduleAssignments[bunk][idx] = {
                field:"Free", sport:null, continuation:i>0, _fixed:true, _activity:"Free"
            };
        });
    } else {
        const config = window.SchedulerCoreUtils.loadAndFilterData();
        const divName = Object.keys(config.divisions).find(
            d => config.divisions[d].bunks.includes(bunk)
        );

        // Clear existing slots first
        slots.forEach(idx => window.scheduleAssignments[bunk][idx] = null);

        // Use core fillBlock to ensure buffers and constraints are respected if possible
        if (window.fillBlock) {
             window.fillBlock({
                divName,
                bunk,
                startTime:startMin,
                endTime:endMin,
                slots,
                _fixed:true
            },{
                field:resolvedName,
                sport:null,
                _fixed:true,
                _activity:resolvedName
            },
            window.fieldUsageBySlot || {},
            config.yesterdayHistory,
            false,
            config.activityProperties);
        } else {
            // Fallback if fillBlock missing
            slots.forEach((idx, i) => {
                window.scheduleAssignments[bunk][idx] = {
                    field: resolvedName,
                    sport: null,
                    continuation: i > 0,
                    _fixed: true,
                    _activity: resolvedName
                };
            });
        }
    }

    saveSchedule();
    updateTable();
};

// ==========================================================================
// ENTRY FETCH / FORMATTERS
// ==========================================================================
function getEntry(bunk, slotIndex) {
    const a = window.scheduleAssignments || {};
    if (!a[bunk]) return null;
    return a[bunk][slotIndex] || null;
}

function formatEntry(entry) {
    if (!entry) return "";
    if (entry._isDismissal) return "Dismissal";
    if (entry._isSnack) return "Snacks";
    if (entry._isTransition) return `🏃‍♂️ ${entry.sport || entry.field}`;

    const label = entry._activity || (typeof entry.field === 'string' ? entry.field : entry.field?.name) || "";
    if (entry._h2h) return entry.sport || "League Game";
    if (entry._fixed) return label;
    if (entry.sport) return `${label} – ${entry.sport}`;
    return label;
}

// ==========================================================================
// RENDERING ENGINE (RESTORED)
// ==========================================================================
function updateTable() {
    const container = document.getElementById("scheduleTable");
    if (!container) return;
    renderStaggeredView(container);
}

function renderStaggeredView(container) {
    container.innerHTML = "";
    
    const times = window.unifiedTimes || [];
    const assignments = window.scheduleAssignments || {};
    const divisions = window.divisions || {};
    const availableDivisions = window.availableDivisions || [];

    if (times.length === 0) {
        container.innerHTML = `
            <div style="padding:40px; text-align:center; color:#666; background:#f9f9f9; border:2px dashed #ccc; border-radius:8px;">
                <h3>No Schedule Generated Yet</h3>
                <p>Go to the <strong>Daily Adjustments</strong> tab and click <span style="color:green; font-weight:bold;">Run Optimizer</span> to build today's schedule.</p>
            </div>`;
        return;
    }

    // --- Build Table HTML ---
    let html = `<div class="schedule-view-wrapper">
        <table class="schedule-division-table" style="width:100%; border-collapse:collapse;">
        <thead>
            <tr>
                <th style="background:#f1f5f9; position:sticky; top:0; left:0; z-index:20; min-width:120px; padding:10px; border:1px solid #ddd;">
                    Time / Bunk
                </th>`;

    // Header Row: Time Slots
    times.forEach(t => {
        html += `<th style="background:#f1f5f9; position:sticky; top:0; z-index:10; min-width:140px; padding:8px; border:1px solid #ddd; font-size:0.9rem;">
                    ${t.label}
                 </th>`;
    });
    html += `</tr></thead><tbody>`;

    // Rows: Divisions & Bunks
    availableDivisions.forEach(divName => {
        // Division Header
        const divColor = divisions[divName]?.color || '#333';
        html += `<tr style="background:${divColor}; color:white;">
                    <td colspan="${times.length + 1}" style="padding:8px 12px; font-weight:bold; font-size:1.1em;">
                        ${divName}
                    </td>
                 </tr>`;

        const divBunks = divisions[divName]?.bunks || [];
        if (divBunks.length === 0) {
            html += `<tr><td colspan="${times.length+1}" style="padding:8px; color:#999; font-style:italic;">No bunks in this division</td></tr>`;
        }

        divBunks.forEach(bunk => {
            html += `<tr>
                        <td style="position:sticky; left:0; background:#fff; z-index:5; padding:8px 12px; font-weight:600; border:1px solid #ddd; border-right:2px solid #ccc;">
                            ${bunk}
                        </td>`;

            const bunkSchedule = assignments[bunk] || [];

            for (let i = 0; i < times.length; i++) {
                const entry = bunkSchedule[i];
                let content = "";
                let cellStyle = "padding:6px; font-size:0.85rem; border:1px solid #eee; cursor:pointer; transition: background 0.1s;";
                let bgColor = "#ffffff";
                let textColor = "#111827";

                if (entry) {
                    if (entry.continuation) {
                        // Merged visually (simple approach: same color, no text, left border removed via CSS if strict, but here we just keep simple)
                        content = "<span style='opacity:0.3;'>&rdsh;</span>"; 
                        bgColor = entry._fixed ? "#fffbeb" : (entry._h2h ? "#eff6ff" : "#ffffff");
                    } else {
                        content = formatEntry(entry);
                        
                        // Styling Logic
                        if (entry._isTransition) {
                            bgColor = "#f0fdf4"; 
                            textColor = "#166534";
                            cellStyle += "font-style:italic; font-size:0.8rem;";
                        } else if (entry._h2h) {
                            bgColor = "#eff6ff"; // Light Blue for League
                            textColor = "#1e40af";
                            cellStyle += "font-weight:600;";
                        } else if (entry._fixed) {
                            bgColor = "#fffbeb"; // Yellowish for Pinned
                            textColor = "#92400e";
                            cellStyle += "border-left:3px solid #f59e0b;";
                        } else if (entry.field === "Free") {
                            bgColor = "#f9fafb";
                            textColor = "#9ca3af";
                        }
                    }
                } else {
                    bgColor = "#f3f4f6"; // Grey for empty/error
                }

                // Interaction args
                const startM = new Date(times[i].start).getHours()*60 + new Date(times[i].start).getMinutes();
                const endM   = new Date(times[i].end).getHours()*60 + new Date(times[i].end).getMinutes();
                const currentVal = entry ? (entry.field || entry._activity) : "";
                const safeVal = String(currentVal).replace(/'/g, "\\'");

                html += `<td style="${cellStyle} background-color:${bgColor}; color:${textColor};" 
                             onclick="window.editCell('${bunk}', ${startM}, ${endM}, '${safeVal}')"
                             title="Click to edit">
                            ${content}
                         </td>`;
            }
            html += `</tr>`;
        });
    });

    html += `</tbody></table></div>`;
    container.innerHTML = html;
}

// ==========================================================================
// STORAGE
// ==========================================================================
function saveSchedule() {
    window.saveCurrentDailyData?.("scheduleAssignments", window.scheduleAssignments);
    window.saveCurrentDailyData?.("leagueAssignments", window.leagueAssignments);
    window.saveCurrentDailyData?.("unifiedTimes", window.unifiedTimes);
}

function reconcileOrRenderSaved() {
    try {
        const data = window.loadCurrentDailyData?.() || {};
        window.scheduleAssignments = data.scheduleAssignments || {};
        window.leagueAssignments = data.leagueAssignments || {};
        const savedTimes = data.unifiedTimes || [];
        window.unifiedTimes = savedTimes.map(s => ({
            ...s,
            start:new Date(s.start),
            end:new Date(s.end)
        }));
    } catch (e) {
        console.error("Schedule load error:", e);
        window.scheduleAssignments = {};
        window.leagueAssignments = {};
        window.unifiedTimes = [];
    }
    updateTable();
}

function initScheduleSystem() { reconcileOrRenderSaved(); }

window.updateTable = updateTable;
window.initScheduleSystem = initScheduleSystem;
window.saveSchedule = saveSchedule;

})();
