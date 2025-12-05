// ============================================================================
// smart_logic_adapter.js (RESTORED CORE — STAGE 2)
// PURPOSE: Generate Smart Tile option sets (primary, secondary, fallback)
// NEW: Fully compatible with timeline engine & preserved metadata from Stage 1
// This is a drop-in file.
// ============================================================================

(function(){
'use strict';

// ---------------------------------------------------------------------------
// SMART TILE OPTION GENERATION
// ---------------------------------------------------------------------------
// The old system ALWAYS produced 2–3 options for Smart Tiles.
// This adapter does NOT pick the activity — it only generates choices.
// The solver (Stage 5) will decide the best option.
// ---------------------------------------------------------------------------

function buildSmartTileOptions(rawBlock) {
    // Clone to avoid mutation
    const blk = JSON.parse(JSON.stringify(rawBlock));

    // We expect blk.smartPrimary, blk.smartSecondary, blk.smartFallback to exist
    // If the user didn’t configure them yet, generate a generic set.
    // The UI will override these values during configuration.

    const primary = blk.smartPrimary || {
        type: 'activity',
        label: 'Primary Activity',
        sport: null,
        activity: null
    };

    const secondary = blk.smartSecondary || {
        type: 'activity',
        label: 'Secondary Activity',
        sport: null,
        activity: null
    };

    const fallback = blk.smartFallback || {
        type: 'activity',
        label: 'Fallback',
        sport: null,
        activity: null
    };

    blk.options = [primary, secondary, fallback];
    return blk;
}

// ---------------------------------------------------------------------------
// MAIN: Wrap every smart block with options set
// ---------------------------------------------------------------------------
function applySmartLogicAdapter(skeleton) {
    if (!Array.isArray(skeleton)) return skeleton;

    return skeleton.map(blk => {
        if (blk.type !== 'smart') return blk;
        return buildSmartTileOptions(blk);
    });
}

// ---------------------------------------------------------------------------
// EXPORT
// ---------------------------------------------------------------------------
// Called by Stage 3 (scheduler_logic_fillers.js) before conversion.
window.applySmartLogicAdapter = applySmartLogicAdapter;

})();
