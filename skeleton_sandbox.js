// =================================================================
// skeleton_sandbox.js v3.0 - Polished Edition
// 
// - Tile-TYPE based conflict detection (not just names)
// - Instant updates on rule changes
// - Clean, modern UI
// =================================================================

(function() {
'use strict';

// =================================================================
// DEFAULT RULES - TILE TYPE BASED
// =================================================================

const DEFAULT_RULES = {
  enabled: true,
  
  // TILE TYPE rules: which types conflict across divisions
  tileTypeRules: [
    { type: 'swim', severity: 'critical', label: 'Swim' },
    { type: 'pinned', severity: 'warning', label: 'Pinned Events', matchSameName: true },
    { type: 'league', severity: 'warning', label: 'League Games' },
    { type: 'specialty_league', severity: 'warning', label: 'Specialty Leagues' }
  ],
  
  // Named resources (event names containing these)
  namedResources: [
    { name: 'Pool', severity: 'critical' },
    { name: 'Gym', severity: 'warning' }
  ],
  
  // Reserved fields always critical
  reservedFieldsConflict: true,
  
  // Division pairs allowed to overlap
  allowedPairs: [],
  
  // Types to completely ignore
  ignoredTypes: ['slot', 'activity', 'sports', 'special'],
  
  // Names to ignore
  ignoredNames: ['General Activity Slot', 'Sports Slot', 'Special Activity', 'Activity', 'Free']
};

let rules = JSON.parse(JSON.stringify(DEFAULT_RULES));
const STORAGE_KEY = 'skeletonRules_v3';

function loadRules() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      rules = { ...DEFAULT_RULES, ...parsed };
      // Ensure arrays exist
      rules.tileTypeRules = rules.tileTypeRules || DEFAULT_RULES.tileTypeRules;
      rules.namedResources = rules.namedResources || DEFAULT_RULES.namedResources;
      rules.allowedPairs = rules.allowedPairs || [];
      rules.ignoredTypes = rules.ignoredTypes || DEFAULT_RULES.ignoredTypes;
      rules.ignoredNames = rules.ignoredNames || DEFAULT_RULES.ignoredNames;
    }
  } catch (e) { console.warn('Failed to load rules', e); }
  return rules;
}

function saveRules() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(rules)); } catch (e) {}
}

function resetRules() {
  rules = JSON.parse(JSON.stringify(DEFAULT_RULES));
  saveRules();
}

// =================================================================
// TILE-TYPE BASED CONFLICT DETECTION
// =================================================================

function detectConflicts(skeleton) {
  if (!skeleton?.length || !rules.enabled) return [];
  
  const conflicts = [];
  const seen = new Set();
  
  for (let i = 0; i < skeleton.length; i++) {
    for (let j = i + 1; j < skeleton.length; j++) {
      const a = skeleton[i], b = skeleton[j];
      
      // Skip same division
      if (a.division === b.division) continue;
      
      // Skip already checked
      const key = [a.id, b.id].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      
      // Check time overlap
      if (!timesOverlap(a, b)) continue;
      
      // Check allowed pairs
      if (isPairAllowed(a.division, b.division)) continue;
      
      // Find conflict
      const conflict = findConflict(a, b);
      if (conflict) conflicts.push(conflict);
    }
  }
  
  return conflicts;
}

