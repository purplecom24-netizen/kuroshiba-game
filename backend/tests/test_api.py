"""Phase 1 API tests (REST + WebSocket) against the mock provider."""

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_list_instruments():
    r = client.get("/api/instruments")
    assert r.status_code == 200
    symbols = {i["symbol"] for i in r.json()}
    assert {"AAPL", "SPY"} <= symbols


def test_search_instruments():
    r = client.get("/api/instruments", params={"q": "apple"})
    assert r.status_code == 200
    assert [i["symbol"] for i in r.json()] == ["AAPL"]


def test_candles_endpoint():
    r = client.get("/api/candles/AAPL", params={"timeframe": "1Day", "limit": 20})
    assert r.status_code == 200
    body = r.json()
    assert len(body) == 20
    assert {"time", "open", "high", "low", "close", "volume"} <= body[0].keys()


def test_candles_unknown_symbol_404():
    r = client.get("/api/candles/DOESNOTEXIST")
    assert r.status_code == 404


def test_sma_indicator_endpoint():
    r = client.get("/api/indicators/AAPL/sma", params={"period": 10, "limit": 50})
    assert r.status_code == 200
    series = r.json()
    assert len(series) == 50 - 10 + 1  # warm-up trimmed
    assert all("value" in p for p in series)


def test_status_reports_data_source():
    r = client.get("/api/status")
    assert r.json()["data_source"] == "mock"  # no keys in test env


def test_ws_quotes_stream():
    with client.websocket_connect("/ws/quotes") as wsc:
        wsc.send_json({"symbols": ["AAPL"]})
        msg = wsc.receive_json()
        assert msg["symbol"] == "AAPL"
        assert msg["price"] > 0
