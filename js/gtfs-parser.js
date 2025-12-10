import CONFIG from './config.js';
/**
 * Clase encargada de leer, analizar y procesar los archivos GTFS raw.
 * Transforma los archivos CSV en estructuras de datos optimizadas para el uso en memoria.
 */
class GTFSParser {
    constructor() {
        this.data = {
            agency: [],
            stops: [],
            routes: [],
            trips: [],
            stop_times: [],
            shapes: [],
            calendar: [],
            calendar_dates: []
        };
        this.processed = {
            stopsById: new Map(),
            routesById: new Map(),
            tripsById: new Map(),
            shapesById: new Map(),
            tripsByShapeId: new Map(),
            calendar: [],
            calendar_dates: []
        };
    }

    /**
     * Carga todos los archivos GTFS necesarios en paralelo.
     * @returns {Promise<Object>} Promesa que resuelve con los datos procesados.
     */
    async loadAll() {
        const files = [
            'agency.txt', 'stops.txt', 'routes.txt', 'trips.txt',
            'stop_times.txt', 'shapes.txt', 'calendar.txt', 'calendar_dates.txt'
        ];
        const promises = files.map(file => this.fetchAndParse(file));
        const results = await Promise.allSettled(promises);
        const criticalFiles = ['stops.txt', 'routes.txt', 'trips.txt', 'stop_times.txt', 'shapes.txt'];
        const failedCritical = results.filter((r, i) => r.status === 'rejected' && criticalFiles.includes(files[i]));
        if (failedCritical.length > 0) {
            throw new Error(`Failed to load critical GTFS files: ${failedCritical.map(f => f.reason).join(', ')}`);
        }
        this.processData();
        return this.processed;
    }
    /**
     * Descarga y analiza un archivo CSV individual.
     * @param {string} filename - Nombre del archivo a cargar (ej. 'stops.txt').
     */
    async fetchAndParse(filename) {
        try {
            const response = await fetch(`${CONFIG.GTFS_FOLDER}${filename}`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const text = await response.text();
            const name = filename.replace('.txt', '');
            this.data[name] = this.parseCSV(text);
            console.log(`Cargado ${filename}: ${this.data[name].length} registros`);
        } catch (e) {
            console.warn(`No se pudo cargar ${filename}:`, e);
            const name = filename.replace('.txt', '');
            this.data[name] = [];
        }
    }

    /**
     * Convierte contenido CSV crudo en un array de objetos.
     * Maneja comillas y limpieza de espacios.
     * @param {string} text - Contenido RAW del archivo CSV.
     * @returns {Array<Object>} Array de objetos con las columnas como claves.
     */
    parseCSV(text) {
        if (!text || !text.trim()) return [];
        const lines = text.split(/\r?\n/).filter(l => l.trim());
        if (lines.length < 2) return [];
        const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
        const result = [];
        for (let i = 1; i < lines.length; i++) {
            const row = lines[i];
            const values = row.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
            if (values.length === headers.length) {
                const obj = {};
                headers.forEach((h, index) => {
                    obj[h] = values[index];
                });
                result.push(obj);
            }
        }
        return result;
    }
    /**
     * Procesa los datos raw para generar estructuras optimizadas.
     * Crea mapas de búsqueda rápida por ID y ordena secuencias de paradas y formas.
     */
    processData() {
        console.time('GTFS Processing');
        this.processed.stationCodes = new Map();
        this.data.stops.forEach(stop => {
            if (stop.stop_code && stop.stop_code.length === 3) {
                this.processed.stationCodes.set(stop.stop_id, stop.stop_code);
            }
            if (!/^\d/.test(stop.stop_name)) {
                this.processed.stopsById.set(stop.stop_id, {
                    id: stop.stop_id,
                    name: stop.stop_name,
                    lat: parseFloat(stop.stop_lat),
                    lon: parseFloat(stop.stop_lon)
                });
            }
        });
        this.data.routes.forEach(route => {
            this.processed.routesById.set(route.route_id, {
                id: route.route_id,
                short_name: route.route_short_name,
                long_name: route.route_long_name,
                color: route.route_color ? `#${route.route_color}` : CONFIG.COLORS.primary,
                text_color: route.route_text_color ? `#${route.route_text_color}` : '#ffffff'
            });
        });
        const shapesRaw = new Map();
        this.data.shapes.forEach(s => {
            if (!shapesRaw.has(s.shape_id)) shapesRaw.set(s.shape_id, []);
            shapesRaw.get(s.shape_id).push({
                lat: parseFloat(s.shape_pt_lat),
                lon: parseFloat(s.shape_pt_lon),
                seq: parseInt(s.shape_pt_sequence),
                dist: s.shape_dist_traveled ? parseFloat(s.shape_dist_traveled) : null
            });
        });
        shapesRaw.forEach((points, id) => {
            points.sort((a, b) => a.seq - b.seq);
            if (points[0].dist === null) {
                let totalDist = 0;
                points[0].dist = 0;
                for (let i = 1; i < points.length; i++) {
                    const d = this.haversine(points[i - 1], points[i]);
                    totalDist += d;
                    points[i].dist = totalDist;
                }
            }
            this.processed.shapesById.set(id, {
                id: id,
                points: points,
                totalDistance: points[points.length - 1].dist
            });
        });
        const stopTimesByTrip = new Map();
        this.processed.stopUsageCounts = new Map();

        this.data.stop_times.forEach(st => {
            if (!stopTimesByTrip.has(st.trip_id)) stopTimesByTrip.set(st.trip_id, []);
            stopTimesByTrip.get(st.trip_id).push({
                stop_id: st.stop_id,
                seq: parseInt(st.stop_sequence),
                arrival: this.parseTime(st.arrival_time),
                departure: this.parseTime(st.departure_time),
                shape_dist: st.shape_dist_traveled ? parseFloat(st.shape_dist_traveled) : null
            });

            const currentCount = this.processed.stopUsageCounts.get(st.stop_id) || 0;
            this.processed.stopUsageCounts.set(st.stop_id, currentCount + 1);
        });
        stopTimesByTrip.forEach(times => times.sort((a, b) => a.seq - b.seq));
        this.data.trips.forEach(trip => {
            const stopTimes = stopTimesByTrip.get(trip.trip_id);
            if (!stopTimes) return;
            const tripObj = {
                id: trip.trip_id,
                route_id: trip.route_id,
                service_id: trip.service_id,
                shape_id: trip.shape_id,
                direction_id: trip.direction_id,
                stop_times: stopTimes
            };
            this.processed.tripsById.set(trip.trip_id, tripObj);
            if (trip.shape_id && stopTimes.some(st => st.shape_dist === null)) {
                const shape = this.processed.shapesById.get(trip.shape_id);
                if (shape) {
                    this.projectStopsOntoShape(stopTimes, shape);
                }
            }
            if (trip.shape_id) {
                if (!this.processed.tripsByShapeId.has(trip.shape_id)) {
                    this.processed.tripsByShapeId.set(trip.shape_id, []);
                }
                this.processed.tripsByShapeId.get(trip.shape_id).push(tripObj);
            }
        });
        this.processed.calendar = this.data.calendar || [];
        this.processed.calendar_dates = this.data.calendar_dates || [];
        console.timeEnd('GTFS Processing');
    }
    /**
     * Calcula la distancia en metros entre dos coordenadas geográficas utilizando la fórmula de Haversine.
     * @param {Object} p1 - Punto 1 {lat, lon}.
     * @param {Object} p2 - Punto 2 {lat, lon}.
     * @returns {number} Distancia en metros.
     */
    haversine(p1, p2) {
        const R = 6371e3;
        const φ1 = p1.lat * Math.PI / 180;
        const φ2 = p2.lat * Math.PI / 180;
        const Δφ = (p2.lat - p1.lat) * Math.PI / 180;
        const Δλ = (p2.lon - p1.lon) * Math.PI / 180;
        const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    /**
     * Proyecta las paradas en la forma (shape) para determinar la distancia recorrida a lo largo de la ruta.
     * Esencial para interpolar la posición del tren basándose en la distancia y no solo en el tiempo.
     * @param {Array} stopTimes - Array de horarios de parada.
     * @param {Object} shape - Objeto shape procesado.
     */
    projectStopsOntoShape(stopTimes, shape) {
        stopTimes.forEach(st => {
            if (st.shape_dist !== null) return;
            const stop = this.processed.stopsById.get(st.stop_id);
            if (!stop) return;
            let minDist = Infinity;
            let closestShapeDist = 0;
            shape.points.forEach(point => {
                const dist = this.haversine(stop, point);
                if (dist < minDist) {
                    minDist = dist;
                    closestShapeDist = point.dist;
                }
            });
            st.shape_dist = closestShapeDist;
        });
    }

    /**
     * Convierte una cadena de tiempo 'HH:MM:SS' a segundos totales desde la medianoche.
     * @param {string} timeStr - Hora en formato texto.
     * @returns {number} Segundos desde medianoche.
     */
    parseTime(timeStr) {
        if (!timeStr) return 0;
        const parts = timeStr.split(':').map(Number);
        return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
}
export default GTFSParser;