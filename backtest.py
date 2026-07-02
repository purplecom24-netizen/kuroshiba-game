#!/usr/bin/env python3
"""「出来高+陽線」ルール検証システム v1.0 — Phase 1 バックテスト

docs/requirements_v1.md(事前登録 2026-07-02)の実装。
`python backtest.py` の1コマンドで 取得→検証→バックテスト→ベースライン→レポート を完走する。

仕様書が明示していない点の実装上の解釈(すべてレポートにも明記):
- 期間末に未決済のポジションは期間末の終値で強制決済し、出口理由 "eod" として台帳に記録する。
- Gate 1 判定は「主ユニバース・端株可(理論値モード)」の結果に対して行う。
  中立ユニバース・単元制約モードは併記(頑健性チェック)。
- データ品質の停止基準: 欠損率 > 5% / 出来高0の日数 > 10 / |日次リターン| > 35%。
  (|日次リターン| > 30% は異常値としてすべてリスト化する)
- 同一銘柄で保有中に出たシグナルは無視するが、同日中にポジションが決済された場合、
  翌営業日の新規シグナルはエントリー時点の保有状態(フラット)で判定する。
"""

from __future__ import annotations

import argparse
import io
import math
import os
import sys
from dataclasses import dataclass, field, replace
from datetime import datetime

import numpy as np
import pandas as pd

# ---------------------------------------------------------------------------
# 設定(事前登録値・変更禁止。変更する場合は docs/requirements_v1.md の変更履歴に記録)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Config:
    start: str = "2021-07-01"
    end: str | None = None            # None = 実行日まで
    vol_lookback: int = 20            # 平均出来高の営業日数(当日を含まない)
    vol_mult: float = 2.0             # 出来高倍率しきい値
    hold_days: int = 5                # 時間切れ: エントリー日を1日目として5営業日目の終値
    slippage_pct: float = 0.003      # 約定価格 = 寄付 × (1 + SLIPPAGE_PCT)
    cost_pct: float = 0.001          # 取引コスト片道0.1%
    min_stop_dist_pct: float = 0.005  # MIN_STOP_DIST_PCT
    risk_pct: float = 0.01            # 1トレードのリスク = 現在資産の1%
    initial_capital: float = 1_000_000.0
    max_positions: int = 3
    target_r: float = 2.0             # 利確 = エントリー + 2R
    seed: int = 42
    n_random_trials: int = 1000


# 主ユニバース(15銘柄・固定)
PRIMARY_UNIVERSE: dict[str, str] = {
    "5803.T": "フジクラ",
    "6315.T": "TOWA",
    "285A.T": "キオクシアHD",
    "5801.T": "古河電気工業",
    "6723.T": "ルネサスエレクトロニクス",
    "6754.T": "アンリツ",
    "4063.T": "信越化学工業",
    "5631.T": "日本製鋼所",
    "6506.T": "安川電機",
    "6954.T": "ファナック",
    "6857.T": "アドバンテスト",
    "6146.T": "ディスコ",
    "8035.T": "東京エレクトロン",
    "6920.T": "レーザーテック",
    "7735.T": "SCREENホールディングス",
}

# 中立ユニバース: TOPIX Core30 構成銘柄
# 注: 構成は定期入替(毎年10月)で変わる。以下は実装時点(2024年10月入替後)の近似リスト。
# 最新の構成に合わせる場合はこのリストのみを編集すること(ルール本体は変更しない)。
NEUTRAL_UNIVERSE: dict[str, str] = {
    "2914.T": "日本たばこ産業",
    "3382.T": "セブン&アイHD",
    "4063.T": "信越化学工業",
    "4502.T": "武田薬品工業",
    "4568.T": "第一三共",
    "6098.T": "リクルートHD",
    "6367.T": "ダイキン工業",
    "6501.T": "日立製作所",
    "6758.T": "ソニーグループ",
    "6857.T": "アドバンテスト",
    "6861.T": "キーエンス",
    "6954.T": "ファナック",
    "6981.T": "村田製作所",
    "7011.T": "三菱重工業",
    "7203.T": "トヨタ自動車",
    "7267.T": "ホンダ",
    "7741.T": "HOYA",
    "7974.T": "任天堂",
    "8001.T": "伊藤忠商事",
    "8031.T": "三井物産",
    "8035.T": "東京エレクトロン",
    "8058.T": "三菱商事",
    "8306.T": "三菱UFJ FG",
    "8316.T": "三井住友FG",
    "8411.T": "みずほFG",
    "8766.T": "東京海上HD",
    "9432.T": "NTT",
    "9433.T": "KDDI",
    "9983.T": "ファーストリテイリング",
    "9984.T": "ソフトバンクグループ",
}

TOPIX_ETF = "1306.T"

DATA_DIR = "data"
OUTPUT_DIR = "output"

# データ品質の停止基準(§7)
DQ_MAX_MISSING_RATE = 0.05
DQ_MAX_ZERO_VOLUME_DAYS = 10
DQ_LIST_RETURN_ABS = 0.30   # これを超える日次リターンをリスト化
DQ_HALT_RETURN_ABS = 0.35   # これを超えたら本体を実行せず停止


# ---------------------------------------------------------------------------
# データ取得(yfinance + CSVキャッシュ)
# ---------------------------------------------------------------------------


def fetch_ticker(ticker: str, cfg: Config, refresh: bool = False) -> pd.DataFrame:
    """日足を取得して data/ にキャッシュする。取得失敗は例外で停止(§6)。"""
    os.makedirs(DATA_DIR, exist_ok=True)
    cache = os.path.join(DATA_DIR, f"{ticker.replace('.', '_')}.csv")
    if os.path.exists(cache) and not refresh:
        df = pd.read_csv(cache, index_col=0, parse_dates=True)
        return df

    import yfinance as yf

    try:
        df = yf.Ticker(ticker).history(
            start=cfg.start, end=cfg.end, auto_adjust=True, interval="1d"
        )
    except Exception as e:  # ネットワーク・API エラーはスキップせず停止
        raise RuntimeError(f"データ取得失敗: {ticker} — {e}") from e
    if df is None or df.empty:
        raise RuntimeError(f"データ取得失敗: {ticker} — 空のデータが返されました")
    df.index = pd.DatetimeIndex(df.index.tz_localize(None)).normalize()
    df = df[~df.index.duplicated(keep="last")].sort_index()
    df.to_csv(cache)
    return df


