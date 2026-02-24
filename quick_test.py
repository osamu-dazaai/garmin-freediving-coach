#!/usr/bin/env python3
import sys
import sqlite3
from pathlib import Path
import numpy as np

sys.path.insert(0, str(Path(__file__).parent / 'src' / 'analysis'))

from dive_parser import DiveParser
from discipline_detector import analyze_and_classify_dive

# Get activity
db_path = Path('data/freediving.db')
conn = sqlite3.connect(str(db_path))
cursor = conn.cursor()
cursor.execute("SELECT garmin_activity_id FROM activities WHERE activity_type = 'apnea_diving' ORDER BY id DESC LIMIT 1")
activity_id = cursor.fetchone()[0]
conn.close()

# Parse
parser = DiveParser()
session = parser.parse_session(activity_id, analyze=True)
dives = session['dives']

# Classify
avg_hrs = [d.avg_hr for d in dives if d.avg_hr]
session_avg_hr = np.mean(avg_hrs)

print(f"Session: {len(dives)} dives, Avg HR: {session_avg_hr:.1f} bpm\n")

for dive in dives:
    result = analyze_and_classify_dive(dive, session_avg_hr)
    disc = result['discipline']
    lung = result['lung_volume']
    
    print(f"Dive {dive.dive_number}: {dive.max_depth:.1f}m, {dive.avg_hr:.0f} bpm")
    print(f"  → {disc['value'].upper()} ({disc['confidence']:.0f}%) | {lung['value'].upper()} ({lung['confidence']:.0f}%)")

print("\n✅ Quick test passed!")
