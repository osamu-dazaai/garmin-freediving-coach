from pydantic_settings import BaseSettings, SettingsConfigDict
from pathlib import Path

_ROOT = Path(__file__).parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_path: str = str(_ROOT / "data" / "freediving.db")
    api_key: str = ""
    garmin_email: str = ""
    garmin_password: str = ""
    port: int = 8504
    host: str = "0.0.0.0"


settings = Settings()
