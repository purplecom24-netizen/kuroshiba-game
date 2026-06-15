"""Phase 0 completion check: the app starts and exposes its mode."""

from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import app

client = TestClient(app)


def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_status_reports_mode():
    get_settings.cache_clear()
    r = client.get("/api/status")
    assert r.status_code == 200
    body = r.json()
    assert body["broker"] == "alpaca"
    assert body["trading_mode"] in {"sim", "paper", "live"}
    assert "live_orders_armed" in body
