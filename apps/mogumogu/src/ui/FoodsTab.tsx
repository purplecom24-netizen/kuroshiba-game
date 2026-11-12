import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type CustomFood, type FormulaProduct } from '../db';
import { NUTRIENTS } from '../data/refdata';
import { useFoodMap } from '../hooks';
import { recipePer100g } from '../engine/recipe';
import { searchFoods } from '../engine/search';
import type { NutrientValue } from '../engine/types';
import { fmt } from '../lib/format';
import { Modal, NumberInput, Seg } from './common';
import type { FoodLike } from '../lib/day';

const WATER_ID = 'water';
const WATER: Record<string, NutrientValue> = Object.fromEntries(NUTRIENTS.map((n) => [n.id, { value: 0, flag: 'measured' as const }]));

type Section = 'custom' | 'formula' | 'recipe' | 'units';

export function FoodsTab() {
  const [sec, setSec] = useState<Section>('custom');
  return (
    <div>
      <Seg label="食材の種類" value={sec} onChange={setSec} options={[{ v: 'custom', l: 'カスタム・BF' }, { v: 'formula', l: 'ミルク銘柄' }, { v: 'recipe', l: 'レシピ' }, { v: 'units', l: '単位' }]} />
      <div style={{ marginTop: 12 }}>
        {sec === 'custom' && <CustomFoods />}
        {sec === 'formula' && <Formulas />}
        {sec === 'recipe' && <Recipes />}
        {sec === 'units' && <Units />}
      </div>
    </div>
  );
}

