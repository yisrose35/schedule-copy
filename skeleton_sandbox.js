// =================================================================
// skeleton_sandbox.js v3.2 — SIMPLE TILE TYPE RULES (DROP-IN READY)
//
// ✔ Fixes: renderBanner missing error
// ✔ Conflict engine unchanged
// ✔ Storage unchanged
// ✔ Simplified Tile Type Rules UI
// ✔ Backward compatible with daily_adjustments.js
// =================================================================

(function () {
'use strict';

// =================================================================
// DEFAULT RULES
// =================================================================

const DEFAULT_RULES = {
  enabled: true,
  tileTypeRules: [
    { type: 'swim', severity: 'critical', label: 'Swim' },
    { type: 'pinned', severity: 'warning', label: 'Pinned Events', matchSameName: true },
    { type: 'league', severity: 'warning', label: 'League Games' },
    { type: 'specialty_league', severity: 'warning', label: 'Specialty Leagues' }
  ],
  namedResources: [
    { name: 'Pool', severity: 'critical' },
    { name: 'Gym', severity: 'warning' }
  ],
  reservedFieldsConflict: true,
  allowedPairs: [],
  ignoredTypes: ['slot', 'activity', 'sports', 'special'],
  ignoredNames: ['General Activity Slot', 'Sports Slot', 'Special Activity', 'Activity', 'Free']
};

let rules = JSON.parse(JSON.stringify(DEFAULT_RULES));
const STORAGE_KEY = 'skeletonRules_v3';

// =================================================================
// STORAGE
// =================================================================

function loadRules() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) rules = { ...DEFAULT_RULES, ...JSON.parse(saved) };
  } catch {}
  return rules;
}

function saveRules() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(rules)); } catch {}
}

// =================================================================
// CONFLICT ENGINE
// =================================================================

function detectConflicts(skeleton) {
  if (!skeleton?.length || !rules.enabled) return [];
  const conflicts = [];
  const seen = new Set();

  for (let i = 0; i < skeleton.length; i++) {
    for (let j = i + 1; j < skeleton.length; j++) {
      const a = skeleton[i], b = skeleton[j];
      if (a.division === b.division) continue;

      const key = [a.id, b.id].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);

      if (!timesOverlap(a, b)) continue;
      if (isPairAllowed(a.division, b.division)) continue;

      const c = findConflict(a, b);
      if (c) conflicts.push(c);
    }
  }
  return conflicts;
}

function findConflict(a, b) {
  if (rules.ignoredTypes.includes(a.type) || rules.ignoredTypes.includes(b.type)) return null;
  if (rules.ignoredNames.includes(a.event) || rules.ignoredNames.includes(b.event)) return null;

  if (rules.reservedFieldsConflict) {
    const shared = (a.reservedFields || []).filter(f => (b.reservedFields || []).includes(f));
    if (shared.length) {
      return { type: 'critical', resource: `Field: ${shared[0]}`, event1: a, event2: b };
    }
  }

  for (const r of rules.tileTypeRules) {
    if (a.type === r.type && b.type === r.type) {
      if (r.matchSameName && a.event !== b.event) continue;
      return { type: r.severity, resource: r.label, event1: a, event2: b };
    }
  }

  for (const r of rules.namedResources) {
    const n = r.name.toLowerCase();
    if (a.event?.toLowerCase().includes(n) && b.event?.toLowerCase().includes(n)) {
      return { type: r.severity, resource: r.name, event1: a, event2: b };
    }
  }
  return null;
}

function isPairAllowed(a, b) {
  return rules.allowedPairs.some(p =>
    (p[0] === a && p[1] === b) || (p[0] === b && p[1] === a)
  );
}

// =================================================================
// TIME HELPERS
// =================================================================

function parseTime(str) {
  if (!str) return null;
  let s = str.toLowerCase().trim();
  let mer = null;
  if (s.endsWith('am') || s.endsWith('pm')) {
    mer = s.slice(-2);
    s = s.slice(0, -2).trim();
  }
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  let h = +m[1], min = +m[2];
  if (mer === 'pm' && h !== 12) h += 12;
  if (mer === 'am' && h === 12) h = 0;
  if (!mer && h <= 7) h += 12;
  return h * 60 + min;
}

function timesOverlap(a, b) {
  const s1 = parseTime(a.startTime), e1 = parseTime(a.endTime);
  const s2 = parseTime(b.startTime), e2 = parseTime(b.endTime);
  return s1 < e2 && e1 > s2;
}

// =================================================================
// CONFLICT BANNER (RESTORED — FIX)
// =================================================================

