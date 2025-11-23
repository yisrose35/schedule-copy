// =================================================================
// fields.js
//
// RESTORED: Original UI layout (Header, Status Box, Chip Pickers).
// FIXED: Uncaught ReferenceError by correctly accessing window.availableDivisions.
// ENHANCED: Merged Priority and Restriction UIs into one clean, organized panel.
// UPDATED: Visual design to match modern Setup/Config theme
//          - card-style master list
//          - sticky detail pane
//          - softer borders, shadows, and pill-like chips.
// =================================================================

(function() {
'use strict';

let fields = [];
let selectedItemId = null; // e.g., "field-Court 1"

let fieldsListEl = null;
let detailPaneEl = null;
let addFieldInput = null;

/**
 * Main entry point, called by index.html
 */
function initFieldsTab() {
    const container = document.getElementById("fields");
    if (!container) return;
    
    loadData();

    container.innerHTML = `
        <div class="setup-grid">
            <section class="setup-card setup-card-wide">
                <div class="setup-card-header">
                    <span class="setup-step-pill">Fields</span>
                    <div class="setup-card-text">
                        <h3>Manage Fields &amp; Activities</h3>
                        <p>
                            Add your physical locations (courts, fields, gyms), then choose
                            which <strong>sports/activities</strong> can be played on each,
                            and configure <strong>sharing</strong> &amp; <strong>time rules</strong>.
                        </p>
                    </div>
                </div>

                <div style="display:flex; flex-wrap:wrap; gap:20px; margin-top:8px;">
                    <!-- LEFT: Fields list + add -->
                    <div style="flex:1; min-width:260px;">
                        <div class="setup-subtitle">All Fields</div>
                        <p style="font-size:0.8rem; color:#6b7280; margin-top:4px;">
                            Click a field to edit its details. Toggle availability or update the name
                            inline. All changes save automatically.
                        </p>

                        <div class="setup-field-row" style="margin-top:10px;">
                            <input id="new-field-input"
                                   placeholder="New Field (e.g., Court 1)">
                            <button id="add-field-btn">Add Field</button>
                        </div>

                        <div id="fields-master-list" class="master-list"
                             style="margin-top:10px; max-height:440px; overflow:auto;"></div>
                    </div>

                    <!-- RIGHT: Detail pane -->
                    <div style="flex:1.3; min-width:320px;">
                        <div class="setup-subtitle">Field Details</div>
                        <div id="fields-detail-pane" class="detail-pane"
                             style="margin-top:8px; min-height:360px;">
                            <p class="muted">
                                Select a field from the left to edit its details:
                                <br>• Toggle if it’s <strong>available</strong> for scheduling
                                <br>• Assign which <strong>sports/activities</strong> can use it
                                <br>• Configure <strong>sharing rules</strong> between divisions
                                <br>• Add <strong>time rules</strong> (e.g. only mornings)
                            </p>
                        </div>
                    </div>
                </div>
            </section>
        </div>
        
        <style>
            /* Master list container – card-like shell */
            .master-list {
                border-radius: 12px;
                border: 1px solid #e5e7eb;
                background: #f9fafb;
                padding: 8px 6px;
            }

            .master-list .list-item {
                padding: 10px 10px;
                border-radius: 10px;
                margin-bottom: 6px;
                cursor: pointer;
                display: flex;
                justify-content: space-between;
                align-items: center;
                background: #ffffff;
                border: 1px solid #e5e7eb;
                box-shadow: 0 3px 8px rgba(15, 23, 42, 0.04);
                transition: background 0.15s ease,
                            box-shadow 0.15s ease,
                            transform 0.07s ease,
                            border-color 0.15s ease;
            }
            .master-list .list-item:hover {
                background: #f3f4f6;
                box-shadow: 0 6px 14px rgba(15, 23, 42, 0.08);
                transform: translateY(-1px);
            }
            .master-list .list-item.selected {
                background: #e0f2fe;
                border-color: #38bdf8;
                box-shadow: 0 0 0 1px rgba(56, 189, 248, 0.6);
                font-weight: 600;
            }
            .master-list .list-item-name {
                flex-grow: 1;
                font-size: 0.88rem;
                font-weight: 500;
                color: #111827;
            }
            .master-list .list-item-toggle {
                margin-left: 10px;
            }

            /* Detail pane – shared card look with Setup tab */
            .detail-pane {
                border-radius: 14px;
                border: 1px solid #e5e7eb;
                padding: 16px 18px;
                background: #ffffff;
                min-height: 400px;
                box-shadow: 0 10px 24px rgba(15, 23, 42, 0.06);
            }

            /* Priority list row styling */
            .priority-list-item {
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 6px 8px;
                border-radius: 8px;
                border: 1px solid #e5e7eb;
                margin-bottom: 4px;
                background: #f9fafb;
            }
            .priority-controls button {
                background: none;
                border: 1px solid #cbd5e1;
                border-radius: 6px;
                padding: 2px 6px;
                cursor: pointer;
                font-size: 0.8rem;
            }
            .priority-controls button:disabled {
                opacity: 0.4;
                cursor: default;
            }
        </style>
    `;

    fieldsListEl = document.getElementById("fields-master-list");
    detailPaneEl = document.getElementById("fields-detail-pane");
    addFieldInput = document.getElementById("new-field-input");

    document.getElementById("add-field-btn").onclick = addField;
    addFieldInput.onkeyup = (e) => { if (e.key === "Enter") addField(); };

    renderMasterLists();
    renderDetailPane();
}

function loadData() {
    const app1Data = window.loadGlobalSettings?.().app1 || {};
    fields = app1Data.fields || [];
    
    fields.forEach(f => {
        f.available = f.available !== false;
        f.timeRules = f.timeRules || [];
        f.sharableWith = f.sharableWith || { type: 'not_sharable', divisions: [] };
        f.limitUsage = f.limitUsage || { enabled: false, divisions: {} };
        
        f.preferences = f.preferences || { enabled: false, exclusive: false, list: [] };
    });
}

function saveData() {
    const app1Data = window.loadGlobalSettings?.().app1 || {};
    app1Data.fields = fields;
    window.saveGlobalSettings?.("app1", app1Data);
}

function renderMasterLists() {
    fieldsListEl.innerHTML = "";

    if (fields.length === 0) {
        fieldsListEl.innerHTML = `<p class="muted">No fields created yet.</p>`;
    }
    fields.forEach(item => {
        fieldsListEl.appendChild(createMasterListItem('field', item));
    });
}

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

    const nameEl = document.createElement('span');
    nameEl.className = 'list-item-name';
    nameEl.textContent = item.name;
    el.appendChild(nameEl);

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
        saveData(); 
        renderDetailPane(); 
    };
    
    const sl = document.createElement("span"); 
    sl.className = "slider";
    
    tog.appendChild(cb); 
    tog.appendChild(sl);
    el.appendChild(tog);

    return el;
}

