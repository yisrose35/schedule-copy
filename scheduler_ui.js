// ============================================================================
// scheduler_ui.js (VALIDATION GATE & LIVE HISTORY)
//
// Supports:
// - Manual Editing with Rule Validation (Capacity, Frequency, Time)
// - "Live" History: Edits update the count immediately for the next check.
// - Staggered schedule view (one table per division)
// - League & Specialty League merged rows
// ============================================================================

(function () {
  "use strict";

  const INCREMENT_MINS = 30;

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
  // DETECT GENERATED EVENT TYPES
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
    "specialty league"
  ]);

  function uiIsGeneratedEventName(name) {
    if (!name) return false;
    return UI_GENERATED_EVENTS.has(String(name).trim().toLowerCase());
  }

  // ==========================================================================
  // SCHEDULE EDITOR (With Validation Gate)
  // ==========================================================================
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

    if (newName === null) return; // User cancelled

    const value = newName.trim();
    const isClear = (value === "" || value.toUpperCase() === "CLEAR" || value.toUpperCase() === "FREE");
    
    // --- VALIDATION GATE START ---
    if (!isClear) {
        const warnings = [];
        
        // 1. Load fresh data (History + Rules)
        // We re-load here to ensure we catch any edits made 10 seconds ago.
        const config = window.SchedulerCoreUtils.loadAndFilterData();
        const { activityProperties, historicalCounts, bunkMetaData, sportMetaData } = config;
        
        const props = activityProperties[value]; // Rules for the new activity
        
        if (props) {
            // A. CHECK FREQUENCY / MAX USAGE
            // History + Today's Usage so far
            const max = props.maxUsage || 0;
            if (max > 0) {
                const historyCount = historicalCounts[bunk]?.[value] || 0;
                
                // Scan "Today" (window.scheduleAssignments) to see if we already scheduled it elsewhere today
                let todayCount = 0;
                const schedule = window.scheduleAssignments[bunk] || [];
                // We must count "blocks", not slots. Simplest heuristic: check unique activities that aren't continuations.
                // Or better: just count every entry that isn't null/free/continuation matching the name.
                // NOTE: We exclude the *current* slots being edited to avoid double counting if we are just renaming/reconfirming.
                const targetSlots = findSlotsForRange(startMin, endMin);
                
                schedule.forEach((entry, idx) => {
                    if (targetSlots.includes(idx)) return; // Ignore the slots we are about to overwrite
                    if (entry && entry._activity === value && !entry.continuation) {
                        todayCount++;
                    }
                });

                const total = historyCount + todayCount + 1; // +1 for this new assignment
                if (total > max) {
                    warnings.push(`⚠️ MAX USAGE: ${bunk} has used "${value}" ${historyCount + todayCount} times. Limit is ${max}.`);
                }
            }

            // B. CHECK FIELD CAPACITY (At this specific time)
            // We need to check every slot in the range
            const slotsToCheck = findSlotsForRange(startMin, endMin);
            const bunkSize = bunkMetaData[bunk]?.size || 0;
            const maxHeadcount = sportMetaData[value]?.maxCapacity || Infinity;
            
            // Shared Limit (Number of Bunks)
            let bunkLimit = 1;
            if (props.sharableWith?.capacity) bunkLimit = parseInt(props.sharableWith.capacity);
            else if (props.sharable || props.sharableWith?.type === 'all') bunkLimit = 2;

            for (const slotIdx of slotsToCheck) {
                let bunksOnField = 0;
                let headcountOnField = 0;

                // Scan all OTHER bunks at this slot
                Object.keys(window.scheduleAssignments).forEach(otherBunk => {
                    if (otherBunk === bunk) return; // Don't count myself
                    const entry = window.scheduleAssignments[otherBunk][slotIdx];
                    // Check if entry matches the activity name or field name
                    if (entry) {
                        const entryName = (typeof entry.field === 'object') ? entry.field.name : entry.field;
                        // Use loose matching or strict? ActivityProperties uses exact names.
                        if (entryName === value || entry._activity === value) {
                            bunksOnField++;
                            headcountOnField += (bunkMetaData[otherBunk]?.size || 0);
                        }
                    }
                });

                // Check Bunk Limit
                if (bunksOnField >= bunkLimit) {
                    warnings.push(`⚠️ CAPACITY: "${value}" is full at ${minutesToTimeLabel(window.unifiedTimes[slotIdx].start)}. (${bunksOnField}/${bunkLimit} bunks).`);
                    break; // Only warn once per edit
                }

                // Check Headcount Limit
                if (maxHeadcount !== Infinity && (headcountOnField + bunkSize > maxHeadcount)) {
                    warnings.push(`⚠️ HEADCOUNT: "${value}" will have ${headcountOnField + bunkSize} kids (Max ${maxHeadcount}).`);
                    break;
                }
                
                // C. CHECK TIME RULES
                if (!window.SchedulerCoreUtils.isTimeAvailable(slotIdx, props)) {
                     warnings.push(`⚠️ TIME: "${value}" is closed/unavailable at ${minutesToTimeLabel(window.unifiedTimes[slotIdx].start)}.`);
                     break;
                }
            }
        }

        // D. BLOCKER PROMPT
        if (warnings.length > 0) {
            const msg = warnings.join("\n") + "\n\nDo you want to OVERRIDE these rules and schedule anyway?";
            if (!confirm(msg)) {
                return; // Cancel edit
            }
        }
    }
    // --- VALIDATION GATE END ---

    // Apply the Edit
    const slots = findSlotsForRange(startMin, endMin);
    if (!window.scheduleAssignments[bunk])
      window.scheduleAssignments[bunk] = new Array(window.unifiedTimes.length);

    if (isClear) {
      slots.forEach((idx, i) => {
        window.scheduleAssignments[bunk][idx] = {
          field: "Free",
          sport: null,
          continuation: i > 0,
          _fixed: true,
          _activity: "Free"
        };
      });
    } else {
      slots.forEach((idx, i) => {
        window.scheduleAssignments[bunk][idx] = {
          field: value,
          sport: null,
          continuation: i > 0,
          _fixed: true,
          _activity: value
        };
      });
    }

    // SAVE IMMEDIATELY to update history for next click
    saveSchedule();
    updateTable();
  }

  // ==========================================================================
  // GET ENTRY (for one bunk, one slot)
  // ==========================================================================
  function getEntry(bunk, slotIndex) {
    const a = window.scheduleAssignments || {};
    if (!a[bunk]) return null;
    return a[bunk][slotIndex] || null;
  }

  function formatEntry(entry) {
    if (!entry) return "";

    if (entry._isDismissal) return "Dismissal";
    if (entry._isSnack) return "Snacks";

    const label = entry._activity || entry.field || "";

    if (entry._h2h) return entry.sport || "League Game";
    if (entry._fixed) return label;

    if (entry.sport) return `${entry.field} – ${entry.sport}`;
    return label;
  }

  // ==========================================================================
  // FIND FIRST SLOT FOR TIME
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
  // MAIN RENDER FUNCTION
  // ==========================================================================
  function updateTable() {
    const container = document.getElementById("scheduleTable");
    if (!container) return;
    renderStaggeredView(container);
  }

  // ==========================================================================
  // RENDER STAGGERED DAILY SCHEDULE
  // ==========================================================================
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

      const table = document.createElement("table");
      table.className = "schedule-division-table";

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

      // Filter blocks for this division
      const blocks = manualSkeleton
        .filter((b) => b.division === div)
        .map((b) => ({
          ...b,
          startMin: parseTimeToMinutes(b.startTime),
          endMin: parseTimeToMinutes(b.endTime),
        }))
        .filter((b) => b.startMin !== null && b.endMin !== null)
        .sort((a, b) => a.startMin - b.startMin);

      // Flatten split blocks at UI level
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

      // Render each block
      expanded.forEach((block) => {
        const tr = document.createElement("tr");

        const tdTime = document.createElement("td");
        tdTime.textContent = block.label;
        tr.appendChild(tdTime);

        // League rows (merged)
        if (block.event.startsWith("League Game") || block.event.startsWith("Specialty League")) {
          const td = document.createElement("td");
          td.colSpan = bunks.length;
          td.style.background = "#eef7f8";
          td.style.fontWeight = "bold";

          const slotIdx = findFirstSlotForTime(block.startMin);
          let allMatchups = [];
          let gameLabel = "";

          if (slotIdx >= 0) {
            const first = getEntry(bunks[0], slotIdx);
            if (first) {
                if(first._allMatchups) allMatchups = first._allMatchups;
                if(first._gameLabel) gameLabel = first._gameLabel;
            }
          }

          // Build Title String (e.g., "League Game 6" or "Senior League (Game 6)")
          let titleHtml = block.event;
          if (gameLabel) {
              if (block.event.trim() === "League Game") {
                  titleHtml = `${block.event} ${gameLabel.replace(/^Game\s+/i, '')}`;
              } else {
                  titleHtml = `${block.event} (${gameLabel})`;
              }
          }

          if (allMatchups.length === 0) {
            td.textContent = titleHtml;
          } else {
            td.innerHTML = `<div>${titleHtml}</div><ul>${allMatchups
              .map((m) => `<li>${m}</li>`)
              .join("")}</ul>`;
          }

          tr.appendChild(td);
          tbody.appendChild(tr);
          return;
        }

        // Regular blocks
        const isDismissal = block.event.toLowerCase().includes("dismiss");
        const isSnack = block.event.toLowerCase().includes("snack");
        const isGeneratedSlot =
          uiIsGeneratedEventName(block.event) || block.event.includes("/");

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
    window.saveCurrentDailyData?.("scheduleAssignments", window.scheduleAssignments);
    window.saveCurrentDailyData?.("leagueAssignments", window.leagueAssignments);
    window.saveCurrentDailyData?.("unifiedTimes", window.unifiedTimes);
  }

  // ==========================================================================
  // CRITICAL: LOAD SAVED ENGINE OUTPUT INTO GLOBALS
  // ==========================================================================
  function reconcileOrRenderSaved() {
    try {
      const data = window.loadCurrentDailyData?.() || {};

      // ALWAYS load from saved data (fixes blank UI issue)
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

  // ==========================================================================
  // EXPORTS
  // ==========================================================================
  window.updateTable = updateTable;
  window.initScheduleSystem = initScheduleSystem;
  window.saveSchedule = saveSchedule;
})();
