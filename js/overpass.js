/**
 * OpenStreetMap Overpass API client for live shelter and emergency facility data.
 * Features multi-mirror fallback, request timeouts, caching, and offline GeoJSON fallback.
 */

import { computeBoundingBox, roundBboxKey, haversineDistance } from './geo.js';
import { getCachedShelters, cacheShelters } from './storage.js';

export const OVERPASS_MIRRORS = [
    'https://overpass-api.de/api/interpreter',
    'https://lz4.overpass-api.de/api/interpreter',
    'https://z.overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter'
];

/**
 * Normalizes an OSM element or GeoJSON feature into a unified Shelter object.
 * @param {object} element 
 * @param {string} source 
 * @returns {object|null}
 */
export function normalizeOsmFacility(element, source = 'overpass') {
    if (!element) return null;

    let lat = null;
    let lon = null;

    if (element.lat != null && element.lon != null) {
        lat = Number(element.lat);
        lon = Number(element.lon);
    } else if (element.center && element.center.lat != null && element.center.lon != null) {
        lat = Number(element.center.lat);
        lon = Number(element.center.lon);
    } else if (element.geometry && element.geometry.coordinates) {
        lon = Number(element.geometry.coordinates[0]);
        lat = Number(element.geometry.coordinates[1]);
    }

    if (lat == null || lon == null || isNaN(lat) || isNaN(lon)) {
        return null;
    }

    const tags = element.tags || element.properties || {};
    const type = detectFacilityType(tags);

    const name = tags.name || tags['name:en'] || formatFallbackName(type, tags);
    // Only real, tagged capacity. A guessed number could send people to a shelter that is already full.
    const capacity = parseInt(tags.capacity, 10) || null;
    const levels = parseInt(tags['building:levels'], 10) || (type === 'school' || type === 'college' ? 2 : 1);
    const phone = tags.phone || tags['contact:phone'] || tags['emergency:phone'] || '';
    const wheelchair = tags.wheelchair || 'unknown';
    const address = [tags['addr:housenumber'], tags['addr:street'], tags['addr:city']]
        .filter(Boolean)
        .join(' ');

    return {
        id: element.id ? `${element.type || 'osm'}_${element.id}` : `geo_${Math.random().toString(36).substring(2, 9)}`,
        name,
        type,
        lat,
        lon,
        capacity,
        levels,
        phone,
        wheelchair,
        address: address || tags.operator || '',
        operator: tags.operator || '',
        source,
        rawTags: tags
    };
}

/**
 * Detect standardized facility type from tags.
 * @param {object} tags 
 * @returns {string}
 */
export function detectFacilityType(tags) {
    if (!tags) return 'shelter';

    if (tags.emergency === 'assembly_point') return 'assembly_point';
    if (tags.amenity === 'shelter' || tags.emergency === 'shelter') return 'shelter';
    if (tags.amenity === 'hospital') return 'hospital';
    if (tags.amenity === 'clinic') return 'clinic';
    if (tags.amenity === 'fire_station') return 'fire_station';
    if (tags.amenity === 'police') return 'police';
    if (tags.amenity === 'community_centre' || tags.leisure === 'sports_centre') return 'community_centre';
    if (tags.amenity === 'college' || tags.amenity === 'university') return 'college';
    if (tags.amenity === 'school') return 'school';

    // GeoJSON fallback support
    if (tags.type === 'hospital') return 'hospital';
    if (tags.type === 'school') return 'school';

    return 'shelter';
}

function formatFallbackName(type, tags) {
    const titleCase = type.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
    if (tags['addr:street']) {
        return `${titleCase} on ${tags['addr:street']}`;
    }
    return `Emergency ${titleCase}`;
}

/**
 * Builds Overpass QL query string for a given center coordinate and radius.
 * @param {number} lat 
 * @param {number} lon 
 * @param {number} radiusMeters 
 * @returns {string}
 */
export const SHELTER_AMENITIES = [
    'hospital', 'clinic', 'school', 'college', 'university',
    'community_centre', 'shelter', 'fire_station', 'police'
];
export const SHELTER_EMERGENCY = ['assembly_point', 'shelter'];

