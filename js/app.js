/**
 * Main Application Orchestrator for GIS Smart Evacuation Assistant.
 * Coordinates Leaflet Map, Live Overpass Shelters, OSRM Road Routing,
 * Multi-Criteria Ranking, Hazard Drawing, USGS Earthquakes, Open-Meteo Weather,
 * and PWA Offline Persistence.
 */

import { haversineDistance } from './geo.js';
import { fetchLiveShelters } from './overpass.js';
import { fetchOsrmRoute, fetchTravelTimeMatrix } from './routing.js';
import { rankFacilities } from './ranking.js';
import { evaluateRouteHazard, fetchLiveEarthquakes } from './hazards.js';
import { fetchWeather } from './weather.js';
import { saveLastPlan, getLastPlan } from './storage.js';
import { initPWA, sharePlan, decodePlanFromUrl } from './pwa.js';
import {
    showToast,
    updateNetworkStatusBadge,
    renderPrimaryPlan,
    renderRouteSteps,
    renderRankedList,
    renderWeatherWidget,
    setupEmergencyNumbersModal,
    setupThemeToggle
} from './ui.js';

// Application State
const state = {
    userLat: null,
    userLon: null,
    disasterType: 'general',
    profile: 'driving', // 'driving' | 'foot'
    searchRadius: 5000, // meters
    medicalPriority: false,
    facilityTypeFilter: 'all',
    hazards: [], // Array of { id, type, centerLat, centerLon, radiusMeters, coordinates, layer }
    cachedShelters: [],
    rankedFacilities: [],
    activeFacility: null,
    currentRoute: null,
    weather: null,
    earthquakesVisible: false,
    earthquakeLayerGroup: null,
    drawControl: null,
    drawnItems: null,
    userMarker: null,
    facilityMarkersGroup: null,
    routeLayerGroup: null,
    map: null
};

document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

/**
 * Initializes map, UI controls, PWA, and restored state.
 */
async function initApp() {
    setupThemeToggle();
    setupEmergencyNumbersModal();
    initMap();
    setupUIControls();
    setupPWAIntegration();

    // Check URL params or shared state first
    const shared = decodePlanFromUrl();
    if (shared && !isNaN(shared.lat) && !isNaN(shared.lon)) {
        state.disasterType = shared.disaster || 'general';
        state.profile = shared.mode || 'driving';
        updateUIFilterSelections();

        setUserLocation(shared.lat, shared.lon, true);
        showToast('Restored shared evacuation plan', 'info');
        return;
    }

    // Check cached offline plan if user is returning offline
    const lastPlan = getLastPlan();
    if (!navigator.onLine && lastPlan && lastPlan.origin) {
        state.disasterType = lastPlan.disasterType || 'general';
        state.profile = lastPlan.profile || 'driving';
        updateUIFilterSelections();

        setUserLocation(lastPlan.origin.lat, lastPlan.origin.lon, false);
        showToast('Offline mode: Restored last evacuation route', 'warning');
        return;
    }

    // Default starting point: Chennai Central (13.0827, 80.2707) or auto-locate
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                setUserLocation(pos.coords.latitude, pos.coords.longitude, true);
                showToast('Location acquired via GPS', 'success');
            },
            () => {
                // Fallback default coordinates
                setUserLocation(13.0827, 80.2707, true);
            },
            { timeout: 7000 }
        );
    } else {
        setUserLocation(13.0827, 80.2707, true);
    }
}

/**
 * Initializes Leaflet map, tile layer, drawn items layer, and map controls.
 */
