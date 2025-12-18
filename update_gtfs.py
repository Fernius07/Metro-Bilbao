"""
Script para la actualización selectiva de datos GTFS de Metro Bilbao.
Descarga los datos oficiales, los extrae y actualiza únicamente los ficheros
de horarios y calendarios, preservando los datos estáticos como paradas y rutas.
"""

import os
import urllib.request
import zipfile
import io
import shutil
import ssl
import tempfile


# URL de descarga del GTFS oficial de Metro Bilbao
GTFS_URL = "https://cms.metrobilbao.eus/get/open_data/horarios/es"
# Directorio donde se almacenan los datos GTFS en el proyecto
GTFS_DIR = "gtfs"

# Ficheros dinámicos que cambian diariamente (horarios y recorridos)
DYNAMIC_FILES = ['stop_times.txt', 'calendar.txt', 'calendar_dates.txt', 'trips.txt', 'shapes.txt']

# Ficheros estáticos que suelen ser permanentes (geometría de red y configuración)
STATIC_FILES = ['stops.txt', 'routes.txt', 'agency.txt']

def update_gtfs():
    """
    Realiza la descarga y actualización selectiva de los ficheros GTFS.
    
    Proceso:
    1. Descarga el paquete ZIP desde la URL oficial.
    2. Extrae el contenido en un directorio temporal.
    3. Si es la primera instalación, copia todos los ficheros.
    4. Si ya existe, actualiza solo los ficheros dinámicos definidos en DYNAMIC_FILES.
    
    Returns:
        bool: True si la operación fue exitosa, False en caso contrario.
    """
    print("🚀 Iniciando el proceso de actualización selectiva de GTFS...")

    # 1. Descarga del fichero ZIP
    print(f"⬇️  Descargando datos GTFS desde {GTFS_URL}...")
    try:
        # Creamos un contexto para omitir errores de SSL si fuera necesario (opcional)
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE

        with urllib.request.urlopen(GTFS_URL, context=ctx) as response:
            if response.status != 200:
                print(f"❌ Error HTTP: {response.status}")
                return False
            data = response.read()
            
        print("✓ Descarga finalizada con éxito")
    except Exception as e:
        print(f"❌ Error al descargar los datos GTFS: {e}")
        return False

    # 2. Extracción del ZIP en un directorio temporal
    print(f"📂 Extrayendo ficheros en directorio temporal...")
    try:
        os.makedirs(GTFS_DIR, exist_ok=True)
        
        # Uso de un directorio temporal para la extracción segura
        with tempfile.TemporaryDirectory() as temp_dir:
            # Extraer en el directorio temporal
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                z.extractall(temp_dir)
            print("✓ Extracción temporal finalizada")
            
            # Verificar si es la primera instalación del sistema
            is_first_install = not all(
                os.path.exists(os.path.join(GTFS_DIR, f)) for f in STATIC_FILES
            )
            
            if is_first_install:
                print("\n📦 Primera instalación detectada - Copiando todos los ficheros...")
                # Copiar todos los ficheros extraídos
                for file in os.listdir(temp_dir):
                    if file.endswith('.txt'):
                        src = os.path.join(temp_dir, file)
                        dst = os.path.join(GTFS_DIR, file)
                        shutil.copy2(src, dst)
                        print(f"   ✓ Copiado: {file}")
                changed_files = STATIC_FILES + DYNAMIC_FILES
            else:
                print("\n🔄 Actualizando solo ficheros dinámicos (preservando datos estáticos)...")
                changed_files = []
                # Copiar únicamente los ficheros definidos como dinámicos
                for file in DYNAMIC_FILES:
                    src = os.path.join(temp_dir, file)
                    dst = os.path.join(GTFS_DIR, file)
                    if os.path.exists(src):
                        shutil.copy2(src, dst)
                        changed_files.append(file)
                        print(f"   ✓ Actualizado: {file}")
                    else:
                        print(f"   ⚠️  Aviso: {file} no encontrado en la descarga")
                
                print("\n📌 Ficheros estáticos preservados:")
                for file in STATIC_FILES:
                    if os.path.exists(os.path.join(GTFS_DIR, file)):
                        print(f"   ✓ {file} (sin cambios)")
                
    except (zipfile.BadZipFile, OSError, shutil.Error) as e:
        print(f"❌ Error durante el procesamiento de datos GTFS: {e}")
        return False

    return True

if __name__ == "__main__":
    success = update_gtfs()
    if not success:
        exit(1)
