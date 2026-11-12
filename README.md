# kuroshiba-game

## クロシバのおさんぽ予報 (osanpo.html)

アスファルト路面温度を推定して、犬の散歩に適した時間帯を教えてくれるナビ。
会員登録なしで3日先まで全時間帯見られます。

- GitHub Pages: `https://purplecom24-netizen.github.io/kuroshiba-game/osanpo.html`
- 位置指定: `osanpo.html?lat=35.63&lon=140.08` (省略時は現在地 → 千葉市美浜区)
- データ: [Open-Meteo](https://open-meteo.com/)(気温・日射量・風速・降水)から路面温度を簡易熱収支モデルで推定

## キオクシア攻略マップ 2026 (kioxia.html)

AIメモリ相場の主役キオクシアHD(285A)の戦略メモ。年表・業績・需給・監視指標を1画面に。

- GitHub Pages: `https://purplecom24-netizen.github.io/kuroshiba-game/kioxia.html`
- 数値は2026/08/31時点の報道・公表情報に基づく引用。売買推奨ではありません
- チャートは報道で確認できた終値のみをつないだアンカー線(値動きの捏造なし)

## もぐもぐ栄養ノート (mogumogu/)

離乳食・育児用ミルク・母乳（推定）を合算した1日の栄養摂取量を、日本人の食事摂取基準（2025年版）と比べて見える化する個人用PWA。成長曲線（令和5年乳幼児身体発育調査）つき。

- GitHub Pages: `https://purplecom24-netizen.github.io/kuroshiba-game/mogumogu/`（iPhoneのSafariで開いて「ホーム画面に追加」）
- ソース: `apps/mogumogu/`（要件定義は `apps/mogumogu/docs/requirements.md`）
- データは端末内（IndexedDB）だけに保存。表示はすべて目安で、医療的な判断の代わりにはなりません
