class TrainSimulator {
    constructor(gtfsData, stationCodes) {
        this.gtfs = gtfsData;
        this.activeTrains = new Map();
        this.stationCodes = stationCodes || new Map();
        this.realTimeOffsets = new Map();
        this.trainLengths = new Map();
    }
    update(now) {
        const secondsFromMidnight = this.getSecondsFromMidnight(now);
        const dateStr = this.getDateString(now);
        const dayOfWeek = now.getDay();
        const activeServices = this.getActiveServices(dateStr, dayOfWeek);
        const currentTrips = [];
        for (const trip of this.gtfs.tripsById.values()) {
            if (!activeServices.has(trip.service_id)) continue;
            const offset = this.realTimeOffsets.get(trip.id) || 0;
            const adjustedTime = secondsFromMidnight - offset;
            const startTime = trip.stop_times[0].departure;
            const endTime = trip.stop_times[trip.stop_times.length - 1].arrival;
            if (adjustedTime >= startTime - 300 && adjustedTime <= endTime + 300) {
                currentTrips.push(trip);
            }
        }
        const newPositions = new Map();
        for (const trip of currentTrips) {
            const offset = this.realTimeOffsets.get(trip.id) || 0;
            const position = this.calculateTrainPosition(trip, secondsFromMidnight - offset);
            if (position) {
                position.delay = offset;
                newPositions.set(trip.id, position);
            }
        }
        this.activeTrains = newPositions;
        return Array.from(this.activeTrains.values());
    }
    syncWithRealTime(apiData) {
        if (!apiData) return;
        const now = new Date();
        const secondsFromMidnight = this.getSecondsFromMidnight(now);
        for (const [tripId, trainHelper] of this.activeTrains) {
            const trip = this.gtfs.tripsById.get(tripId);
            if (!trip) continue;
            const nextStopCodeA = this.stationCodes.get(trainHelper.next_stop_id);
            if (!nextStopCodeA) continue;
            const stationInfo = apiData.get(nextStopCodeA);
            if (!stationInfo) continue;
            const destinationName = trainHelper.destination_name;
            let bestMatch = null;
            let minDiff = Infinity;
            let platforms = [];
            if (Array.isArray(stationInfo)) {
                platforms = stationInfo;
            } else if (stationInfo.Trens) {
                platforms = stationInfo.Trens;
            } else {
                Object.values(stationInfo).forEach(arr => {
                    if (Array.isArray(arr)) platforms.push(...arr);
                });
            }
            for (const entry of platforms) {
                if (!this.matchesDestination(entry.Destination, destinationName)) continue;
                let minutes = parseInt(entry.Minutes);
                if (isNaN(minutes)) minutes = 0;
                const apiArrivalSeconds = secondsFromMidnight + (minutes * 60);
                const stopTime = trip.stop_times.find(st => st.stop_id === trainHelper.next_stop_id);
                if (!stopTime) continue;
                const currentOffset = this.realTimeOffsets.get(tripId) || 0;
                const simArrivalSeconds = stopTime.arrival + currentOffset;
                const diff = Math.abs(apiArrivalSeconds - simArrivalSeconds);
                if (diff < 900 && diff < minDiff) {
                    minDiff = diff;
                    bestMatch = {
                        apiArrival: apiArrivalSeconds,
                        scheduledArrival: stopTime.arrival,
                        length: entry.Length || null
                    };
                }
            }
            if (bestMatch) {
                const newOffset = bestMatch.apiArrival - bestMatch.scheduledArrival;
                this.realTimeOffsets.set(tripId, newOffset);
                if (bestMatch.length) {
                    this.trainLengths.set(tripId, bestMatch.length);
                }
            }
        }
    }
    matchesDestination(apiDest, gtfsDest) {
        if (!apiDest || !gtfsDest) return false;
        const normApi = apiDest.toLowerCase().replace('/', ' ');
        const normGtfs = gtfsDest.toLowerCase().replace('/', ' ');
        if (normGtfs.includes(normApi) || normApi.includes(normGtfs)) return true;
        if (normApi.includes('basauri') && normGtfs.includes('basauri')) return true;
        if (normApi.includes('santurtzi') && normGtfs.includes('santurtzi')) return true;
        if (normApi.includes('kabiezes') && normGtfs.includes('kabiezes')) return true;
        if (normApi.includes('plentzia') && normGtfs.includes('plentzia')) return true;
        return false;
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
                    service_number: trip.service_number || '',
                    lat: stopInfo.lat,
                    lon: stopInfo.lon,
                    status: 'dwelling',
                    stop_name: stopInfo.name,
                    next_stop_id: stopTimes[i + 1].stop_id,
                    next_stop_name: this.gtfs.stopsById.get(stopTimes[i + 1].stop_id).name,
                    next_stop_arrival: stopTimes[i + 1].arrival,
                    destination_name: destinationInfo.name,
                    destination_arrival: lastStop.arrival
                };
            }
        }
        if (!prevStop || !nextStop) return null;
        const shape = this.gtfs.shapesById.get(trip.shape_id);
        const p1 = this.gtfs.stopsById.get(prevStop.stop_id);
        const p2 = this.gtfs.stopsById.get(nextStop.stop_id);
        const nextStopInfo = this.gtfs.stopsById.get(nextStop.stop_id);
        const lastStop = trip.stop_times[trip.stop_times.length - 1];
        const destinationInfo = this.gtfs.stopsById.get(lastStop.stop_id);
        if (!shape) {
            const progress = (time - prevStop.departure) / (nextStop.arrival - prevStop.departure);
            return {
                trip_id: trip.id,
                route_id: trip.route_id,
                service_number: trip.service_number || '',
                lat: p1.lat + (p2.lat - p1.lat) * progress,
                lon: p1.lon + (p2.lon - p1.lon) * progress,
                status: 'moving',
                next_stop_id: nextStop.stop_id,
                next_stop_name: nextStopInfo.name,
                next_stop_arrival: nextStop.arrival,
                destination_name: destinationInfo.name,
                destination_arrival: lastStop.arrival
            };
        }
        let distA = prevStop.shape_dist;
        let distB = nextStop.shape_dist;
        if (distA !== null && distB !== null) {
            const totalTime = nextStop.arrival - prevStop.departure;
            const elapsed = time - prevStop.departure;
            const currentDist = distA + (distB - distA) * (elapsed / totalTime);
            const position = this.getPointAtDistance(shape, currentDist, trip);
            if (position) {
                position.service_number = trip.service_number || '';
                position.next_stop_id = nextStop.stop_id;
                position.next_stop_name = nextStopInfo.name;
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
            service_number: trip.service_number || '',
            lat: p1.lat + (p2.lat - p1.lat) * progress,
            lon: p1.lon + (p2.lon - p1.lon) * progress,
            status: 'moving',
            next_stop_id: nextStop.stop_id,
            next_stop_name: nextStopInfo.name,
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
            const offset = this.realTimeOffsets.get(trip.id) || 0;
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
            relevantTime += offset;
            if (relevantTime >= secondsFromMidnight && relevantTime <= endTime) {
                const minutesUntil = Math.round((relevantTime - secondsFromMidnight) / 60);
                const lastStop = trip.stop_times[trip.stop_times.length - 1];
                const destinationInfo = this.gtfs.stopsById.get(lastStop.stop_id);
                const trainLength = this.trainLengths.get(trip.id);
                upcomingTrains.push({
                    trip_id: trip.id,
                    route_id: trip.route_id,
                    destination_name: destinationInfo ? destinationInfo.name : 'Unknown',
                    arrival_time: relevantTime,
                    minutes_until: minutesUntil,
                    is_departing: isTerminal && stopIndex === 0,
                    delay_msg: offset !== 0 ? (offset > 0 ? `+${Math.round(offset / 60)}` : `${Math.round(offset / 60)}`) : '',
                    length: trainLength || null
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