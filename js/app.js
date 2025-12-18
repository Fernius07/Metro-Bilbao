import MetroAPI from './metro-api.js';
import GTFSParser from './gtfs-parser.js';
import MapRenderer from './map-renderer.js';
import TrainSimulator from './trains-simulator.js';
import CONFIG from './config.js';
/**
 * Clase App: Orquestador principal del frontend.
 * Se encarga de la inicialización coordinada de los componentes, la carga de datos
 * y el mantenimiento del bucle principal de ejecución de la aplicación.
 */
class App {
    /**
     * Inicializa las dependencias básicas del sistema.
     */
    constructor() {
        this.parser = new GTFSParser();      // Analizador de archivos GTFS
        this.renderer = null;                // Gestor de renderizado Leaflet
        this.simulator = null;               // Motor de simulación de trenes
        this.api = new MetroAPI();           // Cliente para la API de tiempo real
        this.lastUpdate = 0;                 // Marca de tiempo del último refresco de animación
        this.lastApiSync = 0;                // Marca de tiempo de la última sincronización API
    }

    /**
     * Calcula y devuelve la hora local de Bilbao (Europe/Madrid).
     * Esencial para asegurar la sincronización con los horarios del GTFS independientemente
     * de la configuración regional del dispositivo del usuario.
     * @returns {Date} Objeto fecha ajustado a la zona horaria de Bilbao.
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
            // Inicializar el sistema de renderizado del mapa
            this.renderer = new MapRenderer('map');
            document.getElementById('loading-text').textContent = "Cargando sistema...";

            // Cargar y procesar datos GTFS (Stops, Trips, Times, Shapes)
            const data = await this.parser.loadAll();

            // Vincular códigos de estación de la API con los datos GTFS
            if (data.stationCodes) {
                this.api.setStationCodes(data.stationCodes);
            }

            // Inicializar simulador y vincularlo con el mapa
            this.simulator = new TrainSimulator(data, data.stationCodes);
            this.renderer.renderStaticData(data);
            this.renderer.setGTFSData(data);
            this.renderer.setSimulator(this.simulator);

            // Transición suave al ocultar la pantalla de carga
            document.getElementById('loading-screen').style.opacity = 0;
            setTimeout(() => {
                document.getElementById('loading-screen').style.display = 'none';
            }, 500);
            this.loop();
        } catch (e) {
            console.error(e);
            alert("Error: No se pudieron cargar los archivos GTFS. Asegúrate de que están en la carpeta /gtfs/ y que estás usando un servidor local o GitHub Pages.\n\n" + e.message);
        }
        this.setupEventListeners();
    }
    /**
     * Bucle de ejecución principal basado en requestAnimationFrame.
     * Implementa dos niveles de actualización:
     * 1. Sincronización API: Cada 10 segundos consulta datos reales.
     * 2. Motor de Animación: Actualiza posiciones simuladas según el CONFIG.UPDATE_INTERVAL_MS.
     * @param {number} timestamp - Marca de tiempo de alta resolución del navegador.
     */
    async loop(timestamp) {
        // Nivel 1: Sincronización con la API de Metro Bilbao (Real-Time)
        if (!this.lastApiSync || timestamp - this.lastApiSync > 10000) {
            this.lastApiSync = timestamp;
            this.api.fetchAll().then(data => {
                if (this.simulator) {
                    // Sincronizar el estado del simulador con los datos reales recibidos
                    const bilbaoNow = this.getBilbaoTime();
                    this.simulator.syncWithRealTime(data, bilbaoNow);
                    this.updateRealTimeStatus(true);
                }
            }).catch(() => {
                // Notificar error de conexión en la UI
                this.updateRealTimeStatus(false);
            });
        }

        // Nivel 2: Actualización de la posición visual de los trenes
        if (timestamp - this.lastUpdate > CONFIG.UPDATE_INTERVAL_MS) {
            const now = this.getBilbaoTime();
            this.renderer.setCurrentTime(now);

            if (this.simulator) {
                // Calcular nuevas posiciones y actualizar marcadores en el mapa
                const trains = this.simulator.update(now);
                this.renderer.updateTrains(trains.filter(t => t));
            }

            this.lastUpdate = timestamp;

            // Actualización del reloj digital de la UI
            const clock = document.getElementById('clock');
            if (clock) {
                clock.textContent = now.toLocaleTimeString('es-ES');
            }
        }

        // Solicitar siguiente frame
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