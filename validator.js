// =================================================================
// validator.js
//
// Scans the schedule for conflicts.
// UPDATED TO MATCH UI LOGIC:
// - Uses "Fuzzy Match" to resolve "Blacktop - Sport" -> "Blacktop".
// - Catches conflicts even if sports are different.
// - Lists specific bunks involved in the conflict.
// =================================================================

(function() {
    'use strict';

    // ==========================================================================
    // HELPER: RESOURCE RESOLVER (Matches UI Logic)
    // ==========================================================================
    function resolveResourceName(input, knownNames) {
        if (!input || !knownNames) return null;
        const cleanInput = String(input).toLowerCase().trim();
        
        // 1. Exact Match
        if (knownNames.includes(input)) return input;

        // 2. Starts With (Sort by length so "Court B" matches before "Court")
        // We look for the "Root" resource name within the input string.
        const sortedNames = [...knownNames].sort((a,b) => b.length - a.length);
        
        for (const name of sortedNames) {
            const cleanName = name.toLowerCase().trim();
            if (cleanInput.startsWith(cleanName)) {
                return name;
            }
        }
        return null; 
    }

    function validateSchedule() {
        const assignments = window.scheduleAssignments || {};
        const unifiedTimes = window.unifiedTimes || [];
        
        // 1. Load Definitions (Fields AND Special Activities)
        const app1 = window.loadGlobalSettings?.().app1 || {};
        const fieldsList = app1.fields || [];
        const specialsList = app1.specialActivities || [];
        
        // Map resource names to their specific rules
        const resourceRules = {};
        const allKnownResources = [];

        // Helper to process items
        const processItem = (item) => {
            resourceRules[item.name] = {
                // If sharable type is 'all' or 'custom', allow 2. Otherwise 1.
                limit: (item.sharableWith?.type === 'all' || item.sharableWith?.type === 'custom') ? 2 : 1,
                name: item.name
            };
            allKnownResources.push(item.name);
        };

        fieldsList.forEach(processItem);
        specialsList.forEach(processItem);

        const errors = [];
        // Structure: usageMap[slotIdx][resourceName] = [Array of Bunk Names]
        const usageMap = {}; 

        // 2. Scan Schedule for Resource Usage
        Object.keys(assignments).forEach(bunk => {
            const schedule = assignments[bunk];
            if (!schedule) return;

            schedule.forEach((entry, slotIdx) => {
                // Filter out invalid entries
                if (!entry) return;
                
                // Get the raw text (handle objects vs strings)
                let rawText = "";
                if (entry._activity) rawText = entry._activity;
                else if (typeof entry.field === 'string') rawText = entry.field;
                else if (typeof entry.field === 'object' && entry.field.name) rawText = entry.field.name;

                // Skip "Free", "Clear", etc.
                if (!rawText || ["Free", "No Field", "No Game", "Unassigned League", "Clear"].includes(rawText)) return;

                // --- CRITICAL UPDATE: RESOLVE NAME LIKE UI DOES ---
                // "Blacktop - Basketball" becomes "Blacktop"
                const resolvedName = resolveResourceName(rawText, allKnownResources);

                // Only validate if it matches a known tracked resource
                if (resolvedName && resourceRules[resolvedName]) {
                    if (!usageMap[slotIdx]) usageMap[slotIdx] = {};
                    if (!usageMap[slotIdx][resolvedName]) usageMap[slotIdx][resolvedName] = [];
                    
                    // Add this bunk to the list for this slot/resource
                    usageMap[slotIdx][resolvedName].push(bunk);
                }
            });
        });

        // 3. Check Capacities against Limits
        Object.keys(usageMap).forEach(slotIdx => {
            const slotUsage = usageMap[slotIdx];
            // Format time nicely
            const tStart = unifiedTimes[slotIdx]?.start ? new Date(unifiedTimes[slotIdx].start) : null;
            const tEnd = unifiedTimes[slotIdx]?.end ? new Date(unifiedTimes[slotIdx].end) : null;
            
            let timeLabel = `Slot ${slotIdx}`;
            if (tStart) {
                const fmt = (d) => {
                    let h = d.getHours();
                    let m = String(d.getMinutes()).padStart(2, '0');
                    let ap = h >= 12 ? 'PM' : 'AM';
                    h = h % 12 || 12;
                    return `${h}:${m} ${ap}`;
                };
                timeLabel = `${fmt(tStart)}`;
                if (tEnd) timeLabel += ` - ${fmt(tEnd)}`;
            } else if (unifiedTimes[slotIdx]?.label) {
                timeLabel = unifiedTimes[slotIdx].label;
            }

            Object.keys(slotUsage).forEach(rName => {
                const bunksInvolved = slotUsage[rName];
                const count = bunksInvolved.length;
                const limit = resourceRules[rName].limit; 

                if (count > limit) {
                    errors.push(`<strong>${timeLabel}</strong>: <u>${rName}</u> is Overbooked.<br>` +
                                `<span style="font-size:0.85em; color:#555;">(Limit: ${limit}, Used: ${count})</span><br>` + 
                                `<span style="font-size:0.85em; font-style:italic;">Occupied by: ${bunksInvolved.join(", ")}</span>`);
                }
            });
        });

        // 4. Show Results
        showValidationModal(errors);
    }

    function showValidationModal(errors) {
        const existing = document.getElementById('validator-overlay');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'validator-overlay';
        overlay.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.6); z-index: 9999;
            display: flex; justify-content: center; align-items: center;
            animation: fadeIn 0.2s;
        `;
        
        let content = `<div style="background:white; padding:25px; border-radius:10px; width:600px; max-height:85vh; overflow-y:auto; box-shadow:0 10px 25px rgba(0,0,0,0.5); font-family: sans-serif;">`;
        
        content += `<div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #eee; padding-bottom:10px; margin-bottom:15px;">
            <h2 style="margin:0; color:#333;">🛡️ Conflict Detector</h2>
            <button id="val-close-x" style="background:none; border:none; font-size:1.5em; cursor:pointer; color:#888;">&times;</button>
        </div>`;
        
        if (errors.length === 0) {
            content += `
                <div style="text-align:center; padding:30px; color:#2e7d32;">
                    <div style="font-size:3em; margin-bottom:10px;">✅</div>
                    <h3 style="margin:0;">No Conflicts Found!</h3>
                    <p style="color:#666;">No double bookings detected.</p>
                </div>
            `;
        } else {
            content += `
                <div style="margin-bottom:20px;">
                    <h3 style="color:#d32f2f; margin-top:0; display:flex; align-items:center; gap:8px;">
                        <span>🚫</span> Conflicts Found (${errors.length})
                    </h3>
                    <ul style="list-style:none; padding:0; margin:0;">
                        ${errors.map(e => `<li style="background:#ffebee; color:#b71c1c; padding:10px; margin-bottom:8px; border-radius:4px; border-left:4px solid #d32f2f; line-height:1.4;">${e}</li>`).join('')}
                    </ul>
                </div>
            `;
        }
        
        content += `<div style="text-align:right; margin-top:20px; border-top:1px solid #eee; padding-top:15px;">
            <button id="val-close-btn" style="padding:10px 20px; background:#333; color:white; border:none; border-radius:5px; cursor:pointer; font-weight:bold;">Close</button>
        </div>`;
        
        content += `</div>`;
        
        overlay.innerHTML = content;
        document.body.appendChild(overlay);

        const close = () => overlay.remove();
        document.getElementById('val-close-btn').onclick = close;
        document.getElementById('val-close-x').onclick = close;
        overlay.onclick = (e) => { if(e.target === overlay) close(); };
    }

    if (!document.getElementById('validator-style')) {
        const style = document.createElement('style');
        style.id = 'validator-style';
        style.innerHTML = `@keyframes fadeIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }`;
        document.head.appendChild(style);
    }

    window.validateSchedule = validateSchedule;

})();
