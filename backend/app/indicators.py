"""Basic indicators (spec §7 "基本インジケータ").

Pure functions over close-price series so they're trivially unit-testable and
reusable by the backtester and strategy engine later.
"""

from __future__ import annotations


def sma(values: list[float], period: int) -> list[float | None]:
    """Simple moving average. Leading entries before ``period`` bars are None."""
    if period <= 0:
        raise ValueError("period must be positive")
    out: list[float | None] = []
    running = 0.0
    for i, v in enumerate(values):
        running += v
        if i >= period:
            running -= values[i - period]
        out.append(round(running / period, 4) if i >= period - 1 else None)
    return out
