import MetroAPI from './metro-api.js';
import GTFSParser from './gtfs-parser.js';
import MapRenderer from './map-renderer.js';
import TrainSimulator from './trains-simulator.js';
import CONFIG from './config.js';
import i18n from './i18n.js';
class App {
    constructor() {
        this.lang = CONFIG.DEFAULT_LANGUAGE;
        this.parser = new GTFSParser();
        this.renderer = null;
        this.simulator = null;
        this.api = new MetroAPI();
        this.lastUpdate = 0;
        this.lastApiSync = 0;
    }
    getBilbaoTime() {
        // Returns a Date object that "looks" like Bilbao time in local getters
        // e.g. if it's 12:00 in Bilbao, this Date object will return 12 for getHours()
        // regardless of the browser's actual timezone.
        const now = new Date();
        const bilbaoString = now.toLocaleString("en-US", { timeZone: "Europe/Madrid" });
        return new Date(bilbaoString);
    }
    async init() {
        try {
            this.renderer = new MapRenderer('map', this.lang);
            document.getElementById('loading-text').textContent = i18n[this.lang].loading;
            const data = await this.parser.loadAll();
            if (data.stationCodes) {
                this.api.setStationCodes(data.stationCodes);
            }
            this.simulator = new TrainSimulator(data, data.stationCodes);
            this.renderer.renderStaticData(data);
            this.renderer.setGTFSData(data);
            this.renderer.setSimulator(this.simulator);
            document.getElementById('loading-screen').style.opacity = 0;
            setTimeout(() => {
                document.getElementById('loading-screen').style.display = 'none';
            }, 500);
            this.loop();
        } catch (e) {
            console.error(e);
            alert(i18n[this.lang].error_files + "\n\n" + e.message);
        }
        this.setupEventListeners();
    }
    async loop(timestamp) {
        if (!this.lastApiSync || timestamp - this.lastApiSync > 10000) {
            this.lastApiSync = timestamp;
            this.api.fetchAll().then(data => {
                if (this.simulator) {
                    // Pass current Bilbao time to sync
                    const bilbaoNow = this.getBilbaoTime();
                    this.simulator.syncWithRealTime(data, bilbaoNow);
                    this.updateRealTimeStatus(true);
                }
            }).catch(() => {
                this.updateRealTimeStatus(false);
            });
        }
        if (timestamp - this.lastUpdate > CONFIG.UPDATE_INTERVAL_MS) {
            const now = this.getBilbaoTime();
            this.renderer.setCurrentTime(now);
            if (this.simulator) {
                const trains = this.simulator.update(now);
                this.renderer.updateTrains(trains.filter(t => t));
            }
            this.lastUpdate = timestamp;
            const clock = document.getElementById('clock');
            if (clock) {
                clock.textContent = now.toLocaleTimeString(this.lang === 'es' ? 'es-ES' : 'eu-ES');
            }
        }
        requestAnimationFrame((t) => this.loop(t));
    }
    updateRealTimeStatus(active) {
        const dot = document.getElementById('rt-status');
        if (dot) {
            dot.style.backgroundColor = active ? '#4caf50' : '#f44336';
            dot.title = active ? 'Real-Time Active' : 'Real-Time Disconnected';
        }
    }
    setupEventListeners() {
        let currentLayer = 'standard';
        const layerToggleBtn = document.getElementById('layer-toggle-btn');
        if (layerToggleBtn) {
            layerToggleBtn.addEventListener('click', () => {
                currentLayer = currentLayer === 'standard' ? 'satellite' : 'standard';
                this.renderer.toggleLayer(currentLayer);
            });
        }
    }
}
window.addEventListener('DOMContentLoaded', () => {
    const app = new App();
    app.init();
});