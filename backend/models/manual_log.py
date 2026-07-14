from pydantic import BaseModel
from typing import Literal

DiveType = Literal["warmup", "working", "pb", "frc", "static", "dynamic"]
EqTechnique = Literal["frenzel", "mouthfill", "valsalva"]


class ManualLogCreate(BaseModel):
    entry_date: str
    dive_type: DiveType
    max_depth: float | None = None
    bottom_time: int | None = None
    equalization_depth: float | None = None
    eq_technique: EqTechnique | None = None
    notes: str | None = None
    location: str | None = None
    activity_id: int | None = None


class ManualLogUpdate(BaseModel):
    dive_type: DiveType | None = None
    max_depth: float | None = None
    bottom_time: int | None = None
    equalization_depth: float | None = None
    eq_technique: EqTechnique | None = None
    notes: str | None = None


class ManualLogEntry(BaseModel):
    id: int
    entry_date: str
    dive_type: DiveType
    max_depth: float | None
    bottom_time: int | None
    equalization_depth: float | None
    eq_technique: EqTechnique | None
    notes: str | None
    location: str | None
    activity_id: int | None
    created_at: str
