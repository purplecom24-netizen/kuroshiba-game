"""Alpaca-backed market data (spec §4-1).

Used automatically once paper (or live) keys are present. Talks to Alpaca's
market-data REST API directly via httpx to avoid a heavy SDK dependency in
Phase 1; this can be swapped for the official SDK later behind the same
``MarketDataProvider`` interface.
"""

from __future__ import annotations

from datetime import datetime, timezone

import httpx

from app.marketdata.base import MarketDataProvider
from app.models import Candle, Quote, Timeframe

_DATA_BASE_URL = "https://data.alpaca.markets/v2"


def _to_epoch(iso_ts: str) -> int:
    # Alpaca returns RFC-3339 timestamps, e.g. "2024-01-02T05:00:00Z".
    dt = datetime.fromisoformat(iso_ts.replace("Z", "+00:00"))
    return int(dt.astimezone(timezone.utc).timestamp())


class AlpacaProvider(MarketDataProvider):
    name = "alpaca"

    def __init__(self, key_id: str, secret_key: str, timeout: float = 10.0) -> None:
        self._headers = {
            "APCA-API-KEY-ID": key_id,
            "APCA-API-SECRET-KEY": secret_key,
        }
        self._timeout = timeout

    def get_candles(
        self, symbol: str, timeframe: Timeframe, limit: int = 300
    ) -> list[Candle]:
        symbol = symbol.upper()
        url = f"{_DATA_BASE_URL}/stocks/{symbol}/bars"
        params = {
            "timeframe": timeframe.value,
            "limit": limit,
            "adjustment": "all",  # split/dividend adjusted (spec §10 corp actions)
        }
        with httpx.Client(timeout=self._timeout) as client:
            resp = client.get(url, params=params, headers=self._headers)
            resp.raise_for_status()
            bars = resp.json().get("bars") or []
        return [
            Candle(
                time=_to_epoch(b["t"]),
                open=b["o"],
                high=b["h"],
                low=b["l"],
                close=b["c"],
                volume=float(b["v"]),
            )
            for b in bars
        ]

    def get_quote(self, symbol: str) -> Quote:
        symbol = symbol.upper()
        # The snapshot bundles the latest trade and the previous daily bar in a
        # single call, so we get price + previous close (day's change) at once.
        url = f"{_DATA_BASE_URL}/stocks/{symbol}/snapshot"
        with httpx.Client(timeout=self._timeout) as client:
            resp = client.get(url, headers=self._headers)
            resp.raise_for_status()
            snap = resp.json()
        trade = snap["latestTrade"]
        prev_bar = snap.get("prevDailyBar") or {}
        return Quote(
            symbol=symbol,
            price=trade["p"],
            time=_to_epoch(trade["t"]),
            prev_close=prev_bar.get("c"),
        )
