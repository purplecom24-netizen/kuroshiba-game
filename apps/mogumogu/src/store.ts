import { create } from 'zustand';
import { todayStr } from './lib/format';

export type Tab = 'record' | 'foods' | 'analysis' | 'growth' | 'settings';
export type Period = 'today' | '3d' | '7d' | 'custom';

interface UIState {
  tab: Tab;
  date: string;
  period: Period | null; // null = 設定の既定値
  customStart: string;
  customDates: string[]; // 任意期間で選んだ日（単日・複数）
  setCustomDates: (d: string[]) => void;
  setTab: (t: Tab) => void;
  setDate: (d: string) => void;
  setPeriod: (p: Period) => void;
  setCustomStart: (d: string) => void;
}

export const useUI = create<UIState>((set) => ({
  tab: 'record',
  date: todayStr(),
  period: null,
  customStart: todayStr(),
  customDates: [todayStr()],
  setCustomDates: (customDates) => set({ customDates: [...new Set(customDates)].sort() }),
  setTab: (tab) => set({ tab }),
  setDate: (date) => set({ date }),
  setPeriod: (period) => set({ period }),
  setCustomStart: (customStart) => set({ customStart }),
}));
