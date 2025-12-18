/**
 * MapRenderer: Gestiona la representación visual de la red ferroviaria y trenes.
 * Utiliza Leaflet.js para el renderizado del mapa y gestiona capas SVG para
 * el movimiento fluido de los marcadores de tren.
 */
class MapRenderer {
    /**
     * Inicializa el motor de mapas Leaflet, configura las capas y los contenedores de UI.
     * @param {string} containerId - El ID del elemento HTML donde se renderizará el mapa.
     */
    constructor(containerId) {
        // Inicialización del objeto principal de Leaflet
        this.map = L.map(containerId, {
            center: CONFIG.MAP_CENTER,
            zoom: CONFIG.MAP_ZOOM,
            zoomControl: false,
            attributionControl: false
        });

        // Creamos un panel SVG específico para el renderizado fluido de trenes
        this.map.createPane('trainsPane');
        this.map.getPane('trainsPane').style.zIndex = 650;
        this.trainsRenderer = L.svg({ pane: 'trainsPane' });

        // Definición de las capas organizadas por tipo de dato
        this.layers = {
            base: {
                standard: L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
                    attribution: '&copy; OpenStreetMap &copy; CARTO'
                }),
                satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
                    attribution: '&copy; Esri'
                })
            },
            shapes: L.layerGroup().addTo(this.map), // Geometría de las líneas ferroviarias
            stops: L.layerGroup().addTo(this.map),  // Iconos de estaciones
            trains: L.layerGroup().addTo(this.map)  // Marcadores dinámicos de trenes
        };

        this.layers.base.standard.addTo(this.map);
        L.control.zoom({ position: 'bottomright' }).addTo(this.map);

        // Referencias internas para la gestión de estado de la UI
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

        // Manejador global para cerrar paneles al hacer click en el mapa base
        this.map.on('click', (e) => {
            if (e.originalEvent.target.closest('.info-panel')) return;
            this.closeInfoPanel();
        });

        this.searchInput = document.getElementById('station-search');
        this.searchResults = document.getElementById('search-results');
        this.setupSearch();

        this.followedTrainId = null;
        this.map.on('dragstart', () => {
            this.followedTrainId = null; // Detener seguimiento si el usuario mueve el mapa
        });
    }
    /**
     * Alterna entre temas visuales (claro/oscuro).
     * @param {string} theme - 'dark' o 'light'.
     */
    setTheme(theme) {
        if (theme === 'dark') {
            this.layers.base.standard.setUrl('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png');
        } else {
            this.layers.base.standard.setUrl('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png');
        }
    }
    /**
     * Alterna la visualización entre mapa estándar y satélite.
     * @param {string} type - 'satellite' u otro para estándar.
     */
    toggleLayer(type) {
        if (type === 'satellite') {
            this.map.removeLayer(this.layers.base.standard);
            this.map.addLayer(this.layers.base.satellite);
        } else {
            this.map.removeLayer(this.layers.base.satellite);
            this.map.addLayer(this.layers.base.standard);
        }
    }
    /**
     * Renderiza los elementos estáticos del GTFS: líneas (shapes) y estaciones (stops).
     * @param {Object} processedData - Objeto con datos GTFS ya procesados por el parser.
     */
    renderStaticData(processedData) {
        this.routesById = processedData.routesById;
        this.shapesById = processedData.shapesById;
        const shapesByRouteDir = new Map();

        // Determinar qué geometría (shapes) dibujar basándose en los viajes activos
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

        // Dibujo de polilíneas para representar las vías férreas
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

        // Dibujo de iconos personalizados de Metro para cada estación
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
    /**
     * Determina el número de línea (L1 o L2) basándose en el nombre de destino.
     * @param {string} destinationName - Nombre de la terminal.
     * @returns {string} ID visual de la línea.
     */
    getLineNumber(destinationName) {
        if (destinationName && (destinationName.includes('Kabiezes') || destinationName.includes('Basauri'))) {
            return 'L2';
        }
        return 'L1';
    }
    /**
     * Actualiza la posición y visualización de los trenes en el mapa.
     * Gestiona la creación, movimiento y eliminación de marcadores de tren.
     * @param {Array} trains - Lista de objetos de tren actualizados.
     */
    updateTrains(trains) {
        const activeIds = new Set(trains.map(t => t.trip_id));
        for (const [id, marker] of this.trainMarkers) {
            if (!activeIds.has(id)) {
                this.layers.trains.removeLayer(marker);
                this.trainMarkers.delete(id);
                if (this.activePanel && this.activePanel.type === 'train' && this.activePanel.id === id) {
                    this.closeInfoPanel();
                }
                if (this.followedTrainId === id) {
                    this.followedTrainId = null;
                }
            }
        }

        trains.forEach(train => {
            const isSelected = this.activePanel && this.activePanel.type === 'train' && this.activePanel.id === train.trip_id;
            const radius = isSelected ? 12 : 7;

            // Gestionar seguimiento del mapa (Follow Train)
            if (this.followedTrainId === train.trip_id) {
                this.map.panTo([train.lat, train.lon], { animate: true, duration: 0.5 });
            }

            if (this.trainMarkers.has(train.trip_id)) {
                const marker = this.trainMarkers.get(train.trip_id);
                marker.setLatLng([train.lat, train.lon]);
                marker.setRadius(radius);
                const lineNumber = this.getLineNumber(train.destination_name);
                marker.setTooltipContent(`${lineNumber} | ${train.destination_name || '...'}`);
                marker.trainData = train;
                if (isSelected) {
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
                    radius: radius,
                    fillColor: color,
                    color: '#fff',
                    weight: 2,
                    fillOpacity: 1,
                    className: 'train-marker',
                    pane: 'trainsPane',
                    renderer: this.trainsRenderer
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
    /**
     * Muestra el panel lateral informativo (info-panel) con contenido dinámico.
     * @param {string} title - Título del panel.
     * @param {string} subtitle - Subtítulo descriptivo.
     * @param {string} contentHtml - Contenido en formato HTML.
     * @param {string} type - Tipo de panel ('train' o 'station').
     * @param {string} id - ID del objeto seleccionado.
     */
    openInfoPanel(title, subtitle, contentHtml, type, id) {
        if (!this.panelElement) return;
        this.panelTitle.textContent = title;
        this.panelSubtitle.textContent = subtitle;
        this.panelContent.innerHTML = contentHtml;

        // Estética condicional según la línea (L2 en negro, L1 en rojo)
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

    /**
     * Cierra el panel lateral y limpia el estado de selección.
     */
    closeInfoPanel() {
        if (!this.panelElement) return;
        this.panelElement.classList.remove('visible');
        document.body.classList.remove('panel-open');
        this.activePanel = null;
    }
    /**
     * Prepara y muestra el panel detallado de un tren seleccionado.
     * @param {Object} train - Datos del tren actualizados.
     */
    showTrainPanel(train) {
        this.followedTrainId = train.trip_id;
        this.updateTrainPanelContent(train);
    }

    /**
     * Actualiza dinámicamente el contenido del panel cuando un tren está seleccionado.
     * Genera la lista de próximas estaciones y tiempos estimados.
     * @param {Object} train - Datos del tren.
     */
    updateTrainPanelContent(train) {
        const lineNumber = this.getLineNumber(train.destination_name);
        const title = `${lineNumber} | ${train.destination_name}`;
        const subtitle = `Tren en servicio`;

        const trip = this.gtfsData.tripsById.get(train.trip_id);
        if (!trip) return;

        const currentTime = this.currentTime ? this.getSecondsFromMidnight(this.currentTime) : 0;

        // Determinar cuál es la siguiente parada lógica basándose en el tiempo y posición
        let nextStopIndex = 0;
        for (let i = 0; i < trip.stop_times.length; i++) {
            const delay = train.delay || 0;
            if (trip.stop_times[i].arrival + delay > currentTime) {
                nextStopIndex = i;
                break;
            }
        }

        // Generación del HTML para la lista de trayecto
        let content = '<div class="station-list">';
        trip.stop_times.forEach((stopTime, index) => {
            // Optimización: solo mostrar paradas recientes y futuras
            if (index < nextStopIndex - 1) return;

            const stopInfo = this.gtfsData.stopsById.get(stopTime.stop_id);
            const isPast = index < nextStopIndex;
            const isNext = index === nextStopIndex;
            const delay = train.delay || 0;
            const adjustedArrival = stopTime.arrival + delay;
            const minutesUntil = Math.round((adjustedArrival - currentTime) / 60);

            // Estilos diferenciales por estado de la parada
            const color = isPast ? '#999' : (isNext ? 'var(--primary-color)' : 'var(--text-color)');
            const fontWeight = isNext ? 'bold' : 'normal';
            const bgColor = isNext ? 'rgba(229, 42, 18, 0.05)' : 'transparent';

            // Visualización de retrasos si existen
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

        // Actualización o creación del panel
        if (this.activePanel && this.activePanel.type === 'train' && this.activePanel.id === train.trip_id) {
            this.panelContent.innerHTML = content;
        } else {
            this.openInfoPanel(title, subtitle, content, 'train', train.trip_id);
        }
    }

    /**
     * Muestra el panel informativo de una estación.
     * @param {string} stopId - ID de la parada GTFS.
     * @param {string} stopName - Nombre legible de la estación.
     */
    showStationPanel(stopId, stopName) {
        if (!this.simulator || !this.currentTime || !this.gtfsData) return;

        // Obtener trenes que llegarán a esta estación en los próximos 45 minutos
        const result = this.simulator.getUpcomingTrainsForStation(stopId, this.currentTime, 45);
        this.openInfoPanel(stopName, 'Próximos trenes', this.renderStationContent(result), 'station', stopId);
    }

    /**
     * Genera el HTML para el panel de información de una estación.
     * Muestra la lista de próximos trenes con sus tiempos estimados y retrasos.
     * @param {Object} result - Resultados calculados por el simulador para la estación.
     * @returns {string} Fragmento HTML listo para insertar.
     */
    renderStationContent(result) {
        if (result.trains.length === 0) {
            return '<div style="padding: 2rem; text-align: center; color: #999;">No hay trenes próximos programados en los próximos minutos.</div>';
        }

        let content = '<div class="station-list">';
        const trainsToShow = result.trains.slice(0, 10); // Limitar a los 10 más próximos

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
                            Llegada: ${this.formatTime(train.arrival_time)}
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
    /**
     * Refresca el contenido del panel de estación si está abierto.
     * Se llama periódicamente para actualizar los tiempos de los próximos trenes.
     */
    refreshStationPopup() {
        if (!this.activePanel || this.activePanel.type !== 'station') return;
        const { id } = this.activePanel;
        const result = this.simulator.getUpcomingTrainsForStation(id, this.currentTime, 45);
        this.panelContent.innerHTML = this.renderStationContent(result);
    }
    /**
     * Calcula los segundos transcurridos desde la medianoche para una fecha dada.
     * @param {Date} date - Objeto fecha.
     * @returns {number} Segundos desde las 00:00:00.
     */
    getSecondsFromMidnight(date) {
        const hours = date.getHours();
        const minutes = date.getMinutes();
        const seconds = date.getSeconds();
        return hours * 3600 + minutes * 60 + seconds;
    }

    /**
     * Formatea segundos desde la medianoche a cadena legible HH:MM.
     * @param {number} secondsFromMidnight - Segundos.
     * @returns {string} Tiempo formateado.
     */
    formatTime(secondsFromMidnight) {
        const hours = Math.floor(secondsFromMidnight / 3600) % 24;
        const minutes = Math.floor((secondsFromMidnight % 3600) / 60);
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
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

    /**
     * Configura los eventos de interacción para la búsqueda de estaciones.
     */
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

        // Cerrar resultados al hacer click fuera del contenedor
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

    /**
     * Realiza la búsqueda de estaciones por nombre.
     * Implementa lógica de filtrado y ordenación por relevancia (popularidad y cercanía alfabética).
     * @param {string} query - Término de búsqueda.
     */
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

    /**
     * Renderiza los resultados de búsqueda en la lista desplegable.
     * @param {Array} results - Lista de estaciones coincidentes.
     */
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

        // Manejador de selección para cada ítem de resultado
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

    /**
     * Se desplaza a una estación seleccionada y abre su panel de información.
     * @param {Object} stop - Datos de la estación seleccionada.
     */
    selectStation(stop) {
        this.searchInput.value = '';
        this.searchResults.classList.remove('visible');

        // Transición de cámara fluida hasta la estación
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