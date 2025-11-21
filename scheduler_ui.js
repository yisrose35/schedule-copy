// =================================================================
// special_activities.js
//
// UPDATED:
// - Added "Max Usage" (Limit per season) input.
// =================================================================

(function() {
'use strict';

let specialActivities = []; 
let selectedItemId = null;

let specialsListEl = null;
let detailPaneEl = null;
let addSpecialInput = null;

function initSpecialActivitiesTab() {
    const container = document.getElementById("special_activities");
    if (!container) return;
    
    specialActivities = window.getGlobalSpecialActivities?.() || [];
    
    // Migration for new fields
    specialActivities.forEach(s => {
        s.available = s.available !== false;
        s.timeRules = s.timeRules || [];
        s.sharableWith = s.sharableWith || { type: 'not_sharable', divisions: [] };
        s.limitUsage = s.limitUsage || { enabled: false, divisions: {} };
        s.maxUsage = s.maxUsage !== undefined ? s.maxUsage : 0; // 0 = unlimited
    });

    container.innerHTML = `
        <div style="display: flex; flex-wrap: wrap; gap: 20px;">
            <div style="flex: 1; min-width: 300px;">
                <h3>Add New Special Activity</h3>
                <div style="display: flex; gap: 10px; margin-bottom: 20px;">
                    <input id="new-special-input" placeholder="New Special (e.g., Canteen)" style="flex: 1;">
                    <button id="add-special-btn">Add Special</button>
                </div>
                <h3>All Special Activities</h3>
                <div id="specials-master-list" class="master-list"></div>
            </div>
            <div style="flex: 2; min-width: 400px; position: sticky; top: 20px;">
                <h3>Details</h3>
                <div id="specials-detail-pane" class="detail-pane">
                    <p class="muted">Select a special activity from the left to edit its details.</p>
                </div>
            </div>
        </div>
        <style>
            .master-list .list-item { padding: 12px 10px; border: 1px solid #ddd; border-radius: 5px; margin-bottom: 5px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; background: #fff; }
            .master-list .list-item:hover { background: #f9f9f9; }
            .master-list .list-item.selected { background: #e7f3ff; border-color: #007bff; font-weight: 600; }
            .master-list .list-item-name { flex-grow: 1; }
            .master-list .list-item-toggle { margin-left: 10px; }
            .detail-pane { border: 1px solid #ccc; border-radius: 8px; padding: 20px; background: #fdfdfd; min-height: 400px; }
        </style>
    `;

    specialsListEl = document.getElementById("specials-master-list");
    detailPaneEl = document.getElementById("specials-detail-pane");
    addSpecialInput = document.getElementById("new-special-input");

    document.getElementById("add-special-btn").onclick = addSpecial;
    addSpecialInput.onkeyup = (e) => { if (e.key === "Enter") addSpecial(); };

    renderMasterLists();
    renderDetailPane();
}

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
    tog.title = "Available (Master)";
    tog.onclick = (e) => e.stopPropagation();
    const cb = document.createElement("input"); 
    cb.type = "checkbox"; 
    cb.checked = item.available;
    cb.onchange = (e) => { 
        e.stopPropagation();
        item.available = cb.checked; 
        window.saveGlobalSpecialActivities(specialActivities);
        renderDetailPane();
    };
    tog.append(cb, document.createElement("span"));
    tog.querySelector("span").className = "slider";
    el.appendChild(tog);

    return el;
}

function renderDetailPane() {
    if (!selectedItemId) {
        detailPaneEl.innerHTML = `<p class="muted">Select a special activity from the left to edit its details.</p>`;
        return;
    }

    const [type, name] = selectedItemId.split(/-(.+)/);
    const item = specialActivities.find(f => f.name === name);

    if (!item) {
        selectedItemId = null;
        detailPaneEl.innerHTML = `<p style="color: red;">Error: Could not find item.</p>`;
        return;
    }
    
    detailPaneEl.innerHTML = ""; 
    
    // 1. Header
    const header = document.createElement('div');
    header.style.cssText = 'display:flex; justify-content:space-between; align-items:center; border-bottom:2px solid #eee; padding-bottom:10px; margin-bottom:15px;';
    const title = document.createElement('h3');
    title.style.margin = '0';
    title.textContent = item.name;
    makeEditable(title, newName => {
        if (!newName.trim()) return;
        item.name = newName;
        selectedItemId = `${type}-${newName}`;
        window.saveGlobalSpecialActivities(specialActivities);
        renderMasterLists();
    });
    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = 'Delete';
    deleteBtn.style.cssText = 'background:#c0392b; color:white;';
    deleteBtn.onclick = () => {
        if (confirm(`Delete "${item.name}"?`)) {
            const idx = specialActivities.indexOf(item);
            if (idx > -1) specialActivities.splice(idx, 1);
            selectedItemId = null;
            window.saveGlobalSpecialActivities(specialActivities);
            renderMasterLists();
            renderDetailPane();
        }
    };
    header.append(title, deleteBtn);
    detailPaneEl.appendChild(header);
    
    // 2. Max Usage Input (NEW)
    const limitDiv = document.createElement('div');
    limitDiv.style.cssText = "background:#f0f8ff; padding:10px; border-radius:5px; margin-bottom:15px; border:1px solid #cce5ff;";
    limitDiv.innerHTML = `<strong>Max Times per Season (0 = Unlimited):</strong><br>`;
    const limitInput = document.createElement('input');
    limitInput.type = "number";
    limitInput.min = "0";
    limitInput.value = item.maxUsage || 0;
    limitInput.style.marginTop = "5px";
    limitInput.style.width = "80px";
    limitInput.onchange = () => {
        item.maxUsage = parseInt(limitInput.value) || 0;
        window.saveGlobalSpecialActivities(specialActivities);
    };
    limitDiv.appendChild(limitInput);
    limitDiv.appendChild(document.createTextNode(" times per bunk"));
    detailPaneEl.appendChild(limitDiv);

    // 3. Controls
    const onSave = () => window.saveGlobalSpecialActivities(specialActivities);
    const onRerender = renderDetailPane;
    
    const sharableControls = renderSharableControls(item, onSave, onRerender);
    sharableControls.style.borderTop = '1px solid #eee';
    sharableControls.style.paddingTop = '15px';
    detailPaneEl.appendChild(sharableControls);
    
    const limitControls = renderAllowedBunksControls(item, onSave, onRerender);
    detailPaneEl.appendChild(limitControls);
    
    const timeRuleControls = renderTimeRulesUI(item, onSave, onRerender);
    timeRuleControls.style.cssText = "margin-top:10px; padding-top:10px; border-top:1px solid #eee;";
    detailPaneEl.appendChild(timeRuleControls);
}

function addSpecial() {
    const n = addSpecialInput.value.trim();
    if (!n) return;
    if (specialActivities.some(s => s.name.toLowerCase() === n.toLowerCase())) {
        alert("Name already exists."); return;
    }
    specialActivities.push({
        name: n,
        available: true,
        sharableWith: { type: 'not_sharable', divisions: [] },
        limitUsage: { enabled: false, divisions: {} },
        timeRules: [],
        maxUsage: 0 
    });
    addSpecialInput.value = "";
    window.saveGlobalSpecialActivities(specialActivities);
    selectedItemId = `special-${n}`;
    renderMasterLists();
    renderDetailPane();
}

// --- Helpers ---
function parseTimeToMinutes(str) { /* same as before */
    if (!str || typeof str !== "string") return null;
    let s = str.trim().toLowerCase(), mer = null;
    if (s.endsWith("am") || s.endsWith("pm")) { mer = s.endsWith("am") ? "am" : "pm"; s = s.replace(/am|pm/g, "").trim(); }
    const m = s.match(/^(\d{1,2})\s*:\s*(\d{2})$/);
    if (!m) return null;
    let hh = parseInt(m[1], 10), mm = parseInt(m[2], 10);
    if (Number.isNaN(hh)||Number.isNaN(mm)) return null;
    if (mer) { if (hh === 12) hh = mer === "am" ? 0 : 12; else if (mer === "pm") hh += 12; }
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
    // ... (Standard time rule renderer, abbreviated for brevity but assumed present)
    // Re-using the standard block from previous files for consistency
    const container = document.createElement("div");
    container.innerHTML = `<strong>Global Time Rules:</strong>`;
    if (!item.timeRules) item.timeRules = [];
    const ruleList = document.createElement("div");
    if (item.timeRules.length === 0) ruleList.innerHTML = `<p class="muted" style="margin:0;">No specific rules.</p>`;
    item.timeRules.forEach((rule, index) => {
        const ruleEl = document.createElement("div");
        ruleEl.style.cssText = "margin:2px 0; padding:4px; background:#f4f4f4; border-radius:4px;";
        ruleEl.innerHTML = `<strong style="color:${rule.type==='Available'?'green':'red'}">${rule.type}</strong> ${rule.start}-${rule.end} <button onclick="this.dispatchEvent(new CustomEvent('rem',{bubbles:true}))" style="margin-left:5px;border:none;background:none;cursor:pointer;">✖</button>`;
        ruleEl.querySelector('button').addEventListener('rem', () => { item.timeRules.splice(index, 1); onSave(); onRerender(); });
        ruleList.appendChild(ruleEl);
    });
    container.appendChild(ruleList);
    
    const addDiv = document.createElement("div");
    addDiv.style.marginTop = "5px";
    addDiv.innerHTML = `<select id="tr-type"><option value="Available">Available</option><option value="Unavailable">Unavailable</option></select> <input id="tr-start" placeholder="9:00am" style="width:70px;"> to <input id="tr-end" placeholder="10:00am" style="width:70px;"> <button id="tr-add">Add</button>`;
    addDiv.querySelector('#tr-add').onclick = () => {
        const type = addDiv.querySelector('#tr-type').value;
        const start = addDiv.querySelector('#tr-start').value;
        const end = addDiv.querySelector('#tr-end').value;
        if(parseTimeToMinutes(start)!=null && parseTimeToMinutes(end)!=null) {
            item.timeRules.push({type, start, end}); onSave(); onRerender();
        } else alert("Invalid times");
    };
    container.appendChild(addDiv);
    return container;
}

function renderSharableControls(item, onSave, onRerender) {
    const container = document.createElement("div");
    const rules = item.sharableWith || { type: 'not_sharable' };
    const isSharable = rules.type !== 'not_sharable';
    container.innerHTML = `<label class="switch"><input type="checkbox" ${isSharable?'checked':''}><span class="slider"></span></label> <strong>Sharable</strong>`;
    container.querySelector('input').onchange = (e) => {
        rules.type = e.target.checked ? 'all' : 'not_sharable';
        rules.divisions = [];
        onSave(); onRerender();
    };
    if (isSharable) {
        const sub = document.createElement('div');
        sub.innerHTML = `<br>Limit to Divisions:`;
        const box = createChipPicker(window.availableDivisions||[], rules.divisions, () => {
            rules.type = rules.divisions.length > 0 ? 'custom' : 'all'; onSave(); onRerender();
        });
        sub.appendChild(box);
        container.appendChild(sub);
    }
    return container;
}

function renderAllowedBunksControls(item, onSave, onRerender) {
    const container = document.createElement("div");
    container.style.cssText = "margin-top:10px; padding-top:10px; border-top:1px solid #eee;";
    container.innerHTML = `<strong>Allowed Divisions & Bunks:</strong>`;
    const rules = item.limitUsage || { enabled: false, divisions: {} };
    
    const togDiv = document.createElement('div');
    togDiv.innerHTML = `<label class="switch"><input type="checkbox" ${rules.enabled?'checked':''}><span class="slider"></span></label> Limit to Specific Bunks`;
    togDiv.querySelector('input').onchange = (e) => { rules.enabled = e.target.checked; onSave(); onRerender(); };
    container.appendChild(togDiv);

    if (rules.enabled) {
        const sub = document.createElement('div');
        (window.availableDivisions||[]).forEach(div => {
            const divRow = document.createElement('div');
            divRow.style.marginTop = '5px';
            const isDivAllowed = div in rules.divisions;
            const chip = createLimitChip(div, isDivAllowed, true);
            chip.onclick = () => {
                if (isDivAllowed) delete rules.divisions[div];
                else rules.divisions[div] = [];
                onSave(); onRerender();
            };
            divRow.appendChild(chip);
            
            if (isDivAllowed) {
                const bunks = window.divisions[div]?.bunks || [];
                const allowedBunks = rules.divisions[div];
                bunks.forEach(b => {
                    const bChip = createLimitChip(b, allowedBunks.includes(b), false);
                    bChip.style.marginLeft = '5px';
                    bChip.onclick = () => {
                        const idx = allowedBunks.indexOf(b);
                        if (idx > -1) allowedBunks.splice(idx, 1); else allowedBunks.push(b);
                        onSave(); onRerender();
                    };
                    divRow.appendChild(bChip);
                });
            }
            sub.appendChild(divRow);
        });
        container.appendChild(sub);
    }
    return container;
}

function createChipPicker(items, selected, onToggle) {
    const d = document.createElement('div'); d.className='chips';
    items.forEach(i => {
        const s = document.createElement('span'); s.className='chip'; s.textContent=i;
        if(selected.includes(i)) { s.style.background='#007BFF'; s.style.color='white'; }
        s.onclick = () => {
            const idx = selected.indexOf(i);
            if(idx>-1) selected.splice(idx,1); else selected.push(i);
            onToggle();
        };
        d.appendChild(s);
    });
    return d;
}

function createLimitChip(name, active, isDiv) {
    const s = document.createElement('span'); 
    s.style.padding='2px 6px'; s.style.border='1px solid #ccc'; s.style.borderRadius='10px'; s.style.cursor='pointer'; s.style.display='inline-block';
    s.textContent = name;
    if(active) { s.style.background = isDiv ? '#007BFF' : '#17a2b8'; s.style.color='white'; }
    else { s.style.background='#f9f9f9'; }
    return s;
}

window.initSpecialActivitiesTab = initSpecialActivitiesTab;

})();
