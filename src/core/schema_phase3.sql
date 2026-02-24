-- Phase 3: User Baselines & Enhanced Dive Storage
-- Migration to add user profiles, classifications, and baseline learning

-- User profiles with personal baselines
CREATE TABLE IF NOT EXISTS user_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    display_name TEXT,
    
    -- Personal baseline metrics (learned over time)
    baseline_hr_resting REAL,           -- Resting HR (from health metrics)
    baseline_hr_full_lung REAL,         -- Avg HR during full lung dives
    baseline_hr_frc REAL,               -- Avg HR during FRC dives
    baseline_hr_exhale REAL,            -- Avg HR during exhale dives
    baseline_descent_cwt REAL,          -- Avg descent rate for CWT (m/s)
    baseline_descent_fim REAL,          -- Avg descent rate for FIM (m/s)
    baseline_descent_cnf REAL,          -- Avg descent rate for CNF (m/s)
    baseline_buoyancy_neutral_depth REAL,  -- Where they become neutral (m)
    
    -- Calibration tracking
    calibration_dives INTEGER DEFAULT 0,       -- Number of labeled dives
    calibration_complete BOOLEAN DEFAULT FALSE, -- TRUE after 20+ labeled dives
    last_calibration_date TIMESTAMP,
    
    -- Settings
    preferred_units TEXT DEFAULT 'metric',  -- metric/imperial
    timezone TEXT DEFAULT 'UTC',
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Enhanced dive sessions with AI classifications
CREATE TABLE IF NOT EXISTS dive_sessions_enhanced (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES user_profiles(id),
    activity_id INTEGER REFERENCES activities(id),
    dive_number INTEGER NOT NULL,
    
    -- Timing
    start_time TIMESTAMP,
    end_time TIMESTAMP,
    
    -- Depths (meters)
    max_depth REAL,
    avg_depth REAL,
    
    -- Durations (seconds)
    total_duration REAL,
    descent_duration REAL,
    bottom_duration REAL,
    ascent_duration REAL,
    surface_interval REAL,
    
    -- Velocities (m/s)
    avg_descent_rate REAL,
    max_descent_rate REAL,
    avg_ascent_rate REAL,
    max_ascent_rate REAL,
    velocity_variation REAL,  -- Coefficient of variation (0-1)
    
    -- Heart Rate (bpm)
    avg_hr REAL,
    max_hr REAL,
    min_hr REAL,
    hr_at_surface REAL,
    hr_at_depth REAL,
    hr_differential REAL,  -- Difference from session avg
    
    -- AI Classification (auto-detected)
    ai_discipline TEXT,  -- FIM/CWT/CNF/STATIC/unknown
    ai_discipline_confidence REAL,  -- 0-100
    ai_discipline_evidence JSON,  -- Reasoning for classification
    
    ai_lung_volume TEXT,  -- full/frc/exhale/unknown
    ai_lung_confidence REAL,  -- 0-100
    ai_lung_evidence JSON,  -- Reasoning for classification
    
    -- Manual override (user confirmed/corrected)
    manual_discipline TEXT,
    manual_lung_volume TEXT,
    manual_notes TEXT,
    labeled_at TIMESTAMP,  -- When user labeled it
    
    -- Final classification (manual overrides AI)
    final_discipline TEXT GENERATED ALWAYS AS (COALESCE(manual_discipline, ai_discipline)) STORED,
    final_lung_volume TEXT GENERATED ALWAYS AS (COALESCE(manual_lung_volume, ai_lung_volume)) STORED,
    
    -- Raw time-series data (for ML training & debugging)
    depth_profile JSON,    -- [depth every second]
    velocity_profile JSON, -- [velocity every second]
    hr_profile JSON,       -- [HR every second]
    
    -- Performance grading
    grade TEXT,  -- A/B/C/D/F based on technique
    grade_factors JSON,  -- What contributed to grade
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Baseline learning history (track how baselines evolve)
CREATE TABLE IF NOT EXISTS baseline_updates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES user_profiles(id),
    update_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    dives_analyzed INTEGER,  -- Total labeled dives used
    
    -- Baseline snapshot
    baseline_data JSON,  -- Full baseline object at this point
    
    -- Statistics
    confidence_score REAL,  -- How confident we are (0-100)
    data_quality TEXT,  -- poor/fair/good/excellent
    
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Training sessions metadata (groups of dives)
CREATE TABLE IF NOT EXISTS training_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES user_profiles(id),
    activity_id INTEGER REFERENCES activities(id),
    session_date DATE,
    
    -- Session summary
    total_dives INTEGER,
    avg_depth REAL,
    max_depth REAL,
    total_time INTEGER,  -- Total underwater time (seconds)
    
    -- Distribution
    discipline_counts JSON,  -- {"FIM": 5, "CWT": 3}
    lung_volume_counts JSON, -- {"full": 6, "frc": 2}
    
    -- Performance
    avg_grade TEXT,
    session_notes TEXT,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_dives_user ON dive_sessions_enhanced(user_id);
CREATE INDEX IF NOT EXISTS idx_dives_activity ON dive_sessions_enhanced(activity_id);
CREATE INDEX IF NOT EXISTS idx_dives_discipline ON dive_sessions_enhanced(final_discipline);
CREATE INDEX IF NOT EXISTS idx_dives_lung ON dive_sessions_enhanced(final_lung_volume);
CREATE INDEX IF NOT EXISTS idx_baselines_user ON baseline_updates(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON training_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_date ON training_sessions(session_date);

-- Default user (Neko)
INSERT OR IGNORE INTO user_profiles (username, display_name, timezone)
VALUES ('neko', 'Neko', 'Asia/Kolkata');