def load_universe(tickers: list[str], cfg: Config, refresh: bool = False) -> dict[str, pd.DataFrame]:
    data = {}
    for t in tickers:
        df = fetch_ticker(t, cfg, refresh=refresh)
        need = {"Open", "High", "Low", "Close", "Volume"}
        missing = need - set(df.columns)
        if missing:
            raise RuntimeError(f"データ列不足: {t} — {missing}")
        data[t] = df
        print(f"  {t}: {len(df)} 行 ({df.index[0].date()} 〜 {df.index[-1].date()})")
    return data


# ---------------------------------------------------------------------------
# データ検証(§7)
# ---------------------------------------------------------------------------


def data_quality(data: dict[str, pd.DataFrame], names: dict[str, str]) -> tuple[str, bool]:
    """データ品質レポート(markdown 文字列)と severe フラグを返す。"""
    union = pd.DatetimeIndex(sorted(set().union(*[set(df.index) for df in data.values()])))
    lines = [
        "# データ検証レポート",
        "",
        f"- 生成日時: {datetime.now().strftime('%Y-%m-%d %H:%M')}",
        f"- 基準カレンダー: 全銘柄の営業日の和集合({len(union)} 日, "
        f"{union[0].date()} 〜 {union[-1].date()})",
        f"- 停止基準: 欠損率 > {DQ_MAX_MISSING_RATE:.0%} / 出来高0 > {DQ_MAX_ZERO_VOLUME_DAYS}日 / "
        f"|日次リターン| > {DQ_HALT_RETURN_ABS:.0%}",
        "",
        "| 銘柄 | 上場内データ開始 | 行数 | 欠損率 | 出来高0日数 | \\|リターン\\|>30% | 分割日 | 判定 |",
        "|---|---|---|---|---|---|---|---|",
    ]
    severe_msgs: list[str] = []
    anomaly_details: list[str] = []

    for t, df in data.items():
        span = union[(union >= df.index[0]) & (union <= df.index[-1])]
        missing_rate = 1.0 - len(df) / len(span) if len(span) else 0.0
        zero_vol = int((df["Volume"] == 0).sum())
        ret = df["Close"].pct_change()
        anomalies = ret[ret.abs() > DQ_LIST_RETURN_ABS].dropna()
        n_splits = 0
        split_issue = ""
        if "Stock Splits" in df.columns:
            split_days = df.index[df["Stock Splits"].fillna(0) != 0]
            n_splits = len(split_days)
            # auto_adjust の妥当性: 分割日当日の調整後リターンが不連続(>20%)なら調整ミスの疑い
            for d in split_days:
                r = ret.get(d)
                if r is not None and not math.isnan(r) and abs(r) > 0.20:
                    split_issue = f"分割日 {d.date()} の調整後リターン {r:+.1%}(調整ミスの疑い)"
        verdict = "OK"
        if missing_rate > DQ_MAX_MISSING_RATE:
            verdict = "NG"
            severe_msgs.append(f"{t}: 欠損率 {missing_rate:.1%} > {DQ_MAX_MISSING_RATE:.0%}")
        if zero_vol > DQ_MAX_ZERO_VOLUME_DAYS:
            verdict = "NG"
            severe_msgs.append(f"{t}: 出来高0が {zero_vol} 日")
        if (anomalies.abs() > DQ_HALT_RETURN_ABS).any():
            verdict = "NG"
            worst = anomalies.abs().max()
            severe_msgs.append(f"{t}: |日次リターン| 最大 {worst:.1%} > {DQ_HALT_RETURN_ABS:.0%}")
        if split_issue:
            verdict = "NG"
            severe_msgs.append(f"{t}: {split_issue}")
        for d, r in anomalies.items():
            anomaly_details.append(f"- {t} {names.get(t, '')} {d.date()}: {r:+.1%}")
        lines.append(
            f"| {t} {names.get(t, '')} | {df.index[0].date()} | {len(df)} | "
            f"{missing_rate:.2%} | {zero_vol} | {len(anomalies)} | {n_splits} | {verdict} |"
        )

    lines += ["", "## 日次リターン ±30% 超の異常値リスト", ""]
    lines += anomaly_details if anomaly_details else ["- なし"]
    if severe_msgs:
        lines += ["", "## 重大な異常(本体実行を停止)", ""] + [f"- {m}" for m in severe_msgs]
    else:
        lines += ["", "重大な異常なし。本体実行を許可。"]
    return "\n".join(lines) + "\n", bool(severe_msgs)


# ---------------------------------------------------------------------------
# シグナル生成(§2.2)
# ---------------------------------------------------------------------------


def compute_signals(df: pd.DataFrame, cfg: Config) -> pd.DataFrame:
    """日足からシグナル列を計算する。当日以前のデータのみに依存する。"""
    vol = df["Volume"].astype(float)
    prev = vol.shift(1)  # 当日を含まない
    avg = prev.rolling(cfg.vol_lookback, min_periods=cfg.vol_lookback).mean()
    mn = prev.rolling(cfg.vol_lookback, min_periods=cfg.vol_lookback).min()
    price_ok = df[["Open", "High", "Low", "Close"]].notna().all(axis=1)
    valid = avg.notna() & (mn > 0) & (vol > 0) & price_ok
    ratio = vol / avg
    sig = valid & (vol >= cfg.vol_mult * avg) & (df["Close"] > df["Open"])
    return pd.DataFrame({"signal": sig, "vol_ratio": ratio, "stop": df["Low"]}, index=df.index)


