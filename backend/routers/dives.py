"""
Per-dive breakdown endpoint.

GET /sessions/{session_id}/dives
  - Reads from dive_sessions cache if populated
  - On first request, fetches splits + time-series from Garmin Connect,
    stores in dive_sessions, returns result
  - Returns [] if Garmin credentials are not configured

The dive_sessions.dive_details JSON column stores:
  { depth_profile, hr_profile, velocity_profile, descent_time_s, ascent_time_s }
"""

import json
import asyncio
import io
import zipfile
from typing import Optional
import aiosqlite
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..database import get_db
from ..deps import verify_api_key
from ..config import settings

router = APIRouter(
    prefix="/sessions",
    tags=["dives"],
    dependencies=[Depends(verify_api_key)],
)


# ── Response schema ───────────────────────────────────────────────────────────

class IndividualDive(BaseModel):
    dive_number: int
    start_time: Optional[str]
    max_depth_m: float
    bottom_time_s: float
    descent_time_s: Optional[float]
    ascent_time_s: Optional[float]
    surface_interval_s: Optional[float]
    min_hr: Optional[float]
    max_hr: Optional[float]
    avg_hr: Optional[float]
    depth_profile: Optional[list]    # [[t_s, depth_m], ...]
    hr_profile: Optional[list]       # [[t_s, bpm], ...]
    velocity_profile: Optional[list] # [[t_s, m/s], ...]
    discipline: Optional[str]        # FIM/CWT/CNF if device-tagged


# ── Helpers ───────────────────────────────────────────────────────────────────

def _cm_to_m(val: Optional[float]) -> Optional[float]:
    """Garmin returns depth in cm in some API calls; convert to metres."""
    return round(val / 100, 2) if val is not None else None


def _build_velocity_profile(depth_profile: list) -> list:
    """
    Derive a [t_s, v_m/s] velocity profile from depth samples.
    Uses central differences for interior points, forward/backward at edges.
    """
    if not depth_profile or len(depth_profile) < 2:
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
        v = round(dd / dt, 3) if dt > 0 else 0.0
        result.append([t, v])
    return result


_DIVE_DEPTH_THRESHOLD = 0.5   # metres — below this = surface, ignore for profiles
_MAX_PROFILE_POINTS   = 300   # downsample long dives to keep payload reasonable