function renderBanner(selector, skeleton) {
  const container = document.querySelector(selector);
  if (!container) return [];

  container.querySelector('.conflict-banner')?.remove();

  const conflicts = detectConflicts(skeleton);
  if (!conflicts.length) return [];

  const crit = conflicts.filter(c => c.type === 'critical').length;
  const warn = conflicts.filter(c => c.type === 'warning').length;
  const hasCrit = crit > 0;

  const banner = document.createElement('div');
  banner.className = 'conflict-banner';
  banner.innerHTML = `
    <div class="cb-inner ${hasCrit ? 'cb-critical' : 'cb-warning'}">
      <div class="cb-icon">${hasCrit ? '🚨' : '⚠️'}</div>
      <div class="cb-text">
        <strong>
          ${crit ? `${crit} critical` : ''}
          ${crit && warn ? ', ' : ''}
          ${warn ? `${warn} warning` : ''}
        </strong>
      </div>
    </div>
  `;

  container.prepend(banner);
  return conflicts;
}

// =================================================================
// RULES MODAL — SIMPLE TILE TYPE RULES
// =================================================================

function showRulesModal() {
  loadRules();

  const overlay = document.createElement('div');
  overlay.className = 'ss-overlay';

  const modal = document.createElement('div');
  modal.className = 'ss-modal ss-rules-modal';

  modal.innerHTML = `
    <div class="ss-modal-header">
      <h2>Conflict Rules</h2>
      <button class="ss-close">×</button>
    </div>

    <div class="ss-modal-body">
      <h3>Tile Type Rules</h3>
      <p class="ss-hint">Choose how activities behave when scheduled at the same time.</p>
      <div id="simple-type-rules"></div>
      <button id="add-type-rule" class="ss-btn-add">+ Add Type Rule</button>
    </div>

    <div class="ss-modal-footer">
      <button class="ss-btn-primary">Done</button>
    </div>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  modal.querySelector('.ss-close').onclick = close;
  modal.querySelector('.ss-btn-primary').onclick = () => { saveRules(); close(); };

  const container = modal.querySelector('#simple-type-rules');

  function render() {
    container.innerHTML = rules.tileTypeRules.map((r, i) => `
      <div class="simple-rule-row">
        <div class="rule-label">${r.label}</div>
        <div class="rule-severity">
          ${['warning','critical'].map(v => `
            <button class="${r.severity === v ? 'active' : ''}"
              data-i="${i}" data-v="${v}">
              ${v === 'warning' ? 'Warn' : 'Block'}
            </button>
          `).join('')}
        </div>
        <label class="rule-same">
          <input type="checkbox" ${r.matchSameName ? 'checked' : ''} data-i="${i}">
          Same event only
        </label>
        <button class="rule-delete" data-i="${i}">✕</button>
      </div>
    `).join('');

    container.querySelectorAll('.rule-severity button').forEach(b => {
      b.onclick = () => {
        rules.tileTypeRules[b.dataset.i].severity = b.dataset.v;
        render();
      };
    });

    container.querySelectorAll('.rule-same input').forEach(c => {
      c.onchange = () => rules.tileTypeRules[c.dataset.i].matchSameName = c.checked;
    });

    container.querySelectorAll('.rule-delete').forEach(d => {
      d.onclick = () => { rules.tileTypeRules.splice(d.dataset.i, 1); render(); };
    });
  }

  modal.querySelector('#add-type-rule').onclick = () => {
    rules.tileTypeRules.push({
      type: 'custom',
      label: 'New Activity',
      severity: 'warning',
      matchSameName: false
    });
    render();
  };

  render();
}

// =================================================================
// STYLES
// =================================================================

(function injectStyles() {
  if (document.getElementById('ss-simple-styles')) return;
  const s = document.createElement('style');
  s.id = 'ss-simple-styles';
  s.textContent = `
    .simple-rule-row{display:flex;align-items:center;gap:10px;
      padding:10px 12px;border:1px solid #e5e7eb;border-radius:12px;
      background:#fff;margin-bottom:8px}
    .rule-label{font-weight:600;min-width:140px}
    .rule-severity button{border-radius:999px;padding:6px 12px;
      border:1px solid #d1d5db;background:#f9fafb}
    .rule-severity button.active{background:#2563eb;color:#fff;border-color:#2563eb}
    .rule-same{font-size:.8rem;color:#6b7280}
    .rule-delete{border:none;background:#fee2e2;color:#b91c1c;
      border-radius:999px;padding:4px 10px;cursor:pointer}
  `;
  document.head.appendChild(s);
})();

// =================================================================
// EXPORT (BACKWARD COMPATIBLE)
// =================================================================

window.SkeletonSandbox = {
  detectConflicts,
  renderBanner,
  showRulesModal,
  loadRules,
  saveRules
};

})();
