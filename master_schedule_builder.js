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
    const TILES = [
        { type: "activity", name: "Activity", base: "#e0f7fa", border: "#007bff" },
        { type: "sports", name: "Sports", base: "#dcedc8", border: "#689f38" },
        { type: "special", name: "Special Activity", base: "#e8f5e9", border: "#43a047" },
        { type: "smart", name: "Smart Tile", base: "#e3f2fd", border: "#0288d1", dash: true },
        { type: "split", name: "Split Activity", base: "#fff3e0", border: "#f57c00" },
        { type: "league", name: "League Game", base: "#d1c4e9", border: "#5e35b1" },
        { type: "specialty_league", name: "Specialty League", base: "#fff8e1", border: "#f9a825" },
        { type: "swim", name: "Swim", base: "#bbdefb", border: "#1976d2" },
        { type: "lunch", name: "Lunch", base: "#fbe9e7", border: "#d84315" },
        { type: "snacks", name: "Snacks", base: "#fff9c4", border: "#fbc02d" },
        { type: "dismissal", name: "Dismissal", base: "#f44336", border: "#b71c1c", text: "#fff" },
        { type: "custom", name: "Custom Event", base: "#eee", border: "#616161" }
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
        container.innerHTML = `
        <div id="mb-template-bar" style="padding:15px;background:#f7f9fa;
            border:1px solid #d0d0d0;border-radius:8px;margin-bottom:20px;"></div>

        <div id="mb-palette"
            style="padding:10px;background:white;border-radius:8px;
            border:1px solid #d9d9d9;display:flex;flex-wrap:wrap;
            gap:10px;margin-bottom:18px;box-shadow:0 1px 2px rgba(0,0,0,0.1);">
        </div>

        <div id="mb-grid-wrapper"
            style="overflow-x:auto;border:1px solid #bfc4c9;border-radius:8px;
            background:white;box-shadow:0 1px 3px rgba(0,0,0,0.12);">
            <div id="mb-grid"></div>
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

            <div>
                <label>Load Template</label>

                <select id="mb-load-select" style="padding:6px;min-width:180px">
                    <option value="">-- Select --</option>
                    ${opts}
                </select>
            </div>

            <div>
                <label>Save As</label>

                <input id="mb-save-name" type="text" placeholder="Template Name"
                    style="padding:6px;min-width:180px">
            </div>

            <div>
                <button id="mb-save-btn"
                    style="background:#007bff;color:white;padding:6px 12px;border-radius:6px;">
                    Save
                </button>

                <button id="mb-new-btn"
                    style="background:#ff9800;color:white;padding:6px 12px;border-radius:6px;margin-left:6px;">
                    New
                </button>
            </div>
        </div>

        <details style="margin-top:10px;">
            <summary style="cursor:pointer;color:#007bff;font-weight:600;">Assignments & Delete</summary>

            <div style="padding:10px;border:1px solid #dcdcdc;border-radius:6px;margin-top:10px;">

                <div style="display:flex;flex-wrap:wrap;gap:15px;">
                    ${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Default"]
                .map(day => `
                            <div>
                                <label>${day}</label>

                                <select data-day="${day}" style="padding:5px;min-width:140px;">
                                    <option value="">-- None --</option>
                                    ${opts}
                                </select>
                            </div>
                        `).join("")}
                </div>

                <button id="mb-assign-save"
                    style="margin-top:10px;background:#28a745;color:white;padding:6px 12px;border-radius:6px;">
                    Save Assignments
                </button>

                <hr style="margin:15px 0">

                <button id="mb-delete-btn"
                    style="background:#c0392b;color:white;padding:6px 12px;border-radius:6px;">
                    Delete Selected Template
                </button>
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
            el.className = "mb-tile";
            el.textContent = tile.name;

            el.style.cssText = `
            background:${tile.base};
            border:1px solid ${tile.border};
            padding:8px 12px;
            border-radius:6px;
            cursor:grab;
            font-size:0.9rem;
            ${tile.dash ? "border-style:dashed;" : ""}
        `;

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
            <div style="padding:20px;text-align:center;color:#666;">
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
    ">
    `;

        // ------------- HEADER -------------
        html += `
        <div style="
            grid-row:1;
            background:white;
            padding:10px;
            border-bottom:1px solid #ccc;
            font-weight:600;
            position:sticky;
            top:0;
            z-index:20;
        ">Time</div>
    `;

        available.forEach((divName, idx) => {
            const color = divisions[divName]?.color || "#5078d5";
            html += `
        <div style="
            grid-row:1;
            grid-column:${idx + 2};
            background:${color};
            color:white;
            padding:10px;
            border-bottom:1px solid #ccc;
            font-weight:600;
            text-align:center;
            position:sticky;
            top:0;
            z-index:20;
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
            background:#fafafa;
            border-right:1px solid #ddd;
        ">
    `;

        for (let m = earliest; m < latest; m += SNAP_MINUTES) {
            const top = (m - earliest) * PIXELS_PER_MINUTE;
            html += `
            <div style="
                position:absolute;
                top:${top}px;
                width:100%;
                border-top:1px solid #f0f0f0;
                font-size:10px;
                color:#777;
                padding-left:4px;
            ">
                ${minutesToTime(m)}
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
                border-right:1px solid #eee;
                background:white;
             ">
        `;

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
                    background:rgba(0,0,0,0.05);
                    pointer-events:none;
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
                    background:rgba(0,0,0,0.05);
                    pointer-events:none;
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

        const base = tile?.base || "#e0e0e0";
        const border = tile?.border || "#555";
        const color = tile?.text || "#000";
        const dashed = tile?.dash ? "dashed" : "solid";

        return `
        <div class="mb-event"
             data-id="${ev.id}"
             draggable="true"
             style="
                position:absolute;
                top:${top}px;
                left:4%;
                width:92%;
                height:${height}px;

                background:${base};
                border:2px ${dashed} ${border};
                color:${color};

                border-radius:6px;
                padding:6px;
                font-size:0.83rem;
                line-height:1.1;
                box-shadow:0 2px 4px rgba(0,0,0,0.15);
                cursor:grab;
                overflow:hidden;
             ">
            <div style="font-weight:bold;">${ev.event}</div>
            <div style="font-size:0.75rem;">${ev.startTime} – ${ev.endTime}</div>
        </div>
    `;
    }

    // ============================================================================
    // DRAG-TO-MOVE EVENTS
    // ============================================================================
    function bindMoveEvents() {
        grid.querySelectorAll(".mb-event").forEach(evEl => {
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
        grid.querySelectorAll(".mb-event").forEach(evEl => {
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
                col.style.background = "#e6f7ff";
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
        grid.querySelectorAll(".mb-event").forEach(evEl => {
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
