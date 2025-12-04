// =====================================================================
// master_schedule_builder.js — Fully Integrated, Global-Safe Version
// =====================================================================

(function () {
    'use strict';

    // =====================================================================
    // GLOBAL EXPORTS (so the rest of the app sees updates)
    // =====================================================================
    window.MSB = {
        get dailySkeleton() { return dailySkeleton; },
        render: () => renderGrid(),
    };

    window.loadSkeletonToBuilder = function (name) {
        const all = window.getSavedSkeletons?.() || {};
        if (!all[name]) {
            console.warn("⚠ Template not found:", name);
            return;
        }
        dailySkeleton = JSON.parse(JSON.stringify(all[name]));
        saveDraftToLocalStorage();
        renderGrid();
    };

    // =====================================================================
    // PRIVATE STATE
    // =====================================================================
    let container = null, palette = null, grid = null;

    let dailySkeleton = [];

    const SKELETON_DRAFT_KEY = 'master-schedule-draft';
    const SKELETON_DRAFT_NAME_KEY = 'master-schedule-draft-name';
    const PIXELS_PER_MINUTE = 2;
    const INCREMENT_MINS = 30;

    // =====================================================================
    // TIME HELPERS — Always prefer GLOBAL UTILS
    // =====================================================================
    const parseTimeToMinutes =
        window.SchedulerCoreUtils?.parseTimeToMinutes ||
        function (str) {
            if (!str) return null;
            let s = str.toLowerCase().trim();
            let isPM = s.includes("pm");
            let isAM = s.includes("am");
            s = s.replace(/am|pm/g, "").trim();
            let [h, m] = s.split(":").map(Number);
            if (isPM && h < 12) h += 12;
            if (isAM && h === 12) h = 0;
            return h * 60 + (m || 0);
        };

    const minutesToTime =
        window.SchedulerCoreUtils?.minutesToTime ||
        function (mins) {
            const h24 = Math.floor(mins / 60);
            const m = mins % 60;
            const ap = h24 >= 12 ? "pm" : "am";
            const h12 = (h24 % 12) || 12;
            return `${h12}:${m.toString().padStart(2, "0")}${ap}`;
        };

    // =====================================================================
    // SAVE / CLEAR
    // =====================================================================
    function saveDraftToLocalStorage() {
        try {
            if (dailySkeleton && dailySkeleton.length) {
                localStorage.setItem(SKELETON_DRAFT_KEY, JSON.stringify(dailySkeleton));
            } else {
                localStorage.removeItem(SKELETON_DRAFT_KEY);
            }
        } catch (e) {
            console.error(e);
        }
    }

    function clearDraftFromLocalStorage() {
        localStorage.removeItem(SKELETON_DRAFT_KEY);
        localStorage.removeItem(SKELETON_DRAFT_NAME_KEY);
    }

    // =====================================================================
    // TILE DEFINITIONS
    // =====================================================================
    const TILES = [
        { type: 'activity', name: 'Activity', style: 'background:#e0f7fa;border:1px solid #007bff;' },
        { type: 'sports', name: 'Sports', style: 'background:#dcedc8;border:1px solid #689f38;' },
        { type: 'special', name: 'Special Activity', style: 'background:#e8f5e9;border:1px solid #43a047;' },
        { type: 'smart', name: 'Smart Tile', style: 'background:#e3f2fd;border:2px dashed #0288d1;color:#01579b;' },
        { type: 'split', name: 'Split Activity', style: 'background:#fff3e0;border:1px solid #f57c00;' },
        { type: 'league', name: 'League Game', style: 'background:#d1c4e9;border:1px solid #5e35b1;' },
        { type: 'specialty_league', name: 'Specialty League', style: 'background:#fff8e1;border:1px solid #f9a825;' },
        { type: 'swim', name: 'Swim', style: 'background:#bbdefb;border:1px solid #1976d2;' },
        { type: 'lunch', name: 'Lunch', style: 'background:#fbe9e7;border:1px solid #d84315;' },
        { type: 'snacks', name: 'Snacks', style: 'background:#fff9c4;border:1px solid #fbc02d;' },
        { type: 'dismissal', name: 'Dismissal', style: 'background:#f44336;color:white;border:1px solid #b71c1c;' },
        { type: 'custom', name: 'Custom Pinned Event', style: 'background:#eee;border:1px solid #616161;' }
    ];

    // =====================================================================
    // INIT
    // =====================================================================
    function init() {
        container = document.getElementById("master-scheduler-content");
        if (!container) return;

        loadDailySkeleton();

        const savedDraft = localStorage.getItem(SKELETON_DRAFT_KEY);
        if (savedDraft && confirm("Load unsaved master schedule draft?")) {
            dailySkeleton = JSON.parse(savedDraft);
        }

        container.innerHTML = `
            <div id="scheduler-template-ui"></div>
            <div id="scheduler-palette"></div>
            <div id="scheduler-grid-wrapper">
                <div id="scheduler-grid"></div>
            </div>
        `;

        palette = document.getElementById("scheduler-palette");
        grid = document.getElementById("scheduler-grid");

        renderTemplateUI();
        renderPalette();
        renderGrid();
    }

    // =====================================================================
    // TEMPLATE UI
    // =====================================================================
    function renderTemplateUI() {
        const ui = document.getElementById("scheduler-template-ui");
        const saved = window.getSavedSkeletons?.() || {};
        const names = Object.keys(saved).sort();
        const assignments = window.getSkeletonAssignments?.() || {};

        ui.innerHTML = `
            <label>Load Template:</label>
            <select id="template-load-select">
                <option value="">-- Select --</option>
                ${names.map(n => `<option value="${n}">${n}</option>`).join("")}
            </select>
        `;

        document.getElementById("template-load-select").onchange = function () {
            const name = this.value;
            if (name && saved[name]) {
                loadSkeletonToBuilder(name);
            }
        };
    }

    // =====================================================================
    // PALETTE
    // =====================================================================
    function renderPalette() {
        palette.innerHTML = "";
        TILES.forEach(tile => {
            const el = document.createElement("div");
            el.textContent = tile.name;
            el.className = "grid-tile";
            el.style = tile.style;
            el.draggable = true;
            el.ondragstart = e => {
                e.dataTransfer.setData("application/json", JSON.stringify(tile));
            };
            palette.appendChild(el);
        });
    }

    // =====================================================================
    // RENDER GRID
    // =====================================================================
    function renderGrid() {
        const divisions = window.divisions || {};
        const availableDivisions = window.availableDivisions || [];

        if (!availableDivisions.length) {
            grid.innerHTML = "<p>No divisions.</p>";
            return;
        }

        let earliest = Infinity, latest = -Infinity;

        Object.values(divisions).forEach(d => {
            const s = parseTimeToMinutes(d.startTime);
            const e = parseTimeToMinutes(d.endTime);
            if (s < earliest) earliest = s;
            if (e > latest) latest = e;
        });

        if (!isFinite(earliest)) earliest = 540;
        if (!isFinite(latest)) latest = 960;

        grid.innerHTML = "";

        const wrapper = document.createElement("div");
        wrapper.style.display = "grid";
        wrapper.style.gridTemplateColumns = `60px repeat(${availableDivisions.length},1fr)`;
        wrapper.style.position = "relative";

        // TIME COLUMN
        const timeCol = document.createElement("div");
        timeCol.style.gridRow = "1";
        timeCol.style.gridColumn = "1";
        timeCol.style.position = "relative";
        timeCol.style.height = ((latest - earliest) * PIXELS_PER_MINUTE) + "px";

        for (let m = earliest; m < latest; m += 30) {
            const t = document.createElement("div");
            t.style.position = "absolute";
            t.style.top = ((m - earliest) * PIXELS_PER_MINUTE) + "px";
            t.textContent = minutesToTime(m);
            timeCol.appendChild(t);
        }

        wrapper.appendChild(timeCol);

        // DIVISION COLUMNS
        availableDivisions.forEach((divName, col) => {
            const d = divisions[divName];
            const colEl = document.createElement("div");
            colEl.className = "grid-cell";
            colEl.dataset.div = divName;
            colEl.dataset.startMin = earliest;
            colEl.style.height = ((latest - earliest) * PIXELS_PER_MINUTE) + "px";
            colEl.style.position = "relative";

            const events = dailySkeleton.filter(ev => ev.division === divName);

            events.forEach(ev => {
                const s = parseTimeToMinutes(ev.startTime);
                const e = parseTimeToMinutes(ev.endTime);
                if (s == null || e == null || e <= s) return;

                const tile = document.createElement("div");
                tile.className = "grid-event";
                tile.dataset.id = ev.id;
                tile.style.position = "absolute";
                tile.style.top = ((s - earliest) * PIXELS_PER_MINUTE) + "px";
                tile.style.height = ((e - s) * PIXELS_PER_MINUTE) + "px";
                tile.style.width = "90%";
                tile.style.left = "5%";
                tile.style.background = "#d9eaff";

                tile.innerHTML = `<strong>${ev.event}</strong><br>${ev.startTime} - ${ev.endTime}`;

                colEl.appendChild(tile);
            });

            wrapper.appendChild(colEl);
        });

        grid.appendChild(wrapper);
    }

    // =====================================================================
    // LOAD DAILY TEMPLATE
    // =====================================================================
    function loadDailySkeleton() {
        const assignments = window.getSkeletonAssignments?.() || {};
        const skeletons = window.getSavedSkeletons?.() || {};
        const dateStr = window.currentScheduleDate || "";

        let dow = 0;
        if (dateStr.includes("-")) {
            const [y, m, d] = dateStr.split("-").map(Number);
            dow = new Date(y, m - 1, d).getDay();
        }

        const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

        const key = assignments[dayNames[dow]] || assignments["Default"];

        dailySkeleton = key && skeletons[key]
            ? JSON.parse(JSON.stringify(skeletons[key]))
            : [];
    }

    // =====================================================================
    // EXPOSE INIT
    // =====================================================================
    window.initMasterScheduler = init;

})();
