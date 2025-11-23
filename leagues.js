// ===================================================================
// leagues.js
//
// VISION REFRESH (UI ONLY, LOGIC PRESERVED):
// - Left panel: card-style league list with hover "lift" and enabled pill.
// - Right panel: structured detail layout:
//      • Header (editable league name, enabled pill, actions)
//      • Status strip (teams/sports/divisions counts)
//      • Collapsible "League Configuration" card (divisions/sports/teams)
//      • Tabs: Current Standings / Game Results & History
// - Import / standings logic unchanged, just slightly cleaned
//   (save button passed explicitly into import function).
// ===================================================================

(function () {
    'use strict';

    // Global league store
    let leaguesByName = {};
    window.leaguesByName = leaguesByName;

    // Round state (per league per day)
    let leagueRoundState = {};
    window.leagueRoundState = leagueRoundState;

    // --- UI State Persistence ---
    let selectedLeagueName = null;
    let listEl = null;
    let detailPaneEl = null;

    function getPlaceSuffix(n) {
        const s = ["th", "st", "nd", "rd"];
        const v = n % 100;
        return (s[(v - 20) % 10] || s[v] || s[0]);
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
        window.saveGlobalSettings?.("leaguesByName", leaguesByName);
    }

    function loadLeaguesData() {
        const global = window.loadGlobalSettings?.() || {};
        leaguesByName = global.leaguesByName || {};
        
        Object.values(leaguesByName).forEach(l => {
            l.divisions = l.divisions || [];
            l.sports    = l.sports    || [];
            l.teams     = l.teams     || [];
            l.enabled   = l.enabled !== false;
            l.standings = l.standings || {};
            l.games     = l.games     || []; 
            (l.teams || []).forEach(team => {
                l.standings[team] = l.standings[team] || { w: 0, l: 0, t: 0 };
            });
        });
        window.leaguesByName = leaguesByName;
    }

    function makeEditable(el, saveCallback) {
        el.ondblclick = e => {
            e.stopPropagation();
            const oldText = el.textContent;
            const input = document.createElement("input");
            input.type = "text";
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
            input.onkeyup = (ev) => { if (ev.key === "Enter") finish(); };
        };
    }

    // ===================================================================
    // INIT
    // ===================================================================
    window.initLeagues = function () {
        const container = document.getElementById("leaguesContainer");
        if (!container) return;

        loadLeaguesData();
        loadRoundState();

        // Modern layout + styling
        container.innerHTML = `
            <div style="display: flex; flex-wrap: wrap; gap: 20px;">
                <div style="flex: 1; min-width: 300px;">
                    <h3>Leagues</h3>
                    <p class="muted" style="margin-top:-6px; font-size:0.8rem;">
                        Configure divisions, sports, and teams for your leagues, then track results and standings.
                    </p>
                    <div style="display: flex; gap: 10px; margin-bottom: 14px; margin-top:8px;">
                        <input id="new-league-input" placeholder="League Name (e.g., Senior League)" style="flex: 1;">
                        <button id="add-league-btn">Add</button>
                    </div>
                    <h4 style="margin:10px 0 6px; font-size:0.9rem; color:#374151;">All Leagues</h4>
                    <div id="league-master-list" class="master-list"></div>
                </div>

                <div style="flex: 2; min-width: 400px; position: sticky; top: 20px;">
                    <h3>Details</h3>
                    <div id="league-detail-pane" class="detail-pane">
                        <p class="muted">
                            Select a league from the left to configure it and enter results.
                        </p>
                    </div>
                </div>
            </div>

            <style>
                /* Master list: card-style items with hover "lift", consistent with Fields/Specials */
                .master-list .list-item {
                    padding: 10px 12px;
                    border-radius: 12px;
                    margin-bottom: 6px;
                    cursor: pointer;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    background: #f9fafb;
                    border: 1px solid #e5e7eb;
                    box-shadow: 0 4px 10px rgba(15, 23, 42, 0.04);
                    transition:
                        background 0.12s ease,
                        box-shadow 0.12s ease,
                        transform 0.08s ease,
                        border-color 0.12s ease;
                }
                .master-list .list-item:hover {
                    background: #eff6ff;
                    transform: translateY(-1px);
                    box-shadow: 0 8px 18px rgba(15, 23, 42, 0.10);
                    border-color: #bfdbfe;
                }
                .master-list .list-item.selected {
                    background: #dbeafe;
                    border-color: #2563eb;
                    box-shadow: 0 10px 22px rgba(37, 99, 235, 0.25);
                }
                .master-list .list-item-main {
                    display: flex;
                    flex-direction: column;
                    gap: 2px;
                    flex-grow: 1;
                }
                .master-list .list-item-name {
                    font-weight: 600;
                    font-size: 0.9rem;
                    color: #111827;
                }
                .master-list .list-item-sub {
                    font-size: 0.75rem;
                    color: #6b7280;
                }
                .master-list .list-item-right {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    margin-left: 10px;
                }
                .master-list .pill {
                    font-size: 0.7rem;
                    padding: 2px 8px;
                    border-radius: 999px;
                    font-weight: 500;
                    white-space: nowrap;
                }
                .master-list .pill-enabled {
                    background: #dcfce7;
                    color: #166534;
                }
                .master-list .pill-disabled {
                    background: #fee2e2;
                    color: #b91c1c;
                }

                .detail-pane {
                    border: 1px solid #e5e7eb;
                    border-radius: 14px;
                    padding: 14px 16px 16px;
                    background: #f9fafb;
                    min-height: 380px;
                    box-shadow: 0 10px 24px rgba(15, 23, 42, 0.06);
                }

                .league-section-card {
                    border-radius: 12px;
                    border: 1px solid #e5e7eb;
                    background: #ffffff;
                    padding: 10px 12px;
                    margin-top: 10px;
                    box-shadow: 0 4px 10px rgba(15, 23, 42, 0.04);
                }
                .league-section-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 6px;
                }
                .league-section-title {
                    font-size: 0.82rem;
                    text-transform: uppercase;
                    letter-spacing: 0.06em;
                    color: #6b7280;
                    font-weight: 600;
                }
                .league-section-tag {
                    font-size: 0.7rem;
                    padding: 2px 8px;
                    border-radius: 999px;
                    background: #eff6ff;
                    color: #1d4ed8;
                    font-weight: 500;
                }

                .chips { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 5px; }
                .chip {
                    padding: 4px 8px;
                    border-radius: 999px;
                    border: 1px solid #cbd5e1;
                    cursor: pointer;
                    font-size: 0.8rem;
                    background: #f1f5f9;
                    color: #111827;
                }

                .match-row { transition: background 0.2s; }
                .match-row:hover { background: #f3f4f6 !important; }

                .league-standings-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
                .league-standings-table th, .league-standings-table td {
                    padding: 8px;
                    text-align: center;
                    border-bottom: 1px solid #e5e7eb;
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
                    background: #e5edff;
                    padding: 8px 12px;
                    font-weight: bold;
                    font-size: 0.9em;
                    color: #1d4ed8;
                    border-radius: 999px;
                    margin-top: 14px;
                    margin-bottom: 8px;
                    display: inline-block;
                }

                .league-tab-btn {
                    padding: 8px 15px;
                    border-radius: 999px;
                    border: none;
                    cursor: pointer;
                    font-size: 0.8rem;
                    font-weight: 600;
                }
                .league-tab-btn-active {
                    background: #2563eb;
                    color: white;
                    box-shadow: 0 4px 10px rgba(37, 99, 235, 0.35);
                }
                .league-tab-btn-inactive {
                    background: #e5e7eb;
                    color: #374151;
                }
            </style>
        `;

        listEl       = document.getElementById("league-master-list");
        detailPaneEl = document.getElementById("league-detail-pane");
        
        const addInput = document.getElementById("new-league-input");
        const addBtn   = document.getElementById("add-league-btn");

        const addLeague = () => {
            const name = addInput.value.trim();
            if (!name) return;
            if (leaguesByName[name]) { alert("League exists!"); return; }
            leaguesByName[name] = {
                teams: [],
                sports: [],
                divisions: [],
                standings: {},
                games: [],
                enabled: true
            };
            saveLeaguesData();
            addInput.value = "";
            selectedLeagueName = name;
            renderMasterList();
            renderDetailPane();
        };

        addBtn.onclick = addLeague;
        addInput.onkeyup = (e) => { if(e.key === "Enter") addLeague(); };

        renderMasterList();
        
        if (selectedLeagueName && leaguesByName[selectedLeagueName]) {
            renderDetailPane();
        }
    };

    // ===================================================================
    // MASTER LIST
    // ===================================================================
    function renderMasterList() {
        listEl.innerHTML = "";
        const keys = Object.keys(leaguesByName).sort();
        if (keys.length === 0) {
            listEl.innerHTML = `<p class="muted" style="font-size:0.8rem;">No leagues yet.</p>`;
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

            const main = document.createElement("div");
            main.className = "list-item-main";

            const title = document.createElement("span");
            title.className = "list-item-name";
            title.textContent = name;
            main.appendChild(title);

            const sub = document.createElement("span");
            sub.className = "list-item-sub";
            const teamCount = item.teams?.length || 0;
            const sportCount = item.sports?.length || 0;
            const divCount = item.divisions?.length || 0;
            sub.textContent = `${teamCount} teams • ${sportCount} sports • ${divCount} divisions`;
            main.appendChild(sub);

            el.appendChild(main);

            const right = document.createElement("div");
            right.className = "list-item-right";

            const pill = document.createElement("span");
            pill.className = "pill " + (item.enabled ? "pill-enabled" : "pill-disabled");
            pill.textContent = item.enabled ? "Enabled" : "Disabled";
            right.appendChild(pill);

            const tog = document.createElement("label"); 
            tog.className = "switch";
            tog.onclick = (e) => e.stopPropagation();
            const cb = document.createElement("input"); 
            cb.type = "checkbox"; 
            cb.checked = item.enabled;
            cb.onchange = () => { 
                item.enabled = cb.checked; 
                saveLeaguesData(); 
                renderMasterList();
                renderDetailPane();
            };
            const slider = document.createElement("span");
            slider.className = "slider";
            tog.append(cb, slider);
            right.appendChild(tog);

            el.appendChild(right);
            listEl.appendChild(el);
        });
    }

    // ===================================================================
    // DETAIL PANE
    // ===================================================================
    function renderDetailPane() {
        if (!selectedLeagueName || !leaguesByName[selectedLeagueName]) {
            detailPaneEl.innerHTML = `<p class="muted">Select a league.</p>`;
            return;
        }
        
        const league = leaguesByName[selectedLeagueName];
        detailPaneEl.innerHTML = "";

        // --- Header ---
        const header = document.createElement('div');
        header.style.display = 'flex';
        header.style.justifyContent = 'space-between';
        header.style.alignItems = 'center';
        header.style.marginBottom = '10px';
        header.style.borderBottom = '2px solid #e5e7eb';
        header.style.paddingBottom = '8px';

        // Title + status pill
        const leftHead = document.createElement("div");
        leftHead.style.display = "flex";
        leftHead.style.flexDirection = "column";
        leftHead.style.gap = "4px";

        const title = document.createElement('h2');
        title.style.margin = '0';
        title.style.fontSize = '1.05rem';
        title.textContent = selectedLeagueName;
        title.title = "Double-click to rename";
        makeEditable(title, (newName) => {
            if(newName && !leaguesByName[newName]) {
                leaguesByName[newName] = league;
                delete leaguesByName[selectedLeagueName];
                selectedLeagueName = newName;
                saveLeaguesData();
                renderMasterList();
                renderDetailPane();
            }
        });
        leftHead.appendChild(title);

        const enabledPill = document.createElement("span");
        enabledPill.className = "pill " + (league.enabled ? "pill-enabled" : "pill-disabled");
        enabledPill.textContent = league.enabled ? "Enabled" : "Disabled";
        enabledPill.style.alignSelf = "flex-start";
        leftHead.appendChild(enabledPill);

        header.appendChild(leftHead);

        // Buttons
        const btnGroup = document.createElement('div');
        
        // EDIT CONFIG BUTTON
        const editConfigBtn = document.createElement('button');
        editConfigBtn.textContent = "Edit Configuration";
        editConfigBtn.style.marginRight = "8px";
        editConfigBtn.style.background = "#6b7280";
        editConfigBtn.style.color = "white";
        editConfigBtn.style.border = "none";
        editConfigBtn.style.padding = "6px 12px";
        editConfigBtn.style.borderRadius = "999px";
        editConfigBtn.style.cursor = "pointer";
        editConfigBtn.style.fontSize = "0.8rem";

        // DELETE BUTTON
        const delBtn = document.createElement('button');
        delBtn.textContent = "Delete";
        delBtn.style.background = "#b91c1c";
        delBtn.style.color = "white";
        delBtn.style.border = "none";
        delBtn.style.padding = "6px 12px";
        delBtn.style.borderRadius = "999px";
        delBtn.style.cursor = "pointer";
        delBtn.style.fontSize = "0.8rem";
        delBtn.onclick = () => {
            if(confirm("Delete league?")) {
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

        // --- Status Strip ---
        const statusRow = document.createElement("div");
        statusRow.style.display = "flex";
        statusRow.style.flexWrap = "wrap";
        statusRow.style.gap = "8px";
        statusRow.style.marginBottom = "10px";

        const pillCounts = (label, value) => {
            const p = document.createElement("span");
            p.style.fontSize = "0.75rem";
            p.style.padding = "3px 8px";
            p.style.borderRadius = "999px";
            p.style.background = "#eef2ff";
            p.style.color = "#3730a3";
            p.textContent = `${value} ${label}`;
            return p;
        };
        statusRow.appendChild(pillCounts("Teams",      league.teams?.length || 0));
        statusRow.appendChild(pillCounts("Sports",     league.sports?.length || 0));
        statusRow.appendChild(pillCounts("Divisions",  league.divisions?.length || 0));

        detailPaneEl.appendChild(statusRow);

        // --- Configuration Section (Card, collapsible) ---
        const configCard = document.createElement("div");
        configCard.className = "league-section-card";
        configCard.id = "league-config-ui";
        configCard.style.display = "none";

        const configHeader = document.createElement("div");
        configHeader.className = "league-section-header";
        configHeader.innerHTML = `
            <span class="league-section-title">League Configuration</span>
            <span class="league-section-tag">Divisions • Sports • Teams</span>
        `;
        configCard.appendChild(configHeader);

        renderConfigSections(league, configCard);
        detailPaneEl.appendChild(configCard);

        // Toggle Config Logic
        editConfigBtn.onclick = () => {
            const isHidden = configCard.style.display === "none";
            if (isHidden) {
                configCard.style.display = "block";
                editConfigBtn.textContent = "Close Configuration";
                editConfigBtn.style.background = "#111827"; 
            } else {
                configCard.style.display = "none";
                editConfigBtn.textContent = "Edit Configuration";
                editConfigBtn.style.background = "#6b7280"; 
            }
        };

        // --- Main Content (Standings & Games) ---
        const mainCard = document.createElement("div");
        mainCard.className = "league-section-card";
        const mainHeader = document.createElement("div");
        mainHeader.className = "league-section-header";
        mainHeader.innerHTML = `
            <span class="league-section-title">Standings &amp; Game Results</span>
            <span class="league-section-tag">Live competition view</span>
        `;
        mainCard.appendChild(mainHeader);

        const mainInner = document.createElement("div");
        renderGameResultsUI(league, mainInner);
        mainCard.appendChild(mainInner);

        detailPaneEl.appendChild(mainCard);
    }
    
    function renderConfigSections(league, container) {
        // Clear body, keep the header div
        const header = container.querySelector(".league-section-header");
        container.innerHTML = "";
        if (header) container.appendChild(header);

        // Divisions
        const divSec = document.createElement('div');
        divSec.style.marginTop = "4px";
        divSec.innerHTML = `<strong style="font-size:0.82rem;">Divisions:</strong>`;
        const divChips = document.createElement('div');
        divChips.className = 'chips';
        (window.availableDivisions || []).forEach(divName => {
            const isActive = league.divisions.includes(divName);
            const chip = document.createElement('span');
            chip.className = 'chip';
            chip.textContent = divName;
            chip.style.background = isActive ? '#2563eb' : '#f1f5f9';
            chip.style.color = isActive ? 'white' : '#111827';
            chip.onclick = () => {
                if (isActive) league.divisions = league.divisions.filter(d => d !== divName);
                else league.divisions.push(divName);
                saveLeaguesData();
                renderConfigSections(league, container);
                renderMasterList();
                renderDetailPane();
            };
            divChips.appendChild(chip);
        });
        divSec.appendChild(divChips);
        container.appendChild(divSec);

        // Sports
        const sportSec = document.createElement('div');
        sportSec.style.marginTop = "12px";
        sportSec.innerHTML = `<strong style="font-size:0.82rem;">Sports:</strong>`;
        const sportChips = document.createElement('div');
        sportChips.className = 'chips';
        (window.getAllGlobalSports?.() || []).forEach(act => {
            const isActive = league.sports.includes(act);
            const chip = document.createElement('span');
            chip.className = 'chip';
            chip.textContent = act;
            chip.style.background = isActive ? '#2563eb' : '#f1f5f9';
            chip.style.color = isActive ? 'white' : '#111827';
            chip.onclick = () => {
                if (isActive) league.sports = league.sports.filter(s => s !== act);
                else league.sports.push(act);
                saveLeaguesData();
                renderConfigSections(league, container);
            };
            sportChips.appendChild(chip);
        });
        sportSec.appendChild(sportChips);
        container.appendChild(sportSec);

        // Teams
        const teamSec = document.createElement('div');
        teamSec.style.marginTop = "12px";
        teamSec.innerHTML = `<strong style="font-size:0.82rem;">Teams:</strong>`;
        const teamList = document.createElement('div');
        teamList.className = 'chips';
        league.teams.forEach(team => {
            const chip = document.createElement('span');
            chip.className = 'chip';
            chip.textContent = `${team} ✖`;
            chip.style.background = "#0ea5e9";
            chip.style.color = "white";
            chip.onclick = () => {
                league.teams = league.teams.filter(t => t !== team);
                delete league.standings[team];
                saveLeaguesData();
                renderConfigSections(league, container);
                renderDetailPane();
            };
            teamList.appendChild(chip);
        });
        teamSec.appendChild(teamList);

        const teamInput = document.createElement("input");
        teamInput.placeholder = "Add team (Press Enter)";
        teamInput.style.marginTop = "8px";
        teamInput.onkeyup = (e) => {
            if (e.key === "Enter" && teamInput.value.trim()) {
                const t = teamInput.value.trim();
                if (!league.teams.includes(t)) {
                    league.teams.push(t);
                    league.standings[t] = {w:0, l:0, t:0};
                    saveLeaguesData();
                    teamInput.value = "";
                    renderConfigSections(league, container);
                    renderDetailPane();
                }
            }
        };
        teamSec.appendChild(teamInput);
        container.appendChild(teamSec);
    }


    // ===================================================================
    // GAME RESULTS & STANDINGS LOGIC
    // ===================================================================

    function renderGameResultsUI(league, container) {
        container.innerHTML = "";

        // --- TABS: Standings vs Game Entry ---
        const tabNav = document.createElement("div");
        tabNav.style.marginBottom = "12px";
        tabNav.style.display = "flex";
        tabNav.style.gap = "6px";

        const btnStd = document.createElement("button");
        btnStd.id = "tab-standings";
        btnStd.className = "league-tab-btn league-tab-btn-active";
        btnStd.textContent = "Current Standings";

        const btnGms = document.createElement("button");
        btnGms.id = "tab-games";
        btnGms.className = "league-tab-btn league-tab-btn-inactive";
        btnGms.textContent = "Game Results / History";

        tabNav.appendChild(btnStd);
        tabNav.appendChild(btnGms);
        container.appendChild(tabNav);

        const standingsDiv = document.createElement("div");
        const gamesDiv = document.createElement("div");
        gamesDiv.style.display = "none";

        container.appendChild(standingsDiv);
        container.appendChild(gamesDiv);

        const activateStandings = () => {
            standingsDiv.style.display = "block";
            gamesDiv.style.display = "none";
            btnStd.className = "league-tab-btn league-tab-btn-active";
            btnGms.className = "league-tab-btn league-tab-btn-inactive";
            renderStandingsTable(league, standingsDiv); 
        };

        const activateGames = () => {
            standingsDiv.style.display = "none";
            gamesDiv.style.display = "block";
            btnStd.className = "league-tab-btn league-tab-btn-inactive";
            btnGms.className = "league-tab-btn league-tab-btn-active";
            renderGameEntryUI(league, gamesDiv);
        };

        btnStd.onclick = activateStandings;
        btnGms.onclick = activateGames;

        // Initial Render (Default to Standings)
        activateStandings();
    }

    function renderStandingsTable(league, container) {
        container.innerHTML = "";
        if (!league.teams || league.teams.length === 0) {
            container.innerHTML = '<p class="muted" style="font-size:0.8rem;">No teams to display.</p>';
            return;
        }

        recalcStandings(league);

        const sortedTeams = [...league.teams].sort((a, b) => {
            const sA = league.standings[a] || {w:0, l:0, t:0};
            const sB = league.standings[b] || {w:0, l:0, t:0};
            if (sA.w !== sB.w) return sB.w - sA.w;
            if (sA.l !== sB.l) return sA.l - sB.l;
            if (sA.t !== sB.t) return sB.t - sA.t;
            return a.localeCompare(b);
        });

        let html = `
            <table class="league-standings-table">
            <thead><tr><th>Place</th><th>Team</th><th>W</th><th>L</th><th>T</th></tr></thead>
            <tbody>
        `;

        sortedTeams.forEach((team, idx) => {
            const stats = league.standings[team] || {w:0,l:0,t:0};
            html += `<tr>
                <td>${idx + 1}${getPlaceSuffix(idx+1)}</td>
                <td>${team}</td>
                <td>${stats.w}</td>
                <td>${stats.l}</td>
                <td>${stats.t}</td>
            </tr>`;
        });
        html += `</tbody></table>`;
        container.innerHTML = html;
    }

    function renderGameEntryUI(league, container) {
        container.innerHTML = "";

        // 1. Game Selection + Import
        const controls = document.createElement("div");
        controls.style.marginBottom = "12px";
        controls.style.display = "flex";
        controls.style.gap = "10px";
        controls.style.alignItems = "center";
        controls.style.flexWrap = "wrap";

        const select = document.createElement("select");
        select.style.minWidth = "220px";
        select.innerHTML = `<option value="new">-- Enter New Game Results --</option>`;

        (league.games || []).forEach((g, idx) => {
            const label = g.name || `Game ${idx + 1}`;
            select.innerHTML += `<option value="${idx}">${label} (${g.date})</option>`;
        });

        controls.appendChild(select);

        const importBtn = document.createElement("button");
        importBtn.textContent = "Import from Today's Schedule";
        importBtn.style.padding = "6px 12px";
        importBtn.style.background = "#2563eb";
        importBtn.style.color = "white";
        importBtn.style.border = "none";
        importBtn.style.borderRadius = "999px";
        importBtn.style.cursor = "pointer";
        importBtn.style.fontSize = "0.8rem";

        const matchContainer = document.createElement("div");
        matchContainer.style.maxHeight = "400px";
        matchContainer.style.overflowY = "auto";
        matchContainer.style.marginTop = "4px";
        
        const saveBtn = document.createElement("button");
        saveBtn.textContent = "Save Game Results";
        saveBtn.style.marginTop = "10px";
        saveBtn.style.background = "#16a34a";
        saveBtn.style.color = "white";
        saveBtn.style.border = "none";
        saveBtn.style.padding = "8px 16px";
        saveBtn.style.borderRadius = "999px";
        saveBtn.style.cursor = "pointer";
        saveBtn.style.fontSize = "0.8rem";
        saveBtn.style.display = "none"; 
        saveBtn.onclick = () => saveGameResults(league, select.value, matchContainer);

        importBtn.onclick = () => importGamesFromSchedule(league, matchContainer, saveBtn);

        controls.appendChild(importBtn);
        container.appendChild(controls);
        container.appendChild(matchContainer);
        container.appendChild(saveBtn);

        // Dropdown Change
        select.onchange = () => {
            matchContainer.innerHTML = "";
            if (select.value === "new") {
                importBtn.style.display = "inline-block";
                saveBtn.style.display = "none";
            } else {
                importBtn.style.display = "none";
                saveBtn.style.display = "inline-block"; 
                loadExistingGame(league, select.value, matchContainer, saveBtn);
            }
        };

        // Helper: Load Existing Game
        function loadExistingGame(league, gameIdx, target, saveButton) {
            const game = league.games[gameIdx];
            if (!game) return;

            const groupedMatches = {};
            game.matches.forEach(m => {
                const label = m.timeLabel || "Matchups";
                if(!groupedMatches[label]) groupedMatches[label] = [];
                groupedMatches[label].push(m);
            });

            Object.keys(groupedMatches).sort().forEach(label => {
                const header = document.createElement("div");
                header.className = "group-header";
                header.textContent = label;
                target.appendChild(header);

                groupedMatches[label].forEach(m => {
                    addMatchRow(target, m.teamA, m.teamB, m.scoreA, m.scoreB, saveButton, label);
                });
            });
        }
    }

    function addMatchRow(target, teamA, teamB, scoreA = "", scoreB = "", saveButton, timeLabel = "") {
        const row = document.createElement("div");
        row.className = "match-row"; 
        row.style.display = "flex";
        row.style.alignItems = "center";
        row.style.gap = "10px";
        row.style.marginBottom = "8px";
        row.style.padding = "8px";
        row.style.background = "#f9fafb";
        row.style.border = "1px solid #e5e7eb";
        row.style.borderRadius = "8px";

        row.innerHTML = `
            <strong style="min-width:100px; text-align:right;">${teamA}</strong>
            <input type="number" class="score-a" value="${scoreA}" style="width:50px; padding:5px;">
            <span>vs</span>
            <input type="number" class="score-b" value="${scoreB}" style="width:50px; padding:5px;">
            <strong style="min-width:100px;">${teamB}</strong>
        `;

        row.dataset.teamA = teamA;
        row.dataset.teamB = teamB;
        if(timeLabel) row.dataset.timeLabel = timeLabel;

        target.appendChild(row);
        if(saveButton) saveButton.style.display = "inline-block";
    }

    function importGamesFromSchedule(league, target) {
    target.innerHTML = "";

    const daily = window.loadCurrentDailyData?.() || {};
    const assignments = daily.scheduleAssignments || {};

    const foundMatches = new Set();      // to avoid duplicate pairings
    const groupedMatches = {};           // { gameLabel: [ {t1,t2}, ... ] }

    // Try to locate the green "Save Game Results" button (same trick as before)
    const saveButton =
        target.parentElement.querySelector("button[style*='background: #28a745']") ||
        target.parentElement.querySelector("button[style*='background: rgb(40, 167, 69)']") ||
        target.parentElement.lastElementChild;

    // Helper: pull out "League Game X" if it exists in a string
    function extractLeagueLabelFrom(str) {
        if (!str) return null;
        const s = String(str);

        // Direct: "League Game 6"
        let m = s.match(/League Game\s*\d+/i);
        if (m) return m[0].trim();

        // Inside parentheses: "Something (League Game 6)"
        const paren = s.match(/\((.*?)\)/);
        if (paren) {
            const inner = paren[1];
            m = inner.match(/League Game\s*\d+/i);
            if (m) return m[0].trim();
        }

        return null;
    }

    // ==============================
    // 1. Scan TODAY'S schedule only
    // ==============================
    Object.keys(assignments).forEach(key => {
        const schedule = assignments[key] || [];

        schedule.forEach((entry) => {
            if (!entry || entry.continuation) return;

            const sportStr = typeof entry.sport === "string" ? entry.sport : "";

            // Treat as head-to-head if:
            //  - core marked it as _h2h
            //  - OR the sport string clearly has "Team A vs Team B"
            const isH2H =
                entry._h2h ||
                / vs /i.test(sportStr);

            if (!isH2H) return;

            // Parse "Team A vs Team B (Something…"
            const match = sportStr.match(/^(.*?)\s+vs\s+(.*?)\s*\(/i);
            if (!match) return;

            const t1 = match[1].trim();
            const t2 = match[2].trim();

            // Only keep pairings where both teams belong to THIS league
            if (!league.teams.includes(t1) || !league.teams.includes(t2)) return;

            // Figure out the label from the schedule (NOT standings)
            // We scan several properties, in priority order:
            const rawLabelCandidate =
                (typeof entry._activity === "string" && entry._activity) ||
                (typeof entry.event === "string"    && entry.event)    ||
                (typeof entry.field === "string"    && entry.field)    ||
                sportStr ||
                "";

            let gameLabel = extractLeagueLabelFrom(rawLabelCandidate);

            // If we *still* don't see "League Game X", fall back to a generic label.
            // We do NOT try to guess a number from standings/history anymore.
            if (!gameLabel) {
                gameLabel = "League Game";  // no number, pure schedule-based import
            }

            const groupKey = gameLabel;
            if (!groupedMatches[groupKey]) groupedMatches[groupKey] = [];

            const uniqueKey = [t1, t2].sort().join(" vs ") + "::" + groupKey;
            if (foundMatches.has(uniqueKey)) return;
            foundMatches.add(uniqueKey);

            groupedMatches[groupKey].push({ t1, t2 });
        });
    });

    const gameLabels = Object.keys(groupedMatches);
    if (gameLabels.length === 0) {
        target.innerHTML = "<p class='muted' style='font-size:0.8rem;'>No scheduled games found for today.</p>";
        return;
    }

    // Sort labels by game number when possible ("League Game 6" < "League Game 7")
    function gameNum(label) {
        const m = label.match(/(\d+)/);
        return m ? parseInt(m[1], 10) : Number.POSITIVE_INFINITY;
    }
    gameLabels.sort((a, b) => {
        const na = gameNum(a);
        const nb = gameNum(b);
        if (na !== nb) return na - nb;
        return a.localeCompare(b);
    });

    // ==============================
    // 2. Render everything we found
    // ==============================
    gameLabels.forEach(label => {
        const header = document.createElement("div");
        header.className = "group-header";
        header.textContent = label;  // e.g. "League Game 6"
        target.appendChild(header);

        groupedMatches[label].forEach(m => {
            addMatchRow(target, m.t1, m.t2, "", "", saveButton, label);
        });
    });

    if (saveButton) {
        saveButton.style.display = "inline-block";
    }
}

    function saveGameResults(league, gameId, container) {
        const rows = container.querySelectorAll(".match-row");
        const results = [];

        rows.forEach(row => {
            const tA = row.dataset.teamA;
            const tB = row.dataset.teamB;
            const tLabel = row.dataset.timeLabel || ""; 
            const sA = parseInt(row.querySelector(".score-a").value) || 0;
            const sB = parseInt(row.querySelector(".score-b").value) || 0;

            let winner = null;
            if (sA > sB) winner = tA;
            else if (sB > sA) winner = tB;
            else winner = "tie";

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

        if (gameId === "new") {
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
        alert("Results saved and standings updated!");
        renderDetailPane(); 
    }

    function recalcStandings(league) {
        league.teams.forEach(t => {
            league.standings[t] = { w: 0, l: 0, t: 0 };
        });

        league.games.forEach(g => {
            g.matches.forEach(m => {
                if (m.winner === "tie") {
                    if(league.standings[m.teamA]) league.standings[m.teamA].t++;
                    if(league.standings[m.teamB]) league.standings[m.teamB].t++;
                } else if (m.winner) {
                    if(league.standings[m.winner]) league.standings[m.winner].w++;
                    const loser = (m.winner === m.teamA) ? m.teamB : m.teamA;
                    if(league.standings[loser]) league.standings[loser].l++;
                }
            });
        });
    }

    // Initial load at file eval time (for safety)
    loadLeaguesData();
    loadRoundState();

})();
