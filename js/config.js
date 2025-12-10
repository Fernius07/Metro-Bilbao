/**
 * Configuración global de la aplicación.
 */
const CONFIG = {
    GTFS_FOLDER: 'gtfs/', // Carpeta donde se encuentran los archivos GTFS
    DEFAULT_LANGUAGE: 'es', // Idioma por defecto
    MAP_CENTER: [43.2630, -2.9350], // Centro inicial del mapa (Bilbao)
    MAP_ZOOM: 12, // Zoom inicial
    UPDATE_INTERVAL_MS: 50, // Intervalo de actualización de la simulación (ms)
    API_URL: 'https://api.metrobilbao.eus/api/stations/', // URL base de la API de Metro Bilbao
    CORS_PROXY: '', // Proxy CORS si es necesario (actualmente vacío)
    COLORS: {
        primary: '#0057A4', // Color primario (L1)
        secondary: '#DC241F', // Color secundario
        background_light: '#f5f5f5',
        background_dark: '#1a1a1a',
        text_light: '#333',
        text_dark: '#eee'
    },
    DEBUG: false // Modo de depuración
};
export default CONFIG;