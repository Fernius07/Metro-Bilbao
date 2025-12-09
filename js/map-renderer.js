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
        this.map.createPane('trainsPane');
        this.map.getPane('trainsPane').style.zIndex = 650;
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

        this.searchInput = document.getElementById('station-search');
        this.searchResults = document.getElementById('search-results');
        this.setupSearch();
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
            const icon = L.divIcon({
                className: 'custom-station-marker',
                html: `<div class="station-icon">
                    <img src="assets/Símbolo_del_Metro_de_Bilbao.png" alt="Metro">
                </div>`,
                iconSize: [20, 20],
                iconAnchor: [10, 10],
                popupAnchor: [0, -10]
            });

            const marker = L.marker([stop.lat, stop.lon], { icon: icon });
            marker.bindTooltip(stop.name, {
                direction: 'top',
                offset: [0, -20]
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
                marker.setLatLng([train.lat, train.lon]);
                const lineNumber = this.getLineNumber(train.destination_name);
                marker.setTooltipContent(`${lineNumber} | ${train.destination_name || '...'}`);
                marker.trainData = train;
                if (this.activePanel && this.activePanel.type === 'train' && this.activePanel.id === train.trip_id) {
                    this.updateTrainPanelContent(train);
                }
            } else {
                let color = CONFIG.COLORS.secondary;
                if (this.routesById && this.routesById.has(train.route_id)) {
                    color = this.routesById.get(train.route_id).color;
                }
                const lineNumber = this.getLineNumber(train.destination_name);
                if (lineNumber === 'L2') {
                    color = '#000000';
                }
                const marker = L.circleMarker([train.lat, train.lon], {
                    radius: 7,
                    fillColor: color,
                    color: '#fff',
                    weight: 2,
                    fillOpacity: 1,
                    className: 'train-marker',
                    pane: 'trainsPane'
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
    openInfoPanel(title, subtitle, contentHtml, type, id) {
        if (!this.panelElement) return;
        this.panelTitle.textContent = title;
        this.panelSubtitle.textContent = subtitle;
        this.panelContent.innerHTML = contentHtml;
        if (type === 'train' && title.startsWith('L2')) {
            this.panelTitle.style.color = '#000000';
        } else if (type === 'train' && title.startsWith('L1')) {
            this.panelTitle.style.color = 'var(--primary-color)';
        } else {
            this.panelTitle.style.color = '';
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
            if (index < nextStopIndex - 1) return;
            const stopInfo = this.gtfsData.stopsById.get(stopTime.stop_id);
            const isPast = index < nextStopIndex;
            const isNext = index === nextStopIndex;
            const delay = train.delay || 0;
            const adjustedArrival = stopTime.arrival + delay;
            const minutesUntil = Math.round((adjustedArrival - currentTime) / 60);
            const color = isPast ? '#999' : (isNext ? 'var(--primary-color)' : 'var(--text-color)');
            const fontWeight = isNext ? 'bold' : 'normal';
            const bgColor = isNext ? 'rgba(229, 42, 18, 0.05)' : 'transparent';
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
        if (this.activePanel && this.activePanel.type === 'train' && this.activePanel.id === train.trip_id) {
            this.panelContent.innerHTML = content;
        } else {
            this.openInfoPanel(title, subtitle, content, 'train', train.trip_id);
            setTimeout(() => {
            }, 100);
        }
    }
    showStationPanel(stopId, stopName) {
        if (!this.simulator || !this.currentTime || !this.gtfsData) {
            return;
        }
        const result = this.simulator.getUpcomingTrainsForStation(stopId, this.currentTime, 45);
        this.updateStationPanelContent(stopId, stopName, result);
        this.openInfoPanel(stopName, 'Próximas salidas', this.renderStationContent(result), 'station', stopId);
    }
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
    }
    refreshStationPopup() {
        if (!this.activePanel || this.activePanel.type !== 'station') return;
        const { id } = this.activePanel;
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

    setupSearch() {
        if (!this.searchInput || !this.searchResults) return;

        this.searchInput.addEventListener('input', (e) => {
            const query = e.target.value.trim();
            if (query.length === 0) {
                this.searchResults.classList.remove('visible');
                this.searchResults.innerHTML = '';
                return;
            }
            this.performSearch(query);
        });

        document.addEventListener('click', (e) => {
            if (!e.target.closest('.search-container')) {
                this.searchResults.classList.remove('visible');
            }
        });

        this.searchInput.addEventListener('focus', () => {
            if (this.searchInput.value.trim().length > 0) {
                this.performSearch(this.searchInput.value.trim());
            }
        });
    }

    performSearch(query) {
        if (!this.gtfsData || !this.gtfsData.stopsById) return;

        const normalizedQuery = query.toLowerCase();
        const matches = [];
        const seenNames = new Set();

        const allStops = Array.from(this.gtfsData.stopsById.values());
        const usageCounts = this.gtfsData.stopUsageCounts || new Map();

        allStops.sort((a, b) => {
            const usageA = usageCounts.get(a.id) || 0;
            const usageB = usageCounts.get(b.id) || 0;
            if (usageA !== usageB) {
                return usageB - usageA;
            }
            return a.id.length - b.id.length;
        });

        for (const stop of allStops) {
            if (stop.name.toLowerCase().includes(normalizedQuery)) {
                if (!seenNames.has(stop.name)) {
                    matches.push(stop);
                    seenNames.add(stop.name);
                }
            }
        }

        matches.sort((a, b) => {
            const aName = a.name.toLowerCase();
            const bName = b.name.toLowerCase();
            const aStarts = aName.startsWith(normalizedQuery);
            const bStarts = bName.startsWith(normalizedQuery);
            if (aStarts && !bStarts) return -1;
            if (!aStarts && bStarts) return 1;
            return aName.localeCompare(bName);
        });

        this.displaySearchResults(matches.slice(0, 10));
    }

    displaySearchResults(results) {
        if (results.length === 0) {
            this.searchResults.classList.remove('visible');
            return;
        }

        let content = '';
        results.forEach(stop => {
            content += `
                <div class="search-result-item" data-stop-id="${stop.id}">
                    <div class="station-icon-small">
                        <img src="assets/Símbolo_del_Metro_de_Bilbao.png" alt="M">
                    </div>
                    <span class="station-name">${stop.name}</span>
                </div>
            `;
        });

        this.searchResults.innerHTML = content;
        this.searchResults.classList.add('visible');

        const items = this.searchResults.querySelectorAll('.search-result-item');
        items.forEach(item => {
            item.addEventListener('click', () => {
                const stopId = item.getAttribute('data-stop-id');
                const stop = this.gtfsData.stopsById.get(stopId);
                if (stop) {
                    this.selectStation(stop);
                }
            });
        });
    }

    selectStation(stop) {
        this.searchInput.value = '';
        this.searchResults.classList.remove('visible');

        this.map.flyTo([stop.lat, stop.lon], 16, {
            duration: 1.5,
            easeLinearity: 0.25
        });

        if (stop && stop.id) {
            this.showStationPanel(stop.id, stop.name);
        }
    }
}
export default MapRenderer;