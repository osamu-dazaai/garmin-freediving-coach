#!/usr/bin/env python3
"""
Explore detailed dive data from Garmin API
"""

import os
import sys
import json
import sqlite3
from pathlib import Path
from dotenv import load_dotenv
from garminconnect import Garmin

load_dotenv()

# Get an existing dive activity ID
db_path = Path('data/freediving.db')
conn = sqlite3.connect(str(db_path))
cursor = conn.cursor()
cursor.execute("SELECT garmin_activity_id FROM activities WHERE activity_type = 'apnea_diving' ORDER BY id DESC LIMIT 1")
activity_id = cursor.fetchone()[0]
conn.close()

print(f"🤿 Exploring dive activity: {activity_id}\n")

# Login to Garmin
email = os.getenv('GARMIN_EMAIL')
password = os.getenv('GARMIN_PASSWORD')

client = Garmin(email, password)
client.login()

print("=" * 60)
print("1. ACTIVITY DETAILS")
print("=" * 60)
try:
    details = client.get_activity_details(activity_id)
    print(f"Keys: {list(details.keys())}")
    
    # Look for dive-specific fields
    interesting_keys = ['diveStats', 'dives', 'splits', 'metrics', 'samples', 'detailsAvailable']
    for key in interesting_keys:
        if key in details:
            print(f"\n{key}:")
            print(json.dumps(details[key], indent=2)[:500])
except Exception as e:
    print(f"Error: {e}")

print("\n" + "=" * 60)
print("2. ACTIVITY SPLITS")
print("=" * 60)
try:
    splits = client.get_activity_splits(activity_id)
    print(f"Type: {type(splits)}")
    if splits:
        print(json.dumps(splits, indent=2)[:1000])
except Exception as e:
    print(f"Error: {e}")

print("\n" + "=" * 60)
print("3. TYPED SPLITS (Dive-specific?)")
print("=" * 60)
try:
    typed_splits = client.get_activity_typed_splits(activity_id)
    print(f"Type: {type(typed_splits)}")
    if typed_splits:
        print(json.dumps(typed_splits, indent=2)[:1000])
except Exception as e:
    print(f"Error: {e}")

print("\n" + "=" * 60)
print("4. SPLIT SUMMARIES")
print("=" * 60)
try:
    summaries = client.get_activity_split_summaries(activity_id)
    print(f"Type: {type(summaries)}")
    if summaries:
        print(json.dumps(summaries, indent=2)[:1000])
except Exception as e:
    print(f"Error: {e}")

print("\n" + "=" * 60)
print("5. DOWNLOAD ACTIVITY (FIT file?)")
print("=" * 60)
try:
    # Try different download formats
    from garminconnect import Garmin
    
    # Check available formats
    print("Available formats:")
    for attr in dir(Garmin.ActivityDownloadFormat):
        if not attr.startswith('_'):
            print(f"  - {attr}")
    
    # Try downloading as JSON/GPX/TCX
    download_path = Path('data/temp_activity.fit')
    data = client.download_activity(activity_id, dl_fmt=Garmin.ActivityDownloadFormat.ORIGINAL)
    
    if data:
        download_path.write_bytes(data)
        print(f"Downloaded {len(data)} bytes to {download_path}")
        print(f"First 200 bytes (hex): {data[:200].hex()}")
except Exception as e:
    print(f"Error: {e}")

print("\n" + "=" * 60)
print("6. HR TIME ZONES")
print("=" * 60)
try:
    hr_zones = client.get_activity_hr_in_timezones(activity_id)
    if hr_zones:
        print(json.dumps(hr_zones, indent=2)[:500])
except Exception as e:
    print(f"Error: {e}")

print("\n✅ Exploration complete!")
