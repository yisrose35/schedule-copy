// =================================================================
// validator.js
//
// Scans the schedule for conflicts.
// UPDATED:
// - Now checks BOTH Fields and Special Activities for overlaps.
// - Respects "Sharable" (limit 2) vs "Normal" (limit 1).
// =================================================================

(function() {
'use strict';

function validateSchedule() {
    const assignments = window.scheduleAssignments || {};
    const unifiedTimes = window.unifiedTimes || [];
    
    // 1. Load Definitions (Fields AND Special Activities)
    const app1 = window.loadGlobalSettings?.().app1 || {};
    const fieldsList = app1.fields || [];
    const specialsList = app1.specialActivities || [];
    
    // Map resource names to their specific rules
    const resourceRules = {};

    // Helper to process items
    const processItem = (item) => {
        resourceRules[item.name] = {
            // If sharable type is 'all' or 'custom', allow 2. Otherwise 1.
            limit: (item.sharableWith?.type === 'all' || item.sharableWith?.type === 'custom') ? 2 : 1
        };
    };

    fieldsList.forEach(processItem);
    specialsList.forEach(processItem);

    const errors = [];
    const usageMap = {}; // slotIndex -> resourceName -> count

    // 2. Scan Schedule for Resource Usage
    Object.keys(assignments).forEach(bunk => {
        const schedule = assignments[bunk];
        if (!schedule) return;

        schedule.forEach((entry, slotIdx) => {
            // Filter out "Free", "No Field", etc.
            if (entry && entry.field && !["Free", "No Field", "No Game", "Unassigned League"].includes(entry.field)) {
                
                // Handle both object and string formats for field name
                let rName = (typeof entry.field === 'string') ? entry.field : entry.field.name;
                
                // Sometimes special activities are stored in _activity if field is generic, 
                // but usually the 'field' property holds the main resource name. 
                // If it's a generated special slot, check the activity name.
                if (entry._activity && resourceRules.hasOwnProperty(entry._activity)) {
                    rName = entry._activity;
                }

                // Only validate if it's a REAL resource defined in Setup/Specials
                if (resourceRules.hasOwnProperty(rName)) {
                    if (!usageMap[slotIdx]) usageMap[slotIdx] = {};
                    if (!usageMap[slotIdx][rName]) usageMap[slotIdx][rName] = 0;
                    
                    usageMap[slotIdx][rName]++;
                }
            }
        });
    });

    // 3. Check Capacities against Limits
    Object.keys(usageMap).forEach(slotIdx => {
        const slotUsage = usageMap[slotIdx];
        const timeLabel = unifiedTimes[slotIdx]?.label || `Slot ${slotIdx}`;

        Object.keys(slotUsage).forEach(rName => {
            const count = slotUsage[rName];
            const limit = resourceRules[rName].limit; 

            if (count > limit) {
                errors.push(`<strong>Double Booking:</strong> <u>${rName}</u> is used by <strong>${count}</strong> bunks at ${timeLabel} (Limit: ${limit}).`);
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
                    ${errors.map(e => `<li style="background:#ffebee; color:#b71c1c; padding:10px; margin-bottom:5px; border-radius:4px; border-left:4px solid #d32f2f;">${e}</li>`).join('')}
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
