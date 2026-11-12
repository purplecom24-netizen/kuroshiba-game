import { describe, expect, it } from 'vitest';
import foodsJson from '../../data/foods.json';
import { expandFoods } from '../../data/foods';
import { BREAST_MILK, GROWTH, INTAKE_REF, NUTRIENTS } from '../../data/refdata';
import { ageMonthsDays, formatAge } from '../age';
import { breastMilkConcentration } from '../breastmilk';
import { assessGrowth, percentilesAt } from '../growth';
import { computeDayIntake } from '../intake';
import { judge, STATUS_TEXT } from '../judge';
import { averageIntake } from '../period';
import { recipePer100g } from '../recipe';
import { selectReference } from '../reference';
import { parseToken } from '../token';
import { eatenGrams, toGrams } from '../units';
import type { DayInput, FormulaPortion } from '../types';

const FOODS = expandFoods(foodsJson as { columns: string[]; foods: string[][] });
const food = (code: string) => {
  const f = FOODS.find((x) => x.code === code);
  if (!f) throw new Error(code);
  return f;
};
const formula = (ironPer100ml: number, ml: number): FormulaPortion => ({ ml, per100ml: { iron: ironPer100ml } });
const emptyDay = (): DayInput => ({ foods: [], formula: [], breastMilkMl: 0 });

describe('T-01 月齢と年齢区分', () => {
  it('2026-04-02生、基準日2026-11-12 → 7か月10日', () => {
    expect(ageMonthsDays('2026-04-02', '2026-11-12')).toEqual({ months: 7, days: 10 });
    expect(formatAge('2026-04-02', '2026-11-12')).toBe('7か月10日');
  });
  it('エネルギー・たんぱく質は6〜8か月、鉄などは6〜11か月の区分', () => {
    const m = ageMonthsDays('2026-04-02', '2026-11-12').months;
    expect(selectReference(INTAKE_REF, 'energy', m, 'F').ageLabel).toBe('6〜8か月');
    expect(selectReference(INTAKE_REF, 'protein', m, 'F').ageLabel).toBe('6〜8か月');
    expect(selectReference(INTAKE_REF, 'iron', m, 'F').ageLabel).toBe('6〜11か月');
    expect(selectReference(INTAKE_REF, 'zinc', m, 'F').ageLabel).toBe('6〜11か月');
  });
  it('月末生まれの境界', () => {
    expect(ageMonthsDays('2026-01-31', '2026-02-28')).toEqual({ months: 1, days: 0 });
    expect(ageMonthsDays('2026-01-31', '2026-03-30')).toEqual({ months: 1, days: 30 });
  });
});

describe('T-02 女児・6〜8か月の基準値が書籍の図と一致する', () => {
  const v = (id: string) => selectReference(INTAKE_REF, id, 7, 'F').target!;
  it.each([
    ['energy', 600, 'EER'],
    ['protein', 15, 'AI'],
    ['iron', 4.5, 'RDA'],
    ['zinc', 2.0, 'AI'],
    ['vitD', 5.0, 'AI'],
  ])('%s = %s (%s)', (id, val, kind) => {
    expect(v(id as string).value).toBe(val);
    expect(v(id as string).kind).toBe(kind);
  });
});

describe('T-03 ミルク由来の鉄', () => {
  it('0.80mg/100ml × 250ml = 2.00mg', () => {
    const d = computeDayIntake({ ...emptyDay(), formula: [formula(0.8, 250)] }, NUTRIENTS, BREAST_MILK, 7);
    expect(d.iron.bySource.formula).toBeCloseTo(2.0, 10);
    expect(d.iron.total).toBeCloseTo(2.0, 10);
  });
});

describe('T-04 母乳推定量の変更', () => {
  it('0mlで母乳の寄与は全栄養素で0、2倍で2倍', () => {
    const base = computeDayIntake({ ...emptyDay(), breastMilkMl: 480 }, NUTRIENTS, BREAST_MILK, 7);
    const zero = computeDayIntake({ ...emptyDay(), breastMilkMl: 0 }, NUTRIENTS, BREAST_MILK, 7);
    const dbl = computeDayIntake({ ...emptyDay(), breastMilkMl: 960 }, NUTRIENTS, BREAST_MILK, 7);
    for (const n of NUTRIENTS) {
      expect(zero[n.id].bySource.breast).toBe(0);
      expect(zero[n.id].missingSources).not.toContain('breast');
      expect(dbl[n.id].bySource.breast).toBeCloseTo(base[n.id].bySource.breast * 2, 10);
    }
    expect(base.iron.bySource.breast).toBeCloseTo(0.48 * 0.35, 10);
  });
});

