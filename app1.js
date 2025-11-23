// =================================================================
// app1.js
//
// UPDATED:
// - **REMOVED** `globalStartTime` and `globalEndTime`.
// - The "Global Camp Times" UI and logic have been deleted from `initApp1`.
// - **ADDED** `startTime` and `endTime` (defaulting to "") to the
//   `divisions` object in `addDivision` and `loadData`.
// - **MODIFIED** `setupDivisionButtons` to:
//   - Render division chips on the left.
//   - Make the ENTIRE division card clickable (like fields.js).
//   - Add a hover "lift" animation on division cards.
//   - Highlight the selected division card.
// - **NEW** `renderDivisionDetailPane`:
//   - Card-style layout:
//     • Division Times card
//     • Bunks in This Division card
//   - Time validation uses `parseTimeToMinutes`.
//   - Removing a bunk from the division is a one-click action in the card.
//   - **NEW**: Per-division bunk add input so you can add bunks by grade
//     directly from the division detail (no drag/drop).
// - `specialActivities` logic from last update is still present.
// =================================================================

(function() {
'use strict';

// -------------------- State --------------------
let bunks = [];
let divisions = {}; // { divName:{ bunks:[], color, startTime, endTime } }
let specialActivities = []; // For special_activities.js

let availableDivisions = [];
let selectedDivision = null;

// NEW: Master list of all sports
let allSports = [];
// NEW: User-defined default sports list
const defaultSports = [
    "Baseball", "Basketball", "Football", "Hockey", "Kickball", 
    "Lacrosse", "Newcomb", "Punchball", "Soccer", "Volleyball"
];

// NEW: Skeleton template management
let savedSkeletons = {};
let skeletonAssignments = {}; // { "Monday": "templateName", "Default": "templateName" }

const defaultColors = ['#4CAF50','#2196F3','#E91E63','#FF9800','#9C27B0','#00BCD4','#FFC107','#F44336','#8BC34A','#3F51B5'];
let colorIndex = 0;

// Expose internal variable to the window for use by other modules
window.divisions = divisions;
window.availableDivisions = availableDivisions;

// -------------------- Helpers --------------------
function makeEditable(el, save) {
    el.ondblclick = e => {
        e.stopPropagation();
        const old = el.textContent;
        const input = document.createElement("input");
        input.type = "text"; input.value = old;
        el.replaceWith(input); input.focus();
        function done() {
            const val = input.value.trim();
            if (val && val !== old) save(val);
            el.textContent = val || old; input.replaceWith(el);
        }
        input.onblur = done; input.onkeyup = e => { if (e.key === "Enter") done(); };
    };
}

function uid() {
    return `id_${Math.random().toString(36).slice(2, 9)}`;
}

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
      if (hh === 12) hh = mer === "am" ? 0 : 12; // 12am -> 0, 12pm -> 12
      else if (mer === "pm") hh += 12; // 1pm -> 13
  } else {
      return null; // AM/PM is required
  }

  return hh * 60 + mm;
}

// Simple bunk sorter: tries leading number, then falls back to alpha
function compareBunks(a, b) {
    const re = /^(\d+)/;
    const ma = String(a).match(re);
    const mb = String(b).match(re);
    if (ma && mb) {
        const na = parseInt(ma[1], 10);
        const nb = parseInt(mb[1], 10);
        if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) {
            return na - nb;
        }
    }
    return String(a).localeCompare(String(b), undefined, { numeric: true });
}

function sortDivisionBunks() {
    Object.values(divisions).forEach(div => {
        if (Array.isArray(div.bunks)) {
            div.bunks.sort(compareBunks);
        }
    });
}

// -------------------- Bunks --------------------
function addBunk() {
    const i = document.getElementById("bunkInput");
    const name = i?.value.trim();
    if (!name) return;
    const exists = bunks.some(b => b.toLowerCase() === name.toLowerCase());
    if (exists) {
        console.error("That bunk already exists!");
        i.value = "";
        return;
    }
    bunks.push(name);
    sortDivisionBunks();
    saveData();
    i.value = "";
    updateUnassigned();
    window.updateTable?.();
}

