// =================================================================
// app1.js
//
// UPDATED (DIVISIONS LIKE FIELDS):
// - Setup tab now mirrors Fields layout:
//   - Left: master list of Divisions (`#divisionButtons`) using .list-item.
//   - Right: detail pane (`#division-detail-pane`) for the selected division.
// - Division row NO LONGER contains time inputs; times + bunks live in the
//   right-hand detail pane.
// - Detail pane includes:
//   - Editable division name + Delete button
//   - Color picker
//   - Start/End time inputs with validation (am/pm required)
//   - Bunk list (edit + remove per bunk)
//   - Add-bunk input that saves globally + into that division.
// - Bunks and divisions are saved via globalSettings just like Fields.
//
// Special activities + skeleton logic remain intact.
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

const defaultColors = [
    '#4CAF50','#2196F3','#E91E63','#FF9800',
    '#9C27B0','#00BCD4','#FFC107','#F44336',
    '#8BC34A','#3F51B5'
];
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
        input.type = "text";
        input.value = old;
        el.replaceWith(input);
        input.focus();
        function done() {
            const val = input.value.trim();
            if (val && val !== old) save(val);
            el.textContent = val || old;
            input.replaceWith(el);
        }
        input.onblur = done;
        input.onkeyup = e => { if (e.key === "Enter") done(); };
    };
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

    if (!mer) return null; // AM/PM is required

    if (hh === 12) hh = (mer === "am") ? 0 : 12; // 12am -> 0, 12pm -> 12
    else if (mer === "pm") hh += 12;             // 1pm -> 13

    return hh * 60 + mm;
}
    // Sort helper: put "Bunk 1, Bunk 2, Bunk 10" in numeric order
function compareBunks(a, b) {
    const sa = String(a);
    const sb = String(b);

    const re = /(\d+)/;
    const ma = sa.match(re);
    const mb = sb.match(re);

    if (ma && mb) {
        const na = parseInt(ma[1], 10);
        const nb = parseInt(mb[1], 10);
        if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) {
            return na - nb;
        }
    }

    // Fallback: natural string compare
    return sa.localeCompare(sb, undefined, { numeric: true, sensitivity: "base" });
}

function sortBunksInPlace(arr) {
    if (!Array.isArray(arr)) return;
    arr.sort(compareBunks);
}


// Rename a bunk everywhere (global + all divisions + scheduleAssignments)
function renameBunkEverywhere(oldName, newName) {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName) return;

    // Prevent duplicate bunk names (case-insensitive)
    const exists = bunks.some(
        b => b.toLowerCase() === trimmed.toLowerCase() && b !== oldName
    );
    if (exists) {
        alert("Another bunk with this name already exists.");
        return;
    }

    const idx = bunks.indexOf(oldName);
    if (idx !== -1) bunks[idx] = trimmed;

    Object.values(divisions).forEach(d => {
        const bi = d.bunks.indexOf(oldName);
        if (bi !== -1) d.bunks[bi] = trimmed;
    });

    if (window.scheduleAssignments && window.scheduleAssignments[oldName]) {
        window.scheduleAssignments[trimmed] = window.scheduleAssignments[oldName];
        delete window.scheduleAssignments[oldName];
        window.saveCurrentDailyData?.("scheduleAssignments", window.scheduleAssignments);
    }

    saveData();
    renderDivisionDetailPane();
    window.updateTable?.();
}

// -------------------- Bunks (logic only; UI is in detail pane) --------------------
function addBunkToDivision(divName, bunkName) {
    if (!divName || !bunkName) return;
    const cleanDiv = String(divName).trim();
    const cleanBunk = String(bunkName).trim();
    if (!cleanDiv || !cleanBunk) return;

    // Make sure bunks[] contains it
    if (!bunks.includes(cleanBunk)) {
        bunks.push(cleanBunk);
    }

    const div = divisions[cleanDiv];
    if (div) {
        if (!div.bunks.includes(cleanBunk)) {
            div.bunks.push(cleanBunk);
        }
    }

    saveData();
    renderDivisionDetailPane();
    window.updateTable?.();
}

