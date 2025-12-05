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

    getLineNumber(destinationName) {
        // L2 for Kabiezes or Basauri, L1 for everything else
        if (destinationName && (destinationName.includes('Kabiezes') || destinationName.includes('Basauri'))) {
            return 'L2';
        }
        return 'L1';
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
                // Update tooltip with L[X] | [destino] format
                const lineNumber = this.getLineNumber(train.destination_name);
                marker.setTooltipContent(`${lineNumber} | ${train.destination_name || '...'}`);

                // Update stored train data
                const oldTrainData = marker.trainData;
                marker.trainData = train;

                // Check if popup is open and update it in real-time
                if (this.openTrainPopup &&
                    this.openTrainPopup.tripId === train.trip_id &&
                    marker.getPopup() &&
                    marker.getPopup().isOpen()) {
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
                });

                // Set tooltip with L[X] | [destino] format
                const lineNumber = this.getLineNumber(train.destination_name);
                marker.bindTooltip(`${lineNumber} | ${train.destination_name || '...'}`);
                marker.openTooltip();

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
        const lineNumber = this.getLineNumber(train.destination_name);
        const route = this.routesById.get(train.route_id);
        const routeColor = route ? route.color : CONFIG.COLORS.primary;

        // Get the trip to access all stop times
        const trip = this.gtfsData.tripsById.get(train.trip_id);
        if (!trip) return;

        // Find current position in the trip
        const currentTime = this.currentTime ? this.getSecondsFromMidnight(this.currentTime) : 0;
        let nextStopIndex = 0;

        for (let i = 0; i < trip.stop_times.length; i++) {
            if (trip.stop_times[i].arrival > currentTime) {
                nextStopIndex = i;
                break;
            }
        }

        // Build station list
        let stationsList = '<div id="train-stations-list" style="max-height: 300px; overflow-y: auto; margin-top: 10px;">';

        trip.stop_times.forEach((stopTime, index) => {
            const stopInfo = this.gtfsData.stopsById.get(stopTime.stop_id);
            const isPast = index < nextStopIndex;
            const isNext = index === nextStopIndex;
            const minutesUntil = Math.round((stopTime.arrival - currentTime) / 60);

            const opacity = isPast ? '0.4' : '1';
            const fontWeight = isNext ? 'bold' : 'normal';
            const backgroundColor = isNext ? '#fff3e0' : 'transparent';
            const color = isPast ? '#999' : '#333';

            stationsList += `
                <div class="station-item" data-index="${index}" style="
                    padding: 8px;
                    opacity: ${opacity};
                    font-weight: ${fontWeight};
                    background-color: ${backgroundColor};
                    border-bottom: 1px solid #eee;
                    color: ${color};
                    cursor: ${isPast ? 'default' : 'pointer'};
                ">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div style="flex: 1;">
                            ${stopInfo ? stopInfo.name : stopTime.stop_id}
                        </div>
                        <div style="text-align: right; font-size: 0.85em; margin-left: 10px;">
                            ${!isPast ? `<span style="color: #ff6b00; font-weight: bold;">${minutesUntil}'</span><br/>` : ''}
                            <span style="color: #666;">${this.formatTime(stopTime.arrival)}</span>
                        </div>
                    </div>
                </div>
            `;
        });

        stationsList += '</div>';

        const popupContent = `
            <div style="font-family: sans-serif; min-width: 280px;">
                <h3 style="margin: 0 0 10px 0; color: #ff6b00; font-size: 1.1em;">
                    ${lineNumber} | ${train.destination_name}
                </h3>
                ${stationsList}
            </div>
        `;

        marker.bindPopup(popupContent, { maxWidth: 400 }).openPopup();

        // Auto-scroll to next station after popup opens
        setTimeout(() => {
            const listElement = document.getElementById('train-stations-list');
            if (listElement) {
                const nextStation = listElement.querySelector(`.station-item[data-index="${nextStopIndex}"]`);
                if (nextStation) {
                    nextStation.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }
        }, 100);
    }
    showStationPopup(stopId, stopName) {
        if (!this.simulator || !this.currentTime || !this.gtfsData) {
            console.warn('Station popup requires simulator, current time, and GTFS data');
            return;
        }

        const result = this.simulator.getUpcomingTrainsForStation(stopId, this.currentTime, 45);

        let trainsList = '';
        if (result.trains.length === 0) {
            trainsList = '<p style="color: #999; font-style: italic; padding: 10px;">No hay trenes próximos</p>';
        } else {
            // Limit to 10 trains
            const trainsToShow = result.trains.slice(0, 10);

            trainsList = '<div style="padding: 5px 0;">';
            trainsToShow.forEach(train => {
                const lineNumber = this.getLineNumber(train.destination_name);
                const route = this.routesById.get(train.route_id);

                // Format: L[X] | [destino] ([XX:XX])                            [XX]'
                trainsList += `
                    <div style="padding: 6px 8px; margin: 2px 0; font-family: monospace; font-size: 0.85em; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #eee;">
                        <div style="flex: 1;">
                            <span style="font-weight: bold;">${lineNumber}</span> | 
                            <span>${train.destination_name}</span>
                            <span style="color: #666; margin-left: 5px;">(${this.formatTime(train.arrival_time)})</span>
                        </div>
                        <div style="font-weight: bold; color: #ff6b00; margin-left: 15px; white-space: nowrap;">
                            ${train.minutes_until}'
                        </div>
                    </div>
                `;
            });
            trainsList += '</div>';
        }

        const popupContent = `
            <div style="font-family: sans-serif; min-width: 320px; max-width: 400px;">
                <h3 style="margin: 0 0 12px 0; color: #0057A4; font-size: 1.1em;">
                    ${stopName}
                </h3>
                ${trainsList}
            </div>
        `;

        // Find the station marker and open popup
        const stop = this.gtfsData.stopsById.get(stopId);
        if (stop) {
            L.popup({ maxWidth: 420 })
                .setLatLng([stop.lat, stop.lon])
                .setContent(popupContent)
                .openOn(this.map);
        }
    }

    getSecondsFromMidnight(date) {
        const hours = date.getHours();
        const minutes = date.getMinutes();
        const seconds = date.getSeconds();
        return hours * 3600 + minutes * 60 + seconds;
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

