# Kuroshiba — セミオート・トレーディング・ダッシュボード

個人用のセミオート・トレード環境。「監視と最終的なリスク操作は人間、執行は自動」。

> ⚠️ **重要**: このシステムは**損失を限定**するもので、**損失を排除するものではありません**。
> 「絶対に損しない」「ノーリスク」な発注は存在しません。詳しくは [`docs/spec.md`](docs/spec.md) §2 を参照。

## 確定した前提（§4）

| 項目 | 決定 |
|---|---|
| ブローカー / API | **Alpaca**（米株、ペーパートレードAPIから開始） |
| 戦略の向き | **(b) 決済売り** ＋ 単純なロング逆張りエントリー から開始 |
| 初期ユニバース | **S&P100 など数十銘柄に固定**（後から拡張可能な設計） |
| 稼働環境 | **小さなクラウドVM（Linux）** 前提。再起動時の状態復元を設計に含める |

## ビルド計画（フェーズ）

- **Phase 0 — セットアップ** ✅ 完了。雛形・依存管理・`.env`枠組み・`sim`/`paper`/`live` モード切替。
- **Phase 1 — データ＋チャートUI（読み取り専用）** ← *現在ここ*。ウォッチリスト・ローソク足・時間足切替・SMA・ライブ更新。
- **Phase 2 — バックテスター**
- **Phase 3 — ペーパートレード（仮想資金の自動売買）**
- **Phase 4 — 本番（少額・手動有効化）**

詳細は [`docs/spec.md`](docs/spec.md)。

## セットアップ（Phase 0）

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # 値を編集（実キーはコミットしない）
uvicorn app.main:app --reload
```

起動後の確認:

```bash
curl http://localhost:8000/health        # {"status":"ok"}
curl http://localhost:8000/api/status     # 現在のモード等を返す
```

### モード切替

`.env` の `TRADING_MODE` を `sim` / `paper` / `live` で切り替えます。
**デフォルトは `paper`（安全側）**。`live` は明示的に `LIVE_TRADING_ENABLED=true`
を設定し、かつAlpacaの実弾キーが揃っている場合のみ有効になります（§2-2・§2-3）。

### フロントエンド（Phase 1）

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173 （/api と /ws はバックエンドにプロキシ）
```

バックエンド(`uvicorn`)とフロントエンド(`npm run dev`)を両方起動すると、ダーク
テーマのダッシュボードでウォッチリスト・ローソク足チャート・時間足切替・SMA(20)・
ライブ価格更新が確認できます。Alpacaキー未設定でもモックデータで動作し、`.env` に
ペーパーキーを入れると自動でAlpacaの実データに切り替わります。

## テスト

```bash
cd backend
pytest
```
