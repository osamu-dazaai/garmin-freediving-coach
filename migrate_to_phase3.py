#!/usr/bin/env python3
"""
Migrate to Phase 3: User Baselines

This script:
1. Creates Phase 3 tables (user_profiles, dive_sessions_enhanced, etc.)
2. Migrates existing dive_sessions data to enhanced format
3. Creates default user profile
4. Runs initial baseline calculation if labeled data exists
"""

import sqlite3
import sys
import os
from pathlib import Path

# Add src to path
sys.path.insert(0, str(Path(__file__).parent / 'src'))

from core.baseline_manager import BaselineManager


def migrate_database(db_path: str):
    """Run Phase 3 migration"""
    
    print(f"🔧 Migrating database to Phase 3: {db_path}")
    
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Read and execute Phase 3 schema
    schema_path = Path(__file__).parent / 'src' / 'core' / 'schema_phase3.sql'
    
    if not schema_path.exists():
        print(f"❌ Schema file not found: {schema_path}")
        return False
    
    with open(schema_path) as f:
        schema_sql = f.read()
    
    print("📋 Creating Phase 3 tables...")
    
    try:
        # Execute schema (creates tables if not exists)
        cursor.executescript(schema_sql)
        conn.commit()
        print("✅ Tables created successfully")
    except sqlite3.Error as e:
        print(f"❌ Error creating tables: {e}")
        return False
    
    # Check if we need to migrate existing dive_sessions
    cursor.execute("SELECT COUNT(*) FROM dive_sessions")
    old_dive_count = cursor.fetchone()[0]
    
    cursor.execute("SELECT COUNT(*) FROM dive_sessions_enhanced")
    new_dive_count = cursor.fetchone()[0]
    
    if old_dive_count > 0 and new_dive_count == 0:
        print(f"\n📦 Migrating {old_dive_count} dives from old to enhanced format...")
        
        # Get default user ID
        cursor.execute("SELECT id FROM user_profiles WHERE username = 'neko'")
        user_row = cursor.fetchone()
        if not user_row:
            print("❌ Default user not found")
            return False
        
        user_id = user_row[0]
        
        # Migrate dives
        cursor.execute("""
            INSERT INTO dive_sessions_enhanced (
                user_id, activity_id, dive_number,
                max_depth, avg_depth, total_duration, bottom_duration,
                avg_descent_rate, avg_ascent_rate,
                avg_hr, min_hr, surface_interval
            )
            SELECT 
                ?, activity_id, dive_number,
                max_depth, max_depth * 0.7, total_time, bottom_time,
                descent_rate, ascent_rate,
                avg_hr, min_hr, surface_interval
            FROM dive_sessions
        """, (user_id,))
        
        migrated = cursor.rowcount
        conn.commit()
        print(f"✅ Migrated {migrated} dives")
    
    elif new_dive_count > 0:
        print(f"ℹ️  Found {new_dive_count} dives in enhanced format (migration already done)")
    
    conn.close()
    
    # Initialize baseline manager
    print("\n🧠 Initializing baseline manager...")
    manager = BaselineManager(db_path)
    
    # Show calibration status
    progress = manager.get_calibration_progress()
    print(f"\n{progress['message']}")
    
    if progress['total_labeled'] > 0:
        print(f"📊 Found {progress['total_labeled']} labeled dives")
        print("🔄 Calculating initial baselines...")
        success, message = manager.update_user_baselines()
        print(message)
    else:
        print("ℹ️  No labeled dives yet. Label some dives to start calibration!")
    
    manager.close()
    
    print("\n✅ Phase 3 migration complete!")
    print("\nNext steps:")
    print("1. Use the dashboard to label dives (discipline + lung volume)")
    print("2. After 20 labeled dives, auto-detection will be enabled")
    print("3. Run: python src/core/baseline_manager.py <db_path> to recalculate baselines")
    
    return True


if __name__ == "__main__":
    # Find database
    db_path = Path(__file__).parent / "garmin_coach.db"
    
    if len(sys.argv) > 1:
        db_path = Path(sys.argv[1])
    
    if not db_path.exists():
        print(f"❌ Database not found: {db_path}")
        print("Creating new database...")
        
        # Create database with base schema first
        conn = sqlite3.connect(db_path)
        schema_base = Path(__file__).parent / 'src' / 'core' / 'schema.sql'
        if schema_base.exists():
            with open(schema_base) as f:
                conn.executescript(f.read())
        conn.close()
    
    success = migrate_database(str(db_path))
    sys.exit(0 if success else 1)
