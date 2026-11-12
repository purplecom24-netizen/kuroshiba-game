import { create } from 'zustand';
import { todayStr } from './lib/format';

export type Tab = 'record' | 'foods' | 'analysis' | 'growth' | 'settings';
export type Period = 'today' | '3d' | '7d' | 'custom';

interface UIState {
  tab: Tab;
  date: string;
  period: Period | null; // null = 設定の既定値
  customStart: string;
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
  setTab: (tab) => set({ tab }),
  setDate: (date) => set({ date }),
  setPeriod: (period) => set({ period }),
  setCustomStart: (customStart) => set({ customStart }),
}));
