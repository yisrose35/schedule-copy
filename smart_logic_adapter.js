// ============================================================================
// smart_logic_adapter.js  — ORIGINAL LOGIC (RESTORED)
// Compatible with Minute Timeline + Modern Metadata
// ============================================================================
//
// PURPOSE:
// Convert raw Smart Tile blocks into standardized solver options.
//
// Old Logic Restored:
// - Every smart tile produces PRIMARY, SECONDARY, FALLBACK options
// - Metadata is preserved (sport, zone, transitions, sharable rules, etc.)
// - This file does NOT decide anything — it prepares options only
// - Solver will pick the best option later
//
// New Timeline Compatibility:
// - Works on minute-level start/end times
// ============================================================================

(function() {
    'use strict';

    // Exposed entry point
    window.SmartLogicAdapter = {
        processSmartTiles
    };

    // ------------------------------------------------------------------------
    // MAIN: Convert blocks with type:"smart" into option bundles
    // ------------------------------------------------------------------------
    function processSmartTiles(blocks) {

        if (!Array.isArray(blocks)) return blocks;

        return blocks.map(block => {
            if (block?.type !== 'smart') {
                return block; // Non-smart tiles untouched
            }

            // =================================================================
            // Old Logic:
            // Smart Tiles must always produce:
            //    block.options = [
            //       { activity: block.primary,   weight: 1 },
            //       { activity: block.secondary, weight: 2 },
            //       { activity: block.fallback,  weight: 3 }
            //    ]
            //
            // The final decision happens in solver_main, NOT here.
            // =================================================================

            const primary   = cleanName(block.primary)   || null;
            const secondary = cleanName(block.secondary) || null;
            const fallback  = cleanName(block.fallback)  || null;

            // Build options list exactly like old engine
            const options = [];
            if (primary)   options.push(createOption(block, primary,   1));
            if (secondary) options.push(createOption(block, secondary, 2));
            if (fallback)  options.push(createOption(block, fallback,  3));

            // MUST always have at least one option
            if (options.length === 0 && fallback) {
                options.push(createOption(block, fallback, 3));
            }

            return {
                ...block,
                options,             // Smart Tile options array
                selected: null,      // Solver fills this later
                resolvedActivity: null // Solver sets final activity
            };
        });
    }

    // ------------------------------------------------------------------------
    // Helper: Create a single option object with METADATA COPIED
    // ------------------------------------------------------------------------
    function createOption(block, activityName, weight) {

        return {
            type: 'smart-option',

            // What the solver will try to assign
            activity: activityName,
            label: activityName,

            // Weight/pref: lower = more preferred (primary = 1)
            preference: weight,

            // Metadata from original tile block
            startMin: block.startMin,
            endMin: block.endMin,
            duration: block.duration,

            // Transition rules
            transition: block.transition ? { ...block.transition } : null,

            // Zone, sharable rules, exclusivity — fully preserved
            zone: block.zone,
            sharable: block.sharable ? { ...block.sharable } : null,
            exclusive: block.exclusive === true,

            // Identifiers
            parentId: block.id,
            originalType: 'smart'
        };
    }

    // ------------------------------------------------------------------------
    // Normalizes names for safety
    // ------------------------------------------------------------------------
    function cleanName(str) {
        if (!str) return null;
        return String(str).trim();
    }

})();
