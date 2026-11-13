import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Bar, BarChart, CartesianGrid, LabelList, PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Child, Settings } from '../db';
import { todayStr } from '../lib/format';
import { useFoodMap } from '../hooks';
import { useUI, type Period } from '../store';
import { INTAKE_REF, NUTRIENTS, NUTRIENT_BY_ID } from '../data/refdata';
import { selectReference, KIND_LABEL } from '../engine/reference';
import { judge, type Judgement } from '../engine/judge';
import { ageMonthsDays, addDays } from '../engine/age';
import { SOURCE_LABEL } from '../engine/intake';
import type { DayIntake, NutrientIntake } from '../engine/types';
import { loadDates } from '../lib/day';
import { db } from '../db';
import { fmt, jpDate } from '../lib/format';
import { Chevron, MEDICAL_NOTE, Seg, StatusBadge } from './common';

type Group = 'focus' | 'macro' | 'mineral' | 'vitamin';
const GROUP_LABEL: Record<Group, string> = { focus: '重点', macro: '主要栄養素', mineral: 'ミネラル', vitamin: 'ビタミン' };

interface Row {
  id: string;
  name: string;
  unit: string;
  it: NutrientIntake;
  j: Judgement;
  ref: ReturnType<typeof selectReference>;
}

export function AnalysisTab({ child, settings }: { child: Child; settings: Settings }) {
  const { date, period: p, setPeriod, customDates, setCustomDates, setTab } = useUI();
  const period: Period = p ?? settings.defaultPeriod;
  const foods = useFoodMap();
  const [group, setGroup] = useState<Group>('focus');
  const nDays = period === 'today' ? 1 : period === '3d' ? 3 : period === '7d' ? 7 : customDates.length;
  const dates = useMemo(
    () => (period === 'custom' ? customDates : Array.from({ length: nDays }, (_, i) => addDays(date, i - nDays + 1))),
    [period, customDates, nDays, date],
  );
  const lastDate = dates[dates.length - 1] ?? date;

  const data = useLiveQuery(
    () => (foods && dates.length ? loadDates(child, dates, foods.map, settings) : Promise.resolve(null)),
    [child, dates, foods, settings.defaultBreastMilkMl, settings.includeEmptyDays],
  );
  const months = ageMonthsDays(child.birthDate, lastDate).months;

  const rows: Row[] = useMemo(() => {
    if (!data) return [];
    const intake: DayIntake = data.intake;
    return NUTRIENTS.map((n) => {
      const ref = selectReference(INTAKE_REF, n.id, months, child.sex);
      const it = intake[n.id] ?? { total: 0, bySource: { breast: 0, formula: 0, food: 0 }, missing: false, missingSources: [], missingFoodGrams: 0, totalFoodGrams: 0, hasEstimate: false, hasTrace: false };
      return { id: n.id, name: n.shortJa, unit: n.unit, it, ref, j: judge(n.id, intake, ref, n.unit, { near: settings.thresholdNear }) };
    });
  }, [data, months, child.sex, settings.thresholdNear]);
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));

  const groupRows = rows.filter((r) => r.id !== 'energy' && r.id !== 'salt' && r.ref.target && (group === 'focus' ? settings.focusNutrients.includes(r.id) : NUTRIENT_BY_ID[r.id].group === group));
  const noRef = rows.every((r) => !r.ref.target);

  return (
    <div>
      <div className="stack" style={{ marginBottom: 12 }}>
        <Seg
          label="期間"
          value={period}
          onChange={setPeriod}
          options={[{ v: 'today', l: '今日' }, { v: '3d', l: '3日平均' }, { v: '7d', l: '7日平均' }, { v: 'custom', l: '任意' }]}
        />
        {period === 'custom' && <MultiDateCalendar child={child} selected={customDates} onChange={setCustomDates} />}
        <p className="muted" style={{ margin: 0 }}>
          {period === 'today' ? jpDate(date) : period === 'custom' ? describeDates(customDates) : `${jpDate(addDays(date, -nDays + 1))}〜${jpDate(date)}`}
          {data ? `・記録のある${data.dayCount}日${period === 'today' ? '' : 'の平均'}` : ''}
          {data && !settings.includeEmptyDays && data.dayCount < nDays && period !== 'today' ? `（記録のない${nDays - data.dayCount}日は除外）` : ''}
        </p>
      </div>
      <p className="disclaimer">{MEDICAL_NOTE}</p>

      {!data && dates.length > 0 && <p className="muted">計算中…</p>}
      {data && data.dayCount === 0 && <div className="notice">この期間の記録がありません。記録タブで食事・ミルク・授乳を記録してください。</div>}
      {noRef && <div className="notice warn">この月齢（{months}か月）の食事摂取基準はまだ取り込んでいません（1歳以降の基準値は未対応）。</div>}

      {data && data.dayCount > 0 && !noRef && (
        <>
          <FocusPanel rows={settings.focusNutrients.map((id) => byId[id]).filter(Boolean)} />
          <EnergyCard row={byId.energy} onGrowth={() => setTab('growth')} data={data.days} />

          <div className="card">
            <div className="row between" style={{ marginBottom: 8 }}>
              <h2 style={{ margin: 0 }}>充足率</h2>
            </div>
            <Seg label="栄養素のグループ" value={group} onChange={setGroup} options={(Object.keys(GROUP_LABEL) as Group[]).map((g) => ({ v: g, l: GROUP_LABEL[g] }))} />
            <RadarView rows={groupRows} />
          </div>

          <div className="card">
            <h2>供給源別（基準値に対する%）</h2>
            <div className="legend" aria-label="凡例">
              <span><span className="sw breast" />{SOURCE_LABEL.breast}</span>
              <span><span className="sw formula" />{SOURCE_LABEL.formula}</span>
              <span><span className="sw food" />{SOURCE_LABEL.food}</span>
              <span><span className="sw gap" />ギャップ</span>
            </div>
            <StackedView rows={groupRows} />
            <p className="muted small">母乳は推定量（{fmt(data.days.filter((d) => d.hasRecord).reduce((s, d) => s + d.breastMilkMl, 0) / Math.max(1, data.dayCount), 0)} ml/日）× 母乳中濃度で計算しています。</p>
          </div>

          <div className="card">
            <h2>栄養素一覧</h2>
            <NutrientTable rows={rows} />
          </div>
          <p className="disclaimer">
            基準値：日本人の食事摂取基準（2025年版）。目安量は「満たしていれば不足のリスクはほとんどない量」で、下回っても不足とは限りません。{MEDICAL_NOTE}
          </p>
        </>
      )}
    </div>
  );
}

