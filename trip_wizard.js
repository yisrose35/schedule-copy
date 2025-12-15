// =================================================================
// trip_wizard.js — HUMAN-CENTRIC TRIP PLANNER (FIXED + SAFE)
// =================================================================

(function () {
  'use strict';

  // ------------------------------------------------------------
  // HARD GUARD — REQUIRED DEPENDENCIES
  // ------------------------------------------------------------
  if (typeof window.parseTimeToMinutes !== "function") {
    alert(
      "Trip Wizard cannot start.\n\n" +
      "parseTimeToMinutes() was not found.\n\n" +
      "Make sure daily_adjustments.js loads BEFORE trip_wizard.js."
    );
    return;
  }

  if (typeof window.loadCurrentDailyData !== "function") {
    alert(
      "Trip Wizard cannot start.\n\n" +
      "loadCurrentDailyData() was not found."
    );
    return;
  }

  // ------------------------------------------------------------
  // STATE
  // ------------------------------------------------------------
  let tripManifest = [];
  let plannedChanges = [];
  let onComplete = null;
  let wizardEl = null;

  // ------------------------------------------------------------
  // TIME HELPERS (AM / PM ONLY)
  // ------------------------------------------------------------
  function toMin(str) {
    try {
      return window.parseTimeToMinutes(str);
    } catch {
      return null;
    }
  }

  function addMinutes(timeStr, mins) {
    const d = new Date("1/1/2000 " + timeStr);
    d.setMinutes(d.getMinutes() + mins);
    let h = d.getHours();
    const m = d.getMinutes();
    const ap = h >= 12 ? 'pm' : 'am';
    h = h % 12 || 12;
    return `${h}:${m.toString().padStart(2, '0')}${ap}`;
  }

  // ------------------------------------------------------------
  // PUBLIC API
  // ------------------------------------------------------------
  window.TripWizard = {
    start(cb) {
      tripManifest = [];
      plannedChanges = [];
      onComplete = cb;

      renderBase();
      stepWho();
    }
  };

  // ------------------------------------------------------------
  // STEP 1 — WHO
  // ------------------------------------------------------------
  function stepWho() {
    const divisions = window.availableDivisions || [];

    renderStep({
      title: "Let’s plan a trip",
      text: "Which divisions are going?",
      body: divisions.map(d => `
        <label class="tw-check">
          <input type="checkbox" value="${d}"> ${d}
        </label>
      `).join(""),
      next: () => {
        const chosen = [...wizardEl.querySelectorAll('input[type=checkbox]:checked')]
          .map(i => i.value);

        if (!chosen.length) {
          alert("Please pick at least one division.");
          return;
        }

        tripManifest = chosen.map(d => ({ division: d }));
        stepTripDetails();
      }
    });
  }

  // ------------------------------------------------------------
  // STEP 2 — TRIP DETAILS
  // ------------------------------------------------------------
  function stepTripDetails() {
    renderStep({
      title: "Trip details",
      text: "Where are they going and when?",
      body: `
        <label>Destination</label>
        <input id="tw-dest" placeholder="Zoo, Park, Museum">

        <label>Leave</label>
        <input id="tw-start" placeholder="11:00am">

        <label>Return</label>
        <input id="tw-end" placeholder="2:00pm">
      `,
      next: () => {
        const dest = wizardEl.querySelector('#tw-dest').value.trim();
        const start = wizardEl.querySelector('#tw-start').value.trim();
        const end = wizardEl.querySelector('#tw-end').value.trim();

        const sMin = toMin(start);
        const eMin = toMin(end);

        if (!dest || sMin == null || eMin == null || eMin <= sMin) {
          alert("Please enter a valid destination and times (am/pm).");
          return;
        }

        tripManifest.forEach(t => {
          t.destination = dest;
          t.start = start;
          t.end = end;
        });

        scanDivision(0);
      }
    });
  }

  // ------------------------------------------------------------
  // SCAN DAILY OVERRIDE SKELETON
  // ------------------------------------------------------------
  function scanDivision(index) {
    if (index >= tripManifest.length) {
      showPreview();
      return;
    }

    const trip = tripManifest[index];
    const dailyData = window.loadCurrentDailyData() || {};
    const skeleton = dailyData.manualSkeleton || [];

    const overlaps = skeleton.filter(b =>
      b.division === trip.division &&
      toMin(b.startTime) < toMin(trip.end) &&
      toMin(b.endTime) > toMin(trip.start)
    );

    handleImpacts(trip, overlaps, index);
  }

  // ------------------------------------------------------------
  // HANDLE IMPACTS ONE BY ONE
  // ------------------------------------------------------------
  function handleImpacts(trip, blocks, index) {
    if (!blocks.length) {
      plannedChanges.push({
        division: trip.division,
        type: "pinned",
        event: `TRIP: ${trip.destination}`,
        startTime: trip.start,
        endTime: trip.end
      });
      scanDivision(index + 1);
      return;
    }

    const block = blocks.shift();
    const evt = (block.event || "").toLowerCase();

    // ---- LUNCH ----
    if (evt.includes("lunch")) {
      renderStep({
        title: `${trip.division} – Lunch`,
        text: "Looks like lunch would be missed. What do you want to do?",
        body: `
          <label>Eat earlier</label>
          <input id="lstart" placeholder="10:40am">
          <input id="lend" placeholder="11:00am">
        `,
        next: () => {
          const s = wizardEl.querySelector('#lstart').value;
          const e = wizardEl.querySelector('#lend').value;
          if (toMin(s) == null || toMin(e) == null || toMin(e) <= toMin(s)) {
            alert("Enter a valid lunch time.");
            return;
          }
          plannedChanges.push({
            division: trip.division,
            type: "lunch",
            event: "Lunch",
            startTime: s,
            endTime: e
          });
          handleImpacts(trip, blocks, index);
        }
      });
      return;
    }

    // ---- SWIM ----
    if (evt.includes("swim")) {
      const suggested = addMinutes(trip.end, 0);
      renderStep({
        title: `${trip.division} – Swim`,
        text: "They’ll miss swim. Here’s a suggestion — you can change it.",
        body: `
          <label>Suggested swim time</label>
          <input id="sstart" value="${suggested}">
          <input id="send" value="${addMinutes(suggested, 45)}">
        `,
        next: () => {
          const s = wizardEl.querySelector('#sstart').value;
          const e = wizardEl.querySelector('#send').value;
          if (toMin(s) == null || toMin(e) == null || toMin(e) <= toMin(s)) {
            alert("Enter a valid swim time.");
            return;
          }
          plannedChanges.push({
            division: trip.division,
            type: "swim",
            event: "Swim",
            startTime: s,
            endTime: e
          });
          handleImpacts(trip, blocks, index);
        }
      });
      return;
    }

    // ---- DEFAULT (SKIP) ----
    renderStep({
      title: `${trip.division}`,
      text: `"${block.event}" will be missed because of the trip.`,
      body: `<p>We’ll skip it for today.</p>`,
      next: () => handleImpacts(trip, blocks, index)
    });
  }

  // ------------------------------------------------------------
  // PREVIEW SCREEN
  // ------------------------------------------------------------
  function showPreview() {
    const html = plannedChanges.map(c => `
      <div style="margin-bottom:6px;">
        <strong>${c.division}</strong>: ${c.event}
        (${c.startTime}–${c.endTime})
      </div>
    `).join("");

    renderStep({
      title: "Here’s what today would look like",
      text: "Please review before applying.",
      body: html,
      nextText: "Apply Changes",
      next: () => {
        if (onComplete) {
          onComplete(groupByDivision(plannedChanges));
        }
        close();
      },
      cancelText: "Cancel"
    });
  }

  function groupByDivision(changes) {
    const out = {};
    changes.forEach(c => {
      out[c.division] ??= [];
      out[c.division].push(c);
    });
    return Object.keys(out).map(d => ({
      division: d,
      actions: out[d]
    }));
  }

  // ------------------------------------------------------------
  // UI RENDERING
  // ------------------------------------------------------------
  function renderBase() {
    const old = document.getElementById("tw-overlay");
    if (old) old.remove();

    const o = document.createElement("div");
    o.id = "tw-overlay";
    o.innerHTML = `
      <div class="tw-box">
        <div class="tw-header">
          <strong>Trip Planner</strong>
          <button id="tw-exit">✖</button>
        </div>
        <div id="tw-content"></div>
      </div>
      <style>
        #tw-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,.5);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 9999;
        }
        .tw-box {
          background: white;
          padding: 20px;
          border-radius: 12px;
          width: 520px;
          max-height: 85vh;
          overflow-y: auto;
          box-shadow: 0 10px 30px rgba(0,0,0,.25);
        }
        .tw-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 10px;
        }
        #tw-exit {
          background: none;
          border: none;
          font-size: 18px;
          cursor: pointer;
        }
        label {
          display: block;
          margin-top: 10px;
        }
        input {
          width: 100%;
          padding: 8px;
          margin-top: 4px;
          box-sizing: border-box;
        }
        button {
          margin-top: 15px;
          padding: 8px 14px;
        }
      </style>
    `;
    document.body.appendChild(o);
    wizardEl = document.getElementById("tw-content");

    document.getElementById("tw-exit").onclick = () => {
      if (confirm("Exit trip setup? No changes will be saved.")) {
        close();
      }
    };
  }

  function renderStep({ title, text, body, next, nextText = "Next", cancelText }) {
    wizardEl.innerHTML = `
      <h3>${title}</h3>
      <p>${text}</p>
      ${body}
      <div>
        <button id="tw-next">${nextText}</button>
        ${cancelText ? `<button id="tw-cancel">${cancelText}</button>` : ""}
      </div>
    `;
    wizardEl.querySelector('#tw-next').onclick = next;
    if (cancelText) {
      wizardEl.querySelector('#tw-cancel').onclick = close;
    }
  }

  function close() {
    document.getElementById("tw-overlay")?.remove();
  }

})();
