import { create } from 'zustand';

export type AppMode = 'circuits' | 'computers';

const KEY = 'redlogic:mode:v1';

function load(): AppMode {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'computers' || v === 'circuits') return v;
  } catch {
    /* хранилище недоступно */
  }
  return 'circuits';
}

export const useMode = create<{ mode: AppMode; setMode: (m: AppMode) => void }>((set) => ({
  mode: load(),
  setMode: (mode) => {
    try {
      localStorage.setItem(KEY, mode);
    } catch {
      /* ignore */
    }
    set({ mode });
  },
}));
