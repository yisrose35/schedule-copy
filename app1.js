// ============================================================================
// app1.js — DOUBLE CLICK DELETE & WIDER INPUTS
// (UPDATED: Removed slot/time functions and adopted SchedulerCoreUtils)
// ============================================================================

(function () {
  "use strict";

  // -------------------- State --------------------
  let bunks = [];
  let divisions = {};
  let specialActivities = [];

  let availableDivisions = [];
  let selectedDivision = null;

  // Metadata
  let bunkMetaData = {};
  let sportMetaData = {};

  // Master list of all sports
  let allSports = [];
  const defaultSports = [
    "Baseball","Basketball","Football","Hockey","Kickball",
    "Lacrosse","Newcomb","Punchball","Soccer","Volleyball",
  ];

  // Skeleton template management
  let savedSkeletons = {};
  let skeletonAssignments = {};

  // Modern Pro Camp accent palette
  const defaultColors = [
    "#00C896", "#0094FF", "#FF7C3B", "#8A5DFF", "#B5FF3F",
    "#FF4D4D", "#00A67C", "#6366F1", "#F97316", "#10B981"
  ];
  let colorIndex = 0;

  // Expose to window
  window.divisions = divisions;
  window.availableDivisions = availableDivisions;
  window.getBunkMetaData = () => bunkMetaData;
  window.getSportMetaData = () => sportMetaData;

  // --- Core Helper References ---
  const parseTimeToMinutes = window.SchedulerCoreUtils?.parseTimeToMinutes;

  // -------------------- Shared Theme Helpers --------------------
  function ensureSharedSetupStyles() {
    if (document.getElementById("setup-shared-styles")) return;

    const style = document.createElement("style");
    style.id = "setup-shared-styles";
    style.textContent = `
        /* ===== Global Setup / Detail Pane Shell (Modern Pro Camp) ===== */
        .detail-pane {
            border-radius: 18px;
            border: 1px solid #E5E7EB;
            padding: 18px 20px;
            background: linear-gradient(135deg, #F7F9FA 0%, #FFFFFF 55%, #F7F9FA 100%);
            min-height: 360px;
            box-shadow: 0 18px 40px rgba(15, 23, 42, 0.06);
        }

        /* Division list cards (left side) */
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
        .division-card:hover {
            box-shadow: 0 12px 26px rgba(15, 23, 42, 0.12);
            transform: translateY(-1px);
            background-color: #F9FAFB;
        }
        .division-card.selected {
            border-color: #00C896;
            box-shadow: 0 0 0 1px rgba(0, 200, 150, 0.55);
            background: radial-gradient(circle at top left, #ECFDF5 0, #FFFFFF 65%);
        }

        .division-card-top {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 4px;
        }
        .division-pill {
            padding: 4px 16px;
            border-radius: 999px;
            color: #FFFFFF;
            font-weight: 600;
            font-size: 0.9rem;
            min-width: 32px;
            display: flex;
            justify-content: center;
            align-items: center;
            box-shadow: 0 4px 10px rgba(15, 23, 42, 0.22);
        }
        .division-color-chip-list {
            width: 22px;
            height: 22px;
            border-radius: 6px;
            border: 1px solid rgba(15, 23, 42, 0.12);
            box-shadow: 0 2px 6px rgba(15, 23, 42, 0.15);
        }
        .division-card-subline {
            font-size: 0.8rem;
            color: #6B7280;
        }

        /* Division detail inner layout */
        .division-edit-shell {
            padding: 4px 0 0;
            border-radius: 16px;
            background: transparent;
        }
        .division-edit-header {
            display: flex;
            justify-content: space-between;
            align-items: baseline;
            padding-bottom: 10px;
            border-bottom: 1px solid #E5E7EB;
            margin-bottom: 14px;
        }
        .division-header-left {
            display: flex;
            align-items: center;
            gap: 8px;
            font-weight: 600;
            font-size: 0.98rem;
            color: #111827;
        }
        .division-header-left .division-name {
            cursor: text;
        }
        .division-status-dot {
            width: 11px;
            height: 11px;
            border-radius: 999px;
            background: #00C896;
            box-shadow: 0 0 0 4px rgba(0, 200, 150, 0.25);
        }
        .division-header-summary {
            font-size: 0.8rem;
            color: #6B7280;
            text-align: right;
            white-space: nowrap;
        }

        .division-edit-grid {
            display: flex;
            flex-wrap: wrap;
            gap: 20px;
            margin-top: 6px;
        }

        /* Mini cards */
        .division-mini-card {
            flex: 1 1 280px;
            border-radius: 16px;
            background: #FFFFFF;
            border: 1px solid #E5E7EB;
            padding: 12px 14px 14px;
            box-shadow: 0 8px 20px rgba(15, 23, 42, 0.05);
        }
        .division-mini-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
            padding-bottom: 6px;
            font-size: 0.78rem;
            text-transform: uppercase;
            letter-spacing: 0.06em;
            color: #6B7280;
            font-weight: 600;
            border-bottom: 1px solid rgba(148, 163, 184, 0.4);
        }
        .division-mini-pill {
            padding: 4px 12px;
            border-radius: 999px;
            background: #ECFDF5;
            color: #047857;
            font-size: 0.7rem;
            border: none;
            cursor: default;
            font-weight: 500;
            box-shadow: 0 4px 10px rgba(16, 185, 129, 0.35);
        }
        .division-mini-help {
            margin: 0 0 10px;
            font-size: 0.78rem;
            color: #6B7280;
            max-width: 340px;
        }

        /* Color row */
        .division-color-row {
            display: flex;
            align-items: center;
            gap: 10px;
            margin: 6px 0 16px;
            font-size: 0.8rem;
            color: #4B5563;
        }
        .division-color-row input[type="color"] {
            -webkit-appearance: none;
            appearance: none;
            width: 68px;
            height: 26px;
            padding: 0;
            border-radius: 999px;
            border: 1px solid #E5E7EB;
            background: #FFFFFF;
            overflow: hidden;
            box-shadow: 0 4px 10px rgba(15, 23, 42, 0.12);
        }
        .division-color-row input[type="color"]::-webkit-color-swatch {
            border: none;
            border-radius: 999px;
            padding: 0;
        }
    `;
    document.head.appendChild(style);
  }
  // -------------------- Helpers --------------------
  function makeEditable(el, save) {
    el.ondblclick = (e) => {
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
      input.onkeyup = (e2) => {
        if (e2.key === "Enter") done();
      };
    };
  }

  // Name comparison helper
  function compareBunks(a, b) {
    const sa = String(a);
    const sb = String(b);
    const re = /(\d+)/;
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
    if (!Array.isArray(arr)) return;
    arr.sort(compareBunks);
  }

  // Rename bunk everywhere
  function renameBunkEverywhere(oldName, newName, newSize) {
    const n = newName.trim();
    if (!n) return;
    const sizeVal = parseInt(newSize) || 0;

    // Update size only
    if (n === oldName) {
      if (!bunkMetaData[n]) bunkMetaData[n] = {};
      bunkMetaData[n].size = sizeVal;
      saveData();
      renderDivisionDetailPane();
      window.updateTable?.();
      return;
    }

    const exists = bunks.some(b => b.toLowerCase() === n.toLowerCase() && b !== oldName);
    if (exists) {
      alert("Bunk name already exists.");
      return;
    }

    const idx = bunks.indexOf(oldName);
    if (idx !== -1) bunks[idx] = n;

    Object.values(divisions).forEach(d => {
      const bi = d.bunks.indexOf(oldName);
      if (bi !== -1) d.bunks[bi] = n;
      sortBunksInPlace(d.bunks);
    });

    // Move schedule keys
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

  // -------------------- CSV / Bulk Logic --------------------
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
    a.hidden = true;
    a.href = url;
    a.download = "camp_setup_template.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function handleBulkImport(file) {
    const reader = new FileReader();
    reader.onload = e => {
      const text = e.target.result;
      const lines = text.split("\n");
      let addedDivs = 0, addedBunks = 0, updatedSizes = 0;

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const parts = line.split(",").map(s => s.replace(/^"|"$/g, "").trim());
        if (parts.length < 2) continue;

        const divName = parts[0];
        const bunkName = parts[1];
        const size = parseInt(parts[2]) || 0;

        if (divName) {
          // Add division
          if (!availableDivisions.includes(divName)) {
            availableDivisions.push(divName);
            divisions[divName] = {
              bunks: [],
              color: defaultColors[colorIndex++ % defaultColors.length]
            };
            addedDivs++;
          }

          // Add bunk
          if (bunkName) {
            if (!bunks.includes(bunkName)) {
              bunks.push(bunkName);
              addedBunks++;
            }
            const div = divisions[divName];
            if (!div.bunks.includes(bunkName)) {
              div.bunks.push(bunkName);
              sortBunksInPlace(div.bunks);
            }
            if (!bunkMetaData[bunkName]) bunkMetaData[bunkName] = {};
            bunkMetaData[bunkName].size = size;
            updatedSizes++;
          }
        }
      }

      saveData();
      setupDivisionButtons();
      renderDivisionDetailPane();

      alert(`Import Complete!
Added Divisions: ${addedDivs}
Added Bunks: ${addedBunks}
Updated Metadata: ${updatedSizes}`);
    };

    reader.readAsText(file);
  }

  // -------------------- Sports Rules Modal --------------------
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
      <p class="muted" style="margin-bottom:15px;">Set max total players per sport.</p>
      <div id="sports-rules-list"></div>
      <div style="margin-top:22px; text-align:right;">
        <button id="save-sports-rules"
                style="background:#00C896;color:white;border:none;padding:8px 20px;border-radius:999px;
                cursor:pointer;font-weight:600;">Save Rules</button>
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
          <input type="number" class="sport-cap-input" data-sport="${sport}"
                 value="${cap}" placeholder="∞">
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
  // -------------------- Bulk Import UI --------------------
  function renderBulkImportUI() {
    if (document.getElementById("bulk-data-card")) return;

    const grid = document.querySelector(".setup-grid");
    const target = grid || document.getElementById("division-detail-pane")?.parentNode;
    if (!target) return;

    const card = document.createElement("section");
    card.className = "setup-card setup-card-wide bulk-card";
    card.id = "bulk-data-card";

    card.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; gap:20px;">
        <div style="flex:1;">
          <h3 style="margin:0; font-size:1.1rem; color:#111827; display:flex; align-items:center; gap:8px;">
             Camp Setup & Configuration
             <span style="font-size:0.7rem; background:#8A5DFF;
                 color:white; padding:2px 8px; border-radius:999px;">Step 1</span>
          </h3>
          <p class="muted" style="margin:4px 0 0;">Use this panel to import data, set rules, or add new divisions below.</p>
        </div>

        <div style="display:flex; gap:10px; align-items:center;">
            <button id="btn-manage-sports"
                    style="background:#FFFFFF; border:1px solid #E5E7EB; color:#374151;
                    padding:8px 16px; border-radius:999px; cursor:pointer; font-size:0.85rem;
                    font-weight:500; display:flex; align-items:center; gap:6px;">
                <span>⚡</span> Sports Rules
            </button>

            <div style="height:24px; width:1px; background:#E5E7EB;"></div>

            <button id="btn-download-template"
                    style="background:white; border:1px solid #D1D5DB;
                    padding:8px 16px; border-radius:999px; font-size:0.85rem; cursor:pointer;">
                Template
            </button>

            <button id="btn-trigger-upload"
                    style="background:#0094FF; color:white;
                    border:none; padding:8px 18px; border-radius:999px;
                    font-size:0.85rem; cursor:pointer; font-weight:600;">
                Upload CSV
            </button>

            <input type="file" id="bulk-upload-input" accept=".csv" style="display:none;">
        </div>
      </div>
    `;

    target.prepend(card);

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

  // -------------------- Core Logic --------------------
  function addBunkToDivision(divName, bunkName) {
    if (!divName || !bunkName) return;
    const cleanDiv = String(divName).trim();
    const cleanBunk = String(bunkName).trim();
    if (!cleanDiv || !cleanBunk) return;

    if (!bunks.includes(cleanBunk)) bunks.push(cleanBunk);

    const div = divisions[cleanDiv];
    if (div && !div.bunks.includes(cleanBunk)) {
      div.bunks.push(cleanBunk);
      sortBunksInPlace(div.bunks);
    }

    if (!bunkMetaData[cleanBunk]) bunkMetaData[cleanBunk] = { size: 0 };

    saveData();
    renderDivisionDetailPane();
    window.updateTable?.();
  }

  function addDivision() {
    const i = document.getElementById("divisionInput");
    if (!i) return;
    const raw = i.value.trim();
    if (!raw) return;

    if (availableDivisions.includes(raw)) {
      alert("That division already exists.");
      i.value = "";
      return;
    }

    const name = raw;
    const color = defaultColors[colorIndex % defaultColors.length];
    colorIndex++;

    availableDivisions.push(name);
    divisions[name] = {
      bunks: [],
      color,
      startTime: "",
      endTime: ""
    };
    selectedDivision = name;
    i.value = "";

    saveData();
    setupDivisionButtons();
    renderDivisionDetailPane();
    window.initLeaguesTab?.();
    window.updateTable?.();
  }

  // -------------------- UI Rendering --------------------
  function setupDivisionButtons() {
    const cont = document.getElementById("divisionButtons");
    if (!cont) return;
    cont.innerHTML = "";

    if (availableDivisions.length === 0) {
      cont.innerHTML = `<p class="muted">No divisions created yet. Add one above or import via CSV.</p>`;
      renderDivisionDetailPane();
      return;
    }

    availableDivisions.forEach(name => {
      const obj = divisions[name];
      if (!obj) return;

      let totalKids = 0;
      obj.bunks.forEach(b => totalKids += (bunkMetaData[b]?.size || 0));

      const card = document.createElement("div");
      card.className = "division-card";
      if (selectedDivision === name) card.classList.add("selected");

      card.onclick = () => {
        selectedDivision = name;
        saveData();
        setupDivisionButtons();
        renderDivisionDetailPane();
      };

      const topRow = document.createElement("div");
      topRow.className = "division-card-top";

      const pill = document.createElement("div");
      pill.className = "division-pill";
      pill.style.backgroundColor = obj.color || "#00C896";
      pill.textContent = name;

      const chip = document.createElement("div");
      chip.className = "division-color-chip-list";
      chip.style.backgroundColor = obj.color || "#00C896";

      topRow.append(pill, chip);
      card.appendChild(topRow);

      const sub = document.createElement("div");
      sub.className = "division-card-subline";

      const bunkCount = (obj.bunks || []).length;
      sub.innerHTML = `${bunkCount} bunks • <strong>${totalKids}</strong> campers`;

      card.appendChild(sub);
      cont.appendChild(card);
    });

    renderDivisionDetailPane();
  }

  function renderDivisionDetailPane() {
    const pane = document.getElementById("division-detail-pane");
    if (!pane) return;
    pane.innerHTML = "";

    if (!selectedDivision || !divisions[selectedDivision]) {
      pane.innerHTML = `<p class="muted">Click a division on the left to set its <strong>times</strong>, color, and <strong>bunks</strong>.</p>`;
      return;
    }

    const divObj = divisions[selectedDivision];

    let totalKids = 0;
    divObj.bunks.forEach(b => totalKids += (bunkMetaData[b]?.size || 0));

    // ---------- Header ----------
    const header = document.createElement("div");
    header.style.display = "flex";
    header.style.justifyContent = "space-between";
    header.style.alignItems = "center";
    header.style.borderBottom = "2px solid #E5E7EB";
    header.style.paddingBottom = "8px";
    header.style.marginBottom = "10px";

    const title = document.createElement("h3");
    title.style.margin = "0";
    title.style.fontSize = "1rem";
    title.style.fontWeight = "600";
    title.style.color = "#111827";
    title.textContent = "Division Details & Bunks";

    const deleteBtn = document.createElement("button");
    deleteBtn.textContent = "Delete Division";
    deleteBtn.style.cssText =
      "background:#FFFFFF; color:#DC2626; border:1px solid #FECACA;" +
      "padding:6px 16px; border-radius:999px; cursor:pointer; font-weight:600; " +
      "font-size:0.85rem; box-shadow:0 4px 10px rgba(220,38,38,0.12);";

    deleteBtn.onclick = () => {
      if (!confirm(`Delete division "${selectedDivision}"?`)) return;
      delete divisions[selectedDivision];
      const idx = availableDivisions.indexOf(selectedDivision);
      if (idx !== -1) availableDivisions.splice(idx, 1);
      selectedDivision = availableDivisions[0] || null;

      saveData();
      setupDivisionButtons();
      renderDivisionDetailPane();
      window.initLeaguesTab?.();
      window.updateTable?.();
    };

    header.append(title, deleteBtn);
    pane.appendChild(header);

    // ---------- Color Row ----------
    const colorRow = document.createElement("div");
    colorRow.className = "division-color-row";

    const colorLabel = document.createElement("span");
    colorLabel.textContent = "Division color";

    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.value = divObj.color || "#00C896";

    colorInput.oninput = e => {
      divObj.color = e.target.value;
      saveData();
      setupDivisionButtons();
      renderDivisionDetailPane();
      window.updateTable?.();
    };

    colorRow.append(colorLabel, colorInput);
    pane.appendChild(colorRow);

    // ---------- Inner Shell ----------
    const shell = document.createElement("div");
    shell.className = "division-edit-shell";
    pane.appendChild(shell);

    const innerHeader = document.createElement("div");
    innerHeader.className = "division-edit-header";

    const leftSide = document.createElement("div");
    leftSide.className = "division-header-left";

    const dot = document.createElement("span");
    dot.className = "division-status-dot";
    dot.style.backgroundColor = divObj.color || "#00C896";
    dot.style.boxShadow = `0 0 0 4px ${(divObj.color || "#00C896")}33`;

    const titleName = document.createElement("span");
    titleName.textContent = selectedDivision;
    titleName.className = "division-name";

    // Inline rename division
    makeEditable(titleName, newName => {
      const trimmed = newName.trim();
      const old = selectedDivision;

      if (!trimmed || trimmed === old) return;
      if (divisions[trimmed]) {
        alert("Division name already exists.");
        return;
      }

      divisions[trimmed] = divisions[old];
      delete divisions[old];

      const idx = availableDivisions.indexOf(old);
      if (idx !== -1) availableDivisions[idx] = trimmed;

      selectedDivision = trimmed;

      saveData();
      setupDivisionButtons();
      renderDivisionDetailPane();
      window.updateTable?.();
    });

    leftSide.append(dot, titleName);

    const rightSide = document.createElement("div");
    rightSide.className = "division-header-summary";

    const bunkCount = (divObj.bunks || []).length;
    const timesSummary =
      divObj.startTime && divObj.endTime
        ? `${divObj.startTime} – ${divObj.endTime}`
        : "Times not set";

    rightSide.innerHTML =
      `${bunkCount} bunks • <strong>${totalKids}</strong> campers • ${timesSummary}`;

    innerHeader.append(leftSide, rightSide);
    shell.appendChild(innerHeader);

    // ---------- Grid ----------
    const grid = document.createElement("div");
    grid.className = "division-edit-grid";
    shell.appendChild(grid);

    // ---------- Time Card ----------
    const timeCard = document.createElement("div");
    timeCard.className = "division-mini-card";
    timeCard.innerHTML = `
      <div class="division-mini-header"><span>Division Times</span></div>
      <p class="division-mini-help">Set the daily time window this division is in camp.</p>
    `;

    const timeForm = document.createElement("div");
    timeForm.style.cssText = "display:flex; align-items:center; gap:8px; margin-top:4px;";

    const startInput = document.createElement("input");
    startInput.value = divObj.startTime || "";
    startInput.placeholder = "9:00am";
    startInput.style.cssText =
      "width:80px; padding:4px 8px; border-radius:999px; border:1px solid #D1D5DB; font-size:0.85rem;";

    const toLabel = document.createElement("span");
    toLabel.textContent = "to";
    toLabel.className = "muted";

    const endInput = document.createElement("input");
    endInput.value = divObj.endTime || "";
    endInput.placeholder = "4:00pm";
    endInput.style.cssText =
      "width:80px; padding:4px 8px; border-radius:999px; border:1px solid #D1D5DB; font-size:0.85rem;";

    const updateBtn = document.createElement("button");
    updateBtn.textContent = "Save";
    updateBtn.style.cssText =
      "background:#00C896;color:white;border:none;padding:4px 12px;" +
      "border-radius:999px;font-weight:600;cursor:pointer;";

    updateBtn.onclick = () => {
      divObj.startTime = startInput.value;
      divObj.endTime = endInput.value;
      saveData();
      setupDivisionButtons();
      renderDivisionDetailPane();
    };

    timeForm.append(startInput, toLabel, endInput, updateBtn);
    timeCard.appendChild(timeForm);
    grid.appendChild(timeCard);

    // ---------- Bunks Card ----------
    const bunksCard = document.createElement("div");
    bunksCard.className = "division-mini-card";

    bunksCard.innerHTML = `
      <div class="division-mini-header"><span>Bunks in this Division</span></div>
      <p class="division-mini-help">Click to edit name/size.<br><strong>Double-click to delete.</strong></p>
    `;

    const bunkList = document.createElement("div");
    bunkList.style.cssText = "margin-top:6px; display:flex; flex-wrap:wrap; gap:6px; margin-bottom:8px;";

    if (!divObj.bunks.length) {
      bunkList.innerHTML = `<p class="muted">No bunks assigned yet.</p>`;
    } else {
      const sorted = [...divObj.bunks].sort(compareBunks);
      sorted.forEach(bName => {
        const meta = bunkMetaData[bName] || { size: 0 };

        const pill = document.createElement("span");
        pill.className = "division-bunk-pill";
        pill.innerHTML =
          `${bName} <span class="bunk-size-badge">${meta.size || 0}</span>`;

        let clickTimer = null;
        const clickDelay = 260;

        function startInlineEdit() {
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
          const save = () =>
            renameBunkEverywhere(bName, nameIn.value, sizeIn.value);

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

          form.append(nameIn, sizeIn, saveBtn);
          pill.replaceWith(form);
          nameIn.focus();
        }

        pill.onclick = e => {
          e.stopPropagation();

          if (clickTimer) {
            clearTimeout(clickTimer);
            clickTimer = null;

            const idx = divObj.bunks.indexOf(bName);
            if (idx !== -1) {
              divObj.bunks.splice(idx, 1);
            }

            saveData();
            renderDivisionDetailPane();
            window.updateTable?.();

          } else {
            clickTimer = setTimeout(() => {
              clickTimer = null;
              startInlineEdit();
            }, clickDelay);
          }
        };

        bunkList.appendChild(pill);
      });
    }

    bunksCard.appendChild(bunkList);

    // -------- Add Bunk Row --------
    const addRow = document.createElement("div");
    addRow.style.cssText = "display:flex; gap:6px; margin-top:10px;";

    const addInput = document.createElement("input");
    addInput.placeholder = "New Bunk Name";
    addInput.style.cssText =
      "flex:1; padding:5px 10px; border-radius:999px; border:1px solid #D1D5DB; font-size:0.86rem;";

    const addBtn = document.createElement("button");
    addBtn.textContent = "Add";
    addBtn.style.cssText =
      "padding:5px 14px; border-radius:999px; border:none; background:#00C896; color:white; " +
      "font-size:0.85rem; font-weight:600; cursor:pointer;";

    const doAdd = () => {
      if (!addInput.value.trim()) return;
      addBunkToDivision(selectedDivision, addInput.value.trim());
      addInput.value = "";
    };

    addBtn.onclick = doAdd;
    addInput.onkeyup = e => {
      if (e.key === "Enter") doAdd();
    };

    addRow.append(addInput, addBtn);
    bunksCard.appendChild(addRow);

    grid.appendChild(bunksCard);
  }

  // -------------------- Persistence --------------------
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
      specialActivities,
      bunkMetaData,
      sportMetaData
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

      Object.keys(divisions).forEach(divName => {
        const div = divisions[divName];
        div.startTime = div.startTime || "";
        div.endTime = div.endTime || "";
        div.bunks = div.bunks || [];
        sortBunksInPlace(div.bunks);
        div.color = div.color || defaultColors[0];
      });

      availableDivisions =
        data.availableDivisions && Array.isArray(data.availableDivisions)
          ? data.availableDivisions.slice()
          : Object.keys(divisions);

      window.divisions = divisions;
      window.availableDivisions = availableDivisions;
      selectedDivision = data.selectedDivision || availableDivisions[0] || null;

      allSports = Array.isArray(data.allSports) ? data.allSports : [...defaultSports];
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
      divisionInput.addEventListener("keyup", e => {
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
    renderBulkImportUI();
  }

  window.initApp1 = initApp1;

  // Exports
  window.getDivisions = () => divisions;
  window.getAllGlobalSports = () => [...allSports].sort();
  window.addGlobalSport = sportName => {
    if (!sportName) return;
    const s = sportName.trim();
    if (s && !allSports.find(sp => sp.toLowerCase() === s.toLowerCase())) {
      allSports.push(s);
      saveData();
    }
  };
  window.getSavedSkeletons = () => savedSkeletons || {};
  window.saveSkeleton = (name, skeletonData) => {
    if (!name || !skeletonData) return;
    savedSkeletons[name] = skeletonData;
    saveData();
  };
  window.deleteSkeleton = name => {
    if (!name) return;
    delete savedSkeletons[name];
    Object.keys(skeletonAssignments).forEach(day => {
      if (skeletonAssignments[day] === name) delete skeletonAssignments[day];
    });
    saveData();
  };
  window.getSkeletonAssignments = () => skeletonAssignments || {};
  window.saveSkeletonAssignments = assignments => {
    if (!assignments) return;
    skeletonAssignments = assignments;
    saveData();
  };
  window.getGlobalSpecialActivities = () => specialActivities;
  window.saveGlobalSpecialActivities = updatedActivities => {
    specialActivities = updatedActivities;
    saveData();
  };
  window.addDivisionBunk = addBunkToDivision;

})();
