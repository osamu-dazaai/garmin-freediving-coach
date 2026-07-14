"""
Readiness score computation — ported directly from dashboard/app.py calc_readiness().
Weights: HRV 40% | Sleep 30% | Body Battery 20% | Stress 10%
"""
import aiosqlite
from datetime import date, timedelta
from ..models.health import ReadinessScore


def _safe(v) -> float | None:
    try:
        f = float(v)
        return f if f == f else None  # NaN check
    except (TypeError, ValueError):
        return None


def compute_score(hrv: float | None, sleep: float | None, bb: float | None, stress: float | None) -> int:
    score = 0.0
    score += (min(100.0, hrv / 80 * 100) if hrv else 60.0) * 0.4
    score += (sleep if sleep else 65.0) * 0.3
    score += (bb if bb else 70.0) * 0.2
    score += (max(0.0, 100 - stress) if stress else 65.0) * 0.1
    return round(score)


def score_level(score: int) -> str:
    if score >= 80:
        return "OPTIMAL"
    if score >= 60:
        return "MODERATE"
    return "LOW"


async def get_readiness_today(conn: aiosqlite.Connection) -> ReadinessScore:
    today = date.today().isoformat()
    # Try today, fall back to yesterday
    for delta in (0, 1, 2):
        d = (date.today() - timedelta(days=delta)).isoformat()
        async with conn.execute(
            "SELECT date, hrv_avg, sleep_score, body_battery_charged, stress_avg "
            "FROM health_metrics WHERE date = ?",
            (d,),
        ) as cur:
            row = await cur.fetchone()
        if row:
            break

    if not row:
        score = compute_score(None, None, None, None)
        return ReadinessScore(
            date=today,
            score=score,
            level=score_level(score),
            components={"hrv": 60.0, "sleep": 65.0, "body_battery": 70.0, "stress": 65.0},
        )

    hrv = _safe(row["hrv_avg"])
    sleep = _safe(row["sleep_score"])
    bb = _safe(row["body_battery_charged"])
    stress = _safe(row["stress_avg"])
    score = compute_score(hrv, sleep, bb, stress)

    return ReadinessScore(
        date=row["date"],
        score=score,
        level=score_level(score),
        hrv_avg=hrv,
        sleep_score=sleep,
        body_battery=bb,
        stress_avg=stress,
        components={
            "hrv": (min(100.0, hrv / 80 * 100) if hrv else 60.0) * 0.4,
            "sleep": (sleep if sleep else 65.0) * 0.3,
            "body_battery": (bb if bb else 70.0) * 0.2,
            "stress": (max(0.0, 100 - stress) if stress else 65.0) * 0.1,
        },
    )


async def get_readiness_history(conn: aiosqlite.Connection, days: int = 30) -> list[ReadinessScore]:
    since = (date.today() - timedelta(days=days)).isoformat()
    async with conn.execute(
        "SELECT date, hrv_avg, sleep_score, body_battery_charged, stress_avg "
        "FROM health_metrics WHERE date >= ? ORDER BY date DESC",
        (since,),
    ) as cur:
        rows = await cur.fetchall()

    results = []
    for row in rows:
        hrv = _safe(row["hrv_avg"])
        sleep = _safe(row["sleep_score"])
        bb = _safe(row["body_battery_charged"])
        stress = _safe(row["stress_avg"])
        score = compute_score(hrv, sleep, bb, stress)
        results.append(
            ReadinessScore(
                date=row["date"],
                score=score,
                level=score_level(score),
                hrv_avg=hrv,
                sleep_score=sleep,
                body_battery=bb,
                stress_avg=stress,
                components={},
            )
        )
    return results
