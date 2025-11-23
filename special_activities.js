// =================================================================
// special_activities.js
//
// UPDATED (VISION REFRESH):
// - Modernized left-hand list (card-style items with hover "lift").
// - Cleaner detail pane layout with sections:
//    • Header + status pills
//    • Usage Limits card
//    • Sharing & Allowed Divisions/Bunks card
//    • Time Rules card
// - Logic for maxUsage, sharing, allowed bunks, and time rules unchanged.
// - Still uses global getters/setters from app1.js:
//      window.getGlobalSpecialActivities()
//      window.saveGlobalSpecialActivities(updatedArray)
// =================================================================

(function() {
'use strict';

let specialActivities = []; // Reference to global data
let selectedItemId = null;  // e.g., "special-Canteen"

let specialsListEl = null;
let detailPaneEl = null;
let addSpecialInput = null;

/**
 * Main entry point, called by index.html
 */
function initSpecialActivitiesTab() {
    const container = document.getElementById("special_activities");
    if (!container) return;

    // --- Load data from app1.js ---
    specialActivities = window.getGlobalSpecialActivities?.() || [];

    // Normalize shape
    specialActivities.forEach(s => {
        s.available   = s.available !== false;
        s.timeRules   = s.timeRules || [];
        s.sharableWith = s.sharableWith || { type: 'not_sharable', divisions: [] };
        s.limitUsage  = s.limitUsage || { enabled: false, divisions: {} };
        s.maxUsage    = s.maxUsage || 0; // 0 = unlimited
    });

    // Create UI shell
    container.innerHTML = `
        <div style="display: flex; flex-wrap: wrap; gap: 20px;">
        
            <div style="flex: 1; min-width: 300px;">
                <h3>Special Activities</h3>
                <p class="muted" style="margin-top:-6px; font-size:0.8rem;">
                    Create and manage camp-wide specials like Canteen, Trips, Color War events, etc.
                </p>
                
                <div style="display: flex; gap: 10px; margin-bottom: 14px; margin-top:8px;">
                    <input id="new-special-input"
                           placeholder="New Special (e.g., Canteen)"
                           style="flex: 1;">
                    <button id="add-special-btn">Add</button>
                </div>
                
                <h4 style="margin:10px 0 6px; font-size:0.9rem; color:#374151;">All Specials</h4>
                <div id="specials-master-list" class="master-list"></div>
            </div>
            
            <div style="flex: 2; min-width: 400px; position: sticky; top: 20px;">
                <h3>Details</h3>
                <div id="specials-detail-pane" class="detail-pane">
                    <p class="muted">
                        Select a special activity from the left to edit:
                        <br>• Availability &amp; max usages
                        <br>• Which divisions/bunks may use it
                        <br>• Time windows during the day
                    </p>
                </div>
            </div>
        </div>
        
        <style>
            /* Master list items: card-style, consistent with fields/setup vision */
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
            .master-list .pill-available {
                background: #dcfce7;
                color: #166534;
            }
            .master-list .pill-unavailable {
                background: #fee2e2;
                color: #b91c1c;
            }

            .master-list .list-item-toggle {
                margin-left: 4px;
            }

            /* Detail pane = soft card */
            #specials-detail-pane.detail-pane {
                border-radius: 14px;
                border: 1px solid #e5e7eb;
                background: #f9fafb;
                padding: 14px 16px 16px;
                box-shadow: 0 10px 24px rgba(15, 23, 42, 0.06);
                min-height: 380px;
            }

            .sa-section-card {
                border-radius: 12px;
                border: 1px solid #e5e7eb;
                background: #ffffff;
                padding: 10px 12px;
                margin-top: 10px;
                box-shadow: 0 4px 10px rgba(15, 23, 42, 0.04);
            }

            .sa-section-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 6px;
            }

            .sa-section-title {
                font-size: 0.82rem;
                text-transform: uppercase;
                letter-spacing: 0.06em;
                color: #6b7280;
                font-weight: 600;
            }

            .sa-section-tag {
                font-size: 0.7rem;
                padding: 2px 8px;
                border-radius: 999px;
                background: #eff6ff;
                color: #1d4ed8;
                font-weight: 500;
            }
        </style>
    `;

    // Element references
    specialsListEl   = document.getElementById("specials-master-list");
    detailPaneEl     = document.getElementById("specials-detail-pane");
    addSpecialInput  = document.getElementById("new-special-input");

    // Add special handlers
    document.getElementById("add-special-btn").onclick = addSpecial;
    addSpecialInput.onkeyup = (e) => { if (e.key === "Enter") addSpecial(); };

    renderMasterLists();
    renderDetailPane();
}

/**
 * Render left-hand list of specials
 */
function renderMasterLists() {
    specialsListEl.innerHTML = "";

    if (specialActivities.length === 0) {
        specialsListEl.innerHTML = `<p class="muted" style="font-size:0.8rem;">No special activities created yet.</p>`;
        return;
    }

    specialActivities.forEach(item => {
        specialsListEl.appendChild(createMasterListItem('special', item));
    });
}

/**
 * Create a single item card for the master list
 */
function createMasterListItem(type, item) {
    const el = document.createElement('div');
    el.className = 'list-item';
    const id = `${type}-${item.name}`;
    if (id === selectedItemId) {
        el.classList.add('selected');
    }

    el.onclick = () => {
        selectedItemId = id;
        renderMasterLists();
        renderDetailPane();
    };

    // Left side: name + small subtitle
    const main = document.createElement('div');
    main.className = 'list-item-main';

    const nameEl = document.createElement('span');
    nameEl.className = 'list-item-name';
    nameEl.textContent = item.name;
    main.appendChild(nameEl);

    const subEl = document.createElement('span');
    subEl.className = 'list-item-sub';
    const max = item.maxUsage || 0;
    const maxText = max === 0 ? "Unlimited usage" : `Max ${max} / bunk`;
    subEl.textContent = maxText;
    main.appendChild(subEl);

    el.appendChild(main);

    // Right side: availability pill + toggle
    const right = document.createElement('div');
    right.className = 'list-item-right';

    const pill = document.createElement('span');
    pill.className = 'pill ' + (item.available ? 'pill-available' : 'pill-unavailable');
    pill.textContent = item.available ? "Available" : "Unavailable";
    right.appendChild(pill);

    const tog = document.createElement("label");
    tog.className = "switch list-item-toggle";
    tog.title = "Available (Master)";
    tog.onclick = (e) => e.stopPropagation();

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = item.available;
    cb.onchange = (e) => {
        e.stopPropagation();
        item.available = cb.checked;
        window.saveGlobalSpecialActivities(specialActivities);
        renderMasterLists();
        renderDetailPane();
    };

    const sl = document.createElement("span");
    sl.className = "slider";

    tog.appendChild(cb);
    tog.appendChild(sl);

    right.appendChild(tog);
    el.appendChild(right);

    return el;
}

/**
 * Render the right-hand detail pane
 */
function renderDetailPane() {
    if (!selectedItemId) {
        detailPaneEl.innerHTML = `
            <p class="muted">
                Select a special activity from the left to edit its details.
            </p>`;
        return;
    }

    const [type, name] = selectedItemId.split(/-(.+)/);
    const item = specialActivities.find(f => f.name === name);

    if (!item) {
        selectedItemId = null;
        detailPaneEl.innerHTML = `<p style="color: red;">Error: Could not find item. Please select another.</p>`;
        return;
    }

    detailPaneEl.innerHTML = "";

    const onSave = () => window.saveGlobalSpecialActivities(specialActivities);
    const onRerender = renderDetailPane;

    // --- HEADER: Name + Delete ---
    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.borderBottom = '2px solid #e5e7eb';
    header.style.paddingBottom = '8px';
    header.style.marginBottom = '8px';

    const title = document.createElement('h3');
    title.style.margin = '0';
    title.style.fontSize = '1.05rem';
    title.textContent = item.name;

    makeEditable(title, newName => {
        if (!newName.trim()) return;
        item.name = newName.trim();
        selectedItemId = `${type}-${item.name}`;
        onSave();
        renderMasterLists();
        renderDetailPane();
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = 'Delete';
    deleteBtn.style.background = '#c0392b';
    deleteBtn.style.color = 'white';
    deleteBtn.onclick = () => {
        if (confirm(`Delete "${item.name}"?`)) {
            specialActivities = specialActivities.filter(s => s.name !== item.name);
            selectedItemId = null;
            window.saveGlobalSpecialActivities(specialActivities);
            renderMasterLists();
            renderDetailPane();
        }
    };

    header.appendChild(title);
    header.appendChild(deleteBtn);
    detailPaneEl.appendChild(header);

    // --- STATUS STRIP (Availability + Usage summary) ---
    const statusRow = document.createElement("div");
    statusRow.style.display = "flex";
    statusRow.style.flexWrap = "wrap";
    statusRow.style.gap = "8px";
    statusRow.style.marginBottom = "10px";

    const availBadge = document.createElement("span");
    availBadge.style.fontSize = "0.75rem";
    availBadge.style.padding = "3px 9px";
    availBadge.style.borderRadius = "999px";
    availBadge.style.fontWeight = "500";
    availBadge.style.background = item.available ? "#dcfce7" : "#fee2e2";
    availBadge.style.color = item.available ? "#166534" : "#b91c1c";
    availBadge.textContent = item.available ? "Globally Available" : "Globally Unavailable";
    statusRow.appendChild(availBadge);

    const max = item.maxUsage || 0;
    const usageBadge = document.createElement("span");
    usageBadge.style.fontSize = "0.75rem";
    usageBadge.style.padding = "3px 9px";
    usageBadge.style.borderRadius = "999px";
    usageBadge.style.fontWeight = "500";
    usageBadge.style.background = "#eef2ff";
    usageBadge.style.color = "#3730a3";
    usageBadge.textContent = max === 0 ? "Unlimited uses per bunk" : `Max ${max} uses per bunk`;
    statusRow.appendChild(usageBadge);

    detailPaneEl.appendChild(statusRow);

    // === CARD 1: USAGE LIMITS ===
    const usageCard = document.createElement("div");
    usageCard.className = "sa-section-card";

    const usageHeader = document.createElement("div");
    usageHeader.className = "sa-section-header";
    usageHeader.innerHTML = `
        <span class="sa-section-title">Usage Limits</span>
        <span class="sa-section-tag">Rotation &amp; fairness</span>
    `;
    usageCard.appendChild(usageHeader);

    const usageHelp = document.createElement("p");
    usageHelp.style.margin = "0 0 8px";
    usageHelp.style.fontSize = "0.78rem";
    usageHelp.style.color = "#6b7280";
    usageHelp.textContent = "Cap how many times each bunk can receive this special across the summer (0 = no cap).";
    usageCard.appendChild(usageHelp);

    const usageRow = document.createElement('div');
    usageRow.style.marginTop = "5px";
    usageRow.style.display = "flex";
    usageRow.style.alignItems = "center";
    usageRow.style.gap = "10px";

    const usageInput = document.createElement('input');
    usageInput.type = "number";
    usageInput.min = "0";
    usageInput.value = item.maxUsage || 0;
    usageInput.style.width = "70px";
    usageInput.onchange = (e) => {
        item.maxUsage = parseInt(e.target.value, 10) || 0;
        onSave();
        renderMasterLists();
        renderDetailPane();
    };

    const usageDesc = document.createElement('span');
    usageDesc.className = "muted";
    usageDesc.style.fontSize = "0.8em";
    usageDesc.textContent = "times per bunk (0 = unlimited)";

    usageRow.appendChild(usageInput);
    usageRow.appendChild(usageDesc);
    usageCard.appendChild(usageRow);

    detailPaneEl.appendChild(usageCard);

    // === CARD 2: SHARING + ALLOWED DIVISIONS/BUNKS ===
    const sharingCard = document.createElement("div");
    sharingCard.className = "sa-section-card";

    const sharingHeader = document.createElement("div");
    sharingHeader.className = "sa-section-header";
    sharingHeader.innerHTML = `
        <span class="sa-section-title">Who Can Use This Special</span>
        <span class="sa-section-tag">Sharing &amp; restrictions</span>
    `;
    sharingCard.appendChild(sharingHeader);

    const sharableControls = renderSharableControls(item, onSave, onRerender);
    sharableControls.style.marginTop = "4px";
    sharingCard.appendChild(sharableControls);

    const limitControls = renderAllowedBunksControls(item, onSave, onRerender);
    limitControls.style.marginTop = "8px";
    sharingCard.appendChild(limitControls);

    detailPaneEl.appendChild(sharingCard);

    // === CARD 3: TIME RULES ===
    const timeCard = document.createElement("div");
    timeCard.className = "sa-section-card";

    const timeHeader = document.createElement("div");
    timeHeader.className = "sa-section-header";
    timeHeader.innerHTML = `
        <span class="sa-section-title">Time Rules</span>
        <span class="sa-section-tag">Daily windows</span>
    `;
    timeCard.appendChild(timeHeader);

    const timeHelp = document.createElement("p");
    timeHelp.style.margin = "0 0 8px";
    timeHelp.style.fontSize = "0.78rem";
    timeHelp.style.color = "#6b7280";
    timeHelp.textContent = "Optionally mark times of day when this special is available or blocked.";
    timeCard.appendChild(timeHelp);

    const timeRuleControls = renderTimeRulesUI(item, onSave, onRerender);
    timeCard.appendChild(timeRuleControls);

    detailPaneEl.appendChild(timeCard);
}

// --- Add Special Function ---
function addSpecial() {
    const n = addSpecialInput.value.trim();
    if (!n) return;
    if (specialActivities.some(s => s.name.toLowerCase() === n.toLowerCase())) {
        alert("A special activity with this name already exists.");
        return;
    }
    specialActivities.push({
        name: n,
        available: true,
        maxUsage: 0, // unlimited
        sharableWith: { type: 'not_sharable', divisions: [] },
        limitUsage: { enabled: false, divisions: {} },
        timeRules: []
    });
    addSpecialInput.value = "";
    window.saveGlobalSpecialActivities(specialActivities);
    selectedItemId = `special-${n}`;
    renderMasterLists();
    renderDetailPane();
}

// =================================================================
// ===== HELPERS (same logic, nicer layout via parents) ============
// =================================================================

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
    if (Number.isNaN(hh) || Number.isNaN(mm) || mm < 0 || mm > 59) return null;
    if (mer) {
        if (hh === 12) hh = mer === "am" ? 0 : 12;
        else if (mer === "pm") hh += 12;
    }
    return hh * 60 + mm;
}

function makeEditable(el, save) {
    el.ondblclick = e => {
        e.stopPropagation();
        const old = el.textContent;
        const input = document.createElement("input");
        input.type = "text"; input.value = old;
        el.replaceWith(input); input.focus();
        function done() {
            const val = input.value.trim();
            if (val && val !== old) save(val);
            el.textContent = val || old; input.replaceWith(el);
        }
        input.onblur = done;
        input.onkeyup = e => { if (e.key === "Enter") done(); };
    };
}

function renderTimeRulesUI(item, onSave, onRerender) {
    const container = document.createElement("div");
    container.style.marginTop = "4px";

    if (!item.timeRules) {
        item.timeRules = [];
    }

    const ruleList = document.createElement("div");
    if (item.timeRules.length === 0) {
        ruleList.innerHTML = `<p class="muted" style="margin: 0;">No specific time rules. (Available all day)</p>`;
    }

    item.timeRules.forEach((rule, index) => {
        const ruleEl = document.createElement("div");
        ruleEl.style.margin = "3px 0";
        ruleEl.style.padding = "4px 6px";
        ruleEl.style.background = "#f3f4f6";
        ruleEl.style.borderRadius = "6px";
        
        const ruleType = document.createElement("strong");
        ruleType.textContent = rule.type;
        ruleType.style.color = rule.type === 'Available' ? 'green' : 'red';
        ruleType.style.textTransform = "capitalize";
        
        const ruleText = document.createElement("span");
        ruleText.textContent = ` from ${rule.start} to ${rule.end}`;
        
        const removeBtn = document.createElement("button");
        removeBtn.textContent = "✖";
        removeBtn.style.marginLeft = "8px";
        removeBtn.style.border = "none";
        removeBtn.style.background = "transparent";
        removeBtn.style.cursor = "pointer";
        removeBtn.onclick = () => {
            item.timeRules.splice(index, 1);
            onSave();
            onRerender();
        };
        
        ruleEl.appendChild(ruleType);
        ruleEl.appendChild(ruleText);
        ruleEl.appendChild(removeBtn);
        ruleList.appendChild(ruleEl);
    });
    container.appendChild(ruleList);

    const addContainer = document.createElement("div");
    addContainer.style.marginTop = "10px";
    addContainer.style.display = "flex";
    addContainer.style.flexWrap = "wrap";
    addContainer.style.gap = "6px";
    addContainer.style.alignItems = "center";
    
    const typeSelect = document.createElement("select");
    typeSelect.innerHTML = `
        <option value="Available">Available</option>
        <option value="Unavailable">Unavailable</option>
    `;
    
    const startInput = document.createElement("input");
    startInput.placeholder = "e.g., 9:00am";
    startInput.style.width = "100px";

    const toLabel = document.createElement("span");
    toLabel.textContent = "to";
    toLabel.style.fontSize = "0.8rem";
    toLabel.style.color = "#6b7280";

    const endInput = document.createElement("input");
    endInput.placeholder = "e.g., 10:30am";
    endInput.style.width = "100px";

    const addBtn = document.createElement("button");
    addBtn.textContent = "Add Rule";
    
    addBtn.onclick = () => {
        const type = typeSelect.value;
        const start = startInput.value;
        const end = endInput.value;
        
        if (!start || !end) {
            alert("Please enter a start and end time."); return;
        }
        if (parseTimeToMinutes(start) == null || parseTimeToMinutes(end) == null) {
            alert("Invalid time format. Use '9:00am' or '2:30pm'."); return;
        }
        if (parseTimeToMinutes(start) >= parseTimeToMinutes(end)) {
            alert("End time must be after start time."); return;
        }

        item.timeRules.push({ type, start, end });
        onSave();
        onRerender();
    };

    addContainer.appendChild(typeSelect);
    addContainer.appendChild(startInput);
    addContainer.appendChild(toLabel);
    addContainer.appendChild(endInput);
    addContainer.appendChild(addBtn);
    container.appendChild(addContainer);

    return container;
}

function renderSharableControls(item, onSave, onRerender) {
    const container = document.createElement("div");
    const rules = item.sharableWith || { type: 'not_sharable', divisions: [] };
    const isSharable = rules.type !== 'not_sharable';

    const label = document.createElement("div");
    label.style.display = "flex";
    label.style.alignItems = "center";
    label.style.gap = "8px";
    label.style.cursor = "pointer";
    label.style.marginTop = "4px";

    const tog = document.createElement("label");
    tog.className = "switch";
    tog.title = "Toggle Sharable";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = isSharable;
    cb.onchange = () => {
        if (cb.checked) { rules.type = 'all'; } 
        else { rules.type = 'not_sharable'; }
        rules.divisions = [];
        onSave();
        onRerender();
    };
    const sl = document.createElement("span"); 
    sl.className = "slider";
    tog.appendChild(cb);
    tog.appendChild(sl);

    const text = document.createElement("span");
    text.textContent = "Sharable across divisions";
    text.style.fontSize = "0.8rem";
    text.style.color = "#374151";

    label.appendChild(tog);
    label.appendChild(text);
    container.appendChild(label);

    if (isSharable) {
        const customPanel = document.createElement("div");
        customPanel.style.paddingLeft = "20px";
        customPanel.style.marginTop = "8px";
        const divLabel = document.createElement("div");
        divLabel.textContent = "Limit to specific divisions (optional):";
        divLabel.style.fontSize = "0.78rem";
        divLabel.style.color = "#6b7280";
        customPanel.appendChild(divLabel);

        const onDivToggle = () => {
            rules.type = (rules.divisions.length > 0) ? 'custom' : 'all';
            onSave();
            onRerender();
        };
        const divChipBox = createChipPicker(window.availableDivisions || [], rules.divisions, onDivToggle);
        customPanel.appendChild(divChipBox);
        container.appendChild(customPanel);
    }
    return container;
}

function createChipPicker(allItems, selectedItems, onToggle) {
    const chipBox = document.createElement("div");
    chipBox.style.display = "flex";
    chipBox.style.flexWrap = "wrap";
    chipBox.style.gap = "5px";
    chipBox.style.marginTop = "5px";

    allItems.forEach(name => {
        const chip = document.createElement("span");
        chip.textContent = name;
        chip.style.padding = "4px 8px";
        chip.style.borderRadius = "999px";
        chip.style.cursor = "pointer";
        chip.style.border = "1px solid #cbd5e1";
        chip.style.fontSize = "0.8rem";
        const isActive = selectedItems.includes(name);
        chip.style.backgroundColor = isActive ? "#2563eb" : "#f1f5f9";
        chip.style.color = isActive ? "white" : "#111827";
        chip.onclick = () => {
            const idx = selectedItems.indexOf(name);
            if (idx > -1) { selectedItems.splice(idx, 1); } 
            else { selectedItems.push(name); }
            onToggle();
        };
        chipBox.appendChild(chip);
    });
    return chipBox;
}

// =================================================================
// Allowed Bunks Controls (unchanged logic, nicer container above)
// =================================================================

function renderAllowedBunksControls(item, onSave, onRerender) {
    const container = document.createElement("div");
    container.style.marginTop = "8px";
    container.style.paddingTop = "8px";
    container.style.borderTop = "1px solid #e5e7eb";
    container.innerHTML = `<strong style="font-size:0.82rem;">Allowed Divisions &amp; Bunks:</strong>`;

    if (!item.limitUsage) {
        item.limitUsage = { enabled: false, divisions: {} };
    }
    const rules = item.limitUsage;

    // 1. Toggle between "All" vs "Specific"
    const modeLabel = document.createElement("label");
    modeLabel.style.display = "flex";
    modeLabel.style.alignItems = "center";
    modeLabel.style.gap = "10px";
    modeLabel.style.cursor = "pointer";
    modeLabel.style.marginTop = "6px";

    const textAll = document.createElement("span");
    textAll.textContent = "All divisions";
    textAll.style.fontSize = "0.8rem";

    const toggleTrack = document.createElement("span");
    Object.assign(toggleTrack.style, {
        width: "44px",
        height: "24px",
        borderRadius: "99px",
        position: "relative",
        display: "inline-block",
        border: "1px solid #d1d5db",
        backgroundColor: rules.enabled ? '#d1d5db' : '#22c55e',
        transition: "background-color 0.2s"
    });
    const toggleKnob = document.createElement("span");
    Object.assign(toggleKnob.style, {
        width: "20px",
        height: "20px",
        borderRadius: "50%",
        backgroundColor: "white",
        position: "absolute",
        top: "1px",
        left: rules.enabled ? '21px' : '1px',
        transition: "left 0.2s"
    });
    toggleTrack.appendChild(toggleKnob);

    const textLimit = document.createElement("span");
    textLimit.textContent = "Specific divisions/bunks";
    textLimit.style.fontSize = "0.8rem";

    textAll.style.fontWeight = rules.enabled ? 'normal' : '600';
    textLimit.style.fontWeight = rules.enabled ? '600' : 'normal';
    
    modeLabel.onclick = () => {
        rules.enabled = !rules.enabled;
        onSave();
        onRerender();
    };
    modeLabel.appendChild(textAll);
    modeLabel.appendChild(toggleTrack);
    modeLabel.appendChild(textLimit);
    container.appendChild(modeLabel);

    // 2. Specific rules panel
    if (rules.enabled) {
        const customPanel = document.createElement("div");
        customPanel.style.paddingLeft = "18px";
        customPanel.style.marginTop = "8px";
        customPanel.style.borderLeft = "3px solid #e5e7eb";
        
        const allDivisions = window.availableDivisions || [];
        if (allDivisions.length === 0) {
            customPanel.innerHTML += `<p class="muted" style="font-size:0.78rem;">No divisions found. Add divisions in Setup.</p>`;
        }

        allDivisions.forEach(divName => {
            const divWrapper = document.createElement("div");
            divWrapper.style.marginTop = "8px";
            
            const isAllowed = divName in rules.divisions;
            const allowedBunks = rules.divisions[divName] || [];
            
            const divChip = createLimitChip(divName, isAllowed, true);

            divChip.onclick = () => {
                if (isAllowed) {
                    delete rules.divisions[divName];
                } else {
                    rules.divisions[divName] = []; // empty array = "all bunks"
                }
                onSave();
                onRerender();
            };
            divWrapper.appendChild(divChip);

            if (isAllowed) {
                const bunkList = document.createElement("div");
                bunkList.style.display = "flex";
                bunkList.style.flexWrap = "wrap";
                bunkList.style.gap = "5px";
                bunkList.style.marginTop = "5px";
                bunkList.style.paddingLeft = "22px";
                
                const bunksInDiv = (window.divisions[divName]?.bunks || []);
                if (bunksInDiv.length === 0) {
                    bunkList.innerHTML = `<span class="muted" style="font-size: 0.78rem;">No bunks in this division.</span>`;
                }

                if (allowedBunks.length > 0) {
                    const allBunksChip = createLimitChip(`All ${divName}`, false, false);
                    allBunksChip.style.backgroundColor = "#f0f9ff";
                    allBunksChip.style.color = "#0369a1";
                    allBunksChip.style.borderColor = "#0ea5e9";
                    allBunksChip.onclick = () => {
                        rules.divisions[divName] = [];
                        onSave();
                        onRerender();
                    };
                    bunkList.appendChild(allBunksChip);
                }

                bunksInDiv.forEach(bunkName => {
                    const bunkChip = createLimitChip(bunkName, allowedBunks.includes(bunkName), false);
                    bunkChip.onclick = () => {
                        const bunkIdx = allowedBunks.indexOf(bunkName);
                        if (bunkIdx > -1) {
                            allowedBunks.splice(bunkIdx, 1);
                        } else {
                            allowedBunks.push(bunkName);
                        }
                        onSave();
                        onRerender();
                    };
                    bunkList.appendChild(bunkChip);
                });
                divWrapper.appendChild(bunkList);
            }
            customPanel.appendChild(divWrapper);
        });

        container.appendChild(customPanel);
    }
    return container;
}

function createLimitChip(name, isActive, isDivision = true) {
    const chip = document.createElement("span");
    chip.textContent = name;
    chip.style.padding = "4px 9px";
    chip.style.borderRadius = "999px";
    chip.style.cursor = "pointer";
    chip.style.border = "1px solid #cbd5e1";
    chip.style.fontSize = isDivision ? "0.8em" : "0.78em";
    const activeBG = isDivision ? "#2563eb" : "#22c55e";
    const activeColor = "white";
    const inactiveBG = isDivision ? "#f1f5f9" : "#f9fafb";
    const inactiveColor = "#111827";
    chip.style.backgroundColor = isActive ? activeBG : inactiveBG;
    chip.style.color = isActive ? activeColor : inactiveColor;
    chip.style.borderColor = isActive ? activeBG : "#cbd5e1";
    return chip;
}

// Expose init
window.initSpecialActivitiesTab = initSpecialActivitiesTab;

})();
