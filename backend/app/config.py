"""Configuration & trading-mode framework (spec Phase 0).

The whole system pivots on three modes — ``sim`` / ``paper`` / ``live`` — and on
the hard safety rules in spec §2:

* default is ``paper`` (virtual funds), never ``live``;
* ``live`` requires a *deliberate* second switch (``LIVE_TRADING_ENABLED``) on
  top of valid live keys, so a stray env var can never arm real money.

Broker adapters, the risk manager and the runner all read their mode from here.
"""

from __future__ import annotations

from enum import Enum
from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class TradingMode(str, Enum):
    SIM = "sim"
    PAPER = "paper"
    LIVE = "live"


ALPACA_PAPER_BASE_URL = "https://paper-api.alpaca.markets"
ALPACA_LIVE_BASE_URL = "https://api.alpaca.markets"


class Settings(BaseSettings):
    """Loaded from environment / ``.env``. See ``.env.example``."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    trading_mode: TradingMode = TradingMode.PAPER
    live_trading_enabled: bool = False

    alpaca_paper_key_id: str = ""
    alpaca_paper_secret_key: str = ""
    alpaca_live_key_id: str = ""
    alpaca_live_secret_key: str = ""

    database_url: str = "sqlite:///./data/kuroshiba.sqlite"
    host: str = "0.0.0.0"
    port: int = 8000

    # ── derived helpers ─────────────────────────────────────────────────────

    @property
    def is_live(self) -> bool:
        return self.trading_mode is TradingMode.LIVE

    @property
    def alpaca_base_url(self) -> str:
        return ALPACA_LIVE_BASE_URL if self.is_live else ALPACA_PAPER_BASE_URL

    @property
    def active_alpaca_credentials(self) -> tuple[str, str]:
        """(key_id, secret) for the current mode. Empty strings if unset."""
        if self.is_live:
            return self.alpaca_live_key_id, self.alpaca_live_secret_key
        return self.alpaca_paper_key_id, self.alpaca_paper_secret_key

    def has_active_credentials(self) -> bool:
        key_id, secret = self.active_alpaca_credentials
        return bool(key_id) and bool(secret)

    def live_orders_armed(self) -> bool:
        """True only when REAL orders may be placed.

        Requires *both* live mode and the explicit opt-in flag, plus credentials.
        This is the single gate every order path must consult (spec §2-2/§3).
        """
        return (
            self.is_live
            and self.live_trading_enabled
            and self.has_active_credentials()
        )

    def describe(self) -> dict:
        """Non-secret summary, safe to expose over the API / logs."""
        return {
            "trading_mode": self.trading_mode.value,
            "live_trading_enabled": self.live_trading_enabled,
            "live_orders_armed": self.live_orders_armed(),
            "broker": "alpaca",
            "alpaca_base_url": self.alpaca_base_url,
            "has_active_credentials": self.has_active_credentials(),
        }


@lru_cache
def get_settings() -> Settings:
    """Cached singleton. Tests can clear via ``get_settings.cache_clear()``."""
    return Settings()
