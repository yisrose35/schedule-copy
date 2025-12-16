// =================================================================
// trip_wizard.js — PROFESSIONAL TRIP PLANNER v2
// Matches app design system, proper cascading conflicts, undo support
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
  let decisionStack = []; // For undo functionality
  let pendingConflictQueue = [];
  let onComplete = null;
  let wizardEl = null;
  let previewEl = null;
  let allDivisions = [];
  let travelingDivisions = [];
  let divisionTimes = {}; // Store division start/end times

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
    if (mins < 60) return `${mins} min`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }

  // ------------------------------------------------------------
  // DIVISION TIME BOUNDARIES
  // ------------------------------------------------------------
  function loadDivisionTimes() {
    const divisions = window.divisions || {};
    allDivisions.forEach(div => {
      const divData = divisions[div] || {};
      divisionTimes[div] = {
        start: divData.startTime || '9:00am',
        end: divData.endTime || '4:30pm',
        startMin: toMin(divData.startTime || '9:00am'),
        endMin: toMin(divData.endTime || '4:30pm')
      };
    });
  }

  function isWithinDivisionBounds(division, startTime, endTime) {
    const bounds = divisionTimes[division];
    if (!bounds) return true;
    
    const startMin = toMin(startTime);
    const endMin = toMin(endTime);
    
    if (startMin == null || endMin == null) return false;
    return startMin >= bounds.startMin && endMin <= bounds.endMin;
  }

  // ------------------------------------------------------------
  // SMART SLOT FINDER (with division boundary enforcement)
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

    const bounds = divisionTimes[division] || { startMin: 540, endMin: 990 };
    const dayStart = bounds.startMin;
    const dayEnd = bounds.endMin;
    
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
      if (block.start > cursor + bufferMinutes) {
        const gapStart = cursor;
        const gapEnd = block.start - bufferMinutes;
        
        // Check if gap is usable (not during trip)
        if (!tripStart || gapEnd <= tripStart || gapStart >= tripEnd) {
          if (gapEnd - gapStart >= duration) {
            // Ensure slot fits within division bounds
            const slotEnd = Math.min(gapStart + duration, dayEnd);
            if (slotEnd - gapStart >= duration) {
              slots.push({
                start: toTime(gapStart),
                end: toTime(gapStart + duration),
                gapSize: gapEnd - gapStart,
                type: gapStart < 720 ? 'morning' : 'afternoon'
              });
            }
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
          type: cursor < 720 ? 'morning' : 'afternoon'
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
      let score = 50;
      const slotStart = toMin(slot.start);

      if (prefAfterMin && slotStart >= prefAfterMin) {
        score += 30;
        score -= Math.min(20, Math.abs(slotStart - prefAfterMin) / 10);
      }

      if (prefBeforeMin && slotStart <= prefBeforeMin) {
        score += 20;
      }

      score += Math.min(10, slot.gapSize / 30);

      return { ...slot, score };
    }).sort((a, b) => b.score - a.score);
  }

  function findBestSwimSlot(division, tripEnd) {
    const duration = 45; // Standard swim duration
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
      decisionStack = [];
      pendingConflictQueue = [];
      onComplete = cb;
      allDivisions = window.availableDivisions || [];
      travelingDivisions = [];
      divisionTimes = {};

      loadFullDaySkeleton();
      loadDivisionTimes();
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

  function saveDecisionState(description) {
    decisionStack.push({
      description,
      skeleton: JSON.parse(JSON.stringify(workingSkeleton)),
      changes: JSON.parse(JSON.stringify(plannedChanges)),
      timestamp: Date.now()
    });
  }

  function undoLastDecision() {
    if (decisionStack.length <= 1) {
      showToast("Nothing to undo", "info");
      return false;
    }
    
    decisionStack.pop(); // Remove current state
    const prevState = decisionStack[decisionStack.length - 1];
    
    workingSkeleton = JSON.parse(JSON.stringify(prevState.skeleton));
    plannedChanges = JSON.parse(JSON.stringify(prevState.changes));
    
    updateLivePreview();
    showToast("Undone: " + prevState.description, "info");
    return true;
  }

  function applyChangeToWorkingSkeleton(change) {
    const div = change.division;

    if (change.action === 'remove' && change.oldEvent) {
      workingSkeleton[div] = workingSkeleton[div].filter(b => b.id !== change.oldEvent.id);
    } else if (change.action === 'replace' && change.oldEvent) {
      workingSkeleton[div] = workingSkeleton[div].filter(b => b.id !== change.oldEvent.id);
      workingSkeleton[div].push({
        id: change.newId || `temp_${Math.random().toString(36).slice(2)}`,
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
        id: change.newId || `temp_${Math.random().toString(36).slice(2)}`,
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
      if (travelingDivisions.includes(div)) return; // Skip other traveling divisions

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

  // Detect ALL conflicts for a division after trip is placed
  function detectAllConflictsForDivision(division, tripStart, tripEnd) {
    const originalBlocks = fullDaySkeleton[division] || [];
    return originalBlocks.filter(b => 
      overlaps(b.startTime, b.endTime, tripStart, tripEnd)
    );
  }

  // Check for NEW conflicts created by a placement
  function detectNewConflictsAfterPlacement(division, newStartTime, newEndTime, excludeId) {
    const blocks = workingSkeleton[division] || [];
    const newConflicts = [];

    blocks.forEach(block => {
      if (block.id === excludeId) return;
      if (block.isNew) return; // Don't conflict with other new items
      
      if (overlaps(block.startTime, block.endTime, newStartTime, newEndTime)) {
        // Check if this wasn't already in our conflict queue
        const alreadyQueued = pendingConflictQueue.some(c => 
          c.block.id === block.id && c.division === division
        );
        if (!alreadyQueued) {
          newConflicts.push(block);
        }
      }
    });

    return newConflicts;
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
      const bounds = divisionTimes[div] || { start: '9:00am', end: '4:30pm' };

      const sorted = blocks.slice().sort((a, b) => {
        const aMin = toMin(a.startTime);
        const bMin = toMin(b.startTime);
        return (aMin || 0) - (bMin || 0);
      });

      html += `
        <div class="tw-preview-division ${isTraveling ? 'traveling' : ''}">
          <div class="tw-preview-header">
            <span class="tw-preview-title">${div}</span>
            ${isTraveling ? '<span class="tw-badge trip">Trip</span>' : '<span class="tw-badge camp">At Camp</span>'}
            <span class="tw-preview-bounds">${bounds.start} – ${bounds.end}</span>
          </div>
          <div class="tw-preview-list">
      `;

      if (sorted.length === 0) {
        html += `<div class="tw-preview-empty">No activities</div>`;
      }

      sorted.forEach(block => {
        const isNew = block.isNew || false;
        const isTrip = (block.event || '').toLowerCase().includes('trip');
        const typeClass = getTypeClass(block.event);

        html += `
          <div class="tw-preview-item ${isNew ? 'new' : ''} ${isTrip ? 'trip' : ''} ${typeClass}">
            <div class="tw-preview-time">${block.startTime}</div>
            <div class="tw-preview-content">
              <div class="tw-preview-event">${block.event}</div>
              <div class="tw-preview-range">${block.startTime} – ${block.endTime}</div>
            </div>
            ${isNew ? '<span class="tw-preview-badge">Changed</span>' : ''}
          </div>
        `;
      });

      html += `</div></div>`;
    });

    previewEl.innerHTML = html;
  }

  function getTypeClass(eventName) {
    if (!eventName) return '';
    const evt = eventName.toLowerCase();
    if (evt.includes('trip')) return 'type-trip';
    if (evt.includes('swim')) return 'type-swim';
    if (evt.includes('lunch')) return 'type-lunch';
    if (evt.includes('snack')) return 'type-snack';
    if (evt.includes('league')) return 'type-league';
    if (evt.includes('dismissal')) return 'type-dismissal';
    return '';
  }

  // ------------------------------------------------------------
  // STEP 1 — WHO'S GOING?
  // ------------------------------------------------------------
  function stepWho() {
    renderStep({
      title: "Select Divisions",
      subtitle: "Which divisions are going on this trip?",
      body: `
        <div class="tw-division-list">
          ${allDivisions.map(d => {
            const bounds = divisionTimes[d] || {};
            const count = (fullDaySkeleton[d] || []).length;
            return `
              <label class="tw-division-item">
                <input type="checkbox" value="${d}">
                <div class="tw-division-info">
                  <span class="tw-division-name">${d}</span>
                  <span class="tw-division-meta">${bounds.start || '?'} – ${bounds.end || '?'} · ${count} activities</span>
                </div>
              </label>
            `;
          }).join('')}
        </div>
        <div class="tw-quick-select">
          <button type="button" class="tw-link-btn" data-action="all">Select All</button>
          <button type="button" class="tw-link-btn" data-action="none">Clear</button>
        </div>
      `,
      next: () => {
        const chosen = [...wizardEl.querySelectorAll('input[type=checkbox]:checked')].map(i => i.value);

        if (!chosen.length) {
          showToast("Select at least one division", "warning");
          return;
        }

        travelingDivisions = chosen;
        tripManifest = chosen.map(d => ({ division: d }));
        
        // Save initial state
        saveDecisionState("Initial state");
        
        updateLivePreview();
        stepTripDetails();
      },
      setup: () => {
        wizardEl.querySelectorAll('.tw-link-btn').forEach(btn => {
          btn.onclick = () => {
            const action = btn.dataset.action;
            wizardEl.querySelectorAll('input[type=checkbox]').forEach(cb => {
              cb.checked = action === 'all';
            });
          };
        });
      }
    });
  }

  // ------------------------------------------------------------
  // STEP 2 — TRIP DETAILS
  // ------------------------------------------------------------
  function stepTripDetails() {
    // Get earliest start and latest end across selected divisions
    let minStart = Infinity, maxEnd = 0;
    travelingDivisions.forEach(div => {
      const bounds = divisionTimes[div];
      if (bounds) {
        minStart = Math.min(minStart, bounds.startMin);
        maxEnd = Math.max(maxEnd, bounds.endMin);
      }
    });

    renderStep({
      title: "Trip Details",
      subtitle: "Where and when?",
      body: `
        <div class="tw-form-group">
          <label class="tw-label">Destination</label>
          <input type="text" id="tw-dest" placeholder="Zoo, Museum, etc." class="tw-input">
        </div>

        <div class="tw-form-row">
          <div class="tw-form-group">
            <label class="tw-label">Departure</label>
            <input type="text" id="tw-start" placeholder="10:00am" class="tw-input">
          </div>
          <div class="tw-form-group">
            <label class="tw-label">Return</label>
            <input type="text" id="tw-end" placeholder="2:30pm" class="tw-input">
          </div>
        </div>

        <div class="tw-form-note" id="tw-duration-note"></div>
        
        <div class="tw-form-hint">
          Division hours: ${toTime(minStart)} – ${toTime(maxEnd)}
        </div>
      `,
      back: () => stepWho(),
      next: () => {
        const dest = wizardEl.querySelector('#tw-dest').value.trim();
        const start = wizardEl.querySelector('#tw-start').value.trim();
        const end = wizardEl.querySelector('#tw-end').value.trim();

        const sMin = toMin(start);
        const eMin = toMin(end);

        if (!dest) {
          showToast("Enter a destination", "warning");
          return;
        }

        if (sMin == null || eMin == null) {
          showToast("Enter valid times (e.g., '10:00am')", "warning");
          return;
        }

        if (eMin <= sMin) {
          showToast("Return must be after departure", "warning");
          return;
        }

        // Validate against division bounds
        let boundsError = null;
        travelingDivisions.forEach(div => {
          const bounds = divisionTimes[div];
          if (bounds) {
            if (sMin < bounds.startMin) {
              boundsError = `${div} doesn't start until ${bounds.start}`;
            }
            if (eMin > bounds.endMin) {
              boundsError = `${div} ends at ${bounds.end}`;
            }
          }
        });

        if (boundsError) {
          showToast(boundsError, "warning");
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
            newId: `trip_${Math.random().toString(36).slice(2)}`
          };
          plannedChanges.push(change);
          applyChangeToWorkingSkeleton(change);
        });

        saveDecisionState("Added trip");

        // Collect ALL conflicts
        collectAllConflicts();
      },
      setup: () => {
        const startInput = wizardEl.querySelector('#tw-start');
        const endInput = wizardEl.querySelector('#tw-end');
        const noteEl = wizardEl.querySelector('#tw-duration-note');

        const updateDuration = () => {
          const s = toMin(startInput.value);
          const e = toMin(endInput.value);
          if (s != null && e != null && e > s) {
            noteEl.textContent = `Duration: ${formatDuration(e - s)}`;
            noteEl.style.display = 'block';
          } else {
            noteEl.style.display = 'none';
          }
        };

        startInput.oninput = updateDuration;
        endInput.oninput = updateDuration;
      }
    });
  }

  // ------------------------------------------------------------
  // CONFLICT COLLECTION & RESOLUTION
  // ------------------------------------------------------------
  function collectAllConflicts() {
    pendingConflictQueue = [];

    tripManifest.forEach(trip => {
      const conflicts = detectAllConflictsForDivision(trip.division, trip.start, trip.end);
      conflicts.forEach(block => {
        pendingConflictQueue.push({
          division: trip.division,
          trip,
          block,
          type: categorizeConflict(block.event)
        });
      });
    });

    if (pendingConflictQueue.length === 0) {
      showToast("No conflicts found!", "success");
      showFinalPreview();
      return;
    }

    // Sort: lunch first, then swim, then others
    const priority = { lunch: 0, swim: 1, snack: 2, league: 3, other: 4 };
    pendingConflictQueue.sort((a, b) => priority[a.type] - priority[b.type]);

    processNextConflict();
  }

  function categorizeConflict(eventName) {
    const evt = (eventName || '').toLowerCase();
    if (evt.includes('lunch')) return 'lunch';
    if (evt.includes('swim')) return 'swim';
    if (evt.includes('snack')) return 'snack';
    if (evt.includes('league')) return 'league';
    return 'other';
  }

  function processNextConflict() {
    if (pendingConflictQueue.length === 0) {
      showFinalPreview();
      return;
    }

    const conflict = pendingConflictQueue.shift();
    
    switch (conflict.type) {
      case 'lunch':
        handleLunchConflict(conflict);
        break;
      case 'swim':
        handleSwimConflict(conflict);
        break;
      case 'snack':
        handleSnackConflict(conflict);
        break;
      case 'league':
        handleLeagueConflict(conflict);
        break;
      default:
        handleGenericConflict(conflict);
    }
  }

  // After resolving a conflict, check if the new placement creates more conflicts
  function checkForCascadingConflicts(division, newStartTime, newEndTime, excludeId) {
    const newConflicts = detectNewConflictsAfterPlacement(division, newStartTime, newEndTime, excludeId);
    
    if (newConflicts.length > 0) {
      const trip = tripManifest.find(t => t.division === division);
      
      newConflicts.forEach(block => {
        pendingConflictQueue.unshift({
          division,
          trip,
          block,
          type: categorizeConflict(block.event),
          cascaded: true
        });
      });
    }
  }

  // ------------------------------------------------------------
  // CONFLICT HANDLERS
  // ------------------------------------------------------------
  function handleLunchConflict(conflict) {
    const { division, trip, block } = conflict;
    const duration = getDuration(block.startTime, block.endTime) || 30;
    const bounds = divisionTimes[division];

    // Find valid slots
    const beforeSlots = findAvailableSlots(division, duration, { preferBefore: trip.start });
    const afterSlots = findAvailableSlots(division, duration, { preferAfter: trip.end });

    // Filter to ensure within bounds
    const validBefore = beforeSlots.filter(s => toMin(s.end) <= toMin(trip.start));
    const validAfter = afterSlots.filter(s => toMin(s.start) >= toMin(trip.end));

    renderConflictStep({
      division,
      eventName: 'Lunch',
      originalTime: `${block.startTime} – ${block.endTime}`,
      tripTime: `${trip.start} – ${trip.end}`,
      options: [
        {
          id: 'pack',
          label: 'Pack Lunch',
          description: 'Eat during the trip',
          recommended: true,
          action: () => {
            applyRemoval(division, block, 'Packed for trip');
            processNextConflict();
          }
        },
        validBefore.length > 0 ? {
          id: 'before',
          label: 'Lunch Before Trip',
          description: `${validBefore[0].start} – ${validBefore[0].end}`,
          action: () => {
            applyReschedule(division, block, 'Lunch', validBefore[0].start, validBefore[0].end);
            checkForCascadingConflicts(division, validBefore[0].start, validBefore[0].end, block.id);
            processNextConflict();
          }
        } : null,
        validAfter.length > 0 ? {
          id: 'after',
          label: 'Lunch After Return',
          description: `${validAfter[0].start} – ${validAfter[0].end}`,
          action: () => {
            applyReschedule(division, block, 'Lunch', validAfter[0].start, validAfter[0].end);
            checkForCascadingConflicts(division, validAfter[0].start, validAfter[0].end, block.id);
            processNextConflict();
          }
        } : null
      ].filter(Boolean),
      customHandler: (start, end) => {
        if (!isWithinDivisionBounds(division, start, end)) {
          showToast(`Time must be within ${bounds.start} – ${bounds.end}`, "warning");
          return false;
        }
        applyReschedule(division, block, 'Lunch', start, end);
        checkForCascadingConflicts(division, start, end, block.id);
        processNextConflict();
        return true;
      }
    });
  }

  function handleSwimConflict(conflict) {
    const { division, trip, block } = conflict;
    const duration = getDuration(block.startTime, block.endTime) || 45;
    const bounds = divisionTimes[division];

    // Find slots that don't conflict with other divisions' swim
    const slots = findBestSwimSlot(division, trip.end);
    const validSlots = slots.filter(s => 
      toMin(s.start) >= toMin(trip.end) && 
      isWithinDivisionBounds(division, s.start, s.end)
    );

    // Check for cross-division conflicts
    const crossConflictWarning = validSlots.length === 0 ? 
      "No available pool times that don't conflict with other divisions" : null;

    renderConflictStep({
      division,
      eventName: 'Swim',
      originalTime: `${block.startTime} – ${block.endTime}`,
      tripTime: `${trip.start} – ${trip.end}`,
      warning: crossConflictWarning,
      swimOptions: true,
      options: [
        validSlots.length > 0 ? {
          id: 'reschedule',
          label: 'Reschedule Swim',
          description: `${validSlots[0].start} – ${validSlots[0].end} (pool available)`,
          recommended: true,
          action: () => {
            applyReschedule(division, block, 'Swim', validSlots[0].start, validSlots[0].end, ['Pool']);
            checkForCascadingConflicts(division, validSlots[0].start, validSlots[0].end, block.id);
            processNextConflict();
          }
        } : null,
        {
          id: 'skip',
          label: 'Skip Swim Today',
          description: 'No swim for this division',
          danger: true,
          action: () => {
            applyRemoval(division, block, 'Skipped');
            processNextConflict();
          }
        }
      ].filter(Boolean),
      customHandler: (start, end) => {
        if (!isWithinDivisionBounds(division, start, end)) {
          showToast(`Time must be within ${bounds.start} – ${bounds.end}`, "warning");
          return false;
        }
        
        // Check pool conflicts
        const poolConflicts = detectCrossDivisionConflicts('swim', start, end, division);
        if (poolConflicts.length > 0) {
          showToast(`Pool conflict with ${poolConflicts[0].division}`, "warning");
          return false;
        }
        
        applyReschedule(division, block, 'Swim', start, end, ['Pool']);
        checkForCascadingConflicts(division, start, end, block.id);
        processNextConflict();
        return true;
      }
    });
  }

  function handleSnackConflict(conflict) {
    const { division, trip, block } = conflict;
    const bounds = divisionTimes[division];

    const beforeTime = addMinutes(trip.start, -15);
    const afterTime = trip.end;

    renderConflictStep({
      division,
      eventName: 'Snack',
      originalTime: `${block.startTime} – ${block.endTime}`,
      tripTime: `${trip.start} – ${trip.end}`,
      options: [
        {
          id: 'pack',
          label: 'Pack Snacks',
          description: 'Bring on the trip',
          recommended: true,
          action: () => {
            applyRemoval(division, block, 'Packed for trip');
            processNextConflict();
          }
        },
        beforeTime && toMin(beforeTime) >= bounds.startMin ? {
          id: 'before',
          label: 'Snack Before Trip',
          description: `${beforeTime} – ${trip.start}`,
          action: () => {
            applyReschedule(division, block, 'Snack', beforeTime, trip.start);
            checkForCascadingConflicts(division, beforeTime, trip.start, block.id);
            processNextConflict();
          }
        } : null,
        {
          id: 'after',
          label: 'Snack After Return',
          description: `${afterTime} – ${addMinutes(afterTime, 15)}`,
          action: () => {
            const endTime = addMinutes(afterTime, 15);
            applyReschedule(division, block, 'Snack', afterTime, endTime);
            checkForCascadingConflicts(division, afterTime, endTime, block.id);
            processNextConflict();
          }
        },
        {
          id: 'skip',
          label: 'Skip Snack',
          danger: true,
          action: () => {
            applyRemoval(division, block, 'Skipped');
            processNextConflict();
          }
        }
      ].filter(Boolean)
    });
  }

  function handleLeagueConflict(conflict) {
    const { division, trip, block } = conflict;
    const duration = getDuration(block.startTime, block.endTime) || 60;
    const bounds = divisionTimes[division];

    const beforeSlots = findAvailableSlots(division, duration, { preferBefore: trip.start });
    const afterSlots = findAvailableSlots(division, duration, { preferAfter: trip.end });

    const validBefore = beforeSlots.filter(s => toMin(s.end) <= toMin(trip.start));
    const validAfter = afterSlots.filter(s => toMin(s.start) >= toMin(trip.end));

    renderConflictStep({
      division,
      eventName: block.event || 'League Game',
      originalTime: `${block.startTime} – ${block.endTime}`,
      tripTime: `${trip.start} – ${trip.end}`,
      warning: "Opposing teams will need to be notified of changes",
      options: [
        {
          id: 'reschedule-day',
          label: 'Reschedule Another Day',
          description: 'Coordinate later',
          recommended: true,
          action: () => {
            applyRemoval(division, block, 'Rescheduled');
            processNextConflict();
          }
        },
        validBefore.length > 0 ? {
          id: 'before',
          label: 'Play Before Trip',
          description: `${validBefore[0].start} – ${toTime(toMin(validBefore[0].start) + duration)}`,
          action: () => {
            const endTime = toTime(toMin(validBefore[0].start) + duration);
            applyReschedule(division, block, block.event, validBefore[0].start, endTime);
            checkForCascadingConflicts(division, validBefore[0].start, endTime, block.id);
            processNextConflict();
          }
        } : null,
        validAfter.length > 0 ? {
          id: 'after',
          label: 'Play After Return',
          description: `${validAfter[0].start} – ${toTime(toMin(validAfter[0].start) + duration)}`,
          action: () => {
            const endTime = toTime(toMin(validAfter[0].start) + duration);
            applyReschedule(division, block, block.event, validAfter[0].start, endTime);
            checkForCascadingConflicts(division, validAfter[0].start, endTime, block.id);
            processNextConflict();
          }
        } : null,
        {
          id: 'cancel',
          label: 'Cancel Game',
          danger: true,
          action: () => {
            applyRemoval(division, block, 'Cancelled');
            processNextConflict();
          }
        }
      ].filter(Boolean)
    });
  }

  function handleGenericConflict(conflict) {
    const { division, trip, block } = conflict;
    const duration = getDuration(block.startTime, block.endTime) || 45;
    const bounds = divisionTimes[division];

    const afterSlots = findAvailableSlots(division, duration, { preferAfter: trip.end });
    const validAfter = afterSlots.filter(s => toMin(s.start) >= toMin(trip.end));

    renderConflictStep({
      division,
      eventName: block.event || 'Activity',
      originalTime: `${block.startTime} – ${block.endTime}`,
      tripTime: `${trip.start} – ${trip.end}`,
      options: [
        validAfter.length > 0 ? {
          id: 'move',
          label: 'Move to Available Slot',
          description: `${validAfter[0].start} – ${toTime(toMin(validAfter[0].start) + duration)}`,
          recommended: true,
          action: () => {
            const endTime = toTime(toMin(validAfter[0].start) + duration);
            applyReschedule(division, block, block.event, validAfter[0].start, endTime);
            checkForCascadingConflicts(division, validAfter[0].start, endTime, block.id);
            processNextConflict();
          }
        } : null,
        {
          id: 'skip',
          label: 'Skip for Today',
          danger: true,
          action: () => {
            applyRemoval(division, block, 'Skipped');
            processNextConflict();
          }
        }
      ].filter(Boolean),
      customHandler: (start, end) => {
        if (!isWithinDivisionBounds(division, start, end)) {
          showToast(`Time must be within ${bounds.start} – ${bounds.end}`, "warning");
          return false;
        }
        applyReschedule(division, block, block.event, start, end);
        checkForCascadingConflicts(division, start, end, block.id);
        processNextConflict();
        return true;
      }
    });
  }

  // ------------------------------------------------------------
  // APPLY CHANGES
  // ------------------------------------------------------------
  function applyRemoval(division, block, reason) {
    const change = {
      division,
      action: 'remove',
      oldEvent: block,
      reason
    };
    plannedChanges.push(change);
    applyChangeToWorkingSkeleton(change);
    saveDecisionState(`Removed ${block.event}`);
  }

  function applyReschedule(division, block, eventName, startTime, endTime, reservedFields = []) {
    const change = {
      division,
      action: 'replace',
      oldEvent: block,
      type: block.type || 'pinned',
      event: eventName,
      startTime,
      endTime,
      reservedFields,
      newId: `new_${Math.random().toString(36).slice(2)}`
    };
    plannedChanges.push(change);
    applyChangeToWorkingSkeleton(change);
    saveDecisionState(`Moved ${eventName} to ${startTime}`);
  }

  // ------------------------------------------------------------
  // RENDER CONFLICT STEP
  // ------------------------------------------------------------
  function renderConflictStep({ division, eventName, originalTime, tripTime, warning, options, customHandler, swimOptions }) {
    const remaining = pendingConflictQueue.length;
    const bounds = divisionTimes[division];

    renderStep({
      title: `${division} — ${eventName}`,
      subtitle: `Originally ${originalTime}, conflicts with trip (${tripTime})`,
      progress: remaining > 0 ? `${remaining} more conflict${remaining > 1 ? 's' : ''} remaining` : null,
      body: `
        ${warning ? `<div class="tw-warning">${warning}</div>` : ''}
        
        <div class="tw-options">
          ${options.map(opt => `
            <button class="tw-option ${opt.recommended ? 'recommended' : ''} ${opt.danger ? 'danger' : ''}" 
                    data-id="${opt.id}">
              <div class="tw-option-main">
                <span class="tw-option-label">${opt.label}</span>
                ${opt.description ? `<span class="tw-option-desc">${opt.description}</span>` : ''}
              </div>
              ${opt.recommended ? '<span class="tw-option-tag">Recommended</span>' : ''}
            </button>
          `).join('')}
        </div>

        ${customHandler ? `
          <div class="tw-custom-section">
            <button class="tw-link-btn" id="tw-show-custom">Choose custom time</button>
            <div id="tw-custom-form" style="display:none;">
              <div class="tw-form-row compact">
                <div class="tw-form-group">
                  <label class="tw-label">Start</label>
                  <input type="text" id="tw-custom-start" class="tw-input" placeholder="2:00pm">
                </div>
                <div class="tw-form-group">
                  <label class="tw-label">End</label>
                  <input type="text" id="tw-custom-end" class="tw-input" placeholder="2:45pm">
                </div>
                <button class="tw-btn secondary" id="tw-apply-custom">Apply</button>
              </div>
              <div class="tw-form-hint">Must be within ${bounds.start} – ${bounds.end}</div>
            </div>
          </div>
        ` : ''}
      `,
      back: decisionStack.length > 1 ? () => {
        undoLastDecision();
        // Re-add current conflict to queue
        pendingConflictQueue.unshift({
          division,
          trip: tripManifest.find(t => t.division === division),
          block: { event: eventName, startTime: originalTime.split(' – ')[0], endTime: originalTime.split(' – ')[1] },
          type: categorizeConflict(eventName)
        });
        processNextConflict();
      } : null,
      hideNext: true,
      setup: () => {
        // Option buttons
        wizardEl.querySelectorAll('.tw-option').forEach(btn => {
          btn.onclick = () => {
            const opt = options.find(o => o.id === btn.dataset.id);
            if (opt && opt.action) opt.action();
          };
        });

        // Custom time
        const showCustomBtn = wizardEl.querySelector('#tw-show-custom');
        const customForm = wizardEl.querySelector('#tw-custom-form');
        
        if (showCustomBtn && customForm) {
          showCustomBtn.onclick = () => {
            customForm.style.display = customForm.style.display === 'none' ? 'block' : 'none';
          };

          const applyBtn = wizardEl.querySelector('#tw-apply-custom');
          if (applyBtn) {
            applyBtn.onclick = () => {
              const start = wizardEl.querySelector('#tw-custom-start').value.trim();
              const end = wizardEl.querySelector('#tw-custom-end').value.trim();

              if (!start || !end || toMin(start) == null || toMin(end) == null) {
                showToast("Enter valid times", "warning");
                return;
              }

              if (toMin(end) <= toMin(start)) {
                showToast("End must be after start", "warning");
                return;
              }

              customHandler(start, end);
            };
          }
        }
      }
    });
  }

  // ------------------------------------------------------------
  // FINAL PREVIEW
  // ------------------------------------------------------------
  function showFinalPreview() {
    // Group changes by division
    const changesByDivision = {};
    allDivisions.forEach(d => { changesByDivision[d] = []; });

    plannedChanges.forEach(change => {
      if (!changesByDivision[change.division]) {
        changesByDivision[change.division] = [];
      }
      changesByDivision[change.division].push(change);
    });

    const affectedDivisions = Object.keys(changesByDivision).filter(d => changesByDivision[d].length > 0);

    renderStep({
      title: "Review Changes",
      subtitle: `${plannedChanges.length} change${plannedChanges.length !== 1 ? 's' : ''} to apply`,
      body: `
        <div class="tw-summary">
          ${affectedDivisions.map(div => {
            const changes = changesByDivision[div];
            const isTraveling = travelingDivisions.includes(div);
            
            return `
              <div class="tw-summary-division">
                <div class="tw-summary-header">
                  <span class="tw-summary-name">${div}</span>
                  <span class="tw-badge ${isTraveling ? 'trip' : 'camp'}">${isTraveling ? 'Trip' : 'Affected'}</span>
                </div>
                <div class="tw-summary-changes">
                  ${changes.map(c => renderChangeSummary(c)).join('')}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `,
      back: decisionStack.length > 1 ? () => {
        undoLastDecision();
        showFinalPreview();
      } : null,
      nextText: "Apply Changes",
      next: () => {
        applyAllChanges();
      }
    });
  }

  function renderChangeSummary(change) {
    if (change.action === 'add') {
      return `
        <div class="tw-change add">
          <span class="tw-change-icon">+</span>
          <div class="tw-change-info">
            <span class="tw-change-event">${change.event}</span>
            <span class="tw-change-time">${change.startTime} – ${change.endTime}</span>
          </div>
        </div>
      `;
    } else if (change.action === 'replace') {
      return `
        <div class="tw-change move">
          <span class="tw-change-icon">↗</span>
          <div class="tw-change-info">
            <span class="tw-change-event">${change.event}</span>
            <span class="tw-change-time">${change.startTime} – ${change.endTime}</span>
            <span class="tw-change-was">was ${change.oldEvent.startTime} – ${change.oldEvent.endTime}</span>
          </div>
        </div>
      `;
    } else if (change.action === 'remove') {
      return `
        <div class="tw-change remove">
          <span class="tw-change-icon">−</span>
          <div class="tw-change-info">
            <span class="tw-change-event">${change.oldEvent.event}</span>
            <span class="tw-change-reason">${change.reason}</span>
          </div>
        </div>
      `;
    }
    return '';
  }

  function applyAllChanges() {
    // Build instructions that PRESERVE non-conflicting events
    const instructions = {};

    // For each division, start with the working skeleton (which already has changes applied)
    travelingDivisions.forEach(div => {
      instructions[div] = {
        division: div,
        actions: []
      };

      // Clear existing and rebuild from working skeleton
      instructions[div].actions.push({ type: 'wipe' });
      
      (workingSkeleton[div] || []).forEach(block => {
        instructions[div].actions.push({
          type: block.type || 'pinned',
          event: block.event,
          startTime: block.startTime,
          endTime: block.endTime,
          reservedFields: block.reservedFields || []
        });
      });
    });

    // Also include changes to non-traveling divisions (e.g., pool swaps)
    allDivisions.forEach(div => {
      if (travelingDivisions.includes(div)) return;
      
      const hasChanges = plannedChanges.some(c => c.division === div);
      if (hasChanges) {
        instructions[div] = {
          division: div,
          actions: []
        };
        
        instructions[div].actions.push({ type: 'wipe' });
        
        (workingSkeleton[div] || []).forEach(block => {
          instructions[div].actions.push({
            type: block.type || 'pinned',
            event: block.event,
            startTime: block.startTime,
            endTime: block.endTime,
            reservedFields: block.reservedFields || []
          });
        });
      }
    });

    const instructionArray = Object.values(instructions);
    onComplete?.(instructionArray);
    showToast("Trip scheduled successfully!", "success");
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
    toast.innerHTML = `<span>${message}</span>`;

    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 200);
    }, 2500);
  }

  // ------------------------------------------------------------
  // RENDER BASE
  // ------------------------------------------------------------
  function renderBase() {
    document.getElementById("tw-overlay")?.remove();

    const overlay = document.createElement("div");
    overlay.id = "tw-overlay";
    overlay.innerHTML = `
      <div class="tw-container">
        <div class="tw-main">
          <div class="tw-header">
            <div class="tw-header-info">
              <h2 class="tw-title">Trip Planner</h2>
              <p class="tw-subtitle">Schedule off-campus trips with automatic conflict resolution</p>
            </div>
            <button class="tw-close" id="tw-close" title="Close">×</button>
          </div>
          <div class="tw-body" id="tw-content"></div>
        </div>
        <div class="tw-sidebar">
          <div class="tw-sidebar-header">
            <h3>Live Preview</h3>
            <span class="tw-sidebar-hint">Updates as you decide</span>
          </div>
          <div class="tw-sidebar-body" id="tw-preview"></div>
        </div>
      </div>
      ${getStyles()}
    `;

    document.body.appendChild(overlay);
    wizardEl = document.getElementById("tw-content");
    previewEl = document.getElementById("tw-preview");

    document.getElementById("tw-close").onclick = () => {
      if (plannedChanges.length > 0) {
        if (confirm("Exit? Changes will be lost.")) close();
      } else {
        close();
      }
    };

    document.addEventListener('keydown', function escHandler(e) {
      if (e.key === 'Escape') {
        document.removeEventListener('keydown', escHandler);
        close();
      }
    });

    updateLivePreview();
  }

  function renderStep({ title, subtitle, progress, body, back, next, nextText = "Continue", hideNext = false, setup }) {
    let html = `
      <div class="tw-step">
        <div class="tw-step-header">
          <h3 class="tw-step-title">${title}</h3>
          ${subtitle ? `<p class="tw-step-subtitle">${subtitle}</p>` : ''}
          ${progress ? `<p class="tw-step-progress">${progress}</p>` : ''}
        </div>
        <div class="tw-step-body">${body}</div>
        <div class="tw-step-footer">
          ${back ? `<button class="tw-btn secondary" id="tw-back">← Back</button>` : '<div></div>'}
          ${!hideNext ? `<button class="tw-btn primary" id="tw-next">${nextText}</button>` : ''}
        </div>
      </div>
    `;

    wizardEl.innerHTML = html;

    if (back) {
      wizardEl.querySelector('#tw-back')?.addEventListener('click', back);
    }

    if (!hideNext && next) {
      wizardEl.querySelector('#tw-next')?.addEventListener('click', next);
    }

    if (setup) setup();
  }

  function close() {
    document.getElementById("tw-overlay")?.remove();
  }

  function getStyles() {
    return `<style>
      /* =============================================
         TRIP WIZARD v2 - Professional Design
         Matches app design system from styles.css
         ============================================= */
      
      #tw-overlay {
        position: fixed;
        inset: 0;
        background: rgba(15, 23, 42, 0.6);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
        padding: 16px;
        backdrop-filter: blur(4px);
      }
      
      .tw-container {
        display: flex;
        gap: 1px;
        width: 100%;
        max-width: 1100px;
        height: 85vh;
        max-height: 750px;
        background: #e5e7eb;
        border-radius: 12px;
        overflow: hidden;
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
      }
      
      /* Main Panel */
      .tw-main {
        flex: 1;
        min-width: 0;
        background: #ffffff;
        display: flex;
        flex-direction: column;
      }
      
      .tw-header {
        padding: 16px 20px;
        border-bottom: 1px solid #e5e7eb;
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        background: #f9fafb;
      }
      
      .tw-header-info {
        flex: 1;
      }
      
      .tw-title {
        margin: 0;
        font-size: 1.1rem;
        font-weight: 600;
        color: #111827;
      }
      
      .tw-subtitle {
        margin: 4px 0 0;
        font-size: 0.8rem;
        color: #6b7280;
      }
      
      .tw-close {
        width: 32px;
        height: 32px;
        border-radius: 999px;
        border: 1px solid #d1d5db;
        background: #ffffff;
        color: #6b7280;
        font-size: 20px;
        line-height: 1;
        cursor: pointer;
        transition: all 0.15s ease;
      }
      
      .tw-close:hover {
        background: #f3f4f6;
        border-color: #9ca3af;
        color: #374151;
      }
      
      .tw-body {
        flex: 1;
        overflow-y: auto;
        padding: 20px;
      }
      
      /* Sidebar */
      .tw-sidebar {
        width: 320px;
        background: #f9fafb;
        display: flex;
        flex-direction: column;
        border-left: 1px solid #e5e7eb;
      }
      
      .tw-sidebar-header {
        padding: 14px 16px;
        border-bottom: 1px solid #e5e7eb;
        background: #ffffff;
      }
      
      .tw-sidebar-header h3 {
        margin: 0;
        font-size: 0.9rem;
        font-weight: 600;
        color: #111827;
      }
      
      .tw-sidebar-hint {
        font-size: 0.75rem;
        color: #9ca3af;
      }
      
      .tw-sidebar-body {
        flex: 1;
        overflow-y: auto;
        padding: 12px;
      }
      
      /* Step Layout */
      .tw-step {
        display: flex;
        flex-direction: column;
        min-height: 100%;
      }
      
      .tw-step-header {
        margin-bottom: 20px;
      }
      
      .tw-step-title {
        margin: 0;
        font-size: 1.25rem;
        font-weight: 600;
        color: #111827;
      }
      
      .tw-step-subtitle {
        margin: 6px 0 0;
        font-size: 0.85rem;
        color: #6b7280;
      }
      
      .tw-step-progress {
        margin: 8px 0 0;
        font-size: 0.75rem;
        color: #9ca3af;
        font-style: italic;
      }
      
      .tw-step-body {
        flex: 1;
      }
      
      .tw-step-footer {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding-top: 20px;
        margin-top: 20px;
        border-top: 1px solid #e5e7eb;
      }
      
      /* Buttons */
      .tw-btn {
        font-family: inherit;
        font-size: 0.85rem;
        font-weight: 500;
        padding: 10px 20px;
        border-radius: 999px;
        cursor: pointer;
        transition: all 0.15s ease;
      }
      
      .tw-btn.primary {
        background: #2563eb;
        color: #ffffff;
        border: 1px solid #2563eb;
      }
      
      .tw-btn.primary:hover {
        background: #1d4ed8;
        border-color: #1d4ed8;
        box-shadow: 0 4px 8px rgba(37, 99, 235, 0.25);
      }
      
      .tw-btn.secondary {
        background: #ffffff;
        color: #374151;
        border: 1px solid #d1d5db;
      }
      
      .tw-btn.secondary:hover {
        background: #f3f4f6;
        border-color: #9ca3af;
      }
      
      .tw-link-btn {
        background: none;
        border: none;
        color: #2563eb;
        font-size: 0.85rem;
        cursor: pointer;
        padding: 4px 0;
        text-decoration: underline;
      }
      
      .tw-link-btn:hover {
        color: #1d4ed8;
      }
      
      /* Forms */
      .tw-form-group {
        margin-bottom: 16px;
      }
      
      .tw-form-row {
        display: flex;
        gap: 12px;
      }
      
      .tw-form-row .tw-form-group {
        flex: 1;
        margin-bottom: 0;
      }
      
      .tw-form-row.compact {
        align-items: flex-end;
      }
      
      .tw-form-row.compact .tw-form-group {
        flex: 0 0 auto;
      }
      
      .tw-label {
        display: block;
        font-size: 0.8rem;
        font-weight: 500;
        color: #374151;
        margin-bottom: 6px;
      }
      
      .tw-input {
        font-family: inherit;
        font-size: 0.85rem;
        padding: 8px 12px;
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
      
      .tw-form-note {
        display: none;
        margin-top: 10px;
        padding: 8px 12px;
        background: #ecfdf5;
        border: 1px solid #a7f3d0;
        border-radius: 6px;
        font-size: 0.8rem;
        color: #065f46;
      }
      
      .tw-form-hint {
        margin-top: 8px;
        font-size: 0.75rem;
        color: #9ca3af;
      }
      
      /* Division Selection */
      .tw-division-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-bottom: 12px;
      }
      
      .tw-division-item {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px 14px;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.15s ease;
        background: #ffffff;
      }
      
      .tw-division-item:hover {
        border-color: #2563eb;
        background: #f9fafb;
      }
      
      .tw-division-item:has(input:checked) {
        border-color: #2563eb;
        background: #eff6ff;
      }
      
      .tw-division-item input {
        width: 16px;
        height: 16px;
        cursor: pointer;
      }
      
      .tw-division-info {
        flex: 1;
      }
      
      .tw-division-name {
        display: block;
        font-size: 0.9rem;
        font-weight: 600;
        color: #111827;
      }
      
      .tw-division-meta {
        display: block;
        font-size: 0.75rem;
        color: #6b7280;
        margin-top: 2px;
      }
      
      .tw-quick-select {
        display: flex;
        gap: 12px;
      }
      
      /* Warning */
      .tw-warning {
        padding: 10px 14px;
        background: #fef3c7;
        border: 1px solid #fcd34d;
        border-radius: 6px;
        font-size: 0.85rem;
        color: #92400e;
        margin-bottom: 16px;
      }
      
      /* Options */
      .tw-options {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      
      .tw-option {
        display: flex;
        align-items: center;
        justify-content: space-between;
        width: 100%;
        padding: 14px 16px;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        background: #ffffff;
        cursor: pointer;
        text-align: left;
        transition: all 0.15s ease;
      }
      
      .tw-option:hover {
        border-color: #2563eb;
        background: #f9fafb;
      }
      
      .tw-option.recommended {
        border-color: #a7f3d0;
        background: #f0fdf4;
      }
      
      .tw-option.recommended:hover {
        border-color: #4ade80;
      }
      
      .tw-option.danger {
        border-color: #fecaca;
      }
      
      .tw-option.danger:hover {
        border-color: #f87171;
        background: #fef2f2;
      }
      
      .tw-option-main {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      
      .tw-option-label {
        font-size: 0.9rem;
        font-weight: 500;
        color: #111827;
      }
      
      .tw-option-desc {
        font-size: 0.8rem;
        color: #6b7280;
      }
      
      .tw-option-tag {
        padding: 3px 8px;
        background: #22c55e;
        color: #ffffff;
        border-radius: 999px;
        font-size: 0.65rem;
        font-weight: 600;
        text-transform: uppercase;
      }
      
      .tw-custom-section {
        margin-top: 16px;
        padding-top: 16px;
        border-top: 1px solid #e5e7eb;
      }
      
      #tw-custom-form {
        margin-top: 12px;
        padding: 14px;
        background: #f9fafb;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
      }
      
      /* Preview */
      .tw-preview-division {
        background: #ffffff;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        margin-bottom: 10px;
        overflow: hidden;
      }
      
      .tw-preview-division.traveling {
        border-color: #fbbf24;
      }
      
      .tw-preview-header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 12px;
        background: #f3f4f6;
        border-bottom: 1px solid #e5e7eb;
      }
      
      .tw-preview-title {
        font-size: 0.85rem;
        font-weight: 600;
        color: #111827;
      }
      
      .tw-preview-bounds {
        margin-left: auto;
        font-size: 0.7rem;
        color: #9ca3af;
      }
      
      .tw-badge {
        padding: 2px 8px;
        border-radius: 999px;
        font-size: 0.65rem;
        font-weight: 600;
        text-transform: uppercase;
      }
      
      .tw-badge.trip {
        background: #fef3c7;
        color: #92400e;
      }
      
      .tw-badge.camp {
        background: #e5e7eb;
        color: #4b5563;
      }
      
      .tw-preview-list {
        padding: 8px;
      }
      
      .tw-preview-empty {
        padding: 16px;
        text-align: center;
        color: #9ca3af;
        font-size: 0.8rem;
      }
      
      .tw-preview-item {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        padding: 8px 10px;
        border-radius: 6px;
        margin-bottom: 4px;
        background: #f9fafb;
        border-left: 3px solid #d1d5db;
      }
      
      .tw-preview-item.new {
        background: #f0fdf4;
        border-left-color: #22c55e;
      }
      
      .tw-preview-item.trip {
        background: #fef9c3;
        border-left-color: #eab308;
      }
      
      .tw-preview-item.type-swim { border-left-color: #06b6d4; }
      .tw-preview-item.type-lunch { border-left-color: #f97316; }
      .tw-preview-item.type-snack { border-left-color: #84cc16; }
      .tw-preview-item.type-league { border-left-color: #8b5cf6; }
      .tw-preview-item.type-dismissal { border-left-color: #ef4444; }
      
      .tw-preview-time {
        font-size: 0.7rem;
        font-weight: 600;
        color: #6b7280;
        min-width: 50px;
        padding-top: 2px;
      }
      
      .tw-preview-content {
        flex: 1;
        min-width: 0;
      }
      
      .tw-preview-event {
        font-size: 0.85rem;
        font-weight: 500;
        color: #111827;
      }
      
      .tw-preview-range {
        font-size: 0.7rem;
        color: #6b7280;
      }
      
      .tw-preview-badge {
        padding: 2px 6px;
        background: #22c55e;
        color: #ffffff;
        border-radius: 999px;
        font-size: 0.6rem;
        font-weight: 600;
      }
      
      /* Summary */
      .tw-summary {
        max-height: 400px;
        overflow-y: auto;
      }
      
      .tw-summary-division {
        margin-bottom: 16px;
      }
      
      .tw-summary-header {
        display: flex;
        align-items: center;
        gap: 10px;
        padding-bottom: 8px;
        border-bottom: 1px solid #e5e7eb;
        margin-bottom: 10px;
      }
      
      .tw-summary-name {
        font-size: 0.95rem;
        font-weight: 600;
        color: #111827;
      }
      
      .tw-summary-changes {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      
      .tw-change {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        padding: 10px 12px;
        border-radius: 6px;
      }
      
      .tw-change.add {
        background: #f0fdf4;
        border-left: 3px solid #22c55e;
      }
      
      .tw-change.move {
        background: #eff6ff;
        border-left: 3px solid #3b82f6;
      }
      
      .tw-change.remove {
        background: #fef2f2;
        border-left: 3px solid #ef4444;
      }
      
      .tw-change-icon {
        font-size: 1rem;
        font-weight: 700;
        width: 20px;
        text-align: center;
      }
      
      .tw-change.add .tw-change-icon { color: #22c55e; }
      .tw-change.move .tw-change-icon { color: #3b82f6; }
      .tw-change.remove .tw-change-icon { color: #ef4444; }
      
      .tw-change-info {
        flex: 1;
      }
      
      .tw-change-event {
        font-size: 0.9rem;
        font-weight: 500;
        color: #111827;
      }
      
      .tw-change-time {
        display: block;
        font-size: 0.8rem;
        color: #4b5563;
      }
      
      .tw-change-was {
        display: block;
        font-size: 0.75rem;
        color: #9ca3af;
        margin-top: 2px;
      }
      
      .tw-change-reason {
        display: block;
        font-size: 0.8rem;
        color: #6b7280;
        font-style: italic;
      }
      
      /* Toast */
      .tw-toast {
        position: fixed;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%) translateY(80px);
        padding: 12px 20px;
        background: #1f2937;
        color: #ffffff;
        border-radius: 8px;
        font-size: 0.85rem;
        box-shadow: 0 10px 25px rgba(0, 0, 0, 0.2);
        z-index: 10001;
        opacity: 0;
        transition: all 0.2s ease;
      }
      
      .tw-toast.show {
        transform: translateX(-50%) translateY(0);
        opacity: 1;
      }
      
      .tw-toast.success { background: #059669; }
      .tw-toast.warning { background: #d97706; }
      .tw-toast.error { background: #dc2626; }
      .tw-toast.info { background: #2563eb; }
      
      /* Responsive */
      @media (max-width: 800px) {
        .tw-container {
          flex-direction: column;
          height: 95vh;
          max-height: none;
        }
        
        .tw-sidebar {
          width: 100%;
          max-height: 200px;
          border-left: none;
          border-top: 1px solid #e5e7eb;
        }
      }
    </style>`;
  }

})();
