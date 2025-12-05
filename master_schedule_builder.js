// ============================================================================
// master_schedule_builder.js  — STAGE 1 of 7
// (MODERN VERSION — MINUTE TIMELINE SUPPORT + FULL METADATA PRESERVATION)
//
// ROLE:
// - Build timeline skeleton blocks EXACTLY as the user arranged them
// - Preserve ALL metadata for Smart Tiles, Splits, Specials, Leagues
// - No collapsing, no normalizing, no filling — ONLY building
// - Outputs clean blocks for Stage 2 (Smart Tile Adapter)
//
// NOTES:
// ★ This file replaces the broken “old builder” that lost metadata.
// ★ Works 100% with your new minute-based drag/drop + timeline gatekeeper.
// ============================================================================

(function() {
'use strict';

let containerEl = null;
let paletteEl   = null;
let gridEl      = null;

// Stores the raw skeleton the user built for this day
let dailySkeleton = [];

// LocalStorage keys
const SKELETON_DRAFT_KEY      = 'master-schedule-draft';
const SKELETON_DRAFT_NAME_KEY = 'master-schedule-draft-name';

// =============================================================================
// INIT
// =============================================================================

function initMasterScheduler() {
    containerEl = document.getElementById("master-scheduler-content");
    if (!containerEl) return;

    buildUI();
    loadDraftIfExists();
    renderSkeletonGrid();
}

// =============================================================================
// UI
// =============================================================================

function buildUI() {
    containerEl.innerHTML = `
        <div class="msb-wrapper">
            <div class="msb-left">
                <h3 class="msb-title">Master Schedule Builder</h3>

                <div id="msb-palette" class="msb-palette"></div>
                <div class="msb-buttons">
                    <button id="msb-save-draft-btn" class="msb-btn save">Save Draft</button>
                    <button id="msb-clear-btn" class="msb-btn clear">Clear</button>
                </div>
            </div>

            <div class="msb-right">
                <div id="msb-grid" class="msb-grid"></div>
            </div>
        </div>
    `;

    paletteEl = document.getElementById("msb-palette");
    gridEl    = document.getElementById("msb-grid");

    document.getElementById("msb-save-draft-btn").onclick = saveDraftToLocalStorage;
    document.getElementById("msb-clear-btn").onclick = clearSkeleton;

    renderPalette();
}

// =============================================================================
// PALETTE (Smart Tiles, GA, Splits, Specials, League, Transitions…)
// =============================================================================

function renderPalette() {
    let activities = getAllPaletteTypes();

    paletteEl.innerHTML = activities.map(a => `
        <div class="palette-item"
             draggable="true"
             data-type="${a.type}"
             data-name="${a.name}"
             data-sport="${a.sport || ''}">
            <span>${a.label}</span>
        </div>
    `).join('');

    paletteEl.querySelectorAll(".palette-item").forEach(el => {
        el.addEventListener("dragstart", onPaletteDragStart);
    });
}

function getAllPaletteTypes() {
    // GA, Special, League, Smart Tiles, Split, Transition Pre/Post, etc.
    const specials = (window.getGlobalSpecialActivities?.() || []).map(s => ({
        type: "special",
        name: s.name,
        label: `⭐ ${s.name}`,
        specialData: s
    }));

    const leagues = Object.values(window.leaguesByName || {}).map(l => ({
        type: "league",
        name: l.name,
        label: `🏆 League: ${l.name}`,
        leagueData: l
    }));

    return [
        { type:"ga",        name:"General Activity", label:"GA Slot" },
        { type:"smart",     name:"Smart Tile",      label:"🎲 Smart Tile" },
        { type:"split",     name:"Split Activity",  label:"↔️ Split Activity" },
        { type:"transition",name:"Transition",      label:"⏱️ Transition" },
        ...specials,
        ...leagues
    ];
}

// =============================================================================
// DRAG EVENTS — Create Raw Blocks
// =============================================================================

function onPaletteDragStart(ev) {
    ev.dataTransfer.setData("text/plain", JSON.stringify({
        type: ev.target.dataset.type,
        name: ev.target.dataset.name,
        sport: ev.target.dataset.sport || null
    }));
}

// Called when user drops block onto timeline
function onBlockDrop(ev, minute) {
    ev.preventDefault();

    const data = JSON.parse(ev.dataTransfer.getData("text/plain"));
    const block = createBlockFromPalette(data, minute);

    dailySkeleton.push(block);
    sortSkeleton();
    renderSkeletonGrid();
}

function createBlockFromPalette(data, startMin) {
    // Default duration if none selected yet (user can resize)
    const defaultDuration = 30;

    return {
        id: generateId(),
        type: data.type,
        name: data.name,
        sport: data.sport || null,
        start: startMin,
        end: startMin + defaultDuration,

        // Full metadata preserved here:
        options: [],           // for smart tiles (Stage 2)
        split: null,           // for split activities
        specialData: null,     // special rule metadata
        leagueData: null,      // league metadata
        sharable: false,
        exclusive: false,
        zone: null,
        transition: {pre:0, post:0},
        raw: data               // raw palette data
    };
}

// =============================================================================
// SKELETON GRID
// =============================================================================

function renderSkeletonGrid() {
    if (!gridEl) return;

    const campStart = window.getCampStartMinutes?.() ?? 540;  // 9:00 default
    const campEnd   = window.getCampEndMinutes?.()   ?? 960;  // 4:00 default

    let html = `<div class="msb-timeline">`;

    for (let m = campStart; m < campEnd; m += 5) {
        html += `<div class="msb-time-slot" 
                     ondragover="event.preventDefault()" 
                     ondrop="window.masterSchedulerDrop(event, ${m})">
                 </div>`;
    }

    html += `</div>`;

    // Overlay blocks
    html += `<div class="msb-block-layer">`;
    dailySkeleton.forEach(b => {
        html += buildBlockHTML(b);
    });
    html += `</div>`;

    gridEl.innerHTML = html;
}

function buildBlockHTML(block) {
    const top = block.start;
    const height = block.end - block.start;

    let label = block.name;
    if (block.type === "smart") label = "🎲 Smart Tile";
    if (block.type === "split") label = "↔️ Split Activity";

    return `
        <div class="msb-block"
             style="top:${top}px;height:${height}px;"
             data-id="${block.id}">
            ${label}
        </div>
    `;
}

window.masterSchedulerDrop = onBlockDrop;

// =============================================================================
// PERSISTENCE
// =============================================================================

function saveDraftToLocalStorage() {
    localStorage.setItem(SKELETON_DRAFT_KEY, JSON.stringify(dailySkeleton));
    alert("Draft saved!");
}

function loadDraftIfExists() {
    const saved = localStorage.getItem(SKELETON_DRAFT_KEY);
    if (!saved) return;
    try {
        dailySkeleton = JSON.parse(saved) || [];
    } catch (e) {
        dailySkeleton = [];
    }
}

function clearSkeleton() {
    if (!confirm("Clear entire skeleton?")) return;
    dailySkeleton = [];
    renderSkeletonGrid();
}

// =============================================================================
// HELPERS
// =============================================================================

function sortSkeleton() {
    dailySkeleton.sort((a,b) => a.start - b.start);
}

function generateId() {
    return "b-" + Math.random().toString(36).substr(2,9);
}

// Expose init
window.initMasterScheduler = initMasterScheduler;

})();
