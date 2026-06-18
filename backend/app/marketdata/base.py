"""Market data provider interface.

Every provider (mock, Alpaca, ...) implements this so the API and, later, the
strategy engine never depend on a concrete data source.
"""

from __future__ import annotations

from abc import ABC, abstractmethod

from app.models import Candle, Quote, Timeframe


class MarketDataProvider(ABC):
    #: short identifier surfaced in /api/status so the UI can show the source
    name: str = "base"

    @abstractmethod
    def get_candles(
        self, symbol: str, timeframe: Timeframe, limit: int = 300
    ) -> list[Candle]:
        """Return up to ``limit`` historical bars, oldest first."""

    @abstractmethod
    def get_quote(self, symbol: str) -> Quote:
        """Return the latest price tick for ``symbol``."""