function FocusPanel({ rows }: { rows: Row[] }) {
  return (
    <div className="card">
      <h2>重点項目</h2>
      <div className="focus-grid">
        {rows.map((r) => {
          const pct = r.j.ratio ?? 0;
          return (
            <div className="focus" key={r.id} data-testid={`focus-${r.id}`}>
              <div className="label">{r.name}{isEnergyRatio(r.j) ? '（エネルギー比）' : ''}</div>
              <div className="big">
                {r.j.lowerBound ? '≥' : ''}
                {fmt(r.j.intake)}
                <span className="unit"> {unitText(r.j.intakeUnit)}</span>
              </div>
              <div className="gauge" role="img" aria-label={`${r.j.ratioLabel ?? ''} ${fmt(pct, 0)}%`}>
                <div className={`fill ${r.j.status}`} style={{ width: `${Math.min(pct, 150) / 1.5}%` }} />
                <div className="mark100" style={{ left: `${100 / 1.5}%` }} />
              </div>
              <div className="small">
                {r.j.ratioLabel} {fmt(pct, 0)}%{' '}
                {r.j.gap && r.j.gap > 0 && !r.j.overUL ? (
                  <strong>あと{fmt(r.j.gap)}{unitText(r.j.intakeUnit)}</strong>
                ) : null}
              </div>
              <div style={{ marginTop: 4 }}><StatusBadge status={r.j.status} lowerBound={r.j.lowerBound} /></div>
              {r.it.missingFoodGrams > 0 && <div className="muted small">欠測 {fmt(r.it.missingFoodGrams, 0)}g/{fmt(r.it.totalFoodGrams, 0)}g</div>}
            </div>
          );
        })}
      </div>
      {rows.some((r) => r.id === 'iron') && (
        <p className="muted small" style={{ marginBottom: 0 }}>
          鉄は供給源によって吸収率が違います（母乳の鉄は吸収率が高く、粉ミルクや食品の鉄は低い）。この値は含有量ベースで、吸収率の補正はしていません。
        </p>
      )}
    </div>
  );
}

