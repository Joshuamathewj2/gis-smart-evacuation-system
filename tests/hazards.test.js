import test from 'node:test';
import assert from 'node:assert/strict';
import {
    isFacilityInHazard,
    evaluateFacilityHazard,
    evaluateRouteHazard
} from '../js/hazards.js';

test('isFacilityInHazard detects circle and polygon inclusions', () => {
    const facilityInside = { lat: 13.08, lon: 80.27 };
    const facilityOutside = { lat: 13.20, lon: 80.40 };

    const hazardCircle = {
        id: 'h1',
        type: 'circle',
        centerLat: 13.08,
        centerLon: 80.27,
        radiusMeters: 500
    };

    assert.equal(isFacilityInHazard(facilityInside, hazardCircle), true);
    assert.equal(isFacilityInHazard(facilityOutside, hazardCircle), false);

    const hazardPolygon = {
        id: 'h2',
        type: 'polygon',
        coordinates: [
            [13.07, 80.26],
            [13.07, 80.28],
            [13.09, 80.28],
            [13.09, 80.26]
        ]
    };

    assert.equal(isFacilityInHazard(facilityInside, hazardPolygon), true);
    assert.equal(isFacilityInHazard(facilityOutside, hazardPolygon), false);
});

test('evaluateFacilityHazard calculates distance to nearest hazard boundary', () => {
    const facility = { lat: 13.08, lon: 80.27 };

    // Hazard circle 1km away
    const hazardCircle = {
        id: 'h1',
        type: 'circle',
        centerLat: 13.09,
        centerLon: 80.27,
        radiusMeters: 200
    };

    const result = evaluateFacilityHazard(facility, [hazardCircle]);
    assert.equal(result.inHazard, false);
    assert.ok(result.nearestHazardDistance > 500 && result.nearestHazardDistance < 1500);
});

test('evaluateRouteHazard flags polylines crossing hazard perimeter', () => {
    const routeCoords = [
        [13.00, 80.20],
        [13.10, 80.20]
    ];

    const hazard = {
        id: 'h1',
        type: 'circle',
        centerLat: 13.05,
        centerLon: 80.20,
        radiusMeters: 1000
    };

    const evalResult = evaluateRouteHazard(routeCoords, [hazard]);
    assert.equal(evalResult.intersects, true);
    assert.equal(evalResult.intersectingHazards.length, 1);

    // Far away route
    const clearRouteCoords = [
        [12.50, 80.00],
        [12.55, 80.00]
    ];
    const clearResult = evaluateRouteHazard(clearRouteCoords, [hazard]);
    assert.equal(clearResult.intersects, false);
});
