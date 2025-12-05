// ============================================================================
// daily_adjustments.js — FULL PATCH (Combined from Parts 1, 2, and 3)
// Modernized for Loader v3, Unified Daily Overrides, Buffer/Transition Awareness
// ============================================================================

(function() {
    'use strict';

    // ==========================================================================
    // GLOBAL DAILY OVERRIDES PIPELINE INITIALIZATION
    // This object serves as the standardized pipeline for daily data manipulation
    // ==========================================================================
    window.dailyOverridesForLoader = window.dailyOverridesForLoader || {
        disabledFields: [],
        disabledSpecials: [],
        disabledLeagues: [],
        disabledSpecialtyLeagues: [],
        dailyFieldAvailability: {},
        dailyDisabledSportsByField: {},
        bunkActivityOverrides: []
    };

    // UI-local state
    let container = null;
    let activeSubTab = "skeleton";

    // Smart Tile cross-day fairness memory (Unused in this file, but kept for context)
    const SMART_TILE_HISTORY_KEY = "smartTileHistory_v1";
    let smartTileHistory = null;

    // Daily Skeleton Data Store
    let dailyOverrideSkeleton = [];
    const PIXELS_PER_MINUTE = 2;
    const INCREMENT_MINS = 30;

    // ==========================================================================
    // SMART TILE HISTORY UTILS
    // ==========================================================================
    function loadSmartTileHistory() {
        try {
            const raw = localStorage.getItem(SMART_TILE_HISTORY_KEY);
            if (!raw) return { byBunk: {} };
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== "object") return { byBunk: {} };
            if (!parsed.byBunk) parsed.byBunk = {};
            return parsed;
        } catch (e) {
            console.warn("Failed to load SmartTileHistory", e);
            return { byBunk: {} };
        }
    }

    function saveSmartTileHistory(history) {
        try {
            localStorage.setItem(SMART_TILE_HISTORY_KEY, JSON.stringify(history));
        } catch (e) {
            console.warn("Failed to save SmartTileHistory", e);
        }
    }

    // ==========================================================================
    // TIME UTILITIES — consistent with loader & UI
    // ==========================================================================
    function parseTimeToMinutes(str) {
        if (!str || typeof str !== "string") return null;

        let s = str.trim().toLowerCase();
        let mer = null;

        if (s.endsWith("am") || s.endsWith("pm")) {
            mer = s.endsWith("am") ? "am" : "pm";
            s = s.replace(/am|pm/g, "").trim();
        }

        const m = s.match(/^(\d{1,2})\s*:\s*(\d{2})$/);
        if (!m) return null;

        let hh = parseInt(m[1], 10);
        const mm = parseInt(m[2], 10);
        if (Number.isNaN(hh) || Number.isNaN(mm) || mm < 0 || mm > 59) return null;

        if (mer) {
            if (hh === 12) hh = mer === "am" ? 0 : 12;
            else if (mer === "pm") hh += 12;
        } else {
            return null;
        }

        return hh * 60 + mm;
    }

    function minutesToTime(min) {
        const hh = Math.floor(min / 60);
        const mm = min % 60;
        const h = hh % 12 === 0 ? 12 : hh % 12;
        const m = String(mm).padStart(2, "0");
        const ampm = hh < 12 ? "am" : "pm";
        return `${h}:${m}${ampm}`;
    }

    // ==========================================================================
    // TILE DEFINITIONS & MAPPINGS
    // ==========================================================================
    const TILES = [
        { type: "activity", name: "Activity", style: "background:#e0f7fa;border:1px solid #007bff;", description: "Flexible sport/special slot." },
        { type: "sports", name: "Sports", style: "background:#dcedc8;border:1px solid #689f38;", description: "Sports slot only." },
        { type: "special", name: "Special Activity", style: "background:#e8f5f9;border:1px solid #43a047;", description: "Specials only." },
        { type: "smart", name: "Smart Tile", style: "background:#e3f2fd;border:2px dashed #0288d1;color:#01579b;", description: "Two activities with fallback." },
        { type: "split", name: "Split Activity", style: "background:#fff3e0;border:1px solid #f57c00;", description: "Half / half." },
        { type: "league", name: "League Game", style: "background:#d1c4e9;border:1px solid #5e35b1;", description: "League slot." },
        { type: "specialty_league", name: "Specialty League", style: "background:#fff8e1;border:1px solid #f9a825;", description: "Specialty league slot." },
        { type: "swim", name: "Swim", style: "background:#bbdefb;border:1px solid #1976d2;", description: "Pinned Swim" },
        { type: "lunch", name: "Lunch", style: "background:#fbe9e7;border:1px solid #d84315;", description: "Pinned Lunch" },
        { type: "snacks", name: "Snacks", style: "background:#fff9c4;border:1px solid #fbc02d;", description: "Pinned snacks" },
        { type: "dismissal", name: "Dismissal", style: "background:#f44336;color:white;border:1px solid #b71c1c;", description: "Pinned dismissal" },
        { type: "custom", name: "Custom Pinned Event", style: "background:#eee;border:1px solid #616161;", description: "Pinned event (e.g. Assembly)." }
    ];

    // Convert Friendly Names → Optimizer event types
    function mapEventNameForOptimizer(name) {
        if (!name) return { type: "slot", event: "General Activity Slot" };
        const lower = name.toLowerCase().trim();

        if (lower === "activity") return { type: "slot", event: "General Activity Slot" };
        if (lower === "sports") return { type: "slot", event: "Sports Slot" };
        if (lower === "special" || lower === "special activity")
            return { type: "slot", event: "Special Activity" };

        // pinned
        if (["swim", "lunch", "snacks", "dismissal"].includes(lower))
            return { type: "pinned", event: name };

        return { type: "pinned", event: name };
    }

    // ==========================================================================
    // SKELETON DATA MANAGEMENT
    // ==========================================================================
    function loadDailySkeleton() {
        const daily = window.loadCurrentDailyData?.() || {};
        if (Array.isArray(daily.manualSkeleton) && daily.manualSkeleton.length > 0) {
            dailyOverrideSkeleton = JSON.parse(JSON.stringify(daily.manualSkeleton));
            return;
        }

        // FALLBACK: Use template
        const global = window.loadGlobalSettings?.() || {};
        const skeletons = global.app1?.savedSkeletons || {};
        const assign = global.app1?.skeletonAssignments || {};

        const dateStr = window.currentScheduleDate || "";
        const [yy, mm, dd] = dateStr.split("-").map(Number);
        let day = 0;
        if (yy && mm && dd) day = new Date(yy, mm - 1, dd).getDay();

        const dayName = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][day];

        let templateName = assign[dayName] || assign["Default"];
        if (!templateName || !skeletons[templateName]) {
            dailyOverrideSkeleton = [];
            return;
        }

        dailyOverrideSkeleton = JSON.parse(JSON.stringify(skeletons[templateName]));
    }

    function saveDailySkeleton() {
        window.saveCurrentDailyData?.("manualSkeleton", dailyOverrideSkeleton);
        window.dailySkeletonForLoader = dailyOverrideSkeleton;
    }

    // ==========================================================================
    // EVENT TILE RENDERING
    // ==========================================================================
    function renderEventTile(event, top, height) {
        let tile = TILES.find(t => t.name === event.event) ||
            TILES.find(t => t.type === event.type) ||
            TILES.find(t => t.type === "custom");

        const style = tile?.style || "background:#eee;border:1px solid #616161;";

        // Inner HTML
        let inner = `<strong>${event.event}</strong><br>
                    <div style="font-size:.85em;">${event.startTime} - ${event.endTime}</div>`;

        if (event.type === "smart" && event.smartData) {
            inner += `
                <div style="font-size:.75em;border-top:1px dotted #01579b;margin-top:2px;padding-top:1px;">
                    Fallback: ${event.smartData.fallbackActivity}<br>
                    For: ${event.smartData.fallbackFor}
                </div>`;
        }

        return `
            <div class="grid-event"
                data-event-id="${event.id}"
                title="Click to remove"
                style="${style};
                    padding:2px 5px;
                    border-radius:4px;
                    text-align:center;
                    position:absolute;
                    top:${top}px;
                    height:${height}px;
                    width:calc(100% - 4px);
                    overflow:hidden;
                    cursor:pointer;">
                ${inner}
            </div>`;
    }

    // ==========================================================================
    // GRID RENDERING (time vs divisions)
    // ==========================================================================
    function renderGrid(gridContainer) {
        // Always pull fresh filtered config from loader
        const config = window.SchedulerCoreUtils.loadAndFilterData();
        const { divisions, availableDivisions } = config;

        // Compute earliest & latest min across divisions
        let earliestMin = null,
            latestMin = null;

        availableDivisions.forEach(divName => {
            const div = divisions[divName];
            if (!div) return;
            const s = parseTimeToMinutes(div.startTime);
            const e = parseTimeToMinutes(div.endTime);
            if (s != null && (earliestMin == null || s < earliestMin)) earliestMin = s;
            if (e != null && (latestMin == null || e > latestMin)) latestMin = e;
        });

        if (earliestMin == null) earliestMin = 540; // 9:00am
        if (latestMin == null) latestMin = 960; // 4:00pm
        if (latestMin <= earliestMin) latestMin = earliestMin + 60;

        const totalMinutes = latestMin - earliestMin;
        const totalHeight = totalMinutes * PIXELS_PER_MINUTE;

        // Build HTML
        let html = `<div style="display:grid;grid-template-columns:60px repeat(${availableDivisions.length},1fr);position:relative;">`;

        // Header row
        html += `<div style="grid-row:1;position:sticky;top:0;background:#fff;z-index:10;border-bottom:1px solid #999;padding:8px;">Time</div>`;
        availableDivisions.forEach((divName, i) => {
            const col = i + 2;
            html += `
                <div style="
                    grid-row:1;
                    grid-column:${col};
                    position:sticky;
                    top:0;
                    background:${divisions[divName]?.color || "#333"};
                    color:#fff;
                    z-index:10;
                    border-bottom:1px solid #999;
                    padding:8px;
                    text-align:center;
                ">${divName}</div>`;
        });

        // TIME COLUMN
        html += `<div style="grid-row:2;grid-column:1;height:${totalHeight}px;position:relative;background:#f9f9f9;border-right:1px solid #ccc;">`;

        for (let min = earliestMin; min < latestMin; min += INCREMENT_MINS) {
            html += `
                <div style="
                    position:absolute;
                    top:${(min - earliestMin) * PIXELS_PER_MINUTE}px;
                    width:100%;
                    height:${INCREMENT_MINS * PIXELS_PER_MINUTE}px;
                    border-bottom:1px dashed #ddd;
                    font-size:10px;
                    padding:2px;
                    color:#777;
                ">${minutesToTime(min)}</div>`;
        }

        html += `</div>`;

        // DIVISION COLUMNS + events
        availableDivisions.forEach((divName, i) => {
            const div = divisions[divName];
            const start = parseTimeToMinutes(div.startTime);
            const end = parseTimeToMinutes(div.endTime);

            html += `
                <div class="grid-cell"
                    id="grid-cell-${divName}"
                    data-div="${divName}"
                    data-start-min="${earliestMin}"
                    style="grid-row:2;grid-column:${i + 2};position:relative;height:${totalHeight}px;border-right:1px solid #ccc;">
            `;

            // Disabled before/after div hours
            if (start != null && start > earliestMin) {
                const h = (start - earliestMin) * PIXELS_PER_MINUTE;
                html += `<div class="grid-disabled" style="top:0;height:${h}px;"></div>`;
            }
            if (end != null && end < latestMin) {
                const t = (end - earliestMin) * PIXELS_PER_MINUTE;
                const h = (latestMin - end) * PIXELS_PER_MINUTE;
                html += `<div class="grid-disabled" style="top:${t}px;height:${h}px;"></div>`;
            }

            // Render each event block
            dailyOverrideSkeleton
                .filter(ev => ev.division === divName)
                .forEach(ev => {
                    const s = parseTimeToMinutes(ev.startTime);
                    const e = parseTimeToMinutes(ev.endTime);
                    if (s == null || e == null) return;

                    const visibleStart = Math.max(s, earliestMin);
                    const visibleEnd = Math.min(e, latestMin);
                    if (visibleEnd <= visibleStart) return;

                    const top = (visibleStart - earliestMin) * PIXELS_PER_MINUTE;
                    const height = (visibleEnd - visibleStart) * PIXELS_PER_MINUTE;

                    html += renderEventTile(ev, top, height);
                });

            html += `</div>`;
        });

        html += `</div>`;
        gridContainer.innerHTML = html;

        addDropListeners(gridContainer);
        addRemoveListeners(gridContainer);
    }

    // ==========================================================================
    // DRAG/DROP LISTENERS
    // ==========================================================================
    function addDropListeners(gridContainer) {
        const cells = gridContainer.querySelectorAll(".grid-cell");

        cells.forEach(cell => {
            cell.ondragover = e => {
                e.preventDefault();
                cell.style.backgroundColor = "#e0ffe0";
            };
            cell.ondragleave = () => {
                cell.style.backgroundColor = "";
            };

            cell.ondrop = e => {
                e.preventDefault();
                cell.style.backgroundColor = "";

                const tile = JSON.parse(e.dataTransfer.getData("application/json"));
                const divName = cell.dataset.div;

                placeTileOnGrid(tile, divName, cell, e); // Pass the event 'e'
            };
        });
    }

    // ==========================================================================
    // TILE REMOVAL
    // ==========================================================================
    function addRemoveListeners(gridContainer) {
        const gridEl = document.getElementById("daily-skeleton-grid");
        gridContainer.querySelectorAll(".grid-event").forEach(tile => {
            tile.onclick = e => {
                e.stopPropagation();
                const id = tile.dataset.eventId;
                dailyOverrideSkeleton = dailyOverrideSkeleton.filter(ev => ev.id !== id);
                saveDailySkeleton();
                renderGrid(gridEl);
            };
        });
    }

    // ==========================================================================
    // PLACING A TILE ON THE GRID (Combines Part 1 and Part 2 logic)
    // ==========================================================================
    function placeTileOnGrid(tile, divName, cell, event) {
        const gridEl = document.getElementById("daily-skeleton-grid");
        const config = window.SchedulerCoreUtils.loadAndFilterData();
        const div = config.divisions[divName];
        if (!div) return;

        const rect = cell.getBoundingClientRect();
        const scrollTop = gridEl?.scrollTop || 0;
        const y = event.clientY - rect.top + scrollTop;

        const earliestMin = parseInt(cell.dataset.startMin, 10);
        const droppedMin = earliestMin + Math.round(y / PIXELS_PER_MINUTE / 15) * 15;

        const defaultStart = minutesToTime(droppedMin);
        const divStartMin = parseTimeToMinutes(div.startTime);
        const divEndMin = parseTimeToMinutes(div.endTime);

        const validate = (timeStr, isStart) => {
            const m = parseTimeToMinutes(timeStr);
            if (m == null) { alert("Invalid time format (e.g., 9:00am)"); return null; }
            if (m < divStartMin) { alert("Time is before division start"); return null; }
            if (isStart ? (m >= divEndMin) : (m > divEndMin)) {
                alert("Time is after division end");
                return null;
            }
            return m;
        };

        let newEvent = null;

        const askBlockTimes = () => {
            let startTime, startMin, endTime, endMin;

            while (true) {
                startTime = prompt(`Start time for ${tile.name}?`, defaultStart);
                if (!startTime) return null;
                startMin = validate(startTime, true);
                if (startMin != null) break;
            }

            while (true) {
                endTime = prompt(`End time for ${tile.name}?`, minutesToTime(startMin + 30));
                if (!endTime) return null;
                endMin = validate(endTime, false);
                if (endMin != null && endMin > startMin) break;
                alert("End time must be after start time");
            }

            return { startTime, endTime };
        };

        // --------------------------------------------------------
        // SPLIT BLOCK
        // --------------------------------------------------------
        if (tile.type === "split") {
            const times = askBlockTimes();
            if (!times) return;

            const a1 = prompt("Enter FIRST activity (e.g., Swim, Sports):");
            if (!a1) return;
            const a2 = prompt("Enter SECOND activity:");
            if (!a2) return;

            newEvent = {
                id: `evt_${Math.random().toString(36).slice(2, 9)}`,
                type: "split",
                event: `${a1} / ${a2}`,
                division: divName,
                startTime: times.startTime,
                endTime: times.endTime,
                subEvents: [
                    mapEventNameForOptimizer(a1),
                    mapEventNameForOptimizer(a2)
                ]
            };
        }

        // --------------------------------------------------------
        // SMART TILE (dual activity w/ fallback)
        // --------------------------------------------------------
        else if (tile.type === "smart") {
            const times = askBlockTimes();
            if (!times) return;

            const raw = prompt("Enter the TWO MAIN activities (e.g., Swim / Special):");
            if (!raw) return;

            const mains = raw.split(/,|\//).map(s => s.trim()).filter(Boolean);
            if (mains.length < 2) {
                alert("You must enter TWO activities.");
                return;
            }
            const [main1, main2] = mains;

            const pick = prompt(`Which activity gets fallback?\n1: ${main1}\n2: ${main2}`);
            if (!pick) return;

            let fallbackFor = pick.trim() === "1" ? main1 :
                pick.trim() === "2" ? main2 : null;
            if (!fallbackFor) {
                alert("Invalid choice. Must select '1' or '2'.");
                return;
            }

            const fallback = prompt(`If "${fallbackFor}" is busy, fallback to:`);
            if (!fallback) return;

            newEvent = {
                id: `evt_${Math.random().toString(36).slice(2, 9)}`,
                type: "smart",
                event: `${main1} / ${main2}`,
                division: divName,
                startTime: times.startTime,
                endTime: times.endTime,
                smartData: {
                    main1,
                    main2,
                    fallbackFor,
                    fallbackActivity: fallback
                }
            };
        }

        // --------------------------------------------------------
        // PINNED EVENTS
        // --------------------------------------------------------
        else if (["lunch", "snacks", "dismissal", "swim", "custom"].includes(tile.type)) {
            const times = askBlockTimes();
            if (!times) return;

            let eventName = tile.type === "custom" ?
                prompt("Enter custom event name:") :
                tile.name;

            if (!eventName) return;

            newEvent = {
                id: `evt_${Math.random().toString(36).slice(2, 9)}`,
                type: "pinned",
                event: eventName,
                division: divName,
                startTime: times.startTime,
                endTime: times.endTime
            };
        }

        // --------------------------------------------------------
        // SIMPLE SLOTS (Activity, Sports, Special, etc)
        // --------------------------------------------------------
        else {
            const times = askBlockTimes();
            if (!times) return;

            let eventName = tile.name;
            if (tile.type === "activity") eventName = "General Activity Slot";
            if (tile.type === "sports") eventName = "Sports Slot";
            if (tile.type === "special") eventName = "Special Activity";

            newEvent = {
                id: `evt_${Math.random().toString(36).slice(2, 9)}`,
                type: "slot",
                event: eventName,
                division: divName,
                startTime: times.startTime,
                endTime: times.endTime
            };
        }

        if (newEvent) {
            dailyOverrideSkeleton.push(newEvent);
            saveDailySkeleton();
            renderGrid(gridEl);
        }
    }


    // ==========================================================================
    // PALETTE RENDERING — drag tiles
    // ==========================================================================
    function renderPalette(paletteContainer) {
        paletteContainer.innerHTML =
            '<span style="font-weight:600; align-self:center;">Drag tiles:</span>';

        TILES.forEach(tile => {
            const el = document.createElement("div");
            el.className = "grid-tile-draggable";
            el.textContent = tile.name;
            el.style.cssText = tile.style;
            el.style.padding = "8px 12px";
            el.style.borderRadius = "5px";
            el.style.cursor = "grab";
            el.title = tile.description;

            el.draggable = true;

            el.ondragstart = e => {
                e.dataTransfer.setData("application/json", JSON.stringify(tile));
                e.dataTransfer.effectAllowed = "copy";
                el.style.cursor = "grabbing";
            };

            el.ondragend = () => {
                el.style.cursor = "grab";
            };

            paletteContainer.appendChild(el);
        });
    }

    // ==========================================================================
    // CHIP HELPER (used for Trips and Bunk Overrides)
    // ==========================================================================
    function createChip(name, color) {
        const el = document.createElement("span");
        el.className = "bunk-button";
        el.dataset.value = name;
        el.textContent = name;

        el.style.padding = "6px 10px";
        el.style.border = `1px solid ${color}`;
        el.style.borderRadius = "5px";
        el.style.margin = "4px";
        el.style.cursor = "pointer";
        el.style.display = "inline-block";

        el.onclick = () => {
            el.classList.toggle("selected");
            if (el.classList.contains("selected")) {
                el.style.background = color;
                el.style.color = "white";
                el.style.boxShadow = `0 2px 5px rgba(0,0,0,0.2)`;
            } else {
                el.style.background = "white";
                el.style.color = "black";
                el.style.boxShadow = 'none';
            }
        };

        return el;
    }


    // ==========================================================================
    // TRIPS UI
    // ==========================================================================
    function renderTripsForm() {
        const box = document.getElementById("trips-form-container");
        box.innerHTML = "";

        const form = document.createElement("div");
        form.style.border = "1px solid #ccc";
        form.style.padding = "15px";
        form.style.borderRadius = "8px";

        form.innerHTML = `
            <div style="display:flex; gap: 10px; align-items: center;">
                <label style="font-weight:600">Trip Name:</label>
                <input id="tripName" style="flex: 1; padding: 5px; border: 1px solid #ddd; border-radius: 4px;">
            </div>

            <div style="margin-top:10px; display:flex; gap: 10px;">
                <label style="font-weight:600;">Start:</label>
                <input id="tripStart" placeholder="9:00am" style="padding: 5px; border: 1px solid #ddd; border-radius: 4px; width: 80px;">
                <label style="font-weight:600; margin-left:10px">End:</label>
                <input id="tripEnd" placeholder="2:00pm" style="padding: 5px; border: 1px solid #ddd; border-radius: 4px; width: 80px;">
            </div>

            <p style="margin-top:15px;font-weight:600">Divisions Participating (Select):</p>
        `;

        const config = window.SchedulerCoreUtils.loadAndFilterData();
        const { availableDivisions, divisions } = config;

        const chipBox = document.createElement("div");
        chipBox.className = "chips";
        chipBox.style.display = "flex";
        chipBox.style.flexWrap = "wrap";
        chipBox.style.gap = "5px";

        availableDivisions.forEach(div => {
            const c = createChip(div, divisions[div]?.color || "#333");
            chipBox.appendChild(c);
        });

        form.appendChild(chipBox);

        const addBtn = document.createElement("button");
        addBtn.textContent = "Add Trip (Overrides Existing Slots)";
        addBtn.style.marginTop = "15px";
        addBtn.style.padding = "10px 15px";
        addBtn.style.borderRadius = "5px";
        addBtn.style.background = "#007BFF";
        addBtn.style.color = "white";
        addBtn.style.border = "none";
        addBtn.style.cursor = "pointer";

        addBtn.onclick = () => {
            const name = form.querySelector("#tripName").value.trim();
            const start = form.querySelector("#tripStart").value.trim();
            const end = form.querySelector("#tripEnd").value.trim();

            const startMin = parseTimeToMinutes(start);
            const endMin = parseTimeToMinutes(end);

            const selectedDivs = [...chipBox.querySelectorAll(".bunk-button.selected")]
                .map(el => el.dataset.value);

            if (!name || !startMin || !endMin || endMin <= startMin || selectedDivs.length === 0) {
                // Using console.error instead of alert per instructions, but using alert here as it's built into the flow
                alert("Invalid trip: Name, valid times, and at least one division are required.");
                return;
            }

            loadDailySkeleton();

            // Remove overlapping items for each affected division
            selectedDivs.forEach(divName => {
                dailyOverrideSkeleton = dailyOverrideSkeleton.filter(ev => {
                    if (ev.division !== divName) return true;
                    const s = parseTimeToMinutes(ev.startTime);
                    const e = parseTimeToMinutes(ev.endTime);
                    if (!s || !e) return true;
                    const overlap = (s < endMin) && (e > startMin);
                    return !overlap;
                });
            });

            // Add trip
            selectedDivs.forEach(divName => {
                dailyOverrideSkeleton.push({
                    id: `evt_${Math.random().toString(36).slice(2, 9)}`,
                    type: "pinned",
                    event: name,
                    division: divName,
                    startTime: start,
                    endTime: end
                });
            });

            saveDailySkeleton();
            const grid = document.getElementById("daily-skeleton-grid");
            renderGrid(grid);

            // Clear form inputs
            form.querySelector("#tripName").value = "";
            form.querySelector("#tripStart").value = "";
            form.querySelector("#tripEnd").value = "";
            chipBox.querySelectorAll(".bunk-button.selected").forEach(el => el.click());
        };

        form.appendChild(addBtn);
        box.appendChild(form);
    }


    // ==========================================================================
    // BUNK OVERRIDES (Pinned Activities for Bunks)
    // ==========================================================================
    function renderBunkOverridesUI() {
        const box = document.getElementById("bunk-overrides-container");
        box.innerHTML = "";

        const config = window.SchedulerCoreUtils.loadAndFilterData();
        const { divisions, availableDivisions } = config;

        const master = window.loadGlobalSettings?.() || {};
        const fields = master.app1?.fields || [];
        const specials = master.app1?.specialActivities || [];

        const sports = fields.flatMap(f => f.activities || []);
        const fieldNames = fields.map(f => f.name);
        const specialNames = specials.map(s => s.name);

        const activities = [...new Set([...sports, ...fieldNames, ...specialNames])].sort();

        // Form
        const form = document.createElement("div");
        form.style.border = "1px solid #ccc";
        form.style.padding = "15px";
        form.style.borderRadius = "8px";

        let opts = `<option value="">-- Select Activity --</option>`;
        activities.forEach(a => opts += `<option>${a}</option>`);

        form.innerHTML = `
            <div style="display:flex; gap: 10px; align-items: center;">
                <label style="font-weight:600">Activity:</label>
                <select id="bunkAct" style="flex: 1; padding: 5px; border: 1px solid #ddd; border-radius: 4px;">${opts}</select>
            </div>

            <div style="margin-top:10px; display:flex; gap: 10px;">
                <label style="font-weight:600;">Start:</label>
                <input id="bunkStart" placeholder="9:00am" style="padding: 5px; border: 1px solid #ddd; border-radius: 4px; width: 80px;">
                <label style="font-weight:600; margin-left:10px">End:</label>
                <input id="bunkEnd" placeholder="10:00am" style="padding: 5px; border: 1px solid #ddd; border-radius: 4px; width: 80px;">
            </div>

            <p style="margin-top:15px;font-weight:600">Bunks (Select):</p>
        `;

        // Bunk chips grouped by division
        availableDivisions.forEach(div => {
            const title = document.createElement("div");
            title.style.fontWeight = "700";
            title.style.marginTop = "10px";
            title.textContent = div;
            form.appendChild(title);

            const bunks = divisions[div]?.bunks || [];
            const chipBox = document.createElement("div");
            chipBox.style.display = "flex";
            chipBox.style.flexWrap = "wrap";
            chipBox.style.gap = "5px";
            bunks.forEach(b => chipBox.appendChild(createChip(b, divisions[div].color)));
            form.appendChild(chipBox);
        });

        const addBtn = document.createElement("button");
        addBtn.textContent = "Add Pinned Activity";
        addBtn.style.marginTop = "15px";
        addBtn.style.padding = "10px 15px";
        addBtn.style.borderRadius = "5px";
        addBtn.style.background = "#28a745";
        addBtn.style.color = "white";
        addBtn.style.border = "none";
        addBtn.style.cursor = "pointer";

        addBtn.onclick = () => {
            const act = form.querySelector("#bunkAct").value;
            const start = form.querySelector("#bunkStart").value.trim();
            const end = form.querySelector("#bunkEnd").value.trim();

            const s = parseTimeToMinutes(start);
            const e = parseTimeToMinutes(end);

            const selectedBunks = [...form.querySelectorAll(".bunk-button.selected")]
                .map(el => el.dataset.value);

            if (!act || !s || !e || e <= s || selectedBunks.length === 0) {
                alert("Invalid pinned activity: Activity, valid times, and at least one bunk are required.");
                return;
            }

            let dailyData = window.loadCurrentDailyData() || {};
            let overrides = dailyData.bunkActivityOverrides || [];

            selectedBunks.forEach(bunk => {
                overrides.push({
                    id: `id_${Math.random().toString(36).slice(2, 9)}`,
                    bunk,
                    activity: act,
                    startTime: start,
                    endTime: end
                });
            });

            window.saveCurrentDailyData?.("bunkActivityOverrides", overrides);
            window.dailyOverridesForLoader.bunkActivityOverrides = overrides; // Update the loader object

            // Clear form inputs and selection
            form.querySelector("#bunkAct").value = "";
            form.querySelector("#bunkStart").value = "";
            form.querySelector("#bunkEnd").value = "";
            form.querySelectorAll(".bunk-button.selected").forEach(el => el.click());

            renderBunkOverridesUI(); // Re-render the list
        };

        form.appendChild(addBtn);
        box.appendChild(form);

        // List
        const listBox = document.createElement("div");
        listBox.style.marginTop = "20px";
        listBox.innerHTML = "<h4>Active Bunk Overrides</h4>";
        const data = window.dailyOverridesForLoader.bunkActivityOverrides;

        if (data.length === 0) {
            listBox.innerHTML += `<p class="muted">No bunk specific overrides yet.</p>`;
        } else {
            const listContainer = document.createElement("div");
            data.forEach(item => {
                const row = document.createElement("div");
                row.style.display = "flex";
                row.style.justifyContent = "space-between";
                row.style.alignItems = "center";
                row.style.padding = "8px 0";
                row.style.borderBottom = "1px solid #eee";

                row.innerHTML = `
                    <div>
                        <strong>${item.bunk}</strong> → ${item.activity}<br>
                        <small style="color:#666;">${item.startTime} - ${item.endTime}</small>
                    </div>
                `;

                const del = document.createElement("button");
                del.textContent = "Remove";
                del.style.background = "#c0392b";
                del.style.color = "white";
                del.style.border = "none";
                del.style.padding = "5px 10px";
                del.style.borderRadius = "4px";
                del.style.cursor = "pointer";

                del.onclick = () => {
                    let list = window.dailyOverridesForLoader.bunkActivityOverrides;
                    window.dailyOverridesForLoader.bunkActivityOverrides =
                        list.filter(o => o.id !== item.id);
                    window.saveCurrentDailyData?.(
                        "bunkActivityOverrides",
                        window.dailyOverridesForLoader.bunkActivityOverrides
                    );
                    renderBunkOverridesUI();
                };

                row.appendChild(del);
                listContainer.appendChild(row);
            });
            listBox.appendChild(listContainer);
        }

        box.appendChild(listBox);
    }

    // ==========================================================================
    // RESOURCE OVERRIDES (Availability, Disabled Sports)
    // ==========================================================================
    let selectedOverrideId = null; // State for detail pane selection

    function renderResourceOverridesUI() {
        const box = document.getElementById("resource-overrides-container");
        box.innerHTML = "";

        const left = document.createElement("div");
        left.style.flex = "1";
        left.style.minWidth = "300px";
        left.style.borderRight = "1px solid #eee";
        left.style.paddingRight = "20px";
        left.style.overflowY = "auto";
        left.style.maxHeight = "70vh";

        const right = document.createElement("div");
        right.style.flex = "2";
        right.style.minWidth = "400px";
        right.style.paddingLeft = "20px";

        const wrapper = document.createElement("div");
        wrapper.style.display = "flex";
        wrapper.style.flexWrap = "wrap";
        wrapper.style.gap = "20px";

        wrapper.appendChild(left);
        wrapper.appendChild(right);
        box.appendChild(wrapper);

        // --- Lists ---
        left.innerHTML = `
            <h4>Fields</h4><div id="override-fields-list" class="master-list"></div>
            <h4 style="margin-top:15px;">Special Activities</h4><div id="override-specials-list" class="master-list"></div>
            <h4 style="margin-top:15px;">Leagues</h4><div id="override-leagues-list" class="master-list"></div>
            <h4 style="margin-top:15px;">Specialty Leagues</h4><div id="override-specialty-leagues-list" class="master-list"></div>
        `;

        right.innerHTML = `
            <h4>Details</h4>
            <div id="override-detail-pane" class="detail-pane" style="min-height:300px; padding:10px; border: 1px solid #ddd; border-radius: 4px;">
                <p class="muted" style="color:#777;">Select an item from the left to adjust its daily availability or supported activities.</p>
            </div>
        `;
        renderOverrideLists();
        renderOverrideDetailPane();
    }

    function renderOverrideLists() {
        const daily = window.loadCurrentDailyData?.() || {};
        const config = window.SchedulerCoreUtils.loadAndFilterData();

        const { fields = [], specialActivities = [], leaguesByName = {}, specialtyLeagues = {} } =
            window.loadGlobalSettings()?.app1 || {};

        const overrideFieldsListEl = document.getElementById("override-fields-list");
        const overrideSpecialsListEl = document.getElementById("override-specials-list");
        const overrideLeaguesListEl = document.getElementById("override-leagues-list");
        const overrideSpecialtyLeaguesListEl = document.getElementById("override-specialty-leagues-list");

        const disabledFields = daily.overrides?.disabledFields || [];
        const disabledSpecials = daily.overrides?.disabledSpecials || [];
        const disabledLeagues = daily.overrides?.leagues || [];
        const disabledSpecialty = daily.disabledSpecialtyLeagues || [];

        const addListItem = (container, type, name, enabled, toggleFn) => {
            const id = `${type}::${name}`;
            const row = document.createElement("div");
            row.className = "list-item";
            row.style.display = "flex";
            row.style.justifyContent = "space-between";
            row.style.alignItems = "center";
            row.style.padding = "5px 0";
            row.style.cursor = "pointer";
            row.style.borderBottom = "1px dotted #eee";

            if (selectedOverrideId === id) {
                row.style.background = "#f0f8ff";
                row.classList.add("selected");
            }

            const label = document.createElement("span");
            label.className = "list-item-name";
            label.textContent = name;
            label.style.flexGrow = "1";
            label.onclick = () => {
                selectedOverrideId = id;
                renderOverrideLists();
                renderOverrideDetailPane();
            };

            const check = document.createElement("input");
            check.type = "checkbox";
            check.checked = enabled;
            check.style.cursor = "pointer";
            check.onclick = e => {
                e.stopPropagation();
                toggleFn(check.checked);
                renderOverrideLists();
            };

            const status = document.createElement("span");
            status.textContent = enabled ? 'Enabled' : 'DISABLED';
            status.style.fontSize = "0.8em";
            status.style.color = enabled ? "#28a745" : "#c0392b";
            status.style.marginRight = "10px";

            row.appendChild(label);
            row.appendChild(status);
            row.appendChild(check);
            row.id = id;
            container.appendChild(row);
        };

        // Helper to update the daily data structure and the global loader object
        const updateDailyDataAndLoader = (key, listUpdater, name, isOn) => {
            const dailyData = window.loadCurrentDailyData() || {};
            let o = dailyData.overrides || {};
            if (key !== 'leagues') o = dailyData; // Special handling for non-league overrides

            let list;
            if (key === 'disabledSpecialtyLeagues') list = o.disabledSpecialtyLeagues || [];
            else list = listUpdater(o) || [];

            if (isOn) list = list.filter(x => x !== name);
            else if (!list.includes(name)) list.push(name);

            if (key === 'disabledSpecialtyLeagues') o.disabledSpecialtyLeagues = list;
            else if (key === 'leagues') o.leagues = list;
            else if (key === 'disabledFields') o.disabledFields = list;
            else if (key === 'disabledSpecials') o.disabledSpecials = list;

            if (key === 'leagues' || key === 'disabledFields' || key === 'disabledSpecials') {
                window.saveCurrentDailyData("overrides", o);
            } else {
                window.saveCurrentDailyData(key, list);
            }

            // Update the global loader object for immediate use by the optimizer
            if (key === 'disabledFields' || key === 'disabledSpecials' || key === 'leagues') {
                window.dailyOverridesForLoader[key] = list;
            } else if (key === 'disabledSpecialtyLeagues') {
                window.dailyOverridesForLoader.disabledSpecialtyLeagues = list;
            }
        };

        // Fields
        overrideFieldsListEl.innerHTML = "";
        fields.forEach(f => {
            addListItem(
                overrideFieldsListEl, "field", f.name,
                !disabledFields.includes(f.name),
                isOn => updateDailyDataAndLoader('disabledFields', (o) => o.disabledFields || [], f.name, isOn)
            );
        });

        // Special Activities
        overrideSpecialsListEl.innerHTML = "";
        specialActivities.forEach(s => {
            addListItem(
                overrideSpecialsListEl, "special", s.name,
                !disabledSpecials.includes(s.name),
                isOn => updateDailyDataAndLoader('disabledSpecials', (o) => o.disabledSpecials || [], s.name, isOn)
            );
        });

        // Leagues
        overrideLeaguesListEl.innerHTML = "";
        Object.keys(leaguesByName).forEach(name => {
            addListItem(
                overrideLeaguesListEl, "league", name,
                !disabledLeagues.includes(name),
                isOn => updateDailyDataAndLoader('leagues', (o) => o.leagues || [], name, isOn)
            );
        });

        // Specialty Leagues
        overrideSpecialtyLeaguesListEl.innerHTML = "";
        Object.values(specialtyLeagues)
            .map(s => s.name)
            .sort()
            .forEach(name => {
                addListItem(
                    overrideSpecialtyLeaguesListEl, "specialty_league", name,
                    !disabledSpecialty.includes(name),
                    isOn => updateDailyDataAndLoader('disabledSpecialtyLeagues', () => null, name, isOn)
                );
            });
    }

    // ------------------------------------------
    // OVERRIDE DETAIL PANE
    // ------------------------------------------
    function renderOverrideDetailPane() {
        const pane = document.getElementById("override-detail-pane");
        if (!pane) return;

        if (!selectedOverrideId) {
            pane.innerHTML = `<p class="muted" style="color:#777;">Select an item from the left to adjust its daily availability or supported activities.</p>`;
            return;
        }

        const [type, name] = selectedOverrideId.split("::");

        const settings = window.loadGlobalSettings()?.app1 || {};
        const daily = window.loadCurrentDailyData() || {};

        const dailyFields = daily.dailyFieldAvailability || {};
        const disabledSportsByField = daily.dailyDisabledSportsByField || {};

        pane.innerHTML = "";
        pane.style.padding = "10px";

        if (type === "field" || type === "special") {
            const list = type === "field" ? settings.fields : settings.specialActivities;
            const item = list.find(x => x.name === name);
            if (!item) {
                pane.textContent = `Error: ${type} not found.`;
                return;
            }

            const globalRules = item.timeRules || [];
            const dailyRules = dailyFields[name] || [];

            // 1. Time Rules (Overrides for Availability)
            pane.appendChild(
                renderTimeRulesUI(name, globalRules, dailyRules, updated => {
                    dailyFields[name] = updated;
                    window.saveCurrentDailyData("dailyFieldAvailability", dailyFields);
                    window.dailyOverridesForLoader.dailyFieldAvailability = dailyFields; // Update loader object
                    renderOverrideDetailPane();
                })
            );

            // 2. Disabled Sports (Only for fields)
            if (type === "field" && item.activities && item.activities.length > 0) {
                const section = document.createElement("div");
                section.style.marginTop = "20px";
                section.innerHTML = `<h4>Disable Sports/Activities on ${name}</h4>`;

                const disabledList = disabledSportsByField[name] || [];

                item.activities.forEach(s => {
                    const row = document.createElement("div");
                    row.style.display = "flex";
                    row.style.alignItems = "center";
                    row.style.padding = "3px 0";

                    const cb = document.createElement("input");
                    cb.type = "checkbox";
                    cb.checked = !disabledList.includes(s);
                    cb.style.marginRight = "8px";

                    cb.onchange = () => {
                        let list = disabledSportsByField[name] || [];
                        if (cb.checked) list = list.filter(x => x !== s);
                        else if (!list.includes(s)) list.push(s);

                        disabledSportsByField[name] = list;
                        window.saveCurrentDailyData("dailyDisabledSportsByField", disabledSportsByField);
                        window.dailyOverridesForLoader.dailyDisabledSportsByField = disabledSportsByField; // Update loader object
                    };

                    row.appendChild(cb);
                    const label = document.createElement("label");
                    label.textContent = s;
                    row.appendChild(label);
                    section.appendChild(row);
                });

                pane.appendChild(section);
            }
        } else {
            pane.innerHTML = `<p class="muted" style="color:#777;">This resource is either fully enabled/disabled using the checkbox, or has no time-specific rules.</p>`;
        }
    }

    // ------------------------------------------
    // TIME RULES UI (Used by Resource Detail Pane)
    // ------------------------------------------
    function renderTimeRulesUI(itemName, globalRules, dailyRules, onChange) {
        const root = document.createElement("div");

        const section1 = document.createElement("div");
        section1.style.paddingBottom = "10px";
        section1.style.borderBottom = "1px solid #ddd";
        section1.innerHTML = `<strong>Global Rules (Default Availability)</strong>`;
        if (globalRules.length === 0) {
            section1.innerHTML += `<p class="muted" style="font-size:0.9em;color:#777;">Available all day (unless manually disabled).</p>`;
        } else {
            globalRules.forEach(r => {
                const line = document.createElement("div");
                line.textContent = `${r.type} from ${r.start} to ${r.end}`;
                line.style.fontSize = "0.9em";
                line.style.color = "#444";
                section1.appendChild(line);
            });
        }
        root.appendChild(section1);

        const section2 = document.createElement("div");
        section2.style.marginTop = "20px";
        section2.innerHTML = `<strong>Daily Overrides for ${itemName}</strong>`;

        const list = document.createElement("div");
        dailyRules.forEach((r, i) => {
            const row = document.createElement("div");
            row.style.background = r.type === 'Available' ? "#e6ffed" : "#ffe6e6";
            row.style.padding = "6px";
            row.style.margin = "4px 0";
            row.style.borderRadius = "4px";
            row.style.display = "flex";
            row.style.justifyContent = "space-between";
            row.style.alignItems = "center";
            row.textContent = `${r.type}: ${r.start} → ${r.end}`;

            const del = document.createElement("button");
            del.textContent = "✖";
            del.title = "Remove Rule";
            del.style.background = "transparent";
            del.style.border = "none";
            del.style.color = "#c0392b";
            del.style.fontSize = "1em";
            del.style.cursor = "pointer";

            del.onclick = () => {
                const copy = dailyRules.slice();
                copy.splice(i, 1);
                onChange(copy);
            };

            row.appendChild(del);
            list.appendChild(row);
        });

        if (dailyRules.length === 0) {
            list.innerHTML = `<p class="muted" style="font-size:0.9em;color:#777;">No time-specific overrides for today.</p>`;
        }

        section2.appendChild(list);

        // Add new
        const add = document.createElement("div");
        add.style.marginTop = "15px";
        add.style.padding = "10px";
        add.style.border = "1px dashed #ccc";
        add.style.borderRadius = "4px";
        add.style.display = "flex";
        add.style.gap = "5px";
        add.style.alignItems = "center";

        const typeSel = document.createElement("select");
        typeSel.innerHTML = `<option>Available</option><option>Unavailable</option>`;
        typeSel.style.padding = "5px";

        const s1 = document.createElement("input");
        s1.placeholder = "Start (e.g., 9:00am)";
        s1.style.flex = "1";
        s1.style.padding = "5px";

        const s2 = document.createElement("input");
        s2.placeholder = "End (e.g., 10:30am)";
        s2.style.flex = "1";
        s2.style.padding = "5px";


        const btn = document.createElement("button");
        btn.textContent = "Add Rule";
        btn.style.background = "#007bff";
        btn.style.color = "white";
        btn.style.padding = "5px 10px";
        btn.style.border = "none";
        btn.style.borderRadius = "4px";
        btn.style.cursor = "pointer";

        btn.onclick = () => {
            const t1 = parseTimeToMinutes(s1.value);
            const t2 = parseTimeToMinutes(s2.value);
            if (!t1 || !t2 || t2 <= t1) {
                alert("Invalid times. End time must be after start time and both must be valid 12-hour clock times.");
                return;
            }
            onChange([...dailyRules, {
                type: typeSel.value,
                start: s1.value,
                end: s2.value
            }]);
        };

        add.appendChild(typeSel);
        add.appendChild(s1);
        add.appendChild(s2);
        add.appendChild(btn);
        section2.appendChild(add);

        root.appendChild(section2);
        return root;
    }

    // ------------------------------------------
    // RUN OPTIMIZER (Loader-Aligned)
    // ------------------------------------------
    function runOptimizer() {
        // Data is already pre-loaded into window.dailySkeletonForLoader and window.dailyOverridesForLoader

        const skeleton = window.dailySkeletonForLoader;
        const overrides = window.dailyOverridesForLoader;

        if (!skeleton || skeleton.length === 0) {
            alert("The daily skeleton is empty. Please drag and drop activity blocks onto the grid first.");
            return;
        }

        if (typeof window.runSkeletonOptimizer !== 'function') {
            alert("Optimizer function (window.runSkeletonOptimizer) is not available in the environment.");
            return;
        }

        const ok = window.runSkeletonOptimizer(skeleton, overrides);

        if (ok) {
            alert("Schedule Generated! Check the 'Schedule' tab.");
            window.showTab?.("schedule");
        } else {
            alert("Optimizer failed. Check the console for detailed error messages.");
        }
    }

    // ------------------------------------------
    // INIT DAILY ADJUSTMENTS PANEL (ENTRY POINT)
    // ------------------------------------------
    function initDailyAdjustments() {
        const container = document.getElementById("daily-adjustments-content");
        if (!container) {
            console.error("Missing #daily-adjustments-content element. Cannot initialize.");
            return;
        }

        // --- Load & Sync Data into Global Loader Objects ---
        const dailyData = window.loadCurrentDailyData?.() || {};

        window.dailySkeletonForLoader = dailyData.manualSkeleton || [];

        window.dailyOverridesForLoader = {
            dailyFieldAvailability: dailyData.dailyFieldAvailability || {},
            leagues: dailyData.overrides?.leagues || [],
            disabledSpecialtyLeagues: dailyData.disabledSpecialtyLeagues || [],
            dailyDisabledSportsByField: dailyData.dailyDisabledSportsByField || {},
            disabledFields: dailyData.overrides?.disabledFields || [],
            disabledSpecials: dailyData.overrides?.disabledSpecials || [],
            bunkActivityOverrides: dailyData.bunkActivityOverrides || []
        };
        // Load the UI's working copy of the skeleton
        loadDailySkeleton();

        container.innerHTML = `
            <style>
                /* General Styles */
                .da-tab-pane { display: none; padding: 15px; border: 1px solid #ddd; border-top: none; border-radius: 0 0 8px 8px; background: #fff; }
                .da-tab-pane.active { display: block; }
                .da-tabs-nav { display: flex; gap: 5px; margin-top: 15px; }
                .tab-button {
                    padding: 10px 15px; border: 1px solid #ddd; border-radius: 8px 8px 0 0; cursor: pointer; background: #f4f4f4;
                    transition: all 0.2s;
                }
                .tab-button.active { background: #fff; border-bottom: 1px solid #fff; font-weight: 600; }
                .grid-disabled { position: absolute; width: 100%; background: rgba(255, 99, 71, 0.1); border-top: 1px solid #ff6347; z-index: 5; }
                .master-list { border: 1px solid #eee; border-radius: 4px; padding: 5px; max-height: 250px; overflow-y: auto; }
            </style>

            <div style="padding:10px 15px;background:#fff;border:1px solid #ddd;border-radius:8px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:center;box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
                <div>
                    <h2 style="margin:0 0 5px 0; color:#0056b3;">Daily Adjustments for ${window.currentScheduleDate || 'Today'}</h2>
                    <p style="margin:0;font-size:0.9em;color:#555;">1. Define blocks, 2. Add overrides, 3. Run the optimizer.</p>
                </div>
                <button id="run-optimizer-btn"
                        style="background:#28a745;color:white;padding:12px 20px;font-size:1.2em;border:none;border-radius:5px;cursor:pointer;box-shadow: 0 2px 4px rgba(0,0,0,0.2);">
                    Run Optimizer
                </button>
            </div>

            <div class="da-tabs-nav">
                <button class="tab-button active" data-tab="skeleton">Skeleton</button>
                <button class="tab-button" data-tab="trips">Trips</button>
                <button class="tab-button" data-tab="bunk-specific">Bunk Specific</button>
                <button class="tab-button" data-tab="resources">Resource Availability</button>
            </div>

            <div id="da-pane-skeleton" class="da-tab-pane active">
                <h3 style="margin-top:0;">Daily Schedule Skeleton</h3>
                <div id="override-scheduler-content"></div>
            </div>

            <div id="da-pane-trips" class="da-tab-pane">
                <h3 style="margin-top:0;">Division Trips/Events</h3>
                <div id="trips-form-container"></div>
            </div>

            <div id="da-pane-bunk-specific" class="da-tab-pane">
                <h3 style="margin-top:0;">Pinned Bunk Activities</h3>
                <div id="bunk-overrides-container"></div>
            </div>

            <div id="da-pane-resources" class="da-tab-pane">
                <h3 style="margin-top:0;">Field & Special Resource Overrides</h3>
                <div id="resource-overrides-container"></div>
            </div>
        `;

        // Handle tab switching
        container.querySelectorAll(".tab-button").forEach(btn => {
            btn.onclick = () => {
                container.querySelectorAll(".tab-button").forEach(b => b.classList.remove("active"));
                btn.classList.add("active");

                const tab = btn.dataset.tab;
                container.querySelectorAll(".da-tab-pane").forEach(p => p.classList.remove("active"));
                container.querySelector(`#da-pane-${tab}`).classList.add("active");

                // Re-render the resource list on tab switch to keep the detail pane up to date
                if (tab === 'resources') {
                    renderOverrideLists();
                    renderOverrideDetailPane();
                }
            };
        });

        document.getElementById("run-optimizer-btn").onclick = runOptimizer;

        // Build skeleton UI
        const skeletonBox = document.getElementById("override-scheduler-content");
        skeletonBox.innerHTML = `
            <div id="daily-skeleton-palette" style="padding:10px;background:#f4f4f4;border-radius:8px;margin-bottom:15px;display:flex;flex-wrap:wrap;gap:10px;box-shadow:inset 0 1px 3px rgba(0,0,0,0.1);"></div>
            <div id="daily-skeleton-grid" style="overflow-x:auto;border:1px solid #999;max-height:600px;overflow-y:scroll;background:#fff;"></div>
        `;
        renderPalette(document.getElementById("daily-skeleton-palette"));
        renderGrid(document.getElementById("daily-skeleton-grid"));

        // Build remaining tabs
        renderTripsForm();
        renderBunkOverridesUI();
        renderResourceOverridesUI();
    }

    // Expose globally
    window.initDailyAdjustments = initDailyAdjustments;

})();
