// =================================================================
// trip_wizard.js — HUMAN-CENTRIC TRIP PLANNER (SELF-CONTAINED FIX)
// NO dependency on daily_adjustments.js internals
// =================================================================

(function () {
  'use strict';

  // ------------------------------------------------------------
  // STATE
  // ------------------------------------------------------------
  let tripManifest = [];
  let plannedChanges = [];
  let onComplete = null;
  let wizardEl = null;

  // ------------------------------------------------------------
  // TIME PARSER — AM/PM ONLY (SELF CONTAINED)
  // ------------------------------------------------------------
  function toMin(str) {
    if (!str || typeof str !== "string") return null;
    const s = str.trim().toLowerCase();
    const m = s.match(/^(\d{1,2}):(\d{2})(am|pm)$/);
    if (!m) return null;

    let h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    const ap = m[3];

    if (min < 0 || min > 59 || h < 1 || h > 12) return null;
    if (h === 12) h = ap === "am" ? 0 : 12;
    else if (ap === "pm") h += 12;

    return h * 60 + min;
  }

  function addMinutes(timeStr, mins) {
    const base = toMin(timeStr);
    if (base == null) return null;
    const t = base + mins;
    let h = Math.floor(t / 60) % 24;
    const m = t % 60;
    const ap = h >= 12 ? 'pm' : 'am';
    h = h % 12 || 12;
    return `${h}:${String(m).padStart(2, '0')}${ap}`;
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
          alert("Please select at least one division.");
          return;
        }

        tripManifest = chosen.map(d => ({ division: d }));
        stepTripDetails();
      }
    });
  }

  // ------------------------------------------------------------
  // STEP 2 — DETAILS
  // ------------------------------------------------------------
  function stepTripDetails() {
    renderStep({
      title: "Trip details",
      text: "Where are they going and what time are they leaving and coming back?",
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
          alert("Please enter a destination and valid times using am/pm.");
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
    const dailyData = window.loadCurrentDailyData?.() || {};
    const skeleton = dailyData.manualSkeleton || [];

    const overlaps = skeleton.filter(b =>
      b.division === trip.division &&
      toMin(b.startTime) < toMin(trip.end) &&
      toMin(b.endTime) > toMin(trip.start)
    );

    handleImpacts(trip, overlaps.slice(), index);
  }

  // ------------------------------------------------------------
  // HANDLE IMPACTS (HUMAN FLOW)
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
        title: `${trip.division} — Lunch`,
        text: "Looks like lunch would be missed. When do you want them to eat?",
        body: `
          <label>From</label>
          <input id="lstart" placeholder="10:40am">
          <label>To</label>
          <input id="lend" placeholder="11:00am">
        `,
        next: () => {
          const s = wizardEl.querySelector('#lstart').value;
          const e = wizardEl.querySelector('#lend').value;
          if (toMin(s) == null || toMin(e) == null || toMin(e) <= toMin(s)) {
            alert("Please enter a valid lunch window.");
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
        title: `${trip.division} — Swim`,
        text: "They’ll miss swim. I suggest moving it right when they get back.",
        body: `
          <label>Suggested swim time</label>
          <input id="sstart" value="${suggested}">
          <input id="send" value="${addMinutes(suggested, 45)}">
        `,
        next: () => {
          const s = wizardEl.querySelector('#sstart').value;
          const e = wizardEl.querySelector('#send').value;
          if (toMin(s) == null || toMin(e) == null || toMin(e) <= toMin(s)) {
            alert("Please enter a valid swim time.");
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

    // ---- DEFAULT ----
    renderStep({
      title: `${trip.division}`,
      text: `"${block.event}" will be skipped because of the trip.`,
      body: `<p>No action needed — we’ll move on.</p>`,
      next: () => handleImpacts(trip, blocks, index)
    });
  }

  // ------------------------------------------------------------
  // PREVIEW
  // ------------------------------------------------------------
  function showPreview() {
    const html = plannedChanges.map(c => `
      <div><strong>${c.division}</strong>: ${c.event} (${c.startTime}–${c.endTime})</div>
    `).join("");

    renderStep({
      title: "Preview changes",
      text: "Here’s what today will look like. Want to apply this?",
      body: html,
      nextText: "Apply",
      next: () => {
        onComplete?.(groupByDivision(plannedChanges));
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
  // UI
  // ------------------------------------------------------------
  function renderBase() {
    document.getElementById("tw-overlay")?.remove();

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
        #tw-overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:9999}
        .tw-box{background:white;padding:20px;border-radius:12px;width:520px;max-height:85vh;overflow-y:auto}
        .tw-header{display:flex;justify-content:space-between;align-items:center}
        input{width:100%;padding:8px;margin-top:4px}
        button{margin-top:15px}
      </style>
    `;
    document.body.appendChild(o);
    wizardEl = document.getElementById("tw-content");

    document.getElementById("tw-exit").onclick = () => {
      if (confirm("Exit trip setup?")) close();
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
    if (cancelText) wizardEl.querySelector('#tw-cancel').onclick = close;
  }

  function close() {
    document.getElementById("tw-overlay")?.remove();
  }

})();
