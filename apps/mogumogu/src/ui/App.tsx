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

  // タブを切り替えたら、その画面の先頭から表示する
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [tab]);

  if (!loaded || !ready) return <div className="main muted">読み込み中…</div>;

  if (!child) {
    return (
      <div className="app">
        <header className="header">
          <div className="header-edge" aria-hidden="true" />
          <div className="glass-pill"><span className="name">もぐもぐ栄養ノート</span></div>
        </header>
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
        <div className="header-edge" aria-hidden="true" />
        <div className="glass-pill who">
          <span className="name">{child.name}</span>
          <span className="age">{formatAge(child.birthDate, date)}</span>
          {children && children.length > 1 ? (
            <>
              <svg className="icon caret" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
              <select className="pill-select" aria-label="子どもを切り替え" value={child.id} onChange={(e) => saveSettings({ activeChildId: Number(e.target.value) })}>
                {children.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </>
          ) : null}
        </div>
        <span className="spacer" />
        <div className="glass-pill when">{date === todayStr() ? '今日' : jpDate(date)}</div>
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
