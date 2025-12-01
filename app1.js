// =================================================================
// app1.js
//
// UPDATED FOR BULK IMPORT/EXPORT & CAPACITY METADATA
// - Adds bunkMetaData (size) & sportMetaData (max capacity).
// - Adds CSV Template Download & Smart Import logic.
// - Auto-creates Divisions/Bunks from CSV.
// - Injects "Bulk Data & Capacity" UI card into the setup grid.
// =================================================================

(function () {
  "use strict";

  // -------------------- State --------------------
  let bunks = [];
  let divisions = {}; // { divName:{ bunks:[], color, startTime, endTime } }
  let specialActivities = [];

  let availableDivisions = [];
  let selectedDivision = null;

  // NEW: Metadata storage
  let bunkMetaData = {};   // { "Bunk 1": { size: 15 } }
  let sportMetaData = {};  // { "Basketball": { maxCapacity: 20 } }

  // Master list of all sports
  let allSports = [];
  const defaultSports = [
    "Baseball", "Basketball", "Football", "Hockey", "Kickball",
    "Lacrosse", "Newcomb", "Punchball", "Soccer", "Volleyball",
  ];

  let savedSkeletons = {};
  let skeletonAssignments = {}; 

  const defaultColors = [
    "#00C896", "#0094FF", "#FF7C3B", "#8A5DFF", "#B5FF3F",
    "#FF4D4D", "#00A67C", "#6366F1", "#F97316", "#10B981"
  ];
  let colorIndex = 0;

  // Expose to window
  window.divisions = divisions;
  window.availableDivisions = availableDivisions;
  
  // Expose metadata getters for Scheduler Core
  window.getBunkMetaData = () => bunkMetaData;
  window.getSportMetaData = () => sportMetaData;

  // -------------------- Shared Theme Helpers --------------------
  function ensureSharedSetupStyles() {
    if (document.getElementById("setup-shared-styles")) return;

    const style = document.createElement("style");
    style.id = "setup-shared-styles";
    style.textContent = `
        /* Global Setup Shell */
        .detail-pane {
            border-radius: 18px;
            border: 1px solid #E5E7EB;
            padding: 18px 20px;
            background: linear-gradient(135deg, #F7F9FA 0%, #FFFFFF 55%, #F7F9FA 100%);
            min-height: 360px;
            box-shadow: 0 18px 40px rgba(15, 23, 42, 0.06);
        }
        /* Division list cards */
        .division-card {
            border-radius: 18px;
            border: 1px solid #E5E7EB;
            background: #FFFFFF;
            padding: 10px 16px;
            margin: 8px 0;
            box-shadow: 0 8px 18px rgba(15, 23, 42, 0.06);
            cursor: pointer;
            transition: all 0.16s ease;
        }
        .division-card:hover { transform: translateY(-1px); background-color: #F9FAFB; }
        .division-card.selected {
            border-color: #00C896;
            box-shadow: 0 0 0 1px rgba(0, 200, 150, 0.55);
            background: radial-gradient(circle at top left, #ECFDF5 0, #FFFFFF 65%);
        }
        /* Pills */
        .division-pill {
            padding: 4px 16px; border-radius: 999px; color: #FFFFFF; font-weight: 600;
            font-size: 0.9rem; min-width: 32px; display: flex; justify-content: center;
            align-items: center; box-shadow: 0 4px 10px rgba(15, 23, 42, 0.22);
        }
        .division-color-chip-list {
            width: 22px; height: 22px; border-radius: 6px;
            border: 1px solid rgba(15, 23, 42, 0.12); box-shadow: 0 2px 6px rgba(15, 23, 42, 0.15);
        }
        .division-card-subline { font-size: 0.8rem; color: #6B7280; }
        
        /* Bunk pills */
        .division-bunk-pill {
            padding: 4px 10px; border-radius: 999px; border: 1px solid #D1D5DB;
            background: #FFFFFF; color: #374151; font-size: 0.8rem; cursor: pointer;
            display: inline-flex; align-items: center; justify-content: center;
            box-shadow: 0 1px 3px rgba(15, 23, 42, 0.1);
            transition: all 0.12s ease;
        }
        .division-bunk-pill:hover { background-color: #F3F4F6; transform: translateY(-0.5px); }
        .bunk-size-badge {
            background: #E5E7EB; color: #374151; border-radius: 4px; padding: 0 4px;
            font-size: 0.7rem; margin-left: 6px; font-weight: 600;
        }

        /* Division detail inner layout */
        .division-edit-shell { padding: 4px 0 0; border: none; background: transparent; }
        .division-edit-header { display: flex; justify-content: space-between; align-items: baseline; padding-bottom: 10px; border-bottom: 1px solid #E5E7EB; margin-bottom: 14px; }
        .division-header-left { display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 0.98rem; color: #111827; }
        .division-status-dot { width: 11px; height: 11px; border-radius: 999px; background: #00C896; box-shadow: 0 0 0 4px rgba(0, 200, 150, 0.25); }
        .division-header-summary { font-size: 0.8rem; color: #6B7280; text-align: right; }
        .division-edit-grid { display: flex; flex-wrap: wrap; gap: 20px; margin-top: 6px; }
        
        .division-mini-card { flex: 1 1 280px; border-radius: 16px; background: #FFFFFF; border: 1px solid #E5E7EB; padding: 12px 14px 14px; box-shadow: 0 8px 20px rgba(15, 23, 42, 0.05); }
        .division-mini-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; padding-bottom: 6px; font-size: 0.78rem; text-transform: uppercase; color: #6B7280; font-weight: 600; border-bottom: 1px solid rgba(148, 163, 184, 0.4); }
        .division-mini-pill { padding: 4px 12px; border-radius: 999px; background: #ECFDF5; color: #047857; font-size: 0.7rem; border: none; font-weight: 500; }
        .division-mini-help { margin: 0 0 10px; font-size: 0.78rem; color: #6B7280; }
        .muted { color: #6B7280; font-size: 0.86rem; }

        /* Sports Modal */
        .sports-modal-overlay {
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.5); z-index: 9999;
            display: flex; justify-content: center; align-items: center;
        }
        .sports-modal {
            background: white; width: 600px; max-height: 85vh; border-radius: 12px;
            padding: 20px; overflow-y: auto; box-shadow: 0 10px 40px rgba(0,0,0,0.3);
        }
        .sports-row {
            display: flex; justify-content: space-between; align-items: center;
            padding: 8px 0; border-bottom: 1px solid #eee;
        }
        .sports-row input { width: 80px; text-align: center; border:1px solid #ccc; border-radius:4px; padding:4px;}
    `;
    document.head.appendChild(style);
  }

  // -------------------- Helpers --------------------
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
    if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
    if (mer) {
      if (hh === 12) hh = mer === "am" ? 0 : 12;
      else if (mer === "pm") hh += 12;
    }
    return hh * 60 + mm;
  }

  function compareBunks(a, b) {
    const sa = String(a); const sb = String(b);
    const re = /(\d+)/;
    const ma = sa.match(re); const mb = sb.match(re);
    if (ma && mb) {
      const na = parseInt(ma[1], 10); const nb = parseInt(mb[1], 10);
      if (na !== nb) return na - nb;
    }
    return sa.localeCompare(sb, undefined, { numeric: true, sensitivity: "base" });
  }

  function sortBunksInPlace(arr) { if (Array.isArray(arr)) arr.sort(compareBunks); }

  // -------------------- Core Logic: Divisions & Bunks --------------------
  
  // Programmatic create division (separated from UI)
  function createDivision(name) {
    if (availableDivisions.includes(name)) return false;
    
    availableDivisions.push(name);
    divisions[name] = { 
        bunks: [], 
        color: defaultColors[colorIndex++ % defaultColors.length], 
        startTime: "", 
        endTime: "" 
    };
    window.availableDivisions = availableDivisions;
    window.divisions = divisions;
    return true;
  }

  // UI trigger for create division
  function addDivision() {
    const i = document.getElementById("divisionInput");
    if (!i) return;
    const name = i.value.trim();
    if (!name) return;

    if (!createDivision(name)) {
        alert("That division already exists.");
        i.value = "";
        return;
    }

    selectedDivision = name;
    i.value = "";
    saveData();
    setupDivisionButtons();
    renderDivisionDetailPane();
    window.initLeaguesTab?.();
    window.updateTable?.();
  }

  function addBunkToDivision(divName, bunkName) {
    if (!divName || !bunkName) return;
    const cleanBunk = String(bunkName).trim();
    if (!bunks.includes(cleanBunk)) bunks.push(cleanBunk);
    
    const div = divisions[divName];
    if (div && !div.bunks.includes(cleanBunk)) {
      div.bunks.push(cleanBunk);
      sortBunksInPlace(div.bunks);
    }
    
    // Initialize default metadata if missing
    if(!bunkMetaData[cleanBunk]) bunkMetaData[cleanBunk] = { size: 0 };

    saveData();
    renderDivisionDetailPane();
    window.updateTable?.();
  }

  function renameBunkEverywhere(oldName, newName, newSize) {
    const trimmed = newName.trim();
    if (!trimmed) return;

    // Update Size Metadata
    const sizeVal = parseInt(newSize) || 0;
    
    // Case 1: Name unchanged, just update size
    if (trimmed === oldName) {
        if (!bunkMetaData[trimmed]) bunkMetaData[trimmed] = {};
        bunkMetaData[trimmed].size = sizeVal;
        saveData();
        renderDivisionDetailPane();
        return;
    }

    // Case 2: Rename logic
    const exists = bunks.some(b => b.toLowerCase() === trimmed.toLowerCase() && b !== oldName);
    if (exists) { alert("Bunk name exists."); return; }

    // Update Master list
    const idx = bunks.indexOf(oldName);
    if (idx !== -1) bunks[idx] = trimmed;

    // Update Division lists
    Object.values(divisions).forEach((d) => {
      const bi = d.bunks.indexOf(oldName);
      if (bi !== -1) d.bunks[bi] = trimmed;
      sortBunksInPlace(d.bunks);
    });

    // Update Schedule History
    if (window.scheduleAssignments && window.scheduleAssignments[oldName]) {
      window.scheduleAssignments[trimmed] = window.scheduleAssignments[oldName];
      delete window.scheduleAssignments[oldName];
      window.saveCurrentDailyData?.("scheduleAssignments", window.scheduleAssignments);
    }

    // Update Metadata Key
    bunkMetaData[trimmed] = { size: sizeVal };
    delete bunkMetaData[oldName];

    saveData();
    renderDivisionDetailPane();
    window.updateTable?.();
  }

  // -------------------- CSV IMPORT / EXPORT LOGIC --------------------

  function downloadTemplate() {
    let csv = "Division,Bunk Name,Camper Count\n";
    
    if (availableDivisions.length === 0) {
        // Sample data if empty
        csv += "Junior,Bunk 1,12\nJunior,Bunk 2,14\nSenior,Bunk A,18\n";
    } else {
        availableDivisions.forEach(divName => {
            const div = divisions[divName];
            if (div && div.bunks && div.bunks.length > 0) {
                div.bunks.forEach(bunk => {
                    const meta = bunkMetaData[bunk] || {};
                    const size = meta.size || 0;
                    csv += `"${divName}","${bunk}",${size}\n`;
                });
            } else {
                // Division with no bunks
                csv += `"${divName}","",\n`;
            }
        });
    }

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.setAttribute('hidden', '');
    a.setAttribute('href', url);
    a.setAttribute('download', 'camp_setup_template.csv');
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function handleBulkImport(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        const text = e.target.result;
        const lines = text.split('\n');
        
        let addedDivs = 0;
        let addedBunks = 0;
        let updatedSizes = 0;

        // Skip Header (Line 0)
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            
            // Simple CSV split (handling quotes crudely but effectively for this usage)
            // Assumes "Division","Bunk","Size" format or simple Division,Bunk,Size
            const parts = line.split(',').map(s => s.replace(/^"|"$/g, '').trim());
            
            if (parts.length < 2) continue;
            
            const divName = parts[0];
            const bunkName = parts[1];
            const size = parseInt(parts[2]) || 0;

            if (divName) {
                if (createDivision(divName)) addedDivs++;
                
                if (bunkName) {
                    // Logic to check if bunk exists handled in addBunkToDivision
                    // We only count if it's new logic, but simple is fine:
                    if (!bunks.includes(bunkName)) addedBunks++;
                    
                    addBunkToDivision(divName, bunkName);
                    
                    if (!bunkMetaData[bunkName]) bunkMetaData[bunkName] = {};
                    bunkMetaData[bunkName].size = size;
                    updatedSizes++;
                }
            }
        }

        saveData();
        setupDivisionButtons();
        renderDivisionDetailPane();
        alert(`Import Complete!\nAdded Divisions: ${addedDivs}\nAdded Bunks: ${addedBunks}\nUpdated Metadata: ${updatedSizes}`);
    };
    reader.readAsText(file);
  }

  // -------------------- UI: Sports Rules Modal --------------------
  function showSportsRulesModal() {
    const overlay = document.createElement("div");
    overlay.className = "sports-modal-overlay";
    
    const modal = document.createElement("div");
    modal.className = "sports-modal";
    
    modal.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
            <h2 style="margin:0; color:#111827;">Sports Capacity Rules</h2>
            <button id="close-sports-modal" style="border:none; background:none; font-size:1.5rem; cursor:pointer;">&times;</button>
        </div>
        <p class="muted" style="margin-bottom:15px;">
            Set the <strong>Max Combined Players</strong> allowed for each sport. 
            <br>Example: If Basketball has a limit of <strong>30</strong>, two bunks with 20 kids each (Total 40) cannot play each other.
            <br>Leave blank or 0 for unlimited.
        </p>
        <div id="sports-rules-list"></div>
        <div style="margin-top:20px; text-align:right;">
            <button id="save-sports-rules" style="background:#00C896; color:white; padding:8px 20px; border:none; border-radius:999px; cursor:pointer;">Save Rules</button>
        </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const list = modal.querySelector("#sports-rules-list");
    const sortedSports = [...allSports].sort();

    sortedSports.forEach(sport => {
        const row = document.createElement("div");
        row.className = "sports-row";
        const meta = sportMetaData[sport] || {};
        const cap = meta.maxCapacity || "";

        row.innerHTML = `
            <strong>${sport}</strong>
            <div>
                <span style="font-size:0.8rem; margin-right:5px;">Max Kids:</span>
                <input type="number" class="sport-cap-input" data-sport="${sport}" value="${cap}" placeholder="∞">
            </div>
        `;
        list.appendChild(row);
    });

    modal.querySelector("#close-sports-modal").onclick = () => overlay.remove();
    modal.querySelector("#save-sports-rules").onclick = () => {
        modal.querySelectorAll(".sport-cap-input").forEach(input => {
            const s = input.dataset.sport;
            const val = parseInt(input.value);
            if (!sportMetaData[s]) sportMetaData[s] = {};
            sportMetaData[s].maxCapacity = (val > 0) ? val : null;
        });
        saveData();
        overlay.remove();
    };
  }

  // -------------------- UI: Bulk Import/Export Card --------------------
  function renderBulkImportUI() {
    // Check if we already rendered it
    if (document.getElementById("bulk-data-card")) return;

    // Find the setup grid to append to
    const grid = document.querySelector(".setup-grid");
    if (!grid) return;

    const card = document.createElement("section");
    card.className = "setup-card setup-card-wide";
    card.id = "bulk-data-card";
    
    card.innerHTML = `
        <div class="setup-card-header">
            <div class="setup-step-pill" style="background:#8A5DFF; color:white;">Bulk Data & Capacity</div>
            <div class="setup-card-text">
                <h3>Bulk Import & Sport Rules</h3>
                <p>Upload your roster from Excel or define sport capacity limits.</p>
            </div>
        </div>
        
        <div style="display:flex; flex-wrap:wrap; gap:20px; align-items:center; margin-top:15px;">
            
            <div style="flex:1; border:1px solid #E5E7EB; padding:15px; border-radius:12px;">
                <h4 style="margin:0 0 10px;">1. Sports Constraints</h4>
                <p class="muted">Define max players per sport (e.g. Basketball = 30).</p>
                <button id="btn-manage-sports" style="background:#00C896; color:white; border:none; padding:8px 16px; border-radius:999px; cursor:pointer;">
                    Manage Sports Rules
                </button>
            </div>

            <div style="flex:1; border:1px solid #E5E7EB; padding:15px; border-radius:12px;">
                <h4 style="margin:0 0 10px;">2. Bulk Data Import</h4>
                <p class="muted">Download template, fill in Excel, and upload to create Divisions/Bunks instantly.</p>
                <div style="display:flex; gap:10px;">
                    <button id="btn-download-template" style="background:#fff; border:1px solid #ccc; color:#333; padding:8px 16px; border-radius:999px; cursor:pointer;">
                        Download Template
                    </button>
                    <button id="btn-trigger-upload" style="background:#0094FF; color:white; border:none; padding:8px 16px; border-radius:999px; cursor:pointer;">
                        Import Data
                    </button>
                    <input type="file" id="bulk-upload-input" accept=".csv" style="display:none;">
                </div>
            </div>

        </div>
    `;

    grid.appendChild(card);

    // Bind Events
    card.querySelector("#btn-manage-sports").onclick = showSportsRulesModal;
    card.querySelector("#btn-download-template").onclick = downloadTemplate;
    
    const upBtn = card.querySelector("#btn-trigger-upload");
    const upInput = card.querySelector("#bulk-upload-input");
    
    upBtn.onclick = () => upInput.click();
    upInput.onchange = (e) => {
        if (e.target.files.length > 0) {
            handleBulkImport(e.target.files[0]);
            e.target.value = ""; // reset
        }
    };
  }

  // -------------------- UI: Division Detail (Standard) --------------------
  function renderDivisionDetailPane() {
    const pane = document.getElementById("division-detail-pane");
    if (!pane) return;
    pane.innerHTML = "";

    if (!selectedDivision || !divisions[selectedDivision]) {
      pane.innerHTML = `<p class="muted">Click a division on the left to edit.</p>`;
      return;
    }

    const divObj = divisions[selectedDivision];

    // Header
    const header = document.createElement("div");
    header.style.cssText = "display:flex; justify-content:space-between; align-items:center; border-bottom:2px solid #E5E7EB; padding-bottom:8px; margin-bottom:10px;";
    
    const title = document.createElement("h3");
    title.textContent = selectedDivision;
    title.style.margin = "0";
    
    const deleteBtn = document.createElement("button");
    deleteBtn.textContent = "Delete Division";
    deleteBtn.style.cssText = "background:#fff; color:#DC2626; border:1px solid #FECACA; padding:4px 12px; border-radius:999px; cursor:pointer;";
    deleteBtn.onclick = () => {
        if(confirm("Delete division?")) {
            delete divisions[selectedDivision];
            const idx = availableDivisions.indexOf(selectedDivision);
            if(idx !== -1) availableDivisions.splice(idx,1);
            selectedDivision = availableDivisions[0] || null;
            saveData();
            setupDivisionButtons();
            renderDivisionDetailPane();
        }
    };
    header.appendChild(title);
    header.appendChild(deleteBtn);
    pane.appendChild(header);

    // Color & Time Row
    const timeRow = document.createElement("div");
    timeRow.innerHTML = `
        <div style="margin-bottom:15px; display:flex; align-items:center; gap:10px;">
            <label>Color:</label> 
            <input type="color" id="divColorPick" value="${divObj.color||'#00C896'}" style="border:none; width:40px; height:30px; cursor:pointer;">
            <span style="margin-left:15px;">Time:</span>
            <input id="divStartT" value="${divObj.startTime||''}" placeholder="9:00am" style="width:80px;"> to 
            <input id="divEndT" value="${divObj.endTime||''}" placeholder="4:00pm" style="width:80px;">
            <button id="saveDivTimeBtn" style="background:#00C896; color:white; border:none; padding:4px 12px; border-radius:999px;">Save</button>
        </div>
    `;
    pane.appendChild(timeRow);

    pane.querySelector("#divColorPick").onchange = (e) => { divObj.color = e.target.value; saveData(); setupDivisionButtons(); };
    pane.querySelector("#saveDivTimeBtn").onclick = () => {
        divObj.startTime = pane.querySelector("#divStartT").value;
        divObj.endTime = pane.querySelector("#divEndT").value;
        saveData(); setupDivisionButtons();
    };

    // Bunk List with Size Badges
    const bunkSection = document.createElement("div");
    bunkSection.innerHTML = `<h4 style="margin:10px 0 5px;">Bunks in ${selectedDivision}</h4><p class="muted" style="margin-top:0;">Click pill to edit Name & Size.</p>`;
    
    const bunkContainer = document.createElement("div");
    bunkContainer.style.display = "flex";
    bunkContainer.style.flexWrap = "wrap";
    bunkContainer.style.gap = "8px";

    const sorted = (divObj.bunks||[]).slice().sort(compareBunks);
    
    sorted.forEach(bName => {
        const meta = bunkMetaData[bName] || { size: 0 };
        const pill = document.createElement("span");
        pill.className = "division-bunk-pill";
        
        pill.innerHTML = `${bName} <span class="bunk-size-badge">${meta.size || '?'}</span>`;

        // Inline Edit Logic
        pill.onclick = (e) => {
            e.stopPropagation();
            
            const form = document.createElement("span");
            form.style.display = "inline-flex";
            form.style.gap = "4px";
            form.style.alignItems = "center";
            form.style.background = "#fff";
            form.style.padding = "2px";
            form.style.border = "1px solid #00C896";
            form.style.borderRadius = "20px";

            const nameIn = document.createElement("input");
            nameIn.value = bName;
            nameIn.style.width = "70px";
            nameIn.style.border = "none";
            nameIn.style.outline = "none";
            nameIn.style.paddingLeft = "8px";

            const sizeIn = document.createElement("input");
            sizeIn.type = "number";
            sizeIn.value = meta.size || "";
            sizeIn.placeholder = "#";
            sizeIn.style.width = "40px";
            sizeIn.style.border = "1px solid #eee";
            sizeIn.style.borderRadius = "4px";
            sizeIn.style.textAlign = "center";

            const saveBtn = document.createElement("button");
            saveBtn.innerHTML = "✓";
            saveBtn.style.padding = "2px 6px";
            saveBtn.style.background = "#00C896";
            saveBtn.style.color = "white";
            saveBtn.style.border = "none";
            saveBtn.style.borderRadius = "50%";
            saveBtn.style.cursor = "pointer";

            const cancel = () => renderDivisionDetailPane();
            const save = () => renameBunkEverywhere(bName, nameIn.value, sizeIn.value);

            saveBtn.onclick = (ev) => { ev.stopPropagation(); save(); };
            nameIn.onkeyup = (ev) => { if(ev.key==="Enter") save(); if(ev.key==="Escape") cancel(); };
            sizeIn.onkeyup = (ev) => { if(ev.key==="Enter") save(); if(ev.key==="Escape") cancel(); };

            form.appendChild(nameIn);
            form.appendChild(sizeIn);
            form.appendChild(saveBtn);

            pill.replaceWith(form);
            nameIn.focus();
        };

        bunkContainer.appendChild(pill);
    });

    bunkSection.appendChild(bunkContainer);
    pane.appendChild(bunkSection);

    // Add Bunk Row
    const addRow = document.createElement("div");
    addRow.style.marginTop = "15px";
    addRow.innerHTML = `
        <div style="display:flex; gap:5px;">
            <input id="newBunkName" placeholder="New Bunk Name" style="flex:1;">
            <button id="addNewBunkBtn" style="background:#00C896; color:white;">Add</button>
        </div>
    `;
    const addBtn = addRow.querySelector("#addNewBunkBtn");
    const addIn = addRow.querySelector("#newBunkName");
    
    const doAdd = () => {
        addBunkToDivision(selectedDivision, addIn.value);
        addIn.value = "";
    };
    addBtn.onclick = doAdd;
    addIn.onkeyup = (e) => { if(e.key==="Enter") doAdd(); };

    pane.appendChild(addRow);
  }

  function setupDivisionButtons() {
    const cont = document.getElementById("divisionButtons");
    if (!cont) return;
    cont.innerHTML = "";
    availableDivisions.forEach(name => {
        const d = divisions[name];
        const card = document.createElement("div");
        card.className = "division-card" + (selectedDivision===name?" selected":"");
        card.innerHTML = `
            <div style="display:flex; align-items:center; gap:8px;">
                <span class="division-pill" style="background:${d.color||'#ccc'}">${name}</span>
            </div>
            <div style="font-size:0.8rem; color:#666; margin-top:4px;">${d.bunks.length} bunks</div>
        `;
        card.onclick = () => { selectedDivision=name; saveData(); setupDivisionButtons(); renderDivisionDetailPane(); };
        cont.appendChild(card);
    });
  }

  // -------------------- Persistence --------------------
  function saveData() {
    const app1Data = window.loadGlobalSettings?.().app1 || {};
    const data = {
      ...app1Data,
      bunks, divisions, availableDivisions, selectedDivision, allSports,
      savedSkeletons, skeletonAssignments, specialActivities,
      bunkMetaData, sportMetaData // Save new data
    };
    window.saveGlobalSettings?.("app1", data);
  }

  function loadData() {
    const data = window.loadGlobalSettings?.().app1 || {};
    try {
      bunks = data.bunks || [];
      divisions = data.divisions || {};
      specialActivities = data.specialActivities || [];
      bunkMetaData = data.bunkMetaData || {};
      sportMetaData = data.sportMetaData || {};

      Object.keys(divisions).forEach((divName) => {
        divisions[divName].bunks = divisions[divName].bunks || [];
        sortBunksInPlace(divisions[divName].bunks);
        divisions[divName].color = divisions[divName].color || defaultColors[0];
      });

      availableDivisions = data.availableDivisions && Array.isArray(data.availableDivisions)
          ? data.availableDivisions.slice() : Object.keys(divisions);

      window.divisions = divisions;
      window.availableDivisions = availableDivisions;
      selectedDivision = data.selectedDivision || availableDivisions[0] || null;

      if (data.allSports && Array.isArray(data.allSports)) {
        allSports = data.allSports;
      } else {
        allSports = [...defaultSports];
      }

      savedSkeletons = data.savedSkeletons || {};
      skeletonAssignments = data.skeletonAssignments || {};
    } catch (e) {
      console.error("Error loading app1 data:", e);
    }
  }

  // -------------------- Init --------------------
  function initApp1() {
    ensureSharedSetupStyles();

    const addDivisionBtn = document.getElementById("addDivisionBtn");
    if (addDivisionBtn) addDivisionBtn.onclick = addDivision;

    const divisionInput = document.getElementById("divisionInput");
    if (divisionInput) {
      divisionInput.addEventListener("keyup", (e) => {
        if (e.key === "Enter") addDivision();
      });
    }

    loadData();

    const detailPane = document.getElementById("division-detail-pane");
    if (detailPane) {
      detailPane.classList.add("detail-pane");
      detailPane.style.marginTop = "8px";
    }

    setupDivisionButtons();
    renderDivisionDetailPane();
    renderBulkImportUI(); // Inject new card
  }
  window.initApp1 = initApp1;

  // Expose some helpers
  window.getDivisions = () => divisions;
  window.getAllGlobalSports = function () { return (allSports || []).slice().sort(); };
  window.addGlobalSport = function (sportName) {
    if (!sportName) return;
    const s = sportName.trim();
    if (s && !allSports.find((sp) => sp.toLowerCase() === s.toLowerCase())) {
      allSports.push(s);
      saveData();
    }
  };
  window.getSavedSkeletons = function () { return savedSkeletons || {}; };
  window.saveSkeleton = function (name, skeletonData) {
    if (!name || !skeletonData) return;
    savedSkeletons[name] = skeletonData;
    saveData();
  };
  window.deleteSkeleton = function (name) {
    if (!name) return;
    delete savedSkeletons[name];
    Object.keys(skeletonAssignments).forEach((day) => {
      if (skeletonAssignments[day] === name) delete skeletonAssignments[day];
    });
    saveData();
  };
  window.getSkeletonAssignments = function () { return skeletonAssignments || {}; };
  window.saveSkeletonAssignments = function (assignments) {
    if (!assignments) return;
    skeletonAssignments = assignments;
    saveData();
  };
  window.getGlobalSpecialActivities = function () { return specialActivities; };
  window.saveGlobalSpecialActivities = function (updatedActivities) {
    specialActivities = updatedActivities;
    saveData();
  };
  window.addDivisionBunk = addBunkToDivision;
})();
