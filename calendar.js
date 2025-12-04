// ============================================================================
// calendar.js — FIXED + SYNCED WITH CONTINUOUS MINUTE ENGINE
//
// Fixes:
// ✔ Removed accidental <br> from comment
// ✔ Added full override initialization structure
// ✔ loadCurrentDailyData now persists newly-created day immediately
// ✔ No unifiedTimes references
// ✔ Fully compatible with Total Solver, Smart Tile V31, and Division Firewall
// ============================================================================

(function () {
    'use strict';

    // ==========================================================
    // 1. STORAGE KEYS
    // ==========================================================
    const GLOBAL_SETTINGS_KEY = "campGlobalSettings_v1";
    const DAILY_DATA_KEY = "campDailyData_v1";
    const ROTATION_HISTORY_KEY = "campRotationHistory_v1";
    const AUTO_SAVE_KEY = "campAutoSave_v1";

    const SMART_TILE_HISTORY_KEY = "smartTileHistory_v1";                // legacy
    const SMART_TILE_SPECIAL_HISTORY_KEY = "smartTileSpecialHistory_v1"; // new
    const SOLVER_SCORECARD_KEY = "campSolverScorecard_v1";               // new


    // ==========================================================
    // Helper — YYYY-MM-DD (no time-zone drift)
    // ==========================================================
    function getTodayString(date = new Date()) {
        date.setHours(12, 0, 0, 0); // lock noon to prevent DST drift
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    // ==========================================================
    // 2. DATE SYSTEM
    // ==========================================================
    window.currentScheduleDate = getTodayString();
    let datePicker = null;

    function onDateChanged() {
        const newDate = datePicker.value;
        if (!newDate) return;

        window.currentScheduleDate = newDate;

        window.loadCurrentDailyData();
        window.initScheduleSystem?.();
        window.initDailyAdjustments?.();

        if (document.getElementById('master-scheduler')?.classList.contains('active')) {
            window.initMasterScheduler?.();
        }
    }

    // ==========================================================
    // 3. GLOBAL SETTINGS API
    // ==========================================================
    window.loadGlobalSettings = function () {
        try {
            const d = localStorage.getItem(GLOBAL_SETTINGS_KEY);
            return d ? JSON.parse(d) : {};
        } catch {
            return {};
        }
    };

    window.saveGlobalSettings = function (key, value) {
        try {
            const settings = window.loadGlobalSettings();
            settings[key] = value;
            localStorage.setItem(GLOBAL_SETTINGS_KEY, JSON.stringify(settings));
        } catch (e) {
            console.error("Failed to save global settings:", e);
        }
    };

    // ==========================================================
    // 4. DAILY DATA API (MINUTE TIMELINE SAFE)
    // ==========================================================
    window.loadAllDailyData = function () {
        try {
            const raw = localStorage.getItem(DAILY_DATA_KEY);
            return raw ? JSON.parse(raw) : {};
        } catch {
            return {};
        }
    };

    window.loadCurrentDailyData = function () {
        const all = window.loadAllDailyData();
        const date = window.currentScheduleDate;

        if (!all[date]) {
            // Initialize NEW daily entry
            all[date] = {
                scheduleAssignments: {},
                leagueAssignments: {},
                leagueRoundState: {},
                leagueDayCounters: {},

                // FULL override structure (prevents undefined lookups)
                overrides: {
                    fields: [],
                    bunks: [],
                    leagues: [],
                    disabledFields: [],
                    disabledSpecials: [],
                    disabledSpecialtyLeagues: [],
                    dailyDisabledSportsByField: {}
                }
            };

            // SAVE NEW DAY IMMEDIATELY
            localStorage.setItem(DAILY_DATA_KEY, JSON.stringify(all));
        }

        all[date].leagueDayCounters ||= {};

        window.currentDailyData = all[date];
        return window.currentDailyData;
    };

    window.saveCurrentDailyData = function (key, value) {
        try {
            const all = window.loadAllDailyData();
            const date = window.currentScheduleDate;

            if (!all[date]) all[date] = {};

            all[date][key] = value;

            localStorage.setItem(DAILY_DATA_KEY, JSON.stringify(all));

            window.currentDailyData = all[date];
        } catch (e) {
            console.error("Failed to save daily data:", e);
        }
    };

    window.loadPreviousDailyData = function () {
        try {
            const [Y, M, D] = window.currentScheduleDate.split('-').map(Number);
            const dt = new Date(Y, M - 1, D, 12, 0, 0);
            dt.setDate(dt.getDate() - 1);

            const yesterday = getTodayString(dt);
            const all = window.loadAllDailyData();

            return all[yesterday] || {
                leagueDayCounters: {},
                leagueRoundState: {}
            };
        } catch {
            return {};
        }
    };

    // ==========================================================
    // 5. ROTATION HISTORY + SOLVER SCORECARD
    // ==========================================================
    window.loadRotationHistory = function () {
        try {
            const d = localStorage.getItem(ROTATION_HISTORY_KEY);
            const hist = d ? JSON.parse(d) : {};
            return {
                bunks: hist.bunks || {},
                leagues: hist.leagues || {},
                leagueTeamSports: hist.leagueTeamSports || {},
                leagueTeamLastSport: hist.leagueTeamLastSport || {}
            };
        } catch {
            return { bunks: {}, leagues: {} };
        }
    };

    window.saveRotationHistory = function (hist) {
        try {
            localStorage.setItem(ROTATION_HISTORY_KEY, JSON.stringify(hist));
        } catch (e) {
            console.error("Failed to save rotation history:", e);
        }
    };

    // SCORECARD
    window.loadSolverScorecard = function () {
        try {
            const d = localStorage.getItem(SOLVER_SCORECARD_KEY);
            return d ? JSON.parse(d) : { teamFairness: {} };
        } catch {
            return { teamFairness: {} };
        }
    };

    window.saveSolverScorecard = function (scorecard) {
        try {
            localStorage.setItem(SOLVER_SCORECARD_KEY, JSON.stringify(scorecard));
        } catch (e) {
            console.error("Failed to save solver scorecard:", e);
        }
    };

    // ==========================================================
    // 6. RESET HISTORY (All Engines)
    // ==========================================================
    window.eraseRotationHistory = function () {
        try {
            localStorage.removeItem(ROTATION_HISTORY_KEY);
            localStorage.removeItem(SMART_TILE_HISTORY_KEY);
            localStorage.removeItem(SMART_TILE_SPECIAL_HISTORY_KEY);
            localStorage.removeItem(SOLVER_SCORECARD_KEY);

            const settings = window.loadGlobalSettings();
            if (settings.manualUsageOffsets) {
                delete settings.manualUsageOffsets;
                localStorage.setItem(GLOBAL_SETTINGS_KEY, JSON.stringify(settings));
            }

            alert("All activity histories have been reset.");
            window.location.reload();
        } catch (e) {
            console.error("Failed to reset:", e);
            alert("Reset failed.");
        }
    };

    // ==========================================================
    // 7. ERASE ALL DATA
    // ==========================================================
    function setupEraseAll() {
        const btn = document.getElementById("eraseAllBtn");
        if (!btn) return;

        btn.onclick = () => {
            if (!confirm("Erase ALL data? This cannot be undone.")) return;

            localStorage.removeItem(GLOBAL_SETTINGS_KEY);
            localStorage.removeItem(DAILY_DATA_KEY);
            localStorage.removeItem(ROTATION_HISTORY_KEY);
            localStorage.removeItem(AUTO_SAVE_KEY);
            localStorage.removeItem(SMART_TILE_HISTORY_KEY);
            localStorage.removeItem(SMART_TILE_SPECIAL_HISTORY_KEY);
            localStorage.removeItem(SOLVER_SCORECARD_KEY);

            window.location.reload();
        };
    }

    // ==========================================================
    // 8. ERASE TODAY / ERASE ALL DAYS
    // ==========================================================
    window.eraseCurrentDailyData = function () {
        const all = window.loadAllDailyData();
        delete all[window.currentScheduleDate];
        localStorage.setItem(DAILY_DATA_KEY, JSON.stringify(all));

        window.loadCurrentDailyData();
        window.initScheduleSystem?.();
    };

    window.eraseAllDailyData = function () {
        localStorage.removeItem(DAILY_DATA_KEY);
        window.location.reload();
    };

    // ==========================================================
    // 9. BACKUP / RESTORE
    // ==========================================================
    function exportAllData() {
        try {
            const backup = {
                globalSettings: JSON.parse(localStorage.getItem(GLOBAL_SETTINGS_KEY) || "{}"),
                dailyData: JSON.parse(localStorage.getItem(DAILY_DATA_KEY) || "{}"),
                rotationHistory: JSON.parse(localStorage.getItem(ROTATION_HISTORY_KEY) || "{}"),
                solverScorecard: JSON.parse(localStorage.getItem(SOLVER_SCORECARD_KEY) || "{}")
            };

            const blob = new Blob([JSON.stringify(backup, null, 2)], {
                type: "application/json"
            });

            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `camp_scheduler_backup_${getTodayString()}.json`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (e) {
            console.error("Export failed:", e);
            alert("Export failed.");
        }
    }

    function handleFileSelect(e) {
        const file = e.target.files[0];
        if (!file) return;

        if (!confirm("Importing will OVERWRITE all data. Continue?")) {
            e.target.value = "";
            return;
        }

        const reader = new FileReader();
        reader.onload = evt => {
            try {
                const backup = JSON.parse(evt.target.result);

                localStorage.setItem(GLOBAL_SETTINGS_KEY, JSON.stringify(backup.globalSettings || {}));
                localStorage.setItem(DAILY_DATA_KEY, JSON.stringify(backup.dailyData || {}));
                localStorage.setItem(ROTATION_HISTORY_KEY, JSON.stringify(backup.rotationHistory || {}));
                localStorage.setItem(SOLVER_SCORECARD_KEY, JSON.stringify(backup.solverScorecard || {}));

                alert("Import successful. Reloading...");
                window.location.reload();
            } catch (err) {
                console.error("Invalid file:", err);
                alert("Invalid backup file.");
            }
        };
        reader.readAsText(file);
    }

    // ==========================================================
    // 10. AUTO SAVE SYSTEM (fixed)
    // ==========================================================
    function performAutoSave(silent = true) {
        try {
            const snap = {
                timestamp: Date.now(),
                [GLOBAL_SETTINGS_KEY]: localStorage.getItem(GLOBAL_SETTINGS_KEY),
                [DAILY_DATA_KEY]: localStorage.getItem(DAILY_DATA_KEY),
                [ROTATION_HISTORY_KEY]: localStorage.getItem(ROTATION_HISTORY_KEY),
                [SOLVER_SCORECARD_KEY]: localStorage.getItem(SOLVER_SCORECARD_KEY)
            };

            localStorage.setItem(AUTO_SAVE_KEY, JSON.stringify(snap));
            if (!silent) alert("Saved.");
        } catch (e) {
            console.error("Auto save failed:", e);
            if (!silent) alert("Save failed.");
        }
    }

    window.forceAutoSave = () => performAutoSave(false);

    window.restoreAutoSave = function () {
        try {
            const raw = localStorage.getItem(AUTO_SAVE_KEY);
            if (!raw) return alert("No auto-save found.");

            const snap = JSON.parse(raw);
            const date = new Date(snap.timestamp).toLocaleString();

            if (!confirm(`Restore auto-save from ${date}?`)) return;

            localStorage.setItem(GLOBAL_SETTINGS_KEY, snap[GLOBAL_SETTINGS_KEY]);
            localStorage.setItem(DAILY_DATA_KEY, snap[DAILY_DATA_KEY]);
            localStorage.setItem(ROTATION_HISTORY_KEY, snap[ROTATION_HISTORY_KEY]);
            localStorage.setItem(SOLVER_SCORECARD_KEY, snap[SOLVER_SCORECARD_KEY]);

            alert("Restored!");
            window.location.reload();
        } catch (e) {
            console.error("Restore failed:", e);
            alert("Restore failed.");
        }
    };

    function startAutoSaveTimer() {
        setInterval(() => performAutoSave(true), 300000);
        setTimeout(() => performAutoSave(true), 5000);
    }

    // ==========================================================
    // 11. INIT CALENDAR
    // ==========================================================
    function initCalendar() {
        datePicker = document.getElementById("calendar-date-picker");
        if (datePicker) {
            datePicker.value = window.currentScheduleDate;
            datePicker.addEventListener("change", onDateChanged);
        }

        setupEraseAll();

        const exportBtn = document.getElementById("exportBackupBtn");
        const importBtn = document.getElementById("importBackupBtn");
        const importInput = document.getElementById("importFileInput");

        if (exportBtn) exportBtn.addEventListener("click", exportAllData);
        if (importBtn && importInput) {
            importBtn.addEventListener("click", () => importInput.click());
            importInput.addEventListener("change", handleFileSelect);
        }

        startAutoSaveTimer();
    }

    window.initCalendar = initCalendar;

    // Immediately load today
    window.loadCurrentDailyData();

})();
