# 🚇 Metro Bilbao - GTFS Data Conversion

## 📋 Overview

This project uses pre-processed GTFS data in JSON format for optimal performance. The GTFS CSV files are converted to a single optimized JSON file that loads much faster in the browser.

The system now supports **selective updates** that only update schedule data while preserving static geometry and stop information. This prevents issues with stop coordinates changing unexpectedly.

## 🚀 Quick Start

**For Users**: Simply open `index.html` in your browser. The app will load the pre-processed data automatically.

**For Developers**: If you need to update the GTFS data, follow the conversion process below.

## 🔄 Converting GTFS Data

### Update Methods

#### Automatic Daily Updates (Recommended)

The system automatically updates schedules daily via GitHub Actions:
- **What's updated**: Schedule files (`stop_times.txt`, `calendar.txt`, `trips.txt`)
- **What's preserved**: Static files (`stops.txt`, `shapes.txt`, `routes.txt`)
- **When**: Daily at 04:00 UTC
- **Validation**: Automatic data integrity checks before commit

#### Manual Selective Update

For updating only schedule data while preserving geometry:

```bash
python update_gtfs.py
```

This will:
1. Download the latest GTFS data
2. Update only schedule-related files
3. Preserve stop coordinates and route shapes
4. Run selective JSON conversion

#### Manual Full Conversion

For a complete rebuild (when setting up or after structural changes):

```bash
python convert_gtfs_to_json.py
```

### When to Use Each Method

**Use selective update** (`update_gtfs.py`) when:
- Updating daily schedules
- You want to preserve stop locations
- You want faster processing

**Use full conversion** (`convert_gtfs_to_json.py`) when:
- Setting up for the first time
- New stops have been added
- Route geometry has changed
- You need to rebuild everything

### Requirements

- Python 3.6 or higher
- No additional Python packages required (uses only standard library)

### Validation

Validate GTFS data integrity:

```bash
python validate_gtfs.py
```

This checks:
- All references between trips and stops are valid
- No orphaned IDs
- Schedule consistency
- Coordinate validity

### Example Output - Selective Update

```
============================================================
🚇 Metro Bilbao - Selective GTFS to JSON Converter
============================================================
✓ Loaded existing JSON data from gtfs/gtfs-data.json

📝 Changed files: stop_times.txt, calendar.txt, trips.txt

📂 Loading GTFS files...
✓ Loaded agency.txt: 1 records
✓ Loaded stops.txt: 191 records
[...]

⚙️  Processing GTFS data (selective mode)...

🚉 Reusing existing stops data (no changes)...
✓ Reused 84 stops

🚇 Reusing existing routes data (no changes)...
✓ Reused 1 routes

📍 Reusing existing shapes data (no changes)...
✓ Reused 35 shapes

🚆 Processing trips and stop times...
✓ Processed 11194 trips

📅 Processing calendar...
✓ Processed 6 calendar entries

✅ Processing complete!

💾 Saving to gtfs/gtfs-data.json...
✓ Saved successfully!
📊 File size: 48.56 MB (50920272 bytes)

============================================================
✨ Selective conversion complete!
============================================================
```

### Example Output - Full Conversion

```
============================================================
🚇 Metro Bilbao - GTFS to JSON Converter
============================================================

📂 Loading GTFS files...
✓ Loaded agency.txt: 1 records
✓ Loaded stops.txt: 191 records
✓ Loaded routes.txt: 1 records
✓ Loaded trips.txt: 11194 records
✓ Loaded stop_times.txt: 287989 records
✓ Loaded shapes.txt: 14316 records
✓ Loaded calendar.txt: 6 records
✓ Loaded calendar_dates.txt: 38 records

⚙️  Processing GTFS data...

🚉 Processing stops...
✓ Processed 84 stops

🚇 Processing routes...
✓ Processed 1 routes

📍 Processing shapes...
✓ Processed 35 shapes

🚆 Processing trips and stop times...
✓ Processed 11194 trips

📅 Processing calendar...
✓ Processed 6 calendar entries
✓ Processed 38 calendar date exceptions

✅ Processing complete!

💾 Saving to gtfs/gtfs-data.json...
✓ Saved successfully!
📊 File size: 48.56 MB (50920272 bytes)

============================================================
✨ Conversion complete! You can now use the web app.
============================================================
```

## 📊 Performance Benefits

### Before (CSV Parsing)
- **Load Time**: 5-10 seconds
- **Processing**: Done in browser
- **Memory**: High (parsing + processing)
- **User Experience**: Long loading screen

### After (JSON Loading)
- **Load Time**: 1-2 seconds
- **Processing**: Pre-processed
- **Memory**: Lower (direct loading)
- **User Experience**: Fast, smooth loading

### With Selective Updates
- **Update Speed**: 50% faster (only processes changed data)
- **Data Stability**: Stop coordinates never change unexpectedly
- **CI/CD**: Fewer conflicts and merge issues
- **Reliability**: Icons show correct upcoming trains

## 🗂️ Generated Data Structure

The `gtfs-data.json` file contains:

```json
{
  "stopsById": {
    "stop_id": {
      "id": "...",
      "name": "...",
      "lat": 0.0,
      "lon": 0.0
    }
  },
  "routesById": { ... },
  "tripsById": { ... },
  "shapesById": { ... },
  "tripsByShapeId": { ... },
  "calendar": [ ... ],
  "calendar_dates": [ ... ]
}
```

## 🛠️ Troubleshooting

### Script fails to run
- **Check Python version**: `python --version` (should be 3.6+)
- **Try**: `python3 convert_gtfs_to_json.py` on some systems

### Missing GTFS files
- The script will warn about missing files
- Critical files: `stops.txt`, `routes.txt`, `trips.txt`, `stop_times.txt`, `shapes.txt`
- Optional files: `calendar.txt`, `calendar_dates.txt`

### JSON file not generated
- Check write permissions in the `gtfs/` folder
- Ensure there's enough disk space (need ~50 MB free)

### Web app doesn't load
- Check browser console (F12) for errors
- Verify `gtfs/gtfs-data.json` exists
- Try hard refresh (Ctrl+F5)

## 📝 Notes

- The original CSV files are **not modified** by the conversion
- You can keep both CSV and JSON files
- The web app only uses the JSON file
- Re-run conversion whenever GTFS data is updated

## 🔗 GTFS Data Source

Metro Bilbao GTFS data: [Add your data source URL here]

## 📄 License

[Add your license information here]