def _fetch_garmin_dives(garmin_activity_id: int) -> list[dict]:
    """
    Synchronously fetch per-dive data from Garmin Connect.
    Called via asyncio.to_thread so it doesn't block the event loop.

    Garmin API notes (verified against live data):
      - lapDTOs.maxDepth        → metres (NOT cm)
      - lapDTOs.bottomTime      → seconds
      - lapDTOs.duration        → seconds (surface_interval + dive time combined)
      - lapDTOs.surfaceInterval → cumulative from previous session; ignore
      - directDepth metric      → metres
      - directVerticalSpeed     → m/s (positive = descending)
      - directTimestamp         → Unix epoch in milliseconds
    """
    import datetime as dt
    from garminconnect import Garmin

    client = Garmin(settings.garmin_email, settings.garmin_password)
    client.login()

    splits = client.get_activity_splits(str(garmin_activity_id))
    laps = splits.get("lapDTOs", [])

    details = client.get_activity_details(str(garmin_activity_id))
    metrics_list = details.get("activityDetailMetrics", [])
    descriptors = {
        desc["metricsIndex"]: desc["key"]
        for desc in details.get("metricDescriptors", [])
    }

    # Metric indices (use exact key names confirmed from live API)
    depth_idx = next((k for k, v in descriptors.items() if v == "directDepth"), None)
    hr_idx    = next((k for k, v in descriptors.items() if v == "directHeartRate"), None)
    speed_idx = next((k for k, v in descriptors.items() if v == "directVerticalSpeed"), None)
    ts_idx    = next((k for k, v in descriptors.items() if v == "directTimestamp"), None)

    def _get(row: list, idx: Optional[int]) -> Optional[float]:
        return row[idx] if idx is not None and idx < len(row) else None

    # Build activity-wide time-series indexed by absolute timestamp (ms)
    all_points: list[dict] = []
    for m in metrics_list:
        row = m.get("metrics", [])
        ts    = _get(row, ts_idx)
        depth = _get(row, depth_idx)
        hr    = _get(row, hr_idx)
        speed = _get(row, speed_idx)
        if ts is not None:
            all_points.append({"ts": ts, "depth": depth, "hr": hr, "speed": speed})

    all_points.sort(key=lambda p: p["ts"])

    def _iso_to_ms(iso: Optional[str]) -> Optional[float]:
        if not iso:
            return None
        try:
            return dt.datetime.fromisoformat(iso.replace(".0", "")).replace(
                tzinfo=dt.timezone.utc
            ).timestamp() * 1000
        except ValueError:
            return None

    # Lap start times in ms
    lap_starts_ms = [_iso_to_ms(lap.get("startTimeGMT")) for lap in laps]

    result = []
    prev_dive_end_ms: Optional[float] = None  # track for surface interval

    for i, lap in enumerate(laps, 1):
        # ── Lap summary stats ─────────────────────────────────────────────────
        # maxDepth from lapDTOs is in METRES (confirmed from live Garmin data)
        max_depth_m  = round(lap.get("maxDepth") or 0, 2)
        bottom_time  = round(lap.get("bottomTime") or 0, 1)
        lap_duration = lap.get("duration") or 0

        # ── Surface interval ─────────────────────────────────────────────────
        # Surface interval = time resting at surface before THIS dive.
        # Compute from: lap_duration - bottom_time (rest portion of this lap).
        # For the first dive this is warmup time — set None.
        # Cap at 20 min: the last lap often includes all post-session time.
        _MAX_SI = 1200.0  # 20 minutes
        surface_interval_s: Optional[float] = None
        if i > 1:
            si = lap_duration - bottom_time
            if 0 < si <= _MAX_SI:
                surface_interval_s = round(si, 1)

        # ── Time-series: extract this lap's window by timestamp ───────────────
        lap_start_ms = lap_starts_ms[i - 1]
        if lap_start_ms is not None:
            lap_end_ms = lap_start_ms + lap_duration * 1000
            lap_points = [p for p in all_points if lap_start_ms <= p["ts"] < lap_end_ms]
        else:
            lap_points = []

        # ── Trim to actual dive: walk outward from peak depth ────────────────
        # Using threshold alone includes surface-swimming time (divers float at
        # ~0.5–1m between dives), inflating ascent times massively. Instead:
        # find the deepest point, then walk backward/forward until depth < 1m.
        _SURFACE_DEPTH = 1.0  # metres — anything shallower = at surface
        dive_points: list = []
        if lap_points:
            peak_pt = max(lap_points, key=lambda p: p.get("depth") or 0)
            peak_depth = peak_pt.get("depth") or 0
            if peak_depth > _DIVE_DEPTH_THRESHOLD:
                pi = lap_points.index(peak_pt)
                # walk backward to find descent start
                start_i = 0
                for j in range(pi, -1, -1):
                    if (lap_points[j].get("depth") or 0) < _SURFACE_DEPTH:
                        start_i = j + 1
                        break
                # walk forward to find ascent end
                end_i = len(lap_points)
                for j in range(pi, len(lap_points)):
                    if (lap_points[j].get("depth") or 0) < _SURFACE_DEPTH:
                        end_i = j
                        break
                dive_points = lap_points[start_i:end_i]

        if dive_points:
            t0_ms = dive_points[0]["ts"]
        elif lap_points:
            t0_ms = lap_points[0]["ts"]
        else:
            t0_ms = lap_start_ms or 0

        def _rel(ts_ms: float) -> float:
            return round((ts_ms - t0_ms) / 1000, 1)

        # Downsample if very dense
        def _thin(pts: list, max_pts: int) -> list:
            if len(pts) <= max_pts:
                return pts
            step = len(pts) // max_pts
            return pts[::step]

        dive_pts_thin = _thin(dive_points, _MAX_PROFILE_POINTS)

        depth_profile: Optional[list] = None
        hr_profile: Optional[list] = None
        velocity_profile: Optional[list] = None

        if dive_pts_thin:
            depth_profile = [
                [_rel(p["ts"]), round(p["depth"], 2)]
                for p in dive_pts_thin if p["depth"] is not None
            ] or None

            hr_profile = [
                [_rel(p["ts"]), p["hr"]]
                for p in dive_pts_thin if p["hr"] is not None
            ] or None

            if speed_idx is not None:
                velocity_profile = [
                    [_rel(p["ts"]), round(p["speed"], 3)]
                    for p in dive_pts_thin if p["speed"] is not None
                ] or None
            elif depth_profile:
                velocity_profile = _build_velocity_profile(depth_profile) or None

        # ── Descent / ascent times from trimmed depth profile ─────────────────
        descent_time_s: Optional[float] = None
        ascent_time_s: Optional[float] = None
        if depth_profile and len(depth_profile) > 1:
            peak_idx = max(range(len(depth_profile)), key=lambda x: depth_profile[x][1])
            if peak_idx > 0:
                descent_time_s = round(depth_profile[peak_idx][0], 1)
            if peak_idx < len(depth_profile) - 1:
                ascent_time_s = round(depth_profile[-1][0] - depth_profile[peak_idx][0], 1)

        result.append({
            "dive_number": i,
            "start_time": lap.get("startTimeGMT"),
            "max_depth_m": max_depth_m,
            "bottom_time_s": bottom_time,
            "descent_time_s": descent_time_s,
            "ascent_time_s": ascent_time_s,
            "surface_interval_s": surface_interval_s,
            "min_hr": lap.get("minHR"),
            "max_hr": lap.get("maxHR"),
            "avg_hr": lap.get("averageHR"),
            "depth_profile": depth_profile,
            "hr_profile": hr_profile,
            "velocity_profile": velocity_profile,
            "discipline": None,
        })

    return result


