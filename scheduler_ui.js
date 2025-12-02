// ============================================================================
// scheduler_ui.js (FIXED: INTERSECTION LOGIC, DETAILED ALERTS, FUZZY MATCH)
//
// Features:
// - Intersection Logic: Catches 10-min overlaps (2:20pm counts as using 2:00pm slot).
// - Detailed Alerts: Lists specific bunks/dates causing conflicts.
// - Fuzzy Match: Handles "- Lineup" or case differences.
// ============================================================================

(function () {
  "use strict";

  const INCREMENT_MINS = 30;
  const PIXELS_PER_MINUTE = 2; // Used if we had a timeline view, kept for ref

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
  // RESOURCE RESOLVER (Fuzzy Matcher)
  // ==========================================================================
  function resolveResourceName(input, knownNames) {
      if (!input || !knownNames) return null;
      const cleanInput = String(input).toLowerCase().trim();
      
      // 1. Exact Match
      if (knownNames.includes(input)) return input;

      // 2. Starts With (e.g. "Basketball Court B - Lineup" -> "Basketball Court B")
      // Sort by length desc so we match "Court B" before "Court"
      const sortedNames = [...knownNames].sort((a,b) => b.length - a.length);
      
      for (const name of sortedNames) {
          const cleanName = name.toLowerCase().trim();
          if (cleanInput.startsWith(cleanName)) {
              return name;
          }
      }
      return null; 
  }

  // ==========================================================================
  // DETECT GENERATED EVENTS
  // ==========================================================================
  const UI_GENERATED_EVENTS = new Set([
    "general activity", "general activity slot", "activity", "activities", "sports", "sport", "sports slot", "special activity", "swim", "league game", "specialty league"
  ]);
  function uiIsGeneratedEventName(name) {
    if (!name) return false;
    return UI_GENERATED_EVENTS.has(String(name).trim().toLowerCase());
  }

  // ==========================================================================
  // SLOT FINDER (CRITICAL FIX: INTERSECTION LOGIC)
  // ==========================================================================
  function findSlotsForRange(startMin, endMin) {
    const slots = [];
    const times = window.unifiedTimes;
    if (!times) return slots;

    for (let i = 0; i < times.length; i++) {
      const slotStart = new Date(times[i].start).getHours() * 60 + new Date(times[i].start).getMinutes();
      const slotEnd = slotStart + INCREMENT_MINS;

      // LOGIC: If the activity touches the slot AT ALL, it counts.
      // Activity: [startMin, endMin)
      // Slot:     [slotStart, slotEnd)
      // Overlap if: startMin < slotEnd AND endMin > slotStart
      if (startMin < slotEnd && endMin > slotStart) {
        slots.push(i);
      }
    }
    return slots;
  }

  // ==========================================================================
  // EDIT LOGIC (Smart Validation)
  // ==========================================================================
  function editCell(bunk, startMin, endMin, current) {
    if (!bunk) return;
    const newName = prompt(`Edit activity for ${bunk}\n${minutesToTimeLabel(startMin)} - ${minutesToTimeLabel(endMin)}\n(Enter CLEAR or FREE to empty)`, current);
    if (newName === null) return; 

    const value = newName.trim();
    const isClear = (value === "" || value.toUpperCase() === "CLEAR" || value.toUpperCase() === "FREE");
    
    // --- VALIDATION GATE START ---
    if (!isClear) {
        const warnings = [];
        
        // 1. Load fresh data
        // We assume SchedulerCoreUtils is available and has loaded data
        const config = window.SchedulerCoreUtils.loadAndFilterData();
        const { activityProperties, historicalCounts, lastUsedDates, bunkMetaData, sportMetaData } = config;
        
        const allKnown = Object.keys(activityProperties);
        const resolvedName = resolveResourceName(value, allKnown) || value;
        const props = activityProperties[resolvedName]; 
        
        // A. DUPLICATE CHECK (Already doing this today?)
        const currentSchedule = window.scheduleAssignments[bunk] || [];
        const targetSlots = findSlotsForRange(startMin, endMin);
        
        currentSchedule.forEach((entry, idx) => {
            if (targetSlots.includes(idx)) return; // Skip self
            if (entry && !entry.continuation) {
                const entryRaw = entry.field || entry._activity;
                const entryRes = resolveResourceName(entryRaw, allKnown) || entryRaw;
                if (entryRes && resolvedName && entryRes.toLowerCase() === resolvedName.toLowerCase()) {
                     const timeLabel = window.unifiedTimes[idx]?.label || minutesToTimeLabel(window.unifiedTimes[idx].start);
                     warnings.push(`⚠️ DUPLICATE: ${bunk} is already scheduled for "${resolvedName}" at ${timeLabel}.`);
                }
            }
        });

        if (props) {
            // B. MAX USAGE / FREQUENCY
            const max = props.maxUsage || 0;
            if (max > 0) {
                const historyCount = historicalCounts[bunk]?.[resolvedName] || 0;
                let todayCount = 0;
                currentSchedule.forEach((entry, idx) => {
                    if (targetSlots.includes(idx)) return; 
                    if (entry && !entry.continuation) {
                        const entryRes = resolveResourceName(entry.field || entry._activity, allKnown);
                        if (entryRes === resolvedName) todayCount++;
                    }
                });
                const total = historyCount + todayCount + 1; 
                if (total > max) {
                    const lastDateStr = lastUsedDates[bunk]?.[resolvedName];
                    const dateInfo = lastDateStr ? ` (Last used: ${lastDateStr})` : "";
                    warnings.push(`⚠️ MAX USAGE: ${bunk} has used "${resolvedName}" ${historyCount + todayCount} times${dateInfo}. Limit is ${max}.`);
                }
            }

            // C. CAPACITY CHECK (With Intersection Logic)
            const slotsToCheck = findSlotsForRange(startMin, endMin);
            const bunkSize = bunkMetaData[bunk]?.size || 0;
            const maxHeadcount = sportMetaData[resolvedName]?.maxCapacity || Infinity;
            
            let bunkLimit = 1;
            if (props.sharableWith?.capacity) bunkLimit = parseInt(props.sharableWith.capacity);
            else if (props.sharable || props.sharableWith?.type === 'all') bunkLimit = 2;

            for (const slotIdx of slotsToCheck) {
                const bunksOnField = []; 
                let headcountOnField = 0;

                Object.keys(window.scheduleAssignments).forEach(otherBunk => {
                    if (otherBunk === bunk) return; 
                    const entry = window.scheduleAssignments[otherBunk][slotIdx];
                    if (entry) {
                        const entryRaw = (typeof entry.field === 'object') ? entry.field.name : entry.field;
                        const entryRes = resolveResourceName(entryRaw || entry._activity, allKnown);
                        
                        if (entryRes === resolvedName) {
                            bunksOnField.push(otherBunk);
                            headcountOnField += (bunkMetaData[otherBunk]?.size || 0);
                        }
                    }
                });

                // Check Bunk Limit
                if (bunksOnField.length >= bunkLimit) {
                    const timeStr = window.unifiedTimes[slotIdx].label || minutesToTimeLabel(window.unifiedTimes[slotIdx].start);
                    warnings.push(`⚠️ CAPACITY: "${resolvedName}" is full at ${timeStr}.\n   Occupied by: ${bunksOnField.join(", ")}.`);
                    break; 
                }

                // Check Headcount Limit
                if (maxHeadcount !== Infinity && (headcountOnField + bunkSize > maxHeadcount)) {
                    warnings.push(`⚠️ HEADCOUNT: "${resolvedName}" will have ${headcountOnField + bunkSize} kids (Max ${maxHeadcount}).`);
                    break;
                }
                
                // D. TIME RULES
                if (!window.SchedulerCoreUtils.isTimeAvailable(slotIdx, props)) {
                     const timeStr = window.unifiedTimes[slotIdx].label || minutesToTimeLabel(window.unifiedTimes[slotIdx].start);
                     warnings.push(`⚠️ TIME: "${resolvedName}" is closed/unavailable at ${timeStr}.`);
                     break;
                }
            }
        }

        // E. BLOCKER PROMPT
        if (warnings.length > 0) {
            const msg = warnings.join("\n\n") + "\n\nDo you want to OVERRIDE these rules and schedule anyway?";
            if (!confirm(msg)) {
                return; 
            }
        }
    }

    // Apply Edit (Using Intersection Logic to fill slots)
    const slots = findSlotsForRange(startMin, endMin);
    if (!window.scheduleAssignments[bunk])
      window.scheduleAssignments[bunk] = new Array(window.unifiedTimes.length);

    if (isClear) {
      slots.forEach((idx, i) => {
        window.scheduleAssignments[bunk][idx] = {
          field: "Free", sport: null, continuation: i > 0, _fixed: true, _activity: "Free"
        };
      });
    } else {
      slots.forEach((idx, i) => {
        window.scheduleAssignments[bunk][idx] = {
          field: value, sport: null, continuation: i > 0, _fixed: true, _activity: value
        };
      });
    }

    saveSchedule();
    updateTable();
  }

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

  // Reused for UI logic
  function findFirstSlotForTime(startMin) {
    if (!window.unifiedTimes) return -1;
    for (let i = 0; i < window.unifiedTimes.length; i++) {
      const slotStart = new Date(window.unifiedTimes[i].start).getHours() * 60 + new Date(window.unifiedTimes[i].start).getMinutes();
      if (slotStart >= startMin && slotStart < startMin + INCREMENT_MINS) return i;
    }
    return -1;
  }

  function updateTable() {
    const container = document.getElementById("scheduleTable");
    if (!container) return;
    renderStaggeredView(container);
  }

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
          expanded.push({ ...b, endMin: mid, label: `${minutesToTimeLabel(b.startMin)} - ${minutesToTimeLabel(mid)}` });
          expanded.push({ ...b, startMin: mid, label: `${minutesToTimeLabel(mid)} - ${minutesToTimeLabel(b.endMin)}` });
        } else {
          expanded.push({ ...b, label: `${minutesToTimeLabel(b.startMin)} - ${minutesToTimeLabel(b.endMin)}` });
        }
      });

      expanded.forEach((block) => {
        const tr = document.createElement("tr");
        const tdTime = document.createElement("td");
        tdTime.textContent = block.label;
        tr.appendChild(tdTime);

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
            td.innerHTML = `<div>${titleHtml}</div><ul>${allMatchups.map((m) => `<li>${m}</li>`).join("")}</ul>`;
          }

          tr.appendChild(td);
          tbody.appendChild(tr);
          return;
        }

        const isDismissal = block.event.toLowerCase().includes("dismiss");
        const isSnack = block.event.toLowerCase().includes("snack");
        const isGeneratedSlot = uiIsGeneratedEventName(block.event) || block.event.includes("/");

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
          td.onclick = () => editCell(bunk, block.startMin, block.endMin, label);
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
    window.saveCurrentDailyData?.("unifiedTimes", window.unifiedTimes);
  }

  function reconcileOrRenderSaved() {
    try {
      const data = window.loadCurrentDailyData?.() || {};
      window.scheduleAssignments = data.scheduleAssignments || {};
      window.leagueAssignments = data.leagueAssignments || {};
      const savedTimes = data.unifiedTimes || [];
      window.unifiedTimes = savedTimes.map((slot) => ({ ...slot, start: new Date(slot.start), end: new Date(slot.end) }));
    } catch (e) {
      console.error("Schedule load error:", e);
      window.scheduleAssignments = {};
      window.leagueAssignments = {};
      window.unifiedTimes = [];
    }
    updateTable();
  }

  function initScheduleSystem() { reconcileOrRenderSaved(); }

  window.updateTable = updateTable;
  window.initScheduleSystem = initScheduleSystem;
  window.saveSchedule = saveSchedule;
})();
