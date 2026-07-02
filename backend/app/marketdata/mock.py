"""Synthetic market data — works with zero API keys (spec Phase 1 / §6 sim).

Generates deterministic random-walk OHLCV bars so the UI can be built and demoed
before Alpaca keys exist. History is reproducible per (symbol, timeframe); the
live quote wanders around the most recent close so the chart visibly updates.
"""

from __future__ import annotations

import hashlib
import random
import time

from app.marketdata.base import MarketDataProvider
from app.models import Candle, Quote, Timeframe

# Seconds per bar for each timeframe.
_INTERVAL_SECONDS: dict[Timeframe, int] = {
    Timeframe.M1: 60,
    Timeframe.M5: 5 * 60,
    Timeframe.M15: 15 * 60,
    Timeframe.H1: 60 * 60,
    Timeframe.D1: 24 * 60 * 60,
}


def _seed(*parts: str) -> int:
    digest = hashlib.sha256("|".join(parts).encode()).hexdigest()
    return int(digest[:8], 16)


def _base_price(symbol: str) -> float:
    # Stable, plausible starting price in roughly [50, 550).
    return 50.0 + (_seed(symbol) % 500)


class MockProvider(MarketDataProvider):
    name = "mock"

    def get_candles(
        self, symbol: str, timeframe: Timeframe, limit: int = 300
    ) -> list[Candle]:
        symbol = symbol.upper()
        interval = _INTERVAL_SECONDS[timeframe]
        rng = random.Random(_seed(symbol, timeframe.value))

        now = int(time.time())
        # Align the most recent bar's open time to the timeframe grid.
        last_open = now - (now % interval)
        start = last_open - interval * (limit - 1)

        candles: list[Candle] = []
        price = _base_price(symbol)
        for i in range(limit):
            open_ = price
            # ~1.5% per-bar volatility random walk.
            drift = rng.uniform(-0.015, 0.015)
            close = max(1.0, open_ * (1 + drift))
            high = max(open_, close) * (1 + abs(rng.uniform(0, 0.008)))
            low = min(open_, close) * (1 - abs(rng.uniform(0, 0.008)))
            volume = float(rng.randint(100_000, 5_000_000))
            candles.append(
                Candle(
                    time=start + i * interval,
                    open=round(open_, 2),
                    high=round(high, 2),
                    low=round(low, 2),
                    close=round(close, 2),
                    volume=volume,
                )
            )
            price = close
        return candles

    def get_quote(self, symbol: str) -> Quote:
        symbol = symbol.upper()
        # Two daily bars: today (reference for the live price) and yesterday
        # (previous close, for the day's change).
        daily = self.get_candles(symbol, Timeframe.D1, limit=2)
        today_close = daily[-1].close if daily else _base_price(symbol)
        prev_close = daily[-2].close if len(daily) >= 2 else today_close
        # Wander around today's close, reseeded each wall-clock second so the
        # value changes between polls but is stable within a second.
        rng = random.Random(_seed(symbol, str(int(time.time()))))
        price = max(1.0, today_close * (1 + rng.uniform(-0.003, 0.003)))
        return Quote(
            symbol=symbol,
            price=round(price, 2),
            time=int(time.time()),
            prev_close=round(prev_close, 2),
        )
