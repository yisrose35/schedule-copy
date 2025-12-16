// =================================================================
// trip_wizard.js — SMART TRIP PLANNER
// Intelligent conflict detection, visual timeline, auto-suggestions
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
  let decisionHistory = [];
  let onComplete = null;
  let wizardEl = null;
  let previewEl = null;
  let allDivisions = [];
  let travelingDivisions = [];

  // Camp day boundaries (configurable)
  const DAY_START = '8:00am';
  const DAY_END = '5:00pm';
  const ACTIVITY_DURATIONS = {
    lunch: 30,
    swim: 45,
    snack: 15,
    league: 60,
    default: 45
  };

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

  function subtractMinutes(timeStr, mins) {
    return addMinutes(timeStr, -mins);
  }

  function getDuration(startTime, endTime) {
    const s = toMin(startTime);
    const e = toMin(endTime);
    if (s == null || e == null) return 0;
    return e - s;
  }

  function overlaps(start1, end1, start2, end2) {
    const s1 = toMin(start1), e1 = toMin(end1);
    const s2 = toMin(start2), e2 = toMin(end2);
    if (s1 == null || e1 == null || s2 == null || e2 == null) return false;
    return (s1 < e2) && (e1 > s2);
  }

  function formatDuration(mins) {
    if (mins < 60) return `${mins}min`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }

  // ------------------------------------------------------------
  // SMART SLOT FINDER
  // ------------------------------------------------------------
  function findAvailableSlots(division, duration, options = {}) {
    const {
      excludeIds = [],
      preferAfter = null,
      preferBefore = null,
      avoidTrip = true,
      checkPool = false,
      bufferMinutes = 5
    } = options;

    const dayStart = toMin(DAY_START);
    const dayEnd = toMin(DAY_END);
    const blocks = workingSkeleton[division] || [];

    // Get trip times if we need to avoid them
    let tripStart = null, tripEnd = null;
    if (avoidTrip) {
      const tripBlock = blocks.find(b => (b.event || '').toLowerCase().includes('trip'));
      if (tripBlock) {
        tripStart = toMin(tripBlock.startTime);
        tripEnd = toMin(tripBlock.endTime);
      }
    }

    // Build list of occupied times
    const occupied = blocks
      .filter(b => !excludeIds.includes(b.id))
      .map(b => ({
        start: toMin(b.startTime),
        end: toMin(b.endTime),
        event: b.event
      }))
      .filter(o => o.start != null && o.end != null)
      .sort((a, b) => a.start - b.start);

    // Find gaps
    const slots = [];
    let cursor = dayStart;

    for (const block of occupied) {
      if (block.start > cursor + duration + bufferMinutes) {
        // There's a gap
        const gapStart = cursor;
        const gapEnd = block.start - bufferMinutes;
        
        // Check if gap is usable (not during trip)
        if (!tripStart || gapEnd <= tripStart || gapStart >= tripEnd) {
          if (gapEnd - gapStart >= duration) {
            slots.push({
              start: toTime(gapStart),
              end: toTime(gapStart + duration),
              gapSize: gapEnd - gapStart,
              type: gapStart < toMin('12:00pm') ? 'morning' : 'afternoon'
            });
          }
        }
      }
      cursor = Math.max(cursor, block.end + bufferMinutes);
    }

    // Check end of day
    if (dayEnd - cursor >= duration) {
      if (!tripStart || cursor >= tripEnd || dayEnd <= tripStart) {
        slots.push({
          start: toTime(cursor),
          end: toTime(cursor + duration),
          gapSize: dayEnd - cursor,
          type: cursor < toMin('12:00pm') ? 'morning' : 'afternoon'
        });
      }
    }

    // Check for cross-division pool conflicts if needed
    if (checkPool) {
      const validSlots = slots.filter(slot => {
        const crossConflicts = detectCrossDivisionConflicts('swim', slot.start, slot.end, division);
        return crossConflicts.length === 0;
      });
      return scoreAndSortSlots(validSlots, { preferAfter, preferBefore });
    }

    return scoreAndSortSlots(slots, { preferAfter, preferBefore });
  }

  function scoreAndSortSlots(slots, { preferAfter, preferBefore }) {
    const prefAfterMin = preferAfter ? toMin(preferAfter) : null;
    const prefBeforeMin = preferBefore ? toMin(preferBefore) : null;

    return slots.map(slot => {
      let score = 50; // Base score
      const slotStart = toMin(slot.start);

      // Prefer slots after a certain time (e.g., after trip return)
      if (prefAfterMin && slotStart >= prefAfterMin) {
        score += 30;
        // Closer to preferred time is better
        score -= Math.min(20, Math.abs(slotStart - prefAfterMin) / 10);
      }

      // Prefer slots before a certain time
      if (prefBeforeMin && slotStart <= prefBeforeMin) {
        score += 20;
      }

      // Slight preference for larger gaps (more flexibility)
      score += Math.min(10, slot.gapSize / 30);

      return { ...slot, score };
    }).sort((a, b) => b.score - a.score);
  }

  function findBestSwimSlot(division, tripEnd) {
    // Find best swim slot considering pool availability across all divisions
    const duration = ACTIVITY_DURATIONS.swim;
    const allSwimTimes = [];

    // Collect all swim times from other divisions
    allDivisions.forEach(div => {
      if (div === division) return;
      const blocks = workingSkeleton[div] || [];
      blocks.forEach(b => {
        if ((b.event || '').toLowerCase().includes('swim')) {
          allSwimTimes.push({
            division: div,
            start: toMin(b.startTime),
            end: toMin(b.endTime)
          });
        }
      });
    });

    // Find slots that don't conflict with other swims
    const slots = findAvailableSlots(division, duration, {
      preferAfter: tripEnd,
      checkPool: true
    });

    return slots;
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
      decisionHistory = [];
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

  function undoLastChange() {
    if (decisionHistory.length === 0) return;
    
    const lastDecision = decisionHistory.pop();
    // Remove changes associated with this decision
    plannedChanges = plannedChanges.filter(c => c.decisionId !== lastDecision.id);
    
    // Rebuild working skeleton from scratch
    allDivisions.forEach(div => {
      workingSkeleton[div] = JSON.parse(JSON.stringify(fullDaySkeleton[div]));
    });
    
    // Re-apply remaining changes
    plannedChanges.forEach(change => {
      applyChangeToWorkingSkeleton(change);
    });
  }

  // ------------------------------------------------------------
  // LIVE SCHEDULE PREVIEW WITH TIMELINE
  // ------------------------------------------------------------
  function updateLivePreview() {
    if (!previewEl) return;

    const dayStartMin = toMin(DAY_START);
    const dayEndMin = toMin(DAY_END);
    const dayLength = dayEndMin - dayStartMin;

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
          
          <div class="tw-timeline-visual">
            <div class="tw-timeline-track">
              ${generateTimeMarkers()}
              ${sorted.map(block => generateTimelineBlock(block, dayStartMin, dayLength)).join('')}
            </div>
          </div>

          <div class="tw-schedule-list">
      `;

      if (sorted.length === 0) {
        html += `<div class="tw-schedule-empty">No activities scheduled</div>`;
      }

      sorted.forEach(block => {
        const isNew = block.isNew || false;
        const isTrip = (block.event || '').toLowerCase().includes('trip');
        const label = getLabelForEvent(block.event);
        const icon = getIconForEvent(block.event);

        html += `
          <div class="tw-list-item ${isNew ? 'new' : ''} ${isTrip ? 'trip' : ''}">
            <div class="tw-list-icon">${icon}</div>
            <div class="tw-list-content">
              <div class="tw-list-title">${label}</div>
              <div class="tw-list-time">${block.startTime} – ${block.endTime}</div>
            </div>
            ${isNew ? '<span class="tw-list-badge">New</span>' : ''}
          </div>
        `;
      });

      html += `</div></div>`;
    });

    previewEl.innerHTML = html;
  }

  function generateTimeMarkers() {
    const markers = ['8am', '9am', '10am', '11am', '12pm', '1pm', '2pm', '3pm', '4pm', '5pm'];
    return `
      <div class="tw-time-markers">
        ${markers.map((m, i) => `<span style="left: ${i * 11.1}%">${m}</span>`).join('')}
      </div>
    `;
  }

  function generateTimelineBlock(block, dayStartMin, dayLength) {
    const startMin = toMin(block.startTime);
    const endMin = toMin(block.endTime);
    if (startMin == null || endMin == null) return '';

    const left = ((startMin - dayStartMin) / dayLength) * 100;
    const width = ((endMin - startMin) / dayLength) * 100;
    const isNew = block.isNew || false;
    const isTrip = (block.event || '').toLowerCase().includes('trip');

    let colorClass = 'default';
    const evt = (block.event || '').toLowerCase();
    if (isTrip) colorClass = 'trip';
    else if (evt.includes('swim')) colorClass = 'swim';
    else if (evt.includes('lunch')) colorClass = 'lunch';
    else if (evt.includes('snack')) colorClass = 'snack';
    else if (evt.includes('league')) colorClass = 'league';

    return `
      <div class="tw-timeline-block ${colorClass} ${isNew ? 'new' : ''}" 
           style="left: ${left}%; width: ${Math.max(width, 2)}%"
           title="${block.event}: ${block.startTime} – ${block.endTime}">
      </div>
    `;
  }

  function getLabelForEvent(eventName) {
    if (!eventName) return 'Activity';
    if (eventName.toLowerCase().includes('trip')) return eventName.replace('Trip: ', '');
    if (eventName.toLowerCase().includes('lunch')) return 'Lunch';
    if (eventName.toLowerCase().includes('swim')) return 'Swim';
    if (eventName.toLowerCase().includes('snack')) return 'Snack';
    if (eventName.toLowerCase().includes('league')) return 'League';
    if (eventName.toLowerCase().includes('specialty')) return 'Specialty';
    return eventName;
  }

  function getIconForEvent(eventName) {
    if (!eventName) return '📅';
    const evt = eventName.toLowerCase();
    if (evt.includes('trip')) return '🚌';
    if (evt.includes('lunch')) return '🍽️';
    if (evt.includes('swim')) return '🏊';
    if (evt.includes('snack')) return '🍎';
    if (evt.includes('league')) return '⚽';
    if (evt.includes('specialty')) return '🎯';
    return '📅';
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

  function analyzeConflictSeverity(conflicts) {
    // Returns 'critical', 'moderate', or 'minor'
    const types = conflicts.map(c => (c.event || '').toLowerCase());
    if (types.some(t => t.includes('lunch') || t.includes('swim'))) return 'critical';
    if (types.some(t => t.includes('league'))) return 'moderate';
    return 'minor';
  }

  // ------------------------------------------------------------
  // STEP 1 — WHO'S GOING?
  // ------------------------------------------------------------
  function stepWho() {
    renderStep({
      title: "Who's going on the trip?",
      subtitle: "Select all divisions that will be traveling",
      body: `
        <div class="tw-division-grid">
          ${allDivisions.map(d => `
            <label class="tw-division-card">
              <input type="checkbox" value="${d}">
              <div class="tw-division-content">
                <span class="tw-division-name">${d}</span>
                <span class="tw-division-count">${(fullDaySkeleton[d] || []).length} activities</span>
              </div>
              <div class="tw-division-check">✓</div>
            </label>
          `).join('')}
        </div>
        
        <div class="tw-quick-actions">
          <button class="tw-quick-btn" data-action="all">Select All</button>
          <button class="tw-quick-btn" data-action="none">Clear</button>
        </div>
      `,
      next: () => {
        const chosen = [...wizardEl.querySelectorAll('input[type=checkbox]:checked')]
          .map(i => i.value);

        if (!chosen.length) {
          showToast("Please select at least one division", "warning");
          return;
        }

        travelingDivisions = chosen;
        tripManifest = chosen.map(d => ({ division: d }));
        updateLivePreview();
        stepTripDetails();
      },
      setup: () => {
        wizardEl.querySelectorAll('.tw-quick-btn').forEach(btn => {
          btn.onclick = () => {
            const action = btn.dataset.action;
            wizardEl.querySelectorAll('input[type=checkbox]').forEach(cb => {
              cb.checked = action === 'all';
              cb.closest('.tw-division-card').classList.toggle('selected', cb.checked);
            });
          };
        });

        wizardEl.querySelectorAll('.tw-division-card input').forEach(cb => {
          cb.onchange = () => {
            cb.closest('.tw-division-card').classList.toggle('selected', cb.checked);
          };
        });
      }
    });
  }

  // ------------------------------------------------------------
  // STEP 2 — TRIP DETAILS
  // ------------------------------------------------------------
  function stepTripDetails() {
    renderStep({
      title: "Trip Details",
      subtitle: "Where and when is this trip happening?",
      body: `
        <div class="tw-form-card">
          <div class="tw-form-section">
            <label class="tw-label">
              <span class="tw-label-icon">📍</span>
              Destination
            </label>
            <input type="text" id="tw-dest" placeholder="e.g., Zoo, Museum, Water Park" class="tw-input">
          </div>

          <div class="tw-form-divider"></div>

          <div class="tw-form-row">
            <div class="tw-form-section">
              <label class="tw-label">
                <span class="tw-label-icon">🚌</span>
                Departure
              </label>
              <input type="text" id="tw-start" placeholder="10:00am" class="tw-input tw-input-time">
            </div>

            <div class="tw-form-arrow">→</div>

            <div class="tw-form-section">
              <label class="tw-label">
                <span class="tw-label-icon">🏕️</span>
                Return
              </label>
              <input type="text" id="tw-end" placeholder="2:30pm" class="tw-input tw-input-time">
            </div>
          </div>

          <div class="tw-duration-display" id="tw-duration"></div>
        </div>

        <div class="tw-helper-text">
          <strong>Tip:</strong> We'll analyze what activities conflict with this time window and help you reschedule them.
        </div>
      `,
      next: () => {
        const dest = wizardEl.querySelector('#tw-dest').value.trim();
        const start = wizardEl.querySelector('#tw-start').value.trim();
        const end = wizardEl.querySelector('#tw-end').value.trim();

        const sMin = toMin(start);
        const eMin = toMin(end);

        if (!dest) {
          showToast("Please enter a destination", "warning");
          return;
        }

        if (sMin == null || eMin == null) {
          showToast("Please enter valid times (e.g., '10:00am')", "warning");
          return;
        }

        if (eMin <= sMin) {
          showToast("Return time must be after departure", "warning");
          return;
        }

        tripManifest.forEach(t => {
          t.destination = dest;
          t.start = start;
          t.end = end;
        });

        // Add trip blocks
        tripManifest.forEach(t => {
          const change = {
            division: t.division,
            action: 'add',
            type: 'pinned',
            event: `Trip: ${t.destination}`,
            startTime: t.start,
            endTime: t.end,
            reservedFields: [],
            decisionId: 'trip_' + Date.now()
          };
          plannedChanges.push(change);
          applyChangeToWorkingSkeleton(change);
        });

        // Analyze conflicts before proceeding
        showConflictAnalysis();
      },
      setup: () => {
        const startInput = wizardEl.querySelector('#tw-start');
        const endInput = wizardEl.querySelector('#tw-end');
        const durationEl = wizardEl.querySelector('#tw-duration');

        const updateDuration = () => {
          const s = toMin(startInput.value);
          const e = toMin(endInput.value);
          if (s != null && e != null && e > s) {
            durationEl.innerHTML = `<span class="tw-duration-label">Trip Duration:</span> ${formatDuration(e - s)}`;
            durationEl.style.display = 'block';
          } else {
            durationEl.style.display = 'none';
          }
        };

        startInput.oninput = updateDuration;
        endInput.oninput = updateDuration;
      }
    });
  }

  // ------------------------------------------------------------
  // CONFLICT ANALYSIS OVERVIEW
  // ------------------------------------------------------------
  function showConflictAnalysis() {
    // Gather all conflicts across traveling divisions
    const allConflicts = [];

    tripManifest.forEach(trip => {
      const originalBlocks = fullDaySkeleton[trip.division] || [];
      const conflicts = originalBlocks.filter(b =>
        overlaps(b.startTime, b.endTime, trip.start, trip.end)
      );

      conflicts.forEach(c => {
        allConflicts.push({
          division: trip.division,
          trip,
          block: c
        });
      });
    });

    if (allConflicts.length === 0) {
      showToast("No conflicts found! The trip fits perfectly.", "success");
      showFinalPreview();
      return;
    }

    // Group conflicts by type
    const grouped = {
      lunch: allConflicts.filter(c => (c.block.event || '').toLowerCase().includes('lunch')),
      swim: allConflicts.filter(c => (c.block.event || '').toLowerCase().includes('swim')),
      snack: allConflicts.filter(c => (c.block.event || '').toLowerCase().includes('snack')),
      league: allConflicts.filter(c => (c.block.event || '').toLowerCase().includes('league')),
      other: allConflicts.filter(c => {
        const evt = (c.block.event || '').toLowerCase();
        return !evt.includes('lunch') && !evt.includes('swim') &&
          !evt.includes('snack') && !evt.includes('league');
      })
    };

    renderStep({
      title: "Schedule Conflicts Found",
      subtitle: `${allConflicts.length} activit${allConflicts.length === 1 ? 'y' : 'ies'} need to be rescheduled`,
      body: `
        <div class="tw-conflict-overview">
          ${Object.entries(grouped).filter(([_, items]) => items.length > 0).map(([type, items]) => `
            <div class="tw-conflict-category ${type}">
              <div class="tw-conflict-icon">${getIconForEvent(type)}</div>
              <div class="tw-conflict-info">
                <div class="tw-conflict-type">${capitalizeFirst(type)}</div>
                <div class="tw-conflict-count">${items.length} conflict${items.length > 1 ? 's' : ''}</div>
              </div>
              <div class="tw-conflict-divisions">
                ${[...new Set(items.map(i => i.division))].join(', ')}
              </div>
            </div>
          `).join('')}
        </div>

        <div class="tw-resolution-options">
          <button class="tw-resolve-btn auto" id="auto-resolve">
            <span class="tw-resolve-icon">✨</span>
            <div class="tw-resolve-content">
              <div class="tw-resolve-title">Smart Auto-Resolve</div>
              <div class="tw-resolve-desc">Let us suggest optimal times for everything</div>
            </div>
          </button>

          <button class="tw-resolve-btn manual" id="manual-resolve">
            <span class="tw-resolve-icon">🎛️</span>
            <div class="tw-resolve-content">
              <div class="tw-resolve-title">Resolve One by One</div>
              <div class="tw-resolve-desc">Make each decision yourself</div>
            </div>
          </button>
        </div>
      `,
      hideNext: true,
      setup: () => {
        wizardEl.querySelector('#auto-resolve').onclick = () => {
          autoResolveAllConflicts(allConflicts);
        };

        wizardEl.querySelector('#manual-resolve').onclick = () => {
          startManualResolution(allConflicts);
        };
      }
    });
  }

  function capitalizeFirst(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  // ------------------------------------------------------------
  // AUTO-RESOLVE (SMART SUGGESTIONS)
  // ------------------------------------------------------------
  function autoResolveAllConflicts(conflicts) {
    const suggestions = [];

    conflicts.forEach(conflict => {
      const { division, trip, block } = conflict;
      const evt = (block.event || '').toLowerCase();
      const duration = getDuration(block.startTime, block.endTime);

      let suggestion = null;

      if (evt.includes('lunch')) {
        // Lunch: Prefer eating during trip (pack) or immediately after return
        suggestion = {
          type: 'lunch',
          recommendation: 'during',
          reason: 'Pack lunch for the trip - most flexible option',
          action: 'remove'
        };
      } else if (evt.includes('swim')) {
        // Swim: Find best available slot after trip
        const slots = findBestSwimSlot(division, trip.end);
        if (slots.length > 0) {
          const best = slots[0];
          suggestion = {
            type: 'swim',
            recommendation: 'reschedule',
            newStart: best.start,
            newEnd: best.end,
            reason: `Best available pool time after returning`,
            action: 'replace'
          };
        } else {
          suggestion = {
            type: 'swim',
            recommendation: 'skip',
            reason: 'No available pool slots today',
            action: 'remove'
          };
        }
      } else if (evt.includes('snack')) {
        // Snack: Pack for trip
        suggestion = {
          type: 'snack',
          recommendation: 'pack',
          reason: 'Bring snacks on the trip',
          action: 'remove'
        };
      } else if (evt.includes('league')) {
        // League: Try to move to different time, else reschedule for another day
        const slots = findAvailableSlots(division, duration, { preferAfter: trip.end });
        if (slots.length > 0 && slots[0].gapSize >= duration) {
          const best = slots[0];
          suggestion = {
            type: 'league',
            recommendation: 'reschedule_today',
            newStart: best.start,
            newEnd: toTime(toMin(best.start) + duration),
            reason: 'Moved to available slot',
            action: 'replace'
          };
        } else {
          suggestion = {
            type: 'league',
            recommendation: 'reschedule_later',
            reason: 'No time today - reschedule for another day',
            action: 'remove'
          };
        }
      } else {
        // Generic: Try to reschedule after trip
        const slots = findAvailableSlots(division, duration, { preferAfter: trip.end });
        if (slots.length > 0) {
          const best = slots[0];
          suggestion = {
            type: 'other',
            recommendation: 'reschedule',
            newStart: best.start,
            newEnd: toTime(toMin(best.start) + duration),
            reason: 'Moved to available slot',
            action: 'replace'
          };
        } else {
          suggestion = {
            type: 'other',
            recommendation: 'skip',
            reason: 'No available time slots',
            action: 'remove'
          };
        }
      }

      suggestions.push({
        conflict,
        suggestion
      });
    });

    showAutoResolveSuggestions(suggestions);
  }

  function showAutoResolveSuggestions(suggestions) {
    renderStep({
      title: "Smart Suggestions",
      subtitle: "Review and approve these recommended changes",
      body: `
        <div class="tw-suggestions-list">
          ${suggestions.map((s, i) => {
        const { conflict, suggestion } = s;
        const block = conflict.block;

        return `
              <div class="tw-suggestion-card" data-index="${i}">
                <div class="tw-suggestion-header">
                  <span class="tw-suggestion-division">${conflict.division}</span>
                  <span class="tw-suggestion-event">${block.event}</span>
                </div>
                
                <div class="tw-suggestion-body">
                  <div class="tw-suggestion-original">
                    <span class="tw-suggestion-label">Was</span>
                    <span class="tw-suggestion-time">${block.startTime} – ${block.endTime}</span>
                  </div>
                  
                  <div class="tw-suggestion-arrow">→</div>
                  
                  <div class="tw-suggestion-new ${suggestion.action}">
                    <span class="tw-suggestion-label">Now</span>
                    ${suggestion.action === 'remove'
            ? `<span class="tw-suggestion-removed">${getSuggestionLabel(suggestion)}</span>`
            : `<span class="tw-suggestion-time">${suggestion.newStart} – ${suggestion.newEnd}</span>`
          }
                  </div>
                </div>
                
                <div class="tw-suggestion-reason">
                  <span class="tw-reason-icon">💡</span>
                  ${suggestion.reason}
                </div>
                
                <div class="tw-suggestion-actions">
                  <button class="tw-accept-btn" data-index="${i}">Accept</button>
                  <button class="tw-modify-btn" data-index="${i}">Modify</button>
                </div>
              </div>
            `;
      }).join('')}
        </div>

        <div class="tw-bulk-actions">
          <button class="tw-bulk-btn accept-all" id="accept-all">
            ✓ Accept All Suggestions
          </button>
        </div>
      `,
      hideNext: true,
      setup: () => {
        const accepted = new Set();

        wizardEl.querySelectorAll('.tw-accept-btn').forEach(btn => {
          btn.onclick = () => {
            const idx = parseInt(btn.dataset.index);
            const card = wizardEl.querySelector(`.tw-suggestion-card[data-index="${idx}"]`);
            card.classList.add('accepted');
            btn.textContent = '✓ Accepted';
            btn.disabled = true;
            accepted.add(idx);

            if (accepted.size === suggestions.length) {
              applyAllSuggestions(suggestions);
            }
          };
        });

        wizardEl.querySelectorAll('.tw-modify-btn').forEach(btn => {
          btn.onclick = () => {
            const idx = parseInt(btn.dataset.index);
            const { conflict, suggestion } = suggestions[idx];
            // Go to manual resolution for this specific conflict
            handleSpecificConflict(conflict, () => {
              // After handling, refresh this view
              showAutoResolveSuggestions(suggestions.filter((_, i) => i !== idx));
            });
          };
        });

        wizardEl.querySelector('#accept-all').onclick = () => {
          applyAllSuggestions(suggestions);
        };
      }
    });
  }

  function getSuggestionLabel(suggestion) {
    if (suggestion.recommendation === 'during' || suggestion.recommendation === 'pack') {
      return 'Packed for trip';
    }
    if (suggestion.recommendation === 'skip') {
      return 'Skipped today';
    }
    if (suggestion.recommendation === 'reschedule_later') {
      return 'Reschedule later';
    }
    return 'Removed';
  }

  function applyAllSuggestions(suggestions) {
    const decisionId = 'auto_' + Date.now();

    suggestions.forEach(({ conflict, suggestion }) => {
      const { division, block } = conflict;

      if (suggestion.action === 'remove') {
        const change = {
          division,
          action: 'remove',
          oldEvent: block,
          reason: suggestion.reason,
          decisionId
        };
        plannedChanges.push(change);
        applyChangeToWorkingSkeleton(change);
      } else if (suggestion.action === 'replace') {
        const change = {
          division,
          action: 'replace',
          oldEvent: block,
          type: block.type || 'pinned',
          event: block.event,
          startTime: suggestion.newStart,
          endTime: suggestion.newEnd,
          reservedFields: block.reservedFields || [],
          decisionId
        };
        plannedChanges.push(change);
        applyChangeToWorkingSkeleton(change);
      }
    });

    decisionHistory.push({ id: decisionId, type: 'auto', count: suggestions.length });
    showFinalPreview();
  }

  // ------------------------------------------------------------
  // MANUAL RESOLUTION
  // ------------------------------------------------------------
  function startManualResolution(conflicts) {
    handleNextConflictManual(conflicts, 0);
  }

  function handleNextConflictManual(conflicts, index) {
    if (index >= conflicts.length) {
      handlePendingQuestions();
      return;
    }

    handleSpecificConflict(conflicts[index], () => {
      handleNextConflictManual(conflicts, index + 1);
    });
  }

  function handleSpecificConflict(conflict, next) {
    const { division, trip, block } = conflict;
    const evt = (block.event || '').toLowerCase();

    if (evt.includes('lunch')) {
      handleLunchConflict(trip, block, next);
    } else if (evt.includes('swim')) {
      handleSwimConflict(trip, block, next);
    } else if (evt.includes('snack')) {
      handleSnackConflict(trip, block, next);
    } else if (evt.includes('league')) {
      handleLeagueConflict(trip, block, next);
    } else {
      handleGenericConflict(trip, block, next);
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
  // CONFLICT HANDLERS (with smart suggestions)
  // ------------------------------------------------------------

  function handleLunchConflict(trip, conflict, next) {
    const duration = getDuration(conflict.startTime, conflict.endTime) || 30;
    const beforeSlots = findAvailableSlots(trip.division, duration, { preferBefore: trip.start });
    const afterSlots = findAvailableSlots(trip.division, duration, { preferAfter: trip.end });

    const beforeSuggestion = beforeSlots.length > 0 ? beforeSlots[0] : null;
    const afterSuggestion = afterSlots.length > 0 ? afterSlots[0] : null;

    renderStep({
      title: `${trip.division} — Lunch`,
      subtitle: `Currently ${conflict.startTime}–${conflict.endTime}, but they'll be on the trip`,
      body: `
        <div class="tw-conflict-visual">
          <div class="tw-visual-block trip">
            <div class="tw-visual-label">Trip</div>
            <div class="tw-visual-time">${trip.start} – ${trip.end}</div>
          </div>
          <div class="tw-visual-overlap">⚠️</div>
          <div class="tw-visual-block conflict">
            <div class="tw-visual-label">Lunch</div>
            <div class="tw-visual-time">${conflict.startTime} – ${conflict.endTime}</div>
          </div>
        </div>

        <div class="tw-options-smart">
          <button class="tw-smart-option recommended" data-choice="during">
            <div class="tw-smart-icon">🎒</div>
            <div class="tw-smart-content">
              <div class="tw-smart-title">Pack Lunch for Trip</div>
              <div class="tw-smart-desc">Eat during the trip or at destination</div>
            </div>
            <span class="tw-recommended-badge">Recommended</span>
          </button>

          ${beforeSuggestion ? `
            <button class="tw-smart-option" data-choice="before">
              <div class="tw-smart-icon">⏰</div>
              <div class="tw-smart-content">
                <div class="tw-smart-title">Lunch Before Trip</div>
                <div class="tw-smart-desc">${beforeSuggestion.start} – ${beforeSuggestion.end}</div>
              </div>
            </button>
          ` : ''}

          ${afterSuggestion ? `
            <button class="tw-smart-option" data-choice="after">
              <div class="tw-smart-icon">🍽️</div>
              <div class="tw-smart-content">
                <div class="tw-smart-title">Lunch After Return</div>
                <div class="tw-smart-desc">${afterSuggestion.start} – ${afterSuggestion.end}</div>
              </div>
            </button>
          ` : ''}

          <button class="tw-smart-option secondary" data-choice="custom">
            <div class="tw-smart-icon">✏️</div>
            <div class="tw-smart-content">
              <div class="tw-smart-title">Choose Custom Time</div>
            </div>
          </button>
        </div>

        <div id="custom-time" style="display:none;" class="tw-custom-panel">
          <div class="tw-custom-header">Custom Lunch Time</div>
          ${renderAvailableSlots(trip.division, duration, trip.start, trip.end)}
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
          <button id="apply-custom" class="tw-btn-primary">Apply Time</button>
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
        wizardEl.querySelectorAll('.tw-smart-option').forEach(btn => {
          btn.onclick = () => {
            const choice = btn.dataset.choice;

            if (choice === 'during') {
              applyRemoval(trip.division, conflict, 'Packed for trip', next);
              return;
            }

            if (choice === 'custom') {
              document.getElementById('custom-time').style.display = 'block';
              return;
            }

            let start, end;
            if (choice === 'before' && beforeSuggestion) {
              start = beforeSuggestion.start;
              end = beforeSuggestion.end;
            } else if (choice === 'after' && afterSuggestion) {
              start = afterSuggestion.start;
              end = afterSuggestion.end;
            }

            if (start && end) {
              applyTimeWithConflictCheck(trip.division, conflict, 'Lunch', start, end, next);
            }
          };
        });

        setupCustomTimeHandler('lunch-start', 'lunch-end', 'apply-custom', (start, end) => {
          applyTimeWithConflictCheck(trip.division, conflict, 'Lunch', start, end, next);
        });
      }
    });
  }

  function handleSwimConflict(trip, conflict, next) {
    const duration = getDuration(conflict.startTime, conflict.endTime) || 45;
    const slots = findBestSwimSlot(trip.division, trip.end);

    const bestSlot = slots.length > 0 ? slots[0] : null;
    const altSlot = slots.length > 1 ? slots[1] : null;

    renderStep({
      title: `${trip.division} — Swim`,
      subtitle: `Currently ${conflict.startTime}–${conflict.endTime}, conflicts with trip`,
      body: `
        <div class="tw-conflict-visual">
          <div class="tw-visual-block trip">
            <div class="tw-visual-label">Trip</div>
            <div class="tw-visual-time">${trip.start} – ${trip.end}</div>
          </div>
          <div class="tw-visual-overlap">⚠️</div>
          <div class="tw-visual-block conflict swim">
            <div class="tw-visual-label">Swim</div>
            <div class="tw-visual-time">${conflict.startTime} – ${conflict.endTime}</div>
          </div>
        </div>

        <div class="tw-pool-info">
          <span class="tw-pool-icon">🏊</span>
          Pool availability checked across all divisions
        </div>

        <div class="tw-options-smart">
          ${bestSlot ? `
            <button class="tw-smart-option recommended" data-choice="best">
              <div class="tw-smart-icon">✨</div>
              <div class="tw-smart-content">
                <div class="tw-smart-title">Best Available Slot</div>
                <div class="tw-smart-desc">${bestSlot.start} – ${bestSlot.end}</div>
              </div>
              <span class="tw-recommended-badge">Recommended</span>
            </button>
          ` : ''}

          ${altSlot ? `
            <button class="tw-smart-option" data-choice="alt">
              <div class="tw-smart-icon">🔄</div>
              <div class="tw-smart-content">
                <div class="tw-smart-title">Alternative Slot</div>
                <div class="tw-smart-desc">${altSlot.start} – ${altSlot.end}</div>
              </div>
            </button>
          ` : ''}

          <button class="tw-smart-option secondary" data-choice="custom">
            <div class="tw-smart-icon">✏️</div>
            <div class="tw-smart-content">
              <div class="tw-smart-title">Choose Custom Time</div>
            </div>
          </button>

          <button class="tw-smart-option danger" data-choice="skip">
            <div class="tw-smart-icon">⏭️</div>
            <div class="tw-smart-content">
              <div class="tw-smart-title">Skip Swim Today</div>
              <div class="tw-smart-desc">No swim for this division</div>
            </div>
          </button>
        </div>

        <div id="custom-time" style="display:none;" class="tw-custom-panel">
          <div class="tw-custom-header">Custom Swim Time</div>
          ${renderAvailableSlots(trip.division, duration, trip.start, trip.end, true)}
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
          <button id="apply-custom" class="tw-btn-primary">Apply Time</button>
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
        wizardEl.querySelectorAll('.tw-smart-option').forEach(btn => {
          btn.onclick = () => {
            const choice = btn.dataset.choice;

            if (choice === 'skip') {
              applyRemoval(trip.division, conflict, 'Skipped', next);
              return;
            }

            if (choice === 'custom') {
              document.getElementById('custom-time').style.display = 'block';
              return;
            }

            let slot = null;
            if (choice === 'best' && bestSlot) slot = bestSlot;
            else if (choice === 'alt' && altSlot) slot = altSlot;

            if (slot) {
              applyTimeWithConflictCheck(trip.division, conflict, 'Swim', slot.start, slot.end, next, ['Pool']);
            }
          };
        });

        setupCustomTimeHandler('swim-start', 'swim-end', 'apply-custom', (start, end) => {
          applyTimeWithConflictCheck(trip.division, conflict, 'Swim', start, end, next, ['Pool']);
        });
      }
    });
  }

  function handleSnackConflict(trip, conflict, next) {
    renderStep({
      title: `${trip.division} — Snack`,
      subtitle: `Currently ${conflict.startTime}–${conflict.endTime}, conflicts with trip`,
      body: `
        <div class="tw-options-smart">
          <button class="tw-smart-option recommended" data-choice="pack">
            <div class="tw-smart-icon">🎒</div>
            <div class="tw-smart-content">
              <div class="tw-smart-title">Pack Snacks</div>
              <div class="tw-smart-desc">Bring snacks on the trip</div>
            </div>
            <span class="tw-recommended-badge">Recommended</span>
          </button>

          <button class="tw-smart-option" data-choice="before">
            <div class="tw-smart-icon">⏰</div>
            <div class="tw-smart-content">
              <div class="tw-smart-title">Snack Before Trip</div>
              <div class="tw-smart-desc">${subtractMinutes(trip.start, 15)} – ${trip.start}</div>
            </div>
          </button>

          <button class="tw-smart-option" data-choice="after">
            <div class="tw-smart-icon">🍎</div>
            <div class="tw-smart-content">
              <div class="tw-smart-title">Snack After Return</div>
              <div class="tw-smart-desc">${trip.end} – ${addMinutes(trip.end, 15)}</div>
            </div>
          </button>

          <button class="tw-smart-option danger" data-choice="skip">
            <div class="tw-smart-icon">⏭️</div>
            <div class="tw-smart-content">
              <div class="tw-smart-title">Skip Snack</div>
            </div>
          </button>
        </div>
      `,
      hideNext: true,
      setup: () => {
        wizardEl.querySelectorAll('.tw-smart-option').forEach(btn => {
          btn.onclick = () => {
            const choice = btn.dataset.choice;

            if (choice === 'pack' || choice === 'skip') {
              applyRemoval(trip.division, conflict, choice === 'pack' ? 'Packed for trip' : 'Skipped', next);
              return;
            }

            let start, end;
            if (choice === 'before') {
              start = subtractMinutes(trip.start, 15);
              end = trip.start;
            } else {
              start = trip.end;
              end = addMinutes(trip.end, 15);
            }

            applyTimeWithConflictCheck(trip.division, conflict, 'Snack', start, end, next);
          };
        });
      }
    });
  }

  function handleLeagueConflict(trip, conflict, next) {
    const duration = getDuration(conflict.startTime, conflict.endTime) || 60;
    const beforeSlots = findAvailableSlots(trip.division, duration, { preferBefore: trip.start });
    const afterSlots = findAvailableSlots(trip.division, duration, { preferAfter: trip.end });

    const canPlayBefore = beforeSlots.length > 0;
    const canPlayAfter = afterSlots.length > 0;

    renderStep({
      title: `${trip.division} — League Game`,
      subtitle: `Game at ${conflict.startTime}–${conflict.endTime} conflicts with trip`,
      body: `
        <div class="tw-info-box warning">
          <span class="tw-info-icon">⚠️</span>
          Opposing teams will need to be notified of any changes
        </div>

        <div class="tw-options-smart">
          ${canPlayBefore ? `
            <button class="tw-smart-option" data-choice="before">
              <div class="tw-smart-icon">⏰</div>
              <div class="tw-smart-content">
                <div class="tw-smart-title">Play Before Trip</div>
                <div class="tw-smart-desc">${beforeSlots[0].start} – ${toTime(toMin(beforeSlots[0].start) + duration)}</div>
              </div>
            </button>
          ` : ''}

          ${canPlayAfter ? `
            <button class="tw-smart-option" data-choice="after">
              <div class="tw-smart-icon">🏆</div>
              <div class="tw-smart-content">
                <div class="tw-smart-title">Play After Return</div>
                <div class="tw-smart-desc">${afterSlots[0].start} – ${toTime(toMin(afterSlots[0].start) + duration)}</div>
              </div>
            </button>
          ` : ''}

          <button class="tw-smart-option recommended" data-choice="reschedule">
            <div class="tw-smart-icon">📅</div>
            <div class="tw-smart-content">
              <div class="tw-smart-title">Reschedule for Another Day</div>
              <div class="tw-smart-desc">Coordinate with schedule later</div>
            </div>
            ${!canPlayBefore && !canPlayAfter ? '<span class="tw-recommended-badge">Recommended</span>' : ''}
          </button>

          <button class="tw-smart-option danger" data-choice="cancel">
            <div class="tw-smart-icon">❌</div>
            <div class="tw-smart-content">
              <div class="tw-smart-title">Cancel Game</div>
            </div>
          </button>
        </div>
      `,
      hideNext: true,
      setup: () => {
        wizardEl.querySelectorAll('.tw-smart-option').forEach(btn => {
          btn.onclick = () => {
            const choice = btn.dataset.choice;

            if (choice === 'reschedule' || choice === 'cancel') {
              applyRemoval(trip.division, conflict, choice === 'reschedule' ? 'Rescheduled' : 'Cancelled', next);
              return;
            }

            let slot = null;
            if (choice === 'before' && canPlayBefore) slot = beforeSlots[0];
            else if (choice === 'after' && canPlayAfter) slot = afterSlots[0];

            if (slot) {
              const newEnd = toTime(toMin(slot.start) + duration);
              applyTimeWithConflictCheck(trip.division, conflict, conflict.event, slot.start, newEnd, next);
            }
          };
        });
      }
    });
  }

  function handleGenericConflict(trip, conflict, next) {
    const duration = getDuration(conflict.startTime, conflict.endTime) || 45;
    const slots = findAvailableSlots(trip.division, duration, { preferAfter: trip.end });
    const hasSlots = slots.length > 0;

    renderStep({
      title: `${trip.division} — ${conflict.event}`,
      subtitle: `${conflict.startTime}–${conflict.endTime} conflicts with trip`,
      body: `
        <div class="tw-options-smart">
          ${hasSlots ? `
            <button class="tw-smart-option recommended" data-choice="move">
              <div class="tw-smart-icon">📍</div>
              <div class="tw-smart-content">
                <div class="tw-smart-title">Move to Available Slot</div>
                <div class="tw-smart-desc">${slots[0].start} – ${toTime(toMin(slots[0].start) + duration)}</div>
              </div>
              <span class="tw-recommended-badge">Recommended</span>
            </button>
          ` : ''}

          <button class="tw-smart-option secondary" data-choice="custom">
            <div class="tw-smart-icon">✏️</div>
            <div class="tw-smart-content">
              <div class="tw-smart-title">Choose Custom Time</div>
            </div>
          </button>

          <button class="tw-smart-option danger" data-choice="skip">
            <div class="tw-smart-icon">⏭️</div>
            <div class="tw-smart-content">
              <div class="tw-smart-title">Skip for Today</div>
            </div>
          </button>
        </div>

        <div id="custom-time" style="display:none;" class="tw-custom-panel">
          <div class="tw-custom-header">Custom Time</div>
          ${renderAvailableSlots(trip.division, duration, trip.start, trip.end)}
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
          <button id="apply-custom" class="tw-btn-primary">Apply Time</button>
        </div>
      `,
      hideNext: true,
      setup: () => {
        wizardEl.querySelectorAll('.tw-smart-option').forEach(btn => {
          btn.onclick = () => {
            const choice = btn.dataset.choice;

            if (choice === 'skip') {
              applyRemoval(trip.division, conflict, 'Skipped', next);
              return;
            }

            if (choice === 'custom') {
              document.getElementById('custom-time').style.display = 'block';
              return;
            }

            if (choice === 'move' && hasSlots) {
              const slot = slots[0];
              const newEnd = toTime(toMin(slot.start) + duration);
              applyTimeWithConflictCheck(trip.division, conflict, conflict.event, slot.start, newEnd, next);
            }
          };
        });

        setupCustomTimeHandler('generic-start', 'generic-end', 'apply-custom', (start, end) => {
          applyTimeWithConflictCheck(trip.division, conflict, conflict.event, start, end, next);
        });
      }
    });
  }

  // ------------------------------------------------------------
  // HELPER: Render available slots visual
  // ------------------------------------------------------------
  function renderAvailableSlots(division, duration, tripStart, tripEnd, checkPool = false) {
    const slots = findAvailableSlots(division, duration, {
      avoidTrip: true,
      checkPool
    });

    if (slots.length === 0) {
      return `<div class="tw-no-slots">No available time slots found</div>`;
    }

    return `
      <div class="tw-available-slots">
        <div class="tw-slots-label">Available times:</div>
        <div class="tw-slots-list">
          ${slots.slice(0, 5).map(slot => `
            <button class="tw-slot-chip" data-start="${slot.start}" data-end="${slot.end}">
              ${slot.start} – ${slot.end}
            </button>
          `).join('')}
        </div>
      </div>
    `;
  }

  function setupCustomTimeHandler(startId, endId, btnId, callback) {
    const applyBtn = wizardEl.querySelector(`#${btnId}`);
    const startInput = wizardEl.querySelector(`#${startId}`);
    const endInput = wizardEl.querySelector(`#${endId}`);

    // Wire up slot chips
    wizardEl.querySelectorAll('.tw-slot-chip').forEach(chip => {
      chip.onclick = () => {
        startInput.value = chip.dataset.start;
        endInput.value = chip.dataset.end;
        wizardEl.querySelectorAll('.tw-slot-chip').forEach(c => c.classList.remove('selected'));
        chip.classList.add('selected');
      };
    });

    if (applyBtn) {
      applyBtn.onclick = () => {
        const start = startInput.value.trim();
        const end = endInput.value.trim();

        if (toMin(start) == null || toMin(end) == null || toMin(end) <= toMin(start)) {
          showToast("Please enter valid times", "warning");
          return;
        }

        callback(start, end);
      };
    }
  }

  // ------------------------------------------------------------
  // APPLY CHANGES WITH CONFLICT CHECKING
  // ------------------------------------------------------------
  function applyRemoval(division, oldBlock, reason, next) {
    const decisionId = 'decision_' + Date.now();
    const change = {
      division,
      action: 'remove',
      oldEvent: oldBlock,
      reason,
      decisionId
    };
    plannedChanges.push(change);
    applyChangeToWorkingSkeleton(change);
    decisionHistory.push({ id: decisionId, type: 'remove' });
    next();
  }

  function applyTimeWithConflictCheck(division, oldBlock, eventName, startTime, endTime, afterResolve, reservedFields = []) {
    // Check for conflicts within the division
    const sameDivConflicts = detectConflicts(division, startTime, endTime, oldBlock.id);

    // Check for pool conflicts if swim
    let crossDivConflicts = [];
    if (eventName.toLowerCase().includes('swim')) {
      crossDivConflicts = detectCrossDivisionConflicts('swim', startTime, endTime, division);
    }

    if (sameDivConflicts.length > 0) {
      handleCascadeConflict(division, eventName, startTime, endTime, oldBlock, sameDivConflicts, afterResolve, reservedFields);
    } else if (crossDivConflicts.length > 0) {
      handlePoolConflict(division, eventName, startTime, endTime, oldBlock, crossDivConflicts[0], afterResolve, reservedFields);
    } else {
      applyTimeChange(division, oldBlock, eventName, startTime, endTime, afterResolve, reservedFields);
    }
  }

  function handleCascadeConflict(division, newActivity, startTime, endTime, originalBlock, conflicts, afterResolve, reservedFields) {
    const conflict = conflicts[0];

    // Find alternative times
    const duration = getDuration(startTime, endTime);
    const altSlots = findAvailableSlots(division, duration, {
      excludeIds: [originalBlock.id]
    });

    renderStep({
      title: "Time Conflict Detected",
      subtitle: `${newActivity} would overlap with ${conflict.event}`,
      body: `
        <div class="tw-cascade-visual">
          <div class="tw-cascade-item trying">
            <div class="tw-cascade-label">Trying to place</div>
            <div class="tw-cascade-event">${newActivity}</div>
            <div class="tw-cascade-time">${startTime} – ${endTime}</div>
          </div>
          
          <div class="tw-cascade-conflict">
            <span>⚠️ Conflicts with</span>
          </div>
          
          <div class="tw-cascade-item blocking">
            <div class="tw-cascade-label">Already scheduled</div>
            <div class="tw-cascade-event">${conflict.event}</div>
            <div class="tw-cascade-time">${conflict.startTime} – ${conflict.endTime}</div>
          </div>
        </div>

        <div class="tw-options-smart">
          ${altSlots.length > 0 ? `
            <button class="tw-smart-option recommended" data-choice="different">
              <div class="tw-smart-icon">📍</div>
              <div class="tw-smart-content">
                <div class="tw-smart-title">Move ${newActivity} Instead</div>
                <div class="tw-smart-desc">Available: ${altSlots[0].start} – ${altSlots[0].end}</div>
              </div>
              <span class="tw-recommended-badge">Recommended</span>
            </button>
          ` : ''}

          <button class="tw-smart-option" data-choice="move-conflict">
            <div class="tw-smart-icon">🔄</div>
            <div class="tw-smart-content">
              <div class="tw-smart-title">Move ${conflict.event} Out of the Way</div>
              <div class="tw-smart-desc">Keep ${newActivity} at ${startTime}</div>
            </div>
          </button>

          <button class="tw-smart-option danger" data-choice="remove-conflict">
            <div class="tw-smart-icon">⏭️</div>
            <div class="tw-smart-content">
              <div class="tw-smart-title">Skip ${conflict.event} Today</div>
            </div>
          </button>
        </div>

        <div id="move-panel" style="display:none;" class="tw-custom-panel">
          <div class="tw-custom-header">New time for ${conflict.event}</div>
          <div class="tw-form-row">
            <div class="tw-form-section">
              <label class="tw-label">Start</label>
              <input type="text" id="move-start" class="tw-input">
            </div>
            <div class="tw-form-section">
              <label class="tw-label">End</label>
              <input type="text" id="move-end" class="tw-input">
            </div>
          </div>
          <button id="apply-move" class="tw-btn-primary">Apply</button>
        </div>
      `,
      hideNext: true,
      setup: () => {
        wizardEl.querySelectorAll('.tw-smart-option').forEach(btn => {
          btn.onclick = () => {
            const choice = btn.dataset.choice;

            if (choice === 'different' && altSlots.length > 0) {
              const slot = altSlots[0];
              applyTimeChange(division, originalBlock, newActivity, slot.start, slot.end, afterResolve, reservedFields);
            } else if (choice === 'move-conflict') {
              document.getElementById('move-panel').style.display = 'block';
            } else if (choice === 'remove-conflict') {
              applyRemoval(division, conflict, `Removed for ${newActivity}`, () => {
                applyTimeChange(division, originalBlock, newActivity, startTime, endTime, afterResolve, reservedFields);
              });
            }
          };
        });

        const moveBtn = wizardEl.querySelector('#apply-move');
        if (moveBtn) {
          moveBtn.onclick = () => {
            const moveStart = wizardEl.querySelector('#move-start').value.trim();
            const moveEnd = wizardEl.querySelector('#move-end').value.trim();

            if (toMin(moveStart) == null || toMin(moveEnd) == null) {
              showToast("Please enter valid times", "warning");
              return;
            }

            // Check if this creates more conflicts
            const moreConflicts = detectConflicts(division, moveStart, moveEnd, conflict.id);
            if (moreConflicts.length > 0) {
              showToast(`That time conflicts with ${moreConflicts[0].event}`, "error");
              return;
            }

            // Move the blocking event, then place our new event
            applyTimeChange(division, conflict, conflict.event, moveStart, moveEnd, () => {
              applyTimeChange(division, originalBlock, newActivity, startTime, endTime, afterResolve, reservedFields);
            });
          };
        }
      }
    });
  }

  function handlePoolConflict(sourceDivision, newActivity, startTime, endTime, originalBlock, crossConflict, afterResolve, reservedFields) {
    const targetDivision = crossConflict.division;
    const targetBlock = crossConflict.block;

    // Find alternative pool times
    const duration = getDuration(startTime, endTime);
    const altSlots = findBestSwimSlot(sourceDivision, tripManifest.find(t => t.division === sourceDivision)?.end || '2:00pm');

    renderStep({
      title: "Pool Scheduling Conflict",
      subtitle: `${targetDivision} already has the pool at this time`,
      body: `
        <div class="tw-pool-conflict">
          <div class="tw-pool-visual">
            <div class="tw-pool-block source">
              <div class="tw-pool-division">${sourceDivision}</div>
              <div class="tw-pool-time">${startTime} – ${endTime}</div>
              <div class="tw-pool-status">Wants pool</div>
            </div>
            
            <div class="tw-pool-icon">🏊</div>
            
            <div class="tw-pool-block target">
              <div class="tw-pool-division">${targetDivision}</div>
              <div class="tw-pool-time">${targetBlock.startTime} – ${targetBlock.endTime}</div>
              <div class="tw-pool-status">Has pool</div>
            </div>
          </div>
        </div>

        <div class="tw-options-smart">
          ${altSlots.length > 0 ? `
            <button class="tw-smart-option recommended" data-choice="different">
              <div class="tw-smart-icon">📍</div>
              <div class="tw-smart-content">
                <div class="tw-smart-title">Choose Different Pool Time</div>
                <div class="tw-smart-desc">Available: ${altSlots[0].start} – ${altSlots[0].end}</div>
              </div>
              <span class="tw-recommended-badge">Recommended</span>
            </button>
          ` : ''}

          <button class="tw-smart-option" data-choice="swap">
            <div class="tw-smart-icon">🔄</div>
            <div class="tw-smart-content">
              <div class="tw-smart-title">Swap Pool Times</div>
              <div class="tw-smart-desc">${sourceDivision} gets ${targetBlock.startTime}, ${targetDivision} gets ${startTime}</div>
            </div>
          </button>

          <button class="tw-smart-option danger" data-choice="skip">
            <div class="tw-smart-icon">⏭️</div>
            <div class="tw-smart-content">
              <div class="tw-smart-title">Skip Swim for ${sourceDivision}</div>
            </div>
          </button>
        </div>
      `,
      hideNext: true,
      setup: () => {
        wizardEl.querySelectorAll('.tw-smart-option').forEach(btn => {
          btn.onclick = () => {
            const choice = btn.dataset.choice;

            if (choice === 'different' && altSlots.length > 0) {
              const slot = altSlots[0];
              applyTimeChange(sourceDivision, originalBlock, 'Swim', slot.start, slot.end, afterResolve, ['Pool']);
            } else if (choice === 'swap') {
              // Check if swap works for source
              const swapConflicts = detectConflicts(sourceDivision, targetBlock.startTime, targetBlock.endTime, originalBlock.id);
              if (swapConflicts.length > 0) {
                showToast(`Can't swap - ${sourceDivision} has ${swapConflicts[0].event} at that time`, "error");
                return;
              }

              applyTimeChange(sourceDivision, originalBlock, 'Swim', targetBlock.startTime, targetBlock.endTime, () => { }, ['Pool']);
              applyTimeChange(targetDivision, targetBlock, 'Swim', startTime, endTime, afterResolve, ['Pool']);
            } else if (choice === 'skip') {
              applyRemoval(sourceDivision, originalBlock, 'No pool available', afterResolve);
            }
          };
        });
      }
    });
  }

  function applyTimeChange(division, oldBlock, eventName, startTime, endTime, next, reservedFields = []) {
    const decisionId = 'decision_' + Date.now();
    const change = {
      division,
      action: 'replace',
      oldEvent: oldBlock,
      type: oldBlock.type || 'pinned',
      event: eventName,
      startTime,
      endTime,
      reservedFields,
      decisionId
    };

    plannedChanges.push(change);
    applyChangeToWorkingSkeleton(change);
    decisionHistory.push({ id: decisionId, type: 'replace' });
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

    let hasChanges = false;
    let previewHtml = '<div class="tw-final-preview">';

    // Traveling divisions
    travelingDivisions.forEach(div => {
      const changes = changesByDivision[div];
      if (changes.length > 0) hasChanges = true;

      previewHtml += `
        <div class="tw-preview-division traveling">
          <div class="tw-preview-header">
            <span class="tw-preview-name">${div}</span>
            <span class="tw-badge-trip">Trip Day</span>
          </div>
          <div class="tw-preview-changes">
            ${changes.length === 0 ? '<div class="tw-preview-note">Only trip added</div>' : ''}
            ${changes.map(c => renderChangePreview(c)).join('')}
          </div>
        </div>
      `;
    });

    // Affected staying divisions
    const stayingDivs = allDivisions.filter(d => !travelingDivisions.includes(d));
    const affected = stayingDivs.filter(d => changesByDivision[d].length > 0);

    if (affected.length > 0) {
      previewHtml += `<div class="tw-affected-header">Also Affected</div>`;

      affected.forEach(div => {
        const changes = changesByDivision[div];
        hasChanges = true;

        previewHtml += `
          <div class="tw-preview-division">
            <div class="tw-preview-header">
              <span class="tw-preview-name">${div}</span>
              <span class="tw-badge-camp">At Camp</span>
            </div>
            <div class="tw-preview-changes">
              ${changes.map(c => renderChangePreview(c)).join('')}
            </div>
          </div>
        `;
      });
    }

    previewHtml += '</div>';

    renderStep({
      title: "Ready to Apply",
      subtitle: hasChanges ? "Review all changes before saving" : "No conflicts to resolve",
      body: previewHtml,
      nextText: "Apply All Changes",
      cancelText: "Cancel",
      next: () => {
        applyAllChanges();
        showToast("Trip scheduled successfully!", "success");
      }
    });
  }

  function renderChangePreview(change) {
    const icons = { add: '➕', replace: '↗️', remove: '➖' };
    const labels = { add: 'Added', replace: 'Moved', remove: 'Removed' };

    if (change.action === 'add') {
      return `
        <div class="tw-change add">
          <span class="tw-change-icon">${icons.add}</span>
          <div class="tw-change-content">
            <div class="tw-change-event">${change.event}</div>
            <div class="tw-change-time">${change.startTime} – ${change.endTime}</div>
          </div>
        </div>
      `;
    } else if (change.action === 'replace') {
      return `
        <div class="tw-change replace">
          <span class="tw-change-icon">${icons.replace}</span>
          <div class="tw-change-content">
            <div class="tw-change-event">${change.event}</div>
            <div class="tw-change-time">${change.startTime} – ${change.endTime}</div>
            <div class="tw-change-was">Was: ${change.oldEvent.startTime} – ${change.oldEvent.endTime}</div>
          </div>
        </div>
      `;
    } else if (change.action === 'remove') {
      return `
        <div class="tw-change remove">
          <span class="tw-change-icon">${icons.remove}</span>
          <div class="tw-change-content">
            <div class="tw-change-event">${change.oldEvent.event}</div>
            <div class="tw-change-reason">${change.reason}</div>
          </div>
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
  // UI UTILITIES
  // ------------------------------------------------------------
  function showToast(message, type = 'info') {
    const existing = document.querySelector('.tw-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `tw-toast ${type}`;
    toast.innerHTML = `
      <span class="tw-toast-icon">${type === 'success' ? '✓' : type === 'warning' ? '⚠️' : type === 'error' ? '✕' : 'ℹ️'}</span>
      <span class="tw-toast-message">${message}</span>
    `;

    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
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
            <div class="tw-header-left">
              <div class="tw-wizard-title">🚌 Trip Planner</div>
              <div class="tw-wizard-subtitle">Smart scheduling assistant</div>
            </div>
            <button id="tw-close" class="tw-btn-close" aria-label="Close">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            </button>
          </div>
          <div id="tw-content" class="tw-wizard-content"></div>
        </div>

        <div class="tw-preview">
          <div class="tw-preview-header">
            <div class="tw-preview-title">📅 Live Schedule</div>
            <div class="tw-preview-subtitle">Updates in real-time</div>
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
      if (plannedChanges.length > 0) {
        if (confirm("Exit trip planner? All progress will be lost.")) {
          close();
        }
      } else {
        close();
      }
    };

    // Close on escape
    document.addEventListener('keydown', function escHandler(e) {
      if (e.key === 'Escape') {
        document.removeEventListener('keydown', escHandler);
        close();
      }
    });

    updateLivePreview();
  }

  function renderStep({ title, subtitle, body, next, nextText = "Continue", cancelText, hideNext = false, showSkip = false, onSkip, setup }) {
    let html = `
      <div class="tw-step">
        <div class="tw-step-header">
          <h2 class="tw-step-title">${title}</h2>
          ${subtitle ? `<p class="tw-step-subtitle">${subtitle}</p>` : ''}
        </div>
        <div class="tw-step-body">${body}</div>
    `;

    if (!hideNext || showSkip || cancelText) {
      html += `<div class="tw-step-footer">`;
      if (showSkip) {
        html += `<button id="tw-skip" class="tw-btn-skip">Skip for now</button>`;
      }
      if (cancelText) {
        html += `<button id="tw-cancel" class="tw-btn-secondary">${cancelText}</button>`;
      }
      if (!hideNext) {
        html += `<button id="tw-next" class="tw-btn-primary">${nextText}</button>`;
      }
      html += `</div>`;
    }

    html += `</div>`;
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
    return `<style>
      /* ============================================
         TRIP WIZARD - ENHANCED SMART UI
         Clean, intuitive, Apple-inspired design
         ============================================ */
      
      * { box-sizing: border-box; }
      
      #tw-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.6);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
        padding: 16px;
        backdrop-filter: blur(8px);
        animation: tw-fadeIn 0.2s ease;
      }
      
      @keyframes tw-fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      
      .tw-app {
        display: flex;
        gap: 16px;
        width: 100%;
        max-width: 1300px;
        height: 90vh;
        max-height: 850px;
      }
      
      /* Wizard Panel */
      .tw-wizard {
        flex: 1;
        min-width: 0;
        background: #ffffff;
        border-radius: 16px;
        display: flex;
        flex-direction: column;
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
        overflow: hidden;
      }
      
      .tw-wizard-header {
        padding: 16px 20px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      
      .tw-header-left {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      
      .tw-wizard-title {
        font-size: 1.1rem;
        font-weight: 700;
        color: #fff;
      }
      
      .tw-wizard-subtitle {
        font-size: 0.75rem;
        color: rgba(255,255,255,0.8);
      }
      
      .tw-btn-close {
        width: 36px;
        height: 36px;
        border-radius: 50%;
        border: none;
        background: rgba(255,255,255,0.2);
        color: #fff;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.15s ease;
      }
      
      .tw-btn-close:hover {
        background: rgba(255,255,255,0.3);
        transform: scale(1.05);
      }
      
      .tw-wizard-content {
        flex: 1;
        overflow-y: auto;
        padding: 24px;
      }
      
      /* Preview Panel */
      .tw-preview {
        width: 380px;
        flex-shrink: 0;
        background: #ffffff;
        border-radius: 16px;
        display: flex;
        flex-direction: column;
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
        overflow: hidden;
      }
      
      .tw-preview-header {
        padding: 16px 20px;
        background: #f8fafc;
        border-bottom: 1px solid #e2e8f0;
      }
      
      .tw-preview-title {
        font-size: 0.95rem;
        font-weight: 600;
        color: #1e293b;
      }
      
      .tw-preview-subtitle {
        font-size: 0.75rem;
        color: #64748b;
        margin-top: 2px;
      }
      
      .tw-preview-content {
        flex: 1;
        overflow-y: auto;
        padding: 16px;
        background: #f8fafc;
      }
      
      /* Step Layout */
      .tw-step {
        display: flex;
        flex-direction: column;
        min-height: 100%;
      }
      
      .tw-step-header {
        margin-bottom: 24px;
      }
      
      .tw-step-title {
        font-size: 1.5rem;
        font-weight: 700;
        color: #1e293b;
        margin: 0 0 6px 0;
        line-height: 1.2;
      }
      
      .tw-step-subtitle {
        font-size: 0.9rem;
        color: #64748b;
        margin: 0;
        line-height: 1.4;
      }
      
      .tw-step-body {
        flex: 1;
      }
      
      .tw-step-footer {
        display: flex;
        gap: 12px;
        padding-top: 24px;
        margin-top: 24px;
        border-top: 1px solid #e2e8f0;
      }
      
      /* Buttons */
      .tw-btn-primary {
        flex: 1;
        font-family: inherit;
        font-size: 0.9rem;
        font-weight: 600;
        border-radius: 10px;
        border: none;
        padding: 12px 24px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: #fff;
        cursor: pointer;
        transition: all 0.2s ease;
      }
      
      .tw-btn-primary:hover {
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
      }
      
      .tw-btn-secondary {
        font-family: inherit;
        font-size: 0.85rem;
        font-weight: 500;
        border-radius: 10px;
        border: 1px solid #e2e8f0;
        padding: 12px 24px;
        background: #fff;
        color: #475569;
        cursor: pointer;
        transition: all 0.15s ease;
      }
      
      .tw-btn-secondary:hover {
        background: #f8fafc;
        border-color: #cbd5e1;
      }
      
      .tw-btn-skip {
        font-family: inherit;
        font-size: 0.85rem;
        font-weight: 500;
        border-radius: 10px;
        border: 1px solid #fcd34d;
        padding: 12px 24px;
        background: #fef9c3;
        color: #92400e;
        cursor: pointer;
        transition: all 0.15s ease;
      }
      
      .tw-btn-skip:hover {
        background: #fef08a;
      }
      
      /* Form Elements */
      .tw-form-card {
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        padding: 20px;
      }
      
      .tw-form-section {
        margin-bottom: 16px;
      }
      
      .tw-form-section:last-child {
        margin-bottom: 0;
      }
      
      .tw-label {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 0.85rem;
        font-weight: 600;
        color: #475569;
        margin-bottom: 8px;
      }
      
      .tw-label-icon {
        font-size: 1rem;
      }
      
      .tw-input {
        font-family: inherit;
        font-size: 0.95rem;
        padding: 12px 16px;
        border-radius: 10px;
        border: 1px solid #e2e8f0;
        background: #fff;
        color: #1e293b;
        width: 100%;
        transition: all 0.15s ease;
      }
      
      .tw-input:focus {
        outline: none;
        border-color: #667eea;
        box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.15);
      }
      
      .tw-input::placeholder {
        color: #94a3b8;
      }
      
      .tw-form-row {
        display: flex;
        gap: 12px;
        align-items: flex-end;
      }
      
      .tw-form-row .tw-form-section {
        flex: 1;
        margin-bottom: 0;
      }
      
      .tw-form-arrow {
        padding-bottom: 12px;
        color: #94a3b8;
        font-size: 1.2rem;
      }
      
      .tw-form-divider {
        height: 1px;
        background: #e2e8f0;
        margin: 16px 0;
      }
      
      .tw-duration-display {
        display: none;
        margin-top: 12px;
        padding: 10px 14px;
        background: #ecfdf5;
        border: 1px solid #a7f3d0;
        border-radius: 8px;
        font-size: 0.85rem;
        color: #065f46;
      }
      
      .tw-duration-label {
        font-weight: 600;
      }
      
      .tw-helper-text {
        margin-top: 16px;
        padding: 12px 14px;
        background: #eff6ff;
        border: 1px solid #bfdbfe;
        border-radius: 8px;
        font-size: 0.85rem;
        color: #1e40af;
      }
      
      /* Division Selection */
      .tw-division-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
        gap: 10px;
        margin-bottom: 16px;
      }
      
      .tw-division-card {
        position: relative;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 14px;
        border: 2px solid #e2e8f0;
        border-radius: 10px;
        background: #fff;
        cursor: pointer;
        transition: all 0.15s ease;
      }
      
      .tw-division-card:hover {
        border-color: #667eea;
        background: #f8fafc;
      }
      
      .tw-division-card.selected {
        border-color: #667eea;
        background: #eff6ff;
      }
      
      .tw-division-card input {
        display: none;
      }
      
      .tw-division-content {
        flex: 1;
        min-width: 0;
      }
      
      .tw-division-name {
        display: block;
        font-size: 0.9rem;
        font-weight: 600;
        color: #1e293b;
      }
      
      .tw-division-count {
        display: block;
        font-size: 0.75rem;
        color: #64748b;
      }
      
      .tw-division-check {
        width: 24px;
        height: 24px;
        border-radius: 50%;
        background: #e2e8f0;
        color: #fff;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 0.8rem;
        font-weight: 700;
        transition: all 0.15s ease;
      }
      
      .tw-division-card.selected .tw-division-check {
        background: #667eea;
      }
      
      .tw-quick-actions {
        display: flex;
        gap: 8px;
      }
      
      .tw-quick-btn {
        font-family: inherit;
        font-size: 0.8rem;
        padding: 6px 12px;
        border: 1px solid #e2e8f0;
        border-radius: 6px;
        background: #fff;
        color: #64748b;
        cursor: pointer;
        transition: all 0.15s ease;
      }
      
      .tw-quick-btn:hover {
        background: #f8fafc;
        color: #475569;
      }
      
      /* Conflict Overview */
      .tw-conflict-overview {
        display: flex;
        flex-direction: column;
        gap: 10px;
        margin-bottom: 20px;
      }
      
      .tw-conflict-category {
        display: flex;
        align-items: center;
        gap: 14px;
        padding: 14px 16px;
        border-radius: 10px;
        background: #fff;
        border: 1px solid #e2e8f0;
      }
      
      .tw-conflict-category.lunch { border-left: 4px solid #f59e0b; }
      .tw-conflict-category.swim { border-left: 4px solid #06b6d4; }
      .tw-conflict-category.snack { border-left: 4px solid #84cc16; }
      .tw-conflict-category.league { border-left: 4px solid #8b5cf6; }
      .tw-conflict-category.other { border-left: 4px solid #64748b; }
      
      .tw-conflict-icon {
        font-size: 1.5rem;
      }
      
      .tw-conflict-info {
        flex: 1;
      }
      
      .tw-conflict-type {
        font-size: 0.9rem;
        font-weight: 600;
        color: #1e293b;
      }
      
      .tw-conflict-count {
        font-size: 0.8rem;
        color: #64748b;
      }
      
      .tw-conflict-divisions {
        font-size: 0.8rem;
        color: #94a3b8;
      }
      
      /* Resolution Options */
      .tw-resolution-options {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      
      .tw-resolve-btn {
        display: flex;
        align-items: center;
        gap: 16px;
        width: 100%;
        padding: 18px 20px;
        border-radius: 12px;
        border: 2px solid #e2e8f0;
        background: #fff;
        cursor: pointer;
        text-align: left;
        transition: all 0.15s ease;
      }
      
      .tw-resolve-btn:hover {
        border-color: #667eea;
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(0,0,0,0.05);
      }
      
      .tw-resolve-btn.auto {
        background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%);
        border-color: #7dd3fc;
      }
      
      .tw-resolve-icon {
        font-size: 1.8rem;
      }
      
      .tw-resolve-content {
        flex: 1;
      }
      
      .tw-resolve-title {
        font-size: 1rem;
        font-weight: 600;
        color: #1e293b;
        margin-bottom: 2px;
      }
      
      .tw-resolve-desc {
        font-size: 0.85rem;
        color: #64748b;
      }
      
      /* Smart Options */
      .tw-options-smart {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      
      .tw-smart-option {
        position: relative;
        display: flex;
        align-items: center;
        gap: 14px;
        width: 100%;
        padding: 16px 18px;
        border-radius: 10px;
        border: 2px solid #e2e8f0;
        background: #fff;
        cursor: pointer;
        text-align: left;
        transition: all 0.15s ease;
      }
      
      .tw-smart-option:hover {
        border-color: #667eea;
        background: #f8fafc;
      }
      
      .tw-smart-option.recommended {
        border-color: #a7f3d0;
        background: #f0fdf4;
      }
      
      .tw-smart-option.recommended:hover {
        border-color: #4ade80;
      }
      
      .tw-smart-option.secondary {
        background: #f8fafc;
      }
      
      .tw-smart-option.danger {
        border-color: #fecaca;
      }
      
      .tw-smart-option.danger:hover {
        border-color: #f87171;
        background: #fef2f2;
      }
      
      .tw-smart-icon {
        font-size: 1.5rem;
        width: 40px;
        text-align: center;
      }
      
      .tw-smart-content {
        flex: 1;
      }
      
      .tw-smart-title {
        font-size: 0.95rem;
        font-weight: 600;
        color: #1e293b;
        margin-bottom: 2px;
      }
      
      .tw-smart-desc {
        font-size: 0.8rem;
        color: #64748b;
      }
      
      .tw-recommended-badge {
        position: absolute;
        top: -8px;
        right: 12px;
        padding: 3px 10px;
        background: #22c55e;
        color: #fff;
        border-radius: 20px;
        font-size: 0.65rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.03em;
      }
      
      /* Custom Time Panel */
      .tw-custom-panel {
        margin-top: 16px;
        padding: 18px;
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 10px;
      }
      
      .tw-custom-header {
        font-size: 0.9rem;
        font-weight: 600;
        color: #475569;
        margin-bottom: 14px;
      }
      
      .tw-available-slots {
        margin-bottom: 16px;
      }
      
      .tw-slots-label {
        font-size: 0.8rem;
        color: #64748b;
        margin-bottom: 8px;
      }
      
      .tw-slots-list {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      
      .tw-slot-chip {
        font-family: inherit;
        font-size: 0.8rem;
        padding: 6px 12px;
        border: 1px solid #e2e8f0;
        border-radius: 20px;
        background: #fff;
        color: #475569;
        cursor: pointer;
        transition: all 0.15s ease;
      }
      
      .tw-slot-chip:hover {
        border-color: #667eea;
        color: #667eea;
      }
      
      .tw-slot-chip.selected {
        border-color: #667eea;
        background: #667eea;
        color: #fff;
      }
      
      .tw-no-slots {
        padding: 12px;
        background: #fef2f2;
        border: 1px solid #fecaca;
        border-radius: 8px;
        font-size: 0.85rem;
        color: #dc2626;
        text-align: center;
      }
      
      /* Conflict Visual */
      .tw-conflict-visual {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 16px;
        padding: 20px;
        background: #fef2f2;
        border: 1px solid #fecaca;
        border-radius: 10px;
        margin-bottom: 20px;
      }
      
      .tw-visual-block {
        padding: 12px 16px;
        border-radius: 8px;
        text-align: center;
        min-width: 120px;
      }
      
      .tw-visual-block.trip {
        background: #fef3c7;
        border: 1px solid #fcd34d;
      }
      
      .tw-visual-block.conflict {
        background: #fff;
        border: 1px solid #e2e8f0;
      }
      
      .tw-visual-block.conflict.swim {
        background: #ecfeff;
        border-color: #67e8f9;
      }
      
      .tw-visual-label {
        font-size: 0.7rem;
        font-weight: 600;
        color: #64748b;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-bottom: 4px;
      }
      
      .tw-visual-time {
        font-size: 0.9rem;
        font-weight: 600;
        color: #1e293b;
      }
      
      .tw-visual-overlap {
        font-size: 1.5rem;
      }
      
      .tw-pool-info {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 14px;
        background: #ecfeff;
        border: 1px solid #a5f3fc;
        border-radius: 8px;
        font-size: 0.85rem;
        color: #0e7490;
        margin-bottom: 16px;
      }
      
      .tw-pool-icon {
        font-size: 1.2rem;
      }
      
      .tw-info-box {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 12px 16px;
        border-radius: 8px;
        font-size: 0.85rem;
        margin-bottom: 16px;
      }
      
      .tw-info-box.warning {
        background: #fef3c7;
        border: 1px solid #fcd34d;
        color: #92400e;
      }
      
      .tw-info-icon {
        font-size: 1.1rem;
      }
      
      /* Cascade Conflict Visual */
      .tw-cascade-visual {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        padding: 20px;
        background: #fef2f2;
        border: 1px solid #fecaca;
        border-radius: 10px;
        margin-bottom: 20px;
      }
      
      .tw-cascade-item {
        padding: 12px 20px;
        border-radius: 8px;
        text-align: center;
        width: 100%;
        max-width: 280px;
      }
      
      .tw-cascade-item.trying {
        background: #dbeafe;
        border: 2px dashed #3b82f6;
      }
      
      .tw-cascade-item.blocking {
        background: #fff;
        border: 1px solid #e2e8f0;
      }
      
      .tw-cascade-label {
        font-size: 0.7rem;
        font-weight: 600;
        color: #64748b;
        text-transform: uppercase;
        margin-bottom: 4px;
      }
      
      .tw-cascade-event {
        font-size: 0.95rem;
        font-weight: 600;
        color: #1e293b;
      }
      
      .tw-cascade-time {
        font-size: 0.85rem;
        color: #64748b;
      }
      
      .tw-cascade-conflict {
        padding: 6px 12px;
        background: #dc2626;
        color: #fff;
        border-radius: 20px;
        font-size: 0.75rem;
        font-weight: 600;
      }
      
      /* Pool Conflict Visual */
      .tw-pool-conflict {
        margin-bottom: 20px;
      }
      
      .tw-pool-visual {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 20px;
        padding: 20px;
        background: #ecfeff;
        border: 1px solid #a5f3fc;
        border-radius: 10px;
      }
      
      .tw-pool-block {
        padding: 14px 20px;
        border-radius: 10px;
        text-align: center;
        min-width: 130px;
      }
      
      .tw-pool-block.source {
        background: #dbeafe;
        border: 2px dashed #3b82f6;
      }
      
      .tw-pool-block.target {
        background: #fff;
        border: 1px solid #e2e8f0;
      }
      
      .tw-pool-division {
        font-size: 0.95rem;
        font-weight: 600;
        color: #1e293b;
        margin-bottom: 4px;
      }
      
      .tw-pool-time {
        font-size: 0.85rem;
        color: #64748b;
        margin-bottom: 4px;
      }
      
      .tw-pool-status {
        font-size: 0.7rem;
        font-weight: 600;
        color: #64748b;
        text-transform: uppercase;
      }
      
      /* Suggestions List */
      .tw-suggestions-list {
        display: flex;
        flex-direction: column;
        gap: 12px;
        margin-bottom: 20px;
        max-height: 400px;
        overflow-y: auto;
      }
      
      .tw-suggestion-card {
        border: 1px solid #e2e8f0;
        border-radius: 10px;
        background: #fff;
        overflow: hidden;
        transition: all 0.15s ease;
      }
      
      .tw-suggestion-card.accepted {
        border-color: #4ade80;
        background: #f0fdf4;
      }
      
      .tw-suggestion-header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 12px 16px;
        background: #f8fafc;
        border-bottom: 1px solid #e2e8f0;
      }
      
      .tw-suggestion-division {
        font-size: 0.8rem;
        font-weight: 600;
        padding: 3px 10px;
        background: #e2e8f0;
        border-radius: 20px;
        color: #475569;
      }
      
      .tw-suggestion-event {
        font-size: 0.9rem;
        font-weight: 500;
        color: #1e293b;
      }
      
      .tw-suggestion-body {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 16px;
        padding: 16px;
      }
      
      .tw-suggestion-original,
      .tw-suggestion-new {
        text-align: center;
      }
      
      .tw-suggestion-label {
        font-size: 0.7rem;
        font-weight: 600;
        color: #94a3b8;
        text-transform: uppercase;
        margin-bottom: 4px;
      }
      
      .tw-suggestion-time {
        font-size: 0.9rem;
        font-weight: 600;
        color: #1e293b;
      }
      
      .tw-suggestion-removed {
        font-size: 0.85rem;
        color: #dc2626;
        font-style: italic;
      }
      
      .tw-suggestion-arrow {
        font-size: 1.2rem;
        color: #94a3b8;
      }
      
      .tw-suggestion-reason {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 16px;
        background: #f0f9ff;
        font-size: 0.8rem;
        color: #0369a1;
      }
      
      .tw-reason-icon {
        font-size: 1rem;
      }
      
      .tw-suggestion-actions {
        display: flex;
        gap: 8px;
        padding: 12px 16px;
        border-top: 1px solid #e2e8f0;
      }
      
      .tw-accept-btn {
        flex: 1;
        font-family: inherit;
        font-size: 0.85rem;
        font-weight: 500;
        padding: 8px 16px;
        border-radius: 6px;
        border: none;
        background: #22c55e;
        color: #fff;
        cursor: pointer;
        transition: all 0.15s ease;
      }
      
      .tw-accept-btn:hover:not(:disabled) {
        background: #16a34a;
      }
      
      .tw-accept-btn:disabled {
        background: #86efac;
        cursor: default;
      }
      
      .tw-modify-btn {
        font-family: inherit;
        font-size: 0.85rem;
        padding: 8px 16px;
        border-radius: 6px;
        border: 1px solid #e2e8f0;
        background: #fff;
        color: #64748b;
        cursor: pointer;
        transition: all 0.15s ease;
      }
      
      .tw-modify-btn:hover {
        background: #f8fafc;
        border-color: #cbd5e1;
      }
      
      .tw-bulk-actions {
        display: flex;
        gap: 12px;
      }
      
      .tw-bulk-btn {
        flex: 1;
        font-family: inherit;
        font-size: 0.9rem;
        font-weight: 600;
        padding: 14px 24px;
        border-radius: 10px;
        border: none;
        cursor: pointer;
        transition: all 0.15s ease;
      }
      
      .tw-bulk-btn.accept-all {
        background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
        color: #fff;
      }
      
      .tw-bulk-btn.accept-all:hover {
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(34, 197, 94, 0.4);
      }
      
      /* Schedule Preview */
      .tw-schedule-division {
        background: #fff;
        border: 1px solid #e2e8f0;
        border-radius: 10px;
        margin-bottom: 12px;
        overflow: hidden;
      }
      
      .tw-schedule-division.traveling {
        border-color: #fbbf24;
      }
      
      .tw-schedule-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 14px;
        background: #f8fafc;
        border-bottom: 1px solid #e2e8f0;
      }
      
      .tw-schedule-title {
        font-size: 0.9rem;
        font-weight: 600;
        color: #1e293b;
      }
      
      .tw-badge-trip,
      .tw-badge-camp {
        padding: 3px 10px;
        border-radius: 20px;
        font-size: 0.65rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.03em;
      }
      
      .tw-badge-trip {
        background: #fef3c7;
        color: #92400e;
      }
      
      .tw-badge-camp {
        background: #e2e8f0;
        color: #64748b;
      }
      
      /* Timeline Visual */
      .tw-timeline-visual {
        padding: 12px 14px 8px;
        background: #fafafa;
        border-bottom: 1px solid #e2e8f0;
      }
      
      .tw-timeline-track {
        position: relative;
        height: 32px;
        background: #e2e8f0;
        border-radius: 6px;
        overflow: visible;
      }
      
      .tw-time-markers {
        position: absolute;
        top: -16px;
        left: 0;
        right: 0;
        display: flex;
        font-size: 0.6rem;
        color: #94a3b8;
      }
      
      .tw-time-markers span {
        position: absolute;
        transform: translateX(-50%);
      }
      
      .tw-timeline-block {
        position: absolute;
        top: 4px;
        height: 24px;
        border-radius: 4px;
        transition: all 0.2s ease;
      }
      
      .tw-timeline-block.default { background: #94a3b8; }
      .tw-timeline-block.trip { background: #fbbf24; }
      .tw-timeline-block.swim { background: #06b6d4; }
      .tw-timeline-block.lunch { background: #f97316; }
      .tw-timeline-block.snack { background: #84cc16; }
      .tw-timeline-block.league { background: #8b5cf6; }
      
      .tw-timeline-block.new {
        box-shadow: 0 0 0 2px #22c55e;
        animation: tw-pulse 1s infinite;
      }
      
      @keyframes tw-pulse {
        0%, 100% { box-shadow: 0 0 0 2px #22c55e; }
        50% { box-shadow: 0 0 0 4px rgba(34, 197, 94, 0.4); }
      }
      
      /* Schedule List */
      .tw-schedule-list {
        padding: 8px;
      }
      
      .tw-schedule-empty {
        padding: 16px;
        text-align: center;
        color: #94a3b8;
        font-size: 0.85rem;
        font-style: italic;
      }
      
      .tw-list-item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 10px;
        border-radius: 6px;
        margin-bottom: 4px;
        background: #f8fafc;
        border: 1px solid transparent;
      }
      
      .tw-list-item.new {
        background: #f0fdf4;
        border-color: #a7f3d0;
      }
      
      .tw-list-item.trip {
        background: #fef9c3;
        border-color: #fde047;
      }
      
      .tw-list-icon {
        font-size: 1rem;
      }
      
      .tw-list-content {
        flex: 1;
        min-width: 0;
      }
      
      .tw-list-title {
        font-size: 0.85rem;
        font-weight: 500;
        color: #1e293b;
      }
      
      .tw-list-time {
        font-size: 0.75rem;
        color: #64748b;
      }
      
      .tw-list-badge {
        padding: 2px 8px;
        background: #22c55e;
        color: #fff;
        border-radius: 20px;
        font-size: 0.6rem;
        font-weight: 700;
        text-transform: uppercase;
      }
      
      /* Final Preview */
      .tw-final-preview {
        max-height: 450px;
        overflow-y: auto;
      }
      
      .tw-preview-division {
        margin-bottom: 16px;
      }
      
      .tw-preview-header {
        display: flex;
        align-items: center;
        gap: 10px;
        padding-bottom: 10px;
        border-bottom: 1px solid #e2e8f0;
        margin-bottom: 12px;
      }
      
      .tw-preview-name {
        font-size: 1rem;
        font-weight: 600;
        color: #1e293b;
      }
      
      .tw-preview-changes {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      
      .tw-preview-note {
        padding: 10px 14px;
        background: #fef9c3;
        border-radius: 6px;
        font-size: 0.85rem;
        color: #92400e;
      }
      
      .tw-affected-header {
        font-size: 0.8rem;
        font-weight: 600;
        color: #64748b;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin: 20px 0 12px;
        padding-top: 16px;
        border-top: 1px solid #e2e8f0;
      }
      
      .tw-change {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        padding: 12px 14px;
        border-radius: 8px;
      }
      
      .tw-change.add {
        background: #f0fdf4;
        border-left: 3px solid #22c55e;
      }
      
      .tw-change.replace {
        background: #eff6ff;
        border-left: 3px solid #3b82f6;
      }
      
      .tw-change.remove {
        background: #fef2f2;
        border-left: 3px solid #ef4444;
      }
      
      .tw-change-icon {
        font-size: 1rem;
      }
      
      .tw-change-content {
        flex: 1;
      }
      
      .tw-change-event {
        font-size: 0.9rem;
        font-weight: 500;
        color: #1e293b;
      }
      
      .tw-change-time {
        font-size: 0.8rem;
        color: #64748b;
      }
      
      .tw-change-was {
        font-size: 0.75rem;
        color: #94a3b8;
        margin-top: 2px;
      }
      
      .tw-change-reason {
        font-size: 0.8rem;
        color: #64748b;
        font-style: italic;
      }
      
      /* Toast */
      .tw-toast {
        position: fixed;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%) translateY(100px);
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 14px 20px;
        background: #1e293b;
        color: #fff;
        border-radius: 10px;
        font-size: 0.9rem;
        box-shadow: 0 10px 30px rgba(0,0,0,0.3);
        z-index: 10001;
        opacity: 0;
        transition: all 0.3s ease;
      }
      
      .tw-toast.show {
        transform: translateX(-50%) translateY(0);
        opacity: 1;
      }
      
      .tw-toast.success {
        background: #22c55e;
      }
      
      .tw-toast.warning {
        background: #f59e0b;
      }
      
      .tw-toast.error {
        background: #ef4444;
      }
      
      .tw-toast-icon {
        font-size: 1.1rem;
      }
      
      /* Responsive */
      @media (max-width: 900px) {
        .tw-app {
          flex-direction: column;
          height: auto;
          max-height: 95vh;
        }
        
        .tw-preview {
          width: 100%;
          max-height: 250px;
        }
        
        .tw-wizard {
          max-height: none;
        }
      }
    </style>`;
  }

})();
