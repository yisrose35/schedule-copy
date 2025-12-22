// =================================================================
// daily_adjustments.js  (v2.5 - Exact Master Builder Match)
// - Grid/tiles EXACTLY match master_schedule_builder.js
// - Uses styles.css color palette for conflicts
// - Fixed conflict detection (only when rules exist)
// - Better drag preview visibility
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
    return (parsed && typeof parsed === "object" && parsed.byBunk) ? parsed : { byBunk: {} };
  } catch (e) { return { byBunk: {} }; }
}

function saveSmartTileHistory(history) {
  try {
    if (window.localStorage) {
      localStorage.setItem(SMART_TILE_HISTORY_KEY, JSON.stringify(history || { byBunk: {} }));
    }
  } catch (e) {}
}

let skeletonContainer = null;
let tripsFormContainer = null;
let bunkOverridesContainer = null;
let resourceOverridesContainer = null;
let activeSubTab = 'skeleton';

// =================================================================
// SKELETON EDITOR - EXACT COPY FROM master_schedule_builder.js
// =================================================================

let dailyOverrideSkeleton = [];
const PIXELS_PER_MINUTE = 2;
const INCREMENT_MINS = 30;
const SNAP_MINS = 5;

// TILES - EXACT copy from master_schedule_builder.js
const TILES = [
  { type: 'activity', name: 'Activity', style: 'background:#e0f7fa;border:1px solid #007bff;', description: 'Flexible slot (Sport or Special).' },
  { type: 'sports', name: 'Sports', style: 'background:#dcedc8;border:1px solid #689f38;', description: 'Sports slot only.' },
  { type: 'special', name: 'Special Activity', style: 'background:#e8f5e9;border:1px solid #43a047;', description: 'Special Activity slot only.' },
  { type: 'smart', name: 'Smart Tile', style: 'background:#e3f2fd;border:2px dashed #0288d1;color:#01579b;', description: 'Balances 2 activities with a fallback.' },
  { type: 'split', name: 'Split Activity', style: 'background:#fff3e0;border:1px solid #f57c00;', description: 'Two activities share the block (Switch halfway).' },
  { type: 'league', name: 'League Game', style: 'background:#d1c4e9;border:1px solid #5e35b1;', description: 'Regular League slot (Full Buyout).' },
  { type: 'specialty_league', name: 'Specialty League', style: 'background:#fff8e1;border:1px solid #f9a825;', description: 'Specialty League slot (Full Buyout).' },
  { type: 'swim', name: 'Swim', style: 'background:#bbdefb;border:1px solid #1976d2;', description: 'Pinned.' },
  { type: 'lunch', name: 'Lunch', style: 'background:#fbe9e7;border:1px solid #d84315;', description: 'Pinned.' },
  { type: 'snacks', name: 'Snacks', style: 'background:#fff9c4;border:1px solid #fbc02d;', description: 'Pinned.' },
  { type: 'dismissal', name: 'Dismissal', style: 'background:#f44336;color:white;border:1px solid #b71c1c;', description: 'Pinned.' },
  { type: 'custom', name: 'Custom Pinned Event', style: 'background:#eee;border:1px solid #616161;', description: 'Pinned custom (e.g., Regroup).' }
];

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
  const validated = [], invalid = [];
  requested.forEach(name => {
    const match = allLocations.find(loc => loc.toLowerCase() === name.toLowerCase());
    if (match) validated.push(match);
    else invalid.push(name);
  });
  if (invalid.length > 0) alert(`Warning: These fields were not found and will be ignored:\n${invalid.join(', ')}`);
  return validated;
}

// =================================================================
// DISPLACED TILES
// =================================================================

