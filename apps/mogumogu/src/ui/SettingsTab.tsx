import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { addDays } from '../engine/age';
import { drunkMl } from '../engine/units';

/** 直近7日（記録のある日）のミルク平均 ml/日 */
async function avgFormulaMl(childId: number | undefined): Promise<number> {
  if (!childId) return 0;
  const from = addDays(todayStr(), -6);
  const feeds = await db.milkFeeds.where('childId').equals(childId).filter((f) => f.kind === 'formula' && f.date >= from).toArray();
  const days = new Set(feeds.map((f) => f.date)).size;
  return days ? Math.round(feeds.reduce((s, f) => s + drunkMl(f.ml ?? 0, f.leftoverMl), 0) / days) : 0;
}
import { db, exportAll, importAll, clearAll, saveSettings, type Child, type FeedingType, type Settings } from '../db';
import { DATA_VERSIONS, NUTRIENTS, referenceBreastMilkMl } from '../data/refdata';
import { ageMonthsDays } from '../engine/age';
import { todayStr } from '../lib/format';
import { DateField, MEDICAL_NOTE, NumberInput, Seg } from './common';
import type { Sex } from '../engine/types';

export function ChildForm({ child, onSaved }: { child?: Child; onSaved?: (id: number) => void }) {
  const [name, setName] = useState(child?.name ?? '');
  const [birth, setBirth] = useState(child?.birthDate ?? '');
  const [sex, setSex] = useState<Sex>(child?.sex ?? 'F');
  const [feeding, setFeeding] = useState<FeedingType>(child?.feedingType ?? 'mixed');
  async function save() {
    const rec = { name: name.trim(), birthDate: birth, sex, feedingType: feeding };
    let id = child?.id;
    if (id) await db.children.update(id, rec);
    else id = await db.children.add(rec);
    if (!child || child.feedingType !== feeding) {
      // 栄養方法を母乳の推定量の既定値に反映（PRF-03）
      const m = ageMonthsDays(birth, todayStr()).months;
      const ref = referenceBreastMilkMl(m);
      if (feeding === 'formula') await saveSettings({ defaultBreastMilkMl: 0 });
      else if (feeding === 'breast') await saveSettings({ defaultBreastMilkMl: ref });
      else await saveSettings({ defaultBreastMilkMl: Math.max(0, ref - (await avgFormulaMl(id))) });
    }
    onSaved?.(id!);
  }
  return (
    <div className="stack">
      <label className="field"><span>名前（ニックネーム可）</span><input type="text" value={name} onChange={(e) => setName(e.target.value)} /></label>
      <div className="field"><span>生年月日</span><DateField value={birth} onChange={setBirth} ariaLabel="生年月日" weekday={false} /></div>
      <div><div className="muted small">性別</div><Seg label="性別" value={sex} onChange={setSex} options={[{ v: 'F', l: '女の子' }, { v: 'M', l: '男の子' }]} /></div>
      <div><div className="muted small">栄養方法</div><Seg label="栄養方法" value={feeding} onChange={setFeeding} options={[{ v: 'breast', l: '母乳のみ' }, { v: 'mixed', l: '混合' }, { v: 'formula', l: 'ミルクのみ' }]} /></div>
      <button className="btn primary block" disabled={!name.trim() || !birth} onClick={save}>{child ? '保存' : '登録してはじめる'}</button>
    </div>
  );
}

