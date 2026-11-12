import type { NutrientValue } from './types';

/**
 * 成分表のセル値を解釈する（要件 6.4）。
 *  数値 → measured / (数値) → estimated / Tr,(Tr) → 0・trace / (0) → 0・zeroEst
 *  - , * , 空欄 → 欠測
 */
export function parseToken(raw: string | number | null | undefined): NutrientValue {
  if (raw === null || raw === undefined) return { value: null, flag: 'missing' };
  if (typeof raw === 'number') return Number.isFinite(raw) ? { value: raw, flag: 'measured' } : { value: null, flag: 'missing' };
  const s = raw.trim().replace(/[（]/g, '(').replace(/[）]/g, ')');
  if (s === '' || s === '-' || s === '−' || s === '―' || s === '*') return { value: null, flag: 'missing' };
  if (s === 'Tr' || s === '(Tr)') return { value: 0, flag: 'trace' };
  if (s === '(0)') return { value: 0, flag: 'zeroEst' };
  const m = s.match(/^\((-?\d+(?:\.\d+)?)\)$/);
  if (m) return { value: Number(m[1]), flag: 'estimated' };
  const n = Number(s);
  if (s !== '' && Number.isFinite(n)) return { value: n, flag: 'measured' };
  return { value: null, flag: 'missing' };
}
