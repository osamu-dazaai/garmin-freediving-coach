# Garmin Freediving Coach 🌊🤿

**AI-powered freediving training & nutrition optimization using Garmin Descent G1 data**

![Status](https://img.shields.io/badge/status-feasibility%20complete-green)
![Phase](https://img.shields.io/badge/phase-planning-blue)

---

## What is This?

A comprehensive system that:
1. **Extracts** all data from your Garmin Descent G1 watch (dives, HR, HRV, sleep, stress)
2. **Analyzes** your recovery, training load, and dive progression
3. **Recommends** personalized training plans and nutrition
4. **Tracks** long-term trends and helps you reach new personal bests

Built specifically for freediving, leveraging science-backed metrics like HRV for recovery monitoring.

---

## Features

### ✅ Feasibility Confirmed (See [FEASIBILITY.md](FEASIBILITY.md))

- **Data Extraction:** Complete access to Garmin Connect via `python-garminconnect`
- **Dive Tracking:** Depth, duration, HR, surface intervals, progression
- **Recovery Monitoring:** HRV trends, sleep quality, Body Battery, training load
- **Training Plans:** CO2/O2 tables, depth progression, dynamic apnea
- **Nutrition:** Personalized macros, meal timing, hydration, supplements
- **Dashboard:** Real-time visualization of all metrics

---

## System Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for full technical details.

**High-level flow:**
```
Watch → Garmin Connect → API → Database → Analysis → Recommendations → Dashboard
```

**Key components:**
- `garmin_sync.py` - Daily data extraction
- `analyzer.py` - HRV, sleep, readiness scoring
- `dive_tracker.py` - Dive session analysis
- `coach.py` - AI training recommendations
- `nutrition.py` - Nutrition optimization
- `dashboard/` - Streamlit web interface

---

## Quick Start

### Prerequisites
- Garmin Descent G1 watch (or any Garmin with freediving support)
- Garmin Connect account
- Python 3.9+
- VPS or local machine (already set up: `ubuntu-8gb-hel1-1`)

### Installation
```bash
# Clone or navigate to project
cd /home/clawd/.openclaw/projects/garmin-freediving

# Set up Python environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install garminconnect garth pandas numpy streamlit plotly

# Configure credentials
cp .env.example .env
# Edit .env with your Garmin email/password
```

### Initial Sync
```bash
# Authenticate + test data extraction
python garmin_sync.py --auth

# Fetch last 7 days of data
python garmin_sync.py --sync-days 7

# Generate first readiness report
python coach.py --daily-briefing
```

### Launch Dashboard
```bash
streamlit run dashboard/app.py
# Visit http://37.27.201.10:8503
```

---

## Project Status

### ✅ Phase 0: Planning (Current)
- [x] Feasibility analysis
- [x] Technical architecture
- [x] Database schema design
- [x] Project structure
- [ ] Get Garmin credentials
- [ ] Test data extraction with real account

### 🚧 Phase 1: Foundation (Week 1)
- [ ] Set up `python-garminconnect`
- [ ] Build database schema (SQLite)
- [ ] Create data pipeline
- [ ] Test sync with 1 week of data
- [ ] Validate dive data extraction

### 📋 Phase 2: Analysis (Week 2)
- [ ] HRV trend analyzer
- [ ] Dive session parser
- [ ] Readiness calculator
- [ ] Basic dashboard (Streamlit)

### 🎯 Phase 3: Intelligence (Week 3)
- [ ] Training plan generator
- [ ] Workout templates
- [ ] Automated recommendations
- [ ] Discord notifications

### 🍎 Phase 4: Nutrition (Week 4)
- [ ] Calorie calculator
- [ ] Macro optimizer
- [ ] Meal timing engine
- [ ] Hydration tracker

---

## Data Privacy

- **All data stored locally** on your VPS
- **No third-party access** to your Garmin data
- **Encrypted credentials** (Garth OAuth tokens)
- **You own everything** - database, code, insights

---

## Science Behind It

### HRV (Heart Rate Variability)
Elite freedivers show:
- **Higher resting HRV** (enhanced parasympathetic activity)
- **Faster recovery** between dives
- **Lower resting heart rate** (~69 bpm vs 80+ untrained)

**Practical use:** Daily HRV measurement predicts training readiness. Low HRV = rest or light training. High HRV = ready for depth work.

### Training Load Management
- **Acute-to-Chronic Load Ratio** (Garmin provides this)
- Avoid overtraining (suppressed HRV + elevated resting HR)
- Balance dive sessions with dry training (running, swimming)

### Mammalian Dive Reflex
- **HR drops during apnea** (bradycardia)
- Track minimum HR during dives to measure adaptation
- Improved reflex = better oxygen conservation = longer dives

---

## Roadmap

### MVP (2-3 weeks)
- Daily sync from Garmin
- HRV/sleep/stress tracking
- Dive log with progression charts
- Basic readiness score
- Training recommendations

### Full System (1-2 months)
- Advanced analytics (ML pattern detection)
- Automated training plans
- Nutrition optimization
- Competition taper planner
- Mobile-friendly dashboard

### Future (3+ months)
- Video analysis (technique optimization)
- Social features (compare with other freedivers)
- Predictive modeling (forecast PBs)
- Integration with other sensors (Moxy, O2 rings)

---

## Contributing

This is a personal project for Neko, but if you're a freediver interested in data-driven training, feel free to:
- Star the repo
- Report issues
- Suggest features
- Share your results

---

## Tech Stack

- **Backend:** Python 3.9+
- **API:** `python-garminconnect` + `garth`
- **Database:** SQLite
- **Analysis:** Pandas, NumPy, SciPy
- **Dashboard:** Streamlit, Plotly
- **Automation:** Cron
- **Notifications:** Discord

---

## License

MIT - Build whatever you want with this.

---

## Contact

Questions? Ping Neko on Discord.

**Let's build something awesome.** 🚀
