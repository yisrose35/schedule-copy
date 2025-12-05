// ============================================================================
// scheduler_logic_fillers.js  —  STAGE 3 OF 7
// (Modern Minute Timeline + Restored Old Logic + Full Metadata Preservation)
//
// ROLE:
// 1. Convert raw skeleton blocks → solver-ready blocks.
// 2. Preserve ALL metadata (smart tiles, splits, specials, transitions).
// 3. Ensure blocks NEVER collapse or lose identity.
// 4. Produce a clean array "filledBlocks" handed to Stage 4 (league engine).
//
// This stage **does not schedule**. It only PREPARES blocks.
// ============================================================================

(function() {
"use strict";

window.SchedulerFillers = {};

// ================================================================
// MAIN ENTRY
// ================================================================
function processSkeletonBlocks(rawBlocks) {
    if (!Array.isArray(rawBlocks)) return [];

    const out = [];
    let pairCounter = 0;

    for (const block of rawBlocks) {
        if (!block || !block.type) continue;

        // Deep clone to avoid mutating original
        const b = JSON.parse(JSON.stringify(block));

        switch (b.type) {

            // -----------------------------
            // SMART TILE (keep options)
            // -----------------------------
            case "smart":
                out.push(prepareSmartBlock(b));
                break;

            // -----------------------------
            // SPLIT ACTIVITY
            // -----------------------------
            case "split":
                const pairId = "pair_" + (++pairCounter);
                const halves = createSplitHalves(b, pairId);
                out.push(...halves);
                break;

            // -----------------------------
            // SPECIAL ACTIVITY
            // -----------------------------
            case "special":
                out.push(...expandSpecialActivity(b));
                break;

            // -----------------------------
            // LEAGUE BLOCK – DO NOT TOUCH
            // -----------------------------
            case "league":
                out.push(prepareLeagueBlock(b));
                break;

            // -----------------------------
            // TRANSITION BLOCK
            // -----------------------------
            case "transition":
                out.push(prepareTransitionBlock(b));
                break;

            // -----------------------------
            // STANDARD ACTIVITY BLOCK
            // -----------------------------
            case "activity":
            default:
                out.push(prepareNormalBlock(b));
                break;
        }
    }

    return out;
}

window.SchedulerFillers.processSkeletonBlocks = processSkeletonBlocks;

// ================================================================
// SMART BLOCK
// ================================================================
function prepareSmartBlock(block) {
    return {
        ...block,
        type: "smart",
        options: block.options || [],   // primary, secondary, fallback
        category: "smart",
        metadata: block.metadata || {},
        originalBlockId: block.originalBlockId || generateId()
    };
}

// ================================================================
// SPLIT ACTIVITY (A/B)
// ================================================================
function createSplitHalves(block, pairId) {
    const duration = block.end - block.start;
    const half = Math.floor(duration / 2);

    const A = {
        ...block,
        type: "splitA",
        start: block.start,
        end: block.start + half,
        duration: half,
        pairId,
        category: "split",
        originalBlockId: block.originalBlockId || generateId()
    };

    const B = {
        ...block,
        type: "splitB",
        start: block.start + half,
        end: block.end,
        duration: block.end - (block.start + half),
        pairId,
        category: "split",
        originalBlockId: block.originalBlockId || generateId()
    };

    return [A, B];
}

// ================================================================
// TRANSITION
// ================================================================
function prepareTransitionBlock(block) {
    return {
        ...block,
        type: "transition",
        category: "transition",
        duration: block.end - block.start,
        originalBlockId: block.originalBlockId || generateId()
    };
}

// ================================================================
// SPECIAL ACTIVITY (APPLY RULES)
// ================================================================
function expandSpecialActivity(block) {
    // Maintain original behavior: special can expand to multiple internal blocks
    const out = [];

    const base = {
        ...block,
        category: "special",
        duration: block.end - block.start,
        requiresField: block.requiresField || false,
        sharable: block.sharable || { type: "not_sharable" },
        transition: block.transition || {},
        zone: block.zone || null,
        originalBlockId: block.originalBlockId || generateId()
    };

    // Add pre-transition
    if (block.transition && block.transition.preMin > 0) {
        out.push({
            type: "transition",
            start: block.start - block.transition.preMin,
            end: block.start,
            duration: block.transition.preMin,
            category: "transition",
            originalBlockId: base.originalBlockId
        });
    }

    // The main special block
    out.push(base);

    // Add post-transition
    if (block.transition && block.transition.postMin > 0) {
        out.push({
            type: "transition",
            start: block.end,
            end: block.end + block.transition.postMin,
            duration: block.transition.postMin,
            category: "transition",
            originalBlockId: base.originalBlockId
        });
    }

    return out;
}

// ================================================================
// LEAGUE BLOCK (DO NOT MODIFY STRUCTURE)
// ================================================================
function prepareLeagueBlock(block) {
    return {
        ...block,
        type: "league",
        category: "league",
        duration: block.end - block.start,
        originalBlockId: block.originalBlockId || generateId()
    };
}

// ================================================================
// NORMAL ACTIVITY
// ================================================================
function prepareNormalBlock(block) {
    return {
        ...block,
        type: "activity",
        category: block.category || "activity",
        duration: block.end - block.start,
        originalBlockId: block.originalBlockId || generateId()
    };
}

// ================================================================
// HELPERS
// ================================================================
function generateId() {
    return "blk_" + Math.random().toString(36).slice(2);
}

})();
