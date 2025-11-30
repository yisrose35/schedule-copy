// ============================================================================
// scheduler_ui.js  —  MODERN UI (ENGINE-ALIGNED VERSION)
// ============================================================================
//
// 100% aligned with the NEW Logic Core:
// - No usage of manualSkeleton.event for generated blocks
// - Reads ONLY scheduleAssignments for activity labels
// - Smart Tile support (block A, block B, fallback, categories)
// - League rows (_h2h + _allMatchups)
// - Staggered multi-division schedule layout
// - Editable UI cells
// - Fully robust: no undefined .event errors ever again
//
// ============================================================================

(function () {
  "use strict";

  const INCREMENT_MINS = 30;

  // ========================================================================
  // TIME HELPERS
  // ========================================================================
  function parseTimeToMinutes(str) {
    if (!str || typeof str !== "string") return null;
    let s = str.trim().toLowerCase();
    let mer = null;

    if (s.endsWith("am") || s.endsWith("pm")) {
      mer = s.endsWith("am") ? "am" : "pm";
      s = s.replace(/am|pm/g, "").trim();
    } else return null;

    const m = s.match(/^(\d{1,2})\s*:\s*(\d{2})$/);
    if (!m) return null;

    let h = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    if (mm < 0 || mm > 59) return null;

    if (h === 12) h = (mer === "am") ? 0 : 12;
    else if (mer === "pm") h += 12;

    return h * 60 + mm;
  }

  function minutesToTimeLabel(min) {
    const h24 = Math.floor(min / 60);
    const m = String(min % 60).padStart(2, "0");
    const ap = h24 >= 12 ? "PM" : "AM";
    const h12 = h24 % 12 || 12;
    return `${h12}:${m} ${ap}`;
  }

  // ========================================================================
  // SCHEDULE ENTRY ACCESS
  // ========================================================================
  function getEntry(bunk, slotIndex) {
    const a = window.scheduleAssignments || {};
    return (a[bunk] && a[bunk][slotIndex]) || null;
  }

  // Modern activity formatting
  function formatEntry(entry) {
    if (!entry) return "";

    // Dismissal / Snacks (rare, but supported)
    if (entry._isDismissal) return "Dismissal";
    if (entry._isSnack) return "Snacks";

    // League row (head-to-head)
    if (entry._h2h) return entry.sport || "League Game";

    // Category-aware display
    if (entry._category && entry._activity) return entry._activity;

    // Fallback fixed block
    if (entry._fixed) return entry.field || entry._activity || "";

    // Standard sports activity
    if (entry.sport) return `${entry.field} – ${entry.sport}`;

    // Default
    return entry._activity || entry.field || "";
  }

  // ========================================================================
  // UI EDIT — Manually override a cell
  // ========================================================================
  function findSlotsForRange(startMin, endMin) {
    const slots = [];
    const times = window.unifiedTimes;
    if (!times) return slots;

    for (let i = 0; i < times.length; i++) {
      const slotStart =
        new Date(times[i].start).getHours() * 60 +
        new Date(times[i].start).getMinutes();

      if (slotStart >= startMin && slotStart < endMin) {
        slots.push(i);
      }
    }
    return slots;
  }

  function editCell(bunk, startMin, endMin, current) {
    if (!bunk) return;

    const newName = prompt(
      `Edit activity for ${bunk}\n${minutesToTimeLabel(startMin)} - ${minutesToTimeLabel(endMin)}\n(Enter CLEAR or FREE to empty)`,
      current
    );

    if (newName === null) return;

    const value = newName.trim();
    const slots = findSlotsForRange(startMin, endMin);

    if (!window.scheduleAssignments[bunk])
      window.scheduleAssignments[bunk] = new Array(window.unifiedTimes.length);

    if (!value || value.toUpperCase() === "CLEAR" || value.toUpperCase() === "FREE") {
      slots.forEach((idx, i) => {
        window.scheduleAssignments[bunk][idx] = {
          field: "Free",
          sport: null,
          continuation: i > 0,
          _fixed: true,
          _activity: "Free",
          _category: "General Activity"
        };
      });
    } else {
      slots.forEach((idx, i) => {
        window.scheduleAssignments[bunk][idx] = {
          field: value,
          sport: null,
          continuation: i > 0,
          _fixed: true,
          _activity: value,
          _category: "General Activity"
        };
      });
    }

    saveSchedule();
    updateTable();
  }

  // ========================================================================
  // SLOT HELPERS
  // ========================================================================
  function findFirstSlotForTime(startMin) {
    if (!window.unifiedTimes) return -1;

    for (let i = 0; i < window.unifiedTimes.length; i++) {
      const slotStart =
        new Date(window.unifiedTimes[i].start).getHours() * 60 +
        new Date(window.unifiedTimes[i].start).getMinutes();

      if (slotStart >= startMin && slotStart < startMin + INCREMENT_MINS)
        return i;
    }
    return -1;
  }

  // ========================================================================
  // MAIN TABLE RENDERER
  // ========================================================================
  function updateTable() {
    const container = document.getElementById("scheduleTable");
    if (!container) return;
    renderStaggeredView(container);
  }

  // ========================================================================
  // STAGGERED VIEW RENDERING
  // ========================================================================
  function renderStaggeredView(container) {
    container.innerHTML = "";

    const divisions = window.divisions || {};
    const availableDivisions = window.availableDivisions || [];

    const daily = window.loadCurrentDailyData?.() || {};
    const manualSkeleton = daily.manualSkeleton || [];

    if (!Array.isArray(manualSkeleton) || manualSkeleton.length === 0) {
      container.innerHTML = `<p>No daily schedule generated for this date.</p>`;
      return;
    }

    const wrapper = document.createElement("div");
    wrapper.className = "schedule-view-wrapper";
    container.appendChild(wrapper);

    availableDivisions.forEach((div) => {
      const bunks = (divisions[div]?.bunks || []).slice().sort();
      if (bunks.length === 0) return;

      // Create table for this division
      const table = document.createElement("table");
      table.className = "schedule-division-table";

      // Header
      const thead = document.createElement("thead");
      const tr1 = document.createElement("tr");

      const head = document.createElement("th");
      head.colSpan = 1 + bunks.length;
      head.textContent = div;
      head.style.background = divisions[div]?.color || "#444";
      head.style.color = "#fff";
      tr1.appendChild(head);
      thead.appendChild(tr1);

      // Bunk header row
      const tr2 = document.createElement("tr");
      const thTime = document.createElement("th");
      thTime.textContent = "Time";
      tr2.appendChild(thTime);

      bunks.forEach((b) => {
        const thB = document.createElement("th");
        thB.textContent = b;
        tr2.appendChild(thB);
      });

      thead.appendChild(tr2);
      table.appendChild(thead);

      // Body
      const tbody = document.createElement("tbody");

      // Flatten skeleton blocks
      const blocks = manualSkeleton
        .filter((b) => b.division === div)
        .map((b) => ({
          ...b,
          startMin: parseTimeToMinutes(b.startTime),
          endMin: parseTimeToMinutes(b.endTime),
        }))
        .filter((b) => b.startMin !== null && b.endMin !== null)
        .sort((a, b) => a.startMin - b.startMin);

      // Flatten split blocks
      const expanded = [];
      blocks.forEach((b) => {
        if (b.type === "split") {
          const mid = b.startMin + (b.endMin - b.startMin) / 2;

          expanded.push({
            ...b,
            endMin: mid,
            label: `${minutesToTimeLabel(b.startMin)} - ${minutesToTimeLabel(mid)}`,
          });
          expanded.push({
            ...b,
            startMin: mid,
            label: `${minutesToTimeLabel(mid)} - ${minutesToTimeLabel(b.endMin)}`,
          });
        } else {
          expanded.push({
            ...b,
            label: `${minutesToTimeLabel(b.startMin)} - ${minutesToTimeLabel(b.endMin)}`,
          });
        }
      });

      // Render each row
      expanded.forEach((block) => {
        const tr = document.createElement("tr");

        const tdTime = document.createElement("td");
        tdTime.textContent = block.label;
        tr.appendChild(tdTime);

        const slotIdx = findFirstSlotForTime(block.startMin);
        const firstEntry = slotIdx >= 0 ? getEntry(bunks[0], slotIdx) : null;

        // Detect league row
        const isLeague = firstEntry && firstEntry._h2h;

        if (isLeague) {
          const td = document.createElement("td");
          td.colSpan = bunks.length;
          td.style.background = "#eef7f8";
          td.style.fontWeight = "bold";

          const allMatchups = firstEntry._allMatchups || [];
          if (allMatchups.length === 0) {
            td.textContent = "League Game";
          } else {
            td.innerHTML = `
              <div>League Matchups</div>
              <ul>${allMatchups.map(m => `<li>${m}</li>`).join("")}</ul>
            `;
          }

          tr.appendChild(td);
          tbody.appendChild(tr);
          return;
        }

        // NORMAL BLOCK ROW
        bunks.forEach((bunk) => {
          const td = document.createElement("td");
          const entry = getEntry(bunk, slotIdx);

          const label = formatEntry(entry);

          td.textContent = label;
          td.style.cursor = "pointer";

          // Allow manual editing
          td.onclick = () =>
            editCell(bunk, block.startMin, block.endMin, label);

          tr.appendChild(td);
        });

        tbody.appendChild(tr);
      });

      table.appendChild(tbody);
      wrapper.appendChild(table);
    });
  }

  // ========================================================================
  // SAVE / LOAD
  // ========================================================================
  function saveSchedule() {
    window.saveCurrentDailyData?.("scheduleAssignments", window.scheduleAssignments);
    window.saveCurrentDailyData?.("leagueAssignments", window.leagueAssignments);
    window.saveCurrentDailyData?.("unifiedTimes", window.unifiedTimes);
  }

  // Load saved engine output
  function reconcileOrRenderSaved() {
    try {
      const data = window.loadCurrentDailyData?.() || {};

      window.scheduleAssignments = data.scheduleAssignments || {};
      window.leagueAssignments = data.leagueAssignments || {};

      const savedTimes = data.unifiedTimes || [];
      window.unifiedTimes = savedTimes.map((slot) => ({
        ...slot,
        start: new Date(slot.start),
        end: new Date(slot.end),
      }));
    } catch (e) {
      console.error("Schedule load error:", e);
      window.scheduleAssignments = {};
      window.leagueAssignments = {};
      window.unifiedTimes = [];
    }

    updateTable();
  }

  // ========================================================================
  // INIT
  // ========================================================================
  function initScheduleSystem() {
    reconcileOrRenderSaved();
  }

  // ========================================================================
  // EXPORTS
  // ========================================================================
  window.updateTable = updateTable;
  window.initScheduleSystem = initScheduleSystem;
  window.saveSchedule = saveSchedule;

})();
