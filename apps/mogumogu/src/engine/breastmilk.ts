import { parseToken } from './token';
import type { BreastMilkRow, NutrientId } from './types';

export interface BreastMilkConc {
  perL: number | null; // null = 母乳中濃度が定まっていない（寄与は欠測）
  estimated: boolean;
  trace: boolean;
  source: string | null;
  flag: string;
}

/** 栄養素・月齢ごとの母乳中濃度（/L）。成分表由来は per100g × 10 × 比重 */
export function breastMilkConcentration(rows: BreastMilkRow[], nutrientId: NutrientId, months: number): BreastMilkConc {
  const m = Math.min(months, 11); // 12か月以降も 9〜11か月の濃度を使う
  const r = rows.find((x) => x.nutrientId === nutrientId && m >= x.ageMinMonths && m <= x.ageMaxMonths);
  if (!r) return { perL: null, estimated: false, trace: false, source: null, flag: '' };
  if (r.perL !== null && r.perL !== undefined) {
    return { perL: r.perL, estimated: r.flag !== '', trace: false, source: r.source, flag: r.flag };
  }
  const t = parseToken(r.per100g);
  if (t.value === null) return { perL: null, estimated: false, trace: false, source: r.source, flag: r.flag };
  return {
    perL: t.value * 10 * r.specificGravity,
    estimated: t.flag === 'estimated',
    trace: t.flag === 'trace',
    source: r.source,
    flag: r.flag,
  };
}
