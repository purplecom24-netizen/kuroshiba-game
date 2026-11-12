import { RATIO_LABEL, type SelectedReference } from './reference';
import type { DayIntake, NutrientId } from './types';

export interface Thresholds {
  near: number; // これ以上100未満は「あと少し」（%）
}
export const DEFAULT_THRESHOLDS: Thresholds = { near: 70 };

export type Status = 'met' | 'near' | 'low' | 'over' | 'noref';

export const STATUS_TEXT: Record<Status, string> = {
  met: '基準に届いている',
  near: 'あと少し',
  low: '届いていない',
  over: '上限を超えている',
  noref: '基準値なし',
};
export const STATUS_ICON: Record<Status, string> = {
  met: '●',
  near: '▲',
  low: '▼',
  over: '⚠',
  noref: '－',
};

export interface Judgement {
  nutrientId: NutrientId;
  intake: number; // 比較する量（脂質は%E）
  intakeUnit: string;
  targetValue: number | null;
  ratio: number | null; // %
  ratioLabel: string | null;
  gap: number | null; // あと○（基準 − 摂取、0以上）
  status: Status;
  overUL: boolean;
  ulValue: number | null;
  lowerBound: boolean; // 欠測あり → 下限値
}

/** 充足率と判定（要件 6.3）。脂質はエネルギー比で比べる */
export function judge(
  id: NutrientId,
  day: DayIntake,
  ref: SelectedReference,
  unit: string,
  th: Thresholds = DEFAULT_THRESHOLDS,
): Judgement {
  const it = day[id];
  let intake = it ? it.total : 0;
  let intakeUnit = unit;
  let lowerBound = it ? it.missing : true;
  if (ref.target && ref.target.unit.startsWith('%E')) {
    const e = day['energy'];
    intake = e && e.total > 0 ? ((intake * 9) / e.total) * 100 : 0;
    intakeUnit = '%E';
    lowerBound = lowerBound || (e ? e.missing : true);
  }
  const t = ref.target;
  const ul = ref.ul ? ref.ul.value : null;
  const overUL = ul !== null && intake >= ul;
  if (!t) {
    return { nutrientId: id, intake, intakeUnit, targetValue: null, ratio: null, ratioLabel: null, gap: null, status: overUL ? 'over' : 'noref', overUL, ulValue: ul, lowerBound };
  }
  const ratio = t.value > 0 ? (intake / t.value) * 100 : null;
  let status: Status = 'noref';
  if (overUL) status = 'over';
  else if (ratio !== null) status = ratio >= 100 ? 'met' : ratio >= th.near ? 'near' : 'low';
  return {
    nutrientId: id,
    intake,
    intakeUnit,
    targetValue: t.value,
    ratio,
    ratioLabel: RATIO_LABEL[t.kind],
    gap: Math.max(0, t.value - intake),
    status,
    overUL,
    ulValue: ul,
    lowerBound,
  };
}