describe('T-05 ユーザー定義単位', () => {
  it('七倍粥「さじ」=2.5g を5さじ → 12.5g', () => {
    const r = toGrams(5, 'custom', null, { name: 'さじ', grams: 2.5 });
    expect(r).toEqual({ ok: true, grams: 12.5 });
  });
  it('容量単位は係数がなければ実測を促す', () => {
    expect(toGrams(1, 'tbsp', null)).toEqual({ ok: false, reason: 'needDensity' });
    expect(toGrams(2, 'tsp', 1.0)).toEqual({ ok: true, grams: 10 });
  });
});

describe('T-06 提供量と残量・摂取割合', () => {
  it('提供20g・残量5g → 15g、摂取割合1/2 → 10g', () => {
    expect(eatenGrams(20, { leftoverGrams: 5 })).toBe(15);
    expect(eatenGrams(20, { ratio: '1/2' })).toBe(10);
  });
});

describe('T-07 レシピ', () => {
  it('精白米30g＋水200g、完成180g → 精白米30g分×100/180', () => {
    const rice = food('01083');
    const water = { grams: 200, per100g: Object.fromEntries(NUTRIENTS.map((n) => [n.id, { value: 0, flag: 'measured' as const }])) };
    const r = recipePer100g([{ grams: 30, per100g: rice.per100g }, water], 180, NUTRIENTS);
    expect(r.energy.value).toBeCloseTo((342 * 0.3 * 100) / 180, 10);
    expect(r.iron.value).toBeCloseTo((0.8 * 0.3 * 100) / 180, 10);
  });
});

describe('T-08 鉄の表示がない市販ベビーフード', () => {
  it('鉄は0ではなく欠測（下限値）で、欠測食材の重量が出る', () => {
    const bf = { label: 'BF', grams: 12, per100g: { energy: { value: 60, flag: 'measured' as const } } };
    const d = computeDayIntake(
      { foods: [bf, { grams: 73, per100g: food('02007').per100g }], formula: [], breastMilkMl: 0 },
      NUTRIENTS,
      BREAST_MILK,
      7,
    );
    expect(d.iron.missing).toBe(true);
    expect(d.iron.missingFoodGrams).toBe(12);
    expect(d.iron.totalFoodGrams).toBe(85);
    expect(d.iron.total).toBeCloseTo((73 * 0.6) / 100, 10);
    const j = judge('iron', d, selectReference(INTAKE_REF, 'iron', 7, 'F'), 'mg');
    expect(j.lowerBound).toBe(true);
  });
});

describe('T-09 成分表の記号の変換', () => {
  it.each([
    ['1.2', 1.2, 'measured'],
    ['(1.2)', 1.2, 'estimated'],
    ['Tr', 0, 'trace'],
    ['(Tr)', 0, 'trace'],
    ['(0)', 0, 'zeroEst'],
    ['-', null, 'missing'],
    ['', null, 'missing'],
    ['*', null, 'missing'],
  ])('%s → %s / %s', (raw, value, flag) => {
    expect(parseToken(raw)).toEqual({ value, flag });
  });
  it('実データ：人乳のビタミンB12は Tr、ヨウ素は欠測', () => {
    const h = food('13051');
    expect(h.per100g.vitB12).toEqual({ value: 0, flag: 'trace' });
    expect(h.per100g.iodine.flag).toBe('missing');
    expect(food('01083').per100g.vitA).toEqual({ value: 0, flag: 'zeroEst' });
  });
});

describe('T-10 耐容上限量の超過', () => {
  it('ビタミンDが25μg以上で上限超過（文言つき）', () => {
    const d = computeDayIntake({ foods: [], formula: [{ ml: 1000, per100ml: { vitD: 3 } }], breastMilkMl: 0 }, NUTRIENTS, BREAST_MILK, 7);
    const j = judge('vitD', d, selectReference(INTAKE_REF, 'vitD', 7, 'F'), 'μg');
    expect(j.overUL).toBe(true);
    expect(j.status).toBe('over');
    expect(STATUS_TEXT[j.status]).toBe('上限を超えている');
  });
});