function EnergyCard({ row, onGrowth, data }: { row: Row; onGrowth: () => void; data: { hasRecord: boolean }[] }) {
  if (!row) return null;
  return (
    <div className="card">
      <div className="row between">
        <h2 style={{ margin: 0 }}>エネルギー（参考）</h2>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>
          {row.j.lowerBound ? '≥' : ''}{fmt(row.it.total, 0)} / {fmt(row.j.targetValue, 0)} kcal
        </span>
      </div>
      <p className="small" style={{ margin: '6px 0' }}>
        エネルギーの過不足は成長曲線で判断します。推定エネルギー必要量は集団の平均的な値で、個人差が大きいためです。
      </p>
      <button className="btn small" onClick={onGrowth}>成長曲線を見る →</button>
      {data.length === 0 ? null : null}
    </div>
  );
}

function RadarView({ rows }: { rows: Row[] }) {
  if (rows.length < 3) return <p className="muted">レーダーチャートには3項目以上が必要です。下の一覧をご覧ください。</p>;
  const d = rows.map((r) => ({ name: r.name, value: Math.min(r.j.ratio ?? 0, 150), raw: r.j.ratio ?? 0, ref: 100, label: r.j.ratioLabel, lb: r.j.lowerBound }));
  return (
    <>
    <div style={{ width: '100%', height: 300 }} role="img" aria-label="充足率のレーダーチャート（数値は下の一覧）">
      <ResponsiveContainer>
        <RadarChart data={d} outerRadius="72%">
          <PolarGrid stroke="var(--grid)" />
          <PolarAngleAxis dataKey="name" tick={{ fill: 'var(--text-2)', fontSize: 11 }} />
          <PolarRadiusAxis domain={[0, 150]} ticks={[0, 50, 100, 150] as never} tick={{ fill: 'var(--text-3)', fontSize: 9 }} angle={90} axisLine={false} />
          <Radar name="基準（100%）" dataKey="ref" stroke="var(--text)" strokeWidth={2} strokeDasharray="4 3" fill="none" isAnimationActive={false} />
          <Radar name="充足率" dataKey="value" stroke="var(--series-breast)" strokeWidth={2} fill="var(--series-breast)" fillOpacity={0.18} dot={{ r: 4 }} isAnimationActive={false} />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const x = payload[0].payload as (typeof d)[number];
              return (
                <div className="chart-tip">
                  <div className="t">{x.name}</div>
                  {x.label} {x.lb ? '≥' : ''}{fmt(x.raw, 0)}%{x.raw > 150 ? '（150%で表示を打ち切り）' : ''}
                </div>
              );
            }}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
    <p className="muted small" style={{ margin: '4px 0 0' }}>実線＝充足率、点線＝基準（100%）。表示は150%まで（超えた分は一覧の数値で確認）。</p>
    </>
  );
}

