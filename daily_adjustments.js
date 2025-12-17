// =================================================================
// daily_adjustments.js v3.0 - Polished Edition
// 
// - Smooth, seamless drag & drop with visual preview
// - Modern UI with animations
// - Instant conflict updates
// =================================================================

(function() {
'use strict';

// =================================================================
// STATE
// =================================================================

let masterSettings = {};
let currentOverrides = {};
let dailySkeleton = [];
let displacedTiles = [];

const PX_PER_MIN = 2;

const TILE_DEFS = [
  { type: 'activity', name: 'Activity', color: '#0891b2', bg: '#ecfeff' },
  { type: 'sports', name: 'Sports', color: '#16a34a', bg: '#f0fdf4' },
  { type: 'special', name: 'Special', color: '#059669', bg: '#ecfdf5' },
  { type: 'smart', name: 'Smart Tile', color: '#0284c7', bg: '#e0f2fe', dashed: true },
  { type: 'split', name: 'Split', color: '#ea580c', bg: '#fff7ed' },
  { type: 'league', name: 'League', color: '#7c3aed', bg: '#f5f3ff' },
  { type: 'specialty_league', name: 'Specialty', color: '#ca8a04', bg: '#fefce8' },
  { type: 'swim', name: 'Swim', color: '#2563eb', bg: '#eff6ff' },
  { type: 'lunch', name: 'Lunch', color: '#dc2626', bg: '#fef2f2' },
  { type: 'snacks', name: 'Snacks', color: '#d97706', bg: '#fffbeb' },
  { type: 'dismissal', name: 'Dismissal', color: '#b91c1c', bg: '#b91c1c', text: '#fff' },
  { type: 'custom', name: 'Custom', color: '#4b5563', bg: '#f3f4f6' }
];

// =================================================================
// TIME UTILS
// =================================================================

function parseTime(str) {
  if (!str || typeof str !== 'string') return null;
  let s = str.trim().toLowerCase();
  let mer = null;
  if (s.endsWith('am') || s.endsWith('pm')) {
    mer = s.slice(-2);
    s = s.slice(0, -2).trim();
  }
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  let h = parseInt(m[1]), min = parseInt(m[2]);
  if (isNaN(h) || isNaN(min)) return null;
  if (mer === 'am' && h === 12) h = 0;
  else if (mer === 'pm' && h !== 12) h += 12;
  else if (!mer && h <= 7) h += 12;
  return h * 60 + min;
}

function formatTime(mins) {
  const h = Math.floor(mins / 60), m = mins % 60;
  const hr = h % 12 || 12;
  return `${hr}:${String(m).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`;
}

// =================================================================
// SKELETON LOAD/SAVE
// =================================================================

function loadSkeleton() {
  const data = window.loadCurrentDailyData?.() || {};
  if (data.manualSkeleton?.length) {
    dailySkeleton = JSON.parse(JSON.stringify(data.manualSkeleton));
    return;
  }
  
  const assignments = masterSettings.app1?.skeletonAssignments || {};
  const skeletons = masterSettings.app1?.savedSkeletons || {};
  const dateStr = window.currentScheduleDate || '';
  const [y, mo, d] = dateStr.split('-').map(Number);
  const dayName = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][new Date(y, mo-1, d).getDay()];
  
  const template = skeletons[assignments[dayName]] || skeletons[assignments['Default']] || [];
  dailySkeleton = JSON.parse(JSON.stringify(template));
}

function saveSkeleton() {
  window.saveCurrentDailyData?.('manualSkeleton', dailySkeleton);
}

// =================================================================
// DISPLACED TILES
// =================================================================

function addDisplaced(ev, reason) {
  displacedTiles.push({ ...ev, reason, ts: Date.now() });
  renderDisplaced();
}

function clearDisplaced() {
  displacedTiles = [];
  renderDisplaced();
}

function renderDisplaced() {
  const el = document.getElementById('displaced-panel');
  if (!el) return;
  
  if (!displacedTiles.length) {
    el.innerHTML = '';
    return;
  }
  
  el.innerHTML = `
    <div class="da-displaced">
      <div class="da-displaced-header">
        <span>📋 Displaced (${displacedTiles.length})</span>
        <button onclick="window.clearDisplacedTiles?.()">Clear</button>
      </div>
      <div class="da-displaced-list">
        ${displacedTiles.map(d => `
          <div class="da-displaced-item">
            <strong>${d.event}</strong>
            <span>${d.division} • ${d.startTime}-${d.endTime}</span>
            <span class="da-displaced-reason">${d.reason}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

window.clearDisplacedTiles = clearDisplaced;

// =================================================================
// BUMP LOGIC
// =================================================================

function bumpTiles(newEvent, div) {
  const newS = parseTime(newEvent.startTime), newE = parseTime(newEvent.endTime);
  const divEnd = parseTime(window.divisions?.[div]?.endTime) || 960;
  
  const overlapping = dailySkeleton.filter(ev => {
    if (ev.id === newEvent.id || ev.division !== div) return false;
    const s = parseTime(ev.startTime), e = parseTime(ev.endTime);
    return s != null && e != null && s < newE && e > newS;
  }).sort((a, b) => parseTime(a.startTime) - parseTime(b.startTime));
  
  if (!overlapping.length) return;
  
  let cursor = newE;
  overlapping.forEach(ev => {
    const dur = parseTime(ev.endTime) - parseTime(ev.startTime);
    const end = cursor + dur;
    
    if (end > divEnd) {
      addDisplaced(ev, 'No room');
      dailySkeleton = dailySkeleton.filter(e => e.id !== ev.id);
    } else {
      ev.startTime = formatTime(cursor);
      ev.endTime = formatTime(end);
      cursor = end;
    }
  });
}

// =================================================================
// GRID RENDERING
// =================================================================

function renderGrid() {
  const gridEl = document.getElementById('skeleton-grid');
  if (!gridEl) return;
  
  const divisions = window.divisions || {};
  const divList = window.availableDivisions || [];
  
  let earliest = 540, latest = 960;
  Object.values(divisions).forEach(d => {
    const s = parseTime(d.startTime), e = parseTime(d.endTime);
    if (s != null && s < earliest) earliest = s;
    if (e != null && e > latest) latest = e;
  });
  dailySkeleton.forEach(ev => {
    const e = parseTime(ev.endTime);
    if (e != null && e > latest) latest = e;
  });
  
  const totalH = (latest - earliest) * PX_PER_MIN;
  
  let html = `<div class="da-grid" style="--cols:${divList.length + 1}">`;
  
  // Headers
  html += `<div class="da-grid-header da-time-header">Time</div>`;
  divList.forEach(name => {
    html += `<div class="da-grid-header" style="--div-color:${divisions[name]?.color || '#6b7280'}">${name}</div>`;
  });
  
  // Time column
  html += `<div class="da-time-col" style="height:${totalH}px">`;
  for (let t = earliest; t < latest; t += 30) {
    html += `<div class="da-time-mark" style="top:${(t - earliest) * PX_PER_MIN}px">${formatTime(t)}</div>`;
  }
  html += `</div>`;
  
  // Division columns
  divList.forEach(name => {
    const div = divisions[name] || {};
    const dS = parseTime(div.startTime) ?? earliest;
    const dE = parseTime(div.endTime) ?? latest;
    
    html += `<div class="da-col" data-div="${name}" data-earliest="${earliest}" style="height:${totalH}px">`;
    
    // Grey areas
    if (dS > earliest) html += `<div class="da-col-disabled" style="top:0;height:${(dS - earliest) * PX_PER_MIN}px"></div>`;
    if (dE < latest) html += `<div class="da-col-disabled" style="top:${(dE - earliest) * PX_PER_MIN}px;height:${(latest - dE) * PX_PER_MIN}px"></div>`;
    
    // Events
    dailySkeleton.filter(ev => ev.division === name).forEach(ev => {
      const s = parseTime(ev.startTime), e = parseTime(ev.endTime);
      if (s == null || e == null) return;
      
      const top = Math.max(0, s - earliest) * PX_PER_MIN;
      const h = (Math.min(e, latest) - Math.max(s, earliest)) * PX_PER_MIN;
      if (h <= 0) return;
      
      const def = TILE_DEFS.find(t => t.type === ev.type || t.name === ev.event) || TILE_DEFS.find(t => t.type === 'custom');
      
      html += `
        <div class="da-event" data-id="${ev.id}" style="top:${top}px;height:${h}px;--tile-color:${def.color};--tile-bg:${def.bg};${def.text ? `--tile-text:${def.text};` : ''}${def.dashed ? '--tile-border:dashed;' : ''}">
          <div class="da-event-name">${ev.event}</div>
          <div class="da-event-time">${ev.startTime} - ${ev.endTime}</div>
          ${ev.reservedFields?.length ? `<div class="da-event-field">📍 ${ev.reservedFields.join(', ')}</div>` : ''}
        </div>
      `;
    });
    
    // Drop preview zone
    html += `<div class="da-drop-preview"></div>`;
    html += `</div>`;
  });
  
  html += `</div>`;
  gridEl.innerHTML = html;
  
  setupDrag();
  setupRemove();
  highlightConflicts();
  
  if (window.SkeletonSandbox) {
    window.SkeletonSandbox.renderBanner('#skeleton-section', dailySkeleton, renderGrid);
  }
}

// =================================================================
// SMOOTH DRAG & DROP
// =================================================================

function setupDrag() {
  const gridEl = document.getElementById('skeleton-grid');
  if (!gridEl) return;
  
  // Ensure ghost exists
  let ghost = document.getElementById('da-ghost');
  if (!ghost) {
    ghost = document.createElement('div');
    ghost.id = 'da-ghost';
    ghost.className = 'da-ghost';
    document.body.appendChild(ghost);
  }
  
  let dragData = null;
  
  // Make events draggable
  gridEl.querySelectorAll('.da-event').forEach(el => {
    el.draggable = true;
    
    el.addEventListener('dragstart', e => {
      const id = el.dataset.id;
      const ev = dailySkeleton.find(x => x.id === id);
      if (!ev) return;
      
      const dur = parseTime(ev.endTime) - parseTime(ev.startTime);
      dragData = { id, event: ev, duration: dur, type: 'move' };
      
      // Set data
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', id);
      
      // Custom ghost
      ghost.innerHTML = `<strong>${ev.event}</strong><br><span>${ev.startTime} - ${ev.endTime}</span>`;
      ghost.style.display = 'block';
      ghost.style.left = e.pageX + 12 + 'px';
      ghost.style.top = e.pageY + 12 + 'px';
      
      // Hide default ghost
      const img = new Image();
      img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
      e.dataTransfer.setDragImage(img, 0, 0);
      
      el.classList.add('da-dragging');
    });
    
    el.addEventListener('drag', e => {
      if (e.pageX === 0 && e.pageY === 0) return;
      ghost.style.left = e.pageX + 12 + 'px';
      ghost.style.top = e.pageY + 12 + 'px';
    });
    
    el.addEventListener('dragend', () => {
      el.classList.remove('da-dragging');
      ghost.style.display = 'none';
      dragData = null;
      gridEl.querySelectorAll('.da-col').forEach(c => {
        c.classList.remove('da-col-over');
        c.querySelector('.da-drop-preview').style.display = 'none';
      });
    });
  });
  
  // Palette tiles
  document.querySelectorAll('.da-palette-tile').forEach(el => {
    el.draggable = true;
    
    el.addEventListener('dragstart', e => {
      const type = el.dataset.type;
      const def = TILE_DEFS.find(t => t.type === type);
      dragData = { type: 'new', tileDef: def, duration: 60 };
      
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData('application/tile', type);
      
      ghost.innerHTML = `<strong>${def.name}</strong><br><span>New tile</span>`;
      ghost.style.display = 'block';
      ghost.style.left = e.pageX + 12 + 'px';
      ghost.style.top = e.pageY + 12 + 'px';
      
      const img = new Image();
      img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
      e.dataTransfer.setDragImage(img, 0, 0);
      
      el.classList.add('da-dragging');
    });
    
    el.addEventListener('drag', e => {
      if (e.pageX === 0 && e.pageY === 0) return;
      ghost.style.left = e.pageX + 12 + 'px';
      ghost.style.top = e.pageY + 12 + 'px';
    });
    
    el.addEventListener('dragend', () => {
      el.classList.remove('da-dragging');
      ghost.style.display = 'none';
      dragData = null;
    });
  });
  
  // Drop zones
  gridEl.querySelectorAll('.da-col').forEach(col => {
    const preview = col.querySelector('.da-drop-preview');
    const earliest = parseInt(col.dataset.earliest);
    
    col.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = dragData?.type === 'move' ? 'move' : 'copy';
      col.classList.add('da-col-over');
      
      // Calculate drop position
      const rect = col.getBoundingClientRect();
      const y = e.clientY - rect.top + col.scrollTop;
      const snapMin = Math.round(y / PX_PER_MIN / 15) * 15;
      const dur = dragData?.duration || 60;
      
      // Show preview
      preview.style.display = 'block';
      preview.style.top = snapMin * PX_PER_MIN + 'px';
      preview.style.height = dur * PX_PER_MIN + 'px';
      preview.textContent = formatTime(earliest + snapMin);
    });
    
    col.addEventListener('dragleave', e => {
      if (!col.contains(e.relatedTarget)) {
        col.classList.remove('da-col-over');
        preview.style.display = 'none';
      }
    });
    
    col.addEventListener('drop', e => {
      e.preventDefault();
      col.classList.remove('da-col-over');
      preview.style.display = 'none';
      
      const divName = col.dataset.div;
      const rect = col.getBoundingClientRect();
      const y = e.clientY - rect.top + col.scrollTop;
      const snapMin = Math.round(y / PX_PER_MIN / 15) * 15;
      const newStartMin = earliest + snapMin;
      
      if (dragData?.type === 'move') {
        // Move existing event
        const ev = dailySkeleton.find(x => x.id === dragData.id);
        if (!ev) return;
        
        ev.division = divName;
        ev.startTime = formatTime(newStartMin);
        ev.endTime = formatTime(newStartMin + dragData.duration);
        
        bumpTiles(ev, divName);
        saveSkeleton();
        renderGrid();
        
      } else if (dragData?.type === 'new') {
        // Create new event
        promptNewEvent(dragData.tileDef, divName, formatTime(newStartMin));
      }
    });
  });
}