describe('T-11 混合栄養の積み上げ', () => {
  it('鉄に3つの供給源が出て、ミルクが最大、和が合計と一致', () => {
    const kayu = recipePer100g(
      [{ grams: 20, per100g: food('01083').per100g }],
      140,
      NUTRIENTS,
    );
    const d = computeDayIntake(
      {
        foods: [
          { grams: 30, per100g: kayu },
          { grams: 20, per100g: food('02007').per100g },
          { grams: 10, per100g: food('10154').per100g },
        ],
        formula: [formula(0.8, 250)],
        breastMilkMl: 480,
      },
      NUTRIENTS,
      BREAST_MILK,
      7,
    );
    const s = d.iron.bySource;
    expect(s.breast).toBeGreaterThan(0);
    expect(s.formula).toBeGreaterThan(0);
    expect(s.food).toBeGreaterThan(0);
    expect(s.formula).toBeGreaterThan(s.breast);
    expect(s.formula).toBeGreaterThan(s.food);
    expect(s.breast + s.formula + s.food).toBeCloseTo(d.iron.total, 10);
  });
});

describe('T-12 期間平均', () => {
  it('3日のうち1日が無記録 → 既定は記録のある2日で平均', () => {
    const mk = (ml: number) => computeDayIntake({ ...emptyDay(), formula: [formula(0.8, ml)] }, NUTRIENTS, BREAST_MILK, 7);
    const days = [
      { date: '2026-11-10', hasRecord: true, intake: mk(200) },
      { date: '2026-11-11', hasRecord: false, intake: computeDayIntake(emptyDay(), NUTRIENTS, BREAST_MILK, 7) },
      { date: '2026-11-12', hasRecord: true, intake: mk(300) },
    ];
    const a = averageIntake(days);
    expect(a.dayCount).toBe(2);
    expect(a.intake.iron.total).toBeCloseTo(2.0, 10);
    const b = averageIntake(days, true);
    expect(b.dayCount).toBe(3);
    expect(b.intake.iron.total).toBeCloseTo(4 / 3, 10);
  });
});

describe('T-13 成長曲線の相談の目安', () => {
  it('女児の体重が3パーセンタイル未満 → 相談の目安（診断的な語を含まない）', () => {
    const p = percentilesAt(GROWTH, 'F', 'weight', 7.3)!;
    const r = assessGrowth(GROWTH, 'F', 'weight', [{ ageMonths: 7.3, value: p[0] - 0.2 }]);
    expect(r.consult).toBe(true);
    expect(r.band!.label).toBe('3パーセンタイル未満');
    const text = r.reasons.join('');
    expect(text).not.toMatch(/異常|病気|欠乏症/);
  });
  it('曲線を2本以上またぐ変化', () => {
    const a = percentilesAt(GROWTH, 'F', 'weight', 4)!;
    const b = percentilesAt(GROWTH, 'F', 'weight', 7)!;
    const r = assessGrowth(GROWTH, 'F', 'weight', [
      { ageMonths: 4, value: (a[4] + a[5]) / 2 }, // 75〜90
      { ageMonths: 7, value: (b[1] + b[2]) / 2 }, // 10〜25
    ]);
    expect(r.consult).toBe(true);
  });
  it('中央付近は相談の目安を出さない', () => {
    const b = percentilesAt(GROWTH, 'F', 'weight', 7)!;
    expect(assessGrowth(GROWTH, 'F', 'weight', [{ ageMonths: 7, value: b[3] }]).consult).toBe(false);
  });
});

describe('参照データの整合性', () => {
  it('母乳のビタミンDは成分表の人乳から（約3μg/L）', () => {
    const c = breastMilkConcentration(BREAST_MILK, 'vitD', 7);
    expect(c.perL).toBeCloseTo(0.3 * 10 * 1.017, 10);
  });
  it('母乳中たんぱく質は月齢で切り替わる', () => {
    expect(breastMilkConcentration(BREAST_MILK, 'protein', 7).perL).toBe(10.6);
    expect(breastMilkConcentration(BREAST_MILK, 'protein', 10).perL).toBe(9.2);
  });
  it('脂質は%エネルギーで比較', () => {
    const d = computeDayIntake({ ...emptyDay(), breastMilkMl: 600 }, NUTRIENTS, BREAST_MILK, 7);
    const j = judge('fat', d, selectReference(INTAKE_REF, 'fat', 7, 'F'), 'g');
    expect(j.intakeUnit).toBe('%E');
    expect(j.intake).toBeCloseTo(((35.6 * 0.6 * 9) / (61 * 10.17 * 0.6)) * 100, 6);
  });
});

