# Installation Guide

**For Your Friends:** Easy setup guide to get their own Garmin Freediving Coach running

---

## Prerequisites

- Garmin watch with freediving/apnea mode (Descent G1, Descent Mk2, or similar)
- Garmin Connect account (free)
- Linux/Mac computer or VPS
- Python 3.9+ installed

---

## Quick Install (5 minutes)

### 1. Clone the Repository

```bash
git clone <REPO_URL>
cd garmin-freediving
```

### 2. Run Setup Script

```bash
bash setup.sh
```

This will:
- Create Python virtual environment
- Install all dependencies (garminconnect, streamlit, etc.)
- Create directory structure
- Generate config templates

### 3. Configure Credentials

```bash
nano .env
```

Edit these lines with your Garmin account:
```
GARMIN_EMAIL=your.email@example.com
GARMIN_PASSWORD=your_password_here
```

**Important:** Your credentials are stored locally only. Never committed to git.

### 4. Test Authentication

```bash
source venv/bin/activate
python test_auth.py
```

You should see:
```
✅ Authentication successful!
   User: Your Name
✅ Daily stats: XX metrics
✅ Recent activities: X found
```

---

## First Sync

Pull your watch data:

```bash
# Activate virtual environment (if not already active)
source venv/bin/activate

# Sync last 7 days
python garmin_sync.py --sync-days 7
```

This creates `data/freediving.db` with all your activities, health metrics, and dives.

---

## Launch Dashboard

```bash
streamlit run dashboard/app.py
```

Then visit: `http://localhost:8503`

You should see:
- Daily readiness score
- Dive log with charts
- HRV trends
- Training recommendations
- Nutrition targets

---

## Daily Automation (Optional)

Set up automatic daily sync:

```bash
# Edit crontab
crontab -e

# Add this line (syncs at 8 AM daily)
0 8 * * * cd /path/to/garmin-freediving && source venv/bin/activate && python garmin_sync.py --sync-today
```

---

## Troubleshooting

### "Authentication failed"
- Check email/password in `.env`
- Make sure Garmin Connect account is active
- Try logging into connect.garmin.com manually first

### "HRV data not available"
- Not all Garmin watches support HRV
- Descent G1 does, but older models might not
- System will work without HRV (graceful degradation)

### "No recent activities"
- Make sure your watch has synced to Garmin Connect
- Check in the Garmin Connect app/website first
- May need to manually sync watch via Bluetooth

### "Module not found" errors
- Make sure virtual environment is activated: `source venv/bin/activate`
- Re-run setup: `bash setup.sh`

---

## For VPS Deployment

If running on a remote server:

```bash
# Install screen for persistent sessions
sudo apt install screen

# Start dashboard in background
screen -dmS freediving-dashboard bash -c 'cd /path/to/garmin-freediving && source venv/bin/activate && streamlit run dashboard/app.py --server.port 8503 --server.address 0.0.0.0'

# Access from your computer
# Visit: http://YOUR_VPS_IP:8503
```

**Security:** Consider setting up a firewall or SSH tunnel for dashboard access.

---

## Privacy & Security

- **All data stays local** (your computer/VPS only)
- Garmin credentials stored in `.env` (not committed to git)
- OAuth tokens saved in `~/.garminconnect` (automatically managed)
- No third-party services, no data sharing
- You own everything: database, analysis, insights

---

## Customization

Edit `.env` to customize:
- Training preferences (focus area, days per week)
- Nutrition goals (maintain, cut, bulk)
- Sync schedule
- Dashboard settings

---

## Getting Help

- Read the docs: `README.md`, `FEASIBILITY.md`, `ARCHITECTURE.md`
- Check metrics guide: `METRICS_GUIDE.md`
- Open an issue on GitHub
- Join the community (link TBD)

---

## What's Next?

Once installed:
1. **Review your readiness score** - Are you ready to train today?
2. **Check dive log** - See your progression over time
3. **Follow training recommendations** - Data-driven workouts
4. **Monitor HRV trends** - Optimize recovery
5. **Track nutrition** - Fuel your dives properly

**Goal:** Improve safely, avoid overtraining, reach new personal bests! 🌊🤿
