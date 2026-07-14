from fastapi import Header, HTTPException, status
from .config import settings


async def verify_api_key(x_api_key: str = Header(default="")) -> None:
    """Soft API key check — skipped if API_KEY is not configured."""
    if not settings.api_key:
        return
    if x_api_key != settings.api_key:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API key")
