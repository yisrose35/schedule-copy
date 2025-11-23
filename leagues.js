// ===================================================================
// leagues.js
//
// UPDATED (Import from Daily Schedule):
// - Imports *all* league game blocks for the selected league from the
//   current day's schedule (not from standings/history).
// - Uses the actual "League Game X" labels coming from the daily
//   schedule text.
// - Correctly splits each block into separate matchups.
// - Avoids double-counting by only reading from a single "anchor" team.
//
// FIX APPLIED:
// - Adding/Removing teams no longer refreshes the whole pane (prevents jumping).
// - Input box automatically refocuses after adding a team.
// ===================================================================

(function () {
  'use strict';

  let leaguesByName = {};
  window.leaguesByName = leaguesByName;

  let leagueRoundState = {};
  window.leagueRoundState = leagueRoundState;

  // --- UI State Persistence ---
  let selectedLeagueName = null;
  let listEl = null;
  let detailPaneEl = null;

  function getPlaceSuffix(n) {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return s[(v - 20) % 10] || s[v] || s[0];
  }

  function loadRoundState() {
    try {
      const data = window.loadCurrentDailyData?.() || {};
      leagueRoundState = data.leagueRoundState || {};
      window.leagueRoundState = leagueRoundState;
    } catch (e) {
      leagueRoundState = {};
    }
  }

  function saveLeaguesData() {
    window.saveGlobalSettings?.('leaguesByName', leaguesByName);
  }

  function loadLeaguesData() {
    const global = window.loadGlobalSettings?.() || {};
    leaguesByName = global.leaguesByName || {};

    Object.values(leaguesByName).forEach((l) => {
      l.divisions = l.divisions || [];
      l.sports = l.sports || [];
      l.teams = l.teams || [];
      l.enabled = l.enabled !== false;
      l.standings = l.standings || {};
      l.games = l.games || [];
      (l.teams || []).forEach((team) => {
        l.standings[team] = l.standings[team] || { w: 0, l: 0, t: 0 };
      });
    });
    window.leaguesByName = leaguesByName;
  }

  function makeEditable(el, saveCallback) {
    el.ondblclick = (e) => {
      e.stopPropagation();
      const oldText = el.textContent;
      const input = document.createElement('input');
      input.type = 'text';
      input.value = oldText;
      el.replaceWith(input);
      input.focus();
      const finish = () => {
        const newVal = input.value.trim();
        if (newVal && newVal !== oldText) saveCallback(newVal);
        el.textContent = newVal || oldText;
        input.replaceWith(el);
      };
      input.onblur = finish;
      input.onkeyup = (ev) => {
        if (ev.key === 'Enter') finish();
      };
    };
  }

  // ================================================================
  // INIT
  // ================================================================
  window.initLeagues = function () {
    const container = document.getElementById('leaguesContainer');
    if (!container) return;

    loadLeaguesData();
    loadRoundState();

    container.innerHTML = `
      <div style="display: flex; flex-wrap: wrap; gap: 20px;">
        <div style="flex: 1; min-width: 300px;">
          <h3>Add New League</h3>
          <div style="display: flex; gap: 10px; margin-bottom: 20px;">
            <input id="new-league-input" placeholder="League Name (e.g., Senior League)" style="flex: 1;">
            <button id="add-league-btn">Add League</button>
          </div>
          <h3>All Leagues</h3>
          <div id="league-master-list" class="master-list"></div>
        </div>
        <div style="flex: 2; min-width: 400px; position: sticky; top: 20px;">
          <h3>Details</h3>
          <div id="league-detail-pane" class="detail-pane">
            <p class="muted">Select a league from the left to edit its details.</p>
          </div>
        </div>
      </div>
      <style>
        .master-list .list-item {
          padding: 12px 10px;
          border: 1px solid #ddd;
          border-radius: 5px;
          margin-bottom: 5px;
          cursor: pointer;
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: #fff;
          transition: transform 0.12s ease, box-shadow 0.12s ease, background 0.12s ease;
        }
        .master-list .list-item:hover {
          background: #f3f6ff;
          transform: translateY(-1px);
          box-shadow: 0 2px 6px rgba(15, 23, 42, 0.08);
        }
        .master-list .list-item.selected {
          background: #e7f3ff;
          border-color: #007bff;
          font-weight: 600;
          box-shadow: 0 0 0 1px rgba(37, 99, 235, 0.35);
        }
        .master-list .list-item-name {
          flex-grow: 1;
        }
        .detail-pane {
          border: 1px solid #e5e7eb;
          border-radius: 12px;
          padding: 18px 20px;
          background: #f9fafb;
          min-height: 420px;
          box-shadow: 0 4px 12px rgba(15, 23, 42, 0.06);
        }
        .chips {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-top: 6px;
        }
        .chip {
          padding: 4px 9px;
          border-radius: 999px;
          border: 1px solid #d1d5db;
          cursor: pointer;
          font-size: 0.85rem;
          background: #f3f4f6;
        }
        .chip.active {
          background: #2563eb;
          border-color: #2563eb;
          color: #fff;
        }
        .match-row {
          transition: background 0.15s ease, transform 0.12s ease, box-shadow 0.12s ease;
        }
        .match-row:hover {
          background: #f3f6ff;
          transform: translateY(-1px);
          box-shadow: 0 2px 6px rgba(15, 23, 42, 0.08);
        }
        .league-standings-table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 5px;
        }
        .league-standings-table th,
        .league-standings-table td {
          padding: 8px;
          text-align: center;
          border-bottom: 1px solid #e5e7eb;
          font-size: 0.9rem;
        }
        .league-standings-table th {
          background: #f3f4f6;
          text-align: left;
        }
        .league-standings-table td:first-child,
        .league-standings-table th:first-child {
          text-align: left;
        }
        .group-header {
          background: #e9efff;
          padding: 7px 10px;
          font-weight: 600;
          font-size: 0.9rem;
          color: #1f2937;
          border-radius: 6px;
          margin-top: 14px;
          margin-bottom: 6px;
          border-left: 4px solid #2563eb;
        }
      </style>
    `;

    listEl = document.getElementById('league-master-list');
    detailPaneEl = document.getElementById('league-detail-pane');

    const addInput = document.getElementById('new-league-input');
    const addBtn = document.getElementById('add-league-btn');

    const addLeague = () => {
      const name = addInput.value.trim();
      if (!name) return;
      if (leaguesByName[name]) {
        alert('League exists!');
        return;
      }
      leaguesByName[name] = {
        teams: [],
        sports: [],
        divisions: [],
        standings: {},
        games: [],
        enabled: true
      };
      saveLeaguesData();
      addInput.value = '';
      selectedLeagueName = name;
      renderMasterList();
      renderDetailPane();
    };

    addBtn.onclick = addLeague;
    addInput.onkeyup = (e) => {
      if (e.key === 'Enter') addLeague();
    };

    renderMasterList();

    if (selectedLeagueName && leaguesByName[selectedLeagueName]) {
      renderDetailPane();
    }
  };

  // ================================================================
  // MASTER LIST
  // ================================================================
  function renderMasterList() {
    listEl.innerHTML = '';
    const keys = Object.keys(leaguesByName).sort();
    if (keys.length === 0) {
      listEl.innerHTML = `<p class="muted">No leagues yet.</p>`;
      return;
    }
    keys.forEach((name) => {
      const item = leaguesByName[name];
      const el = document.createElement('div');
      el.className = 'list-item';
      if (name === selectedLeagueName) el.classList.add('selected');
      el.onclick = () => {
        selectedLeagueName = name;
        renderMasterList();
        renderDetailPane();
      };
      el.innerHTML = `<span class="list-item-name">${name}</span>`;
      const tog = document.createElement('label');
      tog.className = 'switch';
      tog.onclick = (e) => e.stopPropagation();
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = item.enabled;
      cb.onchange = () => {
        item.enabled = cb.checked;
        saveLeaguesData();
      };
      const slider = document.createElement('span');
      slider.className = 'slider';
      tog.append(cb, slider);
      el.appendChild(tog);
      listEl.appendChild(el);
    });
  }

  // ================================================================
  // DETAIL PANE
  // ================================================================
  function renderDetailPane() {
    if (!selectedLeagueName || !leaguesByName[selectedLeagueName]) {
      detailPaneEl.innerHTML = `<p class="muted">Select a league.</p>`;
      return;
    }

    const league = leaguesByName[selectedLeagueName];
    detailPaneEl.innerHTML = '';

    // --- Header ---
    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.marginBottom = '15px';
    header.style.borderBottom = '2px solid #e5e7eb';
    header.style.paddingBottom = '10px';

    const title = document.createElement('h2');
    title.style.margin = '0';
    title.style.fontSize = '1.2rem';
    title.textContent = selectedLeagueName;
    title.title = 'Double-click to rename';
    makeEditable(title, (newName) => {
      if (newName && !leaguesByName[newName]) {
        leaguesByName[newName] = league;
        delete leaguesByName[selectedLeagueName];
        selectedLeagueName = newName;
        saveLeaguesData();
        renderMasterList();
        renderDetailPane();
      }
    });
    header.appendChild(title);

    const btnGroup = document.createElement('div');

    const editConfigBtn = document.createElement('button');
    editConfigBtn.textContent = 'Edit Configuration';
    editConfigBtn.style.marginRight = '10px';
    editConfigBtn.style.background = '#6c757d';
    editConfigBtn.style.color = 'white';
    editConfigBtn.style.border = 'none';
    editConfigBtn.style.padding = '5px 10px';
    editConfigBtn.style.borderRadius = '4px';
    editConfigBtn.style.cursor = 'pointer';

    const delBtn = document.createElement('button');
    delBtn.textContent = 'Delete';
    delBtn.style.background = '#c0392b';
    delBtn.style.color = 'white';
    delBtn.style.border = 'none';
    delBtn.style.padding = '5px 10px';
    delBtn.style.borderRadius = '4px';
    delBtn.style.cursor = 'pointer';
    delBtn.onclick = () => {
      if (confirm('Delete league?')) {
        delete leaguesByName[selectedLeagueName];
        selectedLeagueName = null;
        saveLeaguesData();
        renderMasterList();
        detailPaneEl.innerHTML = `<p class="muted">Select a league.</p>`;
      }
    };

    btnGroup.appendChild(editConfigBtn);
    btnGroup.appendChild(delBtn);
    header.appendChild(btnGroup);
    detailPaneEl.appendChild(header);

    // --- Configuration Section (collapsible) ---
    const configContainer = document.createElement('div');
    configContainer.id = 'league-config-ui';
    configContainer.style.display = 'none';
    configContainer.style.marginBottom = '20px';
    configContainer.style.padding = '15px';
    configContainer.style.border = '1px solid #e5e7eb';
    configContainer.style.background = '#f8fafc';
    configContainer.style.borderRadius = '8px';

    renderConfigSections(league, configContainer);
    detailPaneEl.appendChild(configContainer);

    editConfigBtn.onclick = () => {
      const isHidden = configContainer.style.display === 'none';
      if (isHidden) {
        configContainer.style.display = 'block';
        editConfigBtn.textContent = 'Close Configuration';
        editConfigBtn.style.background = '#343a40';
      } else {
        configContainer.style.display = 'none';
        editConfigBtn.textContent = 'Edit Configuration';
        editConfigBtn.style.background = '#6c757d';
      }
    };

    // --- Standings & Games ---
    const mainContent = document.createElement('div');
    renderGameResultsUI(league, mainContent);
    detailPaneEl.appendChild(mainContent);
  }

  // --- FIXED RENDER CONFIG (Prevents jumping back to Standings) ---
  function renderConfigSections(league, container) {
    container.innerHTML = '';

    // Divisions
    const divSec = document.createElement('div');
    divSec.innerHTML = `<strong>Divisions:</strong>`;
    const divChips = document.createElement('div');
    divChips.className = 'chips';
    (window.availableDivisions || []).forEach((divName) => {
      const isActive = league.divisions.includes(divName);
      const chip = document.createElement('span');
      chip.className = 'chip' + (isActive ? ' active' : '');
      chip.textContent = divName;
      chip.onclick = () => {
        if (isActive) {
          league.divisions = league.divisions.filter((d) => d !== divName);
        } else {
          league.divisions.push(divName);
        }
        saveLeaguesData();
        renderConfigSections(league, container);
      };
      divChips.appendChild(chip);
    });
    divSec.appendChild(divChips);
    container.appendChild(divSec);

    // Sports
    const sportSec = document.createElement('div');
    sportSec.style.marginTop = '15px';
    sportSec.innerHTML = `<strong>Sports:</strong>`;
    const sportChips = document.createElement('div');
    sportChips.className = 'chips';
    (window.getAllGlobalSports?.() || []).forEach((act) => {
      const isActive = league.sports.includes(act);
      const chip = document.createElement('span');
      chip.className = 'chip' + (isActive ? ' active' : '');
      chip.textContent = act;
      chip.onclick = () => {
        if (isActive) {
          league.sports = league.sports.filter((s) => s !== act);
        } else {
          league.sports.push(act);
        }
        saveLeaguesData();
        renderConfigSections(league, container);
      };
      sportChips.appendChild(chip);
    });
    sportSec.appendChild(sportChips);
    container.appendChild(sportSec);

    // Teams
    const teamSec = document.createElement('div');
    teamSec.style.marginTop = '15px';
    teamSec.innerHTML = `<strong>Teams:</strong>`;
    const teamList = document.createElement('div');
    teamList.className = 'chips';
    league.teams.forEach((team) => {
      const chip = document.createElement('span');
      chip.className = 'chip active';
      chip.textContent = `${team} ✖`;
      chip.onclick = () => {
        league.teams = league.teams.filter((t) => t !== team);
        delete league.standings[team];
        saveLeaguesData();
        // FIX 1: Do NOT call renderDetailPane(), only update this section
        renderConfigSections(league, container);
      };
      teamList.appendChild(chip);
    });
    teamSec.appendChild(teamList);

    const teamInput = document.createElement('input');
    teamInput.placeholder = 'Add team (Press Enter)';
    teamInput.style.marginTop = '8px';
    teamInput.onkeyup = (e) => {
      if (e.key === 'Enter' && teamInput.value.trim()) {
        const t = teamInput.value.trim();
        if (!league.teams.includes(t)) {
          league.teams.push(t);
          league.standings[t] = { w: 0, l: 0, t: 0 };
          saveLeaguesData();
          
          // FIX 2: Do NOT call renderDetailPane(), only update this section
          renderConfigSections(league, container);
          
          // FIX 3: Re-focus the input so you can type the next team
          const newInput = container.querySelector('input');
          if (newInput) newInput.focus();
        }
      }
    };
    teamSec.appendChild(teamInput);
    container.appendChild(teamSec);
  }

  // ================================================================
  // GAME RESULTS & STANDINGS
  // ================================================================
  function renderGameResultsUI(league, container) {
    container.innerHTML = '';

    const tabNav = document.createElement('div');
    tabNav.style.marginBottom = '15px';
    tabNav.innerHTML = `
      <button id="tab-standings" style="font-weight:bold; padding:8px 15px; margin-right:5px; background:#2563eb; color:white; border:none; border-radius:999px; cursor:pointer;">Current Standings</button>
      <button id="tab-games" style="padding:8px 15px; background:#e5e7eb; color:#111827; border:none; border-radius:999px; cursor:pointer;">Game Results / History</button>
    `;
    container.appendChild(tabNav);

    const standingsDiv = document.createElement('div');
    const gamesDiv = document.createElement('div');
    gamesDiv.style.display = 'none';

    container.appendChild(standingsDiv);
    container.appendChild(gamesDiv);

    const btnStd = tabNav.querySelector('#tab-standings');
    const btnGms = tabNav.querySelector('#tab-games');

    btnStd.onclick = () => {
      standingsDiv.style.display = 'block';
      gamesDiv.style.display = 'none';
      btnStd.style.background = '#2563eb';
      btnStd.style.color = 'white';
      btnGms.style.background = '#e5e7eb';
      btnGms.style.color = '#111827';
      renderStandingsTable(league, standingsDiv);
    };
    btnGms.onclick = () => {
      standingsDiv.style.display = 'none';
      gamesDiv.style.display = 'block';
      btnStd.style.background = '#e5e7eb';
      btnStd.style.color = '#111827';
      btnGms.style.background = '#2563eb';
      btnGms.style.color = 'white';
      renderGameEntryUI(league, gamesDiv);
    };

    renderStandingsTable(league, standingsDiv);
  }

  function renderStandingsTable(league, container) {
    container.innerHTML = '';
    if (!league.teams || league.teams.length === 0) {
      container.innerHTML = '<p class="muted">No teams to display.</p>';
      return;
    }

    recalcStandings(league);

    const sortedTeams = [...league.teams].sort((a, b) => {
      const sA = league.standings[a] || { w: 0, l: 0, t: 0 };
      const sB = league.standings[b] || { w: 0, l: 0, t: 0 };
      if (sA.w !== sB.w) return sB.w - sA.w;
      if (sA.l !== sB.l) return sA.l - sB.l;
      if (sA.t !== sB.t) return sB.t - sA.t;
      return a.localeCompare(b);
    });

    let html = `
      <table class="league-standings-table">
        <thead>
          <tr>
            <th>Place</th>
            <th>Team</th>
            <th>W</th>
            <th>L</th>
            <th>T</th>
          </tr>
        </thead>
        <tbody>
    `;

    sortedTeams.forEach((team, idx) => {
      const stats = league.standings[team] || { w: 0, l: 0, t: 0 };
      html += `
        <tr>
          <td>${idx + 1}${getPlaceSuffix(idx + 1)}</td>
          <td>${team}</td>
          <td>${stats.w}</td>
          <td>${stats.l}</td>
          <td>${stats.t}</td>
        </tr>
      `;
    });

    html += '</tbody></table>';
    container.innerHTML = html;
  }

  function renderGameEntryUI(league, container) {
    container.innerHTML = '';

    const controls = document.createElement('div');
    controls.style.marginBottom = '15px';
    controls.style.display = 'flex';
    controls.style.gap = '10px';
    controls.style.alignItems = 'center';

    const select = document.createElement('select');
    select.innerHTML = `<option value="new">-- Enter New Game Results --</option>`;
    (league.games || []).forEach((g, idx) => {
      const label = g.name || `Game ${idx + 1}`;
      select.innerHTML += `<option value="${idx}">${label} (${g.date})</option>`;
    });
    controls.appendChild(select);

    const importBtn = document.createElement('button');
    importBtn.textContent = "Import from Today's Schedule";
    importBtn.style.padding = '6px 12px';
    importBtn.style.background = '#2563eb';
    importBtn.style.color = 'white';
    importBtn.style.border = 'none';
    importBtn.style.borderRadius = '999px';
    importBtn.style.cursor = 'pointer';
    controls.appendChild(importBtn);

    const matchContainer = document.createElement('div');
    matchContainer.style.maxHeight = '420px';
    matchContainer.style.overflowY = 'auto';

    container.appendChild(controls);
    container.appendChild(matchContainer);

    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save Game Results';
    saveBtn.style.marginTop = '10px';
    saveBtn.style.background = '#22c55e';
    saveBtn.style.color = 'white';
    saveBtn.style.border = 'none';
    saveBtn.style.padding = '8px 16px';
    saveBtn.style.borderRadius = '999px';
    saveBtn.style.cursor = 'pointer';
    saveBtn.style.display = 'none';
    saveBtn.dataset.role = 'save-game-results';
    saveBtn.onclick = () => saveGameResults(league, select.value, matchContainer);
    container.appendChild(saveBtn);

    importBtn.onclick = () => importGamesFromSchedule(league, matchContainer);

    select.onchange = () => {
      matchContainer.innerHTML = '';
      if (select.value === 'new') {
        importBtn.style.display = 'inline-block';
        saveBtn.style.display = 'none';
      } else {
        importBtn.style.display = 'none';
        saveBtn.style.display = 'inline-block';
        loadExistingGame(league, select.value, matchContainer, saveBtn);
      }
    };

    function loadExistingGame(leagueObj, gameIdx, target, saveButton) {
      const game = leagueObj.games[gameIdx];
      if (!game) return;

      const groupedMatches = {};
      game.matches.forEach((m) => {
        const label = m.timeLabel || 'Matchups';
        if (!groupedMatches[label]) groupedMatches[label] = [];
        groupedMatches[label].push(m);
      });

      Object.keys(groupedMatches)
        .sort()
        .forEach((label) => {
          const header = document.createElement('div');
          header.className = 'group-header';
          header.textContent = label;
          target.appendChild(header);

          groupedMatches[label].forEach((m) => {
            addMatchRow(target, m.teamA, m.teamB, m.scoreA, m.scoreB, saveButton, label);
          });
        });
    }
  }

  function addMatchRow(target, teamA, teamB, scoreA = '', scoreB = '', saveButton, timeLabel = '') {
    const row = document.createElement('div');
    row.className = 'match-row';
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '10px';
    row.style.marginBottom = '8px';
    row.style.padding = '8px';
    row.style.background = '#f9fafb';
    row.style.border = '1px solid #e5e7eb';
    row.style.borderRadius = '8px';

    row.innerHTML = `
      <strong style="min-width:100px; text-align:right;">${teamA}</strong>
      <input type="number" class="score-a" value="${scoreA}" style="width:54px; padding:5px;">
      <span>vs</span>
      <input type="number" class="score-b" value="${scoreB}" style="width:54px; padding:5px;">
      <strong style="min-width:100px;">${teamB}</strong>
    `;

    row.dataset.teamA = teamA;
    row.dataset.teamB = teamB;
    if (timeLabel) row.dataset.timeLabel = timeLabel;

    target.appendChild(row);
    if (saveButton) saveButton.style.display = 'inline-block';
  }

  // ================================================================
  // NEW IMPORT FROM DAILY SCHEDULE
  // ================================================================
  function importGamesFromSchedule(league, target) {
    target.innerHTML = '';

    const daily = window.loadCurrentDailyData?.() || {};
    const assignments = daily.scheduleAssignments || {};

    if (!league.teams || league.teams.length === 0) {
      target.innerHTML = `<p class="muted">Add teams to this league first.</p>`;
      return;
    }

    // We only look at ONE "anchor" team to avoid double counting.
    const anchorTeam = league.teams[0];
    const schedule = assignments[anchorTeam] || [];

    if (!Array.isArray(schedule) || schedule.length === 0) {
      target.innerHTML = `<p class="muted">No schedule entries found today for ${anchorTeam}.</p>`;
      return;
    }

    // Collect game blocks: each has label "League Game X" and a list of matchups
    const groups = [];

    for (let slotIndex = 0; slotIndex < schedule.length; slotIndex++) {
      const entry = schedule[slotIndex];
      if (!entry) continue;

      // We only care about H2H league blocks
      if (!entry._h2h) continue;

      // The display text that the UI put in the cell.
      // Try several fields in case the core uses different ones.
      const rawText =
        (typeof entry.sport === 'string' && entry.sport) ||
        (typeof entry.event === 'string' && entry.event) ||
        (typeof entry._activity === 'string' && entry._activity) ||
        '';

      if (!rawText.trim()) continue;

      // Split into lines, trim, and drop blanks
      const lines = rawText
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

      if (!lines.length) continue;

      // Figure out the label (e.g. "League Game 6")
      let gameLabel =
        lines.find((l) => /league game/i.test(l)) ||
        lines[0] ||
        'League Game';

      // Now parse each matchup line: "1 vs 5 (Baseball) @ Court A"
      const matches = [];

      lines.forEach((line) => {
        if (!/ vs /i.test(line)) return;
        const m = line.match(/^(.*?)\s+vs\s+(.*?)(?:\s*\(|$)/i);
        if (!m) return;
        const teamA = m[1].trim();
        const teamB = m[2].trim();

        // Only keep if both are teams in THIS league
        if (league.teams.includes(teamA) && league.teams.includes(teamB)) {
          matches.push({ teamA, teamB });
        }
      });

      if (matches.length > 0) {
        groups.push({ label: gameLabel, matches });
      }
    }

    if (!groups.length) {
      target.innerHTML = `<p class="muted">No league games found on today's schedule for this league.</p>`;
      return;
    }

    const saveButton =
      target.parentElement.querySelector('[data-role="save-game-results"]') ||
      null;

    groups.forEach((group) => {
      const header = document.createElement('div');
      header.className = 'group-header';
      header.textContent = group.label;
      target.appendChild(header);

      group.matches.forEach((m) => {
        addMatchRow(target, m.teamA, m.teamB, '', '', saveButton, group.label);
      });
    });

    if (saveButton) saveButton.style.display = 'inline-block';
  }

  // ================================================================
  // SAVE RESULTS + STANDINGS
  // ================================================================
  function saveGameResults(league, gameId, container) {
    const rows = container.querySelectorAll('.match-row');
    const results = [];

    rows.forEach((row) => {
      const tA = row.dataset.teamA;
      const tB = row.dataset.teamB;
      const tLabel = row.dataset.timeLabel || '';
      const sA = parseInt(row.querySelector('.score-a').value, 10) || 0;
      const sB = parseInt(row.querySelector('.score-b').value, 10) || 0;

      let winner = null;
      if (sA > sB) winner = tA;
      else if (sB > sA) winner = tB;
      else winner = 'tie';

      results.push({
        teamA: tA,
        teamB: tB,
        scoreA: sA,
        scoreB: sB,
        winner: winner,
        timeLabel: tLabel
      });
    });

    if (results.length === 0) return;

    if (gameId === 'new') {
      const firstLabel = results[0].timeLabel || `Game Set ${league.games.length + 1}`;
      league.games.push({
        id: Date.now(),
        date: window.currentScheduleDate || new Date().toLocaleDateString(),
        name: firstLabel,
        matches: results
      });
    } else {
      league.games[gameId].matches = results;
    }

    recalcStandings(league);
    saveLeaguesData();
    alert('Results saved and standings updated!');
    renderDetailPane();
  }

  function recalcStandings(league) {
    league.teams.forEach((t) => {
      league.standings[t] = { w: 0, l: 0, t: 0 };
    });

    (league.games || []).forEach((g) => {
      (g.matches || []).forEach((m) => {
        if (m.winner === 'tie') {
          if (league.standings[m.teamA]) league.standings[m.teamA].t++;
          if (league.standings[m.teamB]) league.standings[m.teamB].t++;
        } else if (m.winner) {
          if (league.standings[m.winner]) league.standings[m.winner].w++;
          const loser = m.winner === m.teamA ? m.teamB : m.teamA;
          if (league.standings[loser]) league.standings[loser].l++;
        }
      });
    });
  }

  // Initial load of data/state when file is loaded
  loadLeaguesData();
  loadRoundState();
})();
