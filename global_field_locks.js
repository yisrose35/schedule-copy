// ============================================================================
// global_field_locks.js - UNIFIED FIELD LOCK SYSTEM
// ============================================================================
// This module provides a SINGLE SOURCE OF TRUTH for field availability.
// ALL schedulers (specialty leagues, regular leagues, smart tiles, solver)
// MUST use this system to check and register field usage.
//
// When a league (specialty or regular) claims a field during a time slot,
// that field becomes COMPLETELY UNAVAILABLE to everyone else.
// ============================================================================

(function() {
    'use strict';

    // =========================================================================
    // GLOBAL LOCK REGISTRY
    // =========================================================================
    // Structure: { slotIndex: { fieldName: lockInfo } }
    // lockInfo: { 
    //   lockedBy: 'specialty_league' | 'regular_league' | 'pinned',
    //   leagueName: string,
    //   division: string,
    //   activity: string,
    //   timestamp: number
    // }
    // =========================================================================
    
    const GlobalFieldLocks = {
        _locks: {},
        _initialized: false
    };

    // =========================================================================
    // INITIALIZATION - Call at start of each schedule generation
    // =========================================================================
    GlobalFieldLocks.reset = function() {
        this._locks = {};
        this._initialized = true;
        console.log('[GLOBAL_LOCKS] Field lock registry RESET');
    };

    // =========================================================================
    // LOCK A FIELD - Makes field completely unavailable at given slots
    // =========================================================================
    /**
     * Lock a field at specific time slots
     * @param {string} fieldName - The field to lock
     * @param {number[]} slots - Array of slot indices
     * @param {object} lockInfo - Information about who is locking
     * @param {string} lockInfo.lockedBy - 'specialty_league', 'regular_league', 'pinned'
     * @param {string} lockInfo.leagueName - Name of the league (if applicable)
     * @param {string} lockInfo.division - Division name
     * @param {string} lockInfo.activity - Activity description
     */
    GlobalFieldLocks.lockField = function(fieldName, slots, lockInfo) {
        if (!this._initialized) this.reset();
        if (!fieldName || !slots || slots.length === 0) return false;
        
        const normalizedField = fieldName.toLowerCase().trim();
        
        for (const slotIdx of slots) {
            if (!this._locks[slotIdx]) {
                this._locks[slotIdx] = {};
            }
            
            // Check if already locked
            if (this._locks[slotIdx][normalizedField]) {
                const existing = this._locks[slotIdx][normalizedField];
                console.warn(`[GLOBAL_LOCKS] ⚠️ CONFLICT: "${fieldName}" at slot ${slotIdx} already locked by ${existing.lockedBy} (${existing.leagueName || existing.activity})`);
                return false;
            }
            
            // Apply lock
            this._locks[slotIdx][normalizedField] = {
                ...lockInfo,
                fieldName: fieldName, // Store original case
                timestamp: Date.now()
            };
            
            console.log(`[GLOBAL_LOCKS] 🔒 LOCKED: "${fieldName}" at slot ${slotIdx} by ${lockInfo.lockedBy} (${lockInfo.leagueName || lockInfo.activity})`);
        }
        
        return true;
    };

    // =========================================================================
    // CHECK IF FIELD IS LOCKED
    // =========================================================================
    /**
     * Check if a field is locked at ANY of the given slots
     * @param {string} fieldName - The field to check
     * @param {number[]} slots - Array of slot indices to check
     * @returns {object|null} - Lock info if locked, null if available
     */
    GlobalFieldLocks.isFieldLocked = function(fieldName, slots) {
        if (!this._initialized) return null;
        if (!fieldName || !slots || slots.length === 0) return null;
        
        const normalizedField = fieldName.toLowerCase().trim();
        
        for (const slotIdx of slots) {
            if (this._locks[slotIdx] && this._locks[slotIdx][normalizedField]) {
                return this._locks[slotIdx][normalizedField];
            }
        }
        
        return null;
    };

    // =========================================================================
    // CHECK IF FIELD IS AVAILABLE (inverse of isFieldLocked)
    // =========================================================================
    GlobalFieldLocks.isFieldAvailable = function(fieldName, slots) {
        return this.isFieldLocked(fieldName, slots) === null;
    };

    // =========================================================================
    // GET ALL LOCKED FIELDS FOR A TIME SLOT
    // =========================================================================
    GlobalFieldLocks.getLockedFieldsAtSlot = function(slotIdx) {
        if (!this._initialized || !this._locks[slotIdx]) return [];
        return Object.keys(this._locks[slotIdx]).map(key => this._locks[slotIdx][key].fieldName);
    };

    // =========================================================================
    // DEBUG: Print all locks
    // =========================================================================
    GlobalFieldLocks.debugPrintLocks = function() {
        console.log('\n=== GLOBAL FIELD LOCKS ===');
        
        if (!this._initialized || Object.keys(this._locks).length === 0) {
            console.log('No locks registered.');
            return;
        }
        
        const slotIndices = Object.keys(this._locks).sort((a, b) => parseInt(a) - parseInt(b));
        
        for (const slotIdx of slotIndices) {
            const slotLocks = this._locks[slotIdx];
            const fields = Object.keys(slotLocks);
            
            if (fields.length > 0) {
                console.log(`\nSlot ${slotIdx}:`);
                fields.forEach(field => {
                    const lock = slotLocks[field];
                    console.log(`  🔒 ${lock.fieldName}: ${lock.lockedBy} - ${lock.leagueName || lock.activity}`);
                });
            }
        }
        
        console.log('\n=========================\n');
    };

    // =========================================================================
    // LOCK MULTIPLE FIELDS AT ONCE
    // =========================================================================
    GlobalFieldLocks.lockMultipleFields = function(fieldNames, slots, lockInfo) {
        if (!fieldNames || fieldNames.length === 0) return true;
        
        let allSuccess = true;
        for (const fieldName of fieldNames) {
            const success = this.lockField(fieldName, slots, lockInfo);
            if (!success) allSuccess = false;
        }
        return allSuccess;
    };

    // =========================================================================
    // GET AVAILABLE FIELDS FROM A LIST
    // =========================================================================
    GlobalFieldLocks.filterAvailableFields = function(fieldNames, slots) {
        if (!fieldNames || fieldNames.length === 0) return [];
        return fieldNames.filter(fieldName => this.isFieldAvailable(fieldName, slots));
    };

    // =========================================================================
    // UNLOCK A FIELD (use sparingly - mainly for corrections)
    // =========================================================================
    GlobalFieldLocks.unlockField = function(fieldName, slots) {
        if (!this._initialized) return;
        
        const normalizedField = fieldName.toLowerCase().trim();
        
        for (const slotIdx of slots) {
            if (this._locks[slotIdx] && this._locks[slotIdx][normalizedField]) {
                delete this._locks[slotIdx][normalizedField];
                console.log(`[GLOBAL_LOCKS] 🔓 UNLOCKED: "${fieldName}" at slot ${slotIdx}`);
            }
        }
    };

    // =========================================================================
    // EXPORT GLOBALLY
    // =========================================================================
    window.GlobalFieldLocks = GlobalFieldLocks;

    console.log('[GLOBAL_LOCKS] Unified Field Lock System loaded');

})();
