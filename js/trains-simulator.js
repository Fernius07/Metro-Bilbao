class TrainSimulator {
    constructor(gtfsData) {
        this.gtfs = gtfsData;
        this.activeTrains = new Map();
    }

    update(now) {
        const secondsFromMidnight = this.getSecondsFromMidnight(now);
        const dateStr = this.getDateString(now);
        const dayOfWeek = now.getDay();

        const activeServices = this.getActiveServices(dateStr, dayOfWeek);

        const currentTrips = [];
        for (const trip of this.gtfs.tripsById.values()) {
            if (!activeServices.has(trip.service_id)) continue;

            const startTime = trip.stop_times[0].departure;
            const endTime = trip.stop_times[trip.stop_times.length - 1].arrival;

            if (secondsFromMidnight >= startTime && secondsFromMidnight <= endTime) {
                currentTrips.push(trip);
            }
        }

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

        if (this.gtfs.calendar && this.gtfs.calendar.length > 0) {
            this.gtfs.calendar.forEach(cal => {
                if (cal[dayName] === '1' && dateStr >= cal.start_date && dateStr <= cal.end_date) {
                    active.add(cal.service_id);
                }
            });
        }

        if (this.gtfs.calendar_dates && this.gtfs.calendar_dates.length > 0) {
            this.gtfs.calendar_dates.forEach(cd => {
                if (cd.date === dateStr) {
                    if (cd.exception_type === '1') active.add(cd.service_id);
                    else if (cd.exception_type === '2') active.delete(cd.service_id);
                }
            });
        }

        return active;
    }

    calculateTrainPosition(trip, time) {
        const stopTimes = trip.stop_times;
        let prevStop = null;
        let nextStop = null;

        for (let i = 0; i < stopTimes.length - 1; i++) {
            if (time >= stopTimes[i].departure && time < stopTimes[i + 1].arrival) {
                prevStop = stopTimes[i];
                nextStop = stopTimes[i + 1];
                break;
            } else if (time >= stopTimes[i].arrival && time < stopTimes[i].departure) {
                const stopInfo = this.gtfs.stopsById.get(stopTimes[i].stop_id);
                const lastStop = stopTimes[stopTimes.length - 1];
                const destinationInfo = this.gtfs.stopsById.get(lastStop.stop_id);
                return {
                    trip_id: trip.id,
                    route_id: trip.route_id,
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

        const shape = this.gtfs.shapesById.get(trip.shape_id);
        if (!shape) {
            const p1 = this.gtfs.stopsById.get(prevStop.stop_id);
            const p2 = this.gtfs.stopsById.get(nextStop.stop_id);
            const progress = (time - prevStop.departure) / (nextStop.arrival - prevStop.departure);
            return {
                trip_id: trip.id,
                route_id: trip.route_id,
                lat: p1.lat + (p2.lat - p1.lat) * progress,
                lon: p1.lon + (p2.lon - p1.lon) * progress,
                status: 'moving',
                next_stop_name: this.gtfs.stopsById.get(nextStop.stop_id).name
            };
        }

        const pA = this.gtfs.stopsById.get(prevStop.stop_id);
        const pB = this.gtfs.stopsById.get(nextStop.stop_id);

        const lastStop = trip.stop_times[trip.stop_times.length - 1];
        const destinationInfo = this.gtfs.stopsById.get(lastStop.stop_id);

        let distA = prevStop.shape_dist;
        let distB = nextStop.shape_dist;

        if (shape && distA !== null && distB !== null) {
            const totalTime = nextStop.arrival - prevStop.departure;
            const elapsed = time - prevStop.departure;
            const currentDist = distA + (distB - distA) * (elapsed / totalTime);

            const position = this.getPointAtDistance(shape, currentDist, trip);
            if (position) {
                position.next_stop_name = pB.name;
                position.next_stop_arrival = nextStop.arrival;
                position.destination_name = destinationInfo.name;
                position.destination_arrival = lastStop.arrival;
                return position;
            }
        }

        const progress = (time - prevStop.departure) / (nextStop.arrival - prevStop.departure);
        return {
            trip_id: trip.id,
            route_id: trip.route_id,
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
        const points = shape.points;

        for (let i = 0; i < points.length - 1; i++) {
            if (targetDist >= points[i].dist && targetDist <= points[i + 1].dist) {
                const segLen = points[i + 1].dist - points[i].dist;
                const fraction = (targetDist - points[i].dist) / (segLen || 1);
                return {
                    trip_id: trip.id,
                    route_id: trip.route_id,
                    lat: points[i].lat + (points[i + 1].lat - points[i].lat) * fraction,
                    lon: points[i].lon + (points[i + 1].lon - points[i].lon) * fraction,
                    status: 'moving',
                    next_stop_name: '...'
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

    getUpcomingTrainsForStation(stopId, now, windowMinutes = 45) {
        const secondsFromMidnight = this.getSecondsFromMidnight(now);
        const dateStr = this.getDateString(now);
        const dayOfWeek = now.getDay();
        const windowSeconds = windowMinutes * 60;
        const endTime = secondsFromMidnight + windowSeconds;

        const activeServices = this.getActiveServices(dateStr, dayOfWeek);
        const upcomingTrains = [];

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

        isTerminal = terminalCheckCount > 0 && (terminalMatchCount / terminalCheckCount) > 0.3;

        for (const trip of this.gtfs.tripsById.values()) {
            if (!activeServices.has(trip.service_id)) continue;

            const stopIndex = trip.stop_times.findIndex(st => st.stop_id === stopId);
            if (stopIndex === -1) continue;

            const stopTime = trip.stop_times[stopIndex];
            const isLastStop = stopIndex === trip.stop_times.length - 1;

            if (isTerminal && !isLastStop) {
                continue;
            }

            let relevantTime;
            if (isTerminal && stopIndex === 0) {
                relevantTime = stopTime.departure;
            } else {
                relevantTime = stopTime.arrival;
            }

            if (relevantTime >= secondsFromMidnight && relevantTime <= endTime) {
                const minutesUntil = Math.round((relevantTime - secondsFromMidnight) / 60);

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

        upcomingTrains.sort((a, b) => a.arrival_time - b.arrival_time);

        return {
            trains: upcomingTrains,
            is_terminal: isTerminal
        };
    }
}

export default TrainSimulator;
