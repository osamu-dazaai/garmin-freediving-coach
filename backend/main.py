from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .database import run_migrations
from .routers import sessions, health, readiness, analytics, protocols, goals, manual_log, sync, dives, labels


@asynccontextmanager
async def lifespan(app: FastAPI):
    await run_migrations(settings.database_path)
    yield


app = FastAPI(
    title="ApneaOS API",
    description="Freediving training dashboard backend — Garmin-connected, open source.",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(sessions.router)
app.include_router(health.router)
app.include_router(readiness.router)
app.include_router(analytics.router)
app.include_router(protocols.router)
app.include_router(goals.router)
app.include_router(manual_log.router)
app.include_router(sync.router)
app.include_router(dives.router)
app.include_router(labels.router)


@app.get("/", tags=["meta"])
async def root():
    return {"name": "ApneaOS API", "version": "2.0.0", "docs": "/docs"}
