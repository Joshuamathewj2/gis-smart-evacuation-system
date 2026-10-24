/**
 * Open-Meteo Weather API Integration (Free, No Key Required).
 * Provides current conditions, hourly alerts, and disaster risk indicators.
 */

export const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';

/**
 * Fetches real-time weather and forecast for given coordinates.
 * @param {number} lat 
 * @param {number} lon 
 * @param {number} timeoutMs 
 * @returns {Promise<object|null>}
 */
export async function fetchWeather(lat, lon, timeoutMs = 6000) {
    const url = `${OPEN_METEO_URL}?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,rain,weather_code,wind_speed_10m,wind_gusts_10m&hourly=precipitation_probability,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max&timezone=auto`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);

        if (res.ok) {
            const data = await res.json();
            return parseWeatherData(data);
        }
    } catch (err) {
        clearTimeout(timer);
        console.warn('Weather fetch failed:', err.message);
    }
    return null;
}

/**
 * Parses and augments raw Open-Meteo weather response.
 * @param {object} raw 
 * @returns {object}
 */
export function parseWeatherData(raw) {
    if (!raw || !raw.current) return null;

    const current = raw.current;
    const weatherInfo = interpretWmoWeatherCode(current.weather_code);
    const windSpeed = current.wind_speed_10m || 0;
    const windGusts = current.wind_gusts_10m || 0;
    const precipitation = current.precipitation || 0;

    // Detect high risk weather conditions
    const alerts = [];
    if (windGusts >= 60 || windSpeed >= 45) {
        alerts.push({
            type: 'cyclone',
            severity: 'critical',
            message: `Severe Gale / Cyclone Winds: Gusts reaching ${windGusts} km/h`
        });
    } else if (windGusts >= 40) {
        alerts.push({
            type: 'wind',
            severity: 'warning',
            message: `High Wind Advisory: Gusts up to ${windGusts} km/h`
        });
    }

    if (precipitation >= 15) {
        alerts.push({
            type: 'flood',
            severity: 'critical',
            message: `Extreme Rainfall (${precipitation} mm/h): High Flash Flood Danger`
        });
    } else if (precipitation >= 5) {
        alerts.push({
            type: 'rain',
            severity: 'warning',
            message: `Heavy Rain Active (${precipitation} mm/h)`
        });
    }

    if (current.temperature_2m >= 40) {
        alerts.push({
            type: 'heat',
            severity: 'warning',
            message: `Extreme Heat Warning: ${current.temperature_2m}°C`
        });
    }

    return {
        temperature: Math.round(current.temperature_2m),
        apparentTemperature: Math.round(current.apparent_temperature),
        humidity: current.relative_humidity_2m,
        precipitation: precipitation,
        windSpeed: Math.round(windSpeed),
        windGusts: Math.round(windGusts),
        weatherCode: current.weather_code,
        condition: weatherInfo.label,
        icon: weatherInfo.icon,
        alerts
    };
}

/**
 * Maps WMO weather code to icon and readable description.
 * @param {number} code 
 * @returns {{ label: string, icon: string }}
 */
export function interpretWmoWeatherCode(code) {
    switch (code) {
        case 0:
            return { label: 'Clear Sky', icon: '☀️' };
        case 1:
        case 2:
            return { label: 'Partly Cloudy', icon: '🌤️' };
        case 3:
            return { label: 'Overcast', icon: '☁️' };
        case 45:
        case 48:
            return { label: 'Fog / Reduced Visibility', icon: '🌫️' };
        case 51:
        case 53:
        case 55:
            return { label: 'Drizzle', icon: '🌦️' };
        case 61:
        case 63:
            return { label: 'Moderate Rain', icon: '🌧️' };
        case 65:
            return { label: 'Heavy Torrential Rain', icon: '⛈️' };
        case 71:
        case 73:
        case 75:
            return { label: 'Snowfall', icon: '🌨️' };
        case 80:
        case 81:
        case 82:
            return { label: 'Rain Showers', icon: '🌧️' };
        case 95:
        case 96:
        case 99:
            return { label: 'Severe Thunderstorm', icon: '⚡' };
        default:
            return { label: 'Cloudy', icon: '🌥️' };
    }
}
