import aiosqlite
from fastapi import APIRouter, Depends, Query
from ..database import get_db
from ..deps import verify_api_key
from ..models.health import ReadinessScore
from ..services.readiness_service import get_readiness_today, get_readiness_history

router = APIRouter(prefix="/readiness", tags=["readiness"], dependencies=[Depends(verify_api_key)])


@router.get("/today", response_model=ReadinessScore)
async def readiness_today(conn: aiosqlite.Connection = Depends(get_db)):
    return await get_readiness_today(conn)


@router.get("/history", response_model=list[ReadinessScore])
async def readiness_history(
    days: int = Query(30, ge=1, le=365),
    conn: aiosqlite.Connection = Depends(get_db),
):
    return await get_readiness_history(conn, days)
