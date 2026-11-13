import { useEffect, useState, type ReactNode } from 'react';
import { STATUS_ICON, STATUS_TEXT, type Status } from '../engine/judge';

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="row between">
          <h2>{title}</h2>
          <button className="btn small" onClick={onClose} aria-label="閉じる">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function StatusBadge({ status, lowerBound }: { status: Status; lowerBound?: boolean }) {
  return (
    <>
      <span className={`status ${status}`}>
        <span className="i" aria-hidden="true">{STATUS_ICON[status]}</span>
        {STATUS_TEXT[status]}
      </span>
      {lowerBound && status !== 'over' && status !== 'met' ? <span className="muted small" style={{ display: 'block' }}>欠測あり（下限値）</span> : null}
    </>
  );
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { v: T; l: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.v} type="button" aria-pressed={value === o.v} onClick={() => onChange(o.v)}>
          {o.l}
        </button>
      ))}
    </div>
  );
}

/**
 * 数値入力。入力途中の文字列（「1」「0.」「1.2」など）を手元に保ち、
 * 確定値だけを親に渡す（1文字目で確定・欄が消える・小数が打てない問題を防ぐ）。
 */
export function NumberInput({ value, onChange, placeholder, ariaLabel }: { value: number | null | undefined; onChange: (v: number | null) => void; step?: string; placeholder?: string; ariaLabel?: string; min?: number }) {
  const [text, setText] = useState(value === null || value === undefined || Number.isNaN(value) ? '' : String(value));
  // 親から別の値が入ったとき（ワンタップ加算など）だけ表示を合わせる
  useEffect(() => {
    const parsed = text === '' ? null : Number(text);
    const v = value === null || value === undefined || Number.isNaN(value) ? null : value;
    if (parsed !== v && !(parsed !== null && v !== null && Math.abs(parsed - v) < 1e-9)) setText(v === null ? '' : String(v));
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={text}
      onChange={(e) => {
        const t = e.target.value.replace(/[０-９．]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/[^0-9.]/g, '');
        setText(t);
        if (t === '') onChange(null);
        else if (/^\d*\.?\d*$/.test(t) && t !== '.') onChange(Number(t));
      }}
    />
  );
}

/** 線画の矢印アイコン */
export function Chevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={dir === 'left' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'} />
    </svg>
  );
}
/** 「戻る」矢印（今日に戻るボタン用） */
export function ReturnIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 14L4.5 9.5 9 5" />
      <path d="M4.5 9.5H14a5.5 5.5 0 0 1 0 11h-3" />
    </svg>
  );
}

const WD = '日月火水木金土';
/**
 * 日付欄。表示は自前のラベルで中央ぞろえにし、透明な input[type=date] を重ねてタップでカレンダーを開く
 * （iOS Safari の日付欄は独自の最小幅・縦位置を持ち、枠からはみ出したり文字が上に寄ったりするため）。
 */
export function DateField({ value, onChange, ariaLabel, max, min, weekday = true, placeholder = '日付を選ぶ' }: { value: string; onChange: (v: string) => void; ariaLabel: string; max?: string; min?: string; weekday?: boolean; placeholder?: string }) {
  let label = placeholder;
  if (value) {
    const [y, m, d] = value.split('-').map(Number);
    label = `${y}/${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}` + (weekday ? `（${WD[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}）` : '');
  }
  return (
    <div className="date-cell">
      <span className={`date-label${value ? '' : ' muted'}`} aria-hidden="true">{label}</span>
      <input type="date" value={value} max={max} min={min} onChange={(e) => e.target.value && onChange(e.target.value)} aria-label={ariaLabel} />
    </div>
  );
}

export const MEDICAL_NOTE = '表示はすべて目安です。医療的な判断の代わりにはなりません。気になることは健診や小児科で相談してください。';
