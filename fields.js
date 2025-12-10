// =================================================================
// fields.js
//
// UPDATED: "Pro" Apple-Style UI.
// - Clean, minimalist aesthetic (No icons).
// - Logic fully preserved (Priority sorting, Min Duration, Labels included).
// - Simplified UX with Segmented Controls and Toggles.
// =================================================================

(function() {
'use strict';

let fields = [];
let selectedItemId = null; // e.g., "field-Court 1"
let activeTab = 'activities'; // Default tab state
let searchTerm = ""; 

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
                        <h3>Fields &amp; Facilities</h3>
                        <p>
                            Configure your sports facilities, manage availability, and set logistics.
                        </p>
                    </div>
                </div>

                <div style="display:flex; flex-wrap:wrap; gap:24px; margin-top:16px;">
                    <!-- LEFT: Sidebar -->
                    <div style="flex:1; min-width:260px; display:flex; flex-direction:column; border-right:1px solid #F3F4F6; padding-right:20px;">
                        
                        <div style="margin-bottom:12px;">
                             <input id="field-search" 
                                    placeholder="Search fields..." 
                                    class="ios-input" 
                                    style="width:100%;">
                        </div>

                        <div id="fields-master-list" class="master-list"
                             style="flex:1; min-height:300px; max-height:550px; overflow-y:auto; overflow-x:hidden;"></div>

                        <div class="setup-field-row" style="margin-top:12px; padding-top:12px; border-top:1px solid #F3F4F6;">
                            <input id="new-field-input"
                                   placeholder="Add New Field..."
                                   class="ios-input" style="flex:1;">
                            <button id="add-field-btn" class="ios-btn-primary">Add</button>
                        </div>
                    </div>

                    <!-- RIGHT: Detail pane -->
                    <div style="flex:2; min-width:380px;">
                        <div id="fields-detail-pane" class="detail-pane"
                             style="height:100%; min-height:450px;">
                            <!-- Content injected here -->
                        </div>
                    </div>
                </div>
            </section>
        </div>
        
        <style>
            /* --- iOS / Apple Style Base --- */
            .setup-card-wide { padding: 24px; }
            
            /* Inputs */
            .ios-input {
                border: 1px solid #E5E7EB; border-radius: 8px; padding: 8px 12px; font-size: 0.9rem;
                background: #F9FAFB; transition: all 0.2s ease;
                color: #111827; outline: none; width: 100%;
            }
            .ios-input:focus { border-color: #3B82F6; background: #FFF; box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1); }
            
            /* Buttons */
            .ios-btn-primary {
                background: #111827; color: white; border: none; padding: 8px 16px;
                border-radius: 8px; font-weight: 500; cursor: pointer; font-size: 0.85rem;
                transition: opacity 0.2s;
            }
            .ios-btn-primary:hover { opacity: 0.9; }

            .ios-btn-secondary {
                background: #FFF; color: #374151; border: 1px solid #D1D5DB; padding: 6px 12px;
                border-radius: 6px; font-weight: 500; cursor: pointer; font-size: 0.8rem;
            }
            .ios-btn-secondary:hover { background: #F9FAFB; }
            
            .ios-btn-danger { color: #EF4444; background: transparent; border: none; cursor: pointer; font-size: 0.9rem; }

            /* Master List */
            .master-list .list-item {
                padding: 10px 12px;
                border-radius: 8px;
                margin-bottom: 2px;
                cursor: pointer;
                display: flex;
                justify-content: space-between;
                align-items: center;
                transition: background 0.1s;
                color: #374151;
            }
            .master-list .list-item:hover { background: #F3F4F6; }
            .master-list .list-item.selected { background: #EFF6FF; color: #1D4ED8; font-weight: 500; }
            
            /* Toggle Switch (iOS Style) */
            .ios-toggle { position: relative; display: inline-block; width: 36px; height: 20px; flex-shrink: 0; }
            .ios-toggle input { opacity: 0; width: 0; height: 0; }
            .ios-slider {
                position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0;
                background-color: #E5E7EB; transition: .3s; border-radius: 20px;
            }
            .ios-slider:before {
                position: absolute; content: ""; height: 16px; width: 16px; left: 2px; bottom: 2px;
                background-color: white; transition: .3s; border-radius: 50%; box-shadow: 0 1px 2px rgba(0,0,0,0.2);
            }
            input:checked + .ios-slider { background-color: #10B981; }
            input:checked + .ios-slider:before { transform: translateX(16px); }

            /* Detail Pane Structure */
            .detail-pane { display: flex; flex-direction: column; }
            .detail-header { padding-bottom: 16px; border-bottom: 1px solid #F3F4F6; margin-bottom: 20px; }
            .detail-title { font-size: 1.5rem; font-weight: 700; color: #111827; letter-spacing: -0.02em; border:none; background:transparent; width:100%; outline:none;}
            .detail-title:focus { background:#F3F4F6; border-radius:4px;}

            /* Tabs (Text Only, Clean) */
            .tab-nav { display: flex; gap: 24px; border-bottom: 1px solid #E5E7EB; margin-bottom: 24px; }
            .tab-btn {
                padding: 10px 0; font-size: 0.9rem; font-weight: 500; color: #6B7280;
                background: none; border: none; cursor: pointer; position: relative;
            }
            .tab-btn.active { color: #111827; }
            .tab-btn.active::after {
                content: ''; position: absolute; bottom: -1px; left: 0; width: 100%;
                height: 2px; background: #111827;
            }

            /* Content Sections */
            .section-row { margin-bottom: 24px; }
            .section-label { font-size: 0.85rem; font-weight: 600; color: #111827; margin-bottom: 8px; display:block; }
            .section-desc { font-size: 0.8rem; color: #6B7280; margin-bottom: 12px; }

            /* Segmented Control */
            .segmented-control {
                display: flex; background: #F3F4F6; padding: 3px; border-radius: 8px; width: fit-content;
            }
            .segment-btn {
                padding: 6px 16px; border-radius: 6px; border: none; background: transparent;
                font-size: 0.85rem; font-weight: 500; color: #6B7280; cursor: pointer; transition: all 0.2s;
            }
            .segment-btn.active { background: #FFF; color: #111827; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }

            /* Tag/Chip */
            .pro-chip {
                display: inline-flex; align-items: center; padding: 6px 12px; border-radius: 99px;
                background: #FFF; border: 1px solid #E5E7EB; font-size: 0.85rem; color: #374151;
                cursor: pointer; transition: all 0.1s; margin: 0 6px 6px 0;
            }
            .pro-chip:hover { border-color: #D1D5DB; background: #F9FAFB; }
            .pro-chip.active { background: #111827; color: #FFF; border-color: #111827; }

            /* Priority List Item */
            .priority-item {
                display: flex; justify-content: space-between; align-items: center;
                background: #FFF; border-bottom: 1px solid #F3F4F6; padding: 10px 12px;
            }
            .priority-item:last-child { border-bottom: none; }
            .priority-btn { background: none; border: none; color: #6B7280; cursor: pointer; font-size: 1rem; padding: 0 4px; }
            .priority-btn:hover { color: #111827; }

            .empty-state { text-align: center; color: #9CA3AF; padding-top: 60px; }
        </style>
        `;

    fieldsListEl = document.getElementById("fields-master-list");
    detailPaneEl = document.getElementById("fields-detail-pane");
    addFieldInput = document.getElementById("new-field-input");
    const searchInput = document.getElementById("field-search");

    document.getElementById("add-field-btn").onclick = addField;
    addFieldInput.onkeyup = (e) => { if (e.key === "Enter") addField(); };
    searchInput.onkeyup = (e) => {
        searchTerm = e.target.value.toLowerCase();
        renderMasterLists();
    };

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

    let filtered = fields;
    if (searchTerm) {
        filtered = fields.filter(f => f.name.toLowerCase().includes(searchTerm));
    }

    if (filtered.length === 0) {
        fieldsListEl.innerHTML = `<div style="padding:20px; text-align:center; font-size:0.85rem; color:#9CA3AF;">No fields found.</div>`;
    }
    filtered.forEach(item => {
        fieldsListEl.appendChild(createMasterListItem(item));
    });
}

function createMasterListItem(item) {
    const el = document.createElement('div');
    el.className = 'list-item';
    const id = `field-${item.name}`;
    if (id === selectedItemId) el.classList.add('selected');
    
    el.onclick = () => {
        selectedItemId = id;
        renderMasterLists(); 
        renderDetailPane(); 
    };

    const nameSpan = document.createElement("span");
    nameSpan.textContent = item.name;
    
    if(!item.available) {
         nameSpan.style.opacity = "0.5";
         nameSpan.innerHTML += " (Off)";
    }

    el.appendChild(nameSpan);
    return el;
}

// =================================================================
// DETAIL PANE RENDERER
// =================================================================

function renderDetailPane() {
    detailPaneEl.innerHTML = ""; 

    if (!selectedItemId) {
        detailPaneEl.innerHTML = `
            <div class="empty-state">
                <p>Select a field to configure.</p>
            </div>`;
        return;
    }

    const [_, name] = selectedItemId.split(/-(.+)/); 
    const item = fields.find(f => f.name === name);

    if (!item) {
        selectedItemId = null;
        renderMasterLists();
        return;
    }
    
    // --- HEADER ---
    const header = document.createElement('div');
    header.className = 'detail-header';
    
    const topRow = document.createElement('div');
    topRow.style.display = 'flex'; topRow.style.justifyContent = 'space-between'; topRow.style.alignItems = 'flex-start';

    const titleInput = document.createElement('input');
    titleInput.className = 'detail-title';
    titleInput.value = item.name;
    titleInput.onblur = (e) => {
        const val = e.target.value.trim();
        if(val && val !== item.name) {
            item.name = val;
            selectedItemId = `field-${val}`;
            saveData(); renderMasterLists();
        } else { e.target.value = item.name; }
    };
    titleInput.onkeyup = (e) => { if(e.key === "Enter") titleInput.blur(); };
    
    // Global Toggle
    const toggleWrap = document.createElement("label");
    toggleWrap.style.display="flex"; toggleWrap.style.alignItems="center"; toggleWrap.style.gap="8px"; toggleWrap.style.cursor="pointer";
    const toggle = document.createElement("div"); toggle.className = "ios-toggle";
    const check = document.createElement("input"); check.type = "checkbox"; check.checked = item.available;
    const slider = document.createElement("span"); slider.className = "ios-slider";
    check.onchange = (e) => { item.available = e.target.checked; saveData(); renderMasterLists(); };
    toggle.appendChild(check); toggle.appendChild(slider);
    
    const toggleLabel = document.createElement("span");
    toggleLabel.textContent = "Active"; toggleLabel.style.fontSize="0.85rem"; toggleLabel.style.fontWeight="500";
    
    toggleWrap.appendChild(toggleLabel);
    toggleWrap.appendChild(toggle);

    // Delete Button (Subtle)
    const delBtn = document.createElement("button");
    delBtn.textContent = "Delete";
    delBtn.className = "ios-btn-danger";
    delBtn.style.marginLeft = "16px";
    delBtn.onclick = () => {
        if(confirm("Delete this field?")) {
            fields = fields.filter(f => f.name !== item.name);
            selectedItemId = null; saveData(); renderMasterLists(); renderDetailPane();
        }
    };

    const controls = document.createElement("div"); controls.style.display="flex"; controls.style.alignItems="center";
    controls.appendChild(toggleWrap);
    controls.appendChild(delBtn);

    topRow.appendChild(titleInput);
    topRow.appendChild(controls);
    header.appendChild(topRow);
    detailPaneEl.appendChild(header);

    // --- TABS ---
    const nav = document.createElement('nav');
    nav.className = 'tab-nav';
    ['activities', 'access', 'logistics'].forEach(tab => {
        const btn = document.createElement('button');
        btn.className = `tab-btn ${activeTab === tab ? 'active' : ''}`;
        btn.textContent = tab.charAt(0).toUpperCase() + tab.slice(1);
        btn.onclick = () => { activeTab = tab; renderDetailPane(); };
        nav.appendChild(btn);
    });
    detailPaneEl.appendChild(nav);

    // --- CONTENT ---
    const content = document.createElement('div');
    content.className = 'tab-content';
    if (activeTab === 'activities') renderActivities(content, item);
    else if (activeTab === 'access') renderAccess(content, item);
    else if (activeTab === 'logistics') renderLogistics(content, item);
    
    detailPaneEl.appendChild(content);
}

// =================================================================
// TAB 1: ACTIVITIES
// =================================================================
function renderActivities(container, item) {
    const allSports = window.getAllGlobalSports?.() || [];
    
    const section = document.createElement("div");
    section.className = "section-row";
    section.innerHTML = `
        <label class="section-label">Supported Sports</label>
        <p class="section-desc">Select the activities that can be scheduled on this field.</p>
    `;

    const chips = document.createElement("div");
    item.activities = item.activities || [];
    
    allSports.forEach(sport => {
        const chip = document.createElement("button");
        chip.className = `pro-chip ${item.activities.includes(sport) ? 'active' : ''}`;
        chip.textContent = sport;
        chip.onclick = () => {
            if(item.activities.includes(sport)) item.activities = item.activities.filter(s => s !== sport);
            else item.activities.push(sport);
            saveData();
            chip.classList.toggle('active');
        };
        chips.appendChild(chip);
    });
    
    // Add New
    const addWrap = document.createElement("div");
    addWrap.style.marginTop = "12px";
    addWrap.innerHTML = `<input class="ios-input" placeholder="Add custom sport..." style="width:200px;">`;
    const input = addWrap.querySelector("input");
    input.onkeyup = (e) => {
        if(e.key === "Enter" && input.value.trim()) {
            const val = input.value.trim();
            window.addGlobalSport?.(val);
            if(!item.activities.includes(val)) item.activities.push(val);
            saveData();
            renderDetailPane();
        }
    };
    
    section.appendChild(chips);
    section.appendChild(addWrap);
    container.appendChild(section);
}

// =================================================================
// TAB 2: ACCESS (Detailed)
// =================================================================
function renderAccess(container, item) {
    // Ensuring defaults
    if (!item.limitUsage) item.limitUsage = { enabled: false, divisions: {} };
    if (!item.preferences) item.preferences = { enabled: false, exclusive: false, list: [] };
    if (!item.sharableWith) item.sharableWith = { type: 'not_sharable', capacity: 2 };
    
    const rules = item.limitUsage;
    const prefs = item.preferences;
    const share = item.sharableWith;
    
    // --- 1. ACCESS CONTROL ---
    const accessSection = document.createElement("div");
    accessSection.className = "section-row";
    accessSection.innerHTML = `<label class="section-label">Access Level</label>`;
    
    const segControl = document.createElement("div");
    segControl.className = "segmented-control";
    
    const btnAll = document.createElement("button");
    btnAll.className = `segment-btn ${!rules.enabled ? 'active' : ''}`;
    btnAll.textContent = "Open to All";
    btnAll.onclick = () => {
        rules.enabled = false; prefs.enabled = false;
        saveData(); renderDetailPane();
    };

    const btnLimit = document.createElement("button");
    btnLimit.className = `segment-btn ${rules.enabled ? 'active' : ''}`;
    btnLimit.textContent = "Restricted";
    btnLimit.onclick = () => {
        rules.enabled = true; prefs.enabled = true;
        saveData(); renderDetailPane();
    };

    segControl.appendChild(btnAll);
    segControl.appendChild(btnLimit);
    accessSection.appendChild(segControl);
    
    if(rules.enabled) {
        const restrictPanel = document.createElement("div");
        restrictPanel.style.marginTop = "16px"; restrictPanel.style.padding = "16px";
        restrictPanel.style.background = "#F9FAFB"; restrictPanel.style.borderRadius = "8px";
        restrictPanel.style.border = "1px solid #E5E7EB";

        // Exclusive Toggle
        const exclWrap = document.createElement("label");
        exclWrap.style.display="flex"; exclWrap.style.alignItems="center"; exclWrap.style.marginBottom="16px"; exclWrap.style.gap="8px";
        const toggle = document.createElement("div"); toggle.className = "ios-toggle";
        const check = document.createElement("input"); check.type = "checkbox"; check.checked = !!prefs.exclusive;
        const slider = document.createElement("span"); slider.className = "ios-slider";
        check.onchange = (e) => { prefs.exclusive = e.target.checked; saveData(); };
        toggle.appendChild(check); toggle.appendChild(slider);
        exclWrap.appendChild(toggle);
        exclWrap.appendChild(document.createTextNode("Exclusive (Only selected groups can book)"));
        restrictPanel.appendChild(exclWrap);

        // Division Chips (Selection)
        const divLabel = document.createElement("div");
        divLabel.textContent = "Select Allowed Divisions:";
        divLabel.style.fontSize="0.8rem"; divLabel.style.fontWeight="600"; divLabel.style.marginBottom="8px";
        restrictPanel.appendChild(divLabel);

        const availableDivisions = window.availableDivisions || [];
        availableDivisions.forEach(divName => {
            const isAllowed = divName in rules.divisions;
            const chip = document.createElement("button");
            chip.className = `pro-chip ${isAllowed ? 'active' : ''}`;
            chip.textContent = divName;
            chip.onclick = () => {
                if(isAllowed) { 
                    delete rules.divisions[divName]; 
                    prefs.list = prefs.list.filter(d => d !== divName);
                } 
                else { 
                    rules.divisions[divName] = []; 
                    if (!prefs.list.includes(divName)) prefs.list.push(divName);
                }
                saveData(); renderDetailPane();
            };
            restrictPanel.appendChild(chip);
        });

        // Priority Sorting List (Re-implemented with better UI)
        if (prefs.list && prefs.list.length > 0) {
            const sortLabel = document.createElement("div");
            sortLabel.textContent = "Priority Order (Highest First):";
            sortLabel.style.fontSize="0.8rem"; sortLabel.style.fontWeight="600"; sortLabel.style.marginTop="16px"; sortLabel.style.marginBottom="8px";
            restrictPanel.appendChild(sortLabel);

            const sortList = document.createElement("div");
            sortList.style.border = "1px solid #E5E7EB"; sortList.style.borderRadius = "8px"; sortList.style.overflow = "hidden";
            
            // Sync prefs.list with allowed divisions
            prefs.list = prefs.list.filter(d => rules.divisions.hasOwnProperty(d));
            
            prefs.list.forEach((divName, idx) => {
                const row = document.createElement("div");
                row.className = "priority-item";
                row.innerHTML = `<span style="font-size:0.85rem; font-weight:500;">${idx+1}. ${divName}</span>`;
                
                const controls = document.createElement("div");
                const upBtn = document.createElement("button"); upBtn.innerHTML = "↑"; upBtn.className = "priority-btn";
                const downBtn = document.createElement("button"); downBtn.innerHTML = "↓"; downBtn.className = "priority-btn";
                
                upBtn.onclick = () => {
                    if (idx > 0) {
                        [prefs.list[idx-1], prefs.list[idx]] = [prefs.list[idx], prefs.list[idx-1]];
                        saveData(); renderDetailPane();
                    }
                };
                downBtn.onclick = () => {
                    if (idx < prefs.list.length - 1) {
                        [prefs.list[idx+1], prefs.list[idx]] = [prefs.list[idx], prefs.list[idx+1]];
                        saveData(); renderDetailPane();
                    }
                };
                
                if (idx === 0) upBtn.disabled = true;
                if (idx === prefs.list.length - 1) downBtn.disabled = true;
                
                controls.appendChild(upBtn);
                controls.appendChild(downBtn);
                row.appendChild(controls);
                sortList.appendChild(row);
            });
            restrictPanel.appendChild(sortList);
        }
        
        accessSection.appendChild(restrictPanel);
    }
    container.appendChild(accessSection);

    // --- 2. SHARING ---
    const shareSection = document.createElement("div");
    shareSection.className = "section-row";
    shareSection.style.borderTop = "1px solid #F3F4F6"; shareSection.style.paddingTop = "24px";
    
    shareSection.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center;">
            <div>
                <label class="section-label">Concurrent Events</label>
                <div class="section-desc" style="margin:0;">Allow multiple groups to use this field at the same time?</div>
            </div>
            <label class="ios-toggle">
                <input type="checkbox" id="share-toggle" ${share.type !== 'not_sharable' ? 'checked' : ''}>
                <span class="ios-slider"></span>
            </label>
        </div>
    `;
    
    const toggleInput = shareSection.querySelector("#share-toggle");
    toggleInput.onchange = (e) => {
        share.type = e.target.checked ? 'all' : 'not_sharable';
        saveData(); renderDetailPane();
    };

    if (share.type !== 'not_sharable') {
        const capacityRow = document.createElement("div");
        capacityRow.style.marginTop = "12px";
        capacityRow.style.display = "flex"; capacityRow.style.alignItems = "center"; capacityRow.style.gap = "12px";
        
        capacityRow.innerHTML = `
            <span style="font-size:0.9rem;">Max Concurrent Groups:</span>
            <input type="number" value="${share.capacity}" min="2" class="ios-input" style="width:60px;">
        `;
        capacityRow.querySelector("input").onchange = (e) => {
            share.capacity = parseInt(e.target.value) || 2; saveData();
        };
        shareSection.appendChild(capacityRow);
    }
    
    container.appendChild(shareSection);
}

// =================================================================
// TAB 3: LOGISTICS (Clean Form with restored logic)
// =================================================================
function renderLogistics(container, item) {
    const trans = item.transition;
    
    // --- BUFFERS ---
    const bufSection = document.createElement("div");
    bufSection.className = "section-row";
    
    bufSection.innerHTML = `<label class="section-label">Travel & Setup Buffers (Minutes)</label>`;
    
    const grid = document.createElement("div");
    grid.style.display = "grid"; grid.style.gridTemplateColumns = "1fr 1fr"; grid.style.gap = "16px";
    
    // Pre/Post Inputs
    grid.innerHTML = `
        <div>
            <span style="font-size:0.8rem; color:#6B7280; display:block; margin-bottom:4px;">Before Event (Travel To)</span>
            <input type="number" id="pre-min" value="${trans.preMin}" min="0" step="5" class="ios-input" style="width:100%;">
        </div>
        <div>
            <span style="font-size:0.8rem; color:#6B7280; display:block; margin-bottom:4px;">After Event (Travel From)</span>
            <input type="number" id="post-min" value="${trans.postMin}" min="0" step="5" class="ios-input" style="width:100%;">
        </div>
    `;
    
    grid.querySelector("#pre-min").onchange = (e) => { trans.preMin = parseInt(e.target.value)||0; saveData(); };
    grid.querySelector("#post-min").onchange = (e) => { trans.postMin = parseInt(e.target.value)||0; saveData(); };
    bufSection.appendChild(grid);

    // Buffer Label (Restored)
    const labelRow = document.createElement("div");
    labelRow.style.marginTop = "12px";
    labelRow.innerHTML = `
        <span style="font-size:0.8rem; color:#6B7280; display:block; margin-bottom:4px;">Buffer Reason (Label)</span>
        <input type="text" id="buf-label" value="${trans.label}" class="ios-input" style="width:100%;">
    `;
    labelRow.querySelector("#buf-label").onchange = (e) => { trans.label = e.target.value || "Travel"; saveData(); };
    bufSection.appendChild(labelRow);

    // Occupy Toggle
    const occRow = document.createElement("div");
    occRow.style.marginTop = "12px"; occRow.style.display="flex"; occRow.style.alignItems="center"; occRow.style.gap="8px";
    const toggle = document.createElement("div"); toggle.className = "ios-toggle";
    const check = document.createElement("input"); check.type = "checkbox"; check.checked = trans.occupiesField;
    const slider = document.createElement("span"); slider.className = "ios-slider";
    check.onchange = (e) => { trans.occupiesField = e.target.checked; saveData(); };
    toggle.appendChild(check); toggle.appendChild(slider);
    
    occRow.appendChild(toggle);
    occRow.appendChild(document.createTextNode("Buffers block the field (e.g. Setup time)"));
    occRow.style.fontSize = "0.85rem";
    bufSection.appendChild(occRow);
    
    container.appendChild(bufSection);

    // --- LOGISTICS (Zone & Min Duration) ---
    const metaSection = document.createElement("div");
    metaSection.className = "section-row";
    metaSection.style.borderTop = "1px solid #F3F4F6"; metaSection.style.paddingTop = "24px";

    const metaGrid = document.createElement("div");
    metaGrid.style.display = "grid"; metaGrid.style.gridTemplateColumns = "1fr 1fr"; metaGrid.style.gap = "16px";

    // Zone
    const zoneWrapper = document.createElement("div");
    zoneWrapper.innerHTML = `<label class="section-label">Location Zone</label>`;
    const select = document.createElement("select");
    select.className = "ios-input";
    const zones = window.getZones?.() || {};
    Object.values(zones).forEach(z => {
        const opt = document.createElement("option");
        opt.value = z.name; opt.textContent = z.name;
        if(z.name === trans.zone) opt.selected = true;
        select.appendChild(opt);
    });
    select.onchange = (e) => { trans.zone = e.target.value; saveData(); };
    zoneWrapper.appendChild(select);

    // Min Duration (Restored)
    const minDurWrapper = document.createElement("div");
    minDurWrapper.innerHTML = `<label class="section-label">Min Duration</label>`;
    const durInput = document.createElement("input");
    durInput.type = "number"; durInput.value = trans.minDurationMin; durInput.min = "0"; durInput.step = "5"; durInput.className = "ios-input";
    durInput.onchange = (e) => { trans.minDurationMin = parseInt(e.target.value) || 0; saveData(); };
    minDurWrapper.appendChild(durInput);

    metaGrid.appendChild(zoneWrapper);
    metaGrid.appendChild(minDurWrapper);
    metaSection.appendChild(metaGrid);
    
    container.appendChild(metaSection);

    // --- OPENING HOURS ---
    const timeSection = document.createElement("div");
    timeSection.className = "section-row";
    timeSection.style.borderTop = "1px solid #F3F4F6"; timeSection.style.paddingTop = "24px";
    
    timeSection.innerHTML = `
        <label class="section-label">Availability Exceptions</label>
        <div class="section-desc">Default is Available 24/7. Add rules to restrict times.</div>
    `;
    
    const ruleList = document.createElement("div");
    item.timeRules.forEach((r, idx) => {
        const row = document.createElement("div");
        row.style.background = "#FFF"; row.style.border = "1px solid #E5E7EB"; row.style.padding = "8px 12px";
        row.style.borderRadius = "6px"; row.style.marginBottom = "8px"; row.style.display="flex"; row.style.justifyContent="space-between";
        row.innerHTML = `<span>${r.type}: ${r.start} - ${r.end}</span> <span style="cursor:pointer; color:#EF4444;">&times;</span>`;
        row.querySelector("span:last-child").onclick = () => { item.timeRules.splice(idx, 1); saveData(); renderDetailPane(); };
        ruleList.appendChild(row);
    });
    
    // Simple Add
    const addRow = document.createElement("div");
    addRow.style.display="flex"; addRow.style.gap="8px";
    addRow.innerHTML = `
        <select id="new-rule-type" class="ios-input"><option>Available</option><option>Unavailable</option></select>
        <input id="new-rule-start" placeholder="9:00am" class="ios-input" style="width:80px;">
        <input id="new-rule-end" placeholder="5:00pm" class="ios-input" style="width:80px;">
        <button id="add-rule-btn" class="ios-btn-secondary">Add</button>
    `;
    addRow.querySelector("#add-rule-btn").onclick = () => {
        const type = addRow.querySelector("#new-rule-type").value;
        const start = addRow.querySelector("#new-rule-start").value;
        const end = addRow.querySelector("#new-rule-end").value;
        if(start && end) { item.timeRules.push({type, start, end}); saveData(); renderDetailPane(); }
    };
    
    timeSection.appendChild(ruleList);
    timeSection.appendChild(addRow);
    container.appendChild(timeSection);
}

// --- Init ---
window.initFieldsTab = initFieldsTab;
window.fields = fields;

})();
