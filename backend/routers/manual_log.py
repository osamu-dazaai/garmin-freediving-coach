import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, Query
from ..database import get_db
from ..deps import verify_api_key
from ..models.manual_log import ManualLogEntry, ManualLogCreate, ManualLogUpdate

router = APIRouter(prefix="/manual-log", tags=["manual_log"], dependencies=[Depends(verify_api_key)])


def _row_to_entry(row) -> ManualLogEntry:
    return ManualLogEntry(
        id=row["id"],
        entry_date=row["entry_date"],
        dive_type=row["dive_type"],
        max_depth=row["max_depth"],
        bottom_time=row["bottom_time"],
        equalization_depth=row["equalization_depth"],
        eq_technique=row["eq_technique"],
        notes=row["notes"],
        location=row["location"],
        activity_id=row["activity_id"],
        created_at=row["created_at"],
    )


@router.get("", response_model=list[ManualLogEntry])
async def list_entries(
    days: int = Query(30, ge=1, le=365),
    conn: aiosqlite.Connection = Depends(get_db),
):
    async with conn.execute(
        "SELECT * FROM manual_log_entries WHERE entry_date >= date('now', ? || ' days') "
        "ORDER BY entry_date DESC",
        (f"-{days}",),
    ) as cur:
        rows = await cur.fetchall()
    return [_row_to_entry(r) for r in rows]


@router.post("", response_model=ManualLogEntry, status_code=201)
async def create_entry(body: ManualLogCreate, conn: aiosqlite.Connection = Depends(get_db)):
    async with conn.execute(
        "INSERT INTO manual_log_entries "
        "(entry_date, dive_type, max_depth, bottom_time, equalization_depth, eq_technique, notes, location, activity_id) "
        "VALUES (?,?,?,?,?,?,?,?,?)",
        (body.entry_date, body.dive_type, body.max_depth, body.bottom_time,
         body.equalization_depth, body.eq_technique, body.notes, body.location, body.activity_id),
    ) as cur:
        row_id = cur.lastrowid
    await conn.commit()
    async with conn.execute("SELECT * FROM manual_log_entries WHERE id = ?", (row_id,)) as cur:
        row = await cur.fetchone()
    return _row_to_entry(row)


@router.patch("/{entry_id}", response_model=ManualLogEntry)
async def update_entry(entry_id: int, body: ManualLogUpdate, conn: aiosqlite.Connection = Depends(get_db)):
    async with conn.execute("SELECT * FROM manual_log_entries WHERE id = ?", (entry_id,)) as cur:
        row = await cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Entry not found")

    updates = {k: v for k, v in body.model_dump(exclude_none=True).items()}
    if not updates:
        return _row_to_entry(row)

    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [entry_id]
    await conn.execute(f"UPDATE manual_log_entries SET {set_clause} WHERE id = ?", values)
    await conn.commit()

    async with conn.execute("SELECT * FROM manual_log_entries WHERE id = ?", (entry_id,)) as cur:
        updated = await cur.fetchone()
    return _row_to_entry(updated)


@router.delete("/{entry_id}", status_code=204)
async def delete_entry(entry_id: int, conn: aiosqlite.Connection = Depends(get_db)):
    async with conn.execute("SELECT id FROM manual_log_entries WHERE id = ?", (entry_id,)) as cur:
        row = await cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Entry not found")
    await conn.execute("DELETE FROM manual_log_entries WHERE id = ?", (entry_id,))
    await conn.commit()
