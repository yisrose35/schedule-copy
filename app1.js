// ============================================================================
// app1.js  — THEMED EDITION (Emerald Modern UI)
// ============================================================================
//
// VISUAL UPGRADE ONLY — NO LOGIC CHANGES
//
// Enhancements Added:
// • Division cards now show TOTAL campers (summed from bunk sizes)
// • Clean emerald theme (#00C896) across all pills, badges, accents
// • Modernized bunk pills with better spacing + hover interaction
// • Modernized division header (name + camper total)
// • Inline bunk edit form matches theme
// • Bulk Import card theme-aligned
// ============================================================================

(function () {
  "use strict";

  // ==========================================================================
  // STATE
  // ==========================================================================
  let bunks = [];
  let divisions = {}; 
  let specialActivities = [];

  let availableDivisions = [];
  let selectedDivision = null;

  // Metadata
  let bunkMetaData = {};      // { "Bunk 1": { size: 15 } }
  let sportMetaData = {};     // { "Basketball": { maxCapacity: 20 } }

  // Global Sports
  let allSports = [];
  const defaultSports = [
    "Baseball","Basketball","Football","Hockey","Kickball",
    "Lacrosse","Newcomb","Punchball","Soccer","Volleyball",
  ];

  // Skeletons for master scheduler
  let savedSkeletons = {};
  let skeletonAssignments = {};

  // Division colors — emerald palette
  const defaultColors = [
    "#00C896", "#00A67C", "#10B981", "#009E8A", "#00D7A5",
    "#0094FF", "#6366F1", "#F97316", "#8A5DFF", "#FF7C3B"
  ];
  let colorIndex = 0;

  // Expose to window
  window.divisions = divisions;
  window.availableDivisions = availableDivisions;
  window.getBunkMetaData = () => bunkMetaData;
  window.getSportMetaData = () => sportMetaData;

  // ==========================================================================
  // SHARED THEME STYLES (Emerald UI)
  // ==========================================================================
  function ensureSharedSetupStyles() {
    if (document.getElementById("setup-shared-styles")) return;

    const style = document.createElement("style");
    style.id = "setup-shared-styles";

    style.textContent = `

      /* ==================================================================
         GLOBAL DETAIL PANES
      ================================================================== */
      .detail-pane {
          border-radius: 20px;
          border: 1px solid #E5E7EB;
          padding: 20px 22px;
          background: linear-gradient(135deg, #F8FAF9 0%, #FFFFFF 60%, #F8FAF9 100%);
          min-height: 380px;
          box-shadow: 0 18px 40px rgba(0,0,0,0.06);
      }

      /* ==================================================================
         DIVISION CARDS (LEFT LIST)
      ================================================================== */
      .division-card {
          border-radius: 18px;
          border: 1px solid #D1D5DB;
          background: #FFFFFF;
          padding: 12px 18px;
          margin: 10px 0;
          box-shadow: 0 4px 12px rgba(0,0,0,0.06);
          cursor: pointer;
          transition: all 0.16s ease;
      }
      .division-card:hover {
          transform: translateY(-2px);
          background: #F9FAFB;
      }
      .division-card.selected {
          border-color: #00C896;
          box-shadow: 0 0 0 2px rgba(0,200,150,0.45);
          background: radial-gradient(circle at top left, #ECFDF5 0, #FFFFFF 65%);
      }

      /* Division name pill */
      .division-pill {
          padding: 5px 18px;
          border-radius: 999px;
          color: white;
          font-weight: 600;
          font-size: 0.92rem;
          background: #00C896;
          display: inline-flex;
          align-items: center;
          justify-content: center;
      }

      /* ==================================================================
         BUNK PILLS
      ================================================================== */
      .division-bunk-pill {
          padding: 6px 14px;
          border-radius: 999px;
          border: 1px solid #D1D5DB;
          background: #FFFFFF;
          color: #374151;
          font-size: 0.82rem;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          box-shadow: 0 2px 6px rgba(0,0,0,0.06);
          transition: all 0.15s ease;
      }
      .division-bunk-pill:hover {
          background: #ECFDF5;
          border-color: #00C896;
          transform: translateY(-1px);
      }

      /* Camper count badge */
      .bunk-size-badge {
          background: #ECFDF5;
          color: #047857;
          border-radius: 6px;
          padding: 2px 6px;
          font-size: 0.72rem;
          font-weight: 600;
          border: 1px solid #A7F3D0;
      }

      /* ==================================================================
         DIVISION DETAIL HEADER
      ================================================================== */
      .division-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding-bottom: 10px;
          margin-bottom: 14px;
          border-bottom: 1px solid #E5E7EB;
      }
      .division-header-title {
          display: flex;
          align-items: center;
          gap: 12px;
          font-weight: 700;
          font-size: 1.2rem;
          color: #111827;
      }
      .division-header-dot {
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: #00C896;
          box-shadow: 0 0 0 4px rgba(0,200,150,0.25);
      }
      .division-header-sub {
          font-size: 0.85rem;
          color: #6B7280;
      }

      /* ==================================================================
         INLINE EDIT FORM
      ================================================================== */
      .bunk-edit-form {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px 6px;
          border-radius: 999px;
          border: 1px solid #00C896;
          background: #FFFFFF;
      }
      .bunk-edit-input {
          border: none;
          outline: none;
          padding: 4px 6px;
          width: 80px;
          font-size: 0.8rem;
      }
      .bunk-edit-size {
          width: 50px;
          border: 1px solid #E5E7EB;
          border-radius: 6px;
          text-align: center;
      }
      .bunk-edit-save {
          background: #00C896;
          color: white;
          border: none;
          border-radius: 50%;
          padding: 3px 7px;
          cursor: pointer;
      }

      /* ==================================================================
         BULK IMPORT CARD
      ================================================================== */
      .bulk-card {
          border: 1px solid #E5E7EB;
          border-radius: 16px;
          padding: 16px;
          background: #FFFFFF;
          box-shadow: 0 4px 14px rgba(0,0,0,0.05);
      }
    `;

    document.head.appendChild(style);
  }

  // ==========================================================================
  // HELPERS
  // ==========================================================================
  function parseTimeToMinutes(str) {
    if (!str || typeof str !== "string") return null;
    let s = str.trim().toLowerCase();

    let mer = null;
    if (s.endsWith("am") || s.endsWith("pm")) {
      mer = s.endsWith("am") ? "am" : "pm";
      s = s.replace(/am|pm/g, "").trim();
    }

    const m = s.match(/^(\d{1,2})\\s*:\\s*(\\d{2})$/);
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
    const sa = String(a);
    const sb = String(b);

    const re = /(\\d+)/;
    const ma = sa.match(re);
    const mb = sb.match(re);

    if (ma && mb) {
      const na = parseInt(ma[1], 10);
      const nb = parseInt(mb[1], 10);
      if (na !== nb) return na - nb;
    }

    return sa.localeCompare(sb, undefined, { numeric: true, sensitivity: "base" });
  }

  function sortBunksInPlace(arr) {
    if (Array.isArray(arr)) arr.sort(compareBunks);
  }

  // ==========================================================================
  // CORE: CREATE DIVISION
  // ==========================================================================
  function createDivision(name) {
    if (availableDivisions.includes(name)) return false;

    availableDivisions.push(name);
    divisions[name] = {
      bunks: [],
      color: defaultColors[colorIndex++ % defaultColors.length],
      startTime: "",
      endTime: "",
    };

    window.availableDivisions = availableDivisions;
    window.divisions = divisions;
    return true;
  }

  function addDivision() {
    const input = document.getElementById("divisionInput");
    if (!input) return;

    const name = input.value.trim();
    if (!name) return;

    if (!createDivision(name)) {
      alert("That division already exists.");
      input.value = "";
      return;
    }

    selectedDivision = name;
    input.value = "";
    saveData();
    setupDivisionButtons();
    renderDivisionDetailPane();
    window.updateTable?.();
  }

  // ==========================================================================
  // CORE: ADD & RENAME BUNKS
  // ==========================================================================
  function addBunkToDivision(divName, bunkName) {
    if (!divName || !bunkName) return;

    const clean = String(bunkName).trim();
    if (!bunks.includes(clean)) bunks.push(clean);

    const div = divisions[divName];
    if (div && !div.bunks.includes(clean)) {
      div.bunks.push(clean);
      sortBunksInPlace(div.bunks);
    }

    if (!bunkMetaData[clean]) bunkMetaData[clean] = { size: 0 };

    saveData();
    renderDivisionDetailPane();
    window.updateTable?.();
  }

  function renameBunkEverywhere(oldName, newName, newSize) {
    const n = newName.trim();
    if (!n) return;

    const sizeVal = parseInt(newSize) || 0;

    // If only size changed
    if (n === oldName) {
      if (!bunkMetaData[n]) bunkMetaData[n] = {};
      bunkMetaData[n].size = sizeVal;
      saveData();
      renderDivisionDetailPane();
      return;
    }

    // Name changed
    const exists = bunks.some(b => b.toLowerCase() === n.toLowerCase() && b !== oldName);
    if (exists) {
      alert("Bunk name already exists.");
      return;
    }

    // Update master list
    const idx = bunks.indexOf(oldName);
    if (idx !== -1) bunks[idx] = n;

    // Update divisions
    Object.values(divisions).forEach(d => {
      const bi = d.bunks.indexOf(oldName);
      if (bi !== -1) d.bunks[bi] = n;
      sortBunksInPlace(d.bunks);
    });

    // Update schedule history
    if (window.scheduleAssignments && window.scheduleAssignments[oldName]) {
      window.scheduleAssignments[n] = window.scheduleAssignments[oldName];
      delete window.scheduleAssignments[oldName];
      window.saveCurrentDailyData?.("scheduleAssignments", window.scheduleAssignments);
    }

    bunkMetaData[n] = { size: sizeVal };
    delete bunkMetaData[oldName];

    saveData();
    renderDivisionDetailPane();
    window.updateTable?.();
  }

  // STOP HERE FOR PART 1
})();
// ============================================================================
// PART 2 — Bulk Import, Sports Rules, Division Detail Pane (THEMED)
// ============================================================================

