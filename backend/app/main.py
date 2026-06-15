"""FastAPI entrypoint (spec Phase 0).

Phase 0 completion condition: the app starts and the mode config loads.
No trading endpoints yet — those arrive from Phase 1 onward.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app import __version__
from app.config import TradingMode, get_settings

logger = logging.getLogger("kuroshiba")


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings = get_settings()
    logger.info("Starting Kuroshiba in %s mode", settings.trading_mode.value)
    if settings.trading_mode is TradingMode.LIVE and not settings.live_orders_armed():
        # Helpful, not fatal: live mode selected but the safety gate keeps it disarmed.
        logger.warning(
            "TRADING_MODE=live but live orders are NOT armed "
            "(set LIVE_TRADING_ENABLED=true and provide live keys to arm)."
        )
    yield


app = FastAPI(
    title="Kuroshiba Trading Dashboard",
    version=__version__,
    lifespan=lifespan,
)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "version": __version__}


@app.get("/api/status")
def status() -> dict:
    """Current operating mode — non-secret. Frontend status panel reads this."""
    return get_settings().describe()
