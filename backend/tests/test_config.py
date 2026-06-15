"""Phase 0 safety tests for the trading-mode framework.

These guard the spec §2 invariants: paper is the default, and live money is
double-gated. If any of these break, the live gate is unsafe — do not ship.
"""

from app.config import Settings, TradingMode

# Build settings without reading a developer's local .env, so tests are hermetic.
_BASE = {"_env_file": None}


def _settings(**overrides) -> Settings:
    return Settings(**_BASE, **overrides)


def test_default_mode_is_paper():
    assert _settings().trading_mode is TradingMode.PAPER


def test_paper_uses_paper_base_url():
    s = _settings(trading_mode="paper")
    assert s.alpaca_base_url.endswith("paper-api.alpaca.markets")
    assert not s.is_live


def test_live_uses_live_base_url_and_credentials():
    s = _settings(
        trading_mode="live",
        alpaca_live_key_id="k",
        alpaca_live_secret_key="s",
    )
    assert s.is_live
    assert s.alpaca_base_url == "https://api.alpaca.markets"
    assert s.active_alpaca_credentials == ("k", "s")


def test_live_orders_disarmed_without_explicit_flag():
    """Live mode + valid keys is NOT enough — the opt-in flag is mandatory."""
    s = _settings(
        trading_mode="live",
        live_trading_enabled=False,
        alpaca_live_key_id="k",
        alpaca_live_secret_key="s",
    )
    assert s.live_orders_armed() is False


def test_live_orders_disarmed_without_credentials():
    s = _settings(
        trading_mode="live",
        live_trading_enabled=True,
        alpaca_live_key_id="",
        alpaca_live_secret_key="",
    )
    assert s.live_orders_armed() is False


def test_live_orders_armed_only_with_mode_flag_and_keys():
    s = _settings(
        trading_mode="live",
        live_trading_enabled=True,
        alpaca_live_key_id="k",
        alpaca_live_secret_key="s",
    )
    assert s.live_orders_armed() is True


def test_paper_mode_never_arms_live_orders():
    s = _settings(
        trading_mode="paper",
        live_trading_enabled=True,  # flag set, but mode is paper
        alpaca_live_key_id="k",
        alpaca_live_secret_key="s",
    )
    assert s.live_orders_armed() is False


def test_describe_is_non_secret():
    s = _settings(
        trading_mode="paper",
        alpaca_paper_key_id="secret-id",
        alpaca_paper_secret_key="secret-key",
    )
    blob = str(s.describe())
    assert "secret-id" not in blob
    assert "secret-key" not in blob
    assert s.describe()["has_active_credentials"] is True