function StackedView({ rows }: { rows: Row[] }) {
  const d = rows.map((r) => {
    const total = r.it.total;
    const ratio = r.j.ratio ?? 0;
    const k = total > 0 ? ratio / total : 0; // 実量 → % の係数（脂質は%E換算を含む）
    const breast = r.it.bySource.breast * k;
    const formula = r.it.bySource.formula * k;
    const food = r.it.bySource.food * k;
    return {
      name: r.name,
      breast,
      formula,
      food,
      gap: Math.max(0, 100 - (breast + formula + food)),
      amt: { breast: r.it.bySource.breast, formula: r.it.bySource.formula, food: r.it.bySource.food, gap: r.j.gap ?? 0 },
      unit: r.unit,
      gapUnit: isEnergyRatio(r.j) ? '%（エネルギー比）' : unitText(r.j.intakeUnit),
      gapSuffix: isEnergyRatio(r.j) ? '%' : '',
      lb: r.j.lowerBound,
      ratio,
    };
  });
  const max = Math.max(150, ...d.map((x) => x.breast + x.formula + x.food));
  const label = (key: 'breast' | 'formula' | 'food' | 'gap') =>
    function L(props: { x?: number | string; y?: number | string; width?: number | string; height?: number | string; index?: number }) {
      const x = Number(props.x ?? 0), y = Number(props.y ?? 0), width = Number(props.width ?? 0), height = Number(props.height ?? 0), index = props.index ?? 0;
      const row = d[index];
      if (!row || width < 34) return null;
      const v = row.amt[key];
      const txt = key === 'gap' ? `あと${fmt(v)}${row.gapSuffix}` : fmt(v);
      return (
        <text x={x + width / 2} y={y + height / 2} textAnchor="middle" dominantBaseline="central" fontSize={10} fill={key === 'gap' ? 'var(--text)' : '#fff'} style={{ fontVariantNumeric: 'tabular-nums' }}>
          {txt}
        </text>
      );
    };
  return (
    <div style={{ width: '100%', height: Math.max(160, d.length * 44 + 40) }}>
      <ResponsiveContainer>
        <BarChart data={d} layout="vertical" margin={{ left: 0, right: 12, top: 4, bottom: 4 }} barCategoryGap={8}>
          <defs>
            <pattern id="gapHatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="var(--surface)" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="var(--gap)" strokeWidth="2" />
            </pattern>
          </defs>
          <CartesianGrid horizontal={false} stroke="var(--grid)" />
          <XAxis type="number" domain={[0, max]} ticks={[0, 50, 100, 150].filter((t) => t <= max)} tickFormatter={(v) => `${v}%`} tick={{ fill: 'var(--text-3)', fontSize: 10 }} stroke="var(--grid)" />
          <YAxis type="category" dataKey="name" width={72} tick={{ fill: 'var(--text-2)', fontSize: 11 }} stroke="var(--grid)" />
          <ReferenceLine x={100} stroke="var(--text)" strokeWidth={1.5} strokeDasharray="4 3" />
          <Tooltip
            cursor={{ fill: 'var(--surface-2)' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const x = payload[0].payload as (typeof d)[number];
              return (
                <div className="chart-tip">
                  <div className="t">{x.name}（{x.lb ? '≥' : ''}{fmt(x.ratio, 0)}%）</div>
                  <div>{SOURCE_LABEL.breast}：{fmt(x.amt.breast)} {x.unit}</div>
                  <div>{SOURCE_LABEL.formula}：{fmt(x.amt.formula)} {x.unit}</div>
                  <div>{SOURCE_LABEL.food}：{fmt(x.amt.food)} {x.unit}</div>
                  <div>ギャップ：{fmt(x.amt.gap)} {x.gapUnit}</div>
                </div>
              );
            }}
          />
          <Bar dataKey="breast" stackId="s" fill="var(--series-breast)" stroke="var(--surface)" strokeWidth={1} isAnimationActive={false}>
            <LabelList content={label('breast')} />
          </Bar>
          <Bar dataKey="formula" stackId="s" fill="var(--series-formula)" stroke="var(--surface)" strokeWidth={1} isAnimationActive={false}>
            <LabelList content={label('formula')} />
          </Bar>
          <Bar dataKey="food" stackId="s" fill="var(--series-food)" stroke="var(--surface)" strokeWidth={1} isAnimationActive={false}>
            <LabelList content={label('food')} />
          </Bar>
          <Bar dataKey="gap" stackId="s" fill="url(#gapHatch)" stroke="var(--gap)" strokeWidth={1} radius={[0, 4, 4, 0]} isAnimationActive={false}>
            <LabelList content={label('gap')} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function NutrientTable({ rows }: { rows: Row[] }) {
  return (
    <div className="table-wrap">
      <table className="nut" data-testid="nutrient-table">
        <thead>
          <tr>
            <th>栄養素・判定</th>
            <th>摂取量 / 基準値</th>
            <th>充足率</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const t = r.ref.target;
            const energyRatio = isEnergyRatio(r.j);
            const missingNote = [
              r.it.missingFoodGrams > 0 ? `欠測 ${fmt(r.it.missingFoodGrams, 0)}g/${fmt(r.it.totalFoodGrams, 0)}g` : '',
              r.it.missingSources.includes('formula') ? 'ミルク表示なし' : '',
              r.it.missingSources.includes('breast') ? '母乳濃度なし' : '',
            ].filter(Boolean);
            return (
              <tr key={r.id} data-testid={`row-${r.id}`}>
                <td className="nut-name">
                  <div className="nm">{r.name}</div>
                  <StatusBadge status={r.j.status} />
                  {missingNote.length > 0 && <div className="muted small">欠測あり（下限値）<br />{missingNote.join('・')}</div>}
                  {r.it.hasEstimate && <div className="muted small">推定値を含む</div>}
                </td>
                <td className="nut-val">
                  <div className="v">
                    {r.j.lowerBound ? '≥' : ''}
                    {energyRatio ? fmt(r.j.intake, 0) : fmt(r.it.total)}
                    {t ? ` / ${fmt(t.value)}` : ''}
                    <span className="muted"> {unitText(r.j.intakeUnit)}</span>
                  </div>
                  {energyRatio && <div className="muted small">エネルギー比</div>}
                  {energyRatio && <div className="muted small">{KIND_LABEL[t!.kind]}・脂質 {fmt(r.it.total)} g</div>}
                  {t && !energyRatio && <div className="muted small kind">{kindLabel(t.kind)}{r.ref.ul ? `・上限${fmt(r.ref.ul.value)}` : ''}</div>}
                </td>
                <td className="nut-ratio">
                  <div className="v">{r.j.ratio !== null ? `${fmt(r.j.ratio, 0)}%` : '—'}</div>
                  {r.j.ratioLabel && <div className="muted small">{r.j.ratioLabel}</div>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted small">
        「≥」は欠測を含むため下限値であることを示します。脂質は、とったエネルギーのうち脂質が占める割合（エネルギー比）で基準と比べます。ビタミンAは乳児の基準に合わせレチノール（プロビタミンAを含まない）で比較しています。
      </p>
    </div>
  );
}

/** 脂質など、基準が「エネルギーに占める割合」の栄養素か */
function isEnergyRatio(j: Judgement): boolean {
  return j.intakeUnit === '%E';
}
/** 画面に出す単位（エネルギー比は % と書く） */
function unitText(u: string): string {
  return u === '%E' ? '%' : u;
}
/** 指標名。長い「推定エネルギー必要量」は区切りのよい位置で折り返す */
function kindLabel(kind: keyof typeof KIND_LABEL) {
  return kind === 'EER' ? <>推定エネルギー<wbr />必要量</> : KIND_LABEL[kind];
}

const WD = '日月火水木金土';

function describeDates(ds: string[]): string {
  if (ds.length === 0) return '日付を選んでください';
  if (ds.length === 1) return jpDate(ds[0]);
  const shown = ds.slice(0, 3).map((d) => jpDate(d).replace(/（.）/, '')).join('・');
  return `${shown}${ds.length > 3 ? ` ほか${ds.length - 3}日` : ''}（${ds.length}日を選択）`;
}

/** 任意期間：日付をタップで選ぶ／外す（単日・複数日）。記録のある日に点を表示 */
function MultiDateCalendar({ child, selected, onChange }: { child: Child; selected: string[]; onChange: (d: string[]) => void }) {
  const today = todayStr();
  const [ym, setYm] = useState(() => (selected[selected.length - 1] ?? today).slice(0, 7));
  const [y, m] = ym.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = first.getUTCDay();
  const pad = (n: number) => String(n).padStart(2, '0');
  const recorded = useLiveQuery(async () => {
    const from = `${ym}-01`;
    const to = `${ym}-${pad(daysIn)}`;
    const cid = child.id!;
    const [meals, feeds] = await Promise.all([
      db.meals.where('date').between(from, to, true, true).filter((x) => x.childId === cid).toArray(),
      db.milkFeeds.where('date').between(from, to, true, true).filter((x) => x.childId === cid).toArray(),
    ]);
    return new Set([...meals.map((x) => x.date), ...feeds.map((x) => x.date)]);
  }, [ym, child.id]);
  const shift = (n: number) => {
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    setYm(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`);
  };
  const toggle = (d: string) => onChange(selected.includes(d) ? selected.filter((x) => x !== d) : [...selected, d]);
  const selectWeek = () => onChange(Array.from({ length: 7 }, (_, i) => addDays(today, i - 6)));
  return (
    <div className="card cal" data-testid="multi-cal">
      <div className="cal-head">
        <button className="btn small" onClick={() => shift(-1)} aria-label="前の月"><Chevron dir="left" /></button>
        <span>{y}年{m}月</span>
        <button className="btn small" onClick={() => shift(1)} aria-label="次の月" disabled={ym >= today.slice(0, 7)}><Chevron dir="right" /></button>
      </div>
      <div className="cal-grid">
        {[...WD].map((w) => <div key={w} className="cal-wd">{w}</div>)}
        {Array.from({ length: lead }, (_, i) => <div key={`e${i}`} />)}
        {Array.from({ length: daysIn }, (_, i) => {
          const d = `${ym}-${pad(i + 1)}`;
          const future = d > today;
          return (
            <button
              key={d}
              type="button"
              className={`cal-day${d === today ? ' today' : ''}`}
              aria-pressed={selected.includes(d)}
              aria-label={`${m}月${i + 1}日${recorded?.has(d) ? '（記録あり）' : ''}`}
              disabled={future}
              onClick={() => toggle(d)}
            >
              {i + 1}
              {recorded?.has(d) && <span className="dot" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <span className="muted small grow">日付をタップで選ぶ／外す（{selected.length}日選択中）。点は記録のある日。</span>
        <button className="btn small" onClick={selectWeek}>直近7日</button>
        <button className="btn small" onClick={() => onChange([])} disabled={selected.length === 0}>クリア</button>
      </div>
    </div>
  );
}
