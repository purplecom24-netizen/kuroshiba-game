import { useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, addFormulaFromPreset, type Child, type Meal, type MealItem, type MealSlot, type MilkFeed, type Settings } from '../db';
import { useFoodMap } from '../hooks';
import { useUI } from '../store';
import { addDays } from '../engine/age';
import { fmt, jpDate, nowTime, todayStr } from '../lib/format';
import { Modal, NumberInput, Seg } from './common';
import { FoodEntry } from './FoodEntry';
import { drunkMl } from '../engine/units';
import { FORMULA_PRESETS } from '../data/refdata';

export const SLOT_LABEL: Record<MealSlot, string> = { '1': '1回目', '2': '2回目', '3': '3回目', snack: '補食' };

export function RecordTab({ child, settings }: { child: Child; settings: Settings }) {
  const { date, setDate, setTab } = useUI();
  const cid = child.id!;
  const meals = useLiveQuery(() => db.meals.where({ childId: cid, date }).sortBy('time'), [cid, date]);
  const items = useLiveQuery(() => db.mealItems.where({ childId: cid, date }).toArray(), [cid, date]);
  const feeds = useLiveQuery(() => db.milkFeeds.where({ childId: cid, date }).sortBy('time'), [cid, date]);
  const est = useLiveQuery(() => db.breastEstimates.get([cid, date]), [cid, date]);
  const formulas = useLiveQuery(() => db.formulas.toArray(), []);
  const foods = useFoodMap();
  const [entry, setEntry] = useState<{ mealId: number; item?: MealItem } | null>(null);
  const [milk, setMilk] = useState<MilkFeed | 'new' | null>(null);
  const [editEst, setEditEst] = useState(false);
  const [slide, setSlide] = useState<'next' | 'prev' | null>(null);
  const touch = useRef<{ x: number; y: number; at: number } | null>(null);
  const go = (n: number) => {
    setSlide(n > 0 ? 'next' : 'prev');
    setDate(addDays(date, n));
  };

  const breastCount = feeds?.filter((f) => f.kind === 'breast').length ?? 0;
  const formulaMl = feeds?.filter((f) => f.kind === 'formula').reduce((s, f) => s + drunkMl(f.ml ?? 0, f.leftoverMl), 0) ?? 0;
  const foodGrams = items?.reduce((s, i) => s + i.eatenGrams, 0) ?? 0;
  const hasRecord = (meals?.length ?? 0) + (feeds?.length ?? 0) > 0 || !!est;
  const breastMl = est ? est.ml : hasRecord && child.feedingType !== 'formula' ? settings.defaultBreastMilkMl : 0;

  const backupDue = useMemo(() => {
    const base = settings.lastBackupAt ?? settings.createdAt;
    return Date.now() - base > 14 * 86400000;
  }, [settings.lastBackupAt, settings.createdAt]);

  async function addMeal() {
    const n = meals?.length ?? 0;
    const slot: MealSlot = n === 0 ? '1' : n === 1 ? '2' : n === 2 ? '3' : 'snack';
    const id = await db.meals.add({ childId: cid, date, time: nowTime(), slot });
    setEntry({ mealId: id });
  }

  async function copyPrevious() {
    const prev = await db.meals.where('childId').equals(cid).filter((m) => m.date <= date).toArray();
    prev.sort((a, b) => (a.date + a.time < b.date + b.time ? 1 : -1));
    const last = prev[0];
    if (!last) return alert('コピーできる前回の食事がありません');
    const its = await db.mealItems.where('mealId').equals(last.id!).toArray();
    const n = meals?.length ?? 0;
    const slot: MealSlot = n === 0 ? '1' : n === 1 ? '2' : n === 2 ? '3' : 'snack';
    const id = await db.meals.add({ childId: cid, date, time: nowTime(), slot });
    await db.mealItems.bulkAdd(its.map(({ id: _id, ...it }) => ({ ...it, mealId: id, date, reaction: null, note: null })));
  }

  async function addBreast() {
    await db.milkFeeds.add({ childId: cid, date, time: nowTime(), kind: 'breast' });
  }

  return (
    <div
      className="swipe-area"
      onTouchStart={(e) => {
        const t = e.touches[0];
        const el = e.target as HTMLElement;
        // ポップアップ・入力欄上、画面端（iOSの戻る操作）からのスワイプは無視
        if (el.closest('.modal, input, select, textarea') || t.clientX < 24 || t.clientX > window.innerWidth - 24) touch.current = null;
        else touch.current = { x: t.clientX, y: t.clientY, at: Date.now() };
      }}
      onTouchEnd={(e) => {
        const s0 = touch.current;
        touch.current = null;
        if (!s0) return;
        const t = e.changedTouches[0];
        const dx = t.clientX - s0.x;
        const dy = t.clientY - s0.y;
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5 && Date.now() - s0.at < 800) go(dx < 0 ? 1 : -1);
      }}
    >
      {backupDue && (
        <div className="notice warn">
          最後のバックアップから14日以上たっています。端末のデータ消失に備えて、JSONでバックアップしてください。{' '}
          <button className="btn small" onClick={() => setTab('settings')}>設定へ</button>
        </div>
      )}
      <div className="date-nav">
        <button className="btn small" onClick={() => go(-1)} aria-label="前の日">◀</button>
        <div className="date-cell">
          {/* 表示は自前で中央ぞろえ。タップは上に重ねた透明な日付欄が受けてカレンダーを開く */}
          <span className="date-label" aria-hidden="true">{date.replace(/-/g, '/')}{jpDate(date).replace(/^[^（]*/, '')}</span>
          <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="日付" />
        </div>
        <button className="btn small" onClick={() => go(1)} aria-label="次の日">▶</button>
        <button
          className="btn small"
          onClick={() => { setSlide(date > todayStr() ? 'prev' : 'next'); setDate(todayStr()); }}
          style={{ visibility: date === todayStr() ? 'hidden' : 'visible' }}
          aria-hidden={date === todayStr()}
          tabIndex={date === todayStr() ? -1 : 0}
        >
          今日
        </button>
      </div>
      <div key={date} className={slide ? `day-slide ${slide}` : undefined}>

      <div className="card">
        <h2>{jpDate(date)} のまとめ</h2>
        <dl className="kv">
          <dt>離乳食（食べた量）</dt>
          <dd>{fmt(foodGrams, 1)} g</dd>
          <dt>ミルク（飲んだ量）</dt>
          <dd>{fmt(formulaMl, 0)} ml</dd>
          <dt>母乳（推定）</dt>
          <dd>
            {fmt(breastMl, 0)} ml
            <span className="muted">（{est ? '手入力' : child.feedingType === 'formula' ? 'ミルクのみ' : hasRecord ? '既定値' : '記録なし'}・授乳{breastCount}回）</span>
          </dd>
        </dl>
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn small" onClick={() => setEditEst(true)}>母乳の推定量を変更</button>
        </div>
      </div>

      <div className="row" style={{ marginBottom: 12 }}>
        <button className="btn primary grow" onClick={addMeal}>＋ 食事</button>
        <button className="btn grow" onClick={() => setMilk('new')}>＋ ミルク</button>
        <button className="btn grow" onClick={addBreast}>＋ 授乳</button>
      </div>
      <div className="row" style={{ marginBottom: 12 }}>
        <button className="btn small" onClick={copyPrevious}>前回の食事をコピー</button>
      </div>

      {meals?.map((m) => (
        <MealCard key={m.id} meal={m} items={items?.filter((i) => i.mealId === m.id) ?? []} onAdd={() => setEntry({ mealId: m.id! })} onEdit={(item) => setEntry({ mealId: m.id!, item })} />
      ))}

      {feeds && feeds.length > 0 && (
        <div className="card">
          <h3>ミルク・授乳</h3>
          <ul className="list">
            {feeds.map((f) => (
              <li key={f.id}>
                <button className="linkish" onClick={() => setMilk(f)}>
                  <div className="row between">
                    <span>
                      {f.time}　{f.kind === 'breast' ? '授乳' : formulas?.find((p) => p.id === f.formulaId)?.name ?? 'ミルク（銘柄未設定）'}
                    </span>
                    <span className="muted">
                      {f.kind === 'formula' ? `${fmt(drunkMl(f.ml ?? 0, f.leftoverMl), 0)} ml${f.leftoverMl ? `（残${f.leftoverMl}）` : ''}` : f.durationMin ? `${f.durationMin}分` : ''}
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      </div>

      {entry && foods && (
        <FoodEntry
          child={child}
          date={date}
          mealId={entry.mealId}
          item={entry.item}
          foods={foods}
          onClose={async () => {
            // 空の食事は残さない
            const n = await db.mealItems.where('mealId').equals(entry.mealId).count();
            if (n === 0) await db.meals.delete(entry.mealId);
            setEntry(null);
          }}
        />
      )}
      {entry && !foods && <Modal title="食材" onClose={() => setEntry(null)}><p>成分表を読み込み中…</p></Modal>}
      {milk && <MilkEditor child={child} date={date} feed={milk === 'new' ? null : milk} onClose={() => setMilk(null)} />}
      {editEst && <BreastEstimateEditor child={child} date={date} current={breastMl} manual={!!est} defaultMl={settings.defaultBreastMilkMl} onClose={() => setEditEst(false)} />}
    </div>
  );
}

function MealCard({ meal, items, onAdd, onEdit }: { meal: Meal; items: MealItem[]; onAdd: () => void; onEdit: (i: MealItem) => void }) {
  const total = items.reduce((s, i) => s + i.eatenGrams, 0);
  return (
    <div className="card">
      <div className="row between">
        <h3 style={{ margin: 0 }}>
          <select
            aria-label="食事区分"
            value={meal.slot}
            onChange={(e) => db.meals.update(meal.id!, { slot: e.target.value as MealSlot })}
            style={{ width: 'auto', minHeight: 32, padding: '2px 6px', fontWeight: 700 }}
          >
            {Object.entries(SLOT_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>{' '}
          <input type="time" value={meal.time} onChange={(e) => db.meals.update(meal.id!, { time: e.target.value })} style={{ width: 'auto', minHeight: 32, padding: '2px 6px' }} aria-label="時刻" />
        </h3>
        <span className="muted">計 {fmt(total, 1)} g</span>
      </div>
      <ul className="list">
        {items.map((i) => (
          <li key={i.id}>
            <button className="linkish" onClick={() => onEdit(i)}>
              <div className="row between">
                <span className="grow">
                  {i.foodName}
                  {i.cookNote ? <span className="badge">{i.cookNote}</span> : null}
                  {i.reaction ? <span className="badge">{i.reaction}</span> : null}
                </span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {fmt(i.eatenGrams, 1)} g<span className="muted"> / {fmt(i.servedGrams, 1)}</span>
                </span>
              </div>
            </button>
          </li>
        ))}
      </ul>
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn small" onClick={onAdd}>＋ 食材を追加</button>
        {items.length === 0 && (
          <button className="btn small danger" onClick={() => db.meals.delete(meal.id!)}>この食事を削除</button>
        )}
      </div>
    </div>
  );
}

function MilkEditor({ child, date, feed, onClose }: { child: Child; date: string; feed: MilkFeed | null; onClose: () => void }) {
  const formulas = useLiveQuery(() => db.formulas.toArray(), []);
  const lastFormula = useLiveQuery(() => db.milkFeeds.where('childId').equals(child.id!).filter((f) => f.kind === 'formula' && !!f.formulaId).last(), [child.id]);
  const [kind, setKind] = useState<'formula' | 'breast'>(feed?.kind ?? 'formula');
  const [formulaId, setFormulaId] = useState<number | null>(feed?.formulaId ?? null);
  const [ml, setMl] = useState<number | null>(feed?.ml ?? null);
  const [left, setLeft] = useState<number | null>(feed?.leftoverMl ?? null);
  const [dur, setDur] = useState<number | null>(feed?.durationMin ?? null);
  const [time, setTime] = useState(feed?.time ?? nowTime());
  const { setTab } = useUI();

  const defaultFormulaId = lastFormula?.formulaId ?? formulas?.[0]?.id ?? null;
  const fid = formulaId ?? (feed ? null : defaultFormulaId);

  async function save() {
    let fid = formulaId ?? (feed ? null : defaultFormulaId);
    if (kind === 'formula' && fid === null && !feed && formulaId === null) {
      // 銘柄一覧の読み込み前に保存された場合も既定の銘柄を使う
      const last = await db.milkFeeds.where('childId').equals(child.id!).filter((f) => f.kind === 'formula' && !!f.formulaId).last();
      fid = last?.formulaId ?? (await db.formulas.toCollection().first())?.id ?? null;
    }
    const rec: MilkFeed = { childId: child.id!, date, time, kind, formulaId: kind === 'formula' ? fid : null, ml: kind === 'formula' ? ml : null, leftoverMl: kind === 'formula' ? left : null, durationMin: kind === 'breast' ? dur : null };
    if (feed?.id) await db.milkFeeds.update(feed.id, rec);
    else await db.milkFeeds.add(rec);
    onClose();
  }
  return (
    <Modal title={feed ? '記録を編集' : 'ミルク・授乳を記録'} onClose={onClose}>
      <div className="stack">
        <Seg label="種類" value={kind} onChange={setKind} options={[{ v: 'formula', l: 'ミルク' }, { v: 'breast', l: '授乳（母乳）' }]} />
        <label className="field"><span>時刻</span><input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label>
        {kind === 'formula' ? (
          <>
            <label className="field">
              <span>銘柄</span>
              <select
                aria-label="銘柄"
                value={fid ?? ''}
                onChange={async (e) => {
                  const v = e.target.value;
                  if (v.startsWith('preset:')) {
                    const p = FORMULA_PRESETS.find((x) => x.id === v.slice(7));
                    if (p) setFormulaId(await addFormulaFromPreset(p));
                  } else if (v === 'manual') {
                    onClose();
                    setTab('foods');
                  } else setFormulaId(v ? Number(v) : null);
                }}
              >
                <option value="">（未選択：成分は欠測）</option>
                {formulas && formulas.length > 0 && (
                  <optgroup label="登録済みの銘柄">
                    {formulas.map((f) => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                  </optgroup>
                )}
                <optgroup label="メーカーの成分表示から選ぶ">
                  {FORMULA_PRESETS.filter((p) => !formulas?.some((f) => f.presetId === p.id)).map((p) => (
                    <option key={p.id} value={`preset:${p.id}`}>{p.name}（{p.maker}）</option>
                  ))}
                </optgroup>
                <option value="manual">その他の銘柄（缶の表示を手入力）…</option>
              </select>
            </label>
            <div className="row">
              <label className="field grow"><span>作った量（ml）</span><NumberInput value={ml} onChange={setMl} ariaLabel="作った量" /></label>
              <label className="field grow"><span>飲み残し（ml）</span><NumberInput value={left} onChange={setLeft} ariaLabel="飲み残し" /></label>
            </div>
            <div className="chips">
              {[20, 40, 100, 120, 160, 200].map((v) => (
                <button key={v} className="chip" type="button" onClick={() => setMl(v)}>{v}ml</button>
              ))}
            </div>
          </>
        ) : (
          <>
            <label className="field"><span>授乳時間（分・任意）</span><NumberInput value={dur} onChange={setDur} ariaLabel="授乳時間" /></label>
            <p className="muted">母乳の量は測れないため、回数だけ記録します。1日の母乳量は推定値を使います。</p>
          </>
        )}
      </div>
      <div className="actions">
        {feed?.id && (
          <button className="btn danger" onClick={async () => { await db.milkFeeds.delete(feed.id!); onClose(); }}>削除</button>
        )}
        <button className="btn primary" onClick={save} disabled={kind === 'formula' && !(ml && ml > 0)}>保存</button>
      </div>
    </Modal>
  );
}

function BreastEstimateEditor({ child, date, current, manual, defaultMl, onClose }: { child: Child; date: string; current: number; manual: boolean; defaultMl: number; onClose: () => void }) {
  const [ml, setMl] = useState<number | null>(current);
  return (
    <Modal title="母乳の推定量（この日だけ）" onClose={onClose}>
      <p className="small">母乳量は直接測れないため推定値です。設定の既定値は {defaultMl} ml/日 です。この日だけ変える場合に入力してください。</p>
      <label className="field"><span>この日の母乳（推定 ml/日）</span><NumberInput value={ml} onChange={setMl} ariaLabel="母乳の推定量" /></label>
      <div className="actions">
        {manual && (
          <button className="btn" onClick={async () => { await db.breastEstimates.delete([child.id!, date]); onClose(); }}>既定値に戻す</button>
        )}
        <button className="btn primary" disabled={ml === null} onClick={async () => { await db.breastEstimates.put({ childId: child.id!, date, ml: ml ?? 0, method: 'manual' }); onClose(); }}>保存</button>
      </div>
    </Modal>
  );
}
