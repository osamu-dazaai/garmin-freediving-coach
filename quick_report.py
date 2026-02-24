#!/usr/bin/env python3
"""Quick readiness report from synced data"""

import sqlite3
import os
from datetime import datetime, timedelta
from pathlib import Path

# Load environment
from dotenv import load_dotenv
load_dotenv()

DB_PATH = Path(os.getenv('DATABASE_PATH', 'data/freediving.db'))

def get_readiness_report():
    """Generate a readiness report from last 7 days"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    print("\n" + "="*60)
    print("🌊 FREEDIVING READINESS REPORT")
    print("="*60)
    
    # Recent activities
    print("\n📊 RECENT DIVE SESSIONS")
    print("-" * 60)
    cursor.execute("""
        SELECT start_time, activity_type, duration, calories, avg_hr, max_hr,
               json_extract(metadata, '$.activityName') as name
        FROM activities
        WHERE activity_type = 'apnea_diving'
        ORDER BY start_time DESC
        LIMIT 5
    """)
    
    activities = cursor.fetchall()
    if activities:
        for act in activities:
            date = datetime.fromisoformat(act['start_time']).strftime('%b %d, %H:%M')
            duration = int(act['duration'] / 60) if act['duration'] else 0
            hr = f"HR {act['avg_hr']}/{act['max_hr']}" if act['avg_hr'] else ""
            name = act['name'] or 'Apnea Dive'
            print(f"  {date}: {name} ({duration} min) {hr}")
    else:
        print("  No recent dives found")
    
    # Health metrics
    print("\n💓 RECOVERY METRICS (Last 7 days)")
    print("-" * 60)
    cursor.execute("""
        SELECT date, resting_hr, hrv_status, body_battery_charged, 
               sleep_score, stress_avg
        FROM health_metrics
        WHERE date >= date('now', '-7 days')
        ORDER BY date DESC
    """)
    
    metrics = cursor.fetchall()
    if metrics:
        print(f"{'Date':<12} {'RHR':>5} {'HRV':>12} {'Battery':>8} {'Sleep':>7} {'Stress':>7}")
        print("-" * 60)
        for m in metrics:
            date = datetime.fromisoformat(m['date']).strftime('%b %d')
            rhr = m['resting_hr'] or 'N/A'
            hrv = m['hrv_status'] or 'N/A'
            battery = f"{m['body_battery_charged']}%" if m['body_battery_charged'] else 'N/A'
            sleep = m['sleep_score'] or 'N/A'
            stress = m['stress_avg'] or 'N/A'
            print(f"{date:<12} {str(rhr):>5} {str(hrv):>12} {str(battery):>8} {str(sleep):>7} {str(stress):>7}")
    
    # Readiness score calculation
    print("\n🎯 TRAINING READINESS")
    print("-" * 60)
    
    cursor.execute("""
        SELECT 
            AVG(body_battery_charged) as avg_battery,
            AVG(sleep_score) as avg_sleep,
            AVG(stress_avg) as avg_stress,
            AVG(resting_hr) as avg_rhr
        FROM health_metrics
        WHERE date >= date('now', '-3 days')
    """)
    
    avg = cursor.fetchone()
    
    battery = avg['avg_battery'] or 0
    sleep = avg['avg_sleep'] or 0
    stress = avg['avg_stress'] or 50
    
    # Simple readiness score (0-100)
    readiness = (battery * 0.4 + sleep * 0.4 + (100 - stress) * 0.2)
    
    print(f"  3-Day Averages:")
    print(f"    Body Battery: {battery:.0f}%")
    print(f"    Sleep Score: {sleep:.0f}")
    print(f"    Stress: {stress:.0f}")
    print(f"    Resting HR: {avg['avg_rhr']:.0f} bpm" if avg['avg_rhr'] else "    Resting HR: N/A")
    print()
    print(f"  📊 Readiness Score: {readiness:.0f}/100")
    
    if readiness >= 80:
        print("  ✅ OPTIMAL - Great for depth work or max attempts")
    elif readiness >= 65:
        print("  💚 GOOD - Ready for training, moderate intensity")
    elif readiness >= 50:
        print("  🟡 MODERATE - Light training or technique work")
    else:
        print("  🔴 LOW - Focus on recovery, consider rest day")
    
    # Recommendations
    print("\n📋 RECOMMENDATIONS")
    print("-" * 60)
    
    if readiness >= 80:
        print("  • Push depth limits today")
        print("  • Try max static/dynamic attempts")
        print("  • Focus on challenging yourself")
    elif readiness >= 65:
        print("  • Standard training session")
        print("  • CO2/O2 tables")
        print("  • Moderate depth work")
    elif readiness >= 50:
        print("  • Light technique work")
        print("  • Relaxation drills")
        print("  • Breathing exercises")
    else:
        print("  • Rest day recommended")
        print("  • Gentle stretching")
        print("  • Focus on sleep quality tonight")
    
    print("\n" + "="*60 + "\n")
    
    conn.close()

if __name__ == '__main__':
    get_readiness_report()
