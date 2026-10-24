/**
 * OSRM Road Routing and Table Matrix Client.
 * Supports driving and walking profiles, turn-by-turn directions,
 * batch travel times via OSRM table service, and straight-line fallback.
 */

import { haversineDistance } from './geo.js';

// The project-osrm.org demo server only has a car graph and silently returns car routes for
// any profile, so walking ETAs would be wrong. FOSSGIS hosts separate car and foot graphs.
export const OSRM_SERVERS = {
    driving: 'https://routing.openstreetmap.de/routed-car',
    foot: 'https://routing.openstreetmap.de/routed-foot',
};

/** Base URL for a profile. The path segment after /route/v1/ is ignored by these servers. */
export function osrmBase(profile) {
    return profile === 'foot' ? OSRM_SERVERS.foot : OSRM_SERVERS.driving;
}

/**
 * Fetch detailed road route between start and destination using OSRM.
 * @param {number} startLat 
 * @param {number} startLon 
 * @param {number} endLat 
 * @param {number} endLon 
 * @param {'driving'|'foot'} profile 
 * @param {number} timeoutMs 
 * @returns {Promise<object>} Route object with polyline coordinates [lat, lon], distance, duration, steps.
 */
export async function fetchOsrmRoute(startLat, startLon, endLat, endLon, profile = 'driving', timeoutMs = 8000) {
    const prof = profile === 'foot' ? 'foot' : 'driving';
    const url = `${osrmBase(prof)}/route/v1/driving/${startLon},${startLat};${endLon},${endLat}?overview=full&geometries=geojson&steps=true`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);

        if (res.ok) {
            const data = await res.json();
            if (data.code === 'Ok' && Array.isArray(data.routes) && data.routes.length > 0) {
                const route = data.routes[0];

                // OSRM GeoJSON is [lon, lat], Leaflet polyline expects [lat, lon]
                const latLngs = route.geometry.coordinates.map(coord => [coord[1], coord[0]]);

                const steps = parseRouteSteps(route.legs?.[0]?.steps || []);

                return {
                    isFallback: false,
                    profile: prof,
                    distanceMeters: route.distance,
                    durationSeconds: route.duration,
                    coordinates: latLngs, // [ [lat, lon], ... ]
                    steps: steps,
                    summary: `Via ${route.legs?.[0]?.summary || 'road network'}`
                };
            }
        }
    } catch (err) {
        clearTimeout(timer);
        console.warn('OSRM routing request failed:', err.message);
    }

    // Graceful fallback to straight-line route
    return createStraightLineFallback(startLat, startLon, endLat, endLon, prof);
}

/**
 * Batch query travel durations for multiple destinations from a single origin using OSRM Table Service.
 * @param {number} startLat 
 * @param {number} startLon 
 * @param {Array<{lat: number, lon: number}>} destinations 
 * @param {'driving'|'foot'} profile 
 * @param {number} timeoutMs 
 * @returns {Promise<Array<number>>} Array of duration in seconds for each destination in order
 */
export async function fetchTravelTimeMatrix(startLat, startLon, destinations, profile = 'driving', timeoutMs = 7000) {
    if (!destinations || destinations.length === 0) return [];

    const prof = profile === 'foot' ? 'foot' : 'driving';

    // Build coordinates parameter: origin first, then all destinations
    const coords = [`${startLon},${startLat}`, ...destinations.map(d => `${d.lon},${d.lat}`)].join(';');
    const url = `${osrmBase(prof)}/table/v1/driving/${coords}?sources=0`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);

        if (res.ok) {
            const data = await res.json();
            if (data.code === 'Ok' && data.durations && data.durations[0]) {
                // durations[0] contains [0, durDest1, durDest2, ...]
                const row = data.durations[0].slice(1);
                // Return durations, replacing nulls with estimated speed
                return destinations.map((dest, i) => {
                    const dur = row[i];
                    if (dur != null && !isNaN(dur)) return dur;
                    return estimateDuration(startLat, startLon, dest.lat, dest.lon, prof);
                });
            }
        }
    } catch (err) {
        clearTimeout(timer);
        console.warn('OSRM table service failed, using haversine estimates', err.message);
    }

    // Fallback: estimate each destination locally
    return destinations.map(dest => estimateDuration(startLat, startLon, dest.lat, dest.lon, prof));
}

/**
 * Creates straight-line fallback route with realistic distance/time estimates.
 * @param {number} startLat 
 * @param {number} startLon 
 * @param {number} endLat 
 * @param {number} endLon 
 * @param {'driving'|'foot'} profile 
 * @returns {object}
 */
