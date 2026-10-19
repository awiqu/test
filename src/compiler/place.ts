import { Netlist } from './techmap';
import { ModuleDef } from './modules';

export interface Layout {
  /** Смещение левого верхнего угла охранной зоны каждого модуля (в блоках, от 0). */
  pos: { ox: number; oz: number }[];
  /** Для каждого экземпляра: сеть, подключённая к каждому слоту. */
  slotNets: number[][];
  width: number;
  depth: number;
  depthOf: number[];
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Изотоническая регрессия (PAV): неубывающая последовательность, ближайшая к y. */
function isotonic(y: number[]): number[] {
  const blocks: { sum: number; n: number }[] = [];
  for (const v of y) {
    blocks.push({ sum: v, n: 1 });
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1];
      const a = blocks[blocks.length - 2];
      if (a.sum / a.n <= b.sum / b.n) break;
      blocks.pop();
      blocks.pop();
      blocks.push({ sum: a.sum + b.sum, n: a.n + b.n });
    }
  }
  const out: number[] = [];
  for (const b of blocks) for (let i = 0; i < b.n; i++) out.push(b.sum / b.n);
  return out;
}

export function layoutModules(nl: Netlist, defs: ModuleDef[], gapX: number, gapZ: number, seed: number): Layout {
  const n = nl.insts.length;
  const rnd = mulberry(seed + 1);
  const dims = defs.map((d) => ({ w: d.box.x1 - d.box.x0 + 1, d: d.box.z1 - d.box.z0 + 1 }));
  // глубина (столбец)
  const depthOf = new Array<number>(n).fill(0);
  for (const inst of nl.insts) {
    if (inst.kind === 'IN') depthOf[inst.id] = 0;
    else depthOf[inst.id] = 1 + Math.max(...inst.ins.map((net) => depthOf[nl.nets[net].driver]));
  }
  const maxDepth = Math.max(0, ...depthOf);
  const cols: number[][] = [];
  for (let c = 0; c <= maxDepth; c++) cols.push([]);
  for (const inst of nl.insts) cols[depthOf[inst.id]].push(inst.id);
  const jitter = new Map<number, number>();
  for (const inst of nl.insts) jitter.set(inst.id, inst.yhint + (seed ? (rnd() - 0.5) * 40 * Math.min(seed, 3) : 0));
  for (const col of cols) col.sort((a, b) => jitter.get(a)! - jitter.get(b)! || a - b);

  const oz = new Array<number>(n).fill(0);
  const center = (i: number): number => oz[i] + (dims[i].d - 1) / 2;

  const stackColumn = (col: number[]): void => {
    let z = 0;
    for (const i of col) {
      oz[i] = z;
      z += dims[i].d + gapZ;
    }
  };
  for (const col of cols) stackColumn(col);
  const colHeight = (col: number[]): number => (col.length ? oz[col[col.length - 1]] + dims[col[col.length - 1]].d : 0);
  const tallest = Math.max(...cols.map(colHeight));
  for (const col of cols) {
    const shift = Math.floor((tallest - colHeight(col)) / 2);
    for (const i of col) oz[i] += shift;
  }

  const placeWithDesired = (col: number[], desired: Map<number, number>): number[] => {
    const sorted = [...col].sort((a, b) => desired.get(a)! - desired.get(b)! || a - b);
    const cum: number[] = [];
    let c = 0;
    for (const i of sorted) {
      cum.push(c);
      c += dims[i].d + gapZ;
    }
    const ys = sorted.map((i, k) => desired.get(i)! - cum[k]);
    const u = isotonic(ys).map((v) => Math.round(v));
    sorted.forEach((i, k) => {
      oz[i] = u[k] + cum[k];
    });
    return sorted;
  };

  const driversOf = (i: number): number[] => nl.insts[i].ins.map((net) => nl.nets[net].driver);
  const sinksOf = (i: number): number[] => {
    const o = nl.insts[i].out;
    return o < 0 ? [] : nl.nets[o].sinks.map((s) => s.inst);
  };

  const sweep = (c: number, neighbours: (i: number) => number[]): void => {
    const col = cols[c];
    const desired = new Map<number, number>();
    for (const i of col) {
      const nb = neighbours(i);
      if (nb.length === 0) desired.set(i, oz[i]);
      else desired.set(i, nb.reduce((s, j) => s + center(j), 0) / nb.length - (dims[i].d - 1) / 2);
    }
    cols[c] = placeWithDesired(col, desired);
  };

  for (let iter = 0; iter < 4; iter++) {
    for (let c = 1; c <= maxDepth; c++) sweep(c, driversOf);
    for (let c = maxDepth - 1; c >= 0; c--) sweep(c, sinksOf);
  }
  for (let c = 1; c <= maxDepth; c++) sweep(c, driversOf);

  // нормализация по вертикали
  let minZ = Infinity;
  for (let i = 0; i < n; i++) minZ = Math.min(minZ, oz[i]);
  for (let i = 0; i < n; i++) oz[i] -= minZ;

  // позиции по x
  const colW = cols.map((col) => Math.max(0, ...col.map((i) => dims[i].w)));
  const colX: number[] = [];
  let x = 0;
  for (let c = 0; c <= maxDepth; c++) {
    colX.push(x);
    x += colW[c] + gapX;
  }
  const pos = new Array<{ ox: number; oz: number }>(n);
  for (let c = 0; c <= maxDepth; c++) for (const i of cols[c]) pos[i] = { ox: colX[c], oz: oz[i] };
  const width = x - gapX;
  let depth = 0;
  for (let i = 0; i < n; i++) depth = Math.max(depth, oz[i] + dims[i].d);

  // распределение входов по слотам: по порядку строк источников
  const slotNets: number[][] = nl.insts.map((inst) => {
    const k = inst.ins.length;
    if (k === 0) return [];
    const order = inst.ins
      .map((net, idx) => ({ net, idx, row: center(nl.nets[net].driver) }))
      .sort((a, b) => a.row - b.row || a.net - b.net);
    const slots = new Array<number>(k);
    // слоты: k=1 [W]; k=2 [N,S]; k=3 [W,N,S] — сортировка: N (мин. строка), W (середина), S
    const targetSlot = k === 3 ? [1, 0, 2] : k === 2 ? [0, 1] : [0];
    order.forEach((o, rank) => {
      slots[targetSlot[rank]] = o.net;
    });
    return slots;
  });

  return { pos, slotNets, width, depth, depthOf };
}
