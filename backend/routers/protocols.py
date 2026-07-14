import aiosqlite
from fastapi import APIRouter, Depends
from ..database import get_db
from ..deps import verify_api_key
from ..services.protocol_service import build_protocols

router = APIRouter(prefix="/protocols", tags=["protocols"], dependencies=[Depends(verify_api_key)])


@router.get("")
async def get_protocols(conn: aiosqlite.Connection = Depends(get_db)):
    return await build_protocols(conn)