function updateUnassigned() {
    const c = document.getElementById("unassignedBunks");
    if (!c) return; // Failsafe
    c.innerHTML = "";
    bunks.forEach(b => {
        const span = document.createElement("span");
        span.textContent = b;
        // Use same chip style as sports pills
        span.className = "activity-button bunk-pill-chip";
        let assigned = null;
        for (const d in divisions) { if (divisions[d].bunks.includes(b)) assigned = d; }
        if (assigned) { 
            span.style.backgroundColor = divisions[assigned].color; 
            span.style.color = "#fff"; 
            span.style.borderColor = divisions[assigned].color;
        }

        // Assign bunk to currently selected division on normal click (if not already there)
        span.onclick = () => {
            if (selectedDivision && (!assigned || assigned !== selectedDivision)) {
                for (const d in divisions) {
                    const i = divisions[d].bunks.indexOf(b);
                    if (i !== -1) divisions[d].bunks.splice(i, 1);
                }
                if (!divisions[selectedDivision].bunks.includes(b)) {
                    divisions[selectedDivision].bunks.push(b);
                    divisions[selectedDivision].bunks.sort(compareBunks);
                }
                saveData();
                updateUnassigned();
                renderDivisionDetailPane();
                window.updateTable?.();
            } else if (!selectedDivision) {
                console.error("Select a division first!");
            }
        };

        // Editable name via double-click
        makeEditable(span, newName => {
            if (!newName.trim()) return;
            const idx = bunks.indexOf(b);
            if (idx !== -1) bunks[idx] = newName;
            for (const d of Object.values(divisions)) {
                const i = d.bunks.indexOf(b);
                if (i !== -1) d.bunks[i] = newName;
                d.bunks.sort(compareBunks);
            }

            if (window.scheduleAssignments && window.scheduleAssignments[b]) {
                window.scheduleAssignments[newName] = window.scheduleAssignments[b];
                delete window.scheduleAssignments[b];
                window.saveCurrentDailyData?.("scheduleAssignments", window.scheduleAssignments);
            }
            saveData();
            updateUnassigned();
            renderDivisionDetailPane();
            window.updateTable?.();
        });

        c.appendChild(span);
    });
}

// -------------------- Divisions --------------------
function addDivision() {
    const i = document.getElementById("divisionInput");
    if (!i) return;
    if (i.value.trim() === "") return;
    const name = i.value.trim();
    if (!availableDivisions.includes(name)) {
        const color = defaultColors[colorIndex % defaultColors.length]; colorIndex++;

        availableDivisions.push(name);
        window.availableDivisions = availableDivisions; // Update global

        divisions[name] = { 
            bunks: [], 
            color,
            startTime: "", // NEW: Add blank start time
            endTime: ""    // NEW: Add blank end time
        };
        
        window.divisions = divisions; // keep global in sync

        i.value = "";
        saveData();
        selectedDivision = name;
        setupDivisionButtons();
        renderDivisionDetailPane();
        window.initLeaguesTab?.(); 
        window.updateTable?.();
    }
}

/**
 * LEFT SIDE: Division cards list
 * - Entire card clickable (like fields.js).
 * - Hover lift animation.
 * - Selected card highlighted.
 */
