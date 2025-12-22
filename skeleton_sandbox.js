// =================================================================
// skeleton_sandbox.js v4.1 — FIXED: Added getRules export
//
// ✔ Matches App Theme (Apple/System UI style)
// ✔ Segmented Controls for Severity
// ✔ Toggle Switches for constraints
// ✔ Fixed: getRules() function for conflict detection
// =================================================================

(function () {
  'use strict';

  // =================================================================
  // DEFAULT RULES & DATA
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
  const STORAGE_KEY = 'skeletonRules_v4';

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

  // Get the current rules (for conflict detection)
  function getRules() {
    loadRules();
    return rules.tileTypeRules || [];
  }

  // =================================================================
  // CONFLICT ENGINE (LOGIC CORE)
  // =================================================================

  function detectConflicts(skeleton) {
    loadRules(); // Always load latest rules
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

    // 1. Reserved Fields
    if (rules.reservedFieldsConflict) {
      const shared = (a.reservedFields || []).filter(f => (b.reservedFields || []).includes(f));
      if (shared.length) {
        return { type: 'critical', resource: `Field: ${shared[0]}`, event1: a, event2: b };
      }
    }

    // 2. Tile Type Rules
    for (const r of rules.tileTypeRules) {
      if (a.type === r.type && b.type === r.type) {
        if (r.matchSameName && a.event !== b.event) continue;
        return { type: r.severity, resource: r.label, event1: a, event2: b };
      }
    }

    // 3. Named Resources (Fallback)
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
  // CONFLICT BANNER UI
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
    // Matches theme styling for banners
    banner.style.cssText = `
      margin-bottom: 16px; padding: 12px 16px; border-radius: 12px;
      background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c;
      display: flex; align-items: center; justify-content: space-between;
      box-shadow: 0 4px 6px rgba(0,0,0,0.05); font-size: 0.9rem;
    `;
    
    banner.innerHTML = `
      <div style="display:flex; align-items:center; gap:8px;">
        <span style="font-size:1.2em">⚠️</span>
        <span>
            <strong>${crit ? `${crit} critical` : ''}${crit && warn ? ', ' : ''}${warn ? `${warn} warning` : ''}</strong> 
            conflicts detected.
        </span>
      </div>
      <button id="view-conflicts-btn" style="background:white; border:1px solid #f87171; color:#b91c1c; font-size:0.8rem; padding:4px 10px; border-radius:4px; cursor:pointer;">Review</button>
    `;
    container.prepend(banner);
    
    // Optional: wire up the button to show the modal if desired
    banner.querySelector('#view-conflicts-btn').onclick = () => showRulesModal();
    
    return conflicts;
  }

  // =================================================================
  // MODAL UI — THEME MATCHING
  // =================================================================

  function showRulesModal(onClose) {
    loadRules();
    const overlay = document.createElement('div');
    overlay.className = 'ss-overlay';
    
    // Ensure styles are injected
    injectStyles();

    const modal = document.createElement('div');
    modal.className = 'ss-modal';

    modal.innerHTML = `
      <div class="ss-modal-header">
        <div>
          <h2 class="ss-title">Conflict Rules</h2>
          <p class="ss-subtitle">Define which concurrent events trigger warnings.</p>
        </div>
        <button class="ss-close-btn">×</button>
      </div>

      <div class="ss-modal-body">
        <div class="ss-section-label">Event Type Rules</div>
        <div id="ss-rules-list" class="ss-list-container"></div>
        
        <button id="ss-add-btn" class="ss-add-btn">
          <span>+</span> Add Type Rule
        </button>
      </div>

      <div class="ss-modal-footer">
        <div style="flex:1"></div>
        <button class="ss-btn-primary">Done</button>
      </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Event Listeners
    const close = () => { 
      overlay.classList.add('fade-out'); 
      setTimeout(() => {
        overlay.remove();
        if (typeof onClose === 'function') onClose();
      }, 200); 
    };
    modal.querySelector('.ss-close-btn').onclick = close;
    modal.querySelector('.ss-btn-primary').onclick = () => { saveRules(); close(); };

    const listContainer = modal.querySelector('#ss-rules-list');

    // Render Function
    function renderList() {
      listContainer.innerHTML = '';
      
      if(rules.tileTypeRules.length === 0) {
        listContainer.innerHTML = `<div class="ss-empty-state">No active rules defined.</div>`;
        return;
      }

      rules.tileTypeRules.forEach((rule, index) => {
        const row = document.createElement('div');
        row.className = 'ss-rule-row';
        
        // HTML Structure for the Row
        row.innerHTML = `
          <div class="ss-col-name">
             <div class="ss-drag-handle">⋮⋮</div>
             <span class="ss-label-text">${rule.label}</span>
          </div>

          <div class="ss-col-severity">
            <div class="ss-segmented-control">
              <button class="${rule.severity === 'warning' ? 'active' : ''}" data-act="warn">Warn</button>
              <button class="${rule.severity === 'critical' ? 'active' : ''}" data-act="block">Block</button>
            </div>
          </div>

          <div class="ss-col-options">
            <div class="ss-toggle-wrapper" title="Only trigger if names match exactly">
              <label class="switch" style="margin:0; transform:scale(0.8);">
                <input type="checkbox" ${rule.matchSameName ? 'checked' : ''}>
                <span class="slider round"></span>
              </label>
              <span class="ss-toggle-label">Same event only</span>
            </div>
            <button class="ss-btn-delete" title="Remove Rule">×</button>
          </div>
        `;

        // Wiring events
        // 1. Severity Toggle
        const segBtns = row.querySelectorAll('.ss-segmented-control button');
        segBtns.forEach(btn => {
          btn.onclick = () => {
            rule.severity = btn.dataset.act === 'warn' ? 'warning' : 'critical';
            renderList();
          };
        });

        // 2. Checkbox (Switch)
        const chk = row.querySelector('input[type="checkbox"]');
        chk.onchange = () => {
          rule.matchSameName = chk.checked;
        };

        // 3. Delete
        row.querySelector('.ss-btn-delete').onclick = () => {
          if(confirm('Remove this rule?')) {
            rules.tileTypeRules.splice(index, 1);
            renderList();
          }
        };

        listContainer.appendChild(row);
      });
    }

    modal.querySelector('#ss-add-btn').onclick = () => {
      // Basic prompt for now, could be a nicer dropdown later
      const name = prompt("Enter event type label (e.g., 'Art'):", "New Activity");
      if(name) {
        rules.tileTypeRules.push({
          type: name.toLowerCase().replace(/\s/g, '_'),
          label: name,
          severity: 'warning',
          matchSameName: false
        });
        renderList();
      }
    };

    renderList();
  }

  // =================================================================
  // INJECTED CSS — MATCHING THEME
  // =================================================================

  function injectStyles() {
    if (document.getElementById('ss-theme-styles')) return;

    const css = `
      /* OVERLAY & MODAL */
      .ss-overlay {
        position: fixed; inset: 0; background: rgba(15, 23, 42, 0.45);
        backdrop-filter: blur(4px); z-index: 9999;
        display: flex; align-items: center; justify-content: center;
        opacity: 0; animation: ssFadeIn 0.2s forwards;
      }
      .ss-overlay.fade-out { animation: ssFadeOut 0.2s forwards; }

      .ss-modal {
        background: #ffffff; width: 650px; max-width: 95%;
        border-radius: 18px;
        box-shadow: 0 20px 60px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.05);
        display: flex; flex-direction: column; overflow: hidden;
        animation: ssSlideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      }

      /* HEADER */
      .ss-modal-header {
        padding: 20px 24px; border-bottom: 1px solid #f3f4f6;
        display: flex; justify-content: space-between; align-items: flex-start;
      }
      .ss-title { margin: 0; font-size: 1.25rem; font-weight: 700; color: #111827; }
      .ss-subtitle { margin: 4px 0 0; font-size: 0.85rem; color: #6b7280; }
      .ss-close-btn {
        background: transparent; border: none; font-size: 24px; color: #9ca3af;
        cursor: pointer; padding: 0; line-height: 1; transition: color 0.2s;
      }
      .ss-close-btn:hover { color: #111827; }

      /* BODY */
      .ss-modal-body { padding: 0; background: #fafafa; flex: 1; overflow-y: auto; max-height: 70vh; }
      .ss-section-label {
        padding: 16px 24px 8px; font-size: 0.75rem; font-weight: 600;
        text-transform: uppercase; letter-spacing: 0.05em; color: #9ca3af;
      }
      
      .ss-list-container { background: #fff; border-top: 1px solid #e5e7eb; border-bottom: 1px solid #e5e7eb; }
      
      /* ROW ITEM */
      .ss-rule-row {
        display: flex; align-items: center; padding: 12px 24px;
        border-bottom: 1px solid #f3f4f6; gap: 16px;
        transition: background 0.15s;
      }
      .ss-rule-row:last-child { border-bottom: none; }
      .ss-rule-row:hover { background: #f9fafb; }

      /* COLUMNS */
      .ss-col-name { flex: 1; display: flex; align-items: center; gap: 10px; }
      .ss-label-text { font-weight: 600; color: #1f2937; font-size: 0.95rem; }
      .ss-drag-handle { color: #e5e7eb; cursor: grab; font-size: 12px; letter-spacing: -2px; }

      .ss-col-severity { width: 140px; }
      
      .ss-col-options { width: 200px; display: flex; align-items: center; justify-content: flex-end; gap: 12px; }

      /* SEGMENTED CONTROL */
      .ss-segmented-control {
        display: flex; background: #f3f4f6; padding: 3px; border-radius: 8px;
        position: relative;
      }
      .ss-segmented-control button {
        flex: 1; border: none; background: transparent; padding: 4px 0;
        font-size: 0.75rem; font-weight: 600; color: #6b7280;
        border-radius: 6px; cursor: pointer; box-shadow: none;
        transition: all 0.2s ease;
      }
      .ss-segmented-control button:hover { color: #374151; }
      .ss-segmented-control button.active {
        background: #fff; color: #111827;
        box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      }
      .ss-segmented-control button.active[data-act="block"] { color: #b91c1c; }

      /* TOGGLE WRAPPER */
      .ss-toggle-wrapper { display: flex; align-items: center; gap: 8px; cursor: pointer; }
      .ss-toggle-label { font-size: 0.75rem; color: #6b7280; white-space: nowrap; }

      /* SWITCH STYLES */
      .switch { position: relative; display: inline-block; width: 36px; height: 20px; }
      .switch input { opacity: 0; width: 0; height: 0; }
      .slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: #ccc; transition: .3s; }
      .slider:before { position: absolute; content: ""; height: 14px; width: 14px; left: 3px; bottom: 3px; background-color: white; transition: .3s; }
      .switch input:checked + .slider { background-color: #2563eb; }
      .switch input:checked + .slider:before { transform: translateX(16px); }
      .slider.round { border-radius: 20px; }
      .slider.round:before { border-radius: 50%; }

      /* ADD BUTTON */
      .ss-add-btn {
        width: 100%; border: none; background: transparent; padding: 16px;
        color: #2563eb; font-weight: 600; font-size: 0.9rem; cursor: pointer;
        text-align: left; padding-left: 24px; transition: background 0.2s;
      }
      .ss-add-btn:hover { background: rgba(37, 99, 235, 0.05); }

      /* DELETE BUTTON */
      .ss-btn-delete {
        width: 28px; height: 28px; display: flex; align-items: center; justify-content: center;
        border-radius: 50%; border: none; background: transparent;
        color: #d1d5db; font-size: 18px; cursor: pointer; transition: all 0.2s;
      }
      .ss-btn-delete:hover { background: #fee2e2; color: #ef4444; }

      /* FOOTER */
      .ss-modal-footer {
        padding: 16px 24px; border-top: 1px solid #e5e7eb; background: #fff;
        display: flex; justify-content: flex-end;
      }
      .ss-btn-primary {
        background: #111827; color: #fff; padding: 8px 20px;
        border-radius: 999px; font-weight: 600; font-size: 0.9rem; border: none;
        cursor: pointer; box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        transition: transform 0.1s;
      }
      .ss-btn-primary:hover { background: #000; transform: translateY(-1px); }

      /* ANIMATIONS */
      @keyframes ssFadeIn { to { opacity: 1; } }
      @keyframes ssFadeOut { to { opacity: 0; } }
      @keyframes ssSlideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
      
      .ss-empty-state { padding: 30px; text-align: center; color: #9ca3af; font-style: italic; }
    `;

    const s = document.createElement('style');
    s.id = 'ss-theme-styles';
    s.textContent = css;
    document.head.appendChild(s);
  }

  // =================================================================
  // EXPORT
  // =================================================================

  window.SkeletonSandbox = {
    detectConflicts,
    renderBanner,
    showRulesModal,
    loadRules,
    saveRules,
    getRules  // ADDED: Required for conflict detection in daily_adjustments.js
  };

})();
