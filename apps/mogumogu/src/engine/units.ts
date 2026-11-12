/** 量の入力単位（要件 MEAL-04, MEAL-05, 6.1） */
export type UnitKind = 'g' | 'ml' | 'tsp' | 'tbsp' | 'cup' | 'custom';
export const VOLUME_ML: Record<'ml' | 'tsp' | 'tbsp' | 'cup', number> = { ml: 1, tsp: 5, tbsp: 15, cup: 200 };
export const UNIT_LABEL: Record<Exclude<UnitKind, 'custom'>, string> = { g: 'g', ml: 'ml', tsp: '小さじ', tbsp: '大さじ', cup: 'カップ' };

export interface CustomUnit {
  name: string;
  grams?: number | null;
  ml?: number | null;
}

export type ToGramsResult = { ok: true; grams: number } | { ok: false; reason: 'needDensity' | 'badUnit' };

/** 入力量を重量(g)に直す。容量は 容量×係数(g/ml)。係数がなければ needDensity を返す */
export function toGrams(amount: number, unit: UnitKind, densityGPerMl: number | null | undefined, custom?: CustomUnit): ToGramsResult {
  if (!Number.isFinite(amount) || amount < 0) return { ok: false, reason: 'badUnit' };
  if (unit === 'g') return { ok: true, grams: amount };
  if (unit === 'custom') {
    if (!custom) return { ok: false, reason: 'badUnit' };
    if (custom.grams) return { ok: true, grams: amount * custom.grams };
    if (custom.ml) {
      if (!densityGPerMl) return { ok: false, reason: 'needDensity' };
      return { ok: true, grams: amount * custom.ml * densityGPerMl };
    }
    return { ok: false, reason: 'badUnit' };
  }
  if (!densityGPerMl) return { ok: false, reason: 'needDensity' };
  return { ok: true, grams: amount * VOLUME_ML[unit] * densityGPerMl };
}

export const EATEN_RATIOS = [
  { key: 'all', label: '完食', ratio: 1 },
  { key: '3/4', label: '3/4', ratio: 0.75 },
  { key: '1/2', label: '1/2', ratio: 0.5 },
  { key: '1/4', label: '1/4', ratio: 0.25 },
  { key: 'bite', label: '一口', ratio: 0.1 },
  { key: 'none', label: '食べず', ratio: 0 },
] as const;
export type EatenRatioKey = (typeof EATEN_RATIOS)[number]['key'];

/** 食べた量（要件 MEAL-06）: 提供量−残量、または提供量×摂取割合 */
export function eatenGrams(servedGrams: number, opts: { leftoverGrams?: number | null; ratio?: EatenRatioKey | null }): number {
  if (opts.leftoverGrams !== null && opts.leftoverGrams !== undefined) return Math.max(0, servedGrams - opts.leftoverGrams);
  if (opts.ratio) {
    const r = EATEN_RATIOS.find((x) => x.key === opts.ratio);
    return servedGrams * (r ? r.ratio : 1);
  }
  return servedGrams;
}

/** ミルクの飲んだ量（飲み残しを差し引く） */
export function drunkMl(ml: number, leftoverMl?: number | null): number {
  return Math.max(0, ml - (leftoverMl ?? 0));
}

/** 缶の表示が100gあたりのみの場合、標準調乳濃度(g/100ml)で100mlあたりに換算（要件 MILK-01） */
export function per100gToPer100ml(per100g: number | null | undefined, gramsPer100ml: number | null | undefined): number | null {
  if (per100g === null || per100g === undefined || !gramsPer100ml) return null;
  return (per100g * gramsPer100ml) / 100;
}
