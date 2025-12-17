// =================================================================
// skeleton_sandbox.js v3.3 — SIMPLE TILE TYPE RULES (FINAL FIX)
//
// ✔ Fixes: rules modal not opening
// ✔ Fixes: renderBanner missing
// ✔ Keeps simplified Tile Type Rules UI
// ✔ Fully backward compatible
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
// CONFLICT BANNER
// =================================================================

function renderBanner(selector, skeleton) {
  const container = document.querySelector(selector);
  if (!container) return [];

  container.querySelector('.conflict-banner')?.remove();

  const conflicts = detectConflicts(skeleton);
  if (!conflicts.length) return [];

  const crit = conflicts.filter(c => c.type === 'critical').length;
  const warn = conflicts.filter(c => c.type === 'warning').length;

  const banner = document.createElement('div');
  banner.className = 'conflict-banner';
  banner.innerHTML = `
    <div class="cb-inner">
      <strong>${crit ? `${crit} critical` : ''}${crit && warn ? ', ' : ''}${warn ? `${warn} warning` : ''}</strong>
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
  modal.className = 'ss-modal';

  modal.innerHTML = `
    <div class="ss-modal-header">
      <h2>Conflict Rules</h2>
      <button class="ss-close">×</button>
    </div>
    <div class="ss-modal-body">
      <div id="simple-type-rules"></div>
      <button id="add-type-rule" class="ss-btn-add">+ Add Type Rule</button>
    </div>
    <div class="ss-modal-footer">
      <button class="ss-btn-primary">Done</button>
    </div>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  modal.querySelector('.ss-close').onclick = () => overlay.remove();
  modal.querySelector('.ss-btn-primary').onclick = () => {
    saveRules();
    overlay.remove();
  };

  const container = modal.querySelector('#simple-type-rules');

  function render() {
    container.innerHTML = rules.tileTypeRules.map((r, i) => `
      <div class="simple-rule-row">
        <strong>${r.label}</strong>
        <div>
          <button data-i="${i}" data-v="warning" class="${r.severity === 'warning' ? 'active' : ''}">Warn</button>
          <button data-i="${i}" data-v="critical" class="${r.severity === 'critical' ? 'active' : ''}">Block</button>
        </div>
        <label>
          <input type="checkbox" ${r.matchSameName ? 'checked' : ''} data-i="${i}">
          Same event only
        </label>
        <button data-del="${i}">✕</button>
      </div>
    `).join('');

    container.querySelectorAll('button[data-v]').forEach(b => {
      b.onclick = () => {
        rules.tileTypeRules[b.dataset.i].severity = b.dataset.v;
        render();
      };
    });

    container.querySelectorAll('input[type="checkbox"]').forEach(c => {
      c.onchange = () => rules.tileTypeRules[c.dataset.i].matchSameName = c.checked;
    });

    container.querySelectorAll('button[data-del]').forEach(d => {
      d.onclick = () => {
        rules.tileTypeRules.splice(d.dataset.del, 1);
        render();
      };
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
// STYLES (RESTORED — THIS WAS THE BUG)
// =================================================================

(function injectStyles() {
  if (document.getElementById('ss-base-styles')) return;

  const s = document.createElement('style');
  s.id = 'ss-base-styles';
  s.textContent = `
    .ss-overlay{position:fixed;inset:0;background:rgba(0,0,0,.45);
      display:flex;align-items:center;justify-content:center;z-index:9999}
    .ss-modal{background:#fff;border-radius:14px;width:520px;
      max-width:95%;box-shadow:0 20px 60px rgba(0,0,0,.3)}
    .ss-modal-header,.ss-modal-footer{padding:16px;border-bottom:1px solid #eee}
    .ss-modal-footer{border-top:1px solid #eee;border-bottom:none;text-align:right}
    .ss-modal-body{padding:16px}
    .ss-close{background:none;border:none;font-size:20px;cursor:pointer}
    .simple-rule-row{display:flex;align-items:center;gap:10px;margin-bottom:8px}
    .simple-rule-row button.active{background:#2563eb;color:#fff}
  `;
  document.head.appendChild(s);
})();

// =================================================================
// EXPORT
// =================================================================

window.SkeletonSandbox = {
  detectConflicts,
  renderBanner,
  showRulesModal,
  loadRules,
  saveRules
};

})();