function findConflict(a, b) {
  // Skip ignored types
  if (rules.ignoredTypes.includes(a.type) || rules.ignoredTypes.includes(b.type)) return null;
  if (rules.ignoredNames.includes(a.event) || rules.ignoredNames.includes(b.event)) return null;
  
  // 1. Check reserved fields (highest priority)
  if (rules.reservedFieldsConflict) {
    const fieldsA = a.reservedFields || [];
    const fieldsB = b.reservedFields || [];
    const shared = fieldsA.filter(f => fieldsB.includes(f));
    if (shared.length) {
      return { type: 'critical', resource: `Field: ${shared[0]}`, event1: a, event2: b };
    }
  }
  
  // 2. Check tile TYPE rules
  for (const rule of rules.tileTypeRules) {
    // Both events are same type
    if (a.type === rule.type && b.type === rule.type) {
      // For pinned, optionally require same name
      if (rule.matchSameName && a.event !== b.event) continue;
      return { type: rule.severity, resource: rule.label || rule.type, event1: a, event2: b };
    }
    
    // Special case: 'swim' type tiles
    if (rule.type === 'swim') {
      const aIsSwim = a.type === 'swim' || a.event?.toLowerCase().includes('swim');
      const bIsSwim = b.type === 'swim' || b.event?.toLowerCase().includes('swim');
      if (aIsSwim && bIsSwim) {
        return { type: rule.severity, resource: 'Swim', event1: a, event2: b };
      }
    }
  }
  
  // 3. Check named resources
  for (const res of rules.namedResources) {
    const nameL = res.name.toLowerCase();
    const aHas = a.event?.toLowerCase().includes(nameL);
    const bHas = b.event?.toLowerCase().includes(nameL);
    if (aHas && bHas) {
      return { type: res.severity, resource: res.name, event1: a, event2: b };
    }
  }
  
  return null;
}

function timesOverlap(a, b) {
  const s1 = parseTime(a.startTime), e1 = parseTime(a.endTime);
  const s2 = parseTime(b.startTime), e2 = parseTime(b.endTime);
  if (s1 == null || e1 == null || s2 == null || e2 == null) return false;
  return s1 < e2 && e1 > s2;
}

function isPairAllowed(d1, d2) {
  return rules.allowedPairs?.some(p => 
    (p[0] === d1 && p[1] === d2) || (p[0] === d2 && p[1] === d1)
  );
}

function getConflictIds(conflicts) {
  const ids = new Set();
  conflicts.forEach(c => {
    if (c.event1?.id) ids.add(c.event1.id);
    if (c.event2?.id) ids.add(c.event2.id);
  });
  return ids;
}

// =================================================================
// TIME HELPERS
// =================================================================

function parseTime(str) {
  if (!str || typeof str !== 'string') return null;
  let s = str.trim().toLowerCase();
  let mer = null;
  if (s.endsWith('am') || s.endsWith('pm')) {
    mer = s.slice(-2);
    s = s.slice(0, -2).trim();
  }
  const match = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  let h = parseInt(match[1]), m = parseInt(match[2]);
  if (isNaN(h) || isNaN(m)) return null;
  if (mer === 'am' && h === 12) h = 0;
  else if (mer === 'pm' && h !== 12) h += 12;
  else if (!mer && h <= 7) h += 12;
  return h * 60 + m;
}

function formatTime(mins) {
  const h = Math.floor(mins / 60), m = mins % 60;
  const hr = h % 12 || 12;
  return `${hr}:${String(m).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`;
}

// =================================================================
// UI: CONFLICT BANNER
// =================================================================

function renderBanner(selector, skeleton, onRefresh) {
  const container = document.querySelector(selector);
  if (!container) return [];
  
  // Remove existing
  container.querySelector('.conflict-banner')?.remove();
  
  const conflicts = detectConflicts(skeleton);
  if (!conflicts.length) return [];
  
  const critCount = conflicts.filter(c => c.type === 'critical').length;
  const warnCount = conflicts.filter(c => c.type === 'warning').length;
  const hasCrit = critCount > 0;
  
  const banner = document.createElement('div');
  banner.className = 'conflict-banner';
  banner.innerHTML = `
    <div class="cb-inner ${hasCrit ? 'cb-critical' : 'cb-warning'}">
      <div class="cb-icon">${hasCrit ? '🚨' : '⚠️'}</div>
      <div class="cb-text">
        <strong>${critCount ? `${critCount} critical` : ''}${critCount && warnCount ? ', ' : ''}${warnCount ? `${warnCount} warning` : ''}</strong>
        <span>${conflicts[0].resource}: ${conflicts[0].event1.division} ↔ ${conflicts[0].event2.division}</span>
      </div>
      <button class="cb-btn">View All</button>
    </div>
  `;
  
  container.prepend(banner);
  banner.querySelector('.cb-btn').onclick = () => showConflictModal(conflicts);
  
  return conflicts;
}

