# Metro Bilbao - Visualizador en Tiempo Real

Aplicación web interactiva que muestra la posición en tiempo real de los trenes del Metro de Bilbao, combinando datos GTFS estáticos con información en tiempo real de la API oficial.

## Características

- **Visualización en Tiempo Real**: Muestra la posición actual de todos los trenes en servicio
- **Sincronización con API**: Actualización automática cada 10 segundos con datos reales
- **Mapa Interactivo**: Basado en Leaflet con dos capas (estándar y satélite)
- **Panel de Información**: Detalles de trenes y estaciones al hacer clic
- **Diseño Responsive**: Optimizado para escritorio y móvil
- **Colores Corporativos**: Línea 1 (rojo) y Línea 2 (negro)
- **Sin Servidor**: Funciona como sitio estático (SPA)

## Tecnologías

- **Frontend**: HTML5, CSS3, JavaScript (ES6 Modules)
- **Mapas**: Leaflet.js
- **Datos**: GTFS estático + API en tiempo real de Metro Bilbao
- **Diseño**: CSS personalizado con variables y responsive design

## Instalación y Uso

### 1. Requisitos
No requiere instalación de software adicional, solo un navegador web moderno.

### 2. Ejecución Local
Debido a las políticas CORS, no se puede abrir directamente `index.html`. Necesitas un servidor local:

- **Opción A (VS Code)**: Extensión "Live Server" → clic en "Go Live"
- **Opción B (Python)**: `python -m http.server`
- **Opción C (Node)**: `npx http-server .`

### 3. Despliegue en GitHub Pages
1. Sube el proyecto a un repositorio de GitHub
2. Settings → Pages → activa desde rama `main`
3. La aplicación funcionará automáticamente

## Estructura del Proyecto

```
Metro Bilbao/
├── index.html              # Página principal
├── css/
│   └── styles.css         # Estilos de la aplicación
├── js/
│   ├── app.js            # Aplicación principal
│   ├── config.js         # Configuración
│   ├── gtfs-parser.js    # Parser de datos GTFS
│   ├── i18n.js           # Traducciones (ES/EU)
│   ├── map-renderer.js   # Renderizado del mapa
│   ├── metro-api.js      # Cliente API tiempo real
│   └── trains-simulator.js # Simulador de trenes
├── gtfs/                  # Datos GTFS estáticos
└── assets/               # Recursos (logo, loader)
```

## Datos GTFS

El proyecto incluye datos GTFS en `/gtfs/`. Archivos requeridos:
- `agency.txt`
- `stops.txt`
- `routes.txt`
- `trips.txt`
- `stop_times.txt`
- `shapes.txt`
- `calendar.txt`
- `calendar_dates.txt`

### Actualización de Datos

El proyecto usa un **sistema de actualización selectiva** que:
- ✅ Actualiza automáticamente los horarios diariamente (4:00 UTC)
- ✅ Preserva las ubicaciones de paradas y geometría de rutas
- ✅ Valida la integridad de los datos antes de actualizar
- ✅ Solo procesa los archivos que cambian (más rápido)

Para más información sobre el proceso de actualización, consulta `CONVERSION_README.md`.

## API en Tiempo Real

La aplicación consume la API oficial de Metro Bilbao para obtener:
- Tiempos de llegada en tiempo real
- Retrasos y adelantos
- Longitud de los trenes (3 o 5 coches)

Endpoint: `https://www.metrobilbao.eus/api/trenes.php`

## Personalización

Edita `js/config.js` para modificar:
- Coordenadas iniciales del mapa
- Nivel de zoom
- Colores corporativos
- Intervalo de actualización

## Funcionalidades

### Mapa
- **Capas**: Alterna entre vista estándar y satélite
- **Líneas**: Visualización del trazado completo de L1 y L2
- **Estaciones**: Marcadores clickeables en todas las paradas
- **Trenes**: Marcadores en tiempo real (rojo para L1, negro para L2)

### Paneles de Información
- **Trenes**: Horarios de paradas, próxima estación, retrasos
- **Estaciones**: Próximas salidas con tiempos de llegada

### Responsive
- **Desktop**: Panel lateral deslizante
- **Mobile**: Panel inferior tipo "bottom sheet"

## Licencia

MIT

## Créditos

- Datos GTFS: Metro Bilbao
- API en tiempo real: Metro Bilbao
- Mapas: OpenStreetMap, CARTO, Esri
