"""
Training protocol generation.
Calibrates CO2/O2/Pyramid tables to the user's actual single-dive max bottom time
(maxBottomTime per session), NOT total session bottom time.

Table structures follow real freediving training conventions:
- CO2: constant hold, decreasing rest (starts hard, gets harder)
- O2: increasing hold, constant rest (progressive overload)
- Pyramid: step up then down (warmup → peak → cooldown)
"""
import json
import aiosqlite


def _fmt(s: float) -> str:
    m, sec = int(s) // 60, int(s) % 60
    return f"{m}:{sec:02d}"


def _round15(s: float) -> int:
    """Round to nearest 15-second interval, minimum 15s."""
    return max(15, round(s / 15) * 15)


def _build_co2_sets(hold_s: int, rest_start: int, rest_end: int, cycles: int = 8) -> list[dict]:
    """
    CO2 table: constant hold, rest decreases linearly from rest_start to rest_end.
    Each entry: hold → rest → hold → rest → ...
    """
    sets = []
    if cycles <= 1:
        step = 0
    else:
        step = (rest_start - rest_end) / (cycles - 1)
    for i in range(cycles):
        rest = max(rest_end, _round15(rest_start - step * i))
        sets.append({"hold_s": hold_s, "rest_s": rest})
    return sets


def _build_o2_sets(hold_start: int, hold_end: int, rest_s: int, cycles: int = 8) -> list[dict]:
    """
    O2 table: increasing hold, constant rest.
    Hold steps up from hold_start to hold_end.
    """
    sets = []
    if cycles <= 1:
        step = 0
    else:
        step = (hold_end - hold_start) / (cycles - 1)
    for i in range(cycles):
        hold = _round15(hold_start + step * i)
        sets.append({"hold_s": hold, "rest_s": rest_s})
    return sets


def _build_pyramid_sets(steps: list[int], rest_s: int) -> list[dict]:
    """Pyramid: holds go up then down, constant rest."""
    up = steps
    down = list(reversed(steps[:-1]))  # omit peak from down leg (already counted)
    all_holds = up + down
    return [{"hold_s": h, "rest_s": rest_s} for h in all_holds]


