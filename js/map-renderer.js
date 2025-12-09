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
        this.trainMarkers = new Map();
        this.gtfsData = null;
        this.simulator = null;
        this.currentTime = null;
        this.activePanel = null;
        this.panelElement = document.getElementById('info-panel');
        this.panelTitle = document.getElementById('panel-title-text');
        this.panelSubtitle = document.getElementById('panel-subtitle-text');
        this.panelContent = document.getElementById('panel-content');
        this.closePanelBtn = document.getElementById('close-panel-btn');
        if (this.closePanelBtn) {
            this.closePanelBtn.addEventListener('click', () => this.closeInfoPanel());
        }
        this.map.on('click', (e) => {
            if (e.originalEvent.target.closest('.info-panel')) return;
            this.closeInfoPanel();
        });
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
        const shapesByRouteDir = new Map();
        processedData.shapesById.forEach(shape => {
            const trips = processedData.tripsByShapeId.get(shape.id);
            if (!trips || trips.length === 0) return;
            const trip = trips[0];
            const key = `${trip.route_id}_${trip.direction_id || '0'}`;
            if (!shapesByRouteDir.has(key)) {
                shapesByRouteDir.set(key, {
                    shape: shape,
                    route_id: trip.route_id
                });
            }
        });
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
        processedData.stopsById.forEach(stop => {
            const marker = L.circleMarker([stop.lat, stop.lon], {
                radius: 4,
                fillColor: '#fff',
                color: '#97999B',
                weight: 2,
                opacity: 1,
                fillOpacity: 1
            });
            marker.bindTooltip(stop.name, {
                direction: 'top',
                offset: [0, -5]
            });
            marker.on('click', (e) => {
                L.DomEvent.stopPropagation(e);
                this.showStationPanel(stop.id, stop.name);
            });
            marker.addTo(this.layers.stops);
        });
    }
    getLineNumber(destinationName) {
        if (destinationName && (destinationName.includes('Kabiezes') || destinationName.includes('Basauri'))) {
            return 'L2';
        }
        return 'L1';
    }
    updateTrains(trains) {
        const activeIds = new Set(trains.map(t => t.trip_id));
        for (const [id, marker] of this.trainMarkers) {
            if (!activeIds.has(id)) {
                this.layers.trains.removeLayer(marker);
                this.trainMarkers.delete(id);
                if (this.activePanel && this.activePanel.type === 'train' && this.activePanel.id === id) {
                    this.closeInfoPanel();
                }
            }
        }
        trains.forEach(train => {
            if (this.trainMarkers.has(train.trip_id)) {
                const marker = this.trainMarkers.get(train.trip_id);
                // Animate movement using CSS transition on the element if possible, 
                // but Leaflet moves the marker by changing translate3d. 
                // The CSS .train-marker transition helps this smooth out.
                marker.setLatLng([train.lat, train.lon]);
                const lineNumber = this.getLineNumber(train.destination_name);
                marker.setTooltipContent(`${lineNumber} | ${train.destination_name || '...'}`);
                marker.trainData = train;
                // Update panel if open for this train
                if (this.activePanel && this.activePanel.type === 'train' && this.activePanel.id === train.trip_id) {
                    this.updateTrainPanelContent(train);
                }
            } else {
                let color = CONFIG.COLORS.secondary;
                if (this.routesById && this.routesById.has(train.route_id)) {
                    color = this.routesById.get(train.route_id).color;
                }
                // Use black for L2 trains
                const lineNumber = this.getLineNumber(train.destination_name);
                if (lineNumber === 'L2') {
                    color = '#000000';
                }
                // Create custom icon or continue using circle marker with class
                // Using divIcon for better CSS control if needed, but circleMarker is performant.
                // The user asked for icons. Currently using circle markers which are just dots.
                // Let's stick to circle markers but make them distinct.
                const marker = L.circleMarker([train.lat, train.lon], {
                    radius: 7,
                    fillColor: color,
                    color: '#fff',
                    weight: 2,
                    fillOpacity: 1,
                    className: 'train-marker'
                });
                const lineNumber2 = this.getLineNumber(train.destination_name);
                marker.bindTooltip(`${lineNumber2} | ${train.destination_name || '...'}`, {
                    direction: 'top',
                    offset: [0, -5]
                });
                marker.on('click', (e) => {
                    L.DomEvent.stopPropagation(e);
                    this.showTrainPanel(train);
                });
                marker.addTo(this.layers.trains);
                this.trainMarkers.set(train.trip_id, marker);
                marker.trainData = train;
            }
        });
    }
    // --- Side Panel Methods ---
    openInfoPanel(title, subtitle, contentHtml, type, id) {
        if (!this.panelElement) return;
        this.panelTitle.textContent = title;
        this.panelSubtitle.textContent = subtitle;
        this.panelContent.innerHTML = contentHtml;
        // Set title color based on line (black for L2, default for L1)
        if (type === 'train' && title.startsWith('L2')) {
            this.panelTitle.style.color = '#000000';
        } else if (type === 'train' && title.startsWith('L1')) {
            this.panelTitle.style.color = 'var(--primary-color)';
        } else {
            this.panelTitle.style.color = ''; // Reset to default
        }
        this.panelElement.classList.add('visible');
        document.body.classList.add('panel-open');
        this.activePanel = { type, id };
    }
    closeInfoPanel() {
        if (!this.panelElement) return;
        this.panelElement.classList.remove('visible');
        document.body.classList.remove('panel-open');
        this.activePanel = null;
    }
    showTrainPanel(train) {
        const lineNumber = this.getLineNumber(train.destination_name);
        // Initial render
        this.updateTrainPanelContent(train);
    }
    updateTrainPanelContent(train) {
        const lineNumber = this.getLineNumber(train.destination_name);
        const title = `${lineNumber} | ${train.destination_name}`;
        const subtitle = `Tren en servicio`;
        const trip = this.gtfsData.tripsById.get(train.trip_id);
        if (!trip) return;
        const currentTime = this.currentTime ? this.getSecondsFromMidnight(this.currentTime) : 0;
        let nextStopIndex = 0;
        for (let i = 0; i < trip.stop_times.length; i++) {
            if (trip.stop_times[i].arrival > currentTime) {
                nextStopIndex = i;
                break;
            }
        }
        let content = '<div class="station-list">';
        trip.stop_times.forEach((stopTime, index) => {
            // Only show previous 1 stop and upcoming stops to avoid massive list
            if (index < nextStopIndex - 1) return;
            const stopInfo = this.gtfsData.stopsById.get(stopTime.stop_id);
            const isPast = index < nextStopIndex;
            const isNext = index === nextStopIndex;
            const delay = train.delay || 0;
            const adjustedArrival = stopTime.arrival + delay;
            const minutesUntil = Math.round((adjustedArrival - currentTime) / 60);
            // Styling logic
            const color = isPast ? '#999' : (isNext ? 'var(--primary-color)' : 'var(--text-color)');
            const fontWeight = isNext ? 'bold' : 'normal';
            const bgColor = isNext ? 'rgba(229, 42, 18, 0.05)' : 'transparent'; // Light red for next
            let delayHtml = '';
            if (!isPast && delay !== 0) {
                const delayMin = Math.round(delay / 60);
                const delayColor = delay > 0 ? '#cc0000' : '#2e7d32';
                const sign = delay > 0 ? '+' : '';
                delayHtml = `<span style="color: ${delayColor}; font-size: 0.8em; margin-left: 4px;">(${sign}${delayMin})</span>`;
            }
            let timeDisplay = '';
            if (!isPast) {
                if (minutesUntil <= 0) timeDisplay = 'Ahora';
                else timeDisplay = `${minutesUntil} min`;
            } else {
                timeDisplay = this.formatTime(adjustedArrival);
            }
            content += `
                <div class="station-list-item" style="background-color: ${bgColor}; color: ${color}; font-weight: ${fontWeight}; padding: 8px 0;">
                    <div style="flex: 1; display: flex; align-items: center;">
                        <span class="legend-icon icon-station" style="width: 12px; height: 12px; margin-right: 8px; transform: scale(0.8);"></span>
                        <span>${stopInfo ? stopInfo.name : stopTime.stop_id}</span>
                    </div>
                    <div style="text-align: right; font-size: 0.9em; min-width: 80px;">
                        <span>${timeDisplay}</span>
                        ${delayHtml}
                    </div>
                </div>
            `;
        });
        content += '</div>';
        // If panel is already open for this train, just update content
        // Else open it
        if (this.activePanel && this.activePanel.type === 'train' && this.activePanel.id === train.trip_id) {
            this.panelContent.innerHTML = content;
        } else {
            this.openInfoPanel(title, subtitle, content, 'train', train.trip_id);
            // Scroll to next station
            setTimeout(() => {
                // Not easily possible with string injection unless we add IDs.
                // For now, list is filtered so next station is near top.
            }, 100);
        }
    }
    showStationPanel(stopId, stopName) {
        if (!this.simulator || !this.currentTime || !this.gtfsData) {
            return;
        }
        const result = this.simulator.getUpcomingTrainsForStation(stopId, this.currentTime, 45); // 45 min window
        // Initial render
        this.updateStationPanelContent(stopId, stopName, result);
        this.openInfoPanel(stopName, 'Próximas salidas', this.renderStationContent(result), 'station', stopId);
    }
    // Helper to generate station HTML
    renderStationContent(result) {
        if (result.trains.length === 0) {
            return '<div style="padding: 2rem; text-align: center; color: #999;">No hay trenes próximos en los siguientes 45 min.</div>';
        }
        let content = '<div class="station-list">';
        const trainsToShow = result.trains.slice(0, 10);
        trainsToShow.forEach(train => {
            const lineNumber = this.getLineNumber(train.destination_name);
            const route = this.routesById.get(train.route_id);
            const routeColor = route ? route.color : '#000';
            // Use black background for L2, route color for L1
            const badgeColor = lineNumber === 'L2' ? '#000' : routeColor;
            const lengthStr = train.length === 5 ? ' <small>(5 coches)</small>' : '';
            let delayHtml = '';
            if (train.delay_msg) {
                const isLate = train.delay_msg.includes('+');
                const color = isLate ? '#cc0000' : '#2e7d32';
                delayHtml = `<span style="color: ${color}; font-size: 0.85em; margin-left: 5px;">(${train.delay_msg})</span>`;
            }
            content += `
                <div class="station-list-item" style="padding: 12px 0;">
                    <div style="display:flex; flex-direction:column; flex: 1;">
                        <div style="display:flex; align-items:center;">
                            <span style="background:${badgeColor}; color:white; padding:2px 6px; border-radius:4px; font-size:0.8em; margin-right:8px; font-weight:bold;">${lineNumber}</span>
                            <span style="font-weight:600;">${train.destination_name} ${lengthStr}</span>
                        </div>
                        <div style="font-size:0.85em; color:#666; margin-top:4px;">
                             Salida: ${this.formatTime(train.arrival_time)}
                        </div>
                    </div>
                    <div style="text-align: right; min-width: 70px;">
                        <div style="font-size: 1.2em; font-weight: bold; color: var(--primary-color);">
                            ${train.minutes_until}'
                        </div>
                        ${delayHtml}
                    </div>
                </div>
            `;
        });
        content += '</div>';
        return content;
    }
    updateStationPanelContent(stopId, stopName, result) {
        // This is called by refresh loop or initial show
        // Logic mainly in renderStationContent
    }
    refreshStationPopup() {
        if (!this.activePanel || this.activePanel.type !== 'station') return;
        const { id } = this.activePanel; // stopId
        const stop = this.gtfsData.stopsById.get(id);
        if (!stop) return;
        const result = this.simulator.getUpcomingTrainsForStation(id, this.currentTime, 45);
        this.panelContent.innerHTML = this.renderStationContent(result);
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
        if (this.activePanel && this.activePanel.type === 'station') {
            this.refreshStationPopup();
        }
    }
}
export default MapRenderer;