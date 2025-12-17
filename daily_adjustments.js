// =================================================================
// daily_adjustments.js  (SANDBOX MODE - DRAG TO REPOSITION + CONFLICTS)
// 
// Features:
// - Drag existing tiles to reposition them (keeps duration)
// - Real-time conflict detection with visual highlighting
// - Streamlined trip form with instant feedback
// - Enhanced bunk-specific overrides (sport/special/trip)
// - Double-click to remove tiles (prevents accidental deletion while dragging)
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

// --- Smart Tile history ---
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
  { type:'smart', name:'Smart Tile', style:'background:#e3f2fd;border:2px dashed #0288d1;color:#01579b;', description:'Balances 2 activities with a fallback.' },
  { type: 'split', name: 'Split Activity', style: 'background:#fff3e0;border:1px solid #f57c00;', description: 'Two activities share the block.' },
  { type: 'league', name: 'League Game', style: 'background:#d1c4e9;border:1px solid #5e35b1;', description: 'Regular League slot.' },
  { type: 'specialty_league', name: 'Specialty League', style: 'background:#fff8e1;border:1px solid #f9a825;', description: 'Specialty League slot.' },
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

function renderPalette(paletteContainer) {
  paletteContainer.innerHTML = '<span style="font-weight:600;align-self:center;">Drag tiles onto the grid:</span>';
  TILES.forEach(tile => {
    const el = document.createElement('div');
    el.className = 'grid-tile-draggable';
    el.textContent = tile.name;
    el.style.cssText = tile.style;
    el.style.padding = '8px 12px';
    el.style.borderRadius = '5px';
    el.style.cursor = 'grab';
    el.onclick = () => alert(tile.description);
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
  
  gridContainer.dataset.earliestMin = earliestMin;

  let gridHtml = `<div style="display:grid;grid-template-columns:60px repeat(${availableDivisions.length},1fr);position:relative;">`;
  gridHtml += `<div style="grid-row:1;position:sticky;top:0;background:#fff;z-index:10;border-bottom:1px solid #999;padding:8px;">Time</div>`;

  availableDivisions.forEach((divName, i) => {
    gridHtml += `
      <div style="grid-row:1;grid-column:${i + 2};position:sticky;top:0;background:${divisions[divName]?.color || '#333'};color:#fff;z-index:10;border-bottom:1px solid #999;padding:8px;text-align:center;">${divName}</div>`;
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

    gridHtml += `</div>`;
  });

  gridHtml += `</div>`;
  gridContainer.innerHTML = gridHtml;
  
  addDropListeners(gridContainer);
  addDragToRepositionListeners(gridContainer);
  addRemoveListeners(gridContainer);
  applyConflictHighlighting(gridContainer);
  
  // Render conflict banner
  if (window.SkeletonSandbox) {
    window.SkeletonSandbox.renderConflictBanner('#override-scheduler-content', dailyOverrideSkeleton);
  }
}

// =================================================================
// DRAG TO REPOSITION
// =================================================================

function addDragToRepositionListeners(gridContainer) {
  const earliestMin = parseInt(gridContainer.dataset.earliestMin, 10) || 540;
  
  gridContainer.querySelectorAll('.grid-event').forEach(tile => {
    tile.draggable = true;
    tile.style.cursor = 'grab';
    
    tile.ondragstart = (e) => {
      const eventId = tile.dataset.eventId;
      e.dataTransfer.setData('text/event-move', eventId);
      e.dataTransfer.effectAllowed = 'move';
      tile.classList.add('dragging');
      
      // Create a semi-transparent drag image
      const clone = tile.cloneNode(true);
      clone.style.opacity = '0.7';
      clone.style.position = 'absolute';
      clone.style.top = '-1000px';
      document.body.appendChild(clone);
      e.dataTransfer.setDragImage(clone, 50, 20);
      setTimeout(() => clone.remove(), 0);
    };
    
    tile.ondragend = () => {
      tile.classList.remove('dragging');
    };
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
    
    cell.ondragleave = () => {
      cell.classList.remove('drag-over');
    };
    
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
        
        // Check for overlapping events
        const overlapping = dailyOverrideSkeleton.filter(ev => {
          if (ev.id === eventId) return false;
          if (ev.division !== divName) return false;
          const evStart = parseTimeToMinutes(ev.startTime);
          const evEnd = parseTimeToMinutes(ev.endTime);
          return (evStart < newEndMin && evEnd > newStartMin);
        });
        
        if (overlapping.length > 0) {
          const evNames = overlapping.map(e => e.event).join(', ');
          if (!confirm(`Moving "${event.event}" will remove:\n${evNames}\n\nContinue?`)) {
            return;
          }
          overlapping.forEach(ov => {
            const idx = dailyOverrideSkeleton.findIndex(ev => ev.id === ov.id);
            if (idx >= 0) dailyOverrideSkeleton.splice(idx, 1);
          });
        }
        
        event.division = divName;
        event.startTime = minutesToTime(newStartMin);
        event.endTime = minutesToTime(newEndMin);
        
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
    if (c.event1?.id) {
      if (!conflictTypeMap[c.event1.id] || c.type === 'critical') {
        conflictTypeMap[c.event1.id] = c.type;
      }
    }
    if (c.event2?.id) {
      if (!conflictTypeMap[c.event2.id] || c.type === 'critical') {
        conflictTypeMap[c.event2.id] = c.type;
      }
    }
  });
  
  gridContainer.querySelectorAll('.grid-event').forEach(tile => {
    const eventId = tile.dataset.eventId;
    tile.classList.remove('conflict-critical', 'conflict-warning');
    if (conflictTypeMap[eventId]) {
      tile.classList.add(`conflict-${conflictTypeMap[eventId]}`);
    }
  });
}

window.refreshSkeletonConflicts = function() {
  const gridContainer = document.getElementById('daily-skeleton-grid');
  if (gridContainer) renderGrid(gridContainer);
};

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
      try {
        tileData = JSON.parse(e.dataTransfer.getData('application/json'));
      } catch { return; }
      
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
          alert("Invalid time format. Use '9:00am' or '2:30pm'.");
          return null;
        }
        if (divStartMin !== null && timeMin < divStartMin) {
          alert(`${timeStr} is before division start (${div.startTime}).`);
          return null;
        }
        if (divEndMin !== null && (isStartTime ? timeMin >= divEndMin : timeMin > divEndMin)) {
          alert(`${timeStr} is after division end (${div.endTime}).`);
          return null;
        }
        return timeMin;
      };

      // Handle different tile types
      if (tileData.type === 'split') {
        let startTime, endTime, startMin, endMin;
        while (true) {
          startTime = prompt(`Split block start time:`, defaultStartTime);
          if (!startTime) return;
          startMin = validateTime(startTime, true);
          if (startMin !== null) break;
        }
        while (true) {
          endTime = prompt(`Split block end time:`);
          if (!endTime) return;
          endMin = validateTime(endTime, false);
          if (endMin !== null && endMin > startMin) break;
          if (endMin !== null) alert("End must be after start.");
        }
        const name1 = prompt("First activity name:");
        if (!name1) return;
        const name2 = prompt("Second activity name:");
        if (!name2) return;
        
        newEvent = {
          id: `evt_${Math.random().toString(36).slice(2, 9)}`,
          type: 'split',
          event: `${name1} / ${name2}`,
          division: divName,
          startTime, endTime,
          subEvents: [{ type: 'slot', event: name1 }, { type: 'slot', event: name2 }]
        };
        
      } else if (tileData.type === 'smart') {
        let startTime, endTime, startMin, endMin;
        while (true) {
          startTime = prompt(`Smart Tile start time:`, defaultStartTime);
          if (!startTime) return;
          startMin = validateTime(startTime, true);
          if (startMin !== null) break;
        }
        while (true) {
          endTime = prompt(`Smart Tile end time:`);
          if (!endTime) return;
          endMin = validateTime(endTime, false);
          if (endMin !== null && endMin > startMin) break;
          if (endMin !== null) alert("End must be after start.");
        }
        
        const rawMains = prompt("Enter TWO main activities (e.g., Swim / Special):");
        if (!rawMains) return;
        const mains = rawMains.split(/,|\//).map(s => s.trim()).filter(Boolean);
        if (mains.length < 2) { alert("Need 2 activities."); return; }
        
        const [main1, main2] = mains;
        const pick = prompt(`Which needs a fallback?\n1: ${main1}\n2: ${main2}`);
        if (!pick) return;
        
        let fallbackFor = pick.trim() === "1" ? main1 : main2;
        const fallbackActivity = prompt(`Fallback if "${fallbackFor}" unavailable:`);
        if (!fallbackActivity) return;
        
        newEvent = {
          id: `evt_${Math.random().toString(36).slice(2, 9)}`,
          type: "smart",
          event: `${main1} / ${main2}`,
          division: divName,
          startTime, endTime,
          smartData: { main1, main2, fallbackFor, fallbackActivity }
        };
        
      } else if (tileData.type === 'league') {
        let startTime = prompt(`League start time:`, defaultStartTime);
        if (!startTime) return;
        let endTime = prompt(`League end time:`);
        if (!endTime) return;
        
        newEvent = {
          id: `evt_${Math.random().toString(36).slice(2, 9)}`,
          type: 'league',
          event: 'League Game',
          division: divName,
          startTime, endTime
        };
        
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
          startTime, endTime
        };
        
      } else if (['lunch','snacks','custom','dismissal','swim'].includes(tileData.type)) {
        eventType = 'pinned';
        let reservedFields = [];
        
        if (tileData.type === 'custom') {
          eventName = prompt("Custom event name:");
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
          startTime = prompt(`${eventName} start time:`, defaultStartTime);
          if (!startTime) return;
          startMin = validateTime(startTime, true);
          if (startMin !== null) break;
        }
        while (true) {
          endTime = prompt(`${eventName} end time:`);
          if (!endTime) return;
          endMin = validateTime(endTime, false);
          if (endMin !== null && endMin > startMin) break;
          if (endMin !== null) alert("End must be after start.");
        }
        
        newEvent = {
          id: `evt_${Math.random().toString(36).slice(2, 9)}`,
          type: eventType,
          event: eventName,
          division: divName,
          startTime, endTime,
          reservedFields
        };
      }

      // Standard slot tiles
      if (!newEvent) {
        if (tileData.type === 'activity') eventName = 'General Activity Slot';
        else if (tileData.type === 'sports') eventName = 'Sports Slot';
        else if (tileData.type === 'special') eventName = 'Special Activity';
        
        let startTime, endTime, startMin, endMin;
        while (true) {
          startTime = prompt(`${eventName} start time:`, defaultStartTime);
          if (!startTime) return;
          startMin = validateTime(startTime, true);
          if (startMin !== null) break;
        }
        while (true) {
          endTime = prompt(`${eventName} end time:`);
          if (!endTime) return;
          endMin = validateTime(endTime, false);
          if (endMin !== null && endMin > startMin) break;
          if (endMin !== null) alert("End must be after start.");
        }
        
        newEvent = {
          id: `evt_${Math.random().toString(36).slice(2, 9)}`,
          type: eventType,
          event: eventName,
          division: divName,
          startTime, endTime
        };
      }

      if (newEvent) {
        const newStartMin = parseTimeToMinutes(newEvent.startTime);
        const newEndMin = parseTimeToMinutes(newEvent.endTime);

        dailyOverrideSkeleton = dailyOverrideSkeleton.filter(item => {
          if (item.division !== divName) return true;
          const itemStartMin = parseTimeToMinutes(item.startTime);
          const itemEndMin = parseTimeToMinutes(item.endTime);
          if (itemStartMin == null || itemEndMin == null) return true;
          return !((itemStartMin < newEndMin) && (itemEndMin > newStartMin));
        });

        dailyOverrideSkeleton.push(newEvent);
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
  if (event.type === 'pinned' && tile && tile.type === 'custom') {
    tripStyle = 'background:#455a64;color:white;border:1px solid #000;';
  }

  let innerHtml = `<strong>${event.event}</strong><br><span style="font-size:.85em;">${event.startTime} - ${event.endTime}</span>`;
  
  if (event.reservedFields && event.reservedFields.length > 0) {
    innerHtml += `<div style="font-size:0.7em;color:#c62828;margin-top:2px;">📍 ${event.reservedFields.join(', ')}</div>`;
  }
  
  if (event.type === 'smart' && event.smartData) {
    innerHtml += `<div style="font-size:0.7em;margin-top:2px;opacity:0.8;">↳ ${event.smartData.fallbackActivity}</div>`;
  }

  return `
    <div class="grid-event"
         data-event-id="${event.id}"
         title="Drag to move • Double-click to remove"
         style="${tripStyle || style};padding:4px 6px;border-radius:4px;text-align:center;margin:0 1px;font-size:.85em;position:absolute;top:${top}px;height:${height}px;width:calc(100% - 4px);box-sizing:border-box;overflow:hidden;">
      ${innerHtml}
    </div>`;
}

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
      if (hh !== 12) hh += 12;
    }
  }
  return hh * 60 + mm;
}

