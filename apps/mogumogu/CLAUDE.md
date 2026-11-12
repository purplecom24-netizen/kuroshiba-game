# もぐもぐ栄養ノート（離乳食・補完食 栄養可視化アプリ）

要件定義：`docs/requirements.md`（実装メモに一次ソースとの差異を記録）

## ルール
- 基準値・成分値・母乳中濃度・発育曲線の数値を**コードに直書きしない**。`data-src/` の一次ソース（Excel・転記CSV）から `npm run data` で `src/data/*.json` を生成する。
- 一次ソースで確かめられない値は推測で埋めない。TODO として残し、利用者に質問する。
- 計算エンジン（`src/engine/`）は画面から独立した純粋関数。変更時は先に `src/engine/__tests__/` にテストを書く。
- 表示文言は「目安」「届いていない」「健診や小児科で相談する目安」を使い、「異常」「病気」「欠乏症」など診断的な語は使わない。
- 子どもの個人データは端末内（IndexedDB）だけ。解析SDK・広告・外部送信は入れない。

## コマンド
- `npm run data` 参照データの再生成
- `npm test` 計算エンジンのテスト（Vitest、T-01〜T-13）
- `npm run build` → リポジトリ直下の `mogumogu/` に出力（GitHub Pages で配信）
- `npm run e2e` 主要画面の操作テスト（Playwright、T-11/T-13〜T-16）。ビルド後に実行

## 構成
- `data-src/` 一次ソース（成分表Excel、発育調査Excel、食事摂取基準の転記CSVなど）
- `scripts/build-data.mjs` 変換スクリプト
- `src/engine/` 計算エンジン（token, age, reference, breastmilk, intake, judge, period, units, recipe, growth, search）
- `src/lib/day.ts` DBの記録 → エンジン入力の組み立て
- `src/ui/` 画面（記録・食材・栄養分析・成長・設定）
