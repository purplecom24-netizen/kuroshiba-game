"""REST endpoints for the read-only chart UI (spec Phase 1)."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from app import universe
from app.indicators import sma
from app.marketdata import get_provider
from app.models import Candle, Instrument, Timeframe

router = APIRouter(prefix="/api", tags=["marketdata"])


@router.get("/instruments", response_model=list[Instrument])
def list_instruments(q: str = Query("", description="search query")) -> list[Instrument]:
    """Watchlist / symbol search over the configured universe."""
    return universe.search(q)


@router.get("/candles/{symbol}", response_model=list[Candle])
def get_candles(
    symbol: str,
    timeframe: Timeframe = Timeframe.D1,
    limit: int = Query(300, ge=1, le=1000),
) -> list[Candle]:
    if universe.get_instrument(symbol) is None:
        raise HTTPException(status_code=404, detail=f"Unknown symbol: {symbol}")
    return get_provider().get_candles(symbol, timeframe, limit)


@router.get("/indicators/{symbol}/sma")
def get_sma(
    symbol: str,
    timeframe: Timeframe = Timeframe.D1,
    period: int = Query(20, ge=1, le=400),
    limit: int = Query(300, ge=1, le=1000),
) -> list[dict]:
    """SMA overlay series aligned to candle times (None before warm-up)."""
    if universe.get_instrument(symbol) is None:
        raise HTTPException(status_code=404, detail=f"Unknown symbol: {symbol}")
    candles = get_provider().get_candles(symbol, timeframe, limit)
    closes = [c.close for c in candles]
    return [
        {"time": c.time, "value": v}
        for c, v in zip(candles, sma(closes, period))
        if v is not None
    ]
