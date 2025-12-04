// ============================================================================
// data_persistence.js
// (NEW CORE UTILITY: Centralized Solver Memory & Season-Long Scorecard)
// ----------------------------------------------------------------------------
// Manages data that needs to persist across days and sessions for the Total
// Solver to maintain fairness and track historical constraints.
// ============================================================================

(function() {
    'use strict';

    // Keys MUST match those added to calendar.js for synchronization and clearing.
    const SCORECARD_KEY = "campSolverScorecard_v1";

    const Persistence = {};

    // ========================================================================
    // 1. SEASON-LONG SCORECARD (Fairness Tracking)
    // ========================================================================

    /**
     * Loads the Season-Long Fairness Scorecard.
     * Scorecard tracks penalties (disadvantages) accrued by each team/bunk
     * to ensure the solver prioritizes fairer outcomes for those with worse luck.
     *
     * @returns {object}   Example:
     *    {
     *      teamFairness: {
     *        "Bunk A": { totalPenalties: 50, lastPenalty: "2025-07-11" }
     *      }
     *    }
     */
    Persistence.loadSolverScorecard = function() {
        try {
            const raw = localStorage.getItem(SCORECARD_KEY);
            if (!raw) {
                return { teamFairness: {} };
            }
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === "object"
                ? parsed
                : { teamFairness: {} };
        } catch (e) {
            console.error("Persistence: Failed to load Solver Scorecard.", e);
            return { teamFairness: {} };
        }
    };

    /**
     * Saves the current Season-Long Fairness Scorecard.
     * @param {object} scorecard
     */
    Persistence.saveSolverScorecard = function(scorecard) {
        try {
            localStorage.setItem(SCORECARD_KEY, JSON.stringify(scorecard));
        } catch (e) {
            console.error("Persistence: Failed to save Solver Scorecard.", e);
        }
    };

    // ========================================================================
    // 2. CONTINUOUS RESERVATION LOG (Historical Timeline)
    // ========================================================================

    /**
     * Loads the minute-accurate Historical Reservation Log.
     * This returns a processed view of the rotation history which the solver
     * uses for constraints such as:
     *  - repeating opponents in leagues
     *  - repeating special/sports too soon
     *  - day-to-day “streak” fairness checks
     *
     * @returns {object}
     *    {
     *      bunkActivityDates: { "Bunk A": { "Swim": ["2025-07-10"] } },
     *      leagueMatchupHistory: { "Bunk A_vs_Bunk B": ["2025-07-10"] }
     *    }
     */
    Persistence.loadHistoricalReservationLog = function() {
        try {
            const rotationHistory = (typeof window.loadRotationHistory === "function")
                ? window.loadRotationHistory() || {}
                : {};

            return {
                bunkActivityDates: rotationHistory.bunks || {},
                leagueMatchupHistory: rotationHistory.leagues || {}
            };
        } catch (e) {
            console.error("Persistence: Failed to load Historical Reservation Log.", e);
            return {
                bunkActivityDates: {},
                leagueMatchupHistory: {}
            };
        }
    };

    // ========================================================================
    // 3. RESOURCE WEIGHTS & PREFERENCES
    // ========================================================================

    /**
     * Placeholder function to get resource weights (low-level costs).
     * In future versions, this will centralize preference/transition weights
     * used by the solver.
     *
     * @param {string} resourceName
     * @returns {object} { preferenceScore?: number, transitionCost?: number }
     */
    Persistence.getResourceWeights = function(resourceName) {
        // Hook for the Total Solver:
        // Will eventually pull from:
        //  - Fields/Special metadata
        //  - Solver Scorecard (bunk historical disadvantage)
        //  - Smart Tile fairness layers
        return {};
    };

    // Expose globally
    window.DataPersistence = Persistence;

})();
