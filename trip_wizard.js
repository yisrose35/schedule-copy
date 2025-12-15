// =================================================================
// trip_wizard.js — COMPREHENSIVE TRIP PLANNER
// Handles full-day impacts, cross-division coordination, and cascading conflicts
// =================================================================

(function () {
  'use strict';

  // ------------------------------------------------------------
  // STATE
  // ------------------------------------------------------------
  let tripManifest = [];
  let plannedChanges = [];
  let fullDaySkeleton = {}; // Organized by division
  let affectedActivities = {}; // Track what's affected across ALL divisions
  let onComplete = null;
  let wizardEl = null;
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
      affectedActivities = {};
      onComplete = cb;
      allDivisions = window.availableDivisions || [];
      travelingDivisions = [];

      // Load full day skeleton for ALL divisions
      loadFullDaySkeleton();

      renderBase();
      stepWho();
    }
  };

  // ------------------------------------------------------------
  // LOAD FULL DAY SKELETON
  // ------------------------------------------------------------
  function loadFullDaySkeleton() {
    const dailyData = window.loadCurrentDailyData?.() || {};
    const skeleton = dailyData.manualSkeleton || [];

    // Organize by division
    allDivisions.forEach(div => {
      fullDaySkeleton[div] = skeleton.filter(b => b.division === div);
    });

    console.log("Trip Wizard: Loaded full day skeleton", fullDaySkeleton);
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
          💡 The wizard will scan the entire day's schedule and help you handle conflicts for all divisions.
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

        // Analyze full day impact
        analyzeFullDayImpact();
        startConflictResolution();
      }
    });
  }

  // ------------------------------------------------------------
  // ANALYZE FULL DAY IMPACT
  // ------------------------------------------------------------
  function analyzeFullDayImpact() {
    affectedActivities = {
      travelingDivisions: {},
      stayingDivisions: {}
    };

    // Analyze each traveling division
    travelingDivisions.forEach(div => {
      const blocks = fullDaySkeleton[div] || [];
      const trip = tripManifest.find(t => t.division === div);

      const conflicts = blocks.filter(b => 
        overlaps(b.startTime, b.endTime, trip.start, trip.end)
      );

      affectedActivities.travelingDivisions[div] = conflicts.map(b => ({
        ...b,
        impact: 'missed',
        reason: 'Division is off campus'
      }));
    });

    // Analyze staying divisions for opportunities/constraints
    const stayingDivs = allDivisions.filter(d => !travelingDivisions.includes(d));
    
    stayingDivs.forEach(div => {
      affectedActivities.stayingDivisions[div] = {
        opportunities: [],
        constraints: []
      };
      // We'll populate this as we make decisions
    });

    console.log("Full Day Impact Analysis:", affectedActivities);
  }

  // ------------------------------------------------------------
  // CONFLICT RESOLUTION - Division by Division
  // ------------------------------------------------------------
  function startConflictResolution() {
    handleNextDivision(0);
  }

  function handleNextDivision(index) {
    if (index >= tripManifest.length) {
      checkForStayingDivisionImpacts();
      return;
    }

    const trip = tripManifest[index];
    const conflicts = affectedActivities.travelingDivisions[trip.division] || [];

    if (conflicts.length === 0) {
      // No conflicts - add trip and move on
      plannedChanges.push({
        division: trip.division,
        action: 'add',
        type: 'pinned',
        event: `🚌 TRIP: ${trip.destination}`,
        startTime: trip.start,
        endTime: trip.end,
        reservedFields: []
      });
      handleNextDivision(index + 1);
      return;
    }

    handleNextConflict(trip, conflicts.slice(), index);
  }

  function handleNextConflict(trip, remainingConflicts, divIndex) {
    if (remainingConflicts.length === 0) {
      // All conflicts resolved - add the trip
      plannedChanges.push({
        division: trip.division,
        action: 'add',
        type: 'pinned',
        event: `🚌 TRIP: ${trip.destination}`,
        startTime: trip.start,
        endTime: trip.end,
        reservedFields: []
      });
      handleNextDivision(divIndex + 1);
      return;
    }

    const conflict = remainingConflicts.shift();
    const evt = (conflict.event || "").toLowerCase();

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

  // ------------------------------------------------------------
  // SPECIFIC CONFLICT HANDLERS
  // ------------------------------------------------------------

  function handleLunchConflict(trip, conflict, next) {
    renderStep({
      title: `${trip.division} — 🍽️ Lunch`,
      text: `Lunch (${conflict.startTime}–${conflict.endTime}) overlaps with the trip. When should ${trip.division} eat?`,
      body: `
        <div class="tw-option-group">
          <button class="tw-option-btn" data-choice="before">
            <strong>Before Trip</strong>
            <span>Eat early, then leave</span>
          </button>
          <button class="tw-option-btn" data-choice="during">
            <strong>During Trip</strong>
            <span>Pack lunch or eat at destination</span>
          </button>
          <button class="tw-option-btn" data-choice="after">
            <strong>After Return</strong>
            <span>Eat when they get back</span>
          </button>
        </div>

        <div id="tw-lunch-time-input" style="display:none; margin-top:15px;">
          <label>Lunch Time</label>
          <div class="tw-time-row">
            <input id="lunch-start" placeholder="11:00am" class="tw-input">
            <span style="padding:0 8px;">to</span>
            <input id="lunch-end" placeholder="11:30am" class="tw-input">
          </div>
        </div>
      `,
      hideNext: true,
      setup: () => {
        wizardEl.querySelectorAll('.tw-option-btn').forEach(btn => {
          btn.onclick = () => {
            const choice = btn.dataset.choice;

            if (choice === 'during') {
              plannedChanges.push({
                division: trip.division,
                action: 'note',
                message: `${trip.division} will eat lunch during the trip (packed or at destination)`
              });
              next();
              return;
            }

            // Show time input
            wizardEl.querySelector('#tw-lunch-time-input').style.display = 'block';
            
            // Pre-fill suggestions
            const startInput = wizardEl.querySelector('#lunch-start');
            const endInput = wizardEl.querySelector('#lunch-end');
            
            if (choice === 'before') {
              const suggested = addMinutes(trip.start, -30);
              startInput.value = suggested || '';
              endInput.value = trip.start;
            } else if (choice === 'after') {
              startInput.value = trip.end;
              endInput.value = addMinutes(trip.end, 30);
            }

            // Show continue button
            const continueBtn = document.createElement('button');
            continueBtn.textContent = 'Continue';
            continueBtn.className = 'tw-btn tw-btn-primary';
            continueBtn.style.marginTop = '10px';
            continueBtn.onclick = () => {
              const start = startInput.value.trim();
              const end = endInput.value.trim();

              if (toMin(start) == null || toMin(end) == null || toMin(end) <= toMin(start)) {
                alert("Please enter a valid lunch time window.");
                return;
              }

              // Check for conflicts with this new time
              const hasConflict = checkTimeConflict(trip.division, start, end);
              if (hasConflict) {
                if (!confirm(`This time conflicts with ${hasConflict}. Do you want to continue anyway? You'll need to resolve this conflict next.`)) {
                  return;
                }
              }

              plannedChanges.push({
                division: trip.division,
                action: 'replace',
                oldEvent: conflict,
                type: 'pinned',
                event: 'Lunch',
                startTime: start,
                endTime: end
              });

              next();
            };

            if (!wizardEl.querySelector('.tw-btn-primary')) {
              wizardEl.querySelector('#tw-lunch-time-input').appendChild(continueBtn);
            }
          };
        });
      }
    });
  }

  function handleSwimConflict(trip, conflict, next) {
    const suggestedStart = trip.end;
    const suggestedEnd = addMinutes(trip.end, 45);

    // Check if suggested time conflicts with other divisions
    const conflictInfo = checkCrossDivisionConflict('Swim', suggestedStart, suggestedEnd, trip.division);

    let conflictWarning = '';
    if (conflictInfo) {
      conflictWarning = `
        <div class="tw-warning">
          ⚠️ <strong>Note:</strong> ${conflictInfo.division} already has ${conflictInfo.activity} at this time. 
          You may need to adjust their schedule too.
        </div>
      `;
    }

    renderStep({
      title: `${trip.division} — 🏊 Swim`,
      text: `Swim (${conflict.startTime}–${conflict.endTime}) is missed during the trip. When should they swim instead?`,
      body: `
        <div class="tw-suggestion-box">
          <strong>💡 Suggested Time: ${suggestedStart} – ${suggestedEnd}</strong>
          <p>Right when they return from the trip, so the pool is free earlier for other divisions.</p>
        </div>

        ${conflictWarning}

        <div class="tw-form-group">
          <label>Swim Time</label>
          <div class="tw-time-row">
            <input id="swim-start" value="${suggestedStart}" class="tw-input">
            <span style="padding:0 8px;">to</span>
            <input id="swim-end" value="${suggestedEnd}" class="tw-input">
          </div>
        </div>

        <div class="tw-option-group" style="margin-top:15px;">
          <button class="tw-option-btn-small" data-choice="skip">
            Skip swim for today
          </button>
        </div>
      `,
      next: () => {
        const start = wizardEl.querySelector('#swim-start').value.trim();
        const end = wizardEl.querySelector('#swim-end').value.trim();

        if (toMin(start) == null || toMin(end) == null || toMin(end) <= toMin(start)) {
          alert("Please enter a valid swim time.");
          return;
        }

        plannedChanges.push({
          division: trip.division,
          action: 'replace',
          oldEvent: conflict,
          type: 'pinned',
          event: 'Swim',
          startTime: start,
          endTime: end,
          reservedFields: ['Pool'] // Reserve the pool
        });

        next();
      },
      setup: () => {
        wizardEl.querySelector('[data-choice="skip"]').onclick = () => {
          plannedChanges.push({
            division: trip.division,
            action: 'remove',
            oldEvent: conflict,
            reason: 'Skipped due to trip'
          });
          next();
        };
      }
    });
  }

  function handleSnackConflict(trip, conflict, next) {
    renderStep({
      title: `${trip.division} — 🍎 Snack`,
      text: `Snack time (${conflict.startTime}–${conflict.endTime}) is missed during the trip.`,
      body: `
        <div class="tw-option-group">
          <button class="tw-option-btn" data-choice="before">
            <strong>Before Trip</strong>
            <span>Quick snack before leaving</span>
          </button>
          <button class="tw-option-btn" data-choice="pack">
            <strong>Pack Snacks</strong>
            <span>Take snacks on the trip</span>
          </button>
          <button class="tw-option-btn" data-choice="after">
            <strong>After Return</strong>
            <span>Snack when they get back</span>
          </button>
          <button class="tw-option-btn" data-choice="skip">
            <strong>Skip</strong>
            <span>No snack today</span>
          </button>
        </div>

        <div id="tw-snack-time-input" style="display:none; margin-top:15px;">
          <label>Snack Time</label>
          <div class="tw-time-row">
            <input id="snack-start" placeholder="2:00pm" class="tw-input">
            <span style="padding:0 8px;">to</span>
            <input id="snack-end" placeholder="2:15pm" class="tw-input">
          </div>
        </div>
      `,
      hideNext: true,
      setup: () => {
        wizardEl.querySelectorAll('.tw-option-btn').forEach(btn => {
          btn.onclick = () => {
            const choice = btn.dataset.choice;

            if (choice === 'pack' || choice === 'skip') {
              plannedChanges.push({
                division: trip.division,
                action: 'note',
                message: choice === 'pack' 
                  ? `${trip.division} will have snacks during the trip` 
                  : `${trip.division} will skip snacks today`
              });
              next();
              return;
            }

            // Show time input
            wizardEl.querySelector('#tw-snack-time-input').style.display = 'block';
            
            const startInput = wizardEl.querySelector('#snack-start');
            const endInput = wizardEl.querySelector('#snack-end');
            
            if (choice === 'before') {
              const suggested = addMinutes(trip.start, -15);
              startInput.value = suggested || '';
              endInput.value = trip.start;
            } else if (choice === 'after') {
              startInput.value = trip.end;
              endInput.value = addMinutes(trip.end, 15);
            }

            const continueBtn = document.createElement('button');
            continueBtn.textContent = 'Continue';
            continueBtn.className = 'tw-btn tw-btn-primary';
            continueBtn.style.marginTop = '10px';
            continueBtn.onclick = () => {
              const start = startInput.value.trim();
              const end = endInput.value.trim();

              if (toMin(start) == null || toMin(end) == null || toMin(end) <= toMin(start)) {
                alert("Please enter a valid snack time.");
                return;
              }

              plannedChanges.push({
                division: trip.division,
                action: 'replace',
                oldEvent: conflict,
                type: 'pinned',
                event: 'Snacks',
                startTime: start,
                endTime: end
              });

              next();
            };

            if (!wizardEl.querySelector('.tw-btn-primary')) {
              wizardEl.querySelector('#tw-snack-time-input').appendChild(continueBtn);
            }
          };
        });
      }
    });
  }

  function handleLeagueConflict(trip, conflict, next) {
    const isSpecialty = (conflict.event || "").toLowerCase().includes('specialty');
    const leagueType = isSpecialty ? 'Specialty League' : 'League Game';

    renderStep({
      title: `${trip.division} — 🏆 ${leagueType}`,
      text: `${trip.division} has a ${leagueType.toLowerCase()} scheduled during the trip (${conflict.startTime}–${conflict.endTime}). This game cannot happen.`,
      body: `
        <div class="tw-info-box">
          <p><strong>Impact:</strong> The opposing team(s) will also be affected. This game will need to be rescheduled for another day or marked as forfeit/cancelled.</p>
        </div>

        <div class="tw-option-group">
          <button class="tw-option-btn" data-choice="reschedule">
            <strong>Reschedule for Another Day</strong>
            <span>Manually reschedule this game later</span>
          </button>
          <button class="tw-option-btn" data-choice="cancel">
            <strong>Cancel This Game</strong>
            <span>Game won't be played</span>
          </button>
        </div>
      `,
      hideNext: true,
      setup: () => {
        wizardEl.querySelectorAll('.tw-option-btn').forEach(btn => {
          btn.onclick = () => {
            const choice = btn.dataset.choice;
            
            plannedChanges.push({
              division: trip.division,
              action: 'remove',
              oldEvent: conflict,
              reason: choice === 'reschedule' 
                ? `${leagueType} to be rescheduled manually for another day`
                : `${leagueType} cancelled for today`
            });

            next();
          };
        });
      }
    });
  }

  function handleGenericConflict(trip, conflict, next) {
    renderStep({
      title: `${trip.division} — ${conflict.event}`,
      text: `"${conflict.event}" (${conflict.startTime}–${conflict.endTime}) will be skipped because of the trip.`,
      body: `
        <div class="tw-info-box">
          <p>This activity cannot happen while ${trip.division} is off campus. It will be removed from today's schedule.</p>
        </div>

        <div class="tw-option-group">
          <button class="tw-option-btn" data-choice="proceed">
            <strong>Continue</strong>
            <span>Remove this activity for today</span>
          </button>
        </div>
      `,
      hideNext: true,
      setup: () => {
        wizardEl.querySelector('[data-choice="proceed"]').onclick = () => {
          plannedChanges.push({
            division: trip.division,
            action: 'remove',
            oldEvent: conflict,
            reason: 'Division is off campus for trip'
          });
          next();
        };
      }
    });
  }

  // ------------------------------------------------------------
  // CHECK FOR STAYING DIVISION IMPACTS
  // ------------------------------------------------------------
  function checkForStayingDivisionImpacts() {
    // TODO: In a full implementation, we'd check if any of our changes
    // create opportunities or problems for staying divisions
    // For now, proceed to preview
    showPreview();
  }

  // ------------------------------------------------------------
  // CONFLICT DETECTION HELPERS
  // ------------------------------------------------------------
  function checkTimeConflict(division, startTime, endTime) {
    const divisionSkeleton = fullDaySkeleton[division] || [];
    
    for (const block of divisionSkeleton) {
      if (overlaps(block.startTime, block.endTime, startTime, endTime)) {
        return block.event;
      }
    }
    
    // Also check against planned changes
    for (const change of plannedChanges) {
      if (change.division === division && change.action === 'add' || change.action === 'replace') {
        if (overlaps(change.startTime, change.endTime, startTime, endTime)) {
          return change.event;
        }
      }
    }
    
    return null;
  }

  function checkCrossDivisionConflict(activity, startTime, endTime, excludeDivision) {
    for (const div of allDivisions) {
      if (div === excludeDivision) continue;
      
      const divisionSkeleton = fullDaySkeleton[div] || [];
      
      for (const block of divisionSkeleton) {
        if (overlaps(block.startTime, block.endTime, startTime, endTime)) {
          // Check if it's the same type of activity
          if ((block.event || "").toLowerCase().includes(activity.toLowerCase())) {
            return { division: div, activity: block.event };
          }
        }
      }
    }
    
    return null;
  }

  // ------------------------------------------------------------
  // PREVIEW & FINALIZE
  // ------------------------------------------------------------
  function showPreview() {
    // Group changes by division
    const changesByDivision = {};
    allDivisions.forEach(d => { changesByDivision[d] = []; });
    
    plannedChanges.forEach(change => {
      changesByDivision[change.division].push(change);
    });

    let previewHtml = '<div class="tw-preview-container">';

    // Show traveling divisions first
    travelingDivisions.forEach(div => {
      const changes = changesByDivision[div];
      previewHtml += `
        <div class="tw-preview-division">
          <h4>🚌 ${div} (Going on Trip)</h4>
          <div class="tw-preview-items">
      `;

      changes.forEach(change => {
        if (change.action === 'add') {
          previewHtml += `
            <div class="tw-preview-item tw-preview-add">
              <strong>+ ${change.event}</strong>
              <span>${change.startTime} – ${change.endTime}</span>
            </div>
          `;
        } else if (change.action === 'replace') {
          previewHtml += `
            <div class="tw-preview-item tw-preview-replace">
              <strong>↻ ${change.event}</strong>
              <span>Moved to ${change.startTime} – ${change.endTime}</span>
              <small>Was: ${change.oldEvent.startTime} – ${change.oldEvent.endTime}</small>
            </div>
          `;
        } else if (change.action === 'remove') {
          previewHtml += `
            <div class="tw-preview-item tw-preview-remove">
              <strong>− ${change.oldEvent.event}</strong>
              <small>${change.reason}</small>
            </div>
          `;
        } else if (change.action === 'note') {
          previewHtml += `
            <div class="tw-preview-item tw-preview-note">
              <strong>ℹ️ Note</strong>
              <span>${change.message}</span>
            </div>
          `;
        }
      });

      previewHtml += `</div></div>`;
    });

    // Show staying divisions if affected
    const stayingDivs = allDivisions.filter(d => !travelingDivisions.includes(d));
    const affectedStaying = stayingDivs.filter(d => changesByDivision[d].length > 0);
    
    if (affectedStaying.length > 0) {
      previewHtml += '<div class="tw-preview-section-header">📍 Divisions Staying at Camp (Affected)</div>';
      
      affectedStaying.forEach(div => {
        const changes = changesByDivision[div];
        previewHtml += `
          <div class="tw-preview-division">
            <h4>${div}</h4>
            <div class="tw-preview-items">
        `;

        changes.forEach(change => {
          // Same rendering as above
          if (change.action === 'add') {
            previewHtml += `
              <div class="tw-preview-item tw-preview-add">
                <strong>+ ${change.event}</strong>
                <span>${change.startTime} – ${change.endTime}</span>
              </div>
            `;
          } else if (change.action === 'replace') {
            previewHtml += `
              <div class="tw-preview-item tw-preview-replace">
                <strong>↻ ${change.event}</strong>
                <span>Moved to ${change.startTime} – ${change.endTime}</span>
              </div>
            `;
          }
        });

        previewHtml += `</div></div>`;
      });
    }

    previewHtml += '</div>';

    renderStep({
      title: "📋 Review Changes",
      text: "Here's how the day will be adjusted. Review carefully before applying.",
      body: previewHtml,
      nextText: "✓ Apply Changes",
      cancelText: "✗ Cancel",
      next: () => {
        applyChanges();
      }
    });
  }

  function applyChanges() {
    // Convert plannedChanges into the format expected by daily_adjustments.js
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
        // Remove old, add new
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

    // Call the callback with instructions
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
      <div class="tw-modal">
        <div class="tw-header">
          <div>
            <strong class="tw-title">Trip Planner Wizard</strong>
            <div class="tw-subtitle">Smart scheduling for off-campus trips</div>
          </div>
          <button id="tw-close" class="tw-close-btn" title="Close">✖</button>
        </div>
        <div id="tw-content" class="tw-content"></div>
      </div>
      
      <style>
        #tw-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.6);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 10000;
          padding: 20px;
          backdrop-filter: blur(4px);
        }

        .tw-modal {
          background: white;
          border-radius: 16px;
          width: 100%;
          max-width: 650px;
          max-height: 90vh;
          display: flex;
          flex-direction: column;
          box-shadow: 0 20px 60px rgba(0,0,0,0.3);
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
          transform: scale(1.1);
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

        .tw-check input[type="checkbox"] {
          width: 20px;
          height: 20px;
          margin-right: 12px;
          cursor: pointer;
        }

        .tw-check-label {
          font-size: 1rem;
          color: #374151;
          font-weight: 500;
        }

        .tw-form-group {
          margin-bottom: 16px;
        }

        .tw-form-group label {
          display: block;
          font-weight: 500;
          color: #374151;
          margin-bottom: 6px;
          font-size: 0.95rem;
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
          align-items: center;
          gap: 8px;
        }

        .tw-time-row .tw-form-group {
          flex: 1;
          margin-bottom: 0;
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

        .tw-option-group {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .tw-option-btn {
          background: white;
          border: 2px solid #e5e7eb;
          border-radius: 10px;
          padding: 14px 18px;
          text-align: left;
          cursor: pointer;
          transition: all 0.2s;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .tw-option-btn:hover {
          border-color: #667eea;
          background: #f9fafb;
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(102, 126, 234, 0.15);
        }

        .tw-option-btn strong {
          color: #1f2937;
          font-size: 1rem;
        }

        .tw-option-btn span {
          color: #6b7280;
          font-size: 0.875rem;
        }

        .tw-option-btn-small {
          background: #f3f4f6;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          padding: 8px 14px;
          font-size: 0.9rem;
          cursor: pointer;
          transition: all 0.2s;
        }

        .tw-option-btn-small:hover {
          background: #e5e7eb;
        }

        .tw-suggestion-box {
          background: #f0fdf4;
          border: 2px solid #86efac;
          border-radius: 10px;
          padding: 14px;
          margin-bottom: 16px;
        }

        .tw-suggestion-box strong {
          color: #15803d;
          font-size: 1rem;
        }

        .tw-suggestion-box p {
          color: #166534;
          margin: 4px 0 0 0;
          font-size: 0.9rem;
        }

        .tw-warning {
          background: #fef3c7;
          border: 2px solid #fbbf24;
          border-radius: 10px;
          padding: 14px;
          margin-bottom: 16px;
          color: #92400e;
        }

        .tw-info-box {
          background: #eff6ff;
          border: 1px solid #bfdbfe;
          border-radius: 8px;
          padding: 14px;
          margin-bottom: 16px;
          color: #1e40af;
        }

        .tw-info-box p {
          margin: 0;
          font-size: 0.95rem;
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

        .tw-btn-secondary:hover {
          background: #e5e7eb;
        }

        .tw-preview-container {
          max-height: 400px;
          overflow-y: auto;
          border: 1px solid #e5e7eb;
          border-radius: 10px;
          padding: 16px;
          background: #fafafa;
        }

        .tw-preview-section-header {
          font-weight: 600;
          color: #374151;
          margin: 16px 0 12px 0;
          padding-bottom: 8px;
          border-bottom: 2px solid #e5e7eb;
          font-size: 1rem;
        }

        .tw-preview-division {
          margin-bottom: 20px;
        }

        .tw-preview-division h4 {
          margin: 0 0 10px 0;
          color: #1f2937;
          font-size: 1.1rem;
        }

        .tw-preview-items {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .tw-preview-item {
          padding: 10px 12px;
          border-radius: 6px;
          display: flex;
          flex-direction: column;
          gap: 2px;
          font-size: 0.9rem;
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

    document.body.appendChild(overlay);
    wizardEl = document.getElementById("tw-content");

    document.getElementById("tw-close").onclick = () => {
      if (confirm("Are you sure you want to exit? All progress will be lost.")) {
        close();
      }
    };
  }

  function renderStep({ title, text, body, next, nextText = "Next →", cancelText, hideNext = false, setup }) {
    let html = `
      <h2 class="tw-step-title">${title}</h2>
      <p class="tw-step-text">${text}</p>
      <div class="tw-step-body">${body}</div>
    `;

    if (!hideNext) {
      html += `
        <div class="tw-btn-group">
          ${cancelText ? `<button id="tw-cancel" class="tw-btn tw-btn-secondary">${cancelText}</button>` : ''}
          <button id="tw-next" class="tw-btn tw-btn-primary">${nextText}</button>
        </div>
      `;
    }

    wizardEl.innerHTML = html;

    if (!hideNext && next) {
      wizardEl.querySelector('#tw-next').onclick = next;
    }

    if (cancelText) {
      wizardEl.querySelector('#tw-cancel').onclick = close;
    }

    // Run custom setup if provided
    if (setup) {
      setup();
    }
  }

  function close() {
    document.getElementById("tw-overlay")?.remove();
  }

})();
