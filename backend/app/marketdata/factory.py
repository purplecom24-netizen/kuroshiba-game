"""Provider selection.

Uses real Alpaca data when credentials for the active mode are present;
otherwise falls back to the mock provider so the UI always has something to
draw (spec Phase 1). The choice is cached but can be reset in tests.
"""

from __future__ import annotations

from functools import lru_cache

from app.config import Settings, get_settings
from app.marketdata.base import MarketDataProvider
from app.marketdata.mock import MockProvider


def _build(settings: Settings) -> MarketDataProvider:
    if settings.has_active_credentials():
        # Imported lazily so the mock path needs no httpx/network at import time.
        from app.marketdata.alpaca import AlpacaProvider

        key_id, secret = settings.active_alpaca_credentials
        return AlpacaProvider(key_id=key_id, secret_key=secret)
    return MockProvider()


@lru_cache
def get_provider() -> MarketDataProvider:
    return _build(get_settings())
