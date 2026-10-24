/**
 * Pure geospatial and geometric calculations for GIS Evacuation System.
 * ES Module compatible with browser and Node.js testing.
 */

export const EARTH_RADIUS_METERS = 6371000;

/**
 * Calculates great-circle distance between two [lat, lon] coordinates in meters.
 * @param {number} lat1 
 * @param {number} lon1 
 * @param {number} lat2 
 * @param {number} lon2 
 * @returns {number} distance in meters
 */
export function haversineDistance(lat1, lon1, lat2, lon2) {
    if (lat1 === lat2 && lon1 === lon2) return 0;
    const toRad = Math.PI / 180;
    const phi1 = lat1 * toRad;
    const phi2 = lat2 * toRad;
    const deltaPhi = (lat2 - lat1) * toRad;
    const deltaLambda = (lon2 - lon1) * toRad;

    const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
              Math.cos(phi1) * Math.cos(phi2) *
              Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return EARTH_RADIUS_METERS * c;
}

/**
 * Calculates an approximate bounding box around a center point for a given radius in meters.
 * @param {number} lat 
 * @param {number} lon 
 * @param {number} radiusMeters 
 * @returns {{ south: number, west: number, north: number, east: number }}
 */
export function computeBoundingBox(lat, lon, radiusMeters) {
    const latDelta = radiusMeters / 111320;
    const cosLat = Math.cos(lat * Math.PI / 180);
    // guard against pole division
    const lonDelta = Math.abs(cosLat) > 0.0001 ? radiusMeters / (111320 * Math.abs(cosLat)) : radiusMeters / 111320;

    return {
        south: Math.max(-90, lat - latDelta),
        west: Math.max(-180, lon - lonDelta),
        north: Math.min(90, lat + latDelta),
        east: Math.min(180, lon + lonDelta)
    };
}

/**
 * Returns a rounded string key for a bounding box, used for cache keys.
 * Precision of 2 decimals ≈ 1.1 km grid resolution.
 * @param {{ south: number, west: number, north: number, east: number }} bbox 
 * @param {number} precision 
 * @returns {string}
 */
export function roundBboxKey(bbox, precision = 2) {
    return [
        bbox.south.toFixed(precision),
        bbox.west.toFixed(precision),
        bbox.north.toFixed(precision),
        bbox.east.toFixed(precision)
    ].join(',');
}

/**
 * Checks if a point [lat, lon] is inside a circular zone.
 * @param {number} lat 
 * @param {number} lon 
 * @param {number} centerLat 
 * @param {number} centerLon 
 * @param {number} radiusMeters 
 * @returns {boolean}
 */
export function isPointInCircle(lat, lon, centerLat, centerLon, radiusMeters) {
    return haversineDistance(lat, lon, centerLat, centerLon) <= radiusMeters;
}

/**
 * Checks if a point [lat, lon] is inside a polygon using ray casting algorithm.
 * Polygon vertices must be array of [lat, lon] or objects {lat, lon / lng}.
 * @param {number} lat 
 * @param {number} lon 
 * @param {Array<[number, number]|{lat: number, lng: number}>} polygonVertices 
 * @returns {boolean}
 */
