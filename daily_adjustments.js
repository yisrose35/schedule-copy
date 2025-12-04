// =================================================================
// daily_adjustments.js
// FIXED: Scope issues for container variables resolved.
// =================================================================

(function() {
'use strict';

// --- 1. Module-Level Variables (Accessible by all functions) ---
let container = null;
let skeletonContainer = null;
let tripsFormContainer = null;
let bunkOverridesContainer = null;
let resourceOverridesContainer = null;

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

// Legacy Smart Tile history
let smartTileHistory = null;
const SMART_TILE_HISTORY_KEY = "smartTileHistory_v1";

function loadSmartTileHistory() {
  return { byBunk: {} };
}

// --- Global helpers referencing SchedulerCoreUtils ---
const parseTimeToMinutes = window.SchedulerCoreUtils?.parseTimeToMinutes;
const minutesToTime = window.SchedulerCoreUtils?.minutesToTime;

// Rendering settings
const PIXELS_PER_MINUTE = 2;
let dailyOverrideSkeleton = [];

// --- Palette Tile Definitions ---
const TILES = [
  { type: 'activity', name: 'Activity', style: 'background:#e0f7fa;border:1px solid #007bff;', description: 'Flexible slot (Sport or Special).' },
  { type: 'sports', name: 'Sports', style: 'background:#dcedc8;border:1px solid #689f38;', description: 'Sports slot only.' },
  { type: 'special', name: 'Special Activity', style: 'background:#e8f5f9;border:1px solid #43a047;', description: 'Special Activity slot only.' },
  { type: 'smart', name: 'Smart Tile', style: 'background:#e3f2fd;border:2px dashed #0288d1;color:#01579b;', description: 'Balances 2 activities with fallbacks.' },
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
  if (lower === 'activity') return { type:'slot', event:'General Activity Slot' };
  if (lower === 'sports') return { type:'slot', event:'Sports Slot' };
  if (lower === 'special activity' || lower === 'special') return { type:'slot', event:'Special Activity' };
  if (['swim','lunch','snacks','dismissal'].includes(lower))
    return { type:'pinned', event:name };
  return { type:'pinned', event:name };
}

// ----------------------------------------------------------------------
// PALETTE RENDERING
// ----------------------------------------------------------------------
function renderPalette(paletteContainer) {
  if (!paletteContainer) return;
  paletteContainer.innerHTML = '<span style="font-weight:600;align-self:center;">Drag tiles onto the grid:</span>';
  TILES.forEach(tile => {
    const el = document.createElement('div');
    el.className = 'grid-tile-draggable';
    el.textContent = tile.name;
    el.style.cssText = tile.style;
    el.style.padding = '8px 12px';
    el.style.borderRadius = '5px';
    el.style.cursor = 'grab';
    el.draggable = true;

    el.onclick = () => alert(tile.description);

    el.ondragstart = (e) => {
      e.dataTransfer.setData('application/json', JSON.stringify(tile));
      e.dataTransfer.effectAllowed = 'copy';
      el.style.cursor = 'grabbing';
    };

    el.ondragend = () => { el.style.cursor = 'grab'; };

    paletteContainer.appendChild(el);
  });
}

// ----------------------------------------------------------------------
// GRID RENDERING
// ----------------------------------------------------------------------
function renderGrid(gridContainer) {
  if (!gridContainer) return;
  
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

  if (earliestMin === null) earliestMin = 540; // 9:00am
  if (latestMin === null) latestMin = 960;     // 4:00pm

  const pinnedEnds = dailyOverrideSkeleton
    .filter(ev => ev.type === 'pinned')
    .map(ev => parseTimeToMinutes(ev.endTime))
    .filter(v => v != null);

  if (pinnedEnds.length > 0) {
    latestMin = Math.max(latestMin, Math.max(...pinnedEnds));
  }

  if (latestMin <= earliestMin) latestMin = earliestMin + 60;

  const totalMinutes = latestMin - earliestMin;
  const totalHeight = totalMinutes * PIXELS_PER_MINUTE;

  const timeLabels = [];
  const TIME_LABEL_INCREMENT = 30;

  for (let min = earliestMin; min < latestMin; min += TIME_LABEL_INCREMENT) {
    const end = Math.min(min + TIME_LABEL_INCREMENT, latestMin);
    timeLabels.push({ start:min, end });
  }

  let html = `<div style="display:grid;grid-template-columns:60px repeat(${availableDivisions.length},1fr);position:relative;min-width:600px;">`;

  html += `<div style="grid-row:1;position:sticky;top:0;background:#fff;z-index:10;border-bottom:1px solid #999;padding:8px;">Time</div>`;

  availableDivisions.forEach((divName, i) => {
    html += `
      <div style="
        grid-row:1;
        grid-column:${i+2};
        position:sticky;
        top:0;
        background:${divisions[divName]?.color || '#333'};
        color:#fff;
        z-index:10;
        border-bottom:1px solid #999;
        padding:8px;
        text-align:center;
      ">${divName}</div>`;
  });

  html += `<div style="grid-row:2;grid-column:1;height:${totalHeight}px;position:relative;background:#f9f9f9;border-right:1px solid #ccc;">`;

  timeLabels.forEach(({start,end}) => {
    const top = (start - earliestMin) * PIXELS_PER_MINUTE;
    const height = (end - start) * PIXELS_PER_MINUTE;
    html += `
      <div style="
        position:absolute;
        top:${top}px;
        left:0;
        width:100%;
        height:${height}px;
        border-bottom:1px dashed #ddd;
        box-sizing:border-box;
        font-size:10px;
        padding:2px;
        color:#777;
      ">${minutesToTime(start)}</div>`;
  });

  html += `</div>`;

  availableDivisions.forEach((divName, i) => {
    const div = divisions[divName];
    const divStartMin = parseTimeToMinutes(div?.startTime);
    const divEndMin = parseTimeToMinutes(div?.endTime);

    html += `
      <div class="grid-cell"
           data-div="${divName}"
           data-start-min="${earliestMin}"
           style="grid-row:2;grid-column:${i+2};position:relative;height:${totalHeight}px;border-right:1px solid #ccc;">`;

    if (divStartMin !== null && divStartMin > earliestMin) {
      const h = (divStartMin - earliestMin) * PIXELS_PER_MINUTE;
      html += `<div class="grid-disabled" style="top:0;height:${h}px;"></div>`;
    }
    if (divEndMin !== null && divEndMin < latestMin) {
      const top = (divEndMin - earliestMin) * PIXELS_PER_MINUTE;
      const h = (latestMin - divEndMin) * PIXELS_PER_MINUTE;
      html += `<div class="grid-disabled" style="top:${top}px;height:${h}px;"></div>`;
    }

    dailyOverrideSkeleton
      .filter(ev => ev.division === divName)
      .forEach(event => {
        const s = parseTimeToMinutes(event.startTime);
        const e = parseTimeToMinutes(event.endTime);
        if (s == null || e == null) return;

        const vs = Math.max(s, earliestMin);
        const ve = Math.min(e, latestMin);
        if (ve <= vs) return;

        const top = (vs - earliestMin) * PIXELS_PER_MINUTE;
        const height = (ve - vs) * PIXELS_PER_MINUTE;
        html += renderEventTile(event, top, height);
      });

    html += `</div>`;
  });

  html += `</div>`;
  gridContainer.innerHTML = html;

  addDropListeners(gridContainer);
  addRemoveListeners(gridContainer);
}

// ----------------------------------------------------------------------
// DROPPING LOGIC
// ----------------------------------------------------------------------
function addDropListeners(gridContainer) {
  gridContainer.querySelectorAll('.grid-cell').forEach(cell => {

    cell.ondragover = (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      cell.style.backgroundColor = '#e0ffe0';
    };

    cell.ondragleave = () => {
      cell.style.backgroundColor = '';
    };

    cell.ondrop = (e) => {
      e.preventDefault();
      cell.style.backgroundColor = '';

      const tileData = JSON.parse(e.dataTransfer.getData('application/json'));
      const divName = cell.dataset.div;
      const div = window.divisions[divName] || {};

      const divStartMin = parseTimeToMinutes(div.startTime);
      const divEndMin = parseTimeToMinutes(div.endTime);

      const rect = cell.getBoundingClientRect();
      const scrollTop = cell.closest('#daily-skeleton-grid')?.scrollTop || 0;
      const y = e.clientY - rect.top + scrollTop;

      const earliest = parseInt(cell.dataset.startMin, 10);
      let dropped = Math.round(y / PIXELS_PER_MINUTE / 5) * 5;
      let startMin = earliest + dropped;
      let endMin = startMin + 30;

      const defaultStartTime = minutesToTime(startMin);
      const defaultEndTime = minutesToTime(endMin);

      const validateTime = (timeStr, isStart) => {
        const tm = parseTimeToMinutes(timeStr);
        if (tm == null) {
          alert("Invalid time format. Use '9:00am' style.");
          return null;
        }
        if (divStartMin != null && tm < divStartMin) {
          alert(`Error: ${timeStr} is before division start (${div.startTime}).`);
          return null;
        }
        if (divEndMin != null && (isStart ? tm >= divEndMin : tm > divEndMin)) {
          alert(`Error: ${timeStr} is after division end (${div.endTime}).`);
          return null;
        }
        return tm;
      };

      let newEvent = null;
      let eventType = 'slot';
      let eventName = tileData.name;

      // --- SPLIT TILE ---
      if (tileData.type === 'split') {
        let sTime, eTime, sm, em;

        while (true) {
          sTime = prompt(`Enter Start Time for the full block:`, defaultStartTime);
          if (!sTime) return;
          sm = validateTime(sTime, true);
          if (sm !== null) break;
        }
        while (true) {
          eTime = prompt(`Enter End Time for the full block:`, defaultEndTime);
          if (!eTime) return;
          em = validateTime(eTime, false);
          if (em !== null && em > sm) break;
          alert("End time must be after start time.");
        }

        const act1 = prompt("Enter name for FIRST activity:");
        if (!act1) return;
        const act2 = prompt("Enter name for SECOND activity:");
        if (!act2) return;

        const e1 = mapEventNameForOptimizer(act1);
        const e2 = mapEventNameForOptimizer(act2);

        newEvent = {
          id:`evt_${Math.random().toString(36).slice(2,9)}`,
          type:'split',
          event:`${act1} / ${act2}`,
          division:divName,
          startTime:sTime,
          endTime:eTime,
          subEvents:[e1, e2]
        };

      // --- SMART TILE ---
      } else if (tileData.type === 'smart') {

        let sTime, eTime, sm, em;

        while (true) {
          sTime = prompt(`Smart Tile for ${divName}\nEnter Start Time:`, defaultStartTime);
          if (!sTime) return;
          sm = validateTime(sTime, true);
          if (sm !== null) break;
        }

        while (true) {
          eTime = prompt(`Enter End Time:`, defaultEndTime);
          if (!eTime) return;
          em = validateTime(eTime, false);
          if (em !== null && em > sm) break;
          alert("End time must be after start time.");
        }

        const raw = prompt("Enter the TWO MAIN activities (Activity1 / Activity2):");
        if (!raw) return;

        const mains = raw.split(/,|\//).map(s => s.trim()).filter(Boolean);
        if (mains.length < 2) {
          alert("Please enter TWO distinct activities.");
          return;
        }

        const [main1, main2] = mains;

        const pick = prompt(
          `Which activity requires a fallback?\n1: ${main1}\n2: ${main2}`
        );
        if (!pick) return;

        let fallbackFor = null;
        if (pick.trim() === "1" || pick.trim().toLowerCase() === main1.toLowerCase()) {
          fallbackFor = main1;
        } else if (pick.trim() === "2" || pick.trim().toLowerCase() === main2.toLowerCase()) {
          fallbackFor = main2;
        } else {
          alert("Invalid choice.");
          return;
        }

        const fallbackActivity = prompt(
          `If "${fallbackFor}" is unavailable, what should be played instead?`
        );
        if (!fallbackActivity) return;

        newEvent = {
          id:`evt_${Math.random().toString(36).slice(2,9)}`,
          type:'smart',
          event:`${main1} / ${main2}`,
          division:divName,
          startTime:sTime,
          endTime:eTime,
          smartData:{
            main1,
            main2,
            fallbackFor,
            fallbackActivity
          }
        };

      // --- PINNED (swim, lunch, snacks, custom, dismissal) ---
      } else if (['lunch','snacks','custom','dismissal','swim'].includes(tileData.type)) {
        eventType = 'pinned';

        if (tileData.type === 'custom') {
          eventName = prompt("Enter custom event name:");
          if (!eventName) return;
        } else {
          eventName = tileData.name;
        }

        let sTime, eTime, sm, em;

        while (true) {
          sTime = prompt(`Enter Start Time for "${eventName}":`, defaultStartTime);
          if (!sTime) return;
          sm = validateTime(sTime, true);
          if (sm !== null) break;
        }

        while (true) {
          eTime = prompt(`Enter End Time:`, defaultEndTime);
          if (!eTime) return;
          em = validateTime(eTime, false);
          if (em !== null && em > sm) break;
          alert("End time must be after start time.");
        }

        newEvent = {
          id:`evt_${Math.random().toString(36).slice(2,9)}`,
          type:eventType,
          event:eventName,
          division:divName,
          startTime:minutesToTime(sm),
          endTime:minutesToTime(em)
        };

      // --- STANDARD BLOCKS ---
      } else {

        if (tileData.type === 'activity') eventName = 'General Activity Slot';
        else if (tileData.type === 'sports') eventName = 'Sports Slot';
        else if (tileData.type === 'special') eventName = 'Special Activity';

        let sTime, eTime, sm, em;

        while (true) {
          sTime = prompt(`Add "${eventName}"?\nEnter Start Time:`, defaultStartTime);
          if (!sTime) return;
          sm = validateTime(sTime, true);
          if (sm !== null) break;
        }
        while (true) {
          eTime = prompt(`Enter End Time:`, defaultEndTime);
          if (!eTime) return;
          em = validateTime(eTime, false);
          if (em !== null && em > sm) break;
          alert("End time must be after start time.");
        }

        newEvent = {
          id:`evt_${Math.random().toString(36).slice(2,9)}`,
          type:eventType,
          event:eventName,
          division:divName,
          startTime:sTime,
          endTime:eTime
        };
      }

      dailyOverrideSkeleton.push(newEvent);
      saveDailySkeleton();

      renderGrid(gridContainer);
    };
  });
}

// ----------------------------------------------------------------------
// REMOVE EVENTS
// ----------------------------------------------------------------------
function addRemoveListeners(gridContainer) {
  gridContainer.querySelectorAll('.grid-event').forEach(tile => {
    tile.onclick = (e) => {
      e.stopPropagation();
      const id = tile.dataset.eventId;
      if (!id) return;

      const ev = dailyOverrideSkeleton.find(x => x.id === id);
      if (confirm(`Remove "${ev?.event || 'event'}"?`)) {
        dailyOverrideSkeleton = dailyOverrideSkeleton.filter(ev => ev.id !== id);
        saveDailySkeleton();
        renderGrid(gridContainer);
      }
    };
  });
}

// ----------------------------------------------------------------------
// RENDER EVENT TILE
// ----------------------------------------------------------------------
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
  let extraStyle = '';

  if (event.type === 'pinned' && tile && tile.type === 'custom') {
    extraStyle = 'background:#455a64;color:white;border:1px solid #000;';
  }

  let inner = `<strong>${event.event}</strong><br><div style="font-size:.85em;">${event.startTime} - ${event.endTime}</div>`;
  
  if (event.type === 'smart' && event.smartData) {
    inner += `<br>
      <div style="font-size:0.75em;border-top:1px dotted #01579b;margin-top:2px;padding-top:1px;">
        Fallback: ${event.smartData.fallbackActivity}
        For: ${event.smartData.fallbackFor}
      </div>`;
  }

  return `
    <div class="grid-event"
         data-event-id="${event.id}"
         title="Click to remove"
         style="${extraStyle || style};
                padding:2px 5px;border-radius:4px;text-align:center;
                margin:0 1px;font-size:.9em;position:absolute;
                top:${top}px;height:${height}px;width:calc(100% - 4px);
                box-sizing:border-box;overflow:hidden;cursor:pointer;">
      ${inner}
    </div>`;
}

// ----------------------------------------------------------------------
// LOADING / SAVING SKELETON
// ----------------------------------------------------------------------
function loadDailySkeleton() {
  const dailyData = window.loadCurrentDailyData?.() || {};
  if (dailyData.manualSkeleton && dailyData.manualSkeleton.length > 0) {
    dailyOverrideSkeleton = JSON.parse(JSON.stringify(dailyData.manualSkeleton));
    return;
  }

  const assignments = masterSettings.app1.skeletonAssignments || {};
  const skeletons = masterSettings.app1.savedSkeletons || {};
  const dateStr = window.currentScheduleDate || "";
  const [y,m,d] = dateStr.split('-').map(Number);
  let dow = 0;
  if (y && m && d) dow = new Date(y, m-1, d).getDay();
  const dayNames = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const todayName = dayNames[dow];

  let templateName = assignments[todayName];
  if (!templateName || !skeletons[templateName]) {
    templateName = assignments["Default"];
  }

  const skel = skeletons[templateName];
  dailyOverrideSkeleton = skel ? JSON.parse(JSON.stringify(skel)) : [];
}

function saveDailySkeleton() {
  window.saveCurrentDailyData?.("manualSkeleton", dailyOverrideSkeleton);
}

// ----------------------------------------------------------------------
// RUN OPTIMIZER
// ----------------------------------------------------------------------
function runOptimizer() {
  if (!window.runSkeletonOptimizer) {
    alert("Error: 'runSkeletonOptimizer' missing.");
    return;
  }

  if (dailyOverrideSkeleton.length === 0) {
    alert("Skeleton is empty.");
    return;
  }

  saveDailySkeleton();

  const success = window.runSkeletonOptimizer(dailyOverrideSkeleton, currentOverrides);
  if (success) {
    alert("Schedule Generated Successfully!");
    window.showTab?.('schedule');
  } else {
    alert("Error during schedule generation.");
  }
}

// =================================================================
// BEGIN: DAILY ADJUSTMENTS MAIN UI
// =================================================================

function init() {
  container = document.getElementById("daily-adjustments-content");
  if (!container) {
    console.error("Daily Adjustments: container not found");
    return;
  }

  console.log("Daily Adjustments: Initializing for", window.currentScheduleDate);

  // Load all data
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
    <div style="padding:10px 15px;background:#fff;border:1px solid #ddd;border-radius:8px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:center;">
      <div>
        <h2 style="margin:0 0 5px 0;">Daily Adjustments for ${window.currentScheduleDate}</h2>
        <p style="margin:0;font-size:0.9em;color:#555;">Make final changes to the day's template and run the optimizer.</p>
      </div>
      <button id="run-optimizer-btn"
              style="background:#28a745;color:white;padding:12px 20px;font-size:1.2em;border:none;border-radius:5px;cursor:pointer;white-space:nowrap;">
        Run Optimizer & Create Schedule
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
        <h3>Daily Skeleton Override</h3>
        <p style="font-size:0.9em;color:#555;">Modify the schedule layout for <strong>this day only</strong>.</p>
        <div id="override-scheduler-content"></div>
      </div>
    </div>

    <div id="da-pane-trips" class="da-tab-pane league-content-pane">
      <div class="override-section" id="daily-trips-section">
        <h3>Daily Trips (Adds to Skeleton)</h3>
        <div id="trips-form-container"></div>
      </div>
    </div>

    <div id="da-pane-bunk-specific" class="da-tab-pane league-content-pane">
      <div class="override-section" id="daily-bunk-overrides-section">
        <h3>Bunk-Specific Pinned Activities</h3>
        <p style="font-size:0.9em;color:#555;">Assign a specific activity to one or more bunks at a specific time.</p>
        <div id="bunk-overrides-container"></div>
      </div>
    </div>

    <div id="da-pane-resources" class="da-tab-pane league-content-pane">
      <div class="override-section" id="other-overrides-section">
        <h3>Daily Resource Availability</h3>
        <p style="font-size:0.9em;color:#555;">Disable fields, leagues, or activities for <strong>this day only</strong>.</p>
        <div id="resource-overrides-container"></div>
      </div>
    </div>

    <style>
      .grid-disabled{
        position:absolute;
        width:100%;
        background-color:#80808040;
        background-image:linear-gradient(-45deg,#0000001a 25%,transparent 25%,transparent 50%,#0000001a 50%,#0000001a 75%,transparent 75%,transparent);
        background-size:20px 20px;
        z-index:1;
        pointer-events:none;
      }
      .grid-event{z-index:2;position:relative;}
      .master-list .list-item{
        padding:10px 8px;
        border:1px solid #ddd;
        border-radius:5px;
        margin-bottom:3px;
        cursor:pointer;
        background:#fff;
        font-size:.95em;
        display:flex;
        justify-content:space-between;
        align-items:center;
      }
      .master-list .list-item:hover{background:#f9f9f9;}
      .master-list .list-item.selected{
        background:#e7f3ff;
        border-color:#007bff;
      }
      .master-list .list-item-name{
        font-weight:600;
        flex-grow:1;
      }
      .master-list .list-item.selected .list-item-name{
        font-weight:700;
      }
      .detail-pane{
        border:1px solid #ccc;
        border-radius:8px;
        padding:20px;
        background:#fdfdfd;
        min-height:300px;
      }
      .sport-override-list{
        margin-top:15px;
        padding-top:15px;
        border-top:1px solid #eee;
      }
      .sport-override-list label{
        display:block;
        margin:5px 0 5px 10px;
        font-size:1.0em;
      }
      .sport-override-list label input{
        margin-right:8px;
        vertical-align:middle;
      }
    </style>
  `;

  document.getElementById("run-optimizer-btn").onclick = runOptimizer;

  container.querySelectorAll('.da-tabs-nav .tab-button').forEach(btn => {
    btn.onclick = () => {
      container.querySelectorAll('.da-tabs-nav .tab-button')
        .forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      container.querySelectorAll('.da-tab-pane')
        .forEach(p => p.classList.remove('active'));
      container.querySelector(`#da-pane-${btn.dataset.tab}`).classList.add('active');
    };
  });

  // ASSIGN CONTAINERS AFTER HTML INJECTION (CRITICAL FIX)
  skeletonContainer = document.getElementById("override-scheduler-content");
  tripsFormContainer = document.getElementById("trips-form-container");
  bunkOverridesContainer = document.getElementById("bunk-overrides-container");
  resourceOverridesContainer = document.getElementById("resource-overrides-container");

  initDailySkeletonUI();
  renderTripsForm();
  renderBunkOverridesUI();
  renderResourceOverridesUI();
}

// ----------------------------------------------------------------------
// SKELETON TAB UI
// ----------------------------------------------------------------------
function initDailySkeletonUI() {
  if (!skeletonContainer) return;
  loadDailySkeleton();
  skeletonContainer.innerHTML = `
    <div id="daily-skeleton-palette"
         style="padding:10px;background:#f4f4f4;border-radius:8px;margin-bottom:15px;display:flex;flex-wrap:wrap;gap:10px;"></div>
    <div id="daily-skeleton-grid"
         style="overflow-x:auto;border:1px solid #999;max-height:600px;overflow-y:auto;"></div>
  `;
  const palette = document.getElementById("daily-skeleton-palette");
  const grid = document.getElementById("daily-skeleton-grid");
  renderPalette(palette);
  renderGrid(grid);
}

// ----------------------------------------------------------------------
// TRIPS TAB UI
// ----------------------------------------------------------------------
function renderTripsForm() {
  if (!tripsFormContainer) return;
  tripsFormContainer.innerHTML = "";
  const form = document.createElement('div');
  form.style.border = '1px solid #ccc';
  form.style.padding = '15px';
  form.style.borderRadius = '8px';

  form.innerHTML = `
    <label for="tripName" style="display:block;margin-bottom:5px;font-weight:600;">Trip Name:</label>
    <input type="text" id="tripName" placeholder="e.g., Museum Trip" style="width:250px;">

    <label for="tripStart" style="display:block;margin-top:10px;font-weight:600;">Start Time:</label>
    <input id="tripStart" placeholder="e.g., 9:00am" style="margin-right:8px;">

    <label for="tripEnd" style="display:block;margin-top:10px;font-weight:600;">End Time:</label>
    <input id="tripEnd" placeholder="e.g., 2:00pm" style="margin-right:8px;">

    <p style="margin-top:15px;font-weight:600;">Select Divisions:</p>
  `;

  const divisions = masterSettings.app1.divisions || {};
  const availableDivisions = masterSettings.app1.availableDivisions || [];

  const chipBox = document.createElement('div');
  chipBox.className = 'chips';
  chipBox.style.marginBottom = '5px';

  availableDivisions.forEach(divName => {
    const chip = createChip(divName, divisions[divName]?.color || '#333', true);
    chipBox.appendChild(chip);
  });

  form.appendChild(chipBox);

  const addBtn = document.createElement('button');
  addBtn.textContent = 'Add Trip to Skeleton';
  addBtn.className = 'bunk-button';
  addBtn.style.background = '#007BFF';
  addBtn.style.color = 'white';
  addBtn.style.marginTop = '15px';

  addBtn.onclick = () => {
    const name = form.querySelector('#tripName').value.trim();
    const start = form.querySelector('#tripStart').value;
    const end = form.querySelector('#tripEnd').value;
    const selectedDivs = Array.from(chipBox.querySelectorAll('.selected'))
      .map(el => el.dataset.value);

    if (!name || !start || !end) {
      alert('Please enter a name, start, and end time.');
      return;
    }
    if (selectedDivs.length === 0) {
      alert('Select at least one division.');
      return;
    }

    const sMin = parseTimeToMinutes(start);
    const eMin = parseTimeToMinutes(end);
    if (sMin == null || eMin == null || eMin <= sMin) {
      alert('Invalid time range.');
      return;
    }

    loadDailySkeleton();

    dailyOverrideSkeleton = dailyOverrideSkeleton.filter(item => {
      if (!selectedDivs.includes(item.division)) return true;
      const iS = parseTimeToMinutes(item.startTime);
      const iE = parseTimeToMinutes(item.endTime);
      if (iS == null || iE == null) return true;
      const overlap = (iS < eMin) && (iE > sMin);
      return !overlap;
    });

    selectedDivs.forEach(divName => {
      dailyOverrideSkeleton.push({
        id:`evt_${Math.random().toString(36).slice(2,9)}`,
        type:'pinned',
        event:name,
        division:divName,
        startTime:start,
        endTime:end
      });
    });

    saveDailySkeleton();

    // Re-render if grid is currently visible
    const grid = skeletonContainer.querySelector('#daily-skeleton-grid');
    if (grid) renderGrid(grid);

    form.querySelector('#tripName').value = "";
    form.querySelector('#tripStart').value = "";
    form.querySelector('#tripEnd').value = "";
    chipBox.querySelectorAll('.selected').forEach(c => c.click());
  };

  form.appendChild(addBtn);
  tripsFormContainer.appendChild(form);
}

// ----------------------------------------------------------------------
// BUNK-SPECIFIC TAB UI
// ----------------------------------------------------------------------
function renderBunkOverridesUI() {
  if (!bunkOverridesContainer) return;
  bunkOverridesContainer.innerHTML = "";

  const divisions = masterSettings.app1.divisions || {};
  const availableDivisions = masterSettings.app1.availableDivisions || [];
  const bunksByDiv = {};
  availableDivisions.forEach(divName => {
    bunksByDiv[divName] = (divisions[divName]?.bunks || []).sort();
  });

  const allFields = (masterSettings.app1.fields || []).map(f => f.name);
  const allSports = (masterSettings.app1.fields || []).flatMap(f => f.activities || []);
  const allSpecials = (masterSettings.app1.specialActivities || []).map(s => s.name);
  const allActivities = [...new Set([...allSports, ...allSpecials, ...allFields])].sort();

  const form = document.createElement('div');
  form.style.border = '1px solid #ccc';
  form.style.padding = '15px';
  form.style.borderRadius = '8px';
  form.style.marginBottom = '20px';

  let activityOptions = `<option value="">-- Select an Activity --</option>`;
  allActivities.forEach(a => {
    activityOptions += `<option value="${a}">${a}</option>`;
  });

  form.innerHTML = `
    <label style="display:block;margin-bottom:5px;font-weight:600;">Activity / Field:</label>
    <select id="bunk-override-activity" style="width:250px;padding:5px;">${activityOptions}</select>

    <label style="display:block;margin-top:10px;font-weight:600;">Start Time:</label>
    <input id="bunk-override-start" placeholder="e.g., 9:00am" style="margin-right:8px;">

    <label style="display:block;margin-top:10px;font-weight:600;">End Time:</label>
    <input id="bunk-override-end" placeholder="e.g., 10:00am" style="margin-right:8px;">

    <p style="margin-top:15px;font-weight:600;">Select Bunks:</p>
  `;

  availableDivisions.forEach(divName => {
    const label = document.createElement('div');
    label.textContent = divName;
    label.style.fontWeight = 'bold';
    label.style.marginTop = '8px';
    form.appendChild(label);

    const chipBox = document.createElement('div');
    chipBox.className = 'chips';
    bunksByDiv[divName].forEach(bunk => {
      const chip = createChip(bunk, divisions[divName]?.color || '#ccc');
      chipBox.appendChild(chip);
    });

    form.appendChild(chipBox);
  });

  const addBtn = document.createElement('button');
  addBtn.textContent = 'Add Pinned Activity';
  addBtn.className = 'bunk-button';
  addBtn.style.background = '#007BFF';
  addBtn.style.color = 'white';
  addBtn.style.marginTop = '15px';

  addBtn.onclick = () => {
    const activity = form.querySelector('#bunk-override-activity').value;
    const start = form.querySelector('#bunk-override-start').value;
    const end = form.querySelector('#bunk-override-end').value;
    const selected = Array.from(form.querySelectorAll('.bunk-button.selected'))
      .map(el => el.dataset.value);

    if (!activity) { alert('Select an activity.'); return; }
    if (!start || !end) { alert('Enter a time range.'); return; }
    if (selected.length === 0) { alert('Select at least one bunk.'); return; }

    const sMin = parseTimeToMinutes(start);
    const eMin = parseTimeToMinutes(end);
    if (sMin == null || eMin == null || eMin <= sMin) {
      alert('Invalid time range.');
      return;
    }

    const overrides = window.loadCurrentDailyData?.().bunkActivityOverrides || [];

    selected.forEach(bunk => {
      overrides.push({
        id:uid(),
        bunk,
        activity,
        startTime:start,
        endTime:end
      });
    });

    window.saveCurrentDailyData("bunkActivityOverrides", overrides);
    currentOverrides.bunkActivityOverrides = overrides;

    form.querySelector('#bunk-override-activity').value = "";
    form.querySelector('#bunk-override-start').value = "";
    form.querySelector('#bunk-override-end').value = "";
    form.querySelectorAll('.bunk-button.selected').forEach(c => c.click());

    renderBunkOverridesUI();
  };

  form.appendChild(addBtn);
  bunkOverridesContainer.appendChild(form);

  const listContainer = document.createElement('div');
  listContainer.id = "bunk-overrides-list-container";

  const overrides = currentOverrides.bunkActivityOverrides;
  if (overrides.length === 0) {
    listContainer.innerHTML = `<p class="muted">No bunk-specific activities yet.</p>`;
  } else {
    overrides.forEach(item => {
      const el = document.createElement('div');
      el.className = 'item';
      el.innerHTML = `
        <div style="flex-grow:1;">
          <div><strong>${item.bunk}</strong> → ${item.activity}</div>
          <div class="muted" style="font-size:0.9em;">${item.startTime} - ${item.endTime}</div>
        </div>
        <button data-id="${item.id}"
                style="padding:6px 10px;border-radius:4px;cursor:pointer;background:#c0392b;color:white;border:none;">
          Remove
        </button>
      `;
      el.querySelector('button').onclick = () => {
        let list = window.loadCurrentDailyData?.().bunkActivityOverrides || [];
        list = list.filter(o => o.id !== item.id);
        window.saveCurrentDailyData("bunkActivityOverrides", list);
        currentOverrides.bunkActivityOverrides = list;
        renderBunkOverridesUI();
      };
      listContainer.appendChild(el);
    });
  }

  bunkOverridesContainer.appendChild(listContainer);
}

// ----------------------------------------------------------------------
// RESOURCE AVAILABILITY TAB UI
// ----------------------------------------------------------------------
function renderResourceOverridesUI() {
  if (!resourceOverridesContainer) return;
  resourceOverridesContainer.innerHTML = `
    <div style="display:flex;flex-wrap:wrap;gap:20px;">
      <div style="flex:1;min-width:300px;">
        <h4>Fields</h4><div id="override-fields-list" class="master-list"></div>
        <h4 style="margin-top:15px;">Special Activities</h4><div id="override-specials-list" class="master-list"></div>
        <h4 style="margin-top:15px;">Leagues</h4><div id="override-leagues-list" class="master-list"></div>
        <h4 style="margin-top:15px;">Specialty Leagues</h4><div id="override-specialty-leagues-list" class="master-list"></div>
      </div>
      <div style="flex:2;min-width:400px;position:sticky;top:20px;">
        <h4>Details</h4>
        <div id="override-detail-pane" class="detail-pane">
          <p class="muted">Select an item from the left to edit its details.</p>
        </div>
      </div>
    </div>
  `;

  const fieldsListEl = document.getElementById("override-fields-list");
  const specialsListEl = document.getElementById("override-specials-list");
  const leaguesListEl = document.getElementById("override-leagues-list");
  const specialtyListEl = document.getElementById("override-specialty-leagues-list");

  const saveOverrides = () => {
    const dailyData = window.loadCurrentDailyData?.() || {};
    const full = dailyData.overrides || {};
    full.leagues = currentOverrides.leagues;
    full.disabledFields = currentOverrides.disabledFields;
    full.disabledSpecials = currentOverrides.disabledSpecials;
    window.saveCurrentDailyData("overrides", full);
  };

  // ------------------------------
  // Fields
  // ------------------------------
  const fields = masterSettings.app1.fields || [];
  if (fields.length === 0) {
    fieldsListEl.innerHTML = `<p class="muted" style="font-size:0.9em;">No fields in Setup.</p>`;
  }

  fields.forEach(item => {
    const enabled = !currentOverrides.disabledFields.includes(item.name);
    const onToggle = (isEnabled) => {
      if (isEnabled)
        currentOverrides.disabledFields = currentOverrides.disabledFields.filter(n => n !== item.name);
      else if (!currentOverrides.disabledFields.includes(item.name))
        currentOverrides.disabledFields.push(item.name);

      saveOverrides();
    };

    fieldsListEl.appendChild(
      createOverrideMasterListItem('field', item.name, enabled, onToggle)
    );
  });

  // ------------------------------
  // Special Activities
  // ------------------------------
  const specialActs = masterSettings.app1.specialActivities || [];
  if (specialActs.length === 0) {
    specialsListEl.innerHTML = `<p class="muted" style="font-size:0.9em;">No specials in Setup.</p>`;
  }

  specialActs.forEach(item => {
    const enabled = !currentOverrides.disabledSpecials.includes(item.name);
    const onToggle = (isEnabled) => {
      if (isEnabled)
        currentOverrides.disabledSpecials = currentOverrides.disabledSpecials.filter(n => n !== item.name);
      else if (!currentOverrides.disabledSpecials.includes(item.name))
        currentOverrides.disabledSpecials.push(item.name);

      saveOverrides();
    };

    specialsListEl.appendChild(
      createOverrideMasterListItem('special', item.name, enabled, onToggle)
    );
  });

  // ------------------------------
  // Regular Leagues
  // ------------------------------
  const leagues = masterSettings.leaguesByName || {};
  const leagueNames = Object.keys(leagues);
  if (leagueNames.length === 0) {
    leaguesListEl.innerHTML = `<p class="muted" style="font-size:0.9em;">No leagues in Setup.</p>`;
  }

  leagueNames.forEach(name => {
    const enabled = !currentOverrides.leagues.includes(name);
    const onToggle = (isEnabled) => {
      if (isEnabled)
        currentOverrides.leagues = currentOverrides.leagues.filter(n => n !== name);
      else if (!currentOverrides.leagues.includes(name))
        currentOverrides.leagues.push(name);

      saveOverrides();
    };

    leaguesListEl.appendChild(
      createOverrideMasterListItem('league', name, enabled, onToggle)
    );
  });

  // ------------------------------
  // Specialty Leagues
  // ------------------------------
  const specialty = masterSettings.specialtyLeagues || {};
  const specialtyNames = Object.values(specialty).map(l => l.name).sort();

  if (specialtyNames.length === 0) {
    specialtyListEl.innerHTML = `<p class="muted" style="font-size:0.9em;">No specialty leagues in Setup.</p>`;
  }

  specialtyNames.forEach(name => {
    const enabled = !current
