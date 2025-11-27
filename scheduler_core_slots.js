=========================================================================== scheduler_core_slots.js
Standard Slot Filler (Sports, Specials, General)

Fixed: Added run method required by scheduler_core_engine.js ===========================================================================*/

(function (global) { "use strict";

const NS = global.SchedulerCore = global.SchedulerCore || {}; const F = NS.field; const U = NS.utils;

/* --------------------------------------------------------------------------- HELPER: Assign & Mark --------------------------------------------------------------------------- */ function assign(bunk, block, pick, ctx) { if (!pick) return;

const { fieldUsage } = ctx;
const schedule = global.scheduleAssignments[bunk];
if (!schedule) return;

// Write assignment to all slots in the block
block.slots.forEach((slotIdx, i) => {
    if (!schedule[slotIdx]) {
        schedule[slotIdx] = {
            field: pick.field,
            sport: pick.sport || null,
            continuation: i > 0,
            _fixed: false,
            _h2h: false,
            _activity: pick._activity || pick.field
        };
    }
});

// Mark field usage if it's a real place
if (pick.field && pick.field !== "Free" && pick.field !== "No Field") {
    F.markUsage(block, pick.field, fieldUsage, pick._activity);
}
}

/* --------------------------------------------------------------------------- FINDER: SPECIAL --------------------------------------------------------------------------- */ function findBestSpecial(block, allActivities, fieldUsage, avoidField, activityProps) { const specials = allActivities.specials || [];

// Simple First-Fit logic (Can be enhanced with fairness later)
for (const name of specials) {
    const props = activityProps[name];
    if (!props) continue;

    if (F.canFit(block, name, props, fieldUsage, null, name)) {
        return { field: name, _activity: name };
    }
}
return null;
}

/* --------------------------------------------------------------------------- FINDER: SPORTS --------------------------------------------------------------------------- */ function findBestSport(block, allActivities, fieldUsage, avoidField, activityProps) { const sports = allActivities.sports || []; const fieldsBySport = allActivities.fieldsBySport || {};

for (const sportName of sports) {
    const potentialFields = fieldsBySport[sportName] || [];
    
    for (const f of potentialFields) {
        const props = activityProps[f] || {};
        if (F.canFit(block, f, props, fieldUsage, null, sportName)) {
            return { field: f, sport: sportName, _activity: sportName };
        }
    }
}
return null;
}

/* --------------------------------------------------------------------------- FINDER: GENERAL --------------------------------------------------------------------------- */ function findBestGeneral(block, allActivities, fieldUsage, avoidField, activityProps) { // Try specials first (often preferred for general slots) const specialPick = findBestSpecial(block, allActivities, fieldUsage, avoidField, activityProps); if (specialPick) return specialPick;

// Then try sports
const sportPick = findBestSport(block, allActivities, fieldUsage, avoidField, activityProps);
if (sportPick) return sportPick;

return null;
}

/* --------------------------------------------------------------------------- MAIN RUN: Process Standard Slots --------------------------------------------------------------------------- */ function run(blocks, ctx) { // 1. Identify "Slot" blocks (not smart, league, specialty, or pinned) const slotBlocks = blocks.filter(b => b.type === 'slot' || (b.type !== 'smart' && b.type !== 'league' && b.type !== 'specialty' && b.type !== 'pinned' && b.type !== 'split') );

// 2. Sort by start time to fill earlier slots first
slotBlocks.sort((a, b) => a.start - b.start);

// 3. Process each block for each bunk
slotBlocks.forEach(block => {
    const divName = block.division;
    const bunks = ctx.divisions[divName]?.bunks || [];

    bunks.forEach(bunk => {
        // Check if this bunk is already filled in this slot (e.g. by Smart Tile or Pinned)
        const schedule = global.scheduleAssignments[bunk];
        if (block.slots.length > 0 && schedule && schedule[block.slots[0]]) return;

        // Prepare context for finder
        const blockCtx = { ...block, bunk, divName }; // 'divName' for legacy finders
        const evt = (block.event || "").toLowerCase();
        let pick = null;

        if (evt.includes('sport')) {
            pick = findBestSport(blockCtx, ctx.allActivities, ctx.fieldUsage, null, ctx.activityProps);
        } else if (evt.includes('special')) {
            pick = findBestSpecial(blockCtx, ctx.allActivities, ctx.fieldUsage, null, ctx.activityProps);
        } else {
            pick = findBestGeneral(blockCtx, ctx.allActivities, ctx.fieldUsage, null, ctx.activityProps);
        }

        // Fallback
        if (!pick) {
            pick = { field: "Free", _activity: "Free" };
        }

        assign(bunk, blockCtx, pick, ctx);
    });
});
}

/* --------------------------------------------------------------------------- EXPORT --------------------------------------------------------------------------- */ NS.slots = { findBestSpecial, findBestSport, findBestGeneral, run };

})(typeof window !== "undefined" ? window : global);

}
