#!/usr/bin/env python3
"""Check sleep data history"""

import sqlite3
from datetime import datetime
from pathlib import Path

DB_PATH = Path('data/freediving.db')
conn = sqlite3.connect(DB_PATH)
conn.row_factory = sqlite3.Row
cursor = conn.cursor()

print("\n" + "="*80)
print("😴 SLEEP DATA HISTORY")
print("="*80)

# Get all health metrics with sleep data
cursor.execute("""
    SELECT date, sleep_score, sleep_duration, sleep_deep, sleep_light, 
           sleep_rem, sleep_awake, resting_hr, body_battery_charged
    FROM health_metrics
    ORDER BY date DESC
    LIMIT 30
""")

metrics = cursor.fetchall()

print(f"\n{'Date':<12} {'Score':>7} {'Duration':>10} {'Deep':>7} {'Light':>7} {'REM':>7} {'Awake':>7} {'RHR':>5} {'Battery':>8}")
print("-" * 80)

nights_with_sleep = 0
nights_without_sleep = 0

for m in metrics:
    date = datetime.fromisoformat(m['date']).strftime('%b %d')
    score = m['sleep_score'] if m['sleep_score'] else 'N/A'
    duration = f"{m['sleep_duration']//60}h {m['sleep_duration']%60}m" if m['sleep_duration'] else 'N/A'
    deep = f"{m['sleep_deep']//60}m" if m['sleep_deep'] else 'N/A'
    light = f"{m['sleep_light']//60}m" if m['sleep_light'] else 'N/A'
    rem = f"{m['sleep_rem']//60}m" if m['sleep_rem'] else 'N/A'
    awake = f"{m['sleep_awake']//60}m" if m['sleep_awake'] else 'N/A'
    rhr = m['resting_hr'] if m['resting_hr'] else 'N/A'
    battery = f"{m['body_battery_charged']}%" if m['body_battery_charged'] else 'N/A'
    
    # Track nights with/without sleep
    if m['sleep_score']:
        nights_with_sleep += 1
        status = "✅"
    else:
        nights_without_sleep += 1
        status = "❌"
    
    print(f"{status} {date:<10} {str(score):>7} {str(duration):>10} {str(deep):>7} {str(light):>7} {str(rem):>7} {str(awake):>7} {str(rhr):>5} {str(battery):>8}")

print("\n" + "-" * 80)
print(f"📊 Summary (last {len(metrics)} days):")
print(f"  ✅ Nights with sleep data: {nights_with_sleep}")
print(f"  ❌ Nights without sleep data: {nights_without_sleep}")
print(f"  📈 Sleep tracking rate: {nights_with_sleep/len(metrics)*100:.1f}%")

# Check if there's any sleep data at all
cursor.execute("""
    SELECT COUNT(*) as total, 
           SUM(CASE WHEN sleep_score IS NOT NULL THEN 1 ELSE 0 END) as with_sleep
    FROM health_metrics
""")
total_stats = cursor.fetchone()
print(f"\n🗂️  Total database:")
print(f"  Total days tracked: {total_stats['total']}")
print(f"  Days with sleep data: {total_stats['with_sleep']}")

# Show best sleep nights
print("\n🏆 BEST SLEEP NIGHTS:")
print("-" * 80)
cursor.execute("""
    SELECT date, sleep_score, sleep_duration, sleep_deep, sleep_rem
    FROM health_metrics
    WHERE sleep_score IS NOT NULL
    ORDER BY sleep_score DESC
    LIMIT 5
""")

best_nights = cursor.fetchall()
if best_nights:
    for night in best_nights:
        date = datetime.fromisoformat(night['date']).strftime('%b %d')
        duration = f"{night['sleep_duration']//60}h {night['sleep_duration']%60}m"
        deep = f"{night['sleep_deep']//60}m"
        rem = f"{night['sleep_rem']//60}m"
        print(f"  {date}: Score {night['sleep_score']} ({duration}, Deep: {deep}, REM: {rem})")
else:
    print("  No sleep data found")

print("\n" + "="*80 + "\n")

conn.close()
