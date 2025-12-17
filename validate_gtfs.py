import csv
import os
from collections import defaultdict


class GTFSValidator:
    """Validates GTFS data integrity and consistency."""
    
    def __init__(self, gtfs_folder='gtfs'):
        self.gtfs_folder = gtfs_folder
        self.errors = []
        self.warnings = []
        self.data = {}
        
    def load_csv(self, filename):
        """Load a CSV file and return its contents as a list of dictionaries."""
        filepath = os.path.join(self.gtfs_folder, filename)
        if not os.path.exists(filepath):
            self.warnings.append(f"File not found: {filename}")
            return []
        
        try:
            with open(filepath, 'r', encoding='utf-8-sig') as f:
                reader = csv.DictReader(f)
                return list(reader)
        except (UnicodeDecodeError, csv.Error, OSError) as e:
            self.errors.append(f"Error loading {filename}: {e}")
            return []
    
    def load_all(self):
        """Load all required GTFS files."""
        print("📂 Loading GTFS files for validation...")
        self.data['agency'] = self.load_csv('agency.txt')
        self.data['stops'] = self.load_csv('stops.txt')
        self.data['routes'] = self.load_csv('routes.txt')
        self.data['trips'] = self.load_csv('trips.txt')
        self.data['stop_times'] = self.load_csv('stop_times.txt')
        self.data['shapes'] = self.load_csv('shapes.txt')
        self.data['calendar'] = self.load_csv('calendar.txt')
        self.data['calendar_dates'] = self.load_csv('calendar_dates.txt')
        
    def validate_references(self):
        """Validate that all references between files are valid."""
        print("\n🔗 Validating references between files...")
        
        # Build ID sets
        stop_ids = {stop['stop_id'] for stop in self.data['stops']}
        route_ids = {route['route_id'] for route in self.data['routes']}
        trip_ids = {trip['trip_id'] for trip in self.data['trips']}
        shape_ids = {shape['shape_id'] for shape in self.data['shapes']}
        service_ids = set()
        
        # Collect service IDs from calendar and calendar_dates
        for cal in self.data['calendar']:
            service_ids.add(cal['service_id'])
        for cal_date in self.data['calendar_dates']:
            service_ids.add(cal_date['service_id'])
        
        # Validate trip references
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
            self.errors.append(f"Found {invalid_route_refs} trips with invalid route_id references")
        if invalid_service_refs > 0:
            self.errors.append(f"Found {invalid_service_refs} trips with invalid service_id references")
        if invalid_shape_refs > 0:
            self.warnings.append(f"Found {invalid_shape_refs} trips with invalid shape_id references")
        
        # Validate stop_times references
        invalid_trip_refs = 0
        invalid_stop_refs = 0
        
        for stop_time in self.data['stop_times']:
            if stop_time['trip_id'] not in trip_ids:
                invalid_trip_refs += 1
            if stop_time['stop_id'] not in stop_ids:
                invalid_stop_refs += 1
        
        if invalid_trip_refs > 0:
            self.errors.append(f"Found {invalid_trip_refs} stop_times with invalid trip_id references")
        if invalid_stop_refs > 0:
            self.errors.append(f"Found {invalid_stop_refs} stop_times with invalid stop_id references")
        
        if not self.errors:
            print("✓ All references are valid")
        
    def validate_schedule_consistency(self):
        """Validate that schedules are coherent."""
        print("\n⏰ Validating schedule consistency...")
        
        # Group stop_times by trip
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
            # Sort by sequence
            stop_times.sort(key=lambda x: x['seq'])
            
            # Check sequence continuity
            expected_seq = 1
            for st in stop_times:
                if st['seq'] != expected_seq:
                    invalid_sequences += 1
                    break
                expected_seq += 1
            
            # Check time progression (times are in HH:MM:SS format as strings)
            prev_departure = None
            for st in stop_times:
                # Convert time strings to comparable format (simple string comparison works for HH:MM:SS)
                # Note: GTFS times can exceed 24:00:00 for trips past midnight
                if prev_departure and st['arrival'] and st['arrival'] < prev_departure:
                    invalid_times += 1
                    break
                if st['departure']:
                    prev_departure = st['departure']
        
        if invalid_sequences > 0:
            self.warnings.append(f"Found {invalid_sequences} trips with non-continuous stop sequences")
        if invalid_times > 0:
            self.errors.append(f"Found {invalid_times} trips with non-monotonic times")
        
        if not self.errors and invalid_sequences == 0:
            print("✓ Schedule consistency validated")
    
    def validate_coordinates(self):
        """Validate that stop coordinates are reasonable."""
        print("\n📍 Validating coordinates...")
        
        # Metro Bilbao is roughly between these coordinates (with some buffer)
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
            self.errors.append(f"Found {invalid_coords} stops with invalid coordinates")
        else:
            print("✓ All coordinates are valid")
    
    def validate_file_completeness(self):
        """Check that all required files exist and are not empty."""
        print("\n📋 Validating file completeness...")
        
        required_files = ['stops.txt', 'routes.txt', 'trips.txt', 'stop_times.txt']
        optional_files = ['agency.txt', 'shapes.txt', 'calendar.txt', 'calendar_dates.txt']
        
        for filename in required_files:
            data = self.data.get(filename.replace('.txt', ''), [])
            if not data:
                self.errors.append(f"Required file is missing or empty: {filename}")
        
        for filename in optional_files:
            data = self.data.get(filename.replace('.txt', ''), [])
            if not data:
                self.warnings.append(f"Optional file is missing or empty: {filename}")
        
        if not self.errors:
            print("✓ All required files present")
    
    def validate(self):
        """Run all validation checks."""
        print("=" * 60)
        print("🔍 GTFS Data Validation")
        print("=" * 60)
        
        self.load_all()
        
        if not self.data.get('stops') and not self.data.get('trips'):
            print("⚠️ No GTFS data found locally.")
            print("🔄 Attempting to download and install latest GTFS data...")
            try:
                from update_gtfs import update_gtfs
                if update_gtfs():
                    print("✅ Data successfully downloaded. Retrying validation...")
                    self.load_all()
                else:
                    print("❌ Failed to download GTFS data. Validation aborted.")
                    return False
            except ImportError:
                 print("❌ Could not import update_gtfs module. validation aborted.")
                 return False

        if not self.data.get('stops') and not self.data.get('trips'):
             print("❌ Still no data found after update attempt.")
             return False
        
        self.validate_file_completeness()
        self.validate_coordinates()
        self.validate_references()
        self.validate_schedule_consistency()
        
        print("\n" + "=" * 60)
        print("📊 Validation Summary")
        print("=" * 60)
        
        if self.errors:
            print(f"\n❌ Found {len(self.errors)} error(s):")
            for error in self.errors:
                print(f"  • {error}")
        
        if self.warnings:
            print(f"\n⚠️  Found {len(self.warnings)} warning(s):")
            for warning in self.warnings:
                print(f"  • {warning}")
        
        if not self.errors and not self.warnings:
            print("\n✅ All validation checks passed!")
            return True
        elif not self.errors:
            print("\n✅ Validation passed with warnings")
            return True
        else:
            print("\n❌ Validation failed")
            return False


if __name__ == '__main__':
    validator = GTFSValidator()
    success = validator.validate()
    exit(0 if success else 1)
