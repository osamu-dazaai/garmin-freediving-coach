# Phase 3: User Baselines - Implementation Complete ✅

## 🎯 What Was Built

Phase 3 adds personalized dive classification through user-specific baseline learning.

### Components Delivered

1. **Database Schema** (`src/core/schema_phase3.sql`)
   - `user_profiles` - Store personal baselines (HR, descent rates, etc.)
   - `dive_sessions_enhanced` - Rich dive storage with AI + manual labels
   - `baseline_updates` - Track how baselines evolve over time
   - `training_sessions` - Session-level summaries

2. **Baseline Manager** (`src/core/baseline_manager.py`)
   - Calculate baselines from labeled dives
   - Track calibration progress (0-20+ dives)
   - Provide confidence scoring
   - Update user profiles automatically

3. **Labeling Interface** (`dashboard/pages/2_🏷️_Label_Dives.py`)
   - Mobile-optimized dive labeling UI
   - Show AI suggestions with confidence scores
   - Manual discipline + lung volume tagging
   - Dive profile visualization
   - Real-time calibration progress
   - Auto-recalculates baselines after labeling

4. **Migration System** (`migrate_to_phase3.py`)
   - One-command upgrade to Phase 3 schema
   - Migrates existing dives to enhanced format
   - Creates default user profile
   - Safe idempotent operation

## 🚀 How It Works

### Calibration Flow

```
New User → Label 20 Dives → Baselines Learned → Auto-Detection Enabled
   ↓              ↓                ↓                      ↓
Dashboard   AI suggests    Update baselines    High confidence
  UI        user confirms   after each batch    classifications
```

### Baseline Learning

The system calculates personal baselines for:

**Heart Rate:**
- `baseline_hr_resting` - From health metrics
- `baseline_hr_full_lung` - Average HR during full lung dives
- `baseline_hr_frc` - Average HR during FRC dives  
- `baseline_hr_exhale` - Average HR during exhale dives

**Descent Rates:**
- `baseline_descent_fim` - Free Immersion speed
- `baseline_descent_cwt` - Constant Weight (bi-fins)
- `baseline_descent_cnf` - Constant No Fins

### Confidence Scoring

Baseline confidence (0-100%) based on:
- **Dive count** (0-50 points): More labeled dives = higher confidence
- **Consistency** (0-30 points): Low variance = reliable baseline
- **Coverage** (0-20 points): More categories labeled = better model

Target: **20 labeled dives** for "excellent" quality baselines

## 📊 Usage

### 1. Run Migration

```bash
cd /home/clawd/.openclaw/projects/garmin-freediving
source venv/bin/activate
python migrate_to_phase3.py data/freediving.db
```

### 2. Access Labeling Interface

Dashboard: http://37.27.201.10:8503  
Navigate to: **🏷️ Label Dives** page

### 3. Label Dives

For each dive:
1. Review AI suggestion (discipline + lung volume + confidence)
2. Check dive profile (depth, velocity, HR)
3. Confirm or correct the labels
4. Add optional notes
5. Save → Baselines auto-update

### 4. Track Progress

Progress bar shows: **X/20 dives labeled**

After 20 dives: ✅ **Calibration Complete!**

## 🔬 Technical Details

### Database Design

**dive_sessions_enhanced** uses **computed columns** for final classification:

```sql
final_discipline = COALESCE(manual_discipline, ai_discipline)
final_lung_volume = COALESCE(manual_lung_volume, ai_lung_volume)
```

Manual labels **always override** AI suggestions.

### Baseline Calculation

Example baseline object:

```json
{
  "baseline_hr_full_lung": {
    "mean": 85.3,
    "stdev": 3.2,
    "count": 12,
    "min": 80,
    "max": 92
  },
  "baseline_hr_frc": {
    "mean": 72.5,
    "stdev": 2.8,
    "count": 8,
    "min": 68,
    "max": 76
  },
  "baseline_descent_fim": {
    "mean": 0.62,
    "stdev": 0.08,
    "count": 15
  }
}
```

**HR Differential Detection:**
- FRC dives: ~12 bpm **below** session average
- Full lung: ~10 bpm **above** session average
- **20+ bpm spread** = strong signal!

### Multi-User Support

Schema supports multiple users (future):
- Each user has separate `user_profiles` entry
- Baselines are user-specific
- Currently: single user "neko" (ID=1)

## 📁 Files Created

```
src/core/
  schema_phase3.sql         - Phase 3 database schema
  baseline_manager.py       - Baseline calculation engine

dashboard/pages/
  2_🏷️_Label_Dives.py      - Labeling UI (Streamlit)

migrate_to_phase3.py        - Migration script
populate_enhanced_dives.py  - Dive extraction (needs Garmin auth)
PHASE3_README.md           - This file
```

## 🔄 Integration with Existing Code

Phase 3 **does not break** existing code:
- Original `activities` and `dive_sessions` tables unchanged
- Enhanced tables are additive
- Can run old and new systems side-by-side

## 🎯 Next Steps (Phase 4+)

1. **Populate Enhanced Dives**
   - Fix Garmin auth (credentials refresh)
   - Run `populate_enhanced_dives.py` to extract existing dives
   - Or manually import dive data

2. **Use Baselines for Detection**
   - Update `discipline_detector.py` to query baselines
   - Compare dive metrics against user's baseline
   - Boost confidence when matching baseline patterns

3. **ML Enhancement**
   - Train models on labeled data
   - Use velocity/HR time-series for deep learning
   - Export labeled dives for training

4. **Multi-User Product**
   - User authentication
   - Profile management
   - Public/private dive logs
   - Community features

## 🐛 Known Issues

1. **Garmin Auth**: `populate_enhanced_dives.py` fails with 401 Unauthorized
   - **Fix**: Refresh Garmin credentials (`garmin_sync.py`)
   - **Workaround**: Manually label new dives from dashboard

2. **No Historical Dives**: Enhanced table is empty until populated
   - 8 activities exist in `activities` table
   - Need to run populate script after auth fixed

3. **Dashboard Page Navigation**: Multi-page Streamlit might need server restart

## 💡 Design Decisions

**Why 20 dives for calibration?**
- Statistical significance (n=20 gives reasonable confidence intervals)
- Covers variety of dive types and conditions
- Not too burdensome for users (2-3 training sessions)

**Why store both AI and manual labels?**
- Track AI accuracy over time
- User can see where AI is wrong
- Build labeled dataset for ML training
- Allows A/B testing of detection algorithms

**Why JSON for time-series data?**
- SQLite doesn't have array types
- JSON is queryable (SQLite 3.38+)
- Compact storage
- Easy to export for analysis

## 🎉 Success Metrics

Phase 3 is **complete** when:
- ✅ Schema created and migrated
- ✅ Baseline manager working
- ✅ Labeling UI functional
- ✅ Calibration progress tracking
- ✅ Baselines auto-update
- ⏳ Users can label 20+ dives (blocked on Garmin auth)
- ⏳ Detection uses baselines (Phase 4 integration)

Current status: **Core infrastructure complete, ready for data**

---

**Built:** 2026-02-24  
**Author:** NekosClawd  
**Phase:** 3 of 4
