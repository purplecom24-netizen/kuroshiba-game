import { useEffect, useState } from 'react';
import { useActiveChild, useSettings } from '../hooks';
import { useUI } from '../store';
import { TabBar } from './TabBar';
import { formatAge } from '../engine/age';
import { jpDate, todayStr } from '../lib/format';
import { RecordTab } from './RecordTab';
import { FoodsTab } from './FoodsTab';
import { AnalysisTab } from './AnalysisTab';
import { GrowthTab } from './GrowthTab';
import { SettingsTab, ChildForm } from './SettingsTab';
import { db, getSettings, saveSettings } from '../db';


export function App() {
  const { tab, setTab, date } = useUI();
  const { child, children, loaded } = useActiveChild();
  const settings = useSettings();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    getSettings().then(async (s) => {
      if (!(await db.settings.get('app'))) await saveSettings({ ...s, createdAt: Date.now() });
      setReady(true);
    });
  }, []);

  if (!loaded || !ready) return <div className="main muted">読み込み中…</div>;

  if (!child) {
    return (
      <div className="app">
        <div className="header"><span className="name">もぐもぐ栄養ノート</span></div>
        <main className="main">
          <div className="card">
            <h2>はじめに</h2>
            <p className="small">離乳食・ミルク・母乳を合わせた1日の栄養摂取量を推定し、食事摂取基準（2025年版）と比べて見える化します。データはこの端末の中だけに保存されます。</p>
            <ChildForm
              onSaved={async (id) => {
                await saveSettings({ activeChildId: id });
              }}
            />
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="header">
        <span className="name">{child.name}</span>
        <span className="age">{formatAge(child.birthDate, date)}</span>
        <span className="spacer" />
        <span className="muted">{date === todayStr() ? '今日' : jpDate(date)}</span>
        {children && children.length > 1 ? (
          <select
            aria-label="子どもを切り替え"
            value={child.id}
            style={{ width: 'auto', minHeight: 32, padding: '2px 6px' }}
            onChange={(e) => saveSettings({ activeChildId: Number(e.target.value) })}
          >
            {children.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        ) : null}
      </header>
      <main className="main">
        {tab === 'record' && <RecordTab child={child} settings={settings} />}
        {tab === 'foods' && <FoodsTab />}
        {tab === 'analysis' && <AnalysisTab child={child} settings={settings} />}
        {tab === 'growth' && <GrowthTab child={child} settings={settings} />}
        {tab === 'settings' && <SettingsTab child={child} settings={settings} />}
      </main>
      <TabBar tab={tab} onChange={setTab} />
    </div>
  );
}