function setupDivisionButtons() {
    const cont = document.getElementById("divisionButtons"); 
    if (!cont) return; // Failsafe
    cont.innerHTML = "";
    
    const colorEnabledEl = document.getElementById("enableColor");
    const colorEnabled = colorEnabledEl ? colorEnabledEl.checked : true;
    
    availableDivisions.forEach(name => {
        const obj = divisions[name];

        if (!obj) {
            console.warn(`Data mismatch: Division "${name}" exists in availableDivisions but not in divisions object. Skipping.`);
            return;
        }

        // Main wrapper for the division's settings
        const wrap = document.createElement("div"); 
        wrap.className = "divisionWrapper";
        // Hover lift animation like fields
        wrap.style.transition = "transform 0.08s ease, box-shadow 0.12s ease, border-color 0.12s ease";
        wrap.onmouseenter = () => {
            wrap.style.transform = "translateY(-1px)";
            wrap.style.boxShadow = "0 8px 18px rgba(15, 23, 42, 0.12)";
        };
        wrap.onmouseleave = () => {
            wrap.style.transform = "";
            // Slight reset; selected card will re-override boxShadow below
            wrap.style.boxShadow = "0 6px 14px rgba(15, 23, 42, 0.06)";
        };

        // Click anywhere on the card to select this division
        wrap.onclick = () => {
            selectedDivision = name;

            // Clear previous selection
            cont.querySelectorAll(".divisionWrapper").forEach(el => {
                el.classList.remove("division-selected");
                el.style.borderColor = "#e5e7eb";
            });
            cont.querySelectorAll('span.bunk-button').forEach(el => el.classList.remove("selected"));

            // Mark this card + chip as selected
            wrap.classList.add("division-selected");
            wrap.style.borderColor = "#2563eb";
            if (span) span.classList.add("selected");

            saveData();
            renderDivisionDetailPane();
        };
        
        // --- 1. Top row: Name, Color ---
        const topRow = document.createElement("div");
        topRow.style.display = "flex";
        topRow.style.alignItems = "center";
        topRow.style.gap = "8px";

        const span = document.createElement("span"); 
        span.textContent = name; 
        span.className = "bunk-button";
        span.style.backgroundColor = colorEnabled ? obj.color : "transparent";
        span.style.color = colorEnabled ? "#fff" : "inherit";
        // prevent this from swallowing the card click logic for editing name
        makeEditable(span, newName => {
            divisions[newName] = divisions[name];
            delete divisions[name];
            window.divisions = divisions; 
            
            availableDivisions[availableDivisions.indexOf(name)] = newName;
            window.availableDivisions = availableDivisions;

            if (selectedDivision === name) selectedDivision = newName;
            saveData();
            setupDivisionButtons();
            renderDivisionDetailPane();
            window.initLeaguesTab?.();
            window.updateTable?.();
        });
        topRow.appendChild(span);
        
        const col = document.createElement("input"); 
        col.type = "color";
        col.value = obj.color; 
        col.className = "colorPicker";
        // don't let clicking the color picker trigger card selection
        col.onclick = (e) => e.stopPropagation();
        col.oninput = e => {
            obj.color = e.target.value;
            if (colorEnabled) { 
                span.style.backgroundColor = e.target.value; 
                span.style.color = "#fff"; 
            }
            saveData();
            renderDivisionDetailPane();
            window.updateTable?.();
        };
        topRow.appendChild(col);
        wrap.appendChild(topRow);

        // --- 2. Tiny summary under each division chip (optional) ---
        const infoRow = document.createElement("div");
        infoRow.style.marginTop = "6px";
        infoRow.style.fontSize = "0.75rem";
        infoRow.style.color = "#6b7280";
        const bunkCount = (obj.bunks || []).length;
        const hasTimes = obj.startTime && obj.endTime;
        infoRow.textContent = `${bunkCount} bunk${bunkCount === 1 ? "" : "s"}${hasTimes ? ` • ${obj.startTime} - ${obj.endTime}` : ""}`;
        wrap.appendChild(infoRow);

        // Selected styling on initial render
        if (selectedDivision === name) {
            wrap.classList.add("division-selected");
            wrap.style.borderColor = "#2563eb";
            span.classList.add("selected");
        }

        cont.appendChild(wrap);
    });

    // After refreshing the left list, refresh the right-side detail pane as well
    renderDivisionDetailPane();
}

/**
 * RIGHT SIDE: Division detail pane (card-style, like fields.js)
 * Shows:
 * - Division header
 * - Card 1: Division Times
 * - Card 2: Bunks in this Division (with its own add input)
 */
