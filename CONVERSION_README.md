# 🚇 Metro Bilbao - GTFS Data Conversion

## 📋 Overview

This project uses pre-processed GTFS data in JSON format for optimal performance. The GTFS CSV files are converted to a single optimized JSON file that loads much faster in the browser.

## 🚀 Quick Start

**For Users**: Simply open `index.html` in your browser. The app will load the pre-processed data automatically.

**For Developers**: If you need to update the GTFS data, follow the conversion process below.

## 🔄 Converting GTFS Data

### When to Convert

You need to run the conversion script when:
- You have new GTFS data files
- The transit schedule has been updated
- You're setting up the project for the first time

### Requirements

- Python 3.6 or higher
- No additional Python packages required (uses only standard library)

### Conversion Steps

1. **Place GTFS files** in the `gtfs/` folder:
   - `agency.txt`
   - `stops.txt`
   - `routes.txt`
   - `trips.txt`
   - `stop_times.txt`
   - `shapes.txt`
   - `calendar.txt`
   - `calendar_dates.txt`

2. **Run the conversion script**:
   ```bash
   python convert_gtfs_to_json.py
   ```

3. **Wait for completion**. The script will:
   - Load all GTFS CSV files
   - Process and optimize the data
   - Generate `gtfs/gtfs-data.json`
   - Display statistics about the conversion

4. **Verify the output**:
   - Check that `gtfs/gtfs-data.json` was created
   - The file size should be around 40-50 MB for Metro Bilbao data

### Example Output

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
