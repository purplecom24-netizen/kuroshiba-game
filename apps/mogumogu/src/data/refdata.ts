import ref from './reference.json';
import type { BreastMilkRow, GrowthRow, IntakeReferenceRow, NutrientDef } from '../engine/types';

export const NUTRIENTS = (ref.nutrients as NutrientDef[]).slice().sort((a, b) => a.sortOrder - b.sortOrder);
export const NUTRIENT_BY_ID = Object.fromEntries(NUTRIENTS.map((n) => [n.id, n])) as Record<string, NutrientDef>;
export const INTAKE_REF = ref.intake as IntakeReferenceRow[];
export const BREAST_MILK = ref.breastmilk as BreastMilkRow[];
export const GROWTH = ref.growth.rows as GrowthRow[];
export const ALIASES = ref.aliases as { key: string; aliases: string[] }[];
export const DATA_VERSIONS = ref.versions as { dataset: string; version: string; publisher: string; sourceUrl: string; note: string }[];
export const BREAST_MILK_VOLUME = ref.breastMilkVolume as { ageMinMonths: number; ageMaxMonths: number; ml: number; source: string }[];

/** 母乳のみの場合の1日哺乳量の目安（食事摂取基準の算定に用いた値） */
export function referenceBreastMilkMl(months: number): number {
  const m = Math.min(months, 11);
  return BREAST_MILK_VOLUME.find((r) => m >= r.ageMinMonths && m <= r.ageMaxMonths)?.ml ?? 0;
}

export interface Preset { id: string; label: string; category: string; aliases: string[]; code: string; scale: number; note: string }
export const PRESETS = ref.presets as Preset[];
export const PRESET_CATEGORIES = [...new Set(PRESETS.map((p) => p.category))];

export interface FormulaPreset {
  id: string; maker: string; name: string; type: 'powder' | 'liquid'; targetAge: string;
  gramsPer100ml: number | null; concSource: string; sourceUrl: string; checkedAt: string;
  per100g: Record<string, number>; per100ml: Record<string, number>; ranges: string[];
}
export const FORMULA_PRESETS = ref.formulas as FormulaPreset[];