function initMap() {
    const mapContainer = document.getElementById('map');
    if (!mapContainer) return;

    // Default center
    state.map = L.map('map', {
        zoomControl: false,
        attributionControl: false
    }).setView([13.0827, 80.2707], 13);

    // Leaflet Zoom Control on bottom-right
    L.control.zoom({ position: 'bottomright' }).addTo(state.map);

    // Standard OSM Tile Layer with attribution
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'
    }).addTo(state.map);

    // Attribution control
    L.control.attribution({ position: 'bottomright', prefix: false })
        .addAttribution('&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OSM</a> | <a href="https://routing.openstreetmap.de/about.html" target="_blank">OSRM / FOSSGIS</a> | <a href="https://open-meteo.com/" target="_blank">Open-Meteo</a>')
        .addTo(state.map);

    // Layer groups for dynamic features
    state.facilityMarkersGroup = L.layerGroup().addTo(state.map);
    state.routeLayerGroup = L.layerGroup().addTo(state.map);
    state.earthquakeLayerGroup = L.layerGroup().addTo(state.map);

    // Leaflet.draw FeatureGroup for user-drawn hazard zones
    state.drawnItems = new L.FeatureGroup();
    state.map.addLayer(state.drawnItems);

    setupLeafletDraw();

    // Map Click -> Set new evacuation origin
    state.map.on('click', (e) => {
        // Prevent click if currently in drawing mode
        if (state.map._drawModeActive) return;
        setUserLocation(e.latlng.lat, e.latlng.lng, false);
        showToast(`Origin set to: ${e.latlng.lat.toFixed(4)}, ${e.latlng.lng.toFixed(4)}`, 'info');
    });
}

/**
 * Sets up Leaflet.draw toolbar and handlers for hazard polygon & circle drawing.
 */