describe('食材検索（MEAL-02）', () => {
  it('ひらがな・カタカナ・漢字・別名・複数語で一致', async () => {
    const { searchFoods } = await import('../search');
    const names = (q: string) => searchFoods(FOODS, q).map((f) => f.code);
    expect(names('さば')).toContain('10154');
    expect(names('サバ')).toContain('10154');
    expect(names('鯖')).toContain('10154');
    expect(names('しらす干し')).toContain('10055');
    expect(names('さつまいも 蒸し')).toContain('02007');
    expect(names('ニンジン ゆで').length).toBeGreaterThan(0);
  });
  it('最近使った食材を上位に', async () => {
    const { searchFoods } = await import('../search');
    expect(searchFoods(FOODS, 'さば', ['mext:10156'])[0].code).toBe('10156');
    expect(searchFoods(FOODS, '', ['mext:10156'])[0].code).toBe('10156');
  });
  it('全食品対象で200ms以内（NFR-03）', async () => {
    const { searchFoods } = await import('../search');
    const t = performance.now();
    for (const q of ['に', 'にんじん', 'こめ かゆ', '鶏']) searchFoods(FOODS, q);
    expect((performance.now() - t) / 4).toBeLessThan(200);
  });
});

describe('よく使う食材（おかゆ）', () => {
  it('「おかゆ」で10倍・7倍・5倍がゆが出て、成分表の玄米などは混ざらない', async () => {
    const { PRESETS } = await import('../../data/refdata');
    const { presetToFood } = await import('../../lib/day');
    const { searchFoods, normalizeKana } = await import('../search');
    const presets = PRESETS.map((p) => presetToFood(p, food(p.code), normalizeKana));
    const hits = searchFoods(presets, 'おかゆ').map((f) => f.displayName);
    expect(hits).toEqual(expect.arrayContaining(['10倍がゆ', '7倍がゆ', '5倍がゆ（全がゆ）']));
    expect(hits).not.toContain('ごはん（普通炊き）');
    const mextHits = searchFoods(FOODS, 'おかゆ').map((f) => f.name);
    expect(mextHits.some((n) => n.includes('玄米') && n.includes('穀粒'))).toBe(false);
  });
  it('7倍がゆ＝全かゆ（5倍）×5/7 の推定値、10倍がゆは成分表の五分かゆそのまま', async () => {
    const { PRESETS } = await import('../../data/refdata');
    const { presetToFood } = await import('../../lib/day');
    const { normalizeKana } = await import('../search');
    const p7 = presetToFood(PRESETS.find((p) => p.id === 'okayu7')!, food('01093'), normalizeKana);
    expect(p7.per100g.energy.value).toBeCloseTo((65 * 5) / 7, 6);
    expect(p7.per100g.energy.flag).toBe('estimated');
    const p10 = presetToFood(PRESETS.find((p) => p.id === 'okayu10')!, food('01097'), normalizeKana);
    expect(p10.per100g.energy).toEqual(food('01097').per100g.energy);
  });
});

describe('成分表の食品名の表示', () => {
  it('中分類が名前に含まれなければ残す', async () => {
    const { friendlyName } = await import('../../data/foods');
    expect(friendlyName('＜魚類＞　（まぐろ類）　缶詰　水煮　フレーク　ライト')).toBe('まぐろ　缶詰　水煮　フレーク　ライト');
    expect(friendlyName('（にんじん類）　にんじん　根　皮なし　ゆで')).toBe('にんじん　根　皮なし　ゆで');
    expect(friendlyName('＜魚類＞　（さば類）　まさば　焼き')).toBe('まさば　焼き');
    expect(friendlyName('こめ　［水稲五分かゆ］　精白米')).toBe('こめ　水稲五分かゆ　精白米');
  });
});