function setupRemove() {
  document.querySelectorAll('.da-event').forEach(el => {
    el.addEventListener('dblclick', e => {
      e.stopPropagation();
      const ev = dailySkeleton.find(x => x.id === el.dataset.id);
      if (ev && confirm(`Remove "${ev.event}"?`)) {
        dailySkeleton = dailySkeleton.filter(x => x.id !== el.dataset.id);
        saveSkeleton();
        renderGrid();
      }
    });
  });
}

function highlightConflicts() {
  if (!window.SkeletonSandbox) return;
  
  const conflicts = window.SkeletonSandbox.detectConflicts(dailySkeleton);
  const map = {};
  
  conflicts.forEach(c => {
    if (c.event1?.id) map[c.event1.id] = map[c.event1.id] === 'critical' ? 'critical' : c.type;
    if (c.event2?.id) map[c.event2.id] = map[c.event2.id] === 'critical' ? 'critical' : c.type;
  });
  
  document.querySelectorAll('.da-event').forEach(el => {
    el.classList.remove('conflict-critical', 'conflict-warning');
    if (map[el.dataset.id]) el.classList.add(`conflict-${map[el.dataset.id]}`);
  });
}

window.refreshSkeletonConflicts = renderGrid;

// =================================================================
// NEW EVENT PROMPT
// =================================================================