function showConflictModal(conflicts) {
  const overlay = createOverlay();
  const modal = document.createElement('div');
  modal.className = 'ss-modal';
  modal.innerHTML = `
    <div class="ss-modal-header">
      <h2>Schedule Conflicts</h2>
      <button class="ss-close">&times;</button>
    </div>
    <p class="ss-hint">Drag tiles on the skeleton to resolve these conflicts.</p>
    <div class="ss-conflict-list">
      ${conflicts.map(c => `
        <div class="ss-conflict-item ${c.type}">
          <div class="ss-conflict-icon">${c.type === 'critical' ? '🚨' : '⚠️'}</div>
          <div class="ss-conflict-info">
            <strong>${c.resource}</strong>
            <div class="ss-conflict-divs">
              <span class="ss-div-tag">${c.event1.division}</span>
              <span>${c.event1.startTime} - ${c.event1.endTime}</span>
              <span class="ss-arrow">↔</span>
              <span class="ss-div-tag">${c.event2.division}</span>
              <span>${c.event2.startTime} - ${c.event2.endTime}</span>
            </div>
          </div>
        </div>
      `).join('')}
    </div>
    <div class="ss-modal-footer">
      <button class="ss-btn-primary ss-close-btn">Got it</button>
    </div>
  `;
  
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  
  const close = () => overlay.remove();
  modal.querySelector('.ss-close').onclick = close;
  modal.querySelector('.ss-close-btn').onclick = close;
  overlay.onclick = e => { if (e.target === overlay) close(); };
}

// =================================================================
// UI: RULES MODAL (IMPROVED)
// =================================================================

