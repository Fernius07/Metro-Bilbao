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

    async init() {
        this.updateUI();

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
                    this.simulator.syncWithRealTime(data);
                    this.updateRealTimeStatus(true);
                }
            }).catch(() => {
                this.updateRealTimeStatus(false);
            });
        }

        if (timestamp - this.lastUpdate > CONFIG.UPDATE_INTERVAL_MS) {
            const now = new Date();
            this.renderer.setCurrentTime(now); // Update current time for station queries

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

    toggleTheme() {
        const body = document.body;
        const current = body.getAttribute('data-theme');
        const next = current === 'dark' ? 'light' : 'dark';
        body.setAttribute('data-theme', next);
        if (this.renderer) this.renderer.setTheme(next);
    }

    setLanguage(lang) {
        this.lang = lang;
        this.updateUI();
        if (this.renderer) {
            this.renderer.setLanguage(lang);
        }
    }

    updateUI() {
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            if (i18n[this.lang][key]) {
                el.textContent = i18n[this.lang][key];
            }
        });

        document.getElementById('btn-lang-es').className = this.lang === 'es' ? 'active' : '';
        document.getElementById('btn-lang-eu').className = this.lang === 'eu' ? 'active' : '';
    }

    setupEventListeners() {
        document.getElementById('btn-theme').addEventListener('click', () => this.toggleTheme());
        document.getElementById('btn-lang-es').addEventListener('click', () => this.setLanguage('es'));
        document.getElementById('btn-lang-eu').addEventListener('click', () => this.setLanguage('eu'));
        document.getElementById('btn-layer-std').addEventListener('click', () => this.renderer.toggleLayer('standard'));
        document.getElementById('btn-layer-sat').addEventListener('click', () => this.renderer.toggleLayer('satellite'));
    }
}

window.addEventListener('DOMContentLoaded', () => {
    const app = new App();
    app.init();
});
