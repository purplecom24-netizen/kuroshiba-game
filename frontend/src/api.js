// Thin API client. Paths are relative so Vite's dev proxy (or same-origin
// deploy) routes them to the FastAPI backend.

export async function getStatus() {
  const r = await fetch("/api/status");
  if (!r.ok) throw new Error("status failed");
  return r.json();
}

export async function getInstruments(q = "") {
  const r = await fetch(`/api/instruments?q=${encodeURIComponent(q)}`);
  if (!r.ok) throw new Error("instruments failed");
  return r.json();
}

export async function getCandles(symbol, timeframe, limit = 300) {
  const r = await fetch(
    `/api/candles/${symbol}?timeframe=${timeframe}&limit=${limit}`
  );
  if (!r.ok) throw new Error("candles failed");
  return r.json();
}

export async function getSma(symbol, timeframe, period = 20, limit = 300) {
  const r = await fetch(
    `/api/indicators/${symbol}/sma?timeframe=${timeframe}&period=${period}&limit=${limit}`
  );
  if (!r.ok) throw new Error("sma failed");
  return r.json();
}

// Opens the live-quote WebSocket and subscribes to `symbols`.
// Calls onQuote({symbol, price, time}) for each tick.
export function openQuoteStream(symbols, onQuote, onState) {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws/quotes`);
  ws.onopen = () => {
    onState?.("connected");
    ws.send(JSON.stringify({ symbols }));
  };
  ws.onmessage = (e) => onQuote(JSON.parse(e.data));
  ws.onclose = () => onState?.("disconnected");
  ws.onerror = () => onState?.("error");
  return ws;
}
