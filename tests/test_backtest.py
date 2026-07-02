"""§8 実装の受け入れ基準(QA要件)の単体テスト。

合成データのみを使用し、ネットワークに依存しない。
実行: python -m unittest discover -s tests -v
"""

import math
import os
import sys
import unittest

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backtest import (  # noqa: E402
    Config,
    Universe,
    build_rule_events,
    compute_signals,
    run_engine,
    run_random_baseline,
    verify_no_lookahead,
)

CFG = Config()


def make_df(rows: list[dict], start: str = "2024-01-04") -> pd.DataFrame:
    dates = pd.bdate_range(start, periods=len(rows))
    return pd.DataFrame(rows, index=dates)


def base_rows(n: int = 21, price: float = 100.0, vol: float = 1000.0) -> list[dict]:
    """シグナルが出ない平坦な日々(陰線・通常出来高)。"""
    return [
        {"Open": price, "High": price + 1, "Low": price - 1, "Close": price - 0.5, "Volume": vol}
        for _ in range(n)
    ]


def with_signal(extra_rows: list[dict], sig_low: float = 99.0) -> pd.DataFrame:
    """20日平常 + 21日目にシグナル(出来高3倍・陽線, 安値 sig_low)+ extra_rows。"""
    rows = base_rows(20)
    rows.append({"Open": 100.0, "High": 106.0, "Low": sig_low, "Close": 105.0, "Volume": 3000.0})
    rows.extend(extra_rows)
    return make_df(rows)


def run_single(df: pd.DataFrame, cfg: Config = CFG, unit: bool = False):
    univ = Universe({"TEST.T": df})
    events = build_rule_events(univ, cfg)
    return run_engine(univ, events, cfg, unit_constraint=unit)


class TestSignal(unittest.TestCase):
    def test_signal_conditions(self):
        df = with_signal([])
        sig = compute_signals(df, CFG)
        self.assertTrue(sig["signal"].iloc[20])       # 出来高3000 >= 2×1000 かつ陽線
        self.assertFalse(sig["signal"].iloc[:20].any())  # 20日未満 or 条件不成立
        self.assertAlmostEqual(sig["vol_ratio"].iloc[20], 3.0)

    def test_volume_average_excludes_today(self):
        # 当日を含めた平均なら 21日目の平均が変わる。翌日にもう一度急増日を置いて確認。
        rows = base_rows(20)
        rows.append({"Open": 100, "High": 106, "Low": 99, "Close": 105, "Volume": 3000.0})
        # 22日目: 平均算出期間は 2〜21日目(1000×19 + 3000)/20 = 1100。当日含みなら異なる。
        rows.append({"Open": 100, "High": 106, "Low": 99, "Close": 105, "Volume": 2200.0})
        df = make_df(rows)
        sig = compute_signals(df, CFG)
        self.assertAlmostEqual(sig["vol_ratio"].iloc[21], 2200.0 / 1100.0)
        self.assertTrue(sig["signal"].iloc[21])

    def test_zero_volume_excluded(self):
        rows = base_rows(20)
        rows[10]["Volume"] = 0.0
        rows.append({"Open": 100, "High": 106, "Low": 99, "Close": 105, "Volume": 3000.0})
        df = make_df(rows)
        sig = compute_signals(df, CFG)
        self.assertFalse(sig["signal"].iloc[20])  # 平均算出期間に出来高0 → 除外


