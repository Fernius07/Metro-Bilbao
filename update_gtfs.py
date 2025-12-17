import os
import urllib.request
import zipfile
import io
import shutil
import ssl
import tempfile


GTFS_URL = "https://cms.metrobilbao.eus/get/open_data/horarios/es"
GTFS_DIR = "gtfs"

# Files that change daily (schedules)
DYNAMIC_FILES = ['stop_times.txt', 'calendar.txt', 'calendar_dates.txt', 'trips.txt']

# Files that are static (geometry and configuration)
STATIC_FILES = ['stops.txt', 'shapes.txt', 'routes.txt', 'agency.txt']

def update_gtfs():
    print("🚀 Starting GTFS selective update process...")

    # 1. Download ZIP
    print(f"⬇️  Downloading GTFS data from {GTFS_URL}...")
    try:
        # Create a context to ignore SSL errors if necessary (optional, but sometimes helps)
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE

        with urllib.request.urlopen(GTFS_URL, context=ctx) as response:
            if response.status != 200:
                print(f"❌ HTTP Error: {response.status}")
                return False
            data = response.read()
            
        print("✓ Download successful")
    except Exception as e:
        print(f"❌ Error downloading GTFS data: {e}")
        return False

    # 2. Extract ZIP to temporary directory
    print(f"📂 Extracting files to temporary directory...")
    try:
        os.makedirs(GTFS_DIR, exist_ok=True)
        
        # Create temporary directory for extraction
        with tempfile.TemporaryDirectory() as temp_dir:
            # Extract to temp directory
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                z.extractall(temp_dir)
            print("✓ Extraction to temp directory successful")
            
            # Check if this is the first installation
            is_first_install = not all(
                os.path.exists(os.path.join(GTFS_DIR, f)) for f in STATIC_FILES
            )
            
            if is_first_install:
                print("\n📦 First installation detected - copying all files...")
                # Copy all files
                for file in os.listdir(temp_dir):
                    if file.endswith('.txt'):
                        src = os.path.join(temp_dir, file)
                        dst = os.path.join(GTFS_DIR, file)
                        shutil.copy2(src, dst)
                        print(f"   ✓ Copied {file}")
                changed_files = STATIC_FILES + DYNAMIC_FILES
            else:
                print("\n🔄 Updating dynamic files only (preserving static data)...")
                changed_files = []
                # Only copy dynamic files
                for file in DYNAMIC_FILES:
                    src = os.path.join(temp_dir, file)
                    dst = os.path.join(GTFS_DIR, file)
                    if os.path.exists(src):
                        shutil.copy2(src, dst)
                        changed_files.append(file)
                        print(f"   ✓ Updated {file}")
                    else:
                        print(f"   ⚠️  {file} not found in download")
                
                print("\n📌 Static files preserved:")
                for file in STATIC_FILES:
                    if os.path.exists(os.path.join(GTFS_DIR, file)):
                        print(f"   ✓ {file} (unchanged)")
                
    except (zipfile.BadZipFile, OSError, shutil.Error) as e:
        print(f"❌ Error extracting GTFS data: {e}")
        return False

    return True

if __name__ == "__main__":
    success = update_gtfs()
    if not success:
        exit(1)
