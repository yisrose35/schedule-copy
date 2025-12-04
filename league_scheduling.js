/**
 * =============================================================
 * LEAGUE SCHEDULING FACADE (league_scheduling.js)
 * UPDATED: Safe season persistence + correct round numbering +
 *          delegation to Total Solver Engine.
 * =============================================================
 */

(function () {
  'use strict';

  // ============================================================
  // GLOBAL SEASON-LEVEL STATE (NOT PER DAY)
  // ============================================================
  let leagueRoundState = {}; // { leagueName: { currentRound: number } }
  window.leagueRoundState = leagueRoundState;

  // ============================================================
  // PERSISTENCE HELPERS (SAFE, NON-DESTRUCTIVE)
  // ============================================================

  function loadRoundState() {
    try {
      const global = window.loadGlobalSettings?.() || {};
      const stored = global.leagueRoundState;

      leagueRoundState = (stored && typeof stored === "object")
        ? stored
        : {};

      window.leagueRoundState = leagueRoundState;
    } catch (e) {
      console.error("Failed to load league state:", e);
      leagueRoundState = {};
      window.leagueRoundState = leagueRoundState;
    }
  }

  function saveRoundState() {
    try {
      const global = window.loadGlobalSettings?.() || {};
      global.leagueRoundState = leagueRoundState;
      localStorage.setItem("campGlobalSettings_v1", JSON.stringify(global));
    } catch (e) {
      console.error("Failed to save league state:", e);
    }
  }

  // ============================================================
  // MAIN API — Delegated to Solver
  // ============================================================

  /**
   * Generate today's matchups for a league.
   */
  function getLeagueMatchups(leagueName, teams) {
    if (!leagueName || !teams || teams.length < 2) return [];

    if (!window.totalSolverEngine ||
        typeof window.totalSolverEngine.solveLeagueMatchups !== 'function') {
      console.error("Total Solver Engine not loaded. Cannot generate league matchups.");
      return [];
    }

    // 1. Load persistent state
    loadRoundState();

    const state = leagueRoundState[leagueName] || { currentRound: 0 };
    const nextRoundToTry = state.currentRound + 1;

    // 2. Delegate generation
    const matchups = window.totalSolverEngine.solveLeagueMatchups(
      leagueName,
      teams,
      nextRoundToTry
    );

    // 3. Only commit a round increment on successful generation
    if (Array.isArray(matchups) && matchups.length > 0) {
      leagueRoundState[leagueName] = { currentRound: nextRoundToTry };
      saveRoundState();
    } else {
      console.warn(`Solver returned no matchups for ${leagueName}.`);
    }

    return matchups;
  }

  /**
   * Get "Game X" — which number is *up next* for this league
   */
  function getLeagueCurrentRound(leagueName) {
    loadRoundState();
    const state = leagueRoundState[leagueName];
    const lastCompleted = state?.currentRound || 0;
    return lastCompleted + 1; // NEXT upcoming game number
  }

  /**
   * Fetch matchups for an absolute round index without changing season state
   */
  function getMatchupsForRound(teams, roundIndex) {
    if (!teams || teams.length < 2) return [];

    if (!window.totalSolverEngine ||
        typeof window.totalSolverEngine.getSpecificRoundMatchups !== 'function') {
      console.error("Total Solver Engine not loaded. Cannot fetch specific round matchups.");
      return [];
    }

    return window.totalSolverEngine.getSpecificRoundMatchups(teams, roundIndex);
  }

  // ============================================================
  // EXPORT API
  // ============================================================
  window.getLeagueMatchups = getLeagueMatchups;
  window.getLeagueCurrentRound = getLeagueCurrentRound;
  window.getMatchupsForRound = getMatchupsForRound;

  // Load state immediately
  loadRoundState();

})();
