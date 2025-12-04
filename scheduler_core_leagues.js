// ============================================================================
// scheduler_core_leagues.js
// (OBSOLETE: Logic Delegated to Total Solver Engine)
//
// All internal league scheduling logic (including assignment, sport selection,
// and field conflict resolution) has been moved to total_solver_engine.js.
// This file is now empty to ensure no old, conflicting logic runs.
// ============================================================================

(function() {
    'use strict';

    // The functions originally here (processSpecialtyLeagues and processRegularLeagues)
    // are no longer necessary. They are now executed implicitly when 
    // total_solver_engine.solveSchedule() runs its internal passes.
    
    // We keep the object export for compatibility, though it should remain empty.
    window.SchedulerCoreLeagues = {};

})();
