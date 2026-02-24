# Dive Analysis System - Technical Design

## 🎯 Goal
Build auto-detection system for dive discipline & lung volume that works for ANY freediver, learning their personal patterns.

## 🏗️ System Architecture

### 1. User Baseline System
**Problem:** Everyone has different HR, buoyancy, swimming technique  
**Solution:** Learn personal baselines during calibration period

```
User Profile:
  - baseline_hr_resting: 60 bpm (personal resting HR)
  - baseline_hr_full_lung: 85 bpm (avg HR during full lung dives)
  - baseline_hr_frc: 72 bpm (avg HR during FRC dives)
  - baseline_descent_rate_cwt: 0.8 m/s
  - baseline_descent_rate_fim: 0.6 m/s
  - buoyancy_neutral_depth: 8m (where they become neutral)
  - calibration_dives: 20 (number of dives analyzed for baseline)
  - last_calibration: 2026-02-24
```

**Calibration Period:**
- First 10-20 dives: Learning mode
- Ask user to manually tag discipline & lung volume
- Build statistical baseline (mean, std deviation)
- After 20 dives: Auto-detection enabled

### 2. Dive Parser (Time-Series Analysis)

**Input:** Garmin activity ID  
**Output:** Structured dive objects with phases

```python
Dive:
  dive_number: 1
  start_time: timestamp
  end_time: timestamp
  
  # Phases (auto-detected from depth data)
  phases:
    - descent:
        start_depth: 0m
        end_depth: 4.98m
        duration: 15s
        avg_velocity: 0.33 m/s
        max_velocity: 0.60 m/s
        velocity_profile: [0.54, 0.60, 0.21, ...]  # m/s per second
        
    - bottom:
        depth_range: 4.5-4.98m
        duration: 73s
        avg_hr: 71 bpm
        
    - ascent:
        start_depth: 4.98m
        end_depth: 0m
        duration: 12s
        avg_velocity: 0.41 m/s
  
  # Calculated metrics
  metrics:
    max_depth: 4.98m
    avg_depth: 3.21m
    total_time: 200s
    bottom_time: 73s
    
  # HR analysis
  heart_rate:
    avg: 71 bpm
    max: 87 bpm
    min: 71 bpm
    at_surface: 87 bpm
    at_depth: 71 bpm
    recovery_rate: +16 bpm/min (ascent)
    
  # Buoyancy indicators
  buoyancy:
    initial_velocity_0_2m: 0.25 m/s (slow = positive buoyancy)
    acceleration_2_5m: 0.15 m/s² (speed increase = negative buoyancy)
    consistent_descent: true/false
```

### 3. Discipline Detection (Pattern Recognition)

**Method:** Velocity pattern analysis + statistical comparison to baseline

#### Free Immersion (FIM)
```
Signature:
  - Rhythmic velocity spikes (pull-glide-pull)
  - Pull interval: 2-4 seconds
  - Velocity variation: HIGH (coefficient of variation > 0.3)
  - Pull pattern: detect peaks in velocity array
  
Detection Algorithm:
  1. Calculate velocity changes (derivative)
  2. Detect peaks using scipy.signal.find_peaks
  3. Measure inter-peak interval
  4. If consistent rhythm (2-4s) → FIM
  5. Compare to user's baseline FIM velocity profile
  
Confidence Score:
  - 90%+ if clear rhythm + matches baseline
  - 60-90% if rhythm detected but no baseline
  - <60% uncertain
```

#### Constant Weight (CWT - Bi-fins)
```
Signature:
  - Smooth acceleration curve
  - Higher average descent rate (0.7-1.2 m/s)
  - Low velocity variation (CV < 0.2)
  - Consistent fin kick pattern (subtle oscillations ~1 Hz)
  
Detection:
  1. Calculate velocity smoothness (rolling avg)
  2. Check for sustained high velocity
  3. Look for regular low-amplitude oscillations (fin kicks)
  4. Compare to user's CWT baseline
```

#### Constant No Fins (CNF)
```
Signature:
  - Very smooth velocity curve
  - Slower descent (0.5-0.8 m/s)
  - Extremely low variation (CV < 0.15)
  - Gradual acceleration (no jerky movements)
  
Detection:
  1. Low average velocity
  2. Very consistent speed
  3. No rhythmic patterns
  4. Smooth curve (low derivative variance)
```

