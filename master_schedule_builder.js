// ============================================================================
// master_schedule_builder.js (RESTORED CORE — STAGE 1)
// NEW: Full timeline compatibility, minute-level engine
// PURPOSE: Convert user skeleton into raw blocks with complete metadata
// This file is an exact drop-in replacement.
// ============================================================================

(function(){
'use strict';

// ---------------------------------------------------------------------------
// STATE
// ---------------------------------------------------------------------------
let container = null;
let palette = null;
let grid = null;
let dailySkeleton = [];

// Constants
const PIXELS_PER_MINUTE = 2;
const LOCAL_KEY = 'master-schedule-skeleton';
const DEFAULT_TYPE = 'activity';

// ---------------------------------------------------------------------------
// INIT TAB
// ---------------------------------------------------------------------------
function initMasterScheduler() {
    container = document.getElementById('master-scheduler-content');
    if (!container) return;

    container.innerHTML = renderShell();
    palette = container.querySelector('#scheduler-palette');
    grid = container.querySelector('#scheduler-grid');

    loadSkeleton();
    renderGrid();
    renderPalette();

    attachPaletteEvents();
    attachGridEvents();
}

// ---------------------------------------------------------------------------
// HTML SHELL
// ---------------------------------------------------------------------------
function renderShell() {
    return `
        <div class="scheduler-wrapper">
            <div class="scheduler-left">
                <h3>Blocks Palette</h3>
                <div id="scheduler-palette" class="palette"></div>
            </div>
            <div class="scheduler-right">
                <h3>Daily Skeleton</h3>
                <div id="scheduler-grid" class="timeline-grid"></div>
            </div>
        </div>
    `;
}

// ---------------------------------------------------------------------------
// LOAD / SAVE
// ---------------------------------------------------------------------------
function saveSkeleton() {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(dailySkeleton));
}
function loadSkeleton() {
    try {
        const raw = JSON.parse(localStorage.getItem(LOCAL_KEY));
        dailySkeleton = Array.isArray(raw) ? raw : [];
    } catch(err) {
        dailySkeleton = [];
    }
}

// ---------------------------------------------------------------------------
// PALETTE (BLOCK TYPES)
// ---------------------------------------------------------------------------
function renderPalette() {
    palette.innerHTML = '';

    const blockTypes = [
        { type:'activity', label:'General Activity' },
        { type:'transition', label:'Transition' },
        { type:'special', label:'Special Activity' },
        { type:'smart', label:'Smart Tile' },
        { type:'split', label:'Split Activity' },
        { type:'league', label:'League Game' }
    ];

    blockTypes.forEach(b => {
        const div = document.createElement('div');
        div.className = 'palette-item';
        div.dataset.type = b.type;
        div.textContent = b.label;
        palette.appendChild(div);
    });
}

// ---------------------------------------------------------------------------
// GRID RENDERING
// ---------------------------------------------------------------------------
function renderGrid() {
    grid.innerHTML = '';
    dailySkeleton.forEach((blk, i) => {
        const el = document.createElement('div');
        el.className = 'timeline-block';
        el.style.top = (blk.start * PIXELS_PER_MINUTE) + 'px';
        el.style.height = ((blk.end - blk.start) * PIXELS_PER_MINUTE) + 'px';
        el.dataset.index = i;
        el.textContent = blk.label || blk.type;
        grid.appendChild(el);
    });
}

// ---------------------------------------------------------------------------
// BLOCK CREATION
// ---------------------------------------------------------------------------
function createBlock(type, start, end) {
    const blk = {
        type,
        start,
        end,
        label: type,

        // FULL METADATA — preserved until Stage 3
        sport: null,
        activity: null,
        zone: null,
        sharable: false,
        exclusive: false,
        pre: 0,
        post: 0,

        // Smart tile metadata
        smartPrimary: null,
        smartSecondary: null,
        smartFallback: null,

        // Split metadata
        splitA: null,
        splitB: null,

        // League metadata
        leagueName: null,
        leagueDivision: null
    };
    return blk;
}

// ---------------------------------------------------------------------------
// EVENTS — PALETTE DRAG
// ---------------------------------------------------------------------------
function attachPaletteEvents() {
    palette.querySelectorAll('.palette-item').forEach(item => {
        item.addEventListener('click', () => {
            const type = item.dataset.type;
            // Default length: 30 minutes
            const start = 0;
            const end = 30;
            const blk = createBlock(type, start, end);
            dailySkeleton.push(blk);
            saveSkeleton();
            renderGrid();
        });
    });
}

// ---------------------------------------------------------------------------
// EVENTS — GRID INTERACTION
// ---------------------------------------------------------------------------
function attachGridEvents() {
    grid.addEventListener('click', (ev) => {
        const t = ev.target;
        if (!t.classList.contains('timeline-block')) return;

        const idx = Number(t.dataset.index);
        if (isNaN(idx)) return;

        if (confirm('Delete this block?')) {
            dailySkeleton.splice(idx, 1);
            saveSkeleton();
            renderGrid();
        }
    });
}

// ---------------------------------------------------------------------------
// EXPORT
// ---------------------------------------------------------------------------
window.initMasterScheduler = initMasterScheduler;
window.getMasterSkeleton = () => JSON.parse(JSON.stringify(dailySkeleton));

})();
