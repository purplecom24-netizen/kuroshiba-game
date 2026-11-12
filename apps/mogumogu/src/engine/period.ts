import type { DayIntake, NutrientIntake } from './types';

export interface DayRecord {
  date: string;
  hasRecord: boolean; // 食事・ミルク・母乳の記録が1件以上ある
  intake: DayIntake;
}

/** 期間の1日平均（要件 6.5）。記録のない日は既定で除外 */
export function averageIntake(days: DayRecord[], includeEmpty = false): { intake: DayIntake; dayCount: number } {
  const used = days.filter((d) => includeEmpty || d.hasRecord);
  const out: DayIntake = {};
  if (used.length === 0) return { intake: out, dayCount: 0 };
  const ids = new Set(used.flatMap((d) => Object.keys(d.intake)));
  for (const id of ids) {
    const acc: NutrientIntake = {
      total: 0,
      bySource: { breast: 0, formula: 0, food: 0 },
      missing: false,
      missingSources: [],
      missingFoodGrams: 0,
      totalFoodGrams: 0,
      hasEstimate: false,
      hasTrace: false,
    };
    for (const d of used) {
      const v = d.intake[id];
      if (!v) continue;
      acc.total += v.total;
      acc.bySource.breast += v.bySource.breast;
      acc.bySource.formula += v.bySource.formula;
      acc.bySource.food += v.bySource.food;
      acc.missing ||= v.missing;
      for (const s of v.missingSources) if (!acc.missingSources.includes(s)) acc.missingSources.push(s);
      acc.missingFoodGrams += v.missingFoodGrams;
      acc.totalFoodGrams += v.totalFoodGrams;
      acc.hasEstimate ||= v.hasEstimate;
      acc.hasTrace ||= v.hasTrace;
    }
    const n = used.length;
    acc.total /= n;
    acc.bySource.breast /= n;
    acc.bySource.formula /= n;
    acc.bySource.food /= n;
    acc.missingFoodGrams /= n;
    acc.totalFoodGrams /= n;
    out[id] = acc;
  }
  return { intake: out, dayCount: used.length };
}

/** 7日移動平均（P1 推移グラフ用） */
export function movingAverage(values: (number | null)[], window = 7): (number | null)[] {
  return values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - window + 1), i + 1).filter((v): v is number => v !== null);
    return slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : null;
  });
}
