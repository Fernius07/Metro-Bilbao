import CONFIG from './config.js';

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

    async loadAll() {
        const files = [
            'agency.txt', 'stops.txt', 'routes.txt', 'trips.txt',
            'stop_times.txt', 'shapes.txt', 'calendar.txt', 'calendar_dates.txt'
        ];

        const promises = files.map(file => this.fetchAndParse(file));
        const results = await Promise.allSettled(promises);

        // Check for critical failures
        const criticalFiles = ['stops.txt', 'routes.txt', 'trips.txt', 'stop_times.txt', 'shapes.txt'];
        const failedCritical = results.filter((r, i) => r.status === 'rejected' && criticalFiles.includes(files[i]));

        if (failedCritical.length > 0) {
            throw new Error(`Failed to load critical GTFS files: ${failedCritical.map(f => f.reason).join(', ')}`);
        }

        this.processData();
        return this.processed;
    }

    async fetchAndParse(filename) {
        try {
            const response = await fetch(`${CONFIG.GTFS_FOLDER}${filename}`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const text = await response.text();
            const name = filename.replace('.txt', '');
            this.data[name] = this.parseCSV(text);
            console.log(`Loaded ${filename}: ${this.data[name].length} records`);
        } catch (e) {
            console.warn(`Could not load ${filename}:`, e);
            // Return empty array for non-critical files
            const name = filename.replace('.txt', '');
            this.data[name] = [];
        }
    }

    parseCSV(text) {
        if (!text || !text.trim()) return [];

        const lines = text.split(/\r?\n/).filter(l => l.trim());
        if (lines.length < 2) return [];

        const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
        const result = [];

        for (let i = 1; i < lines.length; i++) {
            // Simple CSV split handling quotes roughly (assuming no commas inside quotes for this simple parser)
            // For robust GTFS, a regex or state machine is better, but this suffices for standard simple GTFS
            // Let's use a slightly better regex for splitting
            const row = lines[i];
            // Regex to match CSV fields, handling quotes
            const matches = row.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g);
            // Fallback for simple split if regex fails or complex cases
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

    processData() {
        console.time('GTFS Processing');

        // 1. Index Stops
        // Filter stops starting with number
        this.data.stops.forEach(stop => {
            if (!/^\d/.test(stop.stop_name)) {
                this.processed.stopsById.set(stop.stop_id, {
                    id: stop.stop_id,
                    name: stop.stop_name,
                    lat: parseFloat(stop.stop_lat),
                    lon: parseFloat(stop.stop_lon)
                });
            }
        });

        // 2. Index Routes
        this.data.routes.forEach(route => {
            this.processed.routesById.set(route.route_id, {
                id: route.route_id,
                short_name: route.route_short_name,
                long_name: route.route_long_name,
                color: route.route_color ? `#${route.route_color}` : CONFIG.COLORS.primary,
                text_color: route.route_text_color ? `#${route.route_text_color}` : '#ffffff'
            });
        });

        // 3. Process Shapes (Geometry)
        // Group by shape_id and sort by sequence
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

            // Calculate cumulative distance if missing
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

        // 4. Index Trips & Stop Times
        // We need to link trips to shapes and schedules

        // First, group stop_times by trip_id
        const stopTimesByTrip = new Map();
        this.data.stop_times.forEach(st => {
            if (!stopTimesByTrip.has(st.trip_id)) stopTimesByTrip.set(st.trip_id, []);
            stopTimesByTrip.get(st.trip_id).push({
                stop_id: st.stop_id,
                seq: parseInt(st.stop_sequence),
                arrival: this.parseTime(st.arrival_time),
                departure: this.parseTime(st.departure_time),
                shape_dist: st.shape_dist_traveled ? parseFloat(st.shape_dist_traveled) : null
            });
        });

        // Sort stop times
        stopTimesByTrip.forEach(times => times.sort((a, b) => a.seq - b.seq));

        // Create Trip objects
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

            // Project stops onto shape if shape_dist is missing
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

        // 5. Copy calendar data
        this.processed.calendar = this.data.calendar || [];
        this.processed.calendar_dates = this.data.calendar_dates || [];

        console.timeEnd('GTFS Processing');
    }

    // Helper: Haversine distance in meters
    haversine(p1, p2) {
        const R = 6371e3; // metres
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

    // Project stops onto shape to calculate shape_dist_traveled
    projectStopsOntoShape(stopTimes, shape) {
        stopTimes.forEach(st => {
            if (st.shape_dist !== null) return; // Already has distance

            const stop = this.processed.stopsById.get(st.stop_id);
            if (!stop) return;

            // Find closest point on shape
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

    // Helper: Parse HH:MM:SS to seconds from midnight (handles > 24h)
    parseTime(timeStr) {
        if (!timeStr) return 0;
        const parts = timeStr.split(':').map(Number);
        return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
}

export default GTFSParser;
