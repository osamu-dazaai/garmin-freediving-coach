#!/usr/bin/env python3
"""Test Garmin authentication and data access"""

import os
from dotenv import load_dotenv
from garminconnect import Garmin
from datetime import date, timedelta

# Load credentials
load_dotenv()
email = os.getenv('GARMIN_EMAIL')
password = os.getenv('GARMIN_PASSWORD')

if not email or not password or '@example.com' in email:
    print("❌ Please edit .env with your real Garmin credentials!")
    exit(1)

print("🔐 Authenticating with Garmin Connect...")
try:
    client = Garmin(email, password)
    client.login()
    print("✅ Authentication successful!")
    print(f"   User: {client.get_full_name()}")
except Exception as e:
    print(f"❌ Authentication failed: {e}")
    exit(1)

# Test data extraction
print("\n📊 Testing data extraction...")
today = date.today().strftime('%Y-%m-%d')
yesterday = (date.today() - timedelta(days=1)).strftime('%Y-%m-%d')

try:
    # Get yesterday's stats
    stats = client.get_stats(yesterday)
    print(f"✅ Daily stats: {len(stats)} metrics")
    
    # Get recent activities
    activities = client.get_activities(0, 5)
    print(f"✅ Recent activities: {len(activities)} found")
    
    if activities:
        latest = activities[0]
        print(f"   Latest: {latest.get('activityName', 'Unknown')} on {latest.get('startTimeLocal', 'Unknown')}")
    
    # Get HRV data (if available)
    try:
        hrv = client.get_hrv_data(yesterday)
        print(f"✅ HRV data available")
    except:
        print("⚠️  HRV data not available (might not be supported by your watch)")
    
    print("\n✅ All systems operational!")
    print("\nNext steps:")
    print("  1. Run: python garmin_sync.py --sync-days 7")
    print("  2. Check: data/freediving.db")
    print("  3. Launch: streamlit run dashboard/app.py")
    
except Exception as e:
    print(f"❌ Data extraction failed: {e}")
    exit(1)