export function SettingsTab({ child, settings }: { child: Child; settings: Settings }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState('');
  const [addChild, setAddChild] = useState(false);
  const months = ageMonthsDays(child.birthDate, todayStr()).months;
  const refMl = referenceBreastMilkMl(months);
  const avgMl = useLiveQuery(() => avgFormulaMl(child.id), [child.id]) ?? 0;

  async function doExport() {
    const data = await exportAll();
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `mogumogu-backup-${todayStr()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    await saveSettings({ lastBackupAt: Date.now() });
    setMsg('バックアップを書き出しました');
  }
  async function doImport(file: File) {
    try {
      const data = JSON.parse(await file.text());
      if (!confirm('今のデータをすべて置き換えて読み込みます。よろしいですか？')) return;
      await importAll(data);
      setMsg('読み込みました');
    } catch (e) {
      setMsg(`読み込めませんでした：${(e as Error).message}`);
    }
  }

  return (
    <div>
      <div className="section-title">子どもプロフィール</div>
      <div className="card">
        <ChildForm key={child.id} child={child} onSaved={() => setMsg('保存しました')} />
        <div style={{ marginTop: 12 }}>
          {!addChild ? (
            <button className="btn small" onClick={() => setAddChild(true)}>＋ きょうだいを追加</button>
          ) : (
            <div className="card">
              <h3>子どもを追加</h3>
              <ChildForm onSaved={async (id) => { await saveSettings({ activeChildId: id }); setAddChild(false); }} />
            </div>
          )}
        </div>
      </div>

      <div className="section-title">母乳の推定量</div>
      <div className="card stack">
        <label className="field">
          <span>1日の母乳量の既定値（推定 ml/日）</span>
          <NumberInput value={settings.defaultBreastMilkMl} onChange={(v) => saveSettings({ defaultBreastMilkMl: v ?? 0 })} ariaLabel="母乳の既定値" />
        </label>
        <p className="muted small">
          母乳量は直接測れないため推定値です。食事摂取基準（2025年版）が算定に用いた哺乳量は {months}か月で {refMl} ml/日（母乳のみの場合）。混合栄養では、そこからミルクの量を引いた値がひとつの目安です。日ごとの変更は記録タブから。
        </p>
        <div className="row">
          <button className="btn small" onClick={() => saveSettings({ defaultBreastMilkMl: refMl })}>母乳のみの目安（{refMl}ml）</button>
          <button className="btn small" onClick={() => saveSettings({ defaultBreastMilkMl: Math.max(0, refMl - avgMl) })}>{refMl}−ミルク7日平均{avgMl}ml＝{Math.max(0, refMl - avgMl)}ml</button>
        </div>
      </div>

      <div className="section-title">栄養分析</div>
      <div className="card stack">
        <div>
          <div className="muted small">重点監視項目</div>
          <div className="chips">
            {NUTRIENTS.filter((n) => n.id !== 'energy' && n.id !== 'salt').map((n) => {
              const on = settings.focusNutrients.includes(n.id);
              return (
                <button
                  key={n.id}
                  className="chip"
                  aria-pressed={on}
                  onClick={() => saveSettings({ focusNutrients: on ? settings.focusNutrients.filter((x) => x !== n.id) : [...settings.focusNutrients, n.id] })}
                >
                  {n.shortJa}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <div className="muted small">既定の期間</div>
          <Seg label="既定の期間" value={settings.defaultPeriod} onChange={(v) => saveSettings({ defaultPeriod: v })} options={[{ v: 'today', l: '今日' }, { v: '3d', l: '3日' }, { v: '7d', l: '7日' }]} />
        </div>
        <label className="row">
          <input type="checkbox" checked={settings.includeEmptyDays} onChange={(e) => saveSettings({ includeEmptyDays: e.target.checked })} />
          <span>記録のない日も平均に含める</span>
        </label>
        <label className="field">
          <span>「あと少し」とする充足率の下限（%）</span>
          <NumberInput value={settings.thresholdNear} onChange={(v) => saveSettings({ thresholdNear: v ?? 70 })} ariaLabel="あと少しの下限" />
        </label>
      </div>

      <div className="section-title">成長曲線の相談の目安</div>
      <div className="card stack">
        <div className="row">
          <label className="field grow"><span>下側（パーセンタイル）</span>
            <select value={settings.consultLowP} onChange={(e) => saveSettings({ consultLowP: Number(e.target.value) })}>{[3, 10].map((p) => <option key={p}>{p}</option>)}</select>
          </label>
          <label className="field grow"><span>上側（パーセンタイル）</span>
            <select value={settings.consultHighP} onChange={(e) => saveSettings({ consultHighP: Number(e.target.value) })}>{[90, 97].map((p) => <option key={p}>{p}</option>)}</select>
          </label>
          <label className="field grow"><span>またぐ曲線の本数</span>
            <select value={settings.consultCrossLines} onChange={(e) => saveSettings({ consultCrossLines: Number(e.target.value) })}>{[2, 3].map((p) => <option key={p}>{p}</option>)}</select>
          </label>
        </div>
      </div>

      <div className="section-title">バックアップ</div>
      <div className="card stack">
        <p className="small" style={{ margin: 0 }}>データはこの端末の中だけに保存され、外部には送信しません。機種変更や消失に備えてJSONで書き出してください。</p>
        <p className="muted small" style={{ margin: 0 }}>最終バックアップ：{settings.lastBackupAt ? new Date(settings.lastBackupAt).toLocaleString('ja-JP') : 'まだありません'}</p>
        <div className="row">
          <button className="btn primary" onClick={doExport}>JSONで書き出す</button>
          <button className="btn" onClick={() => fileRef.current?.click()}>JSONを読み込む</button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden data-testid="import-file" onChange={(e) => e.target.files?.[0] && doImport(e.target.files[0])} />
        </div>
        <button
          className="btn danger small"
          onClick={async () => {
            if (confirm('すべての記録と設定を削除します。元に戻せません。よろしいですか？')) {
              await clearAll();
              location.reload();
            }
          }}
        >
          全データを削除
        </button>
        {msg && <div className="notice" role="status">{msg}</div>}
      </div>

      <div className="section-title">参照データの出典と版</div>
      <div className="card">
        <ul className="list">
          {DATA_VERSIONS.map((v) => (
            <li key={v.dataset}>
              <strong>{v.dataset}</strong>：{v.version}（{v.publisher}）
              <div className="muted small">{v.note}</div>
              <a className="small" href={v.sourceUrl} target="_blank" rel="noreferrer">{v.sourceUrl}</a>
            </li>
          ))}
        </ul>
        <p className="muted small">食品成分の値は「日本食品標準成分表（八訂）増補2023年」（文部科学省）による。</p>
        <p className="muted small">
          フォント：M PLUS Rounded 1c（© The M+ FONTS Project Authors、SIL Open Font License 1.1）。{' '}
          <a href="./OFL-MPLUSRounded1c.txt" target="_blank" rel="noreferrer">ライセンス全文</a>
        </p>
      </div>
      <p className="disclaimer">{MEDICAL_NOTE}</p>
    </div>
  );
}