function renderDivisionDetailPane() {
    const pane = document.getElementById("division-detail-pane");
    if (!pane) return;

    if (!selectedDivision || !divisions[selectedDivision]) {
        pane.innerHTML = `
            <p class="muted">
                Select a division on the left to edit its details:
                <br>• Set division <strong>start / end time</strong>
                <br>• Add and manage <strong>bunks</strong>
            </p>
        `;
        return;
    }

    const divObj = divisions[selectedDivision];
    const bunksInDiv = (divObj.bunks || []).slice().sort(compareBunks);

    pane.innerHTML = "";

    // --- Header: name + color dot + quick stats ---
    const header = document.createElement("div");
    header.style.display = "flex";
    header.style.justifyContent = "space-between";
    header.style.alignItems = "center";
    header.style.borderBottom = "2px solid #f3f4f6";
    header.style.paddingBottom = "8px";
    header.style.marginBottom = "10px";

    const left = document.createElement("div");
    left.style.display = "flex";
    left.style.alignItems = "center";
    left.style.gap = "8px";

    const colorDot = document.createElement("span");
    colorDot.style.width = "14px";
    colorDot.style.height = "14px";
    colorDot.style.borderRadius = "999px";
    colorDot.style.background = divObj.color || "#9ca3af";
    colorDot.style.boxShadow = "0 0 0 2px rgba(148, 163, 184, 0.35)";

    const nameEl = document.createElement("h3");
    nameEl.style.margin = "0";
    nameEl.style.fontSize = "1.05rem";
    nameEl.textContent = selectedDivision;

    left.appendChild(colorDot);
    left.appendChild(nameEl);

    const right = document.createElement("div");
    right.style.fontSize = "0.8rem";
    right.style.color = "#6b7280";
    const bunkCount = bunksInDiv.length;
    const timesLabel = (divObj.startTime && divObj.endTime)
        ? `${divObj.startTime} – ${divObj.endTime}`
        : "Times not set";
    right.textContent = `${bunkCount} bunk${bunkCount === 1 ? "" : "s"} • ${timesLabel}`;

    header.appendChild(left);
    header.appendChild(right);
    pane.appendChild(header);

    // --- Card container ---
    const grid = document.createElement("div");
    grid.style.display = "flex";
    grid.style.flexWrap = "wrap";
    grid.style.gap = "12px";
    pane.appendChild(grid);

    // ========== CARD 1: DIVISION TIMES ==========
    const timesCard = document.createElement("div");
    timesCard.style.flex = "1 1 260px";
    timesCard.style.borderRadius = "12px";
    timesCard.style.border = "1px solid #e5e7eb";
    timesCard.style.background = "#f9fafb";
    timesCard.style.padding = "10px 12px";

    const timesHeader = document.createElement("div");
    timesHeader.style.display = "flex";
    timesHeader.style.justifyContent = "space-between";
    timesHeader.style.alignItems = "center";
    timesHeader.style.marginBottom = "6px";
    timesHeader.innerHTML = `
        <span style="font-size:0.78rem; text-transform:uppercase; letter-spacing:0.06em; color:#6b7280; font-weight:600;">
            Division Times
        </span>
        <span style="font-size:0.7rem; padding:2px 8px; border-radius:999px; background:#e0f2fe; color:#0369a1; font-weight:500;">
            Schedule grid
        </span>
    `;
    timesCard.appendChild(timesHeader);

    const timesHelp = document.createElement("p");
    timesHelp.style.margin = "0 0 8px";
    timesHelp.style.fontSize = "0.78rem";
    timesHelp.style.color = "#6b7280";
    timesHelp.textContent = "Set the daily time window this division is in camp. Used as the base for your schedule grid.";
    timesCard.appendChild(timesHelp);

    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.flexWrap = "wrap";
    row.style.gap = "6px";
    row.style.alignItems = "center";

    const startInput = document.createElement("input");
    startInput.type = "text";
    startInput.placeholder = "Start (e.g., 9:00am)";
    startInput.value = divObj.startTime || "";
    startInput.style.flex = "1 1 120px";

    const sep = document.createElement("span");
    sep.textContent = "to";
    sep.style.fontSize = "0.8rem";
    sep.style.color = "#6b7280";

    const endInput = document.createElement("input");
    endInput.type = "text";
    endInput.placeholder = "End (e.g., 4:30pm)";
    endInput.value = divObj.endTime || "";
    endInput.style.flex = "1 1 120px";

    const updateBtn = document.createElement("button");
    updateBtn.textContent = "Update";
    updateBtn.style.padding = "4px 10px";
    updateBtn.onclick = () => {
        const newStart = startInput.value.trim();
        const newEnd = endInput.value.trim();

        const startMin = parseTimeToMinutes(newStart);
        const endMin = parseTimeToMinutes(newEnd);

        if (startMin == null || endMin == null) {
            alert("Error: Invalid time format. Please use '9:00am' or '2:30pm'. Both 'am' or 'pm' are required.");
            return;
        }
        if (endMin <= startMin) {
            alert("Error: End time must be after start time.");
            return;
        }

        divObj.startTime = newStart;
        divObj.endTime = newEnd;
        saveData();

        // Re-render both sides
        setupDivisionButtons();
        if (document.getElementById('master-scheduler')?.classList.contains('active')) {
            window.initMasterScheduler?.();
        } else if (document.getElementById('daily-adjustments')?.classList.contains('active')) {
            window.initDailyAdjustments?.();
        }
    };

    row.appendChild(startInput);
    row.appendChild(sep);
    row.appendChild(endInput);
    row.appendChild(updateBtn);
    timesCard.appendChild(row);

    grid.appendChild(timesCard);

    // ========== CARD 2: BUNKS IN THIS DIVISION ==========
    const bunksCard = document.createElement("div");
    bunksCard.style.flex = "1 1 260px";
    bunksCard.style.borderRadius = "12px";
    bunksCard.style.border = "1px solid #e5e7eb";
    bunksCard.style.background = "#f9fafb";
    bunksCard.style.padding = "10px 12px";

    const bunksHeader = document.createElement("div");
    bunksHeader.style.display = "flex";
    bunksHeader.style.justifyContent = "space-between";
    bunksHeader.style.alignItems = "center";
    bunksHeader.style.marginBottom = "6px";
    bunksHeader.innerHTML = `
        <span style="font-size:0.78rem; text-transform:uppercase; letter-spacing:0.06em; color:#6b7280; font-weight:600;">
            Bunks in This Division
        </span>
        <span style="font-size:0.7rem; padding:2px 8px; border-radius:999px; background:#dcfce7; color:#166534; font-weight:500;">
            Add per division
        </span>
    `;
    bunksCard.appendChild(bunksHeader);

    const bunksHelp = document.createElement("p");
    bunksHelp.style.margin = "0 0 8px";
    bunksHelp.style.fontSize = "0.78rem";
    bunksHelp.style.color = "#6b7280";
    bunksHelp.innerHTML = `
        Add bunks directly to <strong>${selectedDivision}</strong> using the input below,
        or remove existing bunks with a click.
    `;
    bunksCard.appendChild(bunksHelp);

    const bunkWrap = document.createElement("div");
    bunkWrap.style.display = "flex";
    bunkWrap.style.flexWrap = "wrap";
    bunkWrap.style.gap = "6px";

    if (bunksInDiv.length === 0) {
        const empty = document.createElement("p");
        empty.style.margin = "4px 0 0";
        empty.style.fontSize = "0.8rem";
        empty.style.color = "#6b7280";
        empty.style.fontStyle = "italic";
        empty.textContent = "No bunks assigned yet.";
        bunksCard.appendChild(empty);
    } else {
        bunksInDiv.forEach(bunkName => {
            const pill = document.createElement("button");
            pill.textContent = bunkName;
            pill.className = "activity-button";
            pill.style.borderRadius = "999px";
            pill.style.fontSize = "0.78rem";

            pill.onclick = () => {
                if (!confirm(`Remove "${bunkName}" from ${selectedDivision}?`)) return;
                const idx = divObj.bunks.indexOf(bunkName);
                if (idx !== -1) {
                    divObj.bunks.splice(idx, 1);
                }
                saveData();
                updateUnassigned();
                renderDivisionDetailPane();
                window.updateTable?.();
            };

            bunkWrap.appendChild(pill);
        });
    }

    bunksCard.appendChild(bunkWrap);

    // --- NEW: Per-division "Add Bunk" input ---
    const addRow = document.createElement("div");
    addRow.style.display = "flex";
    addRow.style.flexWrap = "wrap";
    addRow.style.gap = "6px";
    addRow.style.alignItems = "center";
    addRow.style.marginTop = "10px";
    addRow.style.paddingTop = "8px";
    addRow.style.borderTop = "1px dashed #e5e7eb";

    const bunkInput = document.createElement("input");
    bunkInput.type = "text";
    bunkInput.placeholder = "Add bunk to this division (e.g., 5A)";
    bunkInput.style.flex = "1 1 160px";

    const bunkAddBtn = document.createElement("button");
    bunkAddBtn.textContent = "Add";
    bunkAddBtn.style.padding = "4px 10px";

    const handleAddBunkToDivision = () => {
        const val = bunkInput.value.trim();
        if (!val) return;
        window.addDivisionBunk?.(selectedDivision, val);
        bunkInput.value = "";
        updateUnassigned();
        renderDivisionDetailPane();
        window.updateTable?.();
    };

    bunkAddBtn.onclick = handleAddBunkToDivision;
    bunkInput.addEventListener("keyup", (e) => {
        if (e.key === "Enter") {
            handleAddBunkToDivision();
        }
    });

    addRow.appendChild(bunkInput);
    addRow.appendChild(bunkAddBtn);
    bunksCard.appendChild(addRow);

    grid.appendChild(bunksCard);
}

