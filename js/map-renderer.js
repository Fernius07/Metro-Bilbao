import CONFIG from './config.js';
import i18n from './i18n.js';

class MapRenderer {
    constructor(containerId, language = 'es') {
        this.language = language;
        this.map = L.map(containerId, {
            center: CONFIG.MAP_CENTER,
            zoom: CONFIG.MAP_ZOOM,
            zoomControl: false,
            attributionControl: false
        });

        // Layers
        this.layers = {
            base: {
                standard: L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
                    attribution: '&copy; OpenStreetMap &copy; CARTO'
                }),
                satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
                    attribution: '&copy; Esri'
                })
            },
            shapes: L.layerGroup().addTo(this.map),
            stops: L.layerGroup().addTo(this.map),
            trains: L.layerGroup().addTo(this.map)
        };

        this.layers.base.standard.addTo(this.map);
        L.control.zoom({ position: 'bottomright' }).addTo(this.map);

        this.trainMarkers = new Map(); // trip_id -> L.marker
        this.gtfsData = null;
        this.simulator = null;
        this.currentTime = null;
        this.openTrainPopup = null; // Track open train popup
    }

    setTheme(theme) {
        if (theme === 'dark') {
            this.layers.base.standard.setUrl('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png');
        } else {
            this.layers.base.standard.setUrl('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png');
        }
    }

    toggleLayer(type) {
        if (type === 'satellite') {
            this.map.removeLayer(this.layers.base.standard);
            this.map.addLayer(this.layers.base.satellite);
        } else {
            this.map.removeLayer(this.layers.base.satellite);
            this.map.addLayer(this.layers.base.standard);
        }
    }

    renderStaticData(processedData) {
        this.routesById = processedData.routesById;
        this.shapesById = processedData.shapesById;

        // 1. Draw Shapes - Consolidate by route+direction
        // Group shapes by route and direction to avoid drawing duplicates
        const shapesByRouteDir = new Map();

        processedData.shapesById.forEach(shape => {
            const trips = processedData.tripsByShapeId.get(shape.id);
            if (!trips || trips.length === 0) return;

            const trip = trips[0];
            const key = `${trip.route_id}_${trip.direction_id || '0'}`;

            // Only keep the first shape for each route+direction
            if (!shapesByRouteDir.has(key)) {
                shapesByRouteDir.set(key, {
                    shape: shape,
                    route_id: trip.route_id
                });
            }
        });

        // Draw consolidated shapes
        shapesByRouteDir.forEach(({ shape, route_id }) => {
            const route = processedData.routesById.get(route_id);
            const latlngs = shape.points.map(p => [p.lat, p.lon]);

            L.polyline(latlngs, {
                color: route.color,
                weight: 4,
                opacity: 0.8,
                smoothFactor: 1
            }).addTo(this.layers.shapes);
        });

        // 2. Draw Stops
        processedData.stopsById.forEach(stop => {
            const marker = L.circleMarker([stop.lat, stop.lon], {
                radius: 4,
                fillColor: '#fff',
                color: '#666',
                weight: 1,
                opacity: 1,
                fillOpacity: 1
            }).bindTooltip(stop.name);

            // Add click handler for station
            marker.on('click', () => {
                this.showStationPopup(stop.id, stop.name);
            });

            marker.addTo(this.layers.stops);
        });
    }

    updateTrains(trains) {
        const activeIds = new Set(trains.map(t => t.trip_id));

        // Remove old trains
        for (const [id, marker] of this.trainMarkers) {
            if (!activeIds.has(id)) {
                this.layers.trains.removeLayer(marker);
                this.trainMarkers.delete(id);
                // Clear open popup reference if this train is removed
                if (this.openTrainPopup && this.openTrainPopup.tripId === id) {
                    this.openTrainPopup = null;
                }
            }
        }

        // Update/Add trains
        trains.forEach(train => {
            if (this.trainMarkers.has(train.trip_id)) {
                // Move with smooth transition
                const marker = this.trainMarkers.get(train.trip_id);
                const element = marker.getElement();
                if (element) {
                    // Add transition if not already present
                    if (!element.style.transition) {
                        element.style.transition = 'all 0.5s linear';
                    }
                }
                marker.setLatLng([train.lat, train.lon]);
                // Show only service number in tooltip if available, otherwise next stop
                const tooltipText = train.service_number || train.next_stop_name || '...';
                marker.setTooltipContent(tooltipText);

                // Update stored train data
                const oldTrainData = marker.trainData;
                marker.trainData = train;

                // Check if popup is open and next stop has changed
                if (this.openTrainPopup &&
                    this.openTrainPopup.tripId === train.trip_id &&
                    marker.getPopup() &&
                    marker.getPopup().isOpen() &&
                    oldTrainData &&
                    oldTrainData.next_stop_name !== train.next_stop_name) {
                    // Refresh the popup with new data
                    this.showTrainPopup(marker, train);
                }
            } else {
                // Create
                let color = CONFIG.COLORS.secondary;
                if (this.routesById && this.routesById.has(train.route_id)) {
                    color = this.routesById.get(train.route_id).color;
                }

                const marker = L.circleMarker([train.lat, train.lon], {
                    radius: 6,
                    fillColor: color,
                    color: '#fff',
                    weight: 2,
                    fillOpacity: 1
                }).bindTooltip(train.service_number || train.next_stop_name || '...');

                // Add click handler for popup
                marker.on('click', () => {
                    this.showTrainPopup(marker, train);
                    this.openTrainPopup = { tripId: train.trip_id, marker: marker };
                });

                // Track when popup closes
                marker.on('popupclose', () => {
                    if (this.openTrainPopup && this.openTrainPopup.tripId === train.trip_id) {
                        this.openTrainPopup = null;
                    }
                });

                marker.addTo(this.layers.trains);
                this.trainMarkers.set(train.trip_id, marker);

                // Store train data for updates
                marker.trainData = train;
            }
        });
    }

    showTrainPopup(marker, train) {
        const t = i18n[this.language];
        const route = this.routesById.get(train.route_id);

        // Use service number as title if available, otherwise use route name
        const title = train.service_number || (route ? route.short_name || route.long_name : train.route_id);

        const popupContent = `
            <div style="font-family: sans-serif; min-width: 200px;">
                <h3 style="margin: 0 0 10px 0; color: ${route ? route.color : CONFIG.COLORS.primary};">
                    ${title}
                </h3>
                <div style="margin-bottom: 8px;">
                    <strong>${t.next_stop}:</strong><br/>
                    ${train.next_stop_name}<br/>
                    <span style="color: #666;">${t.arrival_time}: ${this.formatTime(train.next_stop_arrival)}</span>
                </div>
                <div>
                    <strong>${t.destination}:</strong><br/>
                    ${train.destination_name}<br/>
                    <span style="color: #666;">${t.arrival_time}: ${this.formatTime(train.destination_arrival)}</span>
                </div>
            </div>
        `;

        marker.bindPopup(popupContent).openPopup();
    }

    showStationPopup(stopId, stopName) {
        if (!this.simulator || !this.currentTime || !this.gtfsData) {
            console.warn('Station popup requires simulator, current time, and GTFS data');
            return;
        }

        const t = i18n[this.language];
        const result = this.simulator.getUpcomingTrainsForStation(stopId, this.currentTime, 45);

        let trainsList = '';
        if (result.trains.length === 0) {
            trainsList = `<p style="color: #999; font-style: italic;">${t.no_trains}</p>`;
        } else {
            trainsList = '<div style="max-height: 300px; overflow-y: auto;">';
            result.trains.forEach(train => {
                const route = this.routesById.get(train.route_id);
                const routeName = route ? (route.short_name || route.long_name) : train.route_id;
                const routeColor = route ? route.color : CONFIG.COLORS.primary;

                trainsList += `
                    <div style="padding: 8px; margin: 4px 0; border-left: 3px solid ${routeColor}; background: #f9f9f9;">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <div>
                                <strong style="color: ${routeColor};">${routeName}</strong>
                                <br/>
                                <span style="font-size: 0.9em;">${train.destination_name}</span>
                            </div>
                            <div style="text-align: right; margin-left: 10px;">
                                <strong style="color: #333;">${train.minutes_until} ${t.minutes}</strong>
                                <br/>
                                <span style="font-size: 0.8em; color: #666;">${this.formatTime(train.arrival_time)}</span>
                            </div>
                        </div>
                    </div>
                `;
            });
            trainsList += '</div>';
        }

        const title = result.is_terminal ? t.departing_trains : t.upcoming_trains;

        const popupContent = `
            <div style="font-family: sans-serif; min-width: 250px;">
                <h3 style="margin: 0 0 10px 0; color: ${CONFIG.COLORS.primary};">
                    ${stopName}
                </h3>
                <h4 style="margin: 0 0 10px 0; color: #666; font-weight: normal;">
                    ${title}
                </h4>
                ${trainsList}
            </div>
        `;

        // Find the station marker and open popup
        const stop = this.gtfsData.stopsById.get(stopId);
        if (stop) {
            L.popup()
                .setLatLng([stop.lat, stop.lon])
                .setContent(popupContent)
                .openOn(this.map);
        }
    }

    formatTime(secondsFromMidnight) {
        const hours = Math.floor(secondsFromMidnight / 3600);
        const minutes = Math.floor((secondsFromMidnight % 3600) / 60);
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    }

    setLanguage(language) {
        this.language = language;
    }

    setGTFSData(data) {
        this.gtfsData = data;
    }

    setSimulator(simulator) {
        this.simulator = simulator;
    }

    setCurrentTime(time) {
        this.currentTime = time;
    }
}

export default MapRenderer;
