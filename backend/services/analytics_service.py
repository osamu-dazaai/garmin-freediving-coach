"""
Analytics service — depth progression, working depth, plateau detection,
training phase, location stats, surface intervals, monthly stats, year review.
"""
from __future__ import annotations
import json
from datetime import date, timedelta
import numpy as np
import aiosqlite

from ..models.analytics import (
    DepthPoint, WorkingDepth, PlateauStatus, TrainingPhase,
    LocationStat, PersonalBests, SurfaceIntervalEntry,
    MonthlyStats, YearReview, ReturnToDepthPoint,
)

_POOL_LOCATIONS = {"bengaluru", "secunderabad", "hyderabad", "delhi", "mumbai pool"}
_MAX_DEPTH_POOL_THRESHOLD_M = 6.0  # sessions <= this treated as pool


def _parse_meta(row) -> dict:
    try:
        return json.loads(row["metadata"] or "{}")
    except (json.JSONDecodeError, TypeError):
        return {}


def _depth_m(meta: dict) -> float:
    return round((meta.get("maxDepth") or 0) / 100, 2)


def _avg_depth_m(meta: dict) -> float:
    return round((meta.get("avgDepth") or 0) / 100, 2)


def _is_pool_session(meta: dict) -> bool:
    loc = (meta.get("locationName") or "").lower().strip()
    depth = _depth_m(meta)
    return loc in _POOL_LOCATIONS or depth <= _MAX_DEPTH_POOL_THRESHOLD_M


async def _fetch_apnea_sessions(conn: aiosqlite.Connection, days: int | None = None):
    sql = "SELECT id, start_time, metadata FROM activities WHERE activity_type='apnea_diving'"
    params: tuple = ()
    if days:
        since = (date.today() - timedelta(days=days)).isoformat()
        sql += " AND start_time >= ?"
        params = (since,)
    sql += " ORDER BY start_time ASC"
    async with conn.execute(sql, params) as cur:
        return await cur.fetchall()


# ---------------------------------------------------------------------------
# Depth progression
# ---------------------------------------------------------------------------

async def get_depth_progression(conn: aiosqlite.Connection, days: int = 365) -> list[DepthPoint]:
    rows = await _fetch_apnea_sessions(conn, days)
    result = []
    for row in rows:
        m = _parse_meta(row)
        d = _depth_m(m)
        if d > 0:
            result.append(DepthPoint(
                date=row["start_time"][:10],
                max_depth_m=d,
                session_id=row["id"],
            ))
    return result


# ---------------------------------------------------------------------------
# Working depth (70th percentile)
# ---------------------------------------------------------------------------

async def get_working_depth(conn: aiosqlite.Connection, window_days: int = 90) -> WorkingDepth:
    rows = await _fetch_apnea_sessions(conn, window_days)
    depths = [_depth_m(_parse_meta(r)) for r in rows]
    depths = [d for d in depths if d > 0]

    if not depths:
        return WorkingDepth(working_depth_m=0, pb_depth_m=0, avg_depth_m=0,
                            window_days=window_days, session_count=0)

    return WorkingDepth(
        working_depth_m=round(float(np.percentile(depths, 70)), 2),
        pb_depth_m=round(max(depths), 2),
        avg_depth_m=round(float(np.mean(depths)), 2),
        window_days=window_days,
        session_count=len(depths),
    )


# ---------------------------------------------------------------------------
# Plateau detection
# ---------------------------------------------------------------------------

async def get_plateau_status(conn: aiosqlite.Connection) -> PlateauStatus:
    rows = await _fetch_apnea_sessions(conn)
    points = [(row["start_time"][:10], _depth_m(_parse_meta(row))) for row in rows]
    points = [(d, depth) for d, depth in points if depth > 0]

    if not points:
        return PlateauStatus(plateau=False, days_since_improvement=0,
                             last_pb_date=None, last_pb_depth_m=None, suggestion=None)

    running_max = 0.0
    last_pb_date = None
    last_pb_depth = 0.0

    for session_date, depth in points:
        if depth > running_max:
            running_max = depth
            last_pb_date = session_date
            last_pb_depth = depth

    if last_pb_date is None:
        return PlateauStatus(plateau=False, days_since_improvement=0,
                             last_pb_date=None, last_pb_depth_m=None, suggestion=None)

    days_since = (date.today() - date.fromisoformat(last_pb_date)).days
    plateau = days_since >= 60

    suggestion = None
    if plateau:
        if days_since >= 120:
            suggestion = "Extended plateau. Consider structured CO2/O2 table block or change training location."
        else:
            suggestion = "Consider focusing on bottom time consistency rather than depth progression."

    return PlateauStatus(
        plateau=plateau,
        days_since_improvement=days_since,
        last_pb_date=last_pb_date,
        last_pb_depth_m=last_pb_depth,
        suggestion=suggestion,
    )


# ---------------------------------------------------------------------------
# Training phase auto-detection
# ---------------------------------------------------------------------------

