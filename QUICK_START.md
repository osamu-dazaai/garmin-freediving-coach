# Quick Start for Friends 🌊

**Get your own Garmin Freediving Coach running in 5 minutes**

---

## What You'll Get

✅ **Daily Readiness Score** - Know if you're ready to dive or should rest  
✅ **HRV Tracking** - Elite freedivers have 20-30% higher HRV, track yours  
✅ **Dive Log** - All your dives, depth/time charts, progression  
✅ **Training Plans** - CO2/O2 tables, depth progression, personalized workouts  
✅ **Nutrition** - Daily calorie/macro targets, meal timing, hydration  
✅ **Dashboard** - Beautiful web interface (like trading dashboards)  

**Cost:** $0  
**Time to setup:** 5 minutes  
**Privacy:** All data stays on your computer, nothing shared

---

## Requirements

- **Garmin Watch** with freediving/apnea mode:
  - Descent G1 ✅ (tested)
  - Descent Mk2 ✅
  - Descent Mk3 ✅
  - Any Garmin with apnea tracking
- **Garmin Connect account** (free, you probably have it)
- **Computer or VPS** (Linux/Mac, Windows with WSL)
- **Python 3.9+** (probably already installed)

---

## 5-Minute Setup

### Step 1: Get the Code

```bash
# Clone the repository
git clone <REPO_URL>
cd garmin-freediving

# Or download ZIP from GitHub and extract
```

### Step 2: Run Setup

```bash
bash setup.sh
```

This installs everything automatically. Takes 1-2 minutes.

### Step 3: Add Your Credentials

```bash
nano .env
```

Change these two lines:
```
GARMIN_EMAIL=your.email@example.com    # Your Garmin Connect email
GARMIN_PASSWORD=your_password_here      # Your Garmin Connect password
```

**Don't worry:** Credentials stay on your computer only, never sent anywhere except Garmin.

### Step 4: Test It

```bash
source venv/bin/activate
python test_auth.py
```

You should see:
```
✅ Authentication successful!
   User: Your Name
✅ Recent activities: X found
   Latest: Your last dive/activity
✅ HRV data available
```

### Step 5: Launch Dashboard

```bash
streamlit run dashboard/app.py
```

Open browser: `http://localhost:8503`

**You're done!** 🎉

---

## What You'll See

**Day 1 (after first sync):**
- Your recent dives loaded
- HRV baseline calculated
- Sleep quality tracked
- First readiness score

**Day 7 (after a week):**
- HRV trends visible
- Dive progression charts
- Training recommendations personalized
- Nutrition optimized for your activity level

**Month 1:**
- Patterns identified (best dive times, conditions)
- Recovery profiles learned
- Training plans adapted to YOUR body
- Clear improvement metrics

---

## Daily Workflow

**Morning:**
1. Check readiness score on dashboard
2. Get training recommendation:
   - "87% ready → depth training"
   - "42% ready → light CO2 tables only"
3. See nutrition targets for today

**Pre-Dive:**
- Quick readiness check
- Warm-up suggestions

**Post-Dive:**
- Auto-sync from watch (via Garmin Connect)
- Session analysis appears on dashboard
- Recovery recommendations

---

## Example Readiness Report

```
🌊 Good morning!

Readiness: 87% ✅
HRV: 72ms (↑12% from baseline)
Sleep: 8.2hrs, 94% quality
Body Battery: 85/100

Recommendation: Strong day for depth training.
Target: 3x3 dives to 18m (90% of your max 20m)
Surface intervals: 3min

Nutrition: 2,400 cal | 160g protein | 270g carbs
Pre-dive: Light meal 2-3h before (banana + oats)
```

---

## Key Metrics Explained

**HRV (Heart Rate Variability)**
- Higher = better recovery
- Elite freedivers: 70-100ms
- Low HRV = rest day needed

**Body Battery**
- Garmin's energy score (0-100)
- Need 75+ to start dive sessions
- Tracks throughout day

**Sleep Quality**
- Impacts breath-hold capacity by 20%
- Deep sleep = physical recovery
- <7hrs = poor dive performance

**Mammalian Dive Reflex**
- HR reduction during dives
- Stronger reflex = better O2 conservation
- Improves with training

---

## Privacy & Security

✅ All data stored locally (your computer/VPS)  
✅ Credentials in `.env` (never committed to git)  
✅ OAuth tokens managed automatically  
✅ No third-party services  
✅ No data sharing  
✅ You own everything  

---

## Troubleshooting

**"Authentication failed"**
→ Check credentials in `.env`, make sure Garmin Connect account works

**"No HRV data"**
→ Not all watches support it, system works without it

**"No recent activities"**
→ Sync your watch to Garmin Connect first (via phone app)

**"Module not found"**
→ Activate virtual environment: `source venv/bin/activate`

---

## What's Next?

After setup, the system will:
1. **Learn your baselines** (first 2 weeks)
2. **Predict readiness** (week 3+)
3. **Optimize training** (month 2+)
4. **Help you set PRs** safely!

**Science-backed:** HRV predicts freediving performance (research-proven)

---

## Questions?

- Read full docs: `README.md`, `FEASIBILITY.md`, `METRICS_GUIDE.md`
- Check installation guide: `INSTALL.md`
- Open GitHub issue
- Ask in community (link TBD)

---

**Let's make you a better freediver! 🤿**

_Built with ❤️ by NekosClawd_  
_Research-backed | Open-source | Privacy-first_
