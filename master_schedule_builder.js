/* ===========================================================================
   master_schedule_builder.js  (FULLY UPDATED w/ Division Normalization)
   =========================================================================== */

(function () {
'use strict';

/* ========================================================================== */
/* STATE */
/* ========================================================================== */
let container = null, palette = null, grid = null;
let dailySkeleton = [];

const SKELETON_DRAFT_KEY = 'master-schedule-draft';
const SKELETON_DRAFT_NAME_KEY = 'master-schedule-draft-name';

const PIXELS_PER_MINUTE = 2;
const INCREMENT_MINS = 30;

/* ========================================================================== */
/* DIVISION NORMALIZER — CRITICAL FIX */
/* ========================================================================== */

function normalizeDivisionName(name) {
    const divisions = window.divisions || {};
    if (!name) return name;

    // 1) Direct match
    if (divisions[name]) return name;

    // 2) Match by displayName
    for (const k in divisions) {
        if (divisions[k]?.displayName === name) return k;
    }

    // 3) Match numeric-only
    const num = String(name).replace(/\D+/g, "");
    if (divisions[num]) return num;

    return name; // fallback – prevents undefined
}

/* ========================================================================== */
/* TILE DEFINITIONS */
/* ========================================================================== */
const TILES = [
  { type: 'activity', name: 'Activity', style: 'background:#e0f7fa;border:1px solid #007bff;', description: 'General flexible slot.' },
  { type: 'sports', name: 'Sports', style: 'background:#dcedc8;border:1px solid #689f38;', description: 'Sports slot only.' },
  { type: 'special', name: 'Special Activity', style: 'background:#e8f5e9;border:1px solid #43a047;', description: 'Special activity only.' },

  { type: 'smart', name: 'Smart Tile', style: 'background:#e3f2fd;border:2px dashed #0288d1;color:#01579b;', description: 'Smart balancing tile' },

  { type: 'split', name: 'Split Activity', style: 'background:#fff3e0;border:1px solid #f57c00;', description: 'Two activities share the block.' },

  { type: 'league', name: 'League Game', style: 'background:#d1c4e9;border:1px solid #5e35b1;', description: 'Regular league slot.' },
  { type: 'specialty_league', name: 'Specialty League', style: 'background:#fff8e1;border:1px solid #f9a825;', description: 'Specialty league slot.' },

  { type: 'swim', name: 'Swim', style: 'background:#bbdefb;border:1px solid #1976d2;', description: 'Pinned swim.' },
  { type: 'lunch', name: 'Lunch', style: 'background:#fbe9e7;border:1px solid #d84315;', description: 'Pinned lunch.' },
  { type: 'snacks', name: 'Snacks', style: 'background:#fff9c4;border:1px solid #fbc02d;', description: 'Pinned snacks.' },
  { type: 'dismissal', name: 'Dismissal', style: 'background:#f44336;color:white;border:1px solid #b71c1c;', description: 'Dismissal.' },

  { type: 'custom', name: 'Custom Pinned Event', style: 'background:#eee;border:1px solid #616161;', description: 'Pinned custom event' }
];

/* ========================================================================== */
/* RESOLVE EVENT TO ENGINE TYPE */
/* ========================================================================== */

function resolveEvent(name) {
    if (!name) return { type: "pinned", event: "Free" };

    const v = name.trim().toLowerCase();

    if (v === "activity" || v === "general activity slot")
        return { type: "slot", event: "General Activity Slot" };

    if (v === "sports" || v === "sports slot")
        return { type: "slot", event: "Sports Slot" };

    if (v === "special" || v === "special activity")
        return { type: "slot", event: "Special Activity" };

    if (v === "swim")
        return { type: "pinned", event: "Swim" };

    if (v === "lunch")
        return { type: "pinned", event: "Lunch" };

    if (v === "snacks")
        return { type: "pinned", event: "Snacks" };

    if (v === "dismissal")
        return { type: "pinned", event: "Dismissal" };

    if (v === "league" || v === "league game")
        return { type: "league", event: "League Game" };

    if (v === "specialty league")
        return { type: "specialty", event: "Specialty League" };

    return { type: "pinned", event: name.trim() };
}

/* ========================================================================== */
/* INIT */
/* ========================================================================== */

function init() {
    container = document.getElementById("master-scheduler-content");
    if (!container) return;

    loadDailySkeleton();

    const savedDraft = localStorage.getItem(SKELETON_DRAFT_KEY);
    if (savedDraft && confirm("Load saved draft?")) {
        dailySkeleton = JSON.parse(savedDraft);
    }

    container.innerHTML = `
        <div id="scheduler-template-ui"></div>
        <div id="scheduler-palette"></div>
        <div id="scheduler-grid" style="overflow-x:auto;border:1px solid #999;"></div>
    `;

    palette = document.getElementById("scheduler-palette");
    grid = document.getElementById("scheduler-grid");

    renderTemplateUI();
    renderPalette();
    renderGrid();
}

/* ========================================================================== */
/* LOAD / SAVE DRAFT */
/* ========================================================================== */

function saveDraft() {
    localStorage.setItem(SKELETON_DRAFT_KEY, JSON.stringify(dailySkeleton));
}

function clearDraft() {
    localStorage.removeItem(SKELETON_DRAFT_KEY);
    localStorage.removeItem(SKELETON_DRAFT_NAME_KEY);
}

function loadDailySkeleton() {
    const assignments = window.getSkeletonAssignments?.() || {};
    const skeletons = window.getSavedSkeletons?.() || {};

    const dateStr = window.currentScheduleDate || "";
    const [Y, M, D] = dateStr.split('-').map(Number);
    let dow = 0;
    if (Y && M && D) dow = new Date(Y, M - 1, D).getDay();

    const days = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
    let tmpl = assignments[days[dow]] || assignments["Default"];

    const s = skeletons[tmpl];
    dailySkeleton = s ? JSON.parse(JSON.stringify(s)) : [];
}

/* ========================================================================== */
/* TEMPLATE UI */
/* ========================================================================== */

function renderTemplateUI() {
    const ui = document.getElementById("scheduler-template-ui");
    const saved = window.getSavedSkeletons?.() || {};

    const opts = Object.keys(saved)
        .sort()
        .map(n => `<option value="${n}">${n}</option>`).join("");

    ui.innerHTML = `
        <div style="display:flex;gap:20px;align-items:end;">
            <div>
                <label>Load Template</label><br>
                <select id="tmplLoad"><option value="">--</option>${opts}</select>
            </div>

            <div>
                <label>Save As</label><br>
                <input id="tmplName" placeholder="Template Name">
            </div>

            <div><br>
                <button id="tmplSave">Save</button>
                <button id="tmplNew">New Grid</button>
            </div>
        </div>
    `;

    document.getElementById("tmplLoad").onchange = e => {
        const name = e.target.value;
        if (name) loadSkeletonToBuilder(name);
    };

    document.getElementById("tmplSave").onclick = () => {
        const name = document.getElementById("tmplName").value.trim();
        if (!name) return alert("Name required");
        window.saveSkeleton?.(name, dailySkeleton);
        clearDraft();
        alert("Saved.");
        renderTemplateUI();
    };

    document.getElementById("tmplNew").onclick = () => {
        dailySkeleton = [];
        saveDraft();
        renderGrid();
    };
}

function loadSkeletonToBuilder(name) {
    const all = window.getSavedSkeletons?.() || {};
    const s = all[name];
    dailySkeleton = s ? JSON.parse(JSON.stringify(s)) : [];
    saveDraft();
    renderGrid();
}

/* ========================================================================== */
/* PALETTE */
/* ========================================================================== */

function renderPalette() {
    palette.innerHTML = "";
    TILES.forEach(tile => {
        const el = document.createElement("div");
        el.textContent = tile.name;
        el.style.cssText = tile.style +
            ";padding:8px 12px;border-radius:4px;cursor:grab;margin:4px;";
        el.draggable = true;
        el.onclick = () => alert(tile.description);

        el.ondragstart = e => {
            e.dataTransfer.setData("tile", JSON.stringify(tile));
        };

        palette.appendChild(el);
    });
}

/* ========================================================================== */
/* GRID RENDERING */
/* ========================================================================== */

function renderGrid() {
    const divisions = window.divisions || {};
    const availableDivisions = window.availableDivisions || [];

    let earliest = null, latest = null;

    Object.values(divisions).forEach(div => {
        const s = timeToMin(div.startTime);
        const e = timeToMin(div.endTime);
        if (s != null && (earliest == null || s < earliest)) earliest = s;
        if (e != null && (latest == null || e > latest)) latest = e;
    });

    if (earliest == null) earliest = 540;
    if (latest == null) latest = 960;

    const totalMin = latest - earliest;
    const totalH = totalMin * PIXELS_PER_MINUTE;

    let html = `<div style="display:grid;grid-template-columns:60px repeat(${availableDivisions.length},1fr)">`;

    html += `<div style="padding:8px;border-bottom:1px solid #999;font-weight:bold;">Time</div>`;
    availableDivisions.forEach(div => {
        const col = divisions[div]?.color || "#444";
        html += `<div style="padding:8px;border-bottom:1px solid #999;background:${col};color:white;text-align:center;">${div}</div>`;
    });

    html += `<div style="grid-row:2;width:60px;position:relative;height:${totalH}px;">`;

    for (let m = earliest; m < latest; m += INCREMENT_MINS) {
        const top = (m - earliest) * PIXELS_PER_MINUTE;
        html += `<div style="position:absolute;top:${top}px;height:${INCREMENT_MINS*PIXELS_PER_MINUTE}px;border-bottom:1px dashed #ddd;font-size:10px;">${minToTime(m)}</div>`;
    }
    html += `</div>`;

    availableDivisions.forEach(divName => {
        const normDiv = normalizeDivisionName(divName);

        html += `<div class="grid-cell" data-div="${normDiv}" data-start="${earliest}" style="position:relative;height:${totalH}px;border-right:1px solid #ddd;">`;

        dailySkeleton
            .filter(ev => ev.division === normDiv)
            .forEach(ev => {
                const sm = timeToMin(ev.startTime);
                const em = timeToMin(ev.endTime);

                const top = (sm - earliest) * PIXELS_PER_MINUTE;
                const height = (em - sm) * PIXELS_PER_MINUTE;

                html += renderTile(ev, top, height);
            });

        html += `</div>`;
    });

    html += `</div>`;
    grid.innerHTML = html;

    enableDrops();
    enableRemovals();
}

/* ========================================================================== */
/* RENDER TILE */
/* ========================================================================== */

function renderTile(ev, top, height) {
    return `
      <div class="grid-event"
           data-id="${ev.id}"
           style="position:absolute;top:${top}px;height:${height}px;width:calc(100% - 6px);left:3px;
                  background:#f6f6f6;border:1px solid #999;border-radius:4px;padding:4px;font-size:.85em;">
          <strong>${ev.event}</strong><br>
          <span>${ev.startTime} - ${ev.endTime}</span>
      </div>
    `;
}

/* ========================================================================== */
/* DRAG / DROP */
/* ========================================================================== */

function enableDrops() {
    grid.querySelectorAll(".grid-cell").forEach(cell => {

        cell.ondragover = e => { e.preventDefault(); cell.style.background = "#e0ffe0"; };
        cell.ondragleave = () => { cell.style.background = ""; };

        cell.ondrop = e => {
            e.preventDefault();
            cell.style.background = "";

            const tileData = JSON.parse(e.dataTransfer.getData("tile"));
            const divName = normalizeDivisionName(cell.dataset.div);

            const divisions = window.divisions || {};
            const div = divisions[divName];
            if (!div) {
                alert("Invalid division dropped into grid.");
                return;
            }

            const rect = cell.getBoundingClientRect();
            const y = e.clientY - rect.top + grid.scrollTop;

            const earliest = parseInt(cell.dataset.start, 10);
            const offsetMin = Math.round((y / PIXELS_PER_MINUTE) / 15) * 15;

            const defaultStart = minToTime(earliest + offsetMin);

            addEventFromTile(tileData, divName, div, defaultStart);
            renderGrid();
            saveDraft();
        };
    });
}

function enableRemovals() {
    grid.querySelectorAll(".grid-event").forEach(tile => {
        tile.onclick = () => {
            const id = tile.dataset.id;
            dailySkeleton = dailySkeleton.filter(ev => ev.id !== id);
            saveDraft();
            renderGrid();
        };
    });
}

/* ========================================================================== */
/* CREATE EVENTS */
/* ========================================================================== */

function addEventFromTile(tileData, divName, div, defaultStart) {
    const normDiv = normalizeDivisionName(divName);

    let st, et, sm, em;

    function askTime(label, isStart) {
        while (true) {
            const t = prompt(label, defaultStart);
            if (!t) return null;

            const m = timeToMin(t);
            if (m == null) { alert("Invalid time"); continue; }

            const ds = timeToMin(div.startTime);
            const de = timeToMin(div.endTime);

            if (isStart && m < ds) { alert("Before division start."); continue; }
            if (!isStart && m > de) { alert("After division end."); continue; }
            if (!isStart && m <= sm) { alert("End must be after start."); continue; }

            return t;
        }
    }

    /* ================================================================ */
    /* SMART TILE */
    /* ================================================================ */
    if (tileData.type === "smart") {
        st = askTime("Smart Tile - Start Time:", true); if (!st) return;
        sm = timeToMin(st);
        et = askTime("Smart Tile - End Time:", false); if (!et) return;
        em = timeToMin(et);

        const raw = prompt("Enter the 2 MAIN activities (comma or slash):");
        if (!raw) return;

        const parts = raw.split(/[,/]/).map(s => s.trim()).filter(Boolean);
        if (parts.length < 2) return alert("Need two activities.");

        const [m1, m2] = parts;

        const target = prompt(`Which requires fallback?\n1: ${m1}\n2: ${m2}`);
        const fallbackFor = (target === "1" ? m1 : target === "2" ? m2 : null);
        if (!fallbackFor) return alert("Invalid");

        const fallback = prompt(`Fallback for "${fallbackFor}":`);
        if (!fallback) return;

        const r1 = resolveEvent(m1);
        const r2 = resolveEvent(m2);
        const rFor = resolveEvent(fallbackFor);
        const rFb = resolveEvent(fallback);

        dailySkeleton.push({
            id: "evt_" + Math.random().toString(36).slice(2),
            type: "smart",
            event: `${m1} / ${m2}`,
            division: normDiv,
            startTime: st,
            endTime: et,
            smartData: {
                main1: r1.event,
                main2: r2.event,
                fallbackFor: rFor.event,
                fallbackActivity: rFb.event
            }
        });

        return;
    }

    /* ================================================================ */
    /* SPLIT TILE */
    /* ================================================================ */
    if (tileData.type === "split") {
        st = askTime("Split Block - Start Time:", true); if (!st) return;
        sm = timeToMin(st);
        et = askTime("Split Block - End Time:", false); if (!et) return;
        em = timeToMin(et);

        const a1 = prompt("First Activity:");
        if (!a1) return;

        const a2 = prompt("Second Activity:");
        if (!a2) return;

        const r1 = resolveEvent(a1);
        const r2 = resolveEvent(a2);

        dailySkeleton.push({
            id: "evt_" + Math.random().toString(36).slice(2),
            type: "split",
            event: `${r1.event} / ${r2.event}`,
            division: normDiv,
            startTime: st,
            endTime: et,
            subEvents: [
                { type: r1.type, event: r1.event },
                { type: r2.type, event: r2.event }
            ]
        });

        return;
    }

    /* ================================================================ */
    /* ALL OTHER TILES (SINGLE ACTIVITY) */
    /* ================================================================ */
    st = askTime(`Add "${tileData.name}" — Start:`, true); if (!st) return;
    sm = timeToMin(st);

    et = askTime("End Time:", false); if (!et) return;
    em = timeToMin(et);

    const mapped = resolveEvent(tileData.name);

    dailySkeleton.push({
        id: "evt_" + Math.random().toString(36).slice(2),
        type: mapped.type,
        event: mapped.event,
        division: normDiv,
        startTime: st,
        endTime: et
    });
}

/* ========================================================================== */
/* TIME HELPERS */
/* ========================================================================== */

function timeToMin(str) {
    if (!str) return null;
    let s = str.toLowerCase().trim();
    let mer = null;

    if (s.endsWith("am") || s.endsWith("pm")) {
        mer = s.endsWith("am") ? "am" : "pm";
        s = s.replace(/am|pm/, "").trim();
    }

    const m = s.match(/^(\d{1,2})\s*:\s*(\d{2})$/);
    if (!m) return null;

    let hh = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);

    if (mer) {
        if (hh === 12) hh = (mer === "am") ? 0 : 12;
        else if (mer === "pm") hh += 12;
    }

    return hh * 60 + mm;
}

function minToTime(min) {
    const hh = Math.floor(min / 60);
    const mm = min % 60;
    const h12 = (hh % 12 === 0 ? 12 : (hh % 12));
    return `${h12}:${String(mm).padStart(2, "0")}${hh < 12 ? "am" : "pm"}`;
}

/* ========================================================================== */
/* OUTPUT FOR ENGINE */
/* ========================================================================== */

window.getMasterSkeleton = function () {
    return dailySkeleton.map(ev => {
        return {
            division: normalizeDivisionName(ev.division),
            start: timeToMin(ev.startTime),
            end: timeToMin(ev.endTime),
            type: ev.type,
            event: ev.event,
            ...(ev.smartData ? { smartData: { ...ev.smartData } } : {}),
            ...(ev.subEvents ? { subEvents: ev.subEvents.map(s => ({ ...s })) } : {})
        };
    });
};

window.initMasterScheduler = init;

})();