// Hook up the color checkbox
const enableColorEl = document.getElementById("enableColor");
if (enableColorEl) {
    enableColorEl.addEventListener("change", setupDivisionButtons);
}


// -------------------- Local Storage (UPDATED) --------------------
function saveData() {
    const app1Data = window.loadGlobalSettings?.().app1 || {};
    
    // Merge the existing app1 data with our current state
    const data = { 
        ...app1Data, // Keep other data fields may have added
        bunks, 
        divisions, 
        availableDivisions, 
        selectedDivision,
        // globalStartTime/EndTime REMOVED
        allSports,
        savedSkeletons,
        skeletonAssignments,
        specialActivities // NEW: Add special activities
    };
    window.saveGlobalSettings?.("app1", data);
}

function loadData() {
    const data = window.loadGlobalSettings?.().app1 || {};
    try {
        bunks = data.bunks || [];
        divisions = data.divisions || {};
        specialActivities = data.specialActivities || []; // NEW: Load special activities

        // --- NEW: Ensure old division data gets new time fields ---
        Object.keys(divisions).forEach(divName => {
            divisions[divName].startTime = divisions[divName].startTime || "";
            divisions[divName].endTime = divisions[divName].endTime || "";
            divisions[divName].bunks = divisions[divName].bunks || [];
        });
        // --- End new logic ---

        sortDivisionBunks();

        availableDivisions = (data.availableDivisions && Array.isArray(data.availableDivisions))
            ? data.availableDivisions.slice()
            : Object.keys(divisions);
        
        window.divisions = divisions;
        window.availableDivisions = availableDivisions;
        selectedDivision = data.selectedDivision || (availableDivisions[0] || null);
        
        // globalStartTime/EndTime REMOVED
        
        // NEW: Load master sports list
        if (data.allSports && Array.isArray(data.allSports)) {
            allSports = data.allSports;
        } else {
            // Not saved yet, initialize with defaults
            allSports = [...defaultSports];
        }
        
        // NEW: Load skeleton data
        savedSkeletons = data.savedSkeletons || {};
        skeletonAssignments = data.skeletonAssignments || {};
        
    } catch (e) { console.error("Error loading data:", e); }
}