function promptNewEvent(tileDef, division, defaultStart) {
  const overlay = document.createElement('div');
  overlay.className = 'da-overlay';
  
  const modal = document.createElement('div');
  modal.className = 'da-modal da-modal-sm';
  modal.innerHTML = `
    <div class="da-modal-header">
      <h3>Add ${tileDef.name}</h3>
      <button class="da-close">&times;</button>
    </div>
    <div class="da-modal-body">
      <div class="da-field"><label>Division</label><strong>${division}</strong></div>
      ${tileDef.type === 'custom' ? `<div class="da-field"><label>Event Name</label><input type="text" id="new-name" placeholder="e.g., Regroup"></div>` : ''}
      <div class="da-field-row">
        <div class="da-field"><label>Start</label><input type="text" id="new-start" value="${defaultStart}"></div>
        <div class="da-field"><label>End</label><input type="text" id="new-end" placeholder="e.g., 10:30am"></div>
      </div>
    </div>
    <div class="da-modal-footer">
      <button class="da-btn-cancel">Cancel</button>
      <button class="da-btn-primary">Add</button>
    </div>
  `;
  
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  
  const close = () => overlay.remove();
  modal.querySelector('.da-close').onclick = close;
  modal.querySelector('.da-btn-cancel').onclick = close;
  overlay.onclick = e => { if (e.target === overlay) close(); };
  
  setTimeout(() => modal.querySelector('#new-end')?.focus(), 50);
  
  modal.querySelector('.da-btn-primary').onclick = () => {
    const startTime = modal.querySelector('#new-start').value.trim();
    const endTime = modal.querySelector('#new-end').value.trim();
    const customName = modal.querySelector('#new-name')?.value.trim();
    
    if (!startTime || !endTime) { alert('Enter times.'); return; }
    const sMin = parseTime(startTime), eMin = parseTime(endTime);
    if (sMin == null || eMin == null) { alert('Invalid time format.'); return; }
    if (eMin <= sMin) { alert('End must be after start.'); return; }
    
    let name = tileDef.name;
    let type = tileDef.type;
    
    if (tileDef.type === 'activity') name = 'General Activity Slot';
    else if (tileDef.type === 'sports') name = 'Sports Slot';
    else if (tileDef.type === 'special') name = 'Special Activity';
    else if (tileDef.type === 'custom') name = customName || 'Custom Event';
    else if (tileDef.type === 'league') { name = 'League Game'; type = 'league'; }
    else if (tileDef.type === 'specialty_league') { name = 'Specialty League'; type = 'specialty_league'; }
    else if (['swim', 'lunch', 'snacks', 'dismissal'].includes(tileDef.type)) type = tileDef.type;
    
    const newEv = {
      id: `evt_${Math.random().toString(36).slice(2, 9)}`,
      type: ['activity','sports','special'].includes(type) ? 'slot' : type,
      event: name,
      division,
      startTime, endTime,
      reservedFields: []
    };
    
    dailySkeleton.push(newEv);
    bumpTiles(newEv, division);
    saveSkeleton();
    renderGrid();
    close();
  };
}

