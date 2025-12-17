// =================================================================
// daily_adjustments.js  (UPDATED - SMOOTH DRAG & MINOR UI POLISH)
// - Added smooth drag-to-reposition with visual preview
// - Tiles bump down instead of being deleted
// - Minor UI/UX improvements
// - All original functionality preserved
// =================================================================

(function() {
'use strict';

let container = null;
let masterSettings = {};
let currentOverrides = {
  dailyFieldAvailability: {},
  leagues: [],
  disabledSpecialtyLeagues: [],
  dailyDisabledSportsByField: {},
  disabledFields: [],
  disabledSpecials: [],
  bunkActivityOverrides: []
};

// --- Displaced tiles tracking ---
let displacedTiles = [];

// --- Smart Tile history (cross-day fairness) ---
let smartTileHistory = null;
const SMART_TILE_HISTORY_KEY = "smartTileHistory_v1";

function loadSmartTileHistory() {
  try {
    if (!window.localStorage) return { byBunk: {} };
    const raw = localStorage.getItem(SMART_TILE_HISTORY_KEY);
    if (!raw) return { byBunk: {} };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { byBunk: {} };
    if (!parsed.byBunk) parsed.byBunk = {};
    return parsed;
  } catch (e) {
    console.warn("Daily Adjustments: Failed to load smartTileHistory", e);
    return { byBunk: {} };
  }
}

function saveSmartTileHistory(history) {
  try {
    if (!window.localStorage) return;
    const toSave = history && typeof history === "object" ? history : { byBunk: {} };
    localStorage.setItem(SMART_TILE_HISTORY_KEY, JSON.stringify(toSave));
  } catch (e) {
    console.warn("Daily Adjustments: Failed to save smartTileHistory", e);
  }
}

// --- Helper containers ---
let skeletonContainer = null;
let tripsFormContainer = null;
let bunkOverridesContainer = null;
let resourceOverridesContainer = null;

// Keep track of which sub-tab is active
let activeSubTab = 'skeleton';

// =================================================================
// ===== START: SKELETON EDITOR LOGIC =====
// =================================================================

let dailyOverrideSkeleton = [];
const PIXELS_PER_MINUTE = 2;
const INCREMENT_MINS = 30;

// --- Tile Definitions (MATCH master_schedule_builder.js) ---
const TILES = [
  { type: 'activity', name: 'Activity', style: 'background:#e0f7fa;border:1px solid #007bff;', description: 'Flexible slot (Sport or Special).' },
  { type: 'sports', name: 'Sports', style: 'background:#dcedc8;border:1px solid #689f38;', description: 'Sports slot only.' },
  { type: 'special', name: 'Special Activity', style: 'background:#e8f5e9;border:1px solid #43a047;', description: 'Special Activity slot only.' },
  { type:'smart', name:'Smart Tile', style:'background:#e3f2fd;border:2px dashed #0288d1;color:#01579b;', description:'Balances 2 activities with a fallback (e.g. Special full? -> Sports).' },
  { type: 'split', name: 'Split Activity', style: 'background:#fff3e0;border:1px solid #f57c00;', description: 'Two activities share the block.' },
  { type: 'league', name: 'League Game', style: 'background:#d1c4e9;border:1px solid #5e35b1;', description: 'Regular League slot.' },
  { type: 'specialty_league', name: 'Specialty League', style: 'background:#fff8e1;border:1px solid #f9a825;', description: 'Specialty League slot.' },
  { type: 'swim', name: 'Swim', style: 'background:#bbdefb;border:1px solid #1976d2;', description: 'Pinned.' },
  { type: 'lunch', name: 'Lunch', style: 'background:#fbe9e7;border:1px solid #d84315;', description: 'Pinned.' },
  { type: 'snacks', name: 'Snacks', style: 'background:#fff9c4;border:1px solid #fbc02d;', description: 'Pinned.' },
  { type: 'dismissal', name: 'Dismissal', style: 'background:#f44336;color:white;border:1px solid #b71c1c;', description: 'Pinned.' },
  { type: 'custom', name: 'Custom Pinned Event', style: 'background:#eee;border:1px solid #616161;', description: 'Pinned custom (e.g., Regroup).' }
];

function mapEventNameForOptimizer(name) {
    if (!name) name = "Free";
    const lower = name.toLowerCase().trim();

    if (lower === 'activity')           return { type: 'slot', event: 'General Activity Slot' };
    if (lower === 'sports')             return { type: 'slot', event: 'Sports Slot' };
    if (lower === 'special activity' ||
        lower === 'special')            return { type: 'slot', event: 'Special Activity' };

    if (lower.includes('specialty league'))
        return { type: 'specialty_league', event: 'Specialty League' };

    if (lower.includes('league'))
        return { type: 'league', event: 'League Game' };

    if (['swim','lunch','snacks','dismissal'].includes(lower))
        return { type: 'pinned', event: name };

    return { type: 'pinned', event: name };
}

// =================================================================
// Field Selection Helper for Reserved Fields
// =================================================================
function promptForReservedFields(eventName) {
  const allFields = (masterSettings.app1.fields || []).map(f => f.name);
  const specialActivities = (masterSettings.app1.specialActivities || []).map(s => s.name);
  const allLocations = [...new Set([...allFields, ...specialActivities])].sort();
  
  if (allLocations.length === 0) return [];
  
  const fieldInput = prompt(
    `Which field(s) will "${eventName}" use?\n\n` +
    `This reserves the field so the scheduler won't assign it to other bunks.\n\n` +
    `Available fields:\n${allLocations.join(', ')}\n\n` +
    `Enter field names separated by commas (or leave blank if none):`,
    ''
  );
  
  if (!fieldInput || !fieldInput.trim()) return [];
  
  const requested = fieldInput.split(',').map(f => f.trim()).filter(Boolean);
  const validated = [];
  const invalid = [];
  
  requested.forEach(name => {
    const match = allLocations.find(loc => loc.toLowerCase() === name.toLowerCase());
    if (match) validated.push(match);
    else invalid.push(name);
  });
  
  if (invalid.length > 0) {
    alert(`Warning: These fields were not found and will be ignored:\n${invalid.join(', ')}`);
  }
  
  return validated;
}

// =================================================================
// DISPLACED TILES TRACKER
// =================================================================

function addDisplacedTile(event, reason) {
  displacedTiles.push({
    event: event.event,
    division: event.division,
    originalStart: event.startTime,
    originalEnd: event.endTime,
    reason: reason,
    timestamp: Date.now()
  });
  renderDisplacedTilesPanel();
}

function clearDisplacedTiles() {
  displacedTiles = [];
  renderDisplacedTilesPanel();
}

function renderDisplacedTilesPanel() {
  const panel = document.getElementById('displaced-tiles-panel');
  if (!panel) return;
  
  if (displacedTiles.length === 0) {
    panel.style.display = 'none';
    return;
  }
  
  panel.style.display = 'block';
  panel.innerHTML = `
    <div style="background:#fff3e0;border:1px solid #ffb300;border-radius:8px;padding:12px;margin-bottom:12px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <strong style="color:#e65100;">📋 Displaced Tiles (${displacedTiles.length})</strong>
        <button id="clear-displaced-btn" style="background:#fff;border:1px solid #ffb300;color:#e65100;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:0.85em;">Clear</button>
      </div>
      <div style="max-height:120px;overflow-y:auto;">
        ${displacedTiles.map(d => `
          <div style="background:#fff;padding:6px 10px;margin-bottom:4px;border-radius:4px;font-size:0.85em;display:flex;justify-content:space-between;align-items:center;">
            <span><strong>${d.event}</strong> (${d.division})</span>
            <span style="color:#888;">${d.originalStart} - ${d.originalEnd} • ${d.reason}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;
  
  document.getElementById('clear-displaced-btn').onclick = clearDisplacedTiles;
}

// =================================================================
// BUMP LOGIC - Shifts tiles down instead of deleting
// =================================================================

function bumpOverlappingTiles(newEvent, divName) {
  const newStartMin = parseTimeToMinutes(newEvent.startTime);
  const newEndMin = parseTimeToMinutes(newEvent.endTime);
  
  const div = window.divisions?.[divName] || {};
  const divEndMin = parseTimeToMinutes(div.endTime) || 960;
  
  // Find overlapping events in this division (excluding the new event itself)
  const overlapping = dailyOverrideSkeleton.filter(ev => {
    if (ev.id === newEvent.id) return false;
    if (ev.division !== divName) return false;
    
    const evStart = parseTimeToMinutes(ev.startTime);
    const evEnd = parseTimeToMinutes(ev.endTime);
    if (evStart == null || evEnd == null) return false;
    
    return (evStart < newEndMin && evEnd > newStartMin);
  });
  
  if (overlapping.length === 0) return;
  
  // Sort by start time
  overlapping.sort((a, b) => parseTimeToMinutes(a.startTime) - parseTimeToMinutes(b.startTime));
  
  let currentEndMin = newEndMin;
  
  overlapping.forEach(ev => {
    const evStart = parseTimeToMinutes(ev.startTime);
    const evEnd = parseTimeToMinutes(ev.endTime);
    const duration = evEnd - evStart;
    
    const newStart = currentEndMin;
    const newEnd = newStart + duration;
    
    if (newEnd > divEndMin) {
      addDisplacedTile(ev, 'No room');
      dailyOverrideSkeleton = dailyOverrideSkeleton.filter(e => e.id !== ev.id);
    } else {
      ev.startTime = minutesToTime(newStart);
      ev.endTime = minutesToTime(newEnd);
      currentEndMin = newEnd;
    }
  });
}

// =================================================================
// RENDER FUNCTIONS
// =================================================================

function renderPalette(paletteContainer) {
  paletteContainer.innerHTML = '<span style="font-weight:600;align-self:center;margin-right:8px;">Drag tiles:</span>';
  TILES.forEach(tile => {
    const el = document.createElement('div');
    el.className = 'grid-tile-draggable';
    el.textContent = tile.name;
    el.style.cssText = tile.style;
    el.style.padding = '8px 14px';
    el.style.borderRadius = '6px';
    el.style.cursor = 'grab';
    el.style.fontSize = '0.9em';
    el.style.transition = 'transform 0.15s, box-shadow 0.15s';
    el.title = tile.description;
    el.draggable = true;
    el.ondragstart = (e) => {
      e.dataTransfer.setData('application/json', JSON.stringify(tile));
      e.dataTransfer.effectAllowed = 'copy';
      el.style.opacity = '0.6';
    };
    el.ondragend = () => { el.style.opacity = '1'; };
    el.onmouseenter = () => { el.style.transform = 'translateY(-2px)'; el.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)'; };
    el.onmouseleave = () => { el.style.transform = ''; el.style.boxShadow = ''; };
    paletteContainer.appendChild(el);
  });
}

function renderGrid(gridContainer) {
  const divisions = window.divisions || {};
  const availableDivisions = window.availableDivisions || [];

  let earliestMin = null;
  let latestMin = null;
  Object.values(divisions).forEach(div => {
    const s = parseTimeToMinutes(div.startTime);
    const e = parseTimeToMinutes(div.endTime);
    if (s !== null && (earliestMin === null || s < earliestMin)) earliestMin = s;
    if (e !== null && (latestMin === null || e > latestMin)) latestMin = e;
  });
  if (earliestMin === null) earliestMin = 540;
  if (latestMin === null) latestMin = 960;

  const latestPinnedEnd = Math.max(
    -Infinity,
    ...dailyOverrideSkeleton
      .filter(ev => ev && ev.type === 'pinned')
      .map(ev => parseTimeToMinutes(ev.endTime) ?? -Infinity)
  );
  if (Number.isFinite(latestPinnedEnd)) latestMin = Math.max(latestMin, latestPinnedEnd);
  if (latestMin <= earliestMin) latestMin = earliestMin + 60;

  const totalMinutes = latestMin - earliestMin;
  const totalHeight = totalMinutes * PIXELS_PER_MINUTE;

  // Store for drag calculations
  gridContainer.dataset.earliestMin = earliestMin;

  let gridHtml = `<div style="display:grid;grid-template-columns:60px repeat(${availableDivisions.length},1fr);position:relative;">`;
  gridHtml += `<div style="grid-row:1;position:sticky;top:0;background:#f8f9fa;z-index:10;border-bottom:1px solid #dee2e6;padding:10px 8px;font-weight:600;color:#495057;">Time</div>`;

  availableDivisions.forEach((divName, i) => {
    gridHtml += `
      <div style="
        grid-row:1;
        grid-column:${i + 2};
        position:sticky;
        top:0;
        background:${divisions[divName]?.color || '#333'};
        color:#fff;
        z-index:10;
        border-bottom:1px solid #dee2e6;
        padding:10px 8px;
        text-align:center;
        font-weight:600;
      ">${divName}</div>`;
  });

  // Time column
  gridHtml += `<div style="grid-row:2;grid-column:1;height:${totalHeight}px;position:relative;background:#f8f9fa;border-right:1px solid #dee2e6;">`;
  for (let min = earliestMin; min < latestMin; min += INCREMENT_MINS) {
    const top = (min - earliestMin) * PIXELS_PER_MINUTE;
    gridHtml += `
      <div style="
        position:absolute;
        top:${top}px;
        left:0;
        width:100%;
        height:${INCREMENT_MINS * PIXELS_PER_MINUTE}px;
        border-bottom:1px dashed #e9ecef;
        box-sizing:border-box;
        font-size:11px;
        padding:2px 6px;
        color:#6c757d;
      ">${minutesToTime(min)}</div>`;
  }
  gridHtml += `</div>`;

  // Division columns
  availableDivisions.forEach((divName, i) => {
    const div = divisions[divName];
    const divStartMin = parseTimeToMinutes(div?.startTime);
    const divEndMin = parseTimeToMinutes(div?.endTime);

    gridHtml += `
      <div class="grid-cell"
           data-div="${divName}"
           data-start-min="${earliestMin}"
           style="grid-row:2;grid-column:${i + 2};position:relative;height:${totalHeight}px;border-right:1px solid #dee2e6;transition:background 0.15s;">`;

    if (divStartMin !== null && divStartMin > earliestMin) {
      const greyHeight = (divStartMin - earliestMin) * PIXELS_PER_MINUTE;
      gridHtml += `<div class="grid-disabled" style="top:0;height:${greyHeight}px;"></div>`;
    }
    if (divEndMin !== null && divEndMin < latestMin) {
      const greyTop = (divEndMin - earliestMin) * PIXELS_PER_MINUTE;
      const greyHeight = (latestMin - divEndMin) * PIXELS_PER_MINUTE;
      gridHtml += `<div class="grid-disabled" style="top:${greyTop}px;height:${greyHeight}px;"></div>`;
    }

    dailyOverrideSkeleton
      .filter(ev => ev.division === divName)
      .forEach(event => {
        const startMin = parseTimeToMinutes(event.startTime);
        const endMin = parseTimeToMinutes(event.endTime);
        if (startMin == null || endMin == null) return;

        const visibleStartMin = Math.max(startMin, earliestMin);
        const visibleEndMin = Math.min(endMin, latestMin);
        if (visibleEndMin <= visibleStartMin) return;

        const top = (visibleStartMin - earliestMin) * PIXELS_PER_MINUTE;
        const height = (visibleEndMin - visibleStartMin) * PIXELS_PER_MINUTE;
        gridHtml += renderEventTile(event, top, height);
      });

    // Drop preview element
    gridHtml += `<div class="drop-preview" style="display:none;position:absolute;left:2px;right:2px;background:rgba(37,99,235,0.15);border:2px dashed #2563eb;border-radius:6px;pointer-events:none;z-index:5;"></div>`;

    gridHtml += `</div>`;
  });

  gridHtml += `</div>`;
  gridContainer.innerHTML = gridHtml;
  
  addDropListeners(gridContainer);
  addDragToRepositionListeners(gridContainer);
  addRemoveListeners(gridContainer);
  
  // Apply conflict highlighting if sandbox is available
  if (window.SkeletonSandbox) {
    window.SkeletonSandbox.renderBanner('#override-scheduler-content', dailyOverrideSkeleton);
    applyConflictHighlighting(gridContainer);
  }
}

function renderEventTile(event, top, height) {
  let tile = TILES.find(t => t.name === event.event);
  if (!tile) {
    if (event.type === 'split')         tile = TILES.find(t => t.type === 'split');
    else if (event.type === 'smart')    tile = TILES.find(t => t.type === 'smart');
    else if (event.event === 'General Activity Slot') tile = TILES.find(t => t.type === 'activity');
    else if (event.event === 'Sports Slot')           tile = TILES.find(t => t.type === 'sports');
    else if (event.event === 'Special Activity')      tile = TILES.find(t => t.type === 'special');
    else if (event.event === 'Dismissal')             tile = TILES.find(t => t.type === 'dismissal');
    else                                              tile = TILES.find(t => t.type === 'custom');
  }
  const style = tile ? tile.style : 'background:#eee;border:1px solid #616161;';
  let tripStyle = '';

  if (event.type === 'pinned' && tile && tile.type === 'custom') {
    tripStyle = 'background:#455a64;color:white;border:1px solid #263238;';
  }

  let innerHtml = `<strong style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${event.event}</strong><div style="font-size:.8em;color:#555;">${event.startTime} - ${event.endTime}</div>`;
  
  if (event.reservedFields && event.reservedFields.length > 0) {
    innerHtml += `<div style="font-size:0.7em;color:#c62828;margin-top:2px;">📍 ${event.reservedFields.join(', ')}</div>`;
  }
  
  if (event.type === 'smart' && event.smartData) {
    innerHtml += `<div style="font-size:0.7em;margin-top:2px;opacity:0.8;">↳ ${event.smartData.fallbackActivity}</div>`;
  }

  return `
    <div class="grid-event"
         data-event-id="${event.id}"
         draggable="true"
         title="Drag to move • Double-click to remove"
         style="${tripStyle || style}padding:4px 6px;border-radius:6px;text-align:center;
                 margin:0 2px;font-size:.85em;position:absolute;
                 top:${top}px;height:${height}px;width:calc(100% - 6px);
                 box-sizing:border-box;overflow:hidden;cursor:grab;
                 transition:transform 0.1s, box-shadow 0.1s;">
      ${innerHtml}
    </div>`;
}

// =================================================================
// SMOOTH DRAG TO REPOSITION
// =================================================================

function addDragToRepositionListeners(gridContainer) {
  const earliestMin = parseInt(gridContainer.dataset.earliestMin, 10) || 540;
  
  // Create ghost element for smooth dragging
  let ghost = document.getElementById('drag-ghost');
  if (!ghost) {
    ghost = document.createElement('div');
    ghost.id = 'drag-ghost';
    ghost.style.cssText = 'position:fixed;padding:8px 12px;background:#fff;border:2px solid #2563eb;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.2);pointer-events:none;z-index:10001;display:none;font-size:0.85em;max-width:150px;';
    document.body.appendChild(ghost);
  }
  
  let dragData = null;
  
  // Make existing events draggable
  gridContainer.querySelectorAll('.grid-event').forEach(tile => {
    tile.addEventListener('dragstart', (e) => {
      const eventId = tile.dataset.eventId;
      const event = dailyOverrideSkeleton.find(ev => ev.id === eventId);
      if (!event) return;
      
      const duration = parseTimeToMinutes(event.endTime) - parseTimeToMinutes(event.startTime);
      dragData = { type: 'move', id: eventId, event, duration };
      
      e.dataTransfer.setData('text/event-move', eventId);
      e.dataTransfer.effectAllowed = 'move';
      
      // Custom ghost
      ghost.innerHTML = `<strong>${event.event}</strong><br><span style="color:#666;">${event.startTime} - ${event.endTime}</span>`;
      ghost.style.display = 'block';
      
      // Hide default drag image
      const img = new Image();
      img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
      e.dataTransfer.setDragImage(img, 0, 0);
      
      tile.classList.add('dragging');
    });
    
    tile.addEventListener('drag', (e) => {
      if (e.clientX === 0 && e.clientY === 0) return;
      ghost.style.left = (e.clientX + 12) + 'px';
      ghost.style.top = (e.clientY + 12) + 'px';
    });
    
    tile.addEventListener('dragend', () => {
      tile.classList.remove('dragging');
      ghost.style.display = 'none';
      dragData = null;
      
      // Hide all previews
      gridContainer.querySelectorAll('.drop-preview').forEach(p => p.style.display = 'none');
      gridContainer.querySelectorAll('.grid-cell').forEach(c => c.classList.remove('drag-over'));
    });
  });
  
  // Drop zones
  gridContainer.querySelectorAll('.grid-cell').forEach(cell => {
    const preview = cell.querySelector('.drop-preview');
    
    cell.addEventListener('dragover', (e) => {
      const isEventMove = e.dataTransfer.types.includes('text/event-move');
      const isNewTile = e.dataTransfer.types.includes('application/json');
      
      if (!isEventMove && !isNewTile) return;
      
      e.preventDefault();
      e.dataTransfer.dropEffect = isEventMove ? 'move' : 'copy';
      cell.classList.add('drag-over');
      
      // Show drop preview for event moves
      if (isEventMove && dragData && preview) {
        const rect = cell.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const snapMin = Math.round(y / PIXELS_PER_MINUTE / 15) * 15;
        const cellStartMin = parseInt(cell.dataset.startMin, 10);
        
        preview.style.display = 'block';
        preview.style.top = (snapMin * PIXELS_PER_MINUTE) + 'px';
        preview.style.height = (dragData.duration * PIXELS_PER_MINUTE) + 'px';
        preview.innerHTML = `<div style="text-align:center;padding-top:4px;color:#2563eb;font-weight:500;">${minutesToTime(cellStartMin + snapMin)}</div>`;
      }
    });
    
    cell.addEventListener('dragleave', (e) => {
      if (!cell.contains(e.relatedTarget)) {
        cell.classList.remove('drag-over');
        if (preview) preview.style.display = 'none';
      }
    });
    
    cell.addEventListener('drop', (e) => {
      cell.classList.remove('drag-over');
      if (preview) preview.style.display = 'none';
      
      // Handle event move
      if (e.dataTransfer.types.includes('text/event-move')) {
        e.preventDefault();
        const eventId = e.dataTransfer.getData('text/event-move');
        const event = dailyOverrideSkeleton.find(ev => ev.id === eventId);
        if (!event) return;
        
        const divName = cell.dataset.div;
        const cellStartMin = parseInt(cell.dataset.startMin, 10);
        
        const rect = cell.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const snapMin = Math.round(y / PIXELS_PER_MINUTE / 15) * 15;
        
        const duration = parseTimeToMinutes(event.endTime) - parseTimeToMinutes(event.startTime);
        const newStartMin = cellStartMin + snapMin;
        const newEndMin = newStartMin + duration;
        
        // Update event
        event.division = divName;
        event.startTime = minutesToTime(newStartMin);
        event.endTime = minutesToTime(newEndMin);
        
        // Bump overlapping tiles
        bumpOverlappingTiles(event, divName);
        
        saveDailySkeleton();
        renderGrid(gridContainer);
        return;
      }
    });
  });
}

function applyConflictHighlighting(gridContainer) {
  if (!window.SkeletonSandbox) return;
  
  const conflicts = window.SkeletonSandbox.detectConflicts(dailyOverrideSkeleton);
  const conflictMap = {};
  
  conflicts.forEach(c => {
    if (c.event1?.id) conflictMap[c.event1.id] = conflictMap[c.event1.id] === 'critical' ? 'critical' : c.type;
    if (c.event2?.id) conflictMap[c.event2.id] = conflictMap[c.event2.id] === 'critical' ? 'critical' : c.type;
  });
  
  gridContainer.querySelectorAll('.grid-event').forEach(tile => {
    tile.classList.remove('conflict-critical', 'conflict-warning');
    const severity = conflictMap[tile.dataset.eventId];
    if (severity) tile.classList.add(`conflict-${severity}`);
  });
}

window.refreshSkeletonConflicts = function() {
  const grid = document.getElementById('daily-skeleton-grid');
  if (grid) renderGrid(grid);
};

// =================================================================
// DROP NEW TILES FROM PALETTE
// =================================================================

function addDropListeners(gridContainer) {
  gridContainer.querySelectorAll('.grid-cell').forEach(cell => {
    cell.ondragover = (e) => {
      if (e.dataTransfer.types.includes('text/event-move')) return; // Handled by reposition listener
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      cell.style.backgroundColor = 'rgba(37, 99, 235, 0.08)';
    };
    
    cell.ondragleave = () => { 
      cell.style.backgroundColor = ''; 
    };
    
    cell.ondrop = (e) => {
      if (e.dataTransfer.types.includes('text/event-move')) return; // Handled by reposition listener
      
      e.preventDefault();
      cell.style.backgroundColor = '';

      let tileData;
      try {
        tileData = JSON.parse(e.dataTransfer.getData('application/json'));
      } catch {
        return;
      }
      
      const divName = cell.dataset.div;
      const div = window.divisions[divName] || {};
      const divStartMin = parseTimeToMinutes(div.startTime);
      const divEndMin = parseTimeToMinutes(div.endTime);

      const rect = cell.getBoundingClientRect();
      const scrollTop = cell.closest('#daily-skeleton-grid')?.scrollTop || 0;
      const y = e.clientY - rect.top + scrollTop;
      const droppedMin = Math.round(y / PIXELS_PER_MINUTE / 15) * 15;
      const earliestMin = parseInt(cell.dataset.startMin, 10);
      const defaultStartTime = minutesToTime(earliestMin + droppedMin);

      let eventType = 'slot';
      let eventName = tileData.name;
      let newEvent = null;

      const validateTime = (timeStr, isStartTime) => {
        const timeMin = parseTimeToMinutes(timeStr);
        if (timeMin === null) {
          alert("Invalid time format. Please use '9:00am' or '2:30pm'.");
          return null;
        }
        if (divStartMin !== null && timeMin < divStartMin) {
          alert(`Error: ${timeStr} is before this division's start time of ${div.startTime}.`);
          return null;
        }
        if (divEndMin !== null && (isStartTime ? timeMin >= divEndMin : timeMin > divEndMin)) {
          alert(`Error: ${timeStr} is after this division's end time of ${div.endTime}.`);
          return null;
        }
        return timeMin;
      };

      // --- Split Tile ---
      if (tileData.type === 'split') {
        let startTime, endTime, startMin, endMin;
        while (true) {
          startTime = prompt(`Enter Start Time for the *full* block:`, defaultStartTime);
          if (!startTime) return;
          startMin = validateTime(startTime, true);
          if (startMin !== null) break;
        }
        while (true) {
          endTime = prompt(`Enter End Time for the *full* block:`);
          if (!endTime) return;
          endMin = validateTime(endTime, false);
          if (endMin !== null) {
            if (endMin <= startMin) alert("End time must be after start time.");
            else break;
          }
        }
        const eventName1 = prompt("Enter name for FIRST activity (e.g., Swim, Sports):");
        if (!eventName1) return;
        const eventName2 = prompt("Enter name for SECOND activity (e.g., Activity, Sports):");
        if (!eventName2) return;
        const event1 = mapEventNameForOptimizer(eventName1);
        const event2 = mapEventNameForOptimizer(eventName2);
        newEvent = {
          id: `evt_${Math.random().toString(36).slice(2, 9)}`,
          type: 'split',
          event: `${eventName1} / ${eventName2}`,
          division: divName,
          startTime: startTime,
          endTime: endTime,
          subEvents: [event1, event2]
        };

      // --- SMART TILE ---
      } else if (tileData.type === 'smart') {
        let startTime, endTime, startMin, endMin;

        while (true) {
          startTime = prompt(`Smart Tile for ${divName}.\n\nEnter Start Time:`, defaultStartTime);
          if (!startTime) return;
          startMin = validateTime(startTime, true);
          if (startMin !== null) break;
        }

        while (true) {
          endTime = prompt(`Enter End Time:`);
          if (!endTime) return;
          endMin = validateTime(endTime, false);
          if (endMin !== null) {
            if (endMin <= startMin) alert("End time must be after start time.");
            else break;
          }
        }

        const rawMains = prompt("Enter the TWO MAIN activities (e.g., Swim / Special):");
        if (!rawMains) return;

        const mains = rawMains.split(/,|\//).map(s => s.trim()).filter(Boolean);
        if (mains.length < 2) {
          alert("Please enter TWO distinct activities.");
          return;
        }

        const [main1, main2] = mains;

        const pick = prompt(`Which activity requires a fallback?\n\n1: ${main1}\n2: ${main2}`);
        if (!pick) return;

        let fallbackFor;
        if (pick.trim() === "1" || pick.trim().toLowerCase() === main1.toLowerCase()) {
          fallbackFor = main1;
        } else if (pick.trim() === "2" || pick.trim().toLowerCase() === main2.toLowerCase()) {
          fallbackFor = main2;
        } else {
          alert("Invalid choice.");
          return;
        }

        const fallbackActivity = prompt(`If "${fallbackFor}" is unavailable, what should be played?\nExample: Sports`);
        if (!fallbackActivity) return;

        newEvent = {
          id: `evt_${Math.random().toString(36).slice(2, 9)}`,
          type: "smart",
          event: `${main1} / ${main2}`,
          division: divName,
          startTime,
          endTime,
          smartData: { main1, main2, fallbackFor, fallbackActivity }
        };

      // --- LEAGUE TILE ---
      } else if (tileData.type === 'league') {
        let startTime = prompt(`League Game start time:`, defaultStartTime);
        if (!startTime) return;
        let endTime = prompt(`League Game end time:`);
        if (!endTime) return;

        newEvent = {
          id: `evt_${Math.random().toString(36).slice(2, 9)}`,
          type: 'league',
          event: 'League Game',
          division: divName,
          startTime,
          endTime
        };

      // --- SPECIALTY LEAGUE TILE ---
      } else if (tileData.type === 'specialty_league') {
        let startTime = prompt(`Specialty League start time:`, defaultStartTime);
        if (!startTime) return;
        let endTime = prompt(`Specialty League end time:`);
        if (!endTime) return;

        newEvent = {
          id: `evt_${Math.random().toString(36).slice(2, 9)}`,
          type: 'specialty_league',
          event: 'Specialty League',
          division: divName,
          startTime,
          endTime
        };

      // --- Pinned tiles (WITH FIELD RESERVATION) ---
      } else if (['lunch','snacks','custom','dismissal','swim'].includes(tileData.type)) {
        eventType = 'pinned';
        let reservedFields = [];
        
        if (tileData.type === 'custom') {
          eventName = prompt("Enter the name for this custom pinned event (e.g., 'Regroup' or 'Special with R. Rosenfeld'):");
          if (!eventName) return;
          reservedFields = promptForReservedFields(eventName);
        } else {
          eventName = tileData.name;
          if (tileData.type === 'swim') {
            const swimField = (masterSettings.app1.fields || []).find(f => 
              f.name.toLowerCase().includes('swim') || f.name.toLowerCase().includes('pool')
            );
            if (swimField) reservedFields = [swimField.name];
          }
        }
        
        let startTime, endTime, startMin, endMin;
        while (true) {
          startTime = prompt(`Add "${eventName}" for ${divName}?\nEnter Start Time:`, defaultStartTime);
          if (!startTime) return;
          startMin = validateTime(startTime, true);
          if (startMin !== null) break;
        }
        while (true) {
          endTime = prompt(`Enter End Time:`);
          if (!endTime) return;
          endMin = validateTime(endTime, false);
          if (endMin !== null) {
            if (endMin <= startMin) alert("End time must be after start time.");
            else break;
          }
        }

        newEvent = {
          id: `evt_${Math.random().toString(36).slice(2, 9)}`,
          type: eventType,
          event: eventName,
          division: divName,
          startTime: startTime,
          endTime: endTime,
          reservedFields: reservedFields
        };
      }

      // Standard single-event fallback
      if (!newEvent) {
        if (/league/i.test(eventName) && eventType === 'slot') {
            eventType = 'league';
        }

        let startTime, endTime, startMin, endMin;

        if (tileData.type === 'activity') eventName = 'General Activity Slot';
        else if (tileData.type === 'sports') eventName = 'Sports Slot';
        else if (tileData.type === 'special') eventName = 'Special Activity';

        while (true) {
          startTime = prompt(`Add "${eventName}" for ${divName}?\nEnter Start Time:`, defaultStartTime);
          if (!startTime) return;
          startMin = validateTime(startTime, true);
          if (startMin !== null) break;
        }
        while (true) {
          endTime = prompt(`Enter End Time:`);
          if (!endTime) return;
          endMin = validateTime(endTime, false);
          if (endMin !== null) {
            if (endMin <= startMin) alert("End time must be after start time.");
            else break;
          }
        }

        newEvent = {
          id: `evt_${Math.random().toString(36).slice(2, 9)}`,
          type: eventType,
          event: eventName,
          division: divName,
          startTime: startTime,
          endTime: endTime
        };
      }

      if (newEvent) {
        dailyOverrideSkeleton.push(newEvent);
        bumpOverlappingTiles(newEvent, divName);
        saveDailySkeleton();
        renderGrid(gridContainer);
      }
    };
  });
}

function addRemoveListeners(gridContainer) {
  gridContainer.querySelectorAll('.grid-event').forEach(tile => {
    tile.ondblclick = (e) => {
      e.stopPropagation();
      const eventId = tile.dataset.eventId;
      if (!eventId) return;
      const event = dailyOverrideSkeleton.find(ev => ev.id === eventId);
      if (confirm(`Remove "${event?.event || 'this event'}"?`)) {
        dailyOverrideSkeleton = dailyOverrideSkeleton.filter(ev => ev.id !== eventId);
        saveDailySkeleton();
        renderGrid(gridContainer);
      }
    };
  });
}

// =================================================================
// SKELETON LOAD/SAVE
// =================================================================

function loadDailySkeleton() {
  const dailyData = window.loadCurrentDailyData?.() || {};
  if (dailyData.manualSkeleton && dailyData.manualSkeleton.length > 0) {
    dailyOverrideSkeleton = JSON.parse(JSON.stringify(dailyData.manualSkeleton));
    return;
  }

  const assignments = masterSettings.app1.skeletonAssignments || {};
  const skeletons   = masterSettings.app1.savedSkeletons || {};
  const dateStr = window.currentScheduleDate || "";
  const [year, month, day] = dateStr.split('-').map(Number);
  let dayOfWeek = 0;
  if (year && month && day) dayOfWeek = new Date(year, month - 1, day).getDay();
  const dayNames = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const todayName = dayNames[dayOfWeek];

  let templateName = assignments[todayName];
  if (!templateName || !skeletons[templateName]) templateName = assignments["Default"];
  const skeletonToLoad = skeletons[templateName];
  dailyOverrideSkeleton = skeletonToLoad ? JSON.parse(JSON.stringify(skeletonToLoad)) : [];
}

function saveDailySkeleton() {
  window.saveCurrentDailyData?.("manualSkeleton", dailyOverrideSkeleton);
}

function minutesToTime(min) {
  const hh = Math.floor(min / 60);
  const mm = min % 60;
  const h = hh % 12 === 0 ? 12 : hh % 12;
  const m = String(mm).padStart(2, '0');
  const ampm = hh < 12 ? 'am' : 'pm';
  return `${h}:${m}${ampm}`;
}

function parseTimeToMinutes(str) {
  if (!str || typeof str !== "string") return null;
  let s = str.trim().toLowerCase();
  let mer = null;
  if (s.endsWith("am") || s.endsWith("pm")) {
    mer = s.endsWith("am") ? "am" : "pm";
    s = s.replace(/am|pm/g, "").trim();
  }
  const m = s.match(/^(\d{1,2})\s*:\s*(\d{2})$/);
  if (!m) return null;
  let hh = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (Number.isNaN(hh) || Number.isNaN(mm) || mm < 0 || mm > 59) return null;
  if (mer) {
    if (hh === 12) hh = mer === "am" ? 0 : 12;
    else if (mer === "pm") hh += 12;
  } else {
    if (hh >= 12 || hh <= 7) {
      console.warn(`[TIME PARSE] "${str}" has no AM/PM - assuming PM`);
      if (hh !== 12) hh += 12;
    }
  }
  return hh * 60 + mm;
}

// =================================================================
// SMART TILE PRE-PROCESSOR (DISABLED)
// =================================================================

function applySmartTileOverridesForToday() {
  console.log("Smart Tile pre-processor DISABLED. Using Core Scheduler for capacity-aware Smart Tiles.");
  return;
}

// =================================================================
// RUN OPTIMIZER
// =================================================================

function runOptimizer() {
  if (!window.runSkeletonOptimizer) {
    alert("Error: 'runSkeletonOptimizer' function not found. Is scheduler_logic_core.js loaded?");
    return;
  }
  if (dailyOverrideSkeleton.length === 0) {
    alert("Skeleton is empty. Please add blocks before running the optimizer.");
    return;
  }

  // Check for conflicts
  if (window.SkeletonSandbox) {
    const conflicts = window.SkeletonSandbox.detectConflicts(dailyOverrideSkeleton);
    const critical = conflicts.filter(c => c.type === 'critical');
    if (critical.length > 0) {
      const msg = critical.slice(0, 3).map(c => `• ${c.resource}: ${c.event1.division} ↔ ${c.event2.division}`).join('\n');
      if (!confirm(`⚠️ ${critical.length} critical conflict(s) detected!\n\n${msg}\n\nRun optimizer anyway?`)) {
        return;
      }
    }
  }

  saveDailySkeleton();

  try {
    applySmartTileOverridesForToday();
  } catch (e) {
    console.error("Error while applying Smart Tile overrides:", e);
  }

  const success = window.runSkeletonOptimizer(dailyOverrideSkeleton, currentOverrides);
  if (success) {
    alert("Schedule Generated Successfully!");
    window.showTab?.('schedule');
  } else {
    alert("Error during schedule generation. Check console.");
  }
}

// =================================================================
// MAIN INIT
// =================================================================

function init() {
  container = document.getElementById("daily-adjustments-content");
  if (!container) {
    console.error("Daily Adjustments: container not found");
    return;
  }
  console.log("Daily Adjustments: Initializing for", window.currentScheduleDate);

  masterSettings.global = window.loadGlobalSettings?.() || {};
  masterSettings.app1 = masterSettings.global.app1 || {};
  masterSettings.leaguesByName = masterSettings.global.leaguesByName || {};
  masterSettings.specialtyLeagues = masterSettings.global.specialtyLeagues || {};

  smartTileHistory = loadSmartTileHistory();

  const dailyData = window.loadCurrentDailyData?.() || {};
  const dailyOverrides = dailyData.overrides || {};

  currentOverrides.dailyFieldAvailability = dailyData.dailyFieldAvailability || {};
  currentOverrides.leagues = dailyOverrides.leagues || [];
  currentOverrides.disabledSpecialtyLeagues = dailyData.disabledSpecialtyLeagues || [];
  currentOverrides.dailyDisabledSportsByField = dailyData.dailyDisabledSportsByField || {};
  currentOverrides.disabledFields = dailyOverrides.disabledFields || [];
  currentOverrides.disabledSpecials = dailyOverrides.disabledSpecials || [];
  currentOverrides.bunkActivityOverrides = dailyData.bunkActivityOverrides || [];

  container.innerHTML = `
    <div style="padding:12px 18px;background:#fff;border:1px solid #e5e7eb;border-radius:10px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
      <div>
        <h2 style="margin:0 0 4px 0;font-size:1.3em;color:#1f2937;">Daily Adjustments for ${window.currentScheduleDate}</h2>
        <p style="margin:0;font-size:0.9em;color:#6b7280;">Drag tiles to reposition • Double-click to remove • Overlapping tiles bump down</p>
      </div>
      <button id="run-optimizer-btn"
              style="background:#10b981;color:white;padding:12px 24px;font-size:1.1em;border:none;border-radius:8px;cursor:pointer;font-weight:600;transition:all 0.15s;box-shadow:0 2px 8px rgba(16,185,129,0.3);">
        ▶ Run Optimizer
      </button>
    </div>

    <div class="da-tabs-nav league-nav">
      <button class="tab-button active" data-tab="skeleton">Skeleton</button>
      <button class="tab-button" data-tab="trips">Trips</button>
      <button class="tab-button" data-tab="bunk-specific">Bunk Specific</button>
      <button class="tab-button" data-tab="resources">Resource Availability</button>
    </div>

    <div id="da-pane-skeleton" class="da-tab-pane league-content-pane active">
      <div class="override-section" id="daily-skeleton-editor-section">
        <div id="override-scheduler-content"></div>
      </div>
    </div>

    <div id="da-pane-trips" class="da-tab-pane league-content-pane">
      <div class="override-section" id="daily-trips-section">
        <h3 style="margin-top:0;">Add Trip</h3>
        <div id="trips-form-container"></div>
      </div>
    </div>

    <div id="da-pane-bunk-specific" class="da-tab-pane league-content-pane">
      <div class="override-section" id="daily-bunk-overrides-section">
        <h3 style="margin-top:0;">Bunk-Specific Pinned Activities</h3>
        <p style="font-size:0.9em;color:#6b7280;margin-bottom:16px;">Assign a specific activity to one or more bunks at a specific time.</p>
        <div id="bunk-overrides-container"></div>
      </div>
    </div>

    <div id="da-pane-resources" class="da-tab-pane league-content-pane">
      <div class="override-section" id="other-overrides-section">
        <h3 style="margin-top:0;">Daily Resource Availability</h3>
        <p style="font-size:0.9em;color:#6b7280;margin-bottom:16px;">Disable fields, leagues, or activities for this day only.</p>
        <div id="resource-overrides-container"></div>
      </div>
    </div>

    <style>
      .grid-disabled {
        position:absolute;
        width:100%;
        background-color:rgba(128,128,128,0.15);
        background-image:linear-gradient(-45deg,rgba(0,0,0,0.05) 25%,transparent 25%,transparent 50%,rgba(0,0,0,0.05) 50%,rgba(0,0,0,0.05) 75%,transparent 75%,transparent);
        background-size:20px 20px;
        z-index:1;
        pointer-events:none;
      }
      .grid-event {
        z-index:2;
        position:relative;
      }
      .grid-event:hover {
        transform:scale(1.02);
        box-shadow:0 4px 12px rgba(0,0,0,0.15);
        z-index:10 !important;
      }
      .grid-event.dragging {
        opacity:0.4;
        cursor:grabbing;
      }
      .grid-cell.drag-over {
        background:rgba(37,99,235,0.08) !important;
      }
      @keyframes pulse {
        0%, 100% { box-shadow: 0 0 0 0 rgba(239,68,68,0.4); }
        50% { box-shadow: 0 0 0 8px rgba(239,68,68,0); }
      }
      @keyframes pulseWarn {
        0%, 100% { box-shadow: 0 0 0 0 rgba(245,158,11,0.4); }
        50% { box-shadow: 0 0 0 8px rgba(245,158,11,0); }
      }
      .conflict-critical {
        animation: pulse 1.5s infinite;
        border: 3px solid #ef4444 !important;
        background: linear-gradient(135deg, #fef2f2, #fecaca) !important;
      }
      .conflict-warning {
        animation: pulseWarn 2s infinite;
        border: 3px solid #f59e0b !important;
        background: linear-gradient(135deg, #fffbeb, #fde68a) !important;
      }
      .master-list .list-item {
        padding:10px 12px;
        border:1px solid #e5e7eb;
        border-radius:8px;
        margin-bottom:6px;
        cursor:pointer;
        background:#fff;
        font-size:.95em;
        display:flex;
        justify-content:space-between;
        align-items:center;
        transition:all 0.15s;
      }
      .master-list .list-item:hover { background:#f9fafb; }
      .master-list .list-item.selected {
        background:#eff6ff;
        border-color:#3b82f6;
      }
      .master-list .list-item-name { font-weight:600; flex-grow:1; }
      #run-optimizer-btn:hover {
        background:#059669;
        transform:translateY(-1px);
        box-shadow:0 4px 12px rgba(16,185,129,0.4);
      }
    </style>
  `;

  document.getElementById("run-optimizer-btn").onclick = runOptimizer;

  container.querySelectorAll('.da-tabs-nav .tab-button').forEach(btn => {
    btn.onclick = () => {
      activeSubTab = btn.dataset.tab;
      container.querySelectorAll('.da-tabs-nav .tab-button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      container.querySelectorAll('.da-tab-pane').forEach(p => p.classList.remove('active'));
      container.querySelector(`#da-pane-${activeSubTab}`).classList.add('active');
    };
  });

  skeletonContainer = document.getElementById("override-scheduler-content");
  tripsFormContainer = document.getElementById("trips-form-container");
  bunkOverridesContainer = document.getElementById("bunk-overrides-container");
  resourceOverridesContainer = document.getElementById("resource-overrides-container");

  initDailySkeletonUI();
  renderTripsForm();
  renderBunkOverridesUI();
  renderResourceOverridesUI();
}

// =================================================================
// SKELETON UI
// =================================================================

function initDailySkeletonUI() {
  if (!skeletonContainer) return;
  loadDailySkeleton();

  const savedSkeletons = masterSettings.app1.savedSkeletons || {};
  let optionsHtml = `<option value="">-- Select Saved Skeleton --</option>`;
  Object.keys(savedSkeletons).sort().forEach(name => {
    optionsHtml += `<option value="${name}">${name}</option>`;
  });

  skeletonContainer.innerHTML = `
    <div id="displaced-tiles-panel" style="display:none;"></div>
    
    <div style="margin-bottom:14px;padding:12px;background:#f8f9fa;border:1px solid #e5e7eb;border-radius:8px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
      <select id="daily-skeleton-select" style="padding:8px 12px;border-radius:6px;border:1px solid #d1d5db;background:#fff;">
        ${optionsHtml}
      </select>
      <button id="daily-skeleton-load-btn" style="padding:8px 16px;background:#2563eb;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:500;">
        Load
      </button>
      <div style="flex:1;"></div>
      ${window.SkeletonSandbox ? `<button id="conflict-rules-btn" style="padding:8px 16px;background:#f3f4f6;border:1px solid #d1d5db;border-radius:6px;cursor:pointer;">⚙️ Conflict Rules</button>` : ''}
    </div>

    <div id="daily-skeleton-palette"
         style="padding:12px;background:#f8f9fa;border-radius:8px;margin-bottom:14px;display:flex;flex-wrap:wrap;gap:10px;"></div>
    <div id="daily-skeleton-grid"
         style="overflow-x:auto;border:1px solid #d1d5db;border-radius:8px;max-height:550px;overflow-y:auto;"></div>
  `;

  document.getElementById("daily-skeleton-load-btn").onclick = () => {
    const select = document.getElementById("daily-skeleton-select");
    const name = select.value;
    if (!name) return;

    if (confirm(`Load skeleton "${name}"? This will overwrite your current daily skeleton edits.`)) {
      const skeletonData = savedSkeletons[name];
      if (skeletonData) {
        dailyOverrideSkeleton = JSON.parse(JSON.stringify(skeletonData));
        clearDisplacedTiles();
        saveDailySkeleton();
        renderGrid(document.getElementById("daily-skeleton-grid"));
      }
    }
  };

  if (window.SkeletonSandbox) {
    const rulesBtn = document.getElementById("conflict-rules-btn");
    if (rulesBtn) {
      rulesBtn.onclick = () => window.SkeletonSandbox.showRulesModal(() => {
        renderGrid(document.getElementById("daily-skeleton-grid"));
      });
    }
  }

  const palette = document.getElementById("daily-skeleton-palette");
  const grid = document.getElementById("daily-skeleton-grid");
  renderPalette(palette);
  renderGrid(grid);
  renderDisplacedTilesPanel();
}

// =================================================================
// TRIPS FORM
// =================================================================

function renderTripsForm() {
  if (!tripsFormContainer) return;

  const divisions = window.availableDivisions || [];

  tripsFormContainer.innerHTML = `
    <div style="max-width:480px;">
      <p style="color:#6b7280;font-size:0.9em;margin-bottom:16px;">
        Add an off-campus trip directly to the daily skeleton. Overlapping events will be bumped down.
      </p>

      <div style="margin-bottom:14px;">
        <label style="display:block;font-weight:500;margin-bottom:6px;">Division</label>
        <select id="trip-division-select" style="width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:6px;">
          <option value="">-- Select Division --</option>
          ${divisions.map(d => `<option value="${d}">${d}</option>`).join("")}
        </select>
      </div>

      <div style="margin-bottom:14px;">
        <label style="display:block;font-weight:500;margin-bottom:6px;">Trip Name</label>
        <input id="trip-name-input" type="text" placeholder="e.g. Six Flags, Museum Trip" style="width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:6px;box-sizing:border-box;" />
      </div>

      <div style="display:flex;gap:12px;margin-bottom:16px;">
        <div style="flex:1;">
          <label style="display:block;font-weight:500;margin-bottom:6px;">Start Time</label>
          <input id="trip-start-input" type="text" placeholder="e.g. 10:00am" style="width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:6px;box-sizing:border-box;" />
        </div>
        <div style="flex:1;">
          <label style="display:block;font-weight:500;margin-bottom:6px;">End Time</label>
          <input id="trip-end-input" type="text" placeholder="e.g. 3:30pm" style="width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:6px;box-sizing:border-box;" />
        </div>
      </div>

      <button id="apply-trip-btn" style="width:100%;background:#2563eb;color:white;padding:12px;font-size:1em;font-weight:600;border:none;border-radius:8px;cursor:pointer;transition:all 0.15s;">
        Add Trip to Skeleton
      </button>
    </div>
  `;

  document.getElementById("apply-trip-btn").onclick = () => {
    const division = document.getElementById("trip-division-select").value;
    const tripName = document.getElementById("trip-name-input").value.trim();
    const startTime = document.getElementById("trip-start-input").value.trim();
    const endTime = document.getElementById("trip-end-input").value.trim();

    if (!division || !tripName || !startTime || !endTime) {
      alert("Please complete all fields.");
      return;
    }

    const startMin = parseTimeToMinutes(startTime);
    const endMin = parseTimeToMinutes(endTime);

    if (startMin == null || endMin == null) {
      alert("Invalid time format. Use e.g. 9:00am or 2:30pm.");
      return;
    }
    if (endMin <= startMin) {
      alert("End time must be after start time.");
      return;
    }

    loadDailySkeleton();

    const newEvent = {
      id: `trip_${Math.random().toString(36).slice(2, 9)}`,
      type: "pinned",
      event: tripName,
      division,
      startTime,
      endTime,
      reservedFields: []
    };

    dailyOverrideSkeleton.push(newEvent);
    bumpOverlappingTiles(newEvent, division);
    saveDailySkeleton();

    if (skeletonContainer) {
      const grid = skeletonContainer.querySelector("#daily-skeleton-grid");
      if (grid) renderGrid(grid);
    }

    // Switch to skeleton tab
    container.querySelector('.tab-button[data-tab="skeleton"]').click();

    const conflicts = window.SkeletonSandbox?.detectConflicts(dailyOverrideSkeleton) || [];
    if (conflicts.length > 0) {
      alert(`Trip added! ${conflicts.length} conflict(s) detected - check the skeleton.`);
    } else {
      alert("Trip added to daily skeleton.");
    }

    document.getElementById("trip-name-input").value = "";
    document.getElementById("trip-start-input").value = "";
    document.getElementById("trip-end-input").value = "";
  };
}

// =================================================================
// BUNK OVERRIDES UI
// =================================================================

function renderBunkOverridesUI() {
  if (!bunkOverridesContainer) return;

  const divisions = window.divisions || {};
  const availableDivisions = window.availableDivisions || [];
  const bunks = [];

  availableDivisions.forEach(divName => {
    const div = divisions[divName];
    if (div?.bunks) {
      div.bunks.forEach(bunk => bunks.push({ name: bunk, division: divName, color: div.color }));
    }
  });

  const sports = [];
  (masterSettings.app1.fields || []).forEach(f => {
    (f.activities || []).forEach(s => { if (!sports.includes(s)) sports.push(s); });
  });
  sports.sort();

  const specials = (masterSettings.app1.specialActivities || []).map(s => s.name).sort();

  bunkOverridesContainer.innerHTML = `
    <div style="max-width:520px;">
      <div style="margin-bottom:14px;">
        <label style="display:block;font-weight:500;margin-bottom:6px;">Type</label>
        <select id="bo-type" style="width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:6px;">
          <option value="">-- Select Type --</option>
          <option value="sport">Sport</option>
          <option value="special">Special Activity</option>
          <option value="trip">Personal Trip</option>
        </select>
      </div>

      <div id="bo-activity-wrap" style="margin-bottom:14px;display:none;">
        <label style="display:block;font-weight:500;margin-bottom:6px;">Activity</label>
        <select id="bo-activity" style="width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:6px;"></select>
      </div>

      <div id="bo-trip-wrap" style="margin-bottom:14px;display:none;">
        <label style="display:block;font-weight:500;margin-bottom:6px;">Trip Name</label>
        <input id="bo-trip-name" type="text" placeholder="e.g. Doctor Appointment" style="width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:6px;box-sizing:border-box;">
      </div>

      <div style="display:flex;gap:12px;margin-bottom:14px;">
        <div style="flex:1;">
          <label style="display:block;font-weight:500;margin-bottom:6px;">Start Time</label>
          <input id="bo-start" type="text" placeholder="10:00am" style="width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:6px;box-sizing:border-box;">
        </div>
        <div style="flex:1;">
          <label style="display:block;font-weight:500;margin-bottom:6px;">End Time</label>
          <input id="bo-end" type="text" placeholder="11:00am" style="width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:6px;box-sizing:border-box;">
        </div>
      </div>

      <div style="margin-bottom:16px;">
        <label style="display:block;font-weight:500;margin-bottom:8px;">Select Bunks</label>
        <div id="bo-bunks" style="display:flex;flex-wrap:wrap;gap:8px;max-height:160px;overflow-y:auto;padding:8px;border:1px solid #e5e7eb;border-radius:6px;background:#f9fafb;">
          ${bunks.map(b => `<button type="button" class="bunk-chip" data-bunk="${b.name}" data-color="${b.color}" style="padding:6px 14px;border:2px solid ${b.color};background:white;border-radius:20px;cursor:pointer;font-size:0.9em;transition:all 0.15s;">${b.name}</button>`).join('')}
        </div>
      </div>

      <button id="bo-apply" style="width:100%;background:#2563eb;color:white;padding:12px;font-size:1em;font-weight:600;border:none;border-radius:8px;cursor:pointer;">Apply Override</button>

      <div id="bo-existing" style="margin-top:20px;"></div>
    </div>
  `;

  const typeSelect = document.getElementById("bo-type");
  const activityWrap = document.getElementById("bo-activity-wrap");
  const activitySelect = document.getElementById("bo-activity");
  const tripWrap = document.getElementById("bo-trip-wrap");

  typeSelect.onchange = () => {
    activityWrap.style.display = 'none';
    tripWrap.style.display = 'none';
    if (typeSelect.value === 'sport') {
      activitySelect.innerHTML = `<option value="">-- Select Sport --</option>` + sports.map(s => `<option value="${s}">${s}</option>`).join('');
      activityWrap.style.display = 'block';
    } else if (typeSelect.value === 'special') {
      activitySelect.innerHTML = `<option value="">-- Select Special --</option>` + specials.map(s => `<option value="${s}">${s}</option>`).join('');
      activityWrap.style.display = 'block';
    } else if (typeSelect.value === 'trip') {
      tripWrap.style.display = 'block';
    }
  };

  bunkOverridesContainer.querySelectorAll('.bunk-chip').forEach(chip => {
    chip.onclick = () => {
      const selected = chip.classList.toggle('selected');
      chip.style.background = selected ? chip.dataset.color : 'white';
      chip.style.color = selected ? 'white' : 'black';
    };
  });

  document.getElementById("bo-apply").onclick = () => {
    const type = typeSelect.value;
    const startTime = document.getElementById("bo-start").value.trim();
    const endTime = document.getElementById("bo-end").value.trim();

    if (!type || !startTime || !endTime) { alert("Select type and enter times."); return; }

    let activityName = '';
    if (type === 'sport' || type === 'special') {
      activityName = activitySelect.value;
      if (!activityName) { alert("Select an activity."); return; }
    } else if (type === 'trip') {
      activityName = document.getElementById("bo-trip-name").value.trim();
      if (!activityName) { alert("Enter trip name."); return; }
    }

    const selectedBunks = [...bunkOverridesContainer.querySelectorAll('.bunk-chip.selected')].map(c => c.dataset.bunk);
    if (selectedBunks.length === 0) { alert("Select at least one bunk."); return; }

    const startMin = parseTimeToMinutes(startTime);
    const endMin = parseTimeToMinutes(endTime);
    if (startMin == null || endMin == null || endMin <= startMin) { alert("Invalid times."); return; }

    currentOverrides.bunkActivityOverrides.push({
      id: `bunk_${Math.random().toString(36).slice(2, 9)}`,
      type, activity: activityName, bunks: selectedBunks, startTime, endTime
    });

    window.saveCurrentDailyData("bunkActivityOverrides", currentOverrides.bunkActivityOverrides);
    alert(`Override applied to ${selectedBunks.length} bunk(s)!`);

    bunkOverridesContainer.querySelectorAll('.bunk-chip.selected').forEach(c => {
      c.classList.remove('selected');
      c.style.background = 'white';
      c.style.color = 'black';
    });

    renderExistingBunkOverrides();
  };

  renderExistingBunkOverrides();
}

function renderExistingBunkOverrides() {
  const container = document.getElementById("bo-existing");
  if (!container) return;

  if (currentOverrides.bunkActivityOverrides.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = `
    <h4 style="margin:0 0 12px 0;">Existing Overrides</h4>
    ${currentOverrides.bunkActivityOverrides.map((o, i) => `
      <div style="background:#f9fafb;padding:12px;border-radius:8px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;">
        <div>
          <strong>${o.activity}</strong> (${o.type})<br>
          <span style="font-size:0.85em;color:#6b7280;">${o.bunks.join(', ')} • ${o.startTime} - ${o.endTime}</span>
        </div>
        <button class="remove-bo-btn" data-index="${i}" style="background:#fee2e2;color:#dc2626;border:none;width:32px;height:32px;border-radius:6px;cursor:pointer;font-weight:bold;">✕</button>
      </div>
    `).join('')}
  `;

  container.querySelectorAll('.remove-bo-btn').forEach(btn => {
    btn.onclick = () => {
      currentOverrides.bunkActivityOverrides.splice(parseInt(btn.dataset.index), 1);
      window.saveCurrentDailyData("bunkActivityOverrides", currentOverrides.bunkActivityOverrides);
      renderExistingBunkOverrides();
    };
  });
}

// =================================================================
// RESOURCE OVERRIDES UI
// =================================================================

function renderResourceOverridesUI() {
  if (!resourceOverridesContainer) return;

  resourceOverridesContainer.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(240px, 1fr));gap:24px;">
      <div>
        <h4 style="margin:0 0 12px 0;color:#374151;">Fields</h4>
        <div id="override-fields-list" class="master-list"></div>
      </div>
      <div>
        <h4 style="margin:0 0 12px 0;color:#374151;">Special Activities</h4>
        <div id="override-specials-list" class="master-list"></div>
      </div>
      <div>
        <h4 style="margin:0 0 12px 0;color:#374151;">Leagues</h4>
        <div id="override-leagues-list" class="master-list"></div>
      </div>
      <div>
        <h4 style="margin:0 0 12px 0;color:#374151;">Specialty Leagues</h4>
        <div id="override-specialty-leagues-list" class="master-list"></div>
      </div>
    </div>
  `;

  const saveOverrides = () => {
    const dailyData = window.loadCurrentDailyData?.() || {};
    const fullOverrides = dailyData.overrides || {};
    fullOverrides.leagues = currentOverrides.leagues;
    fullOverrides.disabledFields = currentOverrides.disabledFields;
    fullOverrides.disabledSpecials = currentOverrides.disabledSpecials;
    window.saveCurrentDailyData("overrides", fullOverrides);
  };

  const createToggle = (name, isEnabled, onToggle) => {
    const el = document.createElement('div');
    el.className = 'list-item';
    el.innerHTML = `
      <span class="list-item-name">${name}</span>
      <label class="switch" style="position:relative;width:44px;height:24px;flex-shrink:0;">
        <input type="checkbox" ${isEnabled ? 'checked' : ''} style="opacity:0;width:0;height:0;">
        <span class="slider" style="position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background:${isEnabled ? '#10b981' : '#e5e7eb'};transition:.2s;border-radius:24px;"></span>
      </label>
    `;
    
    const checkbox = el.querySelector('input');
    const slider = el.querySelector('.slider');
    
    checkbox.onchange = () => {
      onToggle(checkbox.checked);
      slider.style.background = checkbox.checked ? '#10b981' : '#e5e7eb';
    };
    
    return el;
  };

  const fields = masterSettings.app1.fields || [];
  const overrideFieldsListEl = document.getElementById("override-fields-list");
  fields.forEach(item => {
    const isDisabled = currentOverrides.disabledFields.includes(item.name);
    overrideFieldsListEl.appendChild(createToggle(item.name, !isDisabled, (isEnabled) => {
      if (isEnabled) currentOverrides.disabledFields = currentOverrides.disabledFields.filter(n => n !== item.name);
      else if (!currentOverrides.disabledFields.includes(item.name)) currentOverrides.disabledFields.push(item.name);
      saveOverrides();
    }));
  });

  const specials = masterSettings.app1.specialActivities || [];
  const overrideSpecialsListEl = document.getElementById("override-specials-list");
  specials.forEach(item => {
    const isDisabled = currentOverrides.disabledSpecials.includes(item.name);
    overrideSpecialsListEl.appendChild(createToggle(item.name, !isDisabled, (isEnabled) => {
      if (isEnabled) currentOverrides.disabledSpecials = currentOverrides.disabledSpecials.filter(n => n !== item.name);
      else if (!currentOverrides.disabledSpecials.includes(item.name)) currentOverrides.disabledSpecials.push(item.name);
      saveOverrides();
    }));
  });

  const leagues = Object.keys(masterSettings.leaguesByName || {});
  const overrideLeaguesListEl = document.getElementById("override-leagues-list");
  leagues.forEach(name => {
    const isDisabled = currentOverrides.leagues.includes(name);
    overrideLeaguesListEl.appendChild(createToggle(name, !isDisabled, (isEnabled) => {
      if (isEnabled) currentOverrides.leagues = currentOverrides.leagues.filter(l => l !== name);
      else if (!currentOverrides.leagues.includes(name)) currentOverrides.leagues.push(name);
      saveOverrides();
    }));
  });

  const specialtyLeagues = Object.values(masterSettings.specialtyLeagues || {}).map(l => l.name).sort();
  const overrideSpecialtyLeaguesListEl = document.getElementById("override-specialty-leagues-list");
  specialtyLeagues.forEach(name => {
    const isDisabled = currentOverrides.disabledSpecialtyLeagues.includes(name);
    overrideSpecialtyLeaguesListEl.appendChild(createToggle(name, !isDisabled, (isEnabled) => {
      if (isEnabled) currentOverrides.disabledSpecialtyLeagues = currentOverrides.disabledSpecialtyLeagues.filter(l => l !== name);
      else if (!currentOverrides.disabledSpecialtyLeagues.includes(name)) currentOverrides.disabledSpecialtyLeagues.push(name);
      window.saveCurrentDailyData("disabledSpecialtyLeagues", currentOverrides.disabledSpecialtyLeagues);
    }));
  });
}

// Expose init
window.initDailyAdjustments = init;

})();