async def get_training_phase(conn: aiosqlite.Connection) -> TrainingPhase:
    # Look at last 30 sessions
    async with conn.execute(
        "SELECT id, start_time, metadata FROM activities WHERE activity_type='apnea_diving' "
        "ORDER BY start_time DESC LIMIT 30"
    ) as cur:
        rows = await cur.fetchall()

    if not rows:
        return TrainingPhase(current_phase="rest", phase_start_date=date.today().isoformat(),
                             session_count=0, avg_depth_m=0, streak_days=0)

    phases = []
    for row in rows:
        m = _parse_meta(row)
        phase = "pool" if _is_pool_session(m) else "open_water"
        phases.append((row["start_time"][:10], phase, _depth_m(m)))

    # Current phase = most recent session's phase
    current_phase = phases[0][1]

    # Find streak
    streak_start = phases[0][0]
    for session_date, phase, _ in phases[1:]:
        if phase != current_phase:
            break
        streak_start = session_date

    streak_days = (date.today() - date.fromisoformat(streak_start)).days + 1
    streak_sessions = [p for p in phases if p[1] == current_phase]
    depths = [p[2] for p in streak_sessions if p[2] > 0]

    return TrainingPhase(
        current_phase=current_phase,
        phase_start_date=streak_start,
        session_count=len(streak_sessions),
        avg_depth_m=round(float(np.mean(depths)), 2) if depths else 0,
        streak_days=streak_days,
    )


# ---------------------------------------------------------------------------
# Personal bests
# ---------------------------------------------------------------------------

async def get_personal_bests(
    conn: aiosqlite.Connection,
    since: str | None = None,
    until: str | None = None,
) -> PersonalBests:
    all_rows = await _fetch_apnea_sessions(conn)

    max_depth = 0.0
    max_depth_date = ""
    max_bt = 0.0
    max_bt_date = ""
    max_dc = 0
    total_bt = 0.0
    total_depth = 0.0

    # Window-filtered accumulators
    w_sessions = 0
    w_bt = 0.0
    w_depth = 0.0

    for row in all_rows:
        m = _parse_meta(row)
        depth = _depth_m(m)
        bt = (m.get("maxBottomTime") or 0)
        total_bt_session = (m.get("bottomTime") or 0)
        dc = m.get("diveCount") or 0
        session_date = row["start_time"][:10]

        # All-time aggregates
        if depth > max_depth:
            max_depth = depth
            max_depth_date = session_date
        if bt > max_bt:
            max_bt = bt
            max_bt_date = session_date
        if dc > max_dc:
            max_dc = dc
        total_bt += total_bt_session
        total_depth += depth

        # Windowed aggregates
        in_window = True
        if since and session_date < since:
            in_window = False
        if until and session_date > until:
            in_window = False
        if in_window:
            w_sessions += 1
            w_bt += total_bt_session
            w_depth += depth

    # Build window label
    window_label = None
    if since or until:
        parts = []
        if since:
            parts.append(f"from {since}")
        if until:
            parts.append(f"to {until}")
        window_label = " ".join(parts)

    return PersonalBests(
        max_depth_m=round(max_depth, 2),
        max_depth_date=max_depth_date,
        max_bottom_time_s=round(max_bt, 1),
        max_bottom_time_date=max_bt_date,
        max_dive_count=max_dc,
        total_sessions=len(all_rows),
        total_bottom_time_s=round(total_bt, 1),
        total_depth_descended_m=round(total_depth, 1),
        window_label=window_label,
        window_sessions=w_sessions if window_label else None,
        window_bottom_time_s=round(w_bt, 1) if window_label else None,
        window_depth_descended_m=round(w_depth, 1) if window_label else None,
    )


# ---------------------------------------------------------------------------
# Location performance
# ---------------------------------------------------------------------------

async def get_location_performance(conn: aiosqlite.Connection) -> list[LocationStat]:
    rows = await _fetch_apnea_sessions(conn)

    loc_data: dict[str, dict] = {}
    for row in rows:
        m = _parse_meta(row)
        loc = (m.get("locationName") or "Unknown").strip().title()
        depth = _depth_m(m)
        bt = (m.get("bottomTime") or 0)

        if loc not in loc_data:
            loc_data[loc] = {"depths": [], "bts": [], "dates": []}
        if depth > 0:
            loc_data[loc]["depths"].append(depth)
        if bt > 0:
            loc_data[loc]["bts"].append(bt)
        loc_data[loc]["dates"].append(row["start_time"][:10])

    result = []
    for loc, data in loc_data.items():
        depths = data["depths"]
        bts = data["bts"]
        dates = sorted(data["dates"])
        result.append(LocationStat(
            location=loc,
            session_count=len(dates),
            max_depth_m=round(max(depths), 2) if depths else 0,
            avg_depth_m=round(float(np.mean(depths)), 2) if depths else 0,
            last_session=dates[-1] if dates else "",
            avg_bottom_time_s=round(float(np.mean(bts)), 1) if bts else None,
        ))

    result.sort(key=lambda x: x.session_count, reverse=True)
    return result


# ---------------------------------------------------------------------------
# Surface interval ratio
# ---------------------------------------------------------------------------