// -------------------- Init (UPDATED) --------------------
function initApp1() {
    // --- BUNK LISTENERS ---
    const addBunkBtn = document.getElementById("addBunkBtn");
    if (addBunkBtn) addBunkBtn.onclick = addBunk;
    const bunkInput = document.getElementById("bunkInput");
    if (bunkInput) bunkInput.addEventListener("keyup", e => { if (e.key === "Enter") addBunk(); });
    
    // --- DIVISION LISTENERS ---
    const addDivisionBtn = document.getElementById("addDivisionBtn");
    if (addDivisionBtn) addDivisionBtn.onclick = addDivision;
    const divisionInput = document.getElementById("divisionInput");
    if (divisionInput) divisionInput.addEventListener("keyup", e => { if (e.key === "Enter") addDivision(); });

    // Load all data
    loadData();
    
    // Render all UI components
    updateUnassigned();
    setupDivisionButtons();
    renderDivisionDetailPane();
}
window.initApp1 = initApp1;


// Expose internal objects
window.getDivisions = () => divisions;

// --- NEW GLOBAL SPORT FUNCTIONS ---
/**
 * Returns a sorted list of all known sports.
 * @returns {string[]}
 */
window.getAllGlobalSports = function() {
    return (allSports || []).slice().sort();
}

