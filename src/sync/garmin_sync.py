#!/usr/bin/env python3
"""
Garmin Data Sync - Extract data from Garmin Connect
"""

import os
import sys
import json
import sqlite3
from datetime import date, datetime, timedelta
from pathlib import Path
from dotenv import load_dotenv
from garminconnect import Garmin

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

class GarminSync:
    def __init__(self, email=None, password=None, db_path=None):
        """Initialize Garmin sync"""
        load_dotenv()
        
        self.email = email or os.getenv('GARMIN_EMAIL')
        self.password = password or os.getenv('GARMIN_PASSWORD')
        self.db_path = db_path or os.getenv('DATABASE_PATH', 'data/freediving.db')
        
        if not self.email or not self.password:
            raise ValueError("Garmin credentials not found. Set GARMIN_EMAIL and GARMIN_PASSWORD in .env")
        
        # Ensure data directory exists
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        
        # Initialize database
        self.init_database()
        
        # Garmin client (will login on first use)
        self.client = None
    
    def login(self):
        """Login to Garmin Connect"""
        if self.client is not None:
            return
        
        print("🔐 Logging in to Garmin Connect...")
        try:
            self.client = Garmin(self.email, self.password)
            self.client.login()
            print(f"✅ Logged in as: {self.client.get_full_name()}")
        except Exception as e:
            print(f"❌ Login failed: {e}")
            raise
    
    def init_database(self):
        """Initialize SQLite database with schema"""
        schema_path = Path(__file__).parent.parent / 'core' / 'schema.sql'
        
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # Read and execute schema
        with open(schema_path, 'r') as f:
            schema = f.read()
            cursor.executescript(schema)
        
        conn.commit()
        conn.close()
        print(f"✅ Database initialized: {self.db_path}")
    
    def sync_date(self, target_date):
        """Sync all data for a specific date"""
        self.login()
        
        date_str = target_date.strftime('%Y-%m-%d')
        print(f"\n📅 Syncing data for {date_str}...")
        
        # Sync health metrics
        self.sync_health_metrics(target_date)
        
        # Sync activities
        self.sync_activities(target_date)
        
        print(f"✅ Sync complete for {date_str}")
    
    def sync_health_metrics(self, target_date):
        """Sync health metrics for a date"""
        date_str = target_date.strftime('%Y-%m-%d')
        
        try:
            # Get various health metrics
            stats = self.client.get_stats(date_str)
            
            # HRV data
            hrv_data = None
            try:
                hrv_data = self.client.get_hrv_data(date_str)
            except:
                pass  # HRV not available for all watches
            
            # Sleep data
            sleep_data = None
            try:
                sleep_data = self.client.get_sleep_data(date_str)
            except:
                pass
            
            # Stress data
            stress_data = None
            try:
                stress_data = self.client.get_stress_data(date_str)
            except:
                pass
            
            # Body Battery
            body_battery = None
            try:
                body_battery = self.client.get_body_battery(date_str)
            except:
                pass
            
            # Insert into database
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            
            cursor.execute('''
                INSERT OR REPLACE INTO health_metrics (
                    date, resting_hr, hrv_avg, hrv_status,
                    stress_avg, stress_max,
                    body_battery_charged, body_battery_drained,
                    sleep_score, sleep_duration, sleep_deep, sleep_light, sleep_rem, sleep_awake,
                    spo2_avg, vo2_max,
                    calories_total, steps, intensity_minutes,
                    raw_data, synced_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ''', (
                date_str,
                stats.get('restingHeartRate'),
                hrv_data.get('avgHRV') if hrv_data else None,
                hrv_data.get('status') if hrv_data else None,
                stats.get('averageStressLevel'),
                stats.get('maxStressLevel'),
                body_battery[0].get('charged') if body_battery and len(body_battery) > 0 else None,
                body_battery[0].get('drained') if body_battery and len(body_battery) > 0 else None,
                sleep_data.get('sleepScores', {}).get('overall', {}).get('value') if sleep_data else None,
                sleep_data.get('sleepTimeSeconds', 0) // 60 if sleep_data else None,  # Convert to minutes
                sleep_data.get('deepSleepSeconds', 0) // 60 if sleep_data else None,
                sleep_data.get('lightSleepSeconds', 0) // 60 if sleep_data else None,
                sleep_data.get('remSleepSeconds', 0) // 60 if sleep_data else None,
                sleep_data.get('awakeSleepSeconds', 0) // 60 if sleep_data else None,
                stats.get('averageSpo2'),
                stats.get('vo2Max'),
                stats.get('totalKilocalories'),
                stats.get('totalSteps'),
                stats.get('intensityMinutesGoal'),
                json.dumps({
                    'stats': stats,
                    'hrv': hrv_data,
                    'sleep': sleep_data,
                    'stress': stress_data,
                    'body_battery': body_battery
                }),
            ))
            
            conn.commit()
            conn.close()
            
            print(f"  ✅ Health metrics saved")
            
        except Exception as e:
            print(f"  ⚠️  Health metrics failed: {e}")
    
    def sync_activities(self, target_date):
        """Sync activities for a date"""
        date_str = target_date.strftime('%Y-%m-%d')
        
        try:
            # Get activities for the date
            activities = self.client.get_activities_by_date(date_str, date_str)
            
            if not activities:
                print(f"  ℹ️  No activities found")
                return
            
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            
            for activity in activities:
                # Insert activity
                cursor.execute('''
                    INSERT OR REPLACE INTO activities (
                        garmin_activity_id, activity_type,
                        start_time, duration, calories,
                        avg_hr, max_hr, distance,
                        metadata, synced_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ''', (
                    activity.get('activityId'),
                    activity.get('activityType', {}).get('typeKey'),
                    activity.get('startTimeLocal'),
                    activity.get('duration'),
                    activity.get('calories'),
                    activity.get('averageHR'),
                    activity.get('maxHR'),
                    activity.get('distance'),
                    json.dumps(activity),
                ))
                
                activity_name = activity.get('activityName', 'Unknown')
                activity_type = activity.get('activityType', {}).get('typeKey', 'unknown')
                print(f"  ✅ Activity: {activity_name} ({activity_type})")
            
            conn.commit()
            conn.close()
            
        except Exception as e:
            print(f"  ⚠️  Activities failed: {e}")
    
    def sync_days(self, days=7):
        """Sync last N days of data"""
        print(f"\n🔄 Syncing last {days} days...")
        
        for i in range(days):
            target_date = date.today() - timedelta(days=i)
            self.sync_date(target_date)
        
        print(f"\n✅ Sync complete! {days} days synced.")
        self.print_summary()
    
    def print_summary(self):
        """Print database summary"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # Count records
        cursor.execute("SELECT COUNT(*) FROM health_metrics")
        health_count = cursor.fetchone()[0]
        
        cursor.execute("SELECT COUNT(*) FROM activities")
        activity_count = cursor.fetchone()[0]
        
        # Get date range
        cursor.execute("SELECT MIN(date), MAX(date) FROM health_metrics")
        date_range = cursor.fetchone()
        
        # Get activity types
        cursor.execute("""
            SELECT activity_type, COUNT(*) 
            FROM activities 
            GROUP BY activity_type 
            ORDER BY COUNT(*) DESC
        """)
        activity_types = cursor.fetchall()
        
        conn.close()
        
        print("\n" + "="*50)
        print("📊 DATABASE SUMMARY")
        print("="*50)
        print(f"Health metrics: {health_count} days")
        print(f"Activities: {activity_count} total")
        if date_range[0]:
            print(f"Date range: {date_range[0]} to {date_range[1]}")
        
        if activity_types:
            print("\nActivity breakdown:")
            for act_type, count in activity_types[:5]:
                print(f"  - {act_type}: {count}")
        
        print("="*50)


if __name__ == '__main__':
    import argparse
    
    parser = argparse.ArgumentParser(description='Sync Garmin data')
    parser.add_argument('--days', type=int, default=7, help='Number of days to sync (default: 7)')
    parser.add_argument('--today', action='store_true', help='Sync only today')
    parser.add_argument('--summary', action='store_true', help='Show database summary')
    
    args = parser.parse_args()
    
    syncer = GarminSync()
    
    if args.summary:
        syncer.print_summary()
    elif args.today:
        syncer.sync_date(date.today())
        syncer.print_summary()
    else:
        syncer.sync_days(args.days)
