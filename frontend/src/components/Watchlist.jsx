import { useEffect, useState } from "react";
import { getInstruments } from "../api";

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
          return (
            <li
              key={it.symbol}
              className={it.symbol === selected ? "active" : ""}
              onClick={() => onSelect(it.symbol)}
            >
              <div className="sym">{it.symbol}</div>
              <div className="name">{it.name}</div>
              <div className="px">{q ? q.price.toFixed(2) : "—"}</div>
            </li>
          );
        })}
        {items.length === 0 && <li className="empty">該当なし</li>}
      </ul>
    </aside>
  );
}