function renderDetailPane() {
    if (!selectedItemId) {
        detailPaneEl.innerHTML = `<p class="muted">Select a field from the left to edit its details.</p>`;
        return;
    }

    const [type, name] = selectedItemId.split(/-(.+)/); 
    const item = fields.find(f => f.name === name);

    if (!item) {
        selectedItemId = null;
        detailPaneEl.innerHTML = `<p style="color: red;">Error: Could not find item. Please select another.</p>`;
        return;
    }
    
    const allSports = window.getAllGlobalSports?.() || [];

    detailPaneEl.innerHTML = ""; 
    
    // --- 1. Name & Delete ---
    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.borderBottom = '2px solid #f3f4f6';
    header.style.paddingBottom = '10px';
    header.style.marginBottom = '15px';
    
    const title = document.createElement('h3');
    title.style.margin = '0';
    title.textContent = item.name;
    makeEditable(title, newName => {
        if (!newName.trim()) return;
        item.name = newName;
        selectedItemId = `${type}-${newName}`; 
        saveData();
        renderMasterLists(); 
    });
    
    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = 'Delete';
    deleteBtn.style.background = '#c0392b';
    deleteBtn.style.color = 'white';
    deleteBtn.style.border = 'none';
    deleteBtn.style.padding = '6px 10px';
    deleteBtn.style.borderRadius = '4px';
    deleteBtn.onclick = () => {
        if (confirm(`Are you sure you want to delete "${item.name}"?`)) {
            fields = fields.filter(f => f.name !== item.name);
            selectedItemId = null;
            saveData();
            renderMasterLists();
            renderDetailPane();
        }
    };
    header.appendChild(title);
    header.appendChild(deleteBtn);
    detailPaneEl.appendChild(header);
    
    // --- 2. Master Toggle (Restored) ---
    const masterToggle = document.createElement('div');
    masterToggle.style.background = item.available ? '#e8f5e9' : '#fbe9e7';
    masterToggle.style.padding = '10px';
    masterToggle.style.borderRadius = '8px';
    masterToggle.style.marginBottom = '15px';
    masterToggle.style.fontSize = '0.85rem';
    masterToggle.textContent = `This item is globally ${item.available ? 'AVAILABLE' : 'UNAVAILABLE'}. (Toggle in list view)`;
    detailPaneEl.appendChild(masterToggle);

    // --- 3. Activities ---
    const actSection = document.createElement('div');
    actSection.innerHTML = `<strong>Activities on this field:</strong>`;
    
    const bw = document.createElement("div"); 
    bw.style.marginTop = "8px";
    bw.style.display = 'flex';
    bw.style.flexWrap = 'wrap';
    bw.style.gap = '5px';
    
    item.activities = item.activities || [];
    allSports.forEach(act => {
        const b = document.createElement("button"); 
        b.textContent = act; 
        b.className = "activity-button";
        if (item.activities.includes(act)) b.classList.add("active");
        b.onclick = () => {
            if (item.activities.includes(act)) {
                item.activities = item.activities.filter(a => a !== act);
            } else {
                item.activities.push(act);
            }
            saveData(); 
            renderDetailPane(); 
        };
        bw.appendChild(b);
    });
    
    const other = document.createElement("input");
    other.placeholder = "Add new sport type";
    other.style.marginTop = '6px';
    other.style.width = '220px';
    other.onkeyup = e => {
        if (e.key === "Enter" && other.value.trim()) {
            const newSport = other.value.trim();
            window.addGlobalSport?.(newSport);
            if (!item.activities.includes(newSport)) {
                item.activities.push(newSport);
                saveData();
            }
            other.value = "";
            renderDetailPane();
        }
    };
    
    actSection.appendChild(bw);
    actSection.appendChild(other);
    detailPaneEl.appendChild(actSection);

    // --- 4. Sharable ---
    const sharableControls = renderSharableControls(item, saveData, renderDetailPane);
    sharableControls.style.borderTop = '1px solid #f3f4f6';
    sharableControls.style.paddingTop = '15px';
    sharableControls.style.marginTop = '15px';
    detailPaneEl.appendChild(sharableControls);
    
    // --- 5. Allowed Divisions/Bunks + Priority/Exclusive (COMBINED) ---
    const limitControls = renderAllowedBunksControls(item, saveData, renderDetailPane);
    detailPaneEl.appendChild(limitControls);
    
    // --- 6. Time Rules ---
    const timeRuleControls = renderTimeRulesUI(item, saveData, renderDetailPane);
    timeRuleControls.style.marginTop = "10px";
    timeRuleControls.style.paddingTop = "10px";
    timeRuleControls.style.borderTop = "1px solid #f3f4f6";
    detailPaneEl.appendChild(timeRuleControls);
}