class TestExitLogic(unittest.TestCase):
    """§8-2 出口ロジック単体テスト(3ケース+ギャップアップ利確)。"""

    def test_case1_gap_down_stop_fills_at_open(self):
        # エントリー翌日に始値がストップ(99)を下回るギャップダウン → 始値で約定
        df = with_signal([
            {"Open": 104.0, "High": 105.0, "Low": 103.0, "Close": 104.0, "Volume": 1000.0},  # エントリー日
            {"Open": 95.0, "High": 96.0, "Low": 94.0, "Close": 95.0, "Volume": 1000.0},      # ギャップダウン
        ])
        res = run_single(df)
        self.assertEqual(len(res.trades), 1)
        t = res.trades[0]
        self.assertEqual(t.exit_reason, "stop")
        self.assertEqual(t.exit_price, 95.0)  # ストップ99ではなく始値95(不利な方)
        self.assertLess(t.r_multiple, -1.0)   # 1Rを超える損失

    def test_case2_same_day_both_stop_takes_priority(self):
        # 同一日に 安値<ストップ かつ 高値≥目標 → 損切り優先・ストップ価格約定
        entry_price = 104.0 * (1 + CFG.slippage_pct)     # 104.312
        target = entry_price + 2 * (entry_price - 99.0)  # ≈114.936
        df = with_signal([
            {"Open": 104.0, "High": 105.0, "Low": 103.0, "Close": 104.0, "Volume": 1000.0},
            {"Open": 105.0, "High": 116.0, "Low": 98.0, "Close": 100.0, "Volume": 1000.0},
        ])
        self.assertGreaterEqual(116.0, target)  # 両条件成立の前提確認
        res = run_single(df)
        t = res.trades[0]
        self.assertEqual(t.exit_reason, "stop")
        self.assertEqual(t.exit_price, 99.0)  # 始値はストップ上 → ストップ価格で約定

    def test_case3_time_exit_at_day5_close(self):
        flat = {"Open": 104.0, "High": 105.0, "Low": 100.0, "Close": 103.0, "Volume": 1000.0}
        last = {"Open": 104.0, "High": 105.0, "Low": 100.0, "Close": 102.5, "Volume": 1000.0}
        df = with_signal([flat, flat, flat, flat, last,
                          {"Open": 104.0, "High": 105.0, "Low": 100.0, "Close": 103.0, "Volume": 1000.0}])
        res = run_single(df)
        t = res.trades[0]
        self.assertEqual(t.exit_reason, "time")
        self.assertEqual(t.exit_price, 102.5)  # エントリー日を1日目として5営業日目の終値
        self.assertEqual(t.exit_date, df.index[25])  # エントリー=idx21 → 5日目=idx25

    def test_gap_up_target_fills_at_open(self):
        # 始値が目標を上回るギャップアップ → 始値で約定
        df = with_signal([
            {"Open": 104.0, "High": 105.0, "Low": 103.0, "Close": 104.0, "Volume": 1000.0},
            {"Open": 120.0, "High": 121.0, "Low": 118.0, "Close": 119.0, "Volume": 1000.0},
        ])
        res = run_single(df)
        t = res.trades[0]
        self.assertEqual(t.exit_reason, "target")
        self.assertEqual(t.exit_price, 120.0)

    def test_entry_invalidated_when_open_below_stop(self):
        # 翌営業日の寄付 ≤ ストップ価格 → シグナル失効
        df = with_signal([
            {"Open": 98.0, "High": 100.0, "Low": 97.0, "Close": 99.0, "Volume": 1000.0},
        ])
        res = run_single(df)
        self.assertEqual(len(res.trades), 0)


class TestSizing(unittest.TestCase):
    """§8-4 サイズ計算テスト(3ケース)。"""

    def test_min_stop_dist_skip(self):
        # ストップ距離 0.4/100.3 ≈ 0.40% < 0.5% → スキップ
        df = with_signal([
            {"Open": 100.0, "High": 101.0, "Low": 100.0, "Close": 100.5, "Volume": 1000.0},
        ], sig_low=99.9)
        res = run_single(df)
        self.assertEqual(len(res.trades), 0)

    def test_cash_cap_shrinks_position(self):
        # 資金10万円・リスク2% = 2,000円, ストップ距離 ≈ 1.312円 → 理論株数 ≈ 1,524株
        # 想定金額 ≈ 15.9万円 > 余力10万円 → 余力内に縮小
        cfg = Config()
        df = with_signal([
            {"Open": 104.0, "High": 105.0, "Low": 103.0, "Close": 104.0, "Volume": 1000.0},
            {"Open": 104.0, "High": 105.0, "Low": 100.0, "Close": 103.0, "Volume": 1000.0},
        ], sig_low=103.0)
        from dataclasses import replace
        cfg_small = replace(cfg, initial_capital=100_000.0, risk_pct=0.02)
        res = run_single(df, cfg=cfg_small)
        self.assertEqual(len(res.trades), 1)
        t = res.trades[0]
        entry = 104.0 * (1 + cfg.slippage_pct)
        expected_shares = 100_000.0 / (entry * (1 + cfg.cost_pct))
        self.assertAlmostEqual(t.shares, expected_shares, places=6)
        # ポジション金額(コスト込み)が余力以内であること
        self.assertLessEqual(t.shares * entry * (1 + cfg.cost_pct), 100_000.0 + 1e-6)

    def test_unit_constraint_floors_to_100(self):
        df = with_signal([
            {"Open": 104.0, "High": 105.0, "Low": 103.0, "Close": 104.0, "Volume": 1000.0},
            {"Open": 104.0, "High": 105.0, "Low": 100.0, "Close": 103.0, "Volume": 1000.0},
        ], sig_low=103.0)
        res_frac = run_single(df)
        res_unit = run_single(df, unit=True)
        self.assertEqual(len(res_unit.trades), 1)
        self.assertEqual(res_unit.trades[0].shares % 100, 0)
        self.assertEqual(
            res_unit.trades[0].shares,
            math.floor(res_frac.trades[0].shares / 100) * 100,
        )

    def test_unit_constraint_skips_when_below_100(self):
        # 高額株: リスク1%=10,000円, ストップ距離≈300円 → 33株 < 100株 → スキップ
        rows = [
            {"Open": 30000.0, "High": 30300.0, "Low": 29700.0, "Close": 29850.0, "Volume": 1000.0}
            for _ in range(20)
        ]
        rows.append({"Open": 30000.0, "High": 31800.0, "Low": 29700.0, "Close": 31500.0, "Volume": 3000.0})
        rows.append({"Open": 31200.0, "High": 31500.0, "Low": 30900.0, "Close": 31200.0, "Volume": 1000.0})
        rows.append({"Open": 31200.0, "High": 31500.0, "Low": 30900.0, "Close": 31200.0, "Volume": 1000.0})
        df = make_df(rows)
        self.assertEqual(len(run_single(df).trades), 1)        # 端株モードは建てられる
        self.assertEqual(len(run_single(df, unit=True).trades), 0)  # 単元制約はスキップ


