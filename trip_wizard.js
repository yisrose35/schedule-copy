// =================================================================
// trip_wizard.js
// The "Interviewer" that builds complex Trip Schedules
// =================================================================

(function() {
    'use strict';

    // --- STATE ---
    let tripManifest = []; // Array of { division, destination, start, end }
    let tripConflicts = {}; // { divisionName: { lunch: true, league: '10:15', ... } }
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
    // 3. PHASE 2: THE AUDIT (The Brain)
    // =============================================================
    function runConflictAudit() {
        renderQuestion({
            title: "Analyzing Schedule...",
            text: "Checking for conflicts with lunch, leagues, and swim...",
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
                
                const conflicts = {
                    lunch: (tripStart < LUNCH_HOUR_END && tripEnd > LUNCH_HOUR_START),
                    leagues: [],
                    swim: false
                };

                // Scan skeleton blocks for this division
                const divBlocks = skeleton.filter(b => b.division === divName);
                
                divBlocks.forEach(block => {
                    const bStart = parseTime(block.startTime);
                    const bEnd = parseTime(block.endTime);
                    if (bStart == null || bEnd == null) return;

                    // Check overlap
                    if (bStart < tripEnd && bEnd > tripStart) {
                        // It overlaps! What is it?
                        const evt = block.event.toLowerCase();
                        if (evt.includes('league')) {
                            conflicts.leagues.push(block);
                        } else if (evt.includes('swim')) {
                            conflicts.swim = true;
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
        const issues = [];

        // Build the HTML for the conflicts found
        let html = `<div class="tw-conflict-list">`;

        // 1. Lunch
        if (conflict.lunch) {
            html += `
                <div class="tw-issue">
                    <p>🥪 <strong>Lunch Conflict:</strong> They are away during 12:00 PM.</p>
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

        // 2. Leagues
        if (conflict.leagues.length > 0) {
            const game = conflict.leagues[0]; // Handle first game found
            html += `
                <div class="tw-issue">
                    <p>🏆 <strong>League Conflict:</strong> Trip hits the "${game.event}" at ${game.startTime}.</p>
                    <label>Action Plan:</label>
                    <select id="res-league" class="tw-select">
                        <option value="cancel">Cancel Game</option>
                        <option value="reschedule">Reschedule (Squeeze in)</option>
                    </select>
                    <div id="res-league-time-box" style="display:none; margin-top:5px;">
                        <input type="text" id="res-league-time" placeholder="New Start Time? (e.g. 9:00am)">
                    </div>
                </div>
            `;
        }

        // 3. Swim / Return Snack
        html += `
            <div class="tw-issue">
                <p>🚌 <strong>Return Logistics:</strong> They get back at ${trip.end}.</p>
                <label class="tw-checkbox">
                    <input type="checkbox" id="res-snack" checked>
                    <span>Schedule "Arrival Snack" immediately?</span>
                </label>
                ${conflict.swim ? `<p style="color:#d97706; font-size:0.9em; margin-top:5px;">⚠️ Note: This trip cuts into their Swim slot.</p>` : ''}
            </div>
        `;

        html += `</div>`;

        renderQuestion({
            title: `Logistics for ${trip.division}`,
            text: "I found a few scheduling conflicts. Let's resolve them.",
            html: html,
            btnText: "Resolve & Next",
            onNext: () => {
                // Gather answers
                const actions = [];

                // 1. Wipe old schedule (Implicit action)
                actions.push({ type: 'wipe' });

                // 2. Handle League (Pre-trip)
                const leagueSel = document.getElementById('res-league');
                if (leagueSel && leagueSel.value === 'reschedule') {
                    const time = document.getElementById('res-league-time').value;
                    if (time) {
                        actions.push({
                            type: 'league',
                            event: 'League Game (Rescheduled)',
                            startTime: time,
                            // Assume 45 min game? Or calculate? Let's assume user inputs sensible time.
                            // For simplicity, we just ask start time. End time needs calculation or another input.
                            // Let's ask for start and assume 45 mins for now.
                            endTime: addMinutes(time, 45) 
                        });
                    }
                }

                // 3. Handle Lunch
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

                // 4. THE TRIP ITSELF
                actions.push({
                    type: 'pinned',
                    event: `TRIP: ${trip.destination}`,
                    startTime: trip.start,
                    endTime: trip.end,
                    reservedFields: ['Trip'] // Virtual
                });

                // 5. Snack
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
                // Logic to toggle time inputs
                const lSel = document.getElementById('res-lunch');
                if(lSel) lSel.onchange = () => {
                    document.getElementById('res-lunch-time-box').style.display = (lSel.value !== 'packed') ? 'block' : 'none';
                };
                
                const lgSel = document.getElementById('res-league');
                if(lgSel) lgSel.onchange = () => {
                    document.getElementById('res-league-time-box').style.display = (lgSel.value === 'reschedule') ? 'block' : 'none';
                };
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
        // Cleanup old
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
                .tw-modal { background:white; width:500px; padding:25px; border-radius:12px; box-shadow:0 10px 30px rgba(0,0,0,0.2); font-family:sans-serif; }
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
            </style>
        `;
        document.body.appendChild(overlay);
        wizardContainer = document.getElementById('tw-content');
        
        // Window hooks for inline onclicks
        window.twBranch = (val) => {
            // Find current step logic
            const btn = document.querySelector('.tw-next-btn'); // Hacky but works for now, or trigger callback directly
            // Actually, best to just call the custom logic directly passed in render
        };
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

        // Expose helpers for inline buttons
        window.twBranch = (val) => {
            if (customLogic) customLogic(val);
        };
        window.twTimeBranch = (val) => {
            if (customLogic) customLogic(val);
        };
        
        // Trigger logic if needed (e.g. attaching listeners)
        if (customLogic && !window.twBranch) customLogic();
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
