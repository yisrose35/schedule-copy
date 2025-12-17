// =================================================================
// daily_adjustments.js  (COMBINED - SANDBOX MODE)
// 
// Features:
// - Drag tiles to reposition (BUMPS other tiles down, doesn't delete)
// - Displaced tiles tracker shows what got moved/removed
// - Real-time conflict detection with configurable rules
// - Streamlined trip form with instant feedback
// - Enhanced bunk-specific overrides
// - Field reservation for pinned events
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
let displacedTiles = []; // { event, reason, originalStart, originalEnd }

// --- Smart Tile history ---
let smartTileHistory = null;
const SMART_TILE_HISTORY_KEY = "smartTileHistory_v1";

function loadSmartTileHistory() {
  try {
    if (!window.localStorage) return { byBunk: {} };
    const raw = localStorage.getItem(SMART_TILE_HISTORY_KEY);
    if (!raw) return { byBunk: {} };
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? { byBunk: parsed.byBunk || {} } : { byBunk: {} };
  } catch (e) {
    return { byBunk: {} };
  }
}

function saveSmartTileHistory(history) {
  try {
    if (window.localStorage) {
      localStorage.setItem(SMART_TILE_HISTORY_KEY, JSON.stringify(history || { byBunk: {} }));
    }
  } catch (e) {}
}

// --- Helper containers ---
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

const TILES = [
  { type: 'activity', name: 'Activity', style: 'background:#e0f7fa;border:1px solid #007bff;', description: 'Flexible slot (Sport or Special).' },
  { type: 'sports', name: 'Sports', style: 'background:#dcedc8;border:1px solid #689f38;', description: 'Sports slot only.' },
  { type: 'special', name: 'Special Activity', style: 'background:#e8f5e9;border:1px solid #43a047;', description: 'Special Activity slot only.' },
  { type: 'smart', name: 'Smart Tile', style: 'background:#e3f2fd;border:2px dashed #0288d1;color:#01579b;', description: 'Balances 2 activities with fallback.' },
  { type: 'split', name: 'Split Activity', style: 'background:#fff3e0;border:1px solid #f57c00;', description: 'Two activities share the block.' },
  { type: 'league', name: 'League Game', style: 'background:#d1c4e9;border:1px solid #5e35b1;', description: 'Regular League slot.' },
  { type: 'specialty_league', name: 'Specialty League', style: 'background:#fff8e1;border:1px solid #f9a825;', description: 'Specialty League slot.' },
  { type: 'swim', name: 'Swim', style: 'background:#bbdefb;border:1px solid #1976d2;', description: 'Pinned.' },
  { type: 'lunch', name: 'Lunch', style: 'background:#fbe9e7;border:1px solid #d84315;', description: 'Pinned.' },
  { type: 'snacks', name: 'Snacks', style: 'background:#fff9c4;border:1px solid #fbc02d;', description: 'Pinned.' },
  { type: 'dismissal', name: 'Dismissal', style: 'background:#f44336;color:white;border:1px solid #b71c1c;', description: 'Pinned.' },
  { type: 'custom', name: 'Custom Pinned Event', style: 'background:#eee;border:1px solid #616161;', description: 'Pinned custom event.' }
];

