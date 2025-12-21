// =================================================================
// daily_adjustments.js  (UPDATED - v2.2)
// - Matches master_schedule_builder.js styling
// - Fixed conflict detection (only applies configured rules)
// - Better drag preview visibility
// - Top & bottom resize handles with real-time preview
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

let displacedTiles = [];
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

let skeletonContainer = null;
let tripsFormContainer = null;
let bunkOverridesContainer = null;
let resourceOverridesContainer = null;
let activeSubTab = 'skeleton';

// =================================================================
// SKELETON EDITOR
// =================================================================

let dailyOverrideSkeleton = [];
const PIXELS_PER_MINUTE = 2;
const INCREMENT_MINS = 30;
const SNAP_MINS = 5;

const TILES = [
  { type: 'activity', name: 'Activity', style: 'background:#e0f7fa;border:1px solid #007bff;', description: 'Flexible slot (Sport or Special).' },
  { type: 'sports', name: 'Sports', style: 'background:#dcedc8;border:1px solid #689f38;', description: 'Sports slot only.' },
  { type: 'special', name: 'Special Activity', style: 'background:#e8f5e9;border:1px solid #43a047;', description: 'Special Activity slot only.' },
  { type: 'smart', name: 'Smart Tile', style: 'background:#e3f2fd;border:2px dashed #0288d1;color:#01579b;', description: 'Balances 2 activities with a fallback.' },
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
  if (lower === 'activity') return { type: 'slot', event: 'General Activity Slot' };
  if (lower === 'sports') return { type: 'slot', event: 'Sports Slot' };
  if (lower === 'special activity' || lower === 'special') return { type: 'slot', event: 'Special Activity' };
  if (lower.includes('specialty league')) return { type: 'specialty_league', event: 'Specialty League' };
  if (lower.includes('league')) return { type: 'league', event: 'League Game' };
  if (['swim', 'lunch', 'snacks', 'dismissal'].includes(lower)) return { type: 'pinned', event: name };
  return { type: 'pinned', event: name };
}

function promptForReservedFields(eventName) {
  const allFields = (masterSettings.app1.fields || []).map(f => f.name);
  const specialActivities = (masterSettings.app1.specialActivities || []).map(s => s.name);
  const allLocations = [...new Set([...allFields, ...specialActivities])].sort();
  if (allLocations.length === 0) return [];
  
  const fieldInput = prompt(
    `Which field(s) will "${eventName}" use?\n\n` +
    `Available: ${allLocations.join(', ')}\n\n` +
    `Enter field names separated by commas (or leave blank):`,
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
    alert(`Warning: These fields were not found:\n${invalid.join(', ')}`);
  }
  return validated;
}

// =================================================================
// DISPLACED TILES
// =================================================================

