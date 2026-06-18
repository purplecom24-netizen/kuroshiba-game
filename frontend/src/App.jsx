import { useEffect, useRef, useState } from "react";
import StatusBar from "./components/StatusBar";
import Watchlist from "./components/Watchlist";
import Chart from "./components/Chart";
import { getStatus, getInstruments, openQuoteStream } from "./api";

export default function App() {
  const [status, setStatus] = useState(null);
  const [connection, setConnection] = useState("connecting");
  const [symbols, setSymbols] = useState([]);
  const [selected, setSelected] = useState(null);
  const [timeframe, setTimeframe] = useState("1Day");
  const [quotes, setQuotes] = useState({});
  const [liveQuote, setLiveQuote] = useState(null);
  const wsRef = useRef(null);

  // Initial load: status + universe symbols.
  useEffect(() => {
    getStatus().then(setStatus).catch(() => {});
    getInstruments().then((items) => {
      const syms = items.map((i) => i.symbol);
      setSymbols(syms);
      setSelected((cur) => cur ?? syms[0] ?? null);
    });
  }, []);

  // One WebSocket for the whole universe; fan quotes out to state.
  useEffect(() => {
    if (symbols.length === 0) return;
    const ws = openQuoteStream(
      symbols,
      (q) => {
        setQuotes((prev) => ({ ...prev, [q.symbol]: q }));
        setLiveQuote(q);
      },
      setConnection
    );
    wsRef.current = ws;
    return () => ws.close();
  }, [symbols]);

  return (
    <div className="app">
      <StatusBar status={status} connection={connection} />
      <div className="body">
        <Watchlist selected={selected} onSelect={setSelected} quotes={quotes} />
        {selected ? (
          <Chart
            symbol={selected}
            timeframe={timeframe}
            onTimeframe={setTimeframe}
            liveQuote={liveQuote}
          />
        ) : (
          <section className="chart-panel empty">銘柄を選択してください</section>
        )}
      </div>
      <footer className="disclaimer">
        本ツールは損失を<b>限定</b>するもので、損失を<b>排除しません</b>。「絶対に損しない」発注は存在しません。
        損益はすべて利用者の責任です。
      </footer>
    </div>
  );
}