function addDisplacedTile(event, reason) {
  displacedTiles.push({
    event: event.event, type: event.type, division: event.division,
    originalStart: event.startTime, originalEnd: event.endTime,
    reason: reason, timestamp: Date.now()
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
  if (displacedTiles.length === 0) { panel.style.display = 'none'; return; }
  
  panel.style.display = 'block';
  panel.innerHTML = `
    <div style="background:#fff8e1;border:1px solid #ffb300;border-radius:8px;padding:12px;margin-bottom:15px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <strong style="color:#e65100;">📋 Displaced Tiles (${displacedTiles.length})</strong>
        <button id="clear-displaced-btn" style="background:#fff;border:1px solid #ffb300;color:#e65100;padding:4px 12px;border-radius:4px;cursor:pointer;font-size:0.85em;">Clear</button>
      </div>
      <div style="max-height:120px;overflow-y:auto;">
        ${displacedTiles.map(d => `
          <div style="background:#fff;padding:8px 12px;margin-bottom:4px;border-radius:4px;font-size:0.85em;border-left:3px solid ${d.type === 'pinned' ? '#ff5722' : '#ffb300'};">
            <strong>${d.event}</strong> (${d.division}) - ${d.originalStart} - ${d.originalEnd}
          </div>
        `).join('')}
      </div>
    </div>
  `;
  document.getElementById('clear-displaced-btn').onclick = clearDisplacedTiles;
}

// =================================================================
// OVERLAP HANDLING - Erase for trips, bump for others
// =================================================================

function eraseOverlappingTiles(newEvent, divName) {
  const newStartMin = parseTimeToMinutes(newEvent.startTime);
  const newEndMin = parseTimeToMinutes(newEvent.endTime);
  
  // Simply remove any overlapping tiles in this division
  dailyOverrideSkeleton = dailyOverrideSkeleton.filter(ev => {
    if (ev.id === newEvent.id || ev.division !== divName) return true;
    const evStart = parseTimeToMinutes(ev.startTime);
    const evEnd = parseTimeToMinutes(ev.endTime);
    if (evStart == null || evEnd == null) return true;
    const overlaps = (evStart < newEndMin && evEnd > newStartMin);
    if (overlaps) {
      addDisplacedTile(ev, 'Erased by trip');
    }
    return !overlaps;
  });
}

function bumpOverlappingTiles(newEvent, divName) {
  const newStartMin = parseTimeToMinutes(newEvent.startTime);
  const newEndMin = parseTimeToMinutes(newEvent.endTime);
  const div = window.divisions?.[divName] || {};
  const divEndMin = parseTimeToMinutes(div.endTime) || 960;
  
  const overlapping = dailyOverrideSkeleton.filter(ev => {
    if (ev.id === newEvent.id || ev.division !== divName) return false;
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

// =================================================================
// RENDER PALETTE - EXACT COPY from master_schedule_builder.js
// =================================================================

function renderPalette(paletteEl) {
  if (!paletteEl) {
    console.error("Palette element not found!");
    return;
  }
  paletteEl.innerHTML = '';
  TILES.forEach(tile => {
    const el = document.createElement('div');
    el.className = 'grid-tile-draggable';
    el.textContent = tile.name;
    el.style.cssText = tile.style;
    el.style.padding = '8px 12px';
    el.style.borderRadius = '5px';
    el.style.cursor = 'grab';
    el.style.userSelect = 'none';
    el.draggable = true;
    el.ondragstart = (e) => { 
      e.dataTransfer.setData('application/json', JSON.stringify(tile)); 
      e.dataTransfer.effectAllowed = 'copy';
    };
    paletteEl.appendChild(el);
  });
}

// =================================================================
// RENDER GRID - EXACT COPY from master_schedule_builder.js
// =================================================================

function renderGrid(gridEl) {
  const divisions = window.divisions || {};
  const availableDivisions = window.availableDivisions || [];

  if (availableDivisions.length === 0) {
    gridEl.innerHTML = `<div style="padding:20px;text-align:center;color:#666;">No divisions found. Please go to Setup to create divisions.</div>`;
    return;
  }

  // Calculate Times - EXACT same logic
  let earliestMin = null, latestMin = null;
  Object.values(divisions).forEach(div => {
    const s = parseTimeToMinutes(div.startTime);
    const e = parseTimeToMinutes(div.endTime);
    if (s !== null && (earliestMin === null || s < earliestMin)) earliestMin = s;
    if (e !== null && (latestMin === null || e > latestMin)) latestMin = e;
  });
  if (earliestMin === null) earliestMin = 540;
  if (latestMin === null) latestMin = 960;

  // Stretch for pinned events
  const latestPinned = Math.max(-Infinity, ...dailyOverrideSkeleton.map(e => parseTimeToMinutes(e.endTime) || -Infinity));
  if (latestPinned > -Infinity) latestMin = Math.max(latestMin, latestPinned);
  if (latestMin <= earliestMin) latestMin = earliestMin + 60;

  const totalHeight = (latestMin - earliestMin) * PIXELS_PER_MINUTE;
  gridEl.dataset.earliestMin = earliestMin;

  // Build HTML - EXACT structure from master_schedule_builder.js
  let html = `<div style="display:grid; grid-template-columns:60px repeat(${availableDivisions.length}, 1fr); position:relative; min-width:800px;">`;
  
  // Header Row
  html += `<div style="grid-row:1; position:sticky; top:0; background:#fff; z-index:10; border-bottom:1px solid #999; padding:8px; font-weight:bold;">Time</div>`;
  availableDivisions.forEach((divName, i) => {
    const color = divisions[divName]?.color || '#444';
    html += `<div style="grid-row:1; grid-column:${i + 2}; position:sticky; top:0; background:${color}; color:#fff; z-index:10; border-bottom:1px solid #999; padding:8px; text-align:center; font-weight:bold;">${divName}</div>`;
  });

  // Time Column
  html += `<div style="grid-row:2; grid-column:1; height:${totalHeight}px; position:relative; background:#f9f9f9; border-right:1px solid #ccc;">`;
  for (let m = earliestMin; m < latestMin; m += INCREMENT_MINS) {
    const top = (m - earliestMin) * PIXELS_PER_MINUTE;
    html += `<div style="position:absolute; top:${top}px; left:0; width:100%; border-top:1px dashed #ddd; font-size:10px; padding:2px; color:#666;">${minutesToTime(m)}</div>`;
  }
  html += `</div>`;

  // Division Columns
  availableDivisions.forEach((divName, i) => {
    const div = divisions[divName];
    const s = parseTimeToMinutes(div?.startTime);
    const e = parseTimeToMinutes(div?.endTime);
    
    html += `<div class="grid-cell" data-div="${divName}" data-start-min="${earliestMin}" style="grid-row:2; grid-column:${i + 2}; height:${totalHeight}px;">`;
    
    // Grey out unavailable times
    if (s !== null && s > earliestMin) {
      html += `<div class="grid-disabled" style="top:0; height:${(s - earliestMin) * PIXELS_PER_MINUTE}px;"></div>`;
    }
    if (e !== null && e < latestMin) {
      html += `<div class="grid-disabled" style="top:${(e - earliestMin) * PIXELS_PER_MINUTE}px; height:${(latestMin - e) * PIXELS_PER_MINUTE}px;"></div>`;
    }

    // Render Events
    dailyOverrideSkeleton.filter(ev => ev.division === divName).forEach(ev => {
      const start = parseTimeToMinutes(ev.startTime);
      const end = parseTimeToMinutes(ev.endTime);
      if (start != null && end != null && end > start) {
        const top = (start - earliestMin) * PIXELS_PER_MINUTE;
        const height = (end - start) * PIXELS_PER_MINUTE;
        html += renderEventTile(ev, top, height);
      }
    });

    // Drop preview element
    html += `<div class="drop-preview"></div>`;
    html += `</div>`;
  });

  html += `</div>`;
  gridEl.innerHTML = html;

  // Bind Events
  addDropListeners(gridEl);
  addDragToRepositionListeners(gridEl);
  addResizeListeners(gridEl);
  addRemoveListeners(gridEl);
  
  // Apply conflict highlighting only if rules exist
  applyConflictHighlighting(gridEl);
}

// =================================================================
// RENDER EVENT TILE - EXACT COPY from master_schedule_builder.js
// =================================================================

function renderEventTile(ev, top, height) {
  let tile = TILES.find(t => t.name === ev.event);
  if (!tile && ev.type) tile = TILES.find(t => t.type === ev.type);
  const style = tile ? tile.style : 'background:#eee;border:1px solid #666;';
  
  // Subtract 2px from height to prevent border overlap (1px top + 1px bottom border)
  const adjustedHeight = Math.max(height - 2, 10);
  
  // Determine font size and layout based on available height
  let fontSize, timeSize, layout;
  if (adjustedHeight < 30) {
    // Very small tile - single line, tiny font
    fontSize = '0.65rem';
    timeSize = '0.55rem';
    layout = 'compact';
  } else if (adjustedHeight < 50) {
    // Small tile - compact layout
    fontSize = '0.75rem';
    timeSize = '0.65rem';
    layout = 'small';
  } else {
    // Normal tile
    fontSize = '0.85rem';
    timeSize = '0.75rem';
    layout = 'normal';
  }
  
  // Build content based on layout
  let content;
  const eventName = ev.event || 'Event';
  const timeStr = `${ev.startTime}-${ev.endTime}`;
  
  if (layout === 'compact') {
    // Single line: "Event 12:00-1:00"
    content = `<span style="font-weight:600;">${eventName}</span> <span style="opacity:0.8;font-size:${timeSize};">${timeStr}</span>`;
  } else if (layout === 'small') {
    // Two lines but compact
    content = `<div style="font-weight:600;line-height:1.2;">${eventName}</div><div style="font-size:${timeSize};opacity:0.85;line-height:1.2;">${timeStr}</div>`;
  } else {
    // Normal layout with optional extras
    content = `<div style="font-weight:600;line-height:1.3;">${eventName}</div><div style="font-size:${timeSize};opacity:0.85;">${timeStr}</div>`;
    
    // Show reserved fields if any (only on larger tiles)
    if (ev.reservedFields && ev.reservedFields.length > 0 && adjustedHeight > 60) {
      content += `<div style="font-size:0.65rem;color:#c62828;margin-top:2px;">📍 ${ev.reservedFields.join(', ')}</div>`;
    }
    
    // Smart tile fallback info
    if (ev.type === 'smart' && ev.smartData && adjustedHeight > 70) {
      content += `<div style="font-size:0.7rem;opacity:0.8;margin-top:2px;">F: ${ev.smartData.fallbackActivity}</div>`;
    }
  }

  return `<div class="grid-event" data-id="${ev.id}" draggable="true" title="${eventName} (${timeStr}) - Double-click to remove" 
          style="${style} position:absolute; top:${top}px; height:${adjustedHeight}px; width:96%; left:2%; 
          padding:4px 6px; font-size:${fontSize}; overflow:hidden; border-radius:3px; cursor:pointer; 
          box-sizing:border-box; display:flex; flex-direction:column; justify-content:center; 
          text-overflow:ellipsis; line-height:1.2;">
          <div class="resize-handle resize-handle-top"></div>
          ${content}
          <div class="resize-handle resize-handle-bottom"></div>
          </div>`;
}

// =================================================================
// CONFLICT HIGHLIGHTING - Uses SkeletonSandbox for detection
// =================================================================

function applyConflictHighlighting(gridEl) {
  // Only apply if SkeletonSandbox exists
  if (!window.SkeletonSandbox) {
    console.log("[Conflicts] SkeletonSandbox not loaded");
    return;
  }
  
  // Load rules (this also initializes defaults if none saved)
  window.SkeletonSandbox.loadRules();
  
  // Detect conflicts using the skeleton sandbox
  const conflicts = window.SkeletonSandbox.detectConflicts(dailyOverrideSkeleton);
  
  console.log(`[Conflicts] Detected ${conflicts.length} conflicts in skeleton`);
  
  if (!conflicts || conflicts.length === 0) {
    // Clear any existing conflict highlights
    gridEl.querySelectorAll('.grid-event').forEach(tile => {
      tile.classList.remove('conflict-warn', 'conflict-notice', 'conflict-critical', 'conflict-warning');
    });
    return;
  }
  
  const conflictMap = {};
  conflicts.forEach(c => {
    // Mark both events involved in the conflict
    // Use highest severity if multiple conflicts
    const severity = c.type; // 'warn' or 'notice'
    if (c.event1?.id) {
      if (!conflictMap[c.event1.id] || severity === 'warn') {
        conflictMap[c.event1.id] = severity;
      }
    }
    if (c.event2?.id) {
      if (!conflictMap[c.event2.id] || severity === 'warn') {
        conflictMap[c.event2.id] = severity;
      }
    }
    console.log(`[Conflicts] ${c.type}: ${c.resource} - ${c.event1?.event} (${c.event1?.division}) vs ${c.event2?.event} (${c.event2?.division})`);
  });
  
  // Apply visual highlighting
  gridEl.querySelectorAll('.grid-event').forEach(tile => {
    tile.classList.remove('conflict-warn', 'conflict-notice', 'conflict-critical', 'conflict-warning');
    const id = tile.dataset.id;
    const severity = conflictMap[id];
    if (severity) {
      tile.classList.add(`conflict-${severity}`);
    }
  });
}

window.refreshSkeletonConflicts = function() {
  const grid = document.getElementById('daily-skeleton-grid');
  if (grid) renderGrid(grid);
};

// =================================================================
// RESIZE HANDLES - Top & Bottom
// =================================================================

function addResizeListeners(gridEl) {
  const earliestMin = parseInt(gridEl.dataset.earliestMin, 10) || 540;
  
  // Create tooltip if not exists
  let tooltip = document.getElementById('resize-tooltip');
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.id = 'resize-tooltip';
    document.body.appendChild(tooltip);
  }
  
  gridEl.querySelectorAll('.grid-event').forEach(tile => {
    const topHandle = tile.querySelector('.resize-handle-top');
    const bottomHandle = tile.querySelector('.resize-handle-bottom');
    
    [topHandle, bottomHandle].forEach(handle => {
      if (!handle) return;
      const direction = handle.classList.contains('resize-handle-top') ? 'top' : 'bottom';
      let isResizing = false, startY = 0, startTop = 0, startHeight = 0, eventId = null;
      
      handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        isResizing = true;
        startY = e.clientY;
        startTop = parseInt(tile.style.top, 10);
        startHeight = tile.offsetHeight;
        eventId = tile.dataset.id;
        tile.classList.add('resizing');
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
      });
      
      function onMouseMove(e) {
        if (!isResizing) return;
        const event = dailyOverrideSkeleton.find(ev => ev.id === eventId);
        if (!event) return;
        
        const deltaY = e.clientY - startY;
        let newTop = startTop, newHeight = startHeight;
        
        if (direction === 'bottom') {
          newHeight = Math.max(SNAP_MINS * PIXELS_PER_MINUTE, startHeight + deltaY);
          newHeight = Math.round(newHeight / (SNAP_MINS * PIXELS_PER_MINUTE)) * (SNAP_MINS * PIXELS_PER_MINUTE);
        } else {
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
        const duration = newEndMin - newStartMin;
        const durationStr = duration < 60 ? `${duration}m` : `${Math.floor(duration/60)}h${duration%60 > 0 ? duration%60+'m' : ''}`;
        
        tooltip.innerHTML = `${minutesToTime(newStartMin)} - ${minutesToTime(newEndMin)}<br><span>${durationStr}</span>`;
        tooltip.style.display = 'block';
        tooltip.style.left = (e.clientX + 15) + 'px';
        tooltip.style.top = (e.clientY - 40) + 'px';
      }
      
      function onMouseUp() {
        if (!isResizing) return;
        isResizing = false;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        tile.classList.remove('resizing');
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
        
        event.startTime = minutesToTime(Math.max(divStartMin, Math.round(newStartMin / SNAP_MINS) * SNAP_MINS));
        event.endTime = minutesToTime(Math.min(divEndMin, Math.round(newEndMin / SNAP_MINS) * SNAP_MINS));
        
        saveDailySkeleton();
        renderGrid(gridEl);
      }
      
      handle.addEventListener('dragstart', (e) => { e.preventDefault(); e.stopPropagation(); });
    });
  });
}

// =================================================================
// DRAG TO REPOSITION - Enhanced preview visibility
// =================================================================

function addDragToRepositionListeners(gridEl) {
  const earliestMin = parseInt(gridEl.dataset.earliestMin, 10) || 540;
  
  // Create ghost element if not exists
  let ghost = document.getElementById('drag-ghost');
  if (!ghost) {
    ghost = document.createElement('div');
    ghost.id = 'drag-ghost';
    document.body.appendChild(ghost);
  }
  
  let dragData = null;
  
  gridEl.querySelectorAll('.grid-event').forEach(tile => {
    tile.addEventListener('dragstart', (e) => {
      if (e.target.classList.contains('resize-handle')) { e.preventDefault(); return; }
      
      const eventId = tile.dataset.id;
      const event = dailyOverrideSkeleton.find(ev => ev.id === eventId);
      if (!event) return;
      
      const duration = parseTimeToMinutes(event.endTime) - parseTimeToMinutes(event.startTime);
      dragData = { type: 'move', id: eventId, event, duration };
      
      e.dataTransfer.setData('text/event-move', eventId);
      e.dataTransfer.effectAllowed = 'move';
      
      ghost.innerHTML = `<strong>${event.event}</strong><br><span>${event.startTime} - ${event.endTime}</span>`;
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
      gridEl.querySelectorAll('.drop-preview').forEach(p => { p.style.display = 'none'; p.innerHTML = ''; });
      gridEl.querySelectorAll('.grid-cell').forEach(c => c.style.background = '');
    });
  });
  
  gridEl.querySelectorAll('.grid-cell').forEach(cell => {
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
        preview.innerHTML = `<div class="preview-time-label">${previewStartTime} - ${previewEndTime}</div>`;
      }
    });
    
    cell.addEventListener('dragleave', (e) => {
      if (!cell.contains(e.relatedTarget)) {
        cell.style.background = '';
        if (preview) { preview.style.display = 'none'; preview.innerHTML = ''; }
      }
    });
    
    cell.addEventListener('drop', (e) => {
      cell.style.background = '';
      if (preview) { preview.style.display = 'none'; preview.innerHTML = ''; }
      
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
        event.division = divName;
        event.startTime = minutesToTime(cellStartMin + snapMin);
        event.endTime = minutesToTime(cellStartMin + snapMin + duration);
        
        bumpOverlappingTiles(event, divName);
        saveDailySkeleton();
        renderGrid(gridEl);
        return;
      }
    });
  });
}