function showRulesModal(onSaveCallback) {
  loadRules();
  
  const overlay = createOverlay();
  const modal = document.createElement('div');
  modal.className = 'ss-modal ss-rules-modal';
  
  function renderTypeRules() {
    return rules.tileTypeRules.map((r, i) => `
      <div class="ss-rule-row" data-idx="${i}">
        <input type="text" class="ss-input rule-type" value="${r.type}" placeholder="Type (e.g., swim)">
        <input type="text" class="ss-input rule-label" value="${r.label || ''}" placeholder="Label">
        <select class="ss-select rule-severity">
          <option value="critical" ${r.severity === 'critical' ? 'selected' : ''}>🔴 Critical</option>
          <option value="warning" ${r.severity === 'warning' ? 'selected' : ''}>🟡 Warning</option>
        </select>
        <label class="ss-check-label"><input type="checkbox" class="rule-samename" ${r.matchSameName ? 'checked' : ''}> Same name only</label>
        <button class="ss-btn-icon ss-remove-rule" data-idx="${i}">✕</button>
      </div>
    `).join('');
  }
  
  function renderNamedResources() {
    return rules.namedResources.map((r, i) => `
      <div class="ss-resource-row" data-idx="${i}">
        <input type="text" class="ss-input res-name" value="${r.name}" placeholder="Name (e.g., Pool)">
        <select class="ss-select res-severity">
          <option value="critical" ${r.severity === 'critical' ? 'selected' : ''}>🔴 Critical</option>
          <option value="warning" ${r.severity === 'warning' ? 'selected' : ''}>🟡 Warning</option>
        </select>
        <button class="ss-btn-icon ss-remove-res" data-idx="${i}">✕</button>
      </div>
    `).join('');
  }
  
  function renderAllowedPairs() {
    if (!rules.allowedPairs.length) return '<span class="ss-muted">None defined</span>';
    return rules.allowedPairs.map((p, i) => `
      <span class="ss-pair-tag">${p[0]} ↔ ${p[1]} <button class="ss-remove-pair" data-idx="${i}">✕</button></span>
    `).join('');
  }
  
  modal.innerHTML = `
    <div class="ss-modal-header">
      <h2>⚙️ Conflict Detection Rules</h2>
      <button class="ss-close">&times;</button>
    </div>
    
    <div class="ss-modal-body">
      <div class="ss-section">
        <label class="ss-toggle">
          <input type="checkbox" id="rules-enabled" ${rules.enabled ? 'checked' : ''}>
          <span class="ss-toggle-slider"></span>
          <span class="ss-toggle-label">Enable conflict detection</span>
        </label>
      </div>
      
      <div class="ss-section">
        <h3>Tile Type Rules</h3>
        <p class="ss-hint">Define which tile types cause conflicts across divisions.</p>
        <div id="type-rules-container">${renderTypeRules()}</div>
        <button id="add-type-rule" class="ss-btn-add">+ Add Type Rule</button>
      </div>
      
      <div class="ss-section">
        <h3>Named Resources</h3>
        <p class="ss-hint">Events containing these names will conflict.</p>
        <div id="named-resources-container">${renderNamedResources()}</div>
        <button id="add-named-res" class="ss-btn-add">+ Add Resource</button>
      </div>
      
      <div class="ss-section">
        <h3>Allowed Division Pairs</h3>
        <p class="ss-hint">These divisions can share resources without conflicts.</p>
        <div id="pairs-container">${renderAllowedPairs()}</div>
        <div class="ss-pair-add">
          <select id="pair-d1" class="ss-select"><option value="">Division 1</option>${(window.availableDivisions||[]).map(d=>`<option>${d}</option>`).join('')}</select>
          <span>↔</span>
          <select id="pair-d2" class="ss-select"><option value="">Division 2</option>${(window.availableDivisions||[]).map(d=>`<option>${d}</option>`).join('')}</select>
          <button id="add-pair" class="ss-btn-add">Add</button>
        </div>
      </div>
      
      <div class="ss-section">
        <h3>Other Options</h3>
        <label class="ss-toggle">
          <input type="checkbox" id="reserved-fields" ${rules.reservedFieldsConflict ? 'checked' : ''}>
          <span class="ss-toggle-slider"></span>
          <span class="ss-toggle-label">Reserved fields cause conflicts</span>
        </label>
        <div class="ss-field-group">
          <label>Ignored event types (comma-separated):</label>
          <input type="text" id="ignored-types" class="ss-input" value="${rules.ignoredTypes.join(', ')}">
        </div>
        <div class="ss-field-group">
          <label>Ignored event names (comma-separated):</label>
          <input type="text" id="ignored-names" class="ss-input" value="${rules.ignoredNames.join(', ')}">
        </div>
      </div>
    </div>
    
    <div class="ss-modal-footer ss-footer-split">
      <button id="reset-rules" class="ss-btn-warning">Reset to Defaults</button>
      <div class="ss-btn-group">
        <button class="ss-btn-secondary ss-cancel">Cancel</button>
        <button class="ss-btn-primary ss-save">Save & Apply</button>
      </div>
    </div>
  `;
  
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  
  const close = () => overlay.remove();
  modal.querySelector('.ss-close').onclick = close;
  modal.querySelector('.ss-cancel').onclick = close;
  overlay.onclick = e => { if (e.target === overlay) close(); };
  
  // Type rules handlers
  function refreshTypeRules() {
    modal.querySelector('#type-rules-container').innerHTML = renderTypeRules();
    modal.querySelectorAll('.ss-remove-rule').forEach(btn => {
      btn.onclick = () => { rules.tileTypeRules.splice(+btn.dataset.idx, 1); refreshTypeRules(); };
    });
  }
  modal.querySelector('#add-type-rule').onclick = () => {
    rules.tileTypeRules.push({ type: '', severity: 'warning', label: '', matchSameName: false });
    refreshTypeRules();
  };
  refreshTypeRules();
  
  // Named resources handlers
  function refreshResources() {
    modal.querySelector('#named-resources-container').innerHTML = renderNamedResources();
    modal.querySelectorAll('.ss-remove-res').forEach(btn => {
      btn.onclick = () => { rules.namedResources.splice(+btn.dataset.idx, 1); refreshResources(); };
    });
  }
  modal.querySelector('#add-named-res').onclick = () => {
    rules.namedResources.push({ name: '', severity: 'warning' });
    refreshResources();
  };
  refreshResources();
  
  // Pairs handlers
  function refreshPairs() {
    modal.querySelector('#pairs-container').innerHTML = renderAllowedPairs();
    modal.querySelectorAll('.ss-remove-pair').forEach(btn => {
      btn.onclick = () => { rules.allowedPairs.splice(+btn.dataset.idx, 1); refreshPairs(); };
    });
  }
  modal.querySelector('#add-pair').onclick = () => {
    const d1 = modal.querySelector('#pair-d1').value;
    const d2 = modal.querySelector('#pair-d2').value;
    if (d1 && d2 && d1 !== d2 && !rules.allowedPairs.some(p=>(p[0]===d1&&p[1]===d2)||(p[0]===d2&&p[1]===d1))) {
      rules.allowedPairs.push([d1, d2]);
      refreshPairs();
    }
  };
  refreshPairs();
  
  // Reset
  modal.querySelector('#reset-rules').onclick = () => {
    if (confirm('Reset all rules to defaults?')) {
      resetRules();
      close();
      showRulesModal(onSaveCallback);
    }
  };
  
  // SAVE - with immediate refresh
  modal.querySelector('.ss-save').onclick = () => {
    // Gather type rules
    rules.tileTypeRules = [];
    modal.querySelectorAll('.ss-rule-row').forEach(row => {
      const type = row.querySelector('.rule-type').value.trim();
      const label = row.querySelector('.rule-label').value.trim();
      const severity = row.querySelector('.rule-severity').value;
      const matchSameName = row.querySelector('.rule-samename').checked;
      if (type) rules.tileTypeRules.push({ type, label: label || type, severity, matchSameName });
    });
    
    // Gather named resources
    rules.namedResources = [];
    modal.querySelectorAll('.ss-resource-row').forEach(row => {
      const name = row.querySelector('.res-name').value.trim();
      const severity = row.querySelector('.res-severity').value;
      if (name) rules.namedResources.push({ name, severity });
    });
    
    // Other options
    rules.enabled = modal.querySelector('#rules-enabled').checked;
    rules.reservedFieldsConflict = modal.querySelector('#reserved-fields').checked;
    rules.ignoredTypes = modal.querySelector('#ignored-types').value.split(',').map(s=>s.trim()).filter(Boolean);
    rules.ignoredNames = modal.querySelector('#ignored-names').value.split(',').map(s=>s.trim()).filter(Boolean);
    
    saveRules();
    close();
    
    // INSTANT REFRESH
    if (onSaveCallback) onSaveCallback();
    if (window.refreshSkeletonConflicts) window.refreshSkeletonConflicts();
  };
}

