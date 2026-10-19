import { Circuit, GATE_INFO, GRID, Gate, GateType, Point, Wire } from './types';

let counter = 0;
export function uid(prefix: string): string {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

export function snap(v: number): number {
  return Math.round(v / GRID) * GRID;
}

export function createGate(type: GateType, x: number, y: number, label = ''): Gate {
  const info = GATE_INFO[type];
  return {
    id: uid('g'),
    type,
    x: snap(x),
    y: snap(y),
    inputs: info.defaultInputs,
    label,
    value: false,
    delay: 1,
  };
}

export function gateSize(g: Gate): { w: number; h: number } {
  switch (g.type) {
    case 'INPUT':
    case 'OUTPUT':
    case 'NOT':
    case 'BUFFER':
      return { w: 60, h: 30 };
    default:
      return { w: 75, h: Math.max(60, g.inputs * 30) };
  }
}

export function inputPinPos(g: Gate, idx: number): Point {
  const { h } = gateSize(g);
  if (g.type === 'NOT' || g.type === 'BUFFER' || g.type === 'OUTPUT') return { x: g.x, y: g.y + h / 2 };
  const n = g.inputs;
  const spacing = 30;
  const top = (h - (n - 1) * spacing) / 2;
  return { x: g.x, y: g.y + top + idx * spacing };
}

export function outputPinPos(g: Gate): Point {
  const { w, h } = gateSize(g);
  return { x: g.x + w, y: g.y + h / 2 };
}

export function inputCount(g: Gate): number {
  return g.type === 'INPUT' ? 0 : g.inputs;
}

export function hasOutput(g: Gate): boolean {
  return g.type !== 'OUTPUT';
}

export function gateById(c: Circuit): Map<string, Gate> {
  return new Map(c.gates.map((g) => [g.id, g]));
}

/** Провод, приходящий на конкретный пин. */
export function wireToPin(c: Circuit, gateId: string, pin: number): Wire | undefined {
  return c.wires.find((w) => w.to === gateId && w.toPin === pin);
}

/**
 * Ортогональная ломаная провода от выхода к входу.
 * Стандартный вид «Z»: вправо, вертикаль, вправо; для обратных связей — обход.
 */
export function wirePath(a: Point, b: Point, midX?: number): Point[] {
  const stub = GRID;
  if (b.x - a.x >= stub * 2 || midX !== undefined) {
    let mx = midX ?? a.x + Math.max(stub, snap((b.x - a.x) / 2));
    if (midX === undefined) mx = Math.min(mx, b.x - stub);
    if (a.y === b.y && midX === undefined) return [a, b];
    return dedupe([a, { x: mx, y: a.y }, { x: mx, y: b.y }, b]);
  }
  // обратная связь / близкие гейты: выходим вправо, обходим сверху или снизу
  const ax = a.x + stub;
  const bx = b.x - stub;
  const midY = (a.y + b.y) / 2 + (a.y <= b.y ? GRID * 2 : -GRID * 2);
  return dedupe([a, { x: ax, y: a.y }, { x: ax, y: midY }, { x: bx, y: midY }, { x: bx, y: b.y }, b]);
}

function dedupe(pts: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || last.x !== p.x || last.y !== p.y) out.push(p);
  }
  return out;
}

export function addWire(c: Circuit, from: string, to: string, toPin: number): Circuit {
  const fromG = c.gates.find((g) => g.id === from);
  const toG = c.gates.find((g) => g.id === to);
  if (!fromG || !toG || !hasOutput(fromG)) return c;
  if (toPin < 0 || toPin >= inputCount(toG)) return c;
  const rest = c.wires.filter((w) => !(w.to === to && w.toPin === toPin));
  return { ...c, wires: [...rest, { id: uid('w'), from, to, toPin }] };
}

export function removeGates(c: Circuit, ids: Set<string>): Circuit {
  return {
    gates: c.gates.filter((g) => !ids.has(g.id)),
    wires: c.wires.filter((w) => !ids.has(w.from) && !ids.has(w.to)),
  };
}

/** После уменьшения числа входов убираем провода на несуществующие пины. */
export function pruneWires(c: Circuit): Circuit {
  const gm = gateById(c);
  const wires = c.wires.filter((w) => {
    const f = gm.get(w.from);
    const t = gm.get(w.to);
    return f && t && hasOutput(f) && w.toPin < inputCount(t);
  });
  return wires.length === c.wires.length ? c : { ...c, wires };
}

