import { useEffect, useRef } from "react";
import { createChart, CrosshairMode } from "lightweight-charts";
import { getCandles, getSma } from "../api";

const TIMEFRAMES = [
  ["1Min", "1m"],
  ["5Min", "5m"],
  ["15Min", "15m"],
  ["1Hour", "1H"],
  ["1Day", "1D"],
];

// Candlestick chart with an SMA(20) overlay and timeframe switcher.
// `liveQuote` updates the last bar's close so the chart animates from the stream.
export default function Chart({ symbol, timeframe, onTimeframe, liveQuote }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const candleSeriesRef = useRef(null);
  const smaSeriesRef = useRef(null);
  const lastBarRef = useRef(null);

  // Create the chart once.
  useEffect(() => {
    const chart = createChart(containerRef.current, {
      layout: { background: { color: "#0e1117" }, textColor: "#c9d1d9" },
      grid: {
        vertLines: { color: "#1b212b" },
        horzLines: { color: "#1b212b" },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#1b212b" },
      timeScale: { borderColor: "#1b212b", timeVisible: true },
      autoSize: true,
    });
    candleSeriesRef.current = chart.addCandlestickSeries({
      upColor: "#26a69a",
      downColor: "#ef5350",
      wickUpColor: "#26a69a",
      wickDownColor: "#ef5350",
      borderVisible: false,
    });
    smaSeriesRef.current = chart.addLineSeries({
      color: "#f5b942",
      lineWidth: 2,
      priceLineVisible: false,
    });
    chartRef.current = chart;
    return () => chart.remove();
  }, []);

  // Load data whenever symbol or timeframe changes.
  useEffect(() => {
    if (!symbol) return;
    let active = true;
    Promise.all([
      getCandles(symbol, timeframe),
      getSma(symbol, timeframe, 20),
    ])
      .then(([candles, sma]) => {
        if (!active) return;
        candleSeriesRef.current.setData(candles);
        smaSeriesRef.current.setData(sma);
        lastBarRef.current = candles[candles.length - 1] ?? null;
        chartRef.current.timeScale().fitContent();
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [symbol, timeframe]);

  // Apply live quotes to the most recent bar.
  useEffect(() => {
    if (!liveQuote || liveQuote.symbol !== symbol || !lastBarRef.current) return;
    const bar = lastBarRef.current;
    const updated = {
      ...bar,
      close: liveQuote.price,
      high: Math.max(bar.high, liveQuote.price),
      low: Math.min(bar.low, liveQuote.price),
    };
    lastBarRef.current = updated;
    candleSeriesRef.current.update(updated);
  }, [liveQuote, symbol]);

  return (
    <section className="chart-panel">
      <div className="chart-header">
        <h2>{symbol}</h2>
        <div className="tf-switch">
          {TIMEFRAMES.map(([value, label]) => (
            <button
              key={value}
              className={value === timeframe ? "active" : ""}
              onClick={() => onTimeframe(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="legend">
          <span className="sma-dot" /> SMA 20
        </div>
      </div>
      <div className="chart-canvas" ref={containerRef} />
    </section>
  );
}
