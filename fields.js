// =================================================================
// fields.js
//
// UPDATED: Refactored Detail Pane into a Tabbed Interface for better UX.
// logic and theme preserved exactly.
// =================================================================

(function() {
'use strict';

let fields = [];
let selectedItemId = null; // e.g., "field-Court 1"
let activeTab = 'activities'; // Default tab state

let fieldsListEl = null;
let detailPaneEl = null;
let addFieldInput = null;

/**
 * Main entry point
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
                            Add your courts, fields, and facilities. Then choose
                            which <strong>sports</strong> they host, who can use them,
                            and any <strong>time rules</strong> they follow.
                        </p>
                    </div>
                </div>

                <div style="display:flex; flex-wrap:wrap; gap:20px; margin-top:8px;">
                    <!-- LEFT: Fields list + add -->
                    <div style="flex:1; min-width:260px;">
                        <div class="setup-subtitle">All Fields</div>
                        <p style="font-size:0.8rem; color:#6b7280; margin-top:4px;">
                            Click a field to open its settings. Toggle availability or rename
                            directly from this list. Everything saves automatically.
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
                    <div style="flex:1.4; min-width:340px;">
                        <div class="setup-subtitle">Field Details</div>
                        <div id="fields-detail-pane" class="detail-pane"
                             style="margin-top:8px; min-height:400px;">
                            <p class="muted">
                                Select a field from the left to edit its details.
                            </p>
                        </div>
                    </div>
                </div>
            </section>
        </div>
        
        <style>
            /* Master list container */
            .master-list {
                border-radius: 18px;
                border: 1px solid #E5E7EB;
                background: #F7F9FA;
                padding: 8px 6px;
                box-shadow: 0 10px 24px rgba(15, 23, 42, 0.04);
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
                box-shadow: 0 4px 10px rgba(15, 23, 42, 0.05);
                transition: background 0.15s ease, box-shadow 0.15s ease, transform 0.08s ease;
            }
            .master-list .list-item:hover {
                background: #F3F4F6;
                box-shadow: 0 8px 18px rgba(15, 23, 42, 0.10);
                transform: translateY(-1px);
            }
            .master-list .list-item.selected {
                background: radial-gradient(circle at top left, #ECFDF5 0, #FFFFFF 70%);
                border-color: #00C896;
                box-shadow: 0 0 0 1px rgba(0, 200, 150, 0.55);
                font-weight: 600;
            }
            .master-list .list-item-name {
                flex-grow: 1;
                font-size: 0.88rem;
                font-weight: 500;
                color: #111827;
            }
            .master-list .list-item-toggle { margin-left: 10px; }

            /* Detail pane - Updated for Tabs */
            .detail-pane {
                border-radius: 18px;
                border: 1px solid #E5E7EB;
                padding: 0; /* Padding removed for full-width header/tabs */
                background: #FFFFFF;
                min-height: 400px;
                box-shadow: 0 18px 40px rgba(15, 23, 42, 0.06);
                display: flex;
                flex-direction: column;
                overflow: hidden;
            }
            
            /* Inner Content Padding */
            .detail-content {
                padding: 20px;
                background: linear-gradient(180deg, #F9FAFB 0%, #FFFFFF 100%);
                flex-grow: 1;
            }

            /* Tabs Styling */
            .detail-tabs {
                display: flex;
                border-bottom: 1px solid #E5E7EB;
                background: #FFFFFF;
                padding: 0 10px;
            }
            .detail-tab-btn {
                padding: 12px 16px;
                font-size: 0.85rem;
                font-weight: 600;
                color: #6B7280;
                background: transparent;
                border: none;
                border-bottom: 2px solid transparent;
                cursor: pointer;
                transition: all 0.2s;
            }
            .detail-tab-btn:hover { color: #111827; background: #F9FAFB; }
            .detail-tab-btn.active {
                color: #00C896;
                border-bottom-color: #00C896;
            }

            /* Section Cards inside Tabs */
            .field-section-card {
                border-radius: 16px;
                border: 1px solid #E5E7EB;
                background: #FFFFFF;
                padding: 16px;
                margin-bottom: 16px;
                box-shadow: 0 4px 12px rgba(15, 23, 42, 0.03);
            }
            .field-section-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                margin-bottom: 10px;
                font-size: 0.8rem;
                text-transform: uppercase;
                letter-spacing: 0.05em;
                color: #6B7280;
                border-bottom: 1px solid #F3F4F6;
                padding-bottom: 8px;
            }
            .field-section-title { font-weight: 700; color: #374151; }
            .field-section-tag {
                font-size: 0.7rem; padding: 2px 8px; border-radius: 999px;
                background: #ECFDF5; color: #047857; font-weight: 500;
            }
            
            /* Inputs & Modern Controls */
            .modern-input {
                border: 1px solid #D1D5DB; border-radius: 8px; padding: 6px 10px; font-size: 0.85rem;
                transition: border-color 0.2s;
            }
            .modern-input:focus { outline: none; border-color: #00C896; }

            .muted { color: #6B7280; font-size: 0.86rem; }
            
            /* Activity Buttons */
            .activity-button {
                background: #FFFFFF; border: 1px solid #E5E7EB; padding: 6px 12px;
                border-radius: 99px; font-size: 0.8rem; cursor: pointer;
                transition: all 0.2s; color: #374151;
            }
            .activity-button:hover { border-color: #D1D5DB; background: #F9FAFB; }
            .activity-button.active {
                background: #ECFDF5; border-color: #00C896; color: #065F46;
                font-weight: 600; box-shadow: 0 2px 5px rgba(0, 200, 150, 0.2);
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
        if (!f.sharableWith.capacity) f.sharableWith.capacity = 2;
        
        f.limitUsage = f.limitUsage || { enabled: false, divisions: {} };
        f.preferences = f.preferences || { enabled: false, exclusive: false, list: [] };

        f.transition = f.transition || {
            preMin: 0, postMin: 0, label: "Travel",
            zone: window.DEFAULT_ZONE_NAME, occupiesField: false, minDurationMin: 0
        };
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
        fieldsListEl.innerHTML = `<p class="muted" style="padding:10px;">No fields created yet.</p>`;
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
    
    // Tiny indicator if there is a zone or buffer
    if (item.transition && (item.transition.preMin > 0 || item.transition.postMin > 0)) {
        const dot = document.createElement('span');
        dot.style.height="6px"; dot.style.width="6px"; dot.style.borderRadius="50%";
        dot.style.background="#047857"; dot.style.display="inline-block";
        dot.style.marginLeft="6px"; dot.style.verticalAlign="middle";
        dot.title = "Has transition buffers";
        nameEl.appendChild(dot);
    }

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

// =================================================================
// MAIN UI REFACTOR: TABBED DETAIL PANE
// =================================================================

function renderDetailPane() {
    detailPaneEl.innerHTML = ""; // Clear existing

    if (!selectedItemId) {
        detailPaneEl.innerHTML = `
            <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; text-align:center; padding:20px; color:#9CA3AF;">
                <div style="font-size:2rem; margin-bottom:10px;">🏟️</div>
                <p>Select a field from the left to edit its details.</p>
            </div>`;
        return;
    }

    const [type, name] = selectedItemId.split(/-(.+)/); 
    const item = fields.find(f => f.name === name);

    if (!item) {
        selectedItemId = null;
        renderMasterLists();
        return;
    }
    
    // --- 1. HEADER (Fixed at top) ---
    const header = document.createElement('div');
    header.style.padding = '18px 20px 10px 20px';
    header.style.background = '#fff';
    
    const headerRow = document.createElement('div');
    headerRow.style.display = 'flex';
    headerRow.style.justifyContent = 'space-between';
    headerRow.style.alignItems = 'center';

    const title = document.createElement('h3');
    title.style.margin = '0';
    title.style.fontSize = '1.2rem';
    title.style.fontWeight = '700';
    title.style.color = '#111827';
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
    deleteBtn.style.cssText = "background:#FFF; color:#EF4444; border:1px solid #FECACA; padding:4px 12px; border-radius:99px; font-weight:600; font-size:0.75rem; cursor:pointer;";
    deleteBtn.onmouseenter = () => deleteBtn.style.background = '#FEF2F2';
    deleteBtn.onmouseleave = () => deleteBtn.style.background = '#FFF';
    deleteBtn.onclick = () => {
        if (confirm(`Delete "${item.name}"?`)) {
            fields = fields.filter(f => f.name !== item.name);
            selectedItemId = null;
            saveData();
            renderMasterLists();
            renderDetailPane();
        }
    };

    headerRow.appendChild(title);
    headerRow.appendChild(deleteBtn);
    header.appendChild(headerRow);

    // Availability Strip (Compact)
    const availStrip = document.createElement('div');
    availStrip.style.marginTop = "8px";
    availStrip.style.fontSize = "0.8rem";
    if (!item.available) {
        availStrip.innerHTML = `<span style="background:#FEF2F2; color:#B91C1C; padding:3px 8px; border-radius:4px; font-weight:600; border:1px solid #FECACA;">⚠️ Unavailable</span> <span class="muted"> - This field is hidden from the scheduler.</span>`;
    } else {
        availStrip.innerHTML = `<span style="color:#059669; font-weight:600;">● Active</span> <span class="muted" style="font-size:0.75rem;">(Visible to scheduler)</span>`;
    }
    header.appendChild(availStrip);
    detailPaneEl.appendChild(header);

    // --- 2. TABS NAVIGATION ---
    const tabsContainer = document.createElement('div');
    tabsContainer.className = 'detail-tabs';
    
    const tabs = [
        { id: 'activities', label: 'Activities' },
        { id: 'access', label: 'Access & Sharing' },
        { id: 'logistics', label: 'Logistics & Time' }
    ];

    tabs.forEach(t => {
        const btn = document.createElement('button');
        btn.className = `detail-tab-btn ${activeTab === t.id ? 'active' : ''}`;
        btn.textContent = t.label;
        btn.onclick = () => {
            activeTab = t.id;
            renderDetailPane(); // Re-render to switch view
        };
        tabsContainer.appendChild(btn);
    });
    detailPaneEl.appendChild(tabsContainer);

    // --- 3. TAB CONTENT AREA ---
    const contentArea = document.createElement('div');
    contentArea.className = 'detail-content';
    detailPaneEl.appendChild(contentArea);

    // Render specific tab content
    if (activeTab === 'activities') renderTabActivities(contentArea, item);
    else if (activeTab === 'access') renderTabAccess(contentArea, item);
    else if (activeTab === 'logistics') renderTabLogistics(contentArea, item);
}

// =================================================================
// TAB 1: ACTIVITIES (Cleaned Up)
// =================================================================
function renderTabActivities(container, item) {
    const allSports = window.getAllGlobalSports?.() || [];

    const card = document.createElement("div");
    card.className = "field-section-card";
    
    card.innerHTML = `
        <div class="field-section-header">
            <span class="field-section-title">Sports & Activities</span>
            <span class="field-section-tag">What happens here?</span>
        </div>
        <p class="muted" style="margin-bottom:12px;">Click to toggle activities supported by this field.</p>
    `;

    const btnWrapper = document.createElement("div"); 
    btnWrapper.style.display = 'flex';
    btnWrapper.style.flexWrap = 'wrap';
    btnWrapper.style.gap = '8px';
    
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
            // Only update buttons to avoid full re-render flickering
            b.classList.toggle("active");
        };
        btnWrapper.appendChild(b);
    });

    const other = document.createElement("input");
    other.className = "modern-input";
    other.placeholder = "+ Add new sport (Type & Enter)";
    other.style.marginTop = '12px';
    other.style.width = '100%';
    other.onkeyup = e => {
        if (e.key === "Enter" && other.value.trim()) {
            const newSport = other.value.trim();
            window.addGlobalSport?.(newSport);
            if (!item.activities.includes(newSport)) {
                item.activities.push(newSport);
                saveData();
            }
            other.value = "";
            renderDetailPane(); // Full render to update list
        }
    };

    card.appendChild(btnWrapper);
    card.appendChild(other);
    container.appendChild(card);
}

// =================================================================
// TAB 2: ACCESS & SHARING (Merged & Simplified)
// =================================================================
function renderTabAccess(container, item) {
    
    // --- PART A: RESTRICTIONS ---
    const restrictCard = document.createElement("div");
    restrictCard.className = "field-section-card";
    
    const rHeader = document.createElement("div");
    rHeader.className = "field-section-header";
    rHeader.innerHTML = `<span class="field-section-title">Who Can Use This?</span>`;
    restrictCard.appendChild(rHeader);

    // Use helper to render the complex restrictions UI
    const limitControls = renderAllowedBunksControls(item, saveData, renderDetailPane);
    restrictCard.appendChild(limitControls);
    container.appendChild(restrictCard);

    // --- PART B: SHARING ---
    const shareCard = document.createElement("div");
    shareCard.className = "field-section-card";
    
    const sHeader = document.createElement("div");
    sHeader.className = "field-section-header";
    sHeader.innerHTML = `<span class="field-section-title">Sharing & Capacity</span>`;
    shareCard.appendChild(sHeader);

    const sharingControls = renderSharableControls(item, saveData, renderDetailPane);
    shareCard.appendChild(sharingControls);
    container.appendChild(shareCard);
}

// =================================================================
// TAB 3: LOGISTICS (Time Rules & Transitions)
// =================================================================
function renderTabLogistics(container, item) {
    
    // --- PART A: TRANSITIONS ---
    const transCard = document.createElement("div");
    transCard.className = "field-section-card";
    
    transCard.innerHTML = `
        <div class="field-section-header">
            <span class="field-section-title">Buffer Zones & Travel</span>
            <span class="field-section-tag">Logistics</span>
        </div>
        <p class="muted" style="margin-bottom:10px;">Setup buffers to block time before/after events.</p>
    `;
    
    const tControls = renderTransitionControls(item.transition, saveData, () => {
        renderDetailPane();
        renderMasterLists(); // Update list dots
    });
    transCard.appendChild(tControls);
    container.appendChild(transCard);

    // --- PART B: OPENING HOURS ---
    const timeCard = document.createElement("div");
    timeCard.className = "field-section-card";
    
    timeCard.innerHTML = `
        <div class="field-section-header">
            <span class="field-section-title">Opening Hours</span>
        </div>
    `;

    const timeRuleControls = renderTimeRulesUI(item, saveData, renderDetailPane);
    timeCard.appendChild(timeRuleControls);
    container.appendChild(timeCard);
}

// =================================================================
// COMPONENT LOGIC (Preserved logic, slightly improved styling)
// =================================================================

function renderTransitionControls(transition, onSave, onRerender) {
    const container = document.createElement("div");
    
    container.innerHTML = `
        <div style="display:flex; align-items:flex-end; gap:15px; background:#F3F4F6; padding:10px; border-radius:10px;">
            <div>
                <label style="font-weight:600; font-size:0.75rem; color:#4B5563; display:block; margin-bottom:4px;">Pre (Min)</label>
                <input type="number" id="pre-min-input" value="${transition.preMin}" min="0" step="5" class="modern-input" style="width:60px;">
            </div>
            <div>
                <label style="font-weight:600; font-size:0.75rem; color:#4B5563; display:block; margin-bottom:4px;">Post (Min)</label>
                <input type="number" id="post-min-input" value="${transition.postMin}" min="0" step="5" class="modern-input" style="width:60px;">
            </div>
             <div style="flex-grow:1;">
                <label style="font-weight:600; font-size:0.75rem; color:#4B5563; display:block; margin-bottom:4px;">Label</label>
                <input type="text" id="buffer-label-input" value="${transition.label}" class="modern-input" style="width:100%;">
            </div>
        </div>

        <div style="margin-top:15px; display:grid; grid-template-columns: 1fr 1fr; gap:15px;">
            <div>
                <label style="font-weight:600; font-size:0.8rem;">Zone Location</label>
                <select id="zone-select" class="modern-input" style="width:100%; margin-top:5px;"></select>
                <p class="muted" style="font-size:0.7rem; margin-top:2px;">Needed for travel logic.</p>
            </div>
            <div>
                 <label style="font-weight:600; font-size:0.8rem;">Min Duration</label>
                 <div style="display:flex; align-items:center; gap:5px; margin-top:5px;">
                    <input type="number" id="min-duration-input" value="${transition.minDurationMin}" min="0" step="5" class="modern-input" style="width:70px;">
                    <span style="font-size:0.8rem;">min</span>
                 </div>
            </div>
        </div>

        <div style="margin-top:15px; padding-top:10px; border-top:1px dashed #E5E7EB;">
             <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                <input type="checkbox" id="occupies-field-check" ${transition.occupiesField ? 'checked' : ''} style="width:16px; height:16px;">
                <span style="font-size:0.85rem; font-weight:600; color:#374151;">Buffer Occupies Field</span>
            </label>
            <p class="muted" style="font-size:0.75rem; margin-top:2px; padding-left:24px;">
                If checked, field is busy during buffer (e.g., Setup). If unchecked, it's just travel time for the group.
            </p>
        </div>
    `;
    
    const zones = window.getZones?.() || {};
    const zoneSelect = container.querySelector('#zone-select');
    Object.values(zones).forEach(z => {
        const opt = document.createElement('option');
        opt.value = z.name;
        opt.textContent = z.name + (z.isDefault ? ' (Default)' : '');
        if (z.name === transition.zone) opt.selected = true;
        zoneSelect.appendChild(opt);
    });

    const updateTransition = () => {
        transition.preMin = parseInt(container.querySelector('#pre-min-input').value) || 0;
        transition.postMin = parseInt(container.querySelector('#post-min-input').value) || 0;
        transition.label = container.querySelector('#buffer-label-input').value.trim() || "Transition";
        transition.zone = container.querySelector('#zone-select').value;
        transition.occupiesField = container.querySelector('#occupies-field-check').checked;
        transition.minDurationMin = parseInt(container.querySelector('#min-duration-input').value) || 0;
        onSave();
        onRerender();
    };

    container.querySelectorAll('input, select').forEach(el => {
        el.onchange = updateTransition;
    });

    return container;
}

function renderAllowedBunksControls(item, onSave, onRerender) {
    const container = document.createElement("div");

    if (!item.limitUsage) { item.limitUsage = { enabled: false, divisions: {} }; }
    if (!item.preferences) { item.preferences = { enabled: false, exclusive: false, list: [] }; }

    const rules = item.limitUsage;
    const prefs = item.preferences;
    prefs.enabled = !!rules.enabled;

    // --- Mode Toggle ---
    const modeWrapper = document.createElement("div");
    modeWrapper.style.display = "flex";
    modeWrapper.style.marginBottom = "12px";
    modeWrapper.style.background = "#F3F4F6";
    modeWrapper.style.padding = "4px";
    modeWrapper.style.borderRadius = "8px";
    
    const btnOpen = document.createElement("button");
    btnOpen.textContent = "Open to All";
    btnOpen.style.flex = "1";
    btnOpen.style.padding = "6px";
    btnOpen.style.borderRadius = "6px";
    btnOpen.style.border = "none";
    btnOpen.style.fontSize = "0.85rem";
    btnOpen.style.cursor = "pointer";
    btnOpen.style.fontWeight = !rules.enabled ? "600" : "400";
    btnOpen.style.background = !rules.enabled ? "#FFFFFF" : "transparent";
    btnOpen.style.boxShadow = !rules.enabled ? "0 2px 4px rgba(0,0,0,0.05)" : "none";
    
    const btnRestricted = document.createElement("button");
    btnRestricted.textContent = "Restricted / Priority";
    btnRestricted.style.flex = "1";
    btnRestricted.style.padding = "6px";
    btnRestricted.style.borderRadius = "6px";
    btnRestricted.style.border = "none";
    btnRestricted.style.fontSize = "0.85rem";
    btnRestricted.style.cursor = "pointer";
    btnRestricted.style.fontWeight = rules.enabled ? "600" : "400";
    btnRestricted.style.background = rules.enabled ? "#FFFFFF" : "transparent";
    btnRestricted.style.boxShadow = rules.enabled ? "0 2px 4px rgba(0,0,0,0.05)" : "none";

    btnOpen.onclick = () => {
        if(rules.enabled) { rules.enabled = false; prefs.enabled = false; onSave(); onRerender(); }
    };
    btnRestricted.onclick = () => {
        if(!rules.enabled) { rules.enabled = true; prefs.enabled = true; onSave(); onRerender(); }
    };

    modeWrapper.appendChild(btnOpen);
    modeWrapper.appendChild(btnRestricted);
    container.appendChild(modeWrapper);

    if (rules.enabled) {
        // --- RESTRICTED UI ---
        
        // 1. Exclusive Checkbox
        const exclLabel = document.createElement("label");
        exclLabel.style.display = "flex";
        exclLabel.style.alignItems = "center";
        exclLabel.style.fontSize = "0.85rem";
        exclLabel.style.marginBottom = "10px";
        exclLabel.style.cursor = "pointer";
        exclLabel.innerHTML = `<input type="checkbox" ${!!prefs.exclusive ? 'checked' : ''} style="margin-right:8px;"> <strong>Strictly Exclusive</strong> (Others cannot use this even if free)`;
        exclLabel.querySelector("input").onchange = (e) => {
            prefs.exclusive = e.target.checked;
            onSave();
        };
        container.appendChild(exclLabel);

        // 2. Priority List
        const priorityBox = document.createElement("div");
        priorityBox.style.border = "1px solid #E5E7EB";
        priorityBox.style.borderRadius = "8px";
        priorityBox.style.padding = "10px";
        priorityBox.style.background = "#F9FAFB";
        priorityBox.style.marginBottom = "15px";

        priorityBox.innerHTML = `<div style="font-size:0.75rem; font-weight:700; color:#6B7280; text-transform:uppercase; margin-bottom:5px;">Priority Order</div>`;

        const ul = document.createElement("ul");
        ul.style.listStyle = "none"; ul.style.padding = "0"; ul.style.margin = "0";
        
        prefs.list = (prefs.list || []).filter(divName => rules.divisions.hasOwnProperty(divName));
        if(prefs.list.length === 0) {
            ul.innerHTML = `<li class="muted" style="font-size:0.8rem; font-style:italic;">No priority set. Select divisions below to add them.</li>`;
        }

        prefs.list.forEach((divName, idx) => {
            const li = document.createElement("li");
            li.style.cssText = "display:flex; justify-content:space-between; align-items:center; background:#FFF; border:1px solid #E5E7EB; padding:6px 10px; margin-bottom:4px; border-radius:6px; font-size:0.85rem;";
            li.innerHTML = `
                <span style="font-weight:600;">${idx + 1}. ${divName}</span>
                <div class="priority-controls" style="display:flex; gap:4px;">
                     <button data-action="up" ${idx === 0 ? 'disabled' : ''}>↑</button>
                     <button data-action="down" ${idx === prefs.list.length - 1 ? 'disabled' : ''}>↓</button>
                </div>
            `;
             li.querySelector('[data-action="up"]').onclick = () => {
                if (idx > 0) {
                    [prefs.list[idx - 1], prefs.list[idx]] = [prefs.list[idx], prefs.list[idx - 1]];
                    onSave(); onRerender();
                }
            };
            li.querySelector('[data-action="down"]').onclick = () => {
                if (idx < prefs.list.length - 1) {
                    [prefs.list[idx + 1], prefs.list[idx]] = [prefs.list[idx], prefs.list[idx + 1]];
                    onSave(); onRerender();
                }
            };
            ul.appendChild(li);
        });
        priorityBox.appendChild(ul);
        container.appendChild(priorityBox);

        // 3. Division Picker
        const pickerHeader = document.createElement("div");
        pickerHeader.textContent = "Click to Allow Division / Bunk:";
        pickerHeader.style.fontSize = "0.8rem";
        pickerHeader.style.fontWeight = "600";
        pickerHeader.style.marginBottom = "5px";
        container.appendChild(pickerHeader);

        const availableDivisions = window.availableDivisions || [];
        const chipContainer = document.createElement("div");
        
        availableDivisions.forEach(divName => {
            const isAllowed = divName in rules.divisions;
            const divChip = createLimitChip(divName, isAllowed, true);
            divChip.style.marginRight = "5px"; divChip.style.marginBottom = "5px"; divChip.style.display="inline-block";
            
            divChip.onclick = () => {
                if (isAllowed) {
                    delete rules.divisions[divName];
                    prefs.list = prefs.list.filter(d => d !== divName);
                } else {
                    rules.divisions[divName] = []; 
                    if(!prefs.list.includes(divName)) prefs.list.push(divName);
                }
                onSave(); onRerender();
            };
            chipContainer.appendChild(divChip);
        });
        container.appendChild(chipContainer);
    }

    return container;
}

function renderSharableControls(item, onSave, onRerender) {
    const container = document.createElement("div");
    
    if (!item.sharableWith) { item.sharableWith = { type: 'not_sharable', capacity: 2 }; }
    if (!item.sharableWith.capacity) { item.sharableWith.capacity = 2; }
    
    const rules = item.sharableWith;
    const isSharable = rules.type !== 'not_sharable';

    const topRow = document.createElement("div");
    topRow.style.display = "flex"; topRow.style.alignItems = "center"; topRow.style.justifyContent = "space-between";

    const tog = document.createElement("label");
    tog.className = "switch";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = isSharable;
    cb.onchange = () => {
        rules.type = cb.checked ? 'all' : 'not_sharable';
        rules.divisions = [];
        onSave(); onRerender();
    };
    const sl = document.createElement("span"); sl.className = "slider";
    tog.appendChild(cb); tog.appendChild(sl);
    
    const label = document.createElement("span");
    label.textContent = "Allow Concurrent Groups";
    label.style.fontWeight = "600"; label.style.fontSize = "0.85rem";

    topRow.appendChild(label);
    topRow.appendChild(tog);
    container.appendChild(topRow);

    if (isSharable) {
        const detailBox = document.createElement("div");
        detailBox.style.marginTop = "10px";
        detailBox.style.padding = "10px";
        detailBox.style.background = "#F0FDF4";
        detailBox.style.border = "1px solid #BBF7D0";
        detailBox.style.borderRadius = "8px";

        detailBox.innerHTML = `
            <div style="display:flex; align-items:center; gap:10px;">
                <span style="font-size:0.85rem;">Max Groups:</span>
                <input type="number" id="share-cap" value="${rules.capacity}" min="2" class="modern-input" style="width:60px;">
            </div>
        `;
        detailBox.querySelector("#share-cap").onchange = (e) => {
            const val = parseInt(e.target.value);
            rules.capacity = val >= 2 ? val : 2;
            onSave();
        };

        container.appendChild(detailBox);
    }

    return container;
}

function renderTimeRulesUI(item, onSave, onRerender) {
    const container = document.createElement("div");

    if (!item.timeRules) item.timeRules = [];

    const ruleList = document.createElement("div");
    if (item.timeRules.length === 0) {
        ruleList.innerHTML = `<p class="muted" style="margin: 4px 0 10px;">Available all day (Default).</p>`;
    } else {
        item.timeRules.forEach((rule, index) => {
            const ruleEl = document.createElement("div");
            ruleEl.style.cssText = "margin-bottom:6px; padding:6px 10px; background:#F9FAFB; border-radius:6px; display:flex; justify-content:space-between; align-items:center; border:1px solid #E5E7EB; font-size:0.85rem;";
            
            ruleEl.innerHTML = `
                <span>
                    <strong style="color:${rule.type === 'Available' ? '#16A34A' : '#DC2626'}">${rule.type}</strong>
                    ${rule.start} - ${rule.end}
                </span>
            `;
            const del = document.createElement("button");
            del.innerHTML = "&times;";
            del.style.cssText = "border:none; background:none; font-size:1.1rem; color:#9CA3AF; cursor:pointer;";
            del.onclick = () => {
                item.timeRules.splice(index, 1);
                onSave(); onRerender();
            };
            ruleEl.appendChild(del);
            ruleList.appendChild(ruleEl);
        });
    }
    container.appendChild(ruleList);

    // Add UI
    const addBox = document.createElement("div");
    addBox.style.display="flex"; addBox.style.gap="5px"; addBox.style.marginTop="5px";
    
    addBox.innerHTML = `
        <select id="tr-type" class="modern-input" style="padding:4px;"><option value="Available">Available</option><option value="Unavailable">Unavailable</option></select>
        <input id="tr-start" placeholder="9:00am" class="modern-input" style="width:70px; padding:4px;">
        <span style="align-self:center;">-</span>
        <input id="tr-end" placeholder="10:30am" class="modern-input" style="width:70px; padding:4px;">
        <button id="tr-add" style="background:#00C896; color:#FFF; border:none; border-radius:6px; padding:0 10px; cursor:pointer;">+</button>
    `;
    
    addBox.querySelector("#tr-add").onclick = () => {
        const type = addBox.querySelector("#tr-type").value;
        const start = addBox.querySelector("#tr-start").value;
        const end = addBox.querySelector("#tr-end").value;
        if(start && end) {
            item.timeRules.push({ type, start, end });
            onSave(); onRerender();
        }
    };

    container.appendChild(addBox);
    return container;
}

// --- Helpers ---

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

function addField() {
    const n = addFieldInput.value.trim();
    if (!n) return;
    if (fields.some(f => f.name.toLowerCase() === n.toLowerCase())) {
        alert("Name exists."); return;
    }
    fields.push({
        name: n, activities: [], available: true,
        sharableWith: { type: 'not_sharable', divisions: [], capacity: 2 },
        limitUsage: { enabled: false, divisions: {} },
        preferences: { enabled: false, exclusive: false, list: [] },
        transition: { preMin: 0, postMin: 0, label: "Travel", zone: window.DEFAULT_ZONE_NAME, occupiesField: false, minDurationMin: 0 }
    });
    addFieldInput.value = "";
    saveData();
    selectedItemId = `field-${n}`;
    renderMasterLists();
    renderDetailPane();
}

function makeEditable(el, save) {
    el.ondblclick = e => {
        e.stopPropagation();
        const old = el.textContent;
        const input = document.createElement("input");
        input.type = "text"; input.value = old;
        input.style.fontSize = "inherit"; input.style.fontWeight = "inherit";
        el.replaceWith(input); input.focus();
        function done() {
            const val = input.value.trim();
            if (val && val !== old) save(val);
            el.textContent = val || old; input.replaceWith(el);
        }
        input.onblur = done; input.onkeyup = e => { if (e.key === "Enter") done(); };
    };
}

function createLimitChip(name, isActive, isDivision = true) {
    const chip = document.createElement("span");
    chip.textContent = name;
    chip.style.padding = "4px 9px";
    chip.style.borderRadius = "999px";
    chip.style.cursor = "pointer";
    chip.style.border = "1px solid #CBD5E1";
    chip.style.fontSize = isDivision ? "0.82rem" : "0.78rem";
    const activeBG = isDivision ? "#00C896" : "#38BDF8"; 
    const activeColor = "#FFFFFF";
    const inactiveBG = isDivision ? "#F3F4F6" : "#F9FAFB";
    const inactiveColor = "#111827";
    chip.style.backgroundColor = isActive ? activeBG : inactiveBG;
    chip.style.color = isActive ? activeColor : inactiveColor;
    chip.style.boxShadow = isActive ? "0 3px 8px rgba(0, 200, 150, 0.35)" : "none";
    return chip;
}

window.initFieldsTab = initFieldsTab;
window.fields = fields;

})();
