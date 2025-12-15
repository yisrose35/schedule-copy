// =================================================================
// trip_wizard.js — GCM v1
// Scheduler-Aware Trip Wizard with Impact Detection + Safe Exit
// =================================================================

(function () {
  'use strict';

  // ---------------------------------------------------------------
  // STATE
  // ---------------------------------------------------------------
  let tripManifest = [];
  let impactReports = [];
  let finalInstructions = [];
  let onCompleteCallback = null;
  let wizardContainer = null;

  // ---------------------------------------------------------------
  // CONSTANTS
  // ---------------------------------------------------------------
  const DAY_START = 8 * 60;
  const DAY_END = 17 * 60;
  const LUNCH_START = 12 * 60;
  const LUNCH_END = 13 * 60;

  // ---------------------------------------------------------------
  // PUBLIC API
  // ---------------------------------------------------------------
  window.TripWizard = {
    start(cb) {
      resetState();
      onCompleteCallback = cb;
      renderModalBase();
      showWhoStep();
    }
  };

  function resetState() {
    tripManifest = [];
    impactReports = [];
    finalInstructions = [];
    onCompleteCallback = null;
  }

  // ---------------------------------------------------------------
  // STEP 1 — WHO
  // ---------------------------------------------------------------
  function showWhoStep() {
    const divisions = window.availableDivisions || [];

    renderStep({
      title: "Plan a Trip",
      body: `
        <p>Select the divisions going on the trip.</p>
        <div class="tw-checkbox-grid">
          ${divisions.map(d => `
            <label class="tw-checkbox">
              <input type="checkbox" value="${d}">
              <span>${d}</span>
            </label>
          `).join("")}
        </div>
      `,
      nextLabel: "Next",
      onNext: () => {
        const selected = [...wizardContainer.querySelectorAll('input:checked')]
          .map(i => i.value);

        if (!selected.length) {
          alert("Select at least one division.");
          return;
        }

        tripManifest = selected.map(d => ({ division: d }));
        showDetailsStep(0);
      }
    });
  }

  // ---------------------------------------------------------------
  // STEP 2 — DETAILS (PER DIVISION)
  // ---------------------------------------------------------------
  function showDetailsStep(index) {
    if (index >= tripManifest.length) {
      analyzeImpacts();
      return;
    }

    const t = tripManifest[index];

    renderStep({
      title: `Trip Details — ${t.division}`,
      body: `
        <label>Destination</label>
        <input id="dest" type="text" placeholder="e.g. Zoo">

        <label>Departure Time</label>
        <input id="start" type="text" placeholder="10:00am">

        <label>Return Time</label>
        <input id="end" type="text" placeholder="3:00pm">
      `,
      nextLabel: "Next Division",
      onNext: () => {
        const dest = val("dest");
        const start = parseTime(val("start"));
        const end = parseTime(val("end"));

        if (!dest || start == null || end == null || end <= start) {
          alert("Enter valid destination and times.");
          return;
        }

        t.destination = dest;
        t.startMin = start;
        t.endMin = end;

        showDetailsStep(index + 1);
      }
    });
  }

  // ---------------------------------------------------------------
  // IMPACT ANALYSIS (CORE FIX)
  // ---------------------------------------------------------------
  function analyzeImpacts() {
    const daily = window.loadCurrentDailyData?.() || {};
    const skeleton = daily.manualSkeleton || [];

    impactReports = tripManifest.map(trip => {
      const impacts = [];

      // BLOCKING: outside day bounds
      if (trip.startMin < DAY_START || trip.endMin > DAY_END) {
        impacts.push(blocking("Trip outside division hours"));
      }

      // Scan blocks
      const blocks = skeleton.filter(b => b.division === trip.division);
      let overlappedMinutes = 0;

      blocks.forEach(b => {
        const bs = parseTime(b.startTime);
        const be = parseTime(b.endTime);
        if (bs == null || be == null) return;

        if (bs < trip.endMin && be > trip.startMin) {
          overlappedMinutes += Math.min(be, trip.endMin) - Math.max(bs, trip.startMin);

          if (b.type === "league") {
            impacts.push(critical("League removed", b));
          }
          if (b.type === "swim") {
            impacts.push(critical("Swim removed", b));
          }
          if (b.type === "specialty_league") {
            impacts.push(critical("Specialty league removed", b));
          }
          if (b.type === "lunch") {
            impacts.push(critical("Lunch displaced", b));
          }
        }
      });

      // BLOCKING: entire day wiped
      if ((trip.endMin - trip.startMin) >= (DAY_END - DAY_START - 30)) {
        impacts.push(blocking("Trip removes entire day"));
      }

      // WARNING: capacity loss
      if (overlappedMinutes > 0) {
        impacts.push(warning(`Removes ${overlappedMinutes} minutes of activities`));
      }

      return { division: trip.division, impacts };
    });

    showImpactSummary(0);
  }

  // ---------------------------------------------------------------
  // IMPACT RESOLUTION
  // ---------------------------------------------------------------
  function showImpactSummary(index) {
    if (index >= impactReports.length) {
      finalize();
      return;
    }

    const report = impactReports[index];

    const blockingIssues = report.impacts.filter(i => i.severity === "blocking");
    if (blockingIssues.length) {
      alert(
        `Trip cannot proceed for ${report.division}:\n\n` +
        blockingIssues.map(i => `• ${i.message}`).join("\n")
      );
      cancelWizard();
      return;
    }

    renderStep({
      title: `Impacts — ${report.division}`,
      body: `
        <ul>
          ${report.impacts.map(i => `
            <li><strong>${i.severity.toUpperCase()}</strong>: ${i.message}</li>
          `).join("")}
        </ul>
        <p>Proceed with this trip?</p>
      `,
      nextLabel: "Proceed",
      onNext: () => showImpactSummary(index + 1)
    });
  }

  // ---------------------------------------------------------------
  // FINALIZE
  // ---------------------------------------------------------------
  function finalize() {
    tripManifest.forEach(trip => {
      finalInstructions.push({
        division: trip.division,
        actions: [
          { type: "wipe" },
          {
            type: "pinned",
            event: `TRIP: ${trip.destination}`,
            startTime: minsToTime(trip.startMin),
            endTime: minsToTime(trip.endMin),
            reservedFields: ["Trip"]
          }
        ]
      });
    });

    closeModal();
    if (onCompleteCallback) onCompleteCallback(finalInstructions);
  }

  // ---------------------------------------------------------------
  // MODAL + EXIT
  // ---------------------------------------------------------------
  function renderModalBase() {
  const old = document.getElementById("tw-modal");
  if (old) old.remove();

  const overlay = document.createElement("div");
  overlay.id = "tw-modal";
  overlay.innerHTML = `
    <div class="tw-box">
      <button class="tw-cancel">✖ Cancel</button>
      <div id="tw-content"></div>
    </div>

    <style>
      #tw-modal {
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.55);
        z-index: 99999;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .tw-box {
        background: #ffffff;
        width: 540px;
        max-height: 85vh;
        overflow-y: auto;
        border-radius: 14px;
        padding: 24px;
        box-shadow: 0 25px 60px rgba(0,0,0,0.35);
        position: relative;
        font-family: system-ui, sans-serif;
      }

      .tw-cancel {
        position: absolute;
        top: 12px;
        right: 12px;
        border: none;
        background: transparent;
        font-size: 14px;
        cursor: pointer;
        color: #555;
      }

      .tw-cancel:hover {
        color: #000;
      }

      .tw-next {
        margin-top: 20px;
        padding: 10px 18px;
        background: #2563eb;
        color: #fff;
        border: none;
        border-radius: 6px;
        font-size: 1em;
        cursor: pointer;
      }

      .tw-next:hover {
        background: #1e40af;
      }

      .tw-checkbox-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
        margin-top: 12px;
      }

      .tw-checkbox {
        border: 1px solid #ddd;
        border-radius: 6px;
        padding: 8px;
        cursor: pointer;
        display: flex;
        gap: 6px;
        align-items: center;
      }

      .tw-checkbox:hover {
        background: #f9fafb;
      }
    </style>
  `;

  document.body.appendChild(overlay);
  wizardContainer = overlay.querySelector("#tw-content");

  overlay.querySelector(".tw-cancel").onclick = cancelWizard;
}


  function cancelWizard() {
    if (!confirm("Cancel trip setup? No changes will be saved.")) return;
    closeModal();
    resetState();
  }

  function closeModal() {
    const el = document.getElementById("tw-modal");
    if (el) el.remove();
  }

  // ---------------------------------------------------------------
  // RENDER HELPERS
  // ---------------------------------------------------------------
  function renderStep({ title, body, nextLabel, onNext }) {
    wizardContainer.innerHTML = `
      <h2>${title}</h2>
      ${body}
      <button class="tw-next">${nextLabel}</button>
    `;
    wizardContainer.querySelector(".tw-next").onclick = onNext;
  }

  // ---------------------------------------------------------------
  // UTILS
  // ---------------------------------------------------------------
  function parseTime(str) {
    if (!str) return null;
    const d = new Date("1/1/2000 " + str);
    if (isNaN(d)) return null;
    return d.getHours() * 60 + d.getMinutes();
  }

  function minsToTime(m) {
    const h = Math.floor(m / 60);
    const min = m % 60;
    const ap = h >= 12 ? "pm" : "am";
    const hh = h % 12 || 12;
    return `${hh}:${min.toString().padStart(2, "0")}${ap}`;
  }

  function val(id) {
    return wizardContainer.querySelector(`#${id}`)?.value.trim();
  }

  function blocking(msg) {
    return { severity: "blocking", message: msg };
  }
  function critical(msg, block) {
    return { severity: "critical", message: msg, block };
  }
  function warning(msg) {
    return { severity: "warning", message: msg };
  }

})();
