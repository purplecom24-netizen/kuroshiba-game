import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, LabelList } from 'recharts';
import { db, type Child, type Measurement, type Settings } from '../db';
import { GROWTH } from '../data/refdata';
import { ageMonthsDecimal, formatAge } from '../engine/age';
import { assessGrowth, PERCENTILES } from '../engine/growth';
import { fmt, jpDate, todayStr } from '../lib/format';
import { DateField, MEDICAL_NOTE, NumberInput, Seg } from './common';

type Metric = 'weight' | 'height' | 'head';
const META: Record<Metric, { label: string; unit: string; key: keyof Measurement }> = {
  weight: { label: '体重', unit: 'kg', key: 'weightKg' },
  height: { label: '身長', unit: 'cm', key: 'heightCm' },
  head: { label: '頭囲', unit: 'cm', key: 'headCm' },
};

export function GrowthTab({ child, settings }: { child: Child; settings: Settings }) {
  const list = useLiveQuery(() => db.measurements.where('childId').equals(child.id!).sortBy('date'), [child.id]);
  const [metric, setMetric] = useState<Metric>('weight');
  const [date, setDate] = useState(todayStr());
  const [w, setW] = useState<number | null>(null);
  const [h, setH] = useState<number | null>(null);
  const [hc, setHc] = useState<number | null>(null);
  const meta = META[metric];

  const points = useMemo(
    () =>
      (list ?? [])
        .filter((m) => typeof m[meta.key] === 'number')
        .map((m) => ({ ageMonths: ageMonthsDecimal(child.birthDate, m.date), value: m[meta.key] as number, date: m.date })),
    [list, meta.key, child.birthDate],
  );
  const assessment = assessGrowth(GROWTH, child.sex, metric, points, {
    lowP: settings.consultLowP,
    highP: settings.consultHighP,
    crossLines: settings.consultCrossLines,
  });

  const maxAge = Math.max(12, Math.ceil((points[points.length - 1]?.ageMonths ?? 0) + 2));
  const curve: Record<string, number>[] = GROWTH.filter((r) => r.sex === child.sex && r.metric === metric && r.ageMonths <= maxAge + 6).map((r) => ({
    age: r.ageMonths,
    ...Object.fromEntries(PERCENTILES.map((p, i) => [`p${p}`, r.p[i]])),
  }));
  const yVals = curve.filter((c) => c.age <= maxAge).flatMap((c) => [c.p3 as number, c.p97 as number]).concat(points.map((p) => p.value));
  const yMin = Math.floor(Math.min(...yVals) - (metric === 'weight' ? 0.5 : 2));
  const yMax = Math.ceil(Math.max(...yVals) + (metric === 'weight' ? 0.5 : 2));

  async function add() {
    if (w === null && h === null && hc === null) return;
    await db.measurements.add({ childId: child.id!, date, weightKg: w, heightCm: h, headCm: hc });
    setW(null);
    setH(null);
    setHc(null);
  }

  return (
    <div>
      <div className="card">
        <h2>計測を記録</h2>
        <div className="row">
          <div className="field grow"><span>計測日</span><DateField value={date} onChange={setDate} ariaLabel="計測日" /></div>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <label className="field grow"><span>体重（kg）</span><NumberInput value={w} onChange={setW} step="0.01" ariaLabel="体重" /></label>
          <label className="field grow"><span>身長（cm）</span><NumberInput value={h} onChange={setH} step="0.1" ariaLabel="身長" /></label>
          <label className="field grow"><span>頭囲（cm）</span><NumberInput value={hc} onChange={setHc} step="0.1" ariaLabel="頭囲" /></label>
        </div>
        <button className="btn primary block" style={{ marginTop: 8 }} onClick={add} disabled={w === null && h === null && hc === null}>記録する</button>
      </div>

      <Seg label="指標" value={metric} onChange={setMetric} options={[{ v: 'weight', l: '体重' }, { v: 'height', l: '身長' }, { v: 'head', l: '頭囲' }]} />

      {assessment.band && (
        <div className="card" style={{ marginTop: 12 }} data-testid="growth-band">
          <div className="row between">
            <strong>最新の{meta.label}：{fmt(points[points.length - 1].value, 2)} {meta.unit}</strong>
            <span className="muted">{formatAge(child.birthDate, points[points.length - 1].date)}</span>
          </div>
          <div>{assessment.band.label}の帯にあります</div>
        </div>
      )}
      {assessment.consult && (
        <div className="notice consult" role="status" data-testid="consult">
          <strong>▲ 健診や小児科で相談する目安です</strong>
          <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
            {assessment.reasons.map((r) => <li key={r}>{r}</li>)}
          </ul>
        </div>
      )}

      <div className="card" style={{ marginTop: 12 }}>
        <h2>{meta.label}の発育曲線（{child.sex === 'F' ? '女子' : '男子'}）</h2>
        <div style={{ width: '100%', height: 320 }} role="img" aria-label={`${meta.label}の発育曲線と記録点（数値は下の一覧）`}>
          <ResponsiveContainer>
            <ComposedChart margin={{ left: -8, right: 28, top: 8, bottom: 8 }}>
              <CartesianGrid stroke="var(--grid)" />
              <XAxis type="number" dataKey="age" domain={[0, maxAge]} allowDataOverflow ticks={Array.from({ length: Math.floor(maxAge / 3) + 1 }, (_, i) => i * 3)} tickFormatter={(v) => `${v}か月`} tick={{ fill: 'var(--text-3)', fontSize: 10 }} stroke="var(--grid)" />
              <YAxis type="number" domain={[yMin, yMax]} allowDataOverflow tick={{ fill: 'var(--text-3)', fontSize: 10 }} stroke="var(--grid)" />
              {PERCENTILES.map((p) => (
                <Line
                  key={p}
                  data={curve}
                  dataKey={`p${p}`}
                  type="monotone"
                  dot={false}
                  activeDot={false}
                  stroke={p === 50 ? 'var(--curve-50)' : 'var(--curve)'}
                  strokeWidth={p === 50 ? 2 : 1.2}
                  strokeDasharray={p === 3 || p === 97 ? undefined : p === 50 ? undefined : '3 3'}
                  isAnimationActive={false}
                  name={`${p}パーセンタイル`}
                >
                  <LabelList
                    content={(props: { x?: number | string; y?: number | string; index?: number }) =>
                      props.index === curve.filter((c) => c.age <= maxAge).length - 1 ? (
                        <text x={Number(props.x ?? 0) + 3} y={Number(props.y ?? 0)} fontSize={9} fill="var(--text-3)" dominantBaseline="central">{p}</text>
                      ) : null
                    }
                  />
                </Line>
              ))}
              <Line data={points.map((p) => ({ age: p.ageMonths, v: p.value }))} dataKey="v" stroke="var(--series-breast)" strokeWidth={2} dot={{ r: 5, fill: 'var(--series-breast)', stroke: 'var(--surface)', strokeWidth: 2 }} isAnimationActive={false} name="記録" />
              <Tooltip
                content={({ active, payload }) => {
                  const rec = payload?.find((x) => x.dataKey === 'v');
                  if (!active || !rec) return null;
                  const pt = rec.payload as { age: number; v: number };
                  return <div className="chart-tip"><div className="t">{fmt(pt.age, 1)}か月</div>{meta.label} {fmt(pt.v, 2)} {meta.unit}</div>;
                }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="muted small">灰色の線：3・10・25・50・75・90・97パーセンタイル（こども家庭庁 令和5年乳幼児身体発育調査）。各月齢区間の値は区間の中央にプロットしています。青：記録。</p>
      </div>

      <div className="card">
        <h3>記録一覧</h3>
        <ul className="list">
          {(list ?? []).slice().reverse().map((m) => (
            <li key={m.id} className="row between">
              <span>{jpDate(m.date)} <span className="muted small">{formatAge(child.birthDate, m.date)}</span></span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                {m.weightKg != null ? `${fmt(m.weightKg, 2)}kg ` : ''}
                {m.heightCm != null ? `${fmt(m.heightCm, 1)}cm ` : ''}
                {m.headCm != null ? `頭${fmt(m.headCm, 1)}cm` : ''}
                <button className="btn small danger" style={{ marginLeft: 6 }} onClick={() => confirm('削除しますか？') && db.measurements.delete(m.id!)} aria-label="削除">✕</button>
              </span>
            </li>
          ))}
          {list?.length === 0 && <li className="muted">まだ記録がありません</li>}
        </ul>
      </div>
      <p className="disclaimer">{MEDICAL_NOTE}</p>
    </div>
  );
}