// --- Add Field Function ---
function addField() {
    const n = addFieldInput.value.trim();
    if (!n) return;
    if (fields.some(f => f.name.toLowerCase() === n.toLowerCase())) {
        alert("A field with this name already exists.");
        return;
    }
    fields.push({
        name: n,
        activities: [],
        available: true,
        sharableWith: { type: 'not_sharable', divisions: [] },
        limitUsage: { enabled: false, divisions: {} },
        preferences: { enabled: false, exclusive: false, list: [] }, // Default
        timeRules: []
    });
    addFieldInput.value = "";
    saveData();
    selectedItemId = `field-${n}`;
    renderMasterLists();
    renderDetailPane();
}

// =================================================================
// ===== HELPERS (UI Functions) =====
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
        input.onblur = done; input.onkeyup = e => { if (e.key === "Enter") done(); };
    };
}

function renderTimeRulesUI(item, onSave, onRerender) {
    const container = document.createElement("div");
    container.innerHTML = `<strong>Global Time Rules:</strong>`;

    if (!item.timeRules) {
        item.timeRules = [];
    }

    const ruleList = document.createElement("div");
    if (item.timeRules.length === 0) {
        ruleList.innerHTML = `<p class="muted" style="margin: 0;">No specific time rules. (Available all day)</p>`;
    }

    item.timeRules.forEach((rule, index) => {
        const ruleEl = document.createElement("div");
        ruleEl.style.margin = "2px 0";
        ruleEl.style.padding = "4px";
        ruleEl.style.background = "#f4f4f4";
        ruleEl.style.borderRadius = "4px";
        
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
    
    const typeSelect = document.createElement("select");
    typeSelect.innerHTML = `
        <option value="Available">Available</option>
        <option value="Unavailable">Unavailable</option>
    `;
    
    const startInput = document.createElement("input");
    startInput.placeholder = "e.g., 9:00am";
    startInput.style.width = "100px";
    startInput.style.marginLeft = "5px";

    const toLabel = document.createElement("span");
    toLabel.textContent = " to ";
    toLabel.style.margin = "0 5px";

    const endInput = document.createElement("input");
    endInput.placeholder = "e.g., 10:30am";
    endInput.style.width = "100px";

    const addBtn = document.createElement("button");
    addBtn.textContent = "Add Rule";
    addBtn.style.marginLeft = "8px";
    
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
    container.innerHTML = `<strong>Sharing Rules:</strong>`;
    const rules = item.sharableWith || { type: 'not_sharable' };
    const isSharable = rules.type !== 'not_sharable';

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
    const sl = document.createElement("span"); sl.className = "slider";
    tog.appendChild(cb); tog.appendChild(sl);
    const togLabel = document.createElement("span");
    togLabel.textContent = "Sharable";
    const shareWrap = document.createElement("label");
    shareWrap.style.display="flex";
    shareWrap.style.alignItems="center";
    shareWrap.style.gap="5px";
    shareWrap.style.cursor="pointer";
    shareWrap.style.marginTop = '5px';
    shareWrap.appendChild(tog);
    shareWrap.appendChild(togLabel);
    container.appendChild(shareWrap);

    if (isSharable) {
        const customPanel = document.createElement("div");
        customPanel.style.paddingLeft = "20px";
        customPanel.style.marginTop = "10px";
        const divLabel = document.createElement("div");
        divLabel.textContent = "Limit to Divisions (if none selected, sharable with all):";
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
        chip.style.borderRadius = "12px";
        chip.style.cursor = "pointer";
        chip.style.border = "1px solid #ccc";
        const isActive = selectedItems.includes(name);
        chip.style.backgroundColor = isActive ? "#007BFF" : "#f0f0f0";
        chip.style.color = isActive ? "white" : "black";
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

function renderAllowedBunksControls(item, onSave, onRerender) {
    const container = document.createElement("div");
    container.style.marginTop = "10px";
    container.style.paddingTop = "10px";
    container.style.borderTop = "1px solid #f3f4f6";
    container.innerHTML = `<strong>Division Restrictions & Priority:</strong>`;

    if (!item.limitUsage) { item.limitUsage = { enabled: false, divisions: {} }; }
    if (!item.preferences) { item.preferences = { enabled: false, exclusive: false, list: [] }; }

    const rules = item.limitUsage;
    const prefs = item.preferences;
    prefs.enabled = !!rules.enabled;

    // --- 1. Master Toggle (All vs Specific) ---
    const modeLabel = document.createElement("label");
    modeLabel.style.display = "flex";
    modeLabel.style.alignItems = "center";
    modeLabel.style.gap = "10px";
    modeLabel.style.cursor = "pointer";
    modeLabel.style.marginTop = '5px';

    const textAll = document.createElement("span");
    textAll.textContent = "All Divisions (No Restrictions)";
    const toggleTrack = document.createElement("span");
    Object.assign(toggleTrack.style, {
        "width": "44px", "height": "24px", "borderRadius": "99px", "position": "relative",
        "display": "inline-block", "border": "1px solid #ccc",
        "backgroundColor": rules.enabled ? '#d1d5db' : '#22c55e',
        "transition": "background-color 0.2s"
    });
    const toggleKnob = document.createElement("span");
    Object.assign(toggleKnob.style, {
        "width": "20px", "height": "20px", "borderRadius": "50%", "backgroundColor": "white",
        "position": "absolute", "top": "1px", "left": rules.enabled ? '21px' : '1px',
        "transition": "left 0.2s"
    });
    toggleTrack.appendChild(toggleKnob);
    const textLimit = document.createElement("span");
    textLimit.textContent = "Specific Restrictions/Priority";
    
    textAll.style.fontWeight = rules.enabled ? 'normal' : 'bold';
    textLimit.style.fontWeight = rules.enabled ? 'bold' : 'normal';
    
    modeLabel.onclick = () => {
        rules.enabled = !rules.enabled;
        prefs.enabled = rules.enabled;
        onSave();
        onRerender();
    };
    modeLabel.appendChild(textAll);
    modeLabel.appendChild(toggleTrack);
    modeLabel.appendChild(textLimit);
    container.appendChild(modeLabel);

    if (rules.enabled) {
        const customPanel = document.createElement("div");
        customPanel.style.padding = "15px 0";
        customPanel.style.borderTop = "1px solid #f0f0f0";
        
        // --- 2. Priority and Exclusive Toggle ---
        const prioritySettings = document.createElement("div");
        prioritySettings.style.cssText = "background:#f9fafb; padding:10px; border-radius:8px; border:1px solid #e5e7eb; margin-bottom:15px;";
        
        // Exclusive Mode
        const exclDiv = document.createElement("div");
        const exclLabel = document.createElement("label");
        exclLabel.style.cursor = "pointer";
        exclLabel.style.display = "flex";
        exclLabel.style.alignItems = "center";
        exclLabel.innerHTML = `<input type="checkbox" ${!!prefs.exclusive ? 'checked' : ''} style="margin-right:6px;"> <strong>Exclusive Mode:</strong> Only Divisions/Bunks listed below can use this field.`;
        exclLabel.querySelector("input").onchange = (e) => {
            prefs.exclusive = e.target.checked;
            onSave();
        };
        exclDiv.appendChild(exclLabel);
        prioritySettings.appendChild(exclDiv);

        // --- Priority List (Visible when enabled) ---
        const listHeader = document.createElement("div");
        listHeader.textContent = "Division Priority List (top = highest priority):";
        listHeader.style.marginTop = "10px";
        listHeader.style.fontWeight = "600";
        listHeader.style.fontSize = "0.8rem";
        prioritySettings.appendChild(listHeader);

        const priorityListContainer = document.createElement("ul");
        priorityListContainer.style.cssText = "list-style:none; padding:0; margin-top:5px;";
        
        // Render Priority List Items
        prefs.list = (prefs.list || []).filter(divName => rules.divisions.hasOwnProperty(divName));
        prefs.list.forEach((divName, idx) => {
            const li = document.createElement("li");
            li.className = "priority-list-item";

            li.innerHTML = `
                <span style="font-weight:bold; width: 30px; text-align:center;">#${idx + 1}</span>
                <span style="flex-grow:1;">${divName}</span>
                <div class="priority-controls">
                    <button data-action="up" data-div="${divName}" ${idx === 0 ? 'disabled' : ''}>↑</button>
                    <button data-action="down" data-div="${divName}" ${idx === prefs.list.length - 1 ? 'disabled' : ''}>↓</button>
                    <button data-action="rem" data-div="${divName}" style="color:#b91c1c; border-color:#fecaca;">x</button>
                </div>
            `;
            
            li.querySelector('[data-action="up"]').onclick = () => {
                if (idx > 0) {
                    [prefs.list[idx - 1], prefs.list[idx]] = [prefs.list[idx], prefs.list[idx - 1]];
                    onSave();
                    onRerender();
                }
            };
            li.querySelector('[data-action="down"]').onclick = () => {
                if (idx < prefs.list.length - 1) {
                    [prefs.list[idx + 1], prefs.list[idx]] = [prefs.list[idx], prefs.list[idx + 1]];
                    onSave();
                    onRerender();
                }
            };
            li.querySelector('[data-action="rem"]').onclick = () => {
                prefs.list = prefs.list.filter(d => d !== divName);
                onSave();
                onRerender();
            };

            priorityListContainer.appendChild(li);
        });

        prioritySettings.appendChild(priorityListContainer);

        // --- Add to Priority Dropdown ---
        const priorityAddRow = document.createElement("div");
        priorityAddRow.style.cssText = "margin-top:10px; padding-top:8px; border-top:1px dashed #e5e7eb; display:flex; gap:6px;";
        
        const select = document.createElement("select");
        select.innerHTML = `<option value="">-- Add Division to Priority --</option>`;
        Object.keys(rules.divisions).forEach(divName => {
            if (!prefs.list.includes(divName)) {
                select.innerHTML += `<option value="${divName}">${divName}</option>`;
            }
        });

        const addBtn = document.createElement("button");
        addBtn.textContent = "Add";
        addBtn.onclick = () => {
            if (select.value) {
                prefs.list.push(select.value);
                onSave();
                onRerender();
            }
        };
        priorityAddRow.appendChild(select);
        priorityAddRow.appendChild(addBtn);
        prioritySettings.appendChild(priorityAddRow);
        
        customPanel.appendChild(prioritySettings);

        // --- 3. Allowed Divisions/Bunks Chips ---
        const allowedHeader = document.createElement("div");
        allowedHeader.style.cssText = "margin-top:15px; font-weight:600; border-top:1px solid #eee; padding-top:10px; font-size:0.85rem;";
        allowedHeader.textContent = "Select Allowed Divisions & Per-Bunk Restrictions:";
        customPanel.appendChild(allowedHeader);
        
        const availableDivisions = window.availableDivisions || []; 

        // --- Division/Bunk Chips ---
        availableDivisions.forEach(divName => {
            const divWrapper = document.createElement("div");
            divWrapper.style.marginTop = "8px";
            
            const isAllowed = divName in rules.divisions;
            const allowedBunks = rules.divisions[divName] || [];
            
            const divChip = createLimitChip(divName, isAllowed, true);
            
            divChip.onclick = () => {
                if (isAllowed) {
                    delete rules.divisions[divName];
                    prefs.list = prefs.list.filter(d => d !== divName); // Remove from Priority List
                } else {
                    rules.divisions[divName] = []; 
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
                bunkList.style.paddingLeft = "25px";
                
                const bunksInDiv = (window.divisions[divName]?.bunks || []);
                if (bunksInDiv.length === 0) {
                    bunkList.innerHTML = `<span class="muted" style="font-size: 0.8rem;">No bunks in this division.</span>`;
                }

                if (allowedBunks.length > 0) {
                    const allBunksChip = createLimitChip(`All ${divName}`, false, false);
                    allBunksChip.style.backgroundColor = "#f3f4f6";
                    allBunksChip.style.color = "#2563eb";
                    allBunksChip.style.borderColor = "#93c5fd";
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
    chip.style.fontSize = isDivision ? "0.82rem" : "0.78rem";
    const activeBG = isDivision ? "#2563eb" : "#38bdf8"; 
    const activeColor = "white";
    const inactiveBG = isDivision ? "#f3f4f6" : "#f9f9f9";
    const inactiveColor = "#111827";
    chip.style.backgroundColor = isActive ? activeBG : inactiveBG;
    chip.style.color = isActive ? activeColor : inactiveColor;
    chip.style.borderColor = isActive ? activeBG : "#cbd5e1";
    return chip;
}

window.initFieldsTab = initFieldsTab;

})();
