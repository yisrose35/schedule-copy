// ============================================================================
// scheduler_ui.js (RESTORED: SKELETON-DRIVEN DYNAMIC GRID)
//
// Features:
// 1. Dynamic Gridlines: Rows are generated based on YOUR Skeleton Blocks.
// 2. Wrapper Logic: Merges "Transition -> Activity -> Transition" into one cell.
// 3. Minute-Engine Compatible: Removes broken "slot index" lookups.
// ============================================================================

(function () {
  "use strict";

  const TRANSITION_TYPE = window.TRANSITION_TYPE || "Transition/Buffer";

  // -------------------------------------------------------------------------
  // TIME HELPERS
  // -------------------------------------------------------------------------
  function parseTimeToMinutes(str) {
    return window.SchedulerCoreUtils.parseTimeToMinutes(str);
  }

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
  // GET ENTRY (Robust Minute Lookup)
  // -------------------------------------------------------------------------
  function getEntry(bunk, startMin) {
    const bunkSched = window.scheduleAssignments?.[bunk];
    if (!bunkSched) return null;
    // Direct lookup by minute
    return bunkSched[startMin] || null;
  }

  // -------------------------------------------------------------------------
  // FORMAT ENTRY
  // -------------------------------------------------------------------------
  function formatEntry(entry) {
    if (!entry) return "";
    if (entry._isDismissal) return "Dismissal";
    if (entry._isSnack) return "Snacks";
    
    if (entry.field === TRANSITION_TYPE) {
      return `🏃‍♂️ ${entry.sport || entry.field}`;
    }

    const label = entry._activity || entry.field || "";
    if (entry._h2h) return entry.sport || "League Game";
    if (entry._fixed) return label;
    if (entry.sport) return `${entry.field} – ${entry.sport}`;
    return label;
  }

  // -------------------------------------------------------------------------
  // EDIT CELL
  // -------------------------------------------------------------------------
  function editCell(bunk, startMin, endMin, current) {
    if (!bunk) return;

    const config = window.SchedulerCoreUtils.loadAndFilterData();
    const { activityProperties, divisions } = config;
    const divName = Object.keys(divisions).find(d => divisions[d].bunks.includes(bunk));

    const newInput = prompt(
      `Edit activity for ${bunk}\n${minutesToTimeLabel(startMin)} - ${minutesToTimeLabel(endMin)}\n(Enter CLEAR or FREE to empty)`,
      current
    );

    if (newInput === null) return;

    const value = newInput.trim();
    const isClear = value === "" || ["CLEAR", "FREE"].includes(value.toUpperCase());

    // 1. CLEANUP OLD
    // We must clear the exact start time, plus any reservations
    delete window.scheduleAssignments[bunk][startMin];
    Object.keys(window.fieldReservationLog).forEach(field => {
        window.fieldReservationLog[field] = window.fieldReservationLog[field].filter(
            r => !(r.bunk === bunk && r.startMin === startMin)
        );
    });

    if (isClear) {
        saveSchedule();
        updateTable();
        return;
    }

    // 2. WRITE NEW
    const allNames = Object.keys(activityProperties);
    const resolvedName = resolveResourceName(value, allNames) || value;

    window.fillBlock(
        { divName, bunk, startTime: startMin, endTime: endMin },
        { field: resolvedName, sport: null, _activity: resolvedName, _fixed: true },
        null, false, activityProperties, true
    );

    saveSchedule();
    updateTable();
  }

  // -------------------------------------------------------------------------
  // MAIN RENDERER: SKELETON-DRIVEN
  // -------------------------------------------------------------------------
  function updateTable() {
    const container = document.getElementById("scheduleTable");
    if (!container) return;
    renderSkeletonGrid(container);
  }

  function renderSkeletonGrid(container) {
    container.innerHTML = "";
    
    const config = window.SchedulerCoreUtils.loadAndFilterData();
    const { divisions, availableDivisions } = config;
    const daily = window.loadCurrentDailyData?.() || {};
    const manualSkeleton = daily.manualSkeleton || [];

    if (!Array.isArray(manualSkeleton) || manualSkeleton.length === 0) {
      container.innerHTML = "<p>No daily schedule generated.</p>";
      return;
    }

    const wrapper = document.createElement("div");
    wrapper.className = "schedule-view-wrapper";
    container.appendChild(wrapper);

    // --- PER DIVISION LOOP ---
    availableDivisions.forEach(div => {
      const bunks = (divisions[div]?.bunks || []).slice().sort();
      if (bunks.length === 0) return;

      const table = document.createElement("table");
      table.className = "schedule-division-table";

      // THEAD
      const thead = document.createElement("thead");
      thead.innerHTML = `
        <tr><th colspan="${1 + bunks.length}" style="background:${divisions[div]?.color || "#444"};color:white;">${div}</th></tr>
        <tr><th>Time</th>${bunks.map(b => `<th>${b}</th>`).join("")}</tr>
      `;
      table.appendChild(thead); // Fixed typo here (was 'head')

      // TBODY
      const tbody = document.createElement("tbody");

      // 1. Get Skeleton Blocks for this Division (The "Dynamic Gridlines")
      const rawBlocks = manualSkeleton.filter(b => b.division === div);
      
      // Expand "Split" tiles into two visual rows
      const rows = [];
      rawBlocks.forEach(b => {
          const s = parseTimeToMinutes(b.startTime);
          const e = parseTimeToMinutes(b.endTime);
          if (s === null || e === null) return;

          if (b.type === "split") {
              const mid = s + (e - s) / 2;
              rows.push({ ...b, startMin: s, endMin: mid, label: `${minutesToTimeLabel(s)} - ${minutesToTimeLabel(mid)}` });
              rows.push({ ...b, startMin: mid, endMin: e, label: `${minutesToTimeLabel(mid)} - ${minutesToTimeLabel(e)}` });
          } else {
              rows.push({ ...b, startMin: s, endMin: e, label: `${minutesToTimeLabel(s)} - ${minutesToTimeLabel(e)}` });
          }
      });

      // Sort rows by time
      rows.sort((a,b) => a.startMin - b.startMin);

      // 2. Render Rows
      rows.forEach(block => {
          const tr = document.createElement("tr");
          
          // Time Column
          const tdTime = document.createElement("td");
          tdTime.textContent = block.label;
          tdTime.style.whiteSpace = "nowrap";
          tdTime.style.fontWeight = "bold";
          tr.appendChild(tdTime);

          // LEAGUE ROW (Merged)
          if (block.event.startsWith("League Game") || block.event.startsWith("Specialty League")) {
              const td = document.createElement("td");
              td.colSpan = bunks.length;
              td.style.background = "#dbeeff";
              td.style.fontWeight = "bold";
              td.style.textAlign = "center";
              
              // Try to find the League Label from the first bunk
              const entry = getEntry(bunks[0], block.startMin);
              let title = block.event;
              if (entry) {
                  if (entry._gameLabel) title += ` (${entry._gameLabel})`;
                  if (entry._allMatchups && entry._allMatchups.length > 0) {
                      title += `<ul style="margin:5px 0 0 0; padding:0; list-style:none; font-weight:normal; font-size:0.9em;">` + 
                               entry._allMatchups.map(m => `<li>${m.teamA} vs ${m.teamB}</li>`).join("") + 
                               `</ul>`;
                  }
              }
              
              td.innerHTML = title;
              td.style.cursor = "pointer";
              td.onclick = () => editCell(bunks[0], block.startMin, block.endMin, block.event);
              
              tr.appendChild(td);
              tbody.appendChild(tr);
              return;
          }

          // STANDARD BUNKS ROW
          bunks.forEach(bunk => {
              const td = document.createElement("td");
              
              // Get the entry at the START of this skeleton block
              const entry = getEntry(bunk, block.startMin);
              
              let cellContent = "";
              let bg = "";
              let mainActivity = "";

              if (entry) {
                  const act = entry._activity;
                  
                  // --- WRAPPER DISPLAY LOGIC ---
                  // If we find a transition, we look ahead to find the main activity
                  // If we find an activity, we look behind/ahead for transitions
                  // We assume the sequence fits roughly within the Skeleton Block
                  
                  if (act === TRANSITION_TYPE) {
                      // It's a start transition. Find the Main Activity it leads to.
                      // Simple heuristic: Look at the next entry in the schedule assignment map
                      const sortedEntries = Object.values(window.scheduleAssignments[bunk]).sort((a,b) => a.startMin - b.startMin);
                      const myIdx = sortedEntries.indexOf(entry);
                      const next = sortedEntries[myIdx + 1];
                      
                      if (next && next._activity !== TRANSITION_TYPE) {
                          mainActivity = next._activity;
                          // Calculate times
                          const preMins = entry.endMin - entry.startMin;
                          const playMins = next.endMin - next.startMin;
                          // Check for post
                          const post = sortedEntries[myIdx + 2];
                          let postMins = 0;
                          if (post && post._activity === TRANSITION_TYPE) postMins = post.endMin - post.startMin;
                          
                          cellContent = `<strong>${mainActivity}</strong><br>` + 
                                        `<span style="font-size:0.8em; color:#059669;">(${preMins}m To / ${playMins}m Play / ${postMins}m From)</span>`;
                          bg = "#e0f7fa";
                      } else {
                          // Orphan transition
                          cellContent = "🏃 Transition";
                          bg = "#f3f4f6";
                      }
                  } 
                  else {
                      // It's an Activity. Check if it had a pre-transition we missed?
                      // In the Skeleton view, the row starts at 11:00. 
                      // If the transition started at 11:00, we caught it above.
                      // If the Activity starts at 11:00 (no transition), we catch it here.
                      
                      mainActivity = act;
                      cellContent = formatEntry(entry);
                      bg = entry._fixed ? "#fff8e1" : "#e0f7fa";
                  }
              } else {
                  // EMPTY
                  // Check if there is an activity starting *mid-block*?
                  // (e.g. Skeleton 11:00, but Activity starts 11:10)
                  // Iterate assignment keys to find overlap
                  const sched = window.scheduleAssignments[bunk] || {};
                  const midKey = Object.keys(sched).find(k => {
                      const kMin = parseInt(k);
                      return kMin > block.startMin && kMin < block.endMin;
                  });
                  
                  if (midKey) {
                      const midEntry = sched[midKey];
                      if (midEntry._activity !== TRANSITION_TYPE) {
                          cellContent = formatEntry(midEntry);
                          mainActivity = midEntry._activity;
                          bg = "#e0f7fa";
                      } else {
                          // Transition started late
                          cellContent = "🏃 Transition"; 
                      }
                  }
              }

              // Dismissal / Snack Overrides based on Skeleton Event Name
              if (block.event.toLowerCase().includes("dismiss")) { cellContent = "Dismissal"; bg = "#ffdddd"; }
              else if (block.event.toLowerCase().includes("snack")) { cellContent = "Snacks"; bg = "#e7ffe7"; }
              else if (!entry && !cellContent) {
                  // If truly empty, use the skeleton name as placeholder if generated
                  if (!["Activity", "Sports", "Special Activity"].includes(block.event)) {
                      cellContent = block.event;
                      bg = "#fff7cc";
                  }
              }

              td.innerHTML = cellContent;
              td.style.background = bg;
              td.style.cursor = "pointer";
              td.style.textAlign = "center";
              td.style.verticalAlign = "middle";
              
              td.onclick = () => editCell(bunk, block.startMin, block.endMin, mainActivity || cellContent);
              
              tr.appendChild(td);
          });

          tbody.appendChild(tr);
      });

      table.appendChild(tbody);
      wrapper.appendChild(table);
    });
  }

  function saveSchedule() {
    window.saveCurrentDailyData?.("scheduleAssignments", window.scheduleAssignments);
    window.saveCurrentDailyData?.("leagueAssignments", window.leagueAssignments);
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
