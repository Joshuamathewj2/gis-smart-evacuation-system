import test from 'node:test';
import assert from 'node:assert/strict';
import {
    haversineDistance,
    computeBoundingBox,
    roundBboxKey,
    isPointInCircle,
    isPointInPolygon,
    segmentsIntersect,
    polylineIntersectsPolygon,
    polylineIntersectsCircle,
    formatDistance,
    formatDuration
} from '../js/geo.js';

test('haversineDistance between known coordinates', () => {
    // Chennai Central to Egmore (~2.4 km)
    const d = haversineDistance(13.0827, 80.2707, 13.0805, 80.2612);
    assert.ok(d > 900 && d < 1500, `Distance was ${d}`);

    // Same point should be 0
    assert.equal(haversineDistance(13.08, 80.27, 13.08, 80.27), 0);
});

test('computeBoundingBox and roundBboxKey', () => {
    const bbox = computeBoundingBox(13.08, 80.27, 5000);
    assert.ok(bbox.south < 13.08);
    assert.ok(bbox.north > 13.08);
    assert.ok(bbox.west < 80.27);
    assert.ok(bbox.east > 80.27);

    const key = roundBboxKey(bbox, 2);
    assert.match(key, /^-?\d+\.\d{2},-?\d+\.\d{2},-?\d+\.\d{2},-?\d+\.\d{2}$/);
});

test('isPointInCircle', () => {
    // Center at 13.08, 80.27
    assert.equal(isPointInCircle(13.0801, 80.2701, 13.08, 80.27, 100), true);
    assert.equal(isPointInCircle(13.15, 80.35, 13.08, 80.27, 500), false);
});

test('isPointInPolygon with ray casting', () => {
    // Square polygon in [lat, lon]
    const square = [
        [10, 10],
        [10, 20],
        [20, 20],
        [20, 10]
    ];

    assert.equal(isPointInPolygon(15, 15, square), true);
    assert.equal(isPointInPolygon(5, 5, square), false);
    assert.equal(isPointInPolygon(25, 25, square), false);
});

test('segmentsIntersect', () => {
    // Segments [lon, lat] crossing like an X
    const p1 = [0, 0];
    const p2 = [2, 2];
    const p3 = [0, 2];
    const p4 = [2, 0];
    assert.equal(segmentsIntersect(p1, p2, p3, p4), true);

    // Parallel segments
    const p5 = [0, 1];
    const p6 = [2, 1];
    assert.equal(segmentsIntersect(p1, p2, p5, p6), true); // intersects p1-p2 at [1,1]

    const p7 = [0, 3];
    const p8 = [2, 3];
    assert.equal(segmentsIntersect(p1, p2, p7, p8), false);
});

test('polylineIntersectsPolygon', () => {
    const polygon = [
        [12, 80],
        [12, 81],
        [14, 81],
        [14, 80]
    ];

    // Polyline passing through polygon
    const crossingLine = [
        [11, 80.5],
        [15, 80.5]
    ];
    assert.equal(polylineIntersectsPolygon(crossingLine, polygon), true);

    // Polyline completely outside
    const outsideLine = [
        [10, 70],
        [10, 71]
    ];
    assert.equal(polylineIntersectsPolygon(outsideLine, polygon), false);
});

test('polylineIntersectsCircle', () => {
    // Circle at 13.0, 80.0 radius 1000m (~1km)
    const lineAcross = [
        [12.98, 80.0],
        [13.02, 80.0]
    ];
    assert.equal(polylineIntersectsCircle(lineAcross, 13.0, 80.0, 1000), true);

    const farLine = [
        [14.0, 80.0],
        [14.1, 80.0]
    ];
    assert.equal(polylineIntersectsCircle(farLine, 13.0, 80.0, 1000), false);
});

test('formatDistance and formatDuration', () => {
    assert.equal(formatDistance(450), '450 m');
    assert.equal(formatDistance(3250), '3.3 km');
    assert.equal(formatDuration(45), '1 min');
    assert.equal(formatDuration(900), '15 min');
    assert.equal(formatDuration(3600), '1 hr');
    assert.equal(formatDuration(4200), '1 hr 10 min');
});
