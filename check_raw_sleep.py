#!/usr/bin/env python3
"""Check what sleep data Garmin Connect has available"""

import os
import json
from dotenv import load_dotenv
from garminconnect import Garmin
from datetime import datetime, timedelta

load_dotenv()

email = os.getenv('GARMIN_EMAIL')
password = os.getenv('GARMIN_PASSWORD')

print("🔐 Connecting to Garmin...")
client = Garmin(email, password)
client.login()

print("✅ Connected\n")

# Check last 3 days for sleep data
print("="*60)
print("📊 Checking Garmin Connect for sleep data...")
print("="*60)

for i in range(3):
    date = (datetime.now() - timedelta(days=i)).strftime('%Y-%m-%d')
    print(f"\n📅 {date}:")
    
    try:
        sleep_data = client.get_sleep_data(date)
        if sleep_data:
            print(f"  ✅ Sleep data available!")
            print(f"  Keys: {list(sleep_data.keys())[:10]}")  # Show first 10 keys
            
            # Check for actual sleep metrics
            if 'dailySleepDTO' in sleep_data:
                sleep_dto = sleep_data['dailySleepDTO']
                if sleep_dto:
                    print(f"  Sleep Score: {sleep_dto.get('sleepScores', {}).get('overall', {}).get('value', 'N/A')}")
                    print(f"  Duration: {sleep_dto.get('sleepTimeSeconds', 0)//60} min")
        else:
            print(f"  ❌ No sleep data")
    except Exception as e:
        print(f"  ⚠️  Error: {str(e)}")

# Also check user sleep settings
print("\n" + "="*60)
print("⚙️  Checking user settings...")
print("="*60)
try:
    user_settings = client.get_user_settings()
    print(f"Sleep tracking: {user_settings.get('sleepTime', 'Unknown')}")
except:
    print("Could not retrieve user settings")

print("\n" + "="*60)
