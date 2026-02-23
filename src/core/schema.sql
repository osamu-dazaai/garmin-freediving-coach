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