function addDisplacedTile(event, reason) {
  displacedTiles.push({
    event: event.event,
    type: event.type,
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
    <div style="background:#fff8e1;border:1px solid #ffb300;border-radius:5px;padding:10px;margin-bottom:10px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <strong style="color:#e65100;">📋 Displaced Tiles (${displacedTiles.length})</strong>
        <button id="clear-displaced-btn" style="background:#fff;border:1px solid #ffb300;color:#e65100;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:0.8em;">Clear</button>
      </div>
      <div style="max-height:120px;overflow-y:auto;">
        ${displacedTiles.map(d => `
          <div style="background:#fff;padding:6px 10px;margin-bottom:4px;border-radius:4px;font-size:0.85em;border-left:3px solid ${d.type === 'pinned' ? '#ff5722' : '#ffb300'};">
            <strong>${d.event}</strong> (${d.division}) - ${d.originalStart} - ${d.originalEnd}
          </div>
        `).join('')}
      </div>
    </div>
  `;
  document.getElementById('clear-displaced-btn').onclick = clearDisplacedTiles;
}

// =================================================================
// BUMP LOGIC
// =================================================================

function bumpOverlappingTiles(newEvent, divName) {
  const newStartMin = parseTimeToMinutes(newEvent.startTime);
  const newEndMin = parseTimeToMinutes(newEvent.endTime);
  const div = window.divisions?.[divName] || {};
  const divEndMin = parseTimeToMinutes(div.endTime) || 960;
  
  const overlapping = dailyOverrideSkeleton.filter(ev => {
    if (ev.id === newEvent.id) return false;
    if (ev.division !== divName) return false;
    const evStart = parseTimeToMinutes(ev.startTime);
    const evEnd = parseTimeToMinutes(ev.endTime);
    if (evStart == null || evEnd == null) return false;
    return (evStart < newEndMin && evEnd > newStartMin);
  });
  
  if (overlapping.length === 0) return;
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

function getDurationText(startTime, endTime) {
  const startMin = parseTimeToMinutes(startTime);
  const endMin = parseTimeToMinutes(endTime);
  if (startMin == null || endMin == null) return '';
  const duration = endMin - startMin;
  if (duration < 60) return `${duration}m`;
  const hours = Math.floor(duration / 60);
  const mins = duration % 60;
  return mins > 0 ? `${hours}h${mins}m` : `${hours}h`;
}

// =================================================================
// RENDER FUNCTIONS
// =================================================================

function renderPalette(paletteContainer) {
  paletteContainer.innerHTML = '';
  TILES.forEach(tile => {
    const el = document.createElement('div');
    el.className = 'grid-tile-draggable';
    el.textContent = tile.name;
    el.style.cssText = tile.style;
    el.style.padding = '8px 12px';
    el.style.borderRadius = '5px';
    el.style.cursor = 'grab';
    el.style.fontSize = '0.85em';
    el.title = tile.description;
    el.draggable = true;
    el.ondragstart = (e) => {
      e.dataTransfer.setData('application/json', JSON.stringify(tile));
      e.dataTransfer.effectAllowed = 'copy';
    };
    paletteContainer.appendChild(el);
  });
}

function renderGrid(gridContainer) {
  const divisions = window.divisions || {};
  const availableDivisions = window.availableDivisions || [];

  if (availableDivisions.length === 0) {
    gridContainer.innerHTML = `<div style="padding:20px;text-align:center;color:#666;">No divisions found. Please go to Setup.</div>`;
    return;
  }

  let earliestMin = null, latestMin = null;
  Object.values(divisions).forEach(div => {
    const s = parseTimeToMinutes(div.startTime);
    const e = parseTimeToMinutes(div.endTime);
    if (s !== null && (earliestMin === null || s < earliestMin)) earliestMin = s;
    if (e !== null && (latestMin === null || e > latestMin)) latestMin = e;
  });
  if (earliestMin === null) earliestMin = 540;
  if (latestMin === null) latestMin = 960;

  const latestPinnedEnd = Math.max(-Infinity, ...dailyOverrideSkeleton.filter(ev => ev).map(ev => parseTimeToMinutes(ev.endTime) ?? -Infinity));
  if (Number.isFinite(latestPinnedEnd)) latestMin = Math.max(latestMin, latestPinnedEnd);
  if (latestMin <= earliestMin) latestMin = earliestMin + 60;

  const totalMinutes = latestMin - earliestMin;
  const totalHeight = totalMinutes * PIXELS_PER_MINUTE;
  gridContainer.dataset.earliestMin = earliestMin;

  let gridHtml = `<div style="display:grid;grid-template-columns:60px repeat(${availableDivisions.length},1fr);position:relative;min-width:800px;">`;
  
  // Header
  gridHtml += `<div style="grid-row:1;position:sticky;top:0;background:#fff;z-index:10;border-bottom:1px solid #999;padding:8px;font-weight:bold;">Time</div>`;
  availableDivisions.forEach((divName, i) => {
    const color = divisions[divName]?.color || '#444';
    gridHtml += `<div style="grid-row:1;grid-column:${i + 2};position:sticky;top:0;background:${color};color:#fff;z-index:10;border-bottom:1px solid #999;padding:8px;text-align:center;font-weight:bold;">${divName}</div>`;
  });

  // Time column
  gridHtml += `<div style="grid-row:2;grid-column:1;height:${totalHeight}px;position:relative;background:#f9f9f9;border-right:1px solid #ccc;">`;
  for (let min = earliestMin; min < latestMin; min += INCREMENT_MINS) {
    const top = (min - earliestMin) * PIXELS_PER_MINUTE;
    gridHtml += `<div style="position:absolute;top:${top}px;left:0;width:100%;border-top:1px dashed #ddd;font-size:10px;padding:2px;color:#666;">${minutesToTime(min)}</div>`;
  }
  gridHtml += `</div>`;

  // Division columns
  availableDivisions.forEach((divName, i) => {
    const div = divisions[divName];
    const divStartMin = parseTimeToMinutes(div?.startTime);
    const divEndMin = parseTimeToMinutes(div?.endTime);

    gridHtml += `<div class="grid-cell" data-div="${divName}" data-start-min="${earliestMin}" style="grid-row:2;grid-column:${i + 2};position:relative;height:${totalHeight}px;border-right:1px solid #ccc;background:#fff;">`;

    if (divStartMin !== null && divStartMin > earliestMin) {
      const greyHeight = (divStartMin - earliestMin) * PIXELS_PER_MINUTE;
      gridHtml += `<div class="grid-disabled" style="top:0;height:${greyHeight}px;"></div>`;
    }
    if (divEndMin !== null && divEndMin < latestMin) {
      const greyTop = (divEndMin - earliestMin) * PIXELS_PER_MINUTE;
      const greyHeight = (latestMin - divEndMin) * PIXELS_PER_MINUTE;
      gridHtml += `<div class="grid-disabled" style="top:${greyTop}px;height:${greyHeight}px;"></div>`;
    }

    dailyOverrideSkeleton.filter(ev => ev.division === divName).forEach(event => {
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

    // Drop preview
    gridHtml += `<div class="drop-preview" style="display:none;position:absolute;left:2%;width:96%;background:rgba(0,123,255,0.2);border:2px dashed #007bff;border-radius:4px;pointer-events:none;z-index:5;"></div>`;
    gridHtml += `</div>`;
  });

  gridHtml += `</div>`;
  gridContainer.innerHTML = gridHtml;
  
  addDropListeners(gridContainer);
  addDragToRepositionListeners(gridContainer);
  addResizeListeners(gridContainer);
  addRemoveListeners(gridContainer);
  
  // Only apply conflict highlighting if SkeletonSandbox exists and has rules
  if (window.SkeletonSandbox) {
    applyConflictHighlighting(gridContainer);
  }
}

function renderEventTile(event, top, height) {
  let tile = TILES.find(t => t.name === event.event);
  if (!tile) {
    if (event.type === 'split') tile = TILES.find(t => t.type === 'split');
    else if (event.type === 'smart') tile = TILES.find(t => t.type === 'smart');
    else if (event.event === 'General Activity Slot') tile = TILES.find(t => t.type === 'activity');
    else if (event.event === 'Sports Slot') tile = TILES.find(t => t.type === 'sports');
    else if (event.event === 'Special Activity') tile = TILES.find(t => t.type === 'special');
    else if (event.event === 'Dismissal') tile = TILES.find(t => t.type === 'dismissal');
    else if (event.event === 'League Game') tile = TILES.find(t => t.type === 'league');
    else if (event.event === 'Specialty League') tile = TILES.find(t => t.type === 'specialty_league');
    else tile = TILES.find(t => t.type === 'custom');
  }
  const style = tile ? tile.style : 'background:#eee;border:1px solid #616161;';
  const duration = getDurationText(event.startTime, event.endTime);
  const isSmall = height < 50;
  const isTiny = height < 35;

  let label = '';
  if (isTiny) {
    label = `<div style="display:flex;align-items:center;justify-content:space-between;height:100%;padding:0 4px;font-size:0.75em;"><strong style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${event.event}</strong><span>${event.startTime}-${event.endTime}</span></div>`;
  } else if (isSmall) {
    label = `<strong>${event.event}</strong><br><span style="font-size:0.8em;">${event.startTime}-${event.endTime} (${duration})</span>`;
  } else {
    label = `<strong>${event.event}</strong><br>${event.startTime} - ${event.endTime}<br><span style="font-size:0.8em;opacity:0.8;">${duration}</span>`;
    if (event.reservedFields && event.reservedFields.length > 0) {
      label += `<br><span style="font-size:0.7em;color:#c62828;">📍 ${event.reservedFields.join(', ')}</span>`;
    }
    if (event.type === 'smart' && event.smartData) {
      label += `<br><span style="font-size:0.75em;">↳ ${event.smartData.fallbackActivity}</span>`;
    }
  }

  return `
    <div class="grid-event" data-event-id="${event.id}" draggable="true"
         title="${event.event} | ${event.startTime}-${event.endTime} (${duration})\nDrag to move • Double-click to remove • Drag edges to resize"
         style="${style}position:absolute;top:${top}px;height:${height}px;width:96%;left:2%;padding:2px;font-size:0.85rem;overflow:hidden;border-radius:4px;cursor:grab;box-shadow:0 1px 3px rgba(0,0,0,0.2);">
      <div class="resize-handle resize-handle-top" data-direction="top"></div>
      ${label}
      <div class="resize-handle resize-handle-bottom" data-direction="bottom"></div>
    </div>`;
}

// =================================================================
// RESIZE - TOP & BOTTOM
// =================================================================

function addResizeListeners(gridContainer) {
  const earliestMin = parseInt(gridContainer.dataset.earliestMin, 10) || 540;
  
  let tooltip = document.getElementById('resize-tooltip');
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.id = 'resize-tooltip';
    tooltip.style.cssText = 'position:fixed;padding:8px 12px;background:#333;color:#fff;border-radius:4px;font-size:0.9em;font-weight:bold;pointer-events:none;z-index:10002;display:none;box-shadow:0 2px 8px rgba(0,0,0,0.3);';
    document.body.appendChild(tooltip);
  }
  
  gridContainer.querySelectorAll('.grid-event').forEach(tile => {
    const handles = tile.querySelectorAll('.resize-handle');
    
    handles.forEach(handle => {
      let isResizing = false;
      let startY = 0;
      let startTop = 0;
      let startHeight = 0;
      let eventId = null;
      let direction = null;
      
      handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        isResizing = true;
        startY = e.clientY;
        startTop = parseInt(tile.style.top, 10);
        startHeight = tile.offsetHeight;
        eventId = tile.dataset.eventId;
        direction = handle.dataset.direction;
        
        tile.style.transition = 'none';
        tile.style.zIndex = '100';
        tile.style.boxShadow = '0 0 0 3px #007bff';
        
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
      });
      
      function onMouseMove(e) {
        if (!isResizing) return;
        
        const event = dailyOverrideSkeleton.find(ev => ev.id === eventId);
        if (!event) return;
        
        const deltaY = e.clientY - startY;
        let newTop = startTop;
        let newHeight = startHeight;
        
        if (direction === 'bottom') {
          newHeight = Math.max(SNAP_MINS * PIXELS_PER_MINUTE, startHeight + deltaY);
          newHeight = Math.round(newHeight / (SNAP_MINS * PIXELS_PER_MINUTE)) * (SNAP_MINS * PIXELS_PER_MINUTE);
        } else if (direction === 'top') {
          const maxDelta = startHeight - (SNAP_MINS * PIXELS_PER_MINUTE);
          const constrainedDelta = Math.min(deltaY, maxDelta);
          const snappedDelta = Math.round(constrainedDelta / (SNAP_MINS * PIXELS_PER_MINUTE)) * (SNAP_MINS * PIXELS_PER_MINUTE);
          newTop = startTop + snappedDelta;
          newHeight = startHeight - snappedDelta;
        }
        
        tile.style.top = newTop + 'px';
        tile.style.height = newHeight + 'px';
        
        const newStartMin = earliestMin + (newTop / PIXELS_PER_MINUTE);
        const newEndMin = newStartMin + (newHeight / PIXELS_PER_MINUTE);
        const newDuration = getDurationText(minutesToTime(newStartMin), minutesToTime(newEndMin));
        
        tooltip.innerHTML = `<span style="font-size:1.1em;">${minutesToTime(newStartMin)} - ${minutesToTime(newEndMin)}</span><br>${newDuration}`;
        tooltip.style.display = 'block';
        tooltip.style.left = (e.clientX + 15) + 'px';
        tooltip.style.top = (e.clientY - 30) + 'px';
      }
      
      function onMouseUp(e) {
        if (!isResizing) return;
        isResizing = false;
        
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        
        tile.style.transition = '';
        tile.style.zIndex = '';
        tile.style.boxShadow = '';
        tooltip.style.display = 'none';
        
        const event = dailyOverrideSkeleton.find(ev => ev.id === eventId);
        if (!event) return;
        
        const newTop = parseInt(tile.style.top, 10);
        const newHeightPx = parseInt(tile.style.height, 10);
        const newStartMin = earliestMin + (newTop / PIXELS_PER_MINUTE);
        const newEndMin = newStartMin + (newHeightPx / PIXELS_PER_MINUTE);
        
        const div = window.divisions?.[event.division] || {};
        const divStartMin = parseTimeToMinutes(div.startTime) || 540;
        const divEndMin = parseTimeToMinutes(div.endTime) || 960;
        
        const finalStartMin = Math.max(divStartMin, Math.round(newStartMin / SNAP_MINS) * SNAP_MINS);
        const finalEndMin = Math.min(divEndMin, Math.round(newEndMin / SNAP_MINS) * SNAP_MINS);
        
        event.startTime = minutesToTime(finalStartMin);
        event.endTime = minutesToTime(finalEndMin);
        
        saveDailySkeleton();
        renderGrid(gridContainer);
      }
    });
    
    tile.querySelectorAll('.resize-handle').forEach(h => {
      h.addEventListener('dragstart', (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
    });
  });
}

// =================================================================
// DRAG TO REPOSITION
// =================================================================

function addDragToRepositionListeners(gridContainer) {
  const earliestMin = parseInt(gridContainer.dataset.earliestMin, 10) || 540;
  
  let ghost = document.getElementById('drag-ghost');
  if (!ghost) {
    ghost = document.createElement('div');
    ghost.id = 'drag-ghost';
    ghost.style.cssText = 'position:fixed;padding:10px 14px;background:#fff;border:2px solid #007bff;border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,0.25);pointer-events:none;z-index:10001;display:none;font-size:0.9em;';
    document.body.appendChild(ghost);
  }
  
  let dragData = null;
  
  gridContainer.querySelectorAll('.grid-event').forEach(tile => {
    tile.addEventListener('dragstart', (e) => {
      if (e.target.classList.contains('resize-handle')) {
        e.preventDefault();
        return;
      }
      
      const eventId = tile.dataset.eventId;
      const event = dailyOverrideSkeleton.find(ev => ev.id === eventId);
      if (!event) return;
      
      const duration = parseTimeToMinutes(event.endTime) - parseTimeToMinutes(event.startTime);
      dragData = { type: 'move', id: eventId, event, duration };
      
      e.dataTransfer.setData('text/event-move', eventId);
      e.dataTransfer.effectAllowed = 'move';
      
      ghost.innerHTML = `<strong>${event.event}</strong><br><span style="color:#666;">${event.startTime} - ${event.endTime}</span>`;
      ghost.style.display = 'block';
      
      const img = new Image();
      img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
      e.dataTransfer.setDragImage(img, 0, 0);
      
      tile.style.opacity = '0.4';
    });
    
    tile.addEventListener('drag', (e) => {
      if (e.clientX === 0 && e.clientY === 0) return;
      ghost.style.left = (e.clientX + 12) + 'px';
      ghost.style.top = (e.clientY + 12) + 'px';
    });
    
    tile.addEventListener('dragend', () => {
      tile.style.opacity = '1';
      ghost.style.display = 'none';
      dragData = null;
      gridContainer.querySelectorAll('.drop-preview').forEach(p => p.style.display = 'none');
      gridContainer.querySelectorAll('.grid-cell').forEach(c => c.style.background = '#fff');
    });
  });
  
  gridContainer.querySelectorAll('.grid-cell').forEach(cell => {
    const preview = cell.querySelector('.drop-preview');
    
    cell.addEventListener('dragover', (e) => {
      const isEventMove = e.dataTransfer.types.includes('text/event-move');
      const isNewTile = e.dataTransfer.types.includes('application/json');
      if (!isEventMove && !isNewTile) return;
      
      e.preventDefault();
      e.dataTransfer.dropEffect = isEventMove ? 'move' : 'copy';
      cell.style.background = '#e6fffa';
      
      if (isEventMove && dragData && preview) {
        const rect = cell.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const snapMin = Math.round(y / PIXELS_PER_MINUTE / SNAP_MINS) * SNAP_MINS;
        const cellStartMin = parseInt(cell.dataset.startMin, 10);
        const previewStartTime = minutesToTime(cellStartMin + snapMin);
        const previewEndTime = minutesToTime(cellStartMin + snapMin + dragData.duration);
        
        preview.style.display = 'block';
        preview.style.top = (snapMin * PIXELS_PER_MINUTE) + 'px';
        preview.style.height = (dragData.duration * PIXELS_PER_MINUTE) + 'px';
        preview.innerHTML = `<div style="text-align:center;padding:4px;color:#007bff;font-weight:bold;font-size:0.9em;">${previewStartTime} - ${previewEndTime}</div>`;
      }
    });
    
    cell.addEventListener('dragleave', (e) => {
      if (!cell.contains(e.relatedTarget)) {
        cell.style.background = '#fff';
        if (preview) preview.style.display = 'none';
      }
    });
    
    cell.addEventListener('drop', (e) => {
      cell.style.background = '#fff';
      if (preview) preview.style.display = 'none';
      
      if (e.dataTransfer.types.includes('text/event-move')) {
        e.preventDefault();
        const eventId = e.dataTransfer.getData('text/event-move');
        const event = dailyOverrideSkeleton.find(ev => ev.id === eventId);
        if (!event) return;
        
        const divName = cell.dataset.div;
        const cellStartMin = parseInt(cell.dataset.startMin, 10);
        const rect = cell.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const snapMin = Math.round(y / PIXELS_PER_MINUTE / SNAP_MINS) * SNAP_MINS;
        
        const duration = parseTimeToMinutes(event.endTime) - parseTimeToMinutes(event.startTime);
        const newStartMin = cellStartMin + snapMin;
        const newEndMin = newStartMin + duration;
        
        event.division = divName;
        event.startTime = minutesToTime(newStartMin);
        event.endTime = minutesToTime(newEndMin);
        
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
// DROP NEW TILES
// =================================================================

function addDropListeners(gridContainer) {
  gridContainer.querySelectorAll('.grid-cell').forEach(cell => {
    cell.ondragover = (e) => {
      if (e.dataTransfer.types.includes('text/event-move')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      cell.style.background = '#e6fffa';
    };
    
    cell.ondragleave = () => { cell.style.background = '#fff'; };
    
    cell.ondrop = (e) => {
      if (e.dataTransfer.types.includes('text/event-move')) return;
      e.preventDefault();
      cell.style.background = '#fff';

      let tileData;
      try { tileData = JSON.parse(e.dataTransfer.getData('application/json')); } catch { return; }
      
      const divName = cell.dataset.div;
      const div = window.divisions[divName] || {};
      const divStartMin = parseTimeToMinutes(div.startTime);
      const divEndMin = parseTimeToMinutes(div.endTime);

      const rect = cell.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const droppedMin = Math.round(y / PIXELS_PER_MINUTE / SNAP_MINS) * SNAP_MINS;
      const earliestMin = parseInt(cell.dataset.startMin, 10);
      const defaultStartTime = minutesToTime(earliestMin + droppedMin);

      let eventType = 'slot';
      let eventName = tileData.name;
      let newEvent = null;

      const validateTime = (timeStr, isStartTime) => {
        const timeMin = parseTimeToMinutes(timeStr);
        if (timeMin === null) { alert("Invalid time format."); return null; }
        if (divStartMin !== null && timeMin < divStartMin) { alert(`Error: Before division start.`); return null; }
        if (divEndMin !== null && (isStartTime ? timeMin >= divEndMin : timeMin > divEndMin)) { alert(`Error: After division end.`); return null; }
        return timeMin;
      };

      // Split Tile
      if (tileData.type === 'split') {
        let startTime, endTime, startMin, endMin;
        while (true) { startTime = prompt(`Start Time:`, defaultStartTime); if (!startTime) return; startMin = validateTime(startTime, true); if (startMin !== null) break; }
        while (true) { endTime = prompt(`End Time:`); if (!endTime) return; endMin = validateTime(endTime, false); if (endMin !== null) { if (endMin <= startMin) alert("End must be after start."); else break; } }
        const eventName1 = prompt("First activity:"); if (!eventName1) return;
        const eventName2 = prompt("Second activity:"); if (!eventName2) return;
        newEvent = { id: `evt_${Math.random().toString(36).slice(2, 9)}`, type: 'split', event: `${eventName1} / ${eventName2}`, division: divName, startTime, endTime, subEvents: [mapEventNameForOptimizer(eventName1), mapEventNameForOptimizer(eventName2)] };
      }
      // Smart Tile
      else if (tileData.type === 'smart') {
        let startTime, endTime, startMin, endMin;
        while (true) { startTime = prompt(`Smart Tile Start:`, defaultStartTime); if (!startTime) return; startMin = validateTime(startTime, true); if (startMin !== null) break; }
        while (true) { endTime = prompt(`End Time:`); if (!endTime) return; endMin = validateTime(endTime, false); if (endMin !== null) { if (endMin <= startMin) alert("End must be after start."); else break; } }
        const rawMains = prompt("Enter TWO activities (e.g., Swim / Special):"); if (!rawMains) return;
        const mains = rawMains.split(/,|\//).map(s => s.trim()).filter(Boolean);
        if (mains.length < 2) { alert("Need two activities."); return; }
        const [main1, main2] = mains;
        const pick = prompt(`Which needs fallback?\n1: ${main1}\n2: ${main2}`); if (!pick) return;
        let fallbackFor = (pick.trim() === "1" || pick.trim().toLowerCase() === main1.toLowerCase()) ? main1 : main2;
        const fallbackActivity = prompt(`Fallback if "${fallbackFor}" unavailable?`, "Sports"); if (!fallbackActivity) return;
        newEvent = { id: `evt_${Math.random().toString(36).slice(2, 9)}`, type: "smart", event: `${main1} / ${main2}`, division: divName, startTime, endTime, smartData: { main1, main2, fallbackFor, fallbackActivity } };
      }
      // League
      else if (tileData.type === 'league') {
        let startTime = prompt(`League Game start:`, defaultStartTime); if (!startTime) return;
        let endTime = prompt(`League Game end:`); if (!endTime) return;
        newEvent = { id: `evt_${Math.random().toString(36).slice(2, 9)}`, type: 'league', event: 'League Game', division: divName, startTime, endTime };
      }
      // Specialty League
      else if (tileData.type === 'specialty_league') {
        let startTime = prompt(`Specialty League start:`, defaultStartTime); if (!startTime) return;
        let endTime = prompt(`Specialty League end:`); if (!endTime) return;
        newEvent = { id: `evt_${Math.random().toString(36).slice(2, 9)}`, type: 'specialty_league', event: 'Specialty League', division: divName, startTime, endTime };
      }
      // Pinned
      else if (['lunch', 'snacks', 'custom', 'dismissal', 'swim'].includes(tileData.type)) {
        eventType = 'pinned';
        let reservedFields = [];
        if (tileData.type === 'custom') {
          eventName = prompt("Event Name:", "Regroup"); if (!eventName) return;
          reservedFields = promptForReservedFields(eventName);
        } else {
          eventName = tileData.name;
          if (tileData.type === 'swim') {
            const swimField = (masterSettings.app1.fields || []).find(f => f.name.toLowerCase().includes('swim') || f.name.toLowerCase().includes('pool'));
            if (swimField) reservedFields = [swimField.name];
          }
        }
        let startTime, endTime, startMin, endMin;
        while (true) { startTime = prompt(`${eventName} Start:`, defaultStartTime); if (!startTime) return; startMin = validateTime(startTime, true); if (startMin !== null) break; }
        while (true) { endTime = prompt(`${eventName} End:`); if (!endTime) return; endMin = validateTime(endTime, false); if (endMin !== null) { if (endMin <= startMin) alert("End must be after start."); else break; } }
        newEvent = { id: `evt_${Math.random().toString(36).slice(2, 9)}`, type: eventType, event: eventName, division: divName, startTime, endTime, reservedFields };
      }
      // Standard
      if (!newEvent) {
        if (/league/i.test(eventName) && eventType === 'slot') eventType = 'league';
        let startTime, endTime, startMin, endMin;
        if (tileData.type === 'activity') eventName = 'General Activity Slot';
        else if (tileData.type === 'sports') eventName = 'Sports Slot';
        else if (tileData.type === 'special') eventName = 'Special Activity';
        while (true) { startTime = prompt(`${eventName} Start:`, defaultStartTime); if (!startTime) return; startMin = validateTime(startTime, true); if (startMin !== null) break; }
        while (true) { endTime = prompt(`${eventName} End:`); if (!endTime) return; endMin = validateTime(endTime, false); if (endMin !== null) { if (endMin <= startMin) alert("End must be after start."); else break; } }
        newEvent = { id: `evt_${Math.random().toString(36).slice(2, 9)}`, type: eventType, event: eventName, division: divName, startTime, endTime };
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
      if (e.target.classList.contains('resize-handle')) return;
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
// LOAD/SAVE
// =================================================================

function loadDailySkeleton() {
  const dailyData = window.loadCurrentDailyData?.() || {};
  if (dailyData.manualSkeleton && dailyData.manualSkeleton.length > 0) {
    dailyOverrideSkeleton = JSON.parse(JSON.stringify(dailyData.manualSkeleton));
    return;
  }
  const assignments = masterSettings.app1.skeletonAssignments || {};
  const skeletons = masterSettings.app1.savedSkeletons || {};
  const dateStr = window.currentScheduleDate || "";
  const [year, month, day] = dateStr.split('-').map(Number);
  let dayOfWeek = 0;
  if (year && month && day) dayOfWeek = new Date(year, month - 1, day).getDay();
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
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
      if (hh !== 12) hh += 12;
    }
  }
  return hh * 60 + mm;
}

function applySmartTileOverridesForToday() {
  console.log("Smart Tile pre-processor DISABLED.");
  return;
}

function runOptimizer() {
  if (!window.runSkeletonOptimizer) { alert("Error: 'runSkeletonOptimizer' not found."); return; }
  if (dailyOverrideSkeleton.length === 0) { alert("Skeleton is empty."); return; }

  if (window.SkeletonSandbox) {
    const conflicts = window.SkeletonSandbox.detectConflicts(dailyOverrideSkeleton);
    const critical = conflicts.filter(c => c.type === 'critical');
    if (critical.length > 0) {
      const msg = critical.slice(0, 3).map(c => `• ${c.resource}: ${c.event1.division} ↔ ${c.event2.division}`).join('\n');
      if (!confirm(`⚠️ ${critical.length} critical conflict(s)!\n\n${msg}\n\nRun anyway?`)) return;
    }
  }

  saveDailySkeleton();
  try { applySmartTileOverridesForToday(); } catch (e) { console.error(e); }
  const success = window.runSkeletonOptimizer(dailyOverrideSkeleton, currentOverrides);
  if (success) { alert("Schedule Generated!"); window.showTab?.('schedule'); }
  else { alert("Error. Check console."); }
}

// =================================================================
// MAIN INIT
// =================================================================

function init() {
  container = document.getElementById("daily-adjustments-content");
  if (!container) { console.error("Daily Adjustments: container not found"); return; }
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
    <div style="padding:15px;background:#f9f9f9;border:1px solid #ddd;border-radius:8px;margin-bottom:15px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
      <div>
        <h2 style="margin:0 0 5px 0;font-size:1.2em;">Daily Adjustments</h2>
        <p style="margin:0;font-size:0.85em;color:#666;">${window.currentScheduleDate} • Drag edges to resize • Double-click to remove</p>
      </div>
      <button id="run-optimizer-btn" style="background:#28a745;color:white;padding:10px 20px;font-size:1em;border:none;border-radius:5px;cursor:pointer;font-weight:bold;">▶ Run Optimizer</button>
    </div>

    <div class="da-tabs-nav" style="background:#f4f4f4;border:1px solid #ddd;border-radius:5px;padding:5px;margin-bottom:15px;display:flex;gap:5px;">
      <button class="da-tab-btn active" data-tab="skeleton">Skeleton</button>
      <button class="da-tab-btn" data-tab="trips">Trips</button>
      <button class="da-tab-btn" data-tab="bunk-specific">Bunk Specific</button>
      <button class="da-tab-btn" data-tab="resources">Resources</button>
    </div>

    <div id="da-pane-skeleton" class="da-pane active">
      <div id="daily-skeleton-editor-section" style="border:1px solid #ddd;border-radius:5px;padding:15px;background:#fff;">
        <div id="override-scheduler-content"></div>
      </div>
    </div>

    <div id="da-pane-trips" class="da-pane" style="display:none;">
      <div style="border:1px solid #ddd;border-radius:5px;padding:15px;background:#fff;">
        <h3 style="margin-top:0;">Add Trip</h3>
        <div id="trips-form-container"></div>
      </div>
    </div>

    <div id="da-pane-bunk-specific" class="da-pane" style="display:none;">
      <div style="border:1px solid #ddd;border-radius:5px;padding:15px;background:#fff;">
        <h3 style="margin-top:0;">Bunk-Specific Overrides</h3>
        <p style="font-size:0.85em;color:#666;">Assign a specific activity to bunks at a specific time.</p>
        <div id="bunk-overrides-container"></div>
      </div>
    </div>

    <div id="da-pane-resources" class="da-pane" style="display:none;">
      <div style="border:1px solid #ddd;border-radius:5px;padding:15px;background:#fff;">
        <h3 style="margin-top:0;">Daily Resource Availability</h3>
        <p style="font-size:0.85em;color:#666;">Disable fields, leagues, or activities for this day only.</p>
        <div id="resource-overrides-container"></div>
      </div>
    </div>

    <style>
      .da-tab-btn { flex:1; padding:8px 12px; border:none; background:transparent; border-radius:4px; cursor:pointer; font-size:0.9em; font-weight:500; color:#666; }
      .da-tab-btn:hover { background:#e9e9e9; }
      .da-tab-btn.active { background:#007bff; color:#fff; }
      .da-pane { display:none; }
      .da-pane.active { display:block; }
      .grid-disabled { position:absolute; width:100%; background-color:#80808040; background-image:linear-gradient(-45deg,#0000001a 25%,transparent 25%,transparent 50%,#0000001a 50%,#0000001a 75%,transparent 75%,transparent); background-size:20px 20px; z-index:1; pointer-events:none; }
      .grid-event { z-index:2; position:relative; }
      .grid-event:hover { box-shadow:0 2px 8px rgba(0,0,0,0.3); z-index:10 !important; }
      .grid-cell { position:relative; border-right:1px solid #ccc; background:#fff; }
      .resize-handle { position:absolute; left:0; right:0; height:8px; cursor:ns-resize; z-index:5; opacity:0; transition:opacity 0.15s; }
      .resize-handle-top { top:0; background:linear-gradient(to bottom, rgba(0,123,255,0.4), transparent); }
      .resize-handle-bottom { bottom:0; background:linear-gradient(to top, rgba(0,123,255,0.4), transparent); }
      .grid-event:hover .resize-handle { opacity:1; }
      @keyframes pulse { 0%,100%{box-shadow:0 0 0 0 rgba(220,38,38,0.4);} 50%{box-shadow:0 0 0 4px rgba(220,38,38,0);} }
      @keyframes pulseWarn { 0%,100%{box-shadow:0 0 0 0 rgba(217,119,6,0.4);} 50%{box-shadow:0 0 0 4px rgba(217,119,6,0);} }
      .conflict-critical { animation:pulse 1.5s infinite; border:2px solid #dc2626 !important; background:#fef2f2 !important; }
      .conflict-critical, .conflict-critical strong, .conflict-critical span { color:#7f1d1d !important; }
      .conflict-warning { animation:pulseWarn 2s infinite; border:2px solid #d97706 !important; background:#fefce8 !important; }
      .conflict-warning, .conflict-warning strong, .conflict-warning span { color:#78350f !important; }
      .resource-toggle-row { display:flex; align-items:center; justify-content:space-between; padding:8px 12px; background:#fff; border:1px solid #ddd; border-radius:5px; margin-bottom:6px; }
      .resource-toggle-row:hover { background:#f9f9f9; }
      .resource-toggle-row.disabled-row { background:#fee; border-color:#fcc; }
      .resource-toggle-row.expanded { border-color:#007bff; background:#f0f7ff; }
      .resource-toggle-name { font-weight:500; flex:1; }
      .resource-toggle-switch { position:relative; width:40px; height:22px; }
      .resource-toggle-switch input { opacity:0; width:0; height:0; }
      .resource-toggle-slider { position:absolute; cursor:pointer; top:0; left:0; right:0; bottom:0; background:#ccc; transition:0.2s; border-radius:22px; }
      .resource-toggle-slider:before { position:absolute; content:""; height:16px; width:16px; left:3px; bottom:3px; background:white; transition:0.2s; border-radius:50%; }
      .resource-toggle-switch input:checked + .resource-toggle-slider { background:#28a745; }
      .resource-toggle-switch input:checked + .resource-toggle-slider:before { transform:translateX(18px); }
      .field-sports-panel { margin-top:6px; padding:10px; background:#f9f9f9; border:1px solid #ddd; border-radius:5px; }
      .field-sport-chip { display:inline-block; padding:4px 10px; margin:2px; border-radius:20px; font-size:0.8em; cursor:pointer; border:1px solid #ddd; background:#fff; }
      .field-sport-chip.enabled { background:#d4edda; border-color:#28a745; color:#155724; }
      .field-sport-chip.disabled { background:#f8d7da; border-color:#dc3545; color:#721c24; text-decoration:line-through; }
    </style>
  `;

  document.getElementById("run-optimizer-btn").onclick = runOptimizer;

  container.querySelectorAll('.da-tab-btn').forEach(btn => {
    btn.onclick = () => {
      activeSubTab = btn.dataset.tab;
      container.querySelectorAll('.da-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      container.querySelectorAll('.da-pane').forEach(p => { p.style.display = 'none'; p.classList.remove('active'); });
      const pane = container.querySelector(`#da-pane-${activeSubTab}`);
      if (pane) { pane.style.display = 'block'; pane.classList.add('active'); }
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

function initDailySkeletonUI() {
  if (!skeletonContainer) return;
  loadDailySkeleton();

  const savedSkeletons = masterSettings.app1.savedSkeletons || {};
  let optionsHtml = `<option value="">-- Select Skeleton --</option>`;
  Object.keys(savedSkeletons).sort().forEach(name => { optionsHtml += `<option value="${name}">${name}</option>`; });

  skeletonContainer.innerHTML = `
    <div id="displaced-tiles-panel" style="display:none;"></div>
    <div style="margin-bottom:10px;padding:10px;background:#f4f4f4;border-radius:5px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
      <select id="daily-skeleton-select" style="padding:6px;">${optionsHtml}</select>
      <button id="daily-skeleton-load-btn" style="padding:6px 12px;background:#007bff;color:white;border:none;border-radius:4px;cursor:pointer;">Load</button>
      <div style="flex:1;"></div>
      ${window.SkeletonSandbox ? `<button id="conflict-rules-btn" style="padding:6px 12px;background:#fff;border:1px solid #ddd;border-radius:4px;cursor:pointer;">⚙️ Conflict Rules</button>` : ''}
    </div>
    <div id="daily-skeleton-palette" style="padding:10px;background:#f4f4f4;border-radius:5px;margin-bottom:10px;display:flex;flex-wrap:wrap;gap:10px;"></div>
    <div id="daily-skeleton-grid" style="overflow-x:auto;border:1px solid #999;background:#fff;max-height:550px;overflow-y:auto;"></div>
  `;

  document.getElementById("daily-skeleton-load-btn").onclick = () => {
    const select = document.getElementById("daily-skeleton-select");
    const name = select.value;
    if (!name) return;
    if (confirm(`Load "${name}"?`)) {
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
      rulesBtn.onclick = () => window.SkeletonSandbox.showRulesModal(() => { renderGrid(document.getElementById("daily-skeleton-grid")); });
    }
  }

  const palette = document.getElementById("daily-skeleton-palette");
  const grid = document.getElementById("daily-skeleton-grid");
  renderPalette(palette);
  renderGrid(grid);
  renderDisplacedTilesPanel();
}

function renderTripsForm() {
  if (!tripsFormContainer) return;
  const divisions = window.availableDivisions || [];

  tripsFormContainer.innerHTML = `
    <div style="max-width:400px;">
      <p style="color:#666;font-size:0.85em;margin-bottom:15px;">Add an off-campus trip. Overlapping events will be bumped.</p>
      <div style="margin-bottom:10px;">
        <label style="display:block;font-weight:500;margin-bottom:4px;">Division</label>
        <select id="trip-division-select" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;">
          <option value="">-- Select --</option>
          ${divisions.map(d => `<option value="${d}">${d}</option>`).join("")}
        </select>
      </div>
      <div style="margin-bottom:10px;">
        <label style="display:block;font-weight:500;margin-bottom:4px;">Trip Name</label>
        <input id="trip-name-input" type="text" placeholder="e.g. Six Flags" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;box-sizing:border-box;" />
      </div>
      <div style="display:flex;gap:10px;margin-bottom:15px;">
        <div style="flex:1;">
          <label style="display:block;font-weight:500;margin-bottom:4px;">Start</label>
          <input id="trip-start-input" type="text" placeholder="10:00am" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;box-sizing:border-box;" />
        </div>
        <div style="flex:1;">
          <label style="display:block;font-weight:500;margin-bottom:4px;">End</label>
          <input id="trip-end-input" type="text" placeholder="3:30pm" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;box-sizing:border-box;" />
        </div>
      </div>
      <button id="apply-trip-btn" style="width:100%;background:#007bff;color:white;padding:10px;font-weight:bold;border:none;border-radius:4px;cursor:pointer;">Add Trip</button>
    </div>
  `;

  document.getElementById("apply-trip-btn").onclick = () => {
    const division = document.getElementById("trip-division-select").value;
    const tripName = document.getElementById("trip-name-input").value.trim();
    const startTime = document.getElementById("trip-start-input").value.trim();
    const endTime = document.getElementById("trip-end-input").value.trim();
    if (!division || !tripName || !startTime || !endTime) { alert("Complete all fields."); return; }
    const startMin = parseTimeToMinutes(startTime);
    const endMin = parseTimeToMinutes(endTime);
    if (startMin == null || endMin == null) { alert("Invalid time."); return; }
    if (endMin <= startMin) { alert("End must be after start."); return; }

    loadDailySkeleton();
    const newEvent = { id: `trip_${Math.random().toString(36).slice(2, 9)}`, type: "pinned", event: tripName, division, startTime, endTime, reservedFields: [] };
    dailyOverrideSkeleton.push(newEvent);
    bumpOverlappingTiles(newEvent, division);
    saveDailySkeleton();

    if (skeletonContainer) {
      const grid = skeletonContainer.querySelector("#daily-skeleton-grid");
      if (grid) renderGrid(grid);
    }
    container.querySelector('.da-tab-btn[data-tab="skeleton"]').click();
    alert("Trip added!");
    document.getElementById("trip-name-input").value = "";
    document.getElementById("trip-start-input").value = "";
    document.getElementById("trip-end-input").value = "";
  };
}

function renderBunkOverridesUI() {
  if (!bunkOverridesContainer) return;
  const divisions = window.divisions || {};
  const availableDivisions = window.availableDivisions || [];
  const bunks = [];
  availableDivisions.forEach(divName => {
    const div = divisions[divName];
    if (div?.bunks) div.bunks.forEach(bunk => bunks.push({ name: bunk, division: divName, color: div.color }));
  });

  const sports = [];
  (masterSettings.app1.fields || []).forEach(f => { (f.activities || []).forEach(s => { if (!sports.includes(s)) sports.push(s); }); });
  sports.sort();
  const specials = (masterSettings.app1.specialActivities || []).map(s => s.name).sort();

  bunkOverridesContainer.innerHTML = `
    <div style="max-width:450px;">
      <div style="margin-bottom:10px;">
        <label style="display:block;font-weight:500;margin-bottom:4px;">Type</label>
        <select id="bo-type" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;">
          <option value="">-- Select --</option>
          <option value="sport">Sport</option>
          <option value="special">Special Activity</option>
          <option value="trip">Personal Trip</option>
        </select>
      </div>
      <div id="bo-activity-wrap" style="margin-bottom:10px;display:none;">
        <label style="display:block;font-weight:500;margin-bottom:4px;">Activity</label>
        <select id="bo-activity" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;"></select>
      </div>
      <div id="bo-trip-wrap" style="margin-bottom:10px;display:none;">
        <label style="display:block;font-weight:500;margin-bottom:4px;">Trip Name</label>
        <input id="bo-trip-name" type="text" placeholder="e.g. Doctor" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;box-sizing:border-box;">
      </div>
      <div style="display:flex;gap:10px;margin-bottom:10px;">
        <div style="flex:1;"><label style="display:block;font-weight:500;margin-bottom:4px;">Start</label><input id="bo-start" type="text" placeholder="10:00am" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;box-sizing:border-box;"></div>
        <div style="flex:1;"><label style="display:block;font-weight:500;margin-bottom:4px;">End</label><input id="bo-end" type="text" placeholder="11:00am" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;box-sizing:border-box;"></div>
      </div>
      <div style="margin-bottom:15px;">
        <label style="display:block;font-weight:500;margin-bottom:6px;">Select Bunks</label>
        <div id="bo-bunks" style="display:flex;flex-wrap:wrap;gap:6px;max-height:140px;overflow-y:auto;padding:8px;border:1px solid #ddd;border-radius:4px;background:#f9f9f9;">
          ${bunks.map(b => `<button type="button" class="bunk-chip" data-bunk="${b.name}" data-color="${b.color}" style="padding:5px 12px;border:2px solid ${b.color};background:white;border-radius:20px;cursor:pointer;font-size:0.85em;">${b.name}</button>`).join('')}
        </div>
      </div>
      <button id="bo-apply" style="width:100%;background:#007bff;color:white;padding:10px;font-weight:bold;border:none;border-radius:4px;cursor:pointer;">Apply</button>
      <div id="bo-existing" style="margin-top:15px;"></div>
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
      activitySelect.innerHTML = `<option value="">-- Select --</option>` + sports.map(s => `<option value="${s}">${s}</option>`).join('');
      activityWrap.style.display = 'block';
    } else if (typeSelect.value === 'special') {
      activitySelect.innerHTML = `<option value="">-- Select --</option>` + specials.map(s => `<option value="${s}">${s}</option>`).join('');
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
    if (!type || !startTime || !endTime) { alert("Complete fields."); return; }

    let activityName = '';
    if (type === 'sport' || type === 'special') {
      activityName = activitySelect.value;
      if (!activityName) { alert("Select activity."); return; }
    } else if (type === 'trip') {
      activityName = document.getElementById("bo-trip-name").value.trim();
      if (!activityName) { alert("Enter trip name."); return; }
    }

    const selectedBunks = [...bunkOverridesContainer.querySelectorAll('.bunk-chip.selected')].map(c => c.dataset.bunk);
    if (selectedBunks.length === 0) { alert("Select bunks."); return; }

    const startMin = parseTimeToMinutes(startTime);
    const endMin = parseTimeToMinutes(endTime);
    if (startMin == null || endMin == null || endMin <= startMin) { alert("Invalid times."); return; }

    currentOverrides.bunkActivityOverrides.push({ id: `bunk_${Math.random().toString(36).slice(2, 9)}`, type, activity: activityName, bunks: selectedBunks, startTime, endTime });
    window.saveCurrentDailyData("bunkActivityOverrides", currentOverrides.bunkActivityOverrides);
    alert(`Applied to ${selectedBunks.length} bunk(s)!`);

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
  const cont = document.getElementById("bo-existing");
  if (!cont) return;
  if (currentOverrides.bunkActivityOverrides.length === 0) { cont.innerHTML = ''; return; }

  cont.innerHTML = `
    <h4 style="margin:0 0 10px 0;">Existing Overrides</h4>
    ${currentOverrides.bunkActivityOverrides.map((o, i) => `
      <div style="background:#f9f9f9;padding:10px;border-radius:5px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;border:1px solid #ddd;">
        <div><strong>${o.activity}</strong> (${o.type})<br><span style="font-size:0.85em;color:#666;">${o.bunks.join(', ')} • ${o.startTime}-${o.endTime}</span></div>
        <button class="remove-bo-btn" data-index="${i}" style="background:#dc3545;color:white;border:none;width:28px;height:28px;border-radius:4px;cursor:pointer;font-size:1em;">×</button>
      </div>
    `).join('')}
  `;

  cont.querySelectorAll('.remove-bo-btn').forEach(btn => {
    btn.onclick = () => {
      currentOverrides.bunkActivityOverrides.splice(parseInt(btn.dataset.index), 1);
      window.saveCurrentDailyData("bunkActivityOverrides", currentOverrides.bunkActivityOverrides);
      renderExistingBunkOverrides();
    };
  });
}

let expandedField = null;

function renderResourceOverridesUI() {
  if (!resourceOverridesContainer) return;

  resourceOverridesContainer.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(240px, 1fr));gap:20px;">
      <div><h4 style="margin:0 0 10px 0;">Fields</h4><div id="override-fields-list"></div></div>
      <div><h4 style="margin:0 0 10px 0;">Special Activities</h4><div id="override-specials-list"></div></div>
      <div><h4 style="margin:0 0 10px 0;">Leagues</h4><div id="override-leagues-list"></div></div>
      <div><h4 style="margin:0 0 10px 0;">Specialty Leagues</h4><div id="override-specialty-leagues-list"></div></div>
    </div>
  `;

  const saveOverrides = () => {
    const dailyData = window.loadCurrentDailyData?.() || {};
    const fullOverrides = dailyData.overrides || {};
    fullOverrides.leagues = currentOverrides.leagues;
    fullOverrides.disabledFields = currentOverrides.disabledFields;
    fullOverrides.disabledSpecials = currentOverrides.disabledSpecials;
    window.saveCurrentDailyData("overrides", fullOverrides);
    window.saveCurrentDailyData("dailyDisabledSportsByField", currentOverrides.dailyDisabledSportsByField);
  };

  const fields = masterSettings.app1.fields || [];
  const overrideFieldsListEl = document.getElementById("override-fields-list");
  
  fields.forEach(item => {
    const isDisabled = currentOverrides.disabledFields.includes(item.name);
    const isExpanded = expandedField === item.name;
    
    const wrapper = document.createElement('div');
    wrapper.innerHTML = `
      <div class="resource-toggle-row ${isDisabled ? 'disabled-row' : ''} ${isExpanded ? 'expanded' : ''}" data-field="${item.name}">
        <div style="display:flex;align-items:center;gap:6px;flex:1;cursor:pointer;" class="field-name-area">
          <span style="color:#999;font-size:0.8em;transition:transform 0.15s;transform:rotate(${isExpanded ? '90deg' : '0deg'});">▶</span>
          <span class="resource-toggle-name">${item.name}</span>
        </div>
        <label class="resource-toggle-switch" onclick="event.stopPropagation()">
          <input type="checkbox" ${!isDisabled ? 'checked' : ''}>
          <span class="resource-toggle-slider"></span>
        </label>
      </div>
      ${isExpanded ? `
        <div class="field-sports-panel">
          <div style="font-size:0.8em;font-weight:500;color:#666;margin-bottom:6px;">Sports on this field:</div>
          ${(item.activities || []).length === 0 ? '<span style="color:#999;font-size:0.8em;font-style:italic;">None</span>' : 
            (item.activities || []).map(sport => {
              const disabledSports = currentOverrides.dailyDisabledSportsByField[item.name] || [];
              const isSportDisabled = disabledSports.includes(sport);
              return `<span class="field-sport-chip ${isSportDisabled ? 'disabled' : 'enabled'}" data-field="${item.name}" data-sport="${sport}">${sport}</span>`;
            }).join('')}
        </div>
      ` : ''}
    `;
    
    const checkbox = wrapper.querySelector('input[type="checkbox"]');
    checkbox.onchange = () => {
      if (checkbox.checked) currentOverrides.disabledFields = currentOverrides.disabledFields.filter(n => n !== item.name);
      else if (!currentOverrides.disabledFields.includes(item.name)) currentOverrides.disabledFields.push(item.name);
      saveOverrides();
      renderResourceOverridesUI();
    };
    
    const nameArea = wrapper.querySelector('.field-name-area');
    nameArea.onclick = () => {
      expandedField = expandedField === item.name ? null : item.name;
      renderResourceOverridesUI();
    };
    
    wrapper.querySelectorAll('.field-sport-chip').forEach(chip => {
      chip.onclick = () => {
        const fieldName = chip.dataset.field;
        const sportName = chip.dataset.sport;
        if (!currentOverrides.dailyDisabledSportsByField[fieldName]) currentOverrides.dailyDisabledSportsByField[fieldName] = [];
        const idx = currentOverrides.dailyDisabledSportsByField[fieldName].indexOf(sportName);
        if (idx >= 0) currentOverrides.dailyDisabledSportsByField[fieldName].splice(idx, 1);
        else currentOverrides.dailyDisabledSportsByField[fieldName].push(sportName);
        saveOverrides();
        renderResourceOverridesUI();
      };
    });
    
    overrideFieldsListEl.appendChild(wrapper);
  });

  const specials = masterSettings.app1.specialActivities || [];
  const overrideSpecialsListEl = document.getElementById("override-specials-list");
  specials.forEach(item => {
    const isDisabled = currentOverrides.disabledSpecials.includes(item.name);
    overrideSpecialsListEl.appendChild(createResourceToggle(item.name, !isDisabled, (isEnabled) => {
      if (isEnabled) currentOverrides.disabledSpecials = currentOverrides.disabledSpecials.filter(n => n !== item.name);
      else if (!currentOverrides.disabledSpecials.includes(item.name)) currentOverrides.disabledSpecials.push(item.name);
      saveOverrides();
      renderResourceOverridesUI();
    }));
  });

  const leagues = Object.keys(masterSettings.leaguesByName || {});
  const overrideLeaguesListEl = document.getElementById("override-leagues-list");
  leagues.forEach(name => {
    const isDisabled = currentOverrides.leagues.includes(name);
    overrideLeaguesListEl.appendChild(createResourceToggle(name, !isDisabled, (isEnabled) => {
      if (isEnabled) currentOverrides.leagues = currentOverrides.leagues.filter(l => l !== name);
      else if (!currentOverrides.leagues.includes(name)) currentOverrides.leagues.push(name);
      saveOverrides();
    }));
  });

  const specialtyLeagues = Object.values(masterSettings.specialtyLeagues || {}).map(l => l.name).sort();
  const overrideSpecialtyLeaguesListEl = document.getElementById("override-specialty-leagues-list");
  specialtyLeagues.forEach(name => {
    const isDisabled = currentOverrides.disabledSpecialtyLeagues.includes(name);
    overrideSpecialtyLeaguesListEl.appendChild(createResourceToggle(name, !isDisabled, (isEnabled) => {
      if (isEnabled) currentOverrides.disabledSpecialtyLeagues = currentOverrides.disabledSpecialtyLeagues.filter(l => l !== name);
      else if (!currentOverrides.disabledSpecialtyLeagues.includes(name)) currentOverrides.disabledSpecialtyLeagues.push(name);
      window.saveCurrentDailyData("disabledSpecialtyLeagues", currentOverrides.disabledSpecialtyLeagues);
    }));
  });
}

function createResourceToggle(name, isEnabled, onToggle) {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = `
    <div class="resource-toggle-row ${!isEnabled ? 'disabled-row' : ''}">
      <span class="resource-toggle-name">${name}</span>
      <label class="resource-toggle-switch">
        <input type="checkbox" ${isEnabled ? 'checked' : ''}>
        <span class="resource-toggle-slider"></span>
      </label>
    </div>
  `;
  const checkbox = wrapper.querySelector('input[type="checkbox"]');
  checkbox.onchange = () => { onToggle(checkbox.checked); };
  return wrapper;
}

window.initDailyAdjustments = init;
window.parseTimeToMinutes = parseTimeToMinutes;
window.minutesToTime = minutesToTime;

})();