# ---------------------------------------------------------------------------
# バックテストエンジン(§2.3〜2.5)
# ---------------------------------------------------------------------------


class TickerData:
    __slots__ = ("ticker", "dates", "pos", "o", "h", "l", "c")

    def __init__(self, ticker: str, df: pd.DataFrame):
        self.ticker = ticker
        self.dates = df.index
        self.pos = {d: i for i, d in enumerate(df.index)}
        self.o = df["Open"].to_numpy(float)
        self.h = df["High"].to_numpy(float)
        self.l = df["Low"].to_numpy(float)
        self.c = df["Close"].to_numpy(float)


class Universe:
    """エンジンが使う前処理済みデータ一式。"""

    def __init__(self, data: dict[str, pd.DataFrame]):
        self.raw = data
        self.td = {t: TickerData(t, df) for t, df in data.items()}
        self.union = pd.DatetimeIndex(
            sorted(set().union(*[set(df.index) for df in data.values()]))
        )
        # 評価用: 和集合カレンダー上に前方補完した終値
        self.close_u = {
            t: df["Close"].reindex(self.union).ffill().to_numpy(float)
            for t, df in data.items()
        }


@dataclass
class Event:
    """エントリー候補。rule では priority=(-出来高倍率, ティッカー)、
    random では priority=(サンプル順,) — いずれも決定的。"""
    signal_date: pd.Timestamp
    ticker: str
    entry_idx: int          # ティッカー固有カレンダー上のエントリー日 index
    entry_date: pd.Timestamp
    stop: float             # シグナル日(random: エントリー前日)の安値
    priority: tuple


@dataclass
class Trade:
    ticker: str
    signal_date: pd.Timestamp
    entry_date: pd.Timestamp
    entry_price: float
    shares: float
    stop_price: float
    exit_date: pd.Timestamp
    exit_price: float
    exit_reason: str        # stop / target / time / eod
    r_multiple: float
    pnl_jpy: float
    equity_after: float


@dataclass
class Position:
    ticker: str
    signal_date: pd.Timestamp
    entry_date: pd.Timestamp
    entry_price: float
    shares: float
    stop: float
    target: float
    days: int = 0           # エントリー日を1日目とする経過営業日数(銘柄固有カレンダー)


@dataclass
class BTResult:
    trades: list[Trade]
    equity: np.ndarray      # 和集合カレンダー上の日次時価評価資産
    dates: pd.DatetimeIndex
    final_equity: float
    unit_constraint: bool


def build_rule_events(univ: Universe, cfg: Config) -> list[Event]:
    events: list[Event] = []
    for t, df in univ.raw.items():
        sig = compute_signals(df, cfg)
        idx = df.index
        flags = sig["signal"].to_numpy()
        for i in np.flatnonzero(flags):
            if i + 1 >= len(idx):
                continue  # 最終日のシグナルは翌営業日が無いためエントリー不能
            events.append(
                Event(
                    signal_date=idx[i],
                    ticker=t,
                    entry_idx=i + 1,
                    entry_date=idx[i + 1],
                    stop=float(sig["stop"].iloc[i]),
                    priority=(-float(sig["vol_ratio"].iloc[i]), t),
                )
            )
    events.sort(key=lambda e: (e.entry_date, e.priority))
    return events


def _check_exit(pos: Position, o: float, h: float, l: float, c: float,
                cfg: Config) -> tuple[float, str] | None:
    """出口判定(§2.4 最先着優先・同日両到達は損切り優先)。"""
    if l < pos.stop:  # 損切り(ギャップダウンは始値約定=不利な方)
        return (o if o < pos.stop else pos.stop), "stop"
    if h >= pos.target:  # 利確(ギャップアップは始値約定=有利な方)
        return (o if o > pos.target else pos.target), "target"
    if pos.days >= cfg.hold_days:  # 時間切れ
        return c, "time"
    return None


