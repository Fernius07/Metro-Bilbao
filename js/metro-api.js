import CONFIG from './config.js';
class MetroAPI {
    constructor() {
        this.cache = new Map();
        this.lastUpdate = 0;
        this.updateInterval = 10000;
        this.stationCodes = new Map();
        this.apiUrl = CONFIG.API_URL;
    }
    setStationCodes(codesMap) {
        this.stationCodes = codesMap;
    }
    async fetchStation(stationCode) {
        if (!stationCode) return null;
        try {
            const url = `${this.apiUrl}${stationCode}`;
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            if (data && data.platforms && data.platforms.Platforms) {
                const trains = data.platforms.Platforms.flat();
                return trains;
            }
            return null;
        } catch (error) {
            console.warn(`Error fetching station ${stationCode}:`, error);
            return null;
        }
    }
    async fetchAll() {
        const now = Date.now();
        if (now - this.lastUpdate < this.updateInterval) {
            return this.cache;
        }
        console.log('🔄 Syncing with Real-Time API...');
        const uniqueCodes = Array.from(new Set(this.stationCodes.values()));
        const chunkCheck = async (code) => {
            const data = await this.fetchStation(code);
            if (data) this.cache.set(code, data);
            return data;
        };
        const batchSize = 5;
        for (let i = 0; i < uniqueCodes.length; i += batchSize) {
            const batch = uniqueCodes.slice(i, i + batchSize);
            await Promise.allSettled(batch.map(code => chunkCheck(code)));
            await new Promise(r => setTimeout(r, 100));
        }
        this.lastUpdate = now;
        const totalTrains = Array.from(this.cache.values()).reduce((sum, trains) => sum + (trains?.length || 0), 0);
        console.log(`✅ Synced ${this.cache.size} stations with ${totalTrains} total trains`);
        return this.cache;
    }
    getStationData(gtfsStopId) {
        const code = this.stationCodes.get(gtfsStopId);
        if (!code) return null;
        return this.cache.get(code);
    }
}
export default MetroAPI;