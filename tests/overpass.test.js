import test from 'node:test';
import assert from 'node:assert/strict';
import {
    detectFacilityType,
    normalizeOsmFacility,
    buildOverpassQuery,
    parseOverpassElements
} from '../js/overpass.js';

test('detectFacilityType handles various OSM tags', () => {
    assert.equal(detectFacilityType({ amenity: 'hospital' }), 'hospital');
    assert.equal(detectFacilityType({ amenity: 'clinic' }), 'clinic');
    assert.equal(detectFacilityType({ amenity: 'school' }), 'school');
    assert.equal(detectFacilityType({ amenity: 'university' }), 'college');
    assert.equal(detectFacilityType({ amenity: 'community_centre' }), 'community_centre');
    assert.equal(detectFacilityType({ emergency: 'assembly_point' }), 'assembly_point');
    assert.equal(detectFacilityType({ amenity: 'fire_station' }), 'fire_station');
    assert.equal(detectFacilityType({ amenity: 'police' }), 'police');
    assert.equal(detectFacilityType({ type: 'hospital' }), 'hospital'); // GeoJSON legacy
});

test('normalizeOsmFacility parses OSM node', () => {
    const rawNode = {
        type: 'node',
        id: 12345,
        lat: 13.0827,
        lon: 80.2707,
        tags: {
            name: 'City General Hospital',
            amenity: 'hospital',
            capacity: '500',
            phone: '+91 44 12345678'
        }
    };

    const parsed = normalizeOsmFacility(rawNode);
    assert.ok(parsed);
    assert.equal(parsed.id, 'node_12345');
    assert.equal(parsed.name, 'City General Hospital');
    assert.equal(parsed.type, 'hospital');
    assert.equal(parsed.lat, 13.0827);
    assert.equal(parsed.lon, 80.2707);
    assert.equal(parsed.capacity, 500);
    assert.equal(parsed.phone, '+91 44 12345678');
});

test('normalizeOsmFacility parses OSM way with center', () => {
    const rawWay = {
        type: 'way',
        id: 98765,
        center: { lat: 13.0850, lon: 80.2750 },
        tags: {
            name: 'Central High School',
            amenity: 'school',
            'building:levels': '3'
        }
    };

    const parsed = normalizeOsmFacility(rawWay);
    assert.ok(parsed);
    assert.equal(parsed.id, 'way_98765');
    assert.equal(parsed.name, 'Central High School');
    assert.equal(parsed.type, 'school');
    assert.equal(parsed.lat, 13.0850);
    assert.equal(parsed.lon, 80.2750);
    assert.equal(parsed.levels, 3);
});

test('normalizeOsmFacility parses GeoJSON feature', () => {
    const feature = {
        type: 'Feature',
        properties: {
            name: 'Govt General Hospital',
            type: 'hospital',
            capacity: 1000,
            status: 'available'
        },
        geometry: {
            type: 'Point',
            coordinates: [80.2750, 13.0800]
        }
    };

    const parsed = normalizeOsmFacility(feature, 'geojson');
    assert.ok(parsed);
    assert.equal(parsed.name, 'Govt General Hospital');
    assert.equal(parsed.type, 'hospital');
    assert.equal(parsed.lat, 13.0800);
    assert.equal(parsed.lon, 80.2750);
    assert.equal(parsed.capacity, 1000);
});

test('buildOverpassQuery constructs valid Overpass QL with clamped radius', () => {
    const query = buildOverpassQuery(13.08, 80.27, 4000);
    assert.ok(query.includes('around:4000,13.08,80.27'));
    assert.match(query, /nwr\["amenity"~"\^\([^)]*\bhospital\b[^)]*\)\$"\]/);
    assert.match(query, /nwr\["emergency"~"\^\([^)]*\bassembly_point\b[^)]*\)\$"\]/);
    assert.ok(query.includes('out center tags;'));
    // Two scans, not one per tag.
    assert.equal((query.match(/around:/g) || []).length, 2);
    assert.ok(buildOverpassQuery(13.08, 80.27, 999999).includes('around:50000,'));
});

test('parseOverpassElements dedupes and filters invalid elements', () => {
    const elements = [
        { type: 'node', id: 1, lat: 13.0, lon: 80.0, tags: { name: 'A', amenity: 'school' } },
        { type: 'node', id: 1, lat: 13.0, lon: 80.0, tags: { name: 'A duplicate', amenity: 'school' } },
        { type: 'node', id: 2, tags: { name: 'Missing lat/lon' } }
    ];

    const result = parseOverpassElements(elements);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'node_1');
});