export interface ClipboardData {
  kind: 'redlogic-clip';
  gates: Gate[];
  wires: Wire[];
}

export function copySelection(c: Circuit, ids: Set<string>): ClipboardData {
  return {
    kind: 'redlogic-clip',
    gates: c.gates.filter((g) => ids.has(g.id)).map((g) => ({ ...g })),
    wires: c.wires.filter((w) => ids.has(w.from) && ids.has(w.to)).map((w) => ({ ...w })),
  };
}

/** Вставляет фрагмент со смещением; возвращает новую схему и id новых гейтов. */
export function pasteClip(c: Circuit, clip: ClipboardData, dx: number, dy: number): { circuit: Circuit; ids: string[] } {
  const map = new Map<string, string>();
  const gates = clip.gates.map((g) => {
    const id = uid('g');
    map.set(g.id, id);
    return { ...g, id, x: snap(g.x + dx), y: snap(g.y + dy) };
  });
  const wires = clip.wires
    .filter((w) => map.has(w.from) && map.has(w.to))
    .map((w) => ({
      ...w,
      id: uid('w'),
      from: map.get(w.from)!,
      to: map.get(w.to)!,
      midX: w.midX === undefined ? undefined : snap(w.midX + dx),
    }));
  return { circuit: { gates: [...c.gates, ...gates], wires: [...c.wires, ...wires] }, ids: gates.map((g) => g.id) };
}

export function boundsOf(gates: Gate[]): { x: number; y: number; w: number; h: number } | null {
  if (gates.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const g of gates) {
    const { w, h } = gateSize(g);
    x0 = Math.min(x0, g.x);
    y0 = Math.min(y0, g.y);
    x1 = Math.max(x1, g.x + w);
    y1 = Math.max(y1, g.y + h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Подпись по умолчанию: x, y, z, … для входов, w0, w1, … для выходов. */
export function nextLabel(c: Circuit, type: GateType): string {
  if (type === 'INPUT') {
    const names = ['x', 'y', 'z', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'k'];
    const used = new Set(c.gates.filter((g) => g.type === 'INPUT').map((g) => g.label));
    for (const n of names) if (!used.has(n)) return n;
    return `in${c.gates.filter((g) => g.type === 'INPUT').length}`;
  }
  if (type === 'OUTPUT') {
    const used = new Set(c.gates.filter((g) => g.type === 'OUTPUT').map((g) => g.label));
    for (let i = 0; i < 64; i++) if (!used.has(`w${i}`)) return `w${i}`;
  }
  return '';
}

export function emptyCircuit(): Circuit {
  return { gates: [], wires: [] };
}

/** Пример из задания: x,y,z → w0,w1. */
export function exampleCircuit(): Circuit {
  const g = (type: GateType, x: number, y: number, label = '', inputs?: number): Gate => {
    const gate = createGate(type, x, y, label);
    if (inputs) gate.inputs = inputs;
    return gate;
  };
  const x = g('INPUT', 30, 30, 'x');
  const y = g('INPUT', 30, 120, 'y');
  const z = g('INPUT', 30, 210, 'z');
  const nx = g('NOT', 120, 135);
  const ny = g('NOT', 120, 225);
  const a1 = g('AND', 255, 60, '', 2);
  const a2 = g('AND', 255, 150, '', 2);
  const o3 = g('OR', 255, 255, '', 2);
  const o1 = g('OR', 405, 90, '', 2);
  const w0 = g('AND', 540, 90, '', 2);
  const w1 = g('AND', 540, 210, '', 2);
  const out0 = g('OUTPUT', 660, 105, 'w0');
  const out1 = g('OUTPUT', 660, 225, 'w1');
  let c: Circuit = { gates: [x, y, z, nx, ny, a1, a2, o3, o1, w0, w1, out0, out1], wires: [] };
  const link = (f: Gate, t: Gate, pin: number) => {
    c = addWire(c, f.id, t.id, pin);
  };
  link(x, nx, 0);
  link(y, ny, 0);
  link(x, a1, 0);
  link(y, a1, 1);
  link(y, a2, 0);
  link(nx, a2, 1);
  link(z, o3, 0);
  link(ny, o3, 1);
  link(a1, o1, 0);
  link(a2, o1, 1);
  link(o1, w0, 0);
  link(a2, w0, 1);
  link(o3, w1, 0);
  link(a2, w1, 1);
  link(w0, out0, 0);
  link(w1, out1, 0);
  return c;
}
