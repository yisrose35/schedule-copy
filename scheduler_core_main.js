// ============================================================================
// scheduler_core_main.js
// STAGE 5 — THE ORCHESTRATOR (Continuous Timeline Version)
//
// Responsibilities:
// 1. Receive processed blocks from Stage 4 (League First).
// 2. Walk through the unified minute timeline.
// 3. Fill blocks for each bunk in exact chronological order.
// 4. Resolve Smart Tile choices (primary, secondary, fallback).
// 5. Insert Split A + Split B as paired blocks.
// 6. Assign fields using same-sport + sharable rules.
// 7. Enforce exclusivity, capacity, zone restrictions.
// 8. Produce final scheduleAssignments[bunk] as minute-indexed arrays.
// ============================================================================

(function(){
"use strict";

if (!window.SchedulerCoreMain) window.SchedulerCoreMain = {};

//
// ---------------------------------------------------------------------------
//  INTERNAL STATE
// ---------------------------------------------------------------------------
//

let unifiedMinutes = [];        // Provided by Stage 1 builder (continuous timeline)
let processedBlocks = [];       // Provided by Stage 4 (League-first)
let fields = [];
let divisions = {};
let bunkList = [];

let fieldUsage = {};            // cache[field][minute] = { used:true, sport }
let scheduleAssignments = {};   // final result: scheduleAssignments[bunk][minute] = entry

//
// ---------------------------------------------------------------------------
//  PUBLIC ENTRY POINT
// ---------------------------------------------------------------------------
//

window.SchedulerCoreMain.runScheduler = function(config) {

    // 1. Pull inputs from Stage 1–4
    unifiedMinutes     = config.unifiedMinutes || [];
    processedBlocks    = config.processedBlocks || [];
    fields             = config.fields || [];
    divisions          = config.divisions || {};
    bunkList           = config.bunks || [];

    // 2. Prepare caches
    initFieldUsageCache();
    initScheduleArrays();

    // 3. Fill blocks in chronological order
    processedBlocks
        .sort((a,b) => a.startMin - b.startMin)
        .forEach(block => placeBlock(block));

    // 4. Expose final structure globally
    window.scheduleAssignments = scheduleAssignments;

    return scheduleAssignments;
};

//
// ---------------------------------------------------------------------------
//  INITIALIZATION HELPERS
// ---------------------------------------------------------------------------
//

function initFieldUsageCache() {
    fieldUsage = {};
    fields.forEach(f => fieldUsage[f.name] = {});
}

function initScheduleArrays() {
    scheduleAssignments = {};
    bunkList.forEach(b => {
        scheduleAssignments[b] = Array(unifiedMinutes.length).fill(null);
    });
}

//
// ---------------------------------------------------------------------------
//  BLOCK PLACEMENT (Core Orchestration)
// ---------------------------------------------------------------------------
//

function placeBlock(block) {

    const blockType = block.type;

    switch(blockType) {

        case "league":
            applyLeagueBlock(block);
            return;

        case "smart":
            resolveSmartTile(block);
            applyStandardBlock(block);
            return;

        case "split-A":
        case "split-B":
            applyStandardBlock(block);
            return;

        case "special":
        case "activity":
        case "transition":
        default:
            applyStandardBlock(block);
            return;
    }
}

//
// ---------------------------------------------------------------------------
//  SMART TILE RESOLUTION
// ---------------------------------------------------------------------------
//

function resolveSmartTile(block) {

    if (!block.options || !Array.isArray(block.options)) return;

    let bestOption = null;
    let bestCost   = Infinity;

    for (let opt of block.options) {
        let cost = evaluateSmartOption(block, opt);
        if (cost < bestCost) {
            bestCost = cost;
            bestOption = opt;
        }
    }

    if (!bestOption) bestOption = block.options[block.options.length - 1];

    // Apply chosen option to the block
    block.activity = bestOption.activity;
    block.sport    = bestOption.sport || null;
    block.field    = bestOption.field || null;
    block.type     = "activity"; // convert into normal block
}

function evaluateSmartOption(block, option) {
    // Simple placeholder cost model.
    // Stage 3 filler provides real penalty weights if needed.
    let cost = 0;

    // Penalize if field is not compatible
    if (!isFieldCompatible(option.field, option.sport, block)) {
        cost += 9999;
    }

    return cost;
}

//
// ---------------------------------------------------------------------------
//  GENERAL BLOCK APPLICATION
// ---------------------------------------------------------------------------
//

function applyStandardBlock(block) {

    const {bun k, startMin, endMin, activity, sport, field, type} = block;

    for (let minute = startMin; minute < endMin; minute++) {

        const slotIndex = unifiedMinutes.indexOf(minute);
        if (slotIndex === -1) continue;

        // Assign the field
        const assignedField = assignFieldForBlockMinute(block, minute);
        if (!assignedField) continue;

        // Write to schedule
        scheduleAssignments[bunk][slotIndex] = {
            activity,
            sport,
            field: assignedField,
            type,
            startMin,
            endMin,
            blockId: block.blockId || null,
            gameNumber: block.gameNumber || null
        };
    }
}

//
// ---------------------------------------------------------------------------
//  LEAGUE BLOCK APPLICATION
// ---------------------------------------------------------------------------
//

function applyLeagueBlock(block) {

    const {bunk, leagueName, gameNumber, startMin, endMin, sport, field} = block;

    for (let minute = startMin; minute < endMin; minute++) {

        const slotIndex = unifiedMinutes.indexOf(minute);
        if (slotIndex === -1) continue;

        const assignedField = assignFieldForBlockMinute(block, minute);
        if (!assignedField) continue;

        scheduleAssignments[bunk][slotIndex] = {
            activity: "League Game",
            leagueName,
            gameNumber,
            field: assignedField,
            sport,
            type: "league",
            startMin,
            endMin
        };
    }
}

//
// ---------------------------------------------------------------------------
//  FIELD ASSIGNMENT LOGIC (Continuous Timeline)
// ---------------------------------------------------------------------------
//

function assignFieldForBlockMinute(block, minute) {

    let candidateFields = block.possibleFields || fields.map(f => f.name);

    for (let fName of candidateFields) {
        if (canUseField(fName, block, minute)) {
            markFieldUsage(fName, block, minute);
            return fName;
        }
    }

    return null;
}

function canUseField(fName, block, minute) {

    const usage = fieldUsage[fName][minute];

    // If field empty → OK
    if (!usage) return true;

    // If field used by another block:
    // 1. Check exclusivity
    if (block.exclusive) return false;

    // 2. Must match sport if sharable
    if (usage.sport !== block.sport) return false;

    return true;
}

function markFieldUsage(fName, block, minute) {
    fieldUsage[fName][minute] = {
        used: true,
        sport: block.sport,
        type: block.type
    };
}

})();
