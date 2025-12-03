import CONFIG from './config.js';

class GTFSParser {
    constructor() {
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
        try {
            console.time('GTFS JSON Loading');

            // Load pre-processed JSON data
            const response = await fetch(`${CONFIG.GTFS_FOLDER}gtfs-data.json`);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: Failed to load gtfs-data.json`);
            }

            const data = await response.json();
            console.timeEnd('GTFS JSON Loading');

            console.time('GTFS Data Conversion');

            // Convert plain objects back to Maps
            this.processed.stopsById = new Map(Object.entries(data.stopsById));
            this.processed.routesById = new Map(Object.entries(data.routesById));
            this.processed.tripsById = new Map(Object.entries(data.tripsById));
            this.processed.shapesById = new Map(Object.entries(data.shapesById));
            this.processed.tripsByShapeId = new Map(Object.entries(data.tripsByShapeId));
            this.processed.calendar = data.calendar;
            this.processed.calendar_dates = data.calendar_dates;

            console.timeEnd('GTFS Data Conversion');

            // Log statistics
            console.log(`✓ Loaded ${this.processed.stopsById.size} stops`);
            console.log(`✓ Loaded ${this.processed.routesById.size} routes`);
            console.log(`✓ Loaded ${this.processed.tripsById.size} trips`);
            console.log(`✓ Loaded ${this.processed.shapesById.size} shapes`);

            return this.processed;

        } catch (e) {
            console.error('Error loading GTFS data:', e);
            throw new Error(`Failed to load GTFS data: ${e.message}`);
        }
    }
}

export default GTFSParser;
