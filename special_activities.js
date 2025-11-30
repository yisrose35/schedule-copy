// =================================================================
// special_activities.js
//
// UPDATED (CRITICAL SAVE FIX):
// - Uses window.getGlobalSpecialActivities() / window.saveGlobalSpecialActivities()
//   so data is owned by app1.js.
//
// UPDATED (BUG FIX):
// - renderAllowedBunksControls:
//   - Clicking an enabled division chip will now correctly disable it.
//
// UPDATED (UI THEME):
// - Matches Modern Pro Camp theme used in Fields:
//   • setup-grid + setup-card shell
//   • Emerald master-list + detail-pane styling
//
// UPDATED (NEW FEATURE):
// - Added "Max Total Usage" (global limit per bunk)
//   • item.maxUsage = null → Unlimited
//   • item.maxUsage = number → Hard cap on total lifetime uses
//   • UI is placed directly under Availability strip
// =================================================================

(function() {
'use strict';

let specialActivities = []; 
let selectedItemId = null;

let specialsListEl = null;
let detailPaneEl = null;
let addSpecialInput = null;

/** INIT TAB **/
function initSpecialActivitiesTab() {
    const container = document.getElementById("special_activities");
    if (!container) return;
    
    specialActivities = window.getGlobalSpecialActivities?.() || [];
    
    specialActivities.forEach(s => {
        s.available = s.available !== false;
        s.timeRules = s.timeRules || [];
        s.sharableWith = s.sharableWith || { type: 'not_sharable', divisions: [] };
        s.limitUsage = s.limitUsage || { enabled: false, divisions: {} };
        s.maxUsage = (s.maxUsage === undefined) ? null : s.maxUsage; // NEW
    });

    container.innerHTML = `
        <div class="setup-grid">
            <section class="setup-card setup-card-wide">
                <div class="setup-card-header">
                    <span class="setup-step-pill">Specials</span>
                    <div class="setup-card-text">
                        <h3>Special Activities &amp; Rotations</h3>
                        <p>
                            Add your <strong>canteen, trips, electives, lakes, buses</strong> and more.
                            Then control which <strong>divisions/bunks</strong> can use each special,
                            whether it can be <strong>shared</strong>, and any <strong>rules</strong>.
                        </p>
                    </div>
                </div>

                <div style="display:flex; flex-wrap:wrap; gap:20px; margin-top:8px;">
                    
                    <div style="flex:1; min-width:260px;">
                        <div class="setup-subtitle">All Special Activities</div>
                        <p style="font-size:0.8rem; color:#6b7280; margin-top:4px;">
                            Add each special once. Click a special to open its rules.
                        </p>

                        <div class="setup-field-row" style="margin-top:10px;">
                            <input id="new-special-input" placeholder="New Special (e.g., Canteen)">
                            <button id="add-special-btn">Add Special</button>
                        </div>

                        <div id="specials-master-list" class="master-list"
                             style="margin-top:10px; max-height:440px; overflow:auto;"></div>
                    </div>

                    <div style="flex:1.3; min-width:320px;">
                        <div class="setup-subtitle">Special Details</div>
                        <div id="specials-detail-pane" class="detail-pane"
                             style="margin-top:8px; min-height:360px;">
                            <p class="muted">
                                Select a special from the left to edit its details.
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
                transition: background 0.15s, box-shadow 0.15s, transform 0.08s;
            }
            .master-list .list-item:hover {
                background: #F3F4F6;
                transform: translateY(-1px);
            }
            .master-list .list-item.selected {
                background: radial-gradient(circle at top left, #ECFDF5 0, #FFFFFF 70%);
                border-color: #00C896;
                box-shadow: 0 0 0 1px rgba(0,200,150,0.55);
                font-weight: 600;
            }
            .detail-pane {
                border-radius: 18px;
                border: 1px solid #E5E7EB;
                padding: 18px 20px;
                background: linear-gradient(135deg, #F7F9FA 0%, #FFFFFF 55%, #F7F9FA 100%);
                box-shadow: 0 18px 40px rgba(15,23,42,0.06);
            }
            .muted {
                color: #6B7280;
                font-size: 0.86rem;
            }
        </style>
    `;

    specialsListEl = document.getElementById("specials-master-list");
    detailPaneEl = document.getElementById("specials-detail-pane");
    addSpecialInput = document.getElementById("new-special-input");

    document.getElementById("add-special-btn").onclick = addSpecial;
    addSpecialInput.onkeyup = e => { if (e.key === "Enter") addSpecial(); };

    renderMasterLists();
    renderDetailPane();
}

/** LIST RENDER **/
function renderMasterLists() {
    specialsListEl.innerHTML = "";
    if (specialActivities.length === 0) {
        specialsListEl.innerHTML = `<p class="muted">No special activities created yet.</p>`;
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
    el.appendChild(nameEl);

    const tog = document.createElement("label");
    tog.className = "switch list-item-toggle";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = item.available;
    cb.onchange = e => {
        e.stopPropagation();
        item.available = cb.checked;
        window.saveGlobalSpecialActivities(specialActivities);
        renderDetailPane();
    };
    tog.appendChild(cb);
    tog.appendChild(document.createElement("span")).className = "slider";
    tog.onclick = e => e.stopPropagation();
    el.appendChild(tog);

    return el;
}

/** DETAIL PANE **/
function renderDetailPane() {
    if (!selectedItemId) {
        detailPaneEl.innerHTML = `<p class="muted">Select a special activity from the left.</p>`;
        return;
    }

    const [type, name] = selectedItemId.split(/-(.+)/);
    const item = specialActivities.find(f => f.name === name);
    if (!item) {
        selectedItemId = null;
        detailPaneEl.innerHTML = `<p style="color:red;">Error loading.</p>`;
        return;
    }

    detailPaneEl.innerHTML = "";
    const onSave = () => window.saveGlobalSpecialActivities(specialActivities);
    const onRerender = () => renderDetailPane();

    // NAME + DELETE
    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.borderBottom = '2px solid #E5E7EB';
    header.style.paddingBottom = '10px';
    header.style.marginBottom = '15px';

    const title = document.createElement('h3');
    title.style.margin = '0';
    title.style.fontSize = '1rem';
    title.style.fontWeight = '600';
    title.textContent = item.name;
    makeEditable(title, newName => {
        if (!newName.trim()) return;
        item.name = newName;
        selectedItemId = `special-${newName}`;
        onSave();
        renderMasterLists();
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = 'Delete';
    deleteBtn.style.background = '#fff';
    deleteBtn.style.color = '#DC2626';
    deleteBtn.style.border = '1px solid #FECACA';
    deleteBtn.style.padding = '6px 14px';
    deleteBtn.style.borderRadius = '999px';
    deleteBtn.style.cursor = 'pointer';
    deleteBtn.onclick = () => {
        if (confirm(`Delete "${item.name}"?`)) {
            specialActivities = specialActivities.filter(s => s.name !== item.name);
            selectedItemId = null;
            onSave();
            renderMasterLists();
            renderDetailPane();
        }
    };

    header.appendChild(title);
    header.appendChild(deleteBtn);
    detailPaneEl.appendChild(header);

    // AVAILABILITY STRIP
    const masterToggle = document.createElement('div');
    masterToggle.style.background = item.available ? '#ECFDF5' : '#FEF2F2';
    masterToggle.style.padding = '8px 12px';
    masterToggle.style.borderRadius = '12px';
    masterToggle.style.marginBottom = '15px';
    masterToggle.style.fontSize = '0.8rem';
    masterToggle.style.border = '1px solid ' + (item.available ? '#BBF7D0' : '#FECACA');
    masterToggle.innerHTML = `
        This special is currently 
        <strong>${item.available ? 'AVAILABLE' : 'UNAVAILABLE'}</strong>.
        <span style="opacity:0.75;">(Toggle in the list)</span>
    `;
    detailPaneEl.appendChild(masterToggle);

    // ======================================================================
    // 🔥 NEW SECTION — MAX TOTAL USAGE
    // ======================================================================
    const maxUsageCard = document.createElement('div');
    maxUsageCard.style.background = '#FFFFFF';
    maxUsageCard.style.border = '1px solid #E5E7EB';
    maxUsageCard.style.borderRadius = '14px';
    maxUsageCard.style.padding = '14px 16px';
    maxUsageCard.style.marginBottom = '18px';
    maxUsageCard.style.boxShadow = '0 6px 12px rgba(0,0,0,0.04)';

    const maxLabel = document.createElement('div');
    maxLabel.style.fontWeight = '600';
    maxLabel.style.marginBottom = '6px';
    maxLabel.textContent = 'Max Usage Limit';
    maxUsageCard.appendChild(maxLabel);

    const maxDesc = document.createElement('div');
    maxDesc.style.fontSize = '0.85rem';
    maxDesc.style.color = '#6B7280';
    maxDesc.style.marginBottom = '10px';
    maxDesc.textContent = 'Each bunk may receive this special no more than:';
    maxUsageCard.appendChild(maxDesc);

    const maxInput = document.createElement('input');
    maxInput.type = 'number';
    maxInput.placeholder = "Leave empty for unlimited";
    maxInput.style.width = '160px';
    maxInput.style.padding = '6px 8px';
    maxInput.style.border = '1px solid #D1D5DB';
    maxInput.style.borderRadius = '8px';
    maxInput.value = item.maxUsage ?? '';
    maxInput.oninput = () => {
        const val = maxInput.value.trim();
        item.maxUsage = val === '' ? null : Math.max(0, parseInt(val,10) || 0);
        onSave();
    };
    maxUsageCard.appendChild(maxInput);

    detailPaneEl.appendChild(maxUsageCard);

    // ======================================================================

    // SHARABLE RULES
    const sharableControls = renderSharableControls(item, onSave, onRerender);
    sharableControls.style.borderTop = '1px solid #E5E7EB';
    sharableControls.style.paddingTop = '15px';
    sharableControls.style.marginTop = '15px';
    detailPaneEl.appendChild(sharableControls);

    // ALLOWED DIVISIONS + BUNKS
    detailPaneEl.appendChild(renderAllowedBunksControls(item, onSave, onRerender));

    // TIME RULES
    const timeRuleControls = renderTimeRulesUI(item, onSave, onRerender);
    timeRuleControls.style.marginTop = "10px";
    timeRuleControls.style.paddingTop = "10px";
    timeRuleControls.style.borderTop = "1px solid #E5E7EB";
    detailPaneEl.appendChild(timeRuleControls);
}

/** ADD SPECIAL **/
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
        sharableWith: { type: 'not_sharable', divisions: [] },
        limitUsage: { enabled: false, divisions: {} },
        timeRules: [],
        maxUsage: null   // NEW FIELD
    });

    addSpecialInput.value = "";
    window.saveGlobalSpecialActivities(specialActivities);
    selectedItemId = `special-${n}`;
    renderMasterLists();
    renderDetailPane();
}

// =================================================================
// HELPERS
// =================================================================

function parseTimeToMinutes(str) {
    if (!str || typeof str !== "string") return null;
    let s = str.trim().toLowerCase();
    let mer = null;
    if (s.endsWith("am") || s.endsWith("pm")) {
        mer = s.endsWith("am") ? "am" : "pm";
        s = s.replace(/am|pm/g, "").trim();
    }
    const m = s.match(/^(\d{1,2})\\s*:\\s*(\\d{2})$/);
    if (!m) return null;
    let hh = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    if (Number.isNaN(hh) || Number.isNaN(mm) || mm < 0 || mm > 59) return null;
    if (mer) {
        if (hh === 12) hh = (mer === "am" ? 0 : 12);
        else if (mer === "pm") hh += 12;
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
        el.replaceWith(input);
        input.focus();

        function done() {
            const val = input.value.trim();
            if (val && val !== old) save(val);
            el.textContent = val || old;
            input.replaceWith(el);
        }
        input.onblur = done;
        input.onkeyup = e => { if (e.key === "Enter") done(); };
    };
}

function renderTimeRulesUI(item, onSave, onRerender) {
    const container = document.createElement("div");
    container.style.paddingLeft = "15px";
    container.style.borderLeft = "3px solid #eee";
    container.innerHTML = `<strong>Global Time Rules:</strong>`;

    if (!item.timeRules) item.timeRules = [];

    const list = document.createElement("div");
    if (item.timeRules.length === 0) {
        list.innerHTML = `<p class="muted" style="margin:0;">Available all day</p>`;
    }

    item.timeRules.forEach((rule, index) => {
        const row = document.createElement("div");
        row.style.padding = "4px";
        row.style.margin = "2px 0";
        row.style.background = "#f4f4f4";
        row.style.borderRadius = "4px";

        row.innerHTML = `
            <strong style="color:${rule.type==='Available'?'green':'red'};">
                ${rule.type}
            </strong>
            from ${rule.start} to ${rule.end}
        `;

        const del = document.createElement("button");
        del.textContent = "✖";
        del.style.marginLeft = "10px";
        del.style.background = "transparent";
        del.style.border = "none";
        del.style.cursor = "pointer";
        del.onclick = () => {
            item.timeRules.splice(index, 1);
            onSave();
            onRerender();
        };

        row.appendChild(del);
        list.appendChild(row);
    });

    container.appendChild(list);

    const addWrap = document.createElement("div");
    addWrap.style.marginTop = "8px";

    const typeSel = document.createElement("select");
    typeSel.innerHTML = `
        <option value="Available">Available</option>
        <option value="Unavailable">Unavailable</option>
    `;

    const start = document.createElement("input");
    start.placeholder = "9:00am";
    start.style.width = "90px";
    start.style.marginLeft = "5px";

    const to = document.createElement("span");
    to.textContent = " to ";
    to.style.margin = "0 5px";

    const end = document.createElement("input");
    end.placeholder = "10:00am";
    end.style.width = "90px";

    const add = document.createElement("button");
    add.textContent = "Add Rule";
    add.style.marginLeft = "8px";
    add.onclick = () => {
        if (!start.value || !end.value) return alert("Enter start and end time.");
        if (parseTimeToMinutes(start.value) == null || parseTimeToMinutes(end.value) == null)
            return alert("Invalid time.");
        if (parseTimeToMinutes(start.value) >= parseTimeToMinutes(end.value))
            return alert("End must be after start.");

        item.timeRules.push({ type: typeSel.value, start: start.value, end: end.value });
        onSave();
        onRerender();
    };

    addWrap.appendChild(typeSel);
    addWrap.appendChild(start);
    addWrap.appendChild(to);
    addWrap.appendChild(end);
    addWrap.appendChild(add);
    container.appendChild(addWrap);

    return container;
}

function renderSharableControls(item, onSave, onRerender) {
    const container = document.createElement("div");
    container.innerHTML = `<strong>Sharing Rules:</strong>`;
    const rules = item.sharableWith || { type:'not_sharable', divisions:[] };
    const isSharable = rules.type !== 'not_sharable';

    const wrap = document.createElement("label");
    wrap.style.display = "flex";
    wrap.style.alignItems = "center";
    wrap.style.gap = "8px";
    wrap.style.marginTop = "8px";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = isSharable;
    cb.onchange = () => {
        rules.type = cb.checked ? 'all' : 'not_sharable';
        rules.divisions = [];
        onSave();
        onRerender();
    };

    const txt = document.createElement("span");
    txt.textContent = "Sharable";

    wrap.appendChild(cb);
    wrap.appendChild(txt);
    container.appendChild(wrap);

    if (isSharable) {
        const custom = document.createElement("div");
        custom.style.paddingLeft = "20px";
        custom.style.marginTop = "8px";

        custom.innerHTML = `Limit to divisions (optional):`;

        const chips = createChipPicker(window.availableDivisions || [], rules.divisions, () => {
            rules.type = rules.divisions.length ? 'custom' : 'all';
            onSave();
            onRerender();
        });

        custom.appendChild(chips);
        container.appendChild(custom);
    }

    return container;
}

function createChipPicker(all, selected, onToggle) {
    const box = document.createElement("div");
    box.style.display = "flex";
    box.style.flexWrap = "wrap";
    box.style.gap = "5px";
    box.style.marginTop = "6px";

    all.forEach(name => {
        const chip = document.createElement("span");
        chip.textContent = name;
        chip.style.padding = "4px 8px";
        chip.style.borderRadius = "12px";
        chip.style.cursor = "pointer";
        chip.style.border = "1px solid #ccc";

        const active = selected.includes(name);
        chip.style.background = active ? "#00A67C" : "#f0f0f0";
        chip.style.color = active ? "white" : "black";

        chip.onclick = () => {
            const idx = selected.indexOf(name);
            if (idx > -1) selected.splice(idx, 1);
            else selected.push(name);
            onToggle();
        };

        box.appendChild(chip);
    });

    return box;
}

// ALLOWED DIVISION/BUNK CONTROLS
function renderAllowedBunksControls(item, onSave, onRerender) {
    const container = document.createElement("div");
    container.style.marginTop = "10px";
    container.style.paddingTop = "10px";
    container.style.borderTop = "1px solid #eee";
    container.innerHTML = `<strong>Allowed Divisions & Bunks:</strong>`;

    const rules = item.limitUsage || { enabled:false, divisions:{} };
    item.limitUsage = rules;

    const mode = document.createElement("label");
    mode.style.display = "flex";
    mode.style.alignItems = "center";
    mode.style.gap = "12px";
    mode.style.marginTop = "6px";
    mode.style.cursor = "pointer";

    const allTxt = document.createElement("span");
    allTxt.textContent = "All Divisions";

    const track = document.createElement("span");
    Object.assign(track.style, {
        width:"44px", height:"24px", borderRadius:"99px",
        display:"inline-block", position:"relative",
        border:"1px solid #ccc",
        background:rules.enabled ? "#d1d5db" : "#22c55e",
        transition:"0.2s"
    });

    const knob = document.createElement("span");
    Object.assign(knob.style, {
        width:"20px", height:"20px", borderRadius:"50%",
        background:"white", position:"absolute", top:"1px",
        left: rules.enabled ? "21px" : "1px",
        transition:"0.2s"
    });

    track.appendChild(knob);

    const spTxt = document.createElement("span");
    spTxt.textContent = "Specific Divisions/Bunks";

    mode.appendChild(allTxt);
    mode.appendChild(track);
    mode.appendChild(spTxt);

    mode.onclick = () => {
        rules.enabled = !rules.enabled;
        onSave();
        onRerender();
    };

    container.appendChild(mode);

    if (!rules.enabled) return container;

    const panel = document.createElement("div");
    panel.style.paddingLeft = "20px";
    panel.style.marginTop = "10px";
    panel.style.borderLeft = "3px solid #eee";

    const allDivs = window.availableDivisions || [];
    allDivs.forEach(div => {
        const wrap = document.createElement("div");
        wrap.style.marginTop = "6px";

        const isAllowed = div in rules.divisions;
        const allowedBunks = rules.divisions[div] || [];

        const divChip = createLimitChip(div, isAllowed, true);
        divChip.onclick = () => {
            if (isAllowed) delete rules.divisions[div];
            else rules.divisions[div] = [];
            onSave();
            onRerender();
        };
        wrap.appendChild(divChip);

        if (isAllowed) {
            const bunkBox = document.createElement("div");
            bunkBox.style.display = "flex";
            bunkBox.style.flexWrap = "wrap";
            bunkBox.style.gap = "5px";
            bunkBox.style.marginTop = "4px";
            bunkBox.style.paddingLeft = "20px";

            const bunks = window.divisions[div]?.bunks || [];

            if (allowedBunks.length > 0) {
                const allChip = createLimitChip("All " + div, false, false);
                allChip.style.borderColor = "#00A67C";
                allChip.style.color = "#00A67C";
                allChip.onclick = () => {
                    rules.divisions[div] = [];
                    onSave();
                    onRerender();
                };
                bunkBox.appendChild(allChip);
            }

            bunks.forEach(b => {
                const bunkChip = createLimitChip(b, allowedBunks.includes(b), false);
                bunkChip.onclick = () => {
                    const idx = allowedBunks.indexOf(b);
                    if (idx > -1) allowedBunks.splice(idx,1);
                    else allowedBunks.push(b);
                    onSave();
                    onRerender();
                };
                bunkBox.appendChild(bunkChip);
            });

            wrap.appendChild(bunkBox);
        }

        panel.appendChild(wrap);
    });

    container.appendChild(panel);
    return container;
}

function createLimitChip(name, active, isDiv=true) {
    const chip = document.createElement("span");
    chip.textContent = name;
    chip.style.padding = "4px 8px";
    chip.style.borderRadius = "12px";
    chip.style.cursor = "pointer";
    chip.style.border = "1px solid #ccc";

    chip.style.background = active ? "#00A67C" : "#f0f0f0";
    chip.style.color = active ? "white" : "black";

    return chip;
}

window.initSpecialActivitiesTab = initSpecialActivitiesTab;

})();
