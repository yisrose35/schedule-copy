// ============================================================================
// scheduler_ui.js (UPDATED: LEAGUE MATCHUP RENDERING + FIXED formatEntry)
// Timeline-aware, fully integrated with league_core and SmartTile system
// ============================================================================

(function () {
  "use strict";

  const INCREMENT_MINS = 30; // fallback

  // ==========================================================================
  // TIME HELPERS
  // ==========================================================================
  function parseTimeToMinutes(str) {
    if (!str || typeof str !== "string") return null;
    let s = str.trim().toLowerCase();
    let mer = null;
    if (s.endsWith("am") || s.endsWith("pm")) {
      mer = s.endsWith("am") ? "am" : "pm";
      s = s.replace(/am|pm/g, "").trim();
    } else return null;
    const m = s.match(/^(\d{1,2})\s*[:]\s*(\d{2})$/);
    if (!m) return null;
    let h = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    if (mm < 0 || mm > 59) return null;
    if (h === 12) h = (mer === "am" ? 0 : 12);
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

  // ==========================================================================
  // RESOURCE RESOLVER
  // ==========================================================================
  function resolveResourceName(input, knownNames) {
    if (!input || !knownNames) return null;
    const cleanInput = String(input).toLowerCase().trim();
    if (knownNames.includes(input)) return input;

    const sortedNames = [...knownNames].sort((a, b) => b.length - a.length);
    for (const name of sortedNames) {
      const cleanName = name.toLowerCase().trim();
      if (cleanInput.startsWith(cleanName)) return name;
    }
    return null;
  }

  // ==========================================================================
  // DETECT GENERATED EVENTS
  // ==========================================================================
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
    "specialty league",
  ]);

  function uiIsGeneratedEventName(name) {
    if (!name) return false;
    return UI_GENERATED_EVENTS.has(String(name).trim().toLowerCase());
  }

  // ==========================================================================
  // SLOT FINDER
  // ==========================================================================
  function findSlotsForRange(startMin, endMin) {
    const slots = [];
    const times = window.unifiedTimes;
    if (!times) return slots;

    for (let i = 0; i < times.length; i++) {
      const slotStart =
        new Date(times[i].start).getHours() * 60 +
        new Date(times[i].start).getMinutes();

      let slotEnd;
      if (times[i].end) {
        slotEnd =
          new Date(times[i].end).getHours() * 60 +
          new Date(times[i].end).getMinutes();
      } else {
        slotEnd = slotStart + INCREMENT_MINS;
      }

      if (startMin < slotEnd && endMin > slotStart) slots.push(i);
    }
    return slots;
  }

  // ==========================================================================
  // EDIT CELL — TIMELINE VALIDATION
  // ==========================================================================
  function editCell(bunk, startMin, endMin, current) {
    if (!bunk) return;

    const newName = prompt(
      `Edit activity for ${bunk}\n${minutesToTimeLabel(startMin)} - ${minutesToTimeLabel(
        endMin
      )}\n(Enter CLEAR or FREE to empty)`,
      current
    );
    if (newName === null) return;

    const value = newName.trim();
    const isClear =
      value === "" ||
      value.toUpperCase() === "CLEAR" ||
      value.toUpperCase() === "FREE";

    // VALIDATION (unchanged)
    if (
      !isClear &&
      window.SchedulerCoreUtils &&
      typeof window.SchedulerCoreUtils.loadAndFilterData === "function"
    ) {
      const warnings = [];
      const config = window.SchedulerCoreUtils.loadAndFilterData();
      const {
        activityProperties,
        historicalCounts,
        lastUsedDates,
      } = config;

      const allKnown = Object.keys(activityProperties);
      const resolvedName = resolveResourceName(value, allKnown) || value;
      const props = activityProperties[resolvedName];

      // DUPLICATE CHECK
      const currentSchedule = window.scheduleAssignments[bunk] || [];
      const targetSlots = findSlotsForRange(startMin, endMin);

      currentSchedule.forEach((entry, idx) => {
        if (targetSlots.includes(idx)) return;
        if (entry && !entry.continuation) {
          const entryRaw = entry.field || entry._activity;
          if (
            String(entryRaw).trim().toLowerCase() ===
            String(value).trim().toLowerCase()
          ) {
            const timeLabel =
              window.unifiedTimes[idx]?.label ||
              minutesToTimeLabel(window.unifiedTimes[idx].start);
            warnings.push(
              `⚠️ DUPLICATE: ${bunk} already has "${entryRaw}" at ${timeLabel}.`
            );
          }
        }
      });

      // MAX USAGE CHECK
      if (props) {
        const max = props.maxUsage || 0;
        if (max > 0) {
          const historyCount = historicalCounts[bunk]?.[resolvedName] || 0;
          let todayCount = 0;
          currentSchedule.forEach((entry, idx) => {
            if (targetSlots.includes(idx)) return;
            if (entry && !entry.continuation) {
              const entryRes = resolveResourceName(
                entry.field || entry._activity,
                allKnown
              );
              if (
                String(entryRes).toLowerCase() ===
                String(resolvedName).toLowerCase()
              )
                todayCount++;
            }
          });
          const total = historyCount + todayCount + 1;
          if (total > max) {
            const lastDateStr = lastUsedDates[bunk]?.[resolvedName];
            const dateInfo = lastDateStr
              ? ` (Last used: ${lastDateStr})`
              : "";
            warnings.push(
              `⚠️ MAX USAGE: "${resolvedName}" exceeded limit (${total}/${max})${dateInfo}.`
            );
          }
        }

        // CAPACITY CHECK via TIMELINE
        let capacityLimit = 1;
        if (props.sharableWith?.capacity)
          capacityLimit = parseInt(props.sharableWith.capacity);
        else if (
          props.sharable ||
          props.sharableWith?.type === "all" ||
          props.sharableWith?.type === "custom"
        )
          capacityLimit = 2;

        const isAvailable =
          window.SchedulerCoreUtils.timeline.checkAvailability(
            resolvedName,
            startMin,
            endMin,
            1,
            capacityLimit,
            bunk
          );

        if (!isAvailable) {
          warnings.push(
            `⚠️ CAPACITY: "${resolvedName}" is full during this time.`
          );
        }

        // TIME RULE CHECK
        if (
          !window.SchedulerCoreUtils.isTimeAvailable(
            startMin,
            endMin,
            props
          )
        ) {
          warnings.push(
            `⚠️ TIME: "${resolvedName}" unavailable at this time.`
          );
        }
      }

      if (warnings.length > 0) {
        const msg =
          warnings.join("\n\n") +
          "\n\nOverride rules and schedule anyway?";
        if (!confirm(msg)) return;
      }
    }

    // APPLY EDIT
    const slots = findSlotsForRange(startMin, endMin);
    if (!slots || slots.length === 0) {
      alert("Time range mismatch. Refresh the page.");
      return;
    }

    if (!window.scheduleAssignments[bunk])
      window.scheduleAssignments[bunk] = new Array(window.unifiedTimes.length);

    if (isClear) {
      slots.forEach((idx, i) => {
        window.scheduleAssignments[bunk][idx] = {
          field: "Free",
          sport: null,
          continuation: i > 0,
          _fixed: true,
          _activity: "Free",
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
        };
      });
    }

    saveSchedule();
    updateTable();
  }

  // ==========================================================================
  // ENTRY GETTER
  // ==========================================================================
  function getEntry(bunk, slotIndex) {
    const a = window.scheduleAssignments || {};
    if (!a[bunk]) return null;
    return a[bunk][slotIndex] || null;
  }

  // ==========================================================================
  // **FIXED** ENTRY FORMATTER FOR LEAGUE MATCHUPS
  // ==========================================================================
  function formatEntry(entry) {
    if (!entry) return "";
    if (entry._isDismissal) return "Dismissal";
    if (entry._isSnack) return "Snacks";

    // ----- LEAGUE MATCHUPS -----
    if (entry._h2h) {
      const game = entry._gameLabel ? ` (${entry._gameLabel})` : "";
      return `${entry.sport || "League Game"}${game}`;
    }

    const label = entry._activity || entry.field || "";
    if (entry._fixed) return label;

    if (entry.sport) return `${entry.field} – ${entry.sport}`;

    return label;
  }

  // ==========================================================================
  // FIND BLOCK SLOT
  // ==========================================================================
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

  // ==========================================================================
  // TABLE UPDATE
  // ==========================================================================
  function updateTable() {
    const container = document.getElementById("scheduleTable");
    if (!container) return;
    renderStaggeredView(container);
  }

  // ==========================================================================
  // **MAIN RENDERER — WITH FULL LEAGUE FIX**
  // ==========================================================================
  function renderStaggeredView(container) {
    container.innerHTML = "";
    const divisions = window.divisions || {};
    const availableDivisions = window.availableDivisions || [];
    const daily = window.loadCurrentDailyData?.() || {};
    const manualSkeleton = daily.manualSkeleton || [];

    if (!Array.isArray(manualSkeleton) || manualSkeleton.length === 0) {
      container.innerHTML = `<p>No daily schedule generated.</p>`;
      return;
    }

    const wrapper = document.createElement("div");
    wrapper.className = "schedule-view-wrapper";
    container.appendChild(wrapper);

    availableDivisions.forEach((div) => {
      const bunks = (divisions[div]?.bunks || []).slice().sort();
      if (bunks.length === 0) return;

      const table = document.createElement("table");
      table.className = "schedule-division-table";

      // HEADER
      const thead = document.createElement("thead");

      const tr1 = document.createElement("tr");
      const th = document.createElement("th");
      th.colSpan = 1 + bunks.length;
      th.textContent = div;
      th.style.background = divisions[div]?.color || "#444";
      th.style.color = "#fff";
      tr1.appendChild(th);
      thead.appendChild(tr1);

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

      const tbody = document.createElement("tbody");

      // EXPAND BLOCKS
      const blocks = manualSkeleton
        .filter((b) => b.division === div)
        .map((b) => ({
          ...b,
          startMin: parseTimeToMinutes(b.startTime),
          endMin: parseTimeToMinutes(b.endTime),
        }))
        .filter((b) => b.startMin !== null && b.endMin !== null)
        .sort((a, b) => a.startMin - b.startMin);

      const expanded = [];
      blocks.forEach((b) => {
        if (b.type === "split") {
          const mid = b.startMin + (b.endMin - b.startMin) / 2;
          expanded.push({
            ...b,
            endMin: mid,
            label: `${minutesToTimeLabel(b.startMin)} - ${minutesToTimeLabel(
              mid
            )}`,
          });
          expanded.push({
            ...b,
            startMin: mid,
            label: `${minutesToTimeLabel(mid)} - ${minutesToTimeLabel(
              b.endMin
            )}`,
          });
        } else {
          expanded.push({
            ...b,
            label: `${minutesToTimeLabel(b.startMin)} - ${minutesToTimeLabel(
              b.endMin
            )}`,
          });
        }
      });

      // MAIN LOOP
      expanded.forEach((block) => {
        const tr = document.createElement("tr");

        const tdTime = document.createElement("td");
        tdTime.textContent = block.label;
        tr.appendChild(tdTime);

        // =====================================================================
        // LEAGUE BLOCK RENDER — **FIXED & FULL MATCHUPS**
        // =====================================================================
        if (
          block.event.startsWith("League Game") ||
          block.event.startsWith("Specialty League")
        ) {
          const td = document.createElement("td");
          td.colSpan = bunks.length;
          td.style.background = "#eef7f8";
          td.style.fontWeight = "bold";

          const slotIdx = findFirstSlotForTime(block.startMin);
          let allMatchups = [];
          let gameLabel = "";

          if (slotIdx >= 0) {
            const firstEntry = getEntry(bunks[0], slotIdx);
            if (firstEntry) {
              if (Array.isArray(firstEntry._allMatchups))
                allMatchups = firstEntry._allMatchups;
              if (firstEntry._gameLabel) gameLabel = firstEntry._gameLabel;
            }
          }

          let titleHtml = block.event;
          if (gameLabel) {
            titleHtml += ` ${gameLabel}`;
          }

          if (allMatchups.length === 0) {
            td.textContent = titleHtml;
          } else {
            td.innerHTML = `
              <div>${titleHtml}</div>
              <ul>${allMatchups
                .map((m) => `<li>${m}</li>`)
                .join("")}</ul>
            `;
          }

          td.style.cursor = "pointer";
          td.onclick = () =>
            editCell(bunks[0], block.startMin, block.endMin, block.event);

          tr.appendChild(td);
          tbody.appendChild(tr);
          return;
        }

        // =====================================================================
        // NON-LEAGUE CELLS
        // =====================================================================
        const isDismissal = block.event.toLowerCase().includes("dismiss");
        const isSnack = block.event.toLowerCase().includes("snack");
        const isGeneratedSlot =
          uiIsGeneratedEventName(block.event) ||
          block.event.includes("/");

        bunks.forEach((bunk) => {
          const td = document.createElement("td");
          let label = block.event;
          const slotIdx = findFirstSlotForTime(block.startMin);

          if (isDismissal) {
            label = "Dismissal";
            td.style.background = "#ffdddd";
          } else if (isSnack) {
            label = "Snacks";
            td.style.background = "#e7ffe7";
          } else if (!isGeneratedSlot) {
            td.style.background = "#fff7cc";
            label = block.event;
          } else {
            const entry = getEntry(bunk, slotIdx);
            label = formatEntry(entry);
          }

          td.textContent = label;
          td.style.cursor = "pointer";
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

  // ==========================================================================
  // SAVE / LOAD
  // ==========================================================================
  function saveSchedule() {
    window.saveCurrentDailyData?.(
      "scheduleAssignments",
      window.scheduleAssignments
    );
    window.saveCurrentDailyData?.(
      "leagueAssignments",
      window.leagueAssignments
    );
    window.saveCurrentDailyData?.("unifiedTimes", window.unifiedTimes);
  }

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

  function initScheduleSystem() {
    reconcileOrRenderSaved();
  }

  // EXPORT
  window.updateTable = updateTable;
  window.initScheduleSystem = initScheduleSystem;
  window.saveSchedule = saveSchedule;

})();