### 4. Lung Volume Detection (Multi-Signal Analysis)

#### Full Lung Indicators
```
Primary Signals:
  1. HR Signature:
     - Higher avg HR vs. user baseline
     - Typical: baseline + 10-15 bpm
     
  2. Buoyancy Pattern (0-5m):
     - Slower initial descent (positive buoyancy)
     - Velocity increase after 2-3m
     - Initial speed < baseline * 0.7
     
  3. Duration Pattern:
     - Longer bottom time (more O2)
     - Deeper dives possible
     
Detection Algorithm:
  score = 0
  if avg_hr > (user.baseline_hr_full - 5): score += 40
  if velocity_0_2m < user.baseline_descent * 0.7: score += 30
  if bottom_time > median_bottom_time: score += 20
  if acceleration_visible_2_5m: score += 10
  
  if score >= 70: FULL_LUNG (high confidence)
  elif score >= 50: FULL_LUNG (medium)
  else: UNCERTAIN
```

#### FRC Indicators
```
Primary Signals:
  1. HR Signature:
     - Lower avg HR (baseline - 10-15 bpm)
     - Very consistent HR throughout dive
     - Example: Neko's FRC = 71-76 bpm vs 86 bpm full
     
  2. Buoyancy Pattern:
     - More consistent descent from surface
     - Neutral around 3-5m (pool) or 8-12m (ocean)
     - Less acceleration visible
     
  3. Dive Profile:
     - Similar depths to full lung (same technique)
     - Moderate bottom time
     
Detection:
  score = 0
  if avg_hr < (user.baseline_hr_full - 8): score += 50  # Strong signal!
  if hr_variance < threshold: score += 20  # Consistent HR
  if velocity_consistent: score += 20
  if no_buoyancy_struggle: score += 10
  
  if score >= 70: FRC
```

#### Exhale Dive Indicators
```
Primary Signals:
  1. HR Signature:
     - VERY low HR (baseline - 20+ bpm)
     - Mammalian dive reflex strongest
     
  2. Buoyancy:
     - Fast descent from surface (negative buoyancy)
     - No acceleration pattern (already sinking)
     - Initial velocity HIGH
     
  3. Dive Profile:
     - Usually shorter duration (less O2)
     - Shallower depths (harder without air)
     
Detection:
  if avg_hr < (user.baseline_hr_full - 18): score += 40
  if velocity_0_2m > baseline * 1.2: score += 40  # Fast start
  if duration < median * 0.8: score += 20
```

### 5. Machine Learning Enhancement (Phase 2)

After collecting 50+ tagged dives per user:

```python
Features:
  - HR stats (mean, std, min, max, range)
  - Velocity stats per depth zone (0-2m, 2-5m, >5m)
  - Velocity variation (CV, FFT for rhythm detection)
  - Buoyancy indicators (acceleration patterns)
  - Temporal features (time of day, session fatigue)
  - Previous dive context (fatigue accumulation)

Model:
  - Random Forest Classifier (interpretable)
  - Train on user's labeled dives
  - Output: Discipline + Lung Volume + Confidence
  
  If confidence < 60%: Ask user for manual tag
  If confidence >= 85%: Auto-label
  If 60-85%: Show prediction, ask confirmation
```

### 6. Database Schema Updates

