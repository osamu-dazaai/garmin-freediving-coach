#!/usr/bin/env python3
"""
Batch import FIT files from the fit/ directory into dive_sessions.

For each *_Apnea*.zip (or any apnea activity zip) in fit/:
  - Extract the activity ID from the filename
  - Find the matching row in activities
  - Parse the FIT file for per-second depth/HR data
  - Update dive_sessions with full profiles

Run from the project root:
    python -m src.sync.import_fit_files
"""

import io
import json
import re
import sqlite3
import zipfile
from pathlib import Path

try:
    import fitparse
except ImportError:
    raise SystemExit("fitparse not installed. Run: pip install fitparse")

_ROOT    = Path(__file__).parent.parent.parent
_FIT_DIR = _ROOT / "fit"
_APP_DB  = _ROOT / "data" / "freediving.db"

_SURFACE_DEPTH   = 1.0   # metres — shallower than this = at surface
_MIN_DIVE_DEPTH  = 0.5   # minimum peak depth to count as a dive
_MIN_DIVE_POINTS = 3     # minimum data points
_MAX_SI          = 1200  # cap surface interval at 20 min
_MAX_PROFILE_PTS = 300   # downsample dense profiles


def _build_velocity(depth_profile: list) -> list:
    if len(depth_profile) < 2:
        return []
    result = []
    for i, (t, d) in enumerate(depth_profile):
        if i == 0:
            dt = depth_profile[1][0] - depth_profile[0][0]
            dd = depth_profile[1][1] - depth_profile[0][1]
        elif i == len(depth_profile) - 1:
            dt = depth_profile[-1][0] - depth_profile[-2][0]
            dd = depth_profile[-1][1] - depth_profile[-2][1]
        else:
            dt = depth_profile[i + 1][0] - depth_profile[i - 1][0]
            dd = depth_profile[i + 1][1] - depth_profile[i - 1][1]
        result.append([t, round(dd / dt, 3) if dt > 0 else 0.0])
    return result


def _thin(pts: list, max_pts: int) -> list:
    if len(pts) <= max_pts:
        return pts
    step = len(pts) // max_pts
    return pts[::step]


def parse_fit(fit_bytes: bytes) -> list[dict]:
    """Parse a FIT file and return per-dive data with profiles."""
    ff = fitparse.FitFile(io.BytesIO(fit_bytes))
    ff.parse()

    all_points = []
    for rec in ff.get_messages("record"):
        fields = {f.name: f.value for f in rec.fields}
        ts    = fields.get("timestamp")
        depth = fields.get("depth")
        hr    = fields.get("heart_rate")
        unk   = fields.get("unknown_127")
        if ts is not None and depth is not None:
            all_points.append({"ts": ts, "depth": round(depth, 3), "hr": hr, "raw_speed": unk})

    if not all_points:
        return []
    all_points.sort(key=lambda p: p["ts"])

    # Segment into dives by depth threshold
    dives: list[list[dict]] = []
    current: list[dict] = []
    for pt in all_points:
        if pt["depth"] >= _SURFACE_DEPTH:
            current.append(pt)
        else:
            if len(current) >= _MIN_DIVE_POINTS:
                if max(p["depth"] for p in current) >= _MIN_DIVE_DEPTH:
                    dives.append(current)
            current = []
    if len(current) >= _MIN_DIVE_POINTS and max(p["depth"] for p in current) >= _MIN_DIVE_DEPTH:
        dives.append(current)

    result = []
    prev_end_ts = None

    for i, dive_pts in enumerate(dives, 1):
        t0        = dive_pts[0]["ts"]
        max_depth = max(p["depth"] for p in dive_pts)
        peak_idx  = max(range(len(dive_pts)), key=lambda j: dive_pts[j]["depth"])

        si = None
        if prev_end_ts:
            gap = (dive_pts[0]["ts"] - prev_end_ts).total_seconds()
            if 0 < gap <= _MAX_SI:
                si = round(gap, 1)
        prev_end_ts = dive_pts[-1]["ts"]

        thin_pts = _thin(dive_pts, _MAX_PROFILE_PTS)

        depth_profile = [[round((p["ts"] - t0).total_seconds(), 1), p["depth"]] for p in thin_pts]
        hr_profile    = [[round((p["ts"] - t0).total_seconds(), 1), p["hr"]]    for p in thin_pts if p["hr"] is not None] or None
        vel_profile   = _build_velocity(depth_profile) or None

        raw_speed_pts = [[round((p["ts"] - t0).total_seconds(), 1), p["raw_speed"]] for p in thin_pts if p["raw_speed"] is not None]
        raw_speed_profile = raw_speed_pts or None

        descent_time_s = round(depth_profile[peak_idx][0], 1) if peak_idx > 0 else None
        ascent_time_s  = round(depth_profile[-1][0] - depth_profile[peak_idx][0], 1) if peak_idx < len(depth_profile) - 1 else None

        bottom_time = sum(1 for p in dive_pts if p["depth"] >= max_depth - 2.0)
        hr_vals     = [p["hr"] for p in dive_pts if p["hr"] is not None]

        result.append({
            "dive_number":      i,
            "start_time":       t0.isoformat(),
            "max_depth_m":      round(max_depth, 3),
            "bottom_time_s":    round(bottom_time, 1),
            "descent_time_s":   descent_time_s,
            "ascent_time_s":    ascent_time_s,
            "surface_interval": si,
            "min_hr":           min(hr_vals) if hr_vals else None,
            "max_hr":           max(hr_vals) if hr_vals else None,
            "avg_hr":           round(sum(hr_vals) / len(hr_vals), 1) if hr_vals else None,
            "depth_profile":    depth_profile,
            "hr_profile":       hr_profile,
            "velocity_profile": vel_profile,
            "raw_speed_profile": raw_speed_profile,
        })

    return result


