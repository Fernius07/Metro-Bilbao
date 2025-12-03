#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
GTFS to JSON Converter for Metro Bilbao
Converts GTFS CSV files to optimized JSON format for faster web loading
"""

import csv
import json
import math
import os
from pathlib import Path


class GTFSConverter:
    def __init__(self, gtfs_folder='gtfs'):
        self.gtfs_folder = gtfs_folder
        self.data = {
            'agency': [],
            'stops': [],
            'routes': [],
            'trips': [],
            'stop_times': [],
            'shapes': [],
            'calendar': [],
            'calendar_dates': []
        }
        self.processed = {
            'stopsById': {},
            'routesById': {},
            'tripsById': {},
            'shapesById': {},
            'tripsByShapeId': {},
            'calendar': [],
            'calendar_dates': []
        }

    def load_csv(self, filename):
        """Load a GTFS CSV file"""
        filepath = os.path.join(self.gtfs_folder, filename)
        if not os.path.exists(filepath):
            print(f"⚠️  Warning: {filename} not found, skipping...")
            return []
        
        try:
            with open(filepath, 'r', encoding='utf-8-sig') as f:
                reader = csv.DictReader(f)
                data = list(reader)
                print(f"✓ Loaded {filename}: {len(data)} records")
                return data
        except Exception as e:
            print(f"✗ Error loading {filename}: {e}")
            return []

    def load_all(self):
        """Load all GTFS files"""
        print("\n📂 Loading GTFS files...")
        self.data['agency'] = self.load_csv('agency.txt')
        self.data['stops'] = self.load_csv('stops.txt')
        self.data['routes'] = self.load_csv('routes.txt')
        self.data['trips'] = self.load_csv('trips.txt')
        self.data['stop_times'] = self.load_csv('stop_times.txt')
        self.data['shapes'] = self.load_csv('shapes.txt')
        self.data['calendar'] = self.load_csv('calendar.txt')
        self.data['calendar_dates'] = self.load_csv('calendar_dates.txt')

    def haversine(self, lat1, lon1, lat2, lon2):
        """Calculate distance between two points in meters"""
        R = 6371e3  # Earth radius in meters
        φ1 = math.radians(lat1)
        φ2 = math.radians(lat2)
        Δφ = math.radians(lat2 - lat1)
        Δλ = math.radians(lon2 - lon1)

        a = math.sin(Δφ / 2) ** 2 + math.cos(φ1) * math.cos(φ2) * math.sin(Δλ / 2) ** 2
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

        return R * c

    def parse_time(self, time_str):
        """Parse HH:MM:SS to seconds from midnight (handles >24h)"""
        if not time_str:
            return 0
        parts = time_str.split(':')
        return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])

    def process_stops(self):
        """Process and index stops"""
        print("\n🚉 Processing stops...")
        for stop in self.data['stops']:
            # Filter stops that start with a number (as per original logic)
            if stop['stop_name'] and not stop['stop_name'][0].isdigit():
                self.processed['stopsById'][stop['stop_id']] = {
                    'id': stop['stop_id'],
                    'name': stop['stop_name'],
                    'lat': float(stop['stop_lat']),
                    'lon': float(stop['stop_lon'])
                }
        print(f"✓ Processed {len(self.processed['stopsById'])} stops")

    def process_routes(self):
        """Process and index routes"""
        print("\n🚇 Processing routes...")
        for route in self.data['routes']:
            color = f"#{route['route_color']}" if route.get('route_color') else '#0066cc'
            text_color = f"#{route['route_text_color']}" if route.get('route_text_color') else '#ffffff'
            
            self.processed['routesById'][route['route_id']] = {
                'id': route['route_id'],
                'short_name': route.get('route_short_name', ''),
                'long_name': route.get('route_long_name', ''),
                'color': color,
                'text_color': text_color
            }
        print(f"✓ Processed {len(self.processed['routesById'])} routes")

    def process_shapes(self):
        """Process and index shapes"""
        print("\n📍 Processing shapes...")
        shapes_raw = {}
        
        # Group by shape_id
        for shape in self.data['shapes']:
            shape_id = shape['shape_id']
            if shape_id not in shapes_raw:
                shapes_raw[shape_id] = []
            
            shapes_raw[shape_id].append({
                'lat': float(shape['shape_pt_lat']),
                'lon': float(shape['shape_pt_lon']),
                'seq': int(shape['shape_pt_sequence']),
                'dist': float(shape['shape_dist_traveled']) if shape.get('shape_dist_traveled') else None
            })
        
        # Sort and calculate distances
        for shape_id, points in shapes_raw.items():
            points.sort(key=lambda p: p['seq'])
            
            # Calculate cumulative distance if missing
            if points[0]['dist'] is None:
                total_dist = 0
                points[0]['dist'] = 0
                for i in range(1, len(points)):
                    d = self.haversine(
                        points[i-1]['lat'], points[i-1]['lon'],
                        points[i]['lat'], points[i]['lon']
                    )
                    total_dist += d
                    points[i]['dist'] = total_dist
            
            self.processed['shapesById'][shape_id] = {
                'id': shape_id,
                'points': points,
                'totalDistance': points[-1]['dist']
            }
        
        print(f"✓ Processed {len(self.processed['shapesById'])} shapes")

    def project_stops_onto_shape(self, stop_times, shape):
        """Project stops onto shape to calculate shape_dist_traveled"""
        for st in stop_times:
            if st['shape_dist'] is not None:
                continue
            
            stop = self.processed['stopsById'].get(st['stop_id'])
            if not stop:
                continue
            
            # Find closest point on shape
            min_dist = float('inf')
            closest_shape_dist = 0
            
            for point in shape['points']:
                dist = self.haversine(stop['lat'], stop['lon'], point['lat'], point['lon'])
                if dist < min_dist:
                    min_dist = dist
                    closest_shape_dist = point['dist']
            
            st['shape_dist'] = closest_shape_dist

    def get_terminal_stations(self, stop_name):
        """Normalize stop names to identify terminal stations"""
        name_lower = stop_name.lower().strip()
        
        # Map variations to canonical names
        terminal_map = {
            'plentzia': 'Plentzia',
            'etxebarri': 'Etxebarri',
            'sopela': 'Sopela',
            'larrabasterra': 'Larrabasterra',
            'ibarbengoa': 'Ibarbengoa',
            'san inazio': 'San Inazio',
            'kabiezes': 'Kabiezes',
            'basauri': 'Basauri'
        }
        
        for key, value in terminal_map.items():
            if key in name_lower:
                return value
        return None
    
    def get_route_code(self, origin, destination):
        """Get route code based on origin-destination pair"""
        # Normalize to handle both directions
        terminals = sorted([origin, destination])
        
        route_codes = {
            ('Etxebarri', 'Plentzia'): 38,
            ('Etxebarri', 'Sopela'): 37,
            ('Etxebarri', 'Larrabasterra'): 35,
            ('Etxebarri', 'Ibarbengoa'): 32,
            ('Etxebarri', 'San Inazio'): 31,
            ('Basauri', 'Kabiezes'): 25
        }
        
        return route_codes.get(tuple(terminals), 99)  # Default to 99 if unknown
    
    def is_main_terminal_direction(self, destination):
        """Check if destination is a main terminal (Etxebarri or Basauri)"""
        return destination in ['Etxebarri', 'Basauri']
    
    def calculate_service_numbers(self):
        """Calculate service numbers for all trips"""
        print("\n🔢 Calculating service numbers...")
        
        # Group trips by service_id (day), route, and direction
        trips_by_service_route_dir = {}
        
        for trip_id, trip in self.processed['tripsById'].items():
            if not trip['stop_times']:
                continue
            
            # Get origin and destination
            first_stop_id = trip['stop_times'][0]['stop_id']
            last_stop_id = trip['stop_times'][-1]['stop_id']
            
            first_stop = self.processed['stopsById'].get(first_stop_id)
            last_stop = self.processed['stopsById'].get(last_stop_id)
            
            if not first_stop or not last_stop:
                continue
            
            origin = self.get_terminal_stations(first_stop['name'])
            destination = self.get_terminal_stations(last_stop['name'])
            
            if not origin or not destination:
                continue
            
            # Get route code
            route_code = self.get_route_code(origin, destination)
            
            # Determine if this is main terminal direction (even) or not (odd)
            is_main_dir = self.is_main_terminal_direction(destination)
            
            # Create key for grouping: service_id, route_code, direction
            # This ensures numbers reset for each day (service_id)
            key = (trip['service_id'], route_code, is_main_dir)
            
            if key not in trips_by_service_route_dir:
                trips_by_service_route_dir[key] = []
            
            trips_by_service_route_dir[key].append({
                'trip_id': trip_id,
                'start_time': trip['stop_times'][0]['departure'],
                'origin': origin,
                'destination': destination
            })
        
        # Sort trips by start time and assign service numbers
        for (service_id, route_code, is_main_dir), trips in trips_by_service_route_dir.items():
            # Sort by departure time
            trips.sort(key=lambda t: t['start_time'])
            
            # Initialize counters for this specific service day
            even_counter = 0
            odd_counter = 1
            
            for trip_info in trips:
                trip_id = trip_info['trip_id']
                
                # Get next number (even or odd)
                if is_main_dir:
                    # Even number for main terminal direction
                    seq_num = even_counter
                    even_counter += 2
                else:
                    # Odd number for secondary terminal direction
                    seq_num = odd_counter
                    odd_counter += 2
                
                # Handle overflow for Kabiezes-Basauri (25 -> 26 when > 99)
                current_route_code = route_code
                if route_code == 25 and seq_num > 99:
                    current_route_code = 26
                    seq_num = seq_num - 100
                
                # Create 4-digit service number
                service_number = f"{current_route_code}{seq_num:02d}"
                
                # Add to trip
                self.processed['tripsById'][trip_id]['service_number'] = service_number
        
        # Count trips with service numbers
        trips_with_numbers = sum(1 for t in self.processed['tripsById'].values() if 'service_number' in t)
        print(f"✓ Assigned service numbers to {trips_with_numbers} trips")
    
    def process_trips(self):
        """Process trips and stop times"""
        print("\n🚆 Processing trips and stop times...")
        
        # Group stop_times by trip_id
        stop_times_by_trip = {}
        for st in self.data['stop_times']:
            trip_id = st['trip_id']
            if trip_id not in stop_times_by_trip:
                stop_times_by_trip[trip_id] = []
            
            stop_times_by_trip[trip_id].append({
                'stop_id': st['stop_id'],
                'seq': int(st['stop_sequence']),
                'arrival': self.parse_time(st['arrival_time']),
                'departure': self.parse_time(st['departure_time']),
                'shape_dist': float(st['shape_dist_traveled']) if st.get('shape_dist_traveled') else None
            })
        
        # Sort stop times
        for times in stop_times_by_trip.values():
            times.sort(key=lambda t: t['seq'])
        
        # Create trip objects
        for trip in self.data['trips']:
            trip_id = trip['trip_id']
            stop_times = stop_times_by_trip.get(trip_id)
            if not stop_times:
                continue
            
            trip_obj = {
                'id': trip_id,
                'route_id': trip['route_id'],
                'service_id': trip['service_id'],
                'shape_id': trip.get('shape_id', ''),
                'direction_id': trip.get('direction_id', ''),
                'stop_times': stop_times
            }
            
            # Project stops onto shape if shape_dist is missing
            if trip.get('shape_id') and any(st['shape_dist'] is None for st in stop_times):
                shape = self.processed['shapesById'].get(trip['shape_id'])
                if shape:
                    self.project_stops_onto_shape(stop_times, shape)
            
            self.processed['tripsById'][trip_id] = trip_obj
            
            # Index by shape_id
            if trip.get('shape_id'):
                shape_id = trip['shape_id']
                if shape_id not in self.processed['tripsByShapeId']:
                    self.processed['tripsByShapeId'][shape_id] = []
                self.processed['tripsByShapeId'][shape_id].append(trip_obj)
        
        print(f"✓ Processed {len(self.processed['tripsById'])} trips")

    def process_calendar(self):
        """Process calendar data"""
        print("\n📅 Processing calendar...")
        self.processed['calendar'] = self.data['calendar']
        self.processed['calendar_dates'] = self.data['calendar_dates']
        print(f"✓ Processed {len(self.processed['calendar'])} calendar entries")
        print(f"✓ Processed {len(self.processed['calendar_dates'])} calendar date exceptions")

    def process_all(self):
        """Process all GTFS data"""
        print("\n⚙️  Processing GTFS data...")
        self.process_stops()
        self.process_routes()
        self.process_shapes()
        self.process_trips()
        self.calculate_service_numbers()  # Add service numbers after trips are processed
        self.process_calendar()
        print("\n✅ Processing complete!")

    def save_json(self, output_file='gtfs/gtfs-data.json'):
        """Save processed data to JSON"""
        print(f"\n💾 Saving to {output_file}...")
        
        # Ensure output directory exists
        os.makedirs(os.path.dirname(output_file), exist_ok=True)
        
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(self.processed, f, ensure_ascii=False, separators=(',', ':'))
        
        # Get file size
        file_size = os.path.getsize(output_file)
        size_mb = file_size / (1024 * 1024)
        
        print(f"✓ Saved successfully!")
        print(f"📊 File size: {size_mb:.2f} MB ({file_size:,} bytes)")

    def convert(self):
        """Main conversion process"""
        print("=" * 60)
        print("🚇 Metro Bilbao - GTFS to JSON Converter")
        print("=" * 60)
        
        self.load_all()
        self.process_all()
        self.save_json()
        
        print("\n" + "=" * 60)
        print("✨ Conversion complete! You can now use the web app.")
        print("=" * 60)


if __name__ == '__main__':
    converter = GTFSConverter()
    converter.convert()