class TestPortfolioRules(unittest.TestCase):
    def test_max_positions_and_volume_ratio_priority(self):
        # 4銘柄同日にシグナル → 出来高倍率の高い順に3銘柄のみ採用
        data = {}
        ratios = {"AAA.T": 4.0, "BBB.T": 5.0, "CCC.T": 2.5, "DDD.T": 3.0}
        for t, r in ratios.items():
            rows = base_rows(20)
            rows.append({"Open": 100.0, "High": 106.0, "Low": 99.0, "Close": 105.0,
                         "Volume": 1000.0 * r})
            for _ in range(6):
                rows.append({"Open": 104.0, "High": 105.0, "Low": 100.0, "Close": 103.0,
                             "Volume": 1000.0})
            data[t] = make_df(rows)
        univ = Universe(data)
        res = run_engine(univ, build_rule_events(univ, CFG), CFG)
        entered = {t.ticker for t in res.trades}
        self.assertEqual(entered, {"BBB.T", "AAA.T", "DDD.T"})  # 倍率 5.0, 4.0, 3.0 の順

    def test_no_duplicate_position(self):
        # 保有中に同銘柄の新規シグナル → 無視(トレードは1件のみ)
        rows = base_rows(20)
        rows.append({"Open": 100.0, "High": 106.0, "Low": 99.0, "Close": 105.0, "Volume": 3000.0})
        rows.append({"Open": 104.0, "High": 110.0, "Low": 103.0, "Close": 109.0, "Volume": 3300.0})  # 保有中の再シグナル
        for _ in range(6):
            rows.append({"Open": 104.0, "High": 105.0, "Low": 100.0, "Close": 103.0, "Volume": 1000.0})
        df = make_df(rows)
        res = run_single(df)
        self.assertEqual(len(res.trades), 1)


def synthetic_universe(seed: int = 7, n_days: int = 300, n_tickers: int = 4):
    """先読み検査・再現性テスト用のランダムだが決定的な合成ユニバース。"""
    rng = np.random.default_rng(seed)
    data = {}
    for k in range(n_tickers):
        dates = pd.bdate_range("2023-01-02", periods=n_days)
        ret = rng.normal(0.0005, 0.02, n_days)
        close = 1000.0 * np.exp(np.cumsum(ret))
        open_ = close * (1 + rng.normal(0, 0.008, n_days))
        high = np.maximum(open_, close) * (1 + np.abs(rng.normal(0, 0.008, n_days)))
        low = np.minimum(open_, close) * (1 - np.abs(rng.normal(0, 0.008, n_days)))
        vol = np.exp(rng.normal(np.log(1e6), 0.6, n_days))
        spikes = rng.random(n_days) < 0.06
        vol[spikes] *= 4.0
        data[f"SYN{k}.T"] = pd.DataFrame(
            {"Open": open_, "High": high, "Low": low, "Close": close, "Volume": vol},
            index=dates,
        )
    return data


class TestLookaheadAndReproducibility(unittest.TestCase):
    def test_no_lookahead_truncation(self):
        """§8-1: 末尾N日切り落とし再実行で残存期間のシグナル・トレードが完全一致。"""
        data = synthetic_universe()
        ok, msg = verify_no_lookahead(data, CFG, n_cut=30)
        self.assertTrue(ok, msg)

    def test_engine_reproducibility(self):
        """§8-3: 同一入力で出力が完全一致。"""
        data = synthetic_universe()
        outs = []
        for _ in range(2):
            univ = Universe(data)
            res = run_engine(univ, build_rule_events(univ, CFG), CFG)
            outs.append([
                (t.ticker, str(t.entry_date), t.entry_price, t.shares,
                 str(t.exit_date), t.exit_price, t.exit_reason, t.pnl_jpy)
                for t in res.trades
            ])
        self.assertGreater(len(outs[0]), 0)  # 検証が空振りしていないこと
        self.assertEqual(outs[0], outs[1])

    def test_random_baseline_reproducibility(self):
        """§8-3: 同一シードでモンテカルロ結果が完全一致。"""
        data = synthetic_universe()
        univ = Universe(data)
        r1 = run_random_baseline(univ, CFG, n_trades_target=10, n_trials=5,
                                 collect_curves=False)
        r2 = run_random_baseline(univ, CFG, n_trades_target=10, n_trials=5,
                                 collect_curves=False)
        np.testing.assert_array_equal(r1["finals"], r2["finals"])
        np.testing.assert_array_equal(r1["expectancies"], r2["expectancies"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
