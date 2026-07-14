#!/usr/bin/env python3
"""
One-time migration: import all data from garmin.db into freediving.db.

Garmin deprecated the auth library (garth), so garmin.db is now the
sole source of Garmin data. This script backfills:
  - apnea_diving activities → activities table
  - per-dive splits         → dive_sessions table (basic stats, no profiles)
  - daily health data       → health_metrics table

Run once from the project root:
    python -m src.sync.migrate_from_garmin_db
"""

import json
import sqlite3
from pathlib import Path

_ROOT = Path(__file__).parent.parent.parent
_GARMIN_DB = _ROOT / "garmin.db"
_APP_DB    = _ROOT / "data" / "freediving.db"

_MAX_SI = 1200.0  # cap surface interval at 20 min


def _build_activity_metadata(row: sqlite3.Row, summary: dict) -> dict:
    """
    Build a metadata JSON that matches what SessionMeta.from_raw expects.
    The old Garmin API returned maxDepth/avgDepth in cm; garmin.db stores
    them in metres, so we multiply back to preserve backward compatibility.
    """
    max_depth_m = summary.get("maxDepth") or 0
    avg_depth_m = summary.get("averageDepth") or 0
    return {
        "activityId":      row["activity_id"],
        "activityName":    row["activity_name"],
        "maxDepth":        max_depth_m * 100,   # convert m → cm (old API format)
        "avgDepth":        avg_depth_m * 100,
        "diveCount":       summary.get("diveCount"),
        "bottomTime":      summary.get("bottomTime"),
        "maxBottomTime":   summary.get("maxBottomTime"),
        "locationName":    row["location_name"] or "Unknown",
        "minTemperature":  summary.get("minTemperature"),
        "surfaceInterval": summary.get("surfaceInterval"),
    }


def migrate_activities(garmin: sqlite3.Connection, app: sqlite3.Connection) -> dict[int, int]:
    """
    Insert apnea_diving activities from garmin.db into freediving.db.
    Returns a mapping {garmin_activity_id: app_activity_id}.
    """
    garmin.row_factory = sqlite3.Row
    rows = garmin.execute(
        "SELECT * FROM activity WHERE activity_type='apnea_diving' ORDER BY start_time_local"
    ).fetchall()

    inserted = skipped = 0
    id_map: dict[int, int] = {}

    for row in rows:
        try:
            raw = json.loads(row["raw_json"] or "{}")
        except json.JSONDecodeError:
            raw = {}
        summary = raw.get("summaryDTO", {})
        metadata = _build_activity_metadata(row, summary)

        cur = app.execute(
            """
            INSERT OR IGNORE INTO activities
              (garmin_activity_id, activity_type, start_time, duration,
               calories, avg_hr, max_hr, distance, metadata, synced_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            """,
            (
                row["activity_id"],
                row["activity_type"],
                row["start_time_local"],
                row["duration_seconds"],
                row["calories"],
                row["average_hr"],
                row["max_hr"],
                row["distance_meters"],
                json.dumps(metadata),
            ),
        )
        if cur.lastrowid and cur.rowcount:
            inserted += 1
            id_map[row["activity_id"]] = cur.lastrowid
        else:
            skipped += 1
            existing = app.execute(
                "SELECT id FROM activities WHERE garmin_activity_id = ?",
                (row["activity_id"],),
            ).fetchone()
            if existing:
                id_map[row["activity_id"]] = existing[0]

    app.commit()
    print(f"  Activities: {inserted} inserted, {skipped} already present")
    return id_map


