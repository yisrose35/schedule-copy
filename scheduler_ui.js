// -------------------- scheduler_ui.js --------------------
// Full-featured staggered view + editing
// - One table per division
// - Rows from manualSkeleton (Daily Adjustments)
// - League mirroring via _allMatchups list
// - League Game X / Specialty League X counters (persisted day-to-day)
// - Split blocks (first half / second half) aligned to slots
// - Pins vs generated vs dismissal vs snacks
// - Click any cell to edit (range-aware, using overlap logic)
// --------------------------------------------------------

(function () {
  "use strict";

  // ===== CONFIG / HELPERS =====
  var INCREMENT_MINS = 30; // Must match core

  function parseTimeToMinutes(str) {
    if (!str || typeof str !== "string") return null;

    var s = str.trim();
    var lower = s.toLowerCase();
    var mer = null;

    if (lower.endsWith("am") || lower.endsWith("pm")) {
      mer = lower.endsWith("am") ? "am" : "pm";
      s = s.slice(0, -2).trim();
    }

    var m = s.match(/^(\d{1,2})\s*:\s*(\d{2})$/);
    if (!m) return null;

    var hh = parseInt(m[1], 10);
    var mm = parseInt(m[2], 10);
    if (isNaN(hh) || isNaN(mm) || mm < 0 || mm > 59) return null;

    if (mer) {
      if (hh === 12) {
        hh = mer === "am" ? 0 : 12;
      } else if (mer === "pm") {
        hh += 12;
      }
    } else {
      // Expect explicit AM/PM everywhere
      return null;
    }

    return hh * 60 + mm;
  }

  function fieldLabel(f) {
    if (typeof f === "string") return f;
    if (f && typeof f === "object" && typeof f.name === "string") return f.name;
    return "";
  }

  function minutesToTimeLabel(min) {
    if (min == null || isNaN(min)) return "Invalid Time";
    var h = Math.floor(min / 60);
    var m = (min % 60).toString().padStart(2, "0");
    var ap = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    return h + ":" + m + " " + ap;
  }

  // ===== MATCH GENERATED EVENTS =====
  var UI_GENERATED_EVENTS = new Set([
    "activity",
    "activities",
    "general activity",
    "general activity slot",
    "sports",
    "sport",
    "sports slot",
    "special activity",
    "league game",
    "specialty league",
    "speciality league",
    "swim"
  ]);

  function uiIsGeneratedEventName(name) {
    if (!name) return false;
    return UI_GENERATED_EVENTS.has(String(name).trim().toLowerCase());
  }

  // ===== ENTRY FORMATTER =====
  function getEntry(bunk, slotIndex) {
    var assignments = window.scheduleAssignments || {};
    if (bunk && assignments[bunk] && assignments[bunk][slotIndex]) {
      return assignments[bunk][slotIndex];
    }
    return null;
  }

  function formatEntry(entry) {
    if (!entry) return "";
    if (entry._isDismissal) return "Dismissal";
    if (entry._isSnack) return "Snacks";

    var label = fieldLabel(entry.field) || "";

    if (entry._h2h) {
      return entry.sport || "League Game";
    } else if (entry._fixed) {
      return label || entry._activity || "";
    } else if (entry.sport) {
      return label + " - " + entry.sport;
    } else {
      return label;
    }
  }

  // ===== SLOT HELPERS =====
  function findFirstSlotForTime(startMin) {
    if (startMin === null || !window.unifiedTimes) return -1;

    // Near-exact match first
    for (var i = 0; i < window.unifiedTimes.length; i++) {
      var slot = window.unifiedTimes[i];
      var d = new Date(slot.start);
      var slotStart = d.getHours() * 60 + d.getMinutes();
      if (Math.abs(slotStart - startMin) < 2) {
        return i;
      }
    }

    // Fallback: overlap (start inside a slot)
    for (var j = 0; j < window.unifiedTimes.length; j++) {
      var slot2 = window.unifiedTimes[j];
      var d2 = new Date(slot2.start);
      var slotStart2 = d2.getHours() * 60 + d2.getMinutes();
      var slotEnd2 = slotStart2 + INCREMENT_MINS;
      if (startMin >= slotStart2 && startMin < slotEnd2) {
        return j;
      }
    }

    return -1;
  }

  // Overlap-based slot finder (synced with core)
  function findSlotsForRange(startMin, endMin) {
    var slots = [];
    if (!window.unifiedTimes || startMin == null || endMin == null) return slots;

    for (var i = 0; i < window.unifiedTimes.length; i++) {
      var slot = window.unifiedTimes[i];
      var d = new Date(slot.start);
      var slotStart = d.getHours() * 60 + d.getMinutes();
      var slotEnd = slotStart + INCREMENT_MINS;

      // Overlap: Max(startA, startB) < Min(endA, endB)
      if (Math.max(startMin, slotStart) < Math.min(endMin, slotEnd)) {
        slots.push(i);
      }
    }
    return slots;
  }

  // ===== EDITING (range-aware) =====
  function editCell(bunkName, startMin, endMin, currentActivity) {
    if (!bunkName) return;

    var promptText =
      "Edit activity for " +
      bunkName +
      "\n(" +
      minutesToTimeLabel(startMin) +
      " - " +
      minutesToTimeLabel(endMin) +
      "):\n\n(Enter 'CLEAR' or 'FREE' to empty the slot)";

    var newActivityName = window.prompt(promptText, currentActivity || "");
    if (newActivityName === null) return;

    var finalActivityName = newActivityName.trim();
    var slotsToUpdate = findSlotsForRange(startMin, endMin);

    if (!slotsToUpdate.length) {
      console.error("Could not find slots to update for", startMin, endMin);
      return;
    }

    if (!window.scheduleAssignments[bunkName]) {
      window.scheduleAssignments[bunkName] = new Array(window.unifiedTimes.length);
    }

    if (
      finalActivityName === "" ||
      finalActivityName.toUpperCase() === "CLEAR" ||
      finalActivityName.toUpperCase() === "FREE"
    ) {
      // Mark all covered slots as Free
      slotsToUpdate.forEach(function (slotIndex, idx) {
        window.scheduleAssignments[bunkName][slotIndex] = {
          field: "Free",
          sport: null,
          continuation: idx > 0,
          _fixed: true,
          _h2h: false,
          _activity: "Free"
        };
      });
    } else {
      // Custom pin across range
      slotsToUpdate.forEach(function (slotIndex, idx) {
        window.scheduleAssignments[bunkName][slotIndex] = {
          field: finalActivityName,
          sport: null,
          continuation: idx > 0,
          _fixed: true,
          _h2h: false,
          vs: null,
          _activity: finalActivityName
        };
      });
    }

    if (typeof window.saveSchedule === "function") window.saveSchedule();
    if (typeof window.updateTable === "function") window.updateTable();
  }

  // ===== CORE RENDER (FULL) =====
  function renderStaggeredView(container) {
    container.innerHTML = "";

    var availableDivisions = window.availableDivisions || [];
    var divisions = window.divisions || {};

    var dailyData =
      (typeof window.loadCurrentDailyData === "function" &&
        window.loadCurrentDailyData()) ||
      {};
    var manualSkeleton = dailyData.manualSkeleton || [];

    var prevDailyData =
      (typeof window.loadPreviousDailyData === "function" &&
        window.loadPreviousDailyData()) ||
      {};
    var prevCounters = prevDailyData.leagueDayCounters || {};
    var todayCounters = {};

    if (!manualSkeleton.length) {
      container.innerHTML =
        "<p>No schedule built for this day. Go to the 'Daily Adjustments' tab to build one.</p>";
      return;
    }

    var wrapper = document.createElement("div");
    wrapper.className = "schedule-view-wrapper";
    container.appendChild(wrapper);

    availableDivisions.forEach(function (div) {
      var divData = divisions[div] || {};
      var bunks = (divData.bunks || []).slice().sort();
      if (!bunks.length) return;

      var table = document.createElement("table");
      table.className = "schedule-division-table";
      table.style.borderCollapse = "collapse";
      table.style.marginBottom = "24px";

      // Header
      var thead = document.createElement("thead");
      var tr1 = document.createElement("tr");
      var tr2 = document.createElement("tr");

      var thDiv = document.createElement("th");
      thDiv.colSpan = 1 + bunks.length;
      thDiv.textContent = div;
      thDiv.style.background = divData.color || "#333";
      thDiv.style.color = "#fff";
      thDiv.style.border = "1px solid #999";
      tr1.appendChild(thDiv);

      var thTime = document.createElement("th");
      thTime.textContent = "Time";
      thTime.style.minWidth = "100px";
      thTime.style.border = "1px solid #999";
      tr2.appendChild(thTime);

      bunks.forEach(function (b) {
        var thBunk = document.createElement("th");
        thBunk.textContent = b;
        thBunk.style.border = "1px solid #999";
        thBunk.style.minWidth = "120px";
        tr2.appendChild(thBunk);
      });

      thead.appendChild(tr1);
      thead.appendChild(tr2);
      table.appendChild(thead);

      // Build blocks from manualSkeleton for this division
      var tbody = document.createElement("tbody");
      var tempSortedBlocks = [];

      manualSkeleton.forEach(function (item) {
        if (item.division !== div) return;

        var startMin = parseTimeToMinutes(item.startTime);
        var endMin = parseTimeToMinutes(item.endTime);
        if (startMin === null || endMin === null) return;

        var divStartMin =
          typeof divData.startTime === "string"
            ? parseTimeToMinutes(divData.startTime)
            : null;
        var divEndMin =
          typeof divData.endTime === "string"
            ? parseTimeToMinutes(divData.endTime)
            : null;

        if (divStartMin !== null && endMin <= divStartMin) return;
        if (divEndMin !== null && startMin >= divEndMin) return;

        tempSortedBlocks.push({
          item: item,
          startMin: startMin,
          endMin: endMin
        });
      });

      tempSortedBlocks.sort(function (a, b) {
        return a.startMin - b.startMin;
      });

      var prevDivCounts = prevCounters[div] || { league: 0, specialty: 0 };
      var todayLeagueCount = prevDivCounts.league;
      var todaySpecialtyCount = prevDivCounts.specialty;

      var divisionBlocks = [];

      tempSortedBlocks.forEach(function (block) {
        var item = block.item;
        var startMin = block.startMin;
        var endMin = block.endMin;
        var eventName = item.event;

        if (item.event === "League Game") {
          todayLeagueCount += 1;
          eventName = "League Game " + todayLeagueCount;
        } else if (item.event === "Specialty League") {
          todaySpecialtyCount += 1;
          eventName = "Specialty League " + todaySpecialtyCount;
        }

        divisionBlocks.push({
          label:
            minutesToTimeLabel(startMin) +
            " - " +
            minutesToTimeLabel(endMin),
          startMin: startMin,
          endMin: endMin,
          event: eventName,
          type: item.type
        });
      });

      todayCounters[div] = {
        league: todayLeagueCount,
        specialty: todaySpecialtyCount
      };

      // Deduplicate by label (time range)
      var uniqueBlocks = divisionBlocks.filter(function (block, index, self) {
        return (
          index ===
          self.findIndex(function (t) {
            return t.label === block.label;
          })
        );
      });

      // Split blocks into first half / second half using slot-based split
      var flattenedBlocks = [];
      uniqueBlocks.forEach(function (block) {
        if (
          block.type === "split" &&
          block.startMin !== null &&
          block.endMin !== null
        ) {
          var durationMins = block.endMin - block.startMin;
          var totalSlots = Math.floor(durationMins / INCREMENT_MINS);
          var firstHalfSlots = Math.ceil(totalSlots / 2);
          var midMin = block.startMin + firstHalfSlots * INCREMENT_MINS;

          // First half
          flattenedBlocks.push({
            label:
              minutesToTimeLabel(block.startMin) +
              " - " +
              minutesToTimeLabel(midMin),
            startMin: block.startMin,
            endMin: midMin,
            event: block.event,
            type: block.type,
            splitPart: 1
          });

          // Second half
          flattenedBlocks.push({
            label:
              minutesToTimeLabel(midMin) +
              " - " +
              minutesToTimeLabel(block.endMin),
            startMin: midMin,
            endMin: block.endMin,
            event: block.event,
            type: block.type,
            splitPart: 2
          });
        } else {
          flattenedBlocks.push(block);
        }
      });

      if (!flattenedBlocks.length) {
        var trEmpty = document.createElement("tr");
        var tdEmpty = document.createElement("td");
        tdEmpty.colSpan = bunks.length + 1;
        tdEmpty.textContent =
          "No schedule blocks found for this division in the template.";
        tdEmpty.className = "grey-cell";
        trEmpty.appendChild(tdEmpty);
        tbody.appendChild(trEmpty);
      }

      flattenedBlocks.forEach(function (eventBlock) {
        var tr = document.createElement("tr");

        // Time cell
        var tdTime = document.createElement("td");
        tdTime.style.border = "1px solid "#ccc";
        tdTime.style.verticalAlign = "top";
        tdTime.style.fontWeight = "bold";
        tdTime.textContent = eventBlock.label;
        tr.appendChild(tdTime);

        var rawName = eventBlock.event || "";
        var nameLc = rawName.toLowerCase();
        var isDismissalBlock = nameLc.indexOf("dismiss") !== -1;
        var isSnackBlock = nameLc.indexOf("snack") !== -1;

        // League / Specialty rows get a merged cell with bullet list
        if (
          rawName.indexOf("League Game") === 0 ||
          rawName.indexOf("Specialty League") === 0
        ) {
          var tdLeague = document.createElement("td");
          tdLeague.colSpan = bunks.length;
          tdLeague.style.verticalAlign = "top";
          tdLeague.style.textAlign = "left";
          tdLeague.style.padding = "5px 8px";
          tdLeague.style.background = "#f0f8f0";

          var firstSlotIndex = findFirstSlotForTime(eventBlock.startMin);
          var allMatchups = [];

          if (bunks.length > 0) {
            var firstBunkEntry = getEntry(bunks[0], firstSlotIndex);
            if (firstBunkEntry && firstBunkEntry._allMatchups) {
              allMatchups = firstBunkEntry._allMatchups;
            }
          }

          var html = "";
          if (!allMatchups || !allMatchups.length) {
            html =
              '<p class="muted" style="margin:0; padding: 4px;">' +
              rawName +
              "</p>";
          } else {
            html =
              '<p style="margin:2px 0 5px 4px; font-weight: bold;">' +
              rawName +
              "</p>";
            html += '<ul style="margin: 0; padding-left: 18px;">';
            allMatchups.forEach(function (matchupLabel) {
              html += "<li>" + matchupLabel + "</li>";
            });
            html += "</ul>";
          }

          tdLeague.innerHTML = html;
          tr.appendChild(tdLeague);
        } else {
          // Non-league blocks: may be pins, generated, dismissal, snacks
          var isGeneratedBlock = uiIsGeneratedEventName(rawName);
          if (!isGeneratedBlock && rawName.indexOf("/") !== -1) {
            var parts = rawName
              .split("/")
              .map(function (s) {
                return s.trim().toLowerCase();
              })
              .filter(function (p) {
                return p;
              });
            if (
              parts.some(function (p) {
                return UI_GENERATED_EVENTS.has(p);
              })
            ) {
              isGeneratedBlock = true;
            }
          }

          var isPinBlock =
            !isGeneratedBlock && !isDismissalBlock && !isSnackBlock;

          bunks.forEach(function (bunk) {
            var tdActivity = document.createElement("td");
            tdActivity.style.border = "1px solid #ccc";
            tdActivity.style.verticalAlign = "top";

            var startMin = eventBlock.startMin;
            var endMin = eventBlock.endMin;
            var cellActivityName = "";

            if (isDismissalBlock) {
              cellActivityName = "Dismissal";
              tdActivity.style.background = "#ffecec";
              tdActivity.style.fontWeight = "bold";
            } else if (isSnackBlock) {
              cellActivityName = "Snacks";
              tdActivity.style.background = "#e8f5e9";
              tdActivity.style.fontWeight = "bold";
            } else if (isPinBlock) {
              cellActivityName = rawName || "Pinned";
              tdActivity.style.background = "#fff8e1";
              tdActivity.style.fontWeight = "bold";
            } else {
              var slotIndex = findFirstSlotForTime(startMin);
              var entry = getEntry(bunk, slotIndex);

              if (entry) {
                cellActivityName = formatEntry(entry);
                if (entry._h2h) {
                  tdActivity.style.background = "#e8f4ff";
                  tdActivity.style.fontWeight = "bold";
                } else if (entry._fixed) {
                  tdActivity.style.background = "#fff8e1";
                }
              } else {
                cellActivityName = rawName;
              }
            }

            tdActivity.textContent = cellActivityName;
            tdActivity.style.cursor = "pointer";
            tdActivity.title = "Click to edit this activity";
            tdActivity.onclick = function () {
              editCell(bunk, startMin, endMin, cellActivityName);
            };

            tr.appendChild(tdActivity);
          });
        }

        tbody.appendChild(tr);
      });

      table.appendChild(tbody);
      wrapper.appendChild(table);
    });

    if (typeof window.saveCurrentDailyData === "function") {
      window.saveCurrentDailyData("leagueDayCounters", todayCounters);
    }
  }

  // ===== Save / Load / Init =====
  function saveSchedule() {
    try {
      if (typeof window.saveCurrentDailyData === "function") {
        window.saveCurrentDailyData(
          "scheduleAssignments",
          window.scheduleAssignments
        );
        window.saveCurrentDailyData(
          "leagueAssignments",
          window.leagueAssignments
        );
        window.saveCurrentDailyData("unifiedTimes", window.unifiedTimes);
      }
    } catch (e) {
      // ignore
    }
  }

  function reconcileOrRenderSaved() {
    try {
      var data =
        (typeof window.loadCurrentDailyData === "function" &&
          window.loadCurrentDailyData()) ||
        {};
      window.scheduleAssignments = data.scheduleAssignments || {};
      window.leagueAssignments = data.leagueAssignments || {};

      var savedTimes = data.unifiedTimes || [];
      window.unifiedTimes = savedTimes.map(function (slot) {
        return {
          start: new Date(slot.start),
          end: new Date(slot.end)
        };
      });
    } catch (e) {
      window.scheduleAssignments = {};
      window.leagueAssignments = {};
      window.unifiedTimes = [];
    }
    updateTable();
  }

  function updateTable() {
    var container = document.getElementById("scheduleTable");
    if (!container) return;
    renderStaggeredView(container);
  }

  function initScheduleSystem() {
    try {
      window.scheduleAssignments = window.scheduleAssignments || {};
      window.leagueAssignments = window.leagueAssignments || {};
      reconcileOrRenderSaved();
    } catch (e) {
      updateTable();
    }
  }

  // ===== Expose to window =====
  if (!window.updateTable) window.updateTable = updateTable;
  if (!window.initScheduleSystem) window.initScheduleSystem = initScheduleSystem;
  if (!window.saveSchedule) window.saveSchedule = saveSchedule;

})();
