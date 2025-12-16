// =================================================================
// trip_wizard.js — PROFESSIONAL TRIP PLANNER
// Apple-inspired UI, robust conflict detection, matches app design system
// =================================================================

(function () {
  'use strict';

  // ------------------------------------------------------------
  // STATE
  // ------------------------------------------------------------
  let tripManifest = [];
  let plannedChanges = [];
  let fullDaySkeleton = {};
  let workingSkeleton = {};
  let pendingQuestions = [];
  let onComplete = null;
  let wizardEl = null;
  let previewEl = null;
  let allDivisions = [];
  let travelingDivisions = [];

  // ------------------------------------------------------------
  // TIME UTILITIES
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

  function toTime(min) {
    if (min == null || min < 0) return null;
    let h = Math.floor(min / 60) % 24;
    const m = min % 60;
    const ap = h >= 12 ? 'pm' : 'am';
    h = h % 12 || 12;
    return `${h}:${String(m).padStart(2, '0')}${ap}`;
  }

  function addMinutes(timeStr, mins) {
    const base = toMin(timeStr);
    if (base == null) return null;
    return toTime(base + mins);
  }

  function overlaps(start1, end1, start2, end2) {
    const s1 = toMin(start1), e1 = toMin(end1);
    const s2 = toMin(start2), e2 = toMin(end2);
    if (s1 == null || e1 == null || s2 == null || e2 == null) return false;
    return (s1 < e2) && (e1 > s2);
  }

  // ------------------------------------------------------------
  // PUBLIC API
  // ------------------------------------------------------------
  window.TripWizard = {
    start(cb) {
      tripManifest = [];
      plannedChanges = [];
      fullDaySkeleton = {};
      workingSkeleton = {};
      pendingQuestions = [];
      onComplete = cb;
      allDivisions = window.availableDivisions || [];
      travelingDivisions = [];

      loadFullDaySkeleton();
      renderBase();
      stepWho();
    }
  };

  // ------------------------------------------------------------
  // SKELETON MANAGEMENT
  // ------------------------------------------------------------
  function loadFullDaySkeleton() {
    const dailyData = window.loadCurrentDailyData?.() || {};
    const skeleton = dailyData.manualSkeleton || [];

    allDivisions.forEach(div => {
      fullDaySkeleton[div] = skeleton.filter(b => b.division === div);
      workingSkeleton[div] = JSON.parse(JSON.stringify(fullDaySkeleton[div]));
    });
  }

  function applyChangeToWorkingSkeleton(change) {
    const div = change.division;
    
    if (change.action === 'remove' && change.oldEvent) {
      workingSkeleton[div] = workingSkeleton[div].filter(b => b.id !== change.oldEvent.id);
    } else if (change.action === 'replace' && change.oldEvent) {
      workingSkeleton[div] = workingSkeleton[div].filter(b => b.id !== change.oldEvent.id);
      workingSkeleton[div].push({
        id: `temp_${Math.random().toString(36).slice(2)}`,
        type: change.type,
        event: change.event,
        division: div,
        startTime: change.startTime,
        endTime: change.endTime,
        reservedFields: change.reservedFields || [],
        isNew: true
      });
    } else if (change.action === 'add') {
      workingSkeleton[div].push({
        id: `temp_${Math.random().toString(36).slice(2)}`,
        type: change.type,
        event: change.event,
        division: div,
        startTime: change.startTime,
        endTime: change.endTime,
        reservedFields: change.reservedFields || [],
        isNew: true
      });
    }

    updateLivePreview();
  }

  // ------------------------------------------------------------
  // LIVE SCHEDULE PREVIEW
  // ------------------------------------------------------------
  function updateLivePreview() {
    if (!previewEl) return;

    let html = '';

    const divisionsToShow = [...travelingDivisions, ...allDivisions.filter(d => !travelingDivisions.includes(d))];

    divisionsToShow.forEach(div => {
      const isTraveling = travelingDivisions.includes(div);
      const blocks = workingSkeleton[div] || [];
      
      const sorted = blocks.slice().sort((a, b) => {
        const aMin = toMin(a.startTime);
        const bMin = toMin(b.startTime);
        return (aMin || 0) - (bMin || 0);
      });

      html += `
        <div class="tw-schedule-division ${isTraveling ? 'traveling' : ''}">
          <div class="tw-schedule-header">
            <span class="tw-schedule-title">${div}</span>
            ${isTraveling ? '<span class="tw-badge-trip">On Trip</span>' : '<span class="tw-badge-camp">At Camp</span>'}
          </div>
          <div class="tw-schedule-timeline">
      `;

      if (sorted.length === 0) {
        html += `<div class="tw-schedule-empty">No activities</div>`;
      }

      sorted.forEach(block => {
        const isNew = block.isNew || false;
        const label = getLabelForEvent(block.event);
        
        html += `
          <div class="tw-timeline-item ${isNew ? 'new' : 'existing'}">
            <div class="tw-timeline-time">${block.startTime}</div>
            <div class="tw-timeline-content">
              <div class="tw-timeline-title">${label}</div>
              <div class="tw-timeline-duration">${block.startTime} – ${block.endTime}</div>
            </div>
            ${isNew ? '<span class="tw-timeline-badge">New</span>' : ''}
          </div>
        `;
      });

      html += `</div></div>`;
    });

    previewEl.innerHTML = html;
  }

  function getLabelForEvent(eventName) {
    if (!eventName) return 'Activity';
    if (eventName.includes('TRIP')) return 'Trip';
    if (eventName.toLowerCase().includes('lunch')) return 'Lunch';
    if (eventName.toLowerCase().includes('swim')) return 'Swim';
    if (eventName.toLowerCase().includes('snack')) return 'Snack';
    if (eventName.toLowerCase().includes('league')) return 'League Game';
    if (eventName.toLowerCase().includes('specialty')) return 'Specialty League';
    return eventName;
  }

  // ------------------------------------------------------------
  // CONFLICT DETECTION
  // ------------------------------------------------------------
  function detectConflicts(division, startTime, endTime, excludeId = null) {
    const blocks = workingSkeleton[division] || [];
    const conflicts = [];

    blocks.forEach(block => {
      if (excludeId && block.id === excludeId) return;
      if (overlaps(block.startTime, block.endTime, startTime, endTime)) {
        conflicts.push(block);
      }
    });

    return conflicts;
  }

  function detectCrossDivisionConflicts(activity, startTime, endTime, excludeDivision) {
    const conflicts = [];

    allDivisions.forEach(div => {
      if (div === excludeDivision) return;
      
      const blocks = workingSkeleton[div] || [];
      blocks.forEach(block => {
        if ((block.event || "").toLowerCase().includes(activity.toLowerCase())) {
          if (overlaps(block.startTime, block.endTime, startTime, endTime)) {
            conflicts.push({ division: div, block });
          }
        }
      });
    });

    return conflicts;
  }

  // ------------------------------------------------------------
  // STEP 1 — WHO'S GOING?
  // ------------------------------------------------------------
  function stepWho() {
    renderStep({
      title: "Select Divisions",
      subtitle: "Which divisions are going on this trip?",
      body: `
        <div class="tw-checkbox-group">
          ${allDivisions.map(d => `
            <label class="tw-checkbox-item">
              <input type="checkbox" value="${d}">
              <span>${d}</span>
            </label>
          `).join('')}
        </div>
      `,
      next: () => {
        const chosen = [...wizardEl.querySelectorAll('input[type=checkbox]:checked')]
          .map(i => i.value);

        if (!chosen.length) {
          alert("Please select at least one division.");
          return;
        }

        travelingDivisions = chosen;
        tripManifest = chosen.map(d => ({ division: d }));
        updateLivePreview();
        stepTripDetails();
      }
    });
  }

  // ------------------------------------------------------------
  // STEP 2 — TRIP DETAILS
  // ------------------------------------------------------------
  function stepTripDetails() {
    renderStep({
      title: "Trip Details",
      subtitle: "Where are they going and when will they leave and return?",
      body: `
        <div class="tw-form-section">
          <label class="tw-label">Destination</label>
          <input type="text" id="tw-dest" placeholder="Zoo, Museum, etc." class="tw-input">
        </div>

        <div class="tw-form-row">
          <div class="tw-form-section">
            <label class="tw-label">Departure Time</label>
            <input type="text" id="tw-start" placeholder="10:00am" class="tw-input">
          </div>

          <div class="tw-form-section">
            <label class="tw-label">Return Time</label>
            <input type="text" id="tw-end" placeholder="2:30pm" class="tw-input">
          </div>
        </div>
      `,
      next: () => {
        const dest = wizardEl.querySelector('#tw-dest').value.trim();
        const start = wizardEl.querySelector('#tw-start').value.trim();
        const end = wizardEl.querySelector('#tw-end').value.trim();

        const sMin = toMin(start);
        const eMin = toMin(end);

        if (!dest) {
          alert("Please enter a destination.");
          return;
        }

        if (sMin == null || eMin == null) {
          alert("Please enter valid times (e.g., '10:00am').");
          return;
        }

        if (eMin <= sMin) {
          alert("Return time must be after departure time.");
          return;
        }

        tripManifest.forEach(t => {
          t.destination = dest;
          t.start = start;
          t.end = end;
        });

        tripManifest.forEach(t => {
          const change = {
            division: t.division,
            action: 'add',
            type: 'pinned',
            event: `Trip: ${t.destination}`,
            startTime: t.start,
            endTime: t.end,
            reservedFields: []
          };
          plannedChanges.push(change);
          applyChangeToWorkingSkeleton(change);
        });

        startConflictResolution();
      }
    });
  }

  // ------------------------------------------------------------
  // CONFLICT RESOLUTION
  // ------------------------------------------------------------
  function startConflictResolution() {
    handleNextDivision(0);
  }

  function handleNextDivision(index) {
    if (index >= tripManifest.length) {
      handlePendingQuestions();
      return;
    }

    const trip = tripManifest[index];
    const originalBlocks = fullDaySkeleton[trip.division] || [];
    
    const conflicts = originalBlocks.filter(b => 
      overlaps(b.startTime, b.endTime, trip.start, trip.end)
    );

    if (conflicts.length === 0) {
      handleNextDivision(index + 1);
      return;
    }

    handleNextConflict(trip, conflicts.slice(), index);
  }

  function handleNextConflict(trip, remainingConflicts, divIndex) {
    if (remainingConflicts.length === 0) {
      handleNextDivision(divIndex + 1);
      return;
    }

    const conflict = remainingConflicts.shift();
    const evt = (conflict.event || "").toLowerCase();

    if (evt.includes('lunch')) {
      handleLunchConflict(trip, conflict, () => {
        handleNextConflict(trip, remainingConflicts, divIndex);
      });
    } else if (evt.includes('swim')) {
      handleSwimConflict(trip, conflict, () => {
        handleNextConflict(trip, remainingConflicts, divIndex);
      });
    } else if (evt.includes('snack')) {
      handleSnackConflict(trip, conflict, () => {
        handleNextConflict(trip, remainingConflicts, divIndex);
      });
    } else if (evt.includes('league')) {
      handleLeagueConflict(trip, conflict, () => {
        handleNextConflict(trip, remainingConflicts, divIndex);
      });
    } else {
      handleGenericConflict(trip, conflict, () => {
        handleNextConflict(trip, remainingConflicts, divIndex);
      });
    }
  }

  function handlePendingQuestions() {
    if (pendingQuestions.length === 0) {
      showFinalPreview();
      return;
    }

    const pending = pendingQuestions.shift();
    pending.handler();
  }

  // ------------------------------------------------------------
  // CONFLICT HANDLERS
  // ------------------------------------------------------------

  function handleLunchConflict(trip, conflict, next) {
    const suggestedBefore = addMinutes(trip.start, -30);
    const suggestedAfter = trip.end;

    renderStep({
      title: `${trip.division} — Lunch Timing`,
      subtitle: `Lunch (${conflict.startTime}–${conflict.endTime}) conflicts with the trip.`,
      body: `
        <div class="tw-options">
          <button class="tw-option" data-choice="before">
            <div class="tw-option-title">Before Trip</div>
            <div class="tw-option-subtitle">Suggested: ${suggestedBefore} – ${trip.start}</div>
          </button>

          <button class="tw-option" data-choice="during">
            <div class="tw-option-title">During Trip</div>
            <div class="tw-option-subtitle">Pack lunch or eat at destination</div>
          </button>

          <button class="tw-option" data-choice="after">
            <div class="tw-option-title">After Return</div>
            <div class="tw-option-subtitle">Suggested: ${suggestedAfter} – ${addMinutes(suggestedAfter, 30)}</div>
          </button>

          <button class="tw-option secondary" data-choice="custom">
            <div class="tw-option-title">Custom Time</div>
          </button>
        </div>

        <div id="custom-time" style="display:none;" class="tw-custom-time">
          <div class="tw-form-row">
            <div class="tw-form-section">
              <label class="tw-label">Start</label>
              <input type="text" id="lunch-start" placeholder="11:00am" class="tw-input">
            </div>
            <div class="tw-form-section">
              <label class="tw-label">End</label>
              <input type="text" id="lunch-end" placeholder="11:30am" class="tw-input">
            </div>
          </div>
          <button id="apply-custom" class="tw-btn-primary" style="margin-top:12px;">Apply Time</button>
        </div>
      `,
      hideNext: true,
      showSkip: true,
      onSkip: () => {
        pendingQuestions.push({
          title: `${trip.division} Lunch`,
          handler: () => handleLunchConflict(trip, conflict, next)
        });
        next();
      },
      setup: () => {
        wizardEl.querySelectorAll('.tw-option').forEach(btn => {
          btn.onclick = () => {
            const choice = btn.dataset.choice;

            if (choice === 'during') {
              const change = {
                division: trip.division,
                action: 'remove',
                oldEvent: conflict,
                reason: 'Eating during trip'
              };
              plannedChanges.push(change);
              applyChangeToWorkingSkeleton(change);
              next();
              return;
            }

            if (choice === 'custom') {
              document.getElementById('custom-time').style.display = 'block';
              return;
            }

            let start, end;
            if (choice === 'before') {
              start = suggestedBefore;
              end = trip.start;
            } else {
              start = suggestedAfter;
              end = addMinutes(suggestedAfter, 30);
            }

            applyTimeWithConflictCheck(trip.division, conflict, 'Lunch', start, end, next);
          };
        });

        const applyBtn = wizardEl.querySelector('#apply-custom');
        if (applyBtn) {
          applyBtn.onclick = () => {
            const start = wizardEl.querySelector('#lunch-start').value.trim();
            const end = wizardEl.querySelector('#lunch-end').value.trim();

            if (toMin(start) == null || toMin(end) == null || toMin(end) <= toMin(start)) {
              alert("Please enter valid times.");
              return;
            }

            applyTimeWithConflictCheck(trip.division, conflict, 'Lunch', start, end, next);
          };
        }
      }
    });
  }

  function handleSwimConflict(trip, conflict, next) {
    const suggestedStart = trip.end;
    const suggestedEnd = addMinutes(trip.end, 45);

    renderStep({
      title: `${trip.division} — Swim Time`,
      subtitle: `Swim (${conflict.startTime}–${conflict.endTime}) conflicts with the trip.`,
      body: `
        <div class="tw-options">
          <button class="tw-option" data-choice="suggested">
            <div class="tw-option-title">After Trip</div>
            <div class="tw-option-subtitle">Suggested: ${suggestedStart} – ${suggestedEnd}</div>
          </button>

          <button class="tw-option" data-choice="morning">
            <div class="tw-option-title">Morning Swim</div>
            <div class="tw-option-subtitle">Move to earlier in the day</div>
          </button>

          <button class="tw-option" data-choice="custom">
            <div class="tw-option-title">Custom Time</div>
          </button>

          <button class="tw-option secondary" data-choice="skip">
            <div class="tw-option-title">Skip Swim Today</div>
          </button>
        </div>

        <div id="custom-time" style="display:none;" class="tw-custom-time">
          <div class="tw-form-row">
            <div class="tw-form-section">
              <label class="tw-label">Start</label>
              <input type="text" id="swim-start" placeholder="2:00pm" class="tw-input">
            </div>
            <div class="tw-form-section">
              <label class="tw-label">End</label>
              <input type="text" id="swim-end" placeholder="2:45pm" class="tw-input">
            </div>
          </div>
          <button id="apply-custom" class="tw-btn-primary" style="margin-top:12px;">Apply Time</button>
        </div>
      `,
      hideNext: true,
      showSkip: true,
      onSkip: () => {
        pendingQuestions.push({
          title: `${trip.division} Swim`,
          handler: () => handleSwimConflict(trip, conflict, next)
        });
        next();
      },
      setup: () => {
        wizardEl.querySelectorAll('.tw-option').forEach(btn => {
          btn.onclick = () => {
            const choice = btn.dataset.choice;

            if (choice === 'skip') {
              const change = {
                division: trip.division,
                action: 'remove',
                oldEvent: conflict,
                reason: 'Skipped'
              };
              plannedChanges.push(change);
              applyChangeToWorkingSkeleton(change);
              next();
              return;
            }

            if (choice === 'custom' || choice === 'morning') {
              document.getElementById('custom-time').style.display = 'block';
              if (choice === 'morning') {
                wizardEl.querySelector('#swim-start').value = '9:00am';
                wizardEl.querySelector('#swim-end').value = '9:45am';
              }
              return;
            }

            applyTimeWithConflictCheck(trip.division, conflict, 'Swim', suggestedStart, suggestedEnd, next, ['Pool']);
          };
        });

        const applyBtn = wizardEl.querySelector('#apply-custom');
        if (applyBtn) {
          applyBtn.onclick = () => {
            const start = wizardEl.querySelector('#swim-start').value.trim();
            const end = wizardEl.querySelector('#swim-end').value.trim();

            if (toMin(start) == null || toMin(end) == null || toMin(end) <= toMin(start)) {
              alert("Please enter valid times.");
              return;
            }

            applyTimeWithConflictCheck(trip.division, conflict, 'Swim', start, end, next, ['Pool']);
          };
        }
      }
    });
  }

  function handleSnackConflict(trip, conflict, next) {
    renderStep({
      title: `${trip.division} — Snack Time`,
      subtitle: `Snack (${conflict.startTime}–${conflict.endTime}) conflicts with the trip.`,
      body: `
        <div class="tw-options">
          <button class="tw-option" data-choice="pack">
            <div class="tw-option-title">Pack Snacks</div>
            <div class="tw-option-subtitle">Bring snacks on the trip</div>
          </button>

          <button class="tw-option" data-choice="before">
            <div class="tw-option-title">Before Trip</div>
          </button>

          <button class="tw-option" data-choice="after">
            <div class="tw-option-title">After Return</div>
          </button>

          <button class="tw-option secondary" data-choice="skip">
            <div class="tw-option-title">Skip Snack</div>
          </button>
        </div>

        <div id="custom-time" style="display:none;" class="tw-custom-time">
          <div class="tw-form-row">
            <div class="tw-form-section">
              <label class="tw-label">Start</label>
              <input type="text" id="snack-start" placeholder="2:00pm" class="tw-input">
            </div>
            <div class="tw-form-section">
              <label class="tw-label">End</label>
              <input type="text" id="snack-end" placeholder="2:15pm" class="tw-input">
            </div>
          </div>
          <button id="apply-custom" class="tw-btn-primary" style="margin-top:12px;">Apply Time</button>
        </div>
      `,
      hideNext: true,
      showSkip: true,
      onSkip: () => {
        pendingQuestions.push({
          title: `${trip.division} Snack`,
          handler: () => handleSnackConflict(trip, conflict, next)
        });
        next();
      },
      setup: () => {
        wizardEl.querySelectorAll('.tw-option').forEach(btn => {
          btn.onclick = () => {
            const choice = btn.dataset.choice;

            if (choice === 'pack' || choice === 'skip') {
              const change = {
                division: trip.division,
                action: 'remove',
                oldEvent: conflict,
                reason: choice === 'pack' ? 'Packing snacks' : 'Skipped'
              };
              plannedChanges.push(change);
              applyChangeToWorkingSkeleton(change);
              next();
              return;
            }

            document.getElementById('custom-time').style.display = 'block';
            
            if (choice === 'before') {
              const suggested = addMinutes(trip.start, -15);
              wizardEl.querySelector('#snack-start').value = suggested;
              wizardEl.querySelector('#snack-end').value = trip.start;
            } else if (choice === 'after') {
              wizardEl.querySelector('#snack-start').value = trip.end;
              wizardEl.querySelector('#snack-end').value = addMinutes(trip.end, 15);
            }
          };
        });

        const applyBtn = wizardEl.querySelector('#apply-custom');
        if (applyBtn) {
          applyBtn.onclick = () => {
            const start = wizardEl.querySelector('#snack-start').value.trim();
            const end = wizardEl.querySelector('#snack-end').value.trim();

            if (toMin(start) == null || toMin(end) == null || toMin(end) <= toMin(start)) {
              alert("Please enter valid times.");
              return;
            }

            applyTimeWithConflictCheck(trip.division, conflict, 'Snacks', start, end, next);
          };
        }
      }
    });
  }

  function handleLeagueConflict(trip, conflict, next) {
    renderStep({
      title: `${trip.division} — League Game`,
      subtitle: `League game (${conflict.startTime}–${conflict.endTime}) conflicts with the trip.`,
      body: `
        <div class="tw-info-box">
          The opposing team will also be affected by this decision.
        </div>

        <div class="tw-options">
          <button class="tw-option" data-choice="reschedule">
            <div class="tw-option-title">Reschedule for Another Day</div>
            <div class="tw-option-subtitle">Coordinate with other teams later</div>
          </button>

          <button class="tw-option" data-choice="earlier">
            <div class="tw-option-title">Move Earlier Today</div>
            <div class="tw-option-subtitle">Play before the trip</div>
          </button>

          <button class="tw-option" data-choice="later">
            <div class="tw-option-title">Move Later Today</div>
            <div class="tw-option-subtitle">Play after returning</div>
          </button>

          <button class="tw-option secondary" data-choice="cancel">
            <div class="tw-option-title">Cancel Game</div>
          </button>
        </div>

        <div id="custom-time" style="display:none;" class="tw-custom-time">
          <div class="tw-form-row">
            <div class="tw-form-section">
              <label class="tw-label">Start</label>
              <input type="text" id="league-start" placeholder="2:00pm" class="tw-input">
            </div>
            <div class="tw-form-section">
              <label class="tw-label">End</label>
              <input type="text" id="league-end" placeholder="3:00pm" class="tw-input">
            </div>
          </div>
          <button id="apply-custom" class="tw-btn-primary" style="margin-top:12px;">Apply Time</button>
        </div>
      `,
      hideNext: true,
      showSkip: true,
      onSkip: () => {
        pendingQuestions.push({
          title: `${trip.division} League`,
          handler: () => handleLeagueConflict(trip, conflict, next)
        });
        next();
      },
      setup: () => {
        wizardEl.querySelectorAll('.tw-option').forEach(btn => {
          btn.onclick = () => {
            const choice = btn.dataset.choice;

            if (choice === 'reschedule' || choice === 'cancel') {
              const change = {
                division: trip.division,
                action: 'remove',
                oldEvent: conflict,
                reason: choice === 'reschedule' ? 'Rescheduled' : 'Cancelled'
              };
              plannedChanges.push(change);
              applyChangeToWorkingSkeleton(change);
              next();
              return;
            }

            document.getElementById('custom-time').style.display = 'block';
            
            const duration = toMin(conflict.endTime) - toMin(conflict.startTime);
            if (choice === 'earlier') {
              const newEnd = trip.start;
              const newStart = toTime(toMin(newEnd) - duration);
              wizardEl.querySelector('#league-start').value = newStart;
              wizardEl.querySelector('#league-end').value = newEnd;
            } else if (choice === 'later') {
              const newStart = trip.end;
              const newEnd = toTime(toMin(newStart) + duration);
              wizardEl.querySelector('#league-start').value = newStart;
              wizardEl.querySelector('#league-end').value = newEnd;
            }
          };
        });

        const applyBtn = wizardEl.querySelector('#apply-custom');
        if (applyBtn) {
          applyBtn.onclick = () => {
            const start = wizardEl.querySelector('#league-start').value.trim();
            const end = wizardEl.querySelector('#league-end').value.trim();

            if (toMin(start) == null || toMin(end) == null || toMin(end) <= toMin(start)) {
              alert("Please enter valid times.");
              return;
            }

            applyTimeWithConflictCheck(trip.division, conflict, conflict.event, start, end, next);
          };
        }
      }
    });
  }

  function handleGenericConflict(trip, conflict, next) {
    renderStep({
      title: `${trip.division} — ${conflict.event}`,
      subtitle: `"${conflict.event}" (${conflict.startTime}–${conflict.endTime}) conflicts with the trip.`,
      body: `
        <div class="tw-options">
          <button class="tw-option" data-choice="skip">
            <div class="tw-option-title">Skip for Today</div>
          </button>

          <button class="tw-option" data-choice="reschedule">
            <div class="tw-option-title">Move to Different Time</div>
          </button>
        </div>

        <div id="custom-time" style="display:none;" class="tw-custom-time">
          <div class="tw-form-row">
            <div class="tw-form-section">
              <label class="tw-label">Start</label>
              <input type="text" id="generic-start" placeholder="2:00pm" class="tw-input">
            </div>
            <div class="tw-form-section">
              <label class="tw-label">End</label>
              <input type="text" id="generic-end" placeholder="3:00pm" class="tw-input">
            </div>
          </div>
          <button id="apply-custom" class="tw-btn-primary" style="margin-top:12px;">Apply Time</button>
        </div>
      `,
      hideNext: true,
      showSkip: true,
      onSkip: () => {
        pendingQuestions.push({
          title: `${trip.division} ${conflict.event}`,
          handler: () => handleGenericConflict(trip, conflict, next)
        });
        next();
      },
      setup: () => {
        wizardEl.querySelectorAll('.tw-option').forEach(btn => {
          btn.onclick = () => {
            const choice = btn.dataset.choice;

            if (choice === 'skip') {
              const change = {
                division: trip.division,
                action: 'remove',
                oldEvent: conflict,
                reason: 'Skipped'
              };
              plannedChanges.push(change);
              applyChangeToWorkingSkeleton(change);
              next();
              return;
            }

            document.getElementById('custom-time').style.display = 'block';
            
            const duration = toMin(conflict.endTime) - toMin(conflict.startTime);
            const newStart = trip.end;
            const newEnd = toTime(toMin(newStart) + duration);
            wizardEl.querySelector('#generic-start').value = newStart;
            wizardEl.querySelector('#generic-end').value = newEnd;
          };
        });

        const applyBtn = wizardEl.querySelector('#apply-custom');
        if (applyBtn) {
          applyBtn.onclick = () => {
            const start = wizardEl.querySelector('#generic-start').value.trim();
            const end = wizardEl.querySelector('#generic-end').value.trim();

            if (toMin(start) == null || toMin(end) == null || toMin(end) <= toMin(start)) {
              alert("Please enter valid times.");
              return;
            }

            applyTimeWithConflictCheck(trip.division, conflict, conflict.event, start, end, next);
          };
        }
      }
    });
  }

  // ------------------------------------------------------------
  // CONFLICT CHECKING ON PLACEMENT
  // ------------------------------------------------------------
  function applyTimeWithConflictCheck(division, oldBlock, eventName, startTime, endTime, afterResolve, reservedFields = []) {
    // Check for conflicts with this new time WITHIN the division
    const sameDivConflicts = detectConflicts(division, startTime, endTime, oldBlock.id);
    
    // Check for conflicts with other divisions (for Swim)
    let crossDivConflicts = [];
    if (eventName.toLowerCase().includes('swim')) {
      crossDivConflicts = detectCrossDivisionConflicts('Swim', startTime, endTime, division);
    }

    // If there are conflicts, handle them
    if (sameDivConflicts.length > 0) {
      handleSameDivisionConflict(division, eventName, startTime, endTime, oldBlock, sameDivConflicts[0], afterResolve, reservedFields);
    } else if (crossDivConflicts.length > 0) {
      handleCrossDivisionConflict(division, eventName, startTime, endTime, oldBlock, crossDivConflicts[0], afterResolve, reservedFields);
    } else {
      // No conflicts, apply the change
      applyTimeChange(division, oldBlock, eventName, startTime, endTime, afterResolve, reservedFields);
    }
  }

  function handleSameDivisionConflict(division, newActivityName, startTime, endTime, originalBlock, conflictBlock, afterResolve, reservedFields) {
    renderStep({
      title: "Schedule Conflict",
      subtitle: `${newActivityName} at ${startTime}–${endTime} overlaps with "${conflictBlock.event}" (${conflictBlock.startTime}–${conflictBlock.endTime}).`,
      body: `
        <div class="tw-options">
          <button class="tw-option" data-choice="change-new">
            <div class="tw-option-title">Choose Different Time for ${newActivityName}</div>
          </button>

          <button class="tw-option" data-choice="move-existing">
            <div class="tw-option-title">Move ${conflictBlock.event}</div>
            <div class="tw-option-subtitle">Keep ${newActivityName} at ${startTime}</div>
          </button>

          <button class="tw-option secondary" data-choice="remove-existing">
            <div class="tw-option-title">Skip ${conflictBlock.event} Today</div>
          </button>
        </div>

        <div id="move-existing-time" style="display:none;" class="tw-custom-time">
          <div class="tw-form-row">
            <div class="tw-form-section">
              <label class="tw-label">New time for ${conflictBlock.event}</label>
              <input type="text" id="move-start" placeholder="3:00pm" class="tw-input">
            </div>
            <div class="tw-form-section">
              <label class="tw-label">End</label>
              <input type="text" id="move-end" placeholder="4:00pm" class="tw-input">
            </div>
          </div>
          <button id="apply-move" class="tw-btn-primary" style="margin-top:12px;">Apply</button>
        </div>
      `,
      hideNext: true,
      setup: () => {
        wizardEl.querySelectorAll('.tw-option').forEach(btn => {
          btn.onclick = () => {
            const choice = btn.dataset.choice;

            if (choice === 'change-new') {
              // Go back to original handler
              const trip = tripManifest.find(t => t.division === division);
              if (newActivityName.toLowerCase().includes('swim')) {
                handleSwimConflict(trip, originalBlock, afterResolve);
              } else if (newActivityName.toLowerCase().includes('lunch')) {
                handleLunchConflict(trip, originalBlock, afterResolve);
              } else if (newActivityName.toLowerCase().includes('snack')) {
                handleSnackConflict(trip, originalBlock, afterResolve);
              } else {
                handleGenericConflict(trip, originalBlock, afterResolve);
              }
            } else if (choice === 'remove-existing') {
              const removeChange = {
                division: division,
                action: 'remove',
                oldEvent: conflictBlock,
                reason: `Removed to make room for ${newActivityName}`
              };
              plannedChanges.push(removeChange);
              applyChangeToWorkingSkeleton(removeChange);

              applyTimeChange(division, originalBlock, newActivityName, startTime, endTime, afterResolve, reservedFields);
            } else if (choice === 'move-existing') {
              document.getElementById('move-existing-time').style.display = 'block';
            }
          };
        });

        const applyBtn = wizardEl.querySelector('#apply-move');
        if (applyBtn) {
          applyBtn.onclick = () => {
            const moveStart = wizardEl.querySelector('#move-start').value.trim();
            const moveEnd = wizardEl.querySelector('#move-end').value.trim();

            if (toMin(moveStart) == null || toMin(moveEnd) == null || toMin(moveEnd) <= toMin(moveStart)) {
              alert("Please enter valid times.");
              return;
            }

            // Check if THIS move creates more conflicts
            const moreConflicts = detectConflicts(division, moveStart, moveEnd, conflictBlock.id);
            if (moreConflicts.length > 0) {
              alert(`That time conflicts with "${moreConflicts[0].event}". Please choose another time.`);
              return;
            }

            // Apply the move for the existing block
            applyTimeChange(division, conflictBlock, conflictBlock.event, moveStart, moveEnd, () => {
              // Then apply the new activity
              applyTimeChange(division, originalBlock, newActivityName, startTime, endTime, afterResolve, reservedFields);
            });
          };
        }
      }
    });
  }

  function handleCrossDivisionConflict(sourceDivision, newActivityName, startTime, endTime, originalBlock, crossConflict, afterResolve, reservedFields) {
    const targetDivision = crossConflict.division;
    const targetBlock = crossConflict.block;

    renderStep({
      title: "Cross-Division Conflict",
      subtitle: `${targetDivision} already has ${targetBlock.event} at ${startTime}–${endTime}.`,
      body: `
        <div class="tw-info-box">
          The pool can only accommodate one division at a time.
        </div>

        <div class="tw-options">
          <button class="tw-option" data-choice="change-source">
            <div class="tw-option-title">Choose Different Time for ${sourceDivision}</div>
          </button>

          <button class="tw-option" data-choice="move-target">
            <div class="tw-option-title">Move ${targetDivision}'s Swim</div>
            <div class="tw-option-subtitle">Keep ${sourceDivision} at ${startTime}</div>
          </button>

          <button class="tw-option" data-choice="swap">
            <div class="tw-option-title">Swap Times</div>
            <div class="tw-option-subtitle">${sourceDivision} gets ${targetBlock.startTime}, ${targetDivision} gets ${startTime}</div>
          </button>
        </div>

        <div id="move-target-time" style="display:none;" class="tw-custom-time">
          <div class="tw-form-row">
            <div class="tw-form-section">
              <label class="tw-label">New time for ${targetDivision}</label>
              <input type="text" id="target-start" placeholder="10:00am" class="tw-input">
            </div>
            <div class="tw-form-section">
              <label class="tw-label">End</label>
              <input type="text" id="target-end" placeholder="10:45am" class="tw-input">
            </div>
          </div>
          <button id="apply-target-move" class="tw-btn-primary" style="margin-top:12px;">Apply</button>
        </div>
      `,
      hideNext: true,
      setup: () => {
        wizardEl.querySelectorAll('.tw-option').forEach(btn => {
          btn.onclick = () => {
            const choice = btn.dataset.choice;

            if (choice === 'change-source') {
              const trip = tripManifest.find(t => t.division === sourceDivision);
              handleSwimConflict(trip, originalBlock, afterResolve);
            } else if (choice === 'swap') {
              applyTimeChange(sourceDivision, originalBlock, 'Swim', targetBlock.startTime, targetBlock.endTime, () => {}, ['Pool']);
              applyTimeChange(targetDivision, targetBlock, 'Swim', startTime, endTime, afterResolve, ['Pool']);
            } else if (choice === 'move-target') {
              document.getElementById('move-target-time').style.display = 'block';
            }
          };
        });

        const applyBtn = wizardEl.querySelector('#apply-target-move');
        if (applyBtn) {
          applyBtn.onclick = () => {
            const moveStart = wizardEl.querySelector('#target-start').value.trim();
            const moveEnd = wizardEl.querySelector('#target-end').value.trim();

            if (toMin(moveStart) == null || toMin(moveEnd) == null || toMin(moveEnd) <= toMin(moveStart)) {
              alert("Please enter valid times.");
              return;
            }

            // Check for conflicts
            const moreConflicts = detectConflicts(targetDivision, moveStart, moveEnd, targetBlock.id);
            if (moreConflicts.length > 0) {
              alert(`That time conflicts with "${moreConflicts[0].event}" in ${targetDivision}.`);
              return;
            }

            // Apply move for target division
            applyTimeChange(targetDivision, targetBlock, 'Swim', moveStart, moveEnd, () => {
              // Then apply source division's swim
              applyTimeChange(sourceDivision, originalBlock, 'Swim', startTime, endTime, afterResolve, ['Pool']);
            });
          };
        }
      }
    });
  }

  function applyTimeChange(division, oldBlock, eventName, startTime, endTime, next, reservedFields = []) {
    const change = {
      division: division,
      action: 'replace',
      oldEvent: oldBlock,
      type: oldBlock.type || 'pinned',
      event: eventName,
      startTime: startTime,
      endTime: endTime,
      reservedFields: reservedFields
    };
    
    plannedChanges.push(change);
    applyChangeToWorkingSkeleton(change);
    next();
  }

  // ------------------------------------------------------------
  // FINAL PREVIEW
  // ------------------------------------------------------------
  function showFinalPreview() {
    const changesByDivision = {};
    allDivisions.forEach(d => { changesByDivision[d] = []; });
    
    plannedChanges.forEach(change => {
      if (!changesByDivision[change.division]) {
        changesByDivision[change.division] = [];
      }
      changesByDivision[change.division].push(change);
    });

    let previewHtml = '<div class="tw-final-summary">';

    travelingDivisions.forEach(div => {
      const changes = changesByDivision[div];
      previewHtml += `
        <div class="tw-summary-section">
          <div class="tw-summary-header">${div} <span class="tw-badge-trip">Trip Day</span></div>
          <div class="tw-summary-list">
      `;

      if (changes.length === 0) {
        previewHtml += `<div class="tw-summary-item note">Only the trip was added</div>`;
      } else {
        changes.forEach(change => {
          previewHtml += formatChangeSummary(change);
        });
      }

      previewHtml += `</div></div>`;
    });

    const stayingDivs = allDivisions.filter(d => !travelingDivisions.includes(d));
    const affectedStaying = stayingDivs.filter(d => changesByDivision[d].length > 0);
    
    if (affectedStaying.length > 0) {
      affectedStaying.forEach(div => {
        const changes = changesByDivision[div];
        previewHtml += `
          <div class="tw-summary-section">
            <div class="tw-summary-header">${div} <span class="tw-badge-camp">At Camp</span></div>
            <div class="tw-summary-list">
        `;

        changes.forEach(change => {
          previewHtml += formatChangeSummary(change);
        });

        previewHtml += `</div></div>`;
      });
    }

    previewHtml += '</div>';

    renderStep({
      title: "Review Changes",
      subtitle: "Confirm these changes before applying to the schedule.",
      body: previewHtml,
      nextText: "Apply Changes",
      cancelText: "Cancel",
      next: () => {
        applyAllChanges();
      }
    });
  }

  function formatChangeSummary(change) {
    if (change.action === 'add') {
      return `
        <div class="tw-summary-item add">
          <span class="tw-summary-label">Added</span>
          <strong>${change.event}</strong>
          <span class="tw-summary-time">${change.startTime} – ${change.endTime}</span>
        </div>
      `;
    } else if (change.action === 'replace') {
      return `
        <div class="tw-summary-item replace">
          <span class="tw-summary-label">Moved</span>
          <strong>${change.event}</strong>
          <span class="tw-summary-time">${change.startTime} – ${change.endTime}</span>
          <span class="tw-summary-note">Was: ${change.oldEvent.startTime} – ${change.oldEvent.endTime}</span>
        </div>
      `;
    } else if (change.action === 'remove') {
      return `
        <div class="tw-summary-item remove">
          <span class="tw-summary-label">Removed</span>
          <strong>${change.oldEvent.event}</strong>
          <span class="tw-summary-note">${change.reason}</span>
        </div>
      `;
    }
    return '';
  }

  function applyAllChanges() {
    const instructions = {};

    plannedChanges.forEach(change => {
      if (!instructions[change.division]) {
        instructions[change.division] = { division: change.division, actions: [] };
      }

      if (change.action === 'add') {
        instructions[change.division].actions.push({
          type: change.type,
          event: change.event,
          startTime: change.startTime,
          endTime: change.endTime,
          reservedFields: change.reservedFields || []
        });
      } else if (change.action === 'replace') {
        instructions[change.division].actions.push({
          type: 'remove',
          eventId: change.oldEvent.id
        });
        instructions[change.division].actions.push({
          type: change.type,
          event: change.event,
          startTime: change.startTime,
          endTime: change.endTime,
          reservedFields: change.reservedFields || []
        });
      } else if (change.action === 'remove') {
        instructions[change.division].actions.push({
          type: 'remove',
          eventId: change.oldEvent.id
        });
      }
    });

    const instructionArray = Object.values(instructions);
    onComplete?.(instructionArray);
    close();
  }

  // ------------------------------------------------------------
  // UI RENDERING
  // ------------------------------------------------------------
  function renderBase() {
    document.getElementById("tw-overlay")?.remove();

    const overlay = document.createElement("div");
    overlay.id = "tw-overlay";
    overlay.innerHTML = `
      <div class="tw-app">
        <div class="tw-wizard">
          <div class="tw-wizard-header">
            <div class="tw-wizard-title">Trip Planner</div>
            <button id="tw-close" class="tw-btn-close">×</button>
          </div>
          <div id="tw-content" class="tw-wizard-content"></div>
        </div>

        <div class="tw-preview">
          <div class="tw-preview-header">
            <div class="tw-preview-title">Live Schedule</div>
            <div class="tw-preview-subtitle">Updates as you make decisions</div>
          </div>
          <div id="tw-preview-content" class="tw-preview-content"></div>
        </div>
      </div>

      ${getStyles()}
    `;

    document.body.appendChild(overlay);
    wizardEl = document.getElementById("tw-content");
    previewEl = document.getElementById("tw-preview-content");

    document.getElementById("tw-close").onclick = () => {
      if (confirm("Exit trip planner? Progress will be lost.")) {
        close();
      }
    };

    updateLivePreview();
  }

  function renderStep({ title, subtitle, body, next, nextText = "Continue", cancelText, hideNext = false, showSkip = false, onSkip, setup }) {
    let html = `
      <div class="tw-step-header">
        <h2 class="tw-step-title">${title}</h2>
        ${subtitle ? `<p class="tw-step-subtitle">${subtitle}</p>` : ''}
      </div>
      <div class="tw-step-body">${body}</div>
    `;

    if (!hideNext || showSkip || cancelText) {
      html += `<div class="tw-step-footer">`;
      if (showSkip) {
        html += `<button id="tw-skip" class="tw-btn-skip">Skip for Now</button>`;
      }
      if (cancelText) {
        html += `<button id="tw-cancel" class="tw-btn-secondary">${cancelText}</button>`;
      }
      if (!hideNext) {
        html += `<button id="tw-next" class="tw-btn-primary">${nextText}</button>`;
      }
      html += `</div>`;
    }

    wizardEl.innerHTML = html;

    if (!hideNext && next) {
      wizardEl.querySelector('#tw-next')?.addEventListener('click', next);
    }

    if (cancelText) {
      wizardEl.querySelector('#tw-cancel')?.addEventListener('click', close);
    }

    if (showSkip && onSkip) {
      wizardEl.querySelector('#tw-skip')?.addEventListener('click', onSkip);
    }

    if (setup) {
      setup();
    }
  }

  function close() {
    document.getElementById("tw-overlay")?.remove();
  }

  function getStyles() {
    return `
      <style>
        /* Match app design system */
        #tw-overlay {
          position: fixed;
          inset: 0;
          background: rgba(15, 23, 42, 0.7);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 10000;
          padding: 20px;
          backdrop-filter: blur(4px);
        }

        .tw-app {
          display: flex;
          gap: 20px;
          width: 100%;
          max-width: 1400px;
          height: 90vh;
          max-height: 900px;
        }

        /* Wizard Panel */
        .tw-wizard {
          flex: 1;
          background: #ffffff;
          border-radius: 12px;
          border: 1px solid #e5e7eb;
          display: flex;
          flex-direction: column;
          box-shadow: 0 10px 24px rgba(15, 23, 42, 0.06);
        }

        .tw-wizard-header {
          padding: 16px 20px;
          border-bottom: 1px solid #e5e7eb;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .tw-wizard-title {
          font-size: 1.15rem;
          font-weight: 600;
          color: #111827;
        }

        .tw-btn-close {
          width: 32px;
          height: 32px;
          border-radius: 999px;
          border: 1px solid #d1d5db;
          background: #f3f4f6;
          color: #6b7280;
          font-size: 24px;
          line-height: 1;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .tw-btn-close:hover {
          background: #e5e7eb;
          border-color: #9ca3af;
        }

        .tw-wizard-content {
          flex: 1;
          overflow-y: auto;
          padding: 24px;
        }

        /* Preview Panel */
        .tw-preview {
          flex: 1;
          background: #ffffff;
          border-radius: 12px;
          border: 1px solid #e5e7eb;
          display: flex;
          flex-direction: column;
          box-shadow: 0 10px 24px rgba(15, 23, 42, 0.06);
        }

        .tw-preview-header {
          padding: 16px 20px;
          border-bottom: 1px solid #e5e7eb;
          background: #f9fafb;
        }

        .tw-preview-title {
          font-size: 0.95rem;
          font-weight: 600;
          color: #111827;
          margin-bottom: 2px;
        }

        .tw-preview-subtitle {
          font-size: 0.8rem;
          color: #6b7280;
        }

        .tw-preview-content {
          flex: 1;
          overflow-y: auto;
          padding: 16px;
        }

        /* Step Header */
        .tw-step-header {
          margin-bottom: 24px;
        }

        .tw-step-title {
          font-size: 1.4rem;
          font-weight: 600;
          color: #111827;
          margin: 0 0 6px 0;
        }

        .tw-step-subtitle {
          font-size: 0.9rem;
          color: #6b7280;
          margin: 0;
        }

        .tw-step-body {
          margin-bottom: 20px;
        }

        .tw-step-footer {
          display: flex;
          gap: 10px;
          padding-top: 20px;
          border-top: 1px solid #e5e7eb;
        }

        /* Buttons - Match app design */
        .tw-btn-primary {
          flex: 1;
          font-family: inherit;
          font-size: 0.9rem;
          font-weight: 500;
          border-radius: 999px;
          border: 1px solid #2563eb;
          padding: 10px 20px;
          background: #2563eb;
          color: #ffffff;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .tw-btn-primary:hover {
          background: #1d4ed8;
          border-color: #1d4ed8;
          box-shadow: 0 4px 8px rgba(37, 99, 235, 0.25);
          transform: translateY(-0.5px);
        }

        .tw-btn-secondary {
          font-family: inherit;
          font-size: 0.85rem;
          border-radius: 999px;
          border: 1px solid #d1d5db;
          padding: 10px 20px;
          background: #ffffff;
          color: #111827;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .tw-btn-secondary:hover {
          background: #f3f4f6;
          border-color: #9ca3af;
        }

        .tw-btn-skip {
          font-family: inherit;
          font-size: 0.85rem;
          border-radius: 999px;
          border: 1px solid #fbbf24;
          padding: 10px 20px;
          background: #fef3c7;
          color: #92400e;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .tw-btn-skip:hover {
          background: #fde68a;
        }

        /* Form Elements - Match app design */
        .tw-label {
          display: block;
          font-size: 0.85rem;
          font-weight: 500;
          color: #374151;
          margin-bottom: 6px;
        }

        .tw-input {
          font-family: inherit;
          font-size: 0.9rem;
          padding: 10px 14px;
          border-radius: 999px;
          border: 1px solid #d1d5db;
          background: #ffffff;
          color: #111827;
          width: 100%;
          box-sizing: border-box;
          transition: all 0.15s ease;
        }

        .tw-input:focus {
          outline: none;
          border-color: #2563eb;
          box-shadow: 0 0 0 1px rgba(37, 99, 235, 0.35);
        }

        .tw-form-section {
          margin-bottom: 16px;
        }

        .tw-form-row {
          display: flex;
          gap: 12px;
        }

        .tw-form-row .tw-form-section {
          flex: 1;
          margin-bottom: 0;
        }

        /* Checkbox Group */
        .tw-checkbox-group {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .tw-checkbox-item {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 12px 16px;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .tw-checkbox-item:hover {
          background: #f9fafb;
          border-color: #2563eb;
        }

        .tw-checkbox-item input {
          width: 18px;
          height: 18px;
          cursor: pointer;
        }

        .tw-checkbox-item span {
          font-size: 0.95rem;
          color: #111827;
          font-weight: 500;
        }

        /* Options */
        .tw-options {
          display: flex;
          flex-direction: column;
          gap: 10px;
          margin-bottom: 16px;
        }

        .tw-option {
          width: 100%;
          text-align: left;
          padding: 14px 16px;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          background: #ffffff;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .tw-option:hover {
          background: #f9fafb;
          border-color: #2563eb;
          box-shadow: 0 4px 8px rgba(37, 99, 235, 0.08);
          transform: translateY(-0.5px);
        }

        .tw-option.secondary {
          background: #fafafa;
        }

        .tw-option-title {
          font-size: 0.95rem;
          font-weight: 500;
          color: #111827;
          margin-bottom: 2px;
        }

        .tw-option-subtitle {
          font-size: 0.8rem;
          color: #6b7280;
        }

        .tw-custom-time {
          padding: 16px;
          background: #f9fafb;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          margin-top: 12px;
        }

        .tw-info-box {
          padding: 12px 16px;
          background: #eff6ff;
          border: 1px solid #bfdbfe;
          border-radius: 8px;
          color: #1e40af;
          font-size: 0.9rem;
          margin-bottom: 16px;
        }

        /* Schedule Preview */
        .tw-schedule-division {
          background: #ffffff;
          border: 1px solid #e5e7eb;
          border-radius: 10px;
          margin-bottom: 12px;
          overflow: hidden;
        }

        .tw-schedule-division.traveling {
          border-color: #fbbf24;
          box-shadow: 0 0 0 1px #fef3c7;
        }

        .tw-schedule-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 16px;
          background: #f9fafb;
          border-bottom: 1px solid #e5e7eb;
        }

        .tw-schedule-title {
          font-size: 0.95rem;
          font-weight: 600;
          color: #111827;
        }

        .tw-badge-trip {
          padding: 3px 10px;
          background: #fef3c7;
          color: #92400e;
          border-radius: 999px;
          font-size: 0.7rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.02em;
        }

        .tw-badge-camp {
          padding: 3px 10px;
          background: #e5e7eb;
          color: #4b5563;
          border-radius: 999px;
          font-size: 0.7rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.02em;
        }

        .tw-schedule-timeline {
          padding: 12px;
        }

        .tw-schedule-empty {
          padding: 20px;
          text-align: center;
          color: #9ca3af;
          font-size: 0.85rem;
          font-style: italic;
        }

        .tw-timeline-item {
          display: flex;
          gap: 12px;
          padding: 10px 12px;
          border-radius: 6px;
          margin-bottom: 6px;
          background: #f9fafb;
          border: 1px solid #e5e7eb;
        }

        .tw-timeline-item.new {
          background: #d1fae5;
          border-color: #34d399;
        }

        .tw-timeline-time {
          font-size: 0.75rem;
          font-weight: 600;
          color: #6b7280;
          text-align: right;
          min-width: 50px;
          padding-top: 2px;
        }

        .tw-timeline-content {
          flex: 1;
          min-width: 0;
        }

        .tw-timeline-title {
          font-size: 0.9rem;
          font-weight: 500;
          color: #111827;
          margin-bottom: 2px;
        }

        .tw-timeline-duration {
          font-size: 0.75rem;
          color: #6b7280;
        }

        .tw-timeline-badge {
          align-self: flex-start;
          padding: 2px 8px;
          background: #10b981;
          color: white;
          border-radius: 999px;
          font-size: 0.65rem;
          font-weight: 600;
          text-transform: uppercase;
        }

        /* Final Summary */
        .tw-final-summary {
          max-height: 500px;
          overflow-y: auto;
        }

        .tw-summary-section {
          margin-bottom: 20px;
        }

        .tw-summary-header {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 1rem;
          font-weight: 600;
          color: #111827;
          margin-bottom: 12px;
          padding-bottom: 8px;
          border-bottom: 1px solid #e5e7eb;
        }

        .tw-summary-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .tw-summary-item {
          padding: 12px 14px;
          border-radius: 6px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .tw-summary-item.add {
          background: #d1fae5;
          border-left: 3px solid #10b981;
        }

        .tw-summary-item.replace {
          background: #dbeafe;
          border-left: 3px solid #3b82f6;
        }

        .tw-summary-item.remove {
          background: #fee2e2;
          border-left: 3px solid #ef4444;
        }

        .tw-summary-item.note {
          background: #fef3c7;
          border-left: 3px solid #f59e0b;
        }

        .tw-summary-label {
          font-size: 0.7rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.03em;
          color: #6b7280;
        }

        .tw-summary-item strong {
          font-size: 0.95rem;
          color: #111827;
        }

        .tw-summary-time {
          font-size: 0.85rem;
          color: #4b5563;
        }

        .tw-summary-note {
          font-size: 0.8rem;
          color: #6b7280;
        }
      </style>
    `;
  }

})();
