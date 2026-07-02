import { useEffect, useState } from "react";
import { getInstruments } from "../api";

// Day's change vs previous close: absolute amount + percent, plus a direction
// used for green(up)/red(down) coloring. Returns null until data is available.
function dayChange(quote) {
  if (!quote || !quote.prev_close) return null;
  const diff = quote.price - quote.prev_close;
  const pct = (diff / quote.prev_close) * 100;
  const up = diff >= 0;
  return {
    dir: up ? "up" : "down",
    sign: up ? "+" : "-",
    abs: Math.abs(diff).toFixed(2),
    pct: Math.abs(pct).toFixed(2),
  };
}

// Left rail: searchable watchlist. Shows the latest streamed price per symbol.
export default function Watchlist({ selected, onSelect, quotes }) {
  const [items, setItems] = useState([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let active = true;
    getInstruments(query)
      .then((data) => active && setItems(data))
      .catch(() => active && setItems([]));
    return () => {
      active = false;
    };
  }, [query]);

  return (
    <aside className="watchlist">
      <input
        className="search"
        placeholder="銘柄検索 (e.g. AAPL)"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <ul>
        {items.map((it) => {
          const q = quotes[it.symbol];
          const change = dayChange(q);
          return (
            <li
              key={it.symbol}
              className={it.symbol === selected ? "active" : ""}
              onClick={() => onSelect(it.symbol)}
            >
              <div className="sym">{it.symbol}</div>
              <div className="name">{it.name}</div>
              <div className="px">{q ? q.price.toFixed(2) : "—"}</div>
              <div className={`chg ${change ? change.dir : ""}`}>
                {change ? `${change.sign}${change.abs} (${change.sign}${change.pct}%)` : ""}
              </div>
            </li>
          );
        })}
        {items.length === 0 && <li className="empty">該当なし</li>}
      </ul>
    </aside>
  );
}