// -------------------- Divisions --------------------
function addDivision() {
    const i = document.getElementById("divisionInput");
    if (!i) return;
    const raw = i.value.trim();
    if (!raw) return;

    const name = raw;
    if (availableDivisions.includes(name)) {
        alert("That division already exists.");
        i.value = "";
        return;
    }

    const color = defaultColors[colorIndex % defaultColors.length];
    colorIndex++;

    availableDivisions.push(name);
    window.availableDivisions = availableDivisions;

    divisions[name] = {
        bunks: [],
        color,
        startTime: "",
        endTime: ""
    };
    window.divisions = divisions;

    selectedDivision = name;

    i.value = "";
    saveData();
    setupDivisionButtons();
    renderDivisionDetailPane();
    window.initLeaguesTab?.();
    window.updateTable?.();
}

/**
 * LEFT SIDE: Master list of Divisions (Fields-style).
 */
function setupDivisionButtons() {
    const cont = document.getElementById("divisionButtons");
    if (!cont) return;
    cont.innerHTML = "";

    if (!availableDivisions || availableDivisions.length === 0) {
        cont.innerHTML = `<p class="muted">No divisions created yet. Add one above.</p>`;
        renderDivisionDetailPane();
        return;
    }

    const colorEnabledEl = document.getElementById("enableColor");
    const colorEnabled = colorEnabledEl ? colorEnabledEl.checked : true;

    availableDivisions.forEach(name => {
        const obj = divisions[name];
        if (!obj) {
            console.warn(`Data mismatch: Division "${name}" exists in availableDivisions but not in divisions object.`);
            return;
        }

        const item = document.createElement("div");
        item.className = "list-item";
        if (selectedDivision === name) item.classList.add("selected");

        item.onclick = () => {
            selectedDivision = name;
            saveData();
            setupDivisionButtons();
            renderDivisionDetailPane();
        };

        const nameEl = document.createElement("span");
        nameEl.className = "list-item-name";
        nameEl.textContent = name;

        if (colorEnabled) {
            nameEl.style.borderLeft = `8px solid ${obj.color || "#007bff"}`;
            nameEl.style.paddingLeft = "8px";
        }

        makeEditable(nameEl, newName => {
            const trimmed = newName.trim();
            if (!trimmed || trimmed === name) return;

            if (divisions[trimmed]) {
                alert("A division with this name already exists.");
                return;
            }

            divisions[trimmed] = divisions[name];
            delete divisions[name];

            const idx = availableDivisions.indexOf(name);
            if (idx !== -1) availableDivisions[idx] = trimmed;

            if (selectedDivision === name) selectedDivision = trimmed;

            window.divisions = divisions;
            window.availableDivisions = availableDivisions;
            saveData();
            setupDivisionButtons();
            renderDivisionDetailPane();
            window.initLeaguesTab?.();
            window.updateTable?.();
        });

        item.appendChild(nameEl);
        cont.appendChild(item);
    });

    // Ensure detail pane reflects the current selection
    renderDivisionDetailPane();
}

/**
 * RIGHT SIDE: Detail pane for selected division.
 * Includes name, delete, color, start/end time, and bunk list.
 */