function setupLeafletDraw() {
    if (typeof L.Control.Draw === 'undefined') {
        console.warn('Leaflet.draw not loaded from CDN');
        return;
    }

    state.drawControl = new L.Control.Draw({
        position: 'topright',
        draw: {
            polygon: {
                allowIntersection: false,
                drawError: { color: '#ef4444', message: 'Polygon edges cannot cross!' },
                shapeOptions: {
                    color: '#ef4444',
                    fillColor: '#ef4444',
                    fillOpacity: 0.35,
                    weight: 3
                }
            },
            circle: {
                shapeOptions: {
                    color: '#ef4444',
                    fillColor: '#ef4444',
                    fillOpacity: 0.35,
                    weight: 3
                }
            },
            rectangle: {
                shapeOptions: {
                    color: '#ef4444',
                    fillColor: '#ef4444',
                    fillOpacity: 0.35,
                    weight: 3
                }
            },
            polyline: false,
            marker: false,
            circlemarker: false
        },
        edit: {
            featureGroup: state.drawnItems,
            remove: true
        }
    });

    state.map.addControl(state.drawControl);

    // Event handlers for drawing
    state.map.on(L.Draw.Event.CREATED, (event) => {
        const layer = event.layer;
        const type = event.layerType;
        state.drawnItems.addLayer(layer);

        let hazardObj = null;
        const id = `hazard_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

        if (type === 'circle') {
            const center = layer.getLatLng();
            const radius = layer.getRadius();
            hazardObj = {
                id,
                name: `Hazard Zone (${Math.round(radius)}m buffer)`,
                type: 'circle',
                centerLat: center.lat,
                centerLon: center.lng,
                radiusMeters: radius,
                layer
            };
            layer.bindPopup(`<b>⚠️ Hazard Zone (Circle)</b><br>Radius: ${Math.round(radius)}m<br><i>Facilities inside are excluded</i>`).openPopup();
        } else if (type === 'polygon' || type === 'rectangle') {
            const latLngs = layer.getLatLngs()[0] || layer.getLatLngs();
            const coords = latLngs.map(p => [p.lat, p.lng]);
            hazardObj = {
                id,
                name: 'Hazard Zone (Perimeter)',
                type: 'polygon',
                coordinates: coords,
                layer
            };
            layer.bindPopup('<b>⚠️ Hazard Zone (Polygon)</b><br><i>Facilities inside excluded; routes crossing penalized</i>').openPopup();
        }

        if (hazardObj) {
            state.hazards.push(hazardObj);
            showToast('⚠️ Hazard zone recorded. Re-evaluating routes...', 'warning');
            recalculateEvacuationPlan();
        }
    });

    state.map.on(L.Draw.Event.DELETED, (event) => {
        const layers = event.layers;
        layers.eachLayer(layer => {
            state.hazards = state.hazards.filter(h => h.layer !== layer);
        });
        showToast('Hazard zone removed. Updating plan...', 'info');
        recalculateEvacuationPlan();
    });

    state.map.on(L.Draw.Event.EDITED, () => {
        // Update all hazard coordinates
        for (const h of state.hazards) {
            if (h.type === 'circle' && h.layer) {
                const c = h.layer.getLatLng();
                h.centerLat = c.lat;
                h.centerLon = c.lng;
                h.radiusMeters = h.layer.getRadius();
            } else if (h.type === 'polygon' && h.layer) {
                const latLngs = h.layer.getLatLngs()[0] || h.layer.getLatLngs();
                h.coordinates = latLngs.map(p => [p.lat, p.lng]);
            }
        }
        showToast('Hazard zones modified. Updating plan...', 'info');
        recalculateEvacuationPlan();
    });
}

/**
 * Sets user origin location and triggers full evaluation pipeline.
 * @param {number} lat 
 * @param {number} lon 
 * @param {boolean} panMap 
 */
export async function setUserLocation(lat, lon, panMap = true) {
    state.userLat = lat;
    state.userLon = lon;

    // Update user marker
    if (state.userMarker) {
        state.userMarker.setLatLng([lat, lon]);
    } else {
        const userIcon = L.divIcon({
            className: 'user-origin-marker',
            html: `
                <div style="
                    width: 22px;
                    height: 22px;
                    background: #10b981;
                    border: 3px solid #ffffff;
                    border-radius: 50%;
                    box-shadow: 0 0 14px rgba(16, 185, 129, 0.9);
                    animation: pulse 1.8s infinite;
                "></div>
            `,
            iconSize: [24, 24],
            iconAnchor: [12, 12]
        });

        state.userMarker = L.marker([lat, lon], {
            icon: userIcon,
            zIndexOffset: 1000,
            title: 'Your Evacuation Origin'
        }).bindPopup('<b>📍 Your Evacuation Origin</b><br>Click anywhere on the map to change.');

        state.userMarker.addTo(state.map);
    }

    if (panMap) {
        state.map.setView([lat, lon], 14);
    }

    // Refresh weather asynchronously for user coordinates
    updateWeatherAsync(lat, lon);

    // Run evacuation search & routing
    await recalculateEvacuationPlan();
}

/**
 * Performs full pipeline: Overpass shelters query -> travel time matrix -> ranking -> primary route.
 */
export async function recalculateEvacuationPlan() {
    if (state.userLat == null || state.userLon == null) return;

    const primaryPlanContainer = document.getElementById('primaryPlanContainer');
    const rankedListContainer = document.getElementById('rankedListContainer');
    const routeStepsContainer = document.getElementById('routeStepsContainer');

    if (primaryPlanContainer) {
        primaryPlanContainer.innerHTML = `
            <div class="ui-card" style="text-align: center; padding: 1.5rem;">
                <div style="font-size: 1.8rem; animation: spin 1s linear infinite;">⏳</div>
                <div style="font-weight: 700; margin-top: 0.5rem;">Analyzing Safe Evacuation Routes...</div>
                <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 4px;">
                    Querying OSM facilities, checking hazard zones, and calculating road travel times.
                </div>
            </div>
        `;
    }

    try {
        // 1. Fetch live shelter facilities from OSM Overpass (or cache / offline fallback)
        let shelters = await fetchLiveShelters(state.userLat, state.userLon, state.searchRadius);
        const usingBundledData = shelters.length > 0 && shelters.every(s => s.source === 'bundled-offline');
        updateNetworkStatusBadge(navigator.onLine, usingBundledData);
        if (usingBundledData) {
            showToast('Live map data is unreachable right now. Showing the bundled shelter list, which may be incomplete.', 'warning');
        }

        // Apply facility type filter if selected
        if (state.facilityTypeFilter && state.facilityTypeFilter !== 'all') {
            shelters = shelters.filter(s => s.type === state.facilityTypeFilter);
        }

        if (shelters.length === 0) {
            showToast('No shelters found in this radius. Try increasing the search radius.', 'warning');
            renderPrimaryPlan({
                plan: null,
                container: primaryPlanContainer,
                onPrint: () => window.print(),
                onShare: () => {}
            });
            if (rankedListContainer) rankedListContainer.innerHTML = '';
            if (routeStepsContainer) routeStepsContainer.innerHTML = '';
            return;
        }

        state.cachedShelters = shelters;

        // 2. Select top N candidate facilities by straight distance for road matrix query (top 8)
        shelters.forEach(s => {
            s.straightDistance = haversineDistance(state.userLat, state.userLon, s.lat, s.lon);
        });
        shelters.sort((a, b) => a.straightDistance - b.straightDistance);

        const candidates = shelters.slice(0, 10);

        // 3. Batch query travel time matrix via OSRM Table Service
        const durations = await fetchTravelTimeMatrix(
            state.userLat,
            state.userLon,
            candidates,
            state.profile
        );

        // 4. Multi-criteria ranking with hazard exclusion and suitability weights
        const ranked = rankFacilities({
            userLocation: { lat: state.userLat, lon: state.userLon },
            facilities: candidates,
            travelDurations: durations,
            disasterType: state.disasterType,
            hazards: state.hazards,
            profile: state.profile,
            options: { medicalPriority: state.medicalPriority }
        });

        state.rankedFacilities = ranked;

        // Pick top valid recommendation (or previously active facility if still in list)
        let primaryCandidate = ranked.find(r => !r.isExcluded) || ranked[0];
        if (state.activeFacility) {
            const stillExists = ranked.find(r => r.id === state.activeFacility.id && !r.isExcluded);
            if (stillExists) primaryCandidate = stillExists;
        }

        await selectFacilityRoute(primaryCandidate, false);

        // Render markers for all candidate facilities on map
        renderFacilityMarkers(ranked);

        // Render ranked alternatives list
        renderRankedList({
            rankedFacilities: ranked,
            activeFacilityId: state.activeFacility?.id,
            container: rankedListContainer,
            onSelectFacility: (fac) => selectFacilityRoute(fac, true)
        });

    } catch (err) {
        console.error('Evacuation calculation error:', err);
        showToast('Error calculating evacuation route: ' + err.message, 'danger');
    }
}

/**
 * Calculates road route to specific facility, updates route polylines, and updates UI panels.
 * @param {object} facility 
 * @param {boolean} panToRoute 
 */
export async function selectFacilityRoute(facility, panToRoute = true) {
    if (!facility) return;

    state.activeFacility = facility;

    // Fetch road route via OSRM (or straight line fallback)
    const route = await fetchOsrmRoute(
        state.userLat,
        state.userLon,
        facility.lat,
        facility.lon,
        state.profile
    );

    // Check if route intersects any active hazard zone
    const hazardCheck = evaluateRouteHazard(route.coordinates, state.hazards);
    route.routeCrossesHazard = hazardCheck.intersects;
    route.intersectingHazards = hazardCheck.intersectingHazards;

    state.currentRoute = route;

    const plan = {
        origin: { lat: state.userLat, lon: state.userLon },
        destination: facility,
        distanceMeters: route.distanceMeters,
        durationSeconds: route.durationSeconds,
        profile: state.profile,
        disasterType: state.disasterType,
        isFallback: route.isFallback,
        routeCrossesHazard: route.routeCrossesHazard,
        steps: route.steps,
        suitabilityReason: facility.suitabilityReason,
        safetyStatus: facility.safetyStatus
    };

    // Save plan to localStorage for offline reload
    saveLastPlan(plan);

    // Draw route on map
    drawRouteOnMap(route, panToRoute);

    // Render primary plan card
    const primaryPlanContainer = document.getElementById('primaryPlanContainer');
    renderPrimaryPlan({
        plan,
        container: primaryPlanContainer,
        onPrint: () => window.print(),
        onShare: () => sharePlan(plan, showToast)
    });

    // Render turn-by-turn steps
    const routeStepsContainer = document.getElementById('routeStepsContainer');
    renderRouteSteps(route.steps, routeStepsContainer, route.isFallback);

    // Highlight active card in ranked list
    const rankedListContainer = document.getElementById('rankedListContainer');
    if (rankedListContainer) {
        rankedListContainer.querySelectorAll('.shelter-card').forEach(card => {
            const isMatch = card.getAttribute('data-facility-id') === facility.id;
            card.classList.toggle('active', isMatch);
            card.setAttribute('aria-pressed', isMatch ? 'true' : 'false');
        });
    }
}

/**
 * Visualizes road route polyline on Leaflet map with hazard styling.
 * @param {object} route 
 * @param {boolean} fitBounds 
 */
function drawRouteOnMap(route, fitBounds = true) {
    state.routeLayerGroup.clearLayers();

    if (!route || !route.coordinates || route.coordinates.length < 2) return;

    // Stylize route line:
    // If route crosses hazard: flashing dashed warning line
    // If fallback: dashed amber line
    // Safe route: bold emergency red/blue line with glow casing
    const crossesHazard = Boolean(route.routeCrossesHazard);
    const isFallback = Boolean(route.isFallback);

    let routeColor = '#0284c7'; // clean road blue
    let dashArray = null;

    if (crossesHazard) {
        routeColor = '#ef4444'; // critical red
        dashArray = '8, 8';
    } else if (isFallback) {
        routeColor = '#f59e0b'; // amber approximate
        dashArray = '6, 6';
    }

    // Outer casing line for high contrast
    const casing = L.polyline(route.coordinates, {
        color: '#000000',
        weight: 8,
        opacity: 0.6
    });

    // Inner route line
    const polyline = L.polyline(route.coordinates, {
        color: routeColor,
        weight: 5,
        opacity: 0.95,
        dashArray: dashArray,
        lineJoin: 'round'
    });

    state.routeLayerGroup.addLayer(casing);
    state.routeLayerGroup.addLayer(polyline);

    if (fitBounds && state.map) {
        state.map.fitBounds(polyline.getBounds(), { padding: [50, 50], maxZoom: 16 });
    }
}

/**
 * Renders marker pins for candidate shelters with custom color coding and popups.
 * @param {Array<object>} facilities 
 */
function renderFacilityMarkers(facilities = []) {
    state.facilityMarkersGroup.clearLayers();

    for (const fac of facilities) {
        const isExcluded = Boolean(fac.isExcluded);
        const isActive = state.activeFacility && state.activeFacility.id === fac.id;

        let markerColor = '#0284c7';
        if (isExcluded) {
            markerColor = '#64748b'; // greyed out
        } else if (fac.type === 'hospital') {
            markerColor = '#ef4444';
        } else if (fac.type === 'assembly_point') {
            markerColor = '#10b981';
        }

        const iconHtml = `
            <div style="
                background-color: ${markerColor};
                color: #ffffff;
                width: 28px;
                height: 28px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 13px;
                border: 2px solid #ffffff;
                box-shadow: 0 2px 8px rgba(0,0,0,0.4);
                cursor: pointer;
                ${isActive ? 'transform: scale(1.25); border-color: #f59e0b; box-shadow: 0 0 12px #f59e0b;' : ''}
            ">
                ${fac.type === 'hospital' ? '🏥' : fac.type === 'school' ? '🏫' : fac.type === 'assembly_point' ? '⛳' : '🏢'}
            </div>
        `;

        const icon = L.divIcon({
            html: iconHtml,
            className: 'facility-div-marker',
            iconSize: [28, 28],
            iconAnchor: [14, 14]
        });

        const marker = L.marker([fac.lat, fac.lon], { icon, title: fac.name });

        marker.bindPopup(`
            <div style="font-family: system-ui, sans-serif; font-size: 0.85rem;">
                <div style="font-weight: 700; margin-bottom: 4px;">${fac.name}</div>
                <div style="color: #64748b; font-size: 0.78rem;">Type: ${fac.type}</div>
                <div style="font-weight: 600; margin-top: 4px; color: ${isExcluded ? '#ef4444' : '#10b981'};">
                    ${isExcluded ? '⛔ Excluded: Inside Hazard' : `Score: ${fac.totalScore}/100`}
                </div>
                ${!isExcluded ? `
                    <button type="button" style="
                        margin-top: 8px;
                        background: #d32f2f;
                        color: #fff;
                        border: none;
                        padding: 4px 10px;
                        border-radius: 4px;
                        cursor: pointer;
                        font-weight: 600;
                    " onclick="window.__selectEvacFacility('${fac.id}')">
                        Route to this shelter
                    </button>
                ` : ''}
            </div>
        `);

        state.facilityMarkersGroup.addLayer(marker);
    }
}

// Global hook for popup routing button
window.__selectEvacFacility = (facilityId) => {
    const target = state.rankedFacilities.find(f => f.id === facilityId);
    if (target && !target.isExcluded) {
        selectFacilityRoute(target, true);
    }
};

/**
 * Updates weather asynchronously via Open-Meteo.
 * @param {number} lat 
 * @param {number} lon 
 */
async function updateWeatherAsync(lat, lon) {
    const weatherContainer = document.getElementById('weatherWidgetContainer');
    try {
        const weather = await fetchWeather(lat, lon);
        state.weather = weather;
        renderWeatherWidget(weather, weatherContainer);
    } catch (e) {
        console.warn('Weather update failed', e);
    }
}

/**
 * Toggles live USGS earthquake layer.
 */
export async function toggleEarthquakesLayer() {
    state.earthquakesVisible = !state.earthquakesVisible;
    const btn = document.getElementById('btnToggleEarthquakes');
    if (btn) btn.classList.toggle('active', state.earthquakesVisible);

    if (!state.earthquakesVisible) {
        state.earthquakeLayerGroup.clearLayers();
        showToast('Earthquakes layer hidden', 'info');
        return;
    }

    showToast('Loading live earthquakes (USGS M2.5+)...', 'info');

    try {
        const quakes = await fetchLiveEarthquakes();
        state.earthquakeLayerGroup.clearLayers();

        for (const eq of quakes) {
            const mag = eq.magnitude;
            const radius = Math.max(5, mag * 3);
            const color = mag >= 5.0 ? '#ef4444' : mag >= 4.0 ? '#f59e0b' : '#38bdf8';

            const marker = L.circleMarker([eq.lat, eq.lon], {
                radius: radius,
                fillColor: color,
                color: '#ffffff',
                weight: 1.5,
                opacity: 0.9,
                fillOpacity: 0.65
            });

            marker.bindPopup(`
                <b>Magnitude ${mag.toFixed(1)} Earthquake</b><br>
                ${eq.place}<br>
                Depth: ${eq.depthKm} km<br>
                Time: ${eq.time.toLocaleString()}<br>
                ${eq.tsunamiAlert ? '<b style="color:red;">⚠️ TSUNAMI WARNING</b><br>' : ''}
                <a href="${eq.url}" target="_blank" rel="noopener">USGS Details</a>
            `);

            state.earthquakeLayerGroup.addLayer(marker);
        }

        showToast(`Displaying ${quakes.length} earthquakes worldwide`, 'success');
    } catch (e) {
        console.warn('Earthquake feed failed:', e);
        showToast('Failed to load USGS earthquake feed', 'warning');
    }
}

/**
 * Sets up all input controls, Nominatim search with debounce, pills, buttons, and mobile drawer.
 */
function setupUIControls() {
    // 1. Geolocation button
    const locateBtn = document.getElementById('btnLocateMe');
    if (locateBtn) {
        locateBtn.addEventListener('click', () => {
            if (navigator.geolocation) {
                locateBtn.textContent = 'Locating...';
                navigator.geolocation.getCurrentPosition(
                    (pos) => {
                        locateBtn.innerHTML = '🎯 Locate Me';
                        setUserLocation(pos.coords.latitude, pos.coords.longitude, true);
                        showToast('Updated to current GPS position', 'success');
                    },
                    (err) => {
                        locateBtn.innerHTML = '🎯 Locate Me';
                        showToast('Geolocation permission denied or timed out', 'warning');
                    },
                    { timeout: 8000 }
                );
            }
        });
    }

    // 2. Nominatim Address Search with debounce
    setupAddressSearch();

    // 3. Disaster Type Selector Pills
    const disasterPills = document.querySelectorAll('.disaster-pills .pill-btn');
    disasterPills.forEach(pill => {
        pill.addEventListener('click', () => {
            disasterPills.forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            state.disasterType = pill.getAttribute('data-disaster') || 'general';
            showToast(`Disaster mode: ${state.disasterType.toUpperCase()}`, 'info');
            recalculateEvacuationPlan();
        });
    });

    // 4. Travel Profile Selector (Driving / Foot)
    const profileSelect = document.getElementById('travelProfileSelect');
    if (profileSelect) {
        profileSelect.addEventListener('change', (e) => {
            state.profile = e.target.value;
            showToast(`Mode: ${state.profile === 'foot' ? 'Walking (Foot)' : 'Driving (Road)'}`, 'info');
            recalculateEvacuationPlan();
        });
    }

    // 5. Search Radius Selector
    const radiusSelect = document.getElementById('searchRadiusSelect');
    if (radiusSelect) {
        radiusSelect.addEventListener('change', (e) => {
            state.searchRadius = parseInt(e.target.value, 10);
            showToast(`Search radius: ${state.searchRadius / 1000} km`, 'info');
            recalculateEvacuationPlan();
        });
    }

    // 6. Medical Priority Checkbox
    const medPriorityCheck = document.getElementById('medicalPriorityCheck');
    if (medPriorityCheck) {
        medPriorityCheck.addEventListener('change', (e) => {
            state.medicalPriority = e.target.checked;
            showToast(state.medicalPriority ? 'Medical emergency priority activated' : 'Standard priority', 'info');
            recalculateEvacuationPlan();
        });
    }

    // 7. Facility Type Filter
    const typeFilter = document.getElementById('facilityTypeFilter');
    if (typeFilter) {
        typeFilter.addEventListener('change', (e) => {
            state.facilityTypeFilter = e.target.value;
            recalculateEvacuationPlan();
        });
    }

    // 8. Floating map action buttons
    const btnDrawPolygon = document.getElementById('btnDrawPolygon');
    if (btnDrawPolygon) {
        btnDrawPolygon.addEventListener('click', () => {
            if (state.drawControl) {
                new L.Draw.Polygon(state.map, state.drawControl.options.draw.polygon).enable();
                showToast('Click points on map to draw hazard polygon. Click first point to close.', 'info');
            }
        });
    }

    const btnDrawCircle = document.getElementById('btnDrawCircle');
    if (btnDrawCircle) {
        btnDrawCircle.addEventListener('click', () => {
            if (state.drawControl) {
                new L.Draw.Circle(state.map, state.drawControl.options.draw.circle).enable();
                showToast('Click and drag on map to draw circular hazard buffer.', 'info');
            }
        });
    }

    const btnClearHazards = document.getElementById('btnClearHazards');
    if (btnClearHazards) {
        btnClearHazards.addEventListener('click', () => {
            if (state.drawnItems) {
                state.drawnItems.clearLayers();
                state.hazards = [];
                showToast('Cleared all custom hazard zones', 'info');
                recalculateEvacuationPlan();
            }
        });
    }

    const btnEarthquakes = document.getElementById('btnToggleEarthquakes');
    if (btnEarthquakes) {
        btnEarthquakes.addEventListener('click', () => toggleEarthquakesLayer());
    }

    const btnRecenter = document.getElementById('btnRecenter');
    if (btnRecenter) {
        btnRecenter.addEventListener('click', () => {
            if (state.userLat != null && state.userLon != null) {
                state.map.setView([state.userLat, state.userLon], 14);
            }
        });
    }

    // 9. Mobile drawer toggle button
    const drawerToggle = document.getElementById('mobileDrawerToggle');
    const sidebar = document.getElementById('sidebar');
    if (drawerToggle && sidebar) {
        drawerToggle.addEventListener('click', () => {
            const isOpen = sidebar.classList.toggle('drawer-open');
            drawerToggle.textContent = isOpen ? '🗺️ View Map' : '📋 View Evacuation Plan';
        });
    }
}

/**
 * Sets up debounced Nominatim address search with email param according to usage policy.
 */
function setupAddressSearch() {
    const input = document.getElementById('searchAddress');
    const dropdown = document.getElementById('autocompleteDropdown');
    if (!input || !dropdown) return;

    let debounceTimer = null;

    input.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        const query = input.value.trim();

        if (query.length < 3) {
            dropdown.style.display = 'none';
            return;
        }

        debounceTimer = setTimeout(async () => {
            try {
                // Nominatim usage policy: debounced, max 1 request/sec; the browser sends the Referer that identifies the app
                const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`;
                const res = await fetch(url, { headers: { 'Accept': 'application/json' } });

                if (res.ok) {
                    const results = await res.json();
                    if (Array.isArray(results) && results.length > 0) {
                        dropdown.innerHTML = results.map(r => `
                            <div class="autocomplete-item" data-lat="${r.lat}" data-lon="${r.lon}">
                                📍 ${escapeHtml(r.display_name)}
                            </div>
                        `).join('');
                        dropdown.style.display = 'block';

                        dropdown.querySelectorAll('.autocomplete-item').forEach(item => {
                            item.addEventListener('click', () => {
                                const lat = parseFloat(item.getAttribute('data-lat'));
                                const lon = parseFloat(item.getAttribute('data-lon'));
                                input.value = item.textContent.replace('📍 ', '').trim();
                                dropdown.style.display = 'none';
                                setUserLocation(lat, lon, true);
                            });
                        });
                        return;
                    }
                }
                dropdown.style.display = 'none';
            } catch (err) {
                console.warn('Nominatim search error:', err);
                dropdown.style.display = 'none';
            }
        }, 400);
    });

    document.addEventListener('click', (e) => {
        if (!dropdown.contains(e.target) && e.target !== input) {
            dropdown.style.display = 'none';
        }
    });
}

/**
 * PWA Service Worker & Online/Offline integration.
 */
function setupPWAIntegration() {
    initPWA({
        onOnline: () => {
            updateNetworkStatusBadge(true);
            showToast('Network restored. Reconnected to live Overpass API.', 'success');
            recalculateEvacuationPlan();
        },
        onOffline: () => {
            updateNetworkStatusBadge(false);
            showToast('Offline mode active. Using cached maps and shelters.', 'warning');
        }
    });

    updateNetworkStatusBadge(navigator.onLine);
}

function updateUIFilterSelections() {
    const pills = document.querySelectorAll('.disaster-pills .pill-btn');
    pills.forEach(p => {
        p.classList.toggle('active', p.getAttribute('data-disaster') === state.disasterType);
    });

    const profSelect = document.getElementById('travelProfileSelect');
    if (profSelect) profSelect.value = state.profile;
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}
