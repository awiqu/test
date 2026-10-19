import { create } from 'zustand';
import { Circuit, Gate, GateType, GATE_INFO } from '../model/types';
import {
  ClipboardData,
  addWire,
  copySelection,
  createGate,
  emptyCircuit,
  exampleCircuit,
  nextLabel,
  pasteClip,
  pruneWires,
  removeGates,
  snap,
} from '../model/circuit';
import { ExportSettings, defaultSettings } from '../compiler/compile';
import { loadAutosave, saveAutosave, ProjectFile } from '../storage/project';

export type Tool = 'select' | 'pan' | 'wire' | 'erase';

export interface View {
  zoom: number;
  panX: number;
  panY: number;
}

interface EditorState {
  circuit: Circuit;
  past: Circuit[];
  future: Circuit[];
  selection: Set<string>;
  wireSelection: Set<string>;
  tool: Tool;
  /** Если задано — режим расстановки гейта. */
  placing: GateType | null;
  view: View;
  clipboard: ClipboardData | null;
  pasteCount: number;
  projectName: string;
  settings: ExportSettings;
  /** Показывать ли состояние сигналов. */
  live: boolean;
  showTable: boolean;
  exportOpen: boolean;
  dialog: 'projects' | 'computers' | null;
  toast: string | null;

  setTool: (t: Tool) => void;
  setPlacing: (t: GateType | null) => void;
  setView: (v: Partial<View>) => void;
  /** Заменить схему без записи в историю (во время перетаскивания). */
  setCircuitSilent: (c: Circuit) => void;
  /** Запомнить текущее состояние для отмены. */
  pushHistory: () => void;
  commit: (c: Circuit) => void;
  undo: () => void;
  redo: () => void;

  select: (ids: string[], additive?: boolean) => void;
  selectWires: (ids: string[]) => void;
  clearSelection: () => void;
  selectAll: () => void;

  addGate: (type: GateType, x: number, y: number) => string;
  deleteSelection: () => void;
  copy: () => void;
  cut: () => void;
  paste: (at?: { x: number; y: number }) => void;
  duplicate: () => void;
  connect: (from: string, to: string, pin: number) => void;
  updateGate: (id: string, patch: Partial<Gate>) => void;
  updateGates: (ids: string[], fn: (g: Gate) => Partial<Gate>) => void;
  toggleInput: (id: string) => void;
  nudge: (dx: number, dy: number) => void;
  deleteWires: (ids: string[]) => void;
  setWireMid: (id: string, midX: number | undefined) => void;

  newProject: () => void;
  loadExample: () => void;
  loadProject: (p: ProjectFile) => void;
  setProjectName: (n: string) => void;
  setSettings: (s: Partial<ExportSettings>) => void;
  setLive: (v: boolean) => void;
  setShowTable: (v: boolean) => void;
  setExportOpen: (v: boolean) => void;
  setDialog: (d: 'projects' | 'computers' | null) => void;
  notify: (msg: string) => void;
}

const HISTORY_LIMIT = 200;

const saved = loadAutosave();

