// -------------------- scheduler_ui.js --------------------
// Dynamic slot-based staggered view + editing
// - One table per division
// - Rows = unifiedTimes (global time grid)
// - Columns = bunks
// - Cells from scheduleAssignments[bunk][slotIndex]
// - League rows: if slot has _allMatchups, show bullet list
// - Click any cell to edit (single-slot edits)
// --------------------------------------------------------

(function () {
  "use strict";

  var INCREMENT_MINS = 30; // must match core

  // ===== HELPERS =====
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

  function formatEntry(entry) {
    if (!entry) return "";
    if (entry._isDismissal) return "Dismissal";
    if (entry._isSnack) return "Snacks";

    var label = fieldLabel(entry.field) || "";

    if (entry._h2h) {
      // head-to-head league entry
      return entry.sport || "League Game";
    } else if (entry._fixed) {
      return label || entry._activity || "";
    } else if (entry.sport) {
      return label + " - " + entry.sport;
    } else {
      return label;
    }
  }

  function getEntry(bunk, slotIndex) {
    var assignments = window.scheduleAssignments || {};
    if (bunk && assignments[bunk] && assignments[bunk][slotIndex]) {
      return assignments[bunk][slotIndex];
    }
    return null;
  }

  // ===== EDITING =====
  function editCell(bunkName, slotIndex, currentActivity) {
    if (!bunkName) return;
    if (!window.unifiedTimes || slotIndex == null) return;

    var slot = window.unifiedTimes[slotIndex];
    var d = new Date(slot.start);
    var startMin = d.getHours() * 60 + d.getMinutes();
    var endMin = startMin + INCREMENT_MINS;

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

    if (!window.scheduleAssignments[bunkName]) {
      window.scheduleAssignments[bunkName] = new Array(window.unifiedTimes.length);
    }

    if (
      finalActivityName === "" ||
      finalActivityName.toUpperCase() === "CLEAR" ||
      finalActivityName.toUpperCase() === "FREE"
    ) {
      // Mark this slot as Free
      window.scheduleAssignments[bunkName][slotIndex] = {
        field: "Free",
        sport: null,
        continuation: false,
        _fixed: true,
        _h2h: false,
        _activity: "Free"
      };
    } else {
      // Simple pinned activity
      window.scheduleAssignments[bunkName][slotIndex] = {
        field: finalActivityName,
        sport: null,
        continuation: false,
        _fixed: true,
        _h2h: false,
        vs: null,
        _activity: finalActivityName
      };
    }

    if (typeof window.saveSchedule === "function") window.saveSchedule();
    if (typeof window.updateTable === "function") window.updateTable();
  }

  // ===== CORE RENDER (slot-based YKLI) =====
  function renderStaggeredView(container) {
    container.innerHTML = "";

    var availableDivisions = window.availableDivisions || [];
    var divisions = window.divisions || {};
    var scheduleAssignments = window.scheduleAssignments || {};
    var unifiedTimes = window.unifiedTimes || [];

    if (!unifiedTimes.length) {
      container.innerHTML =
        "<p>No unified time grid found. Generate a schedule first.</p>";
      return;
    }

    if (!availableDivisions.length) {
      container.innerHTML =
        "<p>No divisions available. Add divisions in the setup tab.</p>";
      return;
    }

    var wrapper = document.createElement("div");
    wrapper.className = "schedule-view-wrapper";
    container.appendChild(wrapper);

    // Helper: determine if a slot is a "league row" with _allMatchups
    function getLeagueMatchupsForSlot(bunks, slotIndex) {
      if (!bunks || !bunks.length) return null;
      for (var i = 0; i < bunks.length; i++) {
        var entry = getEntry(bunks[i], slotIndex);
        if (entry && entry._allMatchups && entry._allMatchups.length) {
          return {
            label: entry._activity || entry.field || "League Game",
            matchups: entry._allMatchups
          };
        }
      }
      return null;
    }

    // Build one table per division
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

      // Body
      var tbody = document.createElement("tbody");

      unifiedTimes.forEach(function (slot, slotIndex) {
        var d = new Date(slot.start);
        var startMin = d.getHours() * 60 + d.getMinutes();
        var endMin = startMin + INCREMENT_MINS;

        var tr = document.createElement("tr");

        // Time cell
        var tdTime = document.createElement("td");
        tdTime.style.border = "1px solid #ccc";
        tdTime.style.verticalAlign = "top";
        tdTime.style.fontWeight = "bold";
        tdTime.textContent =
          minutesToTimeLabel(startMin) +
          " - " +
          minutesToTimeLabel(endMin);
        tr.appendChild(tdTime);

        // Check if this slot is a league row (has _allMatchups)
        var leagueInfo = getLeagueMatchupsForSlot(bunks, slotIndex);
        if (leagueInfo) {
          var tdLeague = document.createElement("td");
          tdLeague.colSpan = bunks.length;
          tdLeague.style.verticalAlign = "top";
          tdLeague.style.textAlign = "left";
          tdLeague.style.padding = "5px 8px";
          tdLeague.style.background = "#f0f8f0";

          var html = "";
          html =
            '<p style="margin:2px 0 5px 4px; font-weight: bold;">' +
            leagueInfo.label +
            "</p>";
          html += '<ul style="margin: 0; padding-left: 18px;">';
          leagueInfo.matchups.forEach(function (matchupLabel) {
            html += "<li>" + matchupLabel + "</li>";
          });
          html += "</ul>";

          tdLeague.innerHTML = html;
          tr.appendChild(tdLeague);
        } else {
          // Regular per-bunk cells
          bunks.forEach(function (bunk) {
            var td = document.createElement("td");
            td.style.border = "1px solid #ccc";
            td.style.verticalAlign = "top";
            td.style.cursor = "pointer";

            var entry =
              scheduleAssignments[bunk] && scheduleAssignments[bunk][slotIndex]
                ? scheduleAssignments[bunk][slotIndex]
                : null;

            var label = formatEntry(entry);

            // Basic styling for fixed / league
            if (entry && entry._h2h) {
              td.style.background = "#e8f4ff";
              td.style.fontWeight = "bold";
            } else if (entry && entry._fixed) {
              td.style.background = "#fff8e1";
            } else if (entry && entry._isDismissal) {
              td.style.background = "#ffecec";
              td.style.fontWeight = "bold";
            } else if (entry && entry._isSnack) {
              td.style.background = "#e8f5e9";
              td.style.fontWeight = "bold";
            }

            td.textContent = label;
            td.title = "Click to edit this activity";

            td.onclick = function () {
              editCell(bunk, slotIndex, label);
            };

            tr.appendChild(td);
          });
        }

        tbody.appendChild(tr);
      });

      table.appendChild(tbody);
      wrapper.appendChild(table);
    });
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