/**
 * Adds a new sport to the master list if it doesn't exist.
 * @param {string} sportName
 */
window.addGlobalSport = function(sportName) {
    if (!sportName) return;
    const s = sportName.trim();
    if (s && !allSports.find(sport => sport.toLowerCase() === s.toLowerCase())) {
        allSports.push(s);
        saveData(); // Save the updated app1 data
    }
}

// --- NEW SKELETON MANAGEMENT FUNCTIONS ---
window.getSavedSkeletons = function() {
    return savedSkeletons || {};
}
window.saveSkeleton = function(name, skeletonData) {
    if (!name || !skeletonData) return;
    savedSkeletons[name] = skeletonData;
    saveData();
}
window.deleteSkeleton = function(name) {
    if (!name) return;
    delete savedSkeletons[name];
    // Also remove from assignments
    Object.keys(skeletonAssignments).forEach(day => {
        if (skeletonAssignments[day] === name) {
            delete skeletonAssignments[day];
        }
    });
    saveData();
}
window.getSkeletonAssignments = function() {
    return skeletonAssignments || {};
}
window.saveSkeletonAssignments = function(assignments) {
    if (!assignments) return;
    skeletonAssignments = assignments;
    saveData();
}

// --- FUNCTIONS FOR special_activities.js ---
window.getGlobalSpecialActivities = function() {
    return specialActivities;
}
window.saveGlobalSpecialActivities = function(updatedActivities) {
    specialActivities = updatedActivities;
    saveData();
}

// --- helper so UI can add a bunk into a division + persist it ---
window.addDivisionBunk = function (divisionName, bunkName) {
    if (!divisionName || !bunkName) return;
    const cleanDiv = String(divisionName).trim();
    const cleanBunk = String(bunkName).trim();
    if (!cleanDiv || !cleanBunk) return;

    // Make sure bunks[] contains it
    if (!bunks.includes(cleanBunk)) {
        bunks.push(cleanBunk);
    }

    // Make sure the division exists
    const div = divisions[cleanDiv];
    if (div) {
        if (!div.bunks.includes(cleanBunk)) {
            div.bunks.push(cleanBunk);
            div.bunks.sort(compareBunks);
        }
    }

    // Persist everything
    saveData();
    updateUnassigned();
    renderDivisionDetailPane();
};

})();
