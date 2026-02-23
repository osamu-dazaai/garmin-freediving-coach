#!/bin/bash
# Garmin Freediving Coach - Setup Script

set -e  # Exit on error

echo "🌊 Garmin Freediving Coach - Setup"
echo "===================================="
echo ""

# Check Python version
echo "Checking Python version..."
python_version=$(python3 --version 2>&1 | awk '{print $2}')
required_version="3.9"

if ! python3 -c "import sys; exit(0 if sys.version_info >= (3,9) else 1)"; then
    echo "❌ Python 3.9+ required (found: $python_version)"
    exit 1
fi
echo "✅ Python $python_version"
echo ""

# Create virtual environment
if [ ! -d "venv" ]; then
    echo "Creating Python virtual environment..."
    python3 -m venv venv
    echo "✅ Virtual environment created"
else
    echo "✅ Virtual environment already exists"
fi
echo ""

# Activate venv
echo "Activating virtual environment..."
source venv/bin/activate

# Upgrade pip
echo "Upgrading pip..."
pip install --upgrade pip > /dev/null 2>&1
echo "✅ pip upgraded"
echo ""

# Install dependencies
echo "Installing Python dependencies..."
echo "  - garminconnect (Garmin API wrapper)"
echo "  - garth (OAuth authentication)"
echo "  - pandas (data manipulation)"
echo "  - numpy (numerical computing)"
echo "  - streamlit (dashboard)"
echo "  - plotly (charts)"
echo "  - python-dotenv (config)"

pip install garminconnect garth pandas numpy streamlit plotly python-dotenv > /dev/null 2>&1
echo "✅ All dependencies installed"
echo ""

# Create directory structure
echo "Creating project structure..."
mkdir -p data
mkdir -p logs
mkdir -p dashboard
mkdir -p src/{core,analysis,training,nutrition}
mkdir -p config
mkdir -p tests

echo "✅ Directory structure created"
echo ""

# Create .env template
if [ ! -f ".env" ]; then
    echo "Creating .env configuration file..."
    cat > .env << 'EOF'
# Garmin Connect Credentials
GARMIN_EMAIL=your.email@example.com
GARMIN_PASSWORD=your_password_here

# Discord Notifications (optional)
DISCORD_WEBHOOK_URL=

# Database
DATABASE_PATH=data/freediving.db

# Dashboard
DASHBOARD_PORT=8503
DASHBOARD_HOST=0.0.0.0

# Sync Settings
AUTO_SYNC_ENABLED=true
SYNC_TIME=08:00  # Daily sync time (24h format)

# Training Preferences
PREFERRED_TRAINING_TIME=morning  # morning, afternoon, evening
TRAINING_DAYS_PER_WEEK=4
FOCUS_AREA=depth  # depth, duration, dynamic, mixed

# Nutrition Preferences
GOAL=maintain  # maintain, cut, bulk
DIET_TYPE=balanced  # balanced, keto, carb_cycling

# Advanced
LOG_LEVEL=INFO
TIMEZONE=Asia/Kolkata
EOF
    echo "✅ .env file created (EDIT THIS FILE with your Garmin credentials!)"
else
    echo "⚠️  .env already exists (not overwriting)"
fi
echo ""

# Create requirements.txt
echo "Creating requirements.txt..."
cat > requirements.txt << 'EOF'
garminconnect>=0.2.13
garth>=0.4.0
pandas>=2.0.0
numpy>=1.24.0
streamlit>=1.28.0
plotly>=5.17.0
python-dotenv>=1.0.0
EOF
echo "✅ requirements.txt created"
echo ""

# Create database schema
echo "Creating database schema..."
cat > src/core/schema.sql << 'EOF'
-- Garmin Freediving Coach - Database Schema

CREATE TABLE IF NOT EXISTS activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    garmin_activity_id INTEGER UNIQUE,
    activity_type TEXT,
    start_time DATETIME,
    duration INTEGER,
    calories INTEGER,
    avg_hr INTEGER,
    max_hr INTEGER,
    distance REAL,
    metadata JSON,
    synced_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS dive_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    activity_id INTEGER REFERENCES activities(id),
    dive_number INTEGER,
    max_depth REAL,
    bottom_time INTEGER,
    total_time INTEGER,
    surface_interval INTEGER,
    avg_hr INTEGER,
    min_hr INTEGER,
    descent_rate REAL,
    ascent_rate REAL,
    water_temp REAL,
    dive_details JSON,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS health_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date DATE UNIQUE,
    resting_hr INTEGER,
    hrv_avg REAL,
    hrv_status TEXT,
    stress_avg INTEGER,
    body_battery_charged INTEGER,
    sleep_score INTEGER,
    sleep_duration INTEGER,
    spo2_avg REAL,
    vo2_max REAL,
    calories_total INTEGER,
    steps INTEGER,
    raw_data JSON,
    synced_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS readiness_scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date DATE UNIQUE,
    overall_score REAL,
    hrv_score REAL,
    sleep_score REAL,
    recovery_score REAL,
    recommendation TEXT,
    factors JSON,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS training_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date DATE,
    workout_type TEXT,
    target_depth REAL,
    target_time INTEGER,
    sets INTEGER,
    completed BOOLEAN DEFAULT FALSE,
    actual_performance JSON,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_activities_type ON activities(activity_type);
CREATE INDEX IF NOT EXISTS idx_activities_start ON activities(start_time);
CREATE INDEX IF NOT EXISTS idx_health_date ON health_metrics(date);
CREATE INDEX IF NOT EXISTS idx_readiness_date ON readiness_scores(date);
EOF
echo "✅ Database schema created"
echo ""

# Create initial test script
echo "Creating authentication test script..."
cat > test_auth.py << 'EOF'
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
EOF
chmod +x test_auth.py
echo "✅ Test script created"
echo ""

# Success message
echo "===================================="
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Edit .env with your Garmin credentials:"
echo "     nano .env"
echo ""
echo "  2. Activate the virtual environment:"
echo "     source venv/bin/activate"
echo ""
echo "  3. Test authentication:"
echo "     python test_auth.py"
echo ""
echo "  4. Read the documentation:"
echo "     - FEASIBILITY.md (what's possible)"
echo "     - ARCHITECTURE.md (how it works)"
echo "     - README.md (getting started)"
echo ""
echo "Need help? Check the docs or ping Neko!"
echo "===================================="
