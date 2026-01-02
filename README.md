# gis-smart-evacuation-system
# GIS-Based Disaster Evacuation Assistance System

A frontend-only GIS application designed to help users find the nearest evacuation center (Government School or Hospital) based on their geographical location.

## Features

- **Landing Page**: Clean interface to input coordinates (Latitude/Longitude) and select destination type.
- **Input Validation**: Ensures valid coordinate ranges before processing.
- **Interactive Map**: Built with [Leaflet.js](https://leafletjs.com/) and OpenStreetMap.
- **Nearest Neighbor Analysis**: Automatically calculates distances to all available centers and identifies the nearest one.
- **Route Visualization**: Draws a visual line from the user's location to the nearest evacuation center.
- **Responsive Design**: Works on desktop and mobile devices.

## Technology Stack

- **HTML5**: semantic structure
- **CSS3**: Custom styling with responsive design
- **JavaScript (ES6+)**: Logic for spatial analysis and DOM manipulation
- **Leaflet.js**: Open-source JavaScript library for interactive maps
- **GeoJSON**: Data format for storing evacuation center locations

## Project Structure

```
c:/SafeCoder/
├── index.html        # Landing page with form
├── map.html          # Map visualization page
├── style.css         # Global styles
├── script.js         # Core application logic
├── README.md         # Project documentation
└── data/
    ├── government_schools.geojson    # Sample data for schools
    └── government_hospitals.geojson  # Sample data for hospitals
```

## Setup & Usage

Since this is a client-side application, no backend server is required.

1. **Clone or Download** the repository.
2. **Open `index.html`** in any modern web browser.
3. **Enter Coordinates**:
   - You can manually enter Latitude and Longitude.
   - Or click **"Use Current Location"** (requires browser permission).
   - *Sample Coordinates (Chennai)*: Lat: `13.0827`, Lon: `80.2707`
4. **Select Destination Type**: Choose between "Government School" or "Government Hospital".
5. **Find Nearest Center**: Click the button to view the map, the nearest center, and the route.

## Data Sources

The application uses static GeoJSON files located in the `data/` directory. Currently, it includes sample data for:
- Government Schools (Shelters)
- Government Hospitals (Medical Camps)

*Note: The sample data is focused around the Chennai, India region for demonstration purposes.*

## License

This project is open-source and free to use for educational and humanitarian purposes.
