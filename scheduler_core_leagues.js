/* ===========================================================================
   scheduler_core_leagues.js — FIXED VERSION
   ---------------------------------------------------------------------------
   - Exports NS.leagues = { run }
   - Ensures engine never hits “SL.run is not a function”
   - Gracefully handles empty divisions, no leagues, no matchups
   ===========================================================================*/

(function (global) {
"use strict";

const NS = global.SchedulerCore = global.SchedulerCore || {};
const U  = NS.utils;

function run(blocks, ctx) {
    if (!blocks || blocks.length === 0) return;

    const divisions = ctx.divisions || {};
    const schedule = global.scheduleAssignments || {};

    blocks.forEach(block => {
        const division = block.division;
        if (!division || !divisions[division]) {
            console.warn("LEAGUES: Division missing:", division);
            return;
        }

        const bunks = divisions[division].bunks || [];
        if (!Array.isArray(bunks) || bunks.length < 2) {
            console.warn("LEAGUES: Not enough bunks for league in:", division);
            return;
        }

        /* --- BASIC ROUND-ROBIN MATCHUPS --- */
        const matchups = [];
        const arr = bunks.slice();

        while (arr.length >= 2) {
            const b1 = arr.shift();
            const b2 = arr.pop();
            matchups.push(`${b1} vs ${b2}`);
        }

        const firstSlot = block.slots[0];

        /* Mirror to UI for schedule viewer */
        matchups.forEach(m => {
            schedule[bunks[0]][firstSlot]._allMatchups =
                schedule[bunks[0]][firstSlot]._allMatchups || [];
            schedule[bunks[0]][firstSlot]._allMatchups.push(m);
        });

        /* Assign activity label in schedule */
        bunks.forEach(bunk => {
            block.slots.forEach(s => {
                schedule[bunk][s] = {
                    field: "League",
                    sport: matchups.find(m => m.includes(bunk)) || "League Game",
                    continuation: false,
                    _h2h: true,
                    _fixed: false,
                    _activity: "League Game"
                };
            });
        });
    });
}

NS.leagues = { run };

})(typeof window !== "undefined" ? window : global);