// =================================================================
// PALETTE
// =================================================================

function renderPalette() {
  const el = document.getElementById('tile-palette');
  if (!el) return;
  
  el.innerHTML = TILE_DEFS.map(t => `
    <div class="da-palette-tile" data-type="${t.type}" style="--tile-color:${t.color};--tile-bg:${t.bg};${t.dashed ? '--tile-border:dashed;' : ''}" title="${t.name}">
      ${t.name}
    </div>
  `).join('');
}

// =================================================================
// TRIPS FORM
// =================================================================

function renderTrips() {
  const el = document.getElementById('trips-section');
  if (!el) return;
  
  const divs = window.availableDivisions || [];
  
  el.innerHTML = `
    <div class="da-form-card">
      <h3>Add Trip</h3>
      <p class="da-hint">Off-campus trip. Overlapping tiles bump down.</p>
      <div class="da-field"><label>Division</label><select id="trip-div"><option value="">Select...</option>${divs.map(d=>`<option>${d}</option>`).join('')}</select></div>
      <div class="da-field"><label>Trip Name</label><input type="text" id="trip-name" placeholder="e.g., Six Flags"></div>
      <div class="da-field-row">
        <div class="da-field"><label>Depart</label><input type="text" id="trip-start" placeholder="9:30am"></div>
        <div class="da-field"><label>Return</label><input type="text" id="trip-end" placeholder="3:30pm"></div>
      </div>
      <button id="add-trip" class="da-btn-primary da-btn-full">Add Trip</button>
    </div>
  `;
  
  document.getElementById('add-trip').onclick = () => {
    const div = document.getElementById('trip-div').value;
    const name = document.getElementById('trip-name').value.trim();
    const start = document.getElementById('trip-start').value.trim();
    const end = document.getElementById('trip-end').value.trim();
    
    if (!div || !name || !start || !end) { alert('Fill all fields.'); return; }
    const sMin = parseTime(start), eMin = parseTime(end);
    if (sMin == null || eMin == null) { alert('Invalid time.'); return; }
    if (eMin <= sMin) { alert('Return must be after departure.'); return; }
    
    const newEv = {
      id: `trip_${Math.random().toString(36).slice(2, 9)}`,
      type: 'pinned',
      event: name,
      division: div,
      startTime: start, endTime: end,
      reservedFields: []
    };
    
    dailySkeleton.push(newEv);
    bumpTiles(newEv, div);
    saveSkeleton();
    
    document.querySelector('[data-tab="skeleton"]')?.click();
    renderGrid();
    
    const conflicts = window.SkeletonSandbox?.detectConflicts(dailySkeleton) || [];
    alert(conflicts.length ? `Trip added! ${conflicts.length} conflict(s).` : 'Trip added!');
    
    document.getElementById('trip-name').value = '';
    document.getElementById('trip-start').value = '';
    document.getElementById('trip-end').value = '';
  };
}

// =================================================================
// BUNK OVERRIDES
// =================================================================

