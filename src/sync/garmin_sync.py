#!/usr/bin/env python3
"""
Garmin Data Sync - Extract data from Garmin Connect
"""

import os
import sys
import json
import sqlite3
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from urllib.parse import urljoin
from dotenv import load_dotenv
from garminconnect import Garmin

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

def _patch_garth_for_proxy(garth_client):
    """
    Garmin blocks connectapi.garmin.com from datacenter IPs (401).
    connect.garmin.com/modern/proxy/ serves the same paths and accepts
    the same Bearer token. Monkey-patch garth's request method to
    redirect all connectapi subdomain calls through the proxy.
    """
    _original_request = garth_client.sess.request.__self__.__class__.request \
        if hasattr(garth_client.sess.request, '__self__') else None
    original_request = garth_client.request.__func__

    import garth.http as garth_http
    from requests import Response

    PROXY_BASE = "https://connect.garmin.com/modern/proxy"
    PROXY_HEADERS = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "NK": "NT",
    }

    def patched_request(self, method, subdomain, path, /, api=False, referrer=False, headers={}, **kwargs):
        if subdomain == "connectapi":
            url = f"{PROXY_BASE}{path}"
            merged_headers = {**PROXY_HEADERS, **headers}
            if api:
                merged_headers["Authorization"] = str(self.oauth2_token)
            self.last_resp = self.sess.request(method, url, headers=merged_headers, timeout=self.timeout, **kwargs)
            try:
                self.last_resp.raise_for_status()
            except Exception as e:
                from garth.exc import GarthHTTPError
                raise GarthHTTPError(msg="Error in request", error=e)
            return self.last_resp
        return original_request(self, method, subdomain, path, api=api, referrer=referrer, headers=headers, **kwargs)

    import types
    garth_client.request = types.MethodType(patched_request, garth_client)

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
        
        # Token cache — avoids re-hitting Garmin SSO on every sync run
        self.tokenstore = str(Path(self.db_path).parent / ".garth")

        # Garmin client (will login on first use)
        self.client = None

    def login(self):
        """Login to Garmin Connect using cached OAuth tokens.

        Garmin SSO is currently rate-limiting all automated logins (429).
        Token-only auth is the only working path — do not fall back to SSO.
        """
        if self.client is not None:
            return

        if not Path(self.tokenstore).exists():
            raise RuntimeError(
                f"No token cache found at {self.tokenstore}. "
                "Garmin SSO is currently blocked (429). "
                "Tokens must be obtained manually."
            )

        print("🔐 Loading Garmin tokens from cache...")
        self.client = Garmin(self.email, self.password)
        self.client.garth.load(self.tokenstore)
        _patch_garth_for_proxy(self.client.garth)
        print(f"✅ Logged in from token cache ({self.tokenstore})")
    
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
            hrv_avg = None
            hrv_status = None
            try:
                hrv_response = self.client.get_hrv_data(date_str)
                if hrv_response and 'hrvSummary' in hrv_response:
                    hrv_summary = hrv_response['hrvSummary']
                    hrv_avg = hrv_summary.get('lastNightAvg')
                    hrv_status = hrv_summary.get('status')
                    hrv_data = hrv_response
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
            
            # Extract sleep data from nested dailySleepDTO
            sleep_dto = sleep_data.get('dailySleepDTO') if sleep_data else None
            sleep_score = None
            sleep_duration = None
            sleep_deep = None
            sleep_light = None
            sleep_rem = None
            sleep_awake = None
            
            if sleep_dto:
                sleep_score = sleep_dto.get('sleepScores', {}).get('overall', {}).get('value')
                sleep_duration = sleep_dto.get('sleepTimeSeconds', 0) // 60 if sleep_dto.get('sleepTimeSeconds') else None
                sleep_deep = sleep_dto.get('deepSleepSeconds', 0) // 60 if sleep_dto.get('deepSleepSeconds') else None
                sleep_light = sleep_dto.get('lightSleepSeconds', 0) // 60 if sleep_dto.get('lightSleepSeconds') else None
                sleep_rem = sleep_dto.get('remSleepSeconds', 0) // 60 if sleep_dto.get('remSleepSeconds') else None
                sleep_awake = sleep_dto.get('awakeSleepSeconds', 0) // 60 if sleep_dto.get('awakeSleepSeconds') else None
            
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
                hrv_avg,
                hrv_status,
                stats.get('averageStressLevel'),
                stats.get('maxStressLevel'),
                body_battery[0].get('charged') if body_battery and len(body_battery) > 0 else None,
                body_battery[0].get('drained') if body_battery and len(body_battery) > 0 else None,
                sleep_score,
                sleep_duration,
                sleep_deep,
                sleep_light,
                sleep_rem,
                sleep_awake,
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
    
    def sync_days(self, days=7, delay=0):
        """Sync last N days of data"""
        print(f"\n🔄 Syncing last {days} days...")

        for i in range(days):
            target_date = date.today() - timedelta(days=i)
            self.sync_date(target_date)
            if delay > 0 and i < days - 1:
                time.sleep(delay)

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
    parser.add_argument('--delay', type=float, default=0, help='Seconds to sleep between days (default: 0)')
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
        syncer.sync_days(args.days, delay=args.delay)
