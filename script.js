document.addEventListener('DOMContentLoaded', () => {

    // Check if we are on the landing page
    const form = document.getElementById('evacuationForm');

    if (form) {
        handleLandingPage(form);
    } else {
        // We are on the map page
        initMapPage();
    }
});

/* LANDING PAGE LOGIC */
function handleLandingPage(form) {
    const errorMsg = document.getElementById('errorMsg');
    const useCurrentLocBtn = document.getElementById('useCurrentLocation');

    if (useCurrentLocBtn) {
        useCurrentLocBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (navigator.geolocation) {
                useCurrentLocBtn.textContent = "Locating...";
                navigator.geolocation.getCurrentPosition((position) => {
                    document.getElementById('latitude').value = position.coords.latitude.toFixed(4);
                    document.getElementById('longitude').value = position.coords.longitude.toFixed(4);
                    errorMsg.style.display = 'none';
                    useCurrentLocBtn.textContent = "Use Current Location";
                }, (error) => {
                    alert('Unable to retrieve your location. Please enter manually.');
                    useCurrentLocBtn.textContent = "Use Current Location";
                });
            } else {
                alert('Geolocation is not supported by your browser');
            }
        });
    }

    form.addEventListener('submit', (e) => {
        e.preventDefault();

        const lat = parseFloat(document.getElementById('latitude').value);
        const lon = parseFloat(document.getElementById('longitude').value);
        const type = document.getElementById('type').value;

        if (validateCoordinates(lat, lon)) {
            errorMsg.style.display = 'none';
            // Redirect to map page with query params
            window.location.href = `map.html?lat=${lat}&lon=${lon}&type=${type}`;
        } else {
            errorMsg.style.display = 'block';
            errorMsg.textContent = 'Invalid coordinates. Latitude must be between -90 and 90. Longitude between -180 and 180.';
        }
    });
}

function validateCoordinates(lat, lon) {
    const isLatValid = isFinite(lat) && Math.abs(lat) <= 90;
    const isLonValid = isFinite(lon) && Math.abs(lon) <= 180;
    return isLatValid && isLonValid;
}

/* MAP PAGE LOGIC */
async function initMapPage() {
    // 1. Parse URL Parameters
    const params = new URLSearchParams(window.location.search);
    const userLat = parseFloat(params.get('lat'));
    const userLon = parseFloat(params.get('lon'));
    const destType = params.get('type') || 'school'; // default to school

    if (!validateCoordinates(userLat, userLon)) {
        alert("Invalid coordinates provided. returning to home.");
        window.location.href = 'index.html';
        return;
    }

    // 2. Initialize Map
    const map = L.map('map').setView([userLat, userLon], 13);

    // Add OSM Tile Layer
    const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    // 3. Add User Marker
    const userIcon = L.icon({
        iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-green.png',
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowSize: [41, 41]
    });

    const userMarker = L.marker([userLat, userLon], { icon: userIcon })
        .bindPopup("<b>Your Location</b>")
        .addTo(map);

    // 4. Fetch Data based on Type
    const dataFile = destType === 'hospital' ? 'data/government_hospitals.geojson' : 'data/government_schools.geojson';

    try {
        const response = await fetch(dataFile);
        if (!response.ok) throw new Error("Failed to load data");
        const geoJsonData = await response.json();

        processEvacuationData(map, userLat, userLon, geoJsonData, destType);
    } catch (error) {
        console.error("Error loading GeoJSON:", error);
        alert("Failed to load evacuation centers data.");
    }

    // Add scale control
    L.control.scale().addTo(map);
}

function processEvacuationData(map, userLat, userLon, data, type) {
    const userLocation = L.latLng(userLat, userLon);
    let nearestCenter = null;
    let minDistance = Infinity;

    const centersLayer = L.geoJSON(data, {
        onEachFeature: function (feature, layer) {
            // Calculate distance
            const centerLatLng = L.latLng(feature.geometry.coordinates[1], feature.geometry.coordinates[0]);
            const distanceMeters = userLocation.distanceTo(centerLatLng);
            const distanceKm = (distanceMeters / 1000).toFixed(2);

            // Check for nearest
            if (distanceMeters < minDistance) {
                minDistance = distanceMeters;
                nearestCenter = {
                    feature: feature,
                    latLng: centerLatLng,
                    distanceKm: distanceKm
                };
            }

            // Bind Popup
            layer.bindPopup(`
                <b>${feature.properties.name}</b><br>
                Type: ${feature.properties.type}<br>
                Status: ${feature.properties.status}<br>
                Distance: ${distanceKm} km
            `);
        },
        pointToLayer: function (feature, latlng) {
            // Use different color for centers
            const centerIcon = L.icon({
                iconUrl: type === 'hospital' ? 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png' : 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-blue.png',
                shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
                iconSize: [25, 41],
                iconAnchor: [12, 41],
                popupAnchor: [1, -34],
                shadowSize: [41, 41]
            });
            return L.marker(latlng, { icon: centerIcon });
        }
    }).addTo(map);

    // 5. Draw Route to Nearest Center
    let routeLayer = null;
    if (nearestCenter) {
        const routePoints = [
            [userLat, userLon],
            [nearestCenter.latLng.lat, nearestCenter.latLng.lng]
        ];

        routeLayer = L.polyline(routePoints, {
            color: 'blue',
            weight: 4,
            opacity: 0.7,
            dashArray: '10, 10'
        }).addTo(map);

        // Highlight nearest marker
        L.popup()
            .setLatLng(nearestCenter.latLng)
            .setContent(`
                <b>NEAREST EVACUATION CENTER</b><br>
                ${nearestCenter.feature.properties.name}<br>
                Distance: ${nearestCenter.distanceKm} km
            `)
            .openOn(map);

        // Update Info Panel
        const infoPanel = document.getElementById('infoPanel');
        const infoContent = document.getElementById('infoContent');
        if (infoPanel && infoContent) {
            infoPanel.style.display = 'block';
            infoContent.innerHTML = `
                <div class="info-item"><b>Name:</b> ${nearestCenter.feature.properties.name}</div>
                <div class="info-item"><b>Type:</b> ${nearestCenter.feature.properties.type}</div>
                <div class="info-item"><b>Status:</b> ${nearestCenter.feature.properties.status}</div>
                <div class="info-item"><b>Distance:</b> ${nearestCenter.distanceKm} km</div>
            `;
        }

        // Fit bounds to show both user and destination
        const bounds = L.latLngBounds(routePoints);
        map.fitBounds(bounds, { padding: [50, 50] });
    }

    // 6. Layer Controls
    const overlays = {
        "Evacuation Centers": centersLayer,
    };
    if (routeLayer) {
        overlays["Evacuation Route"] = routeLayer;
    }

    L.control.layers(null, overlays).addTo(map);
}
