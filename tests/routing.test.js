import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createStraightLineFallback,
    estimateDuration,
    parseRouteSteps
} from '../js/routing.js';

test('createStraightLineFallback sets fallback flags and sensible distances', () => {
    const route = createStraightLineFallback(13.0827, 80.2707, 13.0800, 80.2750, 'driving');
    assert.equal(route.isFallback, true);
    assert.equal(route.profile, 'driving');
    assert.ok(route.distanceMeters > 500 && route.distanceMeters < 1200);
    assert.ok(route.durationSeconds > 30);
    assert.equal(route.coordinates.length, 2);
    assert.equal(route.steps.length, 2);
});

test('estimateDuration gives higher duration for foot than driving', () => {
    const drivingTime = estimateDuration(13.08, 80.27, 13.10, 80.29, 'driving');
    const footTime = estimateDuration(13.08, 80.27, 13.10, 80.29, 'foot');

    assert.ok(footTime > drivingTime * 4, `Foot time: ${footTime}, Driving time: ${drivingTime}`);
});

test('parseRouteSteps formats step maneuvers with icons', () => {
    const rawSteps = [
        {
            name: 'Mount Road',
            distance: 400,
            duration: 60,
            maneuver: { type: 'depart', modifier: 'straight' }
        },
        {
            name: 'Poonamallee High Rd',
            distance: 800,
            duration: 120,
            maneuver: { type: 'turn', modifier: 'right' }
        },
        {
            name: '',
            distance: 0,
            duration: 0,
            maneuver: { type: 'arrive' }
        }
    ];

    const parsed = parseRouteSteps(rawSteps);
    assert.equal(parsed.length, 3);
    assert.ok(parsed[0].instruction.includes('Mount Road'));
    assert.equal(parsed[1].icon, '➡️');
    assert.ok(parsed[1].instruction.includes('Turn right'));
    assert.equal(parsed[2].icon, '🏁');
    assert.ok(parsed[2].instruction.includes('Arrive'));
});
