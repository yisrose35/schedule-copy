// =================================================================
// skeleton_sandbox.js
// 
// Conflict detection with FULLY CUSTOMIZABLE rules:
// - Define resource groups and their conflict behavior
// - Per-division conflict exceptions
// - Visual highlighting (red pulse for critical, yellow for warnings)
// =================================================================

(function() {
'use strict';

// =================================================================
// CONFLICT RULES CONFIGURATION (FULLY CUSTOMIZABLE)
// =================================================================

const DEFAULT_CONFLICT_RULES = {
  // Master switch - if false, no conflicts are detected
  enabled: true,
  
  // Resource definitions - each resource can have custom behavior
  resources: [
    { name: 'Swim', type: 'critical', aliases: ['Pool', 'Swimming Pool', 'Swimming'], canShareWith: [] },
    { name: 'League', type: 'warning', aliases: ['League Game'], canShareWith: [] },
    { name: 'Specialty League', type: 'warning', aliases: [], canShareWith: [] }
  ],
  
  // Division pairs that CAN share resources (exceptions)
  allowedOverlaps: [],
  
  // Event types to completely ignore for conflict detection
  ignoredEventTypes: ['slot', 'activity', 'sports', 'special'],
  
  // Event names to completely ignore
  ignoredEventNames: ['General Activity Slot', 'Sports Slot', 'Special Activity', 'Activity'],
  
  // If true, any pinned event with same name causes conflict
  pinnedEventsConflict: true,
  
  // If true, reserved fields cause conflicts
  reservedFieldsConflict: true,
  
  // Default behavior for unlisted resources
  defaultBehavior: 'warning'
};

let conflictRules = JSON.parse(JSON.stringify(DEFAULT_CONFLICT_RULES));
const CONFLICT_RULES_KEY = 'skeletonConflictRules_v2';

function loadConflictRules() {
  try {
    const saved = localStorage.getItem(CONFLICT_RULES_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      conflictRules = { ...DEFAULT_CONFLICT_RULES, ...parsed };
      if (!Array.isArray(conflictRules.resources)) conflictRules.resources = DEFAULT_CONFLICT_RULES.resources;
      if (!Array.isArray(conflictRules.allowedOverlaps)) conflictRules.allowedOverlaps = [];
      if (!Array.isArray(conflictRules.ignoredEventTypes)) conflictRules.ignoredEventTypes = DEFAULT_CONFLICT_RULES.ignoredEventTypes;
      if (!Array.isArray(conflictRules.ignoredEventNames)) conflictRules.ignoredEventNames = DEFAULT_CONFLICT_RULES.ignoredEventNames;
    }
  } catch (e) {
    console.warn('Failed to load conflict rules:', e);
  }
  return conflictRules;
}

function saveConflictRules() {
  try {
    localStorage.setItem(CONFLICT_RULES_KEY, JSON.stringify(conflictRules));
  } catch (e) {
    console.warn('Failed to save conflict rules:', e);
  }
}

function resetConflictRules() {
  conflictRules = JSON.parse(JSON.stringify(DEFAULT_CONFLICT_RULES));
  saveConflictRules();
}

// =================================================================
// CONFLICT DETECTION ENGINE
// =================================================================

function detectConflicts(skeleton) {
  const conflicts = [];
  
  if (!skeleton || skeleton.length === 0 || !conflictRules.enabled) return conflicts;
  
  const eventsByKey = {};
  skeleton.forEach(ev => {
    const keys = getConflictKeys(ev);
    keys.forEach(key => {
      if (!eventsByKey[key]) eventsByKey[key] = [];
      eventsByKey[key].push(ev);
    });
  });
  
  Object.keys(eventsByKey).forEach(resourceKey => {
    const events = eventsByKey[resourceKey];
    if (events.length < 2) return;
    
    for (let i = 0; i < events.length; i++) {
      for (let j = i + 1; j < events.length; j++) {
        const ev1 = events[i];
        const ev2 = events[j];
        
        if (ev1.division === ev2.division) continue;
        if (isOverlapAllowed(ev1.division, ev2.division)) continue;
        
        if (timesOverlap(ev1, ev2)) {
          const severity = getResourceSeverity(resourceKey);
          if (severity === 'ignore') continue;
          
          conflicts.push({
            type: severity,
            resource: resourceKey,
            event1: ev1,
            event2: ev2,
            message: `${resourceKey}: ${ev1.division} (${ev1.startTime}-${ev1.endTime}) ↔ ${ev2.division} (${ev2.startTime}-${ev2.endTime})`
          });
        }
      }
    }
  });
  
  return conflicts;
}

function getConflictKeys(ev) {
  if (!ev) return [];
  
  const keys = [];
  
  if (conflictRules.ignoredEventTypes.includes(ev.type)) return keys;
  if (conflictRules.ignoredEventNames.includes(ev.event)) return keys;
  
  if (ev.type === 'pinned' && conflictRules.pinnedEventsConflict) {
    keys.push(ev.event);
  }
  
  if (conflictRules.reservedFieldsConflict && ev.reservedFields && ev.reservedFields.length > 0) {
    ev.reservedFields.forEach(field => keys.push(field));
  }
  
  conflictRules.resources.forEach(resource => {
    const allNames = [resource.name, ...(resource.aliases || [])];
    const evNameLower = (ev.event || '').toLowerCase();
    
    for (const name of allNames) {
      if (evNameLower.includes(name.toLowerCase())) {
        keys.push(resource.name);
        break;
      }
    }
  });
  
  if (ev.type === 'league' && !keys.includes('League')) keys.push('League');
  if (ev.type === 'specialty_league' && !keys.includes('Specialty League')) keys.push('Specialty League');
  
  return keys;
}

function getResourceSeverity(resourceKey) {
  const resource = conflictRules.resources.find(r => r.name === resourceKey);
  if (resource) return resource.type;
  return conflictRules.defaultBehavior;
}

function isOverlapAllowed(div1, div2) {
  return conflictRules.allowedOverlaps.some(pair => 
    (pair[0] === div1 && pair[1] === div2) || (pair[0] === div2 && pair[1] === div1)
  );
}

function timesOverlap(ev1, ev2) {
  const start1 = parseTimeToMinutes(ev1.startTime);
  const end1 = parseTimeToMinutes(ev1.endTime);
  const start2 = parseTimeToMinutes(ev2.startTime);
  const end2 = parseTimeToMinutes(ev2.endTime);
  
  if (start1 == null || end1 == null || start2 == null || end2 == null) return false;
  return (start1 < end2) && (end1 > start2);
}

function getConflictingEventIds(conflicts) {
  const ids = new Set();
  conflicts.forEach(c => {
    if (c.event1?.id) ids.add(c.event1.id);
    if (c.event2?.id) ids.add(c.event2.id);
  });
  return ids;
}

// =================================================================
// TIME UTILITIES
// =================================================================

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

function minutesToTime(min) {
  const hh = Math.floor(min / 60);
  const mm = min % 60;
  const h = hh % 12 === 0 ? 12 : hh % 12;
  const m = String(mm).padStart(2, '0');
  const ampm = hh < 12 ? 'am' : 'pm';
  return `${h}:${m}${ampm}`;
}

// =================================================================
// CONFLICT BANNER UI
// =================================================================

function renderConflictBanner(containerSelector, skeleton) {
  const container = document.querySelector(containerSelector);
  if (!container) return [];
  
  const existing = container.querySelector('.conflict-banner');
  if (existing) existing.remove();
  
  const conflicts = detectConflicts(skeleton);
  if (conflicts.length === 0) return [];
  
  const criticalCount = conflicts.filter(c => c.type === 'critical').length;
  const warningCount = conflicts.filter(c => c.type === 'warning').length;
  
  const banner = document.createElement('div');
  banner.className = 'conflict-banner';
  
  let iconHtml, bgColor, borderColor, textColor;
  
  if (criticalCount > 0) {
    iconHtml = '🚨'; bgColor = '#ffebee'; borderColor = '#ef5350'; textColor = '#c62828';
  } else {
    iconHtml = '⚠️'; bgColor = '#fff8e1'; borderColor = '#ffb300'; textColor = '#f57f17';
  }
  
  let message = criticalCount > 0 && warningCount > 0
    ? `${criticalCount} conflict${criticalCount > 1 ? 's' : ''}, ${warningCount} warning${warningCount > 1 ? 's' : ''}`
    : criticalCount > 0
    ? `${criticalCount} conflict${criticalCount > 1 ? 's' : ''}`
    : `${warningCount} warning${warningCount > 1 ? 's' : ''}`;
  
  const firstConflict = conflicts[0];
  const preview = firstConflict ? `: ${firstConflict.resource} (${firstConflict.event1.division} ↔ ${firstConflict.event2.division})` : '';
  
  banner.innerHTML = `
    <div style="background:${bgColor};border:2px solid ${borderColor};border-radius:8px;padding:12px 16px;margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">
      <div style="display:flex;align-items:center;gap:10px;">
        <span style="font-size:1.3em;">${iconHtml}</span>
        <span style="color:${textColor};font-weight:600;">${message}</span>
        <span style="color:#666;font-size:0.9em;">${preview}</span>
      </div>
      <button class="conflict-details-btn" style="background:white;border:1px solid ${borderColor};color:${textColor};padding:6px 12px;border-radius:4px;cursor:pointer;font-size:0.85em;">View All</button>
    </div>
  `;
  
  container.insertBefore(banner, container.firstChild);
  banner.querySelector('.conflict-details-btn').onclick = () => showConflictDetails(conflicts);
  
  return conflicts;
}

function showConflictDetails(conflicts) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:10000;display:flex;justify-content:center;align-items:center;';
  
  const modal = document.createElement('div');
  modal.style.cssText = 'background:white;border-radius:12px;padding:24px;max-width:600px;max-height:80vh;overflow-y:auto;box-shadow:0 20px 40px rgba(0,0,0,0.3);';
  
  let html = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
      <h3 style="margin:0;">Schedule Conflicts</h3>
      <button class="close-btn" style="background:none;border:none;font-size:1.5em;cursor:pointer;color:#999;">&times;</button>
    </div>
    <p style="color:#666;margin-bottom:16px;">Drag tiles on the skeleton to resolve conflicts.</p>
  `;
  
  conflicts.forEach(c => {
    const bg = c.type === 'critical' ? '#ffebee' : '#fff8e1';
    const border = c.type === 'critical' ? '#ef5350' : '#ffb300';
    const icon = c.type === 'critical' ? '🚨' : '⚠️';
    html += `
      <div style="background:${bg};border-left:4px solid ${border};padding:12px;margin-bottom:8px;border-radius:0 8px 8px 0;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;"><span>${icon}</span><strong>${c.resource}</strong></div>
        <div style="color:#555;font-size:0.9em;">
          <span style="background:#e3f2fd;padding:2px 6px;border-radius:3px;">${c.event1.division}</span> ${c.event1.startTime}-${c.event1.endTime}
          <span style="margin:0 8px;">↔</span>
          <span style="background:#e3f2fd;padding:2px 6px;border-radius:3px;">${c.event2.division}</span> ${c.event2.startTime}-${c.event2.endTime}
        </div>
      </div>
    `;
  });
  
  html += `<div style="margin-top:20px;text-align:right;"><button class="close-modal-btn" style="background:#333;color:white;border:none;padding:10px 20px;border-radius:6px;cursor:pointer;">Got it</button></div>`;
  
  modal.innerHTML = html;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  
  const close = () => overlay.remove();
  modal.querySelector('.close-btn').onclick = close;
  modal.querySelector('.close-modal-btn').onclick = close;
  overlay.onclick = (e) => { if (e.target === overlay) close(); };
}

// =================================================================
// FULLY CUSTOMIZABLE RULES MODAL
// =================================================================

function showConflictRulesModal() {
  loadConflictRules();
  
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:10000;display:flex;justify-content:center;align-items:center;padding:20px;';
  
  const modal = document.createElement('div');
  modal.style.cssText = 'background:white;border-radius:12px;padding:24px;max-width:700px;width:100%;max-height:90vh;overflow-y:auto;box-shadow:0 20px 40px rgba(0,0,0,0.3);';
  
  const renderResourceRows = () => conflictRules.resources.map((r, i) => `
    <div class="resource-row" data-index="${i}" style="display:flex;gap:8px;align-items:center;margin-bottom:8px;padding:8px;background:#f9f9f9;border-radius:4px;">
      <input type="text" class="res-name" value="${r.name}" placeholder="Name" style="flex:1;padding:6px;border:1px solid #ddd;border-radius:4px;">
      <input type="text" class="res-aliases" value="${(r.aliases || []).join(', ')}" placeholder="Aliases" style="flex:1;padding:6px;border:1px solid #ddd;border-radius:4px;">
      <select class="res-type" style="padding:6px;border:1px solid #ddd;border-radius:4px;">
        <option value="critical" ${r.type === 'critical' ? 'selected' : ''}>🔴 Critical</option>
        <option value="warning" ${r.type === 'warning' ? 'selected' : ''}>🟡 Warning</option>
        <option value="ignore" ${r.type === 'ignore' ? 'selected' : ''}>⚪ Ignore</option>
      </select>
      <button class="remove-res-btn" data-index="${i}" style="background:#ef5350;color:white;border:none;padding:6px 10px;border-radius:4px;cursor:pointer;">✕</button>
    </div>
  `).join('');
  
  const renderAllowedOverlaps = () => conflictRules.allowedOverlaps.length === 0
    ? '<p style="color:#999;font-size:0.9em;margin:0;">No exceptions</p>'
    : conflictRules.allowedOverlaps.map((pair, i) => `
      <div style="display:inline-flex;align-items:center;gap:4px;background:#e3f2fd;padding:4px 8px;border-radius:4px;margin:2px;">
        <span>${pair[0]} ↔ ${pair[1]}</span>
        <button class="remove-overlap-btn" data-index="${i}" style="background:none;border:none;cursor:pointer;color:#1976d2;">✕</button>
      </div>
    `).join('');
  
  modal.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
      <h3 style="margin:0;">⚙️ Conflict Detection Rules</h3>
      <button class="close-btn" style="background:none;border:none;font-size:1.5em;cursor:pointer;color:#999;">&times;</button>
    </div>
    
    <div style="margin-bottom:20px;padding:12px;background:#f5f5f5;border-radius:8px;">
      <label style="display:flex;align-items:center;gap:10px;cursor:pointer;">
        <input type="checkbox" id="rule-enabled" ${conflictRules.enabled ? 'checked' : ''} style="width:18px;height:18px;">
        <strong>Enable Conflict Detection</strong>
      </label>
    </div>
    
    <div style="margin-bottom:20px;">
      <h4 style="margin:0 0 10px 0;">📍 Resources</h4>
      <p style="color:#666;font-size:0.85em;margin-bottom:10px;">Define resources that cause conflicts when overlapping.</p>
      <div id="resources-list">${renderResourceRows()}</div>
      <button id="add-resource-btn" style="background:#e3f2fd;color:#1976d2;border:1px solid #90caf9;padding:8px 12px;border-radius:4px;cursor:pointer;margin-top:8px;">+ Add Resource</button>
    </div>
    
    <div style="margin-bottom:20px;">
      <h4 style="margin:0 0 10px 0;">🚫 Ignored Event Types</h4>
      <input type="text" id="ignored-types" value="${conflictRules.ignoredEventTypes.join(', ')}" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;box-sizing:border-box;">
      <p style="color:#999;font-size:0.8em;margin-top:4px;">Comma-separated (e.g., slot, activity, sports)</p>
    </div>
    
    <div style="margin-bottom:20px;">
      <h4 style="margin:0 0 10px 0;">🚫 Ignored Event Names</h4>
      <input type="text" id="ignored-names" value="${conflictRules.ignoredEventNames.join(', ')}" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;box-sizing:border-box;">
    </div>
    
    <div style="margin-bottom:20px;">
      <h4 style="margin:0 0 10px 0;">🤝 Allowed Division Overlaps</h4>
      <p style="color:#666;font-size:0.85em;margin-bottom:10px;">Divisions that can share resources:</p>
      <div id="allowed-overlaps-list" style="margin-bottom:10px;">${renderAllowedOverlaps()}</div>
      <div style="display:flex;gap:8px;align-items:center;">
        <select id="overlap-div1" style="flex:1;padding:6px;border:1px solid #ddd;border-radius:4px;">
          <option value="">Div 1...</option>
          ${(window.availableDivisions || []).map(d => `<option value="${d}">${d}</option>`).join('')}
        </select>
        <span>↔</span>
        <select id="overlap-div2" style="flex:1;padding:6px;border:1px solid #ddd;border-radius:4px;">
          <option value="">Div 2...</option>
          ${(window.availableDivisions || []).map(d => `<option value="${d}">${d}</option>`).join('')}
        </select>
        <button id="add-overlap-btn" style="background:#e8f5e9;color:#2e7d32;border:1px solid #a5d6a7;padding:6px 12px;border-radius:4px;cursor:pointer;">Add</button>
      </div>
    </div>
    
    <div style="margin-bottom:20px;">
      <h4 style="margin:0 0 10px 0;">⚙️ Other Options</h4>
      <label style="display:flex;align-items:center;gap:8px;margin-bottom:8px;cursor:pointer;">
        <input type="checkbox" id="pinned-conflict" ${conflictRules.pinnedEventsConflict ? 'checked' : ''}>
        <span>Same-name pinned events cause conflicts</span>
      </label>
      <label style="display:flex;align-items:center;gap:8px;margin-bottom:8px;cursor:pointer;">
        <input type="checkbox" id="reserved-conflict" ${conflictRules.reservedFieldsConflict ? 'checked' : ''}>
        <span>Reserved fields cause conflicts</span>
      </label>
      <div style="display:flex;align-items:center;gap:8px;margin-top:12px;">
        <span>Default for unlisted:</span>
        <select id="default-behavior" style="padding:6px;border:1px solid #ddd;border-radius:4px;">
          <option value="critical" ${conflictRules.defaultBehavior === 'critical' ? 'selected' : ''}>🔴 Critical</option>
          <option value="warning" ${conflictRules.defaultBehavior === 'warning' ? 'selected' : ''}>🟡 Warning</option>
          <option value="ignore" ${conflictRules.defaultBehavior === 'ignore' ? 'selected' : ''}>⚪ Ignore</option>
        </select>
      </div>
    </div>
    
    <div style="display:flex;justify-content:space-between;margin-top:20px;padding-top:15px;border-top:1px solid #eee;">
      <button id="reset-rules-btn" style="background:#fff3e0;color:#e65100;border:1px solid #ffcc80;padding:10px 16px;border-radius:6px;cursor:pointer;">Reset Defaults</button>
      <div style="display:flex;gap:10px;">
        <button class="cancel-btn" style="background:#f5f5f5;border:1px solid #ddd;padding:10px 20px;border-radius:6px;cursor:pointer;">Cancel</button>
        <button class="save-btn" style="background:#2563eb;color:white;border:none;padding:10px 20px;border-radius:6px;cursor:pointer;">Save</button>
      </div>
    </div>
  `;
  
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  
  const close = () => overlay.remove();
  modal.querySelector('.close-btn').onclick = close;
  modal.querySelector('.cancel-btn').onclick = close;
  overlay.onclick = (e) => { if (e.target === overlay) close(); };
  
  const attachResourceListeners = () => {
    modal.querySelectorAll('.remove-res-btn').forEach(btn => {
      btn.onclick = () => {
        conflictRules.resources.splice(parseInt(btn.dataset.index), 1);
        modal.querySelector('#resources-list').innerHTML = renderResourceRows();
        attachResourceListeners();
      };
    });
  };
  attachResourceListeners();
  
  modal.querySelector('#add-resource-btn').onclick = () => {
    conflictRules.resources.push({ name: '', type: 'warning', aliases: [] });
    modal.querySelector('#resources-list').innerHTML = renderResourceRows();
    attachResourceListeners();
  };
  
  const attachOverlapListeners = () => {
    modal.querySelectorAll('.remove-overlap-btn').forEach(btn => {
      btn.onclick = () => {
        conflictRules.allowedOverlaps.splice(parseInt(btn.dataset.index), 1);
        modal.querySelector('#allowed-overlaps-list').innerHTML = renderAllowedOverlaps();
        attachOverlapListeners();
      };
    });
  };
  attachOverlapListeners();
  
  modal.querySelector('#add-overlap-btn').onclick = () => {
    const div1 = modal.querySelector('#overlap-div1').value;
    const div2 = modal.querySelector('#overlap-div2').value;
    if (div1 && div2 && div1 !== div2) {
      const exists = conflictRules.allowedOverlaps.some(p => (p[0] === div1 && p[1] === div2) || (p[0] === div2 && p[1] === div1));
      if (!exists) {
        conflictRules.allowedOverlaps.push([div1, div2]);
        modal.querySelector('#allowed-overlaps-list').innerHTML = renderAllowedOverlaps();
        attachOverlapListeners();
      }
    }
  };
  
  modal.querySelector('#reset-rules-btn').onclick = () => {
    if (confirm('Reset all rules to defaults?')) { resetConflictRules(); close(); showConflictRulesModal(); }
  };
  
  modal.querySelector('.save-btn').onclick = () => {
    conflictRules.resources = [];
    modal.querySelectorAll('.resource-row').forEach(row => {
      const name = row.querySelector('.res-name').value.trim();
      const aliases = row.querySelector('.res-aliases').value.split(',').map(s => s.trim()).filter(Boolean);
      const type = row.querySelector('.res-type').value;
      if (name) conflictRules.resources.push({ name, aliases, type });
    });
    
    conflictRules.enabled = modal.querySelector('#rule-enabled').checked;
    conflictRules.ignoredEventTypes = modal.querySelector('#ignored-types').value.split(',').map(s => s.trim()).filter(Boolean);
    conflictRules.ignoredEventNames = modal.querySelector('#ignored-names').value.split(',').map(s => s.trim()).filter(Boolean);
    conflictRules.pinnedEventsConflict = modal.querySelector('#pinned-conflict').checked;
    conflictRules.reservedFieldsConflict = modal.querySelector('#reserved-conflict').checked;
    conflictRules.defaultBehavior = modal.querySelector('#default-behavior').value;
    
    saveConflictRules();
    close();
    if (window.refreshSkeletonConflicts) window.refreshSkeletonConflicts();
  };
}

// =================================================================
// EXPORTS
// =================================================================

loadConflictRules();

window.SkeletonSandbox = {
  detectConflicts,
  renderConflictBanner,
  showConflictRulesModal,
  loadConflictRules,
  saveConflictRules,
  resetConflictRules,
  getConflictingEventIds,
  parseTimeToMinutes,
  minutesToTime
};

})();