function renderDivisionDetailPane() {
    const pane = document.getElementById("division-detail-pane");
    if (!pane) return;

    pane.innerHTML = "";

    if (!selectedDivision || !divisions[selectedDivision]) {
        pane.innerHTML = `
            <p class="muted">
                Select a division from the left to edit its details.
                <br>Here you will be able to:
                <br>• Set <strong>start / end times</strong> for the division
                <br>• Add / edit <strong>bunks</strong> in this division
                <br>• Adjust the division color
            </p>
        `;
        return;
    }

    const divObj = divisions[selectedDivision];

    // --- Header: Name + Delete ---
    const header = document.createElement("div");
    header.style.display = "flex";
    header.style.justifyContent = "space-between";
    header.style.alignItems = "center";
    header.style.borderBottom = "2px solid #eee";
    header.style.paddingBottom = "10px";
    header.style.marginBottom = "15px";

    const title = document.createElement("h3");
    title.style.margin = "0";
    title.textContent = selectedDivision;

    makeEditable(title, newName => {
        const trimmed = newName.trim();
        const old = selectedDivision;
        if (!trimmed || trimmed === old) return;
        if (divisions[trimmed]) {
            alert("A division with this name already exists.");
            return;
        }

        divisions[trimmed] = divisions[old];
        delete divisions[old];

        const idx = availableDivisions.indexOf(old);
        if (idx !== -1) availableDivisions[idx] = trimmed;

        selectedDivision = trimmed;
        window.divisions = divisions;
        window.availableDivisions = availableDivisions;
        saveData();
        setupDivisionButtons();
        renderDivisionDetailPane();
        window.initLeaguesTab?.();
        window.updateTable?.();
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.textContent = "Delete Division";
    deleteBtn.style.background = "#c0392b";
    deleteBtn.style.color = "white";
    deleteBtn.style.border = "none";
    deleteBtn.style.padding = "6px 10px";
    deleteBtn.style.borderRadius = "4px";
    deleteBtn.style.cursor = "pointer";
    deleteBtn.onclick = () => {
        if (!confirm(`Delete division "${selectedDivision}"? Bunks will remain globally but will no longer belong to this division.`)) {
            return;
        }
        const name = selectedDivision;
        delete divisions[name];
        const idx = availableDivisions.indexOf(name);
        if (idx !== -1) availableDivisions.splice(idx, 1);
        selectedDivision = availableDivisions[0] || null;
        window.divisions = divisions;
        window.availableDivisions = availableDivisions;
        saveData();
        setupDivisionButtons();
        renderDivisionDetailPane();
        window.initLeaguesTab?.();
        window.updateTable?.();
    };

    header.appendChild(title);
    header.appendChild(deleteBtn);
    pane.appendChild(header);

    // --- Division Color ---
    const colorRow = document.createElement("div");
    colorRow.style.display = "flex";
    colorRow.style.alignItems = "center";
    colorRow.style.gap = "10px";
    colorRow.style.marginBottom = "15px";

    const colorLabel = document.createElement("span");
    colorLabel.textContent = "Division Color:";
    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.value = divObj.color || "#007bff";
    colorInput.oninput = e => {
        divObj.color = e.target.value;
        saveData();
        setupDivisionButtons(); // Repaint left list color stripes
        window.updateTable?.();
    };

    colorRow.appendChild(colorLabel);
    colorRow.appendChild(colorInput);
    pane.appendChild(colorRow);

    // --- Start/End Time Section ---
    const timeSection = document.createElement("div");
    timeSection.style.marginBottom = "20px";

    const timeTitle = document.createElement("strong");
    timeTitle.textContent = "Division Day Times:";
    timeSection.appendChild(timeTitle);

    const timeForm = document.createElement("div");
    timeForm.style.display = "flex";
    timeForm.style.alignItems = "center";
    timeForm.style.gap = "6px";
    timeForm.style.marginTop = "8px";

    const startInput = document.createElement("input");
    startInput.type = "text";
    startInput.placeholder = "Start (e.g., 9:00am)";
    startInput.value = divObj.startTime || "";
    startInput.style.width = "130px";

    const toLabel = document.createElement("span");
    toLabel.textContent = "to";

    const endInput = document.createElement("input");
    endInput.type = "text";
    endInput.placeholder = "End (e.g., 4:30pm)";
    endInput.value = divObj.endTime || "";
    endInput.style.width = "130px";

    const updateBtn = document.createElement("button");
    updateBtn.textContent = "Update Times";
    updateBtn.style.padding = "4px 8px";

    updateBtn.onclick = () => {
        const newStart = startInput.value.trim();
        const newEnd = endInput.value.trim();

        const startMin = parseTimeToMinutes(newStart);
        const endMin = parseTimeToMinutes(newEnd);

        if (startMin == null || endMin == null) {
            alert("Invalid time format. Use '9:00am' or '2:30pm'. AM/PM is required.");
            return;
        }
        if (endMin <= startMin) {
            alert("End time must be after start time.");
            return;
        }

        divObj.startTime = newStart;
        divObj.endTime = newEnd;
        saveData();

        // Refresh any time-based views
        if (document.getElementById('master-scheduler')?.classList.contains('active')) {
            window.initMasterScheduler?.();
        } else if (document.getElementById('daily-adjustments')?.classList.contains('active')) {
            window.initDailyAdjustments?.();
        }
    };

    timeForm.appendChild(startInput);
    timeForm.appendChild(toLabel);
    timeForm.appendChild(endInput);
    timeForm.appendChild(updateBtn);
    timeSection.appendChild(timeForm);
    pane.appendChild(timeSection);

    // --- Bunks Section ---
    const bunksSection = document.createElement("div");
    const bunksTitle = document.createElement("strong");
    bunksTitle.textContent = "Bunks in this Division:";
    bunksSection.appendChild(bunksTitle);

    const bunkList = document.createElement("div");
    bunkList.style.marginTop = "8px";
    bunkList.style.display = "flex";
    bunkList.style.flexWrap = "wrap";
    bunkList.style.gap = "6px";

    if (!divObj.bunks || divObj.bunks.length === 0) {
        const msg = document.createElement("p");
        msg.className = "muted";
        msg.style.margin = "4px 0 0 0";
        msg.textContent = "No bunks assigned yet. Add one below.";
        bunksSection.appendChild(msg);
    } else {
        divObj.bunks.forEach(bunkName => {
            const chip = document.createElement("span");
            chip.textContent = bunkName;
            chip.style.padding = "4px 8px";
            chip.style.borderRadius = "12px";
            chip.style.border = "1px solid #ccc";
            chip.style.cursor = "pointer";
            chip.style.background = "#f0f0f0";
            chip.style.display = "inline-flex";
            chip.style.alignItems = "center";
            chip.style.gap = "4px";

            // Editable name (double-click)
            makeEditable(chip, newName => {
                renameBunkEverywhere(bunkName, newName);
            });

            // Remove from THIS division (X button)
            const xBtn = document.createElement("button");
            xBtn.textContent = "×";
            xBtn.style.border = "none";
            xBtn.style.background = "transparent";
            xBtn.style.cursor = "pointer";
            xBtn.style.fontSize = "14px";
            xBtn.onclick = e => {
                e.stopPropagation();
                const idx = divObj.bunks.indexOf(bunkName);
                if (idx !== -1) divObj.bunks.splice(idx, 1);
                saveData();
                renderDivisionDetailPane();
                window.updateTable?.();
            };

            chip.appendChild(xBtn);
            bunkList.appendChild(chip);
        });
    }

    bunksSection.appendChild(bunkList);

    // Add-bunk row
    const addRow = document.createElement("div");
    addRow.style.marginTop = "10px";
    addRow.style.display = "flex";
    addRow.style.gap = "6px";

    const addInput = document.createElement("input");
    addInput.type = "text";
    addInput.placeholder = "Add bunk (e.g., Bunk 1)";
    addInput.style.flex = "1";

    const addBtn = document.createElement("button");
    addBtn.textContent = "Add Bunk";
    addBtn.onclick = () => {
        const name = addInput.value.trim();
        if (!name) return;
        addBunkToDivision(selectedDivision, name);
        addInput.value = "";
    };

    addInput.onkeyup = e => {
        if (e.key === "Enter") {
            const name = addInput.value.trim();
            if (!name) return;
            addBunkToDivision(selectedDivision, name);
            addInput.value = "";
        }
    };

    addRow.appendChild(addInput);
    addRow.appendChild(addBtn);
    bunksSection.appendChild(addRow);

    pane.appendChild(bunksSection);
}

// -------------------- Local Storage (UPDATED) --------------------
function saveData() {
    const app1Data = window.loadGlobalSettings?.().app1 || {};
    
    const data = { 
        ...app1Data,
        bunks,
        divisions,
        availableDivisions,
        selectedDivision,
        allSports,
        savedSkeletons,
        skeletonAssignments,
        specialActivities
    };
    window.saveGlobalSettings?.("app1", data);
}

function loadData() {
    const data = window.loadGlobalSettings?.().app1 || {};
    try {
        bunks = data.bunks || [];
        divisions = data.divisions || {};
        specialActivities = data.specialActivities || [];

        // Ensure time fields exist on old data
        Object.keys(divisions).forEach(divName => {
    divisions[divName].startTime = divisions[divName].startTime || "";
    divisions[divName].endTime = divisions[divName].endTime || "";
    divisions[divName].bunks = divisions[divName].bunks || [];
    sortBunksInPlace(divisions[divName].bunks);
    divisions[divName].color = divisions[divName].color || defaultColors[0];
});


        availableDivisions = (data.availableDivisions && Array.isArray(data.availableDivisions))
            ? data.availableDivisions.slice()
            : Object.keys(divisions);

        window.divisions = divisions;
        window.availableDivisions = availableDivisions;
        selectedDivision = data.selectedDivision || availableDivisions[0] || null;

        // Master sports list
        if (data.allSports && Array.isArray(data.allSports)) {
            allSports = data.allSports;
        } else {
            allSports = [...defaultSports];
        }

        // Skeleton data
        savedSkeletons = data.savedSkeletons || {};
        skeletonAssignments = data.skeletonAssignments || {};

    } catch (e) {
        console.error("Error loading data:", e);
    }
}

// -------------------- Init (UPDATED) --------------------
function initApp1() {
    // DIVISION LISTENERS (top of Setup tab)
    const addDivisionBtn = document.getElementById("addDivisionBtn");
    if (addDivisionBtn) addDivisionBtn.onclick = addDivision;

    const divisionInput = document.getElementById("divisionInput");
    if (divisionInput) {
        divisionInput.addEventListener("keyup", e => {
            if (e.key === "Enter") addDivision();
        });
    }

    loadData();

    // Ensure color checkbox re-renders list when toggled
    const enableColorEl = document.getElementById("enableColor");
    if (enableColorEl) {
        enableColorEl.onchange = setupDivisionButtons;
    }

    setupDivisionButtons();
    renderDivisionDetailPane();
}
window.initApp1 = initApp1;

// Expose internal objects
window.getDivisions = () => divisions;

// --- GLOBAL SPORT FUNCTIONS ---
window.getAllGlobalSports = function() {
    return (allSports || []).slice().sort();
};

window.addGlobalSport = function(sportName) {
    if (!sportName) return;
    const s = sportName.trim();
    if (s && !allSports.find(sp => sp.toLowerCase() === s.toLowerCase())) {
        allSports.push(s);
        saveData();
    }
};

// --- SKELETON MANAGEMENT FUNCTIONS ---
window.getSavedSkeletons = function() {
    return savedSkeletons || {};
};
window.saveSkeleton = function(name, skeletonData) {
    if (!name || !skeletonData) return;
    savedSkeletons[name] = skeletonData;
    saveData();
};
window.deleteSkeleton = function(name) {
    if (!name) return;
    delete savedSkeletons[name];
    Object.keys(skeletonAssignments).forEach(day => {
        if (skeletonAssignments[day] === name) {
            delete skeletonAssignments[day];
        }
    });
    saveData();
};
window.getSkeletonAssignments = function() {
    return skeletonAssignments || {};
};
window.saveSkeletonAssignments = function(assignments) {
    if (!assignments) return;
    skeletonAssignments = assignments;
    saveData();
};

// --- special_activities.js integration ---
window.getGlobalSpecialActivities = function() {
    return specialActivities;
};
window.saveGlobalSpecialActivities = function(updatedActivities) {
    specialActivities = updatedActivities;
    saveData();
};

// Keep the helper exposed (used elsewhere)
window.addDivisionBunk = addBunkToDivision;

})();
