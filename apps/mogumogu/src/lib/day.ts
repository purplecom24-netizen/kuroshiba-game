import { addDays, ageMonthsDays } from '../engine/age';
import { computeDayIntake } from '../engine/intake';
import { averageIntake, type DayRecord } from '../engine/period';
import { per100gToPer100ml, drunkMl } from '../engine/units';
import type { DayIntake, FoodPortion, FormulaPortion, NutrientValue } from '../engine/types';
import { BREAST_MILK, NUTRIENTS } from '../data/refdata';
import type { MextFood } from '../data/foods';
import type { Preset } from '../data/refdata';
import { db, type Child, type CustomFood, type FormulaProduct, type Settings } from '../db';

export interface FoodLike {
  id: string;
  name: string;
  displayName: string;
  source: 'mext' | 'custom' | 'recipe' | 'babyfood' | 'preset';
  category?: string;
  note?: string;
  per100g: Record<string, NutrientValue>;
  base?: string;
  cookState?: string | null;
  code?: string;
  keys: string;
  density?: number | null;
  packGrams?: number | null;
}

export function customToFood(c: CustomFood, normalize: (s: string) => string): FoodLike {
  return {
    id: `custom:${c.id}`,
    name: c.name,
    displayName: c.name,
    source: c.source,
    per100g: c.nutrients,
    keys: normalize([c.name, ...c.aliases].join(' ')),
    density: c.densityGPerMl ?? null,
    packGrams: c.packGrams ?? null,
  };
}

/** よく使う食材（成分表の食品に分かりやすい名前を付けたもの。scale≠1 は推定値） */
export function presetToFood(p: Preset, m: MextFood, normalize: (s: string) => string): FoodLike {
  const per100g: Record<string, NutrientValue> = {};
  for (const [id, v] of Object.entries(m.per100g)) {
    per100g[id] =
      p.scale === 1 || v.value === null
        ? v
        : { value: v.value * p.scale, flag: v.value === 0 ? v.flag : 'estimated' };
  }
  return {
    id: `preset:${p.id}`,
    name: p.label,
    displayName: p.label,
    source: 'preset',
    per100g,
    base: m.base,
    cookState: m.cookState,
    code: m.code,
    category: p.category,
    note: p.note,
    keys: normalize([p.label, ...p.aliases].join(' ')),
  };
}

export function mextToFood(f: MextFood): FoodLike {
  return { id: f.id, name: f.name, displayName: f.displayName, source: 'mext', per100g: f.per100g, base: f.base, cookState: f.cookState, code: f.code, keys: f.keys };
}

/** 銘柄の100mlあたり成分（100gあたりしか表示がなければ標準調乳濃度で換算） */
export function formulaPer100ml(p: FormulaProduct): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const n of NUTRIENTS) {
    const v = p.per100ml?.[n.id];
    out[n.id] = v !== null && v !== undefined && Number.isFinite(v) ? v : per100gToPer100ml(p.per100g?.[n.id], p.gramsPer100ml);
  }
  return out;
}

export interface DayData {
  date: string;
  hasRecord: boolean;
  breastMilkMl: number;
  breastMilkMethod: 'default' | 'manual' | 'testweigh' | 'none';
  formulaMl: number;
  foodGrams: number;
  input: { foods: (FoodPortion & { foodId: string })[]; formula: FormulaPortion[] };
  intake: DayIntake;
  months: number;
}

export async function loadDay(child: Child, date: string, foodMap: Map<string, FoodLike>, settings: Settings): Promise<DayData> {
  const cid = child.id!;
  const [items, feeds, est, formulas] = await Promise.all([
    db.mealItems.where({ childId: cid, date }).toArray(),
    db.milkFeeds.where({ childId: cid, date }).toArray(),
    db.breastEstimates.get([cid, date]),
    db.formulas.toArray(),
  ]);
  const meals = await db.meals.where({ childId: cid, date }).count();
  const fmap = new Map(formulas.map((f) => [f.id!, formulaPer100ml(f)]));
  const foods = items.map((it) => ({ foodId: it.foodId, label: it.foodName, grams: it.eatenGrams, per100g: foodMap.get(it.foodId)?.per100g ?? {} }));
  const formula: FormulaPortion[] = feeds
    .filter((f) => f.kind === 'formula')
    .map((f) => ({ ml: drunkMl(f.ml ?? 0, f.leftoverMl), per100ml: (f.formulaId && fmap.get(f.formulaId)) || {} }));
  const hasRecord = meals > 0 || items.length > 0 || feeds.length > 0 || !!est;
  let breastMilkMl = 0;
  let method: DayData['breastMilkMethod'] = 'none';
  if (est) {
    breastMilkMl = est.ml;
    method = est.method;
  } else if (hasRecord && child.feedingType !== 'formula') {
    breastMilkMl = settings.defaultBreastMilkMl;
    method = 'default';
  }
  const months = ageMonthsDays(child.birthDate, date).months;
  const intake = computeDayIntake({ foods, formula, breastMilkMl }, NUTRIENTS, BREAST_MILK, months);
  return {
    date,
    hasRecord,
    breastMilkMl,
    breastMilkMethod: method,
    formulaMl: formula.reduce((s, f) => s + f.ml, 0),
    foodGrams: foods.reduce((s, f) => s + f.grams, 0),
    input: { foods, formula },
    intake,
    months,
  };
}

export async function loadPeriod(child: Child, endDate: string, days: number, foodMap: Map<string, FoodLike>, settings: Settings) {
  const dates = Array.from({ length: days }, (_, i) => addDays(endDate, i - days + 1));
  const data = await Promise.all(dates.map((d) => loadDay(child, d, foodMap, settings)));
  const recs: DayRecord[] = data.map((d) => ({ date: d.date, hasRecord: d.hasRecord, intake: d.intake }));
  const avg = averageIntake(recs, settings.includeEmptyDays);
  return { days: data, ...avg };
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}
