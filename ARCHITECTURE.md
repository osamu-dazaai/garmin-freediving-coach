# Technical Architecture - Garmin Freediving Coach

## System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Garmin Descent G1 Watch                   │
│  (Dive computer, HR, HRV, Sleep, Stress, Activity tracking) │
└────────────────────┬────────────────────────────────────────┘
                     │ Bluetooth Sync
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                     Garmin Connect                           │
│          (Cloud storage, activity processing)                │
└────────────────────┬────────────────────────────────────────┘
                     │ python-garminconnect API
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                   Data Extraction Layer                      │
│  - Daily sync (cron)                                        │
│  - Activity parser (dive sessions)                          │
│  - Health metrics aggregator                                │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                    Storage Layer (SQLite)                    │
│  - activities (dives, workouts)                             │
│  - health_metrics (daily HRV, sleep, stress)                │
│  - dive_sessions (detailed apnea data)                      │
│  - body_composition (weight, body fat)                      │
│  - training_plans (scheduled workouts)                      │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                    Analysis Engine                           │
│  - HRV trend analyzer                                       │
│  - Recovery calculator                                      │
│  - Training load monitor                                    │
│  - Dive progression tracker                                 │
│  - Nutrition optimizer                                      │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                 Recommendation Engine (AI)                   │
│  - Training readiness score                                 │
│  - Workout suggestions                                      │
│  - Nutrition plans                                          │
│  - Recovery protocols                                       │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                    User Interfaces                           │
│  - Streamlit Dashboard (web)                                │
│  - Discord notifications                                    │
│  - Daily briefings (automated)                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Database Schema

