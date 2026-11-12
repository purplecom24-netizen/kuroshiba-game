import type { NutrientDef, NutrientValue } from './types';

export interface RecipeIngredient {
  grams: number;
  per100g: Record<string, NutrientValue>;
}

/**
 * 作り置き・レシピ（要件 RCP-01, RCP-04）: 完成品100gあたりの成分 = Σ材料の成分 × 100 / 完成重量。
 * 水分の増減は完成重量で吸収し、加熱による損失は考慮しない。
 * 材料のどれかが欠測なら欠測（下限値として扱えるよう値は持たない）。
 */
export function recipePer100g(ingredients: RecipeIngredient[], yieldGrams: number, nutrients: NutrientDef[]): Record<string, NutrientValue> {
  const out: Record<string, NutrientValue> = {};
  if (!(yieldGrams > 0)) return out;
  for (const n of nutrients) {
    let sum = 0;
    let missing = false;
    let estimated = false;
    for (const ing of ingredients) {
      if (ing.grams <= 0) continue;
      const v = ing.per100g[n.id];
      if (!v || v.value === null) {
        missing = true;
        break;
      }
      sum += (ing.grams * v.value) / 100;
      if (v.flag === 'estimated') estimated = true;
    }
    out[n.id] = missing ? { value: null, flag: 'missing' } : { value: (sum * 100) / yieldGrams, flag: estimated ? 'estimated' : 'measured' };
  }
  return out;
}
