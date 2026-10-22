# GIS Smart Evacuation Assistant 🚨

An intelligent, client-side, offline-first disaster evacuation assistant deployable on GitHub Pages with zero backend dependencies. Designed for stressful crisis situations, it computes real-time safe evacuation routes using live OpenStreetMap shelter data, OSRM road routing, multi-criteria hazard avoidance, and real-time environmental alerts.

---

## 🌟 Highlights & Core Capabilities

### 1. Live Global Shelter Data (OSM Overpass API)
- **Global Coverage**: Real-time shelter queries for hospitals, medical clinics, schools, universities, community centres, fire stations, police stations, designated shelters (`amenity=shelter`, `emergency=shelter`), and emergency assembly points (`emergency=assembly_point`).
- **Resilient Mirror Architecture**: Queries primary and fallback Overpass API mirrors (`overpass-api.de`, `lz4.overpass-api.de`, `z.overpass-api.de`, `overpass.kumi.systems`) with request timeouts.
- **Two-Tier Cache**: Fast responses cached in IndexedDB (with `localStorage` fallback) keyed by rounded geographic bounding box (~1.1 km precision).
- **Bundled Offline GeoJSON**: Transparently falls back to local prepackaged GeoJSON facilities if all mirrors or network connections are down.

### 2. Real Road Routing & Turn-by-Turn Guidance (OSRM)
- **Road Network Routing**: Generates real road polylines with OSRM for both **Driving** and **Walking**, using the FOSSGIS servers (`routing.openstreetmap.de`), which keep separate car and foot graphs so walking ETAs are real walking times.
- **Metrics**: Computes actual road distance (meters/km), travel duration (ETA), and street-level maneuver instructions with directional icons.
- **Graceful Fallback**: Automatically renders a dashed, direct path clearly labeled *"Approximate straight line (road routing unavailable)"* if network connectivity or routing servers fail.

### 3. Smart Multi-Criteria Ranking Engine
Instead of naively routing to the nearest facility as the crow flies, facilities are evaluated and ranked via a weighted multi-criteria decision model:
- **Road Travel Time (OSRM Table Matrix)**: Batch matrix durations queried in a single call.
- **Disaster-Specific Facility Suitability**:
  - **Flood**: High scores for multi-story schools and reinforced civic centers (vertical evacuation); penalizes low-lying outdoor open spaces.
  - **Cyclone**: Favors reinforced masonry community centers; penalizes wind-exposed open assembly points.
  - **Earthquake**: Prioritizes open assembly grounds free of structural collapse risks; demotes high-rise structures.
  - **Fire**: Prioritizes fire stations and open outdoor zones away from smoke entrapment.
  - **General**: Balanced municipal emergency shelters and general hospitals.
- **Medical Priority**: Instant toggle to elevate tertiary hospitals and medical clinics to top priority.
- **Full Score Transparency**: Displays composite score (0–100) and breakdown (Travel Time, Suitability, Safety) with alternatives list.

### 4. Interactive Hazard Zones & Live Disaster Feeds
- **Custom Hazard Drawing**: Draw hazard zones (polygons and circular buffers) directly on the map using pinned Leaflet.draw tools.
- **Automatic Collision & Penalty**:
  - Facilities inside active hazard zones are immediately flagged and **excluded** from recommended safe destinations.
  - Evacuation routes traversing hazard polygons or buffer circles trigger prominent visual hazard warnings and routing penalties.
- **Live USGS Earthquakes Layer**: One-click toggle displaying global earthquakes (M2.5+ in the past 24 hours) from the official USGS GeoJSON feed.
- **Open-Meteo Weather Panel**: Real-time temperature, wind speed/gusts, rainfall intensity, and automated warnings for cyclone-force winds, torrential flash flooding, and extreme heat (no API key required).

### 5. Multi-Modal Location Input
- **GPS Browser Geolocation**: One-tap "Locate Me" using high-accuracy HTML5 geolocation.
- **Address Search (Nominatim)**: Debounced global geocoding with policy-compliant email contact parameter.
- **Map Interaction**: Click anywhere on the map to set a new evacuation origin and immediately recalculate routes.

### 6. Offline-First PWA & Emergency Plan Sharing
- **Service Worker & Manifest**: Caches app shell, static assets, maps, and bundled shelters for offline launch.
- **Offline Plan Recovery**: Last computed evacuation route is stored locally and restored immediately upon offline launch.
- **Plan Sharing**: Encode complete evacuation state into a shareable URL (`#plan=...`) via Web Share API or clipboard.
- **Printable Plan View**: Dedicated `@media print` stylesheet with high-contrast road directions and emergency numbers designed for paper emergency grab-bags.

### 7. Crisis-Ready, Accessible Mobile UI
- **Stress-Optimized UI**: Large touch targets (≥ 48px), high-contrast dark and light modes, and distinct emergency-red visual hierarchy.
- **Emergency Helplines Directory**: One-tap dialing for national hotlines (India 112, 100 Police, 101 Fire, 108 Ambulance, 1070 State Disaster, 1077 District Control) plus custom contact storage.

---

## 🏛️ System Architecture & ES Modules

