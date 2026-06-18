"""WebSocket live-quote stream (spec §5 "WebSocket でリアルタイム配信").

Phase 1 keeps this simple: the client sends a JSON list of symbols to subscribe
to, and the server pushes periodic quote ticks. With the mock provider this
animates the chart; with Alpaca it polls latest trades. A later phase can swap
polling for Alpaca's native streaming behind the same client contract.
"""

from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.marketdata import get_provider

router = APIRouter()

# How often to push quotes (seconds). Conservative to respect rate limits (§10).
PUSH_INTERVAL = 2.0


@router.websocket("/ws/quotes")
async def quotes(ws: WebSocket) -> None:
    await ws.accept()
    symbols: list[str] = []
    provider = get_provider()

    async def receive_subscriptions() -> None:
        nonlocal symbols
        try:
            while True:
                raw = await ws.receive_text()
                data = json.loads(raw)
                if isinstance(data, dict) and "symbols" in data:
                    symbols = [str(s).upper() for s in data["symbols"]]
        except (WebSocketDisconnect, json.JSONDecodeError):
            return

    receiver = asyncio.create_task(receive_subscriptions())
    try:
        while True:
            for sym in list(symbols):
                try:
                    quote = await asyncio.to_thread(provider.get_quote, sym)
                except Exception:  # noqa: BLE001 — one bad symbol must not kill the stream
                    continue
                await ws.send_json(quote.model_dump())
            await asyncio.sleep(PUSH_INTERVAL)
    except WebSocketDisconnect:
        pass
    finally:
        receiver.cancel()
