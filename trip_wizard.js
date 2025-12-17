// =================================================================
// trip_wizard.js — TRIP PLANNER v4
// Wipe-and-Rebuild with Cross-Division Cascading
// 
// Architecture:
// 1. Wipe traveling divisions' schedules
// 2. Rebuild piece by piece through the wizard
// 3. When placing an activity, check for cross-division conflicts
// 4. If conflict found (e.g., pool), place ours, remove theirs, add theirs to queue
// 5. Continue cascading through all affected divisions
// =================================================================

(function () {
  'use strict';

  // ------------------------------------------------------------
  // STATE
  // ------------------------------------------------------------
  let plannedChanges = [];
  let fullDaySkeleton = {};      // Original schedules (preserved)
  let workingSkeleton = {};      // Working copy (modified)
  let decisionStack = [];        // For undo
  let rebuildQueue = [];         // Items to process
  let onComplete = null;
  let wizardEl = null;
  let previewEl = null;
  let allDivisions = [];
  let travelingDivisions = [];
  let divisionTimes = {};
  let tripDetails = {};          // { destination, start, end }

  // Category priority for rebuild order
  const CATEGORY_ORDER = ['lunch', 'swim', 'snack', 'league', 'specialty_league', 'dismissal', 'slot', 'other'];

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
  // INITIALIZATION
  // ------------------------------------------------------------
  function loadDivisionTimes() {
    const divisions = window.divisions || {};
    allDivisions.forEach(div => {
      const d = divisions[div] || {};
      divisionTimes[div] = {
        start: d.startTime || '9:00am',
        end: d.endTime || '4:30pm',
        startMin: toMin(d.startTime || '9:00am'),
        endMin: toMin(d.endTime || '4:30pm')
      };
    });
  }

  function loadFullDaySkeleton() {
    const dailyData = window.loadCurrentDailyData?.() || {};
    const skeleton = dailyData.manualSkeleton || [];

    allDivisions.forEach(div => {
      fullDaySkeleton[div] = skeleton.filter(b => b.division === div);
      workingSkeleton[div] = JSON.parse(JSON.stringify(fullDaySkeleton[div]));
    });
  }

  function isWithinBounds(division, startTime, endTime) {
    const bounds = divisionTimes[division];
    if (!bounds) return true;
    const s = toMin(startTime), e = toMin(endTime);
    if (s == null || e == null) return false;
    return s >= bounds.startMin && e <= bounds.endMin;
  }

  // ------------------------------------------------------------
  // CATEGORIZATION
  // ------------------------------------------------------------
  function categorize(block) {
    const evt = (block.event || '').toLowerCase();
    const type = (block.type || '').toLowerCase();
    
    if (evt.includes('trip')) return 'trip';
    if (evt.includes('lunch')) return 'lunch';
    if (evt.includes('swim') || evt.includes('pool')) return 'swim';
    if (evt.includes('snack')) return 'snack';
    if (type === 'specialty_league' || evt.includes('specialty league')) return 'specialty_league';
    if (type === 'league' || evt.includes('league game')) return 'league';
    if (evt.includes('dismissal')) return 'dismissal';
    if (type === 'slot' || evt.includes('activity slot') || evt.includes('sports slot')) return 'slot';
    return 'other';
  }

  function categoryLabel(cat) {
    return {
      lunch: 'Lunch', swim: 'Swim', snack: 'Snack',
      league: 'League Game', specialty_league: 'Specialty League',
      dismissal: 'Dismissal', slot: 'Activity Slot', other: 'Activity'
    }[cat] || 'Activity';
  }

  // ------------------------------------------------------------
  // STATE MANAGEMENT
  // ------------------------------------------------------------
  function saveState(desc) {
    decisionStack.push({
      desc,
      skeleton: JSON.parse(JSON.stringify(workingSkeleton)),
      queue: JSON.parse(JSON.stringify(rebuildQueue)),
      changes: JSON.parse(JSON.stringify(plannedChanges))
    });
  }

  function undoLast() {
    if (decisionStack.length <= 1) {
      showToast("Nothing to undo", "info");
      return false;
    }
    decisionStack.pop();
    const prev = decisionStack[decisionStack.length - 1];
    workingSkeleton = JSON.parse(JSON.stringify(prev.skeleton));
    rebuildQueue = JSON.parse(JSON.stringify(prev.queue));
    plannedChanges = JSON.parse(JSON.stringify(prev.changes));
    updatePreview();
    return true;
  }

  function addBlock(division, block) {
    const newBlock = {
      id: block.id || `blk_${Math.random().toString(36).slice(2)}`,
      type: block.type || 'pinned',
      event: block.event,
      division,
      startTime: block.startTime,
      endTime: block.endTime,
      reservedFields: block.reservedFields || [],
      isNew: true
    };
    workingSkeleton[division].push(newBlock);
    plannedChanges.push({ division, action: 'add', block: newBlock });
    return newBlock;
  }

  function removeBlock(division, blockId) {
    const block = workingSkeleton[division].find(b => b.id === blockId);
    if (block) {
      workingSkeleton[division] = workingSkeleton[division].filter(b => b.id !== blockId);
      plannedChanges.push({ division, action: 'remove', block });
    }
    return block;
  }

  // ------------------------------------------------------------
  // CONFLICT DETECTION
  // ------------------------------------------------------------
  
  // Same-division conflicts
  function detectLocalConflicts(division, startTime, endTime, excludeId = null) {
    return (workingSkeleton[division] || []).filter(b => {
      if (excludeId && b.id === excludeId) return false;
      return overlaps(b.startTime, b.endTime, startTime, endTime);
    });
  }

  // Cross-division pool conflicts
  function detectPoolConflicts(division, startTime, endTime) {
    const conflicts = [];
    allDivisions.forEach(otherDiv => {
      if (otherDiv === division) return;
      (workingSkeleton[otherDiv] || []).forEach(block => {
        if (categorize(block) === 'swim') {
          if (overlaps(block.startTime, block.endTime, startTime, endTime)) {
            conflicts.push({ division: otherDiv, block });
          }
        }
      });
    });
    return conflicts;
  }

  // ------------------------------------------------------------
  // SLOT FINDER
  // ------------------------------------------------------------
  function findSlots(division, duration, options = {}) {
    const { avoidRanges = [], checkPool = false } = options;
    const bounds = divisionTimes[division] || { startMin: 540, endMin: 990 };
    const blocks = workingSkeleton[division] || [];

    // Build occupied ranges
    const occupied = [];
    
    blocks.forEach(b => {
      const s = toMin(b.startTime), e = toMin(b.endTime);
      if (s != null && e != null) occupied.push({ start: s, end: e });
    });
    
    avoidRanges.forEach(r => {
      const s = toMin(r.start), e = toMin(r.end);
      if (s != null && e != null) occupied.push({ start: s, end: e });
    });

    occupied.sort((a, b) => a.start - b.start);

    // Merge overlapping
    const merged = [];
    for (const occ of occupied) {
      if (!merged.length || occ.start > merged[merged.length - 1].end) {
        merged.push({ ...occ });
      } else {
        merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, occ.end);
      }
    }

    // Find gaps
    const slots = [];
    let cursor = bounds.startMin;

    for (const m of merged) {
      if (m.start > cursor && m.start - cursor >= duration) {
        slots.push({
          start: toTime(cursor),
          end: toTime(cursor + duration),
          startMin: cursor
        });
      }
      cursor = Math.max(cursor, m.end);
    }

    if (bounds.endMin - cursor >= duration) {
      slots.push({
        start: toTime(cursor),
        end: toTime(cursor + duration),
        startMin: cursor
      });
    }

    // Filter for pool if needed
    if (checkPool) {
      return slots.filter(s => detectPoolConflicts(division, s.start, s.end).length === 0);
    }

    return slots;
  }

  // ------------------------------------------------------------
  // PUBLIC API
  // ------------------------------------------------------------
  window.TripWizard = {
    start(cb) {
      plannedChanges = [];
      fullDaySkeleton = {};
      workingSkeleton = {};
      decisionStack = [];
      rebuildQueue = [];
      onComplete = cb;
      allDivisions = window.availableDivisions || [];
      travelingDivisions = [];
      divisionTimes = {};
      tripDetails = {};

      loadFullDaySkeleton();
      loadDivisionTimes();
      renderBase();
      stepSelectDivisions();
    }
  };

  // ------------------------------------------------------------
  // STEP 1: SELECT DIVISIONS
  // ------------------------------------------------------------
  function stepSelectDivisions() {
    renderStep({
      title: "Select Divisions",
      subtitle: "Which divisions are going on this trip?",
      body: `
        <div class="tw-list">
          ${allDivisions.map(d => {
            const bounds = divisionTimes[d] || {};
            return `
              <label class="tw-list-item">
                <input type="checkbox" value="${d}">
                <div class="tw-list-info">
                  <span class="tw-list-name">${d}</span>
                  <span class="tw-list-meta">${bounds.start} – ${bounds.end}</span>
                </div>
              </label>
            `;
          }).join('')}
        </div>
        <div class="tw-quick">
          <button class="tw-link" data-action="all">Select All</button>
          <button class="tw-link" data-action="none">Clear</button>
        </div>
      `,
      next: () => {
        const chosen = [...wizardEl.querySelectorAll('input:checked')].map(i => i.value);
        if (!chosen.length) { showToast("Select at least one division", "warning"); return; }
        travelingDivisions = chosen;
        saveState("Initial");
        updatePreview();
        stepTripDetails();
      },
      setup: () => {
        wizardEl.querySelectorAll('.tw-link').forEach(btn => {
          btn.onclick = () => {
            const all = btn.dataset.action === 'all';
            wizardEl.querySelectorAll('input[type=checkbox]').forEach(cb => cb.checked = all);
          };
        });
      }
    });
  }

  // ------------------------------------------------------------
  // STEP 2: TRIP DETAILS
  // ------------------------------------------------------------
  function stepTripDetails() {
    renderStep({
      title: "Trip Details",
      subtitle: "Where and when?",
      body: `
        <div class="tw-form">
          <div class="tw-field">
            <label>Destination</label>
            <input type="text" id="tw-dest" placeholder="Zoo, Museum, etc.">
          </div>
          <div class="tw-row">
            <div class="tw-field">
              <label>Departure</label>
              <input type="text" id="tw-start" placeholder="10:00am">
            </div>
            <div class="tw-field">
              <label>Return</label>
              <input type="text" id="tw-end" placeholder="2:30pm">
            </div>
          </div>
          <div class="tw-note" id="tw-dur"></div>
        </div>
      `,
      back: () => stepSelectDivisions(),
      next: () => {
        const dest = document.getElementById('tw-dest').value.trim();
        const start = document.getElementById('tw-start').value.trim();
        const end = document.getElementById('tw-end').value.trim();

        if (!dest) { showToast("Enter destination", "warning"); return; }
        
        const sMin = toMin(start), eMin = toMin(end);
        if (sMin == null || eMin == null) { showToast("Invalid time format", "warning"); return; }
        if (eMin <= sMin) { showToast("Return must be after departure", "warning"); return; }

        // Validate bounds
        for (const div of travelingDivisions) {
          const b = divisionTimes[div];
          if (sMin < b.startMin) { showToast(`${div} doesn't start until ${b.start}`, "warning"); return; }
          if (eMin > b.endMin) { showToast(`${div} ends at ${b.end}`, "warning"); return; }
        }

        tripDetails = { destination: dest, start, end };
        startRebuild();
      },
      setup: () => {
        const sEl = document.getElementById('tw-start');
        const eEl = document.getElementById('tw-end');
        const dEl = document.getElementById('tw-dur');
        const upd = () => {
          const s = toMin(sEl.value), e = toMin(eEl.value);
          if (s != null && e != null && e > s) {
            dEl.textContent = `Duration: ${formatDuration(e - s)}`;
            dEl.style.display = 'block';
          } else dEl.style.display = 'none';
        };
        sEl.oninput = upd;
        eEl.oninput = upd;
      }
    });
  }

  // ------------------------------------------------------------
  // REBUILD PROCESS
  // ------------------------------------------------------------
  function startRebuild() {
    // WIPE traveling divisions
    travelingDivisions.forEach(div => {
      workingSkeleton[div] = [];
    });

    // Build the rebuild queue
    rebuildQueue = [];

    travelingDivisions.forEach(div => {
      const original = fullDaySkeleton[div] || [];

      // First: add trip
      rebuildQueue.push({
        division: div,
        category: 'trip',
        block: {
          type: 'pinned',
          event: `Trip: ${tripDetails.destination}`,
          startTime: tripDetails.start,
          endTime: tripDetails.end
        },
        autoAdd: true
      });

      // Then: each activity from original, sorted by category
      CATEGORY_ORDER.forEach(cat => {
        original.filter(b => categorize(b) === cat).forEach(block => {
          rebuildQueue.push({
            division: div,
            category: cat,
            block,
            autoAdd: false
          });
        });
      });
    });

    saveState("Wiped schedules");
    updatePreview();
    processQueue();
  }

  function processQueue() {
    if (rebuildQueue.length === 0) {
      showFinalReview();
      return;
    }

    const item = rebuildQueue.shift();

    if (item.autoAdd) {
      // Auto-add (trip block)
      addBlock(item.division, item.block);
      saveState(`Added ${item.block.event}`);
      updatePreview();
      processQueue();
      return;
    }

    // Check if original time works
    const block = item.block;
    const tripStart = tripDetails.start;
    const tripEnd = tripDetails.end;

    // Is it during the trip?
    const duringTrip = overlaps(block.startTime, block.endTime, tripStart, tripEnd);

    // Is there a same-division conflict?
    const localConflicts = detectLocalConflicts(item.division, block.startTime, block.endTime);

    if (!duringTrip && localConflicts.length === 0) {
      // Original time still works!
      // But for swim, check cross-division pool conflicts
      if (item.category === 'swim') {
        const poolConflicts = detectPoolConflicts(item.division, block.startTime, block.endTime);
        if (poolConflicts.length > 0) {
          // Pool conflict - need to ask user
          handlePoolConflict(item, poolConflicts[0], block.startTime, block.endTime);
          return;
        }
      }
      
      // No conflicts - keep original
      addBlock(item.division, block);
      saveState(`Kept ${block.event}`);
      updatePreview();
      processQueue();
    } else {
      // Needs rescheduling
      askReschedule(item, duringTrip ? 'trip' : 'conflict');
    }
  }

  // ------------------------------------------------------------
  // RESCHEDULE PROMPT
  // ------------------------------------------------------------
  function askReschedule(item, reason) {
    const { division, category, block } = item;
    const duration = getDuration(block.startTime, block.endTime);
    const bounds = divisionTimes[division];
    const label = categoryLabel(category);

    // Find available slots
    const avoidRanges = [{ start: tripDetails.start, end: tripDetails.end }];
    const checkPool = category === 'swim';
    const slots = findSlots(division, duration, { avoidRanges, checkPool });

    // Build options
    let options = [];

    if (category === 'lunch') {
      options = [
        { id: 'pack', label: 'Pack lunch for trip', desc: 'Eat during trip', skip: true, recommended: true },
        ...slots.slice(0, 2).map((s, i) => ({
          id: `slot${i}`, label: `Lunch at ${s.start}`, desc: `${s.start} – ${s.end}`, slot: s
        }))
      ];
    } else if (category === 'swim') {
      if (slots.length > 0) {
        options = slots.slice(0, 3).map((s, i) => ({
          id: `slot${i}`, label: `Swim at ${s.start}`, 
          desc: `${s.start} – ${s.end} (pool available)`, 
          slot: s, recommended: i === 0
        }));
      }
      options.push({ id: 'custom', label: 'Choose custom time', desc: 'May require moving another division', custom: true });
      options.push({ id: 'skip', label: 'Skip swim today', danger: true, skip: true });
    } else if (category === 'snack') {
      options = [
        { id: 'pack', label: 'Pack snacks', desc: 'Bring on trip', skip: true, recommended: true },
        ...slots.slice(0, 2).map((s, i) => ({
          id: `slot${i}`, label: `Snack at ${s.start}`, desc: `${s.start} – ${s.end}`, slot: s
        })),
        { id: 'skip', label: 'Skip snack', danger: true, skip: true }
      ];
    } else if (category === 'league' || category === 'specialty_league') {
      options = [
        { id: 'another-day', label: 'Reschedule for another day', skip: true, recommended: true },
        ...slots.slice(0, 2).map((s, i) => ({
          id: `slot${i}`, label: `Play at ${s.start}`, 
          desc: `${s.start} – ${toTime(toMin(s.start) + duration)}`, 
          slot: { ...s, end: toTime(toMin(s.start) + duration) }
        })),
        { id: 'cancel', label: 'Cancel game', danger: true, skip: true }
      ];
    } else if (category === 'dismissal') {
      // Dismissal should keep its time if not conflicting
      if (slots.length > 0) {
        const endSlot = slots[slots.length - 1]; // Last available slot
        options = [{ id: 'slot0', label: `Dismissal at ${endSlot.start}`, slot: endSlot, recommended: true }];
      } else {
        options = [{ id: 'skip', label: 'Skip dismissal', danger: true, skip: true }];
      }
    } else {
      // Generic activity/slot
      options = [
        ...slots.slice(0, 2).map((s, i) => ({
          id: `slot${i}`, label: `${label} at ${s.start}`,
          desc: `${s.start} – ${toTime(toMin(s.start) + duration)}`,
          slot: { ...s, end: toTime(toMin(s.start) + duration) },
          recommended: i === 0
        })),
        { id: 'skip', label: `Skip ${label.toLowerCase()}`, danger: true, skip: true }
      ];
    }

    // Add custom if not present
    if (!options.find(o => o.custom) && category !== 'dismissal') {
      options.push({ id: 'custom', label: 'Choose custom time', custom: true });
    }

    const reasonText = reason === 'trip' 
      ? `Conflicts with trip (${tripDetails.start} – ${tripDetails.end})`
      : 'Conflicts with scheduled activity';

    renderStep({
      title: `${division} — ${label}`,
      subtitle: `Originally ${block.startTime} – ${block.endTime}`,
      progress: `${rebuildQueue.length} remaining`,
      body: `
        <div class="tw-reason">${reasonText}</div>
        
        <div class="tw-options">
          ${options.map(o => `
            <button class="tw-option ${o.recommended ? 'rec' : ''} ${o.danger ? 'danger' : ''}"
                    data-id="${o.id}"
                    ${o.slot ? `data-start="${o.slot.start}" data-end="${o.slot.end}"` : ''}>
              <div class="tw-opt-text">
                <span class="tw-opt-label">${o.label}</span>
                ${o.desc ? `<span class="tw-opt-desc">${o.desc}</span>` : ''}
              </div>
              ${o.recommended ? '<span class="tw-badge">Recommended</span>' : ''}
            </button>
          `).join('')}
        </div>

        <div id="tw-custom-panel" style="display:none">
          <div class="tw-custom-form">
            <div class="tw-row">
              <div class="tw-field"><label>Start</label><input type="text" id="tw-cust-start" placeholder="${tripDetails.end}"></div>
              <div class="tw-field"><label>End</label><input type="text" id="tw-cust-end" placeholder="${toTime(toMin(tripDetails.end) + duration)}"></div>
            </div>
            <div class="tw-hint">Division: ${bounds.start} – ${bounds.end}</div>
            <button class="tw-btn sec" id="tw-apply-cust">Apply</button>
          </div>
        </div>
      `,
      back: decisionStack.length > 1 ? () => {
        undoLast();
        rebuildQueue.unshift(item);
        processQueue();
      } : null,
      hideNext: true,
      setup: () => {
        wizardEl.querySelectorAll('.tw-option').forEach(btn => {
          btn.onclick = () => {
            const id = btn.dataset.id;
            const opt = options.find(o => o.id === id);

            if (opt.skip) {
              saveState(`Skipped ${block.event}`);
              updatePreview();
              processQueue();
            } else if (opt.custom) {
              document.getElementById('tw-custom-panel').style.display = 'block';
            } else if (opt.slot) {
              placeBlock(item, opt.slot.start, opt.slot.end);
            }
          };
        });

        const applyBtn = document.getElementById('tw-apply-cust');
        if (applyBtn) {
          applyBtn.onclick = () => {
            const start = document.getElementById('tw-cust-start').value.trim();
            const end = document.getElementById('tw-cust-end').value.trim();

            if (toMin(start) == null || toMin(end) == null) {
              showToast("Invalid time", "warning"); return;
            }
            if (toMin(end) <= toMin(start)) {
              showToast("End must be after start", "warning"); return;
            }
            if (!isWithinBounds(division, start, end)) {
              showToast(`Must be within ${bounds.start} – ${bounds.end}`, "warning"); return;
            }

            // Check local conflicts
            const local = detectLocalConflicts(division, start, end);
            if (local.length > 0) {
              showToast(`Conflicts with ${local[0].event}`, "warning"); return;
            }

            // Check pool conflicts for swim
            if (category === 'swim') {
              const poolConf = detectPoolConflicts(division, start, end);
              if (poolConf.length > 0) {
                handlePoolConflict(item, poolConf[0], start, end);
                return;
              }
            }

            placeBlock(item, start, end);
          };
        }
      }
    });
  }

  function placeBlock(item, startTime, endTime) {
    const { division, block, category } = item;
    
    // For swim, double-check pool conflicts
    if (category === 'swim') {
      const poolConf = detectPoolConflicts(division, startTime, endTime);
      if (poolConf.length > 0) {
        handlePoolConflict(item, poolConf[0], startTime, endTime);
        return;
      }
    }

    addBlock(division, {
      ...block,
      startTime,
      endTime,
      reservedFields: category === 'swim' ? ['Pool'] : (block.reservedFields || [])
    });
    saveState(`Placed ${block.event} at ${startTime}`);
    updatePreview();
    processQueue();
  }

  // ------------------------------------------------------------
  // POOL CONFLICT HANDLING
  // ------------------------------------------------------------
  function handlePoolConflict(item, conflict, proposedStart, proposedEnd) {
    const { division, block } = item;
    const otherDiv = conflict.division;
    const otherBlock = conflict.block;

    renderStep({
      title: "Pool Scheduling Conflict",
      subtitle: `${otherDiv} has swim at this time`,
      body: `
        <div class="tw-pool-vis">
          <div class="tw-pool-card ours">
            <div class="tw-pool-div">${division}</div>
            <div class="tw-pool-time">${proposedStart} – ${proposedEnd}</div>
            <div class="tw-pool-label">Wants pool</div>
          </div>
          <div class="tw-pool-vs">conflicts with</div>
          <div class="tw-pool-card theirs">
            <div class="tw-pool-div">${otherDiv}</div>
            <div class="tw-pool-time">${otherBlock.startTime} – ${otherBlock.endTime}</div>
            <div class="tw-pool-label">Currently has pool</div>
          </div>
        </div>

        <div class="tw-options">
          <button class="tw-option" data-action="diff-time">
            <div class="tw-opt-text">
              <span class="tw-opt-label">Choose different time for ${division}</span>
              <span class="tw-opt-desc">Keep ${otherDiv}'s swim unchanged</span>
            </div>
          </button>

          <button class="tw-option rec" data-action="cascade">
            <div class="tw-opt-text">
              <span class="tw-opt-label">Give ${division} this time</span>
              <span class="tw-opt-desc">${otherDiv}'s swim will need to be rescheduled</span>
            </div>
            <span class="tw-badge">Cascade</span>
          </button>

          <button class="tw-option" data-action="swap">
            <div class="tw-opt-text">
              <span class="tw-opt-label">Swap times</span>
              <span class="tw-opt-desc">${division} gets ${otherBlock.startTime}, ${otherDiv} gets ${proposedStart}</span>
            </div>
          </button>

          <button class="tw-option danger" data-action="skip">
            <div class="tw-opt-text">
              <span class="tw-opt-label">Skip swim for ${division}</span>
            </div>
          </button>
        </div>
      `,
      back: decisionStack.length > 1 ? () => {
        undoLast();
        rebuildQueue.unshift(item);
        processQueue();
      } : null,
      hideNext: true,
      setup: () => {
        wizardEl.querySelectorAll('.tw-option').forEach(btn => {
          btn.onclick = () => {
            const action = btn.dataset.action;

            if (action === 'diff-time') {
              // Go back to reschedule
              askReschedule(item, 'pool-conflict');

            } else if (action === 'cascade') {
              // Place our swim
              addBlock(division, {
                ...block,
                startTime: proposedStart,
                endTime: proposedEnd,
                reservedFields: ['Pool']
              });

              // Remove their swim
              removeBlock(otherDiv, otherBlock.id);

              // Add their swim to the FRONT of the queue
              rebuildQueue.unshift({
                division: otherDiv,
                category: 'swim',
                block: otherBlock,
                autoAdd: false,
                cascaded: true,
                avoidTime: { start: proposedStart, end: proposedEnd }
              });

              saveState(`${division} gets pool at ${proposedStart}, cascading to ${otherDiv}`);
              updatePreview();
              processQueue();

            } else if (action === 'swap') {
              // Check if we can use their time
              const local = detectLocalConflicts(division, otherBlock.startTime, otherBlock.endTime);
              if (local.length > 0) {
                showToast(`${division} has ${local[0].event} at that time`, "warning");
                return;
              }

              // Check if they can use our time
              const otherLocal = detectLocalConflicts(otherDiv, proposedStart, proposedEnd, otherBlock.id);
              if (otherLocal.length > 0) {
                showToast(`${otherDiv} has ${otherLocal[0].event} at that time`, "warning");
                return;
              }

              // Place our swim at their time
              addBlock(division, {
                ...block,
                startTime: otherBlock.startTime,
                endTime: otherBlock.endTime,
                reservedFields: ['Pool']
              });

              // Update their swim to our time
              removeBlock(otherDiv, otherBlock.id);
              addBlock(otherDiv, {
                ...otherBlock,
                startTime: proposedStart,
                endTime: proposedEnd,
                isNew: true
              });

              saveState(`Swapped swim: ${division} ↔ ${otherDiv}`);
              updatePreview();
              processQueue();

            } else if (action === 'skip') {
              saveState(`Skipped swim for ${division}`);
              updatePreview();
              processQueue();
            }
          };
        });
      }
    });
  }

  // ------------------------------------------------------------
  // FINAL REVIEW
  // ------------------------------------------------------------
  function showFinalReview() {
    const byDiv = {};
    allDivisions.forEach(d => byDiv[d] = { added: [], removed: [] });

    plannedChanges.forEach(c => {
      if (c.action === 'add') byDiv[c.division].added.push(c.block);
      else if (c.action === 'remove') byDiv[c.division].removed.push(c.block);
    });

    const affected = Object.keys(byDiv).filter(d => byDiv[d].added.length || byDiv[d].removed.length);

    renderStep({
      title: "Review Changes",
      subtitle: `${affected.length} division${affected.length !== 1 ? 's' : ''} affected`,
      body: `
        <div class="tw-summary">
          ${affected.map(div => {
            const isTraveling = travelingDivisions.includes(div);
            const { added, removed } = byDiv[div];

            return `
              <div class="tw-sum-div">
                <div class="tw-sum-header">
                  <span class="tw-sum-name">${div}</span>
                  <span class="tw-badge ${isTraveling ? 'trip' : 'affected'}">${isTraveling ? 'Trip' : 'Affected'}</span>
                </div>
                <div class="tw-sum-items">
                  ${added.map(b => `
                    <div class="tw-sum-item add">
                      <span class="tw-sum-icon">+</span>
                      <span class="tw-sum-event">${b.event}</span>
                      <span class="tw-sum-time">${b.startTime} – ${b.endTime}</span>
                    </div>
                  `).join('')}
                  ${removed.filter(r => !added.find(a => a.event === r.event && a.startTime !== r.startTime)).map(b => `
                    <div class="tw-sum-item remove">
                      <span class="tw-sum-icon">−</span>
                      <span class="tw-sum-event">${b.event}</span>
                      <span class="tw-sum-time">Removed</span>
                    </div>
                  `).join('')}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `,
      back: decisionStack.length > 1 ? () => { undoLast(); showFinalReview(); } : null,
      nextText: "Apply Changes",
      next: applyAll
    });
  }

  function applyAll() {
    const instructions = {};

    // For each affected division, rebuild from working skeleton
    allDivisions.forEach(div => {
      const hasChanges = plannedChanges.some(c => c.division === div);
      if (!hasChanges) return;

      instructions[div] = {
        division: div,
        actions: [{ type: 'wipe' }]
      };

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

    onComplete?.(Object.values(instructions));
    showToast("Trip scheduled!", "success");
    close();
  }

  // ------------------------------------------------------------
  // PREVIEW
  // ------------------------------------------------------------
  function updatePreview() {
    if (!previewEl) return;

    const show = [...travelingDivisions, ...allDivisions.filter(d => !travelingDivisions.includes(d))];
    
    let html = show.map(div => {
      const isTraveling = travelingDivisions.includes(div);
      const blocks = (workingSkeleton[div] || [])
        .slice()
        .sort((a, b) => (toMin(a.startTime) || 0) - (toMin(b.startTime) || 0));

      return `
        <div class="tw-prev-div ${isTraveling ? 'traveling' : ''}">
          <div class="tw-prev-head">
            <span class="tw-prev-name">${div}</span>
            <span class="tw-badge ${isTraveling ? 'trip' : 'camp'}">${isTraveling ? 'Trip' : 'Camp'}</span>
          </div>
          <div class="tw-prev-body">
            ${blocks.length === 0 ? '<div class="tw-prev-empty">Schedule wiped - rebuilding...</div>' : ''}
            ${blocks.map(b => {
              const cat = categorize(b);
              return `
                <div class="tw-prev-item ${b.isNew ? 'new' : ''} cat-${cat}">
                  <span class="tw-prev-time">${b.startTime}</span>
                  <div class="tw-prev-info">
                    <span class="tw-prev-event">${b.event}</span>
                    <span class="tw-prev-range">${b.startTime} – ${b.endTime}</span>
                  </div>
                  ${b.isNew ? '<span class="tw-prev-new">New</span>' : ''}
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }).join('');

    previewEl.innerHTML = html;
  }

  // ------------------------------------------------------------
  // UI HELPERS
  // ------------------------------------------------------------
  function showToast(msg, type = 'info') {
    const t = document.createElement('div');
    t.className = `tw-toast ${type}`;
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => t.remove(), 200);
    }, 2500);
  }

  function renderBase() {
    document.getElementById('tw-overlay')?.remove();

    const el = document.createElement('div');
    el.id = 'tw-overlay';
    el.innerHTML = `
      <div class="tw-container">
        <div class="tw-main">
          <div class="tw-header">
            <div class="tw-header-text">
              <h2>Trip Planner</h2>
              <p>Wipe and rebuild with automatic conflict resolution</p>
            </div>
            <button class="tw-close" id="tw-close">×</button>
          </div>
          <div class="tw-content" id="tw-content"></div>
        </div>
        <div class="tw-sidebar">
          <div class="tw-sidebar-head"><h3>Live Preview</h3></div>
          <div class="tw-sidebar-body" id="tw-preview"></div>
        </div>
      </div>
      ${getStyles()}
    `;

    document.body.appendChild(el);
    wizardEl = document.getElementById('tw-content');
    previewEl = document.getElementById('tw-preview');

    document.getElementById('tw-close').onclick = () => {
      if (plannedChanges.length && !confirm("Exit? Changes will be lost.")) return;
      close();
    };

    updatePreview();
  }

  function renderStep({ title, subtitle, progress, body, back, next, nextText = 'Continue', hideNext = false, setup }) {
    wizardEl.innerHTML = `
      <div class="tw-step">
        <div class="tw-step-head">
          <h3>${title}</h3>
          ${subtitle ? `<p class="tw-step-sub">${subtitle}</p>` : ''}
          ${progress ? `<p class="tw-step-prog">${progress}</p>` : ''}
        </div>
        <div class="tw-step-body">${body}</div>
        <div class="tw-step-foot">
          ${back ? '<button class="tw-btn sec" id="tw-back">← Back</button>' : '<div></div>'}
          ${!hideNext ? `<button class="tw-btn pri" id="tw-next">${nextText}</button>` : ''}
        </div>
      </div>
    `;

    if (back) document.getElementById('tw-back')?.addEventListener('click', back);
    if (!hideNext && next) document.getElementById('tw-next')?.addEventListener('click', next);
    if (setup) setup();
  }

  function close() {
    document.getElementById('tw-overlay')?.remove();
  }

  function getStyles() {
    return `<style>
      #tw-overlay {
        position: fixed; inset: 0;
        background: rgba(15,23,42,0.55);
        display: flex; align-items: center; justify-content: center;
        z-index: 10000; padding: 16px;
        backdrop-filter: blur(4px);
      }
      .tw-container {
        display: flex; width: 100%; max-width: 1000px;
        height: 85vh; max-height: 700px;
        background: #fff; border-radius: 12px;
        overflow: hidden;
        box-shadow: 0 25px 50px -12px rgba(0,0,0,0.25);
      }
      .tw-main {
        flex: 1; display: flex; flex-direction: column; min-width: 0;
      }
      .tw-header {
        display: flex; justify-content: space-between; align-items: flex-start;
        padding: 16px 20px; border-bottom: 1px solid #e5e7eb; background: #f9fafb;
      }
      .tw-header h2 { margin: 0; font-size: 1rem; font-weight: 600; color: #111827; }
      .tw-header p { margin: 4px 0 0; font-size: 0.8rem; color: #6b7280; }
      .tw-close {
        width: 32px; height: 32px; border-radius: 999px;
        border: 1px solid #d1d5db; background: #fff; color: #6b7280;
        font-size: 18px; cursor: pointer; transition: all 0.15s;
      }
      .tw-close:hover { background: #f3f4f6; color: #374151; }
      .tw-content { flex: 1; overflow-y: auto; padding: 20px; }
      .tw-sidebar {
        width: 280px; background: #f9fafb; border-left: 1px solid #e5e7eb;
        display: flex; flex-direction: column;
      }
      .tw-sidebar-head {
        padding: 12px 16px; border-bottom: 1px solid #e5e7eb; background: #fff;
      }
      .tw-sidebar-head h3 { margin: 0; font-size: 0.85rem; font-weight: 600; color: #111827; }
      .tw-sidebar-body { flex: 1; overflow-y: auto; padding: 12px; }

      /* Step */
      .tw-step { display: flex; flex-direction: column; min-height: 100%; }
      .tw-step-head { margin-bottom: 20px; }
      .tw-step-head h3 { margin: 0; font-size: 1.15rem; font-weight: 600; color: #111827; }
      .tw-step-sub { margin: 6px 0 0; font-size: 0.85rem; color: #6b7280; }
      .tw-step-prog { margin: 8px 0 0; font-size: 0.75rem; color: #9ca3af; }
      .tw-step-body { flex: 1; }
      .tw-step-foot {
        display: flex; justify-content: space-between;
        padding-top: 20px; margin-top: 20px; border-top: 1px solid #e5e7eb;
      }

      /* Buttons */
      .tw-btn {
        font-family: inherit; font-size: 0.85rem; font-weight: 500;
        padding: 10px 20px; border-radius: 999px; cursor: pointer; transition: all 0.15s;
      }
      .tw-btn.pri { background: #2563eb; color: #fff; border: 1px solid #2563eb; }
      .tw-btn.pri:hover { background: #1d4ed8; box-shadow: 0 4px 8px rgba(37,99,235,0.25); }
      .tw-btn.sec { background: #fff; color: #374151; border: 1px solid #d1d5db; }
      .tw-btn.sec:hover { background: #f3f4f6; }
      .tw-link { background: none; border: none; color: #2563eb; font-size: 0.85rem; cursor: pointer; }
      .tw-link:hover { text-decoration: underline; }

      /* Forms */
      .tw-form { display: flex; flex-direction: column; gap: 16px; }
      .tw-field { display: flex; flex-direction: column; gap: 6px; }
      .tw-field label { font-size: 0.8rem; font-weight: 500; color: #374151; }
      .tw-field input {
        font-family: inherit; font-size: 0.85rem; padding: 8px 12px;
        border-radius: 999px; border: 1px solid #d1d5db; background: #fff;
      }
      .tw-field input:focus { outline: none; border-color: #2563eb; box-shadow: 0 0 0 1px rgba(37,99,235,0.3); }
      .tw-row { display: flex; gap: 12px; }
      .tw-row .tw-field { flex: 1; }
      .tw-note {
        display: none; padding: 8px 12px; background: #ecfdf5;
        border: 1px solid #a7f3d0; border-radius: 6px; font-size: 0.8rem; color: #065f46;
      }

      /* List */
      .tw-list { display: flex; flex-direction: column; gap: 8px; }
      .tw-list-item {
        display: flex; align-items: center; gap: 12px;
        padding: 12px 14px; border: 1px solid #e5e7eb; border-radius: 8px;
        cursor: pointer; background: #fff; transition: all 0.15s;
      }
      .tw-list-item:hover { border-color: #2563eb; background: #f9fafb; }
      .tw-list-item:has(input:checked) { border-color: #2563eb; background: #eff6ff; }
      .tw-list-item input { width: 16px; height: 16px; }
      .tw-list-info { flex: 1; }
      .tw-list-name { display: block; font-weight: 600; color: #111827; }
      .tw-list-meta { display: block; font-size: 0.75rem; color: #6b7280; }
      .tw-quick { display: flex; gap: 12px; margin-top: 8px; }

      /* Reason */
      .tw-reason {
        margin-bottom: 16px; padding: 10px 14px; background: #fef3c7;
        border: 1px solid #fcd34d; border-radius: 6px; font-size: 0.85rem; color: #92400e;
      }

      /* Options */
      .tw-options { display: flex; flex-direction: column; gap: 8px; }
      .tw-option {
        display: flex; align-items: center; justify-content: space-between;
        width: 100%; padding: 14px 16px; border: 1px solid #e5e7eb; border-radius: 8px;
        background: #fff; cursor: pointer; text-align: left; transition: all 0.15s;
      }
      .tw-option:hover { border-color: #2563eb; background: #f9fafb; }
      .tw-option.rec { border-color: #a7f3d0; background: #f0fdf4; }
      .tw-option.rec:hover { border-color: #4ade80; }
      .tw-option.danger { border-color: #fecaca; }
      .tw-option.danger:hover { border-color: #f87171; background: #fef2f2; }
      .tw-opt-text { display: flex; flex-direction: column; gap: 2px; }
      .tw-opt-label { font-size: 0.9rem; font-weight: 500; color: #111827; }
      .tw-opt-desc { font-size: 0.8rem; color: #6b7280; }
      .tw-badge {
        padding: 3px 8px; background: #22c55e; color: #fff; border-radius: 999px;
        font-size: 0.65rem; font-weight: 600; text-transform: uppercase;
      }
      .tw-badge.trip { background: #fef3c7; color: #92400e; }
      .tw-badge.camp { background: #e5e7eb; color: #4b5563; }
      .tw-badge.affected { background: #dbeafe; color: #1e40af; }

      /* Custom panel */
      #tw-custom-panel {
        margin-top: 16px; padding: 16px; background: #f9fafb;
        border: 1px solid #e5e7eb; border-radius: 8px;
      }
      .tw-custom-form { display: flex; flex-direction: column; gap: 12px; }
      .tw-hint { font-size: 0.75rem; color: #9ca3af; }

      /* Pool conflict */
      .tw-pool-vis {
        display: flex; align-items: center; justify-content: center; gap: 16px;
        padding: 20px; background: #f0f9ff; border: 1px solid #bae6fd;
        border-radius: 8px; margin-bottom: 16px;
      }
      .tw-pool-card {
        text-align: center; padding: 12px 20px; border-radius: 8px; min-width: 120px;
      }
      .tw-pool-card.ours { background: #dbeafe; border: 2px dashed #3b82f6; }
      .tw-pool-card.theirs { background: #fff; border: 1px solid #e5e7eb; }
      .tw-pool-div { font-weight: 600; color: #111827; }
      .tw-pool-time { font-size: 0.85rem; color: #4b5563; }
      .tw-pool-label { font-size: 0.7rem; color: #6b7280; text-transform: uppercase; margin-top: 4px; }
      .tw-pool-vs { font-weight: 600; color: #9ca3af; }

      /* Summary */
      .tw-summary { display: flex; flex-direction: column; gap: 16px; max-height: 400px; overflow-y: auto; }
      .tw-sum-div { border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; }
      .tw-sum-header {
        display: flex; align-items: center; gap: 8px;
        padding: 10px 14px; background: #f3f4f6; border-bottom: 1px solid #e5e7eb;
      }
      .tw-sum-name { font-weight: 600; color: #111827; }
      .tw-sum-items { padding: 10px 14px; }
      .tw-sum-item {
        display: flex; align-items: center; gap: 10px;
        padding: 8px 0; border-bottom: 1px solid #f3f4f6;
      }
      .tw-sum-item:last-child { border-bottom: none; }
      .tw-sum-icon { width: 20px; font-weight: 700; text-align: center; }
      .tw-sum-item.add .tw-sum-icon { color: #22c55e; }
      .tw-sum-item.remove .tw-sum-icon { color: #ef4444; }
      .tw-sum-event { flex: 1; font-weight: 500; color: #111827; }
      .tw-sum-time { font-size: 0.8rem; color: #6b7280; }

      /* Preview */
      .tw-prev-div {
        background: #fff; border: 1px solid #e5e7eb; border-radius: 8px;
        margin-bottom: 10px; overflow: hidden;
      }
      .tw-prev-div.traveling { border-color: #fbbf24; }
      .tw-prev-head {
        display: flex; align-items: center; gap: 8px;
        padding: 8px 12px; background: #f3f4f6; border-bottom: 1px solid #e5e7eb;
      }
      .tw-prev-name { font-size: 0.85rem; font-weight: 600; color: #111827; }
      .tw-prev-body { padding: 8px; }
      .tw-prev-empty { padding: 12px; text-align: center; color: #9ca3af; font-size: 0.8rem; font-style: italic; }
      .tw-prev-item {
        display: flex; align-items: flex-start; gap: 8px;
        padding: 6px 8px; border-radius: 4px; margin-bottom: 4px;
        background: #f9fafb; border-left: 3px solid #d1d5db;
      }
      .tw-prev-item.new { background: #f0fdf4; border-left-color: #22c55e; }
      .tw-prev-item.cat-trip { border-left-color: #eab308; background: #fef9c3; }
      .tw-prev-item.cat-swim { border-left-color: #06b6d4; }
      .tw-prev-item.cat-lunch { border-left-color: #f97316; }
      .tw-prev-item.cat-snack { border-left-color: #84cc16; }
      .tw-prev-item.cat-league { border-left-color: #8b5cf6; }
      .tw-prev-item.cat-dismissal { border-left-color: #ef4444; }
      .tw-prev-time { font-size: 0.7rem; font-weight: 600; color: #6b7280; min-width: 45px; }
      .tw-prev-info { flex: 1; min-width: 0; }
      .tw-prev-event { font-size: 0.8rem; font-weight: 500; color: #111827; display: block; }
      .tw-prev-range { font-size: 0.7rem; color: #9ca3af; }
      .tw-prev-new {
        padding: 2px 6px; background: #22c55e; color: #fff;
        border-radius: 999px; font-size: 0.55rem; font-weight: 600;
      }

      /* Toast */
      .tw-toast {
        position: fixed; bottom: 20px; left: 50%;
        transform: translateX(-50%) translateY(60px);
        padding: 10px 18px; background: #1f2937; color: #fff;
        border-radius: 8px; font-size: 0.85rem; z-index: 10001;
        opacity: 0; transition: all 0.2s;
      }
      .tw-toast.show { transform: translateX(-50%) translateY(0); opacity: 1; }
      .tw-toast.success { background: #059669; }
      .tw-toast.warning { background: #d97706; }

      @media (max-width: 768px) {
        .tw-container { flex-direction: column; height: 95vh; }
        .tw-sidebar { width: 100%; max-height: 180px; border-left: none; border-top: 1px solid #e5e7eb; }
      }
    </style>`;
  }

})();
