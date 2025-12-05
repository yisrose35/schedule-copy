// ============================================================================
// scheduler_ui.js  (FULLY PATCHED for NEW LOADER)
// Transition-safe, loader-driven, ZERO logic changes, only data-source fixes
// ============================================================================

(function () {
"use strict";

// ---------------------------------------------------------------------------
// GLOBAL LOADERS / CONFIG ACCESS
// ---------------------------------------------------------------------------
function getConfig() {
    return window.SchedulerCoreUtils?.loadAndFilterData?.() || {};
}

const INCREMENT_MINS = window.INCREMENT_MINS || 30;
const TRANSITION_TYPE = window.TRANSITION_TYPE || "Transition/Buffer";

// ============================================================================
// TIME HELPERS
// ============================================================================
function parseTimeToMinutes(str) {
    if (!str || typeof str !== "string") return null;
    let s = str.trim().toLowerCase();
    let mer = null;
    if (s.endsWith("am") || s.endsWith("pm")) {
        mer = s.endsWith("am") ? "am" : "pm";
        s = s.replace(/am|pm/g, "").trim();
    } else return null;

    const m = s.match(/^(\d{1,2})\s*[:]\s*(\d{2})$/);
    if (!m) return null;

    let h = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);

    if (mm < 0 || mm > 59) return null;

    if (h === 12) h = (mer === "am" ? 0 : 12);
    else if (mer === "pm") h += 12;

    return h * 60 + mm;
}

function minutesToTimeLabel(min) {
    const h24 = Math.floor(min / 60);
    const m = String(min % 60).padStart(2, "0");
    const ap = h24 >= 12 ? "PM" : "AM";
    const h12 = h24 % 12 || 12;
    return `${h12}:${m} ${ap}`;
}

// ============================================================================
// RESOURCE RESOLVER
// ============================================================================
function resolveResourceName(input, knownNames) {
    if (!input || !knownNames) return null;
    const cleanInput = String(input).toLowerCase().trim();
    if (knownNames.includes(input)) return input;

    const sorted = [...knownNames].sort((a,b) => b.length - a.length);
    for (const n of sorted) {
        const clean = n.toLowerCase().trim();
        if (cleanInput.startsWith(clean)) return n;
    }
    return null;
}

// ============================================================================
// DETECT GENERATED EVENTS
// ============================================================================
const UI_GENERATED_EVENTS = new Set([
    "general activity", "general activity slot", "activity", "activities",
    "sports", "sport", "sports slot", "special activity", "swim",
    "league game", "specialty league"
]);

function uiIsGeneratedEventName(name) {
    if (!name) return false;
    return UI_GENERATED_EVENTS.has(String(name).trim().toLowerCase());
}

// ============================================================================
// SLOT FINDER
// ============================================================================
function findSlotsForRange(startMin, endMin) {
    const slots = [];
    const times = window.unifiedTimes || [];
    for (let i = 0; i < times.length; i++) {
        const st = new Date(times[i].start);
        const en = new Date(times[i].end);
        const slotStart = st.getHours() * 60 + st.getMinutes();
        const slotEnd = en.getHours() * 60 + en.getMinutes();
        if (startMin < slotEnd && endMin > slotStart)
            slots.push(i);
    }
    return slots;
}

// ============================================================================
// SAFE ENTRY GETTER
// ============================================================================
function getEntry(bunk, slotIndex) {
    const a = window.scheduleAssignments || {};
    if (!a[bunk]) return null;
    return a[bunk][slotIndex] || null;
}

// ============================================================================
// HUMAN-FRIENDLY ENTRY FORMATTER
// ============================================================================
function formatEntry(entry) {
    if (!entry) return "";
    if (entry._isDismissal) return "Dismissal";
    if (entry._isSnack) return "Snacks";

    if (entry._isTransition) {
        let label = entry.sport || entry.field;
        return `🏃‍♂️ ${label}`;
    }

    const label = entry._activity || entry.field || "";
    if (entry._h2h) return entry.sport || "League Game";
    if (entry._fixed) return label;
    if (entry.sport) return `${entry.field} – ${entry.sport}`;

    return label;
}

// ============================================================================
// FIND FIRST SLOT FOR A START TIME
// ============================================================================
function findFirstSlotForTime(startMin) {
    if (!window.unifiedTimes) return -1;
    for (let i = 0; i < window.unifiedTimes.length; i++) {
        const st = new Date(window.unifiedTimes[i].start);
        const slotStart = st.getHours() * 60 + st.getMinutes();
        if (slotStart >= startMin && slotStart < startMin + INCREMENT_MINS)
            return i;
    }
    return -1;
}

// ============================================================================
// editCell() — FULLY FIXED FOR NEW LOADER
// ============================================================================
function editCell(bunk, startMin, endMin, current) {
    if (!bunk) return;

    const newName = prompt(
        `Edit activity for ${bunk}\n${minutesToTimeLabel(startMin)} - ${minutesToTimeLabel(endMin)}\n(Enter CLEAR or FREE to empty)`,
        current
    );
    if (newName === null) return;

    const value = newName.trim();
    const isClear = (value === "" || value.toUpperCase() === "CLEAR" || value.toUpperCase() === "FREE");
    let resolvedName = value;

    // VALIDATION (loader-based)
    if (!isClear) {
        const config = getConfig();
        const { activityProperties, historicalCounts, divisions, yesterdayHistory } = config;

        const allKnown = Object.keys(activityProperties);
        resolvedName = resolveResourceName(value, allKnown) || value;

        const props = activityProperties[resolvedName];
        const targetSlots = findSlotsForRange(startMin, endMin);
        const warnings = [];

        // --- Same bunk duplicate detection
        const sched = window.scheduleAssignments[bunk] || [];
        sched.forEach((entry, idx) => {
            if (targetSlots.includes(idx)) return;
            if (entry && !entry.continuation) {
                const raw = entry.field || entry._activity;
                if (String(raw).toLowerCase() === String(value).toLowerCase()) {
                    const timeLabel = window.unifiedTimes[idx]?.label ||
                        minutesToTimeLabel(
                            new Date(window.unifiedTimes[idx].start).getHours()*60 +
                            new Date(window.unifiedTimes[idx].start).getMinutes()
                        );
                    warnings.push(`⚠️ DUPLICATE: Already scheduled "${raw}" at ${timeLabel}.`);
                }
            }
        });

        if (props) {
            // --- Max usage
            const max = props.maxUsage || 0;
            if (max > 0) {
                const historyCount = historicalCounts[bunk]?.[resolvedName] || 0;
                let todayCount = 0;

                sched.forEach((entry, idx) => {
                    if (targetSlots.includes(idx)) return;
                    if (entry && !entry.continuation) {
                        const r = resolveResourceName(entry.field || entry._activity, allKnown);
                        if (String(r).toLowerCase() === String(resolvedName).toLowerCase())
                            todayCount++;
                    }
                });

                if (historyCount + todayCount + 1 > max) {
                    warnings.push(`⚠️ MAX USAGE: ${historyCount + todayCount} used; limit is ${max}.`);
                }
            }

            // --- Duration check
            const trans = window.SchedulerCoreUtils.getTransitionRules(resolvedName, activityProperties);
            const { activityDuration } = window.SchedulerCoreUtils.getEffectiveTimeRange(
                { startTime: startMin, endTime: endMin },
                trans
            );
            if (activityDuration < trans.minDurationMin)
                warnings.push(`⚠️ Duration too short: ${activityDuration} mins (min ${trans.minDurationMin}).`);

            // --- Capacity check
            const tempBlock = {
                bunk,
                startTime: startMin,
                endTime: endMin,
                slots: targetSlots,
                divName: Object.keys(divisions).find(d => divisions[d].bunks.includes(bunk))
            };
            const fieldUsageBySlot = window.fieldUsageBySlot ?? {};
            const ok = window.SchedulerCoreUtils.canBlockFit(
                tempBlock, 
                resolvedName,
                activityProperties,
                fieldUsageBySlot,
                resolvedName
            );
            if (!ok) warnings.push(`⚠️ CAPACITY: "${resolvedName}" is blocked or full.`);

            // --- Time rules
            const okTime = targetSlots.every(slotIdx =>
                window.SchedulerCoreUtils.isTimeAvailable(slotIdx, props)
            );
            if (!okTime) warnings.push(`⚠️ TIME RESTRICTION: Unavailable this time.`);
        }

        if (warnings.length > 0) {
            if (!confirm(warnings.join("\n\n") + "\n\nOverride and schedule anyway?"))
                return;
        }
    }

    // APPLY EDIT
    const slots = findSlotsForRange(startMin, endMin);
    if (!slots.length) {
        alert("Error: Could not match this time range.");
        return;
    }

    if (!window.scheduleAssignments[bunk])
        window.scheduleAssignments[bunk] = new Array(window.unifiedTimes.length);

    if (isClear) {
        slots.forEach((idx,i) => {
            window.scheduleAssignments[bunk][idx] = {
                field: "Free", sport: null, continuation: (i>0),
                _fixed: true, _activity: "Free"
            };
        });
    } else {
        const config = getConfig();
        const { activityProperties, yesterdayHistory, divisions } = config;

        const divName = Object.keys(divisions).find(d => divisions[d].bunks.includes(bunk));

        slots.forEach(idx => window.scheduleAssignments[bunk][idx] = null);

        window.fillBlock({
            divName, bunk, startTime: startMin, endTime: endMin,
            slots, _fixed: true
        }, {
            field: resolvedName, sport: null, _fixed: true,
            _activity: resolvedName
        }, 
        window.fieldUsageBySlot ?? {}, 
        yesterdayHistory,
        false,
        activityProperties);
    }

    saveSchedule();
    updateTable();
}

// ============================================================================
// CORE RENDERING (DIVISION TABLES)
// ============================================================================
function renderStaggeredView(container) {
    container.innerHTML = "";

    const config = getConfig();
    const divisions = config.divisions || {};
    const availableDivisions = config.availableDivisions || [];

    const daily = window.loadCurrentDailyData?.() || {};
    const skeleton = daily.manualSkeleton || [];

    if (!Array.isArray(skeleton) || skeleton.length === 0) {
        container.innerHTML = `<p>No daily schedule generated for this date.</p>`;
        return;
    }

    const wrapper = document.createElement("div");
    wrapper.className = "schedule-view-wrapper";
    container.appendChild(wrapper);

    availableDivisions.forEach(div => {
        const bunks = (divisions[div]?.bunks || []).slice().sort();
        if (!bunks.length) return;

        const table = document.createElement("table");
        table.className = "schedule-division-table";

        // HEADER
        const thead = document.createElement("thead");
        const tr1 = document.createElement("tr");
        const th = document.createElement("th");
        th.colSpan = 1 + bunks.length;
        th.textContent = div;
        th.style.background = divisions[div]?.color || "#444";
        th.style.color = "#fff";
        tr1.appendChild(th);
        thead.appendChild(tr1);

        const tr2 = document.createElement("tr");
        const thTime = document.createElement("th");
        thTime.textContent = "Time";
        tr2.appendChild(thTime);

        bunks.forEach(b => {
            const thB = document.createElement("th");
            thB.textContent = b;
            tr2.appendChild(thB);
        });

        thead.appendChild(tr2);
        table.appendChild(thead);

        const tbody = document.createElement("tbody");

        // Expand + normalize blocks
        const blocks = skeleton
            .filter(b => b.division === div)
            .map(b => ({
                ...b,
                startMin: parseTimeToMinutes(b.startTime),
                endMin: parseTimeToMinutes(b.endTime)
            }))
            .filter(b => b.startMin !== null && b.endMin !== null)
            .sort((a,b) => a.startMin - b.startMin);

        const expanded = [];
        blocks.forEach(b => {
            if (b.type === "split") {
                const mid = b.startMin + (b.endMin - b.startMin)/2;
                expanded.push({
                    ...b,
                    endMin: mid,
                    label: `${minutesToTimeLabel(b.startMin)} - ${minutesToTimeLabel(mid)}`
                });
                expanded.push({
                    ...b,
                    startMin: mid,
                    label: `${minutesToTimeLabel(mid)} - ${minutesToTimeLabel(b.endMin)}`
                });
            } else {
                expanded.push({
                    ...b,
                    label: `${minutesToTimeLabel(b.startMin)} - ${minutesToTimeLabel(b.endMin)}`
                });
            }
        });

        // Rendering each block row
        expanded.forEach(block => {
            const tr = document.createElement("tr");

            const tdTime = document.createElement("td");
            tdTime.textContent = block.label;
            tr.appendChild(tdTime);

            const ev = String(block.event || "").trim();
            const isLeague = ev.startsWith("League Game") || ev.startsWith("Specialty League");

            // LEAGUE BLOCK ROW
            if (isLeague) {
                const td = document.createElement("td");
                td.colSpan = bunks.length;
                td.style.background = "#eef7f8";
                td.style.fontWeight = "bold";

                const slotIdx = findFirstSlotForTime(block.startMin);
                let allMatchups = [];
                let gameLabel = "";

                if (slotIdx >= 0) {
                    for (const b of bunks) {
                        const first = getEntry(b, slotIdx);
                        if (first?._allMatchups) allMatchups = first._allMatchups;
                        if (first?._gameLabel) gameLabel = first._gameLabel;
                    }
                }

                let titleHtml = ev;
                if (gameLabel) {
                    if (ev === "League Game")
                        titleHtml = `League Game ${gameLabel.replace(/^Game\s+/i,"")}`;
                    else
                        titleHtml = `${ev} (${gameLabel})`;
                }

                if (!allMatchups.length) td.textContent = titleHtml;
                else
                    td.innerHTML = `<div>${titleHtml}</div><ul>${allMatchups.map(m => `<li>${m}</li>`).join("")}</ul>`;

                td.style.cursor = "pointer";
                td.onclick = () => editCell(bunks[0], block.startMin, block.endMin, ev);

                tr.appendChild(td);
                tbody.appendChild(tr);
                return;
            }

            // NORMAL BLOCK CELLS
            bunks.forEach(bunk => {
                const td = document.createElement("td");
                td.dataset.bunk = bunk;

                let bg = null;
                const slotIdx = findFirstSlotForTime(block.startMin);
                const entry = getEntry(bunk, slotIdx);

                const isDismissal = ev.toLowerCase().includes("dismiss");
                const isSnack = ev.toLowerCase().includes("snack");
                const isGeneratedSlot = uiIsGeneratedEventName(ev) || ev.includes("/");

                let cellContent = "";
                let finalActivity = "";
                let isWrapperBlock = false;

                // NON-TRANSITION ACTIVITY
                if (entry && entry._activity !== TRANSITION_TYPE) {

                    finalActivity = entry._activity;

                    const prevEntry = getEntry(bunk, slotIdx - 1);
                    const nextEntry = getEntry(bunk, slotIdx + 1);

                    isWrapperBlock =
                        (prevEntry?._activity === TRANSITION_TYPE ||
                         nextEntry?._activity === TRANSITION_TYPE);

                    if (isWrapperBlock) {
                        let totalPre = 0, totalPost = 0, play = 0;
                        let startSlot = slotIdx, endSlot = slotIdx;

                        // Scan backward
                        let sIdx = slotIdx - 1;
                        while (sIdx >= 0 && getEntry(bunk, sIdx)?._activity === TRANSITION_TYPE) {
                            const st = new Date(window.unifiedTimes[sIdx].start);
                            const en = new Date(window.unifiedTimes[sIdx].end);
                            totalPre += (en - st)/60000;
                            startSlot = sIdx;
                            sIdx--;
                        }

                        // Scan forward
                        sIdx = slotIdx;
                        while (sIdx < window.unifiedTimes.length) {
                            const scan = getEntry(bunk, sIdx);
                            if (!scan ||
                                (scan._activity !== finalActivity &&
                                 scan._activity !== TRANSITION_TYPE)) break;

                            const st = new Date(window.unifiedTimes[sIdx].start);
                            const en = new Date(window.unifiedTimes[sIdx].end);
                            const dur = (en - st)/60000;

                            if (scan._activity === finalActivity) play += dur;
                            else totalPost += dur;

                            endSlot = sIdx;
                            sIdx++;
                        }

                        // Draw only the first cell
                        if (slotIdx === startSlot) {
                            cellContent = `<strong>${finalActivity}</strong><br>
                                <span style="font-size:0.8em;color:#059669;">
                                (${Math.round(totalPre)}m To / ${Math.round(play)}m Play / ${Math.round(totalPost)}m From)
                                </span>`;
                            td.rowSpan = endSlot - startSlot + 1;
                            td.style.verticalAlign = "top";
                            td.style.textAlign = "center";
                            td.style.background = "#e0f7fa";
                            td.dataset.drawn = "true";
                            td.dataset.endSlot = endSlot;
                        } else {
                            td.style.display = "none";
                        }

                    } else {
                        cellContent = formatEntry(entry);
                    }

                }
                // TRANSITION BLOCK
                else if (entry && entry._activity === TRANSITION_TYPE) {
                    let continuation = false;
                    let sIdx = slotIdx;

                    while (sIdx >= 0) {
                        const prevScan = getEntry(bunk, sIdx);
                        if (prevScan &&
                            prevScan._activity !== TRANSITION_TYPE &&
                            prevScan._activity === getEntry(bunk, slotIdx+1)?._activity) {
                            continuation = true;
                            break;
                        }
                        sIdx--;
                    }

                    if (getEntry(bunk, slotIdx - 1)?.field === entry.field || continuation) {
                        td.style.display = "none";
                    } else {
                        cellContent = formatEntry(entry);
                    }
                }
                // FALLBACK: non-generated content
                else {
                    if (isDismissal) {
                        cellContent = "Dismissal";
                        bg = "#ffdddd";
                    } else if (isSnack) {
                        cellContent = "Snacks";
                        bg = "#e7ffe7";
                    } else if (!isGeneratedSlot) {
                        bg = "#fff7cc";
                        cellContent = ev;
                    } else {
                        cellContent = formatEntry(entry);
                    }
                }

                // Wrapper suppression of following rows
                if (cellContent === "" && td.style.display !== "none") {
                    const prevRow = tr.previousElementSibling;
                    if (prevRow) {
                        const prevTd = prevRow.querySelector(`[data-bunk="${bunk}"][data-end-slot]`);
                        if (prevTd && parseInt(prevTd.dataset.endSlot) >= slotIdx)
                            td.style.display = "none";
                    }
                }

                td.innerHTML = cellContent;
                if (bg) td.style.background = bg;

                td.style.cursor = "pointer";
                td.onclick = () => editCell(
                    bunk,
                    block.startMin,
                    block.endMin,
                    finalActivity || cellContent
                );

                tr.appendChild(td);
            });

            tbody.appendChild(tr);
        });

        table.appendChild(tbody);
        wrapper.appendChild(table);
    });
}

// ============================================================================
// SAVE / LOAD / INIT
// ============================================================================
function saveSchedule() {
    window.saveCurrentDailyData?.("scheduleAssignments", window.scheduleAssignments);
    window.saveCurrentDailyData?.("leagueAssignments", window.leagueAssignments);
    window.saveCurrentDailyData?.("unifiedTimes", window.unifiedTimes);
}

function reconcileOrRenderSaved() {
    try {
        const data = window.loadCurrentDailyData?.() || {};
        window.scheduleAssignments = data.scheduleAssignments || {};
        window.leagueAssignments = data.leagueAssignments || {};

        const saved = data.unifiedTimes || [];
        window.unifiedTimes = saved.map(s => ({
            ...s,
            start: new Date(s.start),
            end: new Date(s.end)
        }));
    } catch (e) {
        console.error("Schedule load error:", e);
        window.scheduleAssignments = {};
        window.leagueAssignments = {};
        window.unifiedTimes = [];
    }
    updateTable();
}

function updateTable() {
    const container = document.getElementById("scheduleTable");
    if (!container) return;
    renderStaggeredView(container);
}

function initScheduleSystem() {
    reconcileOrRenderSaved();
}

// EXPORTS
window.updateTable = updateTable;
window.initScheduleSystem = initScheduleSystem;
window.saveSchedule = saveSchedule;

})();
