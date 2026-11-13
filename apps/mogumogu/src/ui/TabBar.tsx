import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import type { Tab } from '../store';

export const TABS: { id: Tab; label: string }[] = [
  { id: 'record', label: '記録' },
  { id: 'foods', label: '食材' },
  { id: 'analysis', label: '栄養分析' },
  { id: 'growth', label: '成長' },
  { id: 'settings', label: '設定' },
];

/** タブのアイコン（線画。色は currentColor なので選択中はアクセント色になる） */
function TabIcon({ id }: { id: Tab }) {
  const common = { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;
  switch (id) {
    case 'record': // えんぴつ
      return (
        <svg {...common}>
          <path d="M4 20h4.5L19.4 9.1a2.1 2.1 0 0 0 0-3l-1.5-1.5a2.1 2.1 0 0 0-3 0L4 15.5V20z" />
          <path d="M13.5 6l4.5 4.5" />
        </svg>
      );
    case 'foods': // にんじん
      return (
        <svg {...common}>
          <g transform="rotate(40 12 12)">
            <path d="M12 21.5C9.5 17 7.6 12.5 8 9.5a4 4 0 0 1 8 0c.4 3-1.5 7.5-4 12z" />
            <path d="M12 5.5V2M12 5.5L9.5 2.5M12 5.5l2.5-3" />
            <path d="M10 10.8h2M12.5 14.2h1.4" />
          </g>
        </svg>
      );
    case 'analysis': // 棒グラフ
      return (
        <svg {...common}>
          <path d="M4 20.5h16" />
          <path d="M7 16.5v-3.5M12 16.5V6.5M17 16.5v-7" strokeWidth={3.2} />
        </svg>
      );
    case 'growth': // 右上がりの線
      return (
        <svg {...common}>
          <path d="M3.5 16.5l5.5-5.5 3.5 3.5 7-7" />
          <path d="M14.5 7h5v5" />
        </svg>
      );
    default: // 歯車
      return (
        <svg {...common}>
          <path d="M10.22 5.13L10.63 2.8L13.37 2.8L13.78 5.13L15.6 5.88L17.53 4.52L19.48 6.47L18.12 8.4L18.87 10.22L21.2 10.63L21.2 13.37L18.87 13.78L18.12 15.6L19.48 17.53L17.53 19.48L15.6 18.12L13.78 18.87L13.37 21.2L10.63 21.2L10.22 18.87L8.4 18.12L6.47 19.48L4.52 17.53L5.88 15.6L5.13 13.78L2.8 13.37L2.8 10.63L5.13 10.22L5.88 8.4L4.52 6.47L6.47 4.52L8.4 5.88Z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
  }
}

interface Drag {
  x: number; // レンズ左端（タブ並びの左端からのpx）
  index: number; // 指の下にあるタブ
}

/**
 * 浮いたカプセル型の半透明タブバー（iOS 26 の Liquid Glass 風）。
 * - 選択中のタブの後ろに灰色のカプセル。タブを切り替えるとばねのように滑る
 * - バーを押している間はカプセルがガラスのレンズになり、指に付いて動く。離したタブに切り替わる
 * - キーボード操作では各ボタンの click で切り替わる
 */
export function TabBar({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  const itemsRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const activeIndex = Math.max(0, TABS.findIndex((t) => t.id === tab));

  const locate = (clientX: number): Drag | null => {
    const el = itemsRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const w = r.width / TABS.length;
    const rel = Math.min(Math.max(clientX - r.left, 0), r.width - 0.01);
    return { index: Math.floor(rel / w), x: Math.min(Math.max(rel - w / 2, 0), r.width - w) };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const d = locate(e.clientX);
    if (!d) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* 取得できなくても動作に支障なし */
    }
    setDrag(d);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    if (drag) setDrag(locate(e.clientX));
  };
  const finish = (e: ReactPointerEvent<HTMLElement>, commit: boolean) => {
    if (!drag) return;
    const d = locate(e.clientX);
    setDrag(null);
    if (commit && d) onChange(TABS[d.index].id);
  };

  const lensStyle: CSSProperties = { translate: drag ? `${drag.x}px 0` : `${activeIndex * 100}% 0` };

  return (
    <nav
      className={`tabbar${drag ? ' dragging' : ''}`}
      aria-label="タブ"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => finish(e, true)}
      onPointerCancel={(e) => finish(e, false)}
      onLostPointerCapture={() => setDrag(null)}
    >
      <div className="tabbar-glass" aria-hidden="true" />
      <div className="tabbar-items" ref={itemsRef} style={{ gridTemplateColumns: `repeat(${TABS.length}, 1fr)` }}>
        <span className="tab-lens" aria-hidden="true" style={{ ...lensStyle, width: `${100 / TABS.length}%` }} />
        {TABS.map((t, i) => (
          <button
            key={t.id}
            type="button"
            aria-current={tab === t.id ? 'page' : undefined}
            className={drag && drag.index === i ? 'under-lens' : undefined}
            onClick={() => onChange(t.id)}
          >
            <TabIcon id={t.id} />
            <span className="tab-label">{t.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