export const useEditor = create<EditorState>((set, get) => ({
  circuit: saved?.circuit ?? exampleCircuit(),
  past: [],
  future: [],
  selection: new Set(),
  wireSelection: new Set(),
  tool: 'select',
  placing: null,
  view: { zoom: 1, panX: 20, panY: 20 },
  clipboard: null,
  pasteCount: 0,
  projectName: saved?.name ?? 'Моя схема',
  settings: { ...defaultSettings(), ...(saved?.settings ?? {}) },
  live: true,
  showTable: false,
  exportOpen: false,
  dialog: null,
  toast: null,

  setTool: (tool) => set({ tool, placing: null }),
  setPlacing: (placing) => set({ placing, tool: 'select' }),
  setView: (v) => set((s) => ({ view: { ...s.view, ...v } })),
  setCircuitSilent: (circuit) => set({ circuit }),
  pushHistory: () =>
    set((s) => ({ past: [...s.past.slice(-HISTORY_LIMIT), s.circuit], future: [] })),
  commit: (circuit) =>
    set((s) => ({ past: [...s.past.slice(-HISTORY_LIMIT), s.circuit], future: [], circuit })),
  undo: () =>
    set((s) => {
      if (s.past.length === 0) return s;
      const prev = s.past[s.past.length - 1];
      const ids = new Set(prev.gates.map((g) => g.id));
      return {
        circuit: prev,
        past: s.past.slice(0, -1),
        future: [s.circuit, ...s.future],
        selection: new Set([...s.selection].filter((i) => ids.has(i))),
        wireSelection: new Set(),
      };
    }),
  redo: () =>
    set((s) => {
      if (s.future.length === 0) return s;
      const next = s.future[0];
      return { circuit: next, past: [...s.past, s.circuit], future: s.future.slice(1), wireSelection: new Set() };
    }),

  select: (ids, additive = false) =>
    set((s) => {
      if (!additive) return { selection: new Set(ids), wireSelection: new Set() };
      const next = new Set(s.selection);
      for (const id of ids) {
        if (next.has(id)) next.delete(id);
        else next.add(id);
      }
      return { selection: next };
    }),
  selectWires: (ids) => set({ wireSelection: new Set(ids), selection: new Set() }),
  clearSelection: () => set({ selection: new Set(), wireSelection: new Set() }),
  selectAll: () => set((s) => ({ selection: new Set(s.circuit.gates.map((g) => g.id)), wireSelection: new Set() })),

  addGate: (type, x, y) => {
    const s = get();
    const g = createGate(type, x, y, nextLabel(s.circuit, type));
    s.commit({ ...s.circuit, gates: [...s.circuit.gates, g] });
    set({ selection: new Set([g.id]), wireSelection: new Set() });
    return g.id;
  },
  deleteSelection: () => {
    const s = get();
    if (s.selection.size === 0 && s.wireSelection.size === 0) return;
    let c = removeGates(s.circuit, s.selection);
    if (s.wireSelection.size) c = { ...c, wires: c.wires.filter((w) => !s.wireSelection.has(w.id)) };
    s.commit(c);
    set({ selection: new Set(), wireSelection: new Set() });
  },
  copy: () => {
    const s = get();
    if (s.selection.size === 0) return;
    const clip = copySelection(s.circuit, s.selection);
    set({ clipboard: clip, pasteCount: 0 });
    // системный буфер — необязательное дополнение (вставка между вкладками); при отказе остаётся внутренний
    navigator.clipboard?.writeText(JSON.stringify(clip)).catch(() => undefined);
  },
  cut: () => {
    get().copy();
    get().deleteSelection();
  },
  paste: (at) => {
    const s = get();
    const clip = s.clipboard;
    if (!clip || clip.gates.length === 0) return;
    const minX = Math.min(...clip.gates.map((g) => g.x));
    const minY = Math.min(...clip.gates.map((g) => g.y));
    const n = s.pasteCount + 1;
    const dx = at ? snap(at.x) - minX : 30 * n;
    const dy = at ? snap(at.y) - minY : 30 * n;
    const { circuit, ids } = pasteClip(s.circuit, clip, dx, dy);
    s.commit(circuit);
    set({ selection: new Set(ids), wireSelection: new Set(), pasteCount: n });
  },
  duplicate: () => {
    const s = get();
    if (s.selection.size === 0) return;
    const clip = copySelection(s.circuit, s.selection);
    const { circuit, ids } = pasteClip(s.circuit, clip, 30, 30);
    s.commit(circuit);
    set({ selection: new Set(ids), wireSelection: new Set() });
  },
  connect: (from, to, pin) => {
    const s = get();
    if (from === to) return;
    const c = addWire(s.circuit, from, to, pin);
    if (c !== s.circuit) s.commit(c);
  },
  updateGate: (id, patch) => {
    const s = get();
    const c: Circuit = { ...s.circuit, gates: s.circuit.gates.map((g) => (g.id === id ? { ...g, ...patch } : g)) };
    s.commit(pruneWires(c));
  },
  updateGates: (ids, fn) => {
    const s = get();
    const set_ = new Set(ids);
    const c: Circuit = { ...s.circuit, gates: s.circuit.gates.map((g) => (set_.has(g.id) ? { ...g, ...fn(g) } : g)) };
    s.commit(pruneWires(c));
  },
  toggleInput: (id) => {
    const s = get();
    // переключение входа — не правка схемы, поэтому без истории
    set({ circuit: { ...s.circuit, gates: s.circuit.gates.map((g) => (g.id === id && g.type === 'INPUT' ? { ...g, value: !g.value } : g)) } });
  },
  nudge: (dx, dy) => {
    const s = get();
    if (s.selection.size === 0) return;
    s.commit({ ...s.circuit, gates: s.circuit.gates.map((g) => (s.selection.has(g.id) ? { ...g, x: g.x + dx, y: g.y + dy } : g)) });
  },
  deleteWires: (ids) => {
    const s = get();
    const rm = new Set(ids);
    s.commit({ ...s.circuit, wires: s.circuit.wires.filter((w) => !rm.has(w.id)) });
    set({ wireSelection: new Set() });
  },
  setWireMid: (id, midX) => {
    const s = get();
    s.setCircuitSilent({ ...s.circuit, wires: s.circuit.wires.map((w) => (w.id === id ? { ...w, midX } : w)) });
  },

  newProject: () => set({ circuit: emptyCircuit(), past: [], future: [], selection: new Set(), wireSelection: new Set(), projectName: 'Новая схема', view: { zoom: 1, panX: 20, panY: 20 } }),
  loadExample: () =>
    set({ circuit: exampleCircuit(), past: [], future: [], selection: new Set(), wireSelection: new Set(), projectName: 'Пример: x, y, z → w0, w1', view: { zoom: 1, panX: 20, panY: 20 } }),
  loadProject: (p) =>
    set({
      circuit: p.circuit,
      past: [],
      future: [],
      selection: new Set(),
      wireSelection: new Set(),
      projectName: p.name,
      settings: { ...defaultSettings(), ...(p.settings ?? {}) },
      view: { zoom: 1, panX: 20, panY: 20 },
    }),
  setProjectName: (projectName) => set({ projectName }),
  setSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
  setLive: (live) => set({ live }),
  setShowTable: (showTable) => set({ showTable }),
  setExportOpen: (exportOpen) => set({ exportOpen }),
  setDialog: (dialog) => set({ dialog }),
  notify: (toast) => {
    set({ toast });
    setTimeout(() => {
      if (get().toast === toast) set({ toast: null });
    }, 2600);
  },
}));

// автосохранение
let timer: ReturnType<typeof setTimeout> | undefined;
useEditor.subscribe((s, prev) => {
  if (s.circuit === prev.circuit && s.projectName === prev.projectName && s.settings === prev.settings) return;
  clearTimeout(timer);
  timer = setTimeout(() => saveAutosave({ name: s.projectName, circuit: s.circuit, settings: s.settings }), 400);
});

export { GATE_INFO };
