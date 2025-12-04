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
    // Updated colors for a more professional pastel palette
    const TILES = [
        { type: "activity", name: "Activity", base: "#e3f2fd", border: "#1565c0", text: "#0d47a1" },
        { type: "sports", name: "Sports", base: "#e8f5e9", border: "#2e7d32", text: "#1b5e20" },
        { type: "special", name: "Special Activity", base: "#f3e5f5", border: "#7b1fa2", text: "#4a148c" },
        { type: "smart", name: "Smart Tile", base: "#fff8e1", border: "#fbc02d", text: "#f57f17", dash: true },
        { type: "split", name: "Split Activity", base: "#fff3e0", border: "#ef6c00", text: "#e65100" },
        { type: "league", name: "League Game", base: "#ede7f6", border: "#512da8", text: "#311b92" },
        { type: "specialty_league", name: "Specialty League", base: "#fce4ec", border: "#c2185b", text: "#880e4f" },
        { type: "swim", name: "Swim", base: "#e0f7fa", border: "#0097a7", text: "#006064" },
        { type: "lunch", name: "Lunch", base: "#ffebee", border: "#d32f2f", text: "#b71c1c" },
        { type: "snacks", name: "Snacks", base: "#fffde7", border: "#fbc02d", text: "#f57f17" },
        { type: "dismissal", name: "Dismissal", base: "#ffebee", border: "#b71c1c", text: "#b71c1c" },
        { type: "custom", name: "Custom Event", base: "#f5f5f5", border: "#616161", text: "#212121" }
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
                .mb-app {
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                    color: #333;
                    max-width: 100%;
                }
                .mb-toolbar {
                    background: #ffffff;
                    padding: 20px;
                    border: 1px solid #e5e7eb;
                    border-radius: 12px;
                    margin-bottom: 24px;
                    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03);
                }
                .mb-label {
                    display: block;
                    font-size: 0.75rem;
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                    color: #6b7280;
                    margin-bottom: 6px;
                    font-weight: 600;
                }
                .mb-select, .mb-input {
                    padding: 8px 12px;
                    border: 1px solid #d1d5db;
                    border-radius: 6px;
                    font-size: 0.9rem;
                    width: 100%;
                    box-sizing: border-box;
                    transition: all 0.2s;
                    background-color: #f9fafb;
                }
                .mb-select:focus, .mb-input:focus {
                    outline: none;
                    border-color: #3b82f6;
                    background-color: #fff;
                    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
                }
                .mb-btn {
                    padding: 8px 16px;
                    border: none;
                    border-radius: 6px;
                    font-size: 0.9rem;
                    font-weight: 500;
                    cursor: pointer;
                    transition: transform 0.1s, box-shadow 0.1s;
                    box-shadow: 0 1px 2px rgba(0,0,0,0.1);
                }
                .mb-btn:hover {
                    transform: translateY(-1px);
                    box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);
                }
                .mb-btn:active {
                    transform: translateY(0);
                }
                .mb-btn-primary { background: #2563eb; color: white; }
                .mb-btn-secondary { background: #f59e0b; color: white; }
                .mb-btn-success { background: #10b981; color: white; }
                .mb-btn-danger { background: #ef4444; color: white; }

                .mb-palette-area {
                    background: #ffffff;
                    padding: 16px;
                    border-radius: 12px;
                    border: 1px solid #e5e7eb;
                    display: flex;
                    flex-wrap: wrap;
                    gap: 12px;
                    margin-bottom: 24px;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.1);
                }
                
                .mb-tile-item {
                    padding: 10px 16px;
                    border-radius: 8px;
                    cursor: grab;
                    font-size: 0.85rem;
                    font-weight: 600;
                    box-shadow: 0 1px 2px rgba(0,0,0,0.05);
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
                    box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);
                }
                .mb-tile-item:active {
                    cursor: grabbing;
                }

                .mb-grid-container {
                    border: 1px solid #e5e7eb;
                    border-radius: 12px;
                    background: #ffffff;
                    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
                    overflow: hidden; /* Contains the scrollbar nicer */
                }
                
                .mb-event-card {
                    border-radius: 6px;
                    padding: 6px 8px;
                    font-size: 0.8rem;
                    line-height: 1.2;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.05);
                    cursor: grab;
                    overflow: hidden;
                    transition: box-shadow 0.2s, transform 0.1s;
                    z-index: 10;
                    border-width: 1px;
                    border-style: solid;
                }
                .mb-event-card:hover {
                    box-shadow: 0 8px 16px -4px rgba(0,0,0,0.15);
                    z-index: 20;
                    transform: scale(1.01);
                }
                
                /* Scrollbar styling */
                #mb-grid-wrapper::-webkit-scrollbar {
                    height: 10px;
                    width: 10px;
                }
                #mb-grid-wrapper::-webkit-scrollbar-track {
                    background: #f1f1f1;
                }
                #mb-grid-wrapper::-webkit-scrollbar-thumb {
                    background: #c1c1c1;
                    border-radius: 5px;
                }
                #mb-grid-wrapper::-webkit-scrollbar-thumb:hover {
                    background: #a8a8a8;
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
                    <select id="mb-load-select" class="mb-select">
                        <option value="">-- Select --</option>
                        ${opts}
                    </select>
                </div>
            </div>

            <div style="flex:1; min-width: 200px;">
                <label class="mb-label">Save As</label>
                <div style="display:flex; gap:8px;">
                    <input id="mb-save-name" type="text" placeholder="New Template Name" class="mb-input">
                </div>
            </div>

            <div style="display:flex; gap:8px;">
                <button id="mb-save-btn" class="mb-btn mb-btn-primary">Save Template</button>
                <button id="mb-new-btn" class="mb-btn mb-btn-secondary">New Sheet</button>
            </div>
        </div>

        <details style="margin-top:20px; border-top: 1px solid #f3f4f6; padding-top: 15px;">
            <summary style="cursor:pointer;color:#2563eb;font-weight:600;font-size:0.9rem;">Advanced: Assignments & Delete</summary>

            <div style="padding:15px;background:#f9fafb;border-radius:8px;margin-top:15px;border:1px solid #e5e7eb;">
                <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap:15px;">
                    ${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Default"]
                .map(day => `
                            <div>
                                <label class="mb-label">${day}</label>
                                <select data-day="${day}" class="mb-select" style="padding:4px 8px; font-size:0.8rem;">
                                    <option value="">-- None --</option>
                                    ${opts}
                                </select>
                            </div>
                        `).join("")}
                </div>

                <div style="margin-top:20px; display:flex; justify-content:space-between; align-items:center;">
                    <button id="mb-assign-save" class="mb-btn mb-btn-success">
                        Save Assignments
                    </button>
                    
                    <button id="mb-delete-btn" class="mb-btn mb-btn-danger">
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
            <div style="padding:40px;text-align:center;color:#9ca3af;font-style:italic;">
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
            background:#f9fafb;
            padding:12px;
            border-bottom:1px solid #e5e7eb;
            font-weight:600;
            color: #4b5563;
            font-size: 0.8rem;
            position:sticky;
            top:0;
            z-index:30;
            text-align: right;
            border-right: 1px solid #e5e7eb;
        ">Time</div>
    `;

        available.forEach((divName, idx) => {
            const color = divisions[divName]?.color || "#3b82f6";
            html += `
        <div style="
            grid-row:1;
            grid-column:${idx + 2};
            background:#f9fafb;
            border-top: 3px solid ${color};
            color:#1f2937;
            padding:12px;
            border-bottom:1px solid #e5e7eb;
            border-right: 1px solid #f3f4f6;
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
            border-right:1px solid #e5e7eb;
        ">
    `;

        for (let m = earliest; m < latest; m += SNAP_MINUTES) {
            const top = (m - earliest) * PIXELS_PER_MINUTE;
            // Only show time label on hours or 30 mins to reduce clutter
            const isHour = m % 60 === 0;
            const isHalf = m % 30 === 0;
            const label = isHalf ? minutesToTime(m) : "";
            const borderColor = isHour ? "#e5e7eb" : "#f3f4f6";

            html += `
            <div style="
                position:absolute;
                top:${top}px;
                width:100%;
                border-top:1px solid ${borderColor};
                font-size:10px;
                color:#9ca3af;
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
                border-right:1px solid #f3f4f6;
                background:white;
             ">
        `;

            // Render grid lines inside columns too
            for (let m = earliest; m < latest; m += SNAP_MINUTES) {
                const top = (m - earliest) * PIXELS_PER_MINUTE;
                const isHour = m % 60 === 0;
                const borderColor = isHour ? "#e5e7eb" : "#f9fafb";
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
                        #f9fafb,
                        #f9fafb 10px,
                        #f3f4f6 10px,
                        #f3f4f6 20px
                    );
                    pointer-events:none;
                    opacity: 0.6;
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
                        #f9fafb,
                        #f9fafb 10px,
                        #f3f4f6 10px,
                        #f3f4f6 20px
                    );
                    pointer-events:none;
                    opacity: 0.6;
                "></div>
            `;
            }

            // -----------------------------------------------------
            // EVENT BLOCKS (Render all events for this division)
            // -----------------------------------------------------
            dailySkeleton
                .filter(ev => ev.division === divName)
                .forEach(ev => {
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

        // bind interactions
        bindDropEvents();
        bindMoveEvents();
        bindDeleteEvents();
        bindCopyPaste();
    }

    // ============================================================================
    // EVENT TILE RENDERER (Google Calendar-round style)
    // ============================================================================
    function renderEventTile(ev, top, height) {
        const tile = TILES.find(t => t.name === ev.event) ||
            TILES.find(t => t.type === ev.type);

        // Fallback colors
        const base = tile?.base || "#f3f4f6";
        const border = tile?.border || "#9ca3af";
        const text = tile?.text || "#1f2937";
        const borderStyle = tile?.dash ? "dashed" : "solid";

        return `
        <div class="mb-event-card"
             data-id="${ev.id}"
             draggable="true"
             style="
                position:absolute;
                top:${top}px;
                left:2%;
                width:96%;
                height:${height}px;
                background-color: ${base};
                border-color: ${border};
                border-style: ${borderStyle};
                color: ${text};
             ">
            <div style="font-weight:700; margin-bottom:2px;">${ev.event}</div>
            <div style="font-size:0.75rem; opacity:0.85;">${ev.startTime} – ${ev.endTime}</div>
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
