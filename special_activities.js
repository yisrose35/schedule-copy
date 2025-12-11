// ============================================================================
// special_activities.js — MERGED: NEW UX + EXISTING LOGIC
// ============================================================================
// 1. Layout: Apple-inspired Two-Pane with Collapsible Detail Sections.
// 2. Logic: Retains all Transition, Frequency, Sharing, Priority, and Time logic.
// ============================================================================

(function(){
'use strict';

let specialActivities = [];
let selectedItemId = null;
let specialsListEl = null;
let detailPaneEl = null;
let addSpecialInput = null;

//------------------------------------------------------------------
// INIT
//------------------------------------------------------------------
function initSpecialActivitiesTab(){
    const container = document.getElementById("special_activities");
    if(!container) return;
    
    // Load Data
    specialActivities = window.getGlobalSpecialActivities?.() || [];

    // Ensure data completeness (Schema Migration)
    specialActivities.forEach(s => {
        s.available = s.available !== false;
        s.timeRules = s.timeRules || [];
        s.sharableWith = s.sharableWith || { type: 'not_sharable', divisions: [] };
        if (!s.sharableWith.capacity) s.sharableWith.capacity = 2;

        s.limitUsage = s.limitUsage || { enabled: false, divisions: {} };
        s.maxUsage = (s.maxUsage !== undefined && s.maxUsage !== "") ? s.maxUsage : null;
        s.frequencyWeeks = s.frequencyWeeks || 0; 
        
        s.preferences = s.preferences || { enabled: false, exclusive: false, list: [] };

        s.transition = s.transition || {
            preMin: 0,
            postMin: 0,
            label: "Change Time",
            zone: window.DEFAULT_ZONE_NAME,
            occupiesField: true,
            minDurationMin: 0 
        };
    });

    // Inject Styles (Shared with Fields tab for consistency)
    const style = document.createElement('style');
    style.innerHTML = `
        /* New UX Styles */
        .master-list { border: 1px solid #E5E7EB; border-radius: 12px; background: #fff; overflow: hidden; }
        .list-item { padding: 12px 14px; border-bottom: 1px solid #F3F4F6; cursor: pointer; display: flex; justify-content: space-between; align-items: center; transition: background 0.15s; }
        .list-item:last-child { border-bottom: none; }
        .list-item:hover { background: #F9FAFB; }
        .list-item.selected { background: #F0FDF4; border-left: 3px solid #10B981; }
        .list-item-name { font-weight: 500; color: #1F2937; font-size: 0.9rem; }
        .list-item-meta { font-size: 0.75rem; color: #6B7280; margin-left: 6px; }

        /* Accordion / Collapsible Sections */
        .detail-section { margin-bottom: 12px; border: 1px solid #E5E7EB; border-radius: 12px; background: #fff; overflow: hidden; }
        .detail-section-header { padding: 12px 16px; background: #F9FAFB; cursor: pointer; display: flex; justify-content: space-between; align-items: center; user-select: none; }
        .detail-section-header:hover { background: #F3F4F6; }
        .detail-section-title { font-size: 0.9rem; font-weight: 600; color: #111; }
        .detail-section-summary { font-size: 0.8rem; color: #6B7280; margin-top: 2px; }
        .detail-section-body { display: none; padding: 16px; border-top: 1px solid #E5E7EB; }
        
        /* Inner Controls */
        .chip { display: inline-block; padding: 4px 10px; border-radius: 999px; font-size: 0.75rem; cursor: pointer; border: 1px solid #E5E7EB; margin-right: 4px; margin-bottom: 4px; transition: all 0.2s; }
        .chip.active { background: #10B981; color: white; border-color: #10B981; box-shadow: 0 2px 5px rgba(16, 185, 129, 0.3); }
        .chip.inactive { background: #F3F4F6; color: #374151; }
        
        .priority-list-item { display: flex; align-items: center; gap: 10px; padding: 8px; background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 8px; margin-bottom: 6px; }
        .priority-btn { width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; border: 1px solid #D1D5DB; border-radius: 4px; background: white; cursor: pointer; font-size: 0.8rem; }
        .priority-btn:hover:not(:disabled) { border-color: #10B981; color: #10B981; }
        .priority-btn:disabled { opacity: 0.4; cursor: default; }

        /* Switch/Toggle */
        .switch { position: relative; display: inline-block; width: 34px; height: 20px; }
        .switch input { opacity: 0; width: 0; height: 0; }
        .slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: #ccc; transition: .4s; border-radius: 34px; }
        .slider:before { position: absolute; content: ""; height: 14px; width: 14px; left: 3px; bottom: 3px; background-color: white; transition: .4s; border-radius: 50%; }
        input:checked + .slider { background-color: #10B981; }
        input:checked + .slider:before { transform: translateX(14px); }
    `;
    container.appendChild(style);

    // Layout Shell
    container.innerHTML += `
        <div class="setup-grid">
          <section class="setup-card setup-card-wide" style="border:none; box-shadow:none; background:transparent;">
            <div class="setup-card-header" style="margin-bottom:20px;">
              <span class="setup-step-pill">Specials</span>
              <div class="setup-card-text">
                <h3>Special Activities & Rotations</h3>
                <p>Configure canteen, electives, trips, and their availability rules.</p>
              </div>
            </div>

            <div style="display:flex; flex-wrap:wrap; gap:24px;">
              <!-- LEFT SIDE: MASTER LIST -->
              <div style="flex:1; min-width:280px;">
                <div style="display:flex; justify-content:space-between; align-items:end; margin-bottom:8px;">
                    <div class="setup-subtitle">All Specials</div>
                </div>
                
                <div style="background:white; padding:10px; border-radius:12px; border:1px solid #E5E7EB; margin-bottom:12px; display:flex; gap:8px;">
                  <input id="new-special-input" placeholder="New Special (e.g., Canteen)" style="flex:1; border:none; outline:none; font-size:0.9rem;">
                  <button id="add-special-btn" style="background:#111; color:white; border:none; border-radius:6px; padding:6px 12px; font-size:0.8rem; cursor:pointer;">Add</button>
                </div>

                <div id="specials-master-list" class="master-list" style="max-height:600px; overflow-y:auto;"></div>
              </div>

              <!-- RIGHT SIDE: DETAIL PANE -->
              <div style="flex:1.4; min-width:340px;">
                <div class="setup-subtitle">Configuration</div>
                <div id="specials-detail-pane" style="margin-top:8px;"></div>
              </div>
            </div>
          </section>
        </div>`;

    specialsListEl = document.getElementById("specials-master-list");
    detailPaneEl = document.getElementById("specials-detail-pane");
    addSpecialInput = document.getElementById("new-special-input");

    document.getElementById("add-special-btn").onclick = addSpecial;
    addSpecialInput.onkeyup = e => { if(e.key === "Enter") addSpecial(); };

    renderMasterLists();
    renderDetailPane();
}

//------------------------------------------------------------------
// DATA HELPERS
//------------------------------------------------------------------
function save(){
    window.saveGlobalSpecialActivities?.(specialActivities);
}

//------------------------------------------------------------------
// LEFT LIST
//------------------------------------------------------------------
function renderMasterLists(){
    specialsListEl.innerHTML = "";
    if(specialActivities.length === 0){
        specialsListEl.innerHTML = `<div style="padding:20px; text-align:center; color:#9CA3AF;">No specials created yet.</div>`;
        return;
    }
    specialActivities.forEach(s => specialsListEl.appendChild(masterListItem(s)));
}

function masterListItem(item){
    const id = `special-${item.name}`;
    const el = document.createElement("div");
    el.className = "list-item" + (id === selectedItemId ? " selected" : "");
    el.onclick = ()=>{ selectedItemId = id; renderMasterLists(); renderDetailPane(); };

    const infoDiv = document.createElement("div");
    const name = document.createElement("div");
    name.className = "list-item-name";
    name.textContent = item.name;

    // Add meta info (Transition)
    if(item.transition.preMin > 0 || item.transition.postMin > 0){
        const meta = document.createElement("span");
        meta.className = "list-item-meta";
        meta.textContent = `(${item.transition.preMin}m / ${item.transition.postMin}m)`;
        name.appendChild(meta);
    }
    infoDiv.appendChild(name);
    el.appendChild(infoDiv);

    // Toggle Switch
    const tog = document.createElement("label");
    tog.className = "switch list-item-toggle";
    tog.onclick = e => e.stopPropagation();
    
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = item.available;
    cb.onchange = () => { item.available = cb.checked; save(); renderDetailPane(); };
    
    const slider = document.createElement("span"); slider.className = "slider";
    tog.appendChild(cb); tog.appendChild(slider);
    el.appendChild(tog);

    return el;
}

//------------------------------------------------------------------
// RIGHT PANEL - ACCORDION LAYOUT
//------------------------------------------------------------------
function renderDetailPane(){
    if(!selectedItemId){ 
        detailPaneEl.innerHTML = `
            <div style="height:300px; display:flex; align-items:center; justify-content:center; color:#9CA3AF; border:1px dashed #E5E7EB; border-radius:12px;">
                Select a special to edit
            </div>`; 
        return; 
    }

    const [, name] = selectedItemId.split(/-(.+)/);
    const item = specialActivities.find(s => s.name === name);
    if(!item){ detailPaneEl.innerHTML = `<p class='muted'>Not found.</p>`; return; }

    detailPaneEl.innerHTML = "";
    const onSave = () => save();
    const onRerender = () => renderDetailPane();

    // -- 1. HEADER --
    const header = document.createElement("div");
    header.style.display = "flex";
    header.style.justifyContent = "space-between";
    header.style.alignItems = "center";
    header.style.marginBottom = "16px";

    const title = document.createElement("h2");
    title.textContent = item.name;
    title.style.margin = "0";
    title.style.fontSize = "1.25rem";
    makeEditable(title, newName=>{
        if(!newName.trim()) return;
        item.name = newName;
        selectedItemId = `special-${newName}`;
        save();
        renderMasterLists();
        renderDetailPane();
    });

    const delBtn = document.createElement("button");
    delBtn.innerHTML = `Delete`;
    delBtn.style.color = "#DC2626";
    delBtn.style.background = "#FEF2F2";
    delBtn.style.border = "1px solid #FECACA";
    delBtn.style.padding = "6px 12px";
    delBtn.style.borderRadius = "6px";
    delBtn.style.cursor = "pointer";
    delBtn.onclick = ()=>{
        if(confirm(`Delete ${item.name}?`)){
            specialActivities = specialActivities.filter(s => s !== item);
            save();
            selectedItemId = null;
            renderMasterLists();
            renderDetailPane();
        }
    };

    header.appendChild(title);
    header.appendChild(delBtn);
    detailPaneEl.appendChild(header);

    // -- 2. AVAILABILITY STRIP --
    const availability = document.createElement("div");
    availability.style.padding = "12px";
    availability.style.borderRadius = "8px";
    availability.style.marginBottom = "20px";
    availability.style.background = item.available ? "#ECFDF5" : "#FEF2F2";
    availability.style.border = item.available ? "1px solid #A7F3D0" : "1px solid #FECACA";
    availability.style.color = item.available ? "#065F46" : "#991B1B";
    availability.style.fontSize = "0.9rem";
    availability.innerHTML = `<span><strong>${item.available ? 'AVAILABLE' : 'UNAVAILABLE'}</strong></span> <span style="font-size:0.8rem; opacity:0.8;">Toggle in master list</span>`;
    detailPaneEl.appendChild(availability);

    // -- 3. ACCORDION SECTIONS --
    
    // Transition & Duration
    detailPaneEl.appendChild(section("Transition & Duration Rules", summaryTransition(item), 
        () => renderTransitionControls(item.transition, onSave, onRerender)));

    // Frequency
    detailPaneEl.appendChild(section("Frequency Limits", summaryFrequency(item),
        () => renderFrequencyControls(item, onSave, onRerender)));

    // Sharing
    detailPaneEl.appendChild(section("Sharing Rules", summarySharing(item),
        () => renderSharableControls(item, onSave, onRerender)));
        
    // Access & Restrictions (Priority)
    detailPaneEl.appendChild(section("Access & Restrictions", summaryAccess(item),
        () => renderAllowedBunksControls(item, onSave, onRerender)));

    // Time Rules
    detailPaneEl.appendChild(section("Global Time Rules", summaryTime(item),
        () => renderTimeRulesUI(item, onSave, onRerender)));
}

//------------------------------------------------------------------
// SECTION BUILDER
//------------------------------------------------------------------
function section(title, summary, builder){
    const wrap = document.createElement("div"); 
    wrap.className = "detail-section";

    const head = document.createElement("div");
    head.className = "detail-section-header";

    const t = document.createElement("div");
    t.innerHTML = `<div class="detail-section-title">${title}</div><div class="detail-section-summary">${summary}</div>`;

    const caret = document.createElement("span");
    caret.innerHTML = `<svg width="20" height="20" fill="none" stroke="#9CA3AF" stroke-width="2" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"></path></svg>`;
    caret.style.transition = "transform 0.2s";

    head.appendChild(t);
    head.appendChild(caret);

    const body = document.createElement("div");
    body.className = "detail-section-body";

    head.onclick = ()=>{
        const open = body.style.display === "block";
        body.style.display = open ? "none" : "block";
        caret.style.transform = open ? "rotate(0deg)" : "rotate(90deg)";
        if(!open && !body.dataset.built){ 
            body.innerHTML = ""; 
            body.appendChild(builder()); 
            body.dataset.built = "1"; 
        }
    };

    wrap.appendChild(head);
    wrap.appendChild(body);
    return wrap;
}

//------------------------------------------------------------------
// SUMMARIES
//------------------------------------------------------------------
function summaryTransition(i) { return `${i.transition.preMin}m Pre / ${i.transition.postMin}m Post`; }
function summaryFrequency(i) { return i.maxUsage ? `Limit: ${i.maxUsage}x per period` : "Unlimited usage"; }
function summarySharing(i) { return i.sharableWith.type === 'not_sharable' ? "Not sharable" : `Sharable (Max ${i.sharableWith.capacity})`; }
function summaryTime(i) { return i.timeRules.length ? `${i.timeRules.length} rule(s) active` : "Available all day"; }
function summaryAccess(i) {
    if(!i.limitUsage.enabled) return "Open to All Divisions";
    if(i.preferences.exclusive) return "Exclusive to specific divisions";
    return "Priority/Restrictions Active";
}

//------------------------------------------------------------------
// 1. TRANSITION CONTROLS
//------------------------------------------------------------------
function renderTransitionControls(transition, onSave, onRerender) {
    const container = document.createElement("div");
    const update = () => { onSave(); onRerender(); }; // Update master list bubble

    const row = document.createElement("div");
    row.style.display="flex"; row.style.gap="12px"; row.style.marginBottom="12px"; row.style.flexWrap="wrap";

    const mkInput = (lbl, val, setter) => {
        const d = document.createElement("div");
        d.innerHTML = `<label style="display:block; font-size:0.8rem; font-weight:600; margin-bottom:4px;">${lbl}</label>`;
        const i = document.createElement("input");
        i.type="number"; i.min="0"; i.step="5"; i.value=val;
        i.style.width="80px"; i.style.padding="6px"; i.style.border="1px solid #D1D5DB"; i.style.borderRadius="6px";
        i.onchange = ()=>{ setter(parseInt(i.value)||0); update(); };
        d.appendChild(i); return d;
    };

    row.appendChild(mkInput("Pre-Buffer (min)", transition.preMin, v=>transition.preMin=v));
    row.appendChild(mkInput("Post-Buffer (min)", transition.postMin, v=>transition.postMin=v));
    container.appendChild(row);

    // Zone & Min Duration
    const row2 = document.createElement("div");
    row2.style.display="flex"; row2.style.gap="12px"; row2.style.marginBottom="12px"; row2.style.flexWrap="wrap";
    
    // Zone
    const zoneDiv = document.createElement("div");
    zoneDiv.style.flex = "1"; zoneDiv.style.minWidth="140px";
    zoneDiv.innerHTML = `<label style="display:block; font-size:0.8rem; font-weight:600; margin-bottom:4px;">Zone (Location)</label>`;
    const zoneSel = document.createElement("select");
    zoneSel.style.width="100%"; zoneSel.style.padding="6px"; zoneSel.style.borderRadius="6px"; zoneSel.style.border="1px solid #D1D5DB";
    const zones = window.getZones?.() || {};
    Object.values(zones).forEach(z => {
        const opt = document.createElement("option");
        opt.value = z.name;
        opt.textContent = z.name + (z.isDefault ? ' (Default)' : '');
        if(z.name === transition.zone) opt.selected = true;
        zoneSel.appendChild(opt);
    });
    zoneSel.onchange = ()=>{ transition.zone = zoneSel.value; update(); };
    zoneDiv.appendChild(zoneSel);
    row2.appendChild(zoneDiv);

    row2.appendChild(mkInput("Min Duration (min)", transition.minDurationMin, v=>transition.minDurationMin=v));
    container.appendChild(row2);

    // Occupancy
    const occLabel = document.createElement("label");
    occLabel.style.display="flex"; occLabel.style.alignItems="center"; occLabel.style.gap="8px"; occLabel.style.cursor="pointer";
    const occCk = document.createElement("input"); occCk.type="checkbox"; occCk.checked = transition.occupiesField;
    occCk.onchange = ()=>{ transition.occupiesField = occCk.checked; update(); };
    occLabel.appendChild(occCk);
    occLabel.appendChild(document.createTextNode("Buffer occupies resource (e.g. Setup/Teardown)"));
    container.appendChild(occLabel);

    return container;
}

//------------------------------------------------------------------
// 2. FREQUENCY CONTROLS
//------------------------------------------------------------------
function renderFrequencyControls(item, onSave, onRerender){
    const container = document.createElement("div");

    if(item.maxUsage === null){
        const txt = document.createElement("p");
        txt.className = "muted";
        txt.textContent = "Unlimited usage allowed.";
        container.appendChild(txt);

        const btn = document.createElement("button");
        btn.textContent = "+ Add Frequency Rule";
        btn.style.background = "#00C896"; btn.style.color = "white"; btn.style.border="none"; btn.style.padding="6px 12px"; btn.style.borderRadius="6px"; btn.style.cursor="pointer";
        btn.onclick = ()=>{
            item.maxUsage = 1;
            item.frequencyWeeks = 0;
            onSave();
            // Update summary
            const summaryEl = container.closest('.detail-section')?.querySelector('.detail-section-summary');
            if(summaryEl) summaryEl.textContent = summaryFrequency(item);
            // Re-render internal content
            container.innerHTML = "";
            container.appendChild(renderFrequencyControls(item, onSave, onRerender));
        };
        container.appendChild(btn);
        return container;
    }

    const row = document.createElement("div");
    row.style.display="flex"; row.style.alignItems="center"; row.style.gap="10px"; row.style.flexWrap="wrap";

    const count = document.createElement("input"); count.type="number"; count.value=item.maxUsage; count.min="1";
    count.style.width="60px"; count.style.padding="6px"; count.style.borderRadius="6px"; count.style.border="1px solid #D1D5DB";
    count.onchange = ()=>{ item.maxUsage = Math.max(1, parseInt(count.value)||1); onSave(); };

    const txt = document.createElement("span"); txt.textContent = " time(s) per ";

    const freq = document.createElement("select");
    freq.style.padding="6px"; freq.style.borderRadius="6px"; freq.style.border="1px solid #D1D5DB";
    [0,1,2,3,4].forEach(v=>{
        const op = document.createElement("option"); op.value=v;
        op.textContent = v===0 ? "Summer (Lifetime)" : `${v} week(s)`;
        if(item.frequencyWeeks===v) op.selected=true;
        freq.appendChild(op);
    });
    freq.onchange = ()=>{ item.frequencyWeeks = parseInt(freq.value); onSave(); };

    const rm = document.createElement("button"); rm.textContent="Remove Limit";
    rm.style.color="#DC2626"; rm.style.background="transparent"; rm.style.border="1px solid #FECACA"; rm.style.borderRadius="6px"; rm.style.padding="4px 8px"; rm.style.cursor="pointer";
    rm.onclick = ()=>{ 
        item.maxUsage=null; 
        onSave(); 
        const summaryEl = container.closest('.detail-section')?.querySelector('.detail-section-summary');
        if(summaryEl) summaryEl.textContent = summaryFrequency(item);
        container.innerHTML = "";
        container.appendChild(renderFrequencyControls(item, onSave, onRerender));
    };

    row.appendChild(count);
    row.appendChild(txt);
    row.appendChild(freq);
    row.appendChild(rm);
    container.appendChild(row);

    return container;
}

//------------------------------------------------------------------
// 3. SHARING CONTROLS
//------------------------------------------------------------------
function renderSharableControls(item, onSave, onRerender) {
    const container = document.createElement("div");
    const rules = item.sharableWith;

    const tog = document.createElement("label"); tog.className = "switch";
    const cb = document.createElement("input"); cb.type = "checkbox";
    cb.checked = rules.type !== 'not_sharable';
    cb.onchange = ()=>{
        rules.type = cb.checked ? 'all' : 'not_sharable';
        rules.divisions = [];
        onSave();
        // Update summary
        const summaryEl = container.closest('.detail-section')?.querySelector('.detail-section-summary');
        if(summaryEl) summaryEl.textContent = summarySharing(item);
        // Re-render
        container.innerHTML = "";
        container.appendChild(renderSharableControls(item, onSave, onRerender));
    };
    const sl = document.createElement("span"); sl.className = "slider";
    tog.appendChild(cb); tog.appendChild(sl);
    
    const header = document.createElement("div");
    header.style.display="flex"; header.style.alignItems="center"; header.style.gap="10px";
    header.appendChild(tog);
    header.appendChild(document.createTextNode("Allow Sharing"));
    container.appendChild(header);

    if(rules.type !== 'not_sharable'){
        const det = document.createElement("div");
        det.style.marginTop="16px"; det.style.paddingLeft="12px"; det.style.borderLeft="2px solid #E5E7EB";

        // Capacity
        const capRow = document.createElement("div");
        capRow.style.marginBottom="12px";
        capRow.innerHTML = `<span>Max Capacity: </span>`;
        const capIn = document.createElement("input"); capIn.type="number"; capIn.min="2"; capIn.value=rules.capacity;
        capIn.style.width="60px"; capIn.style.marginLeft="8px"; capIn.style.padding="4px";
        capIn.onchange = ()=>{ 
            rules.capacity = Math.max(2, parseInt(capIn.value)||2); 
            onSave(); 
            const summaryEl = container.closest('.detail-section')?.querySelector('.detail-section-summary');
            if(summaryEl) summaryEl.textContent = summarySharing(item);
        };
        capRow.appendChild(capIn);
        det.appendChild(capRow);

        // Limit Divisions
        const divLabel = document.createElement("div");
        divLabel.textContent = "Limit sharing to specific divisions (Optional):";
        divLabel.style.fontSize="0.85rem"; divLabel.style.marginBottom="6px";
        det.appendChild(divLabel);

        const allDivs = window.availableDivisions || [];
        allDivs.forEach(d => {
            const isActive = rules.divisions.includes(d);
            const chip = document.createElement("span");
            chip.className = "chip " + (isActive ? "active" : "inactive");
            chip.textContent = d;
            chip.onclick = ()=>{
                if(isActive) rules.divisions = rules.divisions.filter(x=>x!==d);
                else rules.divisions.push(d);
                rules.type = rules.divisions.length > 0 ? 'custom' : 'all';
                onSave();
                chip.className = "chip " + (rules.divisions.includes(d) ? "active" : "inactive");
            };
            det.appendChild(chip);
        });
        container.appendChild(det);
    }
    return container;
}

//------------------------------------------------------------------
// 4. ACCESS & PRIORITY CONTROLS (Similar to Fields)
//------------------------------------------------------------------
function renderAllowedBunksControls(item, onSave, onRerender) {
    const container = document.createElement("div");

    const updateSummary = () => {
        const summaryEl = container.closest('.detail-section')?.querySelector('.detail-section-summary');
        if(summaryEl) summaryEl.textContent = summaryAccess(item);
    };

    const renderContent = () => {
        container.innerHTML = "";
        const rules = item.limitUsage;
        const prefs = item.preferences;

        // Buttons
        const modeWrap = document.createElement("div");
        modeWrap.style.display="flex"; modeWrap.style.gap="12px"; modeWrap.style.marginBottom="16px";
        
        const btnAll = document.createElement("button");
        btnAll.textContent = "Open to All";
        btnAll.style.cssText = `flex:1; padding:8px; border-radius:6px; border:1px solid #E5E7EB; cursor:pointer; background:${!rules.enabled ? '#ECFDF5' : '#fff'}; color:${!rules.enabled ? '#047857' : '#333'}; border-color:${!rules.enabled ? '#10B981' : '#E5E7EB'}; transition:all 0.2s;`;
        
        const btnRes = document.createElement("button");
        btnRes.textContent = "Restricted / Priority";
        btnRes.style.cssText = `flex:1; padding:8px; border-radius:6px; border:1px solid #E5E7EB; cursor:pointer; background:${rules.enabled ? '#ECFDF5' : '#fff'}; color:${rules.enabled ? '#047857' : '#333'}; border-color:${rules.enabled ? '#10B981' : '#E5E7EB'}; transition:all 0.2s;`;

        btnAll.onclick = ()=>{ rules.enabled=false; prefs.enabled=false; onSave(); renderContent(); updateSummary(); };
        btnRes.onclick = ()=>{ rules.enabled=true; prefs.enabled=true; onSave(); renderContent(); updateSummary(); };

        modeWrap.appendChild(btnAll);
        modeWrap.appendChild(btnRes);
        container.appendChild(modeWrap);

        if(rules.enabled){
            const body = document.createElement("div");
            
            // Exclusive
            const exLabel = document.createElement("label");
            exLabel.style.display="flex"; exLabel.style.alignItems="center"; exLabel.style.gap="8px"; exLabel.style.marginBottom="12px";
            const exCk = document.createElement("input"); exCk.type="checkbox"; exCk.checked=prefs.exclusive;
            exCk.onchange = ()=>{ prefs.exclusive=exCk.checked; onSave(); updateSummary(); };
            exLabel.appendChild(exCk);
            exLabel.appendChild(document.createTextNode("Exclusive Mode (Only allowed divisions)"));
            body.appendChild(exLabel);

            // Priority List
            const pHeader = document.createElement("div");
            pHeader.textContent = "Priority Order:";
            pHeader.style.fontSize="0.85rem"; pHeader.style.fontWeight="600"; pHeader.style.marginBottom="6px";
            body.appendChild(pHeader);

            const listContainer = document.createElement("div");
            prefs.list = (prefs.list || []).filter(d => rules.divisions.hasOwnProperty(d));
            
            if(prefs.list.length === 0) listContainer.innerHTML = `<div class="muted" style="font-size:0.8rem; font-style:italic; padding:4px;">No priority divisions set. Add below.</div>`;

            prefs.list.forEach((divName, idx) => {
                const row = document.createElement("div"); row.className = "priority-list-item";
                row.innerHTML = `<span style="font-weight:bold; color:#10B981; width:20px;">${idx+1}</span> <span style="flex:1;">${divName}</span>`;
                
                const ctrls = document.createElement("div"); ctrls.style.display="flex"; ctrls.style.gap="4px";
                
                const mkBtn = (txt, fn, dis) => {
                    const b = document.createElement("button"); b.className="priority-btn"; b.textContent=txt;
                    if(dis) b.disabled=true; else b.onclick=fn;
                    return b;
                };
                
                ctrls.appendChild(mkBtn("↑", ()=>{ 
                    [prefs.list[idx-1], prefs.list[idx]] = [prefs.list[idx], prefs.list[idx-1]]; onSave(); renderContent(); 
                }, idx===0));
                
                ctrls.appendChild(mkBtn("↓", ()=>{ 
                    [prefs.list[idx+1], prefs.list[idx]] = [prefs.list[idx], prefs.list[idx+1]]; onSave(); renderContent(); 
                }, idx===prefs.list.length-1));
                
                const rm = mkBtn("✕", ()=>{ 
                    prefs.list = prefs.list.filter(d=>d!==divName); onSave(); renderContent(); 
                }, false);
                rm.style.color="#DC2626"; rm.style.borderColor="#FECACA";
                ctrls.appendChild(rm);

                row.appendChild(ctrls);
                listContainer.appendChild(row);
            });
            body.appendChild(listContainer);

            // Chips
            const divHeader = document.createElement("div");
            divHeader.textContent = "Allowed Divisions:";
            divHeader.style.fontSize="0.85rem"; divHeader.style.fontWeight="600"; divHeader.style.marginTop="16px"; divHeader.style.marginBottom="6px";
            body.appendChild(divHeader);

            const chipWrap = document.createElement("div");
            const allDivs = window.availableDivisions || [];
            allDivs.forEach(divName => {
                const isAllowed = divName in rules.divisions;
                const c = document.createElement("span");
                c.className = "chip " + (isAllowed ? "active" : "inactive");
                c.textContent = divName;
                c.onclick = ()=>{
                    if(isAllowed){
                        delete rules.divisions[divName];
                        prefs.list = prefs.list.filter(d => d !== divName);
                    } else {
                        rules.divisions[divName] = [];
                        if(!prefs.list.includes(divName)) prefs.list.push(divName);
                    }
                    onSave();
                    renderContent(); 
                };
                chipWrap.appendChild(c);
            });
            body.appendChild(chipWrap);
            container.appendChild(body);
        }
    };
    renderContent();
    return container;
}

//------------------------------------------------------------------
// 5. TIME RULES CONTROLS
//------------------------------------------------------------------
function renderTimeRulesUI(item, onSave, onRerender){
    const container = document.createElement("div");
    
    // Existing Rules
    if(item.timeRules.length > 0){
        item.timeRules.forEach((r, i) => {
            const row = document.createElement("div");
            row.style.display="flex"; row.style.justifyContent="space-between"; row.style.alignItems="center";
            row.style.background="#F9FAFB"; row.style.padding="8px"; row.style.marginBottom="6px"; row.style.borderRadius="6px"; row.style.border="1px solid #E5E7EB";
            
            const txt = document.createElement("span");
            txt.innerHTML = `<strong style="color:${r.type==='Available'?'#059669':'#DC2626'}">${r.type}</strong>: ${r.start} to ${r.end}`;
            
            const del = document.createElement("button");
            del.textContent="✕"; del.style.border="none"; del.style.background="transparent"; del.style.color="#9CA3AF"; del.style.cursor="pointer";
            del.onclick = ()=>{ 
                item.timeRules.splice(i,1); 
                onSave(); 
                const summaryEl = container.closest('.detail-section')?.querySelector('.detail-section-summary');
                if(summaryEl) summaryEl.textContent = summaryTime(item);
                container.innerHTML=""; container.appendChild(renderTimeRulesUI(item, onSave, onRerender)); 
            };
            row.appendChild(txt); row.appendChild(del);
            container.appendChild(row);
        });
    } else {
        container.innerHTML = `<div class="muted" style="font-size:0.8rem; margin-bottom:10px;">Available all day</div>`;
    }

    // Add New
    const addRow = document.createElement("div");
    addRow.style.display="flex"; addRow.style.gap="8px"; addRow.style.marginTop="12px"; addRow.style.paddingTop="12px"; addRow.style.borderTop="1px dashed #E5E7EB";
    
    const typeSel = document.createElement("select");
    typeSel.innerHTML=`<option>Available</option><option>Unavailable</option>`;
    typeSel.style.borderRadius="6px"; typeSel.style.border="1px solid #D1D5DB";
    
    const startIn = document.createElement("input"); startIn.placeholder="9:00am"; startIn.style.width="70px"; startIn.style.padding="4px"; startIn.style.borderRadius="6px"; startIn.style.border="1px solid #D1D5DB";
    const endIn = document.createElement("input"); endIn.placeholder="10:00am"; endIn.style.width="70px"; endIn.style.padding="4px"; endIn.style.borderRadius="6px"; endIn.style.border="1px solid #D1D5DB";
    
    const btn = document.createElement("button");
    btn.textContent="Add"; btn.style.background="#111"; btn.style.color="white"; btn.style.border="none"; btn.style.borderRadius="6px"; btn.style.padding="4px 12px"; btn.style.cursor="pointer";
    
    btn.onclick = ()=>{
        if(!startIn.value || !endIn.value) return;
        if(parseTimeToMinutes(startIn.value) === null){ alert("Invalid Start Time"); return; }
        item.timeRules.push({ type: typeSel.value, start: startIn.value, end: endIn.value });
        onSave();
        const summaryEl = container.closest('.detail-section')?.querySelector('.detail-section-summary');
        if(summaryEl) summaryEl.textContent = summaryTime(item);
        container.innerHTML=""; container.appendChild(renderTimeRulesUI(item, onSave, onRerender));
    };

    addRow.appendChild(typeSel);
    addRow.appendChild(startIn);
    addRow.appendChild(document.createTextNode(" to "));
    addRow.appendChild(endIn);
    addRow.appendChild(btn);
    container.appendChild(addRow);
    return container;
}

//------------------------------------------------------------------
// HELPERS
//------------------------------------------------------------------
function makeEditable(el, saveFn){
    el.ondblclick = ()=>{
        const inp = document.createElement("input"); inp.value = el.textContent;
        inp.style.fontSize = "inherit"; inp.style.fontWeight = "inherit"; inp.style.border="1px solid #10B981"; inp.style.outline="none"; inp.style.borderRadius="4px";
        el.replaceWith(inp); inp.focus();
        const finish = ()=>{ saveFn(inp.value.trim()); if(inp.parentNode) inp.replaceWith(el); };
        inp.onblur = finish;
        inp.onkeyup = e=>{ if(e.key==="Enter") finish(); };
    };
}

function addSpecial() {
    const n = addSpecialInput.value.trim();
    if (!n) return;
    if (specialActivities.some(s => s.name.toLowerCase() === n.toLowerCase())) { alert("Special already exists."); return; }

    specialActivities.push({
        name: n,
        available: true,
        sharableWith: { type:'not_sharable', divisions:[], capacity: 2 },
        limitUsage: { enabled:false, divisions:{} },
        preferences: { enabled: false, exclusive: false, list: [] },
        timeRules: [],
        maxUsage: null,
        frequencyWeeks: 0,
        transition: { preMin: 0, postMin: 0, label: "Change Time", zone: window.DEFAULT_ZONE_NAME, occupiesField: true, minDurationMin: 0 }
    });

    addSpecialInput.value = "";
    save();
    selectedItemId = `special-${n}`;
    renderMasterLists(); renderDetailPane();
}

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

//------------------------------------------------------------------
// EXPORTS
//------------------------------------------------------------------
window.initSpecialActivitiesTab = initSpecialActivitiesTab;
window.specialActivities = specialActivities;

})();