// =================================================================
// RUN OPTIMIZER
// =================================================================

function runOptimizer() {
  if (!window.runSkeletonOptimizer) {
    alert("Error: 'runSkeletonOptimizer' not found.");
    return;
  }
  if (dailyOverrideSkeleton.length === 0) {
    alert("Skeleton is empty. Add blocks first.");
    return;
  }

  // Warn about conflicts
  if (window.SkeletonSandbox) {
    const conflicts = window.SkeletonSandbox.detectConflicts(dailyOverrideSkeleton);
    const critical = conflicts.filter(c => c.type === 'critical');
    
    if (critical.length > 0) {
      const msg = critical.slice(0, 3).map(c => `• ${c.resource}: ${c.event1.division} ↔ ${c.event2.division}`).join('\n');
      if (!confirm(`⚠️ ${critical.length} conflict(s) detected!\n\n${msg}\n\nRun anyway?`)) return;
    }
  }

  saveDailySkeleton();

  const success = window.runSkeletonOptimizer(dailyOverrideSkeleton, currentOverrides);
  if (success) {
    alert("Schedule Generated!");
    window.showTab?.('schedule');
  } else {
    alert("Error during generation. Check console.");
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
        <p style="margin:0;font-size:0.85em;color:#666;">Drag tiles to reposition • Conflicts auto-highlighted • Double-click to remove</p>
      </div>
      <button id="run-optimizer-btn" style="background:#28a745;color:white;padding:12px 20px;font-size:1.1em;border:none;border-radius:5px;cursor:pointer;font-weight:600;">
        ▶ Run Optimizer
      </button>
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
      .master-list .list-item{padding:10px 8px;border:1px solid #ddd;border-radius:5px;margin-bottom:3px;cursor:pointer;background:#fff;font-size:.95em;display:flex;justify-content:space-between;align-items:center;}
      .master-list .list-item:hover{background:#f9f9f9;}
      .master-list .list-item.selected{background:#e7f3ff;border-color:#007bff;}
      .detail-pane{border:1px solid #ccc;border-radius:8px;padding:20px;background:#fdfdfd;min-height:200px;}
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
  let optionsHtml = `<option value="">-- Load Saved Skeleton --</option>`;
  Object.keys(savedSkeletons).sort().forEach(name => {
    optionsHtml += `<option value="${name}">${name}</option>`;
  });

  skeletonContainer.innerHTML = `
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
    if (confirm(`Load "${name}"? This overwrites current edits.`)) {
      dailyOverrideSkeleton = JSON.parse(JSON.stringify(savedSkeletons[name]));
      saveDailySkeleton();
      renderGrid(document.getElementById("daily-skeleton-grid"));
    }
  };

  document.getElementById("conflict-rules-btn").onclick = () => {
    if (window.SkeletonSandbox) window.SkeletonSandbox.showConflictRulesModal();
  };

  renderPalette(document.getElementById("daily-skeleton-palette"));
  renderGrid(document.getElementById("daily-skeleton-grid"));
}

function renderTripsForm() {
  if (!tripsFormContainer) return;

  const divisions = window.availableDivisions || [];

  tripsFormContainer.innerHTML = `
    <div style="max-width:420px;">
      <h3 style="margin-top:0;">Add a Trip</h3>
      <p style="color:#666;font-size:0.9em;margin-bottom:16px;">Add an off-campus trip. Conflicts will highlight automatically.</p>
      
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

    if (!division || !tripName || !startTime || !endTime) {
      alert("Please fill all fields.");
      return;
    }

    const startMin = parseTimeToMinutes(startTime);
    const endMin = parseTimeToMinutes(endTime);
    if (startMin == null || endMin == null) {
      alert("Invalid time format.");
      return;
    }
    if (endMin <= startMin) {
      alert("Return must be after departure.");
      return;
    }

    loadDailySkeleton();

    const newEvent = {
      id: `trip_${Math.random().toString(36).slice(2, 9)}`,
      type: "pinned",
      event: tripName,
      division,
      startTime, endTime,
      reservedFields: []
    };

    dailyOverrideSkeleton = dailyOverrideSkeleton.filter(ev => {
      if (ev.division !== division) return true;
      const evStart = parseTimeToMinutes(ev.startTime);
      const evEnd = parseTimeToMinutes(ev.endTime);
      if (evStart == null || evEnd == null) return true;
      return !(evStart < endMin && evEnd > startMin);
    });

    dailyOverrideSkeleton.push(newEvent);
    saveDailySkeleton();

    const grid = document.getElementById("daily-skeleton-grid");
    if (grid) renderGrid(grid);

    // Check conflicts and switch to skeleton
    if (window.SkeletonSandbox) {
      const conflicts = window.SkeletonSandbox.detectConflicts(dailyOverrideSkeleton);
      if (conflicts.length > 0) {
        container.querySelector('.tab-button[data-tab="skeleton"]').click();
        setTimeout(() => alert(`Trip added! ${conflicts.length} conflict(s) - drag tiles to fix.`), 100);
      } else {
        alert("Trip added! No conflicts.");
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
    if (div?.bunks) {
      div.bunks.forEach(bunk => bunks.push({ name: bunk, division: divName, color: div.color }));
    }
  });
  
  const sports = [];
  (masterSettings.app1.fields || []).forEach(field => {
    (field.activities || []).forEach(sport => {
      if (!sports.includes(sport)) sports.push(sport);
    });
  });
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
        <div style="flex:1;">
          <label><strong>Start</strong></label>
          <input id="bo-start" type="text" placeholder="10:00am" style="width:100%;padding:10px;margin-top:4px;border:1px solid #ccc;border-radius:4px;box-sizing:border-box;">
        </div>
        <div style="flex:1;">
          <label><strong>End</strong></label>
          <input id="bo-end" type="text" placeholder="11:00am" style="width:100%;padding:10px;margin-top:4px;border:1px solid #ccc;border-radius:4px;box-sizing:border-box;">
        </div>
      </div>
      
      <div style="margin-bottom:16px;">
        <label><strong>Select Bunks</strong></label>
        <div id="bo-bunks" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;max-height:180px;overflow-y:auto;padding:8px;border:1px solid #eee;border-radius:4px;">
          ${bunks.map(b => `<button type="button" class="bunk-chip" data-bunk="${b.name}" style="padding:6px 12px;border:2px solid ${b.color};background:white;border-radius:20px;cursor:pointer;font-size:0.85em;">${b.name}</button>`).join('')}
        </div>
      </div>
      
      <button id="bo-apply" style="width:100%;background:#2563eb;color:white;padding:14px;font-size:1.05em;font-weight:600;border:none;border-radius:6px;cursor:pointer;">Apply Override</button>
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
      chip.style.background = selected ? chip.style.borderColor : 'white';
      chip.style.color = selected ? 'white' : 'black';
    };
  });
  
  document.getElementById("bo-apply").onclick = () => {
    const type = typeSelect.value;
    const startTime = document.getElementById("bo-start").value.trim();
    const endTime = document.getElementById("bo-end").value.trim();
    
    if (!type || !startTime || !endTime) {
      alert("Select type and enter times.");
      return;
    }
    
    let activityName = '';
    if (type === 'sport' || type === 'special') {
      activityName = activitySelect.value;
      if (!activityName) { alert("Select an activity."); return; }
    } else if (type === 'trip') {
      activityName = document.getElementById("bo-trip-name").value.trim();
      if (!activityName) { alert("Enter trip name."); return; }
    }
    
    const selectedBunks = [];
    bunkOverridesContainer.querySelectorAll('.bunk-chip.selected').forEach(c => selectedBunks.push(c.dataset.bunk));
    
    if (selectedBunks.length === 0) {
      alert("Select at least one bunk.");
      return;
    }
    
    const startMin = parseTimeToMinutes(startTime);
    const endMin = parseTimeToMinutes(endTime);
    if (startMin == null || endMin == null || endMin <= startMin) {
      alert("Invalid times.");
      return;
    }
    
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
  };
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
    div.innerHTML = `
      <span style="flex-grow:1;">${name}</span>
      <label class="switch" style="margin:0;">
        <input type="checkbox" ${isEnabled ? 'checked' : ''}>
        <span class="slider"></span>
      </label>
    `;
    div.querySelector('input').onchange = (e) => onToggle(e.target.checked);
    return div;
  };
  
  resourceOverridesContainer.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:20px;">
      <div>
        <h4 style="margin-top:0;">Fields</h4>
        <div id="res-fields" class="master-list"></div>
      </div>
      <div>
        <h4 style="margin-top:0;">Special Activities</h4>
        <div id="res-specials" class="master-list"></div>
      </div>
      <div>
        <h4 style="margin-top:0;">Leagues</h4>
        <div id="res-leagues" class="master-list"></div>
      </div>
      <div>
        <h4 style="margin-top:0;">Specialty Leagues</h4>
        <div id="res-specialty" class="master-list"></div>
      </div>
    </div>
  `;
  
  const fieldsEl = document.getElementById("res-fields");
  fields.forEach(f => {
    const enabled = !currentOverrides.disabledFields.includes(f.name);
    fieldsEl.appendChild(makeToggle(f.name, enabled, (on) => {
      if (on) currentOverrides.disabledFields = currentOverrides.disabledFields.filter(n => n !== f.name);
      else if (!currentOverrides.disabledFields.includes(f.name)) currentOverrides.disabledFields.push(f.name);
      saveOverrides();
    }));
  });
  
  const specialsEl = document.getElementById("res-specials");
  specials.forEach(s => {
    const enabled = !currentOverrides.disabledSpecials.includes(s.name);
    specialsEl.appendChild(makeToggle(s.name, enabled, (on) => {
      if (on) currentOverrides.disabledSpecials = currentOverrides.disabledSpecials.filter(n => n !== s.name);
      else if (!currentOverrides.disabledSpecials.includes(s.name)) currentOverrides.disabledSpecials.push(s.name);
      saveOverrides();
    }));
  });
  
  const leaguesEl = document.getElementById("res-leagues");
  leagues.forEach(name => {
    const enabled = !currentOverrides.leagues.includes(name);
    leaguesEl.appendChild(makeToggle(name, enabled, (on) => {
      if (on) currentOverrides.leagues = currentOverrides.leagues.filter(n => n !== name);
      else if (!currentOverrides.leagues.includes(name)) currentOverrides.leagues.push(name);
      saveOverrides();
    }));
  });
  
  const specialtyEl = document.getElementById("res-specialty");
  specialtyLeagues.forEach(name => {
    const enabled = !currentOverrides.disabledSpecialtyLeagues.includes(name);
    specialtyEl.appendChild(makeToggle(name, enabled, (on) => {
      if (on) currentOverrides.disabledSpecialtyLeagues = currentOverrides.disabledSpecialtyLeagues.filter(n => n !== name);
      else if (!currentOverrides.disabledSpecialtyLeagues.includes(name)) currentOverrides.disabledSpecialtyLeagues.push(name);
      window.saveCurrentDailyData("disabledSpecialtyLeagues", currentOverrides.disabledSpecialtyLeagues);
    }));
  });
}

window.initDailyAdjustments = init;

})();
