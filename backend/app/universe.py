"""Initial trading universe (spec §4-3).

Kept deliberately small: a slice of large-cap S&P 100 names. The watchlist is a
plain list now; later phases can promote it to a DB-backed, user-editable set
without changing callers.
"""

from __future__ import annotations

from app.models import Instrument

# A ~10-name starter watchlist. Expandable later (spec §7 scanner/universe).
DEFAULT_UNIVERSE: list[Instrument] = [
    Instrument(symbol="AAPL", name="Apple Inc."),
    Instrument(symbol="MSFT", name="Microsoft Corp."),
    Instrument(symbol="NVDA", name="NVIDIA Corp."),
    Instrument(symbol="AMZN", name="Amazon.com Inc."),
    Instrument(symbol="GOOGL", name="Alphabet Inc. Class A"),
    Instrument(symbol="META", name="Meta Platforms Inc."),
    Instrument(symbol="TSLA", name="Tesla Inc."),
    Instrument(symbol="JPM", name="JPMorgan Chase & Co."),
    Instrument(symbol="V", name="Visa Inc."),
    Instrument(symbol="SPY", name="SPDR S&P 500 ETF Trust"),
]

_BY_SYMBOL = {i.symbol: i for i in DEFAULT_UNIVERSE}


def all_instruments() -> list[Instrument]:
    return list(DEFAULT_UNIVERSE)


def get_instrument(symbol: str) -> Instrument | None:
    return _BY_SYMBOL.get(symbol.upper())


def search(query: str) -> list[Instrument]:
    q = query.strip().upper()
    if not q:
        return all_instruments()
    return [
        i
        for i in DEFAULT_UNIVERSE
        if q in i.symbol or q in i.name.upper()
    ]
