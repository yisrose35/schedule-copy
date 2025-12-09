// =================================================================
// scheduler_field_reservations.js
// 
// FIELD RESERVATION SYSTEM
// Scans skeleton for reserved fields and blocks them during scheduling
// 
// ADD THIS CODE TO scheduler_core_utils.js or load as separate file
// =================================================================

(function() {
'use strict';

// =================================================================
// FIELD RESERVATION SCANNER
// =================================================================

/**
 * Scans the skeleton for all field reservations
 * Returns: { fieldName: [ { startMin, endMin, division, event } ] }
 */
function getFieldReservationsFromSkeleton(skeleton) {
    const reservations = {};
    
    if (!skeleton || !Array.isArray(skeleton)) {
        return reservations;
    }
    
    skeleton.forEach(block => {
        // Check if this block has reserved fields
        if (block.reservedFields && Array.isArray(block.reservedFields) && block.reservedFields.length > 0) {
            const startMin = parseTimeToMinutes(block.startTime);
            const endMin = parseTimeToMinutes(block.endTime);
            
            if (startMin === null || endMin === null) return;
            
            block.reservedFields.forEach(fieldName => {
                if (!reservations[fieldName]) {
                    reservations[fieldName] = [];
                }
                
                reservations[fieldName].push({
                    startMin,
                    endMin,
                    division: block.division,
                    event: block.event,
                    id: block.id
                });
            });
        }
    });
    
    console.log("[FieldReservations] Scanned skeleton, found reservations:", reservations);
    return reservations;
}

/**
 * Checks if a field is reserved at a given time
 * @param {string} fieldName - The field to check
 * @param {number} startMin - Start time in minutes
 * @param {number} endMin - End time in minutes
 * @param {Object} reservations - The reservations object from getFieldReservationsFromSkeleton
 * @returns {Object|null} - The reservation that blocks this, or null if available
 */
function isFieldReserved(fieldName, startMin, endMin, reservations) {
    if (!reservations || !reservations[fieldName]) {
        return null; // No reservations for this field
    }
    
    for (const reservation of reservations[fieldName]) {
        // Check for time overlap
        const overlaps = (startMin < reservation.endMin) && (endMin > reservation.startMin);
        if (overlaps) {
            return reservation; // Return the blocking reservation
        }
    }
    
    return null; // Field is available
}

/**
 * Parse time string to minutes (same as in other files)
 */
function parseTimeToMinutes(str) {
    if (!str || typeof str !== "string") return null;
    let s = str.trim().toLowerCase();
    let mer = null;
    if (s.endsWith("am") || s.endsWith("pm")) {
        mer = s.endsWith("am") ? "am" : "pm";
        s = s.replace(/am|pm/g, "").trim();
    }
    const m = s.match(/^(\d{1,2})\s*:\s*(\d{2})$/);
    if (!m) return null;
    let hh = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    if (Number.isNaN(hh) || Number.isNaN(mm) || mm < 0 || mm > 59) return null;
    if (mer) {
        if (hh === 12) hh = mer === "am" ? 0 : 12;
        else if (mer === "pm") hh += 12;
    } else {
        // Try to infer AM/PM based on hour
        if (hh >= 1 && hh <= 6) hh += 12; // Assume PM for 1-6
    }
    return hh * 60 + mm;
}

// =================================================================
// EXPOSE GLOBALLY
// =================================================================
window.FieldReservations = {
    getFromSkeleton: getFieldReservationsFromSkeleton,
    isReserved: isFieldReserved,
    parseTimeToMinutes
};

console.log("[FieldReservations] Module loaded");

})();


// =================================================================
// INTEGRATION GUIDE - ADD TO scheduler_core_utils.js canBlockFit()
// =================================================================
/*

In your canBlockFit function, add this check EARLY (before other checks):

// --- FIELD RESERVATION CHECK ---
if (window.fieldReservations && resourceName) {
    const reservation = window.FieldReservations.isReserved(
        resourceName, 
        startMin, 
        endMin, 
        window.fieldReservations
    );
    if (reservation) {
        if (debug) {
            console.log(`[canBlockFit] ${resourceName} REJECTED - reserved by "${reservation.event}" (${reservation.division})`);
        }
        return false;
    }
}

And at the START of runSkeletonOptimizer(), add:

// Scan skeleton for field reservations
window.fieldReservations = window.FieldReservations?.getFromSkeleton(skeleton) || {};

*/
