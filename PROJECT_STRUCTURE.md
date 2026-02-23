# Project Structure

```
garmin-freediving/
│
├── README.md                  # Project overview & quick start
├── SUMMARY.md                 # Executive summary (read this first!)
├── FEASIBILITY.md             # Detailed feasibility analysis
├── ARCHITECTURE.md            # Technical architecture & design
├── METRICS_GUIDE.md           # Understanding your watch data
├── PROJECT_STRUCTURE.md       # This file
│
├── setup.sh                   # Automated setup script
├── test_auth.py              # Test Garmin authentication (created by setup.sh)
├── requirements.txt          # Python dependencies (created by setup.sh)
├── .env                      # Configuration (created by setup.sh, EDIT THIS!)
├── .gitignore               # Git ignore rules
│
├── src/                      # Source code (to be created)
│   ├── core/
│   │   ├── __init__.py
│   │   ├── schema.sql       # Database schema
│   │   ├── database.py      # Database utilities
│   │   └── config.py        # Configuration loader
│   │
│   ├── sync/
│   │   ├── __init__.py
│   │   ├── garmin_sync.py   # Data extraction from Garmin
│   │   └── parsers.py       # Activity/dive parsers
│   │
│   ├── analysis/
│   │   ├── __init__.py
│   │   ├── health.py        # HRV, sleep, stress analysis
│   │   ├── dives.py         # Dive session analysis
│   │   └── readiness.py     # Readiness score calculator
│   │
│   ├── training/
│   │   ├── __init__.py
│   │   ├── coach.py         # Training recommendations
│   │   ├── plans.py         # Workout plan generator
│   │   └── templates.py     # CO2/O2 tables, protocols
│   │
│   └── nutrition/
│       ├── __init__.py
│       ├── calculator.py    # Calorie/macro calculator
│       └── meal_planner.py  # Meal timing & suggestions
│
├── dashboard/               # Streamlit web interface (to be created)
│   ├── app.py              # Main dashboard entry point
│   ├── pages/
│   │   ├── 1_overview.py
│   │   ├── 2_dive_log.py
│   │   ├── 3_health.py
│   │   ├── 4_training.py
│   │   └── 5_nutrition.py
│   └── components/
│       ├── charts.py       # Reusable chart components
│       └── widgets.py      # Custom widgets
│
├── data/                   # Data storage (created by setup.sh)
│   ├── freediving.db      # SQLite database
│   └── backups/           # Database backups
│
├── logs/                  # Application logs (created by setup.sh)
│   ├── sync.log
│   ├── analysis.log
│   └── dashboard.log
│
├── tests/                 # Unit tests (to be created)
│   ├── test_sync.py
│   ├── test_analysis.py
│   ├── test_training.py
│   └── test_nutrition.py
│
└── docs/                  # Additional documentation (optional)
    ├── API.md            # API reference
    ├── TRAINING.md       # Training protocols explained
    └── NUTRITION.md      # Nutrition guidelines
```

---

## File Descriptions

### Documentation (Current)
- **README.md:** Start here - project overview, quick start guide
- **SUMMARY.md:** Executive summary for decision-making (feasibility, timeline, value)
- **FEASIBILITY.md:** Deep technical analysis of what's possible
- **ARCHITECTURE.md:** System design, database schema, module descriptions
- **METRICS_GUIDE.md:** Understanding HRV, sleep, Body Battery, dive metrics

### Setup (Current)
- **setup.sh:** Automated project initialization (run this first!)
- **.env:** Configuration file (Garmin credentials, preferences)
- **requirements.txt:** Python package dependencies

### To Be Created (Phase 1+)
- **src/**: All Python source code
- **dashboard/**: Web interface (Streamlit)
- **data/**: Database and backups
- **logs/**: Application logs
- **tests/**: Unit tests

---

## Next Steps

1. **Review documentation:**
   - Read SUMMARY.md (5 min)
   - Skim FEASIBILITY.md (understand what's possible)
   - Glance at METRICS_GUIDE.md (know what data means)

2. **If proceeding:**
   - Run `bash setup.sh`
   - Edit `.env` with Garmin credentials
   - Run `python test_auth.py`

3. **Then I'll build:**
   - Week 1: src/core + src/sync (data extraction)
   - Week 2: src/analysis + dashboard (readiness scoring)
   - Week 3: src/training + src/nutrition (recommendations)
   - Week 4: Polish, testing, optimization

---

**Status:** Planning phase complete, ready for development!