def migrate_dive_sessions(
    garmin: sqlite3.Connection,
    app: sqlite3.Connection,
    id_map: dict[int, int],
) -> None:
    """
    Populate dive_sessions from activity_splits for all apnea activities.
    Basic stats only — no depth/HR time-series (needs FIT files for those).
    """
    garmin.row_factory = sqlite3.Row
    inserted = skipped = 0

    for garmin_aid, app_aid in id_map.items():
        splits = garmin.execute(
            "SELECT * FROM activity_splits WHERE activity_id = ? ORDER BY split_number",
            (garmin_aid,),
        ).fetchall()

        for split in splits:
            try:
                sj = json.loads(split["raw_json"] or "{}")
            except json.JSONDecodeError:
                sj = {}

            dive_num   = split["split_number"]
            max_depth  = sj.get("maxDepth") or 0       # already in metres
            bottom_time = sj.get("bottomTime") or 0
            duration   = split["duration_seconds"] or 0
            avg_hr     = sj.get("averageHR")
            max_hr     = sj.get("maxHR")
            water_temp = sj.get("averageTemperature")
            start_time = sj.get("startTimeGMT")

            # Surface interval = rest portion of this lap (same logic as dives.py)
            surface_interval = None
            if dive_num > 1:
                si = duration - bottom_time
                if 0 < si <= _MAX_SI:
                    surface_interval = round(si, 1)

            dive_details = json.dumps({
                "start_time": start_time,
                "max_hr": max_hr,
                "avg_depth_m": sj.get("averageDepth"),
            })

            cur = app.execute(
                """
                INSERT OR IGNORE INTO dive_sessions
                  (activity_id, dive_number, max_depth, bottom_time, total_time,
                   surface_interval, avg_hr, min_hr, water_temp, dive_details)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    app_aid, dive_num, max_depth, bottom_time, duration,
                    surface_interval, avg_hr, None, water_temp, dive_details,
                ),
            )
            if cur.rowcount:
                inserted += 1
            else:
                skipped += 1

    app.commit()
    print(f"  Dive splits: {inserted} inserted, {skipped} already present")


def migrate_health_metrics(garmin: sqlite3.Connection, app: sqlite3.Connection) -> None:
    """
    Merge daily_summary + sleep + hrv from garmin.db into health_metrics.
    """
    garmin.row_factory = sqlite3.Row

    # Build a map of sleep scores keyed by calendar_date
    sleep_rows = {r["calendar_date"]: r for r in garmin.execute(
        "SELECT * FROM sleep"
    ).fetchall()}

    # HRV keyed by calendar_date
    hrv_rows = {r["calendar_date"]: r for r in garmin.execute(
        "SELECT * FROM hrv"
    ).fetchall()}

    daily = garmin.execute(
        "SELECT * FROM daily_summary ORDER BY calendar_date"
    ).fetchall()

    inserted = skipped = 0

    for row in daily:
        date = row["calendar_date"]
        sl   = sleep_rows.get(date)
        hrv  = hrv_rows.get(date)

        # Parse sleep score from sleep.raw_json
        sleep_score = None
        if sl:
            try:
                sraw = json.loads(sl["raw_json"] or "{}")
                sleep_score = (
                    sraw.get("dailySleepDTO", {})
                        .get("sleepScores", {})
                        .get("overall", {})
                        .get("value")
                )
            except (json.JSONDecodeError, AttributeError):
                pass

        cur = app.execute(
            """
            INSERT OR IGNORE INTO health_metrics
              (date, resting_hr, hrv_avg, hrv_status,
               stress_avg, stress_max,
               body_battery_charged, body_battery_drained,
               sleep_score, sleep_duration, sleep_deep, sleep_light,
               sleep_rem, sleep_awake,
               spo2_avg, respiration_avg,
               calories_total, steps, intensity_minutes, synced_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            """,
            (
                date,
                row["resting_heart_rate"],
                hrv["last_night_avg"] if hrv else None,
                hrv["status"] if hrv else None,
                row["average_stress_level"],
                row["max_stress_level"],
                row["body_battery_charged"],
                row["body_battery_drained"],
                sleep_score,
                (sl["sleep_time_seconds"] // 60) if sl and sl["sleep_time_seconds"] else None,
                (sl["deep_sleep_seconds"] // 60)  if sl and sl["deep_sleep_seconds"] else None,
                (sl["light_sleep_seconds"] // 60) if sl and sl["light_sleep_seconds"] else None,
                (sl["rem_sleep_seconds"] // 60)   if sl and sl["rem_sleep_seconds"] else None,
                (sl["awake_sleep_seconds"] // 60) if sl and sl["awake_sleep_seconds"] else None,
                row["average_spo2"],
                row["avg_waking_respiration"],
                row["total_kilocalories"],
                row["total_steps"],
                (row["moderate_intensity_minutes"] or 0) + (row["vigorous_intensity_minutes"] or 0),
            ),
        )
        if cur.rowcount:
            inserted += 1
        else:
            skipped += 1

    app.commit()
    print(f"  Health metrics: {inserted} inserted, {skipped} already present")


def main() -> None:
    if not _GARMIN_DB.exists():
        print(f"ERROR: garmin.db not found at {_GARMIN_DB}")
        raise SystemExit(1)

    print(f"Source : {_GARMIN_DB}")
    print(f"Target : {_APP_DB}")
    print()

    garmin = sqlite3.connect(_GARMIN_DB)
    app    = sqlite3.connect(_APP_DB)

    try:
        print("Migrating activities…")
        id_map = migrate_activities(garmin, app)

        print("Migrating dive splits…")
        migrate_dive_sessions(garmin, app, id_map)

        print("Migrating health metrics…")
        migrate_health_metrics(garmin, app)
    finally:
        garmin.close()
        app.close()

    print()
    print("Migration complete.")


if __name__ == "__main__":
    main()
