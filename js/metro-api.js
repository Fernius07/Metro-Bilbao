import CONFIG from './config.js';

/**
 * MetroAPI: Gestor de comunicaciones con el backend de Metro Bilbao.
 * Implementa una capa de abstracción sobre la API REST oficial para manejar
 * la recuperación de tiempos de paso y estados de plataforma.
 */
class MetroAPI {
    /**
     * Inicializa el cliente API con valores por defecto y estructuras de caché.
     */
    constructor() {
        this.cache = new Map();              // Almacén temporal de datos de estaciones
        this.lastUpdate = 0;                 // Timestamp de la última sincronización masiva
        this.updateInterval = 10000;         // Intervalo mínimo entre peticiones globales (10s)
        this.stationCodes = new Map();       // Mapeo entre GTFS Stop ID e ID de API
        this.apiUrl = CONFIG.API_URL;        // URL base configurada
    }

    /**
     * Establece el mapeo de códigos de estación necesarios para las consultas.
     * @param {Map} codesMap - Mapa de StopID -> Código de API.
     */
    setStationCodes(codesMap) {
        this.stationCodes = codesMap;
    }

    /**
     * Consulta los tiempos de llegada en tiempo real para una estación específica.
     * Realiza una petición fetch al endpoint de la API oficial.
     * @param {string} stationCode - ID interno de la estación para la API (ej: 'SAN').
     * @returns {Promise<Array|null>} Promesa con la lista de próximos trenes.
     */
    async fetchStation(stationCode) {
        if (!stationCode) return null;
        try {
            const url = `${this.apiUrl}${stationCode}`;
            const response = await fetch(url);

            if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);

            const data = await response.json();

            // Extraer y aplanar la estructura de plataformas de la respuesta JSON
            if (data && data.platforms && data.platforms.Platforms) {
                return data.platforms.Platforms.flat();
            }
            return null;
        } catch (error) {
            console.warn(`Error al consultar la estación ${stationCode}:`, error);
            return null;
        }
    }
    /**
     * Actualiza masivamente los datos de todas las estaciones configuradas.
     * Gestiona la carga de la red ejecutando peticiones en lotes controlados.
     * @returns {Promise<Map>} Retorna la caché actualizada con todos los datos.
     */
    async fetchAll() {
        const now = Date.now();

        // Política de 'throttle': evitamos peticiones excesivas si se llamó hace poco
        if (now - this.lastUpdate < this.updateInterval) {
            return this.cache;
        }

        console.log('🔄 Sincronizando con API de Metro Bilbao...');

        // Obtener lista única de códigos de estación a consultar
        const uniqueCodes = Array.from(new Set(this.stationCodes.values()));

        // Función auxiliar para procesar una estación individual
        const processStation = async (code) => {
            const data = await this.fetchStation(code);
            if (data) this.cache.set(code, data);
            return data;
        };

        // Ejecución concurrente limitada (batching) para optimizar recursos
        const batchSize = 5;
        for (let i = 0; i < uniqueCodes.length; i += batchSize) {
            const batch = uniqueCodes.slice(i, i + batchSize);
            await Promise.allSettled(batch.map(code => processStation(code)));

            // Pequeña pausa entre lotes para estabilidad
            await new Promise(r => setTimeout(r, 100));
        }

        this.lastUpdate = now;

        // Log de estadísticas para depuración en modo desarrollo
        const totalTrains = Array.from(this.cache.values()).reduce((sum, trains) => sum + (trains?.length || 0), 0);
        console.log(`✅ Sincronización finalizada: ${this.cache.size} estaciones y ${totalTrains} trenes detectados.`);

        return this.cache;
    }
    /**
     * Recupera los datos reales de una estación basándose en su ID de GTFS.
     * @param {string} gtfsStopId - ID del stop en los archivos GTFS.
     * @returns {Array|null} Datos de la estación si están cacheados.
     */
    getStationData(gtfsStopId) {
        const code = this.stationCodes.get(gtfsStopId);
        if (!code) return null;
        return this.cache.get(code);
    }
}
export default MetroAPI;