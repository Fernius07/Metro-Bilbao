import MetroAPI from './metro-api.js';
import GTFSParser from './gtfs-parser.js';
import MapRenderer from './map-renderer.js';
import TrainSimulator from './trains-simulator.js';
import CONFIG from './config.js';
import i18n from './i18n.js';
/**
 * Clase principal que gestiona la inicialización y el bucle principal de la aplicación.
 * Coordina la carga de datos, el renderizado del mapa y la simulación de trenes.
 */
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

    /**
     * Devuelve un objeto Date que "parece" ser la hora de Bilbao en los getters locales.
     * Por ejemplo, si son las 12:00 en Bilbao, este objeto devolverá 12 para getHours(),
     * independientemente de la zona horaria real del navegador.
     * @returns {Date} Fecha ajustada a la zona horaria de Bilbao (Europa/Madrid).
     */
    getBilbaoTime() {
        const now = new Date();
        const bilbaoString = now.toLocaleString("en-US", { timeZone: "Europe/Madrid" });
        return new Date(bilbaoString);
    }
    /**
     * Inicializa la aplicación.
     * Carga los datos GTFS, configura el mapa y el simulador, y elimina la pantalla de carga.
     */
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
    /**
     * Bucle principal de la aplicación.
     * Sincroniza con la API en tiempo real y actualiza la posición de los trenes en cada frame.
     * @param {number} timestamp - Marca de tiempo proporcionada por requestAnimationFrame.
     */
    async loop(timestamp) {
        if (!this.lastApiSync || timestamp - this.lastApiSync > 10000) {
            this.lastApiSync = timestamp;
            this.api.fetchAll().then(data => {
                if (this.simulator) {
                    // Pasar la hora actual de Bilbao para sincronizar
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

    /**
     * Actualiza el indicador visual del estado de la conexión en tiempo real.
     * @param {boolean} active - true si la conexión está activa, false si hay error.
     */
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