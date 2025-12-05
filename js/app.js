import CONFIG from './config.js';
import i18n from './i18n.js';
import GTFSParser from './gtfs-parser.js';
import TrainSimulator from './trains-simulator.js';
import MapRenderer from './map-renderer.js';

class App {
    constructor() {
        this.lang = CONFIG.DEFAULT_LANGUAGE;
        this.parser = new GTFSParser();
        this.renderer = null;
        this.simulator = null;
        this.lastUpdate = 0;
    }

    async init() {
        this.updateUI();

        try {
            // Initialize Map
            this.renderer = new MapRenderer('map', this.lang);

            // Load Data
            document.getElementById('loading-text').textContent = i18n[this.lang].loading;
            const data = await this.parser.loadAll();

            // Setup Simulator
            this.simulator = new TrainSimulator(data);

            // Render Static Map
            this.renderer.renderStaticData(data);

            // Pass references to renderer for station queries
            this.renderer.setGTFSData(data);
            this.renderer.setSimulator(this.simulator);

            // Remove Loading Screen
            document.getElementById('loading-screen').style.opacity = 0;
            setTimeout(() => {
                document.getElementById('loading-screen').style.display = 'none';
            }, 500);

            // Start Loop
            this.loop();

        } catch (e) {
            console.error(e);
            alert(i18n[this.lang].error_files + "\n\n" + e.message);
        }

        this.setupEventListeners();
    }

    loop(timestamp) {
        if (timestamp - this.lastUpdate > CONFIG.UPDATE_INTERVAL_MS) {
            const now = new Date();
            this.renderer.setCurrentTime(now); // Update current time for station queries
            const trains = this.simulator.update(now);
            this.renderer.updateTrains(trains);
            this.lastUpdate = timestamp;

            // Update clock
            document.getElementById('clock').textContent = now.toLocaleTimeString();
        }

        requestAnimationFrame((t) => this.loop(t));
    }

    toggleTheme() {
        const body = document.body;
        const current = body.getAttribute('data-theme');
        const next = current === 'dark' ? 'light' : 'dark';
        body.setAttribute('data-theme', next);
        this.renderer.setTheme(next);
    }

    setLanguage(lang) {
        this.lang = lang;
        if (this.renderer) {
            this.renderer.setLanguage(lang);
        }
        this.updateUI();
    }

    updateUI() {
        const t = i18n[this.lang];
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            if (t[key]) el.textContent = t[key];
        });
    }

    setupEventListeners() {
        document.getElementById('btn-theme').addEventListener('click', () => this.toggleTheme());
        document.getElementById('btn-lang-es').addEventListener('click', () => this.setLanguage('es'));
        document.getElementById('btn-lang-eu').addEventListener('click', () => this.setLanguage('eu'));
        document.getElementById('btn-layer-sat').addEventListener('click', () => this.renderer.toggleLayer('satellite'));
        document.getElementById('btn-layer-std').addEventListener('click', () => this.renderer.toggleLayer('standard'));
    }
}

// Start
window.addEventListener('DOMContentLoaded', () => {
    const app = new App();
    app.init();
});
