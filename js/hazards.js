/**
 * Hazard Zone Management, Spatial Collision Checks, and USGS Earthquakes Feed.
 */

import {
    isPointInCircle,
    isPointInPolygon,
    polylineIntersectsCircle,
    polylineIntersectsPolygon,
    haversineDistance
} from './geo.js';

export const USGS_EARTHQUAKES_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson';

/**
 * Checks whether a single facility is inside a specific hazard zone.
 * @param {{lat: number, lon: number}} facility 
 * @param {object} hazard 
 * @returns {boolean}
 */
export function isFacilityInHazard(facility, hazard) {
    if (!facility || !hazard) return false;

    if (hazard.type === 'circle') {
        return isPointInCircle(
            facility.lat,
            facility.lon,
            hazard.centerLat,
            hazard.centerLon,
            hazard.radiusMeters
        );
    }

    if (hazard.type === 'polygon' && Array.isArray(hazard.coordinates)) {
        return isPointInPolygon(facility.lat, facility.lon, hazard.coordinates);
    }

    return false;
}

/**
 * Evaluates whether a facility is inside any active hazard zone,
 * and finds the distance to the closest hazard perimeter.
 * @param {{lat: number, lon: number}} facility 
 * @param {Array<object>} hazards 
 * @returns {{ inHazard: boolean, nearestHazardDistance: number, activeHazard: object|null }}
 */
export function evaluateFacilityHazard(facility, hazards = []) {
    if (!hazards || hazards.length === 0) {
        return { inHazard: false, nearestHazardDistance: Infinity, activeHazard: null };
    }

    let nearestDist = Infinity;
    let foundInsideHazard = null;

    for (const hazard of hazards) {
        if (isFacilityInHazard(facility, hazard)) {
            foundInsideHazard = hazard;
            return {
                inHazard: true,
                nearestHazardDistance: 0,
                activeHazard: hazard
            };
        }

        // Compute distance to hazard center or boundary
        let dist = Infinity;
        if (hazard.type === 'circle') {
            const centerDist = haversineDistance(facility.lat, facility.lon, hazard.centerLat, hazard.centerLon);
            dist = Math.max(0, centerDist - hazard.radiusMeters);
        } else if (hazard.type === 'polygon' && hazard.coordinates.length > 0) {
            // Distance to closest polygon vertex
            for (const pt of hazard.coordinates) {
                const pLat = Array.isArray(pt) ? pt[0] : pt.lat;
                const pLon = Array.isArray(pt) ? pt[1] : (pt.lng ?? pt.lon);
                const d = haversineDistance(facility.lat, facility.lon, pLat, pLon);
                if (d < dist) dist = d;
            }
        }

        if (dist < nearestDist) {
            nearestDist = dist;
        }
    }

    return {
        inHazard: false,
        nearestHazardDistance: nearestDist,
        activeHazard: null
    };
}

/**
 * Checks whether a route polyline intersects any active hazard zone.
 * @param {Array<[number, number]>} routeCoordinates Array of [lat, lon]
 * @param {Array<object>} hazards 
 * @returns {{ intersects: boolean, intersectingHazards: Array<object> }}
 */
export function evaluateRouteHazard(routeCoordinates, hazards = []) {
    if (!routeCoordinates || routeCoordinates.length === 0 || !hazards || hazards.length === 0) {
        return { intersects: false, intersectingHazards: [] };
    }

    const intersecting = [];

    for (const hazard of hazards) {
        let hits = false;
        if (hazard.type === 'circle') {
            hits = polylineIntersectsCircle(
                routeCoordinates,
                hazard.centerLat,
                hazard.centerLon,
                hazard.radiusMeters
            );
        } else if (hazard.type === 'polygon') {
            hits = polylineIntersectsPolygon(routeCoordinates, hazard.coordinates);
        }

        if (hits) {
            intersecting.push(hazard);
        }
    }

    return {
        intersects: intersecting.length > 0,
        intersectingHazards: intersecting
    };
}

/**
 * Fetches live earthquakes from the USGS past 24-hour M2.5+ feed.
 * @param {number} timeoutMs 
 * @returns {Promise<Array<object>>}
 */
export async function fetchLiveEarthquakes(timeoutMs = 7000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const res = await fetch(USGS_EARTHQUAKES_URL, { signal: controller.signal });
        clearTimeout(timer);

        if (res.ok) {
            const data = await res.json();
            if (data && Array.isArray(data.features)) {
                return data.features.map(f => {
                    const coords = f.geometry?.coordinates || [0, 0, 0];
                    const props = f.properties || {};
                    return {
                        id: f.id,
                        magnitude: props.mag,
                        place: props.place || 'Unknown location',
                        time: new Date(props.time),
                        depthKm: coords[2] || 0,
                        lon: coords[0],
                        lat: coords[1],
                        tsunamiAlert: Boolean(props.tsunami),
                        url: props.url
                    };
                });
            }
        }
    } catch (err) {
        clearTimeout(timer);
        console.warn('USGS Earthquakes feed fetch failed:', err.message);
    }
    return [];
}
