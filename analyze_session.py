#!/usr/bin/env python3
"""
Analyze a dive session and display detailed results
"""

import sys
import sqlite3
from pathlib import Path

# Add src to path
sys.path.insert(0, str(Path(__file__).parent / 'src' / 'analysis'))

from dive_parser import DiveParser
from velocity_analyzer import VelocityAnalyzer
from phase_detector import PhaseDetector


def print_dive_summary(dive):
    """Print detailed dive summary"""
    print(f"\n{'='*70}")
    print(f"🤿 DIVE #{dive.dive_number} - {dive.max_depth:.1f}m × {dive.duration:.0f}s")
    print(f"{'='*70}")
    
    # Basic metrics
    print(f"\n📊 Metrics:")
    print(f"  Max Depth: {dive.max_depth:.1f}m")
    print(f"  Avg Depth: {dive.avg_depth:.1f}m")
    print(f"  Duration: {dive.duration:.0f}s")
    print(f"  Bottom Time: {dive.bottom_time:.0f}s")
    print(f"  Surface Interval: {dive.surface_interval/60:.1f} min")
    
    # Velocities
    print(f"\n🏊 Velocities:")
    if dive.descent_rate:
        print(f"  Descent: {dive.descent_rate:.2f} m/s (max: {dive.max_descent_rate:.2f} m/s)")
    if dive.ascent_rate:
        print(f"  Ascent: {dive.ascent_rate:.2f} m/s (max: {dive.max_ascent_rate:.2f} m/s)")
    
    if hasattr(dive, 'velocity_cv'):
        print(f"  Velocity Variation: {dive.velocity_cv:.3f}")
        if dive.velocity_cv > 0.3:
            print(f"    → HIGH variation (FIM indicator)")
        elif dive.velocity_cv < 0.15:
            print(f"    → LOW variation (CNF indicator)")
    
    # Heart Rate
    print(f"\n💓 Heart Rate:")
    if dive.avg_hr:
        print(f"  Average: {dive.avg_hr:.0f} bpm")
        print(f"  Max: {dive.max_hr:.0f} bpm")
        if dive.min_hr:
            print(f"  Min: {dive.min_hr:.0f} bpm")
            print(f"  Range: {dive.max_hr - dive.min_hr:.0f} bpm")
    
    # Phases
    if dive.phases:
        print(f"\n⏱️  Phases:")
        
        for phase_name, phase_data in dive.phases.items():
            print(f"\n  {phase_name.upper()}:")
            print(f"    Duration: {phase_data.get('duration', 0):.1f}s")
            print(f"    Depth: {phase_data.get('start_depth', 0):.1f}m → {phase_data.get('end_depth', 0):.1f}m")
            
            if 'avg_velocity' in phase_data:
                print(f"    Velocity: {phase_data['avg_velocity']:.2f} m/s (max: {phase_data.get('max_velocity', 0):.2f})")
            
            if 'avg_hr' in phase_data:
                print(f"    HR: {phase_data['avg_hr']:.0f} bpm (range: {phase_data.get('min_hr', 0):.0f}-{phase_data.get('max_hr', 0):.0f})")
                
                if 'hr_change' in phase_data:
                    change = phase_data['hr_change']
                    arrow = "↑" if change > 0 else "↓"
                    print(f"    HR Change: {arrow} {abs(change):.0f} bpm")
    
    # Buoyancy analysis
    va = VelocityAnalyzer()
    buoyancy = va.get_buoyancy_indicators(dive)
    
    if buoyancy:
        print(f"\n🎈 Buoyancy Analysis:")
        if 'avg_velocity_0_2m' in buoyancy:
            print(f"  0-2m velocity: {buoyancy['avg_velocity_0_2m']:.2f} m/s")
        if 'avg_velocity_2_5m' in buoyancy:
            print(f"  2-5m velocity: {buoyancy['avg_velocity_2_5m']:.2f} m/s")
        if 'acceleration' in buoyancy:
            accel = buoyancy['acceleration']
            if accel > 0.1:
                print(f"  Acceleration: +{accel:.2f} m/s² → Positive buoyancy (Full lung?)")
            else:
                print(f"  Acceleration: {accel:.2f} m/s² → Neutral/negative buoyancy")
    
    # Hints
    pd = PhaseDetector()
    hints = pd.detect_dive_type_hints(dive)
    
    if hints:
        print(f"\n🔍 Detection Hints:")
        for key, value in hints.items():
            print(f"  {key}: {value}")


def analyze_session_patterns(dives):
    """Analyze patterns across all dives in session"""
    print(f"\n{'='*70}")
    print(f"📈 SESSION ANALYSIS - {len(dives)} dives")
    print(f"{'='*70}")
    
    # HR analysis
    avg_hrs = [d.avg_hr for d in dives if d.avg_hr]
    
    if avg_hrs:
        import numpy as np
        
        print(f"\n💓 Heart Rate Patterns:")
        print(f"  Session Avg: {np.mean(avg_hrs):.1f} bpm")
        print(f"  Range: {min(avg_hrs):.0f} - {max(avg_hrs):.0f} bpm")
        print(f"  Std Dev: {np.std(avg_hrs):.1f} bpm")
        
        # Look for FRC dives (significantly lower HR)
        session_avg = np.mean(avg_hrs)
        
        print(f"\n  Dive-by-Dive HR:")
        for dive in dives:
            if dive.avg_hr:
                diff = dive.avg_hr - session_avg
                marker = ""
                
                if diff < -10:
                    marker = "  ← FRC/Exhale?"
                elif diff > 10:
                    marker = "  ← High effort"
                
                print(f"    Dive {dive.dive_number}: {dive.avg_hr:.0f} bpm ({diff:+.0f}){marker}")
    
    # Depth progression
    print(f"\n📏 Depth Progression:")
    for dive in dives:
        print(f"  Dive {dive.dive_number}: {dive.max_depth:.1f}m")
    
    # Velocity patterns
    descent_rates = [d.descent_rate for d in dives if d.descent_rate]
    
    if descent_rates:
        import numpy as np
        print(f"\n🏊 Velocity Summary:")
        print(f"  Avg Descent Rate: {np.mean(descent_rates):.2f} m/s")
        print(f"  Range: {min(descent_rates):.2f} - {max(descent_rates):.2f} m/s")


def main():
    """Main analysis script"""
    
    # Get latest dive activity
    db_path = Path(__file__).parent / 'data' / 'freediving.db'
    conn = sqlite3.connect(str(db_path))
    cursor = conn.cursor()
    cursor.execute("SELECT garmin_activity_id FROM activities WHERE activity_type = 'apnea_diving' ORDER BY id DESC LIMIT 1")
    activity_id = cursor.fetchone()[0]
    conn.close()
    
    print(f"🤿 DIVE SESSION ANALYZER")
    print(f"Activity ID: {activity_id}\n")
    
    # Parse session
    parser = DiveParser()
    session = parser.parse_session(activity_id, analyze=True)
    
    # Print each dive
    for dive in session['dives']:
        print_dive_summary(dive)
    
    # Session patterns
    analyze_session_patterns(session['dives'])
    
    print(f"\n{'='*70}")
    print(f"✅ Analysis Complete!")
    print(f"{'='*70}\n")


if __name__ == '__main__':
    main()
