import { Circuit, Gate } from '../model/types';

export interface LogicState {
  /** Значение выхода каждого гейта. */
  out: Map<string, boolean>;
  /** false, если схема не стабилизировалась (колебания). */
  stable: boolean;
}

export function gateFunction(g: Gate, ins: boolean[]): boolean {
  switch (g.type) {
    case 'INPUT':
      return g.value;
    case 'OUTPUT':
    case 'BUFFER':
      return ins[0] ?? false;
    case 'NOT':
      return !(ins[0] ?? false);
    case 'AND':
      return ins.length > 0 && ins.every(Boolean);
    case 'NAND':
      return !(ins.length > 0 && ins.every(Boolean));
    case 'OR':
      return ins.some(Boolean);
    case 'NOR':
      return !ins.some(Boolean);
    case 'XOR':
      return ins.filter(Boolean).length % 2 === 1;
    case 'XNOR':
      return ins.filter(Boolean).length % 2 === 0;
  }
}

/**
 * Вычисляет значения всех гейтов. Для схем с обратными связями
 * делает итерации до стабилизации (или до лимита).
 */
export function evaluate(c: Circuit, inputValues?: Map<string, boolean>): LogicState {
  const incoming = new Map<string, (string | null)[]>();
  for (const g of c.gates) incoming.set(g.id, new Array(g.type === 'INPUT' ? 0 : g.inputs).fill(null));
  for (const w of c.wires) {
    const arr = incoming.get(w.to);
    if (arr && w.toPin >= 0 && w.toPin < arr.length) arr[w.toPin] = w.from;
  }
  const out = new Map<string, boolean>();
  for (const g of c.gates) out.set(g.id, false);
  const limit = c.gates.length + 4;
  let stable = false;
  for (let iter = 0; iter < limit; iter++) {
    let changed = false;
    for (const g of c.gates) {
      const gg = inputValues?.has(g.id) ? { ...g, value: inputValues.get(g.id)! } : g;
      const ins = incoming.get(g.id)!.map((src) => (src ? out.get(src) ?? false : false));
      const v = gateFunction(gg, ins);
      if (out.get(g.id) !== v) {
        out.set(g.id, v);
        changed = true;
      }
    }
    if (!changed) {
      stable = true;
      break;
    }
  }
  return { out, stable };
}

/** Есть ли в схеме обратные связи (циклы). */
export function hasCycle(c: Circuit): boolean {
  const adj = new Map<string, string[]>();
  for (const g of c.gates) adj.set(g.id, []);
  for (const w of c.wires) adj.get(w.from)?.push(w.to);
  const state = new Map<string, number>();
  const visit = (id: string): boolean => {
    state.set(id, 1);
    for (const n of adj.get(id) ?? []) {
      const s = state.get(n) ?? 0;
      if (s === 1) return true;
      if (s === 0 && visit(n)) return true;
    }
    state.set(id, 2);
    return false;
  };
  for (const g of c.gates) if ((state.get(g.id) ?? 0) === 0 && visit(g.id)) return true;
  return false;
}

/** Таблица истинности (до 8 входов). */
export function truthTable(c: Circuit): {
  inputs: Gate[];
  outputs: Gate[];
  rows: { ins: boolean[]; outs: boolean[] }[];
} | null {
  const inputs = c.gates.filter((g) => g.type === 'INPUT').sort((a, b) => a.y - b.y || a.x - b.x);
  const outputs = c.gates.filter((g) => g.type === 'OUTPUT').sort((a, b) => a.y - b.y || a.x - b.x);
  if (inputs.length === 0 || inputs.length > 8) return null;
  const rows: { ins: boolean[]; outs: boolean[] }[] = [];
  const n = inputs.length;
  for (let m = 0; m < 1 << n; m++) {
    const vals = new Map<string, boolean>();
    const ins: boolean[] = [];
    for (let i = 0; i < n; i++) {
      const v = ((m >> (n - 1 - i)) & 1) === 1;
      ins.push(v);
      vals.set(inputs[i].id, v);
    }
    const st = evaluate(c, vals);
    rows.push({ ins, outs: outputs.map((o) => st.out.get(o.id) ?? false) });
  }
  return { inputs, outputs, rows };
}
