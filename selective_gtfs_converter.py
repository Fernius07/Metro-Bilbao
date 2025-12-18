"""
SelectiveGTFSConverter: Convertidor experimental para optimizar la transformación de GTFS a JSON.
NOTA: Este script actualmente depende de 'GTFSConverter' (no incluido en este repositorio),
por lo que su funcionalidad principal está limitada a ser un prototipo de optimización.
"""

import json
import os

# Intento de importación del motor base (puede fallar si no existe convert_gtfs_to_json.py)
try:
    from convert_gtfs_to_json import GTFSConverter
except ImportError:
    class GTFSConverter:
        def __init__(self, *args): pass
        def load_all(self): pass
        def save_json(self): pass
        def process_stops(self): pass
        def process_routes(self): pass
        def process_shapes(self): pass
        def process_trips(self): pass
        def calculate_service_numbers(self): pass
        def process_calendar(self): pass
        def convert(self): pass

class SelectiveGTFSConverter(GTFSConverter):
    """
    Convertidor extendido que soporta actualizaciones selectivas.
    Solo reconstruye las partes del JSON que dependen de archivos que han cambiado,
    reutilizando datos estáticos del JSON previo si está disponible.
    """
    
    # Archivos dinámicos: requieren reprocesamiento diario
    DYNAMIC_FILES = ['stop_times.txt', 'calendar.txt', 'calendar_dates.txt', 'trips.txt']
    
    # Archivos estáticos: su cambio invalida la caché local
    STATIC_FILES = ['stops.txt', 'shapes.txt', 'routes.txt', 'agency.txt']
    
    def __init__(self, gtfs_folder='gtfs'):
        """
        Inicializa el convertidor selectivo.
        :param gtfs_folder: Ruta a la carpeta de datos raw.
        """
        super().__init__(gtfs_folder)
        self.existing_data = None
        self.changed_files = []
    
    def load_existing_json(self, json_path='gtfs/gtfs-data.json'):
        """Carga el JSON generado previamente si existe en disco."""
        if os.path.exists(json_path):
            try:
                with open(json_path, 'r', encoding='utf-8') as f:
                    self.existing_data = json.load(f)
                print(f"✓ Datos JSON existentes cargados desde {json_path}")
                return True
            except (json.JSONDecodeError, UnicodeDecodeError, OSError) as e:
                print(f"⚠️  No se pudo cargar el JSON previo: {e}")
                return False
        return False
    
    def should_use_existing_stops(self):
        """Determina si es seguro reutilizar los datos de paradas del JSON previo."""
        return (self.existing_data and 
                'stopsById' in self.existing_data and 
                'stops.txt' not in self.changed_files)
    
    def should_use_existing_routes(self):
        """Determina si es seguro reutilizar los datos de rutas del JSON previo."""
        return (self.existing_data and 
                'routesById' in self.existing_data and 
                'routes.txt' not in self.changed_files)
    
    def should_use_existing_shapes(self):
        """Determina si es seguro reutilizar la geometría (shapes) del JSON previo."""
        return (self.existing_data and 
                'shapesById' in self.existing_data and 
                'shapes.txt' not in self.changed_files)
    
    def process_stops(self):
        """Procesa paradas reutilizando caché si no hay cambios en stops.txt."""
        if self.should_use_existing_stops():
            print("\n🚉 Reutilizando datos de paradas (sin cambios detectados)...")
            self.processed['stopsById'] = self.existing_data['stopsById']
            print(f"✓ Reutilizadas {len(self.processed['stopsById'])} paradas")
        else:
            print("\n🚉 Procesando paradas desde el archivo .txt...")
            super().process_stops()
    
    def process_routes(self):
        """Procesa rutas reutilizando caché si no hay cambios en routes.txt."""
        if self.should_use_existing_routes():
            print("\n🚇 Reutilizando datos de rutas (sin cambios detectados)...")
            self.processed['routesById'] = self.existing_data['routesById']
            print(f"✓ Reutilizadas {len(self.processed['routesById'])} rutas")
        else:
            print("\n🚇 Procesando rutas desde el archivo .txt...")
            super().process_routes()
    
    def process_shapes(self):
        """Procesa geometrías reutilizando caché si no hay cambios en shapes.txt."""
        if self.should_use_existing_shapes():
            print("\n📍 Reutilizando datos de geometría/shapes (sin cambios detectados)...")
            self.processed['shapesById'] = self.existing_data['shapesById']
            print(f"✓ Reutilizadas {len(self.processed['shapesById'])} geometrías")
        else:
            print("\n📍 Procesando geometría desde el archivo .txt...")
            super().process_shapes()
    
    def convert_selective(self, changed_files=None):
        """
        Convierte datos GTFS de forma selectiva basándose en un diff de archivos.
        :param changed_files: Lista de nombres de archivos que han sufrido cambios.
                             Si es None, se asume conversión completa.
        """
        print("=" * 60)
        print("🚇 Metro Bilbao - Convertidor Selectivo GTFS a JSON")
        print("=" * 60)
        
        self.changed_files = changed_files or []
        
        # Intentar cargar caché previa
        has_existing = self.load_existing_json()
        
        if not has_existing or not changed_files:
            print("\n⚠️  No hay caché previa o no se especificaron archivos modificados.")
            print("   Realizando conversión completa de seguridad...")
            self.changed_files = self.STATIC_FILES + self.DYNAMIC_FILES
        else:
            print(f"\n📝 Archivos modificados detectados: {', '.join(changed_files)}")
        
        # Carga masiva de archivos fuente
        self.load_all()
        
        # Orquestación del procesamiento (selectivo vs full)
        print("\n⚙️  Transformando datos GTFS (Modo Selectivo)...")
        
        # Datos Estáticos - Reutilización de caché
        self.process_stops()
        self.process_routes()
        self.process_shapes()
        
        # Datos Dinámicos - Siempre requieren reconstrucción integral
        self.process_trips()
        self.calculate_service_numbers()
        self.process_calendar()
        
        print("\n✅ Transformación finalizada con éxito.")
        
        # Persistencia en disco
        self.save_json()
        
        print("\n" + "=" * 60)
        print("✨ Proceso de conversión selectiva terminado.")
        print("=" * 60)

if __name__ == '__main__':
    import sys
    
    # Análisis de argumentos para determinar qué ha cambiado (usualmente enviado por CI/CD)
    changed_files = None
    if len(sys.argv) > 1:
        changed_files = sys.argv[1:]
        print(f"Iniciando conversión restringida a: {changed_files}")
    
    converter = SelectiveGTFSConverter()
    
    if changed_files:
        converter.convert_selective(changed_files=changed_files)
    else:
        # Caída en modo total si no hay parámetros
        converter.convert()
