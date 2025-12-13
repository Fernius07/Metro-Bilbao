import os
import urllib.request
import zipfile
import io
import shutil
import ssl
from convert_gtfs_to_json import GTFSConverter

GTFS_URL = "https://cms.metrobilbao.eus/get/open_data/horarios/es"
GTFS_DIR = "gtfs"

def update_gtfs():
    print("🚀 Starting GTFS update process...")

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

    # 2. Extract ZIP
    print(f"📂 Extracting files to {GTFS_DIR}/...")
    try:
        os.makedirs(GTFS_DIR, exist_ok=True)
        
        # Clear existing txt files
        for file in os.listdir(GTFS_DIR):
            if file.endswith(".txt"):
                os.remove(os.path.join(GTFS_DIR, file))

        with zipfile.ZipFile(io.BytesIO(data)) as z:
            z.extractall(GTFS_DIR)
        print("✓ Extraction successful")
    except Exception as e:
        print(f"❌ Error extracting GTFS data: {e}")
        return False

    # 3. Convert to JSON
    print("\n🔄 Running GTFS to JSON conversion...")
    try:
        converter = GTFSConverter(gtfs_folder=GTFS_DIR)
        converter.convert()
        print("✓ Conversion successful")
        return True
    except Exception as e:
        print(f"❌ Error during conversion: {e}")
        return False

if __name__ == "__main__":
    success = update_gtfs()
    if not success:
        exit(1)