def run_engine(
    univ: Universe,
    events: list[Event],
    cfg: Config,
    unit_constraint: bool = False,
    entry_budget: int | None = None,
) -> BTResult:
    """イベント列(rule または random)を同一の執行・出口・サイズ規則で処理する。"""
    by_entry_date: dict[pd.Timestamp, list[Event]] = {}
    for ev in events:
        by_entry_date.setdefault(ev.entry_date, []).append(ev)

    cash = cfg.initial_capital
    realized_equity = cfg.initial_capital  # 決済済みトレードを反映した現在資産
    positions: dict[str, Position] = {}
    trades: list[Trade] = []
    equity = np.empty(len(univ.union))
    budget = entry_budget

    def close_position(pos: Position, exit_date: pd.Timestamp, price: float, reason: str):
        nonlocal cash, realized_equity
        proceeds = pos.shares * price * (1 - cfg.cost_pct)
        cost_basis = pos.shares * pos.entry_price * (1 + cfg.cost_pct)
        pnl = proceeds - cost_basis
        cash += proceeds
        realized_equity += pnl
        risk_amt = pos.shares * (pos.entry_price - pos.stop)
        trades.append(
            Trade(
                ticker=pos.ticker,
                signal_date=pos.signal_date,
                entry_date=pos.entry_date,
                entry_price=pos.entry_price,
                shares=pos.shares,
                stop_price=pos.stop,
                exit_date=exit_date,
                exit_price=price,
                exit_reason=reason,
                r_multiple=pnl / risk_amt if risk_amt > 0 else 0.0,
                pnl_jpy=pnl,
                equity_after=realized_equity,
            )
        )

    for d_i, date in enumerate(univ.union):
        # 1) 既存ポジションの出口判定(銘柄コード順=決定的)
        for t in sorted(positions):
            pos = positions[t]
            td = univ.td[t]
            i = td.pos.get(date)
            if i is None:
                continue
            o, h, l, c = td.o[i], td.h[i], td.l[i], td.c[i]
            if any(map(math.isnan, (o, h, l, c))):
                continue
            pos.days += 1
            res = _check_exit(pos, o, h, l, c, cfg)
            if res is not None:
                price, reason = res
                close_position(pos, date, price, reason)
                del positions[t]

        # 2) 新規エントリー(同日複数シグナルは出来高倍率の高い順)
        for ev in sorted(by_entry_date.get(date, []), key=lambda e: e.priority):
            if budget is not None and budget <= 0:
                break
            if ev.ticker in positions:  # 重複建て禁止
                continue
            if len(positions) >= cfg.max_positions:  # 最大同時保有
                break
            td = univ.td[ev.ticker]
            raw_open = td.o[ev.entry_idx]
            if math.isnan(raw_open) or math.isnan(ev.stop):
                continue
            if raw_open <= ev.stop:  # シグナル失効(寄付がストップ以下)
                continue
            entry_price = raw_open * (1 + cfg.slippage_pct)
            stop_dist = entry_price - ev.stop
            if stop_dist / entry_price < cfg.min_stop_dist_pct:  # サイズ暴発防止
                continue
            # サイズ: 決済済み資産の1%リスク
            shares = (realized_equity * cfg.risk_pct) / stop_dist
            if unit_constraint:
                shares = math.floor(shares / 100) * 100
            # 現金余力チェック(超える場合は余力内に縮小)
            unit_cost = entry_price * (1 + cfg.cost_pct)
            if shares * unit_cost > cash:
                shares = cash / unit_cost
                if unit_constraint:
                    shares = math.floor(shares / 100) * 100
            if shares <= 0:
                continue
            cash -= shares * unit_cost
            pos = Position(
                ticker=ev.ticker,
                signal_date=ev.signal_date,
                entry_date=date,
                entry_price=entry_price,
                shares=shares,
                stop=ev.stop,
                target=entry_price + cfg.target_r * stop_dist,
                days=1,
            )
            if budget is not None:
                budget -= 1
            # エントリー当日も損切り・利確判定の対象(§2.4)
            o, h, l, c = td.o[ev.entry_idx], td.h[ev.entry_idx], td.l[ev.entry_idx], td.c[ev.entry_idx]
            res = _check_exit(pos, o, h, l, c, cfg)
            if res is not None:
                price, reason = res
                # エントリーは寄付なので、当日のギャップ約定条項は適用されない
                # (open <= stop なら失効済み / open > target は entry_price < target のため起こらない)
                positions[ev.ticker] = pos
                close_position(pos, date, price, reason)
                del positions[ev.ticker]
            else:
                positions[ev.ticker] = pos

        # 3) 日次時価評価(現金 + 保有時価)
        equity[d_i] = cash + sum(
            p.shares * univ.close_u[p.ticker][d_i] for p in positions.values()
        )

    # 期間末の未決済ポジションは期間末終値で強制決済(reason=eod)
    last_date = univ.union[-1]
    for t in sorted(positions):
        pos = positions[t]
        close_position(pos, last_date, float(univ.close_u[t][-1]), "eod")
    positions.clear()
    if len(equity):
        equity[-1] = cash

    return BTResult(
        trades=trades,
        equity=equity,
        dates=univ.union,
        final_equity=float(equity[-1]) if len(equity) else cfg.initial_capital,
        unit_constraint=unit_constraint,
    )


# ---------------------------------------------------------------------------
# 統計・Gate 判定(§4)
# ---------------------------------------------------------------------------


@dataclass
class Stats:
    n_trades: int
    win_rate: float
    avg_win_r: float
    avg_loss_r: float
    expectancy_r: float
    profit_factor: float
    max_dd: float
    final_equity: float
    total_return: float


def compute_stats(res: BTResult, cfg: Config) -> Stats:
    rs = np.array([t.r_multiple for t in res.trades])
    pnl = np.array([t.pnl_jpy for t in res.trades])
    wins = pnl > 0
    peak = np.maximum.accumulate(res.equity)
    max_dd = float(np.max(1.0 - res.equity / peak)) if len(res.equity) else 0.0
    gross_win = pnl[wins].sum()
    gross_loss = -pnl[~wins].sum()
    return Stats(
        n_trades=len(res.trades),
        win_rate=float(wins.mean()) if len(pnl) else 0.0,
        avg_win_r=float(rs[wins].mean()) if wins.any() else 0.0,
        avg_loss_r=float(rs[~wins].mean()) if (~wins).any() else 0.0,
        expectancy_r=float(rs.mean()) if len(rs) else 0.0,
        profit_factor=float(gross_win / gross_loss) if gross_loss > 0 else float("inf"),
        max_dd=max_dd,
        final_equity=res.final_equity,
        total_return=res.final_equity / cfg.initial_capital - 1.0,
    )


@dataclass
class GateResult:
    decidable: bool
    passed: bool
    checks: list[tuple[str, bool | None, str]]  # (項目, 合否, 詳細)


def evaluate_gate1(stats: Stats, random_finals: np.ndarray) -> GateResult:
    checks: list[tuple[str, bool | None, str]] = []
    c1 = stats.n_trades >= 100
    checks.append(("トレード数 ≥ 100", c1, f"{stats.n_trades} 件"))
    if not c1:
        checks.append(("期待値R > 0", None, "判定不能(検出力不足)"))
        checks.append(("ランダム分布95%ile以上", None, "判定不能(検出力不足)"))
        checks.append(("最大DD ≤ 25%", None, "判定不能(検出力不足)"))
        return GateResult(decidable=False, passed=False, checks=checks)
    c2 = stats.expectancy_r > 0
    checks.append(("期待値R > 0(コスト控除後)", c2, f"{stats.expectancy_r:+.3f} R"))
    p95 = float(np.percentile(random_finals, 95))
    c3 = stats.final_equity >= p95
    pct_rank = float((random_finals <= stats.final_equity).mean() * 100)
    checks.append(
        ("最終資産がランダム分布の95%ile以上", c3,
         f"ルール {stats.final_equity:,.0f} 円 / 95%ile {p95:,.0f} 円 / 位置 {pct_rank:.1f}%ile")
    )
    c4 = stats.max_dd <= 0.25
    checks.append(("最大DD ≤ 25%", c4, f"{stats.max_dd:.1%}"))
    return GateResult(decidable=True, passed=c2 and c3 and c4, checks=checks)


