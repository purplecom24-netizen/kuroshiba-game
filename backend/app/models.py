"""Shared API schemas (Phase 1)."""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel


class Timeframe(str, Enum):
    """Chart timeframes. Values map to Alpaca bar timeframes."""

    M1 = "1Min"
    M5 = "5Min"
    M15 = "15Min"
    H1 = "1Hour"
    D1 = "1Day"


class Instrument(BaseModel):
    symbol: str
    name: str
    exchange: str = "US"


class Candle(BaseModel):
    """One OHLCV bar. ``time`` is a UNIX epoch (seconds) — lightweight-charts' format."""

    time: int
    open: float
    high: float
    low: float
    close: float
    volume: float


class Quote(BaseModel):
    """A lightweight latest-price tick, pushed over the WebSocket.

    ``prev_close`` is the previous *daily* close so the UI can show the day's
    change (amount + percent). None if it can't be determined.
    """

    symbol: str
    price: float
    time: int
    prev_close: float | None = None
