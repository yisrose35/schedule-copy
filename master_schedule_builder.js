// ============================================================================
// master_schedule_builder.js  — Modern Pro Camp Edition (2025 FINAL VERSION)
// FULLY UPDATED — 100% compatible with your system
//
// KEY FEATURES:
// • Uses global time utils: window.SchedulerCoreUtils.parseTimeToMinutes
// • Snap-to-15-minutes timeline
// • Fully working template load/save/delete/assign
// • Smart Tile & Split Tile updated
// • Clean Modern Pro Camp UI
// • Events render correctly
//
// SAFE EXPORTS:
// • window.MasterBuilder_loadSkeleton(name)
// • window.MasterBuilder_getSkeleton()
// • window.initMasterScheduler()
// ============================================================================

(function () {
"use strict";

// --- GLOBAL UTILS ---
const parseTimeToMinutes = window.SchedulerCoreUtils?.parseTimeToMinutes;
const minutesToTime     = window.SchedulerCoreUtils?.minutesToTime;

// --- INTERNAL STATE ---
let container = null;
let palette   = null;
let grid      = null;

let dailySkeleton = [];   // master skeleton data structure

// --- CONSTANTS ---
const PIXELS_PER_MINUTE = 2;
const SNAP_MINUTES      = 15; // <-- your requested snap resolution
const BLOCK_DEFAULT_MINS = 30;

const LS_DRAFT_KEY = "MASTER_SCHEDULE_DRAFT";
const LS_DRAFT_NAME_KEY = "MASTER_SCHEDULE_DRAFT_NAME";

// --- TILE DEFINITIONS ---
const TILES = [
    { type: "activity",         name: "Activity",         style: "background:#e0f7fa;border:1px solid #007bff;" },
    { type: "sports",           name: "Sports",           style: "background:#dcedc8;border:1px solid #689f38;" },
    { type: "special",          name: "Special Activity", style: "background:#e8f5e9;border:1px solid #43a047;" },
    { type: "smart",            name: "Smart Tile",       style: "background:#e3f2fd;border:2px dashed #0288d1;color:#01579b;" },
    { type: "split",            name: "Split Activity",   style: "background:#fff3e0;border:1px solid #f57c00;" },
    { type: "league",           name: "League Game",      style: "background:#d1c4e9;border:1px solid #5e35b1;" },
    { type: "specialty_league", name: "Specialty League", style: "background:#fff8e1;border:1px solid #f9a825;" },
    { type: "swim",             name: "Swim",             style: "background:#bbdefb;border:1px solid #1976d2;" },
    { type: "lunch",            name: "Lunch",            style: "background:#fbe9e7;border:1px solid #d84315;" },
    { type: "snacks",           name: "Snacks",           style: "background:#fff9c4;border:1px solid #fbc02d;" },
    { type: "dismissal",        name: "Dismissal",        style: "background:#f44336;color:white;border:1px solid #b71c1c;" },
    { type: "custom",           name: "Custom Event",     style: "background:#eee;border:1px solid #616161;" }
];

// ============================================================================
// INIT
// ============================================================================
function init() {
    container = document.getElementById("master-scheduler-content");
    if (!container) return;

    loadSkeletonForToday();

    // Check for unsaved draft
    const draft = localStorage.getItem(LS_DRAFT_KEY);
    if (draft && confirm("Load unsaved draft?")) {
        dailySkeleton = JSON.parse(draft);
    } else {
        localStorage.removeItem(LS_DRAFT_KEY);
        localStorage.removeItem(LS_DRAFT_NAME_KEY);
    }

    buildUI();
    renderPalette();
    renderGrid();
}

// ============================================================================
// BUILD UI
// ============================================================================
function buildUI() {
    container.innerHTML = `
    <div id="mb-template-bar" style="padding:15px;background:#f5f8f8;border:1px solid #d0d0d0;border-radius:8px;margin-bottom:20px;"></div>

    <div id="mb-palette" style="padding:10px;background:white;border-radius:8px;display:flex;flex-wrap:wrap;gap:10px;margin-bottom:15px;
        border:1px solid #e0e0e0;box-shadow:0 1px 2px rgba(0,0,0,0.1);">
    </div>

    <div id="mb-grid-wrapper" style="overflow-x:auto; border:1px solid #b7b7b7; background:#fff; border-radius:8px;">
        <div id="mb-grid"></div>
    </div>
    `;

    palette = document.getElementById("mb-palette");
    grid    = document.getElementById("mb-grid");

    renderTemplateControls();
}

// ============================================================================
// TEMPLATE CONTROLS
// ============================================================================
function renderTemplateControls() {
    const bar = document.getElementById("mb-template-bar");
    const saved = window.getSavedSkeletons?.() || {};
    const assignments = window.getSkeletonAssignments?.() || {};
    const names = Object.keys(saved).sort();

    let opts = names.map(n => `<option value="${n}">${n}</option>`).join("");

    bar.innerHTML = `
    <div style="display:flex; flex-wrap:wrap; gap:20px; align-items:flex-end;">
        <div>
            <label>Load Template</label><br>
            <select id="mb-load-select" style="padding:6px;min-width:160px">
                <option value="">-- Select --</option>
                ${opts}
            </select>
        </div>

        <div>
            <label>Save As</label><br>
            <input id="mb-save-name" type="text" placeholder="Template Name" style="padding:6px;width:160px">
        </div>

        <div>
            <button id="mb-save-btn" style="background:#007bff;color:#fff;padding:6px 12px;border-radius:6px;">Save</button>
            <button id="mb-new-btn" style="background:#f39c12;color:#fff;padding:6px 12px;border-radius:6px;margin-left:5px;">New</button>
        </div>
    </div>

    <details style="margin-top:10px;">
        <summary style="cursor:pointer;color:#007bff;font-weight:600;">Assignments & Delete</summary>
        <div style="padding:10px;border:1px solid #e5e5e5;border-radius:6px;margin-top:10px;">
            <div style="display:flex;flex-wrap:wrap;gap:15px;">
                ${["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Default"]
                .map(day => `
                    <div>
                        <label>${day}</label><br>
                        <select data-day="${day}" style="padding:5px;min-width:120px">
                            <option value="">-- None --</option>
                            ${opts}
                        </select>
                    </div>
                `).join("")}
            </div>

            <button id="mb-assign-save" style="margin-top:10px;background:#27ae60;color:white;padding:6px 12px;border-radius:6px;">
                Save Assignments
            </button>

            <hr style="margin:12px 0">

            <button id="mb-delete-btn" style="background:#c0392b;color:white;padding:6px 12px;border-radius:6px;">
                Delete Selected Template
            </button>
        </div>
    </details>
    `;

    // bindings
    const loadSel = document.getElementById("mb-load-select");
    const saveName = document.getElementById("mb-save-name");

    loadSel.onchange = () => {
        const name = loadSel.value;
        if (name && saved[name] && confirm(`Load template "${name}"?`)) {
            MasterBuilder_loadSkeleton(name);
            saveName.value = name;
        }
    };

    document.getElementById("mb-save-btn").onclick = () => {
        const name = saveName.value.trim();
        if (name && confirm(`Save as "${name}"?`)) {
            window.saveSkeleton?.(name, dailySkeleton);
            localStorage.removeItem(LS_DRAFT_KEY);
            alert("Saved.");
            renderTemplateControls();
        }
    };

    document.getElementById("mb-new-btn").onclick = () => {
        if (confirm("Clear schedule and start new?")) {
            dailySkeleton = [];
            localStorage.removeItem(LS_DRAFT_KEY);
            renderGrid();
        }
    };

    // assignments binding
    bar.querySelectorAll("select[data-day]").forEach(sel => {
        const day = sel.dataset.day;
        sel.value = assignments[day] || "";
    });

    document.getElementById("mb-assign-save").onclick = () => {
        const map = {};
        bar.querySelectorAll("select[data-day]").forEach(sel => {
            if (sel.value) map[sel.dataset.day] = sel.value;
        });
        window.saveSkeletonAssignments?.(map);
        alert("Assignments saved.");
    };

    document.getElementById("mb-delete-btn").onclick = () => {
        const name = loadSel.value;
        if (name && confirm(`Delete "${name}"?`)) {
            window.deleteSkeleton?.(name);
            alert("Deleted.");
            renderTemplateControls();
        }
    };
}

// ============================================================================
// PALETTE
// ============================================================================
function renderPalette() {
    palette.innerHTML = "";

    TILES.forEach(tile => {
        const el = document.createElement("div");
        el.className = "mb-tile";
        el.textContent = tile.name;
        el.style.cssText = `
            ${tile.style};
            padding:8px 12px;
            border-radius:6px;
            cursor:grab;
            font-size:0.9rem;
        `;
        el.draggable = true;

        el.ondragstart = (e) => {
            e.dataTransfer.setData("application/json", JSON.stringify(tile));
        };

        palette.appendChild(el);
    });
}

// ============================================================================
// RENDER GRID
// ============================================================================
function renderGrid() {
    const divisions = window.divisions || {};
    const available = window.availableDivisions || [];

    if (!available.length) {
        grid.innerHTML = `<div style="padding:20px;text-align:center;color:#666;">
            No divisions found. Please create divisions first.
        </div>`;
        return;
    }

    // compute earliest / latest
    let earliest = null;
    let latest = null;

    available.forEach(div => {
        const d = divisions[div];
        if (!d) return;

        const s = parseTimeToMinutes(d.startTime);
        const e = parseTimeToMinutes(d.endTime);
        if (s != null && (earliest == null || s < earliest)) earliest = s;
        if (e != null && (latest == null || e > latest)) latest = e;
    });

    if (!earliest) earliest = 540;
    if (!latest) latest = 960;

    // ensure pinned events stretch timeline
    const pinnedMax = Math.max(...dailySkeleton.map(ev => parseTimeToMinutes(ev.endTime) || -Infinity));
    if (pinnedMax > latest) latest = pinnedMax;

    if (latest <= earliest) latest = earliest + 60;

    const height = (latest - earliest) * PIXELS_PER_MINUTE;

    // build HTML
    let html = `
    <div style="display:grid; grid-template-columns:60px repeat(${available.length}, 1fr); position:relative; min-width:900px;">
    `;

    // header
    html += `
    <div style="grid-row:1; background:white; border-bottom:1px solid #ccc; padding:8px; font-weight:600; position:sticky; top:0; z-index:10;">Time</div>
    `;

    available.forEach((divName, idx) => {
        const color = divisions[divName]?.color || "#444";
        html += `
        <div style="
            grid-row:1;
            grid-column:${idx + 2};
            background:${color};
            color:white;
            border-bottom:1px solid #ccc;
            padding:8px;
            text-align:center;
            font-weight:600;
            position:sticky;
            top:0;
            z-index:10;
        ">${divName}</div>
        `;
    });

    // time column
    html += `<div style="grid-row:2; grid-column:1; position:relative; height:${height}px; background:#fafafa; border-right:1px solid #ddd;">`;
    for (let m = earliest; m < latest; m += SNAP_MINUTES) {
        const top = (m - earliest) * PIXELS_PER_MINUTE;
        html += `
        <div style="position:absolute; top:${top}px; left:0; width:100%; font-size:10px; color:#777; border-top:1px dashed #eee; padding-left:4px;">
            ${minutesToTime(m)}
        </div>`;
    }
    html += `</div>`;

    // division columns
    available.forEach((divName, idx) => {
        const d = divisions[divName];
        const s = parseTimeToMinutes(d.startTime);
        const e = parseTimeToMinutes(d.endTime);

        html += `
        <div class="mb-grid-cell" data-div="${divName}" data-start-min="${earliest}"
            style="grid-row:2; grid-column:${idx + 2}; position:relative; height:${height}px; border-right:1px solid #eee;">
        `;

        // BEFORE START — dark grey diagonal stripes
if (s > earliest) {
    html += `
    <div style="
        position:absolute;
        top:0;
        left:0;
        width:100%;
        height:${(s-earliest)*PIXELS_PER_MINUTE}px;
        background: repeating-linear-gradient(
            45deg,
            #d3d3d3 0,
            #d3d3d3 10px,
            #e8e8e8 10px,
            #e8e8e8 20px
        );
        opacity: 0.8;
        pointer-events:none;
        border-bottom:1px solid #ccc;
    "></div>`;
}

// AFTER END — dark grey diagonal stripes
if (e < latest) {
    html += `
    <div style="
        position:absolute;
        top:${(e-earliest)*PIXELS_PER_MINUTE}px;
        left:0;
        width:100%;
        height:${(latest-e)*PIXELS_PER_MINUTE}px;
        background: repeating-linear-gradient(
            45deg,
            #d3d3d3 0,
            #d3d3d3 10px,
            #e8e8e8 10px,
            #e8e8e8 20px
        );
        opacity: 0.8;
        pointer-events:none;
        border-top:1px solid #ccc;
    "></div>`;
}


        // events
        dailySkeleton.filter(ev => ev.division === divName).forEach(ev => {
            const startM = parseTimeToMinutes(ev.startTime);
            const endM = parseTimeToMinutes(ev.endTime);
            if (startM == null || endM == null || endM <= startM) return;

            const top = (startM - earliest) * PIXELS_PER_MINUTE;
            const h = (endM - startM) * PIXELS_PER_MINUTE;

            html += renderEventTile(ev, top, h);
        });

        html += `</div>`;
    });

    html += `</div>`;
    grid.innerHTML = html;

    bindDropEvents();
    bindDeleteEvents();
}

// ============================================================================
// RENDER EVENT TILE
// ============================================================================
function renderEventTile(ev, top, height) {
    const tile = TILES.find(t => t.name === ev.event) || TILES.find(t => t.type === ev.type);
    const base = tile ? tile.style : "background:#ececec;border:1px solid #999;";

    let label = `
        <div style="font-weight:bold">${ev.event}</div>
        <div style="font-size:0.75rem">${ev.startTime} — ${ev.endTime}</div>
    `;

    if (ev.type === "smart" && ev.smartData) {
        label += `
        <div style="font-size:0.7rem;margin-top:2px;">
            Fallback: ${ev.smartData.fallbackActivity}
        </div>`;
    }

    return `
    <div class="mb-event" data-id="${ev.id}" style="
        ${base};
        position:absolute;
        top:${top}px;
        left:3%;
        width:94%;
        height:${height}px;
        padding:4px;
        border-radius:6px;
        overflow:hidden;
        font-size:0.85rem;
        line-height:1.15;
        cursor:pointer;
        box-shadow:0 1px 2px rgba(0,0,0,0.2);
    ">
        ${label}
    </div>
    `;
}

// ============================================================================
// DROP EVENTS
// ============================================================================
function bindDropEvents() {

    grid.querySelectorAll(".mb-grid-cell").forEach(cell => {

        cell.ondragover = e => {
            e.preventDefault();
            cell.style.background = "#e6fffa";
        };

        cell.ondragleave = () => {
            cell.style.background = "";
        };

        cell.ondrop = e => {
            e.preventDefault();
            cell.style.background = "";

            const tileData = JSON.parse(e.dataTransfer.getData("application/json"));
            const divName   = cell.dataset.div;
            const earliest  = parseInt(cell.dataset.startMin);

            // calculate drop time
            const rect = cell.getBoundingClientRect();
            const offsetY = e.clientY - rect.top;

            const minutesOffset = Math.round((offsetY / PIXELS_PER_MINUTE) / SNAP_MINUTES) * SNAP_MINUTES;
            const startMin = earliest + minutesOffset;
            const endMin   = startMin + BLOCK_DEFAULT_MINS;

            const startStr = minutesToTime(startMin);
            const endStr   = minutesToTime(endMin);

            let newEvent = null;

            // SMART TILE --------------------------------------------------
            if (tileData.type === "smart") {
                let st = prompt("Start Time:", startStr);
                if (!st) return;

                let et = prompt("End Time:", endStr);
                if (!et) return;

                let mains = prompt("Enter TWO main activities (ex: Swim / Art):");
                if (!mains) return;

                let [m1, m2] = mains.split(/[\/,]/).map(s => s.trim());
                if (!m2) {
                    alert("Need two activities.");
                    return;
                }

                let fb = prompt(`Which activity needs fallback?\n1 = ${m1}\n2 = ${m2}`);
                const fallbackFor = fb === "1" ? m1 : m2;

                let fallbackActivity = prompt(`Fallback for ${fallbackFor}?`, "Sports");

                newEvent = {
                    id: String(Date.now()),
                    type: "smart",
                    event: `${m1} / ${m2}`,
                    division: divName,
                    startTime: st,
                    endTime: et,
                    smartData: {
                        main1: m1,
                        main2: m2,
                        fallbackFor,
                        fallbackActivity
                    }
                };
            }

            // SPLIT TILE --------------------------------------------------
            else if (tileData.type === "split") {
                let st = prompt("Start Time:", startStr);
                if (!st) return;

                let et = prompt("End Time:", endStr);
                if (!et) return;

                let a1 = prompt("First Half Activity:");
                if (!a1) return;

                let a2 = prompt("Second Half Activity:");
                if (!a2) return;

                newEvent = {
                    id: String(Date.now()),
                    type: "split",
                    event: `${a1} / ${a2}`,
                    division: divName,
                    startTime: st,
                    endTime: et,
                    subEvents: [{ event: a1 }, { event: a2 }]
                };
            }

            // STANDARD ----------------------------------------------------
            else {
                let name = tileData.name;

                if (tileData.type === "custom") {
                    name = prompt("Event Name:", "Regroup");
                    if (!name) return;
                }
                if (tileData.type === "league")          name = "League Game";
                if (tileData.type === "specialty_league") name = "Specialty League";

                let st = prompt(`${name} Start:`, startStr);
                if (!st) return;

                let et = prompt(`${name} End:`, endStr);
                if (!et) return;

                newEvent = {
                    id: String(Date.now()),
                    type: tileData.type,
                    event: name,
                    division: divName,
                    startTime: st,
                    endTime: et
                };
            }

            // FINALLY ADD TILE
            dailySkeleton.push(newEvent);
            localStorage.setItem(LS_DRAFT_KEY, JSON.stringify(dailySkeleton));
            renderGrid();
        };
    });
}

// ============================================================================
// DELETE EVENTS
// ============================================================================
function bindDeleteEvents() {
    grid.querySelectorAll(".mb-event").forEach(ev => {
        ev.onclick = () => {
            const id = ev.dataset.id;
            if (confirm("Delete this block?")) {
                dailySkeleton = dailySkeleton.filter(x => x.id !== id);
                localStorage.setItem(LS_DRAFT_KEY, JSON.stringify(dailySkeleton));
                renderGrid();
            }
        };
    });
}

// ============================================================================
// LOAD SKELETON FOR TODAY
// ============================================================================
function loadSkeletonForToday() {
    const saved = window.getSavedSkeletons?.() || {};
    const assignments = window.getSkeletonAssignments?.() || {};
    const date = window.currentScheduleDate || "";

    const parts = date.split("-").map(Number);
    let dow = 0;
    if (parts.length === 3) dow = new Date(parts[0], parts[1]-1, parts[2]).getDay();

    const names = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
    const today = names[dow];

    const tmpl = assignments[today] || assignments["Default"];

    dailySkeleton = tmpl && saved[tmpl]
        ? JSON.parse(JSON.stringify(saved[tmpl]))
        : [];
}

// ============================================================================
// PUBLIC EXPORTS
// ============================================================================
function MasterBuilder_loadSkeleton(name) {
    const saved = window.getSavedSkeletons?.() || {};
    if (saved[name]) {
        dailySkeleton = JSON.parse(JSON.stringify(saved[name]));
        localStorage.setItem(LS_DRAFT_KEY, JSON.stringify(dailySkeleton));
        renderGrid();
    }
}

function MasterBuilder_getSkeleton() {
    return JSON.parse(JSON.stringify(dailySkeleton));
}

window.MasterBuilder_loadSkeleton = MasterBuilder_loadSkeleton;
window.MasterBuilder_getSkeleton = MasterBuilder_getSkeleton;
window.initMasterScheduler = init;

})();
