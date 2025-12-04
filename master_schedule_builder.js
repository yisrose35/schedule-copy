// =================================================================
// master_schedule_builder.js (UPDATED for Continuous Minute Timeline)
//
// Updates:
// 1. Removed INCREMENT_MINS constant.
// 2. Drop logic uses 5-minute snapping and absolute minute boundaries for placement.
// 3. Removed dependence on slot-based calculation helpers.
// =================================================================

(function () {
  "use strict";

  let container = null,
    palette = null,
    grid = null;
  let dailySkeleton = [];

  // --- Constants ---
  const SKELETON_DRAFT_KEY = "master-schedule-draft";
  const SKELETON_DRAFT_NAME_KEY = "master-schedule-draft-name";
  const PIXELS_PER_MINUTE = 2;

  
// --- Core Helper Functions ---
const parseTimeToMinutes =
  (window.SchedulerCoreUtils && window.SchedulerCoreUtils.parseTimeToMinutes)
  || function (str) {
      if (!str) return null;
      const d = new Date("1970-01-01 " + str);
      return isNaN(d.getTime()) ? null : d.getHours() * 60 + d.getMinutes();
    };

const minutesToTime =
  (window.SchedulerCoreUtils && window.SchedulerCoreUtils.minutesToTime)
  || function (mins) {
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      const ampm = h >= 12 ? "pm" : "am";
      const hr = ((h + 11) % 12) + 1;
      return `${hr}:${m.toString().padStart(2, "0")}${ampm}`;
    };



  // =====================================================================
  // PERSISTENCE
  // =====================================================================
  function saveDraftToLocalStorage() {
    try {
      if (dailySkeleton && dailySkeleton.length > 0) {
        localStorage.setItem(SKELETON_DRAFT_KEY, JSON.stringify(dailySkeleton));
      } else {
        localStorage.removeItem(SKELETON_DRAFT_KEY);
      }
    } catch (e) {
      console.error(e);
    }
  }

  function clearDraftFromLocalStorage() {
    localStorage.removeItem(SKELETON_DRAFT_KEY);
    localStorage.removeItem(SKELETON_DRAFT_NAME_KEY);
  }

  // =====================================================================
  // TILE DEFINITIONS
  // =====================================================================
  const TILES = [
    {
      type: "activity",
      name: "Activity",
      style: "background:#e0f7fa;border:1px solid #007bff;",
      description: "Flexible slot (Sport or Special).",
    },
    {
      type: "sports",
      name: "Sports",
      style: "background:#dcedc8;border:1px solid #689f38;",
      description: "Sports slot only.",
    },
    {
      type: "special",
      name: "Special Activity",
      style: "background:#e8f5f9;border:1px solid #43a047;",
      description: "Special Activity slot only.",
    },
    {
      type: "smart",
      name: "Smart Tile",
      style: "background:#e3f2fd;border:2px dashed #0288d1;color:#01579b;",
      description: "Balances 2 activities with a fallback.",
    },
    {
      type: "split",
      name: "Split Activity",
      style: "background:#fff3e0;border:1px solid #f57c00;",
      description: "Two activities share the block (Switch halfway).",
    },
    {
      type: "league",
      name: "League Game",
      style: "background:#d1c4e9;border:1px solid #5e35b1;",
      description: "Regular League slot (Full Buyout).",
    },
    {
      type: "specialty_league",
      name: "Specialty League",
      style: "background:#fff8e1;border:1px solid #f9a825;",
      description: "Specialty League slot (Full Buyout).",
    },
    {
      type: "swim",
      name: "Swim",
      style: "background:#bbdefb;border:1px solid #1976d2;",
      description: "Pinned.",
    },
    {
      type: "lunch",
      name: "Lunch",
      style: "background:#fbe9e7;border:1px solid #d84315;",
      description: "Pinned.",
    },
    {
      type: "snacks",
      name: "Snacks",
      style: "background:#fff9c4;border:1px solid #fbc02d;",
      description: "Pinned.",
    },
    {
      type: "dismissal",
      name: "Dismissal",
      style:
        "background:#f44336;color:white;border:1px solid #b71c1c;",
      description: "Pinned.",
    },
    {
      type: "custom",
      name: "Custom Pinned Event",
      style: "background:#eee;border:1px solid #616161;",
      description: "Pinned custom (e.g., Regroup).",
    },
  ];

  // =====================================================================
  // OPTIMIZER MAPPING
  // =====================================================================
  function mapEventNameForOptimizer(name) {
    if (!name) name = "Free";
    const lower = name.toLowerCase().trim();
    if (lower === "activity") return { type: "slot", event: "General Activity Slot" };
    if (lower === "sports") return { type: "slot", event: "Sports Slot" };
    if (lower === "special activity" || lower === "special")
      return { type: "slot", event: "Special Activity" };
    if (["swim", "lunch", "snacks", "dismissal"].includes(lower))
      return { type: "pinned", event: name };
    return { type: "pinned", event: name };
  }

  // =====================================================================
  // INIT
  // =====================================================================
  function init() {
    container = document.getElementById("master-scheduler-content");
    if (!container) return;

    loadDailySkeleton();

    const savedDraft = localStorage.getItem(SKELETON_DRAFT_KEY);
    if (savedDraft) {
      if (confirm("Load unsaved master schedule draft?")) {
        dailySkeleton = JSON.parse(savedDraft);
      } else {
        clearDraftFromLocalStorage();
      }
    }

    container.innerHTML = `
      <div id="scheduler-template-ui" style="padding:15px;background:#f9f9f9;border:1px solid #ddd;border-radius:8px;margin-bottom:20px;"></div>
      <div id="scheduler-palette" style="padding:10px;background:#f4f4f4;border-radius:8px;margin-bottom:15px;display:flex;flex-wrap:wrap;gap:10px;"></div>
      <div id="scheduler-grid-wrapper" style="overflow-x:auto; border:1px solid #999; background:#fff;">
          <div id="scheduler-grid"></div>
      </div>

      <style>
        .grid-disabled {
          position:absolute;
          width:100%;
          background-color:#80808040;
          background-image:linear-gradient(-45deg,#0000001a 25%,transparent 25%,transparent 50%,#0000001a 50%,#0000001a 75%,transparent 75%,transparent);
          background-size:20px 20px;
          z-index:1;
          pointer-events:none;
        }
        .grid-event {
          z-index:2;
          position:relative;
          box-shadow:0 1px 3px rgba(0,0,0,0.2);
        }
        .grid-cell {
          position:relative;
          border-right:1px solid #ccc;
          background:#fff;
        }
      </style>
    `;

    palette = document.getElementById("scheduler-palette");
    grid = document.getElementById("scheduler-grid");

    renderTemplateUI();
    renderPalette();
    renderGrid();
  }

  // =====================================================================
  // TEMPLATE UI
  // =====================================================================
  function renderTemplateUI() {
    const ui = document.getElementById("scheduler-template-ui");
    if (!ui) return;

    const saved = window.getSavedSkeletons?.() || {};
    const names = Object.keys(saved).sort();
    const assignments = window.getSkeletonAssignments?.() || {};

    let loadOptions = names.map((n) => `<option value="${n}">${n}</option>`).join("");

    ui.innerHTML = `
      <div class="template-toolbar" style="display:flex;flex-wrap:wrap;gap:20px;align-items:flex-end;">
        <div class="template-group">
          <label>Load Template</label>
          <select id="template-load-select" style="padding:6px;">
            <option value="">-- Select --</option>
            ${loadOptions}
          </select>
        </div>

        <div class="template-group">
          <label>Save As</label>
          <input type="text" id="template-save-name" placeholder="Name...">
        </div>

        <div class="template-group">
          <label>&nbsp;</label>
          <button id="template-save-btn" style="background:#007bff;color:#fff;">Save</button>
          <button id="template-clear-btn" style="background:#ff9800;color:#fff;margin-left:8px;">New</button>
        </div>
      </div>

      <details style="margin-top:10px;">
        <summary style="cursor:pointer;color:#007bff;">Assignments & Delete</summary>
        <div style="margin-top:10px;padding:10px;border:1px solid #eee;">
          <div style="display:flex;flex-wrap:wrap;gap:10px;">
            ${["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Default"]
              .map(
                (day) => `
              <div>
                <label>${day}</label><br>
                <select data-day="${day}" style="width:100px;">
                  ${loadOptions}
                </select>
              </div>`
              )
              .join("")}
          </div>

          <button id="template-assign-save-btn" style="margin-top:10px;background:#28a745;color:white;">
            Save Assignments
          </button>

          <hr>

          <button id="template-delete-btn" style="background:#c0392b;color:white;">
            Delete Selected Template
          </button>
        </div>
      </details>
    `;

    const loadSel = document.getElementById("template-load-select");
    const saveName = document.getElementById("template-save-name");

    loadSel.onchange = () => {
      const name = loadSel.value;
      if (name && saved[name] && confirm(`Load "${name}"?`)) {
        loadSkeletonToBuilder(name);

        saveName.value = name;
      }
    };

    document.getElementById("template-save-btn").onclick = () => {
      const name = saveName.value.trim();
      if (name && confirm(`Save as "${name}"?`)) {
        window.saveSkeleton?.(name, dailySkeleton);
        clearDraftFromLocalStorage();
        alert("Saved.");
        renderTemplateUI();
      }
    };

    document.getElementById("template-clear-btn").onclick = () => {
      if (confirm("Clear grid and start new?")) {
        dailySkeleton = [];
        clearDraftFromLocalStorage();
        renderGrid();
      }
    };

    ui.querySelectorAll("select[data-day]").forEach((sel) => {
      const day = sel.dataset.day;
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "-- None --";
      sel.prepend(opt);
      sel.value = assignments[day] || "";
    });

    document.getElementById("template-assign-save-btn").onclick = () => {
      const map = {};
      ui.querySelectorAll("select[data-day]").forEach((s) => {
        if (s.value) map[s.dataset.day] = s.value;
      });
      window.saveSkeletonAssignments?.(map);
      alert("Assignments Saved.");
    };
  }

  // =====================================================================
  // PALETTE
  // =====================================================================
  function renderPalette() {
    palette.innerHTML = "";
    TILES.forEach((tile) => {
      const el = document.createElement("div");
      el.className = "grid-tile-draggable";
      el.textContent = tile.name;
      el.style.cssText = tile.style;
      el.style.padding = "8px 12px";
      el.style.borderRadius = "5px";
      el.style.cursor = "grab";
      el.draggable = true;

      el.ondragstart = (e) => {
        e.dataTransfer.setData("application/json", JSON.stringify(tile));
      };

      palette.appendChild(el);
    });
  }

  // =====================================================================
// RENDER GRID
// =====================================================================
function renderGrid() {

  // Pull divisions from global settings (App1 format)
  const gs = window.loadGlobalSettings?.() || {};
  const app1 = gs.app1 || {};

  const divisions = app1.divisions || {};
  const availableDivisions = app1.availableDivisions || [];

  if (availableDivisions.length === 0) {
    grid.innerHTML =
      `<div style="padding:20px;text-align:center;color:#666;">No divisions found. Please go to Setup to create divisions.</div>`;
    return;
  }

  let earliestMin = null,
    latestMin = null;

  Object.values(divisions).forEach((div) => {
    const s = parseTimeToMinutes(div.startTime);
    const e = parseTimeToMinutes(div.endTime);
    if (s !== null && (earliestMin === null || s < earliestMin)) earliestMin = s;
    if (e !== null && (latestMin === null || e > latestMin)) latestMin = e;
  });

  if (earliestMin === null) earliestMin = 540;
  if (latestMin === null) latestMin = 960;

  const latestPinned = Math.max(
    -Infinity,
    ...dailySkeleton.map((ev) => parseTimeToMinutes(ev.endTime) || -Infinity)
  );
  if (latestPinned > -Infinity) latestMin = Math.max(latestMin, latestPinned);
  if (latestMin <= earliestMin) latestMin = earliestMin + 60;

  const totalHeight = (latestMin - earliestMin) * PIXELS_PER_MINUTE;

  const TIME_LABEL_INCREMENT = 30;

  const timeLabels = [];
  for (let min = earliestMin; min < latestMin; min += TIME_LABEL_INCREMENT) {
    timeLabels.push({
      start: min,
      end: Math.min(min + TIME_LABEL_INCREMENT, latestMin),
    });
  }

  let html = `<div style="display:grid; grid-template-columns:60px repeat(${availableDivisions.length}, 1fr); position:relative; min-width:800px;">`;

  // Header row
  html += `
    <div style="grid-row:1; position:sticky; top:0; background:#fff; z-index:10; border-bottom:1px solid #999; padding:8px; font-weight:bold;">Time</div>
  `;

  availableDivisions.forEach((divName, i) => {
    const color = divisions[divName]?.color || "#444";
    html += `
      <div style="
        grid-row:1;
        grid-column:${i + 2};
        position:sticky; top:0;
        background:${color};
        color:#fff; z-index:10;
        border-bottom:1px solid #999;
        padding:8px; text-align:center; font-weight:bold;">
        ${divName}
      </div>`;
  });

  // Time column
  html += `
    <div style="grid-row:2; grid-column:1; height:${totalHeight}px; position:relative; background:#f9f9f9; border-right:1px solid #ccc;">
  `;

  timeLabels.forEach(({ start, end }) => {
    const top = (start - earliestMin) * PIXELS_PER_MINUTE;
    const height = (end - start) * PIXELS_PER_MINUTE;

    html += `
      <div style="
        position:absolute;
        top:${top}px;
        left:0;
        width:100%;
        height:${height}px;
        border-bottom:1px dashed #ddd;
        font-size:10px; color:#666; padding:2px;">
        ${minutesToTime(start)}
      </div>
    `;
  });

  html += `</div>`;

  // Division columns
  availableDivisions.forEach((divName, i) => {
    const div = divisions[divName];
    const s = parseTimeToMinutes(div?.startTime);
    const e = parseTimeToMinutes(div?.endTime);

    html += `
      <div class="grid-cell"
           data-div="${divName}"
           data-start-min="${earliestMin}"
           style="grid-row:2; grid-column:${i + 2}; height:${totalHeight}px;">
    `;

    if (s !== null && s > earliestMin) {
      html += `
        <div class="grid-disabled"
             style="top:0; height:${(s - earliestMin) * PIXELS_PER_MINUTE}px;"></div>
      `;
    }

    if (e !== null && e < latestMin) {
      html += `
        <div class="grid-disabled"
             style="top:${(e - earliestMin) * PIXELS_PER_MINUTE}px;
                    height:${(latestMin - e) * PIXELS_PER_MINUTE}px;"></div>
      `;
    }

    dailySkeleton
      .filter((ev) => ev.division === divName)
      .forEach((ev) => {
        const start = parseTimeToMinutes(ev.startTime);
        const end = parseTimeToMinutes(ev.endTime);
        if (start != null && end != null && end > start) {
          const top = (start - earliestMin) * PIXELS_PER_MINUTE;
          const height = (end - start) * PIXELS_PER_MINUTE;
          html += renderEventTile(ev, top, height);
        }
      });

    html += `</div>`;
  });

  html += `</div>`;
  grid.innerHTML = html;

  addDropListeners(".grid-cell");
  addRemoveListeners(".grid-event");
}

  // =====================================================================
  // RENDER EVENT TILE
  // =====================================================================
  function renderEventTile(ev, top, height) {
    let tile = TILES.find((t) => t.name === ev.event) || TILES.find((t) => t.type === ev.type);
    const style = tile ? tile.style : "background:#eee;border:1px solid #666;";

    let label = `<strong>${ev.event}</strong><br>${ev.startTime}-${ev.endTime}`;

    if (ev.type === "smart" && ev.smartData) {
      label += `
        <br><span style="font-size:0.75em">
          F: ${ev.smartData.fallbackActivity}
          (if ${ev.smartData.fallbackFor.substring(0, 4)} busy)
        </span>`;
    }

    return `
      <div class="grid-event"
           data-id="${ev.id}"
           title="Click to remove"
           style="${style}; position:absolute; top:${top}px; height:${height}px;
                  width:96%; left:2%; padding:2px; font-size:0.85rem;
                  overflow:hidden; border-radius:4px; cursor:pointer;">
        ${label}
      </div>`;
  }

  // =====================================================================
  // DROP HANDLING
  // =====================================================================
  function addDropListeners(selector) {
    grid.querySelectorAll(selector).forEach((cell) => {
      cell.ondragover = (e) => {
        e.preventDefault();
        cell.style.background = "#e6fffa";
      };
      cell.ondragleave = () => {
        cell.style.background = "";
      };
      cell.ondrop = (e) => {
        e.preventDefault();
        cell.style.background = "";

        const tileData = JSON.parse(e.dataTransfer.getData("application/json"));
        const divName = cell.dataset.div;
        const div = window.divisions[divName] || {};
        const divStartMin = parseTimeToMinutes(div.startTime);
        const divEndMin = parseTimeToMinutes(div.endTime);

        const earliestMin = parseInt(cell.dataset.startMin, 10);

        const rect = cell.getBoundingClientRect();
        const y = e.clientY - rect.top;

        const snapped = Math.round(y / PIXELS_PER_MINUTE / 5) * 5;
        const startMin = earliestMin + snapped;
        const endMinDefault = startMin + 30;

        const startStrDefault = minutesToTime(startMin);
        const endStrDefault = minutesToTime(endMinDefault);

        function validateTime(t, isStart) {
          const m = parseTimeToMinutes(t);
          if (m === null) {
            alert("Invalid time format.");
            return null;
          }
          if (divStartMin !== null && m < divStartMin) {
            alert("Before division start time.");
            return null;
          }
          if (divEndMin !== null && m > divEndMin) {
            alert("After division end time.");
            return null;
          }
          if (!isStart && m <= parseTimeToMinutes(startStrDefault)) {
            alert("End must be after start.");
            return null;
          }
          return m;
        }

        let newEvent = null;

        // === SMART TILE ===
        if (tileData.type === "smart") {
          let st = prompt("Start Time:", startStrDefault);
          if (!st) return;
          let stMin = validateTime(st, true);
          if (stMin === null) return;

          let et = prompt("End Time:", minutesToTime(stMin + 30));
          if (!et) return;
          let etMin = validateTime(et, false);
          if (etMin === null) return;

          let mains = prompt("Enter TWO main activities (e.g. Swim / Sports):");
          if (!mains) return;

          let [m1, m2] = mains.split(/[\/,]/).map((s) => s.trim());
          if (!m1 || !m2) {
            alert("Need two activities.");
            return;
          }

          let fb = prompt(`Which requires fallback?\n1: ${m1}\n2: ${m2}`);
          if (!fb) return;
          let fallbackFor =
            fb === "1" || fb.toLowerCase() === m1.toLowerCase() ? m1 : m2;

          let fallbackActivity = prompt(
            `Fallback if ${fallbackFor} is full?`,
            "Sports"
          );

          newEvent = {
            id: "evt_" + Date.now(),
            type: "smart",
            event: `${m1} / ${m2}`,
            division: divName,
            startTime: minutesToTime(stMin),
            endTime: minutesToTime(etMin),
            smartData: {
              main1: m1,
              main2: m2,
              fallbackFor,
              fallbackActivity,
            },
          };
        }

        // === SPLIT TILE ===
        else if (tileData.type === "split") {
          let st = prompt("Start Time:", startStrDefault);
          if (!st) return;
          let stMin = validateTime(st, true);
          if (stMin === null) return;

          let et = prompt("End Time:", minutesToTime(stMin + 60));
          if (!et) return;
          let etMin = validateTime(et, false);
          if (etMin === null) return;

          let a1 = prompt("Activity 1:");
          if (!a1) return;
          let a2 = prompt("Activity 2:");
          if (!a2) return;

          newEvent = {
            id: "evt_" + Date.now(),
            type: "split",
            event: `${a1} / ${a2}`,
            division: divName,
            startTime: minutesToTime(stMin),
            endTime: minutesToTime(etMin),
            subEvents: [{ event: a1 }, { event: a2 }],
          };
        }

        // === STANDARD ===
        else {
          let name = tileData.name;

          if (tileData.type === "custom")
            name = prompt("Event Name:", "Regroup");
          else if (tileData.type === "league")
            name = "League Game";
          else if (tileData.type === "specialty_league")
            name = "Specialty League";

          if (!name) return;

          let st = prompt(`${name} Start:`, startStrDefault);
          if (!st) return;
          let stMin = validateTime(st, true);
          if (stMin === null) return;

          let et = prompt(`${name} End:`, minutesToTime(stMin + 30));
          if (!et) return;
          let etMin = validateTime(et, false);
          if (etMin === null) return;

          newEvent = {
            id: "evt_" + Date.now(),
            type: tileData.type,
            event: name,
            division: divName,
            startTime: minutesToTime(stMin),
            endTime: minutesToTime(etMin),
          };
        }

        if (newEvent) {
          dailySkeleton.push(newEvent);
          saveDraftToLocalStorage();
          renderGrid();
        }
      };
    });
  }

  // =====================================================================
  // REMOVE BLOCK
  // =====================================================================
  function addRemoveListeners(selector) {
    grid.querySelectorAll(selector).forEach((el) => {
      el.onclick = (e) => {
        e.stopPropagation();
        if (confirm("Delete this block?")) {
          const id = el.dataset.id;
          dailySkeleton = dailySkeleton.filter((x) => x.id !== id);
          saveDraftToLocalStorage();
          renderGrid();
        }
      };
    });
  }

  // =====================================================================
  // LOAD DAILY SKELETON FROM TEMPLATE
  // =====================================================================
  function loadDailySkeleton() {
    const assignments = window.getSkeletonAssignments?.() || {};
    const skeletons = window.getSavedSkeletons?.() || {};
    const dateStr = window.currentScheduleDate || "";

    const [Y, M, D] = dateStr.split("-").map(Number);
    let dow = 0;
    if (Y && M && D) dow = new Date(Y, M - 1, D).getDay();

    const dayNames = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];
    const today = dayNames[dow];

    let tmpl = assignments[today] || assignments["Default"];
    dailySkeleton =
      tmpl && skeletons[tmpl] ? JSON.parse(JSON.stringify(skeletons[tmpl])) : [];
  }

  function loadSkeletonToBuilder(name) {
    const all = window.getSavedSkeletons?.() || {};
    if (all[name]) dailySkeleton = JSON.parse(JSON.stringify(all[name]));
    renderGrid();
    saveDraftToLocalStorage();
  }

  // =====================================================================
  // INIT EXPOSE
  // =====================================================================
  window.initMasterScheduler = init;
})();
