// =================================================================
// trip_wizard.js — COMPREHENSIVE TRIP PLANNER WITH LIVE SCHEDULE
// Features: Live preview, cascade handling, skip questions, visual guidance
// =================================================================

(function () {
  'use strict';

  // ------------------------------------------------------------
  // STATE
  // ------------------------------------------------------------
  let tripManifest = [];
  let plannedChanges = [];
  let fullDaySkeleton = {}; // Organized by division
  let workingSkeleton = {}; // Live working copy with changes applied
  let pendingQuestions = []; // Questions that were skipped
  let onComplete = null;
  let wizardEl = null;
  let previewEl = null;
  let allDivisions = [];
  let travelingDivisions = [];
  let currentQuestionId = null;

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
      currentQuestionId = null;

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

    let html = '<div class="tw-live-schedule">';

    // Show divisions in order: traveling first, then staying
    const divisionsToShow = [...travelingDivisions, ...allDivisions.filter(d => !travelingDivisions.includes(d))];

    divisionsToShow.forEach(div => {
      const isTraveling = travelingDivisions.includes(div);
      const blocks = workingSkeleton[div] || [];
      
      // Sort by time
      const sorted = blocks.slice().sort((a, b) => {
        const aMin = toMin(a.startTime);
        const bMin = toMin(b.startTime);
        return (aMin || 0) - (bMin || 0);
      });

      html += `
        <div class="tw-schedule-division ${isTraveling ? 'tw-traveling' : ''}">
          <div class="tw-schedule-div-header">
            ${isTraveling ? '🚌' : '📍'} ${div}
            ${isTraveling ? '<span class="tw-badge">On Trip</span>' : ''}
          </div>
          <div class="tw-schedule-blocks">
      `;

      if (sorted.length === 0) {
        html += `<div class="tw-schedule-empty">No activities scheduled</div>`;
      }

      sorted.forEach(block => {
        const isNew = block.isNew || false;
        const isOriginal = !isNew;
        const blockClass = isNew ? 'tw-block-new' : 'tw-block-original';
        
        let icon = '📌';
        if (block.event?.includes('TRIP')) icon = '🚌';
        else if (block.event?.includes('Lunch')) icon = '🍽️';
        else if (block.event?.includes('Swim')) icon = '🏊';
        else if (block.event?.includes('Snack')) icon = '🍎';
        else if (block.event?.includes('League')) icon = '🏆';

        html += `
          <div class="${blockClass}">
            <div class="tw-block-icon">${icon}</div>
            <div class="tw-block-content">
              <strong>${block.event}</strong>
              <span class="tw-block-time">${block.startTime} – ${block.endTime}</span>
            </div>
            ${isNew ? '<span class="tw-block-badge">NEW</span>' : ''}
          </div>
        `;
      });

      html += `</div></div>`;
    });

    html += '</div>';
    previewEl.innerHTML = html;
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
        // Check for same activity type (e.g., Swim)
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
      title: "📍 Plan a Trip",
      text: "Which divisions are going on the trip?",
      body: allDivisions.map(d => `
        <label class="tw-check">
          <input type="checkbox" value="${d}"> 
          <span class="tw-check-label">${d}</span>
        </label>
      `).join(""),
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
      title: "🚌 Trip Details",
      text: "Where are they going and when?",
      body: `
        <div class="tw-form-group">
          <label>Destination</label>
          <input id="tw-dest" placeholder="e.g., Zoo, Museum, Water Park" class="tw-input">
        </div>

        <div class="tw-time-row">
          <div class="tw-form-group">
            <label>Leave Camp</label>
            <input id="tw-start" placeholder="10:00am" class="tw-input">
          </div>

          <div class="tw-form-group">
            <label>Return to Camp</label>
            <input id="tw-end" placeholder="2:30pm" class="tw-input">
          </div>
        </div>

        <div class="tw-help-text">
          💡 I'll guide you through any schedule conflicts and help coordinate with other divisions.
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
          alert("Please enter valid times using format like '10:00am' or '2:30pm'.");
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

        // Add trip blocks to working skeleton
        tripManifest.forEach(t => {
          const change = {
            division: t.division,
            action: 'add',
            type: 'pinned',
            event: `🚌 TRIP: ${t.destination}`,
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
      // Done with traveling divisions, check for pending questions
      handlePendingQuestions();
      return;
    }

    const trip = tripManifest[index];
    const originalBlocks = fullDaySkeleton[trip.division] || [];
    
    // Find conflicts with the trip time
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
    const questionId = `${trip.division}_${conflict.id}`;
    currentQuestionId = questionId;

    // Route to specific handlers
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
      title: `${trip.division} — 🍽️ Lunch`,
      text: `Lunch is scheduled during the trip (${conflict.startTime}–${conflict.endTime}). Let's find a better time.`,
      body: `
        <div class="tw-suggestion-group">
          <div class="tw-suggestion-card" data-choice="before">
            <div class="tw-suggestion-icon">⏰</div>
            <div class="tw-suggestion-content">
              <strong>Early Lunch (Before Trip)</strong>
              <p>Eat at ${suggestedBefore} - ${trip.start}</p>
              <span class="tw-suggestion-note">Recommended: Gives time to settle before leaving</span>
            </div>
          </div>

          <div class="tw-suggestion-card" data-choice="during">
            <div class="tw-suggestion-icon">🎒</div>
            <div class="tw-suggestion-content">
              <strong>Lunch During Trip</strong>
              <p>Pack lunch or eat at destination</p>
              <span class="tw-suggestion-note">No schedule change needed</span>
            </div>
          </div>

          <div class="tw-suggestion-card" data-choice="after">
            <div class="tw-suggestion-icon">🍔</div>
            <div class="tw-suggestion-content">
              <strong>Late Lunch (After Return)</strong>
              <p>Eat at ${suggestedAfter} - ${addMinutes(suggestedAfter, 30)}</p>
              <span class="tw-suggestion-note">Kids might be hungry - bring snacks</span>
            </div>
          </div>

          <div class="tw-suggestion-card" data-choice="custom">
            <div class="tw-suggestion-icon">✏️</div>
            <div class="tw-suggestion-content">
              <strong>Custom Time</strong>
              <p>I'll choose my own time</p>
            </div>
          </div>
        </div>

        <div id="custom-time-input" style="display:none;">
          <div class="tw-time-row">
            <div class="tw-form-group">
              <label>Lunch Start</label>
              <input id="lunch-start" placeholder="11:00am" class="tw-input">
            </div>
            <div class="tw-form-group">
              <label>Lunch End</label>
              <input id="lunch-end" placeholder="11:30am" class="tw-input">
            </div>
          </div>
        </div>
      `,
      hideNext: true,
      showSkip: true,
      onSkip: () => {
        pendingQuestions.push({
          title: `Skipped: ${trip.division} Lunch`,
          handler: () => handleLunchConflict(trip, conflict, next)
        });
        next();
      },
      setup: () => {
        wizardEl.querySelectorAll('.tw-suggestion-card').forEach(card => {
          card.onclick = () => {
            const choice = card.dataset.choice;

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
              document.getElementById('custom-time-input').style.display = 'block';
              showContinueButton();
              return;
            }

            // Before or After
            let start, end;
            if (choice === 'before') {
              start = suggestedBefore;
              end = trip.start;
            } else {
              start = suggestedAfter;
              end = addMinutes(suggestedAfter, 30);
            }

            applyTimeChange(trip.division, conflict, 'Lunch', start, end, next);
          };
        });

        function showContinueButton() {
          const continueBtn = document.createElement('button');
          continueBtn.textContent = 'Apply Custom Time';
          continueBtn.className = 'tw-btn tw-btn-primary';
          continueBtn.style.marginTop = '15px';
          continueBtn.onclick = () => {
            const start = wizardEl.querySelector('#lunch-start').value.trim();
            const end = wizardEl.querySelector('#lunch-end').value.trim();

            if (toMin(start) == null || toMin(end) == null || toMin(end) <= toMin(start)) {
              alert("Please enter valid times.");
              return;
            }

            applyTimeChange(trip.division, conflict, 'Lunch', start, end, next);
          };
          const customDiv = document.getElementById('custom-time-input');
          if (!customDiv.querySelector('.tw-btn-primary')) {
            customDiv.appendChild(continueBtn);
          }
        }
      }
    });
  }

  function handleSwimConflict(trip, conflict, next) {
    const suggestedStart = trip.end;
    const suggestedEnd = addMinutes(trip.end, 45);

    // Check cross-division conflicts
    const crossConflicts = detectCrossDivisionConflicts('Swim', suggestedStart, suggestedEnd, trip.division);

    renderStep({
      title: `${trip.division} — 🏊 Swim`,
      text: `Swim is scheduled during the trip (${conflict.startTime}–${conflict.endTime}). When should they swim instead?`,
      body: `
        <div class="tw-suggestion-group">
          <div class="tw-suggestion-card" data-choice="suggested">
            <div class="tw-suggestion-icon">⭐</div>
            <div class="tw-suggestion-content">
              <strong>Right After Trip</strong>
              <p>${suggestedStart} - ${suggestedEnd}</p>
              <span class="tw-suggestion-note">✓ Recommended: Frees pool earlier for other divisions</span>
              ${crossConflicts.length > 0 ? `
                <div class="tw-warning-inline">
                  ⚠️ ${crossConflicts[0].division} has swim at this time
                </div>
              ` : ''}
            </div>
          </div>

          <div class="tw-suggestion-card" data-choice="morning">
            <div class="tw-suggestion-icon">🌅</div>
            <div class="tw-suggestion-content">
              <strong>Morning Swim</strong>
              <p>Move to earlier in the day</p>
              <span class="tw-suggestion-note">I'll help you pick a time</span>
            </div>
          </div>

          <div class="tw-suggestion-card" data-choice="custom">
            <div class="tw-suggestion-icon">✏️</div>
            <div class="tw-suggestion-content">
              <strong>Custom Time</strong>
              <p>I'll choose my own time</p>
            </div>
          </div>

          <div class="tw-suggestion-card tw-suggestion-card-muted" data-choice="skip">
            <div class="tw-suggestion-icon">❌</div>
            <div class="tw-suggestion-content">
              <strong>Skip Swim Today</strong>
              <p>No swim for ${trip.division}</p>
            </div>
          </div>
        </div>

        <div id="custom-time-input" style="display:none;">
          <div class="tw-time-row">
            <div class="tw-form-group">
              <label>Swim Start</label>
              <input id="swim-start" placeholder="2:00pm" class="tw-input">
            </div>
            <div class="tw-form-group">
              <label>Swim End</label>
              <input id="swim-end" placeholder="2:45pm" class="tw-input">
            </div>
          </div>
        </div>
      `,
      hideNext: true,
      showSkip: true,
      onSkip: () => {
        pendingQuestions.push({
          title: `Skipped: ${trip.division} Swim`,
          handler: () => handleSwimConflict(trip, conflict, next)
        });
        next();
      },
      setup: () => {
        wizardEl.querySelectorAll('.tw-suggestion-card').forEach(card => {
          card.onclick = () => {
            const choice = card.dataset.choice;

            if (choice === 'skip') {
              const change = {
                division: trip.division,
                action: 'remove',
                oldEvent: conflict,
                reason: 'Skipped for trip day'
              };
              plannedChanges.push(change);
              applyChangeToWorkingSkeleton(change);
              next();
              return;
            }

            if (choice === 'suggested') {
              // Check if this creates cross-division conflict
              if (crossConflicts.length > 0) {
                handleCrossDivisionSwimConflict(trip.division, suggestedStart, suggestedEnd, crossConflicts, conflict, next);
              } else {
                applyTimeChange(trip.division, conflict, 'Swim', suggestedStart, suggestedEnd, next, ['Pool']);
              }
              return;
            }

            if (choice === 'custom' || choice === 'morning') {
              document.getElementById('custom-time-input').style.display = 'block';
              if (choice === 'morning') {
                wizardEl.querySelector('#swim-start').value = '9:00am';
                wizardEl.querySelector('#swim-end').value = '9:45am';
              }
              showContinueButton();
              return;
            }
          };
        });

        function showContinueButton() {
          const continueBtn = document.createElement('button');
          continueBtn.textContent = 'Apply Time';
          continueBtn.className = 'tw-btn tw-btn-primary';
          continueBtn.style.marginTop = '15px';
          continueBtn.onclick = () => {
            const start = wizardEl.querySelector('#swim-start').value.trim();
            const end = wizardEl.querySelector('#swim-end').value.trim();

            if (toMin(start) == null || toMin(end) == null || toMin(end) <= toMin(start)) {
              alert("Please enter valid times.");
              return;
            }

            // Check for conflicts with this new time
            const newConflicts = detectConflicts(trip.division, start, end, conflict.id);
            if (newConflicts.length > 0) {
              handleNewPlacementConflict(trip.division, 'Swim', start, end, conflict, newConflicts, next, ['Pool']);
            } else {
              const crossConflicts = detectCrossDivisionConflicts('Swim', start, end, trip.division);
              if (crossConflicts.length > 0) {
                handleCrossDivisionSwimConflict(trip.division, start, end, crossConflicts, conflict, next);
              } else {
                applyTimeChange(trip.division, conflict, 'Swim', start, end, next, ['Pool']);
              }
            }
          };
          const customDiv = document.getElementById('custom-time-input');
          if (!customDiv.querySelector('.tw-btn-primary')) {
            customDiv.appendChild(continueBtn);
          }
        }
      }
    });
  }

  function handleSnackConflict(trip, conflict, next) {
    renderStep({
      title: `${trip.division} — 🍎 Snack`,
      text: `Snack time (${conflict.startTime}–${conflict.endTime}) is during the trip.`,
      body: `
        <div class="tw-suggestion-group">
          <div class="tw-suggestion-card" data-choice="pack">
            <div class="tw-suggestion-icon">🎒</div>
            <div class="tw-suggestion-content">
              <strong>Pack Snacks for Trip</strong>
              <p>Bring snacks on the bus</p>
              <span class="tw-suggestion-note">Recommended for trips</span>
            </div>
          </div>

          <div class="tw-suggestion-card" data-choice="before">
            <div class="tw-suggestion-icon">⏰</div>
            <div class="tw-suggestion-content">
              <strong>Snack Before Trip</strong>
              <p>Quick snack before leaving</p>
            </div>
          </div>

          <div class="tw-suggestion-card" data-choice="after">
            <div class="tw-suggestion-icon">🍪</div>
            <div class="tw-suggestion-content">
              <strong>Snack After Return</strong>
              <p>Snack when they get back</p>
            </div>
          </div>

          <div class="tw-suggestion-card tw-suggestion-card-muted" data-choice="skip">
            <div class="tw-suggestion-icon">❌</div>
            <div class="tw-suggestion-content">
              <strong>Skip Snack</strong>
              <p>No snack today</p>
            </div>
          </div>
        </div>

        <div id="custom-time-input" style="display:none;">
          <div class="tw-time-row">
            <div class="tw-form-group">
              <label>Snack Start</label>
              <input id="snack-start" placeholder="2:00pm" class="tw-input">
            </div>
            <div class="tw-form-group">
              <label>Snack End</label>
              <input id="snack-end" placeholder="2:15pm" class="tw-input">
            </div>
          </div>
        </div>
      `,
      hideNext: true,
      showSkip: true,
      onSkip: () => {
        pendingQuestions.push({
          title: `Skipped: ${trip.division} Snack`,
          handler: () => handleSnackConflict(trip, conflict, next)
        });
        next();
      },
      setup: () => {
        wizardEl.querySelectorAll('.tw-suggestion-card').forEach(card => {
          card.onclick = () => {
            const choice = card.dataset.choice;

            if (choice === 'pack' || choice === 'skip') {
              const change = {
                division: trip.division,
                action: 'remove',
                oldEvent: conflict,
                reason: choice === 'pack' ? 'Packing snacks for trip' : 'Skipped'
              };
              plannedChanges.push(change);
              applyChangeToWorkingSkeleton(change);
              next();
              return;
            }

            document.getElementById('custom-time-input').style.display = 'block';
            
            if (choice === 'before') {
              const suggested = addMinutes(trip.start, -15);
              wizardEl.querySelector('#snack-start').value = suggested;
              wizardEl.querySelector('#snack-end').value = trip.start;
            } else if (choice === 'after') {
              wizardEl.querySelector('#snack-start').value = trip.end;
              wizardEl.querySelector('#snack-end').value = addMinutes(trip.end, 15);
            }

            showContinueButton();
          };
        });

        function showContinueButton() {
          const continueBtn = document.createElement('button');
          continueBtn.textContent = 'Apply Time';
          continueBtn.className = 'tw-btn tw-btn-primary';
          continueBtn.style.marginTop = '15px';
          continueBtn.onclick = () => {
            const start = wizardEl.querySelector('#snack-start').value.trim();
            const end = wizardEl.querySelector('#snack-end').value.trim();

            if (toMin(start) == null || toMin(end) == null || toMin(end) <= toMin(start)) {
              alert("Please enter valid times.");
              return;
            }

            const newConflicts = detectConflicts(trip.division, start, end, conflict.id);
            if (newConflicts.length > 0) {
              handleNewPlacementConflict(trip.division, 'Snacks', start, end, conflict, newConflicts, next);
            } else {
              applyTimeChange(trip.division, conflict, 'Snacks', start, end, next);
            }
          };
          const customDiv = document.getElementById('custom-time-input');
          if (!customDiv.querySelector('.tw-btn-primary')) {
            customDiv.appendChild(continueBtn);
          }
        }
      }
    });
  }

  function handleLeagueConflict(trip, conflict, next) {
    const isSpecialty = (conflict.event || "").toLowerCase().includes('specialty');
    const leagueType = isSpecialty ? 'Specialty League' : 'League Game';

    renderStep({
      title: `${trip.division} — 🏆 ${leagueType}`,
      text: `${trip.division} has a ${leagueType.toLowerCase()} during the trip (${conflict.startTime}–${conflict.endTime}). What would you like to do?`,
      body: `
        <div class="tw-info-box">
          <strong>About This Game:</strong>
          <p>The opposing team(s) will also be affected by this decision.</p>
        </div>

        <div class="tw-suggestion-group">
          <div class="tw-suggestion-card" data-choice="reschedule">
            <div class="tw-suggestion-icon">📅</div>
            <div class="tw-suggestion-content">
              <strong>Reschedule for Another Day</strong>
              <p>Mark this game to be rescheduled</p>
              <span class="tw-suggestion-note">You'll coordinate with other teams later</span>
            </div>
          </div>

          <div class="tw-suggestion-card" data-choice="earlier">
            <div class="tw-suggestion-icon">⏰</div>
            <div class="tw-suggestion-content">
              <strong>Move Earlier Today</strong>
              <p>Try to fit the game before the trip</p>
              <span class="tw-suggestion-note">I'll help find a time</span>
            </div>
          </div>

          <div class="tw-suggestion-card" data-choice="later">
            <div class="tw-suggestion-icon">🕒</div>
            <div class="tw-suggestion-content">
              <strong>Move Later Today</strong>
              <p>Play after returning from trip</p>
              <span class="tw-suggestion-note">I'll help find a time</span>
            </div>
          </div>

          <div class="tw-suggestion-card tw-suggestion-card-muted" data-choice="cancel">
            <div class="tw-suggestion-icon">❌</div>
            <div class="tw-suggestion-content">
              <strong>Cancel This Game</strong>
              <p>Game won't be played this season</p>
            </div>
          </div>
        </div>

        <div id="custom-time-input" style="display:none;">
          <div class="tw-time-row">
            <div class="tw-form-group">
              <label>Game Start</label>
              <input id="league-start" placeholder="2:00pm" class="tw-input">
            </div>
            <div class="tw-form-group">
              <label>Game End</label>
              <input id="league-end" placeholder="3:00pm" class="tw-input">
            </div>
          </div>
        </div>
      `,
      hideNext: true,
      showSkip: true,
      onSkip: () => {
        pendingQuestions.push({
          title: `Skipped: ${trip.division} ${leagueType}`,
          handler: () => handleLeagueConflict(trip, conflict, next)
        });
        next();
      },
      setup: () => {
        wizardEl.querySelectorAll('.tw-suggestion-card').forEach(card => {
          card.onclick = () => {
            const choice = card.dataset.choice;

            if (choice === 'reschedule' || choice === 'cancel') {
              const change = {
                division: trip.division,
                action: 'remove',
                oldEvent: conflict,
                reason: choice === 'reschedule' 
                  ? `${leagueType} to be rescheduled for another day`
                  : `${leagueType} cancelled`
              };
              plannedChanges.push(change);
              applyChangeToWorkingSkeleton(change);
              next();
              return;
            }

            document.getElementById('custom-time-input').style.display = 'block';
            
            if (choice === 'earlier') {
              const duration = toMin(conflict.endTime) - toMin(conflict.startTime);
              const newEnd = trip.start;
              const newStart = toTime(toMin(newEnd) - duration);
              wizardEl.querySelector('#league-start').value = newStart;
              wizardEl.querySelector('#league-end').value = newEnd;
            } else if (choice === 'later') {
              const duration = toMin(conflict.endTime) - toMin(conflict.startTime);
              const newStart = trip.end;
              const newEnd = toTime(toMin(newStart) + duration);
              wizardEl.querySelector('#league-start').value = newStart;
              wizardEl.querySelector('#league-end').value = newEnd;
            }

            showContinueButton();
          };
        });

        function showContinueButton() {
          const continueBtn = document.createElement('button');
          continueBtn.textContent = 'Apply Time';
          continueBtn.className = 'tw-btn tw-btn-primary';
          continueBtn.style.marginTop = '15px';
          continueBtn.onclick = () => {
            const start = wizardEl.querySelector('#league-start').value.trim();
            const end = wizardEl.querySelector('#league-end').value.trim();

            if (toMin(start) == null || toMin(end) == null || toMin(end) <= toMin(start)) {
              alert("Please enter valid times.");
              return;
            }

            const newConflicts = detectConflicts(trip.division, start, end, conflict.id);
            if (newConflicts.length > 0) {
              handleNewPlacementConflict(trip.division, conflict.event, start, end, conflict, newConflicts, next);
            } else {
              applyTimeChange(trip.division, conflict, conflict.event, start, end, next);
            }
          };
          const customDiv = document.getElementById('custom-time-input');
          if (!customDiv.querySelector('.tw-btn-primary')) {
            customDiv.appendChild(continueBtn);
          }
        }
      }
    });
  }

  function handleGenericConflict(trip, conflict, next) {
    renderStep({
      title: `${trip.division} — ${conflict.event}`,
      text: `"${conflict.event}" (${conflict.startTime}–${conflict.endTime}) overlaps with the trip. What would you like to do?`,
      body: `
        <div class="tw-suggestion-group">
          <div class="tw-suggestion-card" data-choice="skip">
            <div class="tw-suggestion-icon">❌</div>
            <div class="tw-suggestion-content">
              <strong>Skip for Today</strong>
              <p>This activity won't happen</p>
              <span class="tw-suggestion-note">Can be rescheduled another day</span>
            </div>
          </div>

          <div class="tw-suggestion-card" data-choice="reschedule">
            <div class="tw-suggestion-icon">🔄</div>
            <div class="tw-suggestion-content">
              <strong>Reschedule for Today</strong>
              <p>Find a different time today</p>
              <span class="tw-suggestion-note">I'll help you pick a time</span>
            </div>
          </div>
        </div>

        <div id="custom-time-input" style="display:none;">
          <div class="tw-time-row">
            <div class="tw-form-group">
              <label>New Start Time</label>
              <input id="generic-start" placeholder="2:00pm" class="tw-input">
            </div>
            <div class="tw-form-group">
              <label>New End Time</label>
              <input id="generic-end" placeholder="3:00pm" class="tw-input">
            </div>
          </div>
        </div>
      `,
      hideNext: true,
      showSkip: true,
      onSkip: () => {
        pendingQuestions.push({
          title: `Skipped: ${trip.division} ${conflict.event}`,
          handler: () => handleGenericConflict(trip, conflict, next)
        });
        next();
      },
      setup: () => {
        wizardEl.querySelectorAll('.tw-suggestion-card').forEach(card => {
          card.onclick = () => {
            const choice = card.dataset.choice;

            if (choice === 'skip') {
              const change = {
                division: trip.division,
                action: 'remove',
                oldEvent: conflict,
                reason: 'Skipped for trip day'
              };
              plannedChanges.push(change);
              applyChangeToWorkingSkeleton(change);
              next();
              return;
            }

            document.getElementById('custom-time-input').style.display = 'block';
            
            // Suggest after trip
            const duration = toMin(conflict.endTime) - toMin(conflict.startTime);
            const newStart = trip.end;
            const newEnd = toTime(toMin(newStart) + duration);
            wizardEl.querySelector('#generic-start').value = newStart;
            wizardEl.querySelector('#generic-end').value = newEnd;

            showContinueButton();
          };
        });

        function showContinueButton() {
          const continueBtn = document.createElement('button');
          continueBtn.textContent = 'Apply Time';
          continueBtn.className = 'tw-btn tw-btn-primary';
          continueBtn.style.marginTop = '15px';
          continueBtn.onclick = () => {
            const start = wizardEl.querySelector('#generic-start').value.trim();
            const end = wizardEl.querySelector('#generic-end').value.trim();

            if (toMin(start) == null || toMin(end) == null || toMin(end) <= toMin(start)) {
              alert("Please enter valid times.");
              return;
            }

            const newConflicts = detectConflicts(trip.division, start, end, conflict.id);
            if (newConflicts.length > 0) {
              handleNewPlacementConflict(trip.division, conflict.event, start, end, conflict, newConflicts, next);
            } else {
              applyTimeChange(trip.division, conflict, conflict.event, start, end, next);
            }
          };
          const customDiv = document.getElementById('custom-time-input');
          if (!customDiv.querySelector('.tw-btn-primary')) {
            customDiv.appendChild(continueBtn);
          }
        }
      }
    });
  }

  // ------------------------------------------------------------
  // CASCADE CONFLICT HANDLERS
  // ------------------------------------------------------------

  function handleNewPlacementConflict(division, activityName, startTime, endTime, originalConflict, newConflicts, afterResolve, reservedFields = []) {
    const conflictBlock = newConflicts[0];

    renderStep({
      title: `⚠️ Schedule Conflict Detected`,
      text: `Placing ${activityName} at ${startTime}–${endTime} would overlap with "${conflictBlock.event}" (${conflictBlock.startTime}–${conflictBlock.endTime}).`,
      body: `
        <div class="tw-warning-box">
          <strong>What would you like to do?</strong>
        </div>

        <div class="tw-suggestion-group">
          <div class="tw-suggestion-card" data-choice="move-new">
            <div class="tw-suggestion-icon">↩️</div>
            <div class="tw-suggestion-content">
              <strong>Choose Different Time for ${activityName}</strong>
              <p>Go back and pick a different time</p>
            </div>
          </div>

          <div class="tw-suggestion-card" data-choice="move-existing">
            <div class="tw-suggestion-icon">🔄</div>
            <div class="tw-suggestion-content">
              <strong>Move ${conflictBlock.event}</strong>
              <p>Keep ${activityName} at ${startTime}, move ${conflictBlock.event} elsewhere</p>
            </div>
          </div>

          <div class="tw-suggestion-card tw-suggestion-card-muted" data-choice="remove-existing">
            <div class="tw-suggestion-icon">❌</div>
            <div class="tw-suggestion-content">
              <strong>Skip ${conflictBlock.event} Today</strong>
              <p>Remove it to make room for ${activityName}</p>
            </div>
          </div>
        </div>
      `,
      hideNext: true,
      setup: () => {
        wizardEl.querySelectorAll('.tw-suggestion-card').forEach(card => {
          card.onclick = () => {
            const choice = card.dataset.choice;

            if (choice === 'move-new') {
              // Go back to original handler
              if (activityName.toLowerCase().includes('swim')) {
                const trip = tripManifest.find(t => t.division === division);
                handleSwimConflict(trip, originalConflict, afterResolve);
              } else if (activityName.toLowerCase().includes('lunch')) {
                const trip = tripManifest.find(t => t.division === division);
                handleLunchConflict(trip, originalConflict, afterResolve);
              } else if (activityName.toLowerCase().includes('snack')) {
                const trip = tripManifest.find(t => t.division === division);
                handleSnackConflict(trip, originalConflict, afterResolve);
              } else {
                const trip = tripManifest.find(t => t.division === division);
                handleGenericConflict(trip, originalConflict, afterResolve);
              }
            } else if (choice === 'remove-existing') {
              // Remove the conflicting block
              const removeChange = {
                division: division,
                action: 'remove',
                oldEvent: conflictBlock,
                reason: `Removed to make room for ${activityName}`
              };
              plannedChanges.push(removeChange);
              applyChangeToWorkingSkeleton(removeChange);

              // Now apply the new time
              applyTimeChange(division, originalConflict, activityName, startTime, endTime, afterResolve, reservedFields);
            } else if (choice === 'move-existing') {
              // Prompt to move the existing block
              promptMoveExistingBlock(division, conflictBlock, () => {
                // After moving the existing block, apply new time
                applyTimeChange(division, originalConflict, activityName, startTime, endTime, afterResolve, reservedFields);
              });
            }
          };
        });
      }
    });
  }

  function promptMoveExistingBlock(division, block, afterMove) {
    renderStep({
      title: `Move ${block.event}`,
      text: `Where should we move "${block.event}" (originally ${block.startTime}–${block.endTime})?`,
      body: `
        <div class="tw-time-row">
          <div class="tw-form-group">
            <label>New Start Time</label>
            <input id="move-start" placeholder="3:00pm" class="tw-input">
          </div>
          <div class="tw-form-group">
            <label>New End Time</label>
            <input id="move-end" placeholder="4:00pm" class="tw-input">
          </div>
        </div>
      `,
      next: () => {
        const start = wizardEl.querySelector('#move-start').value.trim();
        const end = wizardEl.querySelector('#move-end').value.trim();

        if (toMin(start) == null || toMin(end) == null || toMin(end) <= toMin(start)) {
          alert("Please enter valid times.");
          return;
        }

        // Check if this new time creates more conflicts
        const moreConflicts = detectConflicts(division, start, end, block.id);
        if (moreConflicts.length > 0) {
          alert(`That time also conflicts with "${moreConflicts[0].event}". Please choose another time.`);
          return;
        }

        // Apply the move
        applyTimeChange(division, block, block.event, start, end, afterMove);
      }
    });
  }

  function handleCrossDivisionSwimConflict(sourceDivision, startTime, endTime, crossConflicts, originalConflict, afterResolve) {
    const targetDivision = crossConflicts[0].division;
    const targetBlock = crossConflicts[0].block;

    renderStep({
      title: `⚠️ Pool Conflict with ${targetDivision}`,
      text: `${targetDivision} already has swim at ${startTime}–${endTime}. The pool can only handle one division at a time.`,
      body: `
        <div class="tw-warning-box">
          <strong>Let's coordinate both divisions:</strong>
        </div>

        <div class="tw-suggestion-group">
          <div class="tw-suggestion-card" data-choice="move-source">
            <div class="tw-suggestion-icon">🔄</div>
            <div class="tw-suggestion-content">
              <strong>Change ${sourceDivision}'s Swim Time</strong>
              <p>Pick a different time that doesn't conflict</p>
            </div>
          </div>

          <div class="tw-suggestion-card" data-choice="move-target">
            <div class="tw-suggestion-icon">🔄</div>
            <div class="tw-suggestion-content">
              <strong>Move ${targetDivision}'s Swim</strong>
              <p>Keep ${sourceDivision} at ${startTime}, move ${targetDivision}</p>
              <span class="tw-suggestion-note">I'll help you find a new time for ${targetDivision}</span>
            </div>
          </div>

          <div class="tw-suggestion-card" data-choice="swap">
            <div class="tw-suggestion-icon">↔️</div>
            <div class="tw-suggestion-content">
              <strong>Swap Times</strong>
              <p>${sourceDivision} gets ${targetBlock.startTime}–${targetBlock.endTime}</p>
              <p>${targetDivision} gets ${startTime}–${endTime}</p>
            </div>
          </div>
        </div>
      `,
      hideNext: true,
      setup: () => {
        wizardEl.querySelectorAll('.tw-suggestion-card').forEach(card => {
          card.onclick = () => {
            const choice = card.dataset.choice;

            if (choice === 'move-source') {
              // Go back to swim handler
              const trip = tripManifest.find(t => t.division === sourceDivision);
              handleSwimConflict(trip, originalConflict, afterResolve);
            } else if (choice === 'swap') {
              // Apply swap
              applyTimeChange(sourceDivision, originalConflict, 'Swim', targetBlock.startTime, targetBlock.endTime, () => {}, ['Pool']);
              applyTimeChange(targetDivision, targetBlock, 'Swim', startTime, endTime, afterResolve, ['Pool']);
            } else if (choice === 'move-target') {
              // Prompt for new time for target division
              promptMoveTargetDivisionSwim(targetDivision, targetBlock, () => {
                // Then apply source division's swim
                applyTimeChange(sourceDivision, originalConflict, 'Swim', startTime, endTime, afterResolve, ['Pool']);
              });
            }
          };
        });
      }
    });
  }

  function promptMoveTargetDivisionSwim(division, block, afterMove) {
    renderStep({
      title: `Move ${division}'s Swim`,
      text: `Let's find a new time for ${division}'s swim (currently ${block.startTime}–${block.endTime}).`,
      body: `
        <div class="tw-form-group">
          <label>Suggested times for ${division}:</label>
        </div>

        <div class="tw-suggestion-group">
          <div class="tw-suggestion-card" data-choice="morning">
            <div class="tw-suggestion-icon">🌅</div>
            <div class="tw-suggestion-content">
              <strong>Morning (9:00am)</strong>
              <p>9:00am - 9:45am</p>
            </div>
          </div>

          <div class="tw-suggestion-card" data-choice="late">
            <div class="tw-suggestion-icon">🌆</div>
            <div class="tw-suggestion-content">
              <strong>Late Afternoon (3:30pm)</strong>
              <p>3:30pm - 4:15pm</p>
            </div>
          </div>

          <div class="tw-suggestion-card" data-choice="custom">
            <div class="tw-suggestion-icon">✏️</div>
            <div class="tw-suggestion-content">
              <strong>Custom Time</strong>
              <p>I'll choose manually</p>
            </div>
          </div>
        </div>

        <div id="custom-time-input" style="display:none;">
          <div class="tw-time-row">
            <div class="tw-form-group">
              <label>Swim Start</label>
              <input id="target-swim-start" placeholder="10:00am" class="tw-input">
            </div>
            <div class="tw-form-group">
              <label>Swim End</label>
              <input id="target-swim-end" placeholder="10:45am" class="tw-input">
            </div>
          </div>
        </div>
      `,
      hideNext: true,
      setup: () => {
        wizardEl.querySelectorAll('.tw-suggestion-card').forEach(card => {
          card.onclick = () => {
            const choice = card.dataset.choice;

            let start, end;
            if (choice === 'morning') {
              start = '9:00am';
              end = '9:45am';
            } else if (choice === 'late') {
              start = '3:30pm';
              end = '4:15pm';
            } else if (choice === 'custom') {
              document.getElementById('custom-time-input').style.display = 'block';
              showContinueButton();
              return;
            }

            // Check for conflicts
            const conflicts = detectConflicts(division, start, end, block.id);
            if (conflicts.length > 0) {
              alert(`That time conflicts with "${conflicts[0].event}". Please choose another.`);
              return;
            }

            applyTimeChange(division, block, 'Swim', start, end, afterMove, ['Pool']);
          };
        });

        function showContinueButton() {
          const continueBtn = document.createElement('button');
          continueBtn.textContent = 'Apply Time';
          continueBtn.className = 'tw-btn tw-btn-primary';
          continueBtn.style.marginTop = '15px';
          continueBtn.onclick = () => {
            const start = wizardEl.querySelector('#target-swim-start').value.trim();
            const end = wizardEl.querySelector('#target-swim-end').value.trim();

            if (toMin(start) == null || toMin(end) == null || toMin(end) <= toMin(start)) {
              alert("Please enter valid times.");
              return;
            }

            const conflicts = detectConflicts(division, start, end, block.id);
            if (conflicts.length > 0) {
              alert(`That time conflicts with "${conflicts[0].event}". Please choose another.`);
              return;
            }

            applyTimeChange(division, block, 'Swim', start, end, afterMove, ['Pool']);
          };
          const customDiv = document.getElementById('custom-time-input');
          if (!customDiv.querySelector('.tw-btn-primary')) {
            customDiv.appendChild(continueBtn);
          }
        }
      }
    });
  }

  // ------------------------------------------------------------
  // HELPER: APPLY TIME CHANGE
  // ------------------------------------------------------------
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

    let previewHtml = '<div class="tw-final-preview">';

    travelingDivisions.forEach(div => {
      const changes = changesByDivision[div];
      previewHtml += `
        <div class="tw-preview-division">
          <h4>🚌 ${div} (Trip Day)</h4>
      `;

      if (changes.length === 0) {
        previewHtml += `<div class="tw-preview-item tw-preview-note">Only the trip was added</div>`;
      } else {
        changes.forEach(change => {
          previewHtml += formatChangeForPreview(change);
        });
      }

      previewHtml += `</div>`;
    });

    const stayingDivs = allDivisions.filter(d => !travelingDivisions.includes(d));
    const affectedStaying = stayingDivs.filter(d => changesByDivision[d].length > 0);
    
    if (affectedStaying.length > 0) {
      previewHtml += '<div class="tw-preview-section-header">📍 Other Divisions (Adjusted)</div>';
      
      affectedStaying.forEach(div => {
        const changes = changesByDivision[div];
        previewHtml += `
          <div class="tw-preview-division">
            <h4>${div}</h4>
        `;

        changes.forEach(change => {
          previewHtml += formatChangeForPreview(change);
        });

        previewHtml += `</div>`;
      });
    }

    previewHtml += '</div>';

    renderStep({
      title: "✅ Review Final Schedule",
      text: "Here's the complete plan. Review carefully before applying.",
      body: previewHtml,
      nextText: "✓ Apply All Changes",
      cancelText: "✗ Cancel",
      next: () => {
        applyAllChanges();
      }
    });
  }

  function formatChangeForPreview(change) {
    if (change.action === 'add') {
      return `
        <div class="tw-preview-item tw-preview-add">
          <strong>+ ${change.event}</strong>
          <span>${change.startTime} – ${change.endTime}</span>
        </div>
      `;
    } else if (change.action === 'replace') {
      return `
        <div class="tw-preview-item tw-preview-replace">
          <strong>↻ ${change.event}</strong>
          <span>Moved to ${change.startTime} – ${change.endTime}</span>
          <small>Was: ${change.oldEvent.startTime} – ${change.oldEvent.endTime}</small>
        </div>
      `;
    } else if (change.action === 'remove') {
      return `
        <div class="tw-preview-item tw-preview-remove">
          <strong>− ${change.oldEvent.event}</strong>
          <small>${change.reason}</small>
        </div>
      `;
    } else if (change.action === 'note') {
      return `
        <div class="tw-preview-item tw-preview-note">
          <strong>ℹ️ ${change.message}</strong>
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
      <div class="tw-container">
        <div class="tw-wizard-panel">
          <div class="tw-header">
            <div>
              <strong class="tw-title">Trip Planner</strong>
              <div class="tw-subtitle">Guided scheduling</div>
            </div>
            <button id="tw-close" class="tw-close-btn">✖</button>
          </div>
          <div id="tw-content" class="tw-content"></div>
        </div>

        <div class="tw-preview-panel">
          <div class="tw-preview-header">
            <strong>📅 Live Schedule</strong>
            <span>Updates as you make decisions</span>
          </div>
          <div id="tw-live-preview" class="tw-live-preview"></div>
        </div>
      </div>

      ${getStyles()}
    `;

    document.body.appendChild(overlay);
    wizardEl = document.getElementById("tw-content");
    previewEl = document.getElementById("tw-live-preview");

    document.getElementById("tw-close").onclick = () => {
      if (confirm("Exit trip planner? All progress will be lost.")) {
        close();
      }
    };

    updateLivePreview();
  }

  function renderStep({ title, text, body, next, nextText = "Continue →", cancelText, hideNext = false, showSkip = false, onSkip, setup }) {
    let html = `
      <h2 class="tw-step-title">${title}</h2>
      <p class="tw-step-text">${text}</p>
      <div class="tw-step-body">${body}</div>
    `;

    if (!hideNext || showSkip) {
      html += `<div class="tw-btn-group">`;
      if (showSkip) {
        html += `<button id="tw-skip" class="tw-btn tw-btn-skip">Skip for Now</button>`;
      }
      if (cancelText) {
        html += `<button id="tw-cancel" class="tw-btn tw-btn-secondary">${cancelText}</button>`;
      }
      if (!hideNext) {
        html += `<button id="tw-next" class="tw-btn tw-btn-primary">${nextText}</button>`;
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
        #tw-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.7);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 10000;
          padding: 20px;
          backdrop-filter: blur(4px);
        }

        .tw-container {
          display: flex;
          gap: 20px;
          width: 100%;
          max-width: 1400px;
          height: 90vh;
          max-height: 900px;
        }

        .tw-wizard-panel {
          flex: 1;
          background: white;
          border-radius: 16px;
          display: flex;
          flex-direction: column;
          box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        }

        .tw-preview-panel {
          flex: 1;
          background: white;
          border-radius: 16px;
          display: flex;
          flex-direction: column;
          box-shadow: 0 20px 60px rgba(0,0,0,0.3);
          overflow: hidden;
        }

        .tw-header {
          padding: 20px 24px;
          border-bottom: 1px solid #e5e7eb;
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          border-radius: 16px 16px 0 0;
        }

        .tw-title {
          font-size: 1.25rem;
          font-weight: 600;
        }

        .tw-subtitle {
          font-size: 0.875rem;
          opacity: 0.9;
          margin-top: 2px;
        }

        .tw-close-btn {
          background: rgba(255,255,255,0.2);
          border: none;
          width: 32px;
          height: 32px;
          border-radius: 8px;
          color: white;
          font-size: 18px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .tw-close-btn:hover {
          background: rgba(255,255,255,0.3);
        }

        .tw-content {
          padding: 24px;
          overflow-y: auto;
          flex: 1;
        }

        .tw-step-title {
          font-size: 1.5rem;
          font-weight: 600;
          margin: 0 0 8px 0;
          color: #1f2937;
        }

        .tw-step-text {
          color: #6b7280;
          margin: 0 0 24px 0;
          font-size: 1rem;
          line-height: 1.5;
        }

        .tw-check {
          display: flex;
          align-items: center;
          padding: 12px 16px;
          border: 2px solid #e5e7eb;
          border-radius: 8px;
          margin-bottom: 8px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .tw-check:hover {
          border-color: #667eea;
          background: #f9fafb;
        }

        .tw-check input {
          width: 20px;
          height: 20px;
          margin-right: 12px;
        }

        .tw-form-group {
          margin-bottom: 16px;
        }

        .tw-form-group label {
          display: block;
          font-weight: 500;
          color: #374151;
          margin-bottom: 6px;
        }

        .tw-input {
          width: 100%;
          padding: 10px 14px;
          border: 2px solid #e5e7eb;
          border-radius: 8px;
          font-size: 1rem;
          transition: all 0.2s;
        }

        .tw-input:focus {
          outline: none;
          border-color: #667eea;
          box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
        }

        .tw-time-row {
          display: flex;
          gap: 12px;
        }

        .tw-time-row .tw-form-group {
          flex: 1;
        }

        .tw-help-text {
          background: #f0f9ff;
          border: 1px solid #bae6fd;
          border-radius: 8px;
          padding: 12px;
          color: #0369a1;
          font-size: 0.9rem;
          margin-top: 16px;
        }

        .tw-suggestion-group {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .tw-suggestion-card {
          background: white;
          border: 2px solid #e5e7eb;
          border-radius: 12px;
          padding: 16px;
          cursor: pointer;
          transition: all 0.2s;
          display: flex;
          gap: 16px;
          align-items: flex-start;
        }

        .tw-suggestion-card:hover {
          border-color: #667eea;
          background: #f9fafb;
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(102, 126, 234, 0.15);
        }

        .tw-suggestion-card-muted {
          opacity: 0.7;
        }

        .tw-suggestion-icon {
          font-size: 2rem;
          flex-shrink: 0;
        }

        .tw-suggestion-content {
          flex: 1;
        }

        .tw-suggestion-content strong {
          display: block;
          color: #1f2937;
          font-size: 1.05rem;
          margin-bottom: 4px;
        }

        .tw-suggestion-content p {
          color: #6b7280;
          font-size: 0.95rem;
          margin: 0 0 4px 0;
        }

        .tw-suggestion-note {
          display: block;
          color: #10b981;
          font-size: 0.85rem;
          font-weight: 500;
        }

        .tw-warning-inline {
          background: #fef3c7;
          border-left: 3px solid #f59e0b;
          padding: 8px 12px;
          margin-top: 8px;
          border-radius: 4px;
          font-size: 0.9rem;
          color: #92400e;
        }

        .tw-info-box,
        .tw-warning-box {
          background: #eff6ff;
          border: 1px solid #bfdbfe;
          border-radius: 8px;
          padding: 14px;
          margin-bottom: 16px;
          color: #1e40af;
        }

        .tw-warning-box {
          background: #fef3c7;
          border-color: #fbbf24;
          color: #92400e;
        }

        .tw-btn-group {
          display: flex;
          gap: 10px;
          margin-top: 24px;
          padding-top: 20px;
          border-top: 1px solid #e5e7eb;
        }

        .tw-btn {
          padding: 12px 24px;
          border-radius: 8px;
          font-size: 1rem;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
          border: none;
        }

        .tw-btn-primary {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          flex: 1;
        }

        .tw-btn-primary:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
        }

        .tw-btn-secondary {
          background: #f3f4f6;
          color: #374151;
        }

        .tw-btn-skip {
          background: #fef3c7;
          color: #92400e;
        }

        .tw-preview-header {
          padding: 16px 20px;
          border-bottom: 1px solid #e5e7eb;
          background: #f9fafb;
        }

        .tw-preview-header strong {
          display: block;
          font-size: 1.1rem;
          color: #1f2937;
          margin-bottom: 2px;
        }

        .tw-preview-header span {
          font-size: 0.85rem;
          color: #6b7280;
        }

        .tw-live-preview {
          flex: 1;
          overflow-y: auto;
          padding: 16px;
          background: #fafafa;
        }

        .tw-live-schedule {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .tw-schedule-division {
          background: white;
          border-radius: 10px;
          border: 1px solid #e5e7eb;
          overflow: hidden;
        }

        .tw-schedule-division.tw-traveling {
          border-color: #fbbf24;
          box-shadow: 0 0 0 2px #fef3c7;
        }

        .tw-schedule-div-header {
          padding: 12px 16px;
          background: linear-gradient(to right, #f9fafb, white);
          font-weight: 600;
          color: #1f2937;
          display: flex;
          align-items: center;
          gap: 8px;
          border-bottom: 1px solid #e5e7eb;
        }

        .tw-badge {
          background: #fbbf24;
          color: #78350f;
          padding: 2px 8px;
          border-radius: 12px;
          font-size: 0.75rem;
          font-weight: 600;
          text-transform: uppercase;
        }

        .tw-schedule-blocks {
          padding: 12px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .tw-schedule-empty {
          color: #9ca3af;
          font-style: italic;
          text-align: center;
          padding: 20px;
        }

        .tw-block-original,
        .tw-block-new {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 10px 12px;
          border-radius: 6px;
          transition: all 0.2s;
        }

        .tw-block-original {
          background: #f3f4f6;
          border: 1px solid #e5e7eb;
        }

        .tw-block-new {
          background: #d1fae5;
          border: 1px solid #34d399;
        }

        .tw-block-icon {
          font-size: 1.5rem;
          flex-shrink: 0;
        }

        .tw-block-content {
          flex: 1;
          min-width: 0;
        }

        .tw-block-content strong {
          display: block;
          color: #1f2937;
          font-size: 0.95rem;
          margin-bottom: 2px;
        }

        .tw-block-time {
          display: block;
          color: #6b7280;
          font-size: 0.85rem;
        }

        .tw-block-badge {
          background: #10b981;
          color: white;
          padding: 2px 8px;
          border-radius: 10px;
          font-size: 0.7rem;
          font-weight: 600;
          text-transform: uppercase;
        }

        .tw-final-preview {
          max-height: 400px;
          overflow-y: auto;
        }

        .tw-preview-section-header {
          font-weight: 600;
          color: #374151;
          margin: 20px 0 12px 0;
          padding-bottom: 8px;
          border-bottom: 2px solid #e5e7eb;
        }

        .tw-preview-division {
          margin-bottom: 20px;
        }

        .tw-preview-division h4 {
          margin: 0 0 10px 0;
          color: #1f2937;
        }

        .tw-preview-item {
          padding: 10px 12px;
          border-radius: 6px;
          margin-bottom: 8px;
        }

        .tw-preview-add {
          background: #d1fae5;
          border-left: 3px solid #10b981;
        }

        .tw-preview-replace {
          background: #dbeafe;
          border-left: 3px solid #3b82f6;
        }

        .tw-preview-remove {
          background: #fee2e2;
          border-left: 3px solid #ef4444;
        }

        .tw-preview-note {
          background: #fef3c7;
          border-left: 3px solid #f59e0b;
        }

        .tw-preview-item strong {
          font-weight: 600;
        }

        .tw-preview-item small {
          color: #6b7280;
          font-size: 0.85rem;
        }
      </style>
    `;
  }

})();
