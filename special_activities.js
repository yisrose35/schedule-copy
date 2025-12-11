// ============================================================================
// specialty_leagues.js — COMPLETE SPECIALTY LEAGUES SYSTEM
// ============================================================================
// Features:
// - Single sport per league with multiple games per field per time slot
// - Conference system (East/West) with intra-conference priority
// - Field selection with push-button override (ignores field restrictions)
// - TWO FAIRNESS ALGORITHMS:
//   1. Wait Priority: Teams that played 2nd/3rd yesterday play 1st today
//   2. Field Rotation: Teams must play on all courts before repeating
// - Import matchups & enter scores for automatic standings
// ============================================================================

(function() {
'use strict';

// =============================================================
// STATE
// =============================================================
let specialtyLeagues = {};
let activeLeagueId = null;
let activeTab = "config"; // "config" | "teams" | "schedule" | "results" | "standings"

// DOM refs
let listEl = null;
let detailPaneEl = null;

// =============================================================
// LOAD + SAVE
// =============================================================
function loadData() {
    const g = window.loadGlobalSettings?.() || {};
    specialtyLeagues = g.specialtyLeagues || {};
    
    // Ensure all leagues have required properties
    Object.values(specialtyLeagues).forEach(league => {
        league.conferences = league.conferences || {};
        league.teamFieldRotation = league.teamFieldRotation || {};
        league.lastSlotOrder = league.lastSlotOrder || {};
        league.gamesPerFieldSlot = league.gamesPerFieldSlot || 3;
        league.gameLength = league.gameLength || 20;
        league.allowInterConference = league.allowInterConference || false;
        league.interConferencePriority = league.interConferencePriority || 0.3;
        league.currentRound = league.currentRound || 0;
        league.conferenceRounds = league.conferenceRounds || {};
    });
}

function saveData() {
    window.saveGlobalSettings?.("specialtyLeagues", specialtyLeagues);
}

function uid() {
    return "sl_" + Math.random().toString(36).substring(2, 10);
}

// =============================================================
// HELPER: Get all sports from fields.js
// =============================================================
function getAllSportsFromFields() {
    const global = window.loadGlobalSettings?.() || {};
    const fields = global.app1?.fields || [];
    const sports = new Set();
    
    fields.forEach(f => {
        (f.activities || []).forEach(act => sports.add(act));
    });
    
    return [...sports].sort();
}

// =============================================================
// HELPER: Get fields that support a specific sport
// =============================================================
function getFieldsForSport(sportName) {
    const global = window.loadGlobalSettings?.() || {};
    const fields = global.app1?.fields || [];
    
    return fields
        .filter(f => (f.activities || []).includes(sportName))
        .map(f => f.name)
        .sort();
}

// =============================================================
// EDITABLE LABEL
// =============================================================
function makeEditable(el, save) {
    el.ondblclick = () => {
        const old = el.textContent;
        const input = document.createElement("input");
        input.type = "text";
        input.value = old;
        input.style.cssText = "padding:4px 6px; font-size:inherit; font-weight:inherit; border:2px solid #00C896; border-radius:4px; outline:none;";

        el.replaceWith(input);
        input.focus();
        input.select();

        function done() {
            const val = input.value.trim();
            if (val && val !== old) save(val);
            el.textContent = val || old;
            input.replaceWith(el);
        }

        input.onblur = done;
        input.onkeyup = ev => ev.key === "Enter" && done();
    };
}

// =============================================================
// FAIRNESS ALGORITHM: Wait Priority Score
// =============================================================
// Teams that played 2nd or 3rd in their slot get HIGHER priority to play first
function getWaitPriorityScore(teamA, teamB, lastSlotOrder) {
    const slotA = lastSlotOrder[teamA] || 1;
    const slotB = lastSlotOrder[teamB] || 1;
    
    // Higher slot order = waited longer = higher priority
    // Slot 3 (waited most) = 100 points, Slot 2 = 50 points, Slot 1 = 0 points
    const scoreA = (slotA - 1) * 50;
    const scoreB = (slotB - 1) * 50;
    
    return scoreA + scoreB;
}

// =============================================================
// FAIRNESS ALGORITHM: Field Rotation Score
// =============================================================
// Teams should play on all courts before repeating any court
function getFieldRotationScore(teamA, teamB, fieldName, teamFieldRotation, allFields) {
    const fieldsA = teamFieldRotation[teamA] || [];
    const fieldsB = teamFieldRotation[teamB] || [];
    
    // Count how many times each team has played on this field
    const countA = fieldsA.filter(f => f === fieldName).length;
    const countB = fieldsB.filter(f => f === fieldName).length;
    
    // If neither team has played on this field, big bonus
    if (countA === 0 && countB === 0) return 200;
    
    // If one team hasn't played on this field, medium bonus
    if (countA === 0 || countB === 0) return 100;
    
    // Check if both teams have played on all fields at least once
    const allFieldsSet = new Set(allFields);
    const uniqueA = new Set(fieldsA);
    const uniqueB = new Set(fieldsB);
    
    const missingA = [...allFieldsSet].filter(f => !uniqueA.has(f));
    const missingB = [...allFieldsSet].filter(f => !uniqueB.has(f));
    
    // Penalty if this field is being repeated before all fields are used
    if (missingA.length > 0 || missingB.length > 0) {
        return -100 * (countA + countB);
    }
    
    // Small penalty for repetition
    return -10 * (countA + countB);
}

// =============================================================
// ROUND ROBIN GENERATOR (within conference)
// =============================================================
function generateConferenceRoundRobin(teams) {
    if (teams.length < 2) return [];
    
    const rounds = [];
    const n = teams.length;
    const teamsCopy = [...teams];
    
    // Add dummy if odd number
    if (n % 2 === 1) {
        teamsCopy.push(null); // bye
    }
    
    const numRounds = teamsCopy.length - 1;
    const half = teamsCopy.length / 2;
    
    for (let round = 0; round < numRounds; round++) {
        const matches = [];
        
        for (let i = 0; i < half; i++) {
            const team1 = teamsCopy[i];
            const team2 = teamsCopy[teamsCopy.length - 1 - i];
            
            if (team1 && team2) {
                matches.push({ teamA: team1, teamB: team2 });
            }
        }
        
        rounds.push(matches);
        
        // Rotate teams (keep first team fixed)
        const last = teamsCopy.pop();
        teamsCopy.splice(1, 0, last);
    }
    
    return rounds;
}

// =============================================================
// SCHEDULE GENERATOR WITH FAIRNESS
// =============================================================
function generateDaySchedule(league) {
    const { teams, conferences, fields, gamesPerFieldSlot, teamFieldRotation, lastSlotOrder, allowInterConference, interConferencePriority } = league;
    
    if (!teams || teams.length < 2) return null;
    if (!fields || fields.length === 0) return null;
    
    const totalSlotsAvailable = fields.length * gamesPerFieldSlot;
    
    // Get matchups for today
    let matchups = [];
    
    // Check if we have conferences
    const conferenceNames = Object.keys(conferences).filter(c => conferences[c]?.length > 0);
    
    if (conferenceNames.length > 0) {
        // Generate intra-conference matchups
        conferenceNames.forEach(confName => {
            const confTeams = conferences[confName] || [];
            const roundRobin = generateConferenceRoundRobin(confTeams);
            
            // Get current round for this conference
            const currentRound = (league.conferenceRounds?.[confName] || 0) % roundRobin.length;
            
            if (roundRobin[currentRound]) {
                matchups.push(...roundRobin[currentRound].map(m => ({
                    ...m,
                    conference: confName,
                    isInterConference: false
                })));
            }
        });
        
        // Optionally add inter-conference matchups
        if (allowInterConference && conferenceNames.length >= 2) {
            const conf1Teams = conferences[conferenceNames[0]] || [];
            const conf2Teams = conferences[conferenceNames[1]] || [];
            
            // Simple inter-conference round robin based on current round
            const interRound = (league.interConferenceRound || 0) % Math.max(conf1Teams.length, conf2Teams.length);
            
            conf1Teams.forEach((team1, idx) => {
                const team2Idx = (idx + interRound) % conf2Teams.length;
                const team2 = conf2Teams[team2Idx];
                
                if (team1 && team2) {
                    // Only add based on priority chance
                    if (Math.random() < interConferencePriority) {
                        matchups.push({
                            teamA: team1,
                            teamB: team2,
                            conference: "Inter-Conference",
                            isInterConference: true
                        });
                    }
                }
            });
        }
    } else {
        // No conferences - use all teams
        const roundRobin = generateConferenceRoundRobin(teams);
        const currentRound = (league.currentRound || 0) % roundRobin.length;
        
        if (roundRobin[currentRound]) {
            matchups = roundRobin[currentRound].map(m => ({
                ...m,
                conference: null,
                isInterConference: false
            }));
        }
    }
    
    // Limit matchups to available slots
    if (matchups.length > totalSlotsAvailable) {
        // Score each matchup by wait priority (HIGHEST priority)
        matchups = matchups.map(m => ({
            ...m,
            waitScore: getWaitPriorityScore(m.teamA, m.teamB, lastSlotOrder)
        }));
        
        // Sort by wait score (highest first)
        matchups.sort((a, b) => b.waitScore - a.waitScore);
        
        // Take only what we can fit
        matchups = matchups.slice(0, totalSlotsAvailable);
    }
    
    // Assign matchups to fields and slot orders using fairness algorithms
    return assignMatchupsToFieldsAndSlots(matchups, fields, gamesPerFieldSlot, teamFieldRotation, lastSlotOrder);
}

// =============================================================
// ASSIGN MATCHUPS TO FIELDS & SLOT ORDERS
// =============================================================
function assignMatchupsToFieldsAndSlots(matchups, fields, gamesPerFieldSlot, teamFieldRotation, lastSlotOrder) {
    const assignments = []; // { teamA, teamB, field, slotOrder, conference }
    const usedSlots = {}; // field -> [slotOrders used]
    
    fields.forEach(f => usedSlots[f] = []);
    
    // Create all possible slot assignments
    const possibleSlots = [];
    fields.forEach(field => {
        for (let slot = 1; slot <= gamesPerFieldSlot; slot++) {
            possibleSlots.push({ field, slotOrder: slot });
        }
    });
    
    // Score each matchup-slot combination
    const scoredOptions = [];
    
    matchups.forEach(matchup => {
        possibleSlots.forEach(slot => {
            // Calculate combined fairness score
            const waitScore = getWaitPriorityScore(matchup.teamA, matchup.teamB, lastSlotOrder);
            const fieldScore = getFieldRotationScore(matchup.teamA, matchup.teamB, slot.field, teamFieldRotation, fields);
            
            // Wait priority is HIGHEST, so teams that waited should get slotOrder 1
            // If they have high wait score, they should be assigned to slot 1
            let slotBonus = 0;
            if (waitScore > 50) {
                // Team waited yesterday - bonus for slot 1, penalty for later slots
                slotBonus = (gamesPerFieldSlot - slot.slotOrder + 1) * 30;
            } else {
                // Team played first yesterday - slight penalty for slot 1
                slotBonus = slot.slotOrder * 5;
            }
            
            const totalScore = waitScore + fieldScore + slotBonus;
            
            scoredOptions.push({
                matchup,
                slot,
                score: totalScore
            });
        });
    });
    
    // Sort by score (highest first)
    scoredOptions.sort((a, b) => b.score - a.score);
    
    // Greedy assignment
    const assignedMatchups = new Set();
    const assignedSlots = new Set();
    
    for (const option of scoredOptions) {
        const matchupKey = `${option.matchup.teamA}-${option.matchup.teamB}`;
        const slotKey = `${option.slot.field}-${option.slot.slotOrder}`;
        
        if (!assignedMatchups.has(matchupKey) && !assignedSlots.has(slotKey)) {
            assignments.push({
                teamA: option.matchup.teamA,
                teamB: option.matchup.teamB,
                field: option.slot.field,
                slotOrder: option.slot.slotOrder,
                conference: option.matchup.conference,
                isInterConference: option.matchup.isInterConference,
                _score: option.score
            });
            
            assignedMatchups.add(matchupKey);
            assignedSlots.add(slotKey);
        }
    }
    
    // Sort by field then slot order for display
    assignments.sort((a, b) => {
        if (a.field !== b.field) return a.field.localeCompare(b.field);
        return a.slotOrder - b.slotOrder;
    });
    
    return assignments;
}

// =============================================================
// RECORD GAME RESULTS & UPDATE TRACKING
// =============================================================
function recordGameResults(league, daySchedule) {
    // Update field rotation tracking
    daySchedule.forEach(game => {
        if (!league.teamFieldRotation[game.teamA]) league.teamFieldRotation[game.teamA] = [];
        if (!league.teamFieldRotation[game.teamB]) league.teamFieldRotation[game.teamB] = [];
        
        league.teamFieldRotation[game.teamA].push(game.field);
        league.teamFieldRotation[game.teamB].push(game.field);
        
        // Update last slot order
        league.lastSlotOrder[game.teamA] = game.slotOrder;
        league.lastSlotOrder[game.teamB] = game.slotOrder;
    });
    
    // Increment round counters
    const conferenceNames = Object.keys(league.conferences).filter(c => league.conferences[c]?.length > 0);
    
    if (conferenceNames.length > 0) {
        conferenceNames.forEach(conf => {
            league.conferenceRounds = league.conferenceRounds || {};
            league.conferenceRounds[conf] = (league.conferenceRounds[conf] || 0) + 1;
        });
        
        if (league.allowInterConference) {
            league.interConferenceRound = (league.interConferenceRound || 0) + 1;
        }
    } else {
        league.currentRound = (league.currentRound || 0) + 1;
    }
}

// =============================================================
// INIT TAB
// =============================================================
window.initSpecialtyLeagues = function() {
    const container = document.getElementById("specialty-leagues");
    if (!container) return;

    loadData();

    // =========================================================
    // MAIN TEMPLATE
    // =========================================================
    container.innerHTML = `
        <div class="setup-grid">
            <section class="setup-card setup-card-wide">
                <div class="setup-card-header">
                    <span class="setup-step-pill">Specialty Leagues</span>
                    <div class="setup-card-text">
                        <h3>Manage Specialty Leagues</h3>
                        <p>Configure single-sport leagues with multiple games per field, conferences, and fairness scheduling.</p>
                    </div>
                </div>

                <div style="display:flex; flex-wrap:wrap; gap:20px; margin-top:18px;">
                    <!-- LEFT: League List -->
                    <div style="flex:1; min-width:260px;">
                        <div class="setup-subtitle">Add New Specialty League</div>
                        <div class="setup-field-row" style="margin-top:10px;">
                            <input id="sl-add-input" placeholder="Ex: AFFL Basketball">
                            <button id="sl-add-btn" style="background:#00C896; color:white; border:none; padding:8px 16px; border-radius:6px; cursor:pointer; font-weight:600;">Add</button>
                        </div>

                        <div class="setup-subtitle" style="margin-top:20px;">All Specialty Leagues</div>
                        <div id="sl-master-list" class="master-list" style="margin-top:10px; max-height:500px; overflow:auto;"></div>
                    </div>

                    <!-- RIGHT: Detail Pane -->
                    <div style="flex:2; min-width:400px;">
                        <div class="setup-subtitle">League Configuration</div>
                        <div id="sl-detail-pane" class="detail-pane" style="margin-top:10px; min-height:500px;">
                            <p class="muted">Select a specialty league to configure.</p>
                        </div>
                    </div>
                </div>
            </section>
        </div>

        <style>
            /* Master List Items */
            #specialty-leagues .master-list {
                border: 1px solid #E5E7EB;
                border-radius: 12px;
                background: #F9FAFB;
                padding: 8px;
            }
            #specialty-leagues .list-item {
                padding: 12px;
                border-radius: 10px;
                margin-bottom: 6px;
                cursor: pointer;
                display: flex;
                justify-content: space-between;
                align-items: center;
                background: white;
                border: 1px solid #E5E7EB;
                transition: all 0.15s;
            }
            #specialty-leagues .list-item:hover {
                background: #F3F4F6;
                transform: translateY(-1px);
            }
            #specialty-leagues .list-item.selected {
                background: linear-gradient(135deg, #ECFDF5, white);
                border-color: #00C896;
                box-shadow: 0 0 0 2px rgba(0,200,150,0.2);
            }
            #specialty-leagues .list-item-name {
                font-weight: 500;
                color: #111;
            }

            /* Detail Pane */
            #specialty-leagues .detail-pane {
                border: 1px solid #E5E7EB;
                border-radius: 14px;
                padding: 20px;
                background: linear-gradient(135deg, #FAFAFA, white);
            }

            /* Tab Navigation */
            #specialty-leagues .sl-tabs {
                display: flex;
                gap: 4px;
                margin-bottom: 20px;
                border-bottom: 2px solid #E5E7EB;
                padding-bottom: 10px;
            }
            #specialty-leagues .sl-tab {
                padding: 10px 16px;
                border: none;
                background: #F3F4F6;
                border-radius: 8px 8px 0 0;
                cursor: pointer;
                font-size: 0.9rem;
                font-weight: 500;
                color: #6B7280;
                transition: all 0.15s;
            }
            #specialty-leagues .sl-tab:hover {
                background: #E5E7EB;
            }
            #specialty-leagues .sl-tab.active {
                background: #00C896;
                color: white;
            }

            /* Chips */
            #specialty-leagues .sl-chip {
                display: inline-block;
                padding: 6px 12px;
                border-radius: 999px;
                border: 1px solid #D1D5DB;
                font-size: 0.85rem;
                cursor: pointer;
                user-select: none;
                background: white;
                transition: all 0.15s;
                margin: 3px;
            }
            #specialty-leagues .sl-chip:hover {
                border-color: #00C896;
            }
            #specialty-leagues .sl-chip.active {
                background: #00C896;
                color: white;
                border-color: #00C896;
            }

            /* Field Buttons */
            #specialty-leagues .sl-field-btn {
                display: inline-block;
                padding: 10px 16px;
                border-radius: 8px;
                border: 2px solid #D1D5DB;
                font-size: 0.9rem;
                cursor: pointer;
                background: white;
                transition: all 0.15s;
                margin: 4px;
                font-weight: 500;
            }
            #specialty-leagues .sl-field-btn:hover {
                border-color: #00C896;
                background: #F0FDF4;
            }
            #specialty-leagues .sl-field-btn.active {
                background: #00C896;
                color: white;
                border-color: #00C896;
                box-shadow: 0 2px 8px rgba(0,200,150,0.3);
            }

            /* Conference Box */
            #specialty-leagues .conference-box {
                border: 2px solid #E5E7EB;
                border-radius: 12px;
                padding: 16px;
                margin: 10px 0;
                background: white;
            }
            #specialty-leagues .conference-box.east {
                border-color: #3B82F6;
                background: linear-gradient(135deg, #EFF6FF, white);
            }
            #specialty-leagues .conference-box.west {
                border-color: #EF4444;
                background: linear-gradient(135deg, #FEF2F2, white);
            }

            /* Schedule Cards */
            #specialty-leagues .schedule-field-card {
                border: 1px solid #E5E7EB;
                border-radius: 10px;
                margin: 10px 0;
                overflow: hidden;
            }
            #specialty-leagues .schedule-field-header {
                background: #F3F4F6;
                padding: 10px 16px;
                font-weight: 600;
                border-bottom: 1px solid #E5E7EB;
            }
            #specialty-leagues .schedule-game {
                padding: 12px 16px;
                border-bottom: 1px solid #F3F4F6;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            #specialty-leagues .schedule-game:last-child {
                border-bottom: none;
            }
            #specialty-leagues .slot-badge {
                display: inline-block;
                padding: 2px 8px;
                border-radius: 999px;
                font-size: 0.75rem;
                font-weight: 600;
            }
            #specialty-leagues .slot-badge.slot-1 { background: #D1FAE5; color: #065F46; }
            #specialty-leagues .slot-badge.slot-2 { background: #FEF3C7; color: #92400E; }
            #specialty-leagues .slot-badge.slot-3 { background: #FEE2E2; color: #991B1B; }

            /* Standings Table */
            #specialty-leagues .standings-table {
                width: 100%;
                border-collapse: collapse;
            }
            #specialty-leagues .standings-table th,
            #specialty-leagues .standings-table td {
                padding: 10px 12px;
                text-align: left;
                border-bottom: 1px solid #E5E7EB;
            }
            #specialty-leagues .standings-table th {
                background: #F9FAFB;
                font-weight: 600;
                font-size: 0.8rem;
                text-transform: uppercase;
                color: #6B7280;
            }
            #specialty-leagues .standings-table tr:hover {
                background: #F9FAFB;
            }

            /* Toggle Switch */
            #specialty-leagues .switch {
                position: relative;
                display: inline-block;
                width: 44px;
                height: 24px;
            }
            #specialty-leagues .switch input {
                opacity: 0;
                width: 0;
                height: 0;
            }
            #specialty-leagues .slider {
                position: absolute;
                cursor: pointer;
                top: 0; left: 0; right: 0; bottom: 0;
                background-color: #D1D5DB;
                transition: 0.3s;
                border-radius: 24px;
            }
            #specialty-leagues .slider:before {
                position: absolute;
                content: "";
                height: 18px;
                width: 18px;
                left: 3px;
                bottom: 3px;
                background-color: white;
                transition: 0.3s;
                border-radius: 50%;
            }
            #specialty-leagues input:checked + .slider {
                background-color: #00C896;
            }
            #specialty-leagues input:checked + .slider:before {
                transform: translateX(20px);
            }

            /* Form Sections */
            #specialty-leagues .form-section {
                margin-bottom: 24px;
                padding-bottom: 24px;
                border-bottom: 1px solid #E5E7EB;
            }
            #specialty-leagues .form-section:last-child {
                border-bottom: none;
                margin-bottom: 0;
                padding-bottom: 0;
            }
            #specialty-leagues .form-label {
                display: block;
                font-weight: 600;
                margin-bottom: 8px;
                color: #374151;
            }
            #specialty-leagues .form-hint {
                font-size: 0.85rem;
                color: #6B7280;
                margin-top: 4px;
            }

            /* Action Buttons */
            #specialty-leagues .btn-primary {
                background: #00C896;
                color: white;
                border: none;
                padding: 10px 20px;
                border-radius: 8px;
                cursor: pointer;
                font-weight: 600;
                transition: all 0.15s;
            }
            #specialty-leagues .btn-primary:hover {
                background: #00A87D;
                transform: translateY(-1px);
            }
            #specialty-leagues .btn-secondary {
                background: white;
                color: #374151;
                border: 1px solid #D1D5DB;
                padding: 10px 20px;
                border-radius: 8px;
                cursor: pointer;
                font-weight: 500;
                transition: all 0.15s;
            }
            #specialty-leagues .btn-secondary:hover {
                background: #F3F4F6;
            }
            #specialty-leagues .btn-danger {
                background: #DC2626;
                color: white;
                border: none;
                padding: 8px 16px;
                border-radius: 6px;
                cursor: pointer;
                font-weight: 500;
            }
            #specialty-leagues .btn-danger:hover {
                background: #B91C1C;
            }
        </style>
    `;

    // DOM refs
    listEl = document.getElementById("sl-master-list");
    detailPaneEl = document.getElementById("sl-detail-pane");

    // Add new league
    const addInput = document.getElementById("sl-add-input");
    const addBtn = document.getElementById("sl-add-btn");

    const addLeague = () => {
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
            conferences: {},
            enabled: true,
            standings: {},
            games: [],
            gameLength: 20,
            gamesPerFieldSlot: 3,
            allowInterConference: false,
            interConferencePriority: 0.3,
            teamFieldRotation: {},
            lastSlotOrder: {},
            currentRound: 0,
            conferenceRounds: {},
            interConferenceRound: 0
        };

        saveData();
        activeLeagueId = id;
        activeTab = "config";
        addInput.value = "";

        renderMasterList();
        renderDetailPane();
    };

    addBtn.onclick = addLeague;
    addInput.onkeyup = e => e.key === "Enter" && addLeague();

    renderMasterList();
    if (activeLeagueId && specialtyLeagues[activeLeagueId]) {
        renderDetailPane();
    }
};

// =============================================================
// MASTER LIST
// =============================================================
function renderMasterList() {
    listEl.innerHTML = "";

    const items = Object.values(specialtyLeagues).sort((a, b) => a.name.localeCompare(b.name));

    if (items.length === 0) {
        listEl.innerHTML = `<p class="muted" style="padding:20px; text-align:center;">No specialty leagues yet.</p>`;
        return;
    }

    items.forEach(l => {
        const el = document.createElement("div");
        el.className = "list-item" + (l.id === activeLeagueId ? " selected" : "");

        el.onclick = () => {
            activeLeagueId = l.id;
            activeTab = "config";
            renderMasterList();
            renderDetailPane();
        };

        const nameEl = document.createElement("span");
        nameEl.className = "list-item-name";
        nameEl.textContent = l.name;
        
        const meta = document.createElement("span");
        meta.style.cssText = "font-size:0.75rem; color:#6B7280; margin-left:8px;";
        meta.textContent = l.sport ? `(${l.sport})` : "";
        nameEl.appendChild(meta);
        
        el.appendChild(nameEl);

        // Enable toggle
        const tog = document.createElement("label");
        tog.className = "switch";
        tog.onclick = e => e.stopPropagation();

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

// =============================================================
// DETAIL PANE
// =============================================================
function renderDetailPane() {
    if (!activeLeagueId || !specialtyLeagues[activeLeagueId]) {
        detailPaneEl.innerHTML = `<p class="muted">Select a specialty league to configure.</p>`;
        return;
    }

    const league = specialtyLeagues[activeLeagueId];
    detailPaneEl.innerHTML = "";

    // Header
    const header = document.createElement("div");
    header.style.cssText = "display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;";

    const title = document.createElement("h3");
    title.textContent = league.name;
    title.style.cssText = "margin:0; font-size:1.3rem; cursor:pointer;";
    title.title = "Double-click to rename";
    makeEditable(title, newName => {
        league.name = newName;
        saveData();
        renderMasterList();
    });

    const delBtn = document.createElement("button");
    delBtn.className = "btn-danger";
    delBtn.textContent = "Delete League";
    delBtn.onclick = () => {
        if (confirm(`Delete "${league.name}"? This cannot be undone.`)) {
            delete specialtyLeagues[league.id];
            activeLeagueId = null;
            saveData();
            renderMasterList();
            renderDetailPane();
        }
    };

    header.append(title, delBtn);
    detailPaneEl.appendChild(header);

    // Tab Navigation
    const tabs = document.createElement("div");
    tabs.className = "sl-tabs";

    const tabDefs = [
        { id: "config", label: "Configuration" },
        { id: "teams", label: "Teams & Conferences" },
        { id: "schedule", label: "Schedule" },
        { id: "results", label: "Game Results" },
        { id: "standings", label: "Standings" }
    ];

    tabDefs.forEach(t => {
        const btn = document.createElement("button");
        btn.className = "sl-tab" + (activeTab === t.id ? " active" : "");
        btn.textContent = t.label;
        btn.onclick = () => {
            activeTab = t.id;
            renderDetailPane();
        };
        tabs.appendChild(btn);
    });

    detailPaneEl.appendChild(tabs);

    // Tab Content
    const content = document.createElement("div");
    content.id = "sl-tab-content";

    switch (activeTab) {
        case "config":
            renderConfigTab(league, content);
            break;
        case "teams":
            renderTeamsTab(league, content);
            break;
        case "schedule":
            renderScheduleTab(league, content);
            break;
        case "results":
            renderResultsTab(league, content);
            break;
        case "standings":
            renderStandingsTab(league, content);
            break;
    }

    detailPaneEl.appendChild(content);
}

// =============================================================
// CONFIG TAB
// =============================================================
function renderConfigTab(league, container) {
    container.innerHTML = `
        <div class="form-section">
            <label class="form-label">Divisions</label>
            <p class="form-hint">Select which divisions participate in this league.</p>
            <div id="sl-divisions-chips" style="margin-top:10px;"></div>
        </div>

        <div class="form-section">
            <label class="form-label">Sport</label>
            <p class="form-hint">Select the single sport for this specialty league.</p>
            <select id="sl-sport-select" style="padding:10px; border:1px solid #D1D5DB; border-radius:8px; font-size:1rem; min-width:200px; margin-top:8px;">
                <option value="">-- Select Sport --</option>
            </select>
        </div>

        <div class="form-section" id="sl-fields-section" style="display:none;">
            <label class="form-label">Fields / Courts</label>
            <p class="form-hint">Push to select which fields this league will use. <strong>This overrides field restrictions.</strong></p>
            <div id="sl-fields-buttons" style="margin-top:10px;"></div>
        </div>

        <div class="form-section">
            <label class="form-label">Game Settings</label>
            <div style="display:flex; gap:20px; margin-top:10px; flex-wrap:wrap;">
                <div>
                    <label style="font-size:0.85rem; color:#6B7280;">Game Length (minutes)</label>
                    <input type="number" id="sl-game-length" min="5" max="60" value="${league.gameLength || 20}" 
                           style="display:block; padding:8px; border:1px solid #D1D5DB; border-radius:6px; width:100px; margin-top:4px;">
                </div>
                <div>
                    <label style="font-size:0.85rem; color:#6B7280;">Games per Field per Slot</label>
                    <input type="number" id="sl-games-per-slot" min="1" max="5" value="${league.gamesPerFieldSlot || 3}" 
                           style="display:block; padding:8px; border:1px solid #D1D5DB; border-radius:6px; width:100px; margin-top:4px;">
                </div>
            </div>
            <div id="sl-capacity-calc" style="margin-top:12px; padding:12px; background:#F0FDF4; border-radius:8px; border:1px solid #D1FAE5;"></div>
        </div>

        <div class="form-section">
            <label class="form-label">Inter-Conference Play</label>
            <div style="display:flex; align-items:center; gap:12px; margin-top:10px;">
                <label class="switch">
                    <input type="checkbox" id="sl-inter-conf" ${league.allowInterConference ? "checked" : ""}>
                    <span class="slider"></span>
                </label>
                <span>Allow inter-conference matchups</span>
            </div>
            <div id="sl-inter-conf-priority" style="margin-top:12px; ${league.allowInterConference ? "" : "display:none;"}">
                <label style="font-size:0.85rem; color:#6B7280;">Inter-Conference Priority: <span id="sl-priority-val">${Math.round((league.interConferencePriority || 0.3) * 100)}%</span></label>
                <input type="range" id="sl-priority-slider" min="0" max="50" value="${Math.round((league.interConferencePriority || 0.3) * 100)}"
                       style="width:200px; margin-left:10px;">
            </div>
        </div>
    `;

    // Divisions
    const divChipsEl = container.querySelector("#sl-divisions-chips");
    (window.availableDivisions || []).forEach(div => {
        const chip = document.createElement("span");
        chip.className = "sl-chip" + (league.divisions.includes(div) ? " active" : "");
        chip.textContent = div;
        chip.onclick = () => {
            if (league.divisions.includes(div)) {
                league.divisions = league.divisions.filter(d => d !== div);
            } else {
                league.divisions.push(div);
            }
            chip.classList.toggle("active");
            saveData();
        };
        divChipsEl.appendChild(chip);
    });

    // Sport dropdown
    const sportSelect = container.querySelector("#sl-sport-select");
    const allSports = getAllSportsFromFields();
    
    allSports.forEach(sport => {
        const opt = document.createElement("option");
        opt.value = sport;
        opt.textContent = sport;
        if (league.sport === sport) opt.selected = true;
        sportSelect.appendChild(opt);
    });

    sportSelect.onchange = () => {
        league.sport = sportSelect.value || null;
        league.fields = []; // Reset fields when sport changes
        saveData();
        updateFieldsSection();
    };

    // Fields section
    const fieldsSection = container.querySelector("#sl-fields-section");
    const fieldsButtons = container.querySelector("#sl-fields-buttons");

    function updateFieldsSection() {
        if (!league.sport) {
            fieldsSection.style.display = "none";
            return;
        }

        fieldsSection.style.display = "block";
        fieldsButtons.innerHTML = "";

        const availableFields = getFieldsForSport(league.sport);

        if (availableFields.length === 0) {
            fieldsButtons.innerHTML = `<p class="muted">No fields support ${league.sport}.</p>`;
            return;
        }

        availableFields.forEach(fieldName => {
            const btn = document.createElement("button");
            btn.className = "sl-field-btn" + (league.fields.includes(fieldName) ? " active" : "");
            btn.textContent = fieldName;
            btn.onclick = () => {
                if (league.fields.includes(fieldName)) {
                    league.fields = league.fields.filter(f => f !== fieldName);
                } else {
                    league.fields.push(fieldName);
                }
                btn.classList.toggle("active");
                saveData();
                updateCapacityCalc();
            };
            fieldsButtons.appendChild(btn);
        });

        updateCapacityCalc();
    }

    // Capacity calculator
    const capacityCalc = container.querySelector("#sl-capacity-calc");

    function updateCapacityCalc() {
        const numFields = league.fields.length;
        const gamesPerSlot = parseInt(container.querySelector("#sl-games-per-slot").value) || 3;
        const totalTeams = numFields * gamesPerSlot * 2;
        
        capacityCalc.innerHTML = `
            <strong>Capacity Calculator:</strong><br>
            ${numFields} field(s) × ${gamesPerSlot} games/field = <strong>${numFields * gamesPerSlot} matchups</strong> = <strong>${totalTeams} teams</strong> per time slot
        `;
    }

    // Game settings
    const gameLengthInput = container.querySelector("#sl-game-length");
    const gamesPerSlotInput = container.querySelector("#sl-games-per-slot");

    gameLengthInput.onchange = () => {
        league.gameLength = parseInt(gameLengthInput.value) || 20;
        saveData();
    };

    gamesPerSlotInput.onchange = () => {
        league.gamesPerFieldSlot = parseInt(gamesPerSlotInput.value) || 3;
        saveData();
        updateCapacityCalc();
    };

    // Inter-conference
    const interConfCheck = container.querySelector("#sl-inter-conf");
    const interConfPriority = container.querySelector("#sl-inter-conf-priority");
    const prioritySlider = container.querySelector("#sl-priority-slider");
    const priorityVal = container.querySelector("#sl-priority-val");

    interConfCheck.onchange = () => {
        league.allowInterConference = interConfCheck.checked;
        interConfPriority.style.display = interConfCheck.checked ? "block" : "none";
        saveData();
    };

    prioritySlider.oninput = () => {
        const val = parseInt(prioritySlider.value);
        league.interConferencePriority = val / 100;
        priorityVal.textContent = val + "%";
        saveData();
    };

    // Initialize
    updateFieldsSection();
}

// =============================================================
// TEAMS & CONFERENCES TAB
// =============================================================
function renderTeamsTab(league, container) {
    container.innerHTML = `
        <div class="form-section">
            <label class="form-label">Add Teams</label>
            <div style="display:flex; gap:10px; margin-top:8px;">
                <input id="sl-team-input" placeholder="Team name (e.g., Green, Blue)" 
                       style="flex:1; padding:10px; border:1px solid #D1D5DB; border-radius:8px;">
                <button id="sl-add-team-btn" class="btn-primary">Add Team</button>
            </div>
        </div>

        <div class="form-section">
            <label class="form-label">Conferences</label>
            <p class="form-hint">Create conferences to organize teams. Intra-conference matchups are prioritized.</p>
            <div style="display:flex; gap:10px; margin-top:8px; margin-bottom:16px;">
                <input id="sl-conf-input" placeholder="Conference name (e.g., East, West)" 
                       style="flex:1; padding:10px; border:1px solid #D1D5DB; border-radius:8px;">
                <button id="sl-add-conf-btn" class="btn-secondary">Add Conference</button>
            </div>
            <div id="sl-conferences-container"></div>
        </div>

        <div class="form-section">
            <label class="form-label">Unassigned Teams</label>
            <p class="form-hint">Click a team to assign it to a conference, or they will play in a single pool.</p>
            <div id="sl-unassigned-teams" style="margin-top:10px;"></div>
        </div>

        <div style="margin-top:20px; padding:16px; background:#F9FAFB; border-radius:8px;">
            <strong>League Summary:</strong><br>
            Total Teams: <strong>${league.teams.length}</strong> | 
            Conferences: <strong>${Object.keys(league.conferences).filter(c => league.conferences[c]?.length > 0).length}</strong> | 
            Fields: <strong>${league.fields.length}</strong>
        </div>
    `;

    const teamInput = container.querySelector("#sl-team-input");
    const addTeamBtn = container.querySelector("#sl-add-team-btn");
    const confInput = container.querySelector("#sl-conf-input");
    const addConfBtn = container.querySelector("#sl-add-conf-btn");
    const conferencesContainer = container.querySelector("#sl-conferences-container");
    const unassignedContainer = container.querySelector("#sl-unassigned-teams");

    // Add team
    const addTeam = () => {
        const name = teamInput.value.trim();
        if (!name) return;
        if (league.teams.includes(name)) {
            alert("Team already exists!");
            return;
        }
        league.teams.push(name);
        league.standings[name] = { w: 0, l: 0, t: 0 };
        teamInput.value = "";
        saveData();
        renderTeamsTab(league, container);
    };

    addTeamBtn.onclick = addTeam;
    teamInput.onkeyup = e => e.key === "Enter" && addTeam();

    // Add conference
    const addConf = () => {
        const name = confInput.value.trim();
        if (!name) return;
        if (league.conferences[name]) {
            alert("Conference already exists!");
            return;
        }
        league.conferences[name] = [];
        confInput.value = "";
        saveData();
        renderTeamsTab(league, container);
    };

    addConfBtn.onclick = addConf;
    confInput.onkeyup = e => e.key === "Enter" && addConf();

    // Render conferences
    const confNames = Object.keys(league.conferences).sort();
    
    confNames.forEach((confName, idx) => {
        const confTeams = league.conferences[confName] || [];
        const colorClass = idx % 2 === 0 ? "east" : "west";
        
        const box = document.createElement("div");
        box.className = `conference-box ${colorClass}`;
        box.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                <strong style="font-size:1.1rem;">${confName}</strong>
                <button class="btn-danger" style="font-size:0.75rem; padding:4px 8px;" data-conf="${confName}">Delete</button>
            </div>
            <div class="conf-teams" data-conf="${confName}"></div>
        `;

        box.querySelector(".btn-danger").onclick = () => {
            if (confirm(`Delete conference "${confName}"? Teams will become unassigned.`)) {
                delete league.conferences[confName];
                saveData();
                renderTeamsTab(league, container);
            }
        };

        const teamsDiv = box.querySelector(".conf-teams");
        
        confTeams.forEach(teamName => {
            const chip = document.createElement("span");
            chip.className = "sl-chip active";
            chip.innerHTML = `${teamName} <span style="margin-left:6px; opacity:0.7;">×</span>`;
            chip.onclick = () => {
                // Remove from conference
                league.conferences[confName] = league.conferences[confName].filter(t => t !== teamName);
                saveData();
                renderTeamsTab(league, container);
            };
            teamsDiv.appendChild(chip);
        });

        if (confTeams.length === 0) {
            teamsDiv.innerHTML = `<span class="muted" style="font-size:0.85rem;">No teams assigned</span>`;
        }

        conferencesContainer.appendChild(box);
    });

    // Render unassigned teams
    const assignedTeams = new Set();
    Object.values(league.conferences).forEach(teams => {
        teams.forEach(t => assignedTeams.add(t));
    });

    const unassigned = league.teams.filter(t => !assignedTeams.has(t));

    if (unassigned.length === 0) {
        unassignedContainer.innerHTML = `<span class="muted">All teams are assigned to conferences.</span>`;
    } else {
        unassigned.forEach(teamName => {
            const chip = document.createElement("span");
            chip.className = "sl-chip";
            chip.innerHTML = `${teamName} <span style="margin-left:6px; color:#DC2626;">×</span>`;
            
            chip.onclick = (e) => {
                // Check if clicking the X
                if (e.target.tagName === "SPAN") {
                    if (confirm(`Remove team "${teamName}" from the league?`)) {
                        league.teams = league.teams.filter(t => t !== teamName);
                        delete league.standings[teamName];
                        saveData();
                        renderTeamsTab(league, container);
                    }
                    return;
                }
                
                // Assign to conference
                if (confNames.length === 0) {
                    alert("Create a conference first!");
                    return;
                }
                
                const confChoice = prompt(`Assign "${teamName}" to which conference?\n\nOptions: ${confNames.join(", ")}`);
                if (confChoice && league.conferences[confChoice] !== undefined) {
                    league.conferences[confChoice].push(teamName);
                    saveData();
                    renderTeamsTab(league, container);
                } else if (confChoice) {
                    alert("Conference not found. Please type exactly as shown.");
                }
            };
            
            unassignedContainer.appendChild(chip);
        });
    }
}

// =============================================================
// SCHEDULE TAB
// =============================================================
function renderScheduleTab(league, container) {
    container.innerHTML = `
        <div class="form-section">
            <label class="form-label">Generate Today's Schedule</label>
            <p class="form-hint">Uses fairness algorithms: Wait Priority + Field Rotation</p>
            <button id="sl-generate-btn" class="btn-primary" style="margin-top:10px;">Generate Schedule</button>
        </div>

        <div id="sl-schedule-display"></div>

        <div id="sl-fairness-display" style="margin-top:20px;"></div>
    `;

    const generateBtn = container.querySelector("#sl-generate-btn");
    const scheduleDisplay = container.querySelector("#sl-schedule-display");
    const fairnessDisplay = container.querySelector("#sl-fairness-display");

    generateBtn.onclick = () => {
        if (league.teams.length < 2) {
            alert("Need at least 2 teams to generate a schedule.");
            return;
        }
        if (league.fields.length === 0) {
            alert("Please select at least one field in Configuration.");
            return;
        }

        const schedule = generateDaySchedule(league);
        
        if (!schedule || schedule.length === 0) {
            alert("Could not generate schedule. Check team and field configuration.");
            return;
        }

        displaySchedule(schedule, scheduleDisplay, league);
        displayFairnessInfo(league, fairnessDisplay);
    };

    // Check if there's a saved schedule for today
    const dailyData = window.loadCurrentDailyData?.() || {};
    const savedSchedule = dailyData.specialtyLeagueSchedule?.[league.id];
    
    if (savedSchedule) {
        displaySchedule(savedSchedule, scheduleDisplay, league);
        displayFairnessInfo(league, fairnessDisplay);
    }
}

function displaySchedule(schedule, container, league) {
    container.innerHTML = "";

    // Group by field
    const byField = {};
    schedule.forEach(game => {
        if (!byField[game.field]) byField[game.field] = [];
        byField[game.field].push(game);
    });

    Object.keys(byField).sort().forEach(fieldName => {
        const games = byField[fieldName].sort((a, b) => a.slotOrder - b.slotOrder);
        
        const card = document.createElement("div");
        card.className = "schedule-field-card";
        
        card.innerHTML = `
            <div class="schedule-field-header">
                🏟️ ${fieldName}
            </div>
        `;

        games.forEach(game => {
            const gameEl = document.createElement("div");
            gameEl.className = "schedule-game";
            
            const slotClass = `slot-${game.slotOrder}`;
            const confLabel = game.conference ? `<span style="font-size:0.75rem; color:#6B7280;">(${game.conference})</span>` : "";
            
            gameEl.innerHTML = `
                <div>
                    <span class="slot-badge ${slotClass}">Game ${game.slotOrder}</span>
                    <strong style="margin-left:10px;">${game.teamA}</strong> vs <strong>${game.teamB}</strong>
                    ${confLabel}
                </div>
            `;
            
            card.appendChild(gameEl);
        });

        container.appendChild(card);
    });

    // Save button
    const saveRow = document.createElement("div");
    saveRow.style.cssText = "margin-top:16px; display:flex; gap:10px;";
    
    const saveBtn = document.createElement("button");
    saveBtn.className = "btn-primary";
    saveBtn.textContent = "Confirm & Save Schedule";
    saveBtn.onclick = () => {
        // Save to daily data
        const dailyData = window.loadCurrentDailyData?.() || {};
        dailyData.specialtyLeagueSchedule = dailyData.specialtyLeagueSchedule || {};
        dailyData.specialtyLeagueSchedule[league.id] = schedule;
        window.saveCurrentDailyData?.("specialtyLeagueSchedule", dailyData.specialtyLeagueSchedule);
        
        // Update tracking
        recordGameResults(league, schedule);
        saveData();
        
        alert("Schedule saved! Fairness tracking updated.");
        renderScheduleTab(league, container.parentElement);
    };
    
    saveRow.appendChild(saveBtn);
    container.appendChild(saveRow);
}

function displayFairnessInfo(league, container) {
    container.innerHTML = `
        <div style="background:#F9FAFB; border-radius:12px; padding:16px;">
            <h4 style="margin:0 0 12px 0;">Fairness Tracking</h4>
            
            <div style="margin-bottom:16px;">
                <strong>Last Slot Order (1=First, 2=Second, 3=Third):</strong>
                <div style="margin-top:8px; display:flex; flex-wrap:wrap; gap:6px;">
                    ${league.teams.map(team => {
                        const slot = league.lastSlotOrder[team] || 1;
                        const color = slot === 1 ? "#059669" : (slot === 2 ? "#D97706" : "#DC2626");
                        return `<span style="padding:4px 8px; background:white; border:1px solid #E5E7EB; border-radius:4px; font-size:0.85rem;">
                            ${team}: <strong style="color:${color}">${slot}</strong>
                        </span>`;
                    }).join("")}
                </div>
            </div>
            
            <div>
                <strong>Field Rotation (Recent History):</strong>
                <div style="margin-top:8px; max-height:150px; overflow-y:auto;">
                    ${league.teams.map(team => {
                        const fields = league.teamFieldRotation[team] || [];
                        const recent = fields.slice(-5).join(" → ") || "None";
                        return `<div style="padding:4px 0; font-size:0.85rem; border-bottom:1px solid #E5E7EB;">
                            <strong>${team}:</strong> ${recent}
                        </div>`;
                    }).join("")}
                </div>
            </div>
        </div>
    `;
}

// =============================================================
// RESULTS TAB
// =============================================================
function renderResultsTab(league, container) {
    container.innerHTML = `
        <div class="form-section">
            <label class="form-label">Import Today's Schedule</label>
            <button id="sl-import-btn" class="btn-secondary">Import from Daily Schedule</button>
        </div>

        <div id="sl-results-entry"></div>

        <div class="form-section" style="margin-top:20px;">
            <label class="form-label">Game History</label>
            <div id="sl-game-history"></div>
        </div>
    `;

    const importBtn = container.querySelector("#sl-import-btn");
    const resultsEntry = container.querySelector("#sl-results-entry");
    const gameHistory = container.querySelector("#sl-game-history");

    importBtn.onclick = () => {
        const dailyData = window.loadCurrentDailyData?.() || {};
        const savedSchedule = dailyData.specialtyLeagueSchedule?.[league.id];
        
        if (!savedSchedule || savedSchedule.length === 0) {
            alert("No schedule found for today. Generate and save a schedule first.");
            return;
        }

        displayResultsEntry(savedSchedule, resultsEntry, league);
    };

    // Show existing game history
    displayGameHistory(league, gameHistory);
}

function displayResultsEntry(schedule, container, league) {
    container.innerHTML = `
        <h4 style="margin:16px 0 12px 0;">Enter Scores</h4>
    `;

    schedule.forEach((game, idx) => {
        const row = document.createElement("div");
        row.style.cssText = "display:flex; align-items:center; gap:12px; padding:12px; background:#F9FAFB; border-radius:8px; margin-bottom:8px;";
        row.innerHTML = `
            <span style="width:80px; font-size:0.85rem;">${game.field}</span>
            <strong style="flex:1; text-align:right;">${game.teamA}</strong>
            <input type="number" min="0" data-idx="${idx}" data-team="A" value="" 
                   style="width:60px; padding:8px; border:1px solid #D1D5DB; border-radius:6px; text-align:center; font-weight:bold;">
            <span style="color:#6B7280;">vs</span>
            <input type="number" min="0" data-idx="${idx}" data-team="B" value="" 
                   style="width:60px; padding:8px; border:1px solid #D1D5DB; border-radius:6px; text-align:center; font-weight:bold;">
            <strong style="flex:1;">${game.teamB}</strong>
            <button class="btn-secondary" data-idx="${idx}" style="padding:6px 12px;">Save</button>
        `;

        row.querySelector("button").onclick = () => {
            const scoreA = parseInt(row.querySelector('[data-team="A"]').value) || 0;
            const scoreB = parseInt(row.querySelector('[data-team="B"]').value) || 0;
            
            let winner = null;
            if (scoreA > scoreB) winner = game.teamA;
            else if (scoreB > scoreA) winner = game.teamB;
            else winner = "tie";

            // Find or create game day entry
            const today = window.currentScheduleDate || new Date().toISOString().split('T')[0];
            let gameDay = league.games.find(g => g.date === today);
            
            if (!gameDay) {
                gameDay = { date: today, matches: [] };
                league.games.push(gameDay);
            }

            // Check if match already recorded
            const existingIdx = gameDay.matches.findIndex(m => 
                (m.teamA === game.teamA && m.teamB === game.teamB) ||
                (m.teamA === game.teamB && m.teamB === game.teamA)
            );

            const matchResult = {
                teamA: game.teamA,
                teamB: game.teamB,
                field: game.field,
                slotOrder: game.slotOrder,
                scoreA,
                scoreB,
                winner
            };

            if (existingIdx >= 0) {
                gameDay.matches[existingIdx] = matchResult;
            } else {
                gameDay.matches.push(matchResult);
            }

            recalculateStandings(league);
            saveData();
            
            row.style.background = "#D1FAE5";
            setTimeout(() => row.style.background = "#F9FAFB", 1000);
        };

        container.appendChild(row);
    });
}

function displayGameHistory(league, container) {
    if (!league.games || league.games.length === 0) {
        container.innerHTML = `<p class="muted">No games recorded yet.</p>`;
        return;
    }

    container.innerHTML = "";

    [...league.games].reverse().forEach(gameDay => {
        const dayEl = document.createElement("div");
        dayEl.style.cssText = "margin-bottom:16px; border:1px solid #E5E7EB; border-radius:8px; overflow:hidden;";
        
        dayEl.innerHTML = `
            <div style="background:#F3F4F6; padding:10px 16px; display:flex; justify-content:space-between; align-items:center;">
                <strong>${gameDay.date}</strong>
                <button class="btn-danger" style="font-size:0.75rem; padding:4px 8px;" data-date="${gameDay.date}">Delete Day</button>
            </div>
        `;

        dayEl.querySelector(".btn-danger").onclick = () => {
            if (confirm(`Delete all results from ${gameDay.date}?`)) {
                league.games = league.games.filter(g => g.date !== gameDay.date);
                recalculateStandings(league);
                saveData();
                displayGameHistory(league, container);
            }
        };

        gameDay.matches.forEach(m => {
            const matchEl = document.createElement("div");
            matchEl.style.cssText = "padding:10px 16px; border-bottom:1px solid #F3F4F6; font-size:0.9rem;";
            
            const winnerStyle = (team) => m.winner === team ? "font-weight:bold; color:#059669;" : "";
            
            matchEl.innerHTML = `
                <span style="${winnerStyle(m.teamA)}">${m.teamA}</span> 
                <strong>${m.scoreA}</strong> - <strong>${m.scoreB}</strong>
                <span style="${winnerStyle(m.teamB)}">${m.teamB}</span>
                <span style="color:#6B7280; margin-left:10px; font-size:0.8rem;">@ ${m.field}</span>
            `;
            
            dayEl.appendChild(matchEl);
        });

        container.appendChild(dayEl);
    });
}

// =============================================================
// STANDINGS TAB
// =============================================================
function renderStandingsTab(league, container) {
    recalculateStandings(league);

    const conferenceNames = Object.keys(league.conferences).filter(c => league.conferences[c]?.length > 0);

    container.innerHTML = "";

    if (conferenceNames.length > 0) {
        // Show standings by conference
        conferenceNames.forEach(confName => {
            const confTeams = league.conferences[confName] || [];
            const sorted = [...confTeams].sort((a, b) => {
                const sa = league.standings[a] || { w: 0, l: 0, t: 0 };
                const sb = league.standings[b] || { w: 0, l: 0, t: 0 };
                if (sa.w !== sb.w) return sb.w - sa.w;
                if (sa.l !== sb.l) return sa.l - sb.l;
                return sb.t - sa.t;
            });

            const confEl = document.createElement("div");
            confEl.style.marginBottom = "24px";
            confEl.innerHTML = `
                <h4 style="margin:0 0 12px 0; color:#374151;">${confName} Conference</h4>
                <table class="standings-table">
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>Team</th>
                            <th style="text-align:center;">W</th>
                            <th style="text-align:center;">L</th>
                            <th style="text-align:center;">T</th>
                            <th style="text-align:center;">Win %</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${sorted.map((team, idx) => {
                            const s = league.standings[team] || { w: 0, l: 0, t: 0 };
                            const total = s.w + s.l + s.t;
                            const pct = total > 0 ? ((s.w + s.t * 0.5) / total * 100).toFixed(1) : "0.0";
                            return `
                                <tr>
                                    <td><strong>${idx + 1}</strong></td>
                                    <td>${team}</td>
                                    <td style="text-align:center; color:#059669; font-weight:600;">${s.w}</td>
                                    <td style="text-align:center; color:#DC2626;">${s.l}</td>
                                    <td style="text-align:center; color:#6B7280;">${s.t}</td>
                                    <td style="text-align:center;">${pct}%</td>
                                </tr>
                            `;
                        }).join("")}
                    </tbody>
                </table>
            `;

            container.appendChild(confEl);
        });
    } else {
        // Show all teams together
        const sorted = [...league.teams].sort((a, b) => {
            const sa = league.standings[a] || { w: 0, l: 0, t: 0 };
            const sb = league.standings[b] || { w: 0, l: 0, t: 0 };
            if (sa.w !== sb.w) return sb.w - sa.w;
            if (sa.l !== sb.l) return sa.l - sb.l;
            return sb.t - sa.t;
        });

        container.innerHTML = `
            <table class="standings-table">
                <thead>
                    <tr>
                        <th>#</th>
                        <th>Team</th>
                        <th style="text-align:center;">W</th>
                        <th style="text-align:center;">L</th>
                        <th style="text-align:center;">T</th>
                        <th style="text-align:center;">Win %</th>
                    </tr>
                </thead>
                <tbody>
                    ${sorted.map((team, idx) => {
                        const s = league.standings[team] || { w: 0, l: 0, t: 0 };
                        const total = s.w + s.l + s.t;
                        const pct = total > 0 ? ((s.w + s.t * 0.5) / total * 100).toFixed(1) : "0.0";
                        return `
                            <tr>
                                <td><strong>${idx + 1}</strong></td>
                                <td>${team}</td>
                                <td style="text-align:center; color:#059669; font-weight:600;">${s.w}</td>
                                <td style="text-align:center; color:#DC2626;">${s.l}</td>
                                <td style="text-align:center; color:#6B7280;">${s.t}</td>
                                <td style="text-align:center;">${pct}%</td>
                            </tr>
                        `;
                    }).join("")}
                </tbody>
            </table>
        `;
    }

    // Reset button
    const resetBtn = document.createElement("button");
    resetBtn.className = "btn-danger";
    resetBtn.style.marginTop = "20px";
    resetBtn.textContent = "Reset All Standings & Games";
    resetBtn.onclick = () => {
        if (confirm("Reset all standings and game history? This cannot be undone.")) {
            league.teams.forEach(t => {
                league.standings[t] = { w: 0, l: 0, t: 0 };
            });
            league.games = [];
            league.teamFieldRotation = {};
            league.lastSlotOrder = {};
            league.currentRound = 0;
            league.conferenceRounds = {};
            league.interConferenceRound = 0;
            saveData();
            renderStandingsTab(league, container);
        }
    };

    container.appendChild(resetBtn);
}

function recalculateStandings(league) {
    // Reset standings
    league.teams.forEach(t => {
        league.standings[t] = { w: 0, l: 0, t: 0 };
    });

    // Recalculate from games
    (league.games || []).forEach(gameDay => {
        (gameDay.matches || []).forEach(m => {
            if (m.winner === "tie") {
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

// =============================================================
// EXPORTS FOR SCHEDULER INTEGRATION
// =============================================================
window.getSpecialtyLeagueScheduleForToday = function(leagueId) {
    const dailyData = window.loadCurrentDailyData?.() || {};
    return dailyData.specialtyLeagueSchedule?.[leagueId] || null;
};

window.masterSpecialtyLeagues = specialtyLeagues;

})();
