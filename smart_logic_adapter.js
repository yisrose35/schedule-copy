// ============================================================================
// smart_logic_adapter.js
//
// NEW VERSION with:
// - main1 / main2 / fallback logic
// - dynamic special capacity (block-based)
// - fairness
// - fallback fairness logic
// - debug logging
// ============================================================================

(function () {
    "use strict";

    // -----------------------------------------------------------
    // Helper: do we need scheduler_core generation?
    // -----------------------------------------------------------
    function needsGeneration(actName) {
        if (!actName) return false;
        const s = actName.toLowerCase();

        return (
            s.includes("sport") ||
            s.includes("general activity") ||
            s.includes("ga") ||
            s.includes("special")
        );
    }

    // -----------------------------------------------------------
    // STEP 1 — Detect Smart Tiles in Skeleton
    // -----------------------------------------------------------
   function preprocessSmartTiles(rawSkeleton, dailyAdjustments, masterSpecials) {
    console.log("ADAPTER-DEBUG: preprocessSmartTiles called");
    console.log("ADAPTER-DEBUG: rawSkeleton =", rawSkeleton);

    const smartItems = rawSkeleton.filter(item => item.type === "smart");

    console.log("ADAPTER-DEBUG: smartItems found =", smartItems);

    const jobs = [];

    smartItems.forEach(item => {
        // SUPPORT BOTH formats: smartConfig and smartData
        const cfg = item.smartConfig || item.smartData;
        if (!cfg) {
            console.log("ADAPTER-DEBUG: Smart tile missing config → SKIPPED:", item);
            return;
        }

        const j = {
            division: item.division,
            startTime: item.startTime,
            endTime: item.endTime,

            main1: cfg.main1,
            main2: cfg.main2,

            // new unified fallback format
            fallback1:
                cfg.fallback1 ||
                (cfg.fallbackFor === cfg.main1 ? cfg.fallbackActivity : null),

            fallback2:
                cfg.fallback2 ||
                (cfg.fallbackFor === cfg.main2 ? cfg.fallbackActivity : null),

            allowFallback1: cfg.allowFallback1 ?? true,
            allowFallback2: cfg.allowFallback2 ?? true,

            specialFields: computeSpecialCapacityForBlock(
                item.startTime,
                item.endTime,
                dailyAdjustments,
                masterSpecials
            )
        };

        jobs.push(j);
    });

    console.log("ADAPTER-DEBUG: jobs =", jobs);
    return jobs;
}

    // -----------------------------------------------------------
    // STEP 2 — Compute Block-Specific Special Capacity
    // -----------------------------------------------------------
    function computeSpecialCapacityForBlock(startTime, endTime, dailyAdjustments, masterSpecials) {
        const disabled = dailyAdjustments.disabledSpecials || [];

        const items = [];

        masterSpecials.forEach(sp => {
            if (disabled.includes(sp.name)) return;

            if (sp.sharableWith?.type === "all") {
                // sharable = 2
                items.push({
                    name: sp.name,
                    capacity: 2,
                    raw: sp
                });
            } else {
                // not sharable = 1
                items.push({
                    name: sp.name,
                    capacity: 1,
                    raw: sp
                });
            }
        });

        return items;
    }

    // -----------------------------------------------------------
    // STEP 3 — Assign bunks for the pair of blocks
    // -----------------------------------------------------------
    function generateAssignments(bunks, job, historical) {
        console.log("ADAPTER-DEBUG: generateAssignments called", job);
        const { main1, main2, fallback1, fallback2 } = job;

        historical = historical || {};
        bunks = [...bunks];

        function getSpecialGap(b) {
            return (historical[b]?.specialCount || 0);
        }

        bunks.sort((a, b) => getSpecialGap(a) - getSpecialGap(b));

        const block1 = {};
        const block2 = {};

        const specialsThisBlock = job.specialFields || [];
        const maxSpecialCapacity = specialsThisBlock.reduce((sum, s) => sum + (s.capacity || 1), 0);

        let usedSpecialsBlock1 = 0;
        let usedSpecialsBlock2 = 0;

        const specialName1 = main1.toLowerCase().includes("special") ? main1 :
                             main1.toLowerCase().includes("ga") ? "Special Activity" : null;
        const specialName2 = main2.toLowerCase().includes("special") ? main2 :
                             main2.toLowerCase().includes("ga") ? "Special Activity" : null;

        bunks.forEach(b => {
            const canUseSpecialB1 = specialName1 && usedSpecialsBlock1 < maxSpecialCapacity;
            const canUseSpecialB2 = specialName2 && usedSpecialsBlock2 < maxSpecialCapacity;

            if (canUseSpecialB1) {
                block1[b] = main1;
                usedSpecialsBlock1++;
            } else {
                block1[b] = fallback1 || main2 || main1;
            }

            if (canUseSpecialB2) {
                block2[b] = main2;
                usedSpecialsBlock2++;
            } else {
                block2[b] = fallback2 || main1 || main2;
            }
        });

        console.log("ADAPTER-DEBUG: block1 assignments =", block1);
        console.log("ADAPTER-DEBUG: block2 assignments =", block2);

        return { block1, block2 };
    }

    // -----------------------------------------------------------
    // Expose
    // -----------------------------------------------------------
    window.SmartLogicAdapter = {
        needsGeneration,
        preprocessSmartTiles,
        generateAssignments
    };
})();
