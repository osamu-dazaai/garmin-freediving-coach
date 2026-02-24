#!/usr/bin/env python3
"""
Test the detection algorithms
"""

import sys
import sqlite3
from pathlib import Path
import numpy as np

sys.path.insert(0, str(Path(__file__).parent / 'src' / 'analysis'))

from dive_parser import DiveParser
from discipline_detector import analyze_and_classify_dive


def main():
    # Get latest activity
    db_path = Path(__file__).parent / 'data' / 'freediving.db'
    conn = sqlite3.connect(str(db_path))
    cursor = conn.cursor()
    cursor.execute("SELECT garmin_activity_id FROM activities WHERE activity_type = 'apnea_diving' ORDER BY id DESC LIMIT 1")
    activity_id = cursor.fetchone()[0]
    conn.close()
    
    print("🤿 TESTING DIVE CLASSIFICATION\n")
    
    # Parse session
    parser = DiveParser()
    session = parser.parse_session(activity_id, analyze=True)
    dives = session['dives']
    
    # Calculate session average HR
    avg_hrs = [d.avg_hr for d in dives if d.avg_hr]
    session_avg_hr = np.mean(avg_hrs)
    
    print(f"Session Average HR: {session_avg_hr:.1f} bpm\n")
    print("="*80)
    
    # Classify each dive
    for dive in dives:
        result = analyze_and_classify_dive(dive, session_avg_hr)
        
        print(f"\n🤿 DIVE #{dive.dive_number} - {dive.max_depth:.1f}m")
        print(f"   HR: {dive.avg_hr:.0f} bpm ({dive.avg_hr - session_avg_hr:+.0f})")
        
        # Discipline
        disc = result['discipline']
        print(f"\n   📋 Discipline: {disc['value'].upper()} ({disc['confidence']:.0f}% confidence)")
        
        if disc['confidence'] >= 60:
            if 'fim_rhythm' in disc['evidence']:
                rhythm = disc['evidence']['fim_rhythm']
                print(f"      → Pull rhythm: {rhythm['pull_count']} pulls, {rhythm['avg_interval']:.1f}s interval")
            
            if 'high_speed' in disc['evidence']:
                print(f"      → High descent speed: {dive.descent_rate:.2f} m/s")
            
            if 'cnf_cv_match' in disc['evidence']:
                print(f"      → Very smooth velocity (CV: {disc['evidence']['velocity_cv']:.3f})")
        
        # Lung Volume
        lung = result['lung_volume']
        print(f"\n   🫁 Lung Volume: {lung['value'].upper()} ({lung['confidence']:.0f}% confidence)")
        
        if lung['confidence'] >= 60:
            if 'low_hr' in lung['evidence']:
                print(f"      → Low HR signature (FRC indicator)")
            
            if 'very_low_hr' in lung['evidence']:
                print(f"      → Very low HR (Exhale indicator)")
            
            if 'positive_buoyancy' in lung['evidence']:
                print(f"      → Buoyancy struggle detected (Full lung)")
            
            if 'neutral_buoyancy' in lung['evidence']:
                print(f"      → Neutral buoyancy (FRC/Exhale)")
            
            if 'bottom_hr' in lung['evidence']:
                print(f"      → Bottom HR: {lung['evidence']['bottom_hr']:.0f} bpm")
        
        print(f"\n   Scores:")
        if 'scores' in disc['evidence']:
            print(f"      Discipline: {disc['evidence']['scores']}")
        if 'scores' in lung['evidence']:
            print(f"      Lung Vol:   {lung['evidence']['scores']}")
    
    print("\n" + "="*80)
    print("✅ Detection Test Complete!\n")


if __name__ == '__main__':
    main()