async def build_protocols(conn: aiosqlite.Connection) -> list[dict]:
    async with conn.execute(
        "SELECT metadata FROM activities WHERE activity_type='apnea_diving' "
        "ORDER BY start_time DESC LIMIT 20"
    ) as cur:
        rows = await cur.fetchall()

    # Use maxBottomTime (single-dive max, in seconds) — NOT bottomTime (total session)
    max_dive_times: list[float] = []
    depths: list[float] = []

    for row in rows:
        try:
            m = json.loads(row["metadata"] or "{}")
        except json.JSONDecodeError:
            m = {}
        mbt = m.get("maxBottomTime", 0) or 0   # seconds — longest single dive this session
        depth = (m.get("maxDepth", 0) or 0) / 100  # cm → m
        if mbt > 0:
            max_dive_times.append(float(mbt))
        if depth > 0:
            depths.append(depth)

    # Sensible defaults if no data (beginner level)
    avg_max_bt = 50.0    # avg of per-session max dive times
    overall_max_bt = 70.0  # best single dive ever in recent 20 sessions
    pb_m = 5.0

    if max_dive_times:
        # Filter out sub-30s dives (check dives / warmups skew calibration)
        meaningful = sorted([t for t in max_dive_times if t >= 30], reverse=True)
        if meaningful:
            # Use top-half average as "training baseline"
            top_half = meaningful[: max(1, len(meaningful) // 2)]
            avg_max_bt = sum(top_half) / len(top_half)
        else:
            avg_max_bt = sum(max_dive_times) / len(max_dive_times)
        overall_max_bt = max(max_dive_times)
    if depths:
        pb_m = max(depths)

    # ── CO2 table ──────────────────────────────────────────────────────────────
    # Hold at ~65% of avg max dive time (comfortable but challenging)
    # Rest starts at 2× hold, drops to 1× hold over 8 sets
    co2_hold = _round15(avg_max_bt * 0.65)
    co2_rest_start = _round15(co2_hold * 2.0)
    co2_rest_end = _round15(co2_hold * 1.0)
    co2_sets = _build_co2_sets(co2_hold, co2_rest_start, co2_rest_end, cycles=8)
    co2_cycles = len(co2_sets)

    # ── O2 table ───────────────────────────────────────────────────────────────
    # Starts at 50% of overall max, peaks at 85%
    # Rest is constant at 2× peak hold
    o2_hold_start = _round15(overall_max_bt * 0.50)
    o2_hold_peak = _round15(overall_max_bt * 0.85)
    o2_rest = _round15(o2_hold_peak * 2.0)
    o2_sets = _build_o2_sets(o2_hold_start, o2_hold_peak, o2_rest, cycles=8)
    o2_cycles = len(o2_sets)

    # ── Pyramid ────────────────────────────────────────────────────────────────
    # Steps from 40% → 80% of max in 5 increments, then back down (9 sets total)
    pct_steps = [0.40, 0.50, 0.60, 0.70, 0.80]
    pyr_steps = [_round15(overall_max_bt * p) for p in pct_steps]
    pyr_rest = _round15(pyr_steps[-1] * 2.0)
    pyr_sets = _build_pyramid_sets(pyr_steps, pyr_rest)
    pyr_cycles = len(pyr_sets)

    return [
        {
            "key": "co2",
            "type": "CO₂ Tolerance",
            "name": f"CO2 TABLE · {_fmt(co2_hold)} hold",
            "desc": f"{co2_cycles} sets · constant {_fmt(co2_hold)} hold · rest {_fmt(co2_rest_start)}→{_fmt(co2_rest_end)}",
            "detail": (
                f"Hold constant at {_fmt(co2_hold)} each set. "
                f"Rest drops from {_fmt(co2_rest_start)} to {_fmt(co2_rest_end)}, "
                f"building CO₂ tolerance. Based on your avg max dive time ({_fmt(avg_max_bt)})."
            ),
            "cycles": co2_cycles,
            "hold_s": co2_hold,
            "rest_s": co2_rest_start,
            "rest_end_s": co2_rest_end,
            "hold_fmt": _fmt(co2_hold),
            "rest_fmt": f"{_fmt(co2_rest_start)}→{_fmt(co2_rest_end)}",
            "sets": co2_sets,
            "color": "#00F0FF",
            "recommended": True,
            "progress_pct": min(100, int(avg_max_bt / 120 * 100)),
        },
        {
            "key": "o2",
            "type": "O₂ Adaptation",
            "name": f"O2 TABLE · {_fmt(o2_hold_peak)} peak",
            "desc": f"{o2_cycles} sets · hold {_fmt(o2_hold_start)}→{_fmt(o2_hold_peak)} · rest {_fmt(o2_rest)}",
            "detail": (
                f"Progressive holds from {_fmt(o2_hold_start)} to {_fmt(o2_hold_peak)}. "
                f"Fixed rest {_fmt(o2_rest)}. "
                f"Based on your best single dive ({_fmt(overall_max_bt)})."
            ),
            "cycles": o2_cycles,
            "hold_s": o2_hold_peak,
            "rest_s": o2_rest,
            "hold_fmt": f"{_fmt(o2_hold_start)}→{_fmt(o2_hold_peak)}",
            "rest_fmt": _fmt(o2_rest),
            "sets": o2_sets,
            "color": "#65afff",
            "recommended": False,
            "progress_pct": min(100, int(overall_max_bt / 180 * 100)),
        },
        {
            "key": "pyramid",
            "type": "Pyramid",
            "name": f"PYRAMID · {_fmt(pyr_steps[-1])} peak",
            "desc": f"{pyr_cycles} sets · up {_fmt(pyr_steps[0])}→{_fmt(pyr_steps[-1])} then down",
            "detail": (
                f"Warmup to peak {_fmt(pyr_steps[-1])}, then mirror back down. "
                f"Rest {_fmt(pyr_rest)} throughout. "
                f"Based on your best dive ({_fmt(overall_max_bt)})."
            ),
            "cycles": pyr_cycles,
            "hold_s": pyr_steps[-1],
            "rest_s": pyr_rest,
            "hold_fmt": f"{_fmt(pyr_steps[0])}→{_fmt(pyr_steps[-1])}",
            "rest_fmt": _fmt(pyr_rest),
            "sets": pyr_sets,
            "color": "#ff716c",
            "recommended": False,
            "progress_pct": min(100, int(overall_max_bt / 180 * 100)),
        },
    ]
