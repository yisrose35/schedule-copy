// ============================================================================
// scheduler_ui.js  — FIXED RENDERER
// Fixes: "White Gaps" / Broken Grid Layout / Row Merging
// ============================================================================

(function () {
  "use strict";

  const TRANSITION_TYPE = window.TRANSITION_TYPE || "Transition/Buffer";

  // -------------------------------------------------------------------------
  // TIME HELPERS
  // -------------------------------------------------------------------------
  function minutesToTimeLabel(min) {
    const h24 = Math.floor(min / 60);
    const m = String(min % 60).padStart(2, "0");
    const ap = h24 >= 12 ? "PM" : "AM";
    const h12 = h24 % 12 || 12;
    return `${h12}:${m} ${ap}`;
  }

  // -------------------------------------------------------------------------
  // RESOURCE RESOLVER
  // -------------------------------------------------------------------------
  function resolveResourceName(input, knownNames) {
    if (!input || !knownNames) return null;
    const clean = String(input).toLowerCase().trim();

    if (knownNames.includes(input)) return input;

    const sorted = [...knownNames].sort((a, b) => b.length - a.length);
    for (const name of sorted) {
      if (clean.startsWith(name.toLowerCase())) return name;
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // GENERATED EVENT NAME CHECK
  // -------------------------------------------------------------------------
  const UI_GENERATED_EVENTS = new Set([
    "general activity",
    "general activity slot",
    "activity",
    "activities",
    "sports",
    "sport",
    "sports slot",
    "special activity",
    "swim",
    "league game",
    "specialty league"
  ]);

  function uiIsGeneratedEventName(name) {
    if (!name) return false;
    return UI_GENERATED_EVENTS.has(String(name).trim().toLowerCase());
  }

  // -------------------------------------------------------------------------
  // GET ENTRY FOR BUNK AT SPECIFIC START MINUTE
  // -------------------------------------------------------------------------
  function getEntry(bunk, startMin) {
    const a = window.scheduleAssignments || {};
    if (!a[bunk]) return null;
    return a[bunk][startMin] || null;
  }

  // -------------------------------------------------------------------------
  // FORMAT ENTRY (INCLUDING TRANSITIONS)
  // -------------------------------------------------------------------------
  function formatEntry(entry) {
    if (!entry) return "";
    if (entry._isDismissal) return "Dismissal";
    if (entry._isSnack) return "Snacks";

    if (entry.field === TRANSITION_TYPE) {
      return "🏃 Transition";
    }

    const label = entry._activity || entry.field || "";
    if (entry._h2h) return entry.sport || "League Game";
    if (entry._fixed) return label;
    if (entry.sport) return `${entry.field} – ${entry.sport}`;
    return label;
  }

  // -------------------------------------------------------------------------
  // EDIT CELL (MINUTE ACCURATE + FIXED)
  // -------------------------------------------------------------------------
  function editCell(bunk, startMin, endMin, current) {
    if (!bunk) return;

    const config = window.SchedulerCoreUtils.loadAndFilterData();
    const { activityProperties, divisions } = config;

    const divName = Object.keys(divisions).find(d =>
      divisions[d].bunks.includes(bunk)
    );

    const newInput = prompt(
      `Edit activity for ${bunk}\n${minutesToTimeLabel(
        startMin
      )} - ${minutesToTimeLabel(endMin)}\n(Enter CLEAR or FREE to empty)`,
      current
    );

    if (newInput === null) return;

    const value = newInput.trim();
    const isClear =
      value === "" ||
      value.toUpperCase() === "CLEAR" ||
      value.toUpperCase() === "FREE";

    // LOAD ORIGINAL FIELD BEFORE DELETING ANYTHING
    const origEntry = getEntry(bunk, startMin);
    const oldField = origEntry ? origEntry.field : null;

    // ---------------------------------------------------------------------
    // CLEAR / DELETE BLOCK
    // ---------------------------------------------------------------------
    if (isClear) {
      delete window.scheduleAssignments[bunk][startMin];

      // Clear reservations fully
      Object.keys(window.fieldReservationLog).forEach(field => {
        window.fieldReservationLog[field] = window.fieldReservationLog[field].filter(
          r => !(r.bunk === bunk && r.startMin === startMin)
        );
      });

      saveSchedule();
      updateTable();
      return;
    }

    // ---------------------------------------------------------------------
    // NORMAL EDIT (Rewrite block)
    // ---------------------------------------------------------------------
    const allNames = Object.keys(activityProperties);
    const resolvedName = resolveResourceName(value, allNames) || value;
    const props = activityProperties[resolvedName];

    // VALIDATION WARNINGS
    const warnings = [];

    if (props) {
      // Duration check
      const transRules = window.SchedulerCoreUtils.getTransitionRules(
        resolvedName,
        activityProperties
      );

      const { activityDuration } =
        window.SchedulerCoreUtils.getEffectiveTimeRange(
          { startTime: startMin, endTime: endMin },
          transRules
        );

      if (activityDuration < transRules.minDurationMin) {
        warnings.push(
          `⚠️ DURATION WARNING: Actual activity = ${activityDuration} min (min = ${transRules.minDurationMin}).`
        );
      }

      // Check capacity via canBlockFit
      const tempBlock = { bunk, startTime: startMin, endTime: endMin, divName };
      const canFit = window.SchedulerCoreUtils.canBlockFit(
        tempBlock,
        resolvedName,
        activityProperties,
        resolvedName
      );

      if (!canFit) {
        warnings.push(
          `⚠️ CAPACITY CONFLICT: "${resolvedName}" is full or blocked at this time.`
        );
      }
    }

    // If warnings exist: ask user
    if (warnings.length > 0) {
      const msg =
        warnings.join("\n\n") +
        `\n\nOverride these warnings and schedule anyway?`;

      if (!confirm(msg)) return;
    }

    // ---------------------------------------------------------------------
    // CLEAN OLD RESERVATIONS (critical fix)
    // ---------------------------------------------------------------------
    if (oldField) {
      Object.keys(window.fieldReservationLog).forEach(field => {
        window.fieldReservationLog[field] = window.fieldReservationLog[field].filter(
          r => !(r.bunk === bunk && r.startMin === startMin)
        );
      });
    }

    // Remove old assignment
    delete window.scheduleAssignments[bunk][startMin];

    // ---------------------------------------------------------------------
    // WRITE NEW BLOCK USING fillBlock (correct signature)
    // ---------------------------------------------------------------------
    window.fillBlock(
      {
        divName,
        bunk,
        startTime: startMin,
        endTime: endMin
      },
      {
        field: resolvedName,
        sport: null,
        _activity: resolvedName,
        _fixed: true
      },
      null,
      false,
      activityProperties,
      true
    );

    saveSchedule();
    updateTable();
  }

  // -------------------------------------------------------------------------
  // MAIN RENDERER (UPDATED TO MATCH MINUTE TIMELINE)
  // -------------------------------------------------------------------------
  function updateTable() {
    const container = document.getElementById("scheduleTable");
    if (!container) return;

    renderStaggeredView(container);
  }

  // -------------------------------------------------------------------------
  // STAGGERED MINUTE VIEW
  // -------------------------------------------------------------------------
  function renderStaggeredView(container) {
    container.innerHTML = "";

    const config = window.SchedulerCoreUtils.loadAndFilterData();
    const { divisions, availableDivisions } = config;

    const daily = window.loadCurrentDailyData?.() || {};
    const manualSkeleton = daily.manualSkeleton || [];

    const parseTime = window.SchedulerCoreUtils.parseTimeToMinutes;

    if (!Array.isArray(manualSkeleton) || manualSkeleton.length === 0) {
      container.innerHTML = "<p>No daily schedule generated.</p>";
      return;
    }

    const wrapper = document.createElement("div");
    wrapper.className = "schedule-view-wrapper";
    container.appendChild(wrapper);

    // -----------------------------------------------------
    // Collect all unique minute boundaries
    // -----------------------------------------------------
    const allTimes = new Set();

    // From Skeleton
    manualSkeleton.forEach(item => {
      const s = parseTime(item.startTime);
      const e = parseTime(item.endTime);
      if (s !== null) allTimes.add(s);
      if (e !== null) allTimes.add(e);
    });

    // From Actual Assignments (Critical for detecting generated blocks)
    Object.values(window.scheduleAssignments).forEach(sched => {
      Object.values(sched).forEach(entry => {
        if (entry.startMin != null) allTimes.add(entry.startMin);
        if (entry.endMin != null) allTimes.add(entry.endMin);
      });
    });

    const sorted = [...allTimes].sort((a, b) => a - b);

    // Build Time Segments
    const rows = [];
    for (let i = 0; i < sorted.length - 1; i++) {
      const start = sorted[i];
      const end = sorted[i + 1];
      if (end > start) {
        rows.push({
          startMin: start,
          endMin: end,
          label: `${minutesToTimeLabel(start)} - ${minutesToTimeLabel(end)}`
        });
      }
    }

    if (rows.length === 0) {
      container.innerHTML = "<p>Invalid time range.</p>";
      return;
    }

    // -----------------------------------------------------
    // Render each division
    // -----------------------------------------------------
    availableDivisions.forEach(div => {
      const bunks = divisions[div]?.bunks || [];
      if (bunks.length === 0) return;

      const table = document.createElement("table");
      table.className = "schedule-division-table";

      const head = document.createElement("thead");
      head.innerHTML = `
        <tr><th colspan="${1 + bunks.length}" style="background:${
        divisions[div]?.color || "#444"
      };color:white;">${div}</th></tr>
        <tr><th>Time</th>${bunks
          .map(b => `<th>${b}</th>`)
          .join("")}</tr>
      `;
      table.appendChild(head);

      const body = document.createElement("tbody");
      const skip = {}; // Tracks skip state per bunk (minutes)

      rows.forEach((row) => {
        const { startMin, endMin, label } = row;
        const tr = document.createElement("tr");

        // Time Column
        const tdTime = document.createElement("td");
        tdTime.textContent = label;
        tdTime.style.whiteSpace = "nowrap";
        tr.appendChild(tdTime);

        bunks.forEach(bunk => {
          // CHECK SKIP: If this bunk is already covered by a previous rowspan
          if (skip[bunk] && skip[bunk] > startMin) {
            return;
          }

          const entry = getEntry(bunk, startMin);

          let content = "";
          let rowspan = 1;
          let bg = "";

          if (entry) {
            // === FOUND ACTIVITY STARTING HERE ===
            const act = entry._activity;
            const isLeague = act === "League Game" || act === "Specialty League";
            bg = entry._fixed ? "#fff8e1" : (isLeague ? "#dbeeff" : "");
            content = formatEntry(entry);

            // --- MERGE LOGIC (THE FIX) ---
            let targetEnd = entry.endMin; // The definitive end time of this block

            // Look ahead at subsequent rows
            for (let rIndex = rows.indexOf(row) + 1; rIndex < rows.length; rIndex++) {
                const nextRow = rows[rIndex];

                // Case 1: The activity naturally covers this next row
                // (e.g. Activity ends at 12:00, nextRow is 11:30-12:00)
                if (nextRow.startMin < targetEnd) {
                    rowspan++;
                    continue;
                }

                // Case 2: Seamless continuation (Consecutive identical blocks)
                const nextEntry = getEntry(bunk, nextRow.startMin);
                if (nextEntry && nextEntry._activity === act) {
                    rowspan++;
                    targetEnd = nextEntry.endMin; // Extend our target
                } else {
                    break; // Stop merging
                }
            }

            // Mark this bunk as skipped until targetEnd
            skip[bunk] = targetEnd;

            // LEAGUE EXCEPTION: Render colSpan for the first bunk, skip others
            if (isLeague) {
              if (bunk !== bunks[0]) return; // Only draw for first bunk
              const td = document.createElement("td");
              td.colSpan = bunks.length;
              td.style.background = "#dbeeff";
              td.style.fontWeight = "bold";
              td.textContent = content;
              td.onclick = () => editCell(bunk, startMin, entry.endMin, act);
              td.rowSpan = rowspan;
              tr.appendChild(td);

              // Mark ALL bunks as skipped
              bunks.slice(1).forEach(b => (skip[b] = targetEnd));
              return;
            }

            const td = document.createElement("td");
            td.style.background = bg;
            td.rowSpan = rowspan;
            td.textContent = content;
            td.style.cursor = "pointer";
            td.onclick = () => editCell(bunk, startMin, entry.endMin, content);
            tr.appendChild(td);

          } else {
            // === EMPTY SLOT ===
            const td = document.createElement("td");
            td.onclick = () => editCell(bunk, startMin, endMin, "");
            tr.appendChild(td);
          }
        });

        body.appendChild(tr);
      });

      table.appendChild(body);
      wrapper.appendChild(table);
    });
  }

  // -------------------------------------------------------------------------
  // SAVE / LOAD
  // -------------------------------------------------------------------------
  function saveSchedule() {
    window.saveCurrentDailyData?.(
      "scheduleAssignments",
      window.scheduleAssignments
    );
    window.saveCurrentDailyData?.(
      "leagueAssignments",
      window.leagueAssignments
    );
  }

  function reconcileOrRenderSaved() {
    const data = window.loadCurrentDailyData?.() || {};
    window.scheduleAssignments = data.scheduleAssignments || {};
    window.leagueAssignments = data.leagueAssignments || {};
    updateTable();
  }

  window.updateTable = updateTable;
  window.initScheduleSystem = reconcileOrRenderSaved;
  window.saveSchedule = saveSchedule;
})();
