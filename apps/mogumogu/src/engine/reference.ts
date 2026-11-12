import type { IntakeReferenceRow, NutrientId, RefKind, Sex } from './types';

export interface SelectedReference {
  nutrientId: NutrientId;
  /** 比較に使う指標（推奨量 > 目安量、エネルギーは推定エネルギー必要量） */
  target: IntakeReferenceRow | null;
  ear: IntakeReferenceRow | null;
  ul: IntakeReferenceRow | null;
  ageLabel: string | null;
}

const TARGET_ORDER: RefKind[] = ['RDA', 'AI', 'EER', 'DG'];

export const KIND_LABEL: Record<RefKind, string> = {
  EER: '推定エネルギー必要量',
  EAR: '推定平均必要量',
  RDA: '推奨量',
  AI: '目安量',
  DG: '目標量',
  UL: '耐容上限量',
};
export const RATIO_LABEL: Record<RefKind, string> = {
  EER: '必要量比',
  EAR: '平均必要量比',
  RDA: '推奨量比',
  AI: '目安量比',
  DG: '目標量比',
  UL: '上限比',
};

/** 月齢（満月数）と性別から、栄養素ごとの年齢区分と比較指標を選ぶ（要件 6.2） */
export function selectReference(
  rows: IntakeReferenceRow[],
  nutrientId: NutrientId,
  months: number,
  sex: Sex,
): SelectedReference {
  const cands = rows.filter(
    (r) => r.nutrientId === nutrientId && months >= r.ageMinMonths && months <= r.ageMaxMonths && (r.sex === 'B' || r.sex === sex),
  );
  const pick = (k: RefKind) => cands.find((r) => r.kind === k && r.sex === sex) ?? cands.find((r) => r.kind === k) ?? null;
  let target: IntakeReferenceRow | null = null;
  for (const k of TARGET_ORDER) {
    target = pick(k);
    if (target) break;
  }
  const any = target ?? cands[0] ?? null;
  return {
    nutrientId,
    target,
    ear: pick('EAR'),
    ul: pick('UL'),
    ageLabel: any ? `${any.ageMinMonths}〜${any.ageMaxMonths}か月` : null,
  };
}