def process_zip(zip_path: Path, activity_id: int, app_activity_id: int, conn: sqlite3.Connection) -> int:
    """Parse one zip, update dive_sessions. Returns number of dives written."""
    with zipfile.ZipFile(zip_path) as zf:
        fit_names = [n for n in zf.namelist() if n.lower().endswith(".fit")]
        if not fit_names:
            return 0
        fit_bytes = zf.read(fit_names[0])

    dives = parse_fit(fit_bytes)
    if not dives:
        return 0

    # Clear any existing rows for this activity before inserting FIT data
    conn.execute("DELETE FROM dive_sessions WHERE activity_id = ?", (app_activity_id,))

    for d in dives:
        dive_details = json.dumps({
            "start_time":        d["start_time"],
            "max_hr":            d["max_hr"],
            "depth_profile":     d["depth_profile"],
            "hr_profile":        d["hr_profile"],
            "velocity_profile":  d["velocity_profile"],
            "raw_speed_profile": d["raw_speed_profile"],
            "descent_time_s":    d["descent_time_s"],
            "ascent_time_s":     d["ascent_time_s"],
            "source":            "fit",
        })

        descent_rate = round(d["max_depth_m"] / d["descent_time_s"], 3) if d["descent_time_s"] else None
        ascent_rate  = round(d["max_depth_m"] / d["ascent_time_s"], 3)  if d["ascent_time_s"]  else None

        conn.execute(
            """
            INSERT OR REPLACE INTO dive_sessions
              (activity_id, dive_number, max_depth, bottom_time, total_time,
               surface_interval, avg_hr, min_hr,
               descent_rate, ascent_rate, dive_details)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                app_activity_id, d["dive_number"],
                d["max_depth_m"], d["bottom_time_s"], d["bottom_time_s"],
                d["surface_interval"],
                d["avg_hr"], d["min_hr"],
                descent_rate, ascent_rate,
                dive_details,
            ),
        )

    conn.commit()
    return len(dives)


def main() -> None:
    if not _FIT_DIR.exists():
        raise SystemExit(f"fit/ directory not found at {_FIT_DIR}")

    conn = sqlite3.connect(_APP_DB)
    conn.row_factory = sqlite3.Row

    # Build activity_id → app id map from freediving.db
    id_map = {
        row["garmin_activity_id"]: row["id"]
        for row in conn.execute(
            "SELECT id, garmin_activity_id FROM activities WHERE activity_type='apnea_diving'"
        ).fetchall()
    }

    # Find all apnea zip files — filename pattern: DATE_ACTIVITYID_Name.zip
    zips = sorted(_FIT_DIR.glob("*.zip"))
    apnea_zips = [z for z in zips if "apnea" in z.name.lower()]
    print(f"Found {len(apnea_zips)} apnea FIT zips in {_FIT_DIR}")

    processed = skipped = errors = total_dives = 0

    for zip_path in apnea_zips:
        # Extract activity ID from filename (the numeric part after the date)
        m = re.search(r"_(\d{10,})_", zip_path.name)
        if not m:
            print(f"  SKIP (no activity ID): {zip_path.name}")
            skipped += 1
            continue

        activity_id = int(m.group(1))
        app_id = id_map.get(activity_id)
        if app_id is None:
            print(f"  SKIP (not in db): {zip_path.name}")
            skipped += 1
            continue

        try:
            n = process_zip(zip_path, activity_id, app_id, conn)
            print(f"  OK  {zip_path.name}: {n} dives")
            processed += 1
            total_dives += n
        except Exception as e:
            print(f"  ERR {zip_path.name}: {e}")
            errors += 1

    conn.close()
    print()
    print(f"Done. {processed} sessions, {total_dives} dives written. {skipped} skipped, {errors} errors.")


if __name__ == "__main__":
    main()