// =================================================================
// UTILITY FUNCTIONS
// =================================================================

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
  
  requested.forEach(name => {
    const match = allLocations.find(loc => loc.toLowerCase() === name.toLowerCase());
    if (match) validated.push(match);
  });
  
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
        <button id="clear-displaced-btn" style="background:#fff;border:1px solid #ffb300;color:#e65100;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:0.8em;">Clear</button>
      </div>
      <div style="max-height:150px;overflow-y:auto;">
        ${displacedTiles.map((d, i) => `
          <div style="background:#fff;padding:6px 8px;margin-bottom:4px;border-radius:4px;font-size:0.85em;display:flex;justify-content:space-between;">
            <span><strong>${d.event}</strong> (${d.division})</span>
            <span style="color:#666;">${d.originalStart} - ${d.originalEnd} • ${d.reason}</span>
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

function bumpOverlappingTiles(skeleton, newEvent, divName) {
  const newStartMin = parseTimeToMinutes(newEvent.startTime);
  const newEndMin = parseTimeToMinutes(newEvent.endTime);
  const bumpedEvents = [];
  
  // Get division end time for boundary check
  const div = window.divisions?.[divName] || {};
  const divEndMin = parseTimeToMinutes(div.endTime) || 960; // Default 4pm
  
  // Find all overlapping events in this division
  const overlapping = skeleton.filter(ev => {
    if (ev.id === newEvent.id) return false;
    if (ev.division !== divName) return false;
    
    const evStart = parseTimeToMinutes(ev.startTime);
    const evEnd = parseTimeToMinutes(ev.endTime);
    if (evStart == null || evEnd == null) return false;
    
    return (evStart < newEndMin && evEnd > newStartMin);
  });
  
  if (overlapping.length === 0) return { skeleton, bumped: [] };
  
  // Sort by start time
  overlapping.sort((a, b) => parseTimeToMinutes(a.startTime) - parseTimeToMinutes(b.startTime));
  
  // Calculate how much to bump
  let currentEndMin = newEndMin;
  
  overlapping.forEach(ev => {
    const evStart = parseTimeToMinutes(ev.startTime);
    const evEnd = parseTimeToMinutes(ev.endTime);
    const duration = evEnd - evStart;
    
    // Store original times
    const originalStart = ev.startTime;
    const originalEnd = ev.endTime;
    
    // New start is after the current block ends
    const newStart = currentEndMin;
    const newEnd = newStart + duration;
    
    // Check if it fits within division time
    if (newEnd > divEndMin) {
      // Can't fit - mark as removed
      addDisplacedTile(ev, 'No room');
      skeleton = skeleton.filter(e => e.id !== ev.id);
    } else {
      // Bump it down
      ev.startTime = minutesToTime(newStart);
      ev.endTime = minutesToTime(newEnd);
      bumpedEvents.push({ event: ev, originalStart, originalEnd });
      currentEndMin = newEnd;
    }
  });
  
  // Now check if bumped events caused new overlaps (chain reaction)
  bumpedEvents.forEach(({ event }) => {
    const result = bumpOverlappingTiles(skeleton, event, divName);
    skeleton = result.skeleton;
  });
  
  return { skeleton, bumped: bumpedEvents };
}

// =================================================================
// RENDER FUNCTIONS
// =================================================================

function renderPalette(paletteContainer) {
  paletteContainer.innerHTML = '<span style="font-weight:600;align-self:center;">Drag tiles:</span>';
  TILES.forEach(tile => {
    const el = document.createElement('div');
    el.className = 'grid-tile-draggable';
    el.textContent = tile.name;
    el.style.cssText = tile.style + 'padding:8px 12px;border-radius:5px;cursor:grab;';
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

  let earliestMin = null, latestMin = null;
  Object.values(divisions).forEach(div => {
    const s = parseTimeToMinutes(div.startTime);
    const e = parseTimeToMinutes(div.endTime);
    if (s !== null && (earliestMin === null || s < earliestMin)) earliestMin = s;
    if (e !== null && (latestMin === null || e > latestMin)) latestMin = e;
  });
  if (earliestMin === null) earliestMin = 540;
  if (latestMin === null) latestMin = 960;

  const latestPinnedEnd = Math.max(-Infinity, ...dailyOverrideSkeleton.filter(ev => ev?.type === 'pinned').map(ev => parseTimeToMinutes(ev.endTime) ?? -Infinity));
  if (Number.isFinite(latestPinnedEnd)) latestMin = Math.max(latestMin, latestPinnedEnd);
  if (latestMin <= earliestMin) latestMin = earliestMin + 60;

  const totalMinutes = latestMin - earliestMin;
  const totalHeight = totalMinutes * PIXELS_PER_MINUTE;
  
  gridContainer.dataset.earliestMin = earliestMin;

  let gridHtml = `<div style="display:grid;grid-template-columns:60px repeat(${availableDivisions.length},1fr);position:relative;">`;
  gridHtml += `<div style="grid-row:1;position:sticky;top:0;background:#fff;z-index:10;border-bottom:1px solid #999;padding:8px;">Time</div>`;

  availableDivisions.forEach((divName, i) => {
    gridHtml += `<div style="grid-row:1;grid-column:${i + 2};position:sticky;top:0;background:${divisions[divName]?.color || '#333'};color:#fff;z-index:10;border-bottom:1px solid #999;padding:8px;text-align:center;">${divName}</div>`;
  });

  gridHtml += `<div style="grid-row:2;grid-column:1;height:${totalHeight}px;position:relative;background:#f9f9f9;border-right:1px solid #ccc;">`;
  for (let min = earliestMin; min < latestMin; min += INCREMENT_MINS) {
    const top = (min - earliestMin) * PIXELS_PER_MINUTE;
    gridHtml += `<div style="position:absolute;top:${top}px;left:0;width:100%;height:${INCREMENT_MINS * PIXELS_PER_MINUTE}px;border-bottom:1px dashed #ddd;box-sizing:border-box;font-size:10px;padding:2px;color:#777;">${minutesToTime(min)}</div>`;
  }
  gridHtml += `</div>`;

  availableDivisions.forEach((divName, i) => {
    const div = divisions[divName];
    const divStartMin = parseTimeToMinutes(div?.startTime);
    const divEndMin = parseTimeToMinutes(div?.endTime);

    gridHtml += `<div class="grid-cell" data-div="${divName}" data-start-min="${earliestMin}" style="grid-row:2;grid-column:${i + 2};position:relative;height:${totalHeight}px;border-right:1px solid #ccc;">`;

    if (divStartMin !== null && divStartMin > earliestMin) {
      gridHtml += `<div class="grid-disabled" style="top:0;height:${(divStartMin - earliestMin) * PIXELS_PER_MINUTE}px;"></div>`;
    }
    if (divEndMin !== null && divEndMin < latestMin) {
      gridHtml += `<div class="grid-disabled" style="top:${(divEndMin - earliestMin) * PIXELS_PER_MINUTE}px;height:${(latestMin - divEndMin) * PIXELS_PER_MINUTE}px;"></div>`;
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

    gridHtml += `</div>`;
  });

  gridHtml += `</div>`;
  gridContainer.innerHTML = gridHtml;
  
  addDropListeners(gridContainer);
  addDragToRepositionListeners(gridContainer);
  addRemoveListeners(gridContainer);
  applyConflictHighlighting(gridContainer);
  
  if (window.SkeletonSandbox) {
    window.SkeletonSandbox.renderConflictBanner('#override-scheduler-content', dailyOverrideSkeleton);
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
    else tile = TILES.find(t => t.type === 'custom');
  }
  
  const style = tile ? tile.style : 'background:#eee;border:1px solid #616161;';
  let tripStyle = '';
  if (event.type === 'pinned' && tile?.type === 'custom') {
    tripStyle = 'background:#455a64;color:white;border:1px solid #000;';
  }

  let innerHtml = `<strong>${event.event}</strong><br><span style="font-size:.85em;">${event.startTime} - ${event.endTime}</span>`;
  
  if (event.reservedFields?.length > 0) {
    innerHtml += `<div style="font-size:0.7em;color:#c62828;margin-top:2px;">📍 ${event.reservedFields.join(', ')}</div>`;
  }
  
  if (event.type === 'smart' && event.smartData) {
    innerHtml += `<div style="font-size:0.7em;margin-top:2px;opacity:0.8;">↳ ${event.smartData.fallbackActivity}</div>`;
  }

  return `
    <div class="grid-event" data-event-id="${event.id}" title="Drag to move • Double-click to remove"
         style="${tripStyle || style}padding:4px 6px;border-radius:4px;text-align:center;margin:0 1px;font-size:.85em;position:absolute;top:${top}px;height:${height}px;width:calc(100% - 4px);box-sizing:border-box;overflow:hidden;">
      ${innerHtml}
    </div>`;
}

// =================================================================
// DRAG TO REPOSITION (with BUMP logic)
// =================================================================

function addDragToRepositionListeners(gridContainer) {
  const earliestMin = parseInt(gridContainer.dataset.earliestMin, 10) || 540;
  
  gridContainer.querySelectorAll('.grid-event').forEach(tile => {
    tile.draggable = true;
    tile.style.cursor = 'grab';
    
    tile.ondragstart = (e) => {
      e.dataTransfer.setData('text/event-move', tile.dataset.eventId);
      e.dataTransfer.effectAllowed = 'move';
      tile.classList.add('dragging');
    };
    
    tile.ondragend = () => tile.classList.remove('dragging');
  });
  
  gridContainer.querySelectorAll('.grid-cell').forEach(cell => {
    const existingDragOver = cell.ondragover;
    const existingDrop = cell.ondrop;
    
    cell.ondragover = (e) => {
      if (e.dataTransfer.types.includes('text/event-move')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        cell.classList.add('drag-over');
        return;
      }
      if (existingDragOver) existingDragOver.call(cell, e);
    };
    
    cell.ondragleave = () => cell.classList.remove('drag-over');
    
    cell.ondrop = (e) => {
      cell.classList.remove('drag-over');
      
      if (e.dataTransfer.types.includes('text/event-move')) {
        e.preventDefault();
        const eventId = e.dataTransfer.getData('text/event-move');
        const event = dailyOverrideSkeleton.find(ev => ev.id === eventId);
        if (!event) return;
        
        const divName = cell.dataset.div;
        const cellStartMin = parseInt(cell.dataset.startMin, 10);
        
        const rect = cell.getBoundingClientRect();
        const y = e.clientY - rect.top + (gridContainer.scrollTop || 0);
        const droppedMin = Math.round(y / PIXELS_PER_MINUTE / 15) * 15;
        
        const newStartMin = cellStartMin + droppedMin;
        const duration = parseTimeToMinutes(event.endTime) - parseTimeToMinutes(event.startTime);
        const newEndMin = newStartMin + duration;
        
        // Update event position
        event.division = divName;
        event.startTime = minutesToTime(newStartMin);
        event.endTime = minutesToTime(newEndMin);
        
        // BUMP overlapping tiles instead of deleting
        const result = bumpOverlappingTiles(dailyOverrideSkeleton, event, divName);
        dailyOverrideSkeleton = result.skeleton;
        
        saveDailySkeleton();
        renderGrid(gridContainer);
        return;
      }
      
      if (existingDrop) existingDrop.call(cell, e);
    };
  });
}

function applyConflictHighlighting(gridContainer) {
  if (!window.SkeletonSandbox) return;
  
  const conflicts = window.SkeletonSandbox.detectConflicts(dailyOverrideSkeleton);
  const conflictTypeMap = {};
  
  conflicts.forEach(c => {
    if (c.event1?.id && (!conflictTypeMap[c.event1.id] || c.type === 'critical')) conflictTypeMap[c.event1.id] = c.type;
    if (c.event2?.id && (!conflictTypeMap[c.event2.id] || c.type === 'critical')) conflictTypeMap[c.event2.id] = c.type;
  });
  
  gridContainer.querySelectorAll('.grid-event').forEach(tile => {
    tile.classList.remove('conflict-critical', 'conflict-warning');
    if (conflictTypeMap[tile.dataset.eventId]) {
      tile.classList.add(`conflict-${conflictTypeMap[tile.dataset.eventId]}`);
    }
  });
}

window.refreshSkeletonConflicts = function() {
  const grid = document.getElementById('daily-skeleton-grid');
  if (grid) renderGrid(grid);
};

// =================================================================
// DROP NEW TILES (with BUMP logic)
// =================================================================

function addDropListeners(gridContainer) {
  gridContainer.querySelectorAll('.grid-cell').forEach(cell => {
    cell.ondragover = (e) => {
      if (e.dataTransfer.types.includes('text/event-move')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      cell.style.backgroundColor = '#e0ffe0';
    };
    
    cell.ondragleave = () => { cell.style.backgroundColor = ''; };
    
    cell.ondrop = (e) => {
      if (e.dataTransfer.types.includes('text/event-move')) return;
      
      e.preventDefault();
      cell.style.backgroundColor = '';

      let tileData;
      try { tileData = JSON.parse(e.dataTransfer.getData('application/json')); } catch { return; }
      
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

      const validateTime = (timeStr, isStart) => {
        const timeMin = parseTimeToMinutes(timeStr);
        if (timeMin === null) { alert("Invalid time format."); return null; }
        if (divStartMin !== null && timeMin < divStartMin) { alert(`Before division start.`); return null; }
        if (divEndMin !== null && (isStart ? timeMin >= divEndMin : timeMin > divEndMin)) { alert(`After division end.`); return null; }
        return timeMin;
      };

      let newEvent = null;

      // Handle different tile types (simplified - keeping original logic)
      if (tileData.type === 'split') {
        let startTime = prompt(`Split block start:`, defaultStartTime); if (!startTime) return;
        let endTime = prompt(`Split block end:`); if (!endTime) return;
        const name1 = prompt("First activity:"); if (!name1) return;
        const name2 = prompt("Second activity:"); if (!name2) return;
        newEvent = { id: `evt_${Math.random().toString(36).slice(2,9)}`, type: 'split', event: `${name1} / ${name2}`, division: divName, startTime, endTime, subEvents: [{type:'slot',event:name1},{type:'slot',event:name2}] };
        
      } else if (tileData.type === 'smart') {
        let startTime = prompt(`Smart Tile start:`, defaultStartTime); if (!startTime) return;
        let endTime = prompt(`Smart Tile end:`); if (!endTime) return;
        const rawMains = prompt("Two main activities (e.g., Swim / Special):"); if (!rawMains) return;
        const mains = rawMains.split(/,|\//).map(s => s.trim()).filter(Boolean);
        if (mains.length < 2) { alert("Need 2 activities."); return; }
        const [main1, main2] = mains;
        const pick = prompt(`Which needs fallback?\n1: ${main1}\n2: ${main2}`); if (!pick) return;
        const fallbackFor = pick.trim() === "1" ? main1 : main2;
        const fallbackActivity = prompt(`Fallback if "${fallbackFor}" unavailable:`); if (!fallbackActivity) return;
        newEvent = { id: `evt_${Math.random().toString(36).slice(2,9)}`, type: 'smart', event: `${main1} / ${main2}`, division: divName, startTime, endTime, smartData: {main1,main2,fallbackFor,fallbackActivity} };
        
      } else if (tileData.type === 'league') {
        let startTime = prompt(`League start:`, defaultStartTime); if (!startTime) return;
        let endTime = prompt(`League end:`); if (!endTime) return;
        newEvent = { id: `evt_${Math.random().toString(36).slice(2,9)}`, type: 'league', event: 'League Game', division: divName, startTime, endTime };
        
      } else if (tileData.type === 'specialty_league') {
        let startTime = prompt(`Specialty League start:`, defaultStartTime); if (!startTime) return;
        let endTime = prompt(`Specialty League end:`); if (!endTime) return;
        newEvent = { id: `evt_${Math.random().toString(36).slice(2,9)}`, type: 'specialty_league', event: 'Specialty League', division: divName, startTime, endTime };
        
      } else if (['lunch','snacks','custom','dismissal','swim'].includes(tileData.type)) {
        let eventName = tileData.name;
        let reservedFields = [];
        
        if (tileData.type === 'custom') {
          eventName = prompt("Custom event name:"); if (!eventName) return;
          reservedFields = promptForReservedFields(eventName);
        } else if (tileData.type === 'swim') {
          const swimField = (masterSettings.app1.fields || []).find(f => f.name.toLowerCase().includes('swim') || f.name.toLowerCase().includes('pool'));
          if (swimField) reservedFields = [swimField.name];
        }
        
        let startTime = prompt(`${eventName} start:`, defaultStartTime); if (!startTime) return;
        let endTime = prompt(`${eventName} end:`); if (!endTime) return;
        newEvent = { id: `evt_${Math.random().toString(36).slice(2,9)}`, type: 'pinned', event: eventName, division: divName, startTime, endTime, reservedFields };
        
      } else {
        // Standard slots
        let eventName = tileData.type === 'activity' ? 'General Activity Slot' : tileData.type === 'sports' ? 'Sports Slot' : tileData.type === 'special' ? 'Special Activity' : tileData.name;
        let startTime = prompt(`${eventName} start:`, defaultStartTime); if (!startTime) return;
        let endTime = prompt(`${eventName} end:`); if (!endTime) return;
        newEvent = { id: `evt_${Math.random().toString(36).slice(2,9)}`, type: 'slot', event: eventName, division: divName, startTime, endTime };
      }

      if (newEvent) {
        // BUMP overlapping tiles instead of deleting
        dailyOverrideSkeleton.push(newEvent);
        const result = bumpOverlappingTiles(dailyOverrideSkeleton, newEvent, divName);
        dailyOverrideSkeleton = result.skeleton;
        
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
      const event = dailyOverrideSkeleton.find(ev => ev.id === tile.dataset.eventId);
      if (event && confirm(`Remove "${event.event}"?`)) {
        dailyOverrideSkeleton = dailyOverrideSkeleton.filter(ev => ev.id !== tile.dataset.eventId);
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
  if (dailyData.manualSkeleton?.length > 0) {
    dailyOverrideSkeleton = JSON.parse(JSON.stringify(dailyData.manualSkeleton));
    return;
  }

  const assignments = masterSettings.app1.skeletonAssignments || {};
  const skeletons = masterSettings.app1.savedSkeletons || {};
  const dateStr = window.currentScheduleDate || "";
  const [year, month, day] = dateStr.split('-').map(Number);
  let dayOfWeek = 0;
  if (year && month && day) dayOfWeek = new Date(year, month - 1, day).getDay();
  const dayNames = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

  let templateName = assignments[dayNames[dayOfWeek]] || assignments["Default"];
  const skeletonToLoad = skeletons[templateName];
  dailyOverrideSkeleton = skeletonToLoad ? JSON.parse(JSON.stringify(skeletonToLoad)) : [];
}

function saveDailySkeleton() {
  window.saveCurrentDailyData?.("manualSkeleton", dailyOverrideSkeleton);
}

// =================================================================
// RUN OPTIMIZER
// =================================================================

function runOptimizer() {
  if (!window.runSkeletonOptimizer) { alert("Optimizer not found."); return; }
  if (dailyOverrideSkeleton.length === 0) { alert("Skeleton empty."); return; }

  if (window.SkeletonSandbox) {
    const conflicts = window.SkeletonSandbox.detectConflicts(dailyOverrideSkeleton);
    const critical = conflicts.filter(c => c.type === 'critical');
    if (critical.length > 0) {
      const msg = critical.slice(0,3).map(c => `• ${c.resource}: ${c.event1.division} ↔ ${c.event2.division}`).join('\n');
      if (!confirm(`⚠️ ${critical.length} conflict(s)!\n\n${msg}\n\nRun anyway?`)) return;
    }
  }

  saveDailySkeleton();
  const success = window.runSkeletonOptimizer(dailyOverrideSkeleton, currentOverrides);
  if (success) { alert("Schedule Generated!"); window.showTab?.('schedule'); }
  else { alert("Error. Check console."); }
}

// =================================================================
// INIT UI
// =================================================================

function init() {
  container = document.getElementById("daily-adjustments-content");
  if (!container) return;

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
    <div style="padding:10px 15px;background:#fff;border:1px solid #ddd;border-radius:8px;margin-bottom:15px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
      <div>
        <h2 style="margin:0 0 4px 0;">Daily Adjustments — ${window.currentScheduleDate}</h2>
        <p style="margin:0;font-size:0.85em;color:#666;">Drag tiles to reposition (bumps others down) • Double-click to remove</p>
      </div>
      <button id="run-optimizer-btn" style="background:#28a745;color:white;padding:12px 20px;font-size:1.1em;border:none;border-radius:5px;cursor:pointer;font-weight:600;">▶ Run Optimizer</button>
    </div>

    <div class="da-tabs-nav league-nav">
      <button class="tab-button active" data-tab="skeleton">Skeleton</button>
      <button class="tab-button" data-tab="trips">Add Trip</button>
      <button class="tab-button" data-tab="bunk-specific">Bunk Specific</button>
      <button class="tab-button" data-tab="resources">Resources</button>
    </div>

    <div id="da-pane-skeleton" class="da-tab-pane league-content-pane active">
      <div id="override-scheduler-content"></div>
    </div>

    <div id="da-pane-trips" class="da-tab-pane league-content-pane">
      <div id="trips-form-container" style="padding:10px;"></div>
    </div>

    <div id="da-pane-bunk-specific" class="da-tab-pane league-content-pane">
      <div id="bunk-overrides-container" style="padding:10px;"></div>
    </div>

    <div id="da-pane-resources" class="da-tab-pane league-content-pane">
      <div id="resource-overrides-container" style="padding:10px;"></div>
    </div>

    <style>
      .grid-disabled{position:absolute;width:100%;background-color:#80808040;background-image:linear-gradient(-45deg,#0000001a 25%,transparent 25%,transparent 50%,#0000001a 50%,#0000001a 75%,transparent 75%,transparent);background-size:20px 20px;z-index:1;pointer-events:none;}
      .grid-event{z-index:2;position:relative;transition:transform 0.15s,box-shadow 0.15s;}
      .grid-event:hover{transform:scale(1.02);z-index:10!important;}
      .grid-event.dragging{opacity:0.5;transform:scale(1.05);box-shadow:0 8px 20px rgba(0,0,0,0.3)!important;z-index:100!important;}
      .grid-cell.drag-over{background:rgba(37,99,235,0.15)!important;outline:2px dashed #2563eb;}
      @keyframes pulse{0%,100%{box-shadow:0 0 0 0 rgba(239,83,80,0.5);}50%{box-shadow:0 0 0 8px rgba(239,83,80,0);}}
      @keyframes pulseWarn{0%,100%{box-shadow:0 0 0 0 rgba(255,179,0,0.5);}50%{box-shadow:0 0 0 8px rgba(255,179,0,0);}}
      .grid-event.conflict-critical{animation:pulse 1.5s infinite;border:3px solid #ef5350!important;background:linear-gradient(135deg,#ffebee,#ffcdd2)!important;}
      .grid-event.conflict-warning{animation:pulseWarn 2s infinite;border:3px solid #ffb300!important;background:linear-gradient(135deg,#fff8e1,#ffecb3)!important;}
      .master-list .list-item{padding:10px 8px;border:1px solid #ddd;border-radius:5px;margin-bottom:3px;cursor:pointer;background:#fff;display:flex;justify-content:space-between;align-items:center;}
      .master-list .list-item:hover{background:#f9f9f9;}
      .bunk-chip{padding:6px 12px;border:2px solid #ccc;background:white;border-radius:20px;cursor:pointer;font-size:0.85em;transition:all 0.15s;}
      .bunk-chip.selected{color:white;}
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

function initDailySkeletonUI() {
  if (!skeletonContainer) return;
  loadDailySkeleton();

  const savedSkeletons = masterSettings.app1.savedSkeletons || {};
  let optionsHtml = `<option value="">-- Load Skeleton --</option>`;
  Object.keys(savedSkeletons).sort().forEach(name => { optionsHtml += `<option value="${name}">${name}</option>`; });

  skeletonContainer.innerHTML = `
    <div id="displaced-tiles-panel" style="display:none;"></div>
    <div style="margin-bottom:12px;padding:10px;background:#f8f9fa;border:1px solid #e9ecef;border-radius:6px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
      <select id="daily-skeleton-select" style="padding:8px;border-radius:4px;border:1px solid #ccc;">${optionsHtml}</select>
      <button id="daily-skeleton-load-btn" style="padding:8px 14px;background:#0277bd;color:white;border:none;border-radius:4px;cursor:pointer;">Load</button>
      <span style="flex-grow:1;"></span>
      <button id="conflict-rules-btn" style="padding:8px 14px;background:#f5f5f5;border:1px solid #ccc;border-radius:4px;cursor:pointer;" title="Configure conflict rules">⚙️ Rules</button>
    </div>
    <div id="daily-skeleton-palette" style="padding:10px;background:#f4f4f4;border-radius:8px;margin-bottom:12px;display:flex;flex-wrap:wrap;gap:8px;"></div>
    <div id="daily-skeleton-grid" style="overflow-x:auto;border:1px solid #999;max-height:550px;overflow-y:auto;border-radius:4px;"></div>
  `;

  document.getElementById("daily-skeleton-load-btn").onclick = () => {
    const name = document.getElementById("daily-skeleton-select").value;
    if (!name) return;
    if (confirm(`Load "${name}"?`)) {
      dailyOverrideSkeleton = JSON.parse(JSON.stringify(savedSkeletons[name]));
      clearDisplacedTiles();
      saveDailySkeleton();
      renderGrid(document.getElementById("daily-skeleton-grid"));
    }
  };

  document.getElementById("conflict-rules-btn").onclick = () => {
    if (window.SkeletonSandbox) window.SkeletonSandbox.showConflictRulesModal();
  };

  renderPalette(document.getElementById("daily-skeleton-palette"));
  renderGrid(document.getElementById("daily-skeleton-grid"));
  renderDisplacedTilesPanel();
}

function renderTripsForm() {
  if (!tripsFormContainer) return;
  const divisions = window.availableDivisions || [];

  tripsFormContainer.innerHTML = `
    <div style="max-width:420px;">
      <h3 style="margin-top:0;">Add a Trip</h3>
      <p style="color:#666;font-size:0.9em;margin-bottom:16px;">Add an off-campus trip. Overlapping tiles will be bumped down.</p>
      
      <div style="margin-bottom:12px;">
        <label><strong>Division</strong></label>
        <select id="trip-division" style="width:100%;padding:10px;margin-top:4px;border:1px solid #ccc;border-radius:4px;">
          <option value="">-- Select --</option>
          ${divisions.map(d => `<option value="${d}">${d}</option>`).join("")}
        </select>
      </div>
      
      <div style="margin-bottom:12px;">
        <label><strong>Trip Name</strong></label>
        <input id="trip-name" type="text" placeholder="e.g. Six Flags" style="width:100%;padding:10px;margin-top:4px;border:1px solid #ccc;border-radius:4px;box-sizing:border-box;">
      </div>
      
      <div style="display:flex;gap:10px;margin-bottom:16px;">
        <div style="flex:1;">
          <label><strong>Depart</strong></label>
          <input id="trip-start" type="text" placeholder="9:30am" style="width:100%;padding:10px;margin-top:4px;border:1px solid #ccc;border-radius:4px;box-sizing:border-box;">
        </div>
        <div style="flex:1;">
          <label><strong>Return</strong></label>
          <input id="trip-end" type="text" placeholder="3:30pm" style="width:100%;padding:10px;margin-top:4px;border:1px solid #ccc;border-radius:4px;box-sizing:border-box;">
        </div>
      </div>
      
      <button id="add-trip-btn" style="width:100%;background:#2563eb;color:white;padding:14px;font-size:1.05em;font-weight:600;border:none;border-radius:6px;cursor:pointer;">Add Trip</button>
    </div>
  `;

  document.getElementById("add-trip-btn").onclick = () => {
    const division = document.getElementById("trip-division").value;
    const tripName = document.getElementById("trip-name").value.trim();
    const startTime = document.getElementById("trip-start").value.trim();
    const endTime = document.getElementById("trip-end").value.trim();

    if (!division || !tripName || !startTime || !endTime) { alert("Fill all fields."); return; }

    const startMin = parseTimeToMinutes(startTime);
    const endMin = parseTimeToMinutes(endTime);
    if (startMin == null || endMin == null) { alert("Invalid time."); return; }
    if (endMin <= startMin) { alert("Return must be after departure."); return; }

    loadDailySkeleton();

    const newEvent = {
      id: `trip_${Math.random().toString(36).slice(2,9)}`,
      type: "pinned",
      event: tripName,
      division,
      startTime, endTime,
      reservedFields: []
    };

    dailyOverrideSkeleton.push(newEvent);
    const result = bumpOverlappingTiles(dailyOverrideSkeleton, newEvent, division);
    dailyOverrideSkeleton = result.skeleton;

    saveDailySkeleton();

    const grid = document.getElementById("daily-skeleton-grid");
    if (grid) renderGrid(grid);

    // Check conflicts and switch to skeleton
    if (window.SkeletonSandbox) {
      const conflicts = window.SkeletonSandbox.detectConflicts(dailyOverrideSkeleton);
      container.querySelector('.tab-button[data-tab="skeleton"]').click();
      if (conflicts.length > 0) {
        setTimeout(() => alert(`Trip added! ${conflicts.length} conflict(s) - check skeleton.`), 100);
      } else {
        alert("Trip added!");
      }
    } else {
      alert("Trip added!");
    }

    document.getElementById("trip-name").value = "";
    document.getElementById("trip-start").value = "";
    document.getElementById("trip-end").value = "";
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
  (masterSettings.app1.fields || []).forEach(f => (f.activities || []).forEach(s => { if (!sports.includes(s)) sports.push(s); }));
  sports.sort();
  
  const specials = (masterSettings.app1.specialActivities || []).map(s => s.name).sort();
  
  bunkOverridesContainer.innerHTML = `
    <div style="max-width:550px;">
      <h3 style="margin-top:0;">Bunk-Specific Override</h3>
      <p style="color:#666;font-size:0.9em;margin-bottom:16px;">Assign a specific activity to selected bunks.</p>
      
      <div style="margin-bottom:12px;">
        <label><strong>Type</strong></label>
        <select id="bo-type" style="width:100%;padding:10px;margin-top:4px;border:1px solid #ccc;border-radius:4px;">
          <option value="">-- Select --</option>
          <option value="sport">Sport</option>
          <option value="special">Special Activity</option>
          <option value="trip">Personal Trip</option>
        </select>
      </div>
      
      <div id="bo-activity-wrap" style="margin-bottom:12px;display:none;">
        <label><strong>Activity</strong></label>
        <select id="bo-activity" style="width:100%;padding:10px;margin-top:4px;border:1px solid #ccc;border-radius:4px;"></select>
      </div>
      
      <div id="bo-trip-wrap" style="margin-bottom:12px;display:none;">
        <label><strong>Trip Name</strong></label>
        <input id="bo-trip-name" type="text" placeholder="e.g. Doctor Appointment" style="width:100%;padding:10px;margin-top:4px;border:1px solid #ccc;border-radius:4px;box-sizing:border-box;">
      </div>
      
      <div style="display:flex;gap:10px;margin-bottom:12px;">
        <div style="flex:1;"><label><strong>Start</strong></label><input id="bo-start" type="text" placeholder="10:00am" style="width:100%;padding:10px;margin-top:4px;border:1px solid #ccc;border-radius:4px;box-sizing:border-box;"></div>
        <div style="flex:1;"><label><strong>End</strong></label><input id="bo-end" type="text" placeholder="11:00am" style="width:100%;padding:10px;margin-top:4px;border:1px solid #ccc;border-radius:4px;box-sizing:border-box;"></div>
      </div>
      
      <div style="margin-bottom:16px;">
        <label><strong>Select Bunks</strong></label>
        <div id="bo-bunks" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;max-height:180px;overflow-y:auto;padding:8px;border:1px solid #eee;border-radius:4px;">
          ${bunks.map(b => `<button type="button" class="bunk-chip" data-bunk="${b.name}" data-color="${b.color}" style="border-color:${b.color};">${b.name}</button>`).join('')}
        </div>
      </div>
      
      <button id="bo-apply" style="width:100%;background:#2563eb;color:white;padding:14px;font-size:1.05em;font-weight:600;border:none;border-radius:6px;cursor:pointer;">Apply Override</button>
      
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
      activitySelect.innerHTML = `<option value="">-- Sport --</option>` + sports.map(s => `<option value="${s}">${s}</option>`).join('');
      activityWrap.style.display = 'block';
    } else if (typeSelect.value === 'special') {
      activitySelect.innerHTML = `<option value="">-- Special --</option>` + specials.map(s => `<option value="${s}">${s}</option>`).join('');
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
    
    if (!type || !startTime || !endTime) { alert("Select type and times."); return; }
    
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
    
    currentOverrides.bunkActivityOverrides.push({
      id: `bunk_${Math.random().toString(36).slice(2,9)}`,
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
    <h4 style="margin:0 0 10px 0;">Existing Overrides</h4>
    ${currentOverrides.bunkActivityOverrides.map((o, i) => `
      <div style="background:#f5f5f5;padding:10px;border-radius:6px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;">
        <div>
          <strong>${o.activity}</strong> (${o.type})<br>
          <span style="font-size:0.85em;color:#666;">${o.bunks.join(', ')} • ${o.startTime} - ${o.endTime}</span>
        </div>
        <button class="remove-bo-btn" data-index="${i}" style="background:#ef5350;color:white;border:none;padding:6px 10px;border-radius:4px;cursor:pointer;">✕</button>
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

function renderResourceOverridesUI() {
  if (!resourceOverridesContainer) return;
  
  const fields = masterSettings.app1.fields || [];
  const specials = masterSettings.app1.specialActivities || [];
  const leagues = Object.keys(masterSettings.leaguesByName || {});
  const specialtyLeagues = Object.values(masterSettings.specialtyLeagues || {}).map(l => l.name);
  
  const saveOverrides = () => {
    const dailyData = window.loadCurrentDailyData?.() || {};
    const fullOverrides = dailyData.overrides || {};
    fullOverrides.leagues = currentOverrides.leagues;
    fullOverrides.disabledFields = currentOverrides.disabledFields;
    fullOverrides.disabledSpecials = currentOverrides.disabledSpecials;
    window.saveCurrentDailyData("overrides", fullOverrides);
  };
  
  const makeToggle = (name, isEnabled, onToggle) => {
    const div = document.createElement('div');
    div.className = 'list-item';
    div.innerHTML = `<span style="flex-grow:1;">${name}</span><label class="switch"><input type="checkbox" ${isEnabled ? 'checked' : ''}><span class="slider"></span></label>`;
    div.querySelector('input').onchange = (e) => onToggle(e.target.checked);
    return div;
  };
  
  resourceOverridesContainer.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:20px;">
      <div><h4 style="margin-top:0;">Fields</h4><div id="res-fields" class="master-list"></div></div>
      <div><h4 style="margin-top:0;">Special Activities</h4><div id="res-specials" class="master-list"></div></div>
      <div><h4 style="margin-top:0;">Leagues</h4><div id="res-leagues" class="master-list"></div></div>
      <div><h4 style="margin-top:0;">Specialty Leagues</h4><div id="res-specialty" class="master-list"></div></div>
    </div>
  `;
  
  const fieldsEl = document.getElementById("res-fields");
  fields.forEach(f => {
    fieldsEl.appendChild(makeToggle(f.name, !currentOverrides.disabledFields.includes(f.name), (on) => {
      if (on) currentOverrides.disabledFields = currentOverrides.disabledFields.filter(n => n !== f.name);
      else if (!currentOverrides.disabledFields.includes(f.name)) currentOverrides.disabledFields.push(f.name);
      saveOverrides();
    }));
  });
  
  const specialsEl = document.getElementById("res-specials");
  specials.forEach(s => {
    specialsEl.appendChild(makeToggle(s.name, !currentOverrides.disabledSpecials.includes(s.name), (on) => {
      if (on) currentOverrides.disabledSpecials = currentOverrides.disabledSpecials.filter(n => n !== s.name);
      else if (!currentOverrides.disabledSpecials.includes(s.name)) currentOverrides.disabledSpecials.push(s.name);
      saveOverrides();
    }));
  });
  
  const leaguesEl = document.getElementById("res-leagues");
  leagues.forEach(name => {
    leaguesEl.appendChild(makeToggle(name, !currentOverrides.leagues.includes(name), (on) => {
      if (on) currentOverrides.leagues = currentOverrides.leagues.filter(n => n !== name);
      else if (!currentOverrides.leagues.includes(name)) currentOverrides.leagues.push(name);
      saveOverrides();
    }));
  });
  
  const specialtyEl = document.getElementById("res-specialty");
  specialtyLeagues.forEach(name => {
    specialtyEl.appendChild(makeToggle(name, !currentOverrides.disabledSpecialtyLeagues.includes(name), (on) => {
      if (on) currentOverrides.disabledSpecialtyLeagues = currentOverrides.disabledSpecialtyLeagues.filter(n => n !== name);
      else if (!currentOverrides.disabledSpecialtyLeagues.includes(name)) currentOverrides.disabledSpecialtyLeagues.push(name);
      window.saveCurrentDailyData("disabledSpecialtyLeagues", currentOverrides.disabledSpecialtyLeagues);
    }));
  });
}

window.initDailyAdjustments = init;

})();
