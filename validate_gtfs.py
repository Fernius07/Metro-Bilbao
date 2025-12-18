import csv
import os
from collections import defaultdict

class GTFSValidator:
    """
    GTFSValidator: Clase para la validación de integridad y consistencia de datos GTFS.
    Realiza comprobaciones de referencias cruzadas, coherencia de horarios y
    verificación de coordenadas geográficas.
    """
    
    def __init__(self, gtfs_folder='gtfs'):
        """
        Inicializa el validador.
        :param gtfs_folder: Carpeta que contiene los archivos .txt de GTFS.
        """
        self.gtfs_folder = gtfs_folder
        self.errors = []       # Errores críticos que invalidan los datos
        self.warnings = []     # Advertencias sobre datos inusuales o incompletos
        self.data = {}         # Almacén de archivos cargados en memoria
        
    def load_csv(self, filename):
        """
        Carga un archivo CSV y lo transforma en una lista de diccionarios.
        :param filename: Nombre del archivo .txt.
        """
        filepath = os.path.join(self.gtfs_folder, filename)
        if not os.path.exists(filepath):
            self.warnings.append(f"Archivo no encontrado: {filename}")
            return []
        
        try:
            # Uso de utf-8-sig para manejar automáticamente posibles BOM
            with open(filepath, 'r', encoding='utf-8-sig') as f:
                reader = csv.DictReader(f)
                return list(reader)
        except (UnicodeDecodeError, csv.Error, OSError) as e:
            self.errors.append(f"Error al cargar {filename}: {e}")
            return []
    
    def load_all(self):
        """Carga todos los archivos GTFS estándar necesarios para la validación."""
        print("📂 Cargando archivos GTFS para validación...")
        self.data['agency'] = self.load_csv('agency.txt')
        self.data['stops'] = self.load_csv('stops.txt')
        self.data['routes'] = self.load_csv('routes.txt')
        self.data['trips'] = self.load_csv('trips.txt')
        self.data['stop_times'] = self.load_csv('stop_times.txt')
        self.data['shapes'] = self.load_csv('shapes.txt')
        self.data['calendar'] = self.load_csv('calendar.txt')
        self.data['calendar_dates'] = self.load_csv('calendar_dates.txt')
        
    def validate_references(self):
        """Valida que todas las referencias (IDs) entre archivos sean coherentes (Foreign Keys)."""
        print("\n🔗 Validando integridad de referencias cruzadas...")
        
        # Construcción de conjuntos de IDs para búsqueda O(1)
        stop_ids = {stop['stop_id'] for stop in self.data['stops']}
        route_ids = {route['route_id'] for route in self.data['routes']}
        trip_ids = {trip['trip_id'] for trip in self.data['trips']}
        shape_ids = {shape['shape_id'] for shape in self.data['shapes']}
        service_ids = set()
        
        # Consolidar service_ids de calendario y excepciones
        for cal in self.data['calendar']:
            service_ids.add(cal['service_id'])
        for cal_date in self.data['calendar_dates']:
            service_ids.add(cal_date['service_id'])
        
        # Validación de referencias en el archivo 'trips.txt'
        invalid_route_refs = 0
        invalid_service_refs = 0
        invalid_shape_refs = 0
        
        for trip in self.data['trips']:
            if trip['route_id'] not in route_ids:
                invalid_route_refs += 1
            if trip['service_id'] not in service_ids:
                invalid_service_refs += 1
            if trip.get('shape_id') and trip['shape_id'] not in shape_ids:
                invalid_shape_refs += 1
        
        if invalid_route_refs > 0:
            self.errors.append(f"Se encontraron {invalid_route_refs} viajes con route_id inválido")
        if invalid_service_refs > 0:
            self.errors.append(f"Se encontraron {invalid_service_refs} viajes con service_id inválido")
        if invalid_shape_refs > 0:
            self.warnings.append(f"Se encontraron {invalid_shape_refs} viajes con shape_id inexistente en shapes.txt")
        
        # Validación de referencias en 'stop_times.txt'
        invalid_trip_refs = 0
        invalid_stop_refs = 0
        
        for stop_time in self.data['stop_times']:
            if stop_time['trip_id'] not in trip_ids:
                invalid_trip_refs += 1
            if stop_time['stop_id'] not in stop_ids:
                invalid_stop_refs += 1
        
        if invalid_trip_refs > 0:
            self.errors.append(f"Se encontraron {invalid_trip_refs} stop_times con trip_id inválido")
        if invalid_stop_refs > 0:
            self.errors.append(f"Se encontraron {invalid_stop_refs} stop_times con stop_id inválido")
        
        if not self.errors:
            print("✓ Integridad de referencias validada con éxito.")
        
    def validate_schedule_consistency(self):
        """Valida que los horarios sean lógicos y cronológicos."""
        print("\n⏰ Validando consistencia de horarios y secuencias...")
        
        # Agrupar tiempos por viaje para análisis secuencial
        trips_stop_times = defaultdict(list)
        for st in self.data['stop_times']:
            trips_stop_times[st['trip_id']].append({
                'seq': int(st['stop_sequence']),
                'arrival': st['arrival_time'],
                'departure': st['departure_time']
            })
        
        invalid_sequences = 0
        invalid_times = 0
        
        for trip_id, stop_times in trips_stop_times.items():
            # Ordenar por secuencia lógica
            stop_times.sort(key=lambda x: x['seq'])
            
            # Verificar continuidad de la secuencia
            expected_seq = 1
            for st in stop_times:
                if st['seq'] != expected_seq:
                    invalid_sequences += 1
                    break
                expected_seq += 1
            
            # Verificar progresión temporal (el tren no puede viajar al pasado)
            prev_departure = None
            for st in stop_times:
                if prev_departure and st['arrival'] and st['arrival'] < prev_departure:
                    invalid_times += 1
                    break
                if st['departure']:
                    prev_departure = st['departure']
        
        if invalid_sequences > 0:
            self.warnings.append(f"Se encontraron {invalid_sequences} viajes con secuencias de parada no continuas")
        if invalid_times > 0:
            self.errors.append(f"Se encontraron {invalid_times} viajes con retrocesos temporales (no monotónicos)")
        
        if not self.errors and invalid_sequences == 0:
            print("✓ Coherencia horaria validada.")
    
    def validate_coordinates(self):
        """Verifica que las coordenadas de las estaciones sean razonables para la zona de Bilbao."""
        print("\n📍 Validando coordenadas geográficas...")
        
        # Límites aproximados para el Gran Bilbao
        MIN_LAT, MAX_LAT = 42.9, 43.5
        MIN_LON, MAX_LON = -3.2, -2.6
        
        invalid_coords = 0
        for stop in self.data['stops']:
            try:
                lat = float(stop['stop_lat'])
                lon = float(stop['stop_lon'])
                
                if not (MIN_LAT <= lat <= MAX_LAT and MIN_LON <= lon <= MAX_LON):
                    invalid_coords += 1
            except ValueError:
                invalid_coords += 1
        
        if invalid_coords > 0:
            self.errors.append(f"Se encontraron {invalid_coords} paradas con coordenadas fuera de rango o corruptas")
        else:
            print("✓ Todas las coordenadas son válidas para la zona de operación.")
    
    def validate_file_completeness(self):
        """Comprueba la existencia y contenido de los archivos obligatorios."""
        print("\n📋 Validando completitud de archivos...")
        
        required_files = ['stops.txt', 'routes.txt', 'trips.txt', 'stop_times.txt']
        optional_files = ['agency.txt', 'shapes.txt', 'calendar.txt', 'calendar_dates.txt']
        
        for filename in required_files:
            data = self.data.get(filename.replace('.txt', ''), [])
            if not data:
                self.errors.append(f"Archivo obligatorio ausente o vacío: {filename}")
        
        for filename in optional_files:
            data = self.data.get(filename.replace('.txt', ''), [])
            if not data:
                self.warnings.append(f"Archivo opcional ausente o vacío: {filename}")
        
        if not self.errors:
            print("✓ Presencia de archivos críticos confirmada.")
    
    def validate(self):
        """Orquesta la ejecución de todas las pruebas de validación."""
        print("=" * 60)
        print("🔍 Validación de Datos GTFS - Metro Bilbao")
        print("=" * 60)
        
        self.load_all()
        
        # Lógica de auto-recuperación: si no hay datos, intentar descargarlos
        if not self.data.get('stops') and not self.data.get('trips'):
            print("⚠️ No se detectaron datos locales.")
            print("🔄 Iniciando descarga automática de la última versión...")
            try:
                from update_gtfs import update_gtfs
                if update_gtfs():
                    print("✅ Datos descargados. Reintentando validación...")
                    self.load_all()
                else:
                    print("❌ Fallo en la descarga automática. Abortando.")
                    return False
            except ImportError:
                 print("❌ Error de sistema: No se pudo importar update_gtfs.py.")
                 return False

        if not self.data.get('stops') and not self.data.get('trips'):
             print("❌ Error: Los datos siguen ausentes tras el intento de descarga.")
             return False
        
        self.validate_file_completeness()
        self.validate_coordinates()
        self.validate_references()
        self.validate_schedule_consistency()
        
        print("\n" + "=" * 60)
        print("📊 Resumen de Validación")
        print("=" * 60)
        
        if self.errors:
            print(f"\n❌ Se detectaron {len(self.errors)} error(s) crítico(s):")
            for error in self.errors:
                print(f"  • {error}")
        
        if self.warnings:
            print(f"\n⚠️  Se detectaron {len(self.warnings)} advertencia(s):")
            for warning in self.warnings:
                print(f"  • {warning}")
        
        if not self.errors and not self.warnings:
            print("\n✅ Validación superada: Todos los tests han pasado con éxito.")
            return True
        elif not self.errors:
            print("\n✅ Validación superada con advertencias menores.")
            return True
        else:
            print("\n❌ Validación fallida: Los datos contienen inconsistencias críticas.")
            return False

if __name__ == '__main__':
    validator = GTFSValidator()
    success = validator.validate()
    exit(0 if success else 1)
