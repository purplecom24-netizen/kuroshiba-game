import { breastMilkConcentration } from './breastmilk';
import type { BreastMilkRow, DayInput, DayIntake, NutrientDef, NutrientIntake } from './types';

/**
 * 1日摂取量（要件 6.1）
 * I_n = Σ w_i·c_in/100 + Σ v_j·f_jn/100 + V_bm·b_n
 * 欠測は0と区別し、欠測を含む値は下限値として missing=true を立てる（要件 6.4）。
 */
export function computeDayIntake(
  input: DayInput,
  nutrients: NutrientDef[],
  breastRows: BreastMilkRow[],
  months: number,
): DayIntake {
  const out: DayIntake = {};
  const totalFoodGrams = input.foods.reduce((s, f) => s + f.grams, 0);
  for (const n of nutrients) {
    const r: NutrientIntake = {
      total: 0,
      bySource: { breast: 0, formula: 0, food: 0 },
      missing: false,
      missingSources: [],
      missingFoodGrams: 0,
      totalFoodGrams,
      hasEstimate: false,
      hasTrace: false,
    };
    // 離乳食
    for (const f of input.foods) {
      if (f.grams <= 0) continue;
      const v = f.per100g[n.id];
      if (!v || v.value === null) {
        r.missingFoodGrams += f.grams;
        continue;
      }
      r.bySource.food += (f.grams * v.value) / 100;
      if (v.flag === 'estimated') r.hasEstimate = true;
      if (v.flag === 'trace') r.hasTrace = true;
    }
    if (r.missingFoodGrams > 0) r.missingSources.push('food');
    // ミルク
    let formulaMissing = false;
    for (const j of input.formula) {
      if (j.ml <= 0) continue;
      const f = j.per100ml[n.id];
      if (f === null || f === undefined || !Number.isFinite(f)) {
        formulaMissing = true;
        continue;
      }
      r.bySource.formula += (j.ml * f) / 100;
    }
    if (formulaMissing) r.missingSources.push('formula');
    // 母乳（推定量）
    if (input.breastMilkMl > 0) {
      const c = breastMilkConcentration(breastRows, n.id, months);
      if (c.perL === null) r.missingSources.push('breast');
      else {
        r.bySource.breast = (input.breastMilkMl / 1000) * c.perL;
        if (c.estimated) r.hasEstimate = true;
        if (c.trace) r.hasTrace = true;
      }
    }
    r.total = r.bySource.breast + r.bySource.formula + r.bySource.food;
    r.missing = r.missingSources.length > 0;
    out[n.id] = r;
  }
  return out;
}

export const SOURCE_LABEL = { breast: '母乳（推定）', formula: 'ミルク', food: '離乳食' } as const;