# ---------------------------------------------------------------------------
# ベースライン(§3)
# ---------------------------------------------------------------------------


def run_topix_baseline(df: pd.DataFrame, univ: Universe, cfg: Config) -> tuple[np.ndarray, float]:
    """ベースラインA: 1306.T を期間初日の寄付で全額買い、期間末終値で評価(コスト等なし・仕様どおり)。"""
    first_open = float(df["Open"].iloc[0])
    units = cfg.initial_capital / first_open
    curve = (df["Close"] * units).reindex(univ.union).ffill().bfill().to_numpy(float)
    return curve, float(curve[-1])


def build_random_events(univ: Universe, rng: np.random.Generator, n: int,
                        start_counter: int) -> tuple[list[Event], int]:
    """一様ランダムな (銘柄, 営業日) から n 個のイベント候補を決定的に生成する。"""
    tickers = sorted(univ.td)
    events: list[Event] = []
    k = start_counter
    made = 0
    guard = 0
    while made < n and guard < n * 50:
        guard += 1
        t = tickers[int(rng.integers(len(tickers)))]
        td = univ.td[t]
        if len(td.dates) < 2:
            continue
        i = int(rng.integers(len(td.dates) - 1))  # 翌営業日が存在する日
        stop = td.l[i]
        if math.isnan(stop) or math.isnan(td.o[i + 1]):
            continue
        events.append(
            Event(
                signal_date=td.dates[i],
                ticker=t,
                entry_idx=i + 1,
                entry_date=td.dates[i + 1],
                stop=float(stop),
                priority=(k,),
            )
        )
        k += 1
        made += 1
    return events, k


def run_random_baseline(
    univ: Universe, cfg: Config, n_trades_target: int, n_trials: int | None = None,
    collect_curves: bool = True,
) -> dict:
    """ベースラインB: ランダムエントリー×同一出口のモンテカルロ(シード固定・§3.2)。"""
    n_trials = n_trials or cfg.n_random_trials
    finals = np.empty(n_trials)
    expectancies = np.empty(n_trials)
    curves = np.empty((n_trials, len(univ.union))) if collect_curves else None
    for trial in range(n_trials):
        rng = np.random.default_rng([cfg.seed, trial])
        events: list[Event] = []
        counter = 0
        res = None
        for _round in range(20):
            chunk, counter = build_random_events(
                univ, rng, max(50, n_trades_target * 2), counter
            )
            events.extend(chunk)
            events.sort(key=lambda e: (e.entry_date, e.priority))
            res = run_engine(univ, events, cfg, entry_budget=n_trades_target)
            if len(res.trades) >= n_trades_target:
                break
        assert res is not None
        finals[trial] = res.final_equity
        expectancies[trial] = (
            float(np.mean([t.r_multiple for t in res.trades])) if res.trades else 0.0
        )
        if curves is not None:
            curves[trial] = res.equity
    return {"finals": finals, "expectancies": expectancies, "curves": curves}


# ---------------------------------------------------------------------------
# 先読みバイアス検査(§8-1)
# ---------------------------------------------------------------------------


def verify_no_lookahead(data: dict[str, pd.DataFrame], cfg: Config, n_cut: int = 30) -> tuple[bool, str]:
    """データ末尾を n_cut 営業日切り落として再実行し、残存期間のシグナル・トレードの
    完全一致を確認する。境界時点で未決済だったトレードは比較対象外(切り落とし側では
    強制決済になるため)。"""
    univ_full = Universe(data)
    boundary = univ_full.union[-(n_cut + 1)]
    data_cut = {t: df[df.index <= boundary] for t, df in data.items()}
    data_cut = {t: df for t, df in data_cut.items() if len(df) > 0}
    univ_cut = Universe(data_cut)

    # シグナル一致(共通期間)
    for t, df in data_cut.items():
        s_full = compute_signals(data[t], cfg)["signal"].reindex(df.index)
        s_cut = compute_signals(df, cfg)["signal"]
        if not s_full.equals(s_cut):
            return False, f"シグナル不一致: {t}"

    def key(tr: Trade):
        return (tr.ticker, str(tr.signal_date), str(tr.entry_date), round(tr.entry_price, 6),
                round(tr.shares, 6), str(tr.exit_date), round(tr.exit_price, 6), tr.exit_reason)

    res_full = run_engine(univ_full, build_rule_events(univ_full, cfg), cfg)
    res_cut = run_engine(univ_cut, build_rule_events(univ_cut, cfg), cfg)
    full_k = [key(t) for t in res_full.trades
              if t.exit_date <= boundary and t.exit_reason != "eod"]
    cut_k = [key(t) for t in res_cut.trades
             if t.exit_date <= boundary and t.exit_reason != "eod"]
    # 境界直前にエントリーし境界までに決済されたものまでが比較対象
    if full_k != cut_k:
        return False, f"トレード不一致: full={len(full_k)} cut={len(cut_k)}"
    return True, f"OK(共通期間のシグナル完全一致・決済済みトレード {len(full_k)} 件一致)"


# ---------------------------------------------------------------------------
# レポート(§5)
# ---------------------------------------------------------------------------

# チャート配色(CVD 検証済みパレット)
C_RULE = "#2a78d6"     # ルール資産曲線
C_TOPIX = "#1baf7a"    # TOPIX
C_MARK = "#e34948"     # ルール位置マーカー
C_BAND = "#e1e0d9"     # ランダム帯
C_MUTED = "#898781"
C_INK = "#52514e"
C_SURFACE = "#fcfcfb"


