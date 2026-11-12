import { parseToken } from '../engine/token';
import { normalizeKana } from '../engine/search';
import { splitCookState } from '../engine/cookstate';
import type { NutrientValue } from '../engine/types';
import { ALIASES } from './refdata';

export interface MextFood {
  id: string; // "mext:01083"
  code: string;
  group: string;
  name: string;
  displayName: string;
  base: string;
  cookState: string | null;
  alias: string;
  keys: string;
  per100g: Record<string, NutrientValue>;
  raw: Record<string, string>;
}

export const FOOD_GROUPS: Record<string, string> = {
  '01': '穀類', '02': 'いも及びでん粉類', '03': '砂糖及び甘味類', '04': '豆類', '05': '種実類', '06': '野菜類',
  '07': '果実類', '08': 'きのこ類', '09': '藻類', '10': '魚介類', '11': '肉類', '12': '卵類', '13': '乳類',
  '14': '油脂類', '15': '菓子類', '16': 'し好飲料類', '17': '調味料及び香辛料類', '18': '調理済み流通食品類',
};

/**
 * 成分表の食品名を読みやすくする。＜魚類＞などの大分類と［］は外し、
 * （まぐろ類）などの中分類は、続く名前に含まれていなければ「まぐろ」として残す。
 */
export function friendlyName(name: string): string {
  let s = name.replace(/^＜[^＞]+＞　/, '');
  s = s.replace(/^（([^）]+)）　/, (_, cat: string) => {
    const stem = cat.replace(/類$/, '').split(/[・･]/)[0];
    const rest = s.replace(/^（[^）]+）　/, '');
    return rest.includes(stem) ? '' : `${stem}　`;
  });
  return s.replace(/[［］]/g, '');
}

/** 成分表 JSON を食品オブジェクトに展開する（純粋関数。テストでも使う） */
export function expandFoods(json: { columns: string[]; foods: string[][] }): MextFood[] {
  const nutrientIds = json.columns.slice(4);
  const aliasNorm = ALIASES.map((a) => ({ key: normalizeKana(a.key), aliases: a.aliases.map(normalizeKana).join(' ') }));
  return json.foods.map((r) => {
    const [code, group, name, alias] = r;
    const per100g: Record<string, NutrientValue> = {};
    const raw: Record<string, string> = {};
    nutrientIds.forEach((id, i) => {
      raw[id] = r[4 + i];
      per100g[id] = parseToken(r[4 + i]);
    });
    const displayName = friendlyName(name);
    const { base, state } = splitCookState(name);
    const nk = normalizeKana(name + alias);
    const extra = aliasNorm.filter((a) => nk.includes(a.key)).map((a) => a.aliases).join(' ');
    return {
      id: `mext:${code}`,
      code,
      group,
      name,
      displayName,
      base,
      cookState: state,
      alias,
      keys: `${nk} ${extra} ${code}`,
      per100g,
      raw,
    };
  });
}

let cache: Promise<MextFood[]> | null = null;
/** 成分表を遅延読み込み（初回のみ） */
export function loadMextFoods(): Promise<MextFood[]> {
  if (!cache) cache = import('./foods.json').then((m) => expandFoods((m.default ?? m) as { columns: string[]; foods: string[][] }));
  return cache;
}
