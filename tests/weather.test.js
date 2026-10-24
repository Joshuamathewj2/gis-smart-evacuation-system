import test from 'node:test';
import assert from 'node:assert/strict';
import {
    interpretWmoWeatherCode,
    parseWeatherData
} from '../js/weather.js';

test('interpretWmoWeatherCode maps WMO weather codes to conditions and icons', () => {
    const clear = interpretWmoWeatherCode(0);
    assert.equal(clear.label, 'Clear Sky');
    assert.equal(clear.icon, '☀️');

    const heavyRain = interpretWmoWeatherCode(65);
    assert.equal(heavyRain.label, 'Heavy Torrential Rain');
    assert.equal(heavyRain.icon, '⛈️');

    const storm = interpretWmoWeatherCode(95);
    assert.equal(storm.label, 'Severe Thunderstorm');
    assert.equal(storm.icon, '⚡');
});

test('parseWeatherData detects cyclone wind gusts and flash flood rainfall', () => {
    const stormData = {
        current: {
            temperature_2m: 29.5,
            apparent_temperature: 34.0,
            relative_humidity_2m: 88,
            precipitation: 25.0, // mm/h -> extreme flash flood danger
            weather_code: 95,
            wind_speed_10m: 50.0,
            wind_gusts_10m: 75.0 // -> severe cyclone gale
        }
    };

    const parsed = parseWeatherData(stormData);
    assert.ok(parsed);
    assert.equal(parsed.temperature, 30);
    assert.equal(parsed.precipitation, 25.0);
    assert.ok(parsed.alerts.some(a => a.type === 'cyclone' && a.severity === 'critical'));
    assert.ok(parsed.alerts.some(a => a.type === 'flood' && a.severity === 'critical'));
});