async def _populate_dives(
    activity_db_id: int,
    garmin_activity_id: int,
    conn: aiosqlite.Connection,
) -> list[dict]:
    """Fetch from Garmin and cache in dive_sessions."""
    dives = await asyncio.to_thread(_fetch_garmin_dives, garmin_activity_id)

    for d in dives:
        extra = {
            "depth_profile": d["depth_profile"],
            "hr_profile": d["hr_profile"],
            "velocity_profile": d["velocity_profile"],
            "descent_time_s": d["descent_time_s"],
            "ascent_time_s": d["ascent_time_s"],
            # max_hr has no column in dive_sessions — store in extra
            "max_hr": d["max_hr"],
            "start_time": d["start_time"],
        }
        await conn.execute(
            """
            INSERT OR REPLACE INTO dive_sessions
              (activity_id, dive_number, max_depth, bottom_time, total_time,
               surface_interval, avg_hr, min_hr,
               descent_rate, ascent_rate, dive_details)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                activity_db_id,
                d["dive_number"],
                d["max_depth_m"],
                d["bottom_time_s"],
                d["bottom_time_s"],
                d["surface_interval_s"],
                d["avg_hr"],
                d["min_hr"],
                # descent_rate = depth / descent_time
                round(d["max_depth_m"] / d["descent_time_s"], 3)
                if d["descent_time_s"] else None,
                round(d["max_depth_m"] / d["ascent_time_s"], 3)
                if d["ascent_time_s"] else None,
                json.dumps(extra),
            ),
        )

    await conn.commit()
    return dives


def _row_to_dive(row: aiosqlite.Row, stored_discipline: str | None = None) -> IndividualDive:
    extra: dict = {}
    try:
        extra = json.loads(row["dive_details"] or "{}")
    except (json.JSONDecodeError, TypeError):
        pass

    max_depth = row["max_depth"] or 0
    descent_rate = row["descent_rate"]
    ascent_rate = row["ascent_rate"]

    # surface_interval sanity check: cap at 4 hours (anything larger is
    # probably the gap between sessions, not between individual dives)
    si = row["surface_interval"]
    si_clean = si if (si is not None and si <= 14400) else None

    return IndividualDive(
        dive_number=row["dive_number"],
        start_time=extra.get("start_time"),
        max_depth_m=max_depth,
        bottom_time_s=row["bottom_time"] or 0,
        descent_time_s=extra.get("descent_time_s") or (
            round(max_depth / descent_rate, 1) if descent_rate else None
        ),
        ascent_time_s=extra.get("ascent_time_s") or (
            round(max_depth / ascent_rate, 1) if ascent_rate else None
        ),
        surface_interval_s=si_clean,
        min_hr=row["min_hr"],
        max_hr=extra.get("max_hr"),
        avg_hr=row["avg_hr"],
        depth_profile=extra.get("depth_profile"),
        hr_profile=extra.get("hr_profile"),
        velocity_profile=extra.get("velocity_profile"),
        discipline=stored_discipline,
    )


# ── Route ─────────────────────────────────────────────────────────────────────

@router.get("/{session_id}/dives", response_model=list[IndividualDive])
async def get_session_dives(
    session_id: int,
    conn: aiosqlite.Connection = Depends(get_db),
):
    # Verify session exists
    async with conn.execute(
        "SELECT id, json_extract(metadata,'$.activityId') as garmin_id "
        "FROM activities WHERE id = ?",
        (session_id,),
    ) as cur:
        session_row = await cur.fetchone()

    if not session_row:
        raise HTTPException(status_code=404, detail="Session not found")

    # Fetch cached dives + any stored discipline labels in one pass
    async with conn.execute(
        "SELECT * FROM dive_sessions WHERE activity_id = ? ORDER BY dive_number",
        (session_id,),
    ) as cur:
        cached = await cur.fetchall()

    if not cached:
        return []

    # Load all labels for this session keyed by dive_number
    async with conn.execute(
        "SELECT dive_number, discipline FROM dive_labels WHERE activity_id = ?",
        (session_id,),
    ) as cur:
        label_rows = await cur.fetchall()
    labels: dict[int, str] = {r["dive_number"]: r["discipline"] for r in label_rows}

    return [_row_to_dive(r, labels.get(r["dive_number"])) for r in cached]


# ── FIT file parsing ─────────────────────────────────────────────────────────

def _parse_fit_dives(garmin_activity_id: int) -> list[dict]:
    """
    Download FIT file from Garmin Connect and parse raw sensor data.

    FIT files contain full-resolution depth data at 3-decimal precision
    (vs 2-decimal from the API), plus unknown_127 which appears to be
    a raw velocity/acceleration metric from the pressure sensor.

    Returns per-dive data with high-precision depth and velocity profiles.
    """
    from garminconnect import Garmin
    import fitparse

    client = Garmin(settings.garmin_email, settings.garmin_password)
    client.login()

    # Download FIT file (returned as ZIP)
    fit_zip_bytes = client.download_activity(
        str(garmin_activity_id),
        dl_fmt=Garmin.ActivityDownloadFormat.ORIGINAL,
    )
    if not fit_zip_bytes:
        return []

    # Extract .fit from ZIP
    with zipfile.ZipFile(io.BytesIO(fit_zip_bytes)) as z:
        fit_names = [n for n in z.namelist() if n.lower().endswith(".fit")]
        if not fit_names:
            return []
        fit_data = z.read(fit_names[0])

    fitfile = fitparse.FitFile(io.BytesIO(fit_data))
    fitfile.parse()

    # Extract all record messages with depth
    all_points: list[dict] = []
    for record in fitfile.get_messages("record"):
        fields = {f.name: f.value for f in record.fields}
        ts = fields.get("timestamp")
        depth = fields.get("depth")
        hr = fields.get("heart_rate")
        unk127 = fields.get("unknown_127")  # raw velocity/accel metric
        if ts is not None and depth is not None:
            all_points.append({
                "ts": ts,
                "depth": round(depth, 3),
                "hr": hr,
                "raw_speed": unk127,
            })

    if not all_points:
        return []

    all_points.sort(key=lambda p: p["ts"])

    # Extract lap info for dive boundaries
    laps = list(fitfile.get_messages("lap"))

    # Segment into dives: contiguous sequences where depth > 1.0m
    # with gaps (surface intervals) detected by depth < 1.0m or time gaps
    _SURFACE_DEPTH = 1.0
    dives: list[list[dict]] = []
    current_dive: list[dict] = []

    for pt in all_points:
        if pt["depth"] >= _SURFACE_DEPTH:
            current_dive.append(pt)
        else:
            if len(current_dive) >= 3:
                max_d = max(p["depth"] for p in current_dive)
                if max_d >= _DIVE_DEPTH_THRESHOLD:
                    dives.append(current_dive)
            current_dive = []
    # Close trailing dive
    if len(current_dive) >= 3:
        max_d = max(p["depth"] for p in current_dive)
        if max_d >= _DIVE_DEPTH_THRESHOLD:
            dives.append(current_dive)

    result = []
    prev_end_ts = None

    for i, dive_pts in enumerate(dives, 1):
        t0 = dive_pts[0]["ts"]
        max_depth = max(p["depth"] for p in dive_pts)
        peak_idx = max(range(len(dive_pts)), key=lambda j: dive_pts[j]["depth"])
        duration = (dive_pts[-1]["ts"] - dive_pts[0]["ts"]).total_seconds()

        # Surface interval
        si = None
        if prev_end_ts:
            gap = (dive_pts[0]["ts"] - prev_end_ts).total_seconds()
            if 0 < gap <= 1200:
                si = round(gap, 1)
        prev_end_ts = dive_pts[-1]["ts"]

        # Build profiles with full precision
        depth_profile = [
            [round((p["ts"] - t0).total_seconds(), 1), p["depth"]]
            for p in dive_pts
        ]

        # HR profile
        hr_profile = [
            [round((p["ts"] - t0).total_seconds(), 1), p["hr"]]
            for p in dive_pts if p["hr"] is not None
        ] or None

        # Velocity: compute from high-precision depth using central differences
        velocity_profile = _build_velocity_profile(depth_profile) if depth_profile else None

        # Raw speed metric (unknown_127) — include as separate profile
        raw_speed_profile = None
        raw_pts = [
            [round((p["ts"] - t0).total_seconds(), 1), p["raw_speed"]]
            for p in dive_pts if p["raw_speed"] is not None
        ]
        if raw_pts:
            raw_speed_profile = raw_pts

        # Descent / ascent times
        descent_time_s = round(depth_profile[peak_idx][0], 1) if peak_idx > 0 else None
        ascent_time_s = round(
            depth_profile[-1][0] - depth_profile[peak_idx][0], 1
        ) if peak_idx < len(depth_profile) - 1 else None

        # Bottom time: time spent within 2m of max depth
        bottom_time = sum(
            1 for p in dive_pts if p["depth"] >= max_depth - 2.0
        )

        # HR stats
        hr_vals = [p["hr"] for p in dive_pts if p["hr"] is not None]

        result.append({
            "dive_number": i,
            "start_time": t0.isoformat() if t0 else None,
            "max_depth_m": round(max_depth, 3),
            "bottom_time_s": round(bottom_time, 1),
            "descent_time_s": descent_time_s,
            "ascent_time_s": ascent_time_s,
            "surface_interval_s": si,
            "min_hr": min(hr_vals) if hr_vals else None,
            "max_hr": max(hr_vals) if hr_vals else None,
            "avg_hr": round(sum(hr_vals) / len(hr_vals), 1) if hr_vals else None,
            "depth_profile": depth_profile,
            "hr_profile": hr_profile,
            "velocity_profile": velocity_profile,
            "raw_speed_profile": raw_speed_profile,
            "discipline": None,
        })

    return result


@router.post("/{session_id}/dives/resync-fit")
async def resync_dives_from_fit(
    session_id: int,
    conn: aiosqlite.Connection = Depends(get_db),
):
    """
    Re-sync dive data from FIT file instead of Garmin API.

    Downloads the raw FIT file from Garmin Connect and parses it
    for full-precision depth data (3 decimal places vs 2 from API)
    and the raw velocity metric. Replaces cached dive data.
    """
    async with conn.execute(
        "SELECT id, json_extract(metadata,'$.activityId') as garmin_id "
        "FROM activities WHERE id = ?",
        (session_id,),
    ) as cur:
        session_row = await cur.fetchone()

    if not session_row:
        raise HTTPException(status_code=404, detail="Session not found")

    raise HTTPException(
        status_code=503,
        detail="Garmin Connect API is no longer available. FIT file sync is disabled.",
    )

    if not dives:
        raise HTTPException(status_code=404, detail="No dives found in FIT file")

    # Clear existing cached data
    await conn.execute(
        "DELETE FROM dive_sessions WHERE activity_id = ?",
        (session_id,),
    )

    # Insert FIT-parsed data
    for d in dives:
        extra = {
            "depth_profile": d["depth_profile"],
            "hr_profile": d["hr_profile"],
            "velocity_profile": d["velocity_profile"],
            "raw_speed_profile": d.get("raw_speed_profile"),
            "descent_time_s": d["descent_time_s"],
            "ascent_time_s": d["ascent_time_s"],
            "max_hr": d["max_hr"],
            "start_time": d["start_time"],
            "source": "fit",
        }
        await conn.execute(
            """
            INSERT OR REPLACE INTO dive_sessions
              (activity_id, dive_number, max_depth, bottom_time, total_time,
               surface_interval, avg_hr, min_hr,
               descent_rate, ascent_rate, dive_details)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                session_id,
                d["dive_number"],
                d["max_depth_m"],
                d["bottom_time_s"],
                d["bottom_time_s"],
                d["surface_interval_s"],
                d["avg_hr"],
                d["min_hr"],
                round(d["max_depth_m"] / d["descent_time_s"], 3)
                if d["descent_time_s"] else None,
                round(d["max_depth_m"] / d["ascent_time_s"], 3)
                if d["ascent_time_s"] else None,
                json.dumps(extra),
            ),
        )

    await conn.commit()
    return {
        "status": "ok",
        "dives_parsed": len(dives),
        "source": "fit",
        "message": f"Re-synced {len(dives)} dives from FIT file with full-precision depth data",
    }
