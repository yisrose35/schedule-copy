// ============================================================================
// specialty_leagues.js (THEMED VERSION)
// Modern Pro Camp Theme — Matches Fields / Special Activities / Leagues
// ----------------------------------------------------------------------------
// NO LOGIC CHANGES. 100% VISUAL + LAYOUT UPGRADE.
// ----------------------------------------------------------------------------
// Uses:
//  - setup-grid / setup-card / setup-subtitle
//  - master-list unified styling
//  - detail-pane unified card
//  - blue chips / toggles / buttons
//  - makeEditable for rename
//  - Renders into:  #specialty-leagues
// ============================================================================

(function () {
    'use strict';

    // ================================================================
    // STATE
    // ================================================================
    let specialtyLeagues = {};
    let activeLeagueId = null;
    let activeTab = null; // "standings" or "games"

    let listEl = null;
    let detailPaneEl = null;

    // ================================================================
    // LOAD + SAVE
    // ================================================================
    function loadData() {
        const g = window.loadGlobalSettings?.() || {};
        specialtyLeagues = g.specialtyLeagues || {};
    }

    function saveData() {
        window.saveGlobalSettings?.("specialtyLeagues", specialtyLeagues);
    }

    function uid() {
        return "sl_" + Math.random().toString(36).substring(2, 8);
    }

    // ================================================================
    // INLINE EDIT — UNIFIED
    // ================================================================
    function makeEditable(el, save) {
        el.ondblclick = () => {
            const old = el.textContent;
            const input = document.createElement("input");
            input.type = "text";
            input.value = old;

            input.style.padding = "4px 6px";
            input.style.fontSize = "0.95rem";

            el.replaceWith(input);
            input.focus();

            function done() {
                const newVal = input.value.trim();
                if (newVal && newVal !== old) save(newVal);
                el.textContent = newVal || old;
                input.replaceWith(el);
            }

            input.onblur = done;
            input.onkeyup = (ev) => ev.key === "Enter" && done();
        };
    }

    // ================================================================
    // INIT TAB
    // ================================================================
    window.initSpecialtyLeagues = function () {
        const container = document.getElementById("specialty-leagues");
        if (!container) return;

        loadData();

        container.innerHTML = `
            <div class="setup-grid">

                <!-- FULL WIDTH CARD -->
                <section class="setup-card setup-card-wide">
                    <div class="setup-card-header">
                        <div class="setup-step-pill">Specialty Leagues</div>
                        <div class="setup-card-text">
                            <h3>Manage Specialty Leagues</h3>
                            <p>Create leagues with specific sports, fields, and teams.</p>
                        </div>
                    </div>

                    <div style="display:flex; flex-wrap:wrap; gap:20px; margin-top:15px;">

                        <!-- LEFT COLUMN -->
                        <div style="flex:1; min-width:260px;">
                            <div class="setup-subtitle">Add New Specialty League</div>

                            <div class="setup-field-row" style="margin-top:10px;">
                                <input id="sl-add-input" placeholder="League Name…">
                                <button id="sl-add-btn">Add</button>
                            </div>

                            <div class="setup-subtitle" style="margin-top:20px;">All Specialty Leagues</div>
                            <div id="sl-master-list" class="master-list"
                                 style="max-height:440px; overflow:auto; margin-top:10px;"></div>
                        </div>

                        <!-- RIGHT COLUMN -->
                        <div style="flex:1.5; min-width:320px;">
                            <div class="setup-subtitle">League Details</div>
                            <div id="sl-detail-pane" class="detail-pane" style="margin-top:10px;">
                                <p class="muted">Select a specialty league to edit its details.</p>
                            </div>
                        </div>

                    </div>
                </section>

            </div>

            <style>
                /* master-list + list-item already themed globally */

                /* Chip styling (unified with Leagues) */
                .sl-chip {
                    padding: 4px 10px;
                    border-radius: 999px;
                    border: 1px solid #D1D5DB;
                    font-size: 0.85rem;
                    cursor: pointer;
                    user-select: none;
                    transition: 0.15s;
                }
                .sl-chip.active {
                    background:#2563EB;
                    color:white;
                    border-color:#2563EB;
                }

                /* Tab buttons (standings / games) */
                .sl-tab-btn {
                    padding: 8px 14px;
                    border-radius: 999px;
                    border:none;
                    cursor:pointer;
                    font-size:0.9rem;
                    transition:0.15s;
                }
                .sl-tab-btn.active {
                    background:#2563EB;
                    color:white;
                }
                .sl-tab-btn.inactive {
                    background:#E5E7EB;
                    color:#111827;
                }

                /* Match rows (games) */
                .sl-match-row {
                    display:flex;
                    align-items:center;
                    gap:10px;
                    padding:8px;
                    margin-bottom:8px;
                    background:#F9FAFB;
                    border:1px solid #E5E7EB;
                    border-radius:8px;
                }
            </style>
        `;

        listEl = document.getElementById("sl-master-list");
        detailPaneEl = document.getElementById("sl-detail-pane");

        const addInput = document.getElementById("sl-add-input");
        const addBtn = document.getElementById("sl-add-btn");

        function addLeague() {
            const name = addInput.value.trim();
            if (!name) return;

            const id = uid();
            specialtyLeagues[id] = {
                id,
                name,
                divisions: [],
                sport: null,
                fields: [],
                teams: [],
                enabled: true,
                standings: {},
                games: []
            };
            saveData();

            activeLeagueId = id;
            addInput.value = "";
            renderMasterList();
            renderDetailPane();
        }

        addBtn.onclick = addLeague;
        addInput.onkeyup = (e) => e.key === "Enter" && addLeague();

        renderMasterList();
        if (activeLeagueId && specialtyLeagues[activeLeagueId]) renderDetailPane();
    };

    // ================================================================
    // MASTER LIST (LEFT)
    // ================================================================
    function renderMasterList() {
        listEl.innerHTML = "";

        const entries = Object.values(specialtyLeagues).sort((a, b) =>
            a.name.localeCompare(b.name)
        );

        if (entries.length === 0) {
            listEl.innerHTML = `<p class="muted">No specialty leagues created yet.</p>`;
            return;
        }

        entries.forEach((l) => {
            const el = document.createElement("div");
            el.className = "list-item";
            if (l.id === activeLeagueId) el.classList.add("selected");

            el.onclick = () => {
                activeLeagueId = l.id;
                renderMasterList();
                renderDetailPane();
            };

            const nameEl = document.createElement("span");
            nameEl.className = "list-item-name";
            nameEl.textContent = l.name;
            el.appendChild(nameEl);

            const tog = document.createElement("label");
            tog.className = "switch list-item-toggle";
            tog.onclick = (e) => e.stopPropagation();

            const cb = document.createElement("input");
            cb.type = "checkbox";
            cb.checked = l.enabled;
            cb.onchange = () => {
                l.enabled = cb.checked;
                saveData();
            };

            const slider = document.createElement("span");
            slider.className = "slider";

            tog.append(cb, slider);
            el.appendChild(tog);

            listEl.appendChild(el);
        });
    }

    // ================================================================
    // DETAIL PANE (RIGHT)
    // ================================================================
    function renderDetailPane() {
        if (!activeLeagueId || !specialtyLeagues[activeLeagueId]) {
            detailPaneEl.innerHTML = `<p class="muted">Select a league from the list.</p>`;
            return;
        }

        const league = specialtyLeagues[activeLeagueId];
        detailPaneEl.innerHTML = "";

        // HEADER
        const header = document.createElement("div");
        header.style.display = "flex";
        header.style.justifyContent = "space-between";
        header.style.borderBottom = "2px solid #E5E7EB";
        header.style.marginBottom = "15px";
        header.style.paddingBottom = "10px";

        const title = document.createElement("h3");
        title.textContent = league.name;
        title.style.margin = "0";
        title.style.fontWeight = "600";
        title.title = "Double-click to rename";

        makeEditable(title, (newName) => {
            league.name = newName;
            saveData();
            renderMasterList();
        });

        const btnGroup = document.createElement("div");

        const standingsBtn = document.createElement("button");
        standingsBtn.textContent = "Standings / Games";
        standingsBtn.style.background = "#2563EB";
        standingsBtn.style.color = "white";
        standingsBtn.style.border = "none";
        standingsBtn.style.padding = "6px 14px";
        standingsBtn.style.borderRadius = "999px";
        standingsBtn.style.cursor = "pointer";
        standingsBtn.style.marginRight = "10px";

        const delBtn = document.createElement("button");
        delBtn.textContent = "Delete";
        delBtn.style.background = "#DC2626";
        delBtn.style.color = "white";
        delBtn.style.border = "none";
        delBtn.style.padding = "6px 14px";
        delBtn.style.borderRadius = "999px";
        delBtn.style.cursor = "pointer";

        delBtn.onclick = () => {
            if (confirm("Delete this specialty league?")) {
                delete specialtyLeagues[activeLeagueId];
                activeLeagueId = null;
                saveData();
                renderMasterList();
                renderDetailPane();
            }
        };

        btnGroup.appendChild(standingsBtn);
        btnGroup.appendChild(delBtn);
        header.appendChild(title);
        header.appendChild(btnGroup);

        detailPaneEl.appendChild(header);

        // ============================================================
        // STANDINGS BOX (TOGGLED)
        // ============================================================
        const standingsBox = document.createElement("div");
        standingsBox.style.display = activeTab === "standings" ? "block" : "none";
        standingsBox.style.marginBottom = "20px";
        standingsBox.style.padding = "15px";
        standingsBox.style.border = "1px solid #E5E7EB";
        standingsBox.style.borderRadius = "12px";
        standingsBox.style.background = "#FFFFFF";

        detailPaneEl.appendChild(standingsBox);

        standingsBtn.onclick = () => {
            activeTab = activeTab === "standings" ? null : "standings";
            renderDetailPane();
            if (activeTab === "standings") renderStandingsUI(league, standingsBox);
        };

        if (activeTab === "standings") renderStandingsUI(league, standingsBox);

        // ============================================================
        // DIVISIONS
        // ============================================================
        const divSec = document.createElement("div");
        divSec.innerHTML = `<strong>Divisions:</strong>`;

        const divChips = document.createElement("div");
        divChips.style.display = "flex";
        divChips.style.flexWrap = "wrap";
        divChips.style.gap = "6px";
        divChips.style.marginTop = "6px";

        (window.availableDivisions || []).forEach((d) => {
            const active = league.divisions.includes(d);

            const chip = document.createElement("span");
            chip.className = "sl-chip" + (active ? " active" : "");
            chip.textContent = d;

            chip.onclick = () => {
                if (active)
                    league.divisions = league.divisions.filter((x) => x !== d);
                else league.divisions.push(d);
                saveData();
                renderDetailPane();
            };

            divChips.appendChild(chip);
        });

        divSec.appendChild(divChips);
        detailPaneEl.appendChild(divSec);

        // ============================================================
        // SPORT
        // ============================================================
        const sportSec = document.createElement("div");
        sportSec.style.marginTop = "20px";
        sportSec.innerHTML = `<strong>Sport:</strong>`;

        const sportSelect = document.createElement("select");
        sportSelect.style.marginTop = "6px";
        sportSelect.style.padding = "6px";
        sportSelect.style.borderRadius = "8px";
        sportSelect.style.border = "1px solid #D1D5DB";

        sportSelect.innerHTML = `<option value="">-- Select --</option>`;

        (window.getAllGlobalSports?.() || []).forEach((s) => {
            const opt = document.createElement("option");
            opt.value = s;
            opt.textContent = s;
            if (league.sport === s) opt.selected = true;
            sportSelect.appendChild(opt);
        });

        sportSelect.onchange = () => {
            league.sport = sportSelect.value || null;
            league.fields = [];
            saveData();
            renderDetailPane();
        };

        sportSec.appendChild(sportSelect);
        detailPaneEl.appendChild(sportSec);

        // ============================================================
        // FIELDS (only after selecting sport)
        // ============================================================
        if (league.sport) {
            const fieldSec = document.createElement("div");
            fieldSec.style.marginTop = "20px";
            fieldSec.innerHTML = `<strong>Fields for ${league.sport}:</strong>`;

            const fieldChips = document.createElement("div");
            fieldChips.style.display = "flex";
            fieldChips.style.flexWrap = "wrap";
            fieldChips.style.gap = "6px";
            fieldChips.style.marginTop = "6px";

            const allFields = window.loadGlobalSettings?.().app1.fields || [];
            const matches = allFields.filter(
                (f) => f.activities && f.activities.includes(league.sport)
            );

            if (matches.length === 0) {
                fieldChips.innerHTML = `<span class="muted">No fields support this sport.</span>`;
            } else {
                matches.forEach((f) => {
                    const isActive = league.fields.includes(f.name);

                    const chip = document.createElement("span");
                    chip.className = "sl-chip" + (isActive ? " active" : "");
                    chip.textContent = f.name;

                    chip.onclick = () => {
                        if (isActive)
                            league.fields = league.fields.filter((x) => x !== f.name);
                        else league.fields.push(f.name);
                        saveData();
                        renderDetailPane();
                    };

                    fieldChips.appendChild(chip);
                });
            }

            fieldSec.appendChild(fieldChips);
            detailPaneEl.appendChild(fieldSec);
        }

        // ============================================================
        // TEAMS
        // ============================================================
        const teamSec = document.createElement("div");
        teamSec.style.marginTop = "20px";
        teamSec.innerHTML = `<strong>Teams:</strong>`;

        const teamChips = document.createElement("div");
        teamChips.style.display = "flex";
        teamChips.style.flexWrap = "wrap";
        teamChips.style.gap = "6px";
        teamChips.style.marginTop = "6px";

        league.teams.forEach((team) => {
            const chip = document.createElement("span");
            chip.className = "sl-chip active";
            chip.textContent = team + " ✖";

            chip.onclick = () => {
                league.teams = league.teams.filter((t) => t !== team);
                delete league.standings[team];
                saveData();
                renderDetailPane();
            };

            teamChips.appendChild(chip);
        });

        teamSec.appendChild(teamChips);

        const addTeam = document.createElement("input");
        addTeam.placeholder = "Add team (Enter)";
        addTeam.style.marginTop = "10px";
        addTeam.style.padding = "6px 8px";
        addTeam.style.borderRadius = "8px";
        addTeam.style.border = "1px solid #D1D5DB";
        addTeam.style.width = "180px";

        addTeam.onkeyup = (e) => {
            if (e.key !== "Enter") return;
            const t = addTeam.value.trim();
            if (!t) return;
            if (!league.teams.includes(t)) {
                league.teams.push(t);
                league.standings[t] = { w: 0, l: 0, t: 0 };
                saveData();
            }
            addTeam.value = "";
            renderDetailPane();
        };

        teamSec.appendChild(addTeam);
        detailPaneEl.appendChild(teamSec);
    }

    // ================================================================
    // STANDINGS & GAMES UI
    // ================================================================
    function renderStandingsUI(league, box) {
        box.innerHTML = "";

        // TAB BUTTONS
        const tabRow = document.createElement("div");
        tabRow.style.marginBottom = "15px";

        const btnStd = document.createElement("button");
        btnStd.className = "sl-tab-btn " + (activeTab === "standings" ? "active" : "inactive");
        btnStd.textContent = "Standings";

        const btnGames = document.createElement("button");
        btnGames.className = "sl-tab-btn " + (activeTab === "games" ? "active" : "inactive");
        btnGames.textContent = "Games";

        tabRow.append(btnStd, btnGames);
        box.appendChild(tabRow);

        const content = document.createElement("div");
        box.appendChild(content);

        function showStandings() {
            activeTab = "standings";
            renderDetailPane(); // rebuild UI
        }

        function showGames() {
            activeTab = "games";
            renderDetailPane();
        }

        btnStd.onclick = showStandings;
        btnGames.onclick = showGames;

        if (activeTab === "standings") {
            content.innerHTML = renderStandingsTable(league);
        } else {
            renderGamesEditor(league, content);
        }
    }

    function renderStandingsTable(league) {
        league.teams.forEach((t) => {
            league.standings[t] = { w: 0, l: 0, t: 0 };
        });

        (league.games || []).forEach((g) => {
            g.matches.forEach((m) => {
                if (m.winner === "tie") {
                    league.standings[m.teamA].t++;
                    league.standings[m.teamB].t++;
                } else {
                    league.standings[m.winner].w++;
                    const lose = m.winner === m.teamA ? m.teamB : m.teamA;
                    league.standings[lose].l++;
                }
            });
        });

        const sorted = [...league.teams].sort(
            (a, b) => league.standings[b].w - league.standings[a].w
        );

        let html = `
            <table style="width:100%; border-collapse:collapse;">
                <thead>
                    <tr style="background:#F3F4F6">
                        <th style="text-align:left; padding:8px;">Team</th>
                        <th style="text-align:center;">W</th>
                        <th style="text-align:center;">L</th>
                        <th style="text-align:center;">T</th>
                    </tr>
                </thead>
                <tbody>
        `;

        sorted.forEach((t) => {
            const s = league.standings[t];
            html += `
                <tr>
                    <td style="padding:8px; border-bottom:1px solid #E5E7EB;">${t}</td>
                    <td style="text-align:center;">${s.w}</td>
                    <td style="text-align:center;">${s.l}</td>
                    <td style="text-align:center;">${s.t}</td>
                </tr>
            `;
        });

        html += "</tbody></table>";
        return html;
    }

    function renderGamesEditor(league, wrapper) {
        wrapper.innerHTML = "";

        const info = document.createElement("div");
        info.textContent = "Game entry system for specialty leagues coming soon.";
        info.style.color = "#6B7280";
        info.style.fontSize = "0.9rem";
        wrapper.appendChild(info);
    }

})();
