import uvicorn
from .config import settings

if __name__ == "__main__":
    uvicorn.run(
        "backend.main:app",
        host=settings.host,
        port=settings.port,
        reload=True,
        reload_dirs=["backend"],
    )
