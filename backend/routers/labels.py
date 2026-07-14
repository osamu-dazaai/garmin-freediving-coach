"""
Discipline label management — manual overrides + guest diver training data.

Routes:
  PUT    /sessions/{session_id}/dives/{dive_number}/label
  DELETE /sessions/{session_id}/dives/{dive_number}/label
  GET    /guest-divers
  POST   /guest-divers
  DELETE /guest-divers/{diver_id}
  GET    /guest-divers/{diver_id}/dives
  POST   /guest-divers/{diver_id}/dives
  DELETE /guest-divers/{diver_id}/dives/{dive_id}
  GET    /training-data/export
"""

import json
from typing import Literal, Optional
import aiosqlite
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..database import get_db
from ..deps import verify_api_key

router = APIRouter(tags=["labels"], dependencies=[Depends(verify_api_key)])

Discipline = Literal["CWT", "FIM", "CNF", "WARMUP", "STA"]


# ── Request / response models ─────────────────────────────────────────────────

class LabelUpsert(BaseModel):
    discipline: Discipline
    notes: Optional[str] = None


class LabelResponse(BaseModel):
    activity_id: int
    dive_number: int
    discipline: str
    notes: Optional[str] = None


class GuestDiverCreate(BaseModel):
    id: str           # url-safe slug
    display_name: str
    notes: Optional[str] = None


class GuestDiverResponse(BaseModel):
    id: str
    display_name: str
    notes: Optional[str] = None
    dive_count: int = 0


class GuestDiveCreate(BaseModel):
    dive_number: Optional[int] = None
    discipline: Optional[Discipline] = None
    max_depth_m: float
    bottom_time_s: Optional[float] = None
    descent_time_s: Optional[float] = None
    ascent_time_s: Optional[float] = None
    depth_profile: Optional[list] = None   # [[t_s, depth_m], ...]
    notes: Optional[str] = None


class GuestDiveResponse(BaseModel):
    id: int
    diver_id: str
    session_file: Optional[str] = None
    dive_number: Optional[int] = None
    discipline: Optional[Discipline] = None
    max_depth_m: float
    bottom_time_s: Optional[float] = None
    descent_time_s: Optional[float] = None
    ascent_time_s: Optional[float] = None
    surface_interval_s: Optional[float] = None
    water_temp_c: Optional[float] = None
    depth_profile: Optional[list] = None
    hr_profile: Optional[list] = None
    notes: Optional[str] = None


# ── Personal dive labels ──────────────────────────────────────────────────────

@router.put("/sessions/{session_id}/dives/{dive_number}/label", response_model=LabelResponse)
async def upsert_label(
    session_id: int,
    dive_number: int,
    body: LabelUpsert,
    conn: aiosqlite.Connection = Depends(get_db),
):
    async with conn.execute("SELECT id FROM activities WHERE id = ?", (session_id,)) as cur:
        if not await cur.fetchone():
            raise HTTPException(status_code=404, detail="Session not found")

    async with conn.execute(
        "SELECT max_depth, bottom_time, total_time, ascent_rate, dive_details "
        "FROM dive_sessions WHERE activity_id = ? AND dive_number = ?",
        (session_id, dive_number),
    ) as cur:
        ds = await cur.fetchone()

    depth_profile = None
    descent_time_s = None
    ascent_time_s = None
    if ds:
        try:
            extra = json.loads(ds["dive_details"] or "{}")
            depth_profile = json.dumps(extra.get("depth_profile")) if extra.get("depth_profile") else None
            descent_time_s = extra.get("descent_time_s")
            ascent_time_s = extra.get("ascent_time_s")
        except (json.JSONDecodeError, TypeError):
            pass

    await conn.execute(
        """
        INSERT INTO dive_labels
          (activity_id, dive_number, discipline, notes,
           max_depth_m, bottom_time_s, descent_time_s, ascent_time_s,
           depth_profile, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(activity_id, dive_number) DO UPDATE SET
          discipline     = excluded.discipline,
          notes          = excluded.notes,
          max_depth_m    = excluded.max_depth_m,
          bottom_time_s  = excluded.bottom_time_s,
          descent_time_s = excluded.descent_time_s,
          ascent_time_s  = excluded.ascent_time_s,
          depth_profile  = excluded.depth_profile,
          updated_at     = CURRENT_TIMESTAMP
        """,
        (
            session_id, dive_number, body.discipline, body.notes,
            ds["max_depth"] if ds else None,
            ds["bottom_time"] if ds else None,
            descent_time_s,
            ascent_time_s,
            depth_profile,
        ),
    )
    await conn.commit()
    return LabelResponse(activity_id=session_id, dive_number=dive_number,
                         discipline=body.discipline, notes=body.notes)