async def get_surface_intervals(conn: aiosqlite.Connection, days: int = 90) -> list[SurfaceIntervalEntry]:
    rows = await _fetch_apnea_sessions(conn, days)
    result = []

    for row in rows:
        m = _parse_meta(row)
        bt = (m.get("bottomTime") or 0)
        # surfaceInterval is in milliseconds in Garmin data — convert to seconds
        si_raw = m.get("surfaceInterval") or 0
        si_s = si_raw / 1000 if si_raw > 1000 else si_raw  # handle both ms and s

        if bt <= 0 or si_s <= 0 or si_s > 86400:  # ignore clearly wrong values
            continue

        ratio = si_s / bt
        warning = None
        if ratio < 1.0:
            warning = "danger"
        elif ratio < 2.0:
            warning = "warning"

        result.append(SurfaceIntervalEntry(
            session_id=row["id"],
            date=row["start_time"][:10],
            bottom_time_s=round(bt, 1),
            surface_interval_s=round(si_s, 1),
            ratio=round(ratio, 2),
            warning=warning,
        ))

    return result


# ---------------------------------------------------------------------------
# Monthly stats
# ---------------------------------------------------------------------------

async def get_monthly_stats(conn: aiosqlite.Connection, year: int) -> list[MonthlyStats]:
    since = f"{year}-01-01"
    until = f"{year}-12-31"
    rows = await _fetch_apnea_sessions(conn)
    rows = [r for r in rows if since <= r["start_time"][:10] <= until]

    monthly: dict[str, dict] = {}
    for row in rows:
        m = _parse_meta(row)
        month = row["start_time"][:7]
        if month not in monthly:
            monthly[month] = {"depths": [], "bts": []}
        d = _depth_m(m)
        bt = (m.get("bottomTime") or 0)
        if d > 0:
            monthly[month]["depths"].append(d)
        if bt > 0:
            monthly[month]["bts"].append(bt)

    result = []
    for month in sorted(monthly.keys()):
        data = monthly[month]
        depths = data["depths"]
        bts = data["bts"]
        result.append(MonthlyStats(
            month=month,
            session_count=len(depths),
            max_depth_m=round(max(depths), 2) if depths else 0,
            avg_depth_m=round(float(np.mean(depths)), 2) if depths else 0,
            total_bottom_time_s=round(sum(bts), 1),
        ))
    return result


# ---------------------------------------------------------------------------
# Year in review
# ---------------------------------------------------------------------------

async def get_year_review(conn: aiosqlite.Connection, year: int) -> YearReview:
    monthly = await get_monthly_stats(conn, year)
    pbs = await get_personal_bests(conn)

    total_sessions = sum(m.session_count for m in monthly)
    max_depth = max((m.max_depth_m for m in monthly), default=0)
    total_bt = sum(m.total_bottom_time_s for m in monthly)

    best_month = max(monthly, key=lambda m: m.session_count).month if monthly else ""

    # Check if PB was set this year
    pb_year = pbs.max_depth_date[:4] if pbs.max_depth_date else ""
    pb_set = pb_year == str(year)

    # Locations
    rows = await _fetch_apnea_sessions(conn)
    locs = set()
    total_depth = 0.0
    total_dives = 0
    for row in rows:
        if not row["start_time"].startswith(str(year)):
            continue
        m = _parse_meta(row)
        loc = (m.get("locationName") or "Unknown").strip().title()
        locs.add(loc)
        total_depth += _depth_m(m)
        total_dives += (m.get("diveCount") or 0)

    return YearReview(
        year=year,
        total_sessions=total_sessions,
        total_dives=total_dives,
        max_depth_m=round(max_depth, 2),
        total_bottom_time_s=round(total_bt, 1),
        total_depth_descended_m=round(total_depth, 1),
        pb_set_this_year=pb_set,
        best_month=best_month,
        monthly_breakdown=monthly,
        locations_visited=sorted(locs),
    )


# ---------------------------------------------------------------------------
# Return-to-depth curve
# ---------------------------------------------------------------------------

async def get_return_to_depth(conn: aiosqlite.Connection, days: int = 365) -> list[ReturnToDepthPoint]:
    rows = await _fetch_apnea_sessions(conn)
    if not rows:
        return []

    points = [(row["start_time"][:10], _depth_m(_parse_meta(row)), row["id"]) for row in rows]
    result = []
    block_index = 0

    for i, (session_date, depth, _) in enumerate(points):
        if i == 0:
            block_index = 0
            prev = session_date
            continue

        prev_date = date.fromisoformat(points[i - 1][0])
        curr_date = date.fromisoformat(session_date)
        gap = (curr_date - prev_date).days

        if gap > 5:
            # New return block starts here
            block_index = 0
        else:
            block_index += 1

        result.append(ReturnToDepthPoint(
            date=session_date,
            max_depth_m=depth,
            days_since_last_session=gap,
            session_index_in_block=block_index,
        ))

    # Only return blocks that started after a rest (gap > 5)
    return [r for r in result if r.days_since_last_session > 5]
