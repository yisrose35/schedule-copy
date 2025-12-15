// =================================================================
// trip_wizard.js — HUMAN-CENTRIC TRIP PLANNER (CASCADE SAFE)
// =================================================================

(function () {
  'use strict';

  // ------------------------------------------------------------
  // STATE
  // ------------------------------------------------------------
  let tripManifest = [];           // [{ division, destination, start, end }]
  let plannedChanges = [];         // [{ division, type, event, startTime, endTime, note }]
  let pendingQuestions = [];       // Queue of follow-ups
  let onComplete = null;

  let wizardEl = null;

  // ------------------------------------------------------------
  // HELPERS (TIME)
// ------------------------------------------------------------
  function toMin(str) {
    return window.parseTimeToMinutes(str);
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
      pendingQuestions = [];
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
      body: `
        ${divisions.map(d => `
          <label class="tw-check">
            <input type="checkbox" value="${d}"> ${d}
          </label>
        `).join("")}
      `,
      next: () => {
        const chosen = [...wizardEl.querySelectorAll('input[type=checkbox]:checked')]
          .map(i => i.value);

        if (!chosen.length) return alert("Pick at least one division.");

        tripManifest = chosen.map(d => ({ division: d }));
        stepDestination();
      }
    });
  }

  // ------------------------------------------------------------
  // STEP 2 — DESTINATION + TIME
  // ------------------------------------------------------------
  function stepDestination() {
    renderStep({
      title: "Trip details",
      text: "Where are they going and when?",
      body: `
        <label>Destination</label>
        <input id="dest">

        <label>Leave</label>
        <input id="start" placeholder="11:00am">

        <label>Return</label>
        <input id="end" placeholder="2:00pm">
      `,
      next: () => {
        const dest = wizardEl.querySelector('#dest').value;
        const start = wizardEl.querySelector('#start').value;
        const end = wizardEl.querySelector('#end').value;

        if (!dest || toMin(start) == null || toMin(end) == null || toMin(end) <= toMin(start)) {
          alert("Enter valid destination and times.");
          return;
        }

        tripManifest.forEach(t => {
          t.destination = dest;
          t.start = start;
          t.end = end;
        });

        scanImpacts(0);
      }
    });
  }

  // ------------------------------------------------------------
  // SCAN IMPACTS (DIVISION BY DIVISION)
  // ------------------------------------------------------------
  function scanImpacts(index) {
    if (index >= tripManifest.length) {
      preview();
      return;
    }

    const trip = tripManifest[index];
    const skeleton = window.loadCurrentDailyData?.().manualSkeleton || [];

    const affected = skeleton.filter(b =>
      b.division === trip.division &&
      toMin(b.startTime) < toMin(trip.end) &&
      toMin(b.endTime) > toMin(trip.start)
    );

    handleNextImpact(trip, affected, index);
  }

  // ------------------------------------------------------------
  // HANDLE EACH DISTURBANCE
  // ------------------------------------------------------------
  function handleNextImpact(trip, blocks, idx) {
    if (!blocks.length) {
      plannedChanges.push({
        division: trip.division,
        type: "pinned",
        event: `TRIP: ${trip.destination}`,
        startTime: trip.start,
        endTime: trip.end
      });
      scanImpacts(idx + 1);
      return;
    }

    const block = blocks.shift();
    const evt = block.event.toLowerCase();

    // ---- LUNCH ----
    if (evt.includes("lunch")) {
      renderStep({
        title: `${trip.division} – Lunch`,
        text: "Looks like lunch would be missed. What do you want to do?",
        body: `
          <label>Eat when?</label>
          <input id="lstart" placeholder="10:40am">
          <input id="lend" placeholder="11:00am">
        `,
        next: () => {
          const s = wizardEl.querySelector('#lstart').value;
          const e = wizardEl.querySelector('#lend').value;
          if (toMin(s) == null || toMin(e) == null) return alert("Invalid time.");
          plannedChanges.push({
            division: trip.division,
            type: "lunch",
            event: "Lunch",
            startTime: s,
            endTime: e,
            note: "Moved due to trip"
          });
          handleNextImpact(trip, blocks, idx);
        }
      });
      return;
    }

    // ---- SWIM ----
    if (evt.includes("swim")) {
      const suggestion = addMinutes(trip.end, 0);

      renderStep({
        title: `${trip.division} – Swim`,
        text: `They’ll miss swim. I’d suggest moving it after they get back.`,
        body: `
          <label>Suggested swim time</label>
          <input id="sstart" value="${suggestion}">
          <input id="send" value="${addMinutes(suggestion, 45)}">
        `,
        next: () => {
          const s = wizardEl.querySelector('#sstart').value;
          const e = wizardEl.querySelector('#send').value;
          if (toMin(s) == null || toMin(e) == null) return alert("Invalid time.");

          plannedChanges.push({
            division: trip.division,
            type: "swim",
            event: "Swim",
            startTime: s,
            endTime: e,
            note: "Rescheduled due to trip"
          });

          handleNextImpact(trip, blocks, idx);
        }
      });
      return;
    }

    // ---- DEFAULT SKIP ----
    renderStep({
      title: `${trip.division}`,
      text: `They’ll miss "${block.event}".`,
      body: `<p>We’ll skip it for today.</p>`,
      next: () => handleNextImpact(trip, blocks, idx)
    });
  }

  // ------------------------------------------------------------
  // PREVIEW
  // ------------------------------------------------------------
  function preview() {
    const html = plannedChanges.map(c => `
      <div>
        <strong>${c.division}</strong>: ${c.event}
        (${c.startTime}–${c.endTime})
      </div>
    `).join("");

    renderStep({
      title: "Here’s what today would look like",
      text: "Take a quick look before we apply anything.",
      body: html,
      nextText: "Apply Changes",
      next: () => {
        if (onComplete) onComplete(groupByDivision(plannedChanges));
        close();
      },
      cancelText: "Cancel"
    });
  }

  // ------------------------------------------------------------
  // UTIL
  // ------------------------------------------------------------
  function groupByDivision(changes) {
    const out = {};
    changes.forEach(c => {
      out[c.division] ??= [];
      out[c.division].push(c);
    });
    return Object.keys(out).map(d => ({ division: d, actions: out[d] }));
  }

  // ------------------------------------------------------------
  // UI
  // ------------------------------------------------------------
  function renderBase() {
    const old = document.getElementById("tw-overlay");
    if (old) old.remove();

    const o = document.createElement("div");
    o.id = "tw-overlay";
    o.innerHTML = `
      <div class="tw-box">
        <div id="tw-content"></div>
      </div>
      <style>
        #tw-overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:9999}
        .tw-box{background:white;padding:25px;border-radius:12px;width:520px}
        label{display:block;margin-top:10px}
        input{width:100%;padding:8px;margin-top:4px}
        button{margin-top:15px}
      </style>
    `;
    document.body.appendChild(o);
    wizardEl = document.getElementById("tw-content");
  }

  function renderStep({ title, text, body, next, nextText = "Next", cancelText }) {
    wizardEl.innerHTML = `
      <h3>${title}</h3>
      <p>${text}</p>
      ${body}
      <div style="margin-top:15px">
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
