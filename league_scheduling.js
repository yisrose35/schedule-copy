/**
 * =============================================================
 * LEAGUE SCHEDULING CORE (league_scheduling.js)
 * (UPDATED: Global Persistence & Infinite Game Counter)
 * =============================================================
 */

(function () {
  'use strict';

  let leagueRoundState = {}; // { "League Name": { currentRound: 0 } }

  /**
   * Loads the current round for all leagues from GLOBAL settings (Season Persistence).
   * This ensures "Game 6" carries over to the next day.
   */
  function loadRoundState() {
    try {
      const global = window.loadGlobalSettings?.() || {};
      leagueRoundState = global.leagueRoundState || {};
    } catch (e) {
      console.error("Failed to load league state:", e);
      leagueRoundState = {};
    }
  }

  /**
   * Saves the current round for all leagues to GLOBAL settings.
   */
  function saveRoundState() {
    try {
      window.saveGlobalSettings?.("leagueRoundState", leagueRoundState);
    } catch (e) {
      console.error("Failed to save league state:", e);
    }
  }

  /**
   * Generates a full round-robin tournament schedule for a list of teams.
   */
  function generateRoundRobin(teamList) {
    if (!teamList || teamList.length < 2) {
      return [];
    }
   
    const teams = [...teamList];
    let hasBye = false;
    if (teams.length % 2 !== 0) {
      teams.push("BYE");
      hasBye = true;
    }
   
    const numRounds = teams.length - 1;
    const schedule = [];
   
    const fixedTeam = teams[0];
    const rotatingTeams = teams.slice(1);
   
    for (let round = 0; round < numRounds; round++) {
      const currentRound = [];
      
      currentRound.push([fixedTeam, rotatingTeams[0]]);
   
      for (let i = 1; i < teams.length / 2; i++) {
        const team1 = rotatingTeams[i];
        const team2 = rotatingTeams[rotatingTeams.length - i];
        currentRound.push([team1, team2]);
      }
   
      schedule.push(currentRound);
      rotatingTeams.unshift(rotatingTeams.pop());
    }
   
    if (hasBye) {
      return schedule.map(round => 
        round.filter(match => match[0] !== "BYE" && match[1] !== "BYE")
      );
    }
   
    return schedule;
  }

  /**
   * Public function to get the *next* set of matchups for a league.
   * (Used by the Scheduler to generate the day)
   */
  function getLeagueMatchups(leagueName, teams) {
    if (!leagueName || !teams || teams.length < 2) {
      return []; 
    }
   
    // Ensure state is fresh from storage before calculating
    loadRoundState();

    const state = leagueRoundState[leagueName] || { currentRound: 0 };
    const fullSchedule = generateRoundRobin(teams);
   
    if (fullSchedule.length === 0) {
      return []; 
    }
   
    // Safety check: ensure round is within bounds
    let roundIndex = state.currentRound;
    if (typeof roundIndex !== 'number' || isNaN(roundIndex)) roundIndex = 0;
    
    // Use modulo to cycle through matchups, but keep roundIndex absolute for naming
    const todayMatchups = fullSchedule[roundIndex % fullSchedule.length];
   
    // Increment absolute counter (allows Game 1, Game 2... Game 100)
    const nextRound = roundIndex + 1;
    leagueRoundState[leagueName] = { currentRound: nextRound };
    
    // Save to GLOBAL state so it persists
    saveRoundState();
   
    return todayMatchups;
  }

  /**
   * Returns the CURRENT absolute round number (e.g., 6 for "Game 6").
   * Should be called AFTER getLeagueMatchups to get the label for the game just generated.
   */
  function getLeagueCurrentRound(leagueName) {
      // If we just generated a game, state.currentRound is the NEXT index (e.g., 1).
      // So returning state.currentRound (1) gives us "Game 1".
      // If state is 0, it means we haven't played, so next game is Game 1.
      const state = leagueRoundState[leagueName];
      const val = state ? state.currentRound : 0;
      // If val is 0, we treat it as 1 for display? 
      // No, if getLeagueMatchups runs, val becomes 1. So we return 1.
      // If getLeagueMatchups hasn't run, val is 0.
      return val === 0 ? 1 : val; 
  }

  /**
   * NEW: Get matchups for a specific round index without modifying state.
   * (Used by Leagues.js to import results based on "League Game X")
   */
  function getMatchupsForRound(teams, roundIndex) {
    if (!teams || teams.length < 2) return [];
    const fullSchedule = generateRoundRobin(teams);
    if (fullSchedule.length === 0) return [];
    
    // Handle wrapping if the number is higher than total rounds
    const normalizedIndex = roundIndex % fullSchedule.length;
    return fullSchedule[normalizedIndex] || [];
  }

  // --- Global Exposure and Initialization ---
  window.getLeagueMatchups = getLeagueMatchups;
  window.getLeagueCurrentRound = getLeagueCurrentRound;
  window.getMatchupsForRound = getMatchupsForRound; 
   
  // Load state ONCE when the script loads
  loadRoundState(); 
})();
