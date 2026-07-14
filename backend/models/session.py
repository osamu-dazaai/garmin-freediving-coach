from __future__ import annotations
import json
from datetime import datetime
from pydantic import BaseModel, field_validator, model_validator
from typing import Any


class SessionMeta(BaseModel):
    """Parsed fields from the Garmin activity metadata JSON column."""
    max_depth_m: float = 0.0
    avg_depth_m: float = 0.0
    dive_count: int | None = None
    bottom_time_s: float | None = None
    max_bottom_time_s: float | None = None
    surface_interval_ms: float | None = None
    location_name: str = "Unknown"
    water_temp_c: float | None = None

    @classmethod
    def from_raw(cls, raw: dict) -> "SessionMeta":
        return cls(
            max_depth_m=round((raw.get("maxDepth") or 0) / 100, 2),
            avg_depth_m=round((raw.get("avgDepth") or 0) / 100, 2),
            dive_count=raw.get("diveCount"),
            bottom_time_s=raw.get("bottomTime"),
            max_bottom_time_s=raw.get("maxBottomTime"),
            surface_interval_ms=raw.get("surfaceInterval"),
            location_name=raw.get("locationName") or "Unknown",
            water_temp_c=raw.get("minTemperature"),
        )


class Session(BaseModel):
    id: int
    garmin_activity_id: int | None = None
    activity_type: str
    start_time: str
    duration_s: float | None = None
    calories: float | None = None
    avg_hr: float | None = None
    max_hr: float | None = None
    distance: float | None = None
    dive: SessionMeta
    is_pb: bool = False

    @classmethod
    def from_row(cls, row: Any, pb_depth: float = 0.0) -> "Session":
        try:
            raw_meta = json.loads(row["metadata"]) if row["metadata"] else {}
        except (json.JSONDecodeError, TypeError):
            raw_meta = {}
        dive = SessionMeta.from_raw(raw_meta)
        return cls(
            id=row["id"],
            garmin_activity_id=row["garmin_activity_id"],
            activity_type=row["activity_type"],
            start_time=row["start_time"],
            duration_s=row["duration"],
            calories=row["calories"],
            avg_hr=row["avg_hr"],
            max_hr=row["max_hr"],
            distance=row["distance"],
            dive=dive,
            is_pb=(dive.max_depth_m >= pb_depth and dive.max_depth_m > 0),
        )


class SessionUpdate(BaseModel):
    notes: str | None = None
    location_name: str | None = None
