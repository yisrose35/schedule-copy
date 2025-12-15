// =================================================================
// trip_wizard.js
// The "Interviewer" that builds complex Trip Schedules
// UPDATED: Strict 4-Point Conflict Check (Lunch, Swim, League, Specialty)
// =================================================================

(function() {
    'use strict';

    // --- STATE ---
    let tripManifest = []; // Array of { division, destination, start, end }
    let tripConflicts = {}; // Stores conflicts per division
    let finalInstructions = []; // The output for daily_adjustments.js
    
    let onCompleteCallback = null;
    let wizardContainer = null;

    // --- CONSTANTS ---
    const LUNCH_HOUR_START = 12 * 60; // 12:00 PM
    const LUNCH_HOUR_END = 13 * 60;   // 1:00 PM

    // =============================================================
    // 1. PUBLIC API
    // =============================================================
    window.TripWizard = {
        start: function(saveCallback) {
            // Reset State
            tripManifest = [];
            tripConflicts = {};
            finalInstructions = [];
            onCompleteCallback = saveCallback;
            
            // Create Modal
            renderModalBase();
            
            // Begin Conversation
            showStep1_Who(); 
        }
    };

    // =============================================================
    // 2. PHASE 1: THE GATHERING (Branching Logic)
    // =============================================================

    // Q1: Who is going?
    function showStep1_Who() {
        const divisions = window.availableDivisions || [];
        
        renderQuestion({
            title: "Let's plan a trip!",
            text: "Great, I can help with that. First, tell me which divisions are going?",
            html: `
                <div class="tw-checkbox-grid">
                    ${divisions.map(d => `
                        <label class="tw-checkbox">
                            <input type="checkbox" name="tw-divs" value="${d}">
                            <span>${d}</span>
                        </label>
                    `).join('')}
                </div>
            `,
            btnText: "Next",
            onNext: () => {
                const selected = Array.from(document.querySelectorAll('input[name="tw-divs"]:checked'))
                                      .map(cb => cb.value);
                
                if (selected.length === 0) return alert("Please select at least one division.");
                
                // Init manifest
                tripManifest = selected.map(d => ({ division: d }));
                
                if (selected.length > 1) {
                    showStep2_SamePlace();
                } else {
                    // Only one division, treat as "Specific"
                    showStep3_SpecificDetails(0); 
                }
            }
        });
    }

    // Q2: Same place?
    function showStep2_SamePlace() {
        renderQuestion({
            title: "Destination Check",
            text: "Fantastic. Are they all going to the same place?",
            html: `
                <div class="tw-btn-group">
                    <button class="tw-opt-btn" onclick="window.twBranch('yes')">Yes, same place</button>
                    <button class="tw-opt-btn" onclick="window.twBranch('no')">No, different places</button>
                </div>
            `,
            hideNext: true,
            customLogic: (choice) => {
                if (choice === 'yes') showStep3_UnifiedDetails();
                else showStep3_SpecificDetails(0); // Start looping through divisions
            }
        });
    }

    // BRANCH A: Unified Details (Same Place, Same Time?)
    function showStep3_UnifiedDetails() {
        renderQuestion({
            title: "Trip Details",
            text: "Where are they headed?",
            html: `
                <label>Destination:</label>
                <input type="text" id="tw-dest" placeholder="e.g. The Zoo">
                
                <p style="margin-top:15px;">Are they all leaving and returning at the same time?</p>
                <div class="tw-btn-group">
                    <button class="tw-opt-btn" onclick="window.twTimeBranch('yes')">Yes, same times</button>
                    <button class="tw-opt-btn" onclick="window.twTimeBranch('no')">No, different times</button>
                </div>
                <div id="tw-time-inputs" style="display:none; margin-top:15px; border-top:1px solid #eee; padding-top:10px;">
                    <label>Departure Time:</label>
                    <input type="text" id="tw-start" placeholder="10:00am">
                    <label>Return Time:</label>
                    <input type="text" id="tw-end" placeholder="3:00pm">
                </div>
            `,
            btnText: "Next",
            // We only show Next button if "Yes" is clicked or times filled
            onNext: () => {
                const dest = document.getElementById('tw-dest').value;
                const start = document.getElementById('tw-start').value;
                const end = document.getElementById('tw-end').value;
                
                if (!dest) return alert("Please enter a destination.");
                
                // If inputs are visible, save to ALL
                if (document.getElementById('tw-time-inputs').style.display === 'block') {
                    if (!start || !end) return alert("Please enter times.");
                    tripManifest.forEach(t => {
                        t.destination = dest;
                        t.start = start;
                        t.end = end;
                    });
                    runConflictAudit(); // Done gathering, go to Audit
                } else {
                    // "No, different times" -> Save dest, loop for times
                    tripManifest.forEach(t => t.destination = dest);
                    showStep3_SpecificDetails(0, true); // true = skip destination ask
                }
            },
            customLogic: (choice) => {
                // Hooked to window.twTimeBranch
                if (choice === 'yes') {
                    document.getElementById('tw-time-inputs').style.display = 'block';
                } else {
                    // Trigger "Next" programmatically to go to loop
                    document.querySelector('.tw-next-btn').click();
                }
            }
        });
    }

    // BRANCH B: Loop through each division (Recursion)
    function showStep3_SpecificDetails(index, skipDest = false) {
        if (index >= tripManifest.length) {
            runConflictAudit(); // Finished loop
            return;
        }

        const div = tripManifest[index];
        const destHtml = skipDest ? '' : `
            <label>Where is <strong>${div.division}</strong> going?</label>
            <input type="text" id="tw-loop-dest" placeholder="e.g. Park">
        `;

        renderQuestion({
            title: `Details for ${div.division}`,
            text: skipDest 
                ? `Okay, for <strong>${div.division}</strong> (going to ${div.destination}), what are the times?`
                : `Let's get the details for <strong>${div.division}</strong>.`,
            html: `
                ${destHtml}
                <label>Departure Time:</label>
                <input type="text" id="tw-loop-start" placeholder="10:00am">
                <label>Return Time:</label>
                <input type="text" id="tw-loop-end" placeholder="3:00pm">
            `,
            btnText: "Next Division",
            onNext: () => {
                const start = document.getElementById('tw-loop-start').value;
                const end = document.getElementById('tw-loop-end').value;
                
                if (!skipDest) {
                    const dest = document.getElementById('tw-loop-dest').value;
                    if (!dest) return alert("Enter destination.");
                    div.destination = dest;
                }
                if (!start || !end) return alert("Enter times.");
                
                div.start = start;
                div.end = end;
                
                showStep3_SpecificDetails(index + 1, skipDest);
            }
        });
    }

    // =============================================================
    // 3. PHASE 2: THE AUDIT (Strict 4-Point Check)
    // =============================================================
    function runConflictAudit() {
        renderQuestion({
            title: "Analyzing Schedule...",
            text: "Scanning for conflicts with Lunch, Leagues, Specialty Leagues, and Swim...",
            html: `<div class="tw-spinner"></div>`,
            hideNext: true
        });

        setTimeout(() => {
            // Perform Scan
            const dailyData = window.loadCurrentDailyData?.() || {};
            const skeleton = dailyData.manualSkeleton || [];
            
            tripManifest.forEach(trip => {
                const divName = trip.division;
                const tripStart = parseTime(trip.start);
                const tripEnd = parseTime(trip.end);
                
                // Initialize Conflicts
                const conflicts = {
                    lunch: (tripStart < LUNCH_HOUR_END && tripEnd > LUNCH_HOUR_START), // Default time check
                    leagues: [],
                    specialtyLeagues: [],
                    swim: []
                };

                // Scan skeleton blocks for this division
                const divBlocks = skeleton.filter(b => b.division === divName);
                
                divBlocks.forEach(block => {
                    const bStart = parseTime(block.startTime);
                    const bEnd = parseTime(block.endTime);
                    if (bStart == null || bEnd == null) return;

                    // Check overlap
                    if (bStart < tripEnd && bEnd > tripStart) {
                        const evt = block.event.toLowerCase();
                        const type = block.type || '';

                        // 1. LUNCH (Explicit Block Check)
                        if (evt.includes('lunch') || type === 'lunch') {
                            conflicts.lunch = true;
                        }
                        
                        // 2. SPECIALTY LEAGUE
                        else if (evt.includes('specialty league') || type === 'specialty_league') {
                            conflicts.specialtyLeagues.push(block);
                        }
                        
                        // 3. REGULAR LEAGUE
                        else if (evt.includes('league') || type === 'league') {
                            conflicts.leagues.push(block);
                        }
                        
                        // 4. SWIM
                        else if (evt.includes('swim') || type === 'swim') {
                            conflicts.swim.push(block);
                        }
                    }
                });

                tripConflicts[divName] = conflicts;
            });

            // Move to Resolution Phase
            showStep4_Resolution(0);

        }, 800); // Fake "thinking" time
    }

    // =============================================================
    // 4. PHASE 3: RESOLUTION (Insightful Questions)
    // =============================================================
    function showStep4_Resolution(index) {
        if (index >= tripManifest.length) {
            finishWizard(); // Done resolving
            return;
        }

        const trip = tripManifest[index];
        const conflict = tripConflicts[trip.division];
        
        // Build the HTML for the conflicts found
        let html = `<div class="tw-conflict-list">`;
        let hasIssues = false;

        // 1. Lunch Resolution
        if (conflict.lunch) {
            hasIssues = true;
            html += `
                <div class="tw-issue">
                    <p>🥪 <strong>Lunch Conflict:</strong> They are away during their lunch time.</p>
                    <label>How should we handle food?</label>
                    <select id="res-lunch" class="tw-select">
                        <option value="packed">Packed Lunch (No schedule change)</option>
                        <option value="early">Eat Early (Before leaving)</option>
                        <option value="late">Eat Late (Upon return)</option>
                    </select>
                    <div id="res-lunch-time-box" style="display:none; margin-top:5px;">
                        <input type="text" id="res-lunch-time" placeholder="Time? (e.g. 9:30am)">
                    </div>
                </div>
            `;
        }

        // 2. Specialty Leagues Resolution
        if (conflict.specialtyLeagues.length > 0) {
            hasIssues = true;
            const game = conflict.specialtyLeagues[0];
            html += `
                <div class="tw-issue" style="border-left: 4px solid #f59e0b;">
                    <p>🏅 <strong>Specialty League Conflict:</strong> Trip hits "${game.event}" at ${game.startTime}.</p>
                    <label>What's the plan?</label>
                    <select id="res-spec-league" class="tw-select">
                        <option value="cancel">Cancel/Skip it</option>
                        <option value="reschedule">Reschedule (Before/After trip)</option>
                    </select>
                    <div id="res-spec-league-time-box" style="display:none; margin-top:5px;">
                        <input type="text" id="res-spec-league-time" placeholder="New Start Time? (e.g. 9:00am)">
                    </div>
                </div>
            `;
        }

        // 3. Regular Leagues Resolution
        if (conflict.leagues.length > 0) {
            hasIssues = true;
            const game = conflict.leagues[0];
            html += `
                <div class="tw-issue" style="border-left: 4px solid #3b82f6;">
                    <p>🏆 <strong>League Conflict:</strong> Trip hits "${game.event}" at ${game.startTime}.</p>
                    <label>Action Plan:</label>
                    <select id="res-league" class="tw-select">
                        <option value="cancel">Cancel Game</option>
                        <option value="reschedule">Reschedule (Squeeze in)</option>
                    </select>
                    <div id="res-league-time-box" style="display:none; margin-top:5px;">
                        <input type="text" id="res-league-time" placeholder="New Start Time? (e.g. 8:45am)">
                    </div>
                </div>
            `;
        }

        // 4. Swim Resolution
        if (conflict.swim.length > 0) {
            hasIssues = true;
            const swimBlock = conflict.swim[0];
            html += `
                <div class="tw-issue" style="border-left: 4px solid #06b6d4;">
                    <p>🏊 <strong>Swim Conflict:</strong> Trip overlaps with Swim at ${swimBlock.startTime}.</p>
                    <label>Intention for Swim:</label>
                    <select id="res-swim" class="tw-select">
                        <option value="cancel">Cancel Swim</option>
                        <option value="reschedule">Reschedule (e.g. 4:00pm)</option>
                    </select>
                    <div id="res-swim-time-box" style="display:none; margin-top:5px;">
                        <input type="text" id="res-swim-time" placeholder="New Start Time?">
                    </div>
                </div>
            `;
        }

        // Always ask about Return Snack
        html += `
            <div class="tw-issue" style="background:#f0fdf4; border-color:#bbf7d0;">
                <p>🚌 <strong>Return Logistics:</strong> They get back at ${trip.end}.</p>
                <label class="tw-checkbox">
                    <input type="checkbox" id="res-snack" checked>
                    <span>Schedule "Arrival Snack" immediately?</span>
                </label>
            </div>
        `;

        html += `</div>`;

        // If no major conflicts found, show friendly message
        const introText = hasIssues 
            ? "I found specific activities that are being taken away. What are your intentions for them?"
            : "No major schedule conflicts found! Just confirm the return logistics.";

        renderQuestion({
            title: `Logistics for ${trip.division}`,
            text: introText,
            html: html,
            btnText: "Resolve & Next",
            onNext: () => {
                // Gather answers
                const actions = [];

                // 1. Wipe old schedule (Implicit action)
                actions.push({ type: 'wipe' });

                // 2. Handle Specialty League (Pre/Post-trip)
                const specLeagueSel = document.getElementById('res-spec-league');
                if (specLeagueSel && specLeagueSel.value === 'reschedule') {
                    const time = document.getElementById('res-spec-league-time').value;
                    if (time) {
                        actions.push({
                            type: 'specialty_league',
                            event: 'Specialty League (Rescheduled)',
                            startTime: time,
                            endTime: addMinutes(time, 60) // Assume 60 min
                        });
                    }
                }

                // 3. Handle Regular League
                const leagueSel = document.getElementById('res-league');
                if (leagueSel && leagueSel.value === 'reschedule') {
                    const time = document.getElementById('res-league-time').value;
                    if (time) {
                        actions.push({
                            type: 'league',
                            event: 'League Game (Rescheduled)',
                            startTime: time,
                            endTime: addMinutes(time, 45) // Assume 45 min
                        });
                    }
                }

                // 4. Handle Swim
                const swimSel = document.getElementById('res-swim');
                if (swimSel && swimSel.value === 'reschedule') {
                    const time = document.getElementById('res-swim-time').value;
                    if (time) {
                        actions.push({
                            type: 'swim',
                            event: 'Swim',
                            startTime: time,
                            endTime: addMinutes(time, 45) // Assume 45 min
                        });
                    }
                }

                // 5. Handle Lunch
                const lunchSel = document.getElementById('res-lunch');
                if (lunchSel) {
                    if (lunchSel.value === 'early') {
                        const time = document.getElementById('res-lunch-time').value;
                        if (time) actions.push({ type: 'lunch', event: 'Lunch', startTime: time, endTime: addMinutes(time, 30) });
                    } else if (lunchSel.value === 'late') {
                        const time = document.getElementById('res-lunch-time').value;
                        if (time) actions.push({ type: 'lunch', event: 'Lunch', startTime: time, endTime: addMinutes(time, 30) });
                    }
                }

                // 6. THE TRIP ITSELF
                actions.push({
                    type: 'pinned',
                    event: `TRIP: ${trip.destination}`,
                    startTime: trip.start,
                    endTime: trip.end,
                    reservedFields: ['Trip'] // Virtual
                });

                // 7. Snack
                if (document.getElementById('res-snack').checked) {
                    actions.push({
                        type: 'snacks',
                        event: 'Snack',
                        startTime: trip.end,
                        endTime: addMinutes(trip.end, 15)
                    });
                }

                // Save to final instructions
                finalInstructions.push({
                    division: trip.division,
                    actions: actions
                });

                showStep4_Resolution(index + 1);
            },
            customLogic: () => {
                // Toggles for inputs
                const toggle = (selId, boxId) => {
                    const el = document.getElementById(selId);
                    if(el) el.onchange = () => {
                        document.getElementById(boxId).style.display = (el.value === 'reschedule' || el.value === 'early' || el.value === 'late') ? 'block' : 'none';
                    };
                };
                
                toggle('res-lunch', 'res-lunch-time-box');
                toggle('res-league', 'res-league-time-box');
                toggle('res-spec-league', 'res-spec-league-time-box');
                toggle('res-swim', 'res-swim-time-box');
            }
        });
    }

    // =============================================================
    // 5. EXECUTION (The Handoff)
    // =============================================================
    function finishWizard() {
        renderQuestion({
            title: "All Set!",
            text: "I have the plan. Ready to update the schedule?",
            html: `<p>This will clear the existing schedule for the selected divisions and apply the trip anchors.</p>`,
            btnText: "Update Schedule",
            onNext: () => {
                // Close modal
                document.body.removeChild(document.getElementById('tw-modal-overlay'));
                
                // Callback to daily_adjustments.js
                if (onCompleteCallback) onCompleteCallback(finalInstructions);
            }
        });
    }

    // =============================================================
    // UTILS & UI RENDERER
    // =============================================================
    
    function renderModalBase() {
        const old = document.getElementById('tw-modal-overlay');
        if (old) old.remove();

        const overlay = document.createElement('div');
        overlay.id = 'tw-modal-overlay';
        overlay.innerHTML = `
            <div class="tw-modal">
                <div id="tw-content"></div>
            </div>
            <style>
                #tw-modal-overlay { position: fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); z-index:9999; display:flex; align-items:center; justify-content:center; }
                .tw-modal { background:white; width:550px; padding:25px; border-radius:12px; box-shadow:0 10px 30px rgba(0,0,0,0.2); font-family:sans-serif; max-height:85vh; overflow-y:auto; }
                .tw-step-title { margin-top:0; color:#1a5fb4; }
                .tw-checkbox-grid { display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin:15px 0; }
                .tw-checkbox { display:block; padding:8px; border:1px solid #eee; border-radius:6px; cursor:pointer; }
                .tw-checkbox:hover { background:#f9f9f9; }
                .tw-btn-group { display:flex; gap:10px; margin-top:15px; }
                .tw-opt-btn { flex:1; padding:10px; background:#f0f0f0; border:1px solid #ccc; border-radius:6px; cursor:pointer; }
                .tw-opt-btn:hover { background:#e0e0e0; }
                .tw-next-btn { background:#00C896; color:white; border:none; padding:10px 20px; border-radius:6px; font-weight:bold; cursor:pointer; float:right; margin-top:15px; }
                .tw-next-btn:hover { background:#00a87d; }
                input[type=text], select { width:100%; padding:8px; margin-top:5px; border:1px solid #ccc; border-radius:4px; box-sizing:border-box; }
                .tw-issue { background:#fff3cd; border:1px solid #ffeeba; padding:10px; border-radius:6px; margin-bottom:10px; }
                .tw-spinner { border: 4px solid #f3f3f3; border-top: 4px solid #3498db; border-radius: 50%; width: 30px; height: 30px; animation: tw-spin 1s linear infinite; margin: 20px auto; }
                @keyframes tw-spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
            </style>
        `;
        document.body.appendChild(overlay);
        wizardContainer = document.getElementById('tw-content');
        
        window.twBranch = (val) => { if (window._twLogic) window._twLogic(val); };
        window.twTimeBranch = (val) => { if (window._twTimeLogic) window._twTimeLogic(val); };
    }

    function renderQuestion({ title, text, html, btnText, onNext, hideNext, customLogic }) {
        wizardContainer.innerHTML = `
            <h2 class="tw-step-title">${title}</h2>
            <p>${text || ''}</p>
            <div class="tw-body">${html}</div>
            ${hideNext ? '' : `<button class="tw-next-btn">${btnText || 'Next'}</button>`}
        `;

        if (!hideNext) {
            wizardContainer.querySelector('.tw-next-btn').onclick = onNext;
        }

        if (customLogic) {
            // Store logic globally for inline onclicks or execute immediately
            window._twLogic = customLogic;
            window._twTimeLogic = customLogic;
            customLogic(); 
        }
    }

    function parseTime(str) {
        if (!str) return null;
        const d = new Date("1/1/2000 " + str);
        if (isNaN(d.getTime())) return null;
        return d.getHours() * 60 + d.getMinutes();
    }

    function addMinutes(timeStr, mins) {
        if (!timeStr) return null;
        const d = new Date("1/1/2000 " + timeStr);
        d.setMinutes(d.getMinutes() + mins);
        let h = d.getHours();
        const m = d.getMinutes();
        const ap = h >= 12 ? 'pm' : 'am';
        h = h % 12 || 12;
        return `${h}:${m.toString().padStart(2,'0')}${ap}`;
    }

})();
