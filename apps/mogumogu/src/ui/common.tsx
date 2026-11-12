import { useEffect, type ReactNode } from 'react';
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

export function NumberInput({ value, onChange, step = 'any', placeholder, ariaLabel, min = 0 }: { value: number | null | undefined; onChange: (v: number | null) => void; step?: string; placeholder?: string; ariaLabel?: string; min?: number }) {
  return (
    <input
      type="number"
      inputMode="decimal"
      step={step}
      min={min}
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={value === null || value === undefined || Number.isNaN(value) ? '' : value}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
    />
  );
}

export const MEDICAL_NOTE = '表示はすべて目安です。医療的な判断の代わりにはなりません。気になることは健診や小児科で相談してください。';
