import json
import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, Query
from ..database import get_db
from ..deps import verify_api_key
from ..models.session import Session, SessionUpdate

router = APIRouter(prefix="/sessions", tags=["sessions"], dependencies=[Depends(verify_api_key)])


async def _get_pb_depth(conn: aiosqlite.Connection) -> float:
    async with conn.execute(
        "SELECT MAX(json_extract(metadata,'$.maxDepth')) FROM activities WHERE activity_type='apnea_diving'"
    ) as cur:
        row = await cur.fetchone()
    return round((row[0] or 0) / 100, 2)


@router.get("", response_model=list[Session])
async def list_sessions(
    limit: int = Query(20, ge=1, le=200),
    offset: int = Query(0, ge=0),
    filter: str = Query("all"),
    conn: aiosqlite.Connection = Depends(get_db),
):
    where = "activity_type='apnea_diving'"
    params: list = []

    if filter == "deep":
        where += " AND json_extract(metadata,'$.maxDepth') > 500"  # > 5m
    elif filter == "month":
        where += " AND start_time >= date('now','-30 days')"
    elif filter == "3months":
        where += " AND start_time >= date('now','-90 days')"

    sql = f"SELECT * FROM activities WHERE {where} ORDER BY start_time DESC LIMIT ? OFFSET ?"
    params.extend([limit, offset])

    async with conn.execute(sql, params) as cur:
        rows = await cur.fetchall()

    pb_depth = await _get_pb_depth(conn)
    return [Session.from_row(r, pb_depth) for r in rows]


@router.get("/{session_id}", response_model=Session)
async def get_session(session_id: int, conn: aiosqlite.Connection = Depends(get_db)):
    async with conn.execute(
        "SELECT * FROM activities WHERE id = ?", (session_id,)
    ) as cur:
        row = await cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Session not found")
    pb_depth = await _get_pb_depth(conn)
    return Session.from_row(row, pb_depth)


@router.patch("/{session_id}", response_model=Session)
async def update_session(
    session_id: int,
    body: SessionUpdate,
    conn: aiosqlite.Connection = Depends(get_db),
):
    async with conn.execute("SELECT * FROM activities WHERE id = ?", (session_id,)) as cur:
        row = await cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Session not found")

    if body.location_name is not None:
        try:
            meta = json.loads(row["metadata"] or "{}")
        except json.JSONDecodeError:
            meta = {}
        meta["locationName"] = body.location_name
        await conn.execute(
            "UPDATE activities SET metadata = ? WHERE id = ?",
            (json.dumps(meta), session_id),
        )
        await conn.commit()

    async with conn.execute("SELECT * FROM activities WHERE id = ?", (session_id,)) as cur:
        updated = await cur.fetchone()
    pb_depth = await _get_pb_depth(conn)
    return Session.from_row(updated, pb_depth)
