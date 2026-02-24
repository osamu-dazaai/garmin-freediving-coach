#!/usr/bin/env python3
"""
Check for new dive activities and send analysis to Discord
"""

import sqlite3
import json
import sys
from pathlib import Path
from datetime import datetime
import pandas as pd

# Add parent directory
sys.path.insert(0, str(Path(__file__).parent))

DB_PATH = Path(__file__).parent / 'data' / 'freediving.db'
STATE_FILE = Path(__file__).parent / 'data' / 'last_checked_dive.txt'

def get_last_checked_dive():
    """Get ID of last checked dive"""
    if STATE_FILE.exists():
        return int(STATE_FILE.read_text().strip())
    return 0

def save_last_checked_dive(dive_id):
    """Save last checked dive ID"""
    STATE_FILE.write_text(str(dive_id))

def analyze_dive(dive_data):
    """
    Quick dive analysis
    """
    try:
        metadata = json.loads(dive_data['metadata']) if dive_data['metadata'] else {}
        
        max_depth = metadata.get('maxDepth', 0) / 100  # Convert cm to meters
        dive_count = metadata.get('diveCount', 0)
        bottom_time = metadata.get('bottomTime', 0)
        avg_hr = dive_data['avg_hr']
        water_temp = metadata.get('minTemperature', 0)
        location = metadata.get('locationName', 'Unknown')
        
        # Simple grading (pool diving: max 5m)
        points = 0
        
        if max_depth >= 4.5:
            points += 30
        elif max_depth >= 3.5:
            points += 25
        elif max_depth >= 2.5:
            points += 20
        else:
            points += 10
        
        if dive_count >= 8:
            points += 25
        elif dive_count >= 5:
            points += 20
        elif dive_count >= 3:
            points += 15
        else:
            points += 5
        
        if avg_hr and avg_hr < 70:
            points += 25
        elif avg_hr and avg_hr < 85:
            points += 20
        else:
            points += 10
        
        if points >= 80:
            grade = "A 🏆"
        elif points >= 70:
            grade = "B+ ✅"
        elif points >= 60:
            grade = "B 👍"
        else:
            grade = "C 🟡"
        
        return {
            'location': location,
            'max_depth': max_depth,
            'dive_count': dive_count,
            'avg_hr': avg_hr,
            'water_temp': water_temp,
            'grade': grade,
            'points': points
        }
    except Exception as e:
        return None

def main():
    """Check for new dives"""
    conn = sqlite3.connect(str(DB_PATH))
    
    # Get latest dive
    df = pd.read_sql_query("""
        SELECT * FROM activities 
        WHERE activity_type = 'apnea_diving'
        ORDER BY id DESC
        LIMIT 1
    """, conn)
    
    conn.close()
    
    if len(df) == 0:
        print("NO_NEW_DIVES")
        return
    
    latest_dive = df.iloc[0]
    dive_id = latest_dive['id']
    last_checked = get_last_checked_dive()
    
    if dive_id <= last_checked:
        print("NO_NEW_DIVES")
        return
    
    # New dive detected!
    analysis = analyze_dive(latest_dive)
    
    if not analysis:
        print("ANALYSIS_FAILED")
        save_last_checked_dive(dive_id)
        return
    
    # Format message
    dive_time = pd.to_datetime(latest_dive['start_time'])
    
    message = f"""🤿 **NEW DIVE DETECTED!**

📍 **Location:** {analysis['location']}
📅 **Date:** {dive_time.strftime('%b %d, %Y %I:%M %p')}
🎯 **Grade:** {analysis['grade']}

**Performance:**
• Max Depth: {analysis['max_depth']:.1f}m
• Total Dives: {analysis['dive_count']}
• Avg Heart Rate: {analysis['avg_hr']} bpm
• Water Temp: {analysis['water_temp']:.0f}°C

📊 **View full analysis:** http://100.126.240.92:8503

_Auto-analyzed by Freediving Coach_
"""
    
    print(message)
    
    # Save state
    save_last_checked_dive(dive_id)

if __name__ == '__main__':
    main()