function renderBunkOverrides() {
  const el = document.getElementById('bunks-section');
  if (!el) return;
  
  const divisions = window.divisions || {};
  const divList = window.availableDivisions || [];
  const bunks = [];
  divList.forEach(n => { const d = divisions[n]; if (d?.bunks) d.bunks.forEach(b => bunks.push({ name: b, div: n, color: d.color })); });
  
  const sports = [];
  (masterSettings.app1?.fields || []).forEach(f => (f.activities || []).forEach(s => { if (!sports.includes(s)) sports.push(s); }));
  const specials = (masterSettings.app1?.specialActivities || []).map(s => s.name);
  
  el.innerHTML = `
    <div class="da-form-card">
      <h3>Bunk-Specific Override</h3>
      <p class="da-hint">Assign activity to specific bunks.</p>
      <div class="da-field"><label>Type</label><select id="bo-type"><option value="">Select...</option><option value="sport">Sport</option><option value="special">Special Activity</option><option value="trip">Personal Trip</option></select></div>
      <div class="da-field" id="bo-act-wrap" style="display:none"><label>Activity</label><select id="bo-activity"></select></div>
      <div class="da-field" id="bo-trip-wrap" style="display:none"><label>Trip Name</label><input type="text" id="bo-trip-name" placeholder="e.g., Doctor"></div>
      <div class="da-field-row">
        <div class="da-field"><label>Start</label><input type="text" id="bo-start" placeholder="10:00am"></div>
        <div class="da-field"><label>End</label><input type="text" id="bo-end" placeholder="11:00am"></div>
      </div>
      <div class="da-field"><label>Select Bunks</label><div class="da-chips">${bunks.map(b => `<button class="da-chip" data-bunk="${b.name}" style="--chip-color:${b.color}">${b.name}</button>`).join('')}</div></div>
      <button id="bo-apply" class="da-btn-primary da-btn-full">Apply</button>
      <div id="bo-existing"></div>
    </div>
  `;
  
  document.getElementById('bo-type').onchange = e => {
    const t = e.target.value;
    document.getElementById('bo-act-wrap').style.display = t === 'sport' || t === 'special' ? 'block' : 'none';
    document.getElementById('bo-trip-wrap').style.display = t === 'trip' ? 'block' : 'none';
    const actEl = document.getElementById('bo-activity');
    actEl.innerHTML = t === 'sport' ? `<option value="">Select...</option>${sports.map(s=>`<option>${s}</option>`).join('')}` : t === 'special' ? `<option value="">Select...</option>${specials.map(s=>`<option>${s}</option>`).join('')}` : '';
  };
  
  el.querySelectorAll('.da-chip').forEach(c => { c.onclick = () => c.classList.toggle('selected'); });
  
  document.getElementById('bo-apply').onclick = () => {
    const type = document.getElementById('bo-type').value;
    const start = document.getElementById('bo-start').value.trim();
    const end = document.getElementById('bo-end').value.trim();
    if (!type || !start || !end) { alert('Fill required.'); return; }
    
    let act = type === 'trip' ? document.getElementById('bo-trip-name').value.trim() : document.getElementById('bo-activity').value;
    if (!act) { alert('Select/enter activity.'); return; }
    
    const selected = [...el.querySelectorAll('.da-chip.selected')].map(c => c.dataset.bunk);
    if (!selected.length) { alert('Select bunks.'); return; }
    
    currentOverrides.bunkActivityOverrides.push({ id: `bo_${Math.random().toString(36).slice(2,9)}`, type, activity: act, bunks: selected, startTime: start, endTime: end });
    window.saveCurrentDailyData('bunkActivityOverrides', currentOverrides.bunkActivityOverrides);
    alert(`Applied to ${selected.length} bunk(s)!`);
    el.querySelectorAll('.da-chip.selected').forEach(c => c.classList.remove('selected'));
    renderExistingOverrides();
  };
  
  renderExistingOverrides();
}

function renderExistingOverrides() {
  const el = document.getElementById('bo-existing');
  if (!el || !currentOverrides.bunkActivityOverrides?.length) { if (el) el.innerHTML = ''; return; }
  
  el.innerHTML = `
    <h4>Existing Overrides</h4>
    ${currentOverrides.bunkActivityOverrides.map((o, i) => `
      <div class="da-override-item">
        <div><strong>${o.activity}</strong> (${o.type})<br><small>${o.bunks.join(', ')} • ${o.startTime}-${o.endTime}</small></div>
        <button class="da-remove-btn" data-idx="${i}">✕</button>
      </div>
    `).join('')}
  `;
  
  el.querySelectorAll('.da-remove-btn').forEach(btn => {
    btn.onclick = () => {
      currentOverrides.bunkActivityOverrides.splice(+btn.dataset.idx, 1);
      window.saveCurrentDailyData('bunkActivityOverrides', currentOverrides.bunkActivityOverrides);
      renderExistingOverrides();
    };
  });
}

// =================================================================
// RESOURCES
// =================================================================