### `activities`
```sql
CREATE TABLE activities (
    id INTEGER PRIMARY KEY,
    garmin_activity_id INTEGER UNIQUE,
    activity_type TEXT,  -- 'freediving', 'apnea', 'running', 'swimming'
    start_time DATETIME,
    duration INTEGER,  -- seconds
    calories INTEGER,
    avg_hr INTEGER,
    max_hr INTEGER,
    avg_pace REAL,
    distance REAL,  -- meters
    metadata JSON,  -- raw Garmin data
    synced_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### `dive_sessions`
```sql
CREATE TABLE dive_sessions (
    id INTEGER PRIMARY KEY,
    activity_id INTEGER REFERENCES activities(id),
    dive_number INTEGER,  -- 1st, 2nd, 3rd dive in session
    max_depth REAL,  -- meters
    bottom_time INTEGER,  -- seconds
    total_time INTEGER,  -- seconds
    surface_interval INTEGER,  -- seconds before next dive
    avg_hr INTEGER,
    min_hr INTEGER,  -- lowest HR during dive (mammalian reflex)
    descent_rate REAL,  -- m/s
    ascent_rate REAL,  -- m/s
    water_temp REAL,  -- celsius
    dive_details JSON,  -- second-by-second data
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### `health_metrics`
```sql
CREATE TABLE health_metrics (
    id INTEGER PRIMARY KEY,
    date DATE UNIQUE,
    resting_hr INTEGER,
    hrv_avg REAL,  -- ms (RMSSD)
    hrv_status TEXT,  -- 'balanced', 'unbalanced', 'poor', 'low'
    stress_avg INTEGER,  -- 0-100
    stress_max INTEGER,
    body_battery_charged INTEGER,  -- 0-100
    body_battery_drained INTEGER,
    sleep_score INTEGER,  -- 0-100
    sleep_duration INTEGER,  -- minutes
    sleep_deep INTEGER,  -- minutes
    sleep_light INTEGER,
    sleep_rem INTEGER,
    sleep_awake INTEGER,
    spo2_avg REAL,  -- %
    respiration_avg REAL,  -- breaths/min
    vo2_max REAL,
    calories_total INTEGER,
    steps INTEGER,
    intensity_minutes INTEGER,
    raw_data JSON,
    synced_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### `body_composition`
```sql
CREATE TABLE body_composition (
    id INTEGER PRIMARY KEY,
    date DATE,
    weight REAL,  -- kg
    body_fat REAL,  -- %
    body_water REAL,  -- %
    muscle_mass REAL,  -- kg
    bone_mass REAL,  -- kg
    bmi REAL,
    source TEXT,  -- 'garmin_scale', 'manual', 'estimate'
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### `training_plans`
```sql
CREATE TABLE training_plans (
    id INTEGER PRIMARY KEY,
    date DATE,
    workout_type TEXT,  -- 'co2_table', 'o2_table', 'depth', 'dynamic', 'rest'
    target_depth REAL,  -- meters (if depth training)
    target_time INTEGER,  -- seconds (if static apnea)
    sets INTEGER,
    reps INTEGER,
    rest_interval INTEGER,  -- seconds
    intensity TEXT,  -- 'light', 'moderate', 'hard'
    completed BOOLEAN DEFAULT FALSE,
    actual_performance JSON,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### `readiness_scores`
```sql
CREATE TABLE readiness_scores (
    id INTEGER PRIMARY KEY,
    date DATE UNIQUE,
    overall_score REAL,  -- 0-100
    hrv_score REAL,
    sleep_score REAL,
    recovery_score REAL,
    training_load_score REAL,
    stress_score REAL,
    recommendation TEXT,
    factors JSON,  -- detailed breakdown
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### `nutrition_plans`
```sql
CREATE TABLE nutrition_plans (
    id INTEGER PRIMARY KEY,
    date DATE,
    tdee INTEGER,  -- total daily energy expenditure
    target_calories INTEGER,
    protein_g REAL,
    carbs_g REAL,
    fats_g REAL,
    hydration_ml INTEGER,
    meal_timing JSON,  -- pre/post workout timing
    supplements JSON,
    activity_level TEXT,  -- 'rest', 'light', 'moderate', 'heavy'
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## Core Modules

### 1. `garmin_sync.py` - Data Extraction
```python
class GarminSync:
    def __init__(self, email, password):
        self.client = Garmin(email, password)
        self.client.login()
    
    def sync_daily_data(self, date):
        """Fetch all data for a given date"""
        # Health metrics
        hrv = self.client.get_hrv_data(date)
        sleep = self.client.get_sleep_data(date)
        stress = self.client.get_stress_data(date)
        body_battery = self.client.get_body_battery(date)
        
        # Activities
        activities = self.client.get_activities_by_date(date, date)
        
        # Save to database
        self.save_health_metrics(date, hrv, sleep, stress, body_battery)
        self.save_activities(activities)
    
    def sync_dive_details(self, activity_id):
        """Fetch detailed dive data (second-by-second)"""
        details = self.client.get_activity(activity_id)
        # Parse dive phases, HR data, depth profile
        return self.parse_dive_session(details)
```

### 2. `analyzer.py` - Data Analysis
```python
class HealthAnalyzer:
    def calculate_readiness(self, date):
        """Generate training readiness score"""
        metrics = db.get_health_metrics(date)
        
        # HRV component (40% weight)
        hrv_score = self.score_hrv_trend(metrics['hrv_avg'])
        
        # Sleep component (30% weight)
        sleep_score = self.score_sleep_quality(metrics)
        
        # Recovery component (20% weight)
        recovery_score = self.score_recovery(metrics['body_battery_charged'])
        
        # Training load (10% weight)
        load_score = self.score_training_load()
        
        overall = (hrv_score * 0.4 + sleep_score * 0.3 + 
                   recovery_score * 0.2 + load_score * 0.1)
        
        return {
            'overall': overall,
            'recommendation': self.generate_recommendation(overall),
            'factors': {...}
        }
    
    def score_hrv_trend(self, current_hrv):
        """Compare to 7-day baseline"""
        baseline = db.get_hrv_baseline(days=7)
        deviation = (current_hrv - baseline) / baseline
        
        if deviation > 0.1:
            return 90  # Well recovered
        elif deviation > 0:
            return 75  # Normal
        elif deviation > -0.1:
            return 50  # Borderline
        else:
            return 25  # Suppressed (overtraining)
```

### 3. `dive_tracker.py` - Dive Analysis
```python
class DiveAnalyzer:
    def analyze_session(self, activity_id):
        """Analyze a freediving session"""
        dives = db.get_dive_session(activity_id)
        
        analysis = {
            'total_dives': len(dives),
            'max_depth': max(d['max_depth'] for d in dives),
            'avg_bottom_time': mean(d['bottom_time'] for d in dives),
            'surface_interval_quality': self.score_surface_intervals(dives),
            'hr_adaptation': self.analyze_hr_response(dives),
            'progression': self.compare_to_previous_sessions(dives)
        }
        
        return analysis
    
    def score_surface_intervals(self, dives):
        """Check if surface intervals allow adequate recovery"""
        # HRV should return to near-baseline between dives
        # Typically 2-3x dive time for beginners, 1-1.5x for advanced
        for i, dive in enumerate(dives[:-1]):
            next_dive = dives[i+1]
            ratio = next_dive['surface_interval'] / dive['total_time']
            if ratio < 1.5:
                return 'short'  # Insufficient recovery
        return 'adequate'
```

### 4. `coach.py` - AI Recommendations
```python
class FreedivingCoach:
    def generate_training_plan(self, days=7):
        """Create weekly training plan based on readiness"""
        readiness = analyzer.calculate_readiness(today)
        recent_dives = db.get_recent_dives(days=14)
        
        plan = []
        for day in next_n_days(days):
            if readiness['overall'] > 80:
                plan.append(self.heavy_dive_day(recent_dives))
            elif readiness['overall'] > 60:
                plan.append(self.moderate_training(recent_dives))
            else:
                plan.append(self.recovery_day())
        
        return plan
    
    def heavy_dive_day(self, recent_dives):
        """Challenging dive session (depth or duration)"""
        max_depth = max(d['max_depth'] for d in recent_dives)
        target_depth = max_depth * 0.90  # 90% of max
        
        return {
            'type': 'depth_training',
            'target_depth': target_depth,
            'sets': 3,
            'dives_per_set': 3,
            'surface_interval': 180,  # 3 min
            'warm_up': 'light_co2_table',
            'notes': 'Focus on relaxation at depth'
        }
```

### 5. `nutrition.py` - Nutrition Optimizer
```python
class NutritionOptimizer:
    def calculate_daily_needs(self, date):
        """Generate nutrition plan based on activity"""
        activities = db.get_activities(date)
        metrics = db.get_health_metrics(date)
        body_comp = db.get_latest_body_composition()
        
        # Base metabolic rate
        bmr = self.calculate_bmr(body_comp)
        
        # Activity factor
        activity_calories = sum(a['calories'] for a in activities)
        tdee = bmr + activity_calories
        
        # Adjust for goals (maintain, cut, bulk)
        target_calories = tdee  # maintenance for now
        
        # Macro split (dive day vs rest day)
        if self.is_dive_day(activities):
            # Higher carbs for energy + recovery
            macros = {
                'protein': body_comp['weight'] * 1.8,  # g/kg
                'carbs': target_calories * 0.45 / 4,  # 45% calories
                'fats': target_calories * 0.30 / 9    # 30% calories
            }
        else:
            # Moderate carbs
            macros = {
                'protein': body_comp['weight'] * 1.6,
                'carbs': target_calories * 0.35 / 4,
                'fats': target_calories * 0.35 / 9
            }
        
        return {
            'tdee': tdee,
            'target_calories': target_calories,
            'macros': macros,
            'meal_timing': self.plan_meal_timing(activities)
        }
```

---

## Automation & Scheduling

### Daily Cron Jobs
```bash
# Morning sync (after watch uploads overnight data)
0 8 * * * python garmin_sync.py sync-yesterday

# Daily briefing (analyze readiness + generate plan)
0 9 * * * python coach.py daily-briefing

# Weekly analysis (Sunday evening)
0 20 * * 0 python coach.py weekly-review
```

### Notification System
- **Discord:** Daily readiness score + training recommendation
- **Pre-dive:** Readiness check before dive session
- **Post-dive:** Session summary + recovery recommendations

---

## Dashboard (Streamlit)

### Pages
1. **Overview** - Current readiness, today's plan, recent trends
2. **Dive Log** - All dive sessions, depth/time charts, progression
3. **Health** - HRV trends, sleep quality, stress levels
4. **Training** - Weekly plan, completed workouts, upcoming sessions
5. **Nutrition** - Daily targets, meal plans, macro tracking
6. **Analytics** - Long-term trends, correlations, predictions

---

## Security

- **Garmin credentials:** Stored in environment variables, encrypted at rest
- **OAuth tokens:** Saved to `~/.garminconnect`, restricted permissions (600)
- **Database:** Local SQLite, backed up daily to encrypted storage
- **API calls:** Rate-limited to avoid Garmin throttling

---

## Performance Optimization

- **Incremental sync:** Only fetch new data since last sync
- **Caching:** Store processed analysis to avoid re-computation
- **Batch processing:** Sync multiple days in one API call where possible
- **Database indexing:** Index on dates, activity types for fast queries

---

## Future Enhancements

### Phase 2
- **Machine learning:** Predict readiness based on patterns
- **Computer vision:** Analyze dive videos for technique
- **Social features:** Compare with other freedivers (anonymized)

### Phase 3
- **Mobile app:** Native iOS/Android with offline support
- **Wearable integration:** Real-time biofeedback during training
- **Competition mode:** Taper planning, peak performance prediction

---

## Testing Strategy

1. **Unit tests:** Each module independently
2. **Integration tests:** API → Database → Analysis pipeline
3. **Validation:** Compare recommendations against known good/bad days
4. **User testing:** Your feedback after 2 weeks of use

---

This architecture is designed to be:
- **Modular:** Easy to add features without breaking existing code
- **Scalable:** Can handle years of data without performance issues
- **Reliable:** Error handling, logging, automatic retries
- **Privacy-focused:** All data stays under your control
