/**
 * Storage module with IndexedDB and localStorage fallbacks.
 * Safely handles private browsing mode, storage quotas, and offline persistence.
 */

const DB_NAME = 'gis_evacuation_db';
const DB_VERSION = 1;
const SHELTER_STORE = 'shelter_cache';
const PLAN_KEY = 'gis_last_evacuation_plan';
const PREFS_KEY = 'gis_user_preferences';

/**
 * Open IndexedDB database instance with error handling.
 * @returns {Promise<IDBDatabase|null>}
 */
function openDB() {
    return new Promise((resolve) => {
        if (typeof indexedDB === 'undefined') {
            resolve(null);
            return;
        }

        try {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(SHELTER_STORE)) {
                    db.createObjectStore(SHELTER_STORE, { keyPath: 'key' });
                }
            };

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => {
                console.warn('IndexedDB open error, falling back to localStorage');
                resolve(null);
            };
        } catch (err) {
            console.warn('IndexedDB not supported or accessible', err);
            resolve(null);
        }
    });
}

/**
 * Save shelter search results into cache keyed by rounded bbox.
 * @param {string} bboxKey 
 * @param {Array<object>} shelters 
 * @param {number} ttlMs Default 2 hours
 */
export async function cacheShelters(bboxKey, shelters, ttlMs = 2 * 60 * 60 * 1000) {
    const record = {
        key: bboxKey,
        shelters: shelters,
        timestamp: Date.now(),
        expiresAt: Date.now() + ttlMs
    };

    const db = await openDB();
    if (db) {
        try {
            const tx = db.transaction(SHELTER_STORE, 'readwrite');
            tx.objectStore(SHELTER_STORE).put(record);
            return;
        } catch (err) {
            console.warn('IndexedDB put error', err);
        }
    }

    // LocalStorage fallback
    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(`shelter_${bboxKey}`, JSON.stringify(record));
        }
    } catch (err) {
        console.warn('LocalStorage quota or write error', err);
    }
}

/**
 * Retrieve cached shelters by rounded bbox if still valid.
 * @param {string} bboxKey 
 * @returns {Promise<Array<object>|null>}
 */
export async function getCachedShelters(bboxKey) {
    const db = await openDB();
    if (db) {
        try {
            const result = await new Promise((resolve) => {
                const tx = db.transaction(SHELTER_STORE, 'readonly');
                const req = tx.objectStore(SHELTER_STORE).get(bboxKey);
                req.onsuccess = () => resolve(req.result || null);
                req.onerror = () => resolve(null);
            });

            if (result && result.expiresAt > Date.now() && Array.isArray(result.shelters)) {
                return result.shelters;
            }
        } catch (err) {
            console.warn('IndexedDB get error', err);
        }
    }

    // LocalStorage fallback
    try {
        if (typeof localStorage !== 'undefined') {
            const raw = localStorage.getItem(`shelter_${bboxKey}`);
            if (raw) {
                const record = JSON.parse(raw);
                if (record && record.expiresAt > Date.now() && Array.isArray(record.shelters)) {
                    return record.shelters;
                }
            }
        }
    } catch (err) {
        console.warn('LocalStorage get error', err);
    }

    return null;
}

/**
 * Persists the last active evacuation plan (origin, destination, route, steps, hazard warnings).
 * @param {object} plan 
 */
export function saveLastPlan(plan) {
    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(PLAN_KEY, JSON.stringify({
                ...plan,
                savedAt: Date.now()
            }));
        }
    } catch (err) {
        console.warn('Failed to save last evacuation plan', err);
    }
}

/**
 * Retrieves the last active evacuation plan from storage.
 * @returns {object|null}
 */
export function getLastPlan() {
    try {
        if (typeof localStorage !== 'undefined') {
            const raw = localStorage.getItem(PLAN_KEY);
            return raw ? JSON.parse(raw) : null;
        }
    } catch (err) {
        console.warn('Failed to load last evacuation plan', err);
    }
    return null;
}

/**
 * Clear the saved last evacuation plan.
 */
export function clearLastPlan() {
    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.removeItem(PLAN_KEY);
        }
    } catch (err) {
        console.warn('Failed to clear last plan', err);
    }
}

/**
 * Persist user preferences (theme, emergency contacts, search radius, default mode).
 * @param {object} prefs 
 */
export function savePreferences(prefs) {
    try {
        if (typeof localStorage !== 'undefined') {
            const current = getPreferences();
            localStorage.setItem(PREFS_KEY, JSON.stringify({ ...current, ...prefs }));
        }
    } catch (err) {
        console.warn('Failed to save preferences', err);
    }
}

/**
 * Get user preferences.
 * @returns {object}
 */
export function getPreferences() {
    const defaults = {
        theme: 'dark',
        disaster: 'general',
        mode: 'driving',
        radiusKm: 5,
        countryCode: 'IN',
        customEmergencyNumbers: []
    };
    try {
        if (typeof localStorage !== 'undefined') {
            const raw = localStorage.getItem(PREFS_KEY);
            return raw ? { ...defaults, ...JSON.parse(raw) } : defaults;
        }
    } catch (err) {
        console.warn('Failed to load preferences', err);
    }
    return defaults;
}
