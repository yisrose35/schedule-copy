// =================================================================
// skeleton_sandbox.js v5.0 — TILE-BASED CONFLICT DETECTOR
//
// ✔ Shows all tiles from skeleton
// ✔ 3-way severity: Warn (Red) | Notice (Yellow) | Ignore
// ✔ Add custom tile types for pinned events
// ✔ Scans grid and highlights conflicts
// =================================================================

(function () {
  'use strict';

  // =================================================================
  // STORAGE
  // =================================================================

  const STORAGE_KEY = 'conflictRules_v5';
  
  // Rules stored as: { "Swim": "warn", "Lunch": "notice", "League Game": "ignore" }
  let tileRules = {};

  function loadRules() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) tileRules = JSON.parse(saved);
    } catch {}
    return tileRules;
  }

  function saveRules() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(tileRules)); } catch {}
  }

  function getRules() {
    loadRules();
    return tileRules;
  }

  // =================================================================
  // GET ALL UNIQUE TILES FROM SKELETON
  // =================================================================

  function getUniqueTilesFromSkeleton(skeleton) {
    if (!skeleton || !Array.isArray(skeleton)) return [];
    
    const seen = new Set();
    const tiles = [];
    
    skeleton.forEach(item => {
      const name = item.event || item.name;
      if (!name || seen.has(name)) return;
      
      // Skip generic slots
      const lower = name.toLowerCase();
      if (lower.includes('general activity') || 
          lower.includes('sports slot') || 
          lower.includes('special activity') ||
          lower === 'activity' ||
          lower === 'free') return;
      
      seen.add(name);
      tiles.push({
        name: name,
        type: item.type || 'custom',
        count: skeleton.filter(s => s.event === name).length
      });
    });
    
    // Sort by count (most used first), then alphabetically
    tiles.sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.name.localeCompare(b.name);
    });
    
    return tiles;
  }

  // =================================================================
  // CONFLICT DETECTION ENGINE
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
    if (s1 === null || e1 === null || s2 === null || e2 === null) return false;
    return s1 < e2 && e1 > s2;
  }

  function detectConflicts(skeleton) {
    loadRules();
    if (!skeleton?.length) return [];
    
    const conflicts = [];
    const seen = new Set();

    for (let i = 0; i < skeleton.length; i++) {
      for (let j = i + 1; j < skeleton.length; j++) {
        const a = skeleton[i], b = skeleton[j];
        
        // Must be different divisions
        if (a.division === b.division) continue;
        
        // Must be same event type/name
        if (a.event !== b.event) continue;
        
        // Must overlap in time
        if (!timesOverlap(a, b)) continue;
        
        // Check if this tile type has a rule
        const severity = tileRules[a.event];
        if (!severity || severity === 'ignore') continue;
        
        // Avoid duplicate conflict entries
        const key = [a.id, b.id].sort().join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        
        conflicts.push({
          type: severity, // 'warn' or 'notice'
          resource: a.event,
          event1: a,
          event2: b
        });
      }
    }
    
    // Also check for reserved field conflicts
    for (let i = 0; i < skeleton.length; i++) {
      for (let j = i + 1; j < skeleton.length; j++) {
        const a = skeleton[i], b = skeleton[j];
        
        if (a.division === b.division) continue;
        if (!timesOverlap(a, b)) continue;
        
        // Check reserved fields overlap
        const aFields = a.reservedFields || [];
        const bFields = b.reservedFields || [];
        const shared = aFields.filter(f => bFields.includes(f));
        
        if (shared.length > 0) {
          const key = `field_${[a.id, b.id].sort().join('|')}`;
          if (seen.has(key)) continue;
          seen.add(key);
          
          conflicts.push({
            type: 'warn', // Field conflicts are always warnings
            resource: `Field: ${shared[0]}`,
            event1: a,
            event2: b
          });
        }
      }
    }
    
    return conflicts;
  }

  // =================================================================
  // MODAL UI
  // =================================================================

  function showRulesModal(onClose, currentSkeleton) {
    loadRules();
    
    // Get skeleton from window if not provided
    const skeleton = currentSkeleton || window.dailyOverrideSkeleton || [];
    const tiles = getUniqueTilesFromSkeleton(skeleton);
    
    // Inject styles
    injectStyles();
    
    const overlay = document.createElement('div');
    overlay.className = 'cd-overlay';

    const modal = document.createElement('div');
    modal.className = 'cd-modal';

    modal.innerHTML = `
      <div class="cd-header">
        <div>
          <h2 class="cd-title">Conflict Detection</h2>
          <p class="cd-subtitle">Set how each tile type should be flagged when it appears in multiple divisions at the same time.</p>
        </div>
        <button class="cd-close-btn">×</button>
      </div>

      <div class="cd-body">
        <div class="cd-legend">
          <span class="cd-legend-item"><span class="cd-dot cd-dot-warn"></span> Warn (Red)</span>
          <span class="cd-legend-item"><span class="cd-dot cd-dot-notice"></span> Notice (Yellow)</span>
          <span class="cd-legend-item"><span class="cd-dot cd-dot-ignore"></span> Ignore</span>
        </div>
        
        <div class="cd-tiles-list" id="cd-tiles-list">
          <!-- Tiles will be rendered here -->
        </div>
        
        <button id="cd-add-custom" class="cd-add-btn">
          <span>+</span> Add Custom Tile Type
        </button>
      </div>

      <div class="cd-footer">
        <button class="cd-btn-secondary" id="cd-reset-btn">Reset to Defaults</button>
        <button class="cd-btn-primary" id="cd-apply-btn">Apply & Scan</button>
      </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const listContainer = modal.querySelector('#cd-tiles-list');

    // Close handler
    const close = (shouldApply = false) => {
      overlay.classList.add('fade-out');
      setTimeout(() => {
        overlay.remove();
        if (shouldApply && typeof onClose === 'function') {
          onClose();
        }
      }, 200);
    };

    modal.querySelector('.cd-close-btn').onclick = () => close(false);
    
    modal.querySelector('#cd-apply-btn').onclick = () => {
      saveRules();
      close(true);
    };
    
    modal.querySelector('#cd-reset-btn').onclick = () => {
      if (confirm('Reset all rules to defaults?')) {
        // Set sensible defaults
        tileRules = {};
        tiles.forEach(t => {
          const lower = t.name.toLowerCase();
          if (lower.includes('swim') || lower.includes('pool')) {
            tileRules[t.name] = 'warn';
          } else if (lower.includes('league') || lower.includes('lunch') || lower.includes('dismissal')) {
            tileRules[t.name] = 'notice';
          } else {
            tileRules[t.name] = 'ignore';
          }
        });
        renderTiles();
      }
    };

    modal.querySelector('#cd-add-custom').onclick = () => {
      const name = prompt("Enter tile/event name:", "");
      if (name && name.trim()) {
        const trimmed = name.trim();
        if (!tileRules.hasOwnProperty(trimmed)) {
          tileRules[trimmed] = 'notice';
          // Add to tiles list for rendering
          tiles.push({ name: trimmed, type: 'custom', count: 0 });
          renderTiles();
        } else {
          alert('This tile type already exists.');
        }
      }
    };

    function renderTiles() {
      listContainer.innerHTML = '';
      
      if (tiles.length === 0) {
        listContainer.innerHTML = `
          <div class="cd-empty">
            No tiles found in the skeleton. Add a custom tile type or load a skeleton template first.
          </div>
        `;
        return;
      }

      tiles.forEach(tile => {
        // Get current severity or default to 'ignore'
        let severity = tileRules[tile.name];
        if (!severity) {
          // Auto-detect sensible defaults
          const lower = tile.name.toLowerCase();
          if (lower.includes('swim') || lower.includes('pool')) {
            severity = 'warn';
          } else if (lower.includes('league') || lower.includes('lunch') || lower.includes('dismissal') || lower.includes('snack')) {
            severity = 'notice';
          } else {
            severity = 'ignore';
          }
          tileRules[tile.name] = severity;
        }

        const row = document.createElement('div');
        row.className = 'cd-tile-row';
        row.innerHTML = `
          <div class="cd-tile-info">
            <span class="cd-tile-name">${tile.name}</span>
            ${tile.count > 0 ? `<span class="cd-tile-count">${tile.count}×</span>` : '<span class="cd-tile-count cd-custom">custom</span>'}
          </div>
          <div class="cd-severity-slider">
            <button class="cd-sev-btn ${severity === 'warn' ? 'active' : ''}" data-sev="warn" title="Warn (Red)">
              <span class="cd-sev-dot cd-dot-warn"></span>
              Warn
            </button>
            <button class="cd-sev-btn ${severity === 'notice' ? 'active' : ''}" data-sev="notice" title="Notice (Yellow)">
              <span class="cd-sev-dot cd-dot-notice"></span>
              Notice
            </button>
            <button class="cd-sev-btn ${severity === 'ignore' ? 'active' : ''}" data-sev="ignore" title="Ignore">
              <span class="cd-sev-dot cd-dot-ignore"></span>
              Ignore
            </button>
          </div>
          ${tile.count === 0 ? `<button class="cd-remove-btn" title="Remove">×</button>` : ''}
        `;

        // Wire up severity buttons
        row.querySelectorAll('.cd-sev-btn').forEach(btn => {
          btn.onclick = () => {
            tileRules[tile.name] = btn.dataset.sev;
            row.querySelectorAll('.cd-sev-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
          };
        });

        // Wire up remove button (only for custom tiles)
        const removeBtn = row.querySelector('.cd-remove-btn');
        if (removeBtn) {
          removeBtn.onclick = () => {
            delete tileRules[tile.name];
            const idx = tiles.findIndex(t => t.name === tile.name);
            if (idx >= 0) tiles.splice(idx, 1);
            renderTiles();
          };
        }

        listContainer.appendChild(row);
      });
    }

    renderTiles();
  }

  // =================================================================
  // CSS INJECTION
  // =================================================================

  function injectStyles() {
    if (document.getElementById('cd-styles')) return;

    const css = `
      /* OVERLAY */
      .cd-overlay {
        position: fixed; inset: 0; background: rgba(15, 23, 42, 0.5);
        backdrop-filter: blur(4px); z-index: 9999;
        display: flex; align-items: center; justify-content: center;
        opacity: 0; animation: cdFadeIn 0.2s forwards;
      }
      .cd-overlay.fade-out { animation: cdFadeOut 0.2s forwards; }

      /* MODAL */
      .cd-modal {
        background: #ffffff; width: 550px; max-width: 95%; max-height: 85vh;
        border-radius: 16px;
        box-shadow: 0 25px 50px rgba(0,0,0,0.2);
        display: flex; flex-direction: column; overflow: hidden;
        animation: cdSlideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      }

      /* HEADER */
      .cd-header {
        padding: 20px 24px; border-bottom: 1px solid #e5e7eb;
        display: flex; justify-content: space-between; align-items: flex-start;
        background: #fafafa;
      }
      .cd-title { margin: 0; font-size: 1.2rem; font-weight: 700; color: #111827; }
      .cd-subtitle { margin: 6px 0 0; font-size: 0.85rem; color: #6b7280; line-height: 1.4; }
      .cd-close-btn {
        background: transparent; border: none; font-size: 28px; color: #9ca3af;
        cursor: pointer; padding: 0; line-height: 1; transition: color 0.2s;
        margin-top: -4px;
      }
      .cd-close-btn:hover { color: #111827; }

      /* BODY */
      .cd-body { 
        padding: 16px 24px; flex: 1; overflow-y: auto; 
        background: #fff;
      }

      /* LEGEND */
      .cd-legend {
        display: flex; gap: 16px; margin-bottom: 16px; padding-bottom: 12px;
        border-bottom: 1px solid #f3f4f6;
      }
      .cd-legend-item {
        display: flex; align-items: center; gap: 6px;
        font-size: 0.8rem; color: #6b7280;
      }
      .cd-dot {
        width: 10px; height: 10px; border-radius: 50%;
      }
      .cd-dot-warn { background: #dc2626; }
      .cd-dot-notice { background: #f59e0b; }
      .cd-dot-ignore { background: #d1d5db; }

      /* TILES LIST */
      .cd-tiles-list {
        display: flex; flex-direction: column; gap: 8px;
      }

      /* TILE ROW */
      .cd-tile-row {
        display: flex; align-items: center; gap: 12px;
        padding: 10px 14px; background: #f9fafb; border-radius: 10px;
        border: 1px solid #e5e7eb; transition: all 0.15s;
      }
      .cd-tile-row:hover { background: #f3f4f6; border-color: #d1d5db; }

      .cd-tile-info {
        flex: 1; display: flex; align-items: center; gap: 8px;
      }
      .cd-tile-name {
        font-weight: 600; color: #1f2937; font-size: 0.95rem;
      }
      .cd-tile-count {
        font-size: 0.75rem; color: #9ca3af; background: #e5e7eb;
        padding: 2px 6px; border-radius: 4px;
      }
      .cd-tile-count.cd-custom {
        background: #dbeafe; color: #2563eb;
      }

      /* SEVERITY SLIDER */
      .cd-severity-slider {
        display: flex; background: #e5e7eb; border-radius: 8px; padding: 3px;
      }
      .cd-sev-btn {
        display: flex; align-items: center; gap: 4px;
        padding: 6px 10px; border: none; background: transparent;
        font-size: 0.75rem; font-weight: 600; color: #6b7280;
        border-radius: 6px; cursor: pointer; transition: all 0.15s;
        white-space: nowrap;
      }
      .cd-sev-btn:hover { color: #374151; }
      .cd-sev-btn.active {
        background: #fff; color: #111827;
        box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      }
      .cd-sev-btn.active[data-sev="warn"] { color: #dc2626; }
      .cd-sev-btn.active[data-sev="notice"] { color: #d97706; }
      .cd-sev-btn.active[data-sev="ignore"] { color: #6b7280; }

      .cd-sev-dot {
        width: 8px; height: 8px; border-radius: 50%;
      }

      /* REMOVE BUTTON */
      .cd-remove-btn {
        width: 24px; height: 24px; border-radius: 50%; border: none;
        background: transparent; color: #d1d5db; font-size: 18px;
        cursor: pointer; display: flex; align-items: center; justify-content: center;
        transition: all 0.15s;
      }
      .cd-remove-btn:hover { background: #fee2e2; color: #dc2626; }

      /* ADD BUTTON */
      .cd-add-btn {
        width: 100%; margin-top: 12px; padding: 12px;
        border: 2px dashed #d1d5db; border-radius: 10px;
        background: transparent; color: #6b7280; font-weight: 600;
        font-size: 0.9rem; cursor: pointer; transition: all 0.15s;
        display: flex; align-items: center; justify-content: center; gap: 6px;
      }
      .cd-add-btn:hover { border-color: #2563eb; color: #2563eb; background: #eff6ff; }

      /* EMPTY STATE */
      .cd-empty {
        padding: 40px 20px; text-align: center; color: #9ca3af;
        font-size: 0.9rem; line-height: 1.5;
      }

      /* FOOTER */
      .cd-footer {
        padding: 16px 24px; border-top: 1px solid #e5e7eb;
        display: flex; justify-content: space-between; gap: 12px;
        background: #fafafa;
      }
      .cd-btn-secondary {
        padding: 10px 16px; border-radius: 8px; font-weight: 600;
        font-size: 0.9rem; cursor: pointer; transition: all 0.15s;
        background: #fff; border: 1px solid #d1d5db; color: #374151;
      }
      .cd-btn-secondary:hover { background: #f3f4f6; border-color: #9ca3af; }
      
      .cd-btn-primary {
        padding: 10px 20px; border-radius: 8px; font-weight: 600;
        font-size: 0.9rem; cursor: pointer; transition: all 0.15s;
        background: #111827; border: none; color: #fff;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      }
      .cd-btn-primary:hover { background: #000; transform: translateY(-1px); }

      /* ANIMATIONS */
      @keyframes cdFadeIn { to { opacity: 1; } }
      @keyframes cdFadeOut { to { opacity: 0; } }
      @keyframes cdSlideUp { 
        from { transform: translateY(20px); opacity: 0; } 
        to { transform: translateY(0); opacity: 1; } 
      }
    `;

    const s = document.createElement('style');
    s.id = 'cd-styles';
    s.textContent = css;
    document.head.appendChild(s);
  }

  // =================================================================
  // EXPORT
  // =================================================================

  window.SkeletonSandbox = {
    detectConflicts,
    showRulesModal,
    loadRules,
    saveRules,
    getRules,
    getUniqueTilesFromSkeleton
  };

})();
