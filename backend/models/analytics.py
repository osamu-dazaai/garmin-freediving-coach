from pydantic import BaseModel


class DepthPoint(BaseModel):
    date: str
    max_depth_m: float
    session_id: int


class WorkingDepth(BaseModel):
    working_depth_m: float          # 70th percentile
    pb_depth_m: float
    avg_depth_m: float
    window_days: int
    session_count: int


class PlateauStatus(BaseModel):
    plateau: bool
    days_since_improvement: int
    last_pb_date: str | None
    last_pb_depth_m: float | None
    suggestion: str | None


class TrainingPhase(BaseModel):
    current_phase: str              # pool / open_water / rest / mixed
    phase_start_date: str
    session_count: int
    avg_depth_m: float
    streak_days: int


class LocationStat(BaseModel):
    location: str
    session_count: int
    max_depth_m: float
    avg_depth_m: float
    last_session: str
    avg_bottom_time_s: float | None = None


class PersonalBests(BaseModel):
    max_depth_m: float
    max_depth_date: str
    max_bottom_time_s: float
    max_bottom_time_date: str
    max_dive_count: int
    total_sessions: int
    total_bottom_time_s: float
    total_depth_descended_m: float
    # Time-window vanity stats (populated when since/until filters are applied)
    window_label: str | None = None
    window_sessions: int | None = None
    window_bottom_time_s: float | None = None
    window_depth_descended_m: float | None = None


class SurfaceIntervalEntry(BaseModel):
    session_id: int
    date: str
    bottom_time_s: float
    surface_interval_s: float
    ratio: float
    warning: str | None           # None / "warning" / "danger"


class MonthlyStats(BaseModel):
    month: str                    # YYYY-MM
    session_count: int
    max_depth_m: float
    avg_depth_m: float
    total_bottom_time_s: float


class YearReview(BaseModel):
    year: int
    total_sessions: int
    total_dives: int
    max_depth_m: float
    total_bottom_time_s: float
    total_depth_descended_m: float
    pb_set_this_year: bool
    best_month: str
    monthly_breakdown: list[MonthlyStats]
    locations_visited: list[str]


class ReturnToDepthPoint(BaseModel):
    date: str
    max_depth_m: float
    days_since_last_session: int
    session_index_in_block: int
