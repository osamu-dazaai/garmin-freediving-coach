import aiosqlite
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from ..database import get_db
from ..deps import verify_api_key
from ..models.goal import Goal, GoalCreate, GoalUpdate

router = APIRouter(prefix="/goals", tags=["goals"], dependencies=[Depends(verify_api_key)])


def _row_to_goal(row) -> Goal:
    progress = min(100.0, round(row["current_value"] / row["target_value"] * 100, 1)) if row["target_value"] else 0
    return Goal(
        id=row["id"],
        goal_type=row["goal_type"],
        title=row["title"],
        target_value=row["target_value"],
        current_value=row["current_value"],
        target_date=row["target_date"],
        achieved=bool(row["achieved"]),
        achieved_at=row["achieved_at"],
        notes=row["notes"],
        created_at=row["created_at"],
        progress_pct=progress,
    )


@router.get("", response_model=list[Goal])
async def list_goals(conn: aiosqlite.Connection = Depends(get_db)):
    async with conn.execute("SELECT * FROM goals ORDER BY created_at DESC") as cur:
        rows = await cur.fetchall()
    return [_row_to_goal(r) for r in rows]


@router.post("", response_model=Goal, status_code=201)
async def create_goal(body: GoalCreate, conn: aiosqlite.Connection = Depends(get_db)):
    async with conn.execute(
        "INSERT INTO goals (goal_type, title, target_value, target_date, notes) VALUES (?,?,?,?,?)",
        (body.goal_type, body.title, body.target_value, body.target_date, body.notes),
    ) as cur:
        row_id = cur.lastrowid
    await conn.commit()
    async with conn.execute("SELECT * FROM goals WHERE id = ?", (row_id,)) as cur:
        row = await cur.fetchone()
    return _row_to_goal(row)


@router.patch("/{goal_id}", response_model=Goal)
async def update_goal(goal_id: int, body: GoalUpdate, conn: aiosqlite.Connection = Depends(get_db)):
    async with conn.execute("SELECT * FROM goals WHERE id = ?", (goal_id,)) as cur:
        row = await cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Goal not found")

    updates = {k: v for k, v in body.model_dump(exclude_none=True).items()}
    if not updates:
        return _row_to_goal(row)

    # Auto-achieve if current_value reaches target
    current = updates.get("current_value", row["current_value"])
    target = updates.get("target_value", row["target_value"])
    if current >= target and not row["achieved"]:
        updates["achieved"] = True
        updates["achieved_at"] = datetime.utcnow().isoformat()

    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [goal_id]
    await conn.execute(f"UPDATE goals SET {set_clause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?", values)
    await conn.commit()

    async with conn.execute("SELECT * FROM goals WHERE id = ?", (goal_id,)) as cur:
        updated = await cur.fetchone()
    return _row_to_goal(updated)


@router.delete("/{goal_id}", status_code=204)
async def delete_goal(goal_id: int, conn: aiosqlite.Connection = Depends(get_db)):
    async with conn.execute("SELECT id FROM goals WHERE id = ?", (goal_id,)) as cur:
        row = await cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Goal not found")
    await conn.execute("DELETE FROM goals WHERE id = ?", (goal_id,))
    await conn.commit()
