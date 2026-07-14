import aiosqlite
from fastapi import APIRouter, Depends, Query
from ..database import get_db
from ..deps import verify_api_key
from ..models.analytics import (
    DepthPoint, WorkingDepth, PlateauStatus, TrainingPhase,
    LocationStat, PersonalBests, SurfaceIntervalEntry,
    MonthlyStats, YearReview, ReturnToDepthPoint,
)
from ..services import analytics_service as svc
from datetime import date

router = APIRouter(prefix="/analytics", tags=["analytics"], dependencies=[Depends(verify_api_key)])


@router.get("/depth-progression", response_model=list[DepthPoint])
async def depth_progression(
    days: int = Query(365, ge=30, le=1095),
    conn: aiosqlite.Connection = Depends(get_db),
):
    return await svc.get_depth_progression(conn, days)


@router.get("/working-depth", response_model=WorkingDepth)
async def working_depth(
    window_days: int = Query(90, ge=30, le=365),
    conn: aiosqlite.Connection = Depends(get_db),
):
    return await svc.get_working_depth(conn, window_days)


@router.get("/plateau-detection", response_model=PlateauStatus)
async def plateau_detection(conn: aiosqlite.Connection = Depends(get_db)):
    return await svc.get_plateau_status(conn)


@router.get("/training-phase", response_model=TrainingPhase)
async def training_phase(conn: aiosqlite.Connection = Depends(get_db)):
    return await svc.get_training_phase(conn)


@router.get("/personal-bests", response_model=PersonalBests)
async def personal_bests(
    since: str | None = Query(None, description="ISO date e.g. 2025-10-01"),
    until: str | None = Query(None, description="ISO date e.g. 2026-03-21"),
    conn: aiosqlite.Connection = Depends(get_db),
):
    return await svc.get_personal_bests(conn, since=since, until=until)


@router.get("/location-performance", response_model=list[LocationStat])
async def location_performance(conn: aiosqlite.Connection = Depends(get_db)):
    return await svc.get_location_performance(conn)


@router.get("/surface-intervals", response_model=list[SurfaceIntervalEntry])
async def surface_intervals(
    days: int = Query(90, ge=7, le=365),
    conn: aiosqlite.Connection = Depends(get_db),
):
    return await svc.get_surface_intervals(conn, days)


@router.get("/monthly-stats", response_model=list[MonthlyStats])
async def monthly_stats(
    year: int = Query(default=None),
    conn: aiosqlite.Connection = Depends(get_db),
):
    if year is None:
        year = date.today().year
    return await svc.get_monthly_stats(conn, year)


@router.get("/year-review", response_model=YearReview)
async def year_review(
    year: int = Query(default=None),
    conn: aiosqlite.Connection = Depends(get_db),
):
    if year is None:
        year = date.today().year - 1
    return await svc.get_year_review(conn, year)


@router.get("/return-to-depth", response_model=list[ReturnToDepthPoint])
async def return_to_depth(
    days: int = Query(365, ge=30, le=1095),
    conn: aiosqlite.Connection = Depends(get_db),
):
    return await svc.get_return_to_depth(conn, days)
