// =================================================================
// special_activities.js  — Modern Pro Camp THEMED VERSION
//
// ✦ UPDATE: Added Transition, Buffer Occupancy, Zone, and Min Duration.
// ✦ UPDATE: Added "Priority & Exclusive Mode" (Restrictions).
// ✦ UPDATE: Added "Sharing Capacity" (Max Bunks at Once).
// =================================================================

(function() {
'use strict';

let specialActivities = [];
let selectedItemId = null;

let specialsListEl = null;
let detailPaneEl = null;
let addSpecialInput = null;

/*********************************************************
 * INIT TAB
 *********************************************************/
function initSpecialActivitiesTab() {
    const container = document.getElementById("special_activities");
    if (!container) return;

    specialActivities = window.getGlobalSpecialActivities?.() || [];

    // ensure data completeness
    specialActivities.forEach(s => {
        s.available = s.available !== false;
        s.timeRules = s.timeRules || [];
        s.sharableWith = s.sharableWith || { type: 'not_sharable', divisions: [] };
        
        // Ensure default capacity is set if sharable
        if (!s.sharableWith.capacity) s.sharableWith.capacity = 2;

        s.limitUsage = s.limitUsage || { enabled: false, divisions: {} };
        // Ensure maxUsage is number or null
        s.maxUsage = (s.maxUsage !== undefined && s.maxUsage !== "") ? s.maxUsage : null;
        // Ensure frequency is set (default 0 = lifetime/unlimited period)
        s.frequencyWeeks = s.frequencyWeeks || 0; 
        
        // Priority Preferences (From Fields)
        s.preferences = s.preferences || { enabled: false, exclusive: false, list: [] };

        // Transition fields
        s.transition = s.transition || {
            preMin: 0,
            postMin: 0,
            label: "Change Time",
            zone: window.DEFAULT_ZONE_NAME,
            occupiesField: true, // Defaults to true for specials like Canteen/Pool
            minDurationMin: 0 
        };
    });

    // ==== THEMED HTML SHELL ====<
    container.innerHTML = `
        <div class="setup-grid">

            <section class="setup-card setup-card-wide">

                <div class="setup-card-header">
                    <span class="setup-step-pill">Specials</span>
                    <div class="setup-card-text">
                        <h3>Special Activities & Rotations</h3>
                        <p>
                            Add canteen, electives, trips, lakes, buses, and control
                            availability, sharing, division access, and rotation rules.
                        </p>
                    </div>
                </div>

                <div style="display:flex; flex-wrap:wrap; gap:22px; margin-top:10px;">

                    <div style="flex:1; min-width:260px;">
                        <div class="setup-subtitle">All Specials</div>
                        <p style="font-size:0.8rem; color:#6b7280;">
                            Click a special to edit its rules.
                        </p>

                        <div class="setup-field-row" style="margin-top:10px;">
                            <input id="new-special-input" placeholder="New Special (e.g., Canteen)">
                            <button id="add-special-btn">Add Special</button>
                        </div>

                        <div id="specials-master-list"
                             class="master-list"
                             style="margin-top:10px; max-height:460px; overflow:auto;">
                        </div>
                    </div>

                    <div style="flex:1.3; min-width:330px;">
                        <div class="setup-subtitle">Special Details</div>
                        <div id="specials-detail-pane"
                             class="detail-pane"
                             style="margin-top:10px; min-height:380px;">
                            <p class="muted">Select a special to begin.</p>
                        </div>
                    </div>

                </div>
            </section>
        </div>

        <style>
            .master-list {
                border-radius: 18px;
                border: 1px solid #E5E7EB;
                background: #F8FAFC;
                padding: 6px 6px;
                box-shadow: 0 8px 20px rgba(15,23,42,0.06);
            }
            .master-list .list-item {
                padding: 10px 12px;
                border-radius: 14px;
                margin-bottom: 6px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                cursor: pointer;

                background: #ffffff;
                border: 1px solid #e5e7eb;
                box-shadow: 0 3px 8px rgba(15,23,42,0.05);
                transition: 0.15s ease;
            }
            .master-list .list-item:hover {
                background: #f1f5f9;
                transform: translateY(-1px);
            }
            .master-list .list-item.selected {
                background: radial-gradient(circle at top left, #ECFDF5, #ffffff 70%);
                border-color: #00C896;
                box-shadow: 0 0 0 2px rgba(0,200,150,0.45);
                font-weight: 600;
            }

            .detail-pane {
                border-radius: 18px;
                border: 1px solid #E5E7EB;
                padding: 20px 22px;
                background: radial-gradient(circle at top left, #F0F9FF 0%, #FFFFFF 55%, #F8FAFC 100%);
                box-shadow: 0 14px 36px rgba(15,23,42,0.08);
            }

            .muted { color:#6b7280; font-size:0.86rem; }

            /* Priority list row styling (From Fields) */
            .priority-list-item {
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 6px 8px;
                border-radius: 10px;
                border: 1px solid #E5E7EB;
                margin-bottom: 4px;
                background: #F9FAFB;
            }
            .priority-controls button {
                background: #FFFFFF;
                border: 1px solid #CBD5E1;
                border-radius: 8px;
                padding: 2px 6px;
                cursor: pointer;
                font-size: 0.8rem;
                box-shadow: 0 2px 5px rgba(15, 23, 42, 0.06);
            }
            .priority-controls button:hover:not(:disabled) {
                border-color: #00C896;
            }
            .priority-controls button:disabled {
                opacity: 0.4;
                cursor: default;
                box-shadow: none;
            }
        </style>
    `;

    specialsListEl = document.getElementById("specials-master-list");
    detailPaneEl   = document.getElementById("specials-detail-pane");
    addSpecialInput = document.getElementById("new-special-input");

    document.getElementById("add-special-btn").onclick = addSpecial;
    addSpecialInput.onkeyup = e => { if (e.key === "Enter") addSpecial(); };

    renderMasterLists();
    renderDetailPane();
}

/*********************************************************
 * LEFT LIST
 *********************************************************/
function renderMasterLists() {
    specialsListEl.innerHTML = "";
    if (specialActivities.length === 0) {
        specialsListEl.innerHTML = `<p class="muted">No special activities yet.</p>`;
    }
    specialActivities.forEach(item => {
        specialsListEl.appendChild(createMasterListItem('special', item));
    });
}

function createMasterListItem(type, item) {
    const el = document.createElement('div');
    el.className = 'list-item';

    const id = `${type}-${item.name}`;
    if (id === selectedItemId) el.classList.add('selected');

    el.onclick = () => {
        selectedItemId = id;
        renderMasterLists();
        renderDetailPane();
    };

    const nameEl = document.createElement('span');
    nameEl.className = 'list-item-name';
    nameEl.textContent = item.name;
    
    // Show Transition status
    if (item.transition.preMin > 0 || item.transition.postMin > 0) {
        const span = document.createElement('span');
        span.textContent = ` (${item.transition.preMin}m / ${item.transition.postMin}m)`;
        span.style.fontSize = '0.7rem';
        span.style.color = '#047857';
        span.style.fontWeight = 'normal';
        nameEl.appendChild(span);
    }

    el.appendChild(nameEl);

    // switch
    const tog = document.createElement("label");
    tog.className = "switch list-item-toggle";
    tog.onclick = e => e.stopPropagation();

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = item.available;

    cb.onchange = e => {
        e.stopPropagation();
        item.available = cb.checked;
        window.saveGlobalSpecialActivities(specialActivities);
        renderDetailPane();
    };

    const slider = document.createElement("span");
    slider.className = "slider";

    tog.appendChild(cb);
    tog.appendChild(slider);
    el.appendChild(tog);

    return el;
}

/*********************************************************
 * DETAIL PANE
 *********************************************************/
function renderDetailPane() {
    if (!selectedItemId) {
        detailPaneEl.innerHTML = `<p class="muted">Select a special.</p>`;
        return;
    }

    const [type, name] = selectedItemId.split(/-(.+)/);
    const item = specialActivities.find(f => f.name === name);

    if (!item) {
        selectedItemId = null;
        detailPaneEl.innerHTML = `<p style="color:red;">Error.</p>`;
        return;
    }

    detailPaneEl.innerHTML = "";
    const onSave = () => window.saveGlobalSpecialActivities(specialActivities);
    const onRerender = () => renderDetailPane();

    // HEADER
    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.borderBottom = '1px solid #E5E7EB';
    header.style.paddingBottom = '10px';
    header.style.marginBottom = '16px';

    const title = document.createElement('h3');
    title.style.margin = '0';
    title.style.fontSize = '1.05rem';
    title.style.fontWeight = '600';
    title.textContent = item.name;
    makeEditable(title, newName => {
        if (!newName.trim()) return;
        item.name = newName;
        selectedItemId = `special-${newName}`;
        onSave();
        renderMasterLists();
    });

    const del = document.createElement('button');
    del.textContent = "Delete";
    del.style.color = "#DC2626";
    del.style.border = "1px solid #FECACA";
    del.style.background = "#fff";
    del.style.borderRadius = "999px";
    del.onclick = () => {
        if (confirm(`Delete "${item.name}"?`)) {
            specialActivities = specialActivities.filter(s => s.name !== item.name);
            selectedItemId = null;
            onSave();
            renderMasterLists();
            renderDetailPane();
        }
    };

    header.appendChild(title);
    header.appendChild(del);
    detailPaneEl.appendChild(header);

    // AVAILABILITY STRIP
    const avail = document.createElement('div');
    avail.style.padding = "10px 14px";
    avail.style.borderRadius = "14px";
    avail.style.marginBottom = "18px";
    avail.style.border = "1px solid " + (item.available ? "#BBF7D0" : "#FECACA");
    avail.style.background = item.available ? "#ECFDF5" : "#FEF2F2";
    avail.innerHTML = `
        Currently <strong>${item.available ? 'AVAILABLE' : 'UNAVAILABLE'}</strong>.
        <span style="opacity:0.7;">(Toggle in the left list)</span>
    `;
    detailPaneEl.appendChild(avail);

    /*******************************************************
     * TRANSITION RULES (NEW)
     *******************************************************/
    const transitionCard = document.createElement('div');
    Object.assign(transitionCard.style, {
        background:"#ffffff",
        border:"1px solid #e5e7eb",
        borderRadius:"14px",
        padding:"16px 16px",
        marginBottom:"20px",
        boxShadow:"0 8px 18px rgba(15,23,42,0.06)"
    });

    const transitionHeader = document.createElement('div');
    transitionHeader.textContent = "Transition & Duration Rules";
    transitionHeader.style.fontWeight = "600";
    transitionHeader.style.marginBottom = "6px";
    transitionHeader.style.fontSize = "0.9rem";
    transitionCard.appendChild(transitionHeader);

    const tControls = renderTransitionControls(item.transition, onSave, onRerender);
    transitionCard.appendChild(tControls);
    detailPaneEl.appendChild(transitionCard);
    
    /*******************************************************
     * MAX USAGE CARD (FREQUENCY UPDATE)
     *******************************************************/
    const maxCard = document.createElement('div');
    Object.assign(maxCard.style, {
        background:"#ffffff",
        border:"1px solid #e5e7eb",
        borderRadius:"14px",
        padding:"16px 16px",
        marginBottom:"20px",
        boxShadow:"0 8px 18px rgba(15,23,42,0.06)"
    });

    const maxHdr = document.createElement('div');
    maxHdr.textContent = "Frequency Limits";
    maxHdr.style.fontWeight = "600";
    maxHdr.style.marginBottom = "6px";
    maxHdr.style.fontSize = "0.9rem";
    maxCard.appendChild(maxHdr);

    // If null/undefined -> "Add Limit"
    if (item.maxUsage === null || item.maxUsage === undefined) {
        const noLimitText = document.createElement('p');
        noLimitText.textContent = "Unlimited usage allowed.";
        noLimitText.style.margin = "0 0 10px";
        noLimitText.style.fontSize = "0.8rem";
        noLimitText.style.color = "#6b7280";
        maxCard.appendChild(noLimitText);

        const addLimitBtn = document.createElement("button");
        addLimitBtn.textContent = "+ Add Frequency Rule";
        addLimitBtn.style.background = "#00C896";
        addLimitBtn.style.color = "white";
        addLimitBtn.style.border = "none";
        addLimitBtn.style.fontSize = "0.8rem";
        
        addLimitBtn.onclick = () => {
            item.maxUsage = 1;      // Default count
            item.frequencyWeeks = 0; // Default (Lifetime/Summer)
            onSave();
            onRerender();
        };
        maxCard.appendChild(addLimitBtn);

    } else {
        const limitDesc = document.createElement('p');
        limitDesc.textContent = "Bunks are allowed to play this:";
        limitDesc.style.margin = "0 0 8px";
        limitDesc.style.fontSize = "0.8rem";
        limitDesc.style.color = "#6b7280";
        maxCard.appendChild(limitDesc);

        const controlRow = document.createElement("div");
        controlRow.style.display = "flex";
        controlRow.style.gap = "10px";
        controlRow.style.alignItems = "center";
        controlRow.style.flexWrap = "wrap";

        // 1. Count Input
        const maxInput = document.createElement("input");
        maxInput.type = "number";
        maxInput.style.width = "60px";
        maxInput.style.borderRadius = "999px";
        maxInput.style.border = "1px solid #D1D5DB";
        maxInput.style.padding = "6px 12px";
        maxInput.value = item.maxUsage;
        maxInput.min = 1;

        maxInput.oninput = () => {
            const val = maxInput.value.trim();
            if (val !== "") {
                item.maxUsage = Math.max(1, parseInt(val,10) || 1);
                onSave();
            }
        };

        const timeLabel = document.createElement("span");
        timeLabel.textContent = "time(s) per";
        timeLabel.style.fontSize = "0.85rem";

        // 2. Frequency Dropdown
        const freqSelect = document.createElement("select");
        freqSelect.style.borderRadius = "999px";
        freqSelect.style.padding = "6px 12px";
        freqSelect.style.border = "1px solid #D1D5DB";
        
        const opts = [
            {v: 0, t: "Summer (Lifetime)"},
            {v: 1, t: "1 Week (7 Days)"},
            {v: 2, t: "2 Weeks (14 Days)"},
            {v: 3, t: "3 Weeks (21 Days)"},
            {v: 4, t: "4 Weeks (28 Days)"}
        ];
        
        opts.forEach(o => {
            const op = document.createElement("option");
            op.value = o.v;
            op.textContent = o.t;
            if(item.frequencyWeeks === o.v) op.selected = true;
            freqSelect.appendChild(op);
        });

        freqSelect.onchange = () => {
            item.frequencyWeeks = parseInt(freqSelect.value, 10);
            onSave();
        };

        // 3. Remove Button
        const removeBtn = document.createElement("button");
        removeBtn.textContent = "Remove Rule";
        removeBtn.style.background = "#FEE2E2";
        removeBtn.style.color = "#DC2626";
        removeBtn.style.border = "1px solid #FECACA";
        
        removeBtn.onclick = () => {
            item.maxUsage = null;
            item.frequencyWeeks = 0;
            onSave();
            onRerender();
        };

        controlRow.appendChild(maxInput);
        controlRow.appendChild(timeLabel);
        controlRow.appendChild(freqSelect);
        controlRow.appendChild(removeBtn);
        maxCard.appendChild(controlRow);
    }

    detailPaneEl.appendChild(maxCard);


    /*******************************************************
     * SHARABLE RULES
     *******************************************************/
    const sharableControls = renderSharableControls(item, onSave, onRerender);
    sharableControls.style.borderTop = "1px solid #E5E7EB";
    sharableControls.style.marginTop = "16px";
    sharableControls.style.paddingTop = "14px";
    detailPaneEl.appendChild(sharableControls);

    /*******************************************************
     * ALLOWED DIV + BUNKS
     *******************************************************/
    detailPaneEl.appendChild(renderAllowedBunksControls(item, onSave, onRerender));

    /*******************************************************
     * TIME RULES
     *******************************************************/
    const times = renderTimeRulesUI(item, onSave, onRerender);
    times.style.marginTop = "14px";
    times.style.paddingTop = "14px";
    times.style.borderTop = "1px solid #E5E7EB";
    detailPaneEl.appendChild(times);
}

// --- NEW FUNCTION: Render Transition Controls ---
function renderTransitionControls(transition, onSave, onRerender) {
    const container = document.createElement("div");
    
    // --- 1. Pre/Post Buffer Inputs ---
    container.innerHTML = `
        <div style="display:flex; flex-wrap:wrap; gap:10px; align-items:center;">
            <label style="font-weight:600; font-size:0.85rem;">Pre-Activity (To):</label>
            <input type="number" id="pre-min-input" value="${transition.preMin}" min="0" step="5" style="width:60px; padding:4px;">
            <label style="font-weight:600; font-size:0.85rem;">Post-Activity (From):</label>
            <input type="number" id="post-min-input" value="${transition.postMin}" min="0" step="5" style="width:60px; padding:4px;">
        </div>
        
        <div style="margin-top:10px; display:flex; gap:10px; flex-wrap:wrap;">
            <label style="font-weight:600; font-size:0.85rem;">Label:</label>
            <input type="text" id="buffer-label-input" value="${transition.label}" style="width:120px; padding:4px;">
        </div>

        <!-- Zone Selector (Issue 2/4) -->
        <div style="margin-top:15px; border-top:1px dashed #E5E7EB; padding-top:10px;">
            <label style="font-weight:600; font-size:0.85rem;">Location Zone:</label>
            <select id="zone-select" style="width:100%; margin-top:5px; padding:6px;"></select>
            <p class="muted" style="font-size:0.75rem; margin-top:5px;">Required for Buffer Merging and Transport Limits.</p>
        </div>

        <!-- Occupancy Toggle (Issue 5) -->
        <label style="display:flex; align-items:center; gap:8px; margin-top:10px; cursor:pointer;">
            <input type="checkbox" id="occupies-field-check" ${transition.occupiesField ? 'checked' : ''} style="width:16px; height:16px;">
            <span style="font-size:0.85rem; font-weight:600;">Buffer Occupies Resource (e.g., Setup/Change)</span>
        </label>
        <p class="muted" style="font-size:0.75rem; margin-top:2px; padding-left:25px;">
            If unchecked (Travel), the resource is available during transition time.
        </p>

        <!-- Minimum Duration (Issue 1) -->
        <div style="margin-top:15px; border-top:1px dashed #E5E7EB; padding-top:10px;">
            <label style="font-weight:600; font-size:0.85rem;">Min Activity Duration:</label>
            <input type="number" id="min-duration-input" value="${transition.minDurationMin}" min="0" step="5" style="width:60px; padding:4px; margin-left:5px;">
            <span class="muted" style="font-size:0.85rem;">minutes (if less, placement is rejected).</span>
        </div>
    `;
    
    // Populate Zones
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


/*********************************************************
 * ADD SPECIAL
 *********************************************************/
function addSpecial() {
    const n = addSpecialInput.value.trim();
    if (!n) return;

    if (specialActivities.some(s => s.name.toLowerCase() === n.toLowerCase())) {
        alert("Special already exists.");
        return;
    }

    specialActivities.push({
        name: n,
        available: true,
        sharableWith: { type:'not_sharable', divisions:[], capacity: 2 },
        limitUsage: { enabled:false, divisions:{} },
        preferences: { enabled: false, exclusive: false, list: [] },
        timeRules: [],
        maxUsage: null,
        frequencyWeeks: 0,
        transition: { // NEW DEFAULT
            preMin: 0,
            postMin: 0,
            label: "Change Time",
            zone: window.DEFAULT_ZONE_NAME,
            occupiesField: true,
            minDurationMin: 0
        }
    });

    addSpecialInput.value = "";
    window.saveGlobalSpecialActivities(specialActivities);

    selectedItemId = `special-${n}`;
    renderMasterLists();
    renderDetailPane();
}

/*********************************************************
 * HELPERS, CHIP PICKERS, SWITCHES, RULE UI
 *********************************************************/
function parseTimeToMinutes(str) {
    if (!str || typeof str !== "string") return null;
    let s = str.trim().toLowerCase();
    let mer = null;
    if (s.endsWith("am")||s.endsWith("pm")) {
        mer = s.endsWith("am") ? "am":"pm";
        s = s.replace(/am|pm/g, "").trim();
    }
    const m = s.match(/^(\d{1,2})\s*:\s*(\d{2})$/);
    if (!m) return null;
    let hh = parseInt(m[1],10);
    const mm = parseInt(m[2],10);
    if (mer) {
        if (hh === 12) hh = (mer==="am"?0:12);
        else if (mer==="pm") hh += 12;
    }
    return hh*60 + mm;
}

function makeEditable(el, save) {
    el.ondblclick = e => {
        e.stopPropagation();
        const old = el.textContent;

        const input = document.createElement("input");
        input.type = "text";
        input.value = old;
        input.style.borderRadius = "999px";
        input.style.padding = "4px 10px";
        input.style.border = "1px solid #60A5FA";
        input.style.outline = "none";
        input.style.boxShadow = "0 0 0 1px rgba(96,165,250,0.4)";
        input.style.minWidth = "120px";

        el.replaceWith(input);
        input.focus();

        function done() {
            const val = input.value.trim();
            if (val && val !== old) save(val);
            el.textContent = val || old;
            input.replaceWith(el);
        }
        input.onblur = done;
        input.onkeyup = e => { if (e.key==="Enter") done(); };
    };
}

function renderTimeRulesUI(item, onSave, onRerender) {
    const wrap = document.createElement("div");
    wrap.style.paddingLeft = "14px";
    wrap.style.borderLeft = "3px solid #e5e7eb";

    wrap.innerHTML = `<strong>Global Time Rules:</strong>`;

    if (!item.timeRules) item.timeRules = [];

    const list = document.createElement("div");
    if (item.timeRules.length === 0)
        list.innerHTML = `<p class="muted" style="margin:0;">Available all day</p>`;

    item.timeRules.forEach((rule, idx) => {
        const row = document.createElement("div");
        Object.assign(row.style, {
            padding:"4px 6px",
            margin:"3px 0",
            background:"#f3f4f6",
            borderRadius:"8px",
        });

        row.innerHTML = `
            <strong style="color:${rule.type==="Available"?"#059669":"#DC2626"};">
                ${rule.type}
            </strong>
            from ${rule.start} to ${rule.end}
        `;

        const x = document.createElement("button");
        x.textContent = "✖";
        x.style.marginLeft = "10px";
        x.style.background = "transparent";
        x.style.border = "none";
        x.style.cursor = "pointer";
        x.onclick = () => {
            item.timeRules.splice(idx,1);
            onSave();
            onRerender();
        };

        row.appendChild(x);
        list.appendChild(row);
    });

    wrap.appendChild(list);

    // Add rule
    const form = document.createElement("div");
    form.style.marginTop = "10px";

    const sel = document.createElement("select");
    sel.style.borderRadius = "999px";
    sel.style.padding = "4px 10px";
    sel.innerHTML = `
        <option value="Available">Available</option>
        <option value="Unavailable">Unavailable</option>
    `;

    const s = document.createElement("input");
    s.placeholder = "9:00am";
    s.style.width = "90px";
    s.style.marginLeft = "6px";

    const txt = document.createElement("span");
    txt.textContent = " to ";
    txt.style.margin = "0 6px";

    const e = document.createElement("input");
    e.placeholder = "10:00am";
    e.style.width = "90px";

    const add = document.createElement("button");
    add.textContent = "Add";
    add.style.marginLeft = "8px";

    add.onclick = () => {
        if (!s.value || !e.value) return alert("Enter both times.");
        if (parseTimeToMinutes(s.value)==null ||
            parseTimeToMinutes(e.value)==null)
            return alert("Invalid time.");
        if (parseTimeToMinutes(s.value)>=parseTimeToMinutes(e.value))
            return alert("End must be after start.");

        item.timeRules.push({
            type: sel.value,
            start: s.value,
            end: e.value
        });
        onSave();
        onRerender();
    };

    form.appendChild(sel);
    form.appendChild(s);
    form.appendChild(txt);
    form.appendChild(e);
    form.appendChild(add);

    wrap.appendChild(form);
    return wrap;
}

/*********************************************************
 * SHARABLE UI (Updated to match Fields - With Capacity)
 *********************************************************/
function renderSharableControls(item, onSave, onRerender) {
    const container = document.createElement("div");
    container.innerHTML = `<strong>Sharing Rules:</strong>`;
    
    // Ensure default capacity exists
    if (!item.sharableWith) { item.sharableWith = { type: 'not_sharable', capacity: 2 }; }
    if (!item.sharableWith.capacity) { item.sharableWith.capacity = 2; }
    
    const rules = item.sharableWith;
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
        // --- CAPACITY INPUT (New) ---
        const capDiv = document.createElement("div");
        capDiv.style.marginTop = "8px";
        capDiv.style.paddingLeft = "12px";
        capDiv.style.display = "flex";
        capDiv.style.alignItems = "center";
        capDiv.style.gap = "8px";
        
        const capLabel = document.createElement("span");
        capLabel.textContent = "Max Total Bunks at once:";
        capLabel.style.fontSize = "0.85rem";
        
        const capInput = document.createElement("input");
        capInput.type = "number";
        capInput.min = "2";
        capInput.value = rules.capacity || 2;
        capInput.style.width = "60px";
        capInput.style.padding = "2px 6px";
        capInput.style.borderRadius = "6px";
        capInput.style.border = "1px solid #d1d5db";
        
        capInput.onchange = (e) => {
            const val = parseInt(e.target.value);
            rules.capacity = val >= 2 ? val : 2;
            onSave();
        };
        
        capDiv.appendChild(capLabel);
        capDiv.appendChild(capInput);
        container.appendChild(capDiv);

        // --- SPECIFIC DIVISIONS ---
        const customPanel = document.createElement("div");
        customPanel.style.paddingLeft = "12px";
        customPanel.style.marginTop = "8px";
        const divLabel = document.createElement("div");
        divLabel.textContent = "Optionally limit sharing to specific divisions:";
        divLabel.style.fontSize = "0.78rem";
        divLabel.style.color = "#4b5563";
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

function createChipPicker(all, selected, onToggle) {
    const box = document.createElement("div");
    box.style.display = "flex";
    box.style.flexWrap = "wrap";
    box.style.gap = "6px";

    all.forEach(name => {
        const chip = document.createElement("span");
        chip.textContent = name;
        chip.style.padding = "6px 12px";
        chip.style.borderRadius = "999px";
        chip.style.cursor = "pointer";
        chip.style.fontSize = "0.8rem";
        chip.style.border = "1px solid #d1d5db";

        const active = selected.includes(name);
        chip.style.background = active ? "#00C896" : "#f3f4f6";
        chip.style.color = active ? "#ffffff" : "#111827";

        chip.onclick = () => {
            const idx = selected.indexOf(name);
            if (idx>-1) selected.splice(idx,1);
            else selected.push(name);
            onToggle();
        };

        box.appendChild(chip);
    });

    return box;
}

/*********************************************************
 * ALLOWED DIVISION/BUNK RULES (Themed Perfectly)
 *********************************************************/
function renderAllowedBunksControls(item, onSave, onRerender) {
    const container = document.createElement("div");
    container.style.marginTop = "4px";

    if (!item.limitUsage) { item.limitUsage = { enabled: false, divisions: {} }; }
    if (!item.preferences) { item.preferences = { enabled: false, exclusive: false, list: [] }; }

    const rules = item.limitUsage;
    const prefs = item.preferences;
    prefs.enabled = !!rules.enabled;

    container.innerHTML = `<strong>Division Restrictions & Priority:</strong>`;

    // --- 1. Master Toggle (All vs Specific) ---
    const modeLabel = document.createElement("label");
    modeLabel.style.display = "flex";
    modeLabel.style.alignItems = "center";
    modeLabel.style.gap = "10px";
    modeLabel.style.cursor = "pointer";
    modeLabel.style.marginTop = '6px';

    const textAll = document.createElement("span");
    textAll.textContent = "All Divisions (No Restrictions)";
    const toggleTrack = document.createElement("span");
    Object.assign(toggleTrack.style, {
        "width": "44px", "height": "24px", "borderRadius": "999px", "position": "relative",
        "display": "inline-block", "border": "1px solid #CBD5E1",
        "backgroundColor": rules.enabled ? '#D1D5DB' : '#22C55E',
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
        customPanel.style.padding = "12px 0 0";
        customPanel.style.borderTop = "1px solid #F3F4F6";
        
        // --- 2. Priority and Exclusive Toggle ---
        const prioritySettings = document.createElement("div");
        prioritySettings.style.cssText = "background:#F9FAFB; padding:10px; border-radius:12px; border:1px solid #E5E7EB; margin-bottom:12px;";
        
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
        listHeader.textContent = "Division Priority Order (top = first choice):";
        listHeader.style.marginTop = "8px";
        listHeader.style.fontWeight = "600";
        listHeader.style.fontSize = "0.78rem";
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
                    <button data-action="rem" data-div="${divName}" style="color:#B91C1C; border-color:#FECACA;">x</button>
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
        priorityAddRow.style.cssText = "margin-top:8px; padding-top:6px; border-top:1px dashed #E5E7EB; display:flex; gap:6px;";
        
        const select = document.createElement("select");
        select.innerHTML = `<option value="">-- Add Division to Priority --</option>`;
        Object.keys(rules.divisions).forEach(divName => {
            if (!prefs.list.includes(divName)) {
                select.innerHTML += `<option value="${divName}">${divName}</option>`;
            }
        });

        const addBtn = document.createElement("button");
        addBtn.textContent = "Add";
        addBtn.style.padding = "4px 10px";
        addBtn.style.borderRadius = "999px";
        addBtn.style.border = "none";
        addBtn.style.background = "#00C896";
        addBtn.style.color = "#FFFFFF";
        addBtn.style.fontSize = "0.8rem";
        addBtn.style.cursor = "pointer";
        addBtn.style.boxShadow = "0 3px 8px rgba(0, 200, 150, 0.35)";
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
        allowedHeader.style.cssText = "margin-top:10px; font-weight:600; font-size:0.8rem;";
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
                    allBunksChip.style.backgroundColor = "#F3F4F6";
                    allBunksChip.style.color = "#2563EB";
                    allBunksChip.style.borderColor = "#93C5FD";
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

function createLimitChip(text, active, isDivision = true) {
    const c = document.createElement("span");
    c.textContent = text;
    c.style.padding = "6px 12px";
    c.style.borderRadius = "999px";
    c.style.cursor = "pointer";
    c.style.fontSize = isDivision ? "0.82rem" : "0.78rem";
    const activeBG = isDivision ? "#00C896" : "#38BDF8"; 
    const activeColor = "#FFFFFF";
    const inactiveBG = isDivision ? "#F3F4F6" : "#F9FAFB";
    const inactiveColor = "#111827";
    c.style.backgroundColor = active ? activeBG : inactiveBG;
    c.style.color = active ? activeColor : inactiveColor;
    return c;
}

window.initSpecialActivitiesTab = initSpecialActivitiesTab;
window.specialActivities = specialActivities;

})();