// =================================================================
// DROP NEW TILES - EXACT same logic as master_schedule_builder.js
// =================================================================

function addDropListeners(gridEl) {
  gridEl.querySelectorAll('.grid-cell').forEach(cell => {
    cell.ondragover = (e) => {
      if (e.dataTransfer.types.includes('text/event-move')) return;
      e.preventDefault();
      cell.style.background = '#e6fffa';
    };
    cell.ondragleave = () => { cell.style.background = ''; };
    
    cell.ondrop = (e) => {
      if (e.dataTransfer.types.includes('text/event-move')) return;
      e.preventDefault();
      cell.style.background = '';

      let tileData;
      try { tileData = JSON.parse(e.dataTransfer.getData('application/json')); } catch { return; }
      
      const divName = cell.dataset.div;
      const earliestMin = parseInt(cell.dataset.startMin);
      
      // Calc time - EXACT same as master builder
      const rect = cell.getBoundingClientRect();
      const offsetY = e.clientY - rect.top;
      let minOffset = Math.round(offsetY / PIXELS_PER_MINUTE / 15) * 15;
      let startMin = earliestMin + minOffset;
      let endMin = startMin + INCREMENT_MINS;
      const startStr = minutesToTime(startMin);
      const endStr = minutesToTime(endMin);

      let newEvent = null;

      // 1. Smart Tile
      if (tileData.type === 'smart') {
        let st = prompt("Start Time:", startStr); if (!st) return;
        let et = prompt("End Time:", endStr); if (!et) return;
        let mains = prompt("Enter TWO main activities (e.g. Swim / Art):"); if (!mains) return;
        let [m1, m2] = mains.split(/[\/,]/).map(s => s.trim());
        if (!m2) { alert("Need two activities."); return; }
        let fbTarget = prompt(`Which one needs fallback if busy?\n1: ${m1}\n2: ${m2}`); if (!fbTarget) return;
        let fallbackFor = (fbTarget === '1' || fbTarget.toLowerCase() === m1.toLowerCase()) ? m1 : m2;
        let fbAct = prompt(`Fallback activity if ${fallbackFor} is full?`, "Sports");
        newEvent = { id: Date.now().toString(), type: 'smart', event: `${m1} / ${m2}`, division: divName, startTime: st, endTime: et, smartData: { main1: m1, main2: m2, fallbackFor, fallbackActivity: fbAct } };
      }
      // 2. Split Tile
      else if (tileData.type === 'split') {
        let st = prompt("Start Time:", startStr); if (!st) return;
        let et = prompt("End Time:", endStr); if (!et) return;
        let a1 = prompt("Activity 1 (First Half):"); if (!a1) return;
        let a2 = prompt("Activity 2 (Second Half):"); if (!a2) return;
        newEvent = { id: Date.now().toString(), type: 'split', event: `${a1} / ${a2}`, division: divName, startTime: st, endTime: et, subEvents: [{ event: a1 }, { event: a2 }] };
      }
      // 3. Pinned Tiles
      else if (['lunch', 'snacks', 'custom', 'dismissal', 'swim'].includes(tileData.type)) {
        let name = tileData.name;
        let reservedFields = [];
        if (tileData.type === 'custom') {
          name = prompt("Event Name (e.g., 'Special with R. Rosenfeld'):", "Regroup"); if (!name) return;
          reservedFields = promptForReservedFields(name);
        } else if (tileData.type === 'swim') {
          const swimField = (masterSettings.app1.fields || []).find(f => f.name.toLowerCase().includes('swim') || f.name.toLowerCase().includes('pool'));
          if (swimField) reservedFields = [swimField.name];
        }
        let st = prompt(`${name} Start:`, startStr); if (!st) return;
        let et = prompt(`${name} End:`, endStr); if (!et) return;
        newEvent = { id: Date.now().toString(), type: 'pinned', event: name, division: divName, startTime: st, endTime: et, reservedFields };
      }
      // 4. Standard & League Types
      else {
        let name = tileData.name;
        let finalType = tileData.type;
        if (tileData.type === 'activity') { name = "General Activity Slot"; finalType = 'slot'; }
        else if (tileData.type === 'sports') { name = "Sports Slot"; finalType = 'slot'; }
        else if (tileData.type === 'special') { name = "Special Activity"; finalType = 'slot'; }
        else if (tileData.type === 'league') { name = "League Game"; finalType = 'league'; }
        else if (tileData.type === 'specialty_league') { name = "Specialty League"; finalType = 'specialty_league'; }
        if (!name) return;
        if (/league/i.test(name) && finalType === 'slot') finalType = 'league';
        let st = prompt(`${name} Start:`, startStr); if (!st) return;
        let et = prompt(`${name} End:`, endStr); if (!et) return;
        newEvent = { id: Date.now().toString(), type: finalType, event: name, division: divName, startTime: st, endTime: et };
      }

      if (newEvent) {
        // FILTER overlapping events - EXACT same as master builder
        const newStartVal = parseTimeToMinutes(newEvent.startTime);
        const newEndVal = parseTimeToMinutes(newEvent.endTime);
        dailyOverrideSkeleton = dailyOverrideSkeleton.filter(existing => {
          if (existing.division !== divName) return true;
          const exStart = parseTimeToMinutes(existing.startTime);
          const exEnd = parseTimeToMinutes(existing.endTime);
          if (exStart === null || exEnd === null) return true;
          const overlaps = (exStart < newEndVal) && (exEnd > newStartVal);
          return !overlaps;
        });
        dailyOverrideSkeleton.push(newEvent);
        saveDailySkeleton();
        renderGrid(gridEl);
      }
    };
  });
}

