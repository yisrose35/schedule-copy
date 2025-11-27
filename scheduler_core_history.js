
/* ===========================================================================
   scheduler_core_history.js

   Tracks & updates long-term usage history for:
     ✔ Bunk activity rotation
     ✔ League sports usage
     ✔ Smart Tile usage bumps
     ✔ HistoricalCounts → used by fairness engine
     ✔ Yesterday history integration

   API:
     SchedulerCore.history.update(ctx)

   ctx:
     {
        divisions,
        unifiedTimes,
        masterLeagues,
        rotationHistory,           // { bunks:{}, leagues:{}, leagueTeamSports:{}, leagueTeamLastSport:{} }
        allActivities,
        scheduleAssignments        // GLOBAL (window.scheduleAssignments)
     }

   =========================================================================== */

(function (global) {
    "use strict";

    const NS = global.SchedulerCore = global.SchedulerCore || {};
    const U  = NS.utils;

    /* =======================================================================
       Helper: Record activity for one bunk
       ======================================================================= */

    function recordBunkHistory(history, bunk, activity, timestamp) {
        if (!bunk || !activity) return;

        history.bunks[bunk] = history.bunks[bunk] || {};
        history.bunks[bunk][activity] = timestamp;
    }

    /* =======================================================================
       Helper: Record league sport usage
       ======================================================================= */

    function recordLeagueHistory(history, leagueName, sport, timestamp) {
        if (!leagueName || !sport) return;

        history.leagues[leagueName] = history.leagues[leagueName] || {};
        history.leagues[leagueName][sport] = timestamp;
    }

    /* =======================================================================
       Extract first occurrence of a new activity in a bunk's schedule
       ======================================================================= */

    function extractTransitions(schedule) {
        const transitions = [];
        let lastActivity = null;

        for (let entry of schedule) {
            if (!entry) continue;

            const act = entry._activity;
            if (!act) {
                lastActivity = null;
                continue;
            }

            if (act !== lastActivity && !entry.continuation) {
                transitions.push(act);
                lastActivity = act;
            }
        }

        return transitions;
    }

    /* =======================================================================
       MAIN API: UPDATE ROTATION HISTORY
       ======================================================================= */

    function update(ctx) {
        const {
            divisions,
            masterLeagues,
            rotationHistory,
            scheduleAssignments
        } = ctx;

        const timestamp = Date.now();

        // Process each bunk in each division
        Object.keys(divisions).forEach(div => {
            const bunks = divisions[div].bunks || [];

            bunks.forEach(bunk => {
                const schedule = scheduleAssignments[bunk] || [];
                const transitions = extractTransitions(schedule);

                transitions.forEach(activity => {
                    recordBunkHistory(rotationHistory, bunk, activity, timestamp);

                    // Also bump league history if activity is a sport used by this division’s league
                    const leagueEntry = Object.entries(masterLeagues).find(
                        ([name, lg]) => lg.enabled && lg.divisions.includes(div)
                    );

                    if (leagueEntry) {
                        const [leagueName, league] = leagueEntry;

                        // Activities that represent H2H league play
                        if (league.sports.includes(activity)) {
                            recordLeagueHistory(rotationHistory, leagueName, activity, timestamp);
                        }
                    }
                });
            });
        });

        // Return updated object so engine can save it externally
        return rotationHistory;
    }

    /* =======================================================================
       EXPORT
       ======================================================================= */

    NS.history = { update };

})(typeof window !== "undefined" ? window : global);
