import test from 'node:test';
import assert from 'node:assert/strict';
import {
    calculateFacilitySuitability,
    calculateTravelTimeScore,
    calculateSafetyScore,
    rankFacilities
} from '../js/ranking.js';

test('calculateFacilitySuitability favors multi-story schools for floods and assembly points for earthquakes', () => {
    const multiStorySchool = { type: 'school', levels: 3, capacity: 500 };
    const assemblyPoint = { type: 'assembly_point', levels: 1, capacity: 500 };

    const floodSchool = calculateFacilitySuitability(multiStorySchool, 'flood');
    const floodAssembly = calculateFacilitySuitability(assemblyPoint, 'flood');
    assert.ok(floodSchool.score > floodAssembly.score, `Flood: School (${floodSchool.score}) should beat Assembly (${floodAssembly.score})`);

    const quakSchool = calculateFacilitySuitability(multiStorySchool, 'earthquake');
    const quakAssembly = calculateFacilitySuitability(assemblyPoint, 'earthquake');
    assert.ok(quakAssembly.score > quakSchool.score, `Earthquake: Assembly (${quakAssembly.score}) should beat School (${quakSchool.score})`);
});

test('calculateTravelTimeScore awards high score for quick trips and decays with time', () => {
    const score3min = calculateTravelTimeScore(180, 'driving');
    const score15min = calculateTravelTimeScore(900, 'driving');
    const score60min = calculateTravelTimeScore(3600, 'driving');

    assert.ok(score3min > 85, `3 min score was ${score3min}`);
    assert.ok(score3min > score15min, '3 min should score higher than 15 min');
    assert.ok(score15min > score60min, '15 min should score higher than 60 min');
});

test('calculateSafetyScore excludes facilities directly inside a hazard zone', () => {
    const facilityInside = { lat: 13.08, lon: 80.27 };
    const hazardCircle = {
        name: 'Flash Flood Zone',
        type: 'circle',
        centerLat: 13.08,
        centerLon: 80.27,
        radiusMeters: 500
    };

    const safety = calculateSafetyScore(facilityInside, [hazardCircle]);
    assert.equal(safety.isExcluded, true);
    assert.equal(safety.score, 0);
    assert.ok(safety.status.includes('DANGER'));
});

test('rankFacilities ranks candidates and demotes or excludes hazards', () => {
    const facilities = [
        { id: 'f1', name: 'Near School', type: 'school', lat: 13.08, lon: 80.27, capacity: 600, levels: 2 },
        { id: 'f2', name: 'Far Hospital', type: 'hospital', lat: 13.12, lon: 80.30, capacity: 1000, levels: 4 },
        { id: 'f3', name: 'Hazard School', type: 'school', lat: 13.09, lon: 80.28, capacity: 400, levels: 2 }
    ];

    const travelDurations = [300, 1800, 400]; // f1: 5min, f2: 30min, f3: ~6.6min

    // Place f3 inside a hazard
    const hazards = [
        {
            name: 'Active Inundation',
            type: 'circle',
            centerLat: 13.09,
            centerLon: 80.28,
            radiusMeters: 200
        }
    ];

    const ranked = rankFacilities({
        userLocation: { lat: 13.07, lon: 80.26 },
        facilities,
        travelDurations,
        disasterType: 'flood',
        hazards,
        profile: 'driving'
    });

    assert.equal(ranked.length, 3);
    // f1 should be rank 1
    assert.equal(ranked[0].id, 'f1');
    assert.equal(ranked[0].rank, 1);
    assert.equal(ranked[0].isExcluded, false);

    // f3 should be excluded at the end
    const f3Result = ranked.find(r => r.id === 'f3');
    assert.equal(f3Result.isExcluded, true);
    assert.equal(f3Result.rank, null);
    assert.equal(f3Result.totalScore, 0);
});

test('rankFacilities with medicalPriority boosts hospitals', () => {
    const facilities = [
        { id: 'f1', name: 'Local School', type: 'school', lat: 13.08, lon: 80.27, capacity: 400 },
        { id: 'f2', name: 'Community Hospital', type: 'hospital', lat: 13.081, lon: 80.271, capacity: 400 }
    ];
    const travelDurations = [300, 310];

    const rankedRegular = rankFacilities({
        userLocation: { lat: 13.08, lon: 80.27 },
        facilities,
        travelDurations,
        disasterType: 'flood'
    });

    const rankedMedical = rankFacilities({
        userLocation: { lat: 13.08, lon: 80.27 },
        facilities,
        travelDurations,
        disasterType: 'flood',
        options: { medicalPriority: true }
    });

    assert.equal(rankedMedical[0].id, 'f2');
});