def write_trades_csv(res: BTResult, names: dict[str, str], path: str):
    rows = []
    for t in res.trades:
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


def yearly_table(res: BTResult) -> str:
    if not res.trades:
        return "(トレードなし)"
    df = pd.DataFrame({
        "year": [t.exit_date.year for t in res.trades],
        "pnl": [t.pnl_jpy for t in res.trades],
        "r": [t.r_multiple for t in res.trades],
    })
    lines = ["| 年 | トレード数 | 勝率 | 期待値R | 損益円 |", "|---|---|---|---|---|"]
    for y, g in df.groupby("year"):
        lines.append(
            f"| {y} | {len(g)} | {(g['pnl'] > 0).mean():.1%} | "
            f"{g['r'].mean():+.3f} | {g['pnl'].sum():+,.0f} |"
        )
    return "\n".join(lines)


def stats_row(label: str, s: Stats) -> str:
    pf = f"{s.profit_factor:.2f}" if math.isfinite(s.profit_factor) else "∞"
    return (f"| {label} | {s.n_trades} | {s.win_rate:.1%} | {s.avg_win_r:+.3f} | "
            f"{s.avg_loss_r:+.3f} | {s.expectancy_r:+.3f} | {pf} | {s.max_dd:.1%} | "
            f"{s.final_equity:,.0f} | {s.total_return:+.1%} |")


def write_summary(
    cfg: Config,
    results: dict[str, tuple[BTResult, Stats]],
    gate: GateResult,
    topix_final: float,
    rnd_main: dict,
    rnd_neutral: dict,
    lookahead_msg: str,
    path: str,
):
    (res_main, s_main) = results["主・端株可"]
    eod_n = sum(1 for t in res_main.trades if t.exit_reason == "eod")
    pct_rank = float((rnd_main["finals"] <= s_main.final_equity).mean() * 100)
    exp_pct_rank = float(
        (rnd_main["expectancies"] <= s_main.expectancy_r).mean() * 100
    )
    lines = [
        "# 検証サマリー: 「出来高+陽線」ルール v1.0(Phase 1 バックテスト)",
        "",
        f"- 実行日時: {datetime.now().strftime('%Y-%m-%d %H:%M')}",
        f"- 検証期間: {cfg.start} 〜 {res_main.dates[-1].date()}",
        f"- パラメータ: 出来高倍率 {cfg.vol_mult} / 平均 {cfg.vol_lookback}日 / 保有 {cfg.hold_days}営業日 / "
        f"スリッページ {cfg.slippage_pct:.1%} / コスト片道 {cfg.cost_pct:.1%} / "
        f"最小ストップ距離 {cfg.min_stop_dist_pct:.1%} / リスク {cfg.risk_pct:.0%} / 最大 {cfg.max_positions} 枠",
        f"- モンテカルロ試行数: {len(rnd_main['finals'])} / シード {cfg.seed}",
        "",
        "## Gate 1 判定結果",
        "",
    ]
    if not gate.decidable:
        lines.append("**判定: 検出力不足・判定不能**(トレード数 < 100 のため合否を出さない)")
    elif gate.passed:
        lines.append("**判定: 合格** — Phase 2(フォワードテスト)の実装に進むことができる。")
    else:
        lines.append("**判定: 不合格 → ルール棄却。Phase 2 は実装しない。**")
    lines += ["", "| 条件 | 合否 | 詳細 |", "|---|---|---|"]
    for name, ok, detail in gate.checks:
        mark = "—" if ok is None else ("PASS" if ok else "FAIL")
        lines.append(f"| {name} | {mark} | {detail} |")
    lines += [
        "",
        "> Gate 1 判定は主ユニバース・端株可(理論値モード)の結果に対して行う。",
        "",
        "## 成績一覧(ユニバース別 / 単元制約別)",
        "",
        "| 系列 | トレード数 | 勝率 | 平均利益R | 平均損失R | 期待値R | PF | 最大DD | 最終資産 | 総リターン |",
        "|---|---|---|---|---|---|---|---|---|---|",
    ]
    for label, (_r, s) in results.items():
        lines.append(stats_row(label, s))
    lines += [
        "",
        "## ベースライン比較",
        "",
        f"- ベースラインA(TOPIX 1306.T バイ&ホールド): 最終資産 {topix_final:,.0f} 円 "
        f"({topix_final / cfg.initial_capital - 1:+.1%})",
        f"- ベースラインB(ランダム×同一出口, 主ユニバース): 最終資産の中央値 "
        f"{np.median(rnd_main['finals']):,.0f} 円 / 95%ile {np.percentile(rnd_main['finals'], 95):,.0f} 円",
        f"- ルール最終資産のランダム分布内位置: **{pct_rank:.1f} パーセンタイル**",
        f"- ルール期待値Rのランダム分布内位置: {exp_pct_rank:.1f} パーセンタイル",
        f"- (中立ユニバース)ルール位置: "
        f"{float((rnd_neutral['finals'] <= results['中立・端株可'][1].final_equity).mean() * 100):.1f} パーセンタイル",
        "",
        "## 年次別成績(主ユニバース・端株可)",
        "",
        yearly_table(res_main),
        "",
        "## QA・前提の明記",
        "",
        f"- 先読みバイアス検査(末尾切り落とし再実行): {lookahead_msg}",
        "- 同一日に損切りと利確の両条件に到達した場合は**損切りを優先**する保守的仮定を採用(§2.4)。",
        f"- 期間末未決済ポジションは期間末終値で強制決済(出口理由 eod, 該当 {eod_n} 件)。統計に含む。",
        "- ベースラインAには執行コストを課していない(仕様の文言どおり寄付買い→終値評価)。",
        "",
        "## 既知の限界(必読)",
        "",
        "- **選択バイアス(勝者バイアス)**: 主ユニバースは 2024〜26 年に大きく上昇した銘柄を"
        "「現在の知識で」選んでおり、好成績が出ても割り引いて解釈すること(§2.1)。"
        "頑健性チェックとして中立ユニバース(TOPIX Core30)の結果を上表に併記した。",
        "- パラメータを変更して再テストする場合、それは「別の新ルール」である。同一データで良い結果が"
        "出るまで探索する行為は過剰適合(データスヌーピング)である(§4)。",
        "- `output/sensitivity.md` は探索的分析であり Gate 判定には使用しない。",
        "- 本検証は仮想資金のみを扱い、投資判断を提供するものではない。",
        "",
    ]
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))


