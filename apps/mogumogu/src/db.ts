import Dexie, { type Table } from 'dexie';
import type { NutrientValue, Sex } from './engine/types';
import type { EatenRatioKey, UnitKind } from './engine/units';

export type FeedingType = 'breast' | 'mixed' | 'formula';

export interface Child {
  id?: number;
  name: string;
  birthDate: string;
  sex: Sex;
  feedingType: FeedingType;
}
export interface Measurement {
  id?: number;
  childId: number;
  date: string;
  weightKg?: number | null;
  heightCm?: number | null;
  headCm?: number | null;
}
/** カスタム食材・市販ベビーフード・レシピ（100gあたり成分を保持） */
export interface CustomFood {
  id?: number;
  source: 'custom' | 'recipe' | 'babyfood';
  name: string;
  aliases: string[];
  nutrients: Record<string, NutrientValue>;
  densityGPerMl?: number | null;
  recipe?: { ingredients: { foodId: string; name: string; grams: number }[]; yieldGrams: number } | null;
  packGrams?: number | null;
  note?: string;
}
/** 食材ごとの利用者設定（容量係数・最終使用） */
export interface FoodPref {
  foodId: string;
  densityGPerMl?: number | null;
  lastUsed?: number;
}
export interface UnitDef {
  id?: number;
  foodId: string | null; // null = 共通
  name: string;
  grams?: number | null;
  ml?: number | null;
}
export interface FormulaProduct {
  id?: number;
  maker: string;
  name: string;
  per100ml: Record<string, number | null>;
  per100g: Record<string, number | null>;
  gramsPer100ml?: number | null; // 標準調乳濃度
  presetId?: string | null; // 公式成分表示から登録した場合の元データ
  ranges?: string[]; // 範囲表示（下限値で計算）の栄養素
  sourceUrl?: string | null;
}

/** 公式の成分表示から銘柄を登録（登録済みならそれを返す） */
export async function addFormulaFromPreset(p: { id: string; maker: string; name: string; gramsPer100ml: number | null; per100g: Record<string, number>; per100ml: Record<string, number>; ranges: string[]; sourceUrl: string }): Promise<number> {
  const exist = await db.formulas.filter((f) => f.presetId === p.id).first();
  if (exist?.id) return exist.id;
  return db.formulas.add({
    maker: p.maker,
    name: p.name,
    per100g: { ...p.per100g },
    per100ml: { ...p.per100ml },
    gramsPer100ml: p.gramsPer100ml,
    presetId: p.id,
    ranges: [...p.ranges],
    sourceUrl: p.sourceUrl,
  });
}
export type MealSlot = '1' | '2' | '3' | 'snack';
export interface Meal {
  id?: number;
  childId: number;
  date: string;
  time: string;
  slot: MealSlot;
}
export interface MealItem {
  id?: number;
  mealId: number;
  childId: number;
  date: string;
  foodId: string;
  foodName: string;
  cookNote?: string | null; // 調理状態に対応する食品がない場合の注記
  amount: number;
  unit: UnitKind;
  unitId?: number | null;
  servedGrams: number;
  leftoverGrams?: number | null;
  eatenRatio?: EatenRatioKey | null;
  eatenGrams: number;
  reaction?: string | null;
  note?: string | null;
}
export interface MilkFeed {
  id?: number;
  childId: number;
  date: string;
  time: string;
  kind: 'formula' | 'breast';
  formulaId?: number | null;
  ml?: number | null;
  leftoverMl?: number | null;
  durationMin?: number | null;
}
export interface BreastMilkEstimate {
  childId: number;
  date: string;
  ml: number;
  method: 'manual' | 'testweigh';
}
export interface Settings {
  key: 'app';
  activeChildId: number | null;
  focusNutrients: string[];
  thresholdNear: number;
  defaultBreastMilkMl: number;
  defaultPeriod: 'today' | '3d' | '7d' | 'custom';
  includeEmptyDays: boolean;
  consultLowP: number;
  consultHighP: number;
  consultCrossLines: number;
  lastBackupAt: number | null;
  createdAt: number;
}

export const DEFAULT_SETTINGS: Settings = {
  key: 'app',
  activeChildId: null,
  focusNutrients: ['iron', 'zinc', 'vitD', 'calcium'],
  thresholdNear: 70,
  defaultBreastMilkMl: 480,
  defaultPeriod: '7d',
  includeEmptyDays: false,
  consultLowP: 3,
  consultHighP: 97,
  consultCrossLines: 2,
  lastBackupAt: null,
  createdAt: Date.now(),
};

export class AppDB extends Dexie {
  children!: Table<Child, number>;
  measurements!: Table<Measurement, number>;
  customFoods!: Table<CustomFood, number>;
  foodPrefs!: Table<FoodPref, string>;
  units!: Table<UnitDef, number>;
  formulas!: Table<FormulaProduct, number>;
  meals!: Table<Meal, number>;
  mealItems!: Table<MealItem, number>;
  milkFeeds!: Table<MilkFeed, number>;
  breastEstimates!: Table<BreastMilkEstimate, [number, string]>;
  settings!: Table<Settings, string>;

  constructor(name = 'mogumogu') {
    super(name);
    this.version(1).stores({
      children: '++id',
      measurements: '++id, childId, date',
      customFoods: '++id, source, name',
      foodPrefs: 'foodId',
      units: '++id, foodId',
      formulas: '++id',
      meals: '++id, [childId+date], date',
      mealItems: '++id, mealId, [childId+date], foodId',
      milkFeeds: '++id, [childId+date], date',
      breastEstimates: '[childId+date]',
      settings: 'key',
    });
  }
}

export const db = new AppDB();

export async function getSettings(): Promise<Settings> {
  const s = await db.settings.get('app');
  return { ...DEFAULT_SETTINGS, ...(s ?? {}) };
}
export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  const cur = await getSettings();
  await db.settings.put({ ...cur, ...patch, key: 'app' });
}

/** 端末のデータ消失リスクを下げる（要件 10章） */
export async function requestPersist(): Promise<boolean> {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch {
    /* noop */
  }
  return false;
}

const TABLES = ['children', 'measurements', 'customFoods', 'foodPrefs', 'units', 'formulas', 'meals', 'mealItems', 'milkFeeds', 'breastEstimates', 'settings'] as const;

/** 全データと設定のJSONエクスポート（要件 DATA-02） */
export async function exportAll(d: AppDB = db): Promise<{ app: string; schema: number; exportedAt: string; tables: Record<string, unknown[]> }> {
  const tables: Record<string, unknown[]> = {};
  for (const t of TABLES) tables[t] = await d.table(t).toArray();
  return { app: 'mogumogu', schema: 1, exportedAt: new Date().toISOString(), tables };
}
export async function importAll(data: { app?: string; tables?: Record<string, unknown[]> }, d: AppDB = db): Promise<void> {
  if (data.app !== 'mogumogu' || !data.tables) throw new Error('このアプリのバックアップファイルではありません');
  await d.transaction('rw', TABLES.map((t) => d.table(t)), async () => {
    for (const t of TABLES) {
      await d.table(t).clear();
      const rows = data.tables![t] ?? [];
      if (rows.length) await d.table(t).bulkAdd(rows);
    }
  });
}
export async function clearAll(d: AppDB = db): Promise<void> {
  await d.transaction('rw', TABLES.map((t) => d.table(t)), async () => {
    for (const t of TABLES) await d.table(t).clear();
  });
}
