from pydantic import BaseModel


class HealthMetric(BaseModel):
    date: str
    resting_hr: float | None = None
    hrv_avg: float | None = None
    hrv_status: str | None = None
    sleep_score: float | None = None
    sleep_duration: float | None = None
    sleep_deep: float | None = None
    sleep_rem: float | None = None
    body_battery_charged: float | None = None
    body_battery_drained: float | None = None
    stress_avg: float | None = None
    spo2_avg: float | None = None


class ReadinessScore(BaseModel):
    date: str
    score: int
    level: str          # OPTIMAL / MODERATE / LOW
    hrv_avg: float | None = None
    sleep_score: float | None = None
    body_battery: float | None = None
    stress_avg: float | None = None
    components: dict[str, float]