def plot_equity_curve(res: BTResult, topix_curve: np.ndarray, rnd: dict, cfg: Config, path: str):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    dates = res.dates
    fig, ax = plt.subplots(figsize=(10, 5.5), dpi=150)
    fig.patch.set_facecolor(C_SURFACE)
    ax.set_facecolor(C_SURFACE)
    if rnd["curves"] is not None:
        lo = np.percentile(rnd["curves"], 5, axis=0)
        hi = np.percentile(rnd["curves"], 95, axis=0)
        med = np.percentile(rnd["curves"], 50, axis=0)
        ax.fill_between(dates, lo, hi, color=C_BAND, label="Random 5-95% band", zorder=1)
        ax.plot(dates, med, color=C_MUTED, lw=1.0, label="Random median", zorder=2)
    ax.plot(dates, topix_curve, color=C_TOPIX, lw=2.0, label="TOPIX (1306.T) B&H", zorder=3)
    ax.plot(dates, res.equity, color=C_RULE, lw=2.2, label="Rule (volume + bullish candle)", zorder=4)
    # 直接ラベル(コントラスト警告のある aqua への救済)
    ax.annotate("Rule", xy=(dates[-1], res.equity[-1]), xytext=(6, 0),
                textcoords="offset points", color=C_RULE, fontsize=9, va="center")
    ax.annotate("TOPIX", xy=(dates[-1], topix_curve[-1]), xytext=(6, 0),
                textcoords="offset points", color="#128057", fontsize=9, va="center")
    ax.axhline(cfg.initial_capital, color=C_MUTED, lw=0.8, ls=":")
    ax.set_title("Equity curve: rule vs TOPIX vs random-entry band", color="#0b0b0b", fontsize=12)
    ax.set_ylabel("Equity (JPY)", color=C_INK)
    ax.grid(axis="y", color=C_BAND, lw=0.7)
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
    for s in ("left", "bottom"):
        ax.spines[s].set_color("#c3c2b7")
    ax.tick_params(colors=C_INK)
    ax.yaxis.set_major_formatter(lambda v, _: f"{v:,.0f}")
    ax.legend(loc="upper left", frameon=False, fontsize=9)
    fig.tight_layout()
    fig.savefig(path, facecolor=C_SURFACE)
    plt.close(fig)


def plot_random_dist(rule_final: float, rnd: dict, cfg: Config, path: str):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    finals = rnd["finals"]
    p95 = np.percentile(finals, 95)
    pct_rank = (finals <= rule_final).mean() * 100
    fig, ax = plt.subplots(figsize=(10, 5), dpi=150)
    fig.patch.set_facecolor(C_SURFACE)
    ax.set_facecolor(C_SURFACE)
    ax.hist(finals, bins=40, color=C_RULE, edgecolor=C_SURFACE, lw=0.8, zorder=2)
    ax.axvline(p95, color=C_MUTED, lw=1.2, ls="--", zorder=3)
    ax.annotate("95th %ile", xy=(p95, ax.get_ylim()[1]), xytext=(4, -12),
                textcoords="offset points", color=C_MUTED, fontsize=9)
    ax.axvline(rule_final, color=C_MARK, lw=2.0, zorder=4)
    ax.annotate(f"Rule: {rule_final:,.0f} JPY\n({pct_rank:.1f} %ile)",
                xy=(rule_final, ax.get_ylim()[1] * 0.92), xytext=(6, 0),
                textcoords="offset points", color=C_MARK, fontsize=9)
    ax.set_title(f"Random-entry final equity distribution ({len(finals)} trials, seed={cfg.seed})",
                 color="#0b0b0b", fontsize=12)
    ax.set_xlabel("Final equity (JPY)", color=C_INK)
    ax.set_ylabel("Trials", color=C_INK)
    ax.grid(axis="y", color=C_BAND, lw=0.7)
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
    for s in ("left", "bottom"):
        ax.spines[s].set_color("#c3c2b7")
    ax.tick_params(colors=C_INK)
    ax.xaxis.set_major_formatter(lambda v, _: f"{v:,.0f}")
    fig.tight_layout()
    fig.savefig(path, facecolor=C_SURFACE)
    plt.close(fig)