// =================================================================
// HELPERS
// =================================================================

function createOverlay() {
  const el = document.createElement('div');
  el.className = 'ss-overlay';
  return el;
}

function injectStyles() {
  if (document.getElementById('ss-styles-v3')) return;
  const style = document.createElement('style');
  style.id = 'ss-styles-v3';
  style.textContent = `
    /* Overlay */
    .ss-overlay { position:fixed; inset:0; background:rgba(0,0,0,.5); backdrop-filter:blur(4px); z-index:10000; display:flex; justify-content:center; align-items:center; padding:20px; animation:ssFadeIn .2s ease; }
    @keyframes ssFadeIn { from{opacity:0} to{opacity:1} }
    
    /* Modal */
    .ss-modal { background:#fff; border-radius:16px; width:100%; max-width:580px; max-height:90vh; overflow:hidden; display:flex; flex-direction:column; box-shadow:0 25px 60px rgba(0,0,0,.3); animation:ssSlideUp .25s ease; }
    .ss-rules-modal { max-width:700px; }
    @keyframes ssSlideUp { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
    
    .ss-modal-header { display:flex; justify-content:space-between; align-items:center; padding:20px 24px; border-bottom:1px solid #e5e7eb; }
    .ss-modal-header h2 { margin:0; font-size:1.25em; }
    .ss-close { background:none; border:none; font-size:1.6em; cursor:pointer; color:#9ca3af; transition:color .15s; }
    .ss-close:hover { color:#374151; }
    
    .ss-modal-body { padding:20px 24px; overflow-y:auto; flex:1; }
    .ss-modal-footer { padding:16px 24px; border-top:1px solid #e5e7eb; display:flex; justify-content:flex-end; gap:10px; }
    .ss-footer-split { justify-content:space-between; }
    .ss-btn-group { display:flex; gap:10px; }
    
    .ss-hint { color:#6b7280; font-size:.9em; margin:0 0 16px; }
    .ss-muted { color:#9ca3af; font-size:.9em; }
    
    /* Sections */
    .ss-section { margin-bottom:24px; }
    .ss-section h3 { margin:0 0 6px; font-size:1em; color:#374151; }
    
    /* Toggle */
    .ss-toggle { display:flex; align-items:center; gap:12px; cursor:pointer; margin-bottom:12px; }
    .ss-toggle input { display:none; }
    .ss-toggle-slider { width:44px; height:24px; background:#e5e7eb; border-radius:24px; position:relative; transition:background .2s; }
    .ss-toggle-slider::before { content:''; position:absolute; width:18px; height:18px; background:#fff; border-radius:50%; top:3px; left:3px; transition:transform .2s; }
    .ss-toggle input:checked + .ss-toggle-slider { background:#10b981; }
    .ss-toggle input:checked + .ss-toggle-slider::before { transform:translateX(20px); }
    .ss-toggle-label { font-weight:500; }
    
    /* Inputs */
    .ss-input { padding:10px 14px; border:1px solid #e5e7eb; border-radius:8px; font-size:.95em; transition:border-color .15s,box-shadow .15s; }
    .ss-input:focus { outline:none; border-color:#3b82f6; box-shadow:0 0 0 3px rgba(59,130,246,.15); }
    .ss-select { padding:10px 14px; border:1px solid #e5e7eb; border-radius:8px; background:#fff; font-size:.95em; cursor:pointer; }
    
    .ss-field-group { margin-top:12px; }
    .ss-field-group label { display:block; font-weight:500; margin-bottom:6px; font-size:.9em; }
    .ss-field-group .ss-input { width:100%; box-sizing:border-box; }
    
    /* Rule rows */
    .ss-rule-row, .ss-resource-row { display:flex; gap:8px; align-items:center; margin-bottom:10px; padding:12px; background:#f9fafb; border-radius:10px; flex-wrap:wrap; }
    .ss-rule-row .ss-input, .ss-resource-row .ss-input { flex:1; min-width:100px; }
    .ss-rule-row .ss-select, .ss-resource-row .ss-select { min-width:120px; }
    .ss-check-label { display:flex; align-items:center; gap:6px; font-size:.85em; color:#6b7280; white-space:nowrap; }
    .ss-btn-icon { width:32px; height:32px; border:none; border-radius:8px; cursor:pointer; font-weight:bold; display:flex; align-items:center; justify-content:center; transition:all .15s; }
    .ss-remove-rule, .ss-remove-res { background:#fee2e2; color:#dc2626; }
    .ss-remove-rule:hover, .ss-remove-res:hover { background:#fecaca; }
    
    /* Pairs */
    .ss-pair-tag { display:inline-flex; align-items:center; gap:6px; background:#dbeafe; color:#1e40af; padding:6px 12px; border-radius:20px; margin:4px; font-size:.9em; }
    .ss-pair-tag button { background:none; border:none; color:#3b82f6; cursor:pointer; padding:0; font-size:1.1em; }
    .ss-pair-add { display:flex; gap:8px; align-items:center; margin-top:12px; }
    .ss-pair-add .ss-select { flex:1; }
    
    /* Buttons */
    .ss-btn-add { background:#eff6ff; color:#2563eb; border:1px solid #bfdbfe; padding:10px 18px; border-radius:8px; cursor:pointer; font-weight:500; transition:all .15s; }
    .ss-btn-add:hover { background:#dbeafe; }
    .ss-btn-primary { background:#2563eb; color:#fff; border:none; padding:12px 24px; border-radius:8px; cursor:pointer; font-weight:600; transition:all .15s; }
    .ss-btn-primary:hover { background:#1d4ed8; }
    .ss-btn-secondary { background:#f3f4f6; border:1px solid #e5e7eb; padding:12px 24px; border-radius:8px; cursor:pointer; font-weight:500; }
    .ss-btn-secondary:hover { background:#e5e7eb; }
    .ss-btn-warning { background:#fef3c7; color:#92400e; border:1px solid #fcd34d; padding:12px 20px; border-radius:8px; cursor:pointer; font-weight:500; }
    .ss-btn-warning:hover { background:#fde68a; }
    
    /* Conflict list */
    .ss-conflict-list { max-height:350px; overflow-y:auto; }
    .ss-conflict-item { display:flex; gap:12px; padding:14px; margin-bottom:10px; border-radius:10px; }
    .ss-conflict-item.critical { background:#fef2f2; border-left:4px solid #ef4444; }
    .ss-conflict-item.warning { background:#fffbeb; border-left:4px solid #f59e0b; }
    .ss-conflict-icon { font-size:1.2em; }
    .ss-conflict-info strong { display:block; margin-bottom:6px; }
    .ss-conflict-divs { display:flex; flex-wrap:wrap; align-items:center; gap:8px; font-size:.9em; color:#6b7280; }
    .ss-div-tag { background:#e0f2fe; color:#0369a1; padding:4px 10px; border-radius:6px; font-weight:500; }
    .ss-arrow { color:#9ca3af; }
    
    /* Banner */
    .conflict-banner { margin-bottom:16px; animation:ssSlideDown .3s ease; }
    @keyframes ssSlideDown { from{opacity:0;transform:translateY(-10px)} to{opacity:1;transform:translateY(0)} }
    .cb-inner { display:flex; align-items:center; gap:14px; padding:14px 18px; border-radius:12px; border:2px solid; }
    .cb-critical { background:#fef2f2; border-color:#fca5a5; }
    .cb-warning { background:#fffbeb; border-color:#fcd34d; }
    .cb-icon { font-size:1.4em; }
    .cb-text { flex:1; }
    .cb-text strong { color:#dc2626; }
    .cb-warning .cb-text strong { color:#d97706; }
    .cb-text span { color:#6b7280; margin-left:8px; }
    .cb-btn { background:#fff; border:1px solid currentColor; padding:8px 16px; border-radius:8px; cursor:pointer; font-weight:500; transition:all .15s; }
    .cb-critical .cb-btn { color:#dc2626; border-color:#fca5a5; }
    .cb-warning .cb-btn { color:#d97706; border-color:#fcd34d; }
    .cb-btn:hover { transform:translateY(-1px); }
    
    /* Conflict highlights */
    @keyframes ssPulse { 0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,.4)} 50%{box-shadow:0 0 0 8px rgba(239,68,68,0)} }
    @keyframes ssPulseWarn { 0%,100%{box-shadow:0 0 0 0 rgba(245,158,11,.4)} 50%{box-shadow:0 0 0 8px rgba(245,158,11,0)} }
    .conflict-critical { animation:ssPulse 1.5s infinite !important; border:3px solid #ef4444 !important; background:linear-gradient(135deg,#fef2f2,#fecaca) !important; }
    .conflict-warning { animation:ssPulseWarn 2s infinite !important; border:3px solid #f59e0b !important; background:linear-gradient(135deg,#fffbeb,#fde68a) !important; }
  `;
  document.head.appendChild(style);
}

// =================================================================
// INIT
// =================================================================

injectStyles();
loadRules();

window.SkeletonSandbox = {
  detectConflicts,
  renderBanner,
  showRulesModal,
  getConflictIds,
  parseTime,
  formatTime,
  loadRules,
  saveRules,
  resetRules
};

})();