/* ---------- カスタム食材・市販ベビーフード ---------- */
function CustomFoods() {
  const list = useLiveQuery(() => db.customFoods.filter((f) => f.source !== 'recipe').toArray(), []);
  const [edit, setEdit] = useState<CustomFood | 'new' | null>(null);
  return (
    <div>
      <p className="muted">成分表にない食材や市販ベビーフードを、100gあたり（ベビーフードは1袋あたりでも可）の成分で登録します。空欄の栄養素は0ではなく「欠測」として扱います。</p>
      <button className="btn primary block" onClick={() => setEdit('new')}>＋ 食材を登録</button>
      <ul className="list card" style={{ marginTop: 12 }}>
        {list?.length === 0 && <li className="muted">まだ登録がありません</li>}
        {list?.map((f) => (
          <li key={f.id}>
            <button className="linkish" onClick={() => setEdit(f)}>
              {f.name}
              <span className="badge">{f.source === 'babyfood' ? 'ベビーフード' : 'カスタム'}</span>
              <span className="muted small"> 欠測 {NUTRIENTS.filter((n) => f.nutrients[n.id]?.value == null).length}項目</span>
            </button>
          </li>
        ))}
      </ul>
      {edit && <CustomFoodEditor food={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function CustomFoodEditor({ food, onClose }: { food: CustomFood | null; onClose: () => void }) {
  const [source, setSource] = useState<'custom' | 'babyfood'>(food?.source === 'babyfood' ? 'babyfood' : 'custom');
  const [name, setName] = useState(food?.name ?? '');
  const [aliases, setAliases] = useState(food?.aliases.join('、') ?? '');
  const [packGrams, setPackGrams] = useState<number | null>(food?.packGrams ?? null);
  const [basis, setBasis] = useState<'100g' | 'pack'>('100g');
  const [vals, setVals] = useState<Record<string, number | null>>(() => Object.fromEntries(NUTRIENTS.map((n) => [n.id, food?.nutrients[n.id]?.value ?? null])));
  const [density, setDensity] = useState<number | null>(food?.densityGPerMl ?? null);
  const main = ['energy', 'protein', 'fat', 'carbohydrate', 'salt', 'iron', 'calcium', 'zinc', 'vitD'];
  const [showAll, setShowAll] = useState(false);

  async function save() {
    const factor = basis === 'pack' && packGrams ? 100 / packGrams : 1;
    const nutrients: Record<string, NutrientValue> = {};
    for (const n of NUTRIENTS) {
      const v = vals[n.id];
      nutrients[n.id] = v === null || v === undefined ? { value: null, flag: 'missing' } : { value: v * factor, flag: 'measured' };
    }
    const rec: CustomFood = {
      source,
      name: name.trim(),
      aliases: aliases.split(/[、,\s]+/).filter(Boolean),
      nutrients,
      densityGPerMl: density,
      packGrams: source === 'babyfood' ? packGrams : null,
    };
    if (food?.id) await db.customFoods.put({ ...rec, id: food.id });
    else await db.customFoods.add(rec);
    onClose();
  }
  return (
    <Modal title={food ? '食材を編集' : '食材を登録'} onClose={onClose}>
      <div className="stack">
        <Seg label="種類" value={source} onChange={setSource} options={[{ v: 'custom', l: 'カスタム食材' }, { v: 'babyfood', l: '市販ベビーフード' }]} />
        <label className="field"><span>名前</span><input type="text" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field"><span>別名（検索用・読点区切り）</span><input type="text" value={aliases} onChange={(e) => setAliases(e.target.value)} /></label>
        {source === 'babyfood' && (
          <>
            <label className="field"><span>1袋の重量（g）</span><NumberInput value={packGrams} onChange={setPackGrams} ariaLabel="1袋の重量" /></label>
            <Seg label="成分表示の基準" value={basis} onChange={setBasis} options={[{ v: '100g', l: '100gあたり' }, { v: 'pack', l: '1袋あたり' }]} />
          </>
        )}
        <label className="field"><span>容量の係数（g/ml・任意）</span><NumberInput value={density} onChange={setDensity} ariaLabel="容量係数" /></label>
        <p className="muted">表示のない栄養素は空欄のままにしてください（0ではなく欠測になります）。</p>
        <div className="nutrient-form">
          {NUTRIENTS.filter((n) => showAll || main.includes(n.id)).map((n) => (
            <label key={n.id} className="field">
              <span>{n.shortJa}（{n.unit}）</span>
              <NumberInput value={vals[n.id]} onChange={(v) => setVals({ ...vals, [n.id]: v })} ariaLabel={n.nameJa} />
            </label>
          ))}
        </div>
        {!showAll && <button className="btn small" onClick={() => setShowAll(true)}>すべての栄養素を表示</button>}
      </div>
      <div className="actions">
        {food?.id && <button className="btn danger" onClick={async () => { if (confirm('削除しますか？')) { await db.customFoods.delete(food.id!); onClose(); } }}>削除</button>}
        <button className="btn primary" disabled={!name.trim() || (basis === 'pack' && !packGrams)} onClick={save}>保存</button>
      </div>
    </Modal>
  );
}

/* ---------- ミルク銘柄 ---------- */
function Formulas() {
  const list = useLiveQuery(() => db.formulas.toArray(), []);
  const [edit, setEdit] = useState<FormulaProduct | 'new' | null>(null);
  return (
    <div>
      <p className="muted">缶の栄養成分表示を入力します。100mlあたり（調乳後）と100gあたり（粉）のどちらか片方だけでも、標準調乳濃度があれば換算します。</p>
      <button className="btn primary block" onClick={() => setEdit('new')}>＋ 銘柄を登録</button>
      <ul className="list card" style={{ marginTop: 12 }}>
        {list?.length === 0 && <li className="muted">まだ登録がありません</li>}
        {list?.map((f) => (
          <li key={f.id}>
            <button className="linkish" onClick={() => setEdit(f)}>
              {f.maker} {f.name} <span className="muted small">鉄 {fmt(f.per100ml.iron ?? null)} mg/100ml</span>
            </button>
          </li>
        ))}
      </ul>
      {edit && <FormulaEditor product={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function FormulaEditor({ product, onClose }: { product: FormulaProduct | null; onClose: () => void }) {
  const [maker, setMaker] = useState(product?.maker ?? '');
  const [name, setName] = useState(product?.name ?? '');
  const [conc, setConc] = useState<number | null>(product?.gramsPer100ml ?? null);
  const [basis, setBasis] = useState<'ml' | 'g'>('ml');
  const [per100ml, setPer100ml] = useState<Record<string, number | null>>(product?.per100ml ?? {});
  const [per100g, setPer100g] = useState<Record<string, number | null>>(product?.per100g ?? {});
  const cur = basis === 'ml' ? per100ml : per100g;
  const setCur = basis === 'ml' ? setPer100ml : setPer100g;
  async function save() {
    const rec: FormulaProduct = { maker, name, per100ml, per100g, gramsPer100ml: conc };
    if (product?.id) await db.formulas.put({ ...rec, id: product.id });
    else await db.formulas.add(rec);
    onClose();
  }
  return (
    <Modal title={product ? '銘柄を編集' : '銘柄を登録'} onClose={onClose}>
      <div className="stack">
        <div className="row">
          <label className="field grow"><span>メーカー</span><input type="text" value={maker} onChange={(e) => setMaker(e.target.value)} /></label>
          <label className="field grow"><span>商品名</span><input type="text" value={name} onChange={(e) => setName(e.target.value)} /></label>
        </div>
        <label className="field"><span>標準調乳濃度（g / 100ml）</span><NumberInput value={conc} onChange={setConc} ariaLabel="標準調乳濃度" /></label>
        <Seg label="表示の基準" value={basis} onChange={setBasis} options={[{ v: 'ml', l: '100mlあたり（調乳後）' }, { v: 'g', l: '100gあたり（粉）' }]} />
        <p className="muted">缶に表示のない栄養素は空欄のまま（欠測）。</p>
        <div className="nutrient-form">
          {NUTRIENTS.map((n) => (
            <label key={n.id} className="field">
              <span>{n.shortJa}（{n.unit}）</span>
              <NumberInput value={cur[n.id] ?? null} onChange={(v) => setCur({ ...cur, [n.id]: v })} ariaLabel={`${n.nameJa} ${basis === 'ml' ? '100mlあたり' : '100gあたり'}`} />
            </label>
          ))}
        </div>
        <p className="muted small">ビタミンAは乳児の基準がレチノール（プロビタミンAを含まない）なので、缶のビタミンA（μg）をそのまま入れてください。ナイアシンは表示値（mg）を入れてください。</p>
      </div>
      <div className="actions">
        {product?.id && <button className="btn danger" onClick={async () => { if (confirm('削除しますか？')) { await db.formulas.delete(product.id!); onClose(); } }}>削除</button>}
        <button className="btn primary" disabled={!name} onClick={save}>保存</button>
      </div>
    </Modal>
  );
}

/* ---------- レシピ（作り置き） ---------- */
function Recipes() {
  const list = useLiveQuery(() => db.customFoods.where('source').equals('recipe').toArray(), []);
  const [edit, setEdit] = useState<CustomFood | 'new' | null>(null);
  const foods = useFoodMap();
  return (
    <div>
      <p className="muted">材料と完成重量（実測）から、完成品100gあたりの成分を計算します（例：七倍粥＝精白米＋水）。水分の増減は完成重量で吸収し、加熱によるビタミン等の損失は考慮しません。</p>
      <button className="btn primary block" onClick={() => setEdit('new')}>＋ レシピを登録</button>
      <ul className="list card" style={{ marginTop: 12 }}>
        {list?.length === 0 && <li className="muted">まだ登録がありません</li>}
        {list?.map((f) => (
          <li key={f.id}>
            <button className="linkish" onClick={() => setEdit(f)}>
              {f.name} <span className="muted small">完成 {f.recipe?.yieldGrams} g・材料 {f.recipe?.ingredients.length}品</span>
            </button>
          </li>
        ))}
      </ul>
      {edit && foods && <RecipeEditor recipe={edit === 'new' ? null : edit} foods={foods} onClose={() => setEdit(null)} />}
    </div>
  );
}

function RecipeEditor({ recipe, foods, onClose }: { recipe: CustomFood | null; foods: { map: Map<string, FoodLike>; list: FoodLike[]; recent: string[] }; onClose: () => void }) {
  const [name, setName] = useState(recipe?.name ?? '');
  const [ings, setIngs] = useState(recipe?.recipe?.ingredients ?? []);
  const [yieldG, setYieldG] = useState<number | null>(recipe?.recipe?.yieldGrams ?? null);
  const [q, setQ] = useState('');
  const [cube, setCube] = useState<number | null>(null);
  const results = useMemo(() => (q ? searchFoods(foods.list.filter((f) => f.source !== 'recipe' || f.id !== `custom:${recipe?.id}`), q, foods.recent, 10) : []), [q, foods, recipe]);
  const per100 = useMemo(
    () => (yieldG ? recipePer100g(ings.map((i) => ({ grams: i.grams, per100g: i.foodId === WATER_ID ? WATER : foods.map.get(i.foodId)?.per100g ?? {} })), yieldG, NUTRIENTS) : null),
    [ings, yieldG, foods],
  );
  async function save() {
    if (!per100 || !yieldG) return;
    const rec: CustomFood = { source: 'recipe', name, aliases: [], nutrients: per100, recipe: { ingredients: ings, yieldGrams: yieldG } };
    let id = recipe?.id;
    if (id) await db.customFoods.put({ ...rec, id });
    else id = await db.customFoods.add(rec);
    if (cube) await db.units.add({ foodId: `custom:${id}`, name: 'キューブ', grams: cube });
    onClose();
  }
  return (
    <Modal title={recipe ? 'レシピを編集' : 'レシピを登録'} onClose={onClose}>
      <div className="stack">
        <label className="field"><span>名前</span><input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="例：七倍粥" /></label>
        <div className="section-title">材料</div>
        <ul className="list">
          {ings.map((i, k) => (
            <li key={k} className="row">
              <span className="grow">{i.name}</span>
              <span style={{ width: 90 }}><NumberInput value={i.grams} onChange={(g) => setIngs(ings.map((x, j) => (j === k ? { ...x, grams: g ?? 0 } : x)))} ariaLabel={`${i.name}の重量`} /></span>
              <span>g</span>
              <button className="btn small danger" onClick={() => setIngs(ings.filter((_, j) => j !== k))} aria-label="材料を削除">✕</button>
            </li>
          ))}
        </ul>
        <input type="search" placeholder="材料を検索" value={q} onChange={(e) => setQ(e.target.value)} aria-label="材料を検索" />
        <button className="btn small" onClick={() => setIngs([...ings, { foodId: WATER_ID, name: '水（成分0として計算）', grams: 0 }])}>＋ 水</button>
        {results.map((f) => (
          <button key={f.id} className="result-item" onClick={() => { setIngs([...ings, { foodId: f.id, name: f.displayName, grams: 0 }]); setQ(''); }}>
            {f.displayName}
          </button>
        ))}
        <label className="field"><span>完成重量（実測 g）</span><NumberInput value={yieldG} onChange={setYieldG} ariaLabel="完成重量" /></label>
        {!recipe && <label className="field"><span>分割単位（1キューブ＝g・任意）</span><NumberInput value={cube} onChange={setCube} ariaLabel="1キューブの重さ" /></label>}
        {per100 && (
          <div className="notice small">
            完成品100gあたり：エネルギー {fmt(per100.energy.value)} kcal、たんぱく質 {fmt(per100.protein.value)} g、鉄 {fmt(per100.iron.value)} mg
            <br />加熱によるビタミン等の損失は考慮していません。
          </div>
        )}
      </div>
      <div className="actions">
        {recipe?.id && <button className="btn danger" onClick={async () => { if (confirm('削除しますか？')) { await db.customFoods.delete(recipe.id!); onClose(); } }}>削除</button>}
        <button className="btn primary" disabled={!name || !yieldG || ings.length === 0} onClick={save}>保存</button>
      </div>
    </Modal>
  );
}

/* ---------- 単位 ---------- */
function Units() {
  const units = useLiveQuery(() => db.units.toArray(), []);
  const prefs = useLiveQuery(() => db.foodPrefs.filter((p) => !!p.densityGPerMl).toArray(), []);
  const foods = useFoodMap();
  const [name, setName] = useState('');
  const [grams, setGrams] = useState<number | null>(null);
  const nameOf = (id: string | null) => (id ? foods?.map.get(id)?.displayName ?? id : '共通');
  return (
    <div>
      <p className="muted">「さじ」（手持ちの離乳食スプーン1杯）や「キューブ」（製氷皿1個）など、自分の単位を「1単位＝○g」で登録します。食材ごとの単位は量の入力画面から追加できます。</p>
      <div className="card">
        <h3>共通の単位を追加</h3>
        <div className="row">
          <label className="field grow"><span>名前</span><input type="text" value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label className="field" style={{ width: 120 }}><span>1単位＝g</span><NumberInput value={grams} onChange={setGrams} ariaLabel="1単位のグラム" /></label>
        </div>
        <button className="btn small primary" style={{ marginTop: 8 }} disabled={!name || !grams} onClick={async () => { await db.units.add({ foodId: null, name, grams }); setName(''); setGrams(null); }}>追加</button>
      </div>
      <ul className="list card">
        {units?.length === 0 && <li className="muted">まだ登録がありません</li>}
        {units?.map((u) => (
          <li key={u.id} className="row between">
            <span>{u.name} = {u.grams ? `${u.grams} g` : `${u.ml} ml`} <span className="muted small">（{nameOf(u.foodId)}）</span></span>
            <button className="btn small danger" onClick={() => db.units.delete(u.id!)}>削除</button>
          </li>
        ))}
      </ul>
      <div className="section-title">容量→重量の係数（実測）</div>
      <ul className="list card">
        {prefs?.length === 0 && <li className="muted">まだ登録がありません</li>}
        {prefs?.map((p) => (
          <li key={p.foodId} className="row between">
            <span>{nameOf(p.foodId)}：{fmt(p.densityGPerMl!, 3)} g/ml</span>
            <button className="btn small danger" onClick={() => db.foodPrefs.update(p.foodId, { densityGPerMl: null })}>削除</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
