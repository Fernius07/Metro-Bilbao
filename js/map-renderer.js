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
            const route = this.routesById ? this.routesById.get(train.route_id) : null;
            const routeShortName = route ? (route.short_name || route.long_name) : train.route_id;
            // New tooltip format: L[X] | [destino]
            const tooltipText = `L${routeShortName} | ${train.destination_name || '...'}`;
            
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
                marker.setTooltipContent(tooltipText);

                // Update stored train data
                const oldTrainData = marker.trainData;
                marker.trainData = train;

                // Check if popup is open - always refresh to update station states
                if (this.openTrainPopup &&
                    this.openTrainPopup.tripId === train.trip_id &&
                    marker.getPopup() &&
                    marker.getPopup().isOpen()) {
                    // Refresh the popup with new data (updates passed/current stations)
                    this.showTrainPopup(marker, train, false); // false = don't scroll again
                }
            } else {
                // Create
                let color = CONFIG.COLORS.secondary;
                if (route) {
                    color = route.color;
                }

                const marker = L.circleMarker([train.lat, train.lon], {
                    radius: 6,
                    fillColor: color,
                    color: '#fff',
                    weight: 2,
                    fillOpacity: 1
                }).bindTooltip(tooltipText);

                // Add click handler for popup
                marker.on('click', () => {
                    this.showTrainPopup(marker, marker.trainData, true); // true = scroll to current
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

    showTrainPopup(marker, train, scrollToCurrentStation = true) {
        const route = this.routesById.get(train.route_id);
        const routeShortName = route ? (route.short_name || route.long_name) : train.route_id;
        const routeColor = route ? route.color : CONFIG.COLORS.primary;
        
        // Title format: L[X] | [destino]
        const title = `L${routeShortName} | ${train.destination_name || '...'}`;
        
        // Generate station list
        let stationsList = '';
        const currentTime = this.currentTime ? this.getSecondsFromMidnight(this.currentTime) : 0;
        
        if (train.all_stops && train.all_stops.length > 0) {
            train.all_stops.forEach((stop, index) => {
                const isPassed = stop.is_passed;
                const isCurrent = stop.is_current;
                
                // Calculate minutes until arrival (only for future stations)
                let timeInfo = '';
                if (!isPassed && currentTime > 0) {
                    const minutesUntil = Math.max(0, Math.round((stop.arrival - currentTime) / 60));
                    const arrivalFormatted = this.formatTime(stop.arrival);
                    timeInfo = `<span style="color: ${isCurrent ? '#333' : '#666'}; font-size: 0.85em;">${minutesUntil}' · ${arrivalFormatted}</span>`;
                } else if (isPassed) {
                    timeInfo = `<span style="color: #bbb; font-size: 0.85em;">${this.formatTime(stop.arrival)}</span>`;
                }
                
                // Style based on station state
                let stationStyle = '';
                let textColor = '#333';
                let fontWeight = 'normal';
                let backgroundColor = 'transparent';
                let borderLeft = '3px solid transparent';
                
                if (isPassed) {
                    textColor = '#bbb';
                    stationStyle = 'text-decoration: line-through;';
                } else if (isCurrent) {
                    fontWeight = 'bold';
                    backgroundColor = `${routeColor}15`;
                    borderLeft = `3px solid ${routeColor}`;
                }
                
                const stationId = `train-stop-${train.trip_id}-${index}`;
                
                stationsList += `
                    <div id="${stationId}" style="padding: 6px 8px; margin: 2px 0; display: flex; justify-content: space-between; align-items: center; background: ${backgroundColor}; border-left: ${borderLeft};">
                        <span style="color: ${textColor}; font-weight: ${fontWeight}; ${stationStyle}">${stop.stop_name}</span>
                        ${timeInfo}
                    </div>
                `;
            });
        }
        
        const popupId = `train-popup-${train.trip_id}`;
        const scrollContainerId = `train-scroll-${train.trip_id}`;
        
        const popupContent = `
            <div id="${popupId}" style="font-family: sans-serif; min-width: 280px; max-width: 320px;">
                <h3 style="margin: 0 0 10px 0; padding: 8px; background: ${routeColor}; color: white; border-radius: 4px 4px 0 0;">
                    ${title}
                </h3>
                <div id="${scrollContainerId}" style="max-height: 250px; overflow-y: auto; padding: 4px;">
                    ${stationsList}
                </div>
            </div>
        `;

        marker.bindPopup(popupContent, { maxWidth: 350 }).openPopup();
        
        // Auto-scroll to current station
        if (scrollToCurrentStation && train.current_stop_index !== undefined) {
            setTimeout(() => {
                const currentStopElement = document.getElementById(`train-stop-${train.trip_id}-${train.current_stop_index}`);
                const scrollContainer = document.getElementById(scrollContainerId);
                if (currentStopElement && scrollContainer) {
                    currentStopElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }, 100);
        }
    }

    getSecondsFromMidnight(date) {
        return date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds();
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
            // New format: L[X] | [destino] (XX:XX)                            XX'
            // No scroll, max 10 trains (already limited by simulator)
            trainsList = '<div>';
            result.trains.forEach(train => {
                const route = this.routesById.get(train.route_id);
                const routeShortName = route ? (route.short_name || route.long_name) : train.route_id;
                const routeColor = route ? route.color : CONFIG.COLORS.primary;
                const arrivalFormatted = this.formatTime(train.arrival_time);

                trainsList += `
                    <div style="padding: 6px 8px; margin: 3px 0; border-left: 3px solid ${routeColor}; background: #f9f9f9; display: flex; justify-content: space-between; align-items: center;">
                        <span style="color: ${routeColor}; font-weight: 500;">L${routeShortName} | ${train.destination_name} <span style="color: #666; font-weight: normal;">(${arrivalFormatted})</span></span>
                        <span style="font-weight: bold; color: #333; margin-left: 12px; white-space: nowrap;">${train.minutes_until}'</span>
                    </div>
                `;
            });
            trainsList += '</div>';
        }

        const title = result.is_terminal ? t.departing_trains : t.upcoming_trains;

        const popupContent = `
            <div style="font-family: sans-serif; min-width: 280px; max-width: 350px;">
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