def write_sensitivity(data: dict[str, pd.DataFrame], cfg: Config, path: str):
    lines = [
        "# 感度分析",
        "",
        "**本分析は探索的分析であり Gate 判定には使用しない。**",
        "パラメータを変えた各行は事前登録ルールとは別のルールであり、良い組合せを選ぶ行為は",
        "過剰適合(データスヌーピング)である(§4・§10)。",
        "",
        "主ユニバース・端株可(理論値モード)・モンテカルロなし。",
        "",
        "| 出来高倍率 | 保有日数 | スリッページ | トレード数 | 勝率 | 期待値R | 最大DD | 最終資産 |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for vm in (1.5, 2.0, 3.0):
        for hd in (3, 5, 10):
            for sl in (0.001, 0.003, 0.005):
                c = replace(cfg, vol_mult=vm, hold_days=hd, slippage_pct=sl)
                univ = Universe(data)
                res = run_engine(univ, build_rule_events(univ, c), c)
                s = compute_stats(res, c)
                lines.append(
                    f"| {vm} | {hd} | {sl:.1%} | {s.n_trades} | {s.win_rate:.1%} | "
                    f"{s.expectancy_r:+.3f} | {s.max_dd:.1%} | {s.final_equity:,.0f} |"
                )
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


# ---------------------------------------------------------------------------
# メイン
# ---------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="「出来高+陽線」ルール検証 Phase 1 バックテスト")
    ap.add_argument("--refresh", action="store_true", help="CSVキャッシュを無視して再取得する")
    ap.add_argument("--trials", type=int, default=None, help="モンテカルロ試行数(デフォルト1000)")
    ap.add_argument("--qa-truncate", type=int, default=30,
                    help="先読み検査で切り落とす末尾営業日数(0で省略)")
    ap.add_argument("--skip-sensitivity", action="store_true", help="感度分析を省略する")
    args = ap.parse_args(argv)

    cfg = Config()
    if args.trials:
        cfg = replace(cfg, n_random_trials=args.trials)
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    print("=== 1/7 データ取得(主ユニバース + 中立ユニバース + TOPIX ETF) ===")
    all_tickers = sorted(set(PRIMARY_UNIVERSE) | set(NEUTRAL_UNIVERSE) | {TOPIX_ETF})
    all_names = {**PRIMARY_UNIVERSE, **NEUTRAL_UNIVERSE, TOPIX_ETF: "TOPIX連動ETF"}
    data_all = load_universe(all_tickers, cfg, refresh=args.refresh)

    print("=== 2/7 データ検証 ===")
    dq_md, severe = data_quality(data_all, all_names)
    with open(os.path.join(OUTPUT_DIR, "data_quality.md"), "w", encoding="utf-8") as f:
        f.write(dq_md)
    print(f"  -> {OUTPUT_DIR}/data_quality.md")
    if severe:
        print("重大なデータ異常を検出したため本体を実行せず停止します。"
              f"{OUTPUT_DIR}/data_quality.md を確認してください。", file=sys.stderr)
        return 1

    data_main = {t: data_all[t] for t in PRIMARY_UNIVERSE}
    data_neutral = {t: data_all[t] for t in NEUTRAL_UNIVERSE}

    print("=== 3/7 先読みバイアス検査 ===")
    if args.qa_truncate > 0:
        ok, lookahead_msg = verify_no_lookahead(data_main, cfg, args.qa_truncate)
        print(f"  {lookahead_msg}")
        if not ok:
            print("先読みバイアス検査に失敗したため停止します。", file=sys.stderr)
            return 1
    else:
        lookahead_msg = "省略(--qa-truncate 0)"

    print("=== 4/7 バックテスト(4系列) ===")
    results: dict[str, tuple[BTResult, Stats]] = {}
    univ_main = Universe(data_main)
    univ_neutral = Universe(data_neutral)
    for label, univ, unit in (
        ("主・端株可", univ_main, False),
        ("主・単元制約", univ_main, True),
        ("中立・端株可", univ_neutral, False),
        ("中立・単元制約", univ_neutral, True),
    ):
        res = run_engine(univ, build_rule_events(univ, cfg), cfg, unit_constraint=unit)
        s = compute_stats(res, cfg)
        results[label] = (res, s)
        print(f"  {label}: {s.n_trades} トレード, 期待値 {s.expectancy_r:+.3f}R, "
              f"最終資産 {s.final_equity:,.0f} 円")

    res_main, s_main = results["主・端株可"]

    print("=== 5/7 ベースライン ===")
    topix_curve, topix_final = run_topix_baseline(data_all[TOPIX_ETF], univ_main, cfg)
    print(f"  A: TOPIX B&H 最終資産 {topix_final:,.0f} 円")
    rnd_main = run_random_baseline(univ_main, cfg, s_main.n_trades)
    print(f"  B: ランダム(主) 中央値 {np.median(rnd_main['finals']):,.0f} 円 / "
          f"95%ile {np.percentile(rnd_main['finals'], 95):,.0f} 円")
    n_neutral = results["中立・端株可"][1].n_trades
    rnd_neutral = run_random_baseline(univ_neutral, cfg, n_neutral, collect_curves=False)
    print(f"  B: ランダム(中立) 中央値 {np.median(rnd_neutral['finals']):,.0f} 円")

    print("=== 6/7 Gate 1 判定・レポート ===")
    gate = evaluate_gate1(s_main, rnd_main["finals"])
    write_trades_csv(res_main, PRIMARY_UNIVERSE, os.path.join(OUTPUT_DIR, "trades.csv"))
    write_summary(cfg, results, gate, topix_final, rnd_main, rnd_neutral, lookahead_msg,
                  os.path.join(OUTPUT_DIR, "summary.md"))
    plot_equity_curve(res_main, topix_curve, rnd_main, cfg,
                      os.path.join(OUTPUT_DIR, "equity_curve.png"))
    plot_random_dist(s_main.final_equity, rnd_main, cfg,
                     os.path.join(OUTPUT_DIR, "random_dist.png"))
    for name, ok, detail in gate.checks:
        mark = "—" if ok is None else ("PASS" if ok else "FAIL")
        print(f"  [{mark}] {name}: {detail}")
    if not gate.decidable:
        print("  判定: 検出力不足・判定不能")
    elif gate.passed:
        print("  判定: Gate 1 合格 — Phase 2(daily_scan.py)の実装に進める")
    else:
        print("  判定: Gate 1 不合格 → ルール棄却。Phase 2 は実装しない")

    print("=== 7/7 感度分析(探索的・Gate判定に不使用) ===")
    if args.skip_sensitivity:
        print("  省略(--skip-sensitivity)")
    else:
        write_sensitivity(data_main, cfg, os.path.join(OUTPUT_DIR, "sensitivity.md"))
        print(f"  -> {OUTPUT_DIR}/sensitivity.md")

    print(f"完了。成果物: {OUTPUT_DIR}/data_quality.md, trades.csv, summary.md, "
          "equity_curve.png, random_dist.png, sensitivity.md")
    return 0


if __name__ == "__main__":
    sys.exit(main())
