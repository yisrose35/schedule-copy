// =================================================================
// app1.js
//
// DIVISIONS UI – MATCHING "STEP 1 / STEP 2" DESIGN
// - Left: All Divisions as rounded cards with number badge, color swatch,
//   bunk count, and times.
// - Right: Division Details & Bunks card:
//      • Header with status dot + division name
//      • Summary "X bunks • 11:00am – 4:30pm"
//      • Two subcards: "DIVISION TIMES" and "BUNKS IN THIS DIVISION"
//      • Bunks rendered as circular pills (1, 2, 3, 4...) like screenshot.
// - All existing behavior preserved: numeric bunk sorting, color per
//   division, double-click renames, persistence via global settings.
// =================================================================

(function () {
  'use strict';

  // -------------------- State --------------------
  let bunks = [];
  let divisions = {}; // { divName:{ bunks:[], color, startTime, endTime } }
  let specialActivities = []; // For special_activities.js

  let availableDivisions = [];
  let selectedDivision = null;

  // Master list of all sports
  let allSports = [];
  const defaultSports = [
    "Baseball", "Basketball", "Football", "Hockey", "Kickball",
    "Lacrosse", "Newcomb", "Punchball", "Soccer", "Volleyball"
  ];

  // Skeleton template management
  let savedSkeletons = {};
  let skeletonAssignments = {}; // { "Monday": "templateName", "Default": "templateName" }

  const defaultColors = [
    '#4CAF50', '#2196F3', '#E91E63', '#FF9800',
    '#9C27B0', '#00BCD4', '#FFC107', '#F44336',
    '#8BC34A', '#3F51B5'
  ];
  let colorIndex = 0;

  // Expose to window
  window.divisions = divisions;
  window.availableDivisions = availableDivisions;

  // -------------------- Styles for Divisions UI --------------------
  function ensureDivisionStyles() {
    if (document.getElementById('division-styles')) return;

    const style = document.createElement('style');
    style.id = 'division-styles';
    style.textContent = `
      /* LEFT: division list */
      .division-list {
        border-radius: 14px;
        border: 1px solid #e5e7eb;
        background: #f9fafb;
        padding: 10px 8px;
        max-height: 460px;
        overflow: auto;
      }
      .division-list-item {
        border-radius: 14px;
        border: 2px solid transparent;
        background: #ffffff;
        padding: 10px 14px;
        margin-bottom: 8px;
        display: flex;
        align-items: center;
        gap: 12px;
        box-shadow: 0 8px 18px rgba(15, 23, 42, 0.06);
        cursor: pointer;
        transition: border-color 0.15s ease, box-shadow 0.15s ease,
                    transform 0.07s ease, background 0.15s ease;
      }
      .division-list-item:hover {
        transform: translateY(-1px);
        box-shadow: 0 12px 24px rgba(15, 23, 42, 0.10);
      }
      .division-list-item.active {
        border-color: #2563eb;
        box-shadow: 0 0 0 1px rgba(37, 99, 235, 0.4);
      }
      .division-badge {
        width: 30px;
        height: 30px;
        border-radius: 999px;
        background: #2563eb;
        color: #ffffff;
        font-size: 0.9rem;
        font-weight: 600;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: inset 0 0 0 2px rgba(255,255,255,0.6);
        flex-shrink: 0;
      }
      .division-meta-block {
        flex: 1;
        display: flex;
        flex-direction: column;
      }
      .division-name-line {
        font-size: 0.95rem;
        font-weight: 600;
        color: #111827;
      }
      .division-sub-line {
        font-size: 0.8rem;
        color: #6b7280;
        margin-top: 2px;
      }
      .division-color-swatch {
        width: 20px;
        height: 20px;
        border-radius: 4px;
        box-shadow: inset 0 0 0 1px rgba(255,255,255,0.8);
        border: 1px solid rgba(15,23,42,0.15);
        flex-shrink: 0;
      }

      /* RIGHT: main detail card */
      .division-detail-root {
        border-radius: 16px;
        border: 1px solid #e5e7eb;
        background: linear-gradient(145deg, #f9fafb 0%, #ffffff 45%, #f3f4ff 100%);
        padding: 14px 16px 18px;
        box-shadow: 0 20px 40px rgba(15, 23, 42, 0.18);
      }
      .division-detail-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 10px;
      }
      .division-header-left {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .division-status-dot {
        width: 10px;
        height: 10px;
        border-radius: 999px;
        background: #22c55e;
        box-shadow: 0 0 0 4px rgba(34,197,94,0.28);
      }
      .division-header-title {
        font-size: 1rem;
        font-weight: 700;
        color: #111827;
      }
      .division-header-summary {
        font-size: 0.8rem;
        color: #6b7280;
      }

      .division-detail-grid {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin-top: 6px;
      }
      .division-times-card,
      .division-bunks-card {
        flex: 1 1 260px;
        border-radius: 14px;
        border: 1px solid #e5e7eb;
        background: #ffffff;
        padding: 10px 12px 12px;
        box-shadow: 0 10px 24px rgba(15, 23, 42, 0.08);
      }
      .division-card-header-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 6px;
      }
      .division-card-title {
        font-size: 0.78rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: #6b7280;
        font-weight: 700;
      }
      .division-card-pill-button {
        font-size: 0.75rem;
        padding: 3px 10px;
        border-radius: 999px;
        border: 1px solid #bfdbfe;
        background: #eff6ff;
        color: #2563eb;
        cursor: pointer;
      }
      .division-times-inputs {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px 8px;
        margin-top: 4px;
        align-items: center;
      }
      .division-times-inputs input {
        width: 100%;
      }
      .division-times-to {
        text-align: center;
        font-size: 0.8rem;
        color: #6b7280;
      }

      /* bunk pills */
      .division-bunk-row {
        margin-top: 4px;
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      .division-bunk-pill {
        width: 32px;
        height: 32px;
        border-radius: 999px;
        border: 1px solid #d1d5db;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 0.78rem;
        color: #111827;
        background: #f9fafb;
        cursor: pointer;
        position: relative;
      }
      .division-bunk-pill:hover {
        background: #e5edff;
        border-color: #93c5fd;
      }
      .division-bunk-pill button {
        position: absolute;
        top: -6px;
        right: -6px;
        border-radius: 999px;
        border: none;
        width: 14px;
        height: 14px;
        font-size: 10px;
        line-height: 14px;
        padding: 0;
        cursor: pointer;
        background: #fee2e2;
        color: #b91c1c;
        box-shadow: 0 0 0 1px rgba(248,113,113,0.6);
      }

      .division-add-bunk-row {
        margin-top: 10px;
        display: flex;
        gap: 6px;
      }
      .division-add-bunk-row input {
        flex: 1;
      }

      .division-color-row {
        margin-top: 10px;
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 0.8rem;
        color: #4b5563;
      }
    `;
    document.head.appendChild(style);
  }

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

    if (!mer) return null; // require am/pm

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

  function renameBunkEverywhere(oldName, newName) {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName) return;

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
      sortBunksInPlace(d.bunks);
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

  // -------------------- Bunks (logic; UI in detail pane) --------------------
  function addBunkToDivision(divName, bunkName) {
    if (!divName || !bunkName) return;
    const cleanDiv = String(divName).trim();
    const cleanBunk = String(bunkName).trim();
    if (!cleanDiv || !cleanBunk) return;

    if (!bunks.includes(cleanBunk)) {
      bunks.push(cleanBunk);
    }

    const div = divisions[cleanDiv];
    if (div && !div.bunks.includes(cleanBunk)) {
      div.bunks.push(cleanBunk);
      sortBunksInPlace(div.bunks);
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

  function formatTimeRange(divObj) {
    const st = divObj.startTime || "";
    const et = divObj.endTime || "";
    if (!st && !et) return "Set times";
    if (st && et) return `${st} – ${et}`;
    return st || et;
  }

  /**
   * LEFT SIDE: master list of divisions, styled like screenshot.
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

    cont.classList.add("division-list");

    const colorEnabledEl = document.getElementById("enableColor");
    const colorEnabled = colorEnabledEl ? colorEnabledEl.checked : true;

    availableDivisions.forEach((name, idx) => {
      const obj = divisions[name];
      if (!obj) {
        console.warn(`Division "${name}" exists in availableDivisions but not in divisions object.`);
        return;
      }

      const item = document.createElement("div");
      item.className = "division-list-item";
      if (selectedDivision === name) item.classList.add("active");

      item.onclick = () => {
        selectedDivision = name;
        saveData();
        setupDivisionButtons();
        renderDivisionDetailPane();
      };

      // Badge with division index
      const badge = document.createElement("div");
      badge.className = "division-badge";
      badge.textContent = String(idx + 1);
      badge.style.background = obj.color || "#2563eb";

      // Meta block (name + bunks/times)
      const metaBlock = document.createElement("div");
      metaBlock.className = "division-meta-block";

      const nameLine = document.createElement("div");
      nameLine.className = "division-name-line";
      nameLine.textContent = name;
      makeEditable(nameLine, newName => {
        const trimmed = newName.trim();
        const old = name;
        if (!trimmed || trimmed === old) return;

        if (divisions[trimmed]) {
          alert("A division with this name already exists.");
          return;
        }

        divisions[trimmed] = divisions[old];
        delete divisions[old];

        const i = availableDivisions.indexOf(old);
        if (i !== -1) availableDivisions[i] = trimmed;

        if (selectedDivision === old) selectedDivision = trimmed;

        window.divisions = divisions;
        window.availableDivisions = availableDivisions;
        saveData();
        setupDivisionButtons();
        renderDivisionDetailPane();
        window.initLeaguesTab?.();
        window.updateTable?.();
      });

      const subLine = document.createElement("div");
      subLine.className = "division-sub-line";
      const bunkCount = (obj.bunks || []).length;
      subLine.textContent = `${bunkCount || 0} bunks • ${formatTimeRange(obj)}`;

      metaBlock.appendChild(nameLine);
      metaBlock.appendChild(subLine);

      // Color swatch
      const swatch = document.createElement("div");
      swatch.className = "division-color-swatch";
      if (colorEnabled) {
        swatch.style.background = obj.color || "#2563eb";
      } else {
        swatch.style.background = "#e5e7eb";
      }

      item.appendChild(badge);
      item.appendChild(metaBlock);
      item.appendChild(swatch);
      cont.appendChild(item);
    });

    renderDivisionDetailPane();
  }

  /**
   * RIGHT SIDE: detail pane for selected division.
   */
  function renderDivisionDetailPane() {
    const pane = document.getElementById("division-detail-pane");
    if (!pane) return;

    pane.innerHTML = "";

    if (!selectedDivision || !divisions[selectedDivision]) {
      pane.innerHTML = `
        <p class="muted">
          Click a division on the left to set its <strong>times</strong>,
          color, and <strong>bunks</strong>.
        </p>
      `;
      return;
    }

    const divObj = divisions[selectedDivision];
    const bunkCount = (divObj.bunks || []).length;

    const root = document.createElement("div");
    root.className = "division-detail-root";

    // Header
    const header = document.createElement("div");
    header.className = "division-detail-header";

    const left = document.createElement("div");
    left.className = "division-header-left";

    const dot = document.createElement("div");
    dot.className = "division-status-dot";

    const title = document.createElement("div");
    title.className = "division-header-title";
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

    left.appendChild(dot);
    left.appendChild(title);

    const right = document.createElement("div");
    right.className = "division-header-summary";
    right.textContent = `${bunkCount || 0} bunks • ${formatTimeRange(divObj)}`;

    header.appendChild(left);
    header.appendChild(right);
    root.appendChild(header);

    // Detail grid
    const grid = document.createElement("div");
    grid.className = "division-detail-grid";

    // ----- TIMES CARD -----
    const timesCard = document.createElement("div");
    timesCard.className = "division-times-card";

    const timesHeader = document.createElement("div");
    timesHeader.className = "division-card-header-row";
    timesHeader.innerHTML = `
      <span class="division-card-title">Division Times</span>
      <button type="button" class="division-card-pill-button">Schedule grid</button>
    `;
    timesCard.appendChild(timesHeader);

    const timesHelp = document.createElement("p");
    timesHelp.style.margin = "0 0 6px 0";
    timesHelp.style.fontSize = "0.78rem";
    timesHelp.style.color = "#6b7280";
    timesHelp.textContent =
      "Set the daily time window this division is in camp. Used as the base for your schedule grid.";
    timesCard.appendChild(timesHelp);

    const timeForm = document.createElement("div");
    timeForm.className = "division-times-inputs";

    const startInput = document.createElement("input");
    startInput.type = "text";
    startInput.placeholder = "Start (e.g., 11:00am)";
    startInput.value = divObj.startTime || "";

    const toLabel = document.createElement("div");
    toLabel.className = "division-times-to";
    toLabel.textContent = "to";

    const endInput = document.createElement("input");
    endInput.type = "text";
    endInput.placeholder = "End (e.g., 4:30pm)";
    endInput.value = divObj.endTime || "";

    const updateBtn = document.createElement("button");
    updateBtn.textContent = "Update";
    updateBtn.style.padding = "4px 10px";
    updateBtn.style.fontSize = "0.8rem";
    updateBtn.onclick = () => {
      const newStart = startInput.value.trim();
      const newEnd = endInput.value.trim();

      const startMin = parseTimeToMinutes(newStart);
      const endMin = parseTimeToMinutes(newEnd);

      if (startMin == null || endMin == null) {
        alert("Invalid time format. Use '9:00am' or '2:30pm' with am/pm.");
        return;
      }
      if (endMin <= startMin) {
        alert("End time must be after start time.");
        return;
      }

      divObj.startTime = newStart;
      divObj.endTime = newEnd;
      saveData();
      setupDivisionButtons();
      renderDivisionDetailPane();

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
    timesCard.appendChild(timeForm);

    // Color row (keeps your color control, just subtle)
    const colorRow = document.createElement("div");
    colorRow.className = "division-color-row";

    const colorLabel = document.createElement("span");
    colorLabel.textContent = "Division color";

    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.value = divObj.color || "#2563eb";
    colorInput.oninput = e => {
      divObj.color = e.target.value;
      saveData();
      setupDivisionButtons();
      window.updateTable?.();
    };

    colorRow.appendChild(colorLabel);
    colorRow.appendChild(colorInput);
    timesCard.appendChild(colorRow);

    // ----- BUNKS CARD -----
    const bunksCard = document.createElement("div");
    bunksCard.className = "division-bunks-card";

    const bunksHeader = document.createElement("div");
    bunksHeader.className = "division-card-header-row";
    bunksHeader.innerHTML = `
      <span class="division-card-title">Bunks in this Division</span>
      <button type="button" class="division-card-pill-button">Add per division</button>
    `;
    bunksCard.appendChild(bunksHeader);

    const bunksHelp = document.createElement("p");
    bunksHelp.style.margin = "0 0 6px 0";
    bunksHelp.style.fontSize = "0.78rem";
    bunksHelp.style.color = "#6b7280";
    bunksHelp.textContent =
      `Add bunks directly to ${selectedDivision} using the input below, or remove existing bunks with a click.`;
    bunksCard.appendChild(bunksHelp);

    const bunkRow = document.createElement("div");
    bunkRow.className = "division-bunk-row";

    if (!divObj.bunks || divObj.bunks.length === 0) {
      const msg = document.createElement("span");
      msg.className = "muted";
      msg.style.fontSize = "0.8rem";
      msg.textContent = "No bunks in this division yet.";
      bunkRow.appendChild(msg);
    } else {
      const sorted = divObj.bunks.slice().sort(compareBunks);
      sorted.forEach((bunkName) => {
        const pill = document.createElement("div");
        pill.className = "division-bunk-pill";
        pill.textContent = bunkName;

        // rename on double-click
        makeEditable(pill, newName => {
          renameBunkEverywhere(bunkName, newName);
        });

        const xBtn = document.createElement("button");
        xBtn.textContent = "×";
        xBtn.title = "Remove from this division";
        xBtn.onclick = e => {
          e.stopPropagation();
          const idx = divObj.bunks.indexOf(bunkName);
          if (idx !== -1) divObj.bunks.splice(idx, 1);
          saveData();
          renderDivisionDetailPane();
          window.updateTable?.();
        };

        pill.appendChild(xBtn);
        bunkRow.appendChild(pill);
      });
    }

    bunksCard.appendChild(bunkRow);

    // Add bunk row
    const addRow = document.createElement("div");
    addRow.className = "division-add-bunk-row";

    const addInput = document.createElement("input");
    addInput.type = "text";
    addInput.placeholder = "Add bunk to this division (e.g., 5A)";

    const addBtn = document.createElement("button");
    addBtn.textContent = "Add";
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
    bunksCard.appendChild(addRow);

    grid.appendChild(timesCard);
    grid.appendChild(bunksCard);
    root.appendChild(grid);

    pane.appendChild(root);
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
    ensureDivisionStyles();

    const addDivisionBtn = document.getElementById("addDivisionBtn");
    if (addDivisionBtn) addDivisionBtn.onclick = addDivision;

    const divisionInput = document.getElementById("divisionInput");
    if (divisionInput) {
      divisionInput.addEventListener("keyup", e => {
        if (e.key === "Enter") addDivision();
      });
    }

    loadData();

    const enableColorEl = document.getElementById("enableColor");
    if (enableColorEl) {
      enableColorEl.onchange = setupDivisionButtons;
    }

    setupDivisionButtons();
    renderDivisionDetailPane();
  }
  window.initApp1 = initApp1;

  // Expose some helpers
  window.getDivisions = () => divisions;

  // Sports
  window.getAllGlobalSports = function () {
    return (allSports || []).slice().sort();
  };
  window.addGlobalSport = function (sportName) {
    if (!sportName) return;
    const s = sportName.trim();
    if (s && !allSports.find(sp => sp.toLowerCase() === s.toLowerCase())) {
      allSports.push(s);
      saveData();
    }
  };

  // Skeletons
  window.getSavedSkeletons = function () {
    return savedSkeletons || {};
  };
  window.saveSkeleton = function (name, skeletonData) {
    if (!name || !skeletonData) return;
    savedSkeletons[name] = skeletonData;
    saveData();
  };
  window.deleteSkeleton = function (name) {
    if (!name) return;
    delete savedSkeletons[name];
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

  // Special activities
  window.getGlobalSpecialActivities = function () {
    return specialActivities;
  };
  window.saveGlobalSpecialActivities = function (updatedActivities) {
    specialActivities = updatedActivities;
    saveData();
  };

  // Keep helper name for other modules
  window.addDivisionBunk = addBunkToDivision;

})();
