import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Child, type MealItem, type UnitDef } from '../db';
import type { FoodLike } from '../lib/day';
import { searchFoods } from '../engine/search';
import { COOK_STATES } from '../engine/cookstate';
import { EATEN_RATIOS, UNIT_LABEL, eatenGrams, toGrams, type EatenRatioKey, type UnitKind } from '../engine/units';
import { fmt } from '../lib/format';
import { Modal, NumberInput, Seg } from './common';
import { FOOD_GROUPS } from '../data/foods';

const REACTIONS = ['好き', '普通', '嫌い', '吐き出し'];

interface Props {
  child: Child;
  date: string;
  mealId: number;
  item?: MealItem;
  foods: { map: Map<string, FoodLike>; list: FoodLike[]; recent: string[] };
  onClose: () => void;
}

export function FoodEntry({ child, date, mealId, item, foods, onClose }: Props) {
  const [food, setFood] = useState<FoodLike | null>(item ? foods.map.get(item.foodId) ?? null : null);
  const [query, setQuery] = useState('');
  const [cookNote, setCookNote] = useState<string | null>(item?.cookNote ?? null);
  const [amount, setAmount] = useState<number | null>(item?.amount ?? null);
  const [unit, setUnit] = useState<UnitKind>(item?.unit ?? 'g');
  const [unitId, setUnitId] = useState<number | null>(item?.unitId ?? null);
  const [mode, setMode] = useState<'leftover' | 'ratio'>(item?.eatenRatio ? 'ratio' : 'leftover');
  const [leftover, setLeftover] = useState<number | null>(item?.leftoverGrams ?? null);
  const [ratio, setRatio] = useState<EatenRatioKey>(item?.eatenRatio ?? 'all');
  const [reaction, setReaction] = useState<string | null>(item?.reaction ?? null);
  const [note, setNote] = useState(item?.note ?? '');
  const [densityG, setDensityG] = useState<number | null>(null); // 大さじ1の実測g
  const [newUnit, setNewUnit] = useState<{ name: string; grams: number | null } | null>(null);

  const results = useMemo(() => searchFoods(foods.list, query, foods.recent, 40), [foods, query]);
  const units = useLiveQuery(
    (): Promise<UnitDef[]> => (food ? db.units.filter((u) => u.foodId === food.id || u.foodId === null).toArray() : Promise.resolve([])),
    [food?.id],
  );
  const customUnit = units?.find((u) => u.id === unitId);

  const siblings = useMemo(() => {
    if (!food || food.source !== 'mext' || !food.base) return [];
    return foods.list.filter((f) => f.source === 'mext' && f.base === food.base && f.cookState).sort((a, b) => (a.code! < b.code! ? -1 : 1));
  }, [food, foods.list]);
  const missingStates = COOK_STATES.filter((s) => !siblings.some((f) => f.cookState === s));

  const density = food?.density ?? (densityG ? densityG / 15 : null);
  const conv = amount !== null && food ? toGrams(amount, unit, density, unit === 'custom' ? customUnit ?? undefined : undefined) : null;
  const served = conv && conv.ok ? conv.grams : null;
  const eaten = served !== null ? eatenGrams(served, mode === 'leftover' ? { leftoverGrams: leftover ?? 0 } : { ratio }) : null;
  const lowConf = food && Object.values(food.per100g).every((v) => v.value === null);

  async function save() {
    if (!food || served === null || eaten === null) return;
    if (densityG && !food.density) await db.foodPrefs.put({ ...(await db.foodPrefs.get(food.id)), foodId: food.id, densityGPerMl: densityG / 15 });
    const rec: MealItem = {
      mealId,
      childId: child.id!,
      date,
      foodId: food.id,
      foodName: food.displayName,
      cookNote,
      amount: amount ?? 0,
      unit,
      unitId: unit === 'custom' ? unitId : null,
      servedGrams: served,
      leftoverGrams: mode === 'leftover' ? leftover ?? 0 : null,
      eatenRatio: mode === 'ratio' ? ratio : null,
      eatenGrams: eaten,
      reaction,
      note: note || null,
    };
    if (item?.id) await db.mealItems.update(item.id, rec);
    else await db.mealItems.add(rec);
    const pref = await db.foodPrefs.get(food.id);
    await db.foodPrefs.put({ ...(pref ?? {}), foodId: food.id, lastUsed: Date.now() });
    onClose();
  }

  if (!food) {
    return (
      <Modal title="食材を選ぶ" onClose={onClose}>
        <input
          type="search"
          autoFocus
          placeholder="例：さば、しらす、にんじん、おかゆ"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="食材を検索"
        />
        <p className="muted" style={{ margin: '6px 0' }}>{query ? `${results.length}件${results.length >= 40 ? '以上' : ''}` : '最近使った食材'}</p>
        <div role="list">
          {results.map((f) => (
            <button
              key={f.id}
              role="listitem"
              className="result-item"
              onClick={() => {
                setFood(f);
                setCookNote(null);
                if (f.packGrams) {
                  setAmount(f.packGrams);
                  setUnit('g');
                }
              }}
            >
              <span>
                {f.displayName}
                {f.source !== 'mext' && <span className="badge">{f.source === 'recipe' ? 'レシピ' : f.source === 'babyfood' ? 'ベビーフード' : 'カスタム'}</span>}
              </span>
              <span className="muted small">{f.code ? `${FOOD_GROUPS[f.code.slice(0, 2)] ?? ''} ${f.code}` : ''}</span>
            </button>
          ))}
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={item ? '食材を編集' : '量を入力'} onClose={onClose}>
      <div className="stack">
        <div className="row between">
          <strong className="grow">{food.displayName}</strong>
          {!item && <button className="btn small" onClick={() => setFood(null)}>選び直す</button>}
        </div>
        {lowConf && <div className="notice warn">この食材は成分が登録されていません（すべて欠測として扱います）。</div>}

        {food.source === 'mext' && (siblings.length > 0 || food.cookState === null) && (
          <label className="field">
            <span>調理状態（重量は与える時点＝調理後の重さで入力）</span>
            <select
              value={cookNote ? `other:${cookNote}` : food.id}
              onChange={(e) => {
                const v = e.target.value;
                if (v.startsWith('other:')) setCookNote(v.slice(6));
                else {
                  setCookNote(null);
                  const f = foods.map.get(v);
                  if (f) setFood(f);
                }
              }}
            >
              {siblings.length === 0 && <option value={food.id}>（成分表の値のまま）</option>}
              {siblings.map((s) => (
                <option key={s.id} value={s.id}>{s.cookState}（成分表 {s.code}）</option>
              ))}
              {missingStates.map((s) => (
                <option key={s} value={`other:${s}（調理による変化は未考慮）`}>{s}（成分表になし → 選んだ食品の値で計算）</option>
              ))}
            </select>
          </label>
        )}
        {cookNote && <div className="notice warn small">成分表に対応する食品がないため、{food.cookState ?? '選んだ食品'}の値で計算します。調理による変化は未考慮です。</div>}

        <div className="row" style={{ alignItems: 'flex-end' }}>
          <label className="field grow"><span>提供量</span><NumberInput value={amount} onChange={setAmount} ariaLabel="提供量" /></label>
          <label className="field" style={{ width: 150 }}>
            <span>単位</span>
            <select
              aria-label="単位"
              value={unit === 'custom' ? `u:${unitId}` : unit}
              onChange={(e) => {
                const v = e.target.value;
                if (v === 'new') setNewUnit({ name: '', grams: null });
                else if (v.startsWith('u:')) {
                  setUnit('custom');
                  setUnitId(Number(v.slice(2)));
                } else setUnit(v as UnitKind);
              }}
            >
              {(Object.keys(UNIT_LABEL) as (keyof typeof UNIT_LABEL)[]).map((k) => (
                <option key={k} value={k}>{UNIT_LABEL[k]}{k === 'tsp' ? '(5ml)' : k === 'tbsp' ? '(15ml)' : k === 'cup' ? '(200ml)' : ''}</option>
              ))}
              {units?.map((u) => (
                <option key={u.id} value={`u:${u.id}`}>{u.name}（{u.grams ? `${u.grams}g` : `${u.ml}ml`}）</option>
              ))}
              <option value="new">＋単位を追加…</option>
            </select>
          </label>
        </div>
        {unit === 'custom' && customUnit && (
          <div className="chips" aria-label="ワンタップ加算">
            {[1, 2, 3, 5].map((n) => (
              <button key={n} className="chip" type="button" onClick={() => setAmount((amount ?? 0) + n)}>＋{n}{customUnit.name}</button>
            ))}
            <button className="chip" type="button" onClick={() => setAmount(0)}>クリア</button>
          </div>
        )}
        {unit === 'g' && (
          <div className="chips">
            {[5, 10, 15, 20, 30, 50].map((n) => (
              <button key={n} className="chip" type="button" onClick={() => setAmount(n)}>{n}g</button>
            ))}
          </div>
        )}
        {newUnit && (
          <div className="card">
            <h3>単位を追加（この食材用）</h3>
            <div className="row">
              <label className="field grow"><span>名前（例：さじ、キューブ）</span><input type="text" value={newUnit.name} onChange={(e) => setNewUnit({ ...newUnit, name: e.target.value })} /></label>
              <label className="field" style={{ width: 120 }}><span>1単位＝g</span><NumberInput value={newUnit.grams} onChange={(g) => setNewUnit({ ...newUnit, grams: g })} ariaLabel="1単位のグラム" /></label>
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn small" onClick={() => setNewUnit(null)}>やめる</button>
              <button
                className="btn small primary"
                disabled={!newUnit.name || !newUnit.grams}
                onClick={async () => {
                  const id = await db.units.add({ foodId: food.id, name: newUnit.name, grams: newUnit.grams });
                  setUnit('custom');
                  setUnitId(id);
                  setNewUnit(null);
                }}
              >
                追加
              </button>
            </div>
          </div>
        )}
        {conv && !conv.ok && conv.reason === 'needDensity' && (
          <div className="notice warn">
            <p style={{ margin: '0 0 6px' }}>この食材は容量（ml）から重さに直す係数がありません。大さじ1杯（15ml）の重さを一度量って入力してください。以後はその値を使います。</p>
            <label className="field"><span>大さじ1杯の重さ（g）</span><NumberInput value={densityG} onChange={setDensityG} ariaLabel="大さじ1杯の重さ" /></label>
          </div>
        )}

        <div>
          <Seg label="食べた量の記録方法" value={mode} onChange={setMode} options={[{ v: 'leftover', l: '残量（g）' }, { v: 'ratio', l: '摂取割合' }]} />
          <div style={{ marginTop: 8 }}>
            {mode === 'leftover' ? (
              <label className="field"><span>残した量（g）</span><NumberInput value={leftover} onChange={setLeftover} ariaLabel="残量" /></label>
            ) : (
              <div className="chips">
                {EATEN_RATIOS.map((r) => (
                  <button key={r.key} type="button" className="chip" aria-pressed={ratio === r.key} onClick={() => setRatio(r.key)}>{r.label}</button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="notice">
          提供 <strong>{fmt(served, 1)} g</strong> → 食べた量 <strong>{fmt(eaten, 1)} g</strong>
        </div>

        <details>
          <summary className="muted">反応・メモ</summary>
          <div className="chips" style={{ marginTop: 6 }}>
            {REACTIONS.map((r) => (
              <button key={r} type="button" className="chip" aria-pressed={reaction === r} onClick={() => setReaction(reaction === r ? null : r)}>{r}</button>
            ))}
          </div>
          <label className="field" style={{ marginTop: 6 }}><span>メモ</span><input type="text" value={note} onChange={(e) => setNote(e.target.value)} /></label>
        </details>
      </div>
      <div className="actions">
        {item?.id && (
          <button className="btn danger" onClick={async () => { await db.mealItems.delete(item.id!); onClose(); }}>削除</button>
        )}
        <button className="btn primary" disabled={eaten === null} onClick={save}>保存</button>
      </div>
    </Modal>
  );
}