(function () {
  "use strict";

  // (Globals reused from Part 1 — the script is a single IIFE)

  // ==========================================================================
  // CSV TEMPLATE DOWNLOAD
  // ==========================================================================
  function downloadTemplate() {
    let csv = "Division,Bunk Name,Camper Count\n";

    if (availableDivisions.length === 0) {
      csv += "Junior,Bunk 1,12\nJunior,Bunk 2,14\nSenior,Bunk A,18\n";
    } else {
      availableDivisions.forEach(div => {
        const d = divisions[div];
        if (d.bunks.length > 0) {
          d.bunks.forEach(b => {
            const meta = bunkMetaData[b] || {};
            const size = meta.size || 0;
            csv += `"${div}","${b}",${size}\n`;
          });
        } else {
          csv += `"${div}","",\n`;
        }
      });
    }

    const blob = new Blob([csv], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.setAttribute("hidden", "");
    a.href = url;
    a.download = "camp_setup_template.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  // ==========================================================================
  // CSV IMPORT LOGIC
  // ==========================================================================
  function handleBulkImport(file) {
    const reader = new FileReader();

    reader.onload = e => {
      const text = e.target.result;
      const lines = text.split("\n");

      let addedDivs = 0;
      let addedBunks = 0;
      let updatedSizes = 0;

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const parts = line.split(",").map(s => s.replace(/^"|"$/g, "").trim());
        if (parts.length < 2) continue;

        const divName = parts[0];
        const bunkName = parts[1];
        const size = parseInt(parts[2]) || 0;

        if (divName) {
          if (createDivision(divName)) addedDivs++;

          if (bunkName) {
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

      alert(
        `Import Complete!\nAdded Divisions: ${addedDivs}\nAdded Bunks: ${addedBunks}\nUpdated Metadata: ${updatedSizes}`
      );
    };

    reader.readAsText(file);
  }

  // ==========================================================================
  // SPORTS RULES MODAL
  // ==========================================================================
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
        Set the <strong>max total players</strong> allowed for each sport.<br>
        Example: Basketball = 30 means two bunks of 18 (36 total) cannot play each other.
      </p>
      
      <div id="sports-rules-list"></div>

      <div style="margin-top:22px; text-align:right;">
        <button id="save-sports-rules" style="
          background:#00C896; color:white; border:none; padding:8px 20px;
          border-radius:999px; cursor:pointer; font-weight:600;">
          Save Rules
        </button>
      </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const list = modal.querySelector("#sports-rules-list");
    const sortedSports = [...allSports].sort();

    sortedSports.forEach(sport => {
      const meta = sportMetaData[sport] || {};
      const cap = meta.maxCapacity || "";

      const row = document.createElement("div");
      row.className = "sports-row";

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
        const sport = input.dataset.sport;
        const val = parseInt(input.value);

        if (!sportMetaData[sport]) sportMetaData[sport] = {};
        sportMetaData[sport].maxCapacity = val > 0 ? val : null;
      });

      saveData();
      overlay.remove();
    };
  }

  // ==========================================================================
  // BULK IMPORT UI CARD
  // ==========================================================================
  function renderBulkImportUI() {
    if (document.getElementById("bulk-data-card")) return;

    const grid = document.querySelector(".setup-grid");
    if (!grid) return;

    const card = document.createElement("section");
    card.className = "setup-card setup-card-wide bulk-card";
    card.id = "bulk-data-card";

    card.innerHTML = `
      <div class="setup-card-header">
        <div class="setup-step-pill" style="background:#8A5DFF; color:white;">Bulk Data & Capacity</div>
        <div class="setup-card-text">
          <h3>Bulk Import & Sport Rules</h3>
          <p>Upload rosters or set maximum players per sport.</p>
        </div>
      </div>

      <div style="display:flex; flex-wrap:wrap; gap:22px; margin-top:15px;">

        <div style="flex:1; border:1px solid #E5E7EB; padding:16px; border-radius:14px;">
          <h4 style="margin:0 0 10px;">1. Sports Capacity</h4>
          <p class="muted">Example: Basketball = 30 max combined kids.</p>
          <button id="btn-manage-sports"
            style="background:#00C896; color:white; border:none; padding:8px 16px; border-radius:999px; cursor:pointer;">
            Manage Sports Rules
          </button>
        </div>

        <div style="flex:1; border:1px solid #E5E7EB; padding:16px; border-radius:14px;">
          <h4 style="margin:0 0 10px;">2. Bulk Import</h4>
          <p class="muted">Download CSV, fill in Excel, upload to auto-create divisions & bunks.</p>

          <div style="display:flex; gap:12px;">
            <button id="btn-download-template"
              style="background:white; border:1px solid #D1D5DB; padding:8px 16px; border-radius:999px;">Template</button>

            <button id="btn-trigger-upload"
              style="background:#0094FF; color:white; border:none; padding:8px 16px; border-radius:999px;">
              Upload
            </button>

            <input type="file" id="bulk-upload-input" accept=".csv" style="display:none;">
          </div>
        </div>
      </div>
    `;

    grid.appendChild(card);

    card.querySelector("#btn-manage-sports").onclick = showSportsRulesModal;
    card.querySelector("#btn-download-template").onclick = downloadTemplate;

    const uploadBtn = card.querySelector("#btn-trigger-upload");
    const uploadInput = card.querySelector("#bulk-upload-input");

    uploadBtn.onclick = () => uploadInput.click();

    uploadInput.onchange = e => {
      if (e.target.files.length > 0) {
        handleBulkImport(e.target.files[0]);
        uploadInput.value = "";
      }
    };
  }

  // ==========================================================================
  // DIVISION DETAIL PANE — THEMED
  // ==========================================================================
  function renderDivisionDetailPane() {
    const pane = document.getElementById("division-detail-pane");
    if (!pane) return;

    pane.innerHTML = "";

    if (!selectedDivision || !divisions[selectedDivision]) {
      pane.innerHTML = `<p class="muted">Click a division to edit.</p>`;
      return;
    }

    const divObj = divisions[selectedDivision];

    // ----------------------------------------------------------------------
    // TOTAL CAMPERS IN DIVISION
    // ----------------------------------------------------------------------
    let totalKids = 0;
    divObj.bunks.forEach(b => {
      const meta = bunkMetaData[b] || {};
      totalKids += meta.size || 0;
    });

    // ----------------------------------------------------------------------
    // HEADER
    // ----------------------------------------------------------------------
    const header = document.createElement("div");
    header.className = "division-header";

    header.innerHTML = `
      <div class="division-header-title">
        <div class="division-header-dot"></div>
        <span>${selectedDivision}</span>
      </div>

      <div class="division-header-sub">
        ${divObj.bunks.length} bunks • <strong>${totalKids}</strong> campers
      </div>
    `;

    pane.appendChild(header);

    // Delete Button
    const deleteBtn = document.createElement("button");
    deleteBtn.textContent = "Delete Division";
    deleteBtn.style.cssText = `
      background:#fff; color:#DC2626; border:1px solid #FECACA;
      padding:4px 12px; border-radius:999px; cursor:pointer;
      font-size:0.8rem; margin-bottom:10px;
    `;
    deleteBtn.onclick = () => {
      if (confirm("Delete division?")) {
        delete divisions[selectedDivision];
        const i = availableDivisions.indexOf(selectedDivision);
        if (i !== -1) availableDivisions.splice(i, 1);
        selectedDivision = availableDivisions[0] || null;
        saveData();
        setupDivisionButtons();
        renderDivisionDetailPane();
      }
    };
    pane.appendChild(deleteBtn);

    // ----------------------------------------------------------------------
    // COLOR + TIME ROW
    // ----------------------------------------------------------------------
    const timeRow = document.createElement("div");
    timeRow.style.margin = "10px 0 18px";

    timeRow.innerHTML = `
      <div style="display:flex; align-items:center; gap:14px;">
        <label style="font-weight:500;">Color:</label>
        <input type="color" id="divColorPick"
          value="${divObj.color || "#00C896"}"
          style="border:none; width:42px; height:32px; cursor:pointer;">

        <span style="margin-left:16px; font-weight:500;">Time:</span>

        <input id="divStartT" value="${divObj.startTime || ""}"
          placeholder="9:00am" style="width:80px;">
          to
        <input id="divEndT" value="${divObj.endTime || ""}"
          placeholder="4:00pm" style="width:80px;">

        <button id="saveDivTimeBtn"
          style="background:#00C896; color:white; border:none;
          padding:4px 12px; border-radius:999px; cursor:pointer;">
          Save
        </button>
      </div>
    `;

    pane.appendChild(timeRow);

    pane.querySelector("#divColorPick").onchange = e => {
      divObj.color = e.target.value;
      saveData();
      setupDivisionButtons();
    };

    pane.querySelector("#saveDivTimeBtn").onclick = () => {
      divObj.startTime = pane.querySelector("#divStartT").value;
      divObj.endTime = pane.querySelector("#divEndT").value;
      saveData();
      setupDivisionButtons();
    };

    // ----------------------------------------------------------------------
    // BUNKS SECTION (THEMED PILLS)
    // ----------------------------------------------------------------------
    const bunkSection = document.createElement("div");
    bunkSection.innerHTML = `
      <h4 style="margin:10px 0 4px;">Bunks</h4>
      <p class="muted" style="margin-top:0;">Click a bunk pill to edit name & camper count.</p>
    `;

    const bunkContainer = document.createElement("div");
    bunkContainer.style.display = "flex";
    bunkContainer.style.flexWrap = "wrap";
    bunkContainer.style.gap = "10px";

    const sorted = [...divObj.bunks].sort(compareBunks);

    sorted.forEach(bName => {
      const meta = bunkMetaData[bName] || { size: 0 };

      const pill = document.createElement("span");
      pill.className = "division-bunk-pill";

      pill.innerHTML = `
        ${bName}
        <span class="bunk-size-badge">${meta.size || 0}</span>
      `;

      // Inline Edit
      pill.onclick = e => {
        e.stopPropagation();

        const form = document.createElement("span");
        form.className = "bunk-edit-form";

        const nameIn = document.createElement("input");
        nameIn.value = bName;
        nameIn.className = "bunk-edit-input";

        const sizeIn = document.createElement("input");
        sizeIn.type = "number";
        sizeIn.value = meta.size || "";
        sizeIn.placeholder = "#";
        sizeIn.className = "bunk-edit-size";

        const saveBtn = document.createElement("button");
        saveBtn.className = "bunk-edit-save";
        saveBtn.innerHTML = "✓";

        const cancel = () => renderDivisionDetailPane();
        const save = () => renameBunkEverywhere(bName, nameIn.value, sizeIn.value);

        saveBtn.onclick = ev => {
          ev.stopPropagation();
          save();
        };

        nameIn.onkeyup = ev => {
          if (ev.key === "Enter") save();
          if (ev.key === "Escape") cancel();
        };
        sizeIn.onkeyup = ev => {
          if (ev.key === "Enter") save();
          if (ev.key === "Escape") cancel();
        };

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

    // ----------------------------------------------------------------------
    // ADD NEW BUNK
    // ----------------------------------------------------------------------
    const addRow = document.createElement("div");
    addRow.style.marginTop = "16px";

    addRow.innerHTML = `
      <div style="display:flex; gap:8px;">
        <input id="newBunkName" placeholder="New Bunk Name" style="flex:1;">
        <button id="addNewBunkBtn"
          style="background:#00C896; color:white; padding:6px 14px; border:none; border-radius:999px; cursor:pointer;">
          Add
        </button>
      </div>
    `;

    const addBtn = addRow.querySelector("#addNewBunkBtn");
    const addIn = addRow.querySelector("#newBunkName");

    const doAdd = () => {
      addBunkToDivision(selectedDivision, addIn.value);
      addIn.value = "";
    };

    addBtn.onclick = doAdd;
    addIn.onkeyup = e => {
      if (e.key === "Enter") doAdd();
    };

    pane.appendChild(addRow);
  }

  // ==========================================================================
  // UPDATE LEFT LIST OF DIVISIONS (WITH CAMPER TOTALS)
  // ==========================================================================
  function setupDivisionButtons() {
    const cont = document.getElementById("divisionButtons");
    if (!cont) return;

    cont.innerHTML = "";

    availableDivisions.forEach(name => {
      const d = divisions[name];

      // Compute camper total
      let totalKids = 0;
      d.bunks.forEach(b => {
        const meta = bunkMetaData[b] || {};
        totalKids += meta.size || 0;
      });

      const card = document.createElement("div");
      card.className = "division-card" + (selectedDivision === name ? " selected" : "");

      card.innerHTML = `
        <div style="display:flex; align-items:center; gap:10px;">
          <span class="division-pill" style="background:${d.color}">${name}</span>
        </div>
        <div style="font-size:0.8rem; color:#6B7280; margin-top:6px;">
          ${d.bunks.length} bunks • <strong>${totalKids}</strong> campers
        </div>
      `;

      card.onclick = () => {
        selectedDivision = name;
        saveData();
        setupDivisionButtons();
        renderDivisionDetailPane();
      };

      cont.appendChild(card);
    });
  }

  // ==========================================================================
  // Save + Load
  // ==========================================================================
  function saveData() {
    const old = window.loadGlobalSettings?.().app1 || {};

    const data = {
      ...old,
      bunks,
      divisions,
      availableDivisions,
      selectedDivision,
      allSports,
      savedSkeletons,
      skeletonAssignments,
      specialActivities,
      bunkMetaData,
      sportMetaData,
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

      Object.keys(divisions).forEach(div => {
        divisions[div].bunks = divisions[div].bunks || [];
        sortBunksInPlace(divisions[div].bunks);
        divisions[div].color = divisions[div].color || defaultColors[0];
      });

      availableDivisions = Array.isArray(data.availableDivisions)
        ? data.availableDivisions.slice()
        : Object.keys(divisions);

      window.divisions = divisions;
      window.availableDivisions = availableDivisions;

      selectedDivision = data.selectedDivision || availableDivisions[0] || null;

      allSports = Array.isArray(data.allSports) ? data.allSports : [...defaultSports];

      savedSkeletons = data.savedSkeletons || {};
      skeletonAssignments = data.skeletonAssignments || {};
    } catch (err) {
      console.error("Error loading app1 data:", err);
    }
  }

  // ==========================================================================
  // Init
  // ==========================================================================
  function initApp1() {
    ensureSharedSetupStyles();

    const btn = document.getElementById("addDivisionBtn");
    if (btn) btn.onclick = addDivision;

    const divInput = document.getElementById("divisionInput");
    if (divInput) {
      divInput.addEventListener("keyup", e => {
        if (e.key === "Enter") addDivision();
      });
    }

    loadData();

    const pane = document.getElementById("division-detail-pane");
    if (pane) {
      pane.classList.add("detail-pane");
      pane.style.marginTop = "8px";
    }

    setupDivisionButtons();
    renderDivisionDetailPane();
    renderBulkImportUI();
  }

  window.initApp1 = initApp1;

})();
// ============================================================================
// PART 3 — Global Exports & Final Helpers
// ============================================================================

// These must remain AFTER everything else is defined.
(function () {
  "use strict";

  // Return all divisions
  window.getDivisions = () => divisions;

  // All sports (sorted)
  window.getAllGlobalSports = function () {
    return (allSports || []).slice().sort();
  };

  // Add new sport
  window.addGlobalSport = function (sportName) {
    if (!sportName) return;

    const s = sportName.trim();
    if (!s) return;

    const exists = allSports.some(
      sp => sp.toLowerCase() === s.toLowerCase()
    );

    if (!exists) {
      allSports.push(s);
      saveData();
    }
  };

  // Skeletons
  window.getSavedSkeletons = () => savedSkeletons || {};

  window.saveSkeleton = function (name, skeletonData) {
    if (!name || !skeletonData) return;
    savedSkeletons[name] = skeletonData;
    saveData();
  };

  window.deleteSkeleton = function (name) {
    if (!name) return;

    delete savedSkeletons[name];

    // Remove assignments mapped to deleted skeleton
    Object.keys(skeletonAssignments).forEach(day => {
      if (skeletonAssignments[day] === name) {
        delete skeletonAssignments[day];
      }
    });

    saveData();
  };

  window.getSkeletonAssignments = function () {
    return skeletonAssignments || {};
  };

  window.saveSkeletonAssignments = function (assignments) {
    if (!assignments) return;
    skeletonAssignments = assignments;
    saveData();
  };

  // Specials
  window.getGlobalSpecialActivities = function () {
    return specialActivities;
  };

  window.saveGlobalSpecialActivities = function (updatedActivities) {
    specialActivities = updatedActivities;
    saveData();
  };

  // Expose bunk add for other modules
  window.addDivisionBunk = addBunkToDivision;

})();