```sql
-- User profiles
CREATE TABLE user_profiles (
    id INTEGER PRIMARY KEY,
    garmin_email TEXT UNIQUE,
    display_name TEXT,
    baseline_hr_resting REAL,
    baseline_hr_full_lung REAL,
    baseline_hr_frc REAL,
    baseline_descent_cwt REAL,
    baseline_descent_fim REAL,
    calibration_dives INTEGER DEFAULT 0,
    calibration_complete BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP
);

-- Enhanced dive sessions
CREATE TABLE dive_sessions_enhanced (
    id INTEGER PRIMARY KEY,
    user_id INTEGER REFERENCES user_profiles(id),
    activity_id INTEGER REFERENCES activities(id),
    dive_number INTEGER,
    
    -- Timing
    start_time TIMESTAMP,
    end_time TIMESTAMP,
    
    -- Depths
    max_depth REAL,
    avg_depth REAL,
    
    -- Durations
    total_duration REAL,
    descent_duration REAL,
    bottom_duration REAL,
    ascent_duration REAL,
    surface_interval REAL,
    
    -- Velocities
    avg_descent_rate REAL,
    max_descent_rate REAL,
    avg_ascent_rate REAL,
    max_ascent_rate REAL,
    velocity_variation REAL,  -- Coefficient of variation
    
    -- Heart Rate
    avg_hr REAL,
    max_hr REAL,
    min_hr REAL,
    hr_at_surface REAL,
    hr_at_depth REAL,
    
    -- Classification (auto-detected)
    discipline TEXT,  -- FIM/CWT/CNF/unknown
    discipline_confidence REAL,  -- 0-100
    lung_volume TEXT,  -- full/frc/exhale/unknown
    lung_confidence REAL,
    
    -- Manual override
    manual_discipline TEXT,
    manual_lung_volume TEXT,
    
    -- Raw data (for ML training)
    depth_profile JSON,  -- [depth every second]
    velocity_profile JSON,
    hr_profile JSON,
    
    created_at TIMESTAMP
);

-- Baseline learning history
CREATE TABLE baseline_updates (
    id INTEGER PRIMARY KEY,
    user_id INTEGER REFERENCES user_profiles(id),
    update_date TIMESTAMP,
    dives_analyzed INTEGER,
    baseline_data JSON,
    notes TEXT
);
```

### 7. User Experience Flow

#### New User (Calibration Mode)
```
Session 1-3 (First 20 dives):
  1. Dive detected → Parse data
  2. Show analysis: "Detected: CWT, Full Lung (75% confidence)"
  3. Ask: "Is this correct?" → User confirms/corrects
  4. Store labeled dive for baseline learning
  5. After 20 dives: "Baseline established! Auto-detection enabled ✅"

Progress indicator:
  "Building your baseline: 8/20 dives labeled
   Accuracy so far: 75%"
```

#### Experienced User (Auto-Detection)
```
New dive:
  1. Auto-analyze using baseline
  2. If confidence >= 85%: Show result
     "CWT, Full Lung (92% confidence) ✓"
  3. If confidence 60-85%: Ask confirmation
     "Detected: FIM, FRC (72% confidence) - Correct?"
  4. If confidence < 60%: Request manual tag
     "Unable to auto-detect - please tag this dive"
  5. Use feedback to improve baseline
```

## 🚀 Implementation Phases

### Phase 1: Core Parser (Week 1)
- [x] Dive data extraction from Garmin
- [ ] Time-series depth data parsing
- [ ] Velocity calculation from depth
- [ ] Phase detection (descent/bottom/ascent)
- [ ] Basic metrics (rates, durations, HR stats)

### Phase 2: Rule-Based Detection (Week 2)
- [ ] Discipline detection (FIM/CWT/CNF)
- [ ] Lung volume detection (Full/FRC/Exhale)
- [ ] Confidence scoring
- [ ] User baseline system

### Phase 3: Multi-User Support (Week 3)
- [ ] User profiles & authentication
- [ ] Calibration mode for new users
- [ ] Baseline learning algorithms
- [ ] Manual tagging interface

### Phase 4: ML Enhancement (Week 4+)
- [ ] Feature engineering
- [ ] Train classifiers on labeled data
- [ ] A/B test rule-based vs ML
- [ ] Continuous learning from user feedback

## 📊 Success Metrics

**Technical:**
- Detection accuracy > 85% after calibration
- False positive rate < 10%
- Processing time < 2s per session

**User Experience:**
- Calibration complete in 3-5 sessions
- User override rate < 15% (means auto-detection working)
- Users trust the system (NPS > 8)

## 🤿 Real-World Validation

**Test with diverse divers:**
- Different HR ranges (50-100 bpm resting)
- Various techniques (pull styles, fin types)
- Pool vs ocean (buoyancy differences)
- Beginners vs elite athletes

**Edge Cases:**
- Mixed disciplines in one session
- Depth changes during dive (not vertical)
- Equipment failures (HR sensor dropout)
- Very short dives (warmup/cooldown)

---

**Next Step:** Build Phase 1 - Core Parser
Extract individual dives, calculate velocities, detect phases.

Ready to start? 🚀