export function isPointInPolygon(lat, lon, polygonVertices) {
    if (!polygonVertices || polygonVertices.length < 3) return false;

    // Normalize coordinates to [lat, lon]
    const pts = polygonVertices.map(p => {
        if (Array.isArray(p)) return [p[0], p[1]];
        return [p.lat, p.lng ?? p.lon];
    });

    let inside = false;
    const n = pts.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = pts[i][1], yi = pts[i][0];
        const xj = pts[j][1], yj = pts[j][0];

        const intersect = ((yi > lat) !== (yj > lat)) &&
            (lon < (xj - xi) * (lat - yi) / (yj - yi + 1e-12) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

/**
 * Determines whether two 2D line segments [p1, p2] and [p3, p4] intersect.
 * Points are [lon, lat] or [x, y].
 * @param {[number, number]} p1 
 * @param {[number, number]} p2 
 * @param {[number, number]} p3 
 * @param {[number, number]} p4 
 * @returns {boolean}
 */
export function segmentsIntersect(p1, p2, p3, p4) {
    function ccw(a, b, c) {
        return (c[1] - a[1]) * (b[0] - a[0]) > (b[1] - a[1]) * (c[0] - a[0]);
    }

    const a = ccw(p1, p3, p4);
    const b = ccw(p2, p3, p4);
    const c = ccw(p1, p2, p3);
    const d = ccw(p1, p2, p4);

    if (a !== b && c !== d) return true;

    // Check collinear cases
    function onSegment(p, q, r) {
        return q[0] <= Math.max(p[0], r[0]) && q[0] >= Math.min(p[0], r[0]) &&
               q[1] <= Math.max(p[1], r[1]) && q[1] >= Math.min(p[1], r[1]);
    }

    function orientation(p, q, r) {
        const val = (q[1] - p[1]) * (r[0] - q[0]) - (q[0] - p[0]) * (r[1] - q[1]);
        if (Math.abs(val) < 1e-10) return 0;
        return (val > 0) ? 1 : 2;
    }

    const o1 = orientation(p1, p2, p3);
    const o2 = orientation(p1, p2, p4);
    const o3 = orientation(p3, p4, p1);
    const o4 = orientation(p3, p4, p2);

    if (o1 === 0 && onSegment(p1, p3, p2)) return true;
    if (o2 === 0 && onSegment(p1, p4, p2)) return true;
    if (o3 === 0 && onSegment(p3, p1, p4)) return true;
    if (o4 === 0 && onSegment(p3, p2, p4)) return true;

    return false;
}

/**
 * Checks if a polyline (array of [lat, lon]) intersects a polygon.
 * @param {Array<[number, number]>} polyline 
 * @param {Array<[number, number]|{lat: number, lng: number}>} polygonVertices 
 * @returns {boolean}
 */
export function polylineIntersectsPolygon(polyline, polygonVertices) {
    if (!polyline || polyline.length < 2 || !polygonVertices || polygonVertices.length < 3) return false;

    // Normalize polygon vertices
    const poly = polygonVertices.map(p => Array.isArray(p) ? [p[0], p[1]] : [p.lat, p.lng ?? p.lon]);

    // Check if any point of polyline is inside polygon
    for (const pt of polyline) {
        if (isPointInPolygon(pt[0], pt[1], poly)) return true;
    }

    // Check if any polyline segment crosses any polygon edge
    for (let i = 0; i < polyline.length - 1; i++) {
        const segA = [polyline[i][1], polyline[i][0]]; // [lon, lat]
        const segB = [polyline[i + 1][1], polyline[i + 1][0]];

        for (let j = 0; j < poly.length; j++) {
            const nextJ = (j + 1) % poly.length;
            const edgeA = [poly[j][1], poly[j][0]];
            const edgeB = [poly[nextJ][1], poly[nextJ][0]];

            if (segmentsIntersect(segA, segB, edgeA, edgeB)) {
                return true;
            }
        }
    }
    return false;
}

/**
 * Checks if a polyline (array of [lat, lon]) intersects a circle.
 * @param {Array<[number, number]>} polyline 
 * @param {number} cLat 
 * @param {number} cLon 
 * @param {number} radiusMeters 
 * @returns {boolean}
 */
export function polylineIntersectsCircle(polyline, cLat, cLon, radiusMeters) {
    if (!polyline || polyline.length === 0) return false;

    for (let i = 0; i < polyline.length; i++) {
        if (isPointInCircle(polyline[i][0], polyline[i][1], cLat, cLon, radiusMeters)) {
            return true;
        }
    }

    // Check segment distance to circle center
    for (let i = 0; i < polyline.length - 1; i++) {
        const d = distanceSegmentToPoint(
            polyline[i][0], polyline[i][1],
            polyline[i + 1][0], polyline[i + 1][1],
            cLat, cLon
        );
        if (d <= radiusMeters) return true;
    }

    return false;
}

/**
 * Calculates shortest distance from a point to a line segment in meters.
 * @param {number} lat1 
 * @param {number} lon1 
 * @param {number} lat2 
 * @param {number} lon2 
 * @param {number} pLat 
 * @param {number} pLon 
 * @returns {number}
 */
export function distanceSegmentToPoint(lat1, lon1, lat2, lon2, pLat, pLon) {
    const toRad = Math.PI / 180;
    const cosLat = Math.cos((lat1 + lat2) / 2 * toRad);

    // Approximate planar projection in meters
    const x1 = lon1 * 111320 * cosLat, y1 = lat1 * 111320;
    const x2 = lon2 * 111320 * cosLat, y2 = lat2 * 111320;
    const px = pLon * 111320 * cosLat, py = pLat * 111320;

    const dx = x2 - x1;
    const dy = y2 - y1;
    const l2 = dx * dx + dy * dy;
    if (l2 === 0) return haversineDistance(lat1, lon1, pLat, pLon);

    let t = ((px - x1) * dx + (py - y1) * dy) / l2;
    t = Math.max(0, Math.min(1, t));

    const projX = x1 + t * dx;
    const projY = y1 + t * dy;

    return Math.hypot(px - projX, py - projY);
}

/**
 * Format meters to human readable string (e.g. "850 m" or "4.2 km").
 * @param {number} meters 
 * @returns {string}
 */
export function formatDistance(meters) {
    if (meters == null || isNaN(meters)) return '--';
    if (meters < 1000) {
        return `${Math.round(meters)} m`;
    }
    return `${(meters / 1000).toFixed(1)} km`;
}

/**
 * Format seconds to human readable string (e.g. "12 min" or "1 hr 15 min").
 * @param {number} seconds 
 * @returns {string}
 */
export function formatDuration(seconds) {
    if (seconds == null || isNaN(seconds)) return '--';
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) {
        return `${Math.max(1, minutes)} min`;
    }
    const hrs = Math.floor(minutes / 60);
    const remainingMins = minutes % 60;
    return remainingMins > 0 ? `${hrs} hr ${remainingMins} min` : `${hrs} hr`;
}
