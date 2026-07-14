import aiosqlite
from contextlib import asynccontextmanager
from pathlib import Path
from .config import settings

_SCHEMA_V2 = Path(__file__).parent.parent / "src" / "core" / "schema_v2.sql"


async def _apply_pragmas(conn: aiosqlite.Connection) -> None:
    await conn.execute("PRAGMA journal_mode=WAL")
    await conn.execute("PRAGMA foreign_keys=ON")
    conn.row_factory = aiosqlite.Row


_ADDITIVE_MIGRATIONS = [
    # guest_dives was created without session_file/hr_profile columns — add them if missing
    "ALTER TABLE guest_dives ADD COLUMN session_file TEXT",
    "ALTER TABLE guest_dives ADD COLUMN hr_profile TEXT",
    "ALTER TABLE guest_dives ADD COLUMN surface_interval_s REAL",
    "ALTER TABLE guest_dives ADD COLUMN water_temp_c REAL",
]


async def run_migrations(db_path: str) -> None:
    """Apply schema_v2.sql then any additive column migrations."""
    if _SCHEMA_V2.exists():
        sql = _SCHEMA_V2.read_text()
        async with aiosqlite.connect(db_path) as conn:
            await _apply_pragmas(conn)
            await conn.executescript(sql)
            await conn.commit()

    async with aiosqlite.connect(db_path) as conn:
        await _apply_pragmas(conn)
        for stmt in _ADDITIVE_MIGRATIONS:
            try:
                await conn.execute(stmt)
                await conn.commit()
            except Exception:
                pass  # column already exists


@asynccontextmanager
async def get_conn():
    """Async context manager yielding an aiosqlite connection."""
    async with aiosqlite.connect(settings.database_path) as conn:
        await _apply_pragmas(conn)
        yield conn


async def get_db():
    """FastAPI dependency yielding a connection."""
    async with aiosqlite.connect(settings.database_path) as conn:
        await _apply_pragmas(conn)
        yield conn
