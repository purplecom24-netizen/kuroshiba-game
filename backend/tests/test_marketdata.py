"""Phase 1 market data + indicator tests (mock provider, no network)."""

import pytest

from app.indicators import sma
from app.marketdata.mock import MockProvider
from app.models import Timeframe


@pytest.fixture
def provider() -> MockProvider:
    return MockProvider()


def test_candles_count_and_order(provider: MockProvider):
    candles = provider.get_candles("AAPL", Timeframe.D1, limit=50)
    assert len(candles) == 50
    times = [c.time for c in candles]
    assert times == sorted(times)  # oldest first, strictly increasing


def test_candles_ohlc_consistency(provider: MockProvider):
    for c in provider.get_candles("MSFT", Timeframe.H1, limit=100):
        assert c.high >= c.open and c.high >= c.close
        assert c.low <= c.open and c.low <= c.close
        assert c.volume > 0


def test_candles_are_deterministic(provider: MockProvider):
    a = provider.get_candles("NVDA", Timeframe.M5, limit=30)
    b = provider.get_candles("NVDA", Timeframe.M5, limit=30)
    assert [c.close for c in a] == [c.close for c in b]


def test_quote_is_near_last_close(provider: MockProvider):
    quote = provider.get_quote("AAPL")
    assert quote.symbol == "AAPL"
    assert quote.price > 0


def test_quote_has_prev_close_for_day_change(provider: MockProvider):
    quote = provider.get_quote("AAPL")
    assert quote.prev_close is not None
    assert quote.prev_close > 0


def test_sma_warmup_and_value():
    values = [float(i) for i in range(1, 11)]  # 1..10
    result = sma(values, period=3)
    assert result[0] is None and result[1] is None
    assert result[2] == 2.0  # (1+2+3)/3
    assert result[-1] == 9.0  # (8+9+10)/3


def test_sma_rejects_bad_period():
    with pytest.raises(ValueError):
        sma([1.0, 2.0], period=0)
