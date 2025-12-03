const CONFIG = {
    GTFS_FOLDER: 'gtfs/',
    DEFAULT_LANGUAGE: 'es',
    // Bilbao center
    MAP_CENTER: [43.2630, -2.9350],
    MAP_ZOOM: 12,
    // Animation
    UPDATE_INTERVAL_MS: 50, // Update UI every 50ms for smoother animation
    // Visuals
    COLORS: {
        primary: '#0057A4', // Metro Bilbao Blue approx
        secondary: '#DC241F', // Red accent
        background_light: '#f5f5f5',
        background_dark: '#1a1a1a',
        text_light: '#333',
        text_dark: '#eee'
    },
    // Debug
    DEBUG: false
};

// Export for module usage if needed, but we are using vanilla JS globals for simplicity in this specific setup
// or we can use ES modules. The prompt asked for ES6, so let's stick to ES modules if possible, 
// but for simplest local file usage without bundlers, standard script tags are often easier. 
// However, ES modules work in modern browsers with <script type="module">. 
// Let's use ES modules for better structure.
export default CONFIG;
