# Metro Bilbao GTFS Visualizer

Un visualizador de tráfico de metro estático basado en horarios GTFS. Muestra la posición estimada de los trenes sobre el mapa utilizando datos de horarios programados.

## Características

- **Mapa Interactivo**: Basado en Leaflet.
- **Simulación de Trenes**: Interpolación de movimiento basada en horarios GTFS.
- **Multilenguaje**: Español y Euskera.
- **Modo Oscuro/Claro**: Adaptable a preferencias de usuario.
- **Sin Servidor**: Funciona como sitio estático (SPA).

## Instalación y Uso

### 1. Requisitos
No requiere instalación de software (Node.js, Python, etc.) para ejecutarse, solo un navegador web moderno.

### 2. Ejecución Local
Debido a las políticas de seguridad de los navegadores (CORS), **no se puede abrir directamente el archivo `index.html`** haciendo doble clic (protocolo `file://`).

Para probarlo localmente, necesitas un servidor estático simple.
- **Opción A (VS Code)**: Instala la extensión "Live Server" y haz clic en "Go Live".
- **Opción B (Python)**: Abre una terminal en la carpeta y ejecuta `python -m http.server`.
- **Opción C (Node)**: Ejecuta `npx http-server .`.

### 3. Despliegue en GitHub Pages
Este proyecto está diseñado para funcionar perfectamente en GitHub Pages.
1. Sube todos los archivos a un repositorio de GitHub.
2. Ve a Settings > Pages y activa el despliegue desde la rama `main` (o `master`).
3. La web cargará los archivos GTFS correctamente.

## Datos GTFS

El proyecto incluye datos de ejemplo en la carpeta `/gtfs/`. Para usar datos reales de Metro Bilbao:

1. Consigue los archivos GTFS oficiales (normalmente un .zip).
2. Descomprime los archivos `.txt` en la carpeta `/gtfs/` de este proyecto, sobrescribiendo los existentes.
3. Archivos requeridos:
   - `agency.txt`
   - `stops.txt`
   - `routes.txt`
   - `trips.txt`
   - `stop_times.txt`
   - `shapes.txt`
   - `calendar.txt`
   - `calendar_dates.txt`

> **Nota**: El sistema filtra automáticamente paradas que comienzan por números (entradas/salidas) y procesa la geometría de `shapes.txt`.

## Personalización

Puedes editar `js/config.js` para cambiar:
- Coordenadas iniciales del mapa.
- Colores por defecto.
- Intervalo de actualización.

## Licencia
MIT
