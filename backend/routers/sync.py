import aiosqlite
from fastapi import APIRouter, Depends
from ..database import get_db
from ..deps import verify_api_key

router = APIRouter(prefix="/sync", tags=["sync"], dependencies=[Depends(verify_api_key)])


@router.post("/trigger")
async def trigger_sync(conn: aiosqlite.Connection = Depends(get_db)):
    """Garmin Connect sync is no longer available (auth library discontinued).
    Data is sourced from the local garmin.db export. Run the migration script
    to import newly downloaded exports."""
    return {
        "status": "disabled",
        "message": "Garmin Connect API sync is unavailable. Use the garmin.db export workflow.",
    }


@router.get("/status")
async def sync_status(conn: aiosqlite.Connection = Depends(get_db)):
    """Return the timestamp of the most recent sync."""
    async with conn.execute(
        "SELECT MAX(synced_at) as last_sync FROM health_metrics"
    ) as cur:
        row = await cur.fetchone()
    async with conn.execute(
        "SELECT COUNT(*) as total FROM activities WHERE activity_type='apnea_diving'"
    ) as cur:
        count_row = await cur.fetchone()
    return {
        "last_sync": row["last_sync"] if row else None,
        "total_sessions": count_row["total"] if count_row else 0,
    }
