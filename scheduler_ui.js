// ============================================================================
// scheduler_ui.js (UPDATED: TRANSITION WRAPPER & DISPLAY)
//
// Updates:
// 1. Implements Wrapper Block display logic for transitions (Issue 6).
// 2. Formats transition segments for clean schedule view.
// 3. Updated editCell to use new fillBlock logic for buffer-aware manual edits (Issue 15).
// ============================================================================

(function () {
  "use strict";

  const INCREMENT_MINS = 30; // Fallback only
  const TRANSITION_TYPE = window.TRANSITION_TYPE; // "Transition/Buffer"

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
  // SLOT FINDER
  // ==========================================================================
  function findSlotsForRange(startMin, endMin) {
    const slots = [];
    const times = window.unifiedTimes || [];
    if (!times.length) return slots;

    for (let i = 0; i < times.length; i++) {
      const slotStart = new Date(times[i].start).getHours() * 60 + new Date(times[i].start).getMinutes();
      let slotEnd = new Date(times[i].end).getHours() * 60 + new Date(times[i].end).getMinutes();

      if (startMin < slotEnd && endMin > slotStart) {
        slots.push(i);
      }
    }
    return slots;
  }

  // ==========================================================================
  // EDIT CELL (BUFFER-AWARE MANUAL EDIT)
  // ==========================================================================
  function editCell(bunk, startMin, endMin, current) {
    if (!bunk) return;
    
    // 1. Get user input
    const newName = prompt(`Edit activity for ${bunk}\n${minutesToTimeLabel(startMin)} - ${minutesToTimeLabel(endMin)}\n(Enter CLEAR or FREE to empty)`, current);
    if (newName === null) return; 

    const value = newName.trim();
    const isClear = (value === "" || value.toUpperCase() === "CLEAR" || value.toUpperCase() === "FREE");
    
    // --- VALIDATION GATE ---
    let resolvedName = value;
    
    if (!isClear && window.SchedulerCoreUtils && typeof window.SchedulerCoreUtils.loadAndFilterData === 'function') {
        const warnings = [];
        
        // Load fresh data (This REBUILDS the Timeline with current grid state)
        const config = window.SchedulerCoreUtils.loadAndFilterData();
        const { activityProperties, historicalCounts, lastUsedDates, divisions } = config;
        
        const allKnown = Object.keys(activityProperties);
        resolvedName = resolveResourceName(value, allKnown) || value; 
        const props = activityProperties[resolvedName]; 
        const targetSlots = findSlotsForRange(startMin, endMin);
        
        // -------------------------------------------------------------
        // A. SAME BUNK CHECK (Duplicate Warning)
        // -------------------------------------------------------------
        const currentSchedule = window.scheduleAssignments[bunk] || [];
        
        currentSchedule.forEach((entry, idx) => {
            if (targetSlots.includes(idx)) return; // Skip self
            if (entry && !entry.continuation) {
                const entryRaw = entry.field || entry._activity;
                if (String(entryRaw).trim().toLowerCase() === String(value).trim().toLowerCase()) {
                     const timeLabel = window.unifiedTimes[idx]?.label || minutesToTimeLabel(new Date(window.unifiedTimes[idx].start).getHours() * 60 + new Date(window.unifiedTimes[idx].start).getMinutes());
                     warnings.push(`⚠️ DUPLICATE: ${bunk} is already scheduled for "${entryRaw}" at ${timeLabel}.`);
                }
            }
        });

        if (props) {
            // -------------------------------------------------------------
            // B. MAX USAGE CHECK (Frequency)
            // -------------------------------------------------------------
            const max = props.maxUsage || 0;
            if (max > 0) {
                const historyCount = historicalCounts[bunk]?.[resolvedName] || 0;
                let todayCount = 0;
                currentSchedule.forEach((entry, idx) => {
                    if (targetSlots.includes(idx)) return; 
                    if (entry && !entry.continuation) {
                        const entryRes = resolveResourceName(entry.field || entry._activity, allKnown);
                        if (String(entryRes).toLowerCase() === String(resolvedName).toLowerCase()) todayCount++;
                    }
                });
                const total = historyCount + todayCount + 1; 
                if (total > max) {
                    const lastDateStr = lastUsedDates[bunk]?.[resolvedName];
                    const dateInfo = lastDateStr ? ` (Last used: ${lastDateStr})` : "";
                    warnings.push(`⚠️ MAX USAGE: ${bunk} has used "${resolvedName}" ${historyCount + todayCount} times${dateInfo}. Limit is ${max}.`);
                }
            }
            
            // -------------------------------------------------------------
            // C. BUFFER DURATION CHECK (Issue 1)
            // -------------------------------------------------------------
            const transRules = window.SchedulerCoreUtils.getTransitionRules(resolvedName, activityProperties);
            const { activityDuration } = window.SchedulerCoreUtils.getEffectiveTimeRange({startTime: startMin, endTime: endMin}, transRules);

            if (activityDuration < transRules.minDurationMin) {
                warnings.push(`⚠️ DURATION WARNING: Actual activity time is ${activityDuration} mins (Buffer: ${transRules.preMin + transRules.postMin} mins). Minimum required is ${transRules.minDurationMin} mins.`);
            }

            // -------------------------------------------------------------
            // D. TIMELINE CAPACITY CHECK (The Gatekeeper)
            // -------------------------------------------------------------
            const tempBlock = { bunk, startTime: startMin, endTime: endMin, slots: targetSlots, divName: divisions[bunk]?.name };
            const isAvailable = window.SchedulerCoreUtils.canBlockFit(
                tempBlock, 
                resolvedName, 
                activityProperties, 
                window.fieldUsageBySlot,
                resolvedName 
            );

            if (!isAvailable) {
                warnings.push(`⚠️ CAPACITY CONFLICT: "${resolvedName}" is blocked or full during this time.`);
            }
            
            // -------------------------------------------------------------
            // E. TIME RULES CHECK
            // -------------------------------------------------------------
            const isAvailableTime = targetSlots.every(slotIdx => window.SchedulerCoreUtils.isTimeAvailable(slotIdx, props));
            if (!isAvailableTime) {
                 warnings.push(`⚠️ TIME RESTRICTION: "${resolvedName}" is closed/unavailable during this time block.`);
            }
        }

        // F. BLOCKER PROMPT
        if (warnings.length > 0) {
            const msg = warnings.join("\n\n") + "\n\nDo you want to OVERRIDE these rules and schedule anyway?";
            if (!confirm(msg)) {
                return; 
            }
        }
    } 

    // --- APPLY EDIT (Use fillBlock for atomic buffer writing - Issue 15) ---
    const slots = findSlotsForRange(startMin, endMin);
    
    if (!slots || slots.length === 0) {
        alert("Error: Could not match this time range to the internal schedule grid. Please refresh the page.");
        return;
    }

    if (!window.scheduleAssignments[bunk])
      window.scheduleAssignments[bunk] = new Array(window.unifiedTimes.length);

    if (isClear) {
      // Manual clearance is always direct writes
      slots.forEach((idx, i) => {
        window.scheduleAssignments[bunk][idx] = {
          field: "Free", sport: null, continuation: i > 0, _fixed: true, _activity: "Free"
        };
      });
    } else {
      // Fetch data for fillBlock
      const config = window.SchedulerCoreUtils.loadAndFilterData();
      const divName = Object.keys(config.divisions).find(d => config.divisions[d].bunks.includes(bunk));

      // 1. Clear old data from this range first (important for re-writing)
      slots.forEach(idx => window.scheduleAssignments[bunk][idx] = null);
      
      // 2. Use the central fillBlock logic to ensure buffers are generated correctly
      window.fillBlock({
        divName, bunk,
        startTime: startMin, 
        endTime: endMin, 
        slots,
        _fixed: true 
      }, {
        field: resolvedName, 
        sport: null, 
        _fixed: true, 
        _activity: resolvedName
      }, window.fieldUsageBySlot, config.yesterdayHistory, false, config.activityProperties);
    }

    saveSchedule();
    updateTable();
  }

  function getEntry(bunk, slotIndex) {
    const a = window.scheduleAssignments || {};
    if (!a[bunk]) return null;
    return a[bunk][slotIndex] || null;
  }

  // UPDATED: Format entry to check for transitions
  function formatEntry(entry) {
    if (!entry) return "";
    if (entry._isDismissal) return "Dismissal";
    if (entry._isSnack) return "Snacks";
    
    // Check if it's a Transition block
    if (entry._isTransition) {
        let label = entry.sport || entry.field;
        // Use a clean label for the UI
        return `🏃‍♂️ ${label}`;
    }

    const label = entry._activity || entry.field || "";
    if (entry._h2h) return entry.sport || "League Game";
    if (entry._fixed) return label;
    if (entry.sport) return `${entry.field} – ${entry.sport}`;
    return label;
  }

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

  // --- DYNAMIC GRID (UPDATED for Wrapper Block) ---
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
          expanded.push({ ...b, label: `${minutesToTimeLabel(b.startMin)} - ${minutesToLabel(b.endMin)}` });
        }
      });

      expanded.forEach((block) => {
        const tr = document.createElement("tr");
        const tdTime = document.createElement("td");
        tdTime.textContent = block.label;
        tr.appendChild(tdTime);

        const isLeague = block.event.startsWith("League Game") || block.event.startsWith("Specialty League");

        if (isLeague) {
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

          td.style.cursor = "pointer";
          td.onclick = () => editCell(bunks[0], block.startMin, block.endMin, block.event);

          tr.appendChild(td);
          tbody.appendChild(tr);
          return;
        }

        // --- Standard & Generated Slots (New Wrapper Logic) ---
        
        bunks.forEach((bunk) => {
          const td = document.createElement("td");
          const slotIdx = findFirstSlotForTime(block.startMin);
          const entry = getEntry(bunk, slotIdx);

          const isDismissal = block.event.toLowerCase().includes("dismiss");
          const isSnack = block.event.toLowerCase().includes("snack");
          const isGeneratedSlot = uiIsGeneratedEventName(block.event) || block.event.includes("/");

          let cellContent = "";
          let bg = "";
          let finalActivity = "";
          let transitionInfo = "";
          let isWrapperBlock = false;

          if (isDismissal) {
            cellContent = "Dismissal";
            bg = "#ffdddd";
          } else if (isSnack) {
            cellContent = "Snacks";
            bg = "#e7ffe7";
          } else if (!isGeneratedSlot) {
            // Pinned/Custom Event (No Buffer Logic unless manually overriden)
            bg = "#fff7cc";
            cellContent = block.event;
          } else if (entry && entry.field !== "Free") {
            // Generated Content
            
            let currentIdx = slotIdx;
            let totalPreTime = 0;
            let totalPostTime = 0;
            let activePlayTime = 0;
            let mainActivityFound = false;

            // Scan through slots belonging to this visual block
            while (currentIdx < window.unifiedTimes.length) {
                const scanEntry = getEntry(bunk, currentIdx);
                if (!scanEntry) break;
                
                const slotDuration = new Date(window.unifiedTimes[currentIdx].end).getTime() - new Date(window.unifiedTimes[currentIdx].start).getTime();
                const durationMins = slotDuration / (1000 * 60);

                if (scanEntry._activity === TRANSITION_TYPE) {
                    if (!mainActivityFound) {
                        totalPreTime += durationMins;
                    } else {
                        totalPostTime += durationMunkins;
                    }
                } else if (scanEntry._activity !== "Free") {
                    finalActivity = scanEntry._activity;
                    activePlayTime += durationMins;
                    mainActivityFound = true;
                } else {
                    // Free block breaks the wrapper sequence
                    break;
                }
                
                // If the next slot is unrelated, break the sequence
                const nextEntry = getEntry(bunk, currentIdx + 1);
                if (!nextEntry || (nextEntry.field !== scanEntry.field && nextEntry._activity !== TRANSITION_TYPE && nextEntry._activity !== finalActivity)) break;
                
                currentIdx++;
            }
            
            // Determine if the current slot is the START of the wrapper block
            const isStartOfWrapper = (slotIdx === 0) || (getEntry(bunk, slotIdx - 1)?._activity !== entry._activity && getEntry(bunk, slotIdx - 1)?._activity !== TRANSITION_TYPE);
            
            if (isStartOfWrapper && mainActivityFound) {
                 isWrapperBlock = (totalPreTime > 0 || totalPostTime > 0);
            }
            
            if (isWrapperBlock) {
                // If it's the start of a wrapper, display all info
                cellContent = `<strong>${finalActivity}</strong>`;
                bg = "#e0f7fa"; // Light blue for generated/wrapped block
                transitionInfo = `<span style="font-size:0.8em; color:#059669;">(${totalPreTime}m To / ${Math.round(activePlayTime)}m Play / ${totalPostTime}m From)</span>`;
                cellContent += `<br>${transitionInfo}`;

            } else if (entry._activity === TRANSITION_TYPE) {
                // This is a transition segment, suppress its content in the grid display
                cellContent = "";
                
                // Also, check if this transition is followed by a non-transition block 
                // within the same block time, if so, the main activity block draws over it.
                // We leave the cell empty for the wrapper block to span.
                
            } else {
                // Standard activity, not the start of a wrapper or a transition block
                cellContent = formatEntry(entry);
            }

          } else {
            cellContent = formatEntry(entry);
          }


          td.textContent = cellContent;
          td.style.cursor = "pointer";
          td.onclick = () => editCell(bunk, block.startMin, block.endMin, finalActivity || cellContent);
          
          // --- Wrapper Span Logic ---
          if (isWrapperBlock) {
             let spanCount = 1;
             let scanEndIndex = slotIdx;
             
             // Count how many vertical slots this wrapper block spans
             while (scanEndIndex + 1 < window.unifiedTimes.length) {
                const nextEntry = getEntry(bunk, scanEndIndex + 1);
                // Span until the activity or transition changes or becomes 'Free'
                if (nextEntry && nextEntry.field === entry.field && nextEntry._activity !== 'Free') {
                     spanCount++;
                     scanEndIndex++;
                } else {
                     break;
                }
             }
             
             if (spanCount > 1) {
                 td.rowSpan = spanCount;
                 // Mark all subsequent cells in the column to be skipped
                 for(let k=slotIdx + 1; k < slotIdx + spanCount; k++) {
                     // We mark this cell so the next iteration of the outer loop skips it
                     // This is handled implicitly by checking slotIndex against blocks.startMin, 
                     // but setting rowSpan > 1 visually merges it.
                 }
                 
                 // Apply merger style
                 td.style.verticalAlign = 'top';
                 td.style.textAlign = 'center';
                 td.style.background = '#e0f7fa';
             }

          } else if (getEntry(bunk, slotIdx - 1)?.field === entry.field && getEntry(bunk, slotIdx - 1)?._activity !== 'Free') {
              // This is a continuation of a previously drawn merged block or an empty transition slot
              td.style.display = 'none';
              
          }
          
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