function addRemoveListeners(gridEl) {
  gridEl.querySelectorAll('.grid-event').forEach(tile => {
    tile.ondblclick = (e) => {
      e.stopPropagation();
      if (e.target.classList.contains('resize-handle')) return;
      const id = tile.dataset.id;
      if (!id) return;
      if (confirm("Delete this block?")) {
        dailyOverrideSkeleton = dailyOverrideSkeleton.filter(x => x.id !== id);
        saveDailySkeleton();
        renderGrid(gridEl);
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
    window.dailyOverrideSkeleton = dailyOverrideSkeleton; // Expose globally for conflict detection
    return;
  }
  const assignments = masterSettings.app1.skeletonAssignments || {};
  const skeletons = masterSettings.app1.savedSkeletons || {};
  const dateStr = window.currentScheduleDate || "";
  const [Y, M, D] = dateStr.split('-').map(Number);
  let dow = 0;
  if (Y && M && D) dow = new Date(Y, M - 1, D).getDay();
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  let tmpl = assignments[dayNames[dow]] || assignments["Default"];
  dailyOverrideSkeleton = (tmpl && skeletons[tmpl]) ? JSON.parse(JSON.stringify(skeletons[tmpl])) : [];
  window.dailyOverrideSkeleton = dailyOverrideSkeleton; // Expose globally for conflict detection
}

function saveDailySkeleton() {
  window.saveCurrentDailyData?.("manualSkeleton", dailyOverrideSkeleton);
  window.dailyOverrideSkeleton = dailyOverrideSkeleton; // Keep global in sync
}

// EXACT same helper functions as master_schedule_builder.js
function parseTimeToMinutes(str) {
  if (!str) return null;
  let s = str.toLowerCase().replace(/am|pm/g, '').trim();
  let [h, m] = s.split(':').map(Number);
  if (str.toLowerCase().includes('pm') && h !== 12) h += 12;
  if (str.toLowerCase().includes('am') && h === 12) h = 0;
  return h * 60 + (m || 0);
}

function minutesToTime(min) {
  let h = Math.floor(min / 60), m = min % 60, ap = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return `${h}:${m.toString().padStart(2, '0')}${ap}`;
}

function runOptimizer() {
  if (!window.runSkeletonOptimizer) { alert("Error: 'runSkeletonOptimizer' not found."); return; }
  if (dailyOverrideSkeleton.length === 0) { alert("Skeleton is empty."); return; }

  if (window.SkeletonSandbox) {
    let rules = [];
    try { rules = window.SkeletonSandbox.getRules?.() || []; } catch (e) {}
    if (rules && rules.length > 0) {
      const conflicts = window.SkeletonSandbox.detectConflicts(dailyOverrideSkeleton);
      const critical = conflicts.filter(c => c.type === 'critical');
      if (critical.length > 0) {
        const msg = critical.slice(0, 3).map(c => `• ${c.resource}: ${c.event1.division} ↔ ${c.event2.division}`).join('\n');
        if (!confirm(`⚠️ ${critical.length} critical conflict(s)!\n\n${msg}\n\nRun anyway?`)) return;
      }
    }
  }

  saveDailySkeleton();
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
    <style>
      /* EXACT grid styles from master_schedule_builder.js */
      .grid-disabled { position:absolute; width:100%; background-color:#80808040; background-image:linear-gradient(-45deg,#0000001a 25%,transparent 25%,transparent 50%,#0000001a 50%,#0000001a 75%,transparent 75%,transparent); background-size:20px 20px; z-index:1; pointer-events:none; }
      .grid-event { z-index:2; position:relative; box-sizing:border-box; }
      .grid-cell { position:relative; border-right:1px solid #ccc; background:#fff; }
      
      /* Resize handles - subtle until hover */
      .resize-handle { position:absolute; left:0; right:0; height:10px; cursor:ns-resize; z-index:5; opacity:0; transition:opacity 0.15s; }
      .resize-handle-top { top:-2px; }
      .resize-handle-bottom { bottom:-2px; }
      .grid-event:hover .resize-handle { opacity:1; background:rgba(37,99,235,0.3); }
      .grid-event.resizing { box-shadow:0 0 0 2px #2563eb, 0 4px 12px rgba(37,99,235,0.25) !important; z-index:100 !important; }
      
      /* Resize tooltip - matches styles.css theme */
      #resize-tooltip {
        position:fixed; padding:10px 14px; background:#111827; color:#fff;
        border-radius:8px; font-size:0.9em; font-weight:600; pointer-events:none;
        z-index:10002; display:none; box-shadow:0 8px 24px rgba(15,23,42,0.35);
        text-align:center; line-height:1.4;
      }
      #resize-tooltip span { font-size:0.85em; opacity:0.7; }
      
      /* Drag ghost - matches styles.css theme */
      #drag-ghost {
        position:fixed; padding:10px 14px; background:#ffffff; border:2px solid #2563eb;
        border-radius:8px; box-shadow:0 8px 24px rgba(37,99,235,0.25); pointer-events:none;
        z-index:10001; display:none; font-size:0.9em; color:#111827;
      }
      #drag-ghost span { color:#6b7280; }
      
      /* Drop preview - highly visible */
      .drop-preview {
        display:none; position:absolute; left:2%; width:96%;
        background:rgba(37,99,235,0.15); border:2px dashed #2563eb; border-radius:4px;
        pointer-events:none; z-index:5;
      }
      .preview-time-label {
        text-align:center; padding:8px 4px; color:#1d4ed8; font-weight:700;
        font-size:0.9em; background:rgba(255,255,255,0.95); border-radius:3px;
        margin:4px; box-shadow:0 2px 6px rgba(0,0,0,0.1);
      }
      
      /* Conflict styles - Warn (Red) and Notice (Yellow) */
      .conflict-warn, .conflict-critical {
        border:2px solid #dc2626 !important;
        background:#fef2f2 !important;
        box-shadow:0 0 0 2px rgba(220,38,38,0.2), 0 2px 8px rgba(220,38,38,0.15) !important;
      }
      .conflict-warn strong, .conflict-warn > div:first-child,
      .conflict-critical strong, .conflict-critical > div:first-child { color:#991b1b !important; }
      
      .conflict-notice, .conflict-warning {
        border:2px solid #f59e0b !important;
        background:#fffbeb !important;
        box-shadow:0 0 0 2px rgba(245,158,11,0.2), 0 2px 8px rgba(245,158,11,0.15) !important;
      }
      .conflict-notice strong, .conflict-notice > div:first-child,
      .conflict-warning strong, .conflict-warning > div:first-child { color:#92400e !important; }
      
      /* Tab buttons - matches styles.css */
      .da-tab-btn { 
        flex:1; padding:8px 12px; border:1px solid #d1d5db; background:#fff; 
        border-radius:999px; cursor:pointer; font-size:0.85rem; font-weight:500; 
        color:#4b5563; transition:background 0.15s, color 0.15s, border-color 0.15s; 
      }
      .da-tab-btn:hover { background:#f3f4f6; border-color:#9ca3af; }
      .da-tab-btn.active { background:#2563eb; color:#fff; border-color:#2563eb; }
      .da-pane { display:none; }
      .da-pane.active { display:block; }
      
      /* Resource toggles - matches styles.css */
      .resource-toggle-row { 
        display:flex; align-items:center; justify-content:space-between; 
        padding:8px 12px; background:#fff; border:1px solid #e5e7eb; 
        border-radius:8px; margin-bottom:6px; transition:background 0.15s, border-color 0.15s; 
      }
      .resource-toggle-row:hover { background:#f9fafb; border-color:#d1d5db; }
      .resource-toggle-row.disabled-row { background:#fef2f2; border-color:#fecaca; }
      .resource-toggle-row.expanded { border-color:#2563eb; background:#eff6ff; }
      .resource-toggle-name { font-weight:500; flex:1; color:#111827; }
      .resource-toggle-switch { position:relative; width:40px; height:20px; }
      .resource-toggle-switch input { opacity:0; width:0; height:0; }
      .resource-toggle-slider { 
        position:absolute; cursor:pointer; top:0; left:0; right:0; bottom:0; 
        background:#ccc; transition:0.4s; border-radius:20px; 
      }
      .resource-toggle-slider:before { 
        position:absolute; content:""; height:14px; width:14px; left:3px; bottom:3px; 
        background:white; transition:0.4s; border-radius:50%; 
      }
      .resource-toggle-switch input:checked + .resource-toggle-slider { background:#4caf50; }
      .resource-toggle-switch input:checked + .resource-toggle-slider:before { transform:translateX(20px); }
      .field-sports-panel { margin-top:6px; padding:10px; background:#f9fafb; border:1px solid #e5e7eb; border-radius:8px; }
      .field-sport-chip { 
        display:inline-block; padding:4px 10px; margin:2px; border-radius:999px; 
        font-size:0.8em; cursor:pointer; border:1px solid #cbd5e1; background:#f8fafc; 
        transition:all 0.15s; 
      }
      .field-sport-chip.enabled { background:#dcfce7; border-color:#22c55e; color:#166534; }
      .field-sport-chip.disabled { background:#fee2e2; border-color:#ef4444; color:#991b1b; text-decoration:line-through; }
    </style>
    
    <div style="padding:15px;background:#f9f9f9;border:1px solid #ddd;border-radius:8px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
      <div>
        <h2 style="margin:0 0 5px 0;font-size:1.2em;">Daily Adjustments</h2>
        <p style="margin:0;font-size:0.85em;color:#666;">${window.currentScheduleDate} • Drag edges to resize • Double-click to remove</p>
      </div>
      <button id="run-optimizer-btn" style="background:#28a745;color:white;padding:10px 20px;font-size:1em;border:none;border-radius:5px;cursor:pointer;font-weight:bold;">▶ Run Optimizer</button>
    </div>

    <div style="display:flex;gap:5px;margin-bottom:15px;">
      <button class="da-tab-btn active" data-tab="skeleton">Skeleton</button>
      <button class="da-tab-btn" data-tab="trips">Trips</button>
      <button class="da-tab-btn" data-tab="bunk-specific">Bunk Specific</button>
      <button class="da-tab-btn" data-tab="resources">Resources</button>
    </div>

    <div id="da-pane-skeleton" class="da-pane active"></div>
    <div id="da-pane-trips" class="da-pane" style="display:none;"></div>
    <div id="da-pane-bunk-specific" class="da-pane" style="display:none;"></div>
    <div id="da-pane-resources" class="da-pane" style="display:none;"></div>
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

  // Render panes - matching master builder structure
  document.getElementById('da-pane-skeleton').innerHTML = `<div id="override-scheduler-content"></div>`;
  document.getElementById('da-pane-trips').innerHTML = `
    <div style="border:1px solid #ddd;border-radius:8px;padding:15px;background:#fff;">
      <h3 style="margin-top:0;">Add Trip</h3>
      <div id="trips-form-container"></div>
    </div>
  `;
  document.getElementById('da-pane-bunk-specific').innerHTML = `
    <div style="border:1px solid #ddd;border-radius:8px;padding:15px;background:#fff;">
      <h3 style="margin-top:0;">Bunk-Specific Overrides</h3>
      <p style="font-size:0.85em;color:#666;">Assign a specific activity to bunks at a specific time.</p>
      <div id="bunk-overrides-container"></div>
    </div>
  `;
  document.getElementById('da-pane-resources').innerHTML = `
    <div style="border:1px solid #ddd;border-radius:8px;padding:15px;background:#fff;">
      <h3 style="margin-top:0;">Daily Resource Availability</h3>
      <p style="font-size:0.85em;color:#666;">Disable fields, leagues, or activities for this day only.</p>
      <div id="resource-overrides-container"></div>
    </div>
  `;

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
  let optionsHtml = `<option value="">-- Select --</option>`;
  Object.keys(savedSkeletons).sort().forEach(name => { optionsHtml += `<option value="${name}">${name}</option>`; });

  // EXACT same structure as master_schedule_builder.js
  skeletonContainer.innerHTML = `
    <div id="displaced-tiles-panel" style="display:none;"></div>
    <div style="margin-bottom:10px;padding:10px;background:#f4f4f4;border-radius:5px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
      <label>Load Template</label>
      <select id="daily-skeleton-select" style="padding:6px;">${optionsHtml}</select>
      <div style="flex:1;"></div>
      ${window.SkeletonSandbox ? `<button id="conflict-rules-btn" style="padding:6px 12px;background:#fff;border:1px solid #ddd;border-radius:4px;cursor:pointer;">⚙️ Conflict Rules</button>` : ''}
    </div>
    <div id="daily-skeleton-palette" style="padding:10px;background:#f4f4f4;border-radius:8px;margin-bottom:15px;display:flex;flex-wrap:wrap;gap:10px;"></div>
    <div id="scheduler-grid-wrapper" style="overflow-x:auto; border:1px solid #999; background:#fff;">
      <div id="daily-skeleton-grid"></div>
    </div>
  `;

  document.getElementById("daily-skeleton-select").onchange = function() {
    const name = this.value;
    if (name && savedSkeletons[name] && confirm(`Load "${name}"?`)) {
      dailyOverrideSkeleton = JSON.parse(JSON.stringify(savedSkeletons[name]));
      clearDisplacedTiles();
      saveDailySkeleton();
      renderGrid(document.getElementById("daily-skeleton-grid"));
    }
  };

  if (window.SkeletonSandbox) {
    const rulesBtn = document.getElementById("conflict-rules-btn");
    if (rulesBtn) {
      rulesBtn.onclick = () => {
        // Pass the current skeleton and a callback to refresh the grid
        window.SkeletonSandbox.showRulesModal(
          () => { renderGrid(document.getElementById("daily-skeleton-grid")); },
          dailyOverrideSkeleton
        );
      };
    }
  }

  const paletteEl = document.getElementById("daily-skeleton-palette");
  renderPalette(paletteEl);
  renderGrid(document.getElementById("daily-skeleton-grid"));
  renderDisplacedTilesPanel();
}

function renderTripsForm() {
  if (!tripsFormContainer) return;
  const divisions = window.availableDivisions || [];

  tripsFormContainer.innerHTML = `
    <div style="max-width:400px;">
      <p style="color:#666;font-size:0.85em;margin-bottom:15px;">Add an off-campus trip. Overlapping events will be bumped.</p>
      <div style="margin-bottom:10px;"><label>Division</label><br>
        <select id="trip-division-select" style="width:100%;padding:8px;margin-top:4px;">
          <option value="">-- Select --</option>
          ${divisions.map(d => `<option value="${d}">${d}</option>`).join("")}
        </select>
      </div>
      <div style="margin-bottom:10px;"><label>Trip Name</label><br>
        <input id="trip-name-input" type="text" placeholder="e.g. Six Flags" style="width:100%;padding:8px;margin-top:4px;box-sizing:border-box;" />
      </div>
      <div style="display:flex;gap:10px;margin-bottom:15px;">
        <div style="flex:1;"><label>Start</label><br><input id="trip-start-input" type="text" placeholder="10:00am" style="width:100%;padding:8px;margin-top:4px;box-sizing:border-box;" /></div>
        <div style="flex:1;"><label>End</label><br><input id="trip-end-input" type="text" placeholder="3:30pm" style="width:100%;padding:8px;margin-top:4px;box-sizing:border-box;" /></div>
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
    const newEvent = { id: `trip_${Date.now()}`, type: "pinned", event: tripName, division, startTime, endTime, reservedFields: [] };
    eraseOverlappingTiles(newEvent, division);  // ERASE overlapping tiles, don't bump
    dailyOverrideSkeleton.push(newEvent);
    saveDailySkeleton();

    renderGrid(document.getElementById("daily-skeleton-grid"));
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
      <div style="margin-bottom:10px;"><label>Type</label><br>
        <select id="bo-type" style="width:100%;padding:8px;margin-top:4px;">
          <option value="">-- Select --</option>
          <option value="sport">Sport</option>
          <option value="special">Special Activity</option>
          <option value="trip">Personal Trip</option>
        </select>
      </div>
      <div id="bo-activity-wrap" style="margin-bottom:10px;display:none;"><label>Activity</label><br>
        <select id="bo-activity" style="width:100%;padding:8px;margin-top:4px;"></select>
      </div>
      <div id="bo-trip-wrap" style="margin-bottom:10px;display:none;"><label>Trip Name</label><br>
        <input id="bo-trip-name" type="text" placeholder="e.g. Doctor" style="width:100%;padding:8px;margin-top:4px;box-sizing:border-box;">
      </div>
      <div style="display:flex;gap:10px;margin-bottom:10px;">
        <div style="flex:1;"><label>Start</label><br><input id="bo-start" type="text" placeholder="10:00am" style="width:100%;padding:8px;margin-top:4px;box-sizing:border-box;"></div>
        <div style="flex:1;"><label>End</label><br><input id="bo-end" type="text" placeholder="11:00am" style="width:100%;padding:8px;margin-top:4px;box-sizing:border-box;"></div>
      </div>
      <div style="margin-bottom:15px;"><label>Select Bunks</label>
        <div id="bo-bunks" style="display:flex;flex-wrap:wrap;gap:6px;max-height:140px;overflow-y:auto;padding:8px;border:1px solid #ddd;border-radius:8px;background:#f9f9f9;margin-top:6px;">
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

    // Create ONE override per bunk (scheduler expects override.bunk to be singular)
    selectedBunks.forEach(bunkName => {
      currentOverrides.bunkActivityOverrides.push({ 
        id: `bunk_${Date.now()}_${bunkName}`, 
        type, 
        activity: activityName, 
        bunk: bunkName,  // SINGULAR - required by scheduler_core_main.js
        bunks: [bunkName],  // Keep for display purposes
        startTime, 
        endTime 
      });
    });
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

  // Group overrides by activity+time for cleaner display
  const grouped = {};
  currentOverrides.bunkActivityOverrides.forEach((o, i) => {
    const key = `${o.activity}|${o.startTime}|${o.endTime}|${o.type}`;
    if (!grouped[key]) {
      grouped[key] = { ...o, bunks: [], indices: [] };
    }
    // Handle both old format (bunks array) and new format (bunk singular)
    if (o.bunk) {
      grouped[key].bunks.push(o.bunk);
    } else if (o.bunks && Array.isArray(o.bunks)) {
      grouped[key].bunks.push(...o.bunks);
    }
    grouped[key].indices.push(i);
  });

  cont.innerHTML = `
    <h4 style="margin:0 0 10px 0;">Existing Overrides</h4>
    ${Object.values(grouped).map(o => `
      <div style="background:#f9f9f9;padding:10px;border-radius:8px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;border:1px solid #e5e7eb;">
        <div><strong>${o.activity}</strong> (${o.type})<br><span style="font-size:0.85em;color:#666;">${o.bunks.join(', ')} • ${o.startTime}-${o.endTime}</span></div>
        <button class="remove-bo-btn" data-indices="${o.indices.join(',')}" style="background:#dc3545;color:white;border:none;width:28px;height:28px;border-radius:4px;cursor:pointer;">×</button>
      </div>
    `).join('')}
  `;

  cont.querySelectorAll('.remove-bo-btn').forEach(btn => {
    btn.onclick = () => {
      const indices = btn.dataset.indices.split(',').map(Number).sort((a,b) => b - a);
      // Remove from highest index first to preserve lower indices
      indices.forEach(idx => {
        currentOverrides.bunkActivityOverrides.splice(idx, 1);
      });
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
          <span style="color:#9ca3af;font-size:0.8em;transition:transform 0.15s;transform:rotate(${isExpanded ? '90deg' : '0deg'});">▶</span>
          <span class="resource-toggle-name">${item.name}</span>
        </div>
        <label class="resource-toggle-switch" onclick="event.stopPropagation()">
          <input type="checkbox" ${!isDisabled ? 'checked' : ''}>
          <span class="resource-toggle-slider"></span>
        </label>
      </div>
      ${isExpanded ? `
        <div class="field-sports-panel">
          <div style="font-size:0.8em;font-weight:500;color:#6b7280;margin-bottom:6px;">Sports:</div>
          ${(item.activities || []).length === 0 ? '<span style="color:#9ca3af;font-size:0.8em;">None</span>' : 
            (item.activities || []).map(sport => {
              const disabledSports = currentOverrides.dailyDisabledSportsByField[item.name] || [];
              return `<span class="field-sport-chip ${disabledSports.includes(sport) ? 'disabled' : 'enabled'}" data-field="${item.name}" data-sport="${sport}">${sport}</span>`;
            }).join('')}
        </div>
      ` : ''}
    `;
    
    wrapper.querySelector('input[type="checkbox"]').onchange = function() {
      if (this.checked) currentOverrides.disabledFields = currentOverrides.disabledFields.filter(n => n !== item.name);
      else if (!currentOverrides.disabledFields.includes(item.name)) currentOverrides.disabledFields.push(item.name);
      saveOverrides();
      renderResourceOverridesUI();
    };
    
    wrapper.querySelector('.field-name-area').onclick = () => {
      expandedField = expandedField === item.name ? null : item.name;
      renderResourceOverridesUI();
    };
    
    wrapper.querySelectorAll('.field-sport-chip').forEach(chip => {
      chip.onclick = () => {
        const fieldName = chip.dataset.field, sportName = chip.dataset.sport;
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
  wrapper.querySelector('input[type="checkbox"]').onchange = function() { onToggle(this.checked); };
  return wrapper;
}

window.initDailyAdjustments = init;
window.parseTimeToMinutes = parseTimeToMinutes;
window.minutesToTime = minutesToTime;

})();
