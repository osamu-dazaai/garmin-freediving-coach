import aiosqlite
from fastapi import APIRouter, Depends, Query
from ..database import get_db
from ..deps import verify_api_key
from ..models.health import HealthMetric

router = APIRouter(prefix="/health-metrics", tags=["health"], dependencies=[Depends(verify_api_key)])


def _row_to_metric(row) -> HealthMetric:
    return HealthMetric(
        date=row["date"],
        resting_hr=row["resting_hr"],
        hrv_avg=row["hrv_avg"],
        hrv_status=row["hrv_status"],
        sleep_score=row["sleep_score"],
        sleep_duration=row["sleep_duration"],
        sleep_deep=row["sleep_deep"],
        sleep_rem=row["sleep_rem"],
        body_battery_charged=row["body_battery_charged"],
        body_battery_drained=row["body_battery_drained"],
        stress_avg=row["stress_avg"],
        spo2_avg=row["spo2_avg"],
    )


@router.get("", response_model=list[HealthMetric])
async def list_health_metrics(
    days: int = Query(30, ge=1, le=1095),
    conn: aiosqlite.Connection = Depends(get_db),
):
    async with conn.execute(
        "SELECT * FROM health_metrics WHERE date >= date('now', ? || ' days') "
        "ORDER BY date DESC",
        (f"-{days}",),
    ) as cur:
        rows = await cur.fetchall()
    return [_row_to_metric(r) for r in rows]


@router.get("/latest", response_model=HealthMetric | None)
async def get_latest_health(conn: aiosqlite.Connection = Depends(get_db)):
    async with conn.execute(
        "SELECT * FROM health_metrics WHERE resting_hr IS NOT NULL ORDER BY date DESC LIMIT 1"
    ) as cur:
        row = await cur.fetchone()
    return _row_to_metric(row) if row else None
