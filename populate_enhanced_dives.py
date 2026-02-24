#!/usr/bin/env python3
"""
Populate dive_sessions_enhanced from activities

This script:
1. Reads activities from the database
2. Uses DiveParser to extract individual dives
3. Runs AI classification (discipline + lung volume)
4. Stores results in dive_sessions_enhanced
"""

import sqlite3
import sys
import json
from pathlib import Path
from datetime import datetime

# Add src to path
sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parent / 'src' / 'analysis'))

from src.analysis.dive_parser import DiveParser
from src.analysis.discipline_detector import analyze_and_classify_dive


def populate_dives(db_path: str, user_id: int = 1):
    """Extract and classify dives from activities"""
    
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    # Get activities
    cursor.execute("""
        SELECT * FROM activities
        WHERE activity_type IN ('apnea_diving', 'freediving', 'lap_swimming')
        ORDER BY start_time
    """)
    
    activities = cursor.fetchall()
    
    if not activities:
        print("❌ No activities found")
        return
    
    print(f"📊 Found {len(activities)} activities")
    
    total_dives = 0
    
    for activity in activities:
        activity_id = activity['id']
        garmin_id = activity['garmin_activity_id']
        
        print(f"\n🏊 Processing activity {activity_id} (Garmin: {garmin_id})...")
        
        # Parse dives
        try:
            parser = DiveParser(db_path)
            dives = parser.parse_activity(garmin_id)
            
            if not dives:
                print(f"  ⚠️  No dives found")
                continue
            
            print(f"  ✅ Found {len(dives)} dives")
            
            # Process each dive
            for dive in dives:
                dive_num = dive.dive_number
                
                # Run AI classification
                classification = analyze_and_classify_dive(dive)
                
                # Insert into enhanced table
                cursor.execute("""
                    INSERT INTO dive_sessions_enhanced (
                        user_id, activity_id, dive_number,
                        start_time, end_time,
                        max_depth, avg_depth,
                        total_duration, descent_duration, bottom_duration, ascent_duration,
                        avg_descent_rate, max_descent_rate,
                        avg_ascent_rate, max_ascent_rate,
                        velocity_variation,
                        avg_hr, max_hr, min_hr,
                        hr_at_surface, hr_at_depth, hr_differential,
                        ai_discipline, ai_discipline_confidence, ai_discipline_evidence,
                        ai_lung_volume, ai_lung_confidence, ai_lung_evidence,
                        depth_profile, velocity_profile, hr_profile,
                        grade, grade_factors
                    ) VALUES (
                        ?, ?, ?,
                        ?, ?,
                        ?, ?,
                        ?, ?, ?, ?,
                        ?, ?,
                        ?, ?,
                        ?,
                        ?, ?, ?,
                        ?, ?, ?,
                        ?, ?, ?,
                        ?, ?, ?,
                        ?, ?, ?,
                        ?, ?
                    )
                """, (
                    user_id, activity_id, dive_num,
                    dive.start_time.isoformat() if dive.start_time else None,
                    dive.end_time.isoformat() if dive.end_time else None,
                    dive.max_depth, dive.avg_depth,
                    dive.total_duration, dive.descent_duration, dive.bottom_duration, dive.ascent_duration,
                    dive.descent.avg_velocity if dive.descent else None,
                    dive.descent.max_velocity if dive.descent else None,
                    dive.ascent.avg_velocity if dive.ascent else None,
                    dive.ascent.max_velocity if dive.ascent else None,
                    dive.descent.velocity_variation if dive.descent else None,
                    dive.avg_hr, dive.max_hr, dive.min_hr,
                    dive.hr_at_surface, dive.hr_at_depth, dive.hr_differential,
                    classification['discipline']['type'],
                    classification['discipline']['confidence'],
                    json.dumps(classification['discipline'].get('evidence', {})),
                    classification['lung_volume']['type'],
                    classification['lung_volume']['confidence'],
                    json.dumps(classification['lung_volume'].get('evidence', {})),
                    json.dumps(dive.depth_profile) if dive.depth_profile else None,
                    json.dumps(dive.descent.velocity_profile) if dive.descent and dive.descent.velocity_profile else None,
                    json.dumps(dive.hr_profile) if dive.hr_profile else None,
                    classification.get('grade'),
                    json.dumps(classification.get('grade_factors', {}))
                ))
                
                # Print summary
                disc = classification['discipline']['type']
                disc_conf = classification['discipline']['confidence']
                lung = classification['lung_volume']['type']
                lung_conf = classification['lung_volume']['confidence']
                
                print(f"    Dive #{dive_num}: {disc} ({disc_conf:.0f}%), {lung} ({lung_conf:.0f}%)")
                
                total_dives += 1
            
        except Exception as e:
            print(f"  ❌ Error: {e}")
            import traceback
            traceback.print_exc()
            continue
    
    conn.commit()
    conn.close()
    
    print(f"\n✅ Populated {total_dives} dives!")
    print("\nNext: Open the dashboard and start labeling dives to build your baseline.")


if __name__ == "__main__":
    db_path = "data/freediving.db"
    
    if len(sys.argv) > 1:
        db_path = sys.argv[1]
    
    if not Path(db_path).exists():
        print(f"❌ Database not found: {db_path}")
        sys.exit(1)
    
    populate_dives(db_path)