export function buildOverpassQuery(lat, lon, radiusMeters) {
    const r = Math.min(Math.max(radiusMeters, 500), 50000); // 500m to 50km
    // Two regex statements over nodes+ways+relations instead of 22 separate scans:
    // the server walks the area once per key, which is far cheaper under load.
    return `
[out:json][timeout:15];
(
  nwr["amenity"~"^(${SHELTER_AMENITIES.join('|')})$"](around:${r},${lat},${lon});
  nwr["emergency"~"^(${SHELTER_EMERGENCY.join('|')})$"](around:${r},${lat},${lon});
);
out center tags;
`.trim();
}

/**
 * Parses raw Overpass JSON elements into normalized Shelter objects.
 * @param {Array<object>} elements 
 * @returns {Array<object>}
 */
export function parseOverpassElements(elements) {
    if (!Array.isArray(elements)) return [];
    const seen = new Set();
    const result = [];

    for (const el of elements) {
        const shelter = normalizeOsmFacility(el, 'overpass');
        if (shelter && !seen.has(shelter.id)) {
            seen.add(shelter.id);
            result.push(shelter);
        }
    }
    return result;
}

/**
 * Fetches shelters from Overpass API with mirror fallback and request timeout.
 * @param {number} lat 
 * @param {number} lon 
 * @param {number} radiusMeters 
 * @param {number} timeoutMs 
 * @returns {Promise<Array<object>>}
 */
export async function fetchLiveShelters(lat, lon, radiusMeters = 5000, timeoutMs = 12000) {
    const bbox = computeBoundingBox(lat, lon, radiusMeters);
    const cacheKey = roundBboxKey(bbox, 2);

    // 1. Check local cache first
    try {
        const cached = await getCachedShelters(cacheKey);
        if (cached && cached.length > 0) {
            return cached;
        }
    } catch (e) {
        console.warn('Cache lookup failed', e);
    }

    const query = buildOverpassQuery(lat, lon, radiusMeters);

    // 2. Race all mirrors in parallel: in an emergency the first good answer wins.
    // (Trying them one by one meant up to 4 x timeout = ~50 s before falling back.)
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const attempt = async (mirror) => {
        const res = await fetch(mirror, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
            body: `data=${encodeURIComponent(query)}`,
            signal: controller.signal
        });
        if (!res.ok) throw new Error(`${mirror} returned status ${res.status}`);
        const data = await res.json();
        const shelters = Array.isArray(data?.elements) ? parseOverpassElements(data.elements) : [];
        if (shelters.length === 0) throw new Error(`${mirror} returned no facilities`);
        return shelters;
    };

    try {
        const shelters = await Promise.any(OVERPASS_MIRRORS.map(attempt));
        controller.abort(); // cancel the slower mirrors
        await cacheShelters(cacheKey, shelters);
        return shelters;
    } catch (err) {
        const reasons = err instanceof AggregateError ? err.errors.map(e => e.message) : [err.message];
        console.warn('Overpass mirrors failed:', reasons.join('; '));
    } finally {
        clearTimeout(timer);
    }

    // 3. Fallback to bundled offline GeoJSON data if mirrors fail or user is offline
    console.warn('All Overpass mirrors failed or offline. Loading bundled offline GeoJSON...');
    return loadBundledOfflineShelters(lat, lon, radiusMeters);
}

/**
 * Loads bundled offline GeoJSON files (schools, hospitals) and filters by distance.
 * @param {number} lat 
 * @param {number} lon 
 * @param {number} maxRadiusMeters 
 * @returns {Promise<Array<object>>}
 */
export async function loadBundledOfflineShelters(lat, lon, maxRadiusMeters = 15000) {
    const files = [
        'data/government_hospitals.geojson',
        'data/government_schools.geojson'
    ];

    const results = [];

    for (const file of files) {
        try {
            const res = await fetch(file);
            if (!res.ok) continue;
            const geojson = await res.json();
            if (geojson && Array.isArray(geojson.features)) {
                for (const feature of geojson.features) {
                    const shelter = normalizeOsmFacility(feature, 'bundled-offline');
                    if (shelter) {
                        // Calculate distance to current user location
                        const dist = haversineDistance(lat, lon, shelter.lat, shelter.lon);
                        shelter.straightDistance = dist;
                        results.push(shelter);
                    }
                }
            }
        } catch (err) {
            console.warn(`Failed loading offline file ${file}`, err);
        }
    }

    // Sort by proximity
    results.sort((a, b) => (a.straightDistance || 0) - (b.straightDistance || 0));
    return results;
}
