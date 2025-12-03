class TrainSimulator {
    constructor(gtfsData) {
        this.gtfs = gtfsData;
        this.activeTrains = new Map(); // trip_id -> { lat, lon, route_id, next_stop, ... }
    }

    // Get active trains for a specific timestamp (Date object)
    update(now) {
        const secondsFromMidnight = this.getSecondsFromMidnight(now);
        const dateStr = this.getDateString(now); // YYYYMMDD
        const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon...

        // 1. Identify active services for today
        const activeServices = this.getActiveServices(dateStr, dayOfWeek);

        // 2. Find trips running at this time
        const currentTrips = [];

        // Optimization: iterate all trips is slow if many. 
        // In a real app, we'd index trips by start/end time.
        // For client-side JS with reasonable GTFS size, iteration is okay-ish.
        for (const trip of this.gtfs.tripsById.values()) {
            if (!activeServices.has(trip.service_id)) continue;

            const startTime = trip.stop_times[0].departure;
            const endTime = trip.stop_times[trip.stop_times.length - 1].arrival;

            if (secondsFromMidnight >= startTime && secondsFromMidnight <= endTime) {
                currentTrips.push(trip);
            }
        }

        // 3. Calculate positions
        const newPositions = new Map();

        for (const trip of currentTrips) {
            const position = this.calculateTrainPosition(trip, secondsFromMidnight);
            if (position) {
                newPositions.set(trip.id, position);
            }
        }

        this.activeTrains = newPositions;
        return Array.from(this.activeTrains.values());
    }

    getActiveServices(dateStr, dayOfWeek) {
        const active = new Set();
        const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const dayName = days[dayOfWeek];

        // Check calendar.txt
        if (this.gtfs.calendar && this.gtfs.calendar.length > 0) {
            this.gtfs.calendar.forEach(cal => {
                if (cal[dayName] === '1' && dateStr >= cal.start_date && dateStr <= cal.end_date) {
                    active.add(cal.service_id);
                }
            });
        }

        // Check calendar_dates.txt (exceptions)
        if (this.gtfs.calendar_dates && this.gtfs.calendar_dates.length > 0) {
            this.gtfs.calendar_dates.forEach(cd => {
                if (cd.date === dateStr) {
                    if (cd.exception_type === '1') active.add(cd.service_id); // Add
                    else if (cd.exception_type === '2') active.delete(cd.service_id); // Remove
                }
            });
        }

        return active;
    }

    calculateTrainPosition(trip, time) {
        // Find current segment
        const stopTimes = trip.stop_times;
        let prevStop = null;
        let nextStop = null;

        for (let i = 0; i < stopTimes.length - 1; i++) {
            if (time >= stopTimes[i].departure && time < stopTimes[i + 1].arrival) {
                prevStop = stopTimes[i];
                nextStop = stopTimes[i + 1];
                break;
            } else if (time >= stopTimes[i].arrival && time < stopTimes[i].departure) {
                // Train is dwelling at station
                const stopInfo = this.gtfs.stopsById.get(stopTimes[i].stop_id);
                const lastStop = stopTimes[stopTimes.length - 1];
                const destinationInfo = this.gtfs.stopsById.get(lastStop.stop_id);
                return {
                    trip_id: trip.id,
                    route_id: trip.route_id,
                    service_number: trip.service_number || '',
                    lat: stopInfo.lat,
                    lon: stopInfo.lon,
                    status: 'dwelling',
                    stop_name: stopInfo.name,
                    next_stop_name: this.gtfs.stopsById.get(stopTimes[i + 1].stop_id).name,
                    next_stop_arrival: stopTimes[i + 1].arrival,
                    destination_name: destinationInfo.name,
                    destination_arrival: lastStop.arrival
                };
            }
        }

        if (!prevStop || !nextStop) return null;

        // Interpolate between stops
        // We need to map stop times to shape distances
        // If shape_dist_traveled is missing in stop_times, we estimate or project.
        // For this implementation, let's assume we have shape_dist or we project simply.
        // Fallback: Linear interpolation between stop coordinates (straight line) if no shape, 
        // but we have shape.

        const shape = this.gtfs.shapesById.get(trip.shape_id);
        if (!shape) {
            // Fallback to straight line
            const p1 = this.gtfs.stopsById.get(prevStop.stop_id);
            const p2 = this.gtfs.stopsById.get(nextStop.stop_id);
            const progress = (time - prevStop.departure) / (nextStop.arrival - prevStop.departure);
            return {
                trip_id: trip.id,
                route_id: trip.route_id,
                service_number: trip.service_number || '',
                lat: p1.lat + (p2.lat - p1.lat) * progress,
                lon: p1.lon + (p2.lon - p1.lon) * progress,
                status: 'moving',
                next_stop_name: this.gtfs.stopsById.get(nextStop.stop_id).name
            };
        }

        // Interpolate along shape
        // We need the distance along shape for prevStop and nextStop.
        // If not in GTFS, we'd need to project stops onto shape. 
        // For simplicity in this "static" generator, let's assume simple linear progress between stops
        // but mapped to the shape path.

        // 1. Find shape points corresponding to stops (naive approach: closest point)
        // Optimization: In a real app, pre-calculate stop indices on shape.
        // Here, let's assume we just walk the shape for now or use straight line if too complex for client-side JS without pre-processing.
        // BETTER APPROACH:
        // Calculate total time t_total = next_arrival - prev_departure
        // elapsed = time - prev_departure
        // fraction = elapsed / t_total
        // We want point at fraction of distance between stop A and stop B along the shape.

        // Let's assume we know the shape segment indices. 
        // If we don't, straight line is safer than broken shape matching.
        // BUT the prompt asks for "following the geometry".
        // Let's try to find the sub-segment of the shape.

        // Simplified Shape Interpolation:
        // Get lat/lon of A and B. Find their closest indices in shape points.
        // Walk points between indexA and indexB.

        const pA = this.gtfs.stopsById.get(prevStop.stop_id);
        const pB = this.gtfs.stopsById.get(nextStop.stop_id);

        // Get destination info
        const lastStop = trip.stop_times[trip.stop_times.length - 1];
        const destinationInfo = this.gtfs.stopsById.get(lastStop.stop_id);

        // Use shape-based interpolation if shape exists
        // (shape_dist should now be calculated for all stops via projection)
        let distA = prevStop.shape_dist;
        let distB = nextStop.shape_dist;

        if (shape && distA !== null && distB !== null) {
            const totalTime = nextStop.arrival - prevStop.departure;
            const elapsed = time - prevStop.departure;
            const currentDist = distA + (distB - distA) * (elapsed / totalTime);

            // Find point at currentDist in shape
            const position = this.getPointAtDistance(shape, currentDist, trip);
            if (position) {
                position.service_number = trip.service_number || '';
                position.next_stop_name = pB.name;
                position.next_stop_arrival = nextStop.arrival;
                position.destination_name = destinationInfo.name;
                position.destination_arrival = lastStop.arrival;
                return position;
            }
        }

        // Fallback: Straight line (if no shape or projection failed)
        const progress = (time - prevStop.departure) / (nextStop.arrival - prevStop.departure);
        return {
            trip_id: trip.id,
            route_id: trip.route_id,
            service_number: trip.service_number || '',
            lat: pA.lat + (pB.lat - pA.lat) * progress,
            lon: pA.lon + (pB.lon - pA.lon) * progress,
            status: 'moving',
            next_stop_name: pB.name,
            next_stop_arrival: nextStop.arrival,
            destination_name: destinationInfo.name,
            destination_arrival: lastStop.arrival
        };
    }

    getPointAtDistance(shape, targetDist, trip) {
        // Binary search or linear scan shape points
        const points = shape.points;

        // Find segment containing targetDist
        for (let i = 0; i < points.length - 1; i++) {
            if (targetDist >= points[i].dist && targetDist <= points[i + 1].dist) {
                const segLen = points[i + 1].dist - points[i].dist;
                const fraction = (targetDist - points[i].dist) / (segLen || 1);
                return {
                    trip_id: trip.id,
                    route_id: trip.route_id,
                    service_number: trip.service_number || '',
                    lat: points[i].lat + (points[i + 1].lat - points[i].lat) * fraction,
                    lon: points[i].lon + (points[i + 1].lon - points[i].lon) * fraction,
                    status: 'moving',
                    next_stop_name: '...' // Need to pass context if we want this
                };
            }
        }
        return null;
    }

    getSecondsFromMidnight(date) {
        return date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds();
    }

    getDateString(date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}${m}${d}`;
    }

    // Get upcoming trains for a specific station within a time window
    getUpcomingTrainsForStation(stopId, now, windowMinutes = 45) {
        const secondsFromMidnight = this.getSecondsFromMidnight(now);
        const dateStr = this.getDateString(now);
        const dayOfWeek = now.getDay();
        const windowSeconds = windowMinutes * 60;
        const endTime = secondsFromMidnight + windowSeconds;

        const activeServices = this.getActiveServices(dateStr, dayOfWeek);
        const upcomingTrains = [];

        // Check if this station is a terminal (destination) station
        let isTerminal = false;
        let terminalCheckCount = 0;
        let terminalMatchCount = 0;

        for (const trip of this.gtfs.tripsById.values()) {
            if (!activeServices.has(trip.service_id)) continue;

            const lastStop = trip.stop_times[trip.stop_times.length - 1];
            terminalCheckCount++;
            if (lastStop.stop_id === stopId) {
                terminalMatchCount++;
            }
        }

        // If more than 30% of trips end at this station, consider it a terminal
        isTerminal = terminalCheckCount > 0 && (terminalMatchCount / terminalCheckCount) > 0.3;

        for (const trip of this.gtfs.tripsById.values()) {
            if (!activeServices.has(trip.service_id)) continue;

            // Find this stop in the trip
            const stopIndex = trip.stop_times.findIndex(st => st.stop_id === stopId);
            if (stopIndex === -1) continue;

            const stopTime = trip.stop_times[stopIndex];
            const isLastStop = stopIndex === trip.stop_times.length - 1;

            // For terminal stations, show departing trains (first stop of trips)
            // For regular stations, show arriving trains
            if (isTerminal && !isLastStop) {
                // Skip trains that don't end here
                continue;
            }

            let relevantTime;
            if (isTerminal && stopIndex === 0) {
                // Departing train - use departure time
                relevantTime = stopTime.departure;
            } else {
                // Arriving train - use arrival time
                relevantTime = stopTime.arrival;
            }

            // Check if within time window
            if (relevantTime >= secondsFromMidnight && relevantTime <= endTime) {
                const minutesUntil = Math.round((relevantTime - secondsFromMidnight) / 60);

                // Get destination
                const lastStop = trip.stop_times[trip.stop_times.length - 1];
                const destinationInfo = this.gtfs.stopsById.get(lastStop.stop_id);

                upcomingTrains.push({
                    trip_id: trip.id,
                    route_id: trip.route_id,
                    destination_name: destinationInfo ? destinationInfo.name : 'Unknown',
                    arrival_time: relevantTime,
                    minutes_until: minutesUntil,
                    is_departing: isTerminal && stopIndex === 0
                });
            }
        }

        // Sort by arrival time
        upcomingTrains.sort((a, b) => a.arrival_time - b.arrival_time);

        return {
            trains: upcomingTrains,
            is_terminal: isTerminal
        };
    }
}

export default TrainSimulator;
