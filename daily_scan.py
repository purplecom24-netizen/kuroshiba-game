#!/usr/bin/env python3
"""Phase 2: フォワードテスト日次スキャン(docs/requirements_v1.md §9)

Gate 1 合格(2026-07-02 実行: 主・端株可 310件 / 期待値 +0.004R /
ランダム分布 99.7%ile / 最大DD 16.3%)を受けて実装。仮想資金のみを扱う。

複数ルールの並走に対応する。ルール定義は backtest.py の RULE_PRESETS
(事前登録・変更禁止)。新しいルールは、そのルールの Phase 1 バックテストが
Gate 1 に合格した後に `python daily_scan.py --activate <rule>` で追加する。
各ルールの状態・台帳は forward/<rule>/ に分離される。

方式(リプレイ方式):
- ルールごとの初回有効化日を「フォワード開始日」として forward/<rule>/state.json に固定記録。
- 毎回、開始日から当日までを Phase 1 と同一のエンジンで決定的に再構築する。
  実行を数日忘れても次の実行で自動的に追いつき、同一データなら出力は完全一致する。
- シグナル判定は大引け確定後(平日18:00 JST 実行を想定)。当日のシグナルは
  翌営業日寄付でのエントリーとして次回実行時に自動処理される。

実行スケジュール設定例:

  Linux/Mac (crontab -e):
    0 18 * * 1-5 cd /path/to/kuroshiba-game && python3 daily_scan.py >> forward/scan_log.txt 2>&1

  Windows (管理者でなくてよい。run_daily_scan.bat を使用):
    schtasks /Create /SC WEEKLY /D MON,TUE,WED,THU,FRI /ST 18:00 ^
      /TN "KuroshibaDailyScan" /TR "C:\\path\\to\\run_daily_scan.bat"
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from datetime import datetime

import numpy as np
import pandas as pd

from backtest import (
    Config,
    PRIMARY_UNIVERSE,
    RULE_LABELS,
    RULE_PRESETS,
    TOPIX_ETF,
    Universe,
    build_rule_events,
    compute_signals,
    fetch_ticker,
    repair_price_glitches,
    run_engine,
    run_random_baseline,
)

FORWARD_DIR = "forward"
ACTIVE_PATH = os.path.join(FORWARD_DIR, "active_rules.json")
REVIEW_MILESTONES = (30, 50)  # 中間レビュー / 本レビュー(§4 Gate 2)


def _migrate_legacy_layout():
    """旧レイアウト(forward/ 直下に v1 のファイル)を forward/v1/ へ移動する。"""
    legacy_state = os.path.join(FORWARD_DIR, "state.json")
    v1_dir = os.path.join(FORWARD_DIR, "v1")
    if os.path.exists(legacy_state) and not os.path.exists(os.path.join(v1_dir, "state.json")):
        os.makedirs(v1_dir, exist_ok=True)
        for name in ("state.json", "forward_trades.csv", "summary_weekly.md",
                     "review_30.md", "review_50.md"):
            src = os.path.join(FORWARD_DIR, name)
            if os.path.exists(src):
                shutil.move(src, os.path.join(v1_dir, name))
        print("  旧レイアウトを forward/v1/ へ移行しました")


def load_active_rules() -> list[str]:
    os.makedirs(FORWARD_DIR, exist_ok=True)
    if os.path.exists(ACTIVE_PATH):
        with open(ACTIVE_PATH, encoding="utf-8") as f:
            return json.load(f)["active"]
    save_active_rules(["v1"])
    return ["v1"]


def save_active_rules(rules: list[str]):
    os.makedirs(FORWARD_DIR, exist_ok=True)
    with open(ACTIVE_PATH, "w", encoding="utf-8") as f:
        json.dump({"active": rules}, f, ensure_ascii=False, indent=2)


def load_state(rule: str) -> dict:
    rule_dir = os.path.join(FORWARD_DIR, rule)
    os.makedirs(rule_dir, exist_ok=True)
    path = os.path.join(rule_dir, "state.json")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    state = {
        "rule": rule,
        "forward_start": datetime.now().strftime("%Y-%m-%d"),
        "registered_at": datetime.now().isoformat(timespec="seconds"),
        "note": "フォワード開始日。初回実行時に固定され、以後変更しない。",
    }
    with open(path, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)
    print(f"  [{rule}] フォワードテスト開始を登録: {state['forward_start']}")
    return state


def load_data(cfg: Config, refresh: bool) -> dict[str, pd.DataFrame]:
    data = {}
    for t in sorted(set(PRIMARY_UNIVERSE) | {TOPIX_ETF}):
        df = fetch_ticker(t, cfg, refresh=refresh)
        df, notes = repair_price_glitches(df)
        for note in notes:
            print(f"  価格グリッチ修復: {t} {note}")
        data[t] = df
    return data


def forward_result(data: dict[str, pd.DataFrame], cfg: Config, forward_start: pd.Timestamp):
    """フォワード開始日以降のシグナルのみでエンジンを実行する。"""
    univ = Universe({t: data[t] for t in PRIMARY_UNIVERSE})
    events = [e for e in build_rule_events(univ, cfg) if e.signal_date >= forward_start]
    res = run_engine(univ, events, cfg)
    closed = [t for t in res.trades if t.exit_reason != "eod"]
    open_pos = [t for t in res.trades if t.exit_reason == "eod"]  # 実態は保有中
    return univ, res, closed, open_pos


def write_forward_csv(closed: list, path: str):
    rows = []
    for t in closed:
        rows.append({
            "銘柄": t.ticker,
            "シグナル日": t.signal_date.date(),
            "エントリー日": t.entry_date.date(),
            "エントリー価格": round(t.entry_price, 4),
            "株数": round(t.shares, 4),
            "ストップ価格": round(t.stop_price, 4),
            "出口日": t.exit_date.date(),
            "出口価格": round(t.exit_price, 4),
            "出口理由": t.exit_reason,
            "R倍数": round(t.r_multiple, 4),
            "損益円": round(t.pnl_jpy, 2),
            "決済後資産": round(t.equity_after, 2),
        })
    pd.DataFrame(rows).to_csv(path, index=False, encoding="utf-8-sig")


def topix_same_period(data: dict, cfg: Config, forward_start: pd.Timestamp) -> float:
    """同期間の TOPIX リターン(フォワード開始以降の初寄付→直近終値)。"""
    df = data[TOPIX_ETF]
    fw = df[df.index >= forward_start]
    if fw.empty:
        return 0.0
    return float(fw["Close"].iloc[-1] / fw["Open"].iloc[0] - 1.0)


def forward_window_universe(data: dict, forward_start: pd.Timestamp) -> Universe:
    sliced = {
        t: df[df.index >= forward_start]
        for t, df in data.items() if t in PRIMARY_UNIVERSE
    }
    sliced = {t: df for t, df in sliced.items() if len(df) >= 2}
    return Universe(sliced)


def milestone_review(rule: str, n: int, data: dict, cfg: Config, forward_start: pd.Timestamp,
                     closed: list, topix_ret: float, path: str):
    """30/50 トレード到達時のレビュー(§4 Gate 2: 同期間 TOPIX と再生成ランダム分布)。"""
    fw_univ = forward_window_universe(data, forward_start)
    rnd = run_random_baseline(fw_univ, cfg, n_trades_target=len(closed),
                              n_trials=1000, collect_curves=False)
    rs = np.array([t.r_multiple for t in closed])
    pnl = np.array([t.pnl_jpy for t in closed])
    final = closed[-1].equity_after
    pct = float((rnd["finals"] <= final).mean() * 100)
    exp_pct = float((rnd["expectancies"] <= rs.mean()).mean() * 100)
    kind = "中間レビュー(30トレード)" if n == 30 else "本レビュー(50トレード)"
    lines = [
        f"# フォワードテスト {kind} — ルール {RULE_LABELS.get(rule, rule)}",
        "",
        f"- 生成日時: {datetime.now().strftime('%Y-%m-%d %H:%M')}",
        f"- フォワード開始日: {forward_start.date()}(事前登録・変更なし)",
        f"- 決済済みトレード数: {len(closed)}",
        "",
        "## 成績(コスト控除後)",
        "",
        f"- 勝率: {(pnl > 0).mean():.1%}",
        f"- 期待値: {rs.mean():+.3f} R",
        f"- 決済後資産: {final:,.0f} 円({final / cfg.initial_capital - 1:+.1%})",
        "",
        "## 比較対象(§4 Gate 2)",
        "",
        f"- 同期間 TOPIX(1306.T): {topix_ret:+.1%}",
        f"- 同期間データで再生成したランダム分布(1000試行・シード{cfg.seed}): "
        f"最終資産中央値 {np.median(rnd['finals']):,.0f} 円",
        f"- ルールの位置: 最終資産 **{pct:.1f} パーセンタイル** / 期待値R {exp_pct:.1f} パーセンタイル",
        "",
        "## 解釈上の注意",
        "",
        "- バックテスト(Phase 1)の合格は同一データへの適合を含む。フォワードで期待値が",
        "  マイナスに沈む・ランダム分布の95%ileを下回るようであれば、Phase 1 の結果は",
        "  選択バイアス・過剰適合の産物だった可能性が高い。",
        "- 判定基準の事後変更は禁止(§10)。",
        "",
    ]
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"  [{rule}] レビューレポート生成: {path}")


def weekly_summary(rule: str, closed: list, open_pos: list, cfg: Config,
                   forward_start: pd.Timestamp, topix_ret: float, path: str):
    now = datetime.now()
    week_ago = pd.Timestamp(now.date()) - pd.Timedelta(days=7)
    this_week = [t for t in closed if t.exit_date >= week_ago]
    rs = np.array([t.r_multiple for t in closed]) if closed else np.array([])
    equity_now = closed[-1].equity_after if closed else cfg.initial_capital
    lines = [
        f"# フォワードテスト週次サマリー — ルール {RULE_LABELS.get(rule, rule)}",
        "",
        f"- 生成日時: {now.strftime('%Y-%m-%d %H:%M')}",
        f"- フォワード開始日: {forward_start.date()}",
        f"- 決済済みトレード: {len(closed)} 件(直近7日: {len(this_week)} 件)",
        f"- 決済後資産: {equity_now:,.0f} 円({equity_now / cfg.initial_capital - 1:+.1%})",
        f"- 期待値: {rs.mean():+.3f} R" if len(rs) else "- 期待値: (トレードなし)",
        f"- 同期間 TOPIX: {topix_ret:+.1%}",
        "",
        "## 今週決済したトレード",
        "",
    ]
    if this_week:
        lines += ["| 銘柄 | エントリー日 | 出口日 | 理由 | R | 損益円 |", "|---|---|---|---|---|---|"]
        for t in this_week:
            lines.append(f"| {t.ticker} | {t.entry_date.date()} | {t.exit_date.date()} | "
                         f"{t.exit_reason} | {t.r_multiple:+.2f} | {t.pnl_jpy:+,.0f} |")
    else:
        lines.append("- なし")
    lines += ["", "## 保有中ポジション", ""]
    if open_pos:
        lines += ["| 銘柄 | エントリー日 | エントリー価格 | ストップ | 評価損益円 |", "|---|---|---|---|---|"]
        for t in open_pos:
            lines.append(f"| {t.ticker} | {t.entry_date.date()} | {t.entry_price:,.1f} | "
                         f"{t.stop_price:,.1f} | {t.pnl_jpy:+,.0f} |")
    else:
        lines.append("- なし")
    lines += [
        "",
        f"- 次のレビュー: {'30トレード到達時(中間)' if len(closed) < 30 else '50トレード到達時(本レビュー)' if len(closed) < 50 else '完了(review_50.md 参照)'}",
        "",
    ]
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"  [{rule}] 週次サマリー生成: {path}")


def scan_rule(rule: str, data: dict, do_weekly: bool):
    cfg = RULE_PRESETS[rule]
    state = load_state(rule)
    forward_start = pd.Timestamp(state["forward_start"])
    rule_dir = os.path.join(FORWARD_DIR, rule)
    trades_path = os.path.join(rule_dir, "forward_trades.csv")

    univ, res, closed, open_pos = forward_result(data, cfg, forward_start)
    write_forward_csv(closed, trades_path)
    topix_ret = topix_same_period(data, cfg, forward_start)

    # 当日のシグナル(翌営業日寄付でエントリー候補)
    last_dates = {t: data[t].index[-1] for t in PRIMARY_UNIVERSE}
    latest = max(last_dates.values())
    todays = []
    for t in PRIMARY_UNIVERSE:
        if last_dates[t] != latest:
            continue
        sig = compute_signals(data[t], cfg)
        if bool(sig["signal"].iloc[-1]):
            todays.append((t, float(sig["vol_ratio"].iloc[-1]), float(sig["stop"].iloc[-1])))
    todays.sort(key=lambda x: -x[1])

    equity_now = closed[-1].equity_after if closed else cfg.initial_capital
    print(f"  [{rule} {RULE_LABELS.get(rule, '')}] 開始 {forward_start.date()} / "
          f"決済済み {len(closed)} 件 / 資産 {equity_now:,.0f} 円 "
          f"({equity_now / cfg.initial_capital - 1:+.1%}) / 同期間TOPIX {topix_ret:+.1%}")
    print(f"  [{rule}] 保有中: {len(open_pos)} ポジション"
          + (" — " + ", ".join(t.ticker for t in open_pos) if open_pos else ""))
    if todays:
        print(f"  [{rule}] 本日のシグナル(翌営業日寄付でエントリー候補・倍率順):")
        for t, ratio, stop in todays:
            print(f"    {t} {PRIMARY_UNIVERSE[t]}: 出来高倍率 {ratio:.1f}x / ストップ {stop:,.1f}")
    else:
        print(f"  [{rule}] 本日のシグナル: なし")

    if do_weekly:
        weekly_summary(rule, closed, open_pos, cfg, forward_start, topix_ret,
                       os.path.join(rule_dir, "summary_weekly.md"))

    for n in REVIEW_MILESTONES:
        path = os.path.join(rule_dir, f"review_{n}.md")
        if len(closed) >= n and not os.path.exists(path):
            milestone_review(rule, n, data, cfg, forward_start, closed, topix_ret, path)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Phase 2 フォワードテスト日次スキャン")
    ap.add_argument("--no-refresh", action="store_true",
                    help="データを再取得せずキャッシュのみで実行(オフライン検証用)")
    ap.add_argument("--weekly", action="store_true",
                    help="曜日にかかわらず週次サマリーを生成する(通常は金曜のみ)")
    ap.add_argument("--activate", metavar="RULE",
                    help="ルールをフォワードテストに追加する(そのルールの Gate 1 合格後のみ)")
    args = ap.parse_args(argv)

    os.makedirs(FORWARD_DIR, exist_ok=True)
    _migrate_legacy_layout()
    active = load_active_rules()

    if args.activate:
        rule = args.activate
        if rule not in RULE_PRESETS:
            print(f"未定義のルール: {rule}(定義済み: {sorted(RULE_PRESETS)})", file=sys.stderr)
            return 1
        if rule in active:
            print(f"{rule} はすでに有効です")
        else:
            active.append(rule)
            save_active_rules(active)
            load_state(rule)  # フォワード開始日を今日で固定
            print(f"{rule} をフォワードテストに追加しました(このコマンドはそのルールの "
                  f"Phase 1 Gate 1 合格を確認してから実行すること)")

    print(f"=== 日次スキャン {datetime.now().strftime('%Y-%m-%d %H:%M')} "
          f"(有効ルール: {', '.join(active)}) ===")
    # 全ルール中で最も長い履歴要件をカバーするため、取得は共通(cfg.start から)
    data = load_data(Config(), refresh=not args.no_refresh)
    latest = max(data[t].index[-1] for t in PRIMARY_UNIVERSE)
    print(f"  データ最終日: {latest.date()}")

    do_weekly = args.weekly or datetime.now().weekday() == 4
    for rule in active:
        scan_rule(rule, data, do_weekly)
    return 0


if __name__ == "__main__":
    sys.exit(main())
