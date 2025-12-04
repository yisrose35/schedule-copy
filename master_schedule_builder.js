// ============================================================================
// master_schedule_builder.js
// Modern Pro Camp Edition — GOOGLE CALENDAR STYLE
// COMBINED VERSION
// ============================================================================

(function () {
    "use strict";

    // =========================================
    // GLOBAL UTILS (from scheduler_core_utils.js)
    // =========================================
    const parseTimeToMinutes = window.SchedulerCoreUtils?.parseTimeToMinutes;
    const minutesToTime = window.SchedulerCoreUtils?.minutesToTime;

    if (!parseTimeToMinutes) {
        console.error("❌ SchedulerCoreUtils missing. Builder cannot run.");
    }

    // =========================================
    // INTERNAL STATE
    // =========================================
    let container = null;
    let palette = null;
    let grid = null;

    let dailySkeleton = [];
    let copiedEvent = null; // Buffer for copy/paste operations

    // =========================================
    // CONSTANTS
    // =========================================
    const PIXELS_PER_MINUTE = 2;
    const SNAP_MINUTES = 15;
    const BLOCK_DEFAULT_MINS = 30;

    const LS_DRAFT_KEY = "MASTER_SCHEDULE_DRAFT_V2";
    const LS_DRAFT_NAME_KEY = "MASTER_SCHEDULE_DRAFT_NAME_V2";

    // =========================================
    // TILE DEFINITIONS
    // =========================================
    // Updated colors for distinct, professional contrast
    // Using a "Modern SaaS" palette: bold borders, distinct pastel backgrounds
    const TILES = [
        { type: "activity", name: "Activity", base: "#ffffff", border: "#64748b", text: "#334155" }, // Neutral White/Slate
        { type: "sports", name: "Sports", base: "#dcfce7", border: "#16a34a", text: "#14532d" }, // Distinct Green
        { type: "special", name: "Special Activity", base: "#f3e8ff", border: "#9333ea", text: "#581c87" }, // Purple
        { type: "smart", name: "Smart Tile", base: "#fffbeb", border: "#f59e0b", text: "#b45309", dash: true }, // Amber
        { type: "split", name: "Split Activity", base: "#ffedd5", border: "#ea580c", text: "#7c2d12" }, // Orange
        { type: "league", name: "League Game", base: "#e0f2fe", border: "#0284c7", text: "#0c4a6e" }, // Sky Blue
        { type: "specialty_league", name: "Specialty League", base: "#fae8ff", border: "#d946ef", text: "#701a75" }, // Fuchsia
        { type: "swim", name: "Swim", base: "#ecfeff", border: "#06b6d4", text: "#155e75" }, // Cyan
        { type: "lunch", name: "Lunch", base: "#fee2e2", border: "#ef4444", text: "#7f1d1d" }, // Red
        { type: "snacks", name: "Snacks", base: "#fef9c3", border: "#eab308", text: "#713f12" }, // Yellow
        { type: "dismissal", name: "Dismissal", base: "#1e293b", border: "#0f172a", text: "#ffffff" }, // Dark Slate (Inverted)
        { type: "custom", name: "Custom Event", base: "#f1f5f9", border: "#334155", text: "#0f172a" } // Grey
    ];

    // ============================================================================
    // INIT
    // ============================================================================
    function init() {
        container = document.getElementById("master-scheduler-content");
        if (!container) return;

        // Note: loadSkeletonForToday is assumed to be defined globally or in included scripts
        if (typeof loadSkeletonForToday === 'function') {
            loadSkeletonForToday();
        }

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
    // BUILD UI WRAPPER
    // ============================================================================
    function buildUI() {
        // Inject CSS Styles
        const style = `
            <style>
                /* ========================= */
                /* THEME INJECTION           */
                /* ========================= */
                .mb-app {
                    font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                    background: #f8fafc;
                    color: #1e293b;
                    padding: 20px;
                }

                /* Generic buttons adapted from theme */
                .mb-app button {
                    font-family: inherit;
                    font-size: 0.85rem;
                    border-radius: 999px;
                    border: 1px solid #cbd5e1;
                    padding: 6px 14px;
                    background: #ffffff;
                    color: #1e293b;
                    cursor: pointer;
                    transition: all 0.15s ease;
                    box-shadow: 0 1px 2px rgba(0,0,0,0.05);
                    font-weight: 500;
                }
                .mb-app button:hover {
                    background: #f1f5f9;
                    border-color: #94a3b8;
                    transform: translateY(-0.5px);
                }
                .mb-app button.mb-btn-primary { background: #2563eb; color: white; border-color: #2563eb; }
                .mb-app button.mb-btn-primary:hover { background: #1d4ed8; }
                .mb-app button.mb-btn-secondary { background: #f59e0b; color: white; border-color: #f59e0b; }
                .mb-app button.mb-btn-secondary:hover { background: #d97706; }
                .mb-app button.mb-btn-success { background: #10b981; color: white; border-color: #10b981; }
                .mb-app button.mb-btn-success:hover { background: #059669; }
                .mb-app button.mb-btn-danger { background: #ef4444; color: white; border-color: #ef4444; }
                .mb-app button.mb-btn-danger:hover { background: #dc2626; }

                /* Inputs adapted from theme */
                .mb-app input[type="text"],
                .mb-app select {
                    font-family: inherit;
                    font-size: 0.85rem;
                    padding: 6px 12px;
                    border-radius: 999px;
                    border: 1px solid #cbd5e1;
                    background: #ffffff;
                    color: #1e293b;
                    box-sizing: border-box;
                    outline: none;
                    transition: all 0.2s;
                }
                .mb-app input[type="text"]:focus,
                .mb-app select:focus {
                    border-color: #3b82f6;
                    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
                }

                /* Layout Containers (Cards) */
                .mb-toolbar, .mb-palette-area {
                    background: #ffffff;
                    border-radius: 16px;
                    border: 1px solid #e2e8f0;
                    padding: 1rem 1.25rem;
                    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03);
                    margin-bottom: 24px;
                }

                .mb-label {
                    display: block;
                    font-size: 0.75rem;
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                    color: #64748b;
                    margin-bottom: 6px;
                    font-weight: 700;
                }

                /* Palette Items */
                .mb-palette-area {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 12px;
                }
                .mb-tile-item {
                    padding: 8px 16px;
                    border-radius: 999px; /* Pill shape matches theme */
                    cursor: grab;
                    font-size: 0.85rem;
                    font-weight: 600;
                    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
                    transition: all 0.2s ease;
                    user-select: none;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    border-width: 1px;
                    border-style: solid;
                }
                .mb-tile-item:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
                }
                .mb-tile-item:active {
                    cursor: grabbing;
                }

                /* Grid Container */
                .mb-grid-container {
                    border: 1px solid #e2e8f0;
                    border-radius: 16px;
                    background: #ffffff;
                    box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.05);
                    overflow: hidden;
                }

                /* Scrollbar styling from theme */
                .mb-grid-container::-webkit-scrollbar {
                    height: 10px;
                    width: 10px;
                }
                .mb-grid-container::-webkit-scrollbar-track {
                    background: #f8fafc;
                }
                .mb-grid-container::-webkit-scrollbar-thumb {
                    background: #cbd5e1;
                    border-radius: 5px;
                }
                .mb-grid-container::-webkit-scrollbar-thumb:hover {
                    background: #94a3b8;
                }

                /* Event Card on Grid */
                .mb-event-card {
                    border-radius: 6px;
                    padding: 4px 8px;
                    font-size: 0.8rem;
                    line-height: 1.25;
                    box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06);
                    cursor: grab;
                    overflow: hidden;
                    transition: box-shadow 0.2s, transform 0.1s, z-index 0s;
                    z-index: 10;
                    font-family: inherit;
                    display: flex;
                    flex-direction: column;
                }
                .mb-event-card:hover {
                    box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
                    z-index: 50 !important; /* Ensure hovered item pops to very top */
                    transform: scale(1.02);
                }
                .mb-event-card > div {
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }
            </style>
        `;

        container.innerHTML = `
        ${style}
        <div class="mb-app">
            <div id="mb-template-bar" class="mb-toolbar"></div>
            <div id="mb-palette" class="mb-palette-area"></div>
            <div id="mb-grid-wrapper" style="overflow-x:auto;" class="mb-grid-container">
                <div id="mb-grid"></div>
            </div>
        </div>
    `;

        palette = document.getElementById("mb-palette");
        grid = document.getElementById("mb-grid");

        renderTemplateControls();
    }

    // ============================================================================
    // TEMPLATE UI (LOAD / SAVE / DELETE / ASSIGN)
    // ============================================================================
    function renderTemplateControls() {
        const bar = document.getElementById("mb-template-bar");
        const saved = window.getSavedSkeletons?.() || {};
        const assignments = window.getSkeletonAssignments?.() || {};
        const names = Object.keys(saved).sort();

        const opts = names.map(n => `<option value="${n}">${n}</option>`).join("");

        bar.innerHTML = `
        <div style="display:flex;gap:20px;flex-wrap:wrap;align-items:flex-end;">
            <div style="flex:1; min-width: 200px;">
                <label class="mb-label">Load Template</label>
                <div style="display:flex; gap:8px;">
                    <select id="mb-load-select">
                        <option value="">-- Select --</option>
                        ${opts}
                    </select>
                </div>
            </div>

            <div style="flex:1; min-width: 200px;">
                <label class="mb-label">Save As</label>
                <div style="display:flex; gap:8px;">
                    <input id="mb-save-name" type="text" placeholder="New Template Name">
                </div>
            </div>

            <div style="display:flex; gap:8px;">
                <button id="mb-save-btn" class="mb-btn-primary">Save Template</button>
                <button id="mb-new-btn" class="mb-btn-secondary">New Sheet</button>
            </div>
        </div>

        <details style="margin-top:20px; border-top: 1px solid #f1f5f9; padding-top: 15px;">
            <summary style="cursor:pointer;color:#2563eb;font-weight:600;font-size:0.9rem;">Advanced: Assignments & Delete</summary>

            <div style="padding:15px;background:#f8fafc;border-radius:12px;margin-top:15px;border:1px solid #e2e8f0;">
                <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap:15px;">
                    ${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Default"]
                .map(day => `
                            <div>
                                <label class="mb-label">${day}</label>
                                <select data-day="${day}" style="width:100%">
                                    <option value="">-- None --</option>
                                    ${opts}
                                </select>
                            </div>
                        `).join("")}
                </div>

                <div style="margin-top:20px; display:flex; justify-content:space-between; align-items:center;">
                    <button id="mb-assign-save" class="mb-btn-success">
                        Save Assignments
                    </button>
                    
                    <button id="mb-delete-btn" class="mb-btn-danger">
                        Delete Loaded Template
                    </button>
                </div>
            </div>
        </details>
    `;

        // ----------- BINDINGS -----------------
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
            if (confirm("Clear entire grid and start new?")) {
                dailySkeleton = [];
                localStorage.removeItem(LS_DRAFT_KEY);
                renderGrid();
            }
        };

        // assignment
        bar.querySelectorAll("select[data-day]").forEach(sel => {
            sel.value = assignments[sel.dataset.day] || "";
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
    // RENDER PALETTE
    // ============================================================================
    function renderPalette() {
        palette.innerHTML = "";

        TILES.forEach(tile => {
            const el = document.createElement("div");
            el.className = "mb-tile-item"; // New class
            el.textContent = tile.name;

            // Updated to strictly match the tile definition
            el.style.backgroundColor = tile.base;
            el.style.borderColor = tile.border;
            el.style.color = tile.text || "#333";
            if (tile.dash) el.style.borderStyle = "dashed";
            // Ensure border width is correct for palette items too
            el.style.borderWidth = "2px"; // Bold borders for professional look

            el.draggable = true;
            el.ondragstart = e =>
                e.dataTransfer.setData("application/json", JSON.stringify(tile));

            palette.appendChild(el);
        });
    }

    // ============================================================================
    // RENDER GRID (GOOGLE CALENDAR STYLE)
    // ============================================================================
    function renderGrid() {
        const divisions = window.divisions || {};
        const available = window.availableDivisions || [];

        if (!available.length) {
            grid.innerHTML = `
            <div style="padding:40px;text-align:center;color:#94a3b8;font-style:italic;">
                No divisions found. Please set them up first.
            </div>`;
            return;
        }

        // -----------------------------
        // Determine timeline boundaries
        // -----------------------------
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

        if (earliest == null) earliest = 540;
        if (latest == null) latest = 1020;

        // Stretch if pinned blocks overflow
        const pinnedMax = Math.max(
            ...dailySkeleton.map(ev => parseTimeToMinutes(ev.endTime) || -Infinity)
        );
        if (pinnedMax > latest) latest = pinnedMax;

        if (latest <= earliest) latest = earliest + 60;

        const totalHeight = (latest - earliest) * PIXELS_PER_MINUTE;

        // ---------------------------------------
        // Build main grid structure (Google style)
        // ---------------------------------------
        let html = `
    <div style="
        display:grid;
        grid-template-columns:60px repeat(${available.length}, 1fr);
        min-width:1000px;
        position:relative;
        background: #fff;
    ">
    `;

        // ------------- HEADER -------------
        html += `
        <div style="
            grid-row:1;
            background:#f8fafc;
            padding:12px;
            border-bottom:1px solid #e2e8f0;
            font-weight:600;
            color: #64748b;
            font-size: 0.8rem;
            position:sticky;
            top:0;
            z-index:30;
            text-align: right;
            border-right: 1px solid #e2e8f0;
        ">Time</div>
    `;

        available.forEach((divName, idx) => {
            const color = divisions[divName]?.color || "#3b82f6";
            html += `
        <div style="
            grid-row:1;
            grid-column:${idx + 2};
            background:#f8fafc;
            border-top: 4px solid ${color}; /* Thicker top border for clear division coding */
            color:#334155;
            padding:12px;
            border-bottom:1px solid #e2e8f0;
            border-right: 1px solid #f1f5f9;
            font-weight:700;
            text-align:center;
            position:sticky;
            top:0;
            z-index:30;
            font-size: 0.9rem;
            letter-spacing: 0.02em;
        ">
            ${divName}
        </div>`;
        });

        // -----------------------------------
        // TIME COLUMN (Google calendar style)
        // -----------------------------------
        html += `
        <div style="
            grid-row:2;
            grid-column:1;
            position:relative;
            height:${totalHeight}px;
            background:#ffffff;
            border-right:1px solid #e2e8f0;
        ">
    `;

        for (let m = earliest; m < latest; m += SNAP_MINUTES) {
            const top = (m - earliest) * PIXELS_PER_MINUTE;
            // Only show time label on hours or 30 mins to reduce clutter
            const isHour = m % 60 === 0;
            const isHalf = m % 30 === 0;
            const label = isHalf ? minutesToTime(m) : "";
            const borderColor = isHour ? "#e2e8f0" : "#f8fafc"; // Subtle differentiation

            html += `
            <div style="
                position:absolute;
                top:${top}px;
                width:100%;
                border-top:1px solid ${borderColor};
                font-size:10px;
                color:#94a3b8;
                padding-right:8px;
                text-align:right;
                transform: translateY(-50%);
                font-weight: ${isHour ? "600" : "400"};
            ">
                ${label}
            </div>
        `;
        }

        html += `</div>`;

        // ========================================================================
        // DIVISION COLUMNS
        // ========================================================================
        available.forEach((divName, idx) => {
            const s = parseTimeToMinutes(divisions[divName]?.startTime);
            const e = parseTimeToMinutes(divisions[divName]?.endTime);

            html += `
        <div class="mb-grid-col"
             data-div="${divName}"
             data-start-min="${earliest}"
             style="
                grid-row:2;
                grid-column:${idx + 2};
                position:relative;
                height:${totalHeight}px;
                border-right:1px solid #f1f5f9;
                background:white;
             ">
        `;

            // Render grid lines inside columns too
            for (let m = earliest; m < latest; m += SNAP_MINUTES) {
                const top = (m - earliest) * PIXELS_PER_MINUTE;
                const isHour = m % 60 === 0;
                const borderColor = isHour ? "#e2e8f0" : "#f8fafc";
                html += `
                    <div style="position:absolute;top:${top}px;width:100%;border-top:1px solid ${borderColor};pointer-events:none;"></div>
                `;
            }


            // Grey out BEFORE start time
            if (s > earliest) {
                const h = (s - earliest) * PIXELS_PER_MINUTE;
                html += `
                <div style="
                    position:absolute;
                    top:0;
                    left:0;
                    width:100%;
                    height:${h}px;
                    background: repeating-linear-gradient(
                        45deg,
                        #f8fafc,
                        #f8fafc 10px,
                        #f1f5f9 10px,
                        #f1f5f9 20px
                    );
                    pointer-events:none;
                    opacity: 0.8;
                "></div>
            `;
            }

            // Grey out AFTER end time
            if (e < latest) {
                const top = (e - earliest) * PIXELS_PER_MINUTE;
                const h = (latest - e) * PIXELS_PER_MINUTE;

                html += `
                <div style="
                    position:absolute;
                    top:${top}px;
                    left:0;
                    width:100%;
                    height:${h}px;
                    background: repeating-linear-gradient(
                        45deg,
                        #f8fafc,
                        #f8fafc 10px,
                        #f1f5f9 10px,
                        #f1f5f9 20px
                    );
                    pointer-events:none;
                    opacity: 0.8;
                "></div>
            `;
            }

            // -----------------------------------------------------
            // EVENT BLOCKS (Render all events for this division)
            // -----------------------------------------------------
            // "Cluster-based Layout Algorithm"
            // This groups events that touch each other and layouts them in columns
            // just for that group, ensuring max width for non-overlapping events.
            
            const divEvents = dailySkeleton
                .filter(ev => ev.division === divName)
                .map(ev => ({
                    original: ev,
                    startM: parseTimeToMinutes(ev.startTime),
                    endM: parseTimeToMinutes(ev.endTime)
                }))
                .filter(ev => ev.startM != null && ev.endM != null && ev.endM > ev.startM)
                .sort((a, b) => a.startM - b.startM);

            if (divEvents.length > 0) {
                // Step 1: Group intersecting events into clusters
                const clusters = [];
                let currentCluster = [divEvents[0]];
                let clusterEnd = divEvents[0].endM;

                for (let i = 1; i < divEvents.length; i++) {
                    const ev = divEvents[i];
                    if (ev.startM < clusterEnd) {
                        // Overlaps with current cluster
                        currentCluster.push(ev);
                        if (ev.endM > clusterEnd) clusterEnd = ev.endM;
                    } else {
                        // New cluster
                        clusters.push(currentCluster);
                        currentCluster = [ev];
                        clusterEnd = ev.endM;
                    }
                }
                clusters.push(currentCluster);

                // Step 2: Layout each cluster
                clusters.forEach(cluster => {
                    const columns = [];
                    cluster.forEach(ev => {
                        let placed = false;
                        for (let i = 0; i < columns.length; i++) {
                            const col = columns[i];
                            const lastEv = col[col.length - 1];
                            // Check overlap in this column
                            if (ev.startM >= lastEv.endM) {
                                col.push(ev);
                                ev.colIndex = i;
                                placed = true;
                                break;
                            }
                        }
                        if (!placed) {
                            columns.push([ev]);
                            ev.colIndex = columns.length - 1;
                        }
                    });

                    // Render events in this cluster
                    const totalCols = columns.length;
                    const colWidth = 100 / totalCols;

                    cluster.forEach(ev => {
                        const top = (ev.startM - earliest) * PIXELS_PER_MINUTE;
                        const h = (ev.endM - ev.startM) * PIXELS_PER_MINUTE;
                        const left = ev.colIndex * colWidth;
                        const width = colWidth - 1; // 1% gap for visual separation

                        html += renderEventTile(ev.original, top, h, left, width);
                    });
                });
            }

            html += `</div>`;
        });

        html += `</div>`;

        grid.innerHTML = html;

        // bind interactions
        bindDropEvents();
        bindMoveEvents();
        bindDeleteEvents();
        bindCopyPaste();
    }

    // ============================================================================
    // EVENT TILE RENDERER (Google Calendar-round style)
    // ============================================================================
    function renderEventTile(ev, top, height, leftPct, widthPct) {
        const tile = TILES.find(t => t.name === ev.event) ||
            TILES.find(t => t.type === ev.type);

        // Fallback colors - use cleaner neutrals if tile type not found
        const base = tile?.base || "#ffffff";
        const border = tile?.border || "#cbd5e1";
        const text = tile?.text || "#334155";
        const borderStyle = tile?.dash ? "dashed" : "solid";
        
        // Ensure border width is prominently visible for the pastel colors
        const borderWidth = "2px"; 

        return `
        <div class="mb-event-card"
             data-id="${ev.id}"
             draggable="true"
             style="
                position:absolute;
                top:${top}px;
                left:${leftPct}%;
                width:${widthPct}%;
                height:${height}px;
                background-color: ${base};
                border: ${borderWidth} ${borderStyle} ${border};
                color: ${text};
                z-index: 10;
             ">
            <div style="font-weight:700; margin-bottom:2px; font-size: 0.85rem;">${ev.event}</div>
            <div style="font-size:0.75rem; opacity:0.9;">${ev.startTime} – ${ev.endTime}</div>
        </div>
    `;
    }

    // ============================================================================
    // DRAG-TO-MOVE EVENTS
    // ============================================================================
    function bindMoveEvents() {
        grid.querySelectorAll(".mb-event-card").forEach(evEl => {
            evEl.ondragstart = (e) => {
                const id = evEl.dataset.id;
                const ev = dailySkeleton.find(x => x.id === id);
                if (!ev) return;

                e.dataTransfer.setData("text/plain", JSON.stringify({
                    mode: "move",
                    event: ev
                }));
            };
        });
    }

    // ============================================================================
    // COPY / PASTE SUPPORT
    // ============================================================================
    function bindCopyPaste() {
        grid.querySelectorAll(".mb-event-card").forEach(evEl => {
            // COPY (CTRL + C)
            evEl.onkeydown = (e) => {
                if (e.ctrlKey && e.key === "c") {
                    const id = evEl.dataset.id;
                    copiedEvent = dailySkeleton.find(x => x.id === id);
                    console.log("Copied event:", copiedEvent);
                    e.preventDefault();
                }
            };

            // DELETE with DEL key
            evEl.onkeydown = (e) => {
                if (e.key === "Delete") {
                    const id = evEl.dataset.id;
                    dailySkeleton = dailySkeleton.filter(x => x.id !== id);
                    localStorage.setItem(LS_DRAFT_KEY, JSON.stringify(dailySkeleton));
                    renderGrid();
                    e.preventDefault();
                }
            };
        });

        // GLOBAL PASTE
        grid.onpaste = (e) => {
            if (!copiedEvent) return;

            const active = document.activeElement;
            if (!active.classList.contains("mb-grid-col")) return;

            const divName = active.dataset.div;
            const earliest = parseInt(active.dataset.startMin);

            // find mouse position
            const rect = active.getBoundingClientRect();
            // Note: Paste events don't easily give mouse coordinates in all browsers.
            // We use a safe fallback or the last known interaction if available.
            // For this implementation, we default to the top if not precise, 
            // but the original logic tried to calculate it.
            const targetTop = 0; // Fallback since e.clientY is often not available in paste events
            // Ideally, the user clicks to focus (setting activeElement) then pastes.
            
            // To make this robust, we usually need to track mouse position globally or paste at a default time.
            // We will paste at the start of the view (earliest) + offset if possible, 
            // or just append. Here we stick to the original logic logic flow.
            
            const newStart = earliest; // Simplified for robustness
            const duration = parseTimeToMinutes(copiedEvent.endTime) - parseTimeToMinutes(copiedEvent.startTime);
            const newEnd = newStart + duration;

            const newEvent = JSON.parse(JSON.stringify(copiedEvent));
            newEvent.id = String(Date.now());
            newEvent.division = divName;
            newEvent.startTime = minutesToTime(newStart);
            newEvent.endTime = minutesToTime(newEnd);

            dailySkeleton.push(newEvent);
            localStorage.setItem(LS_DRAFT_KEY, JSON.stringify(dailySkeleton));
            renderGrid();

            console.log("Pasted:", newEvent);
            e.preventDefault();
        };
    }

    // ============================================================================
    // DROP HANDLING (MOVE + NEW TILE DROP)
    // ============================================================================
    function bindDropEvents() {
        grid.querySelectorAll(".mb-grid-col").forEach(col => {
            col.ondragover = e => {
                e.preventDefault();
                col.style.background = "#eff6ff"; // Light blue drag highlight
            };

            col.ondragleave = () => {
                col.style.background = "";
            };

            col.ondrop = e => {
                e.preventDefault();
                col.style.background = "";

                const payloadText = e.dataTransfer.getData("application/json") ||
                    e.dataTransfer.getData("text/plain");
                if (!payloadText) return;

                const payload = JSON.parse(payloadText);
                const mode = payload.mode || "new";

                const divName = col.dataset.div;
                const earliest = parseInt(col.dataset.startMin);

                const rect = col.getBoundingClientRect();
                const offsetY = e.clientY - rect.top;

                const minuteOffset =
                    Math.round((offsetY / PIXELS_PER_MINUTE) / SNAP_MINUTES) * SNAP_MINUTES;

                const newStart = earliest + minuteOffset;
                const newEnd = newStart + BLOCK_DEFAULT_MINS;

                const startStr = minutesToTime(newStart);
                const endStr = minutesToTime(newEnd);

                // ---------------------------------------------------------
                // MOVE EXISTING EVENT
                // ---------------------------------------------------------
                if (mode === "move") {
                    const old = payload.event;

                    const duration = parseTimeToMinutes(old.endTime) - parseTimeToMinutes(old.startTime);

                    const moved = {
                        ...old,
                        id: old.id, // keep identity
                        division: divName,
                        startTime: startStr,
                        endTime: minutesToTime(newStart + duration)
                    };

                    // remove original
                    dailySkeleton = dailySkeleton.filter(ev => ev.id !== old.id);
                    // add moved
                    dailySkeleton.push(moved);

                    localStorage.setItem(LS_DRAFT_KEY, JSON.stringify(dailySkeleton));
                    renderGrid();
                    return;
                }

                // ---------------------------------------------------------
                // NEW TILE DROPS (from palette)
                // ---------------------------------------------------------
                const tile = payload;

                let finalEvent = null;

                // SMART TILE
                if (tile.type === "smart") {
                    let st = prompt("Start Time:", startStr);
                    if (!st) return;
                    let et = prompt("End Time:", endStr);
                    if (!et) return;

                    const mains = prompt("Two main activities (ex: Swim / Art):");
                    if (!mains) return;

                    const [m1, m2] = mains.split(/[\/,]/).map(s => s.trim());
                    if (!m2) {
                        alert("Two activities required.");
                        return;
                    }

                    const fb = prompt(`Which needs fallback?\n1 = ${m1}\n2 = ${m2}`);
                    const fallbackFor = fb === "1" ? m1 : m2;
                    const fallbackAct = prompt(`Fallback for ${fallbackFor}?`, "Sports");

                    finalEvent = {
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
                            fallbackActivity: fallbackAct
                        }
                    };
                }

                // SPLIT TILE
                else if (tile.type === "split") {
                    let st = prompt("Start Time:", startStr);
                    if (!st) return;
                    let et = prompt("End Time:", endStr);
                    if (!et) return;

                    let a1 = prompt("First Activity:");
                    if (!a1) return;
                    let a2 = prompt("Second Activity:");
                    if (!a2) return;

                    finalEvent = {
                        id: String(Date.now()),
                        type: "split",
                        event: `${a1} / ${a2}`,
                        division: divName,
                        startTime: st,
                        endTime: et,
                        subEvents: [
                            { event: a1 },
                            { event: a2 }
                        ]
                    };
                }

                // STANDARD BLOCK
                else {
                    let name = tile.name;
                    if (tile.type === "custom") {
                        name = prompt("Event Name:", "Custom Event");
                        if (!name) return;
                    }
                    if (tile.type === "league") name = "League Game";
                    if (tile.type === "specialty_league") name = "Specialty League";

                    let st = prompt(`${name} Start:`, startStr);
                    if (!st) return;
                    let et = prompt(`${name} End:`, endStr);
                    if (!et) return;

                    finalEvent = {
                        id: String(Date.now()),
                        type: tile.type,
                        event: name,
                        division: divName,
                        startTime: st,
                        endTime: et
                    };
                }

                // ADD NEW EVENT
                if (finalEvent) {
                    dailySkeleton.push(finalEvent);
                    localStorage.setItem(LS_DRAFT_KEY, JSON.stringify(dailySkeleton));
                    renderGrid();
                }
            };
        });
    }

    // ============================================================================
    // DELETE EVENTS (click)
    // ============================================================================
    function bindDeleteEvents() {
        grid.querySelectorAll(".mb-event-card").forEach(evEl => {
            evEl.onclick = (e) => {
                if (e.shiftKey) { // Shift-Click = delete
                    const id = evEl.dataset.id;
                    dailySkeleton = dailySkeleton.filter(x => x.id !== id);
                    localStorage.setItem(LS_DRAFT_KEY, JSON.stringify(dailySkeleton));
                    renderGrid();
                }
            };
        });
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

    window.initMasterScheduler = init;
    window.MasterBuilder_loadSkeleton = MasterBuilder_loadSkeleton;
    window.MasterBuilder_getSkeleton = MasterBuilder_getSkeleton;

})();
