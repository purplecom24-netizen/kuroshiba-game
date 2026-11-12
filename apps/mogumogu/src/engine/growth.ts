import type { GrowthRow, Sex } from './types';

export const PERCENTILES = [3, 10, 25, 50, 75, 90, 97];

/** 月齢での各パーセンタイル値（隣接する表の点の線形補間） */
export function percentilesAt(rows: GrowthRow[], sex: Sex, metric: GrowthRow['metric'], ageMonths: number): number[] | null {
  const rs = rows.filter((r) => r.sex === sex && r.metric === metric).sort((a, b) => a.ageMonths - b.ageMonths);
  if (rs.length === 0 || ageMonths < rs[0].ageMonths || ageMonths > rs[rs.length - 1].ageMonths) return null;
  for (let i = 0; i < rs.length - 1; i++) {
    const a = rs[i];
    const b = rs[i + 1];
    if (ageMonths >= a.ageMonths && ageMonths <= b.ageMonths) {
      const t = b.ageMonths === a.ageMonths ? 0 : (ageMonths - a.ageMonths) / (b.ageMonths - a.ageMonths);
      return a.p.map((v, k) => v + (b.p[k] - v) * t);
    }
  }
  return rs[rs.length - 1].p.slice();
}

export interface Band {
  index: number; // 0: <3, 1: 3〜10, ..., 6: 90〜97, 7: >97
  label: string;
}

export function bandOf(values: number[], v: number): Band {
  let i = 0;
  while (i < values.length && v >= values[i]) i++;
  const label =
    i === 0 ? '3パーセンタイル未満' : i === values.length ? '97パーセンタイル超' : `${PERCENTILES[i - 1]}〜${PERCENTILES[i]}パーセンタイル`;
  return { index: i, label };
}

export interface ConsultSettings {
  lowP: number; // 既定3
  highP: number; // 既定97
  crossLines: number; // 既定2
}
export const DEFAULT_CONSULT: ConsultSettings = { lowP: 3, highP: 97, crossLines: 2 };

export interface GrowthPoint {
  ageMonths: number;
  value: number;
}

export interface GrowthAssessment {
  band: Band | null;
  consult: boolean;
  reasons: string[];
}

/**
 * 最新値の帯と「健診や小児科で相談する目安」の判定（要件 GRW-03, GRW-04）。
 * 診断的な語は使わない。
 */
export function assessGrowth(
  rows: GrowthRow[],
  sex: Sex,
  metric: GrowthRow['metric'],
  points: GrowthPoint[],
  s: ConsultSettings = DEFAULT_CONSULT,
): GrowthAssessment {
  const sorted = [...points].sort((a, b) => a.ageMonths - b.ageMonths);
  const last = sorted[sorted.length - 1];
  if (!last) return { band: null, consult: false, reasons: [] };
  const ps = percentilesAt(rows, sex, metric, last.ageMonths);
  if (!ps) return { band: null, consult: false, reasons: ['この月齢の発育曲線データがありません'] };
  const band = bandOf(ps, last.value);
  const reasons: string[] = [];
  const lowIdx = PERCENTILES.indexOf(s.lowP);
  const highIdx = PERCENTILES.indexOf(s.highP);
  if (lowIdx >= 0 && last.value < ps[lowIdx]) reasons.push(`${s.lowP}パーセンタイル未満です`);
  if (highIdx >= 0 && last.value > ps[highIdx]) reasons.push(`${s.highP}パーセンタイルを超えています`);
  // 最初の記録から最新までに、パーセンタイル曲線を何本またいだか
  const first = sorted[0];
  if (sorted.length >= 2) {
    for (const prev of [sorted[sorted.length - 2], first]) {
      const pp = percentilesAt(rows, sex, metric, prev.ageMonths);
      if (!pp) continue;
      const crossed = Math.abs(bandOf(pp, prev.value).index - band.index);
      if (crossed >= s.crossLines) {
        reasons.push(`パーセンタイル曲線を${crossed}本またいで変化しています`);
        break;
      }
    }
  }
  return { band, consult: reasons.length > 0, reasons };
}
