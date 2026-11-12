import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, DEFAULT_SETTINGS, type Settings } from './db';
import { loadMextFoods, type MextFood } from './data/foods';
import { customToFood, mextToFood, type FoodLike } from './lib/day';
import { normalizeKana } from './engine/search';

export function useSettings(): Settings {
  const s = useLiveQuery(() => db.settings.get('app'), []);
  return useMemo(() => ({ ...DEFAULT_SETTINGS, ...(s ?? {}) }), [s]);
}

export function useActiveChild() {
  const settings = useSettings();
  const children = useLiveQuery(() => db.children.toArray(), []);
  const child = children?.find((c) => c.id === settings.activeChildId) ?? children?.[0];
  return { child, children, loaded: children !== undefined };
}

export function useMextFoods(): MextFood[] | null {
  const [foods, setFoods] = useState<MextFood[] | null>(null);
  useEffect(() => {
    let live = true;
    loadMextFoods().then((f) => live && setFoods(f));
    return () => {
      live = false;
    };
  }, []);
  return foods;
}

/** 成分表＋カスタム食材をまとめた食材辞書 */
export function useFoodMap() {
  const mext = useMextFoods();
  const custom = useLiveQuery(() => db.customFoods.toArray(), []);
  const prefs = useLiveQuery(() => db.foodPrefs.toArray(), []);
  return useMemo(() => {
    if (!mext || !custom || !prefs) return null;
    const map = new Map<string, FoodLike>();
    for (const f of mext) map.set(f.id, mextToFood(f));
    for (const c of custom) map.set(`custom:${c.id}`, customToFood(c, normalizeKana));
    const pmap = new Map(prefs.map((p) => [p.foodId, p]));
    for (const [id, f] of map) {
      const p = pmap.get(id);
      if (p?.densityGPerMl) f.density = p.densityGPerMl;
      else if (f.density == null && isLiquid(f)) f.density = 1.0;
    }
    const recent = prefs.filter((p) => p.lastUsed).sort((a, b) => b.lastUsed! - a.lastUsed!).map((p) => p.foodId);
    return { map, list: [...map.values()], recent };
  }, [mext, custom, prefs]);
}

/** 液体の既定係数 1.0（要件 6.1）。成分表のし好飲料類・液状乳類・人乳・だし等 */
export function isLiquid(f: FoodLike): boolean {
  if (f.source !== 'mext') return false;
  if (f.code?.startsWith('16')) return true;
  return /液状乳類|人乳|普通牛乳|豆乳|ジュース|だし|スープ|ストレート|液体ミルク/.test(f.name);
}
