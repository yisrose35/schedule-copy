// =================================================================
// skeleton_sandbox.js
// 
// Enhances the skeleton editor with:
// - Real-time conflict detection across divisions
// - Visual highlighting (red pulse for critical, yellow for warnings)
// - Configurable conflict rules
// - Conflict banner with summary
// =================================================================

(function() {
'use strict';

// =================================================================
// CONFLICT RULES CONFIGURATION
// =================================================================

const DEFAULT_CONFLICT_RULES = {
  // Resources that cause RED conflicts (critical - must fix)
  critical: ['Swim', 'Pool', 'Swimming Pool'],
  
  // Resources that cause YELLOW warnings (optional to fix)
  warnings: [],
  
  // If true, any field overlap is critical
  allFieldsCritical: false,
  
  // Ignore general activity slot overlaps entirely
  ignoreGeneralOverlaps: true
};

let conflictRules = { ...DEFAULT_CONFLICT_RULES };
const CONFLICT_RULES_KEY = 'skeletonConflictRules_v1';

function loadConflictRules() {
  try {
    const saved = localStorage.getItem(CONFLICT_RULES_KEY);
    if (saved) {
      conflictRules = { ...DEFAULT_CONFLICT_RULES, ...JSON.parse(saved) };
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

// =================================================================
// CONFLICT DETECTION ENGINE
// =================================================================

function detectConflicts(skeleton) {
  const conflicts = [];
  
  if (!skeleton || skeleton.length === 0) return conflicts;
  
  // Group events by resource type
  const eventsByType = {};
  skeleton.forEach(ev => {
    const key = getConflictKey(ev);
    if (!key) return;
    
    if (!eventsByType[key]) eventsByType[key] = [];
    eventsByType[key].push(ev);
  });
  
  // Check each resource type for overlaps across divisions
  Object.keys(eventsByType).forEach(resourceKey => {
    const events = eventsByType[resourceKey];
    if (events.length < 2) return;
    
    for (let i = 0; i < events.length; i++) {
      for (let j = i + 1; j < events.length; j++) {
        const ev1 = events[i];
        const ev2 = events[j];
        
        // Same division handled by overlap removal
        if (ev1.division === ev2.division) continue;
        
        if (timesOverlap(ev1, ev2)) {
          const severity = getConflictSeverity(resourceKey);
          
          conflicts.push({
            type: severity,
            resource: resourceKey,
            event1: ev1,
            event2: ev2,
            message: `${resourceKey} overlaps: ${ev1.division} (${ev1.startTime}-${ev1.endTime}) & ${ev2.division} (${ev2.startTime}-${ev2.endTime})`
          });
        }
      }
    }
  });
  
  return conflicts;
}

function getConflictKey(ev) {
  if (!ev) return null;
  
  // Skip general activity slots if configured
  if (conflictRules.ignoreGeneralOverlaps) {
    const generalTypes = ['slot', 'activity', 'sports', 'special'];
    if (generalTypes.includes(ev.type)) return null;
    
    const generalNames = ['General Activity Slot', 'Sports Slot', 'Special Activity', 'Activity'];
    if (generalNames.includes(ev.event)) return null;
  }
  
  // For pinned events, use the event name
  if (ev.type === 'pinned') {
    return ev.event;
  }
  
  // For events with reserved fields
  if (ev.reservedFields && ev.reservedFields.length > 0) {
    return ev.reservedFields[0];
  }
  
  // For swim specifically
  if (ev.event && ev.event.toLowerCase().includes('swim')) {
    return 'Swim';
  }
  
  // For leagues
  if (ev.type === 'league') return 'League';
  if (ev.type === 'specialty_league') return 'Specialty League';
  
  return null;
}

function getConflictSeverity(resourceKey) {
  if (conflictRules.allFieldsCritical) return 'critical';
  
  const keyLower = resourceKey.toLowerCase();
  
  for (const critical of conflictRules.critical) {
    if (keyLower.includes(critical.toLowerCase())) return 'critical';
  }
  
  for (const warning of conflictRules.warnings) {
    if (keyLower.includes(warning.toLowerCase())) return 'warning';
  }
  
  return 'warning';
}

function timesOverlap(ev1, ev2) {
  const start1 = parseTimeToMinutes(ev1.startTime);
  const end1 = parseTimeToMinutes(ev1.endTime);
  const start2 = parseTimeToMinutes(ev2.startTime);
  const end2 = parseTimeToMinutes(ev2.endTime);
  
  if (start1 == null || end1 == null || start2 == null || end2 == null) {
    return false;
  }
  
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

// =================================================================
// CONFLICT BANNER UI
// =================================================================

function renderConflictBanner(containerSelector, skeleton) {
  const container = document.querySelector(containerSelector);
  if (!container) return;
  
  const existing = container.querySelector('.conflict-banner');
  if (existing) existing.remove();
  
  const conflicts = detectConflicts(skeleton);
  
  if (conflicts.length === 0) return;
  
  const criticalCount = conflicts.filter(c => c.type === 'critical').length;
  const warningCount = conflicts.filter(c => c.type === 'warning').length;
  
  const banner = document.createElement('div');
  banner.className = 'conflict-banner';
  
  let iconHtml, bgColor, borderColor, textColor;
  
  if (criticalCount > 0) {
    iconHtml = '🚨';
    bgColor = '#ffebee';
    borderColor = '#ef5350';
    textColor = '#c62828';
  } else {
    iconHtml = '⚠️';
    bgColor = '#fff8e1';
    borderColor = '#ffb300';
    textColor = '#f57f17';
  }
  
  let message = '';
  if (criticalCount > 0 && warningCount > 0) {
    message = `${criticalCount} conflict${criticalCount > 1 ? 's' : ''}, ${warningCount} warning${warningCount > 1 ? 's' : ''}`;
  } else if (criticalCount > 0) {
    message = `${criticalCount} conflict${criticalCount > 1 ? 's' : ''} detected`;
  } else {
    message = `${warningCount} warning${warningCount > 1 ? 's' : ''}`;
  }
  
  const firstConflict = conflicts[0];
  const preview = firstConflict ? `: ${firstConflict.resource} (${firstConflict.event1.division} ↔ ${firstConflict.event2.division})` : '';
  
  banner.innerHTML = `
    <div style="
      background: ${bgColor};
      border: 2px solid ${borderColor};
      border-radius: 8px;
      padding: 12px 16px;
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 10px;
    ">
      <div style="display: flex; align-items: center; gap: 10px;">
        <span style="font-size: 1.3em;">${iconHtml}</span>
        <span style="color: ${textColor}; font-weight: 600;">${message}</span>
        <span style="color: #666; font-size: 0.9em;">${preview}</span>
      </div>
      <div style="display: flex; gap: 8px;">
        <button class="conflict-details-btn" style="
          background: white;
          border: 1px solid ${borderColor};
          color: ${textColor};
          padding: 6px 12px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 0.85em;
        ">View All</button>
      </div>
    </div>
  `;
  
  container.insertBefore(banner, container.firstChild);
  
  banner.querySelector('.conflict-details-btn').onclick = () => showConflictDetails(conflicts);
  
  return conflicts;
}

function showConflictDetails(conflicts) {
  const overlay = document.createElement('div');
  overlay.className = 'conflict-overlay';
  overlay.style.cssText = `
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.5);
    z-index: 10000;
    display: flex;
    justify-content: center;
    align-items: center;
  `;
  
  const modal = document.createElement('div');
  modal.style.cssText = `
    background: white;
    border-radius: 12px;
    padding: 24px;
    max-width: 600px;
    max-height: 80vh;
    overflow-y: auto;
    box-shadow: 0 20px 40px rgba(0,0,0,0.3);
  `;
  
  let html = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
      <h3 style="margin: 0;">Schedule Conflicts</h3>
      <button class="close-btn" style="background: none; border: none; font-size: 1.5em; cursor: pointer; color: #999;">&times;</button>
    </div>
    <p style="color: #666; margin-bottom: 16px;">Drag tiles on the skeleton grid to resolve these conflicts.</p>
  `;
  
  conflicts.forEach((c) => {
    const bg = c.type === 'critical' ? '#ffebee' : '#fff8e1';
    const border = c.type === 'critical' ? '#ef5350' : '#ffb300';
    const icon = c.type === 'critical' ? '🚨' : '⚠️';
    
    html += `
      <div style="
        background: ${bg};
        border-left: 4px solid ${border};
        padding: 12px;
        margin-bottom: 8px;
        border-radius: 0 8px 8px 0;
      ">
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
          <span>${icon}</span>
          <strong>${c.resource}</strong>
        </div>
        <div style="color: #555; font-size: 0.9em;">
          <span style="background: #e3f2fd; padding: 2px 6px; border-radius: 3px;">${c.event1.division}</span>
          ${c.event1.startTime} - ${c.event1.endTime}
          <span style="margin: 0 8px;">↔</span>
          <span style="background: #e3f2fd; padding: 2px 6px; border-radius: 3px;">${c.event2.division}</span>
          ${c.event2.startTime} - ${c.event2.endTime}
        </div>
      </div>
    `;
  });
  
  html += `
    <div style="margin-top: 20px; text-align: right;">
      <button class="close-modal-btn" style="
        background: #333;
        color: white;
        border: none;
        padding: 10px 20px;
        border-radius: 6px;
        cursor: pointer;
      ">Got it</button>
    </div>
  `;
  
  modal.innerHTML = html;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  
  const close = () => overlay.remove();
  overlay.querySelector('.close-btn').onclick = close;
  overlay.querySelector('.close-modal-btn').onclick = close;
  overlay.onclick = (e) => { if (e.target === overlay) close(); };
}

function showConflictRulesModal() {
  loadConflictRules();
  
  const overlay = document.createElement('div');
  overlay.className = 'conflict-overlay';
  overlay.style.cssText = `
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.5);
    z-index: 10000;
    display: flex;
    justify-content: center;
    align-items: center;
  `;
  
  const modal = document.createElement('div');
  modal.style.cssText = `
    background: white;
    border-radius: 12px;
    padding: 24px;
    max-width: 500px;
    box-shadow: 0 20px 40px rgba(0,0,0,0.3);
  `;
  
  modal.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
      <h3 style="margin: 0;">⚙️ Conflict Detection Rules</h3>
      <button class="close-btn" style="background: none; border: none; font-size: 1.5em; cursor: pointer; color: #999;">&times;</button>
    </div>
    
    <p style="color: #666; font-size: 0.9em; margin-bottom: 20px;">
      Configure which resources trigger conflict alerts when overlapping across divisions.
    </p>
    
    <div style="margin-bottom: 16px;">
      <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
        <input type="checkbox" id="rule-ignore-general" ${conflictRules.ignoreGeneralOverlaps ? 'checked' : ''}>
        <span>Ignore general activity slot overlaps</span>
      </label>
      <p style="color: #999; font-size: 0.8em; margin: 4px 0 0 26px;">
        Activity/Sports/Special slots won't trigger conflicts
      </p>
    </div>
    
    <div style="margin-bottom: 16px;">
      <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
        <input type="checkbox" id="rule-all-fields" ${conflictRules.allFieldsCritical ? 'checked' : ''}>
        <span>All resource overlaps are critical (red)</span>
      </label>
    </div>
    
    <div style="margin-bottom: 16px;">
      <label style="font-weight: 600; display: block; margin-bottom: 6px;">Critical Resources (red alerts)</label>
      <input type="text" id="rule-critical" value="${conflictRules.critical.join(', ')}" 
        style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box;"
        placeholder="e.g., Swim, Pool, Basketball Court">
      <p style="color: #999; font-size: 0.8em; margin-top: 4px;">Comma-separated</p>
    </div>
    
    <div style="margin-bottom: 20px;">
      <label style="font-weight: 600; display: block; margin-bottom: 6px;">Warning Resources (yellow alerts)</label>
      <input type="text" id="rule-warnings" value="${conflictRules.warnings.join(', ')}" 
        style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box;"
        placeholder="e.g., Gaga Pit, Art Room">
    </div>
    
    <div style="display: flex; justify-content: flex-end; gap: 10px;">
      <button class="cancel-btn" style="
        background: #f5f5f5;
        border: 1px solid #ddd;
        padding: 10px 20px;
        border-radius: 6px;
        cursor: pointer;
      ">Cancel</button>
      <button class="save-btn" style="
        background: #2563eb;
        color: white;
        border: none;
        padding: 10px 20px;
        border-radius: 6px;
        cursor: pointer;
      ">Save Rules</button>
    </div>
  `;
  
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  
  const close = () => overlay.remove();
  modal.querySelector('.close-btn').onclick = close;
  modal.querySelector('.cancel-btn').onclick = close;
  overlay.onclick = (e) => { if (e.target === overlay) close(); };
  
  modal.querySelector('.save-btn').onclick = () => {
    conflictRules.ignoreGeneralOverlaps = modal.querySelector('#rule-ignore-general').checked;
    conflictRules.allFieldsCritical = modal.querySelector('#rule-all-fields').checked;
    conflictRules.critical = modal.querySelector('#rule-critical').value
      .split(',').map(s => s.trim()).filter(Boolean);
    conflictRules.warnings = modal.querySelector('#rule-warnings').value
      .split(',').map(s => s.trim()).filter(Boolean);
    
    saveConflictRules();
    close();
    
    if (window.refreshSkeletonConflicts) {
      window.refreshSkeletonConflicts();
    }
  };
}

// =================================================================
// INITIALIZATION
// =================================================================

loadConflictRules();

// Export
window.SkeletonSandbox = {
  detectConflicts,
  renderConflictBanner,
  showConflictRulesModal,
  loadConflictRules,
  saveConflictRules,
  getConflictingEventIds
};

})();
