#!/usr/bin/env python3
"""
Dive Parser - Extract individual dives from Garmin activity data
"""

import os
import sys
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Any, Optional
from dotenv import load_dotenv
from garminconnect import Garmin

# Add parent to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

load_dotenv()


class Dive:
    """Represents a single dive with all time-series data"""
    
    def __init__(self, dive_number: int, lap_data: Dict, time_series: List[Dict]):
        self.dive_number = dive_number
        self.lap_data = lap_data
        self.time_series = time_series
        
        # Basic metrics from lap
        self.start_time = lap_data.get('startTimeGMT')
        self.max_depth = lap_data.get('maxDepth', 0)
        self.avg_depth = lap_data.get('averageDepth', 0)
        self.duration = lap_data.get('duration', 0)
        self.bottom_time = lap_data.get('bottomTime', 0)
        self.surface_interval = lap_data.get('surfaceInterval', 0)
        
        # HR data
        self.avg_hr = lap_data.get('averageHR')
        self.max_hr = lap_data.get('maxHR')
        self.min_hr = None  # Will calculate from time series
        
        # Temperature
        self.water_temp = lap_data.get('averageTemperature')
        
        # Calculated metrics (will be populated by analyzers)
        self.descent_rate = None
        self.ascent_rate = None
        self.phases = None
        self.velocity_profile = []
        self.hr_profile = []
        
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for storage"""
        return {
            'dive_number': self.dive_number,
            'start_time': self.start_time,
            'max_depth': self.max_depth,
            'avg_depth': self.avg_depth,
            'duration': self.duration,
            'bottom_time': self.bottom_time,
            'surface_interval': self.surface_interval,
            'avg_hr': self.avg_hr,
            'max_hr': self.max_hr,
            'min_hr': self.min_hr,
            'water_temp': self.water_temp,
            'descent_rate': self.descent_rate,
            'ascent_rate': self.ascent_rate,
            'phases': self.phases,
            'velocity_profile': self.velocity_profile,
            'hr_profile': self.hr_profile,
        }
    
    def __repr__(self):
        return f"<Dive {self.dive_number}: {self.max_depth:.1f}m, {self.duration:.0f}s>"


class DiveParser:
    """
    Parse Garmin activity data and extract individual dives with time-series analysis
    """
    
    def __init__(self, email: Optional[str] = None, password: Optional[str] = None):
        """Initialize parser with Garmin credentials"""
        self.email = email or os.getenv('GARMIN_EMAIL')
        self.password = password or os.getenv('GARMIN_PASSWORD')
        
        if not self.email or not self.password:
            raise ValueError("Garmin credentials required")
        
        self.client = None
    
    def login(self):
        """Login to Garmin Connect"""
        if self.client is not None:
            return
        
        print("🔐 Logging in to Garmin Connect...")
        self.client = Garmin(self.email, self.password)
        self.client.login()
        print(f"✅ Logged in")
    
    def parse_activity(self, activity_id: int) -> List[Dive]:
        """
        Parse a single activity and extract all dives
        
        Args:
            activity_id: Garmin activity ID
            
        Returns:
            List of Dive objects
        """
        self.login()
        
        print(f"📥 Fetching activity {activity_id}...")
        
        # Get lap data (individual dive summaries)
        splits = self.client.get_activity_splits(activity_id)
        laps = splits.get('lapDTOs', [])
        
        # Get detailed time-series data
        details = self.client.get_activity_details(activity_id)
        metrics = details.get('activityDetailMetrics', [])
        descriptors = {desc['metricsIndex']: desc['key'] 
                      for desc in details.get('metricDescriptors', [])}
        
        print(f"✅ Found {len(laps)} dives with {len(metrics)} data points")
        
        # Parse ALL metrics first
        all_dive_metrics = self._extract_all_metrics(metrics, descriptors)
        
        print(f"   Total metrics extracted: {len(all_dive_metrics)}")
        
        # Split metrics by lap boundaries
        cumulative_time = 0
        dives = []
        
        for i, lap in enumerate(laps, 1):
            dive_duration = lap.get('duration', 0)
            dive_end_time = cumulative_time + dive_duration
            
            # Extract metrics for this dive's time window
            dive_metrics = [
                m for m in all_dive_metrics 
                if cumulative_time <= m['time_offset'] < dive_end_time
            ]
            
            # Adjust time offsets to be relative to dive start
            for m in dive_metrics:
                m['time_offset'] -= cumulative_time
            
            dive = Dive(i, lap, dive_metrics)
            dives.append(dive)
            
            print(f"  Dive {i}: {dive.max_depth:.1f}m, {dive.duration:.0f}s, "
                  f"{len(dive_metrics)} data points")
            
            cumulative_time = dive_end_time
        
        return dives
    
    def _parse_timestamp(self, timestamp_str: str) -> datetime:
        """Parse Garmin timestamp string"""
        # Format: "2026-02-24T04:37:44.0"
        return datetime.fromisoformat(timestamp_str.replace('.0', ''))
    
    def _extract_all_metrics(
        self, 
        all_metrics: List[Dict], 
        descriptors: Dict[int, str]
    ) -> List[Dict]:
        """
        Extract ALL time-series data from activity
        
        Returns list of dicts with time_offset, depth, hr
        """
        # Find metric indices
        depth_idx = next((k for k, v in descriptors.items() if 'depth' in v.lower() and 'direct' in v.lower()), None)
        hr_idx = next((k for k, v in descriptors.items() if 'heart' in v.lower() and 'direct' in v.lower()), None)
        
        if depth_idx is None:
            print(f"⚠️  No depth data. Available: {list(descriptors.values())[:5]}")
            return []
        
        parsed_metrics = []
        time_offset = 0.0
        
        for metric in all_metrics:
            if 'metrics' in metric and len(metric['metrics']) > depth_idx:
                depth = metric['metrics'][depth_idx]
                hr = metric['metrics'][hr_idx] if hr_idx and hr_idx < len(metric['metrics']) else None
                
                # Garmin stores depth, we need to check if it's valid
                if depth is not None:
                    parsed_metrics.append({
                        'time_offset': time_offset,
                        'depth': depth,
                        'hr': hr
                    })
                    time_offset += 1.0  # 1-second intervals
        
        return parsed_metrics
    
    def parse_session(self, activity_id: int, analyze: bool = True) -> Dict[str, Any]:
        """
        Parse entire dive session with optional analysis
        
        Args:
            activity_id: Garmin activity ID
            analyze: Run velocity & phase analysis
            
        Returns:
            Dict with session info and dives
        """
        dives = self.parse_activity(activity_id)
        
        if analyze:
            from velocity_analyzer import VelocityAnalyzer
            from phase_detector import PhaseDetector
            
            velocity_analyzer = VelocityAnalyzer()
            phase_detector = PhaseDetector()
            
            print("\n🔬 Analyzing dives...")
            for dive in dives:
                # Calculate velocities
                velocity_analyzer.analyze(dive)
                
                # Detect phases
                phase_detector.detect(dive)
                
                descent_str = f"{dive.descent_rate:.2f}" if dive.descent_rate else "N/A"
                ascent_str = f"{dive.ascent_rate:.2f}" if dive.ascent_rate else "N/A"
                print(f"  Dive {dive.dive_number}: "
                      f"Descent {descent_str} m/s, "
                      f"Ascent {ascent_str} m/s")
        
        return {
            'activity_id': activity_id,
            'dive_count': len(dives),
            'dives': dives,
            'parsed_at': datetime.now().isoformat()
        }


if __name__ == '__main__':
    # Test the parser
    import sqlite3
    
    # Get latest dive activity
    db_path = Path(__file__).parent.parent.parent / 'data' / 'freediving.db'
    conn = sqlite3.connect(str(db_path))
    cursor = conn.cursor()
    cursor.execute("SELECT garmin_activity_id FROM activities WHERE activity_type = 'apnea_diving' ORDER BY id DESC LIMIT 1")
    activity_id = cursor.fetchone()[0]
    conn.close()
    
    print(f"🤿 Testing DiveParser with activity {activity_id}\n")
    
    parser = DiveParser()
    session = parser.parse_session(activity_id, analyze=True)
    
    print(f"\n✅ Parsed {session['dive_count']} dives")
    
    # Show summary
    for dive in session['dives']:
        print(f"\n{dive}")
        if dive.phases:
            for phase_name, phase_data in dive.phases.items():
                print(f"  {phase_name}: {phase_data}")
