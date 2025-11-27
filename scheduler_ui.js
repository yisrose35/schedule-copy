// ================================================================
// scheduler_ui.js  (UPDATED FOR NEW 10-MODULE CORE)
// ================================================================
//
// VISUALS KEPT THE SAME:
//  - Staggered (YKLI) grid
//  - One table per division
//  - Split blocks rendered as two rows
//  - League mirroring (_allMatchups)
//  - Click-to-edit every cell
//
// INTERNALS UPDATED:
//  - Reads from new coreResult.timeline
//  - Reads from new coreResult.assignments
//  - Reads from new coreResult.blocks
//  - Reads from new coreResult.leagueMatches
//  - Updated findSlotsForRange to match timeline[minStart/minEnd]
//  - Updated getEntry()
//  - Updated dismissal/snack/pin detection
// ================================================================


// ===== CONSTANT =====
const INCREMENT_MINS = 30;


// ===== TIME HELPERS =====
function minutesToLabel(m) {
  let h = Math.floor(m / 60);
  const mm = (m % 60).toString().padStart(2, "0");
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${mm} ${ap}`;
}

function parseMinFromTimelineSlot(slot) {
  return {
    start: slot.start,
    end: slot.end
  };
}


// ===== MATCHING GENERATED EVENTS =====
const UI_GENERATED_EVENTS = new Set([
  "activity",
  "general activity slot",
  "sports slot",
  "sports",
  "special activity",
  "swim",
  "league game",
  "specialty league"
]);

function uiEventGenerated(name) {
  if (!name) return false;
  const n = String(name).trim().toLowerCase();
  return UI_GENERATED_EVENTS.has(n);
}


// ===== SCHEDULE ENTRY ACCESS =====
function getEntry(bunk, slotIndex) {
  const a = window.coreResult?.assignments || {};
  if (!a[bunk]) return null;
  return a[bunk][slotIndex] || null;
}


// ===== FIND SLOTS GIVEN MINUTE RANGE =====
function findSlotsForRange(startMin, endMin) {
  const slots = [];
  const timeline = window.coreResult?.timeline || [];
  for (let i = 0; i < timeline.length; i++) {
    const s = timeline[i].start;
    if (s >= startMin && s < endMin) slots.push(i);
  }
  return slots;
}

function firstSlotForStart(min) {
  const timeline = window.coreResult?.timeline || [];
  for (let i = 0; i < timeline.length; i++) {
    if (timeline[i].start === min) return i;
  }
  return -1;
}


// ===== CLICK-TO-EDIT =====
function editCell(bunk, startMin, endMin, currentLabel) {
  const newName = prompt(
    `Edit activity for ${bunk}\n(${minutesToLabel(startMin)} - ${minutesToLabel(endMin)}):`,
    currentLabel
  );
  if (newName === null) return;

  const cleaned = newName.trim();
  const slots = findSlotsForRange(startMin, endMin);

  if (!window.coreResult.assignments[bunk]) {
    window.coreResult.assignments[bunk] = new Array(window.coreResult.timeline.length);
  }

  slots.forEach((slotIndex, idx) => {
    let entry = {
      field: cleaned,
      sport: null,
      continuation: idx > 0,
      _fixed: true,
      _h2h: false,
      _activity: cleaned
    };
    window.coreResult.assignments[bunk][slotIndex] = entry;
  });

  saveUIState();
  updateTable();
}


// ===== SAVE TO DAILY DATA =====
function saveUIState() {
  window.saveCurrentDailyData?.("coreResult", window.coreResult);
}


// ==================================================================
// MAIN TABLE RENDERER (staggered view, same as original UI)
// ==================================================================
function updateTable() {
  const container = document.getElementById("scheduleTable");
  if (!container) return;

  const blocks = window.coreResult?.blocks || [];
  const divisions = window.divisions || {};
  const availableDivisions = window.availableDivisions || [];

  container.innerHTML = "";

  const wrapper = document.createElement("div");
  wrapper.className = "schedule-view-wrapper";
  container.appendChild(wrapper);

  availableDivisions.forEach(divName => {
    const div = divisions[divName];
    const bunks = (div?.bunks || []).sort();
    if (bunks.length === 0) return;

    const table = document.createElement("table");
    table.className = "schedule-division-table";

    // ===== HEADER =====
    const thead = document.createElement("thead");
    const tr1 = document.createElement("tr");
    const thDiv = document.createElement("th");
    thDiv.colSpan = 1 + bunks.length;
    thDiv.textContent = divName;
    thDiv.style.background = div.color || "#333";
    thDiv.style.color = "#fff";
    tr1.appendChild(thDiv);
    thead.appendChild(tr1);

    const tr2 = document.createElement("tr");
    const thTime = document.createElement("th");
    thTime.textContent = "Time";
    tr2.appendChild(thTime);
    bunks.forEach(b => {
      const th = document.createElement("th");
      th.textContent = b;
      tr2.appendChild(th);
    });
    thead.appendChild(tr2);
    table.appendChild(thead);

    // ===== BODY =====
    const tbody = document.createElement("tbody");

    // filter blocks for this division
    let divBlocks = blocks
      .filter(b => b.division === divName)
      .map(b => ({
        ...b,
        label: `${minutesToLabel(b.start)} - ${minutesToLabel(b.end)}`
      }));

    // split blocks into halves if type === "split"
    const finalBlocks = [];
    for (let b of divBlocks) {
      if (b.type === "split") {
        const mid = b.start + (b.end - b.start) / 2;
        finalBlocks.push({ ...b, start: b.start, end: mid, label: `${minutesToLabel(b.start)} - ${minutesToLabel(mid)}`, splitPart: 1 });
        finalBlocks.push({ ...b, start: mid, end: b.end, label: `${minutesToLabel(mid)} - ${minutesToLabel(b.end)}`, splitPart: 2 });
      } else {
        finalBlocks.push(b);
      }
    }

    // ===== RENDER ROWS =====
    finalBlocks.forEach(block => {
      const tr = document.createElement("tr");

      // TIME CELL
      const tdTime = document.createElement("td");
      tdTime.textContent = block.label;
      tdTime.style.fontWeight = "bold";
      tr.appendChild(tdTime);

      // DETECT SPECIAL ROW TYPES
      const eventLc = (block.event || "").toLowerCase();
      const isDismissal = eventLc.includes("dismissal");
      const isSnacks = eventLc.includes("snack");
      const isGenerated = uiEventGenerated(block.event);

      // LEAGUE BLOCK: FULL-WIDTH MERGED
      if (eventLc.includes("league")) {
        const td = document.createElement("td");
        td.colSpan = bunks.length;
        td.style.background = "#e8f4ff";
        td.style.fontWeight = "bold";

        const match = (window.coreResult.leagueMatches || []).find(
          m => m.division === divName && m.time === block.start
        );

        if (match?.matchups?.length) {
          td.innerHTML = `<div>${block.event}</div><ul>${match.matchups.map(m => `<li>${m}</li>`).join("")}</ul>`;
        } else {
          td.textContent = block.event;
        }

        tr.appendChild(td);
        tbody.appendChild(tr);
        return;
      }

      // NORMAL CELLS
      bunks.forEach(bunk => {
        const td = document.createElement("td");

        const slotIndex = firstSlotForStart(block.start);
        const entry = getEntry(bunk, slotIndex);

        let cellLabel = block.event;

        if (isDismissal) {
          cellLabel = "Dismissal";
          td.style.background = "#ffecec";
        } else if (isSnacks) {
          cellLabel = "Snacks";
          td.style.background = "#e8f5e9";
        } else if (isGenerated) {
          cellLabel = entry ? (entry._h2h ? entry.sport : entry.field) : block.event;
          if (entry?._h2h) td.style.background = "#e3f2fd";
        } else {
          // pin tile
          cellLabel = block.event;
          td.style.background = "#fff8e1";
        }

        td.textContent = cellLabel;
        td.style.cursor = "pointer";
        td.onclick = () => editCell(bunk, block.start, block.end, cellLabel);

        tr.appendChild(td);
      });

      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    wrapper.appendChild(table);
  });
}


// ===== INIT =====
function initScheduleSystem() {
  try {
    const data = window.loadCurrentDailyData?.() || {};
    if (data.coreResult) {
      window.coreResult = {
        ...data.coreResult,
        timeline: data.coreResult.timeline.map(t => ({ start: t.start, end: t.end }))
      };
    }
  } catch {
    window.coreResult = { timeline: [], assignments: {}, blocks: [] };
  }

  updateTable();
}


// ===== EXPORTS =====
window.initScheduleSystem = initScheduleSystem;
window.updateTable = updateTable;
window.saveUIState = saveUIState;