```
gis-smart-evacuation-system/
├── index.html                 # Unified single-page application shell
├── map.html                   # Backward-compatible redirect to index.html
├── style.css                  # Crisis UI styling, themes, and print stylesheet
├── sw.js                      # Service Worker caching app shell and tiles
├── manifest.webmanifest       # PWA metadata & standalone display config
├── server.js                  # Zero-dependency local Node.js static HTTP server
├── package.json               # Project manifest, test scripts, and metadata
├── data/
│   ├── government_hospitals.geojson  # Bundled offline fallback hospitals
│   └── government_schools.geojson    # Bundled offline fallback schools
├── icons/
│   ├── icon-192.png           # 192x192 PWA app icon
│   ├── icon-512.png           # 512x512 PWA app icon
│   └── icon.svg               # Vector SVG app icon
├── js/
│   ├── app.js                 # Central orchestrator: map, UI, events, state
│   ├── ui.js                  # DOM renderer: plans, steps, ranked list, modals
│   ├── overpass.js            # OSM Overpass API client with mirror failover
│   ├── routing.js             # OSRM road routing, table matrix, step formatting
│   ├── ranking.js             # Weighted multi-criteria ranking engine
│   ├── hazards.js             # Hazard intersection algorithms & USGS quake feed
│   ├── weather.js             # Open-Meteo weather integration & risk indicators
│   ├── storage.js             # IndexedDB & localStorage persistence layer
│   ├── geo.js                 # Pure spatial math: Haversine, ray casting, intersections
│   └── pwa.js                 # Service worker lifecycle, sharing, URL encoding
└── tests/
    ├── geo.test.js            # Unit tests: Haversine, bounding box, polygon collision
    ├── hazards.test.js        # Unit tests: Hazard zone inclusion and route crossing
    ├── overpass.test.js       # Unit tests: Tag parsing, element normalization, QL queries
    ├── ranking.test.js        # Unit tests: Disaster suitability, time score, exclusion
    ├── routing.test.js        # Unit tests: Step formatting, straight-line fallback
    └── weather.test.js        # Unit tests: WMO weather codes and disaster alerts
```

---

## 🚀 Getting Started

Since this is a client-side, zero-backend architecture, no database or build toolchain is required.

### Prerequisites
- Modern web browser (Chrome, Edge, Firefox, Safari)
- Node.js (v18+ recommended for running unit tests or local server)

### 1. Clone the Repository
```bash
git clone https://github.com/your-username/gis-smart-evacuation-system.git
cd gis-smart-evacuation-system
```

### 2. Run the Local Development Server
```bash
npm run serve
# or
node server.js
```
Open your browser at:
```
http://127.0.0.1:8080/
```

### 3. Run the Unit Test Suite
Run the test suite using Node.js built-in test runner:
```bash
npm test
# or
node --test tests/*.test.js
```

### 4. Deploying to GitHub Pages
1. Push the repository to GitHub.
2. Go to **Settings** > **Pages**.
3. Under **Build and deployment**, set **Source** to `Deploy from a branch` and select `main` / `/ (root)`.
4. Click **Save**. The PWA will be live at `https://<username>.github.io/gis-smart-evacuation-system/`.

---

## 📡 Data Sources & Attribution

| Service | Provider | Usage | Attribution / Terms |
| :--- | :--- | :--- | :--- |
| **Map Tiles & POIs** | [OpenStreetMap](https://www.openstreetmap.org/) | Base map tiles, shelters, medical facilities, schools | &copy; OpenStreetMap contributors ([ODbL](https://www.openstreetmap.org/copyright)) |
| **Overpass API** | [Overpass API](https://overpass-api.de/) | Live spatial query of emergency facilities | OpenStreetMap data licensed under ODbL |
| **Address Geocoding** | [Nominatim](https://nominatim.openstreetmap.org/) | Global address search autocomplete | Nominatim usage policy (debounced, email identified) |
| **Road Routing** | [OSRM](https://project-osrm.org/) on [FOSSGIS routing.openstreetmap.de](https://routing.openstreetmap.de/) | Road polylines, ETAs, table matrix (car + foot) | FOSSGIS public service, OSM data ODbL |
| **Earthquake Data** | [USGS Earthquake Hazards](https://earthquake.usgs.gov/) | Real-time global M2.5+ earthquake feed | Public Domain / US Geological Survey |
| **Weather & Alerts** | [Open-Meteo](https://open-meteo.com/) | Real-time temperature, wind, gusts, precipitation | Open-Meteo Weather API ([CC BY 4.0](https://open-meteo.com/en/terms)) |
| **Map Rendering** | [Leaflet](https://leafletjs.com/) | Mobile-friendly interactive mapping library | BSD 2-Clause License |
| **Drawing Tools** | [Leaflet.draw](https://github.com/Leaflet/Leaflet.draw) | Vector hazard polygon and circle drawing | MIT License |

---

## ⚠️ Important Limitations & Safety Disclaimer

1. **Demonstration & Educational Purpose**: This software utilizes public, shared demo API servers (Overpass API, OSRM public demo, Nominatim, and Open-Meteo). These servers may enforce rate limits, experience temporary latency, or be unavailable during massive concurrent traffic.
2. **Not a Substitute for Official Directives**: In an actual life-threatening disaster, **always obey official instructions from local emergency authorities, civil defense agencies, the National Disaster Management Authority (NDMA), police, and emergency responders.** Do not rely solely on automated digital routing when ground conditions (e.g., downed bridges, police blockades, fallen electrical lines) cannot be verified in real time.
3. **Offline Limitations**: When operating fully offline without cached data, the system relies on bundled emergency points and straight-line approximations. Users are encouraged to pre-cache their local region or print an evacuation plan before severe storms or natural disasters strike.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