function renderResources() {
  const el = document.getElementById('resources-section');
  if (!el) return;
  
  const fields = masterSettings.app1?.fields || [];
  const specials = masterSettings.app1?.specialActivities || [];
  const leagues = Object.keys(masterSettings.leaguesByName || {});
  const specialty = Object.values(masterSettings.specialtyLeagues || {}).map(l => l.name);
  
  const save = () => {
    const data = window.loadCurrentDailyData?.() || {};
    const o = data.overrides || {};
    o.leagues = currentOverrides.leagues;
    o.disabledFields = currentOverrides.disabledFields;
    o.disabledSpecials = currentOverrides.disabledSpecials;
    window.saveCurrentDailyData('overrides', o);
  };
  
  const toggle = (name, enabled, key) => {
    const div = document.createElement('div');
    div.className = 'da-res-toggle';
    div.innerHTML = `<span>${name}</span><label class="da-switch"><input type="checkbox" ${enabled?'checked':''}><span class="da-slider"></span></label>`;
    div.querySelector('input').onchange = e => {
      if (e.target.checked) currentOverrides[key] = currentOverrides[key].filter(n => n !== name);
      else if (!currentOverrides[key].includes(name)) currentOverrides[key].push(name);
      save();
    };
    return div;
  };
  
  el.innerHTML = `
    <div class="da-res-grid">
      <div><h4>Fields</h4><div id="res-fields"></div></div>
      <div><h4>Special Activities</h4><div id="res-specials"></div></div>
      <div><h4>Leagues</h4><div id="res-leagues"></div></div>
      <div><h4>Specialty Leagues</h4><div id="res-specialty"></div></div>
    </div>
  `;
  
  const fEl = document.getElementById('res-fields');
  fields.forEach(f => fEl.appendChild(toggle(f.name, !currentOverrides.disabledFields.includes(f.name), 'disabledFields')));
  
  const sEl = document.getElementById('res-specials');
  specials.forEach(s => sEl.appendChild(toggle(s.name, !currentOverrides.disabledSpecials.includes(s.name), 'disabledSpecials')));
  
  const lEl = document.getElementById('res-leagues');
  leagues.forEach(l => lEl.appendChild(toggle(l, !currentOverrides.leagues.includes(l), 'leagues')));
  
  const spEl = document.getElementById('res-specialty');
  specialty.forEach(l => {
    const d = toggle(l, !currentOverrides.disabledSpecialtyLeagues.includes(l), 'disabledSpecialtyLeagues');
    d.querySelector('input').onchange = e => {
      if (e.target.checked) currentOverrides.disabledSpecialtyLeagues = currentOverrides.disabledSpecialtyLeagues.filter(n=>n!==l);
      else if (!currentOverrides.disabledSpecialtyLeagues.includes(l)) currentOverrides.disabledSpecialtyLeagues.push(l);
      window.saveCurrentDailyData('disabledSpecialtyLeagues', currentOverrides.disabledSpecialtyLeagues);
    };
    spEl.appendChild(d);
  });
}

// =================================================================
// RUN OPTIMIZER
// =================================================================

function runOptimizer() {
  if (!window.runSkeletonOptimizer) { alert('Optimizer not found.'); return; }
  if (!dailySkeleton.length) { alert('Skeleton empty.'); return; }
  
  const conflicts = window.SkeletonSandbox?.detectConflicts(dailySkeleton) || [];
  const crit = conflicts.filter(c => c.type === 'critical');
  if (crit.length && !confirm(`⚠️ ${crit.length} conflict(s)!\n\nRun anyway?`)) return;
  
  saveSkeleton();
  if (window.runSkeletonOptimizer(dailySkeleton, currentOverrides)) {
    alert('Schedule Generated!');
    window.showTab?.('schedule');
  } else alert('Error. Check console.');
}

// =================================================================
// INIT
// =================================================================

function init() {
  const container = document.getElementById('daily-adjustments-content');
  if (!container) return;
  
  masterSettings.global = window.loadGlobalSettings?.() || {};
  masterSettings.app1 = masterSettings.global.app1 || {};
  masterSettings.leaguesByName = masterSettings.global.leaguesByName || {};
  masterSettings.specialtyLeagues = masterSettings.global.specialtyLeagues || {};
  
  const dailyData = window.loadCurrentDailyData?.() || {};
  const overrides = dailyData.overrides || {};
  currentOverrides = {
    dailyFieldAvailability: dailyData.dailyFieldAvailability || {},
    leagues: overrides.leagues || [],
    disabledSpecialtyLeagues: dailyData.disabledSpecialtyLeagues || [],
    dailyDisabledSportsByField: dailyData.dailyDisabledSportsByField || {},
    disabledFields: overrides.disabledFields || [],
    disabledSpecials: overrides.disabledSpecials || [],
    bunkActivityOverrides: dailyData.bunkActivityOverrides || []
  };
  
  loadSkeleton();
  
  container.innerHTML = `
    <div class="da-header">
      <div>
        <h2>Daily Adjustments — ${window.currentScheduleDate}</h2>
        <p>Drag to reposition • Double-click to remove • Conflicts auto-detected</p>
      </div>
      <button id="run-btn" class="da-run-btn">▶ Run Optimizer</button>
    </div>
    
    <div class="da-tabs">
      <button class="da-tab active" data-tab="skeleton">Skeleton</button>
      <button class="da-tab" data-tab="trips">Add Trip</button>
      <button class="da-tab" data-tab="bunks">Bunk Specific</button>
      <button class="da-tab" data-tab="resources">Resources</button>
    </div>
    
    <div class="da-body">
      <div id="pane-skeleton" class="da-pane active">
        <div id="skeleton-section">
          <div id="displaced-panel"></div>
          <div class="da-toolbar">
            <select id="load-skel"><option value="">Load skeleton...</option>${Object.keys(masterSettings.app1?.savedSkeletons||{}).sort().map(n=>`<option>${n}</option>`).join('')}</select>
            <button id="load-skel-btn">Load</button>
            <div class="da-spacer"></div>
            <button id="rules-btn">⚙️ Rules</button>
          </div>
          <div id="tile-palette" class="da-palette"></div>
          <div id="skeleton-grid" class="da-grid-wrap"></div>
        </div>
      </div>
      <div id="pane-trips" class="da-pane"><div id="trips-section"></div></div>
      <div id="pane-bunks" class="da-pane"><div id="bunks-section"></div></div>
      <div id="pane-resources" class="da-pane"><div id="resources-section"></div></div>
    </div>
  `;
  
  injectStyles();
  
  document.getElementById('run-btn').onclick = runOptimizer;
  
  document.querySelectorAll('.da-tab').forEach(tab => {
    tab.onclick = () => {
      document.querySelectorAll('.da-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.da-pane').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`pane-${tab.dataset.tab}`).classList.add('active');
    };
  });
  
  document.getElementById('load-skel-btn').onclick = () => {
    const n = document.getElementById('load-skel').value;
    if (!n) return;
    if (confirm(`Load "${n}"?`)) {
      dailySkeleton = JSON.parse(JSON.stringify(masterSettings.app1.savedSkeletons[n]));
      clearDisplaced();
      saveSkeleton();
      renderGrid();
    }
  };
  
  document.getElementById('rules-btn').onclick = () => window.SkeletonSandbox?.showRulesModal(renderGrid);
  
  renderPalette();
  renderGrid();
  renderTrips();
  renderBunkOverrides();
  renderResources();
}

