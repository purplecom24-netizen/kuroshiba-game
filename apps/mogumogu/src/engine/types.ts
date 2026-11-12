// 計算エンジンの型。画面・DBから独立させる。
export type Sex = 'M' | 'F';
export type NutrientId = string;
export type ValueFlag = 'measured' | 'estimated' | 'trace' | 'zeroEst' | 'missing';

export interface NutrientValue {
  value: number | null; // null = 欠測
  flag: ValueFlag;
}

export interface NutrientDef {
  id: NutrientId;
  nameJa: string;
  shortJa: string;
  unit: string;
  group: 'macro' | 'mineral' | 'vitamin';
  mextColumn: string;
  sortOrder: number;
  note?: string;
}

export type RefKind = 'EER' | 'EAR' | 'RDA' | 'AI' | 'DG' | 'UL';

export interface IntakeReferenceRow {
  nutrientId: NutrientId;
  ageMinMonths: number;
  ageMaxMonths: number;
  sex: 'M' | 'F' | 'B';
  kind: RefKind;
  value: number;
  unit: string;
  source: string;
  page: number;
}

export interface BreastMilkRow {
  nutrientId: NutrientId;
  ageMinMonths: number;
  ageMaxMonths: number;
  perL: number | null;
  per100g: string | null; // 成分表の記号つき値
  specificGravity: number;
  source: string;
  flag: string;
}

export interface GrowthRow {
  sex: Sex;
  metric: 'weight' | 'height' | 'head';
  label: string;
  ageMonths: number;
  p: number[]; // 3,10,25,50,75,90,97
}

/** 1日分の計算入力 */
export interface FoodPortion {
  label?: string;
  grams: number; // 食べた重量
  per100g: Record<NutrientId, NutrientValue>; // 欠けているキーは欠測
}
export interface FormulaPortion {
  ml: number; // 飲んだ量
  per100ml: Record<NutrientId, number | null | undefined>; // null/undefined = 表示なし（欠測）
}
export interface DayInput {
  foods: FoodPortion[];
  formula: FormulaPortion[];
  breastMilkMl: number;
}

export interface SourceBreakdown {
  breast: number;
  formula: number;
  food: number;
}
export interface NutrientIntake {
  total: number; // 欠測を含む場合は下限値
  bySource: SourceBreakdown;
  missing: boolean; // 欠測を含む（= total は下限値）
  missingSources: (keyof SourceBreakdown)[];
  missingFoodGrams: number;
  totalFoodGrams: number;
  hasEstimate: boolean;
  hasTrace: boolean;
}
export type DayIntake = Record<NutrientId, NutrientIntake>;
