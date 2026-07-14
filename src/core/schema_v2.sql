-- schema_v2.sql — New tables for FastAPI + mobile app features
-- Safe to run multiple times (CREATE TABLE IF NOT EXISTS throughout)

-- Manual log entries: equalization notes, non-Garmin dives, dive type tags
CREATE TABLE IF NOT EXISTS manual_log_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_date DATE NOT NULL,
    dive_type TEXT CHECK(dive_type IN ('warmup','working','pb','frc','static','dynamic')) NOT NULL,
    max_depth REAL,
    bottom_time INTEGER,
    equalization_depth REAL,
    eq_technique TEXT CHECK(eq_technique IN ('frenzel','mouthfill','valsalva')),
    notes TEXT,
    location TEXT,
    activity_id INTEGER REFERENCES activities(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Goals tracking
CREATE TABLE IF NOT EXISTS goals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    goal_type TEXT CHECK(goal_type IN ('depth','bottom_time','dive_count','eq_depth','static_time')) NOT NULL,
    title TEXT NOT NULL,
    target_value REAL NOT NULL,
    current_value REAL DEFAULT 0,
    target_date DATE,
    achieved BOOLEAN DEFAULT FALSE,
    achieved_at DATETIME,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Personal bests: explicit PB log
CREATE TABLE IF NOT EXISTS personal_bests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pb_type TEXT CHECK(pb_type IN ('depth_cwt','depth_fim','depth_cnf','static_time','dyn_distance')) NOT NULL,
    value REAL NOT NULL,
    achieved_date DATE NOT NULL,
    activity_id INTEGER REFERENCES activities(id),
    manual_entry BOOLEAN DEFAULT FALSE,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Manual discipline labels — overrides auto-classification, doubles as ML training data
CREATE TABLE IF NOT EXISTS dive_labels (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    activity_id     INTEGER REFERENCES activities(id) ON DELETE CASCADE,
    dive_number     INTEGER NOT NULL,
    discipline      TEXT NOT NULL CHECK(discipline IN ('CWT','FIM','CNF','WARMUP','STA')),
    notes           TEXT,
    max_depth_m     REAL,
    bottom_time_s   REAL,
    descent_time_s  REAL,
    ascent_time_s   REAL,
    depth_profile   TEXT,   -- JSON [[t_s, depth_m], ...]
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(activity_id, dive_number)
);

-- External freedivers whose dives we've labeled for ML training
CREATE TABLE IF NOT EXISTS guest_divers (
    id           TEXT PRIMARY KEY,   -- url-safe slug, e.g. "alice-smith"
    display_name TEXT NOT NULL,
    notes        TEXT,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Dives from external freedivers — imported from FIT files or entered manually.
-- discipline is NULL until manually labeled; source_file deduplicates FIT imports.
CREATE TABLE IF NOT EXISTS guest_dives (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    diver_id       TEXT NOT NULL REFERENCES guest_divers(id) ON DELETE CASCADE,
    session_file   TEXT,   -- source zip filename, e.g. "2026-04-30_Apnea.zip"
    dive_number    INTEGER,
    discipline     TEXT CHECK(discipline IN ('CWT','FIM','CNF','WARMUP','STA')),
    max_depth_m    REAL NOT NULL,
    bottom_time_s  REAL,
    descent_time_s REAL,
    ascent_time_s  REAL,
    surface_interval_s REAL,
    water_temp_c   REAL,
    depth_profile  TEXT,   -- JSON [[t_s, depth_m], ...]
    hr_profile     TEXT,   -- JSON [[t_s, bpm], ...]
    notes          TEXT,
    created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(diver_id, session_file, dive_number)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_manual_log_date ON manual_log_entries(entry_date);
CREATE INDEX IF NOT EXISTS idx_goals_type ON goals(goal_type);
CREATE INDEX IF NOT EXISTS idx_pbs_type ON personal_bests(pb_type, achieved_date);
CREATE INDEX IF NOT EXISTS idx_dive_labels_activity ON dive_labels(activity_id);
CREATE INDEX IF NOT EXISTS idx_guest_dives_diver ON guest_dives(diver_id);
