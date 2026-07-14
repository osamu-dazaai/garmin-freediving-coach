from pydantic import BaseModel
from typing import Literal


GoalType = Literal["depth", "bottom_time", "dive_count", "eq_depth", "static_time"]


class GoalCreate(BaseModel):
    goal_type: GoalType
    title: str
    target_value: float
    target_date: str | None = None
    notes: str | None = None


class GoalUpdate(BaseModel):
    title: str | None = None
    target_value: float | None = None
    current_value: float | None = None
    target_date: str | None = None
    notes: str | None = None
    achieved: bool | None = None


class Goal(BaseModel):
    id: int
    goal_type: GoalType
    title: str
    target_value: float
    current_value: float
    target_date: str | None
    achieved: bool
    achieved_at: str | None
    notes: str | None
    created_at: str
    progress_pct: float