export function createStraightLineFallback(startLat, startLon, endLat, endLon, profile = 'driving') {
    const directDistance = haversineDistance(startLat, startLon, endLat, endLon);
    // Urban circuity multiplier (typically 1.25x - 1.35x direct distance)
    const roadDistanceEstimate = directDistance * 1.3;
    const durationEstimate = estimateDuration(startLat, startLon, endLat, endLon, profile);

    return {
        isFallback: true,
        profile,
        distanceMeters: roadDistanceEstimate,
        durationSeconds: durationEstimate,
        coordinates: [
            [startLat, startLon],
            [endLat, endLon]
        ],
        steps: [
            {
                instruction: 'Head towards shelter along safest passable road',
                detail: 'Direct straight-line path (OSRM road server unavailable offline). Follow local emergency road signage.',
                distanceMeters: roadDistanceEstimate,
                durationSeconds: durationEstimate,
                icon: 'direct'
            },
            {
                instruction: 'Arrive at designated emergency facility',
                detail: 'Report to shelter coordinators or reception staff.',
                distanceMeters: 0,
                durationSeconds: 0,
                icon: 'arrive'
            }
        ],
        summary: 'Approximate straight line (road routing unavailable)'
    };
}

/**
 * Estimates travel duration in seconds based on profile and haversine distance.
 * @param {number} lat1 
 * @param {number} lon1 
 * @param {number} lat2 
 * @param {number} lon2 
 * @param {'driving'|'foot'} profile 
 * @returns {number} duration in seconds
 */
export function estimateDuration(lat1, lon1, lat2, lon2, profile = 'driving') {
    const dist = haversineDistance(lat1, lon1, lat2, lon2) * 1.3; // circuity factor
    // Average emergency urban speeds:
    // Driving: 25 km/h ≈ 6.94 m/s (heavy traffic/debris)
    // Foot: 4.5 km/h ≈ 1.25 m/s
    const speedMs = profile === 'foot' ? 1.25 : 6.94;
    return Math.round(dist / speedMs);
}

/**
 * Formats OSRM leg steps into clean, human-readable turn directions.
 * @param {Array<object>} rawSteps 
 * @returns {Array<object>}
 */
export function parseRouteSteps(rawSteps) {
    if (!Array.isArray(rawSteps) || rawSteps.length === 0) return [];

    return rawSteps.map((step, idx) => {
        const maneuver = step.maneuver || {};
        const instruction = formatStepInstruction(maneuver, step.name, idx === 0, idx === rawSteps.length - 1);
        const icon = getManeuverIcon(maneuver.type, maneuver.modifier);

        return {
            instruction,
            name: step.name || 'unnamed road',
            distanceMeters: step.distance,
            durationSeconds: step.duration,
            type: maneuver.type,
            modifier: maneuver.modifier,
            icon
        };
    });
}

function formatStepInstruction(maneuver, streetName, isFirst, isLast) {
    const name = streetName ? `onto <b>${escapeHtml(streetName)}</b>` : 'ahead';

    if (isFirst) {
        return streetName ? `Depart on <b>${escapeHtml(streetName)}</b>` : 'Head towards evacuation route';
    }
    if (isLast || maneuver.type === 'arrive') {
        return 'Arrive at evacuation facility';
    }

    const mod = maneuver.modifier ? maneuver.modifier.replace('_', ' ') : '';

    switch (maneuver.type) {
        case 'turn':
            return `Turn ${mod} ${name}`;
        case 'new name':
            return `Continue ${name}`;
        case 'fork':
            return `Take the ${mod} fork ${name}`;
        case 'end of road':
            return `Turn ${mod} at end of road ${name}`;
        case 'roundabout':
        case 'rotary':
            return `Take exit at roundabout ${name}`;
        case 'merge':
            return `Merge ${mod} ${name}`;
        case 'on ramp':
            return `Take ramp ${name}`;
        case 'off ramp':
            return `Take exit ${name}`;
        default:
            return mod ? `Turn ${mod} ${name}` : `Proceed ${name}`;
    }
}

function getManeuverIcon(type, modifier) {
    if (type === 'arrive') return '🏁';
    if (type === 'depart') return '🚗';
    if (type === 'roundabout') return '🔄';

    switch (modifier) {
        case 'left': return '⬅️';
        case 'slight left': return '↖️';
        case 'sharp left': return '↙️';
        case 'right': return '➡️';
        case 'slight right': return '↗️';
        case 'sharp right': return '↘️';
        case 'u-turn': return '↩️';
        default: return '⬆️';
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}