@router.delete("/sessions/{session_id}/dives/{dive_number}/label", status_code=204)
async def delete_label(
    session_id: int,
    dive_number: int,
    conn: aiosqlite.Connection = Depends(get_db),
):
    await conn.execute(
        "DELETE FROM dive_labels WHERE activity_id = ? AND dive_number = ?",
        (session_id, dive_number),
    )
    await conn.commit()


# ── Guest divers ──────────────────────────────────────────────────────────────

@router.get("/guest-divers", response_model=list[GuestDiverResponse])
async def list_guest_divers(conn: aiosqlite.Connection = Depends(get_db)):
    async with conn.execute(
        """
        SELECT g.id, g.display_name, g.notes,
               COUNT(d.id) as dive_count
        FROM guest_divers g
        LEFT JOIN guest_dives d ON d.diver_id = g.id
        GROUP BY g.id ORDER BY g.display_name
        """
    ) as cur:
        rows = await cur.fetchall()
    return [GuestDiverResponse(**dict(r)) for r in rows]


@router.post("/guest-divers", response_model=GuestDiverResponse, status_code=201)
async def create_guest_diver(
    body: GuestDiverCreate,
    conn: aiosqlite.Connection = Depends(get_db),
):
    try:
        await conn.execute(
            "INSERT INTO guest_divers (id, display_name, notes) VALUES (?, ?, ?)",
            (body.id, body.display_name, body.notes),
        )
        await conn.commit()
    except aiosqlite.IntegrityError:
        raise HTTPException(status_code=409, detail=f"Diver '{body.id}' already exists")
    return GuestDiverResponse(id=body.id, display_name=body.display_name,
                              notes=body.notes, dive_count=0)


@router.delete("/guest-divers/{diver_id}", status_code=204)
async def delete_guest_diver(
    diver_id: str,
    conn: aiosqlite.Connection = Depends(get_db),
):
    await conn.execute("DELETE FROM guest_divers WHERE id = ?", (diver_id,))
    await conn.commit()


@router.get("/guest-divers/{diver_id}/dives", response_model=list[GuestDiveResponse])
async def list_guest_dives(
    diver_id: str,
    conn: aiosqlite.Connection = Depends(get_db),
):
    async with conn.execute(
        "SELECT * FROM guest_dives WHERE diver_id = ? ORDER BY session_file, dive_number, id",
        (diver_id,),
    ) as cur:
        rows = await cur.fetchall()
    return [
        GuestDiveResponse(
            id=r["id"], diver_id=r["diver_id"],
            session_file=r["session_file"], dive_number=r["dive_number"],
            discipline=r["discipline"], max_depth_m=r["max_depth_m"],
            bottom_time_s=r["bottom_time_s"], descent_time_s=r["descent_time_s"],
            ascent_time_s=r["ascent_time_s"],
            surface_interval_s=r["surface_interval_s"],
            water_temp_c=r["water_temp_c"],
            depth_profile=json.loads(r["depth_profile"]) if r["depth_profile"] else None,
            hr_profile=json.loads(r["hr_profile"]) if r["hr_profile"] else None,
            notes=r["notes"],
        )
        for r in rows
    ]


