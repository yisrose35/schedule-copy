// ===================================================================
// leagues.js  — THEMED VERSION (FIXED: Game # Extraction & 2nd Game)
// ===================================================================

(function () {
    'use strict';

    // -------------------------------------------------------------
    // GLOBAL LEAGUE STORAGE
    // -------------------------------------------------------------
    let leaguesByName = {};
    window.leaguesByName = leaguesByName;

    let leagueRoundState = {};
    window.leagueRoundState = leagueRoundState;

    // -------------------------------------------------------------
    // UI STATE
    // -------------------------------------------------------------
    let selectedLeagueName = null;
    let listEl = null;
    let detailPaneEl = null;

    function getPlaceSuffix(n) {
        const s = ['th', 'st', 'nd', 'rd'];
        const v = n % 100;
        return s[(v - 20) % 10] || s[v] || s[0];
    }

    // -------------------------------------------------------------
    // LOAD + SAVE
    // -------------------------------------------------------------
    function loadRoundState() {
        try {
            const global = window.loadGlobalSettings?.() || {};
            leagueRoundState = global.leagueRoundState || {};
            window.leagueRoundState = leagueRoundState;
        } catch (e) {
            console.error("Failed to load league round state:", e);
            leagueRoundState = {};
            window.leagueRoundState = leagueRoundState;
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

    // -------------------------------------------------------------
    // INLINE EDIT HELPER
    // -------------------------------------------------------------
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

    // -------------------------------------------------------------
    // TIME HELPERS
    // -------------------------------------------------------------
    function parseTimeToMinutes(str) {
        if (!str || typeof str !== "string") return null;
        let s = str.trim().toLowerCase();
        let mer = null;

        if (s.endsWith("am") || s.endsWith("pm")) {
            mer = s.endsWith("am") ? "am" : "pm";
            s = s.replace(/am|pm/g, "").trim();
        }

        const m = s.match(/^(\d{1,2})\s*:\s*(\d{2})$/);
        if (!m) return null;

        let hh = parseInt(m[1], 10);
        const mm = parseInt(m[2], 10);
        if (Number.isNaN(hh) || Number.isNaN(mm)) return null;

        if (mer) {
            if (hh === 12) hh = mer === "am" ? 0 : 12;
            else if (mer === "pm") hh += 12;
        }

        return hh * 60 + mm;
    }

    function minutesToTimeLabel(min) {
        const h24 = Math.floor(min / 60);
        const m = String(min % 60).padStart(2, "0");
        const ap = h24 >= 12 ? "PM" : "AM";
        const h12 = h24 % 12 || 12;
        return `${h12}:${m} ${ap}`;
    }

    // Robust Slot Finder: Finds a slot that INTERSECTS the time
    function findSlotIndexForTime(targetMin) {
        const times = window.unifiedTimes || [];
        // Default incremental check if unifiedTimes isn't perfectly granular
        const INCREMENT_MINS = window.INCREMENT_MINS || 30; 

        for (let i = 0; i < times.length; i++) {
            const d = new Date(times[i].start);
            const slotStart = d.getHours() * 60 + d.getMinutes();
            
            // Calculate slot end (use data or fallback to increment)
            let slotEnd;
            if (times[i].end) {
                 const e = new Date(times[i].end);
                 slotEnd = e.getHours() * 60 + e.getMinutes();
            } else {
                 slotEnd = slotStart + INCREMENT_MINS;
            }

            // Check if targetMin falls inside this slot
            if (targetMin >= slotStart && targetMin < slotEnd) {
                return i;
            }
        }
        return -1;
    }

    // =================================================================
    // INIT — MOUNT ON #leagues
    // =================================================================
    window.initLeagues = function () {
        const container = document.getElementById('leagues');

        if (!container) return;

        loadLeaguesData();
        loadRoundState();

        // FULL THEME-CONSISTENT UI
        container.innerHTML = `
            <div class="setup-grid">
                <section class="setup-card setup-card-wide">
                    <div class="setup-card-header">
                        <span class="setup-step-pill">Leagues</span>
                        <div class="setup-card-text">
                            <h3>Manage Leagues, Teams, Standings & Results</h3>
                            <p>Configure league divisions, sports, and teams — then enter results to update standings.</p>
                        </div>
                    </div>

                    <div style="display:flex; flex-wrap:wrap; gap:20px; margin-top:10px;">

                        <div style="flex:1; min-width:260px;">
                            <div class="setup-subtitle">Add New League</div>

                            <div class="setup-field-row" style="margin-top:8px;">
                                <input id="new-league-input" placeholder="League Name (e.g., Senior League)">
                                <button id="add-league-btn">Add League</button>
                            </div>

                            <div class="setup-subtitle" style="margin-top:18px;">All Leagues</div>

                            <div id="league-master-list"
                                 class="master-list"
                                 style="margin-top:8px; max-height:440px; overflow:auto;">
                            </div>
                        </div>

                        <div style="flex:1.4; min-width:320px;">
                            <div class="setup-subtitle">League Details</div>

                            <div id="league-detail-pane"
                                 class="detail-pane"
                                 style="margin-top:8px; min-height:380px;">
                                <p class="muted">
                                    Select a league from the left to edit.
                                </p>
                            </div>
                        </div>

                    </div>
                </section>
            </div>

            <style>
                .master-list {
                    border-radius: 18px;
                    border: 1px solid #E5E7EB;
                    background: #F7F9FA;
                    padding: 8px 6px;
                    box-shadow: 0 10px 24px rgba(15,23,42,0.04);
                }
                .master-list .list-item {
                    padding: 10px 10px;
                    border-radius: 14px;
                    margin-bottom: 6px;
                    cursor: pointer;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    background: #FFFFFF;
                    border: 1px solid #E5E7EB;
                    box-shadow: 0 4px 10px rgba(15,23,42,0.05);
                    transition: background 0.15s, box-shadow 0.15s, transform 0.08s;
                }
                .master-list .list-item:hover {
                    background: #E7F0FF;
                    transform: translateY(-1px);
                }
                .master-list .list-item.selected {
                    background: radial-gradient(circle at top left, #E1ECFF 0, #FFFFFF 70%);
                    border-color: #2563EB;
                    box-shadow: 0 0 0 1px rgba(37, 99, 235, 0.45);
                    font-weight: 600;
                }
                .detail-pane {
                    border-radius: 18px;
                    border: 1px solid #E5E7EB;
                    padding: 18px 20px;
                    background: linear-gradient(135deg, #F7F9FA 0%, #FFFFFF 55%, #F7F9FA 100%);
                    box-shadow: 0 18px 40px rgba(15,23,42,0.06);
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
                    background: #2563EB;
                    border-color: #2563EB;
                    color: #fff;
                }
                .group-header {
                    background: #DBEAFE;
                    padding: 8px 12px;
                    font-weight: 700;
                    font-size: 0.95rem;
                    color: #1E40AF;
                    border-radius: 8px;
                    margin-top: 15px;
                    margin-bottom: 8px;
                    border-left: 5px solid #2563EB;
                }
                .match-row {
                    transition: background 0.15s ease, transform 0.12s ease, box-shadow 0.12s ease;
                }
                .match-row:hover {
                    background: #E7F0FF;
                    transform: translateY(-1px);
                    box-shadow: 0 2px 6px rgba(15, 23, 42, 0.08);
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
        addInput.onkeyup = e => { if (e.key === 'Enter') addLeague(); };

        renderMasterList();
        if (selectedLeagueName && leaguesByName[selectedLeagueName]) {
            renderDetailPane();
        }
    };

    // =================================================================
    // MASTER LIST RENDER
    // =================================================================
    function renderMasterList() {
        listEl.innerHTML = '';

        const keys = Object.keys(leaguesByName).sort();
        if (keys.length === 0) {
            listEl.innerHTML = `<p class="muted">No leagues yet.</p>`;
            return;
        }

        keys.forEach(name => {
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
            tog.onclick = e => e.stopPropagation();

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

    // =================================================================
    // DETAIL PANE
    // =================================================================
    function renderDetailPane() {
        if (!selectedLeagueName || !leaguesByName[selectedLeagueName]) {
            detailPaneEl.innerHTML = `<p class="muted">Select a league.</p>`;
            return;
        }

        const league = leaguesByName[selectedLeagueName];
        detailPaneEl.innerHTML = '';

        const header = document.createElement('div');
        Object.assign(header.style, {
            display: 'flex',
            justifyContent: 'space-between',
            marginBottom: '15px',
            borderBottom: '2px solid #e5e7eb',
            paddingBottom: '10px'
        });

        const title = document.createElement('h3');
        title.style.margin = '0';
        title.textContent = selectedLeagueName;
        title.title = "Double-click to rename";

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

        const btnGroup = document.createElement('div');

        const editConfigBtn = document.createElement('button');
        editConfigBtn.textContent = 'Edit Configuration';
        Object.assign(editConfigBtn.style, {
            marginRight: '10px',
            background: '#6c757d',
            color: 'white',
            border: 'none',
            padding: '6px 14px',
            borderRadius: '999px',
            cursor: 'pointer'
        });

        const delBtn = document.createElement('button');
        delBtn.textContent = 'Delete';
        Object.assign(delBtn.style, {
            background: '#c0392b',
            color: 'white',
            border: 'none',
            padding: '6px 14px',
            borderRadius: '999px',
            cursor: 'pointer'
        });

        delBtn.onclick = () => {
            if (confirm('Delete league?')) {
                delete leaguesByName[selectedLeagueName];
                selectedLeagueName = null;
                saveLeaguesData();
                renderMasterList();
                detailPaneEl.innerHTML = `<p class="muted">Select a league.</p>`;
            }
        };

        btnGroup.append(editConfigBtn, delBtn);
        header.append(title, btnGroup);
        detailPaneEl.appendChild(header);

        // CONFIG CARD
        const configContainer = document.createElement('div');
        configContainer.id = 'league-config-ui';
        Object.assign(configContainer.style, {
            display: 'none',
            marginBottom: '20px',
            padding: '15px',
            border: '1px solid #e5e7eb',
            background: '#F8FAFC',
            borderRadius: '12px'
        });

        renderConfigSections(league, configContainer);
        detailPaneEl.appendChild(configContainer);

        editConfigBtn.onclick = () => {
            const hidden = configContainer.style.display === 'none';
            if (hidden) {
                configContainer.style.display = 'block';
                editConfigBtn.textContent = 'Close Configuration';
                editConfigBtn.style.background = '#343a40';
            } else {
                configContainer.style.display = 'none';
                editConfigBtn.textContent = 'Edit Configuration';
                editConfigBtn.style.background = '#6c757d';
            }
        };

        // MAIN CONTENT
        const mainContent = document.createElement('div');
        renderGameResultsUI(league, mainContent);
        detailPaneEl.appendChild(mainContent);
    }

    // =================================================================
    // CONFIG SECTIONS
    // =================================================================
    function renderConfigSections(league, container) {
        container.innerHTML = '';

        // DIVISIONS
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
                    league.divisions = league.divisions.filter(d => d !== divName);
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

        // SPORTS
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
                    league.sports = league.sports.filter(s => s !== act);
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

        // TEAMS
        const teamSec = document.createElement('div');
        teamSec.style.marginTop = '15px';
        teamSec.innerHTML = `<strong>Teams:</strong>`;

        const teamList = document.createElement('div');
        teamList.className = 'chips';

        league.teams.forEach(team => {
            const chip = document.createElement('span');
            chip.className = 'chip active';
            chip.textContent = `${team} ✖`;

            chip.onclick = () => {
                league.teams = league.teams.filter(t => t !== team);
                delete league.standings[team];
                saveLeaguesData();
                renderConfigSections(league, container);
            };

            teamList.appendChild(chip);
        });

        teamSec.appendChild(teamList);

        const teamInput = document.createElement('input');
        teamInput.placeholder = 'Add team (Press Enter)';
        teamInput.style.marginTop = '8px';

        teamInput.onkeyup = e => {
            if (e.key === 'Enter' && teamInput.value.trim()) {
                const t = teamInput.value.trim();
                if (!league.teams.includes(t)) {
                    league.teams.push(t);
                    league.standings[t] = { w: 0, l: 0, t: 0 };
                    saveLeaguesData();
                    renderConfigSections(league, container);

                    // Focus the new input again
                    const newInput = container.querySelector('input');
                    if (newInput) newInput.focus();
                }
            }
        };

        teamSec.appendChild(teamInput);
        container.appendChild(teamSec);
    }

    // =================================================================
    // GAME RESULTS VIEW
    // =================================================================
    function renderGameResultsUI(league, container) {
        container.innerHTML = '';

        const tabNav = document.createElement('div');
        tabNav.style.marginBottom = '15px';

        tabNav.innerHTML = `
            <button id="tab-standings"
                    style="font-weight:bold; padding:8px 15px; margin-right:5px;
                           background:#2563EB; color:white; border:none;
                           border-radius:999px; cursor:pointer;">
                Current Standings
            </button>

            <button id="tab-games"
                    style="padding:8px 15px; background:#E5E7EB; color:#111827;
                           border:none; border-radius:999px; cursor:pointer;">
                Game Results / History
            </button>
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
            btnStd.style.background = '#2563EB';
            btnStd.style.color = 'white';
            btnGms.style.background = '#E5E7EB';
            btnGms.style.color = '#111827';
            renderStandingsTable(league, standingsDiv);
        };

        btnGms.onclick = () => {
            standingsDiv.style.display = 'none';
            gamesDiv.style.display = 'block';
            btnStd.style.background = '#E5E7EB';
            btnStd.style.color = '#111827';
            btnGms.style.background = '#2563EB';
            btnGms.style.color = 'white';
            renderGameEntryUI(league, gamesDiv);
        };

        renderStandingsTable(league, standingsDiv);
    }

    // =================================================================
    // STANDINGS TABLE
    // =================================================================
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
            <table class="league-standings-table" style="width:100%; border-collapse:collapse;">
                <thead>
                    <tr style="background:#F3F4F6;">
                        <th style="text-align:left; padding:8px;">Place</th>
                        <th style="text-align:left; padding:8px;">Team</th>
                        <th style="padding:8px;">W</th>
                        <th style="padding:8px;">L</th>
                        <th style="padding:8px;">T</th>
                    </tr>
                </thead>
                <tbody>
        `;

        sortedTeams.forEach((team, idx) => {
            const stats = league.standings[team] || { w: 0, l: 0, t: 0 };
            html += `
                <tr>
                    <td style="padding:8px;">${idx + 1}${getPlaceSuffix(idx + 1)}</td>
                    <td style="padding:8px;">${team}</td>
                    <td style="padding:8px; text-align:center;">${stats.w}</td>
                    <td style="padding:8px; text-align:center;">${stats.l}</td>
                    <td style="padding:8px; text-align:center;">${stats.t}</td>
                </tr>
            `;
        });

        html += `</tbody></table>`;
        container.innerHTML = html;
    }

    // =================================================================
    // GAME ENTRY + IMPORT
    // =================================================================
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
        Object.assign(importBtn.style, {
            padding: '6px 12px',
            background: '#2563EB',
            color: 'white',
            border: 'none',
            borderRadius: '999px',
            cursor: 'pointer'
        });
        controls.appendChild(importBtn);

        const matchContainer = document.createElement('div');
        matchContainer.style.maxHeight = '420px';
        matchContainer.style.overflowY = 'auto';

        container.appendChild(controls);
        container.appendChild(matchContainer);

        const saveBtn = document.createElement('button');
        saveBtn.textContent = 'Save Game Results';
        Object.assign(saveBtn.style, {
            marginTop: '10px',
            background: '#22c55e',
            color: 'white',
            border: 'none',
            padding: '8px 16px',
            borderRadius: '999px',
            cursor: 'pointer',
            display: 'none'
        });
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

            const labels = Object.keys(groupedMatches).sort((a, b) => {
                return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
            });

            labels.forEach((label) => {
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

        Object.assign(row.style, {
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            marginBottom: '8px',
            padding: '8px',
            background: '#F9FAFB',
            border: '1px solid #E5E7EB',
            borderRadius: '8px'
        });

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

    // =================================================================
    // IMPORT FROM SCHEDULE (FIXED: Game # Extraction & 2nd Game)
    // =================================================================
    function importGamesFromSchedule(league, target) {
        target.innerHTML = '';
        
        // 1. Get Core Data
        const daily = window.loadCurrentDailyData?.() || {};
        const skeleton = daily.manualSkeleton || [];
        const assignments = daily.scheduleAssignments || {};
        const divisions = window.divisions || {};
        
        const saveButton = target.parentElement.querySelector('[data-role="save-game-results"]');

        if (!league.teams || league.teams.length === 0) {
            target.innerHTML = `<p class="muted">Add teams to this league first.</p>`;
            return;
        }
        
        // 2. Scan Skeleton: LEAGUE blocks in this DIVISION
        const relevantBlocks = skeleton.filter(block => {
            return league.divisions.includes(block.division) &&
                   block.event.toLowerCase().includes("league game");
        });

        if (relevantBlocks.length === 0) {
             target.innerHTML = `<p class="muted">No "League Game" blocks found for the divisions: ${league.divisions.join(", ")}.</p>`;
             return;
        }

        const gamesFound = {}; 

        // 3. Process Each Block
        relevantBlocks.forEach(block => {
            const startMin = parseTimeToMinutes(block.startTime);
            const slotIdx = findSlotIndexForTime(startMin);

            if (slotIdx === -1) return;

            const divBunks = divisions[block.division]?.bunks || [];
            if (divBunks.length === 0) return;
            const representativeBunk = divBunks[0];
            const entry = assignments[representativeBunk]?.[slotIdx];

            if (!entry) return;

            // --- HEADER LABEL EXTRACTION (FIXED) ---
            let headerLabel = block.event; // Default "League Game"
            
            // Try to find "Game X" inside the TEXT first (Visual Priority)
            const rawText = (typeof entry.field === 'string') ? entry.field : (entry.sport || "");
            
            // Regex: Look for "Game 5" or "Match 5" inside the text or the block name
            const textMatch = rawText.match(/(?:Game|Match)\s*(\d+)/i) || headerLabel.match(/(?:Game|Match)\s*(\d+)/i);
            const hiddenMatch = entry._gameLabel || entry.gameLabel;

            if (textMatch) {
                // If text says "Game 5", force header to "League Game 5"
                headerLabel = `League Game ${textMatch[1]}`;
            } else if (hiddenMatch) {
                // If hidden data says "Game 5", use that
                headerLabel = `League Game ${hiddenMatch.replace(/^\D+/g, '')}`; 
            } else {
                // Fallback: If generic, append TIME to keep multiple games separate
                if (headerLabel.trim().toLowerCase() === "league game") {
                    headerLabel = `${headerLabel} (${minutesToTimeLabel(startMin)})`;
                }
            }

            // --- TEXT PARSING ---
            let linesToScan = [];
            if (entry._allMatchups && Array.isArray(entry._allMatchups) && entry._allMatchups.length > 0) {
                linesToScan = entry._allMatchups;
            } else if (typeof entry.field === 'string') {
                linesToScan = entry.field.split('\n');
            } else if (entry.sport) {
                linesToScan = [entry.sport];
            }

            linesToScan.forEach(line => {
                const m = line.match(/^(.*?)\s+vs\.?\s+(.*?)(?:\s*[@\(]|$)/i); 
                if (m) {
                    const tA = m[1].trim();
                    const tB = m[2].trim();

                    if (league.teams.includes(tA) && league.teams.includes(tB)) {
                        if (!gamesFound[headerLabel]) gamesFound[headerLabel] = [];
                        
                        const exists = gamesFound[headerLabel].some(g => 
                            (g.teamA === tA && g.teamB === tB) || 
                            (g.teamA === tB && g.teamB === tA)
                        );
                        
                        if (!exists) {
                            gamesFound[headerLabel].push({ teamA: tA, teamB: tB });
                        }
                    }
                }
            });
        });

        // 4. Render Results
        const groupNames = Object.keys(gamesFound).sort((a,b) => 
            a.localeCompare(b, undefined, {numeric: true})
        );

        if (groupNames.length === 0) {
            target.innerHTML = `<p class="muted">Found League blocks, but no valid matchups (Team A vs Team B) matching your roster.</p>`;
            return;
        }

        groupNames.forEach(label => {
            const header = document.createElement('div');
            header.className = 'group-header';
            header.textContent = label;
            target.appendChild(header);

            gamesFound[label].forEach(m => {
                addMatchRow(target, m.teamA, m.teamB, '', '', saveButton, label);
            });
        });

        if (saveButton) saveButton.style.display = 'inline-block';
    }

    // =================================================================
    // SAVE GAME RESULTS
    // =================================================================
    function saveGameResults(league, gameId, container) {
        const rows = container.querySelectorAll('.match-row');
        const results = [];

        rows.forEach(row => {
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

    // =================================================================
    // RECALC STANDINGS
    // =================================================================
    function recalcStandings(league) {
        league.teams.forEach(t => {
            league.standings[t] = { w: 0, l: 0, t: 0 };
        });

        (league.games || []).forEach(g => {
            (g.matches || []).forEach(m => {
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

    // FINAL LOAD
    loadLeaguesData();
    loadRoundState();

})();
