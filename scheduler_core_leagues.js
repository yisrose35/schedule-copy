/* ===========================================================================
   scheduler_core_leagues.js
   ---------------------------------------------------------------------------
   LEAGUE + SPECIALTY LEAGUE ENGINE
   Required API:
     NS.leagues.run(blocks, ctx)

   ctx contains:
     - divisions
     - unifiedTimes
     - fieldUsage
     - activityProps
     - fairness
     - allActivities
     - findBestSpecial / findBestSport / findBestGeneral
--------------------------------------------------------------------------- */

(function (global) {
"use strict";

const NS = global.SchedulerCore = global.SchedulerCore || {};
const F  = NS.field;
const FR = NS.fairness;

/* ===========================================================================
   BUILD LEAGUE GROUPS
   Group by: leagueName + startTime
--------------------------------------------------------------------------- */
function groupLeagueBlocks(blocks, masterLeagues) {
    const out = {};

    blocks.forEach(block => {
        const leagueEntry = Object.entries(masterLeagues).find(
            ([name, L]) =>
                L.enabled &&
                L.divisions.includes(block.division)
        );
        if (!leagueEntry) return;

        const [leagueName, league] = leagueEntry;
        const key = `${leagueName}_${block.startTime}`;

        if (!out[key]) {
            out[key] = {
                leagueName,
                league,
                startTime: block.startTime,
                endTime: block.endTime,
                blocks: [],
                bunks: new Set()
            };
        }

        out[key].blocks.push(block);
    });

    return Object.values(out);
}

/* ===========================================================================
   RUN A SINGLE GROUP
--------------------------------------------------------------------------- */
function runGroup(group, ctx) {
    const { leagueName, league, blocks } = group;

    const divisionName = blocks[0].division;
    const bunks = ctx.divisions[divisionName].bunks.slice();

    const fairCat = `LEAGUE_${leagueName}`;
    if (!ctx.fairness.categories[fairCat])
        ctx.fairness.categories[fairCat] = [];

    const fairOrder = FR.order(bunks, fairCat);

    /* LEAGUE SCHEDULING:
       For simplicity: each block gives a leagueActivity to all bunks
    */
    const leagueField = league.fieldName || leagueName;

    for (const block of blocks) {
        for (const bunk of fairOrder) {
            const schedule = global.scheduleAssignments[bunk];

            for (const idx of block.slots) {
                if (!schedule[idx]) {
                    schedule[idx] = {
                        field: leagueField,
                        sport: leagueName,
                        continuation: false,
                        _fixed: false,
                        _h2h: false,
                        _activity: "League Game"
                    };
                }
            }

            FR.bump(bunk, fairCat, 1);
        }
    }
}

/* ===========================================================================
   MAIN RUN
--------------------------------------------------------------------------- */
function run(blocks, ctx) {
    const leagueBlocks = blocks.filter(b => b.type === "league");
    const specialtyBlocks = blocks.filter(b => b.type === "specialty");

    const masterLeagues = ctx.allActivities.masterLeagues || {};
    const masterSpecialty = ctx.allActivities.masterSpecialtyLeagues || {};

    const leagueGroups = groupLeagueBlocks(leagueBlocks, masterLeagues);
    const specGroups = groupLeagueBlocks(specialtyBlocks, masterSpecialty);

    leagueGroups.forEach(group => runGroup(group, ctx));
    specGroups.forEach(group => runGroup(group, ctx));
}

/* ===========================================================================
   EXPORT
--------------------------------------------------------------------------- */
NS.leagues = { run };

})(typeof window !== "undefined" ? window : global);