@router.post("/guest-divers/{diver_id}/dives", response_model=GuestDiveResponse, status_code=201)
async def add_guest_dive(
    diver_id: str,
    body: GuestDiveCreate,
    conn: aiosqlite.Connection = Depends(get_db),
):
    async with conn.execute("SELECT id FROM guest_divers WHERE id = ?", (diver_id,)) as cur:
        if not await cur.fetchone():
            raise HTTPException(status_code=404, detail="Diver not found")

    async with conn.execute(
        """
        INSERT INTO guest_dives
          (diver_id, dive_number, discipline, max_depth_m,
           bottom_time_s, descent_time_s, ascent_time_s, depth_profile, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            diver_id, body.dive_number, body.discipline, body.max_depth_m,
            body.bottom_time_s, body.descent_time_s, body.ascent_time_s,
            json.dumps(body.depth_profile) if body.depth_profile else None,
            body.notes,
        ),
    ) as cur:
        new_id = cur.lastrowid
    await conn.commit()

    return GuestDiveResponse(id=new_id, diver_id=diver_id, **body.model_dump())


@router.delete("/guest-divers/{diver_id}/dives/{dive_id}", status_code=204)
async def delete_guest_dive(
    diver_id: str,
    dive_id: int,
    conn: aiosqlite.Connection = Depends(get_db),
):
    await conn.execute(
        "DELETE FROM guest_dives WHERE id = ? AND diver_id = ?",
        (dive_id, diver_id),
    )
    await conn.commit()


@router.patch("/guest-divers/{diver_id}/dives/{dive_id}/label", status_code=204)
async def label_guest_dive(
    diver_id: str,
    dive_id: int,
    body: LabelUpsert,
    conn: aiosqlite.Connection = Depends(get_db),
):
    await conn.execute(
        "UPDATE guest_dives SET discipline = ? WHERE id = ? AND diver_id = ?",
        (body.discipline, dive_id, diver_id),
    )
    await conn.commit()


@router.delete("/guest-divers/{diver_id}/dives/{dive_id}/label", status_code=204)
async def unlabel_guest_dive(
    diver_id: str,
    dive_id: int,
    conn: aiosqlite.Connection = Depends(get_db),
):
    await conn.execute(
        "UPDATE guest_dives SET discipline = NULL WHERE id = ? AND diver_id = ?",
        (dive_id, diver_id),
    )
    await conn.commit()


# ── ML training data export ───────────────────────────────────────────────────

@router.get("/training-data/export")
async def export_training_data(conn: aiosqlite.Connection = Depends(get_db)):
    """Export all labeled dives (personal + guest) for ML training."""
    async with conn.execute(
        """
        SELECT dl.discipline, dl.max_depth_m, dl.bottom_time_s,
               dl.descent_time_s, dl.ascent_time_s, dl.depth_profile,
               'self' as diver_id
        FROM dive_labels dl
        WHERE dl.discipline IS NOT NULL
        """
    ) as cur:
        personal = await cur.fetchall()

    async with conn.execute(
        """
        SELECT gd.discipline, gd.max_depth_m, gd.bottom_time_s,
               gd.descent_time_s, gd.ascent_time_s, gd.depth_profile,
               gd.diver_id
        FROM guest_dives gd
        WHERE gd.discipline IS NOT NULL
        """
    ) as cur:
        guest = await cur.fetchall()

    def _row(r, source: str) -> dict:
        profile = None
        try:
            profile = json.loads(r["depth_profile"]) if r["depth_profile"] else None
        except (json.JSONDecodeError, TypeError):
            pass
        return {
            "discipline":    r["discipline"],
            "max_depth_m":   r["max_depth_m"],
            "bottom_time_s": r["bottom_time_s"],
            "descent_time_s": r["descent_time_s"],
            "ascent_time_s": r["ascent_time_s"],
            "depth_profile": profile,
            "source":        source,
            "diver_id":      r["diver_id"],
        }

    return {
        "total": len(personal) + len(guest),
        "personal": len(personal),
        "guest": len(guest),
        "data": [_row(r, "personal") for r in personal] + [_row(r, "guest") for r in guest],
    }
