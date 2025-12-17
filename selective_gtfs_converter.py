import json
import os
from convert_gtfs_to_json import GTFSConverter


class SelectiveGTFSConverter(GTFSConverter):
    """
    Extended GTFS converter that supports selective conversion.
    Only rebuilds parts of the JSON that depend on changed files.
    """
    
    # Files that change daily (schedules)
    DYNAMIC_FILES = ['stop_times.txt', 'calendar.txt', 'calendar_dates.txt', 'trips.txt']
    
    # Files that are static (geometry and configuration)
    STATIC_FILES = ['stops.txt', 'shapes.txt', 'routes.txt', 'agency.txt']
    
    def __init__(self, gtfs_folder='gtfs'):
        super().__init__(gtfs_folder)
        self.existing_data = None
        self.changed_files = []
    
    def load_existing_json(self, json_path='gtfs/gtfs-data.json'):
        """Load existing JSON data if it exists."""
        if os.path.exists(json_path):
            try:
                with open(json_path, 'r', encoding='utf-8') as f:
                    self.existing_data = json.load(f)
                print(f"✓ Loaded existing JSON data from {json_path}")
                return True
            except (json.JSONDecodeError, UnicodeDecodeError, OSError) as e:
                print(f"⚠️  Could not load existing JSON: {e}")
                return False
        return False
    
    def should_use_existing_stops(self):
        """Determine if we should reuse existing stops data."""
        return (self.existing_data and 
                'stopsById' in self.existing_data and 
                'stops.txt' not in self.changed_files)
    
    def should_use_existing_routes(self):
        """Determine if we should reuse existing routes data."""
        return (self.existing_data and 
                'routesById' in self.existing_data and 
                'routes.txt' not in self.changed_files)
    
    def should_use_existing_shapes(self):
        """Determine if we should reuse existing shapes data."""
        return (self.existing_data and 
                'shapesById' in self.existing_data and 
                'shapes.txt' not in self.changed_files)
    
    def process_stops(self):
        """Process stops, reusing existing data if static files haven't changed."""
        if self.should_use_existing_stops():
            print("\n🚉 Reusing existing stops data (no changes)...")
            self.processed['stopsById'] = self.existing_data['stopsById']
            print(f"✓ Reused {len(self.processed['stopsById'])} stops")
        else:
            print("\n🚉 Processing stops...")
            super().process_stops()
    
    def process_routes(self):
        """Process routes, reusing existing data if static files haven't changed."""
        if self.should_use_existing_routes():
            print("\n🚇 Reusing existing routes data (no changes)...")
            self.processed['routesById'] = self.existing_data['routesById']
            print(f"✓ Reused {len(self.processed['routesById'])} routes")
        else:
            print("\n🚇 Processing routes...")
            super().process_routes()
    
    def process_shapes(self):
        """Process shapes, reusing existing data if static files haven't changed."""
        if self.should_use_existing_shapes():
            print("\n📍 Reusing existing shapes data (no changes)...")
            self.processed['shapesById'] = self.existing_data['shapesById']
            print(f"✓ Reused {len(self.processed['shapesById'])} shapes")
        else:
            print("\n📍 Processing shapes...")
            super().process_shapes()
    
    def convert_selective(self, changed_files=None):
        """
        Convert GTFS data selectively based on which files have changed.
        
        Args:
            changed_files: List of filenames that have changed (e.g., ['stop_times.txt'])
                          If None, all files are considered changed (full conversion)
        """
        print("=" * 60)
        print("🚇 Metro Bilbao - Selective GTFS to JSON Converter")
        print("=" * 60)
        
        self.changed_files = changed_files or []
        
        # Load existing JSON to reuse static data
        has_existing = self.load_existing_json()
        
        if not has_existing or not changed_files:
            print("\n⚠️  No existing data or no changed files specified")
            print("   Performing full conversion...")
            self.changed_files = self.STATIC_FILES + self.DYNAMIC_FILES
        else:
            print(f"\n📝 Changed files: {', '.join(changed_files)}")
        
        # Load all GTFS files
        self.load_all()
        
        # Process data (selectively reusing where possible)
        print("\n⚙️  Processing GTFS data (selective mode)...")
        
        # Static data - reuse if unchanged
        self.process_stops()
        self.process_routes()
        self.process_shapes()
        
        # Dynamic data - always reprocess
        self.process_trips()
        self.calculate_service_numbers()
        self.process_calendar()
        
        print("\n✅ Processing complete!")
        
        # Save JSON
        self.save_json()
        
        print("\n" + "=" * 60)
        print("✨ Selective conversion complete!")
        print("=" * 60)


if __name__ == '__main__':
    import sys
    
    # Parse command line arguments
    changed_files = None
    if len(sys.argv) > 1:
        changed_files = sys.argv[1:]
        print(f"Converting with changed files: {changed_files}")
    
    converter = SelectiveGTFSConverter()
    
    if changed_files:
        converter.convert_selective(changed_files=changed_files)
    else:
        # Full conversion if no files specified
        converter.convert()