function injectStyles() {
  if (document.getElementById('da-styles-v3')) return;
  const style = document.createElement('style');
  style.id = 'da-styles-v3';
  style.textContent = `
    .da-header { display:flex; justify-content:space-between; align-items:center; padding:18px 22px; background:#fff; border:1px solid #e5e7eb; border-radius:14px; margin-bottom:16px; }
    .da-header h2 { margin:0 0 4px; font-size:1.35em; }
    .da-header p { margin:0; color:#6b7280; font-size:.9em; }
    .da-run-btn { background:linear-gradient(135deg,#10b981,#059669); color:#fff; border:none; padding:14px 28px; border-radius:10px; font-size:1.1em; font-weight:600; cursor:pointer; transition:all .2s; box-shadow:0 4px 14px rgba(16,185,129,.3); }
    .da-run-btn:hover { transform:translateY(-2px); box-shadow:0 6px 20px rgba(16,185,129,.4); }
    
    .da-tabs { display:flex; gap:4px; margin-bottom:16px; }
    .da-tab { background:#f3f4f6; border:none; padding:14px 28px; border-radius:12px 12px 0 0; cursor:pointer; font-weight:500; color:#6b7280; transition:all .15s; }
    .da-tab:hover { background:#e5e7eb; }
    .da-tab.active { background:#fff; color:#1f2937; box-shadow:0 -2px 10px rgba(0,0,0,.05); }
    
    .da-body { background:#fff; border-radius:0 14px 14px 14px; padding:22px; min-height:500px; }
    .da-pane { display:none; }
    .da-pane.active { display:block; }
    
    .da-toolbar { display:flex; gap:10px; align-items:center; margin-bottom:16px; padding:14px; background:#f9fafb; border-radius:12px; }
    .da-toolbar select, .da-toolbar button { padding:10px 18px; border:1px solid #e5e7eb; border-radius:8px; background:#fff; cursor:pointer; font-size:.95em; }
    .da-toolbar button:hover { background:#f3f4f6; }
    .da-spacer { flex:1; }
    
    .da-palette { display:flex; flex-wrap:wrap; gap:10px; padding:16px; background:#f9fafb; border-radius:12px; margin-bottom:16px; }
    .da-palette-tile { padding:10px 18px; background:var(--tile-bg); border:2px var(--tile-border,solid) var(--tile-color); border-radius:10px; cursor:grab; font-weight:500; font-size:.9em; transition:all .15s; }
    .da-palette-tile:hover { transform:translateY(-2px); box-shadow:0 4px 12px rgba(0,0,0,.1); }
    .da-palette-tile.da-dragging { opacity:.5; }
    
    .da-grid-wrap { border:1px solid #e5e7eb; border-radius:12px; overflow:hidden; max-height:580px; overflow-y:auto; }
    .da-grid { display:grid; grid-template-columns:55px repeat(var(--cols,4),1fr); }
    .da-grid-header { padding:14px; font-weight:600; text-align:center; color:#fff; background:var(--div-color,#6b7280); position:sticky; top:0; z-index:10; }
    .da-time-header { background:#f3f4f6 !important; color:#6b7280 !important; }
    
    .da-time-col { position:relative; background:#f9fafb; border-right:1px solid #e5e7eb; }
    .da-time-mark { position:absolute; left:0; width:100%; padding:3px 6px; font-size:11px; color:#9ca3af; border-bottom:1px dashed #e5e7eb; box-sizing:border-box; }
    
    .da-col { position:relative; border-right:1px solid #e5e7eb; transition:background .15s; }
    .da-col:last-child { border-right:none; }
    .da-col.da-col-over { background:rgba(37,99,235,.06); }
    .da-col-disabled { position:absolute; width:100%; background:repeating-linear-gradient(-45deg,transparent,transparent 8px,rgba(0,0,0,.03) 8px,rgba(0,0,0,.03) 16px); pointer-events:none; z-index:1; }
    
    .da-event { position:absolute; left:3px; right:3px; padding:6px 8px; background:var(--tile-bg); border:2px var(--tile-border,solid) var(--tile-color); color:var(--tile-text,#1f2937); border-radius:10px; cursor:grab; z-index:2; overflow:hidden; transition:transform .12s,box-shadow .12s; }
    .da-event:hover { transform:scale(1.02); z-index:10; box-shadow:0 4px 14px rgba(0,0,0,.15); }
    .da-event.da-dragging { opacity:.35; cursor:grabbing; }
    .da-event-name { font-weight:600; font-size:.85em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .da-event-time { font-size:.75em; color:#6b7280; }
    .da-event-field { font-size:.7em; color:#dc2626; margin-top:2px; }
    
    .da-drop-preview { display:none; position:absolute; left:4px; right:4px; background:rgba(37,99,235,.15); border:2px dashed #2563eb; border-radius:10px; pointer-events:none; z-index:5; color:#2563eb; font-weight:600; font-size:.85em; display:flex; align-items:center; justify-content:center; }
    
    .da-ghost { position:fixed; padding:12px 18px; background:#fff; border:2px solid #2563eb; border-radius:10px; box-shadow:0 10px 30px rgba(0,0,0,.25); pointer-events:none; z-index:10001; font-size:.9em; display:none; }
    .da-ghost strong { display:block; margin-bottom:2px; }
    .da-ghost span { color:#6b7280; font-size:.85em; }
    
    .da-displaced { background:#fef3c7; border:1px solid #fcd34d; border-radius:12px; padding:14px; margin-bottom:16px; }
    .da-displaced-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; font-weight:600; color:#92400e; }
    .da-displaced-header button { background:#fff; border:1px solid #fcd34d; padding:6px 14px; border-radius:6px; cursor:pointer; }
    .da-displaced-list { max-height:120px; overflow-y:auto; }
    .da-displaced-item { background:#fff; padding:10px 14px; border-radius:8px; margin-bottom:6px; display:flex; justify-content:space-between; align-items:center; font-size:.9em; }
    .da-displaced-reason { color:#9ca3af; }
    
    .da-form-card { max-width:460px; }
    .da-form-card h3 { margin:0 0 8px; }
    .da-hint { color:#6b7280; font-size:.9em; margin:0 0 20px; }
    .da-field { margin-bottom:16px; }
    .da-field label { display:block; font-weight:500; margin-bottom:6px; }
    .da-field input, .da-field select { width:100%; padding:12px 14px; border:1px solid #e5e7eb; border-radius:10px; font-size:1em; box-sizing:border-box; transition:border-color .15s,box-shadow .15s; }
    .da-field input:focus, .da-field select:focus { outline:none; border-color:#3b82f6; box-shadow:0 0 0 3px rgba(59,130,246,.15); }
    .da-field-row { display:flex; gap:16px; }
    .da-field-row .da-field { flex:1; }
    
    .da-btn-primary { background:#2563eb; color:#fff; border:none; padding:14px 24px; border-radius:10px; font-size:1em; font-weight:600; cursor:pointer; transition:all .15s; }
    .da-btn-primary:hover { background:#1d4ed8; }
    .da-btn-full { width:100%; }
    .da-btn-cancel { background:#f3f4f6; border:1px solid #e5e7eb; padding:12px 20px; border-radius:8px; cursor:pointer; }
    
    .da-chips { display:flex; flex-wrap:wrap; gap:8px; max-height:150px; overflow-y:auto; padding:4px; }
    .da-chip { padding:8px 16px; border:2px solid var(--chip-color,#e5e7eb); background:#fff; border-radius:20px; cursor:pointer; font-size:.9em; transition:all .15s; }
    .da-chip:hover { background:#f9fafb; }
    .da-chip.selected { background:var(--chip-color); color:#fff; }
    
    .da-override-item { display:flex; justify-content:space-between; align-items:center; background:#f9fafb; padding:12px 14px; border-radius:10px; margin-bottom:8px; margin-top:8px; }
    .da-remove-btn { background:#fee2e2; color:#dc2626; border:none; width:32px; height:32px; border-radius:8px; cursor:pointer; font-weight:bold; }
    
    .da-res-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:24px; }
    .da-res-grid h4 { margin:0 0 12px; color:#374151; }
    .da-res-toggle { display:flex; justify-content:space-between; align-items:center; padding:10px 14px; background:#f9fafb; border-radius:10px; margin-bottom:8px; }
    
    .da-switch { position:relative; width:44px; height:24px; flex-shrink:0; }
    .da-switch input { opacity:0; width:0; height:0; }
    .da-slider { position:absolute; cursor:pointer; inset:0; background:#e5e7eb; transition:.2s; border-radius:24px; }
    .da-slider:before { position:absolute; content:""; height:18px; width:18px; left:3px; bottom:3px; background:#fff; transition:.2s; border-radius:50%; }
    input:checked + .da-slider { background:#10b981; }
    input:checked + .da-slider:before { transform:translateX(20px); }
    
    .da-overlay { position:fixed; inset:0; background:rgba(0,0,0,.5); backdrop-filter:blur(4px); z-index:10000; display:flex; justify-content:center; align-items:center; padding:20px; }
    .da-modal { background:#fff; border-radius:16px; width:100%; max-width:400px; overflow:hidden; box-shadow:0 25px 60px rgba(0,0,0,.3); animation:daSlide .25s ease; }
    .da-modal-sm { max-width:360px; }
    @keyframes daSlide { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
    .da-modal-header { display:flex; justify-content:space-between; align-items:center; padding:18px 22px; border-bottom:1px solid #e5e7eb; }
    .da-modal-header h3 { margin:0; font-size:1.15em; }
    .da-close { background:none; border:none; font-size:1.5em; cursor:pointer; color:#9ca3af; }
    .da-modal-body { padding:20px 22px; }
    .da-modal-footer { padding:16px 22px; border-top:1px solid #e5e7eb; display:flex; justify-content:flex-end; gap:10px; }
  `;
  document.head.appendChild(style);
}

window.initDailyAdjustments = init;

})();
