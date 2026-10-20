import { Grid, K, DX, DZ, opp, isConductor, isSignalSource, RES_BLOCKED, RES_NOSOLID, MAT_WIRE } from './voxel';

/** Дерево пыли одной сети. */
export interface NetTree {
  id: number;
  /** Клетки-корни (цепочка выхода): [первая, ...]; parent первой = -1. */
  root: number[];
  /** Приёмники: цепочка клеток [A, I?] — A подключается маршрутизатором. */
  sinks: number[][];
  parent: Map<number, number>;
  /** Рёбра «родитель → дети». */
  children: Map<number, number[]>;
  failed?: boolean;
}

export interface RouteOptions {
  maxLevel: number;
  maxExpansions: number;
}

export function makeTree(id: number, root: number[], sinks: number[][]): NetTree {
  const t: NetTree = { id, root, sinks, parent: new Map(), children: new Map() };
  for (let i = 0; i < root.length; i++) link(t, i === 0 ? -1 : root[i - 1], root[i]);
  return t;
}

function link(t: NetTree, parent: number, child: number): void {
  t.parent.set(child, parent);
  if (parent >= 0) {
    const arr = t.children.get(parent);
    if (arr) arr.push(child);
    else t.children.set(parent, [child]);
  }
}

class MinHeap {
  private a: number[] = [];
  private keys: number[] = [];
  get size(): number {
    return this.a.length;
  }
  push(key: number, val: number): void {
    const a = this.a;
    const k = this.keys;
    let i = a.length;
    a.push(val);
    k.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      a[i] = a[p];
      k[i] = k[p];
      i = p;
    }
    a[i] = val;
    k[i] = key;
  }
  pop(): number {
    const a = this.a;
    const k = this.keys;
    const top = a[0];
    const lastV = a.pop()!;
    const lastK = k.pop()!;
    const n = a.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lastK) break;
        a[i] = a[c];
        k[i] = k[c];
        i = c;
      }
      a[i] = lastV;
      k[i] = lastK;
    }
    return top;
  }
}

export class Router {
  readonly g: Grid;
  readonly opts: RouteOptions;
  private gScore: Float32Array;
  private stamp: Int32Array;
  private prev: Int32Array;
  private closed: Int32Array;
  /** Зона доступа к пинам: чужие сети сюда не заходят. */
  private pin: Int32Array;
  private pin2: Int32Array;
  private pinCells = new Map<number, number[]>();
  private cur = 0;
  expansions = 0;
  lastFail = '';

  constructor(g: Grid, opts: RouteOptions) {
    this.g = g;
    this.opts = opts;
    const n = g.W * g.H * g.D * 5;
    this.gScore = new Float32Array(n);
    this.stamp = new Int32Array(n);
    this.prev = new Int32Array(n);
    this.closed = new Int32Array(n);
    this.pin = new Int32Array(g.W * g.H * g.D).fill(-1);
    this.pin2 = new Int32Array(g.W * g.H * g.D).fill(-1);
  }

  /** Резервирует подходы к приёмникам, чтобы другие провода не замуровали пины. */
  reservePins(trees: NetTree[]): void {
    const g = this.g;
    for (const t of trees) {
      const cells: number[] = [];
      const mark = (x: number, y: number, z: number): void => {
        if (!g.inb(x, y, z)) return;
        const i = g.idx(x, y, z);
        if (g.kind[i] !== K.Air || g.res[i] & RES_BLOCKED) return;
        if (this.pin[i] === -1) {
          this.pin[i] = t.id;
          cells.push(i);
        } else if (this.pin2[i] === -1 && this.pin[i] !== t.id) {
          this.pin2[i] = t.id;
          cells.push(i);
        }
      };
      for (const chain of t.sinks) {
        const a = chain[0];
        const ax = g.x(a);
        const ay = g.y(a);
        const az = g.z(a);
        for (let d = 0; d < 4; d++) {
          const qx = ax + DX[d];
          const qz = az + DZ[d];
          if (!g.inb(qx, ay, qz)) continue;
          const qi = g.idx(qx, ay, qz);
          if (g.kind[qi] !== K.Air || g.res[qi] & RES_BLOCKED) continue;
          for (let dy = 0; dy <= 1; dy++) {
            mark(qx, ay + dy, qz);
            for (let e = 0; e < 4; e++) mark(qx + DX[e], ay + dy, qz + DZ[e]);
          }
        }
      }
      this.pinCells.set(t.id, cells);
    }
  }

  private releasePins(net: number): void {
    for (const i of this.pinCells.get(net) ?? []) {
      if (this.pin[i] === net) this.pin[i] = -1;
      if (this.pin2[i] === net) this.pin2[i] = -1;
    }
    this.pinCells.delete(net);
  }

  /** Диагностика: почему клетка непригодна для пыли. */
  explain(qx: number, qy: number, qz: number, net: number, target: number): string {
    const g = this.g;
    if (!g.inb(qx, qy, qz)) return 'oob';
    const qi = g.idx(qx, qy, qz);
    if (g.kind[qi] !== K.Air) return `kind=${g.kind[qi]} net=${g.net[qi]}`;
    if (g.res[qi] !== 0) return `res=${g.res[qi]}`;
    const o1 = this.pin[qi];
    const o2 = this.pin2[qi];
    if ((o1 !== -1 || o2 !== -1) && o1 !== net && o2 !== net) return `pin owners ${o1},${o2}`;
    const si = g.idx(qx, qy - 1, qz);
    if (g.kind[si] !== K.Air || g.res[si] !== 0) return `support kind=${g.kind[si]} res=${g.res[si]}`;
    for (let d = 0; d < 4; d++) {
      const nx = qx + DX[d];
      const nz = qz + DZ[d];
      const ni = g.idx(nx, qy, nz);
      if (g.kind[ni] === K.Dust && g.net[ni] !== net) return `adjacent foreign dust net ${g.net[ni]} at (${nx},${qy},${nz})`;
      if (g.kind[ni] === K.Dust && ni !== target) return `adjacent own dust (${nx},${qy},${nz})`;
    }
    return this.canPlaceDust(qx, qy, qz, net, -2, target, true) ? 'ok' : 'diag conflict';
  }

  /** Быстрая проверка: есть ли хоть один свободный подход к приёмнику. */
  private hasAccess(tree: NetTree, target: number): boolean {
    const g = this.g;
    const tx = g.x(target);
    const ty = g.y(target);
    const tz = g.z(target);
    for (let d = 0; d < 4; d++) {
      const nx = tx + DX[d];
      const nz = tz + DZ[d];
      if (!g.inb(nx, ty, nz)) continue;
      const ni = g.idx(nx, ty, nz);
      if (g.kind[ni] === K.Dust && g.net[ni] === tree.id) return true;
      for (let dy = 0; dy <= 1; dy++) {
        if (g.inb(nx, ty + dy, nz) && this.canPlaceDust(nx, ty + dy, nz, tree.id, -2, target, true)) return true;
      }
    }
    return false;
  }

  private isCond(x: number, y: number, z: number): boolean {
    return isConductor(this.g.kindAt(x, y, z));
  }

  /** Можно ли поставить пыль сети `net` в (qx,qy,qz) с учётом изоляции от чужих цепей. */
  private canPlaceDust(qx: number, qy: number, qz: number, net: number, pred: number, target: number, relaxOwn = false): boolean {
    const g = this.g;
    if (qy < 1 || qy > this.opts.maxLevel) return false;
    const qi = g.idx(qx, qy, qz);
    if (g.kind[qi] !== K.Air || g.res[qi] !== 0) return false;
    const o1 = this.pin[qi];
    const o2 = this.pin2[qi];
    if ((o1 !== -1 || o2 !== -1) && o1 !== net && o2 !== net) return false;
    const si = g.idx(qx, qy - 1, qz);
    if (g.kind[si] !== K.Air || g.res[si] !== 0) return false;
    const upCond = this.isCond(qx, qy + 1, qz);
    for (let d = 0; d < 4; d++) {
      const nx = qx + DX[d];
      const nz = qz + DZ[d];
      if (nx < 0 || nz < 0 || nx >= g.W || nz >= g.D) continue;
      // тот же уровень
      const ni = g.idx(nx, qy, nz);
      const kn = g.kind[ni] as K;
      if (kn === K.Dust) {
        if (g.net[ni] !== net) return false;
        if (!relaxOwn && ni !== pred && ni !== target) return false;
      } else if (isSignalSource(kn)) return false;
      else if (kn === K.Repeater && (g.dir[ni] & 1) === (d & 1)) return false;
      // диагональ вверх: соединяется, если над q нет проводящего блока
      if (!upCond && qy + 1 < g.H) {
        const ui = g.idx(nx, qy + 1, nz);
        if (g.kind[ui] === K.Dust) {
          if (g.net[ui] !== net) return false;
          if (!relaxOwn && ui !== pred && ui !== target) return false;
        }
      }
      // диагональ вниз: соединяется, если соседняя клетка на уровне q не проводник
      if (!isConductor(kn) && qy - 1 >= 0) {
        const wi = g.idx(nx, qy - 1, nz);
        if (g.kind[wi] === K.Dust) {
          if (g.net[wi] !== net) return false;
          if (!relaxOwn && wi !== pred && wi !== target) return false;
        }
      }
    }
    return true;
  }

  /** Допустимы ли доп. условия перехода p→q (воздух над p / под ходом вниз). */
  private moveOk(px: number, py: number, pz: number, d: number, dy: number): boolean {
    const g = this.g;
    if (dy === 1) {
      if (py + 1 >= g.H) return false;
      const ui = g.idx(px, py + 1, pz);
      return g.kind[ui] === K.Air && (g.res[ui] & RES_BLOCKED) === 0;
    }
    if (dy === -1) {
      const cx = px + DX[d];
      const cz = pz + DZ[d];
      const ci = g.idx(cx, py, cz);
      return g.kind[ci] === K.Air; // клетка между p и q должна быть непроводящей
    }
    return true;
  }

  /**
   * Прокладывает провод от любой клетки дерева до клетки приёмника `target`.
   * Возвращает список новых клеток пыли (по порядку от старта) и стартовую клетку.
   */
  private search(tree: NetTree, target: number): { start: number; path: number[] } | null {
    const g = this.g;
    const net = tree.id;
    const tx = g.x(target);
    const ty = g.y(target);
    const tz = g.z(target);
    this.cur++;
    const heap = new MinHeap();
    const H = (x: number, z: number): number => Math.abs(x - tx) + Math.abs(z - tz);
    const fixed = new Set<number>();
    for (const chain of tree.sinks) for (let i = 1; i < chain.length; i++) fixed.add(chain[i]);
    for (const cell of tree.parent.keys()) {
      if (g.kind[cell] !== K.Dust || fixed.has(cell)) continue;
      const node = cell * 5 + 4;
      this.stamp[node] = this.cur;
      this.gScore[node] = 0;
      this.prev[node] = -1;
      heap.push(H(g.x(cell), g.z(cell)), node);
    }
    const budget = this.opts.maxExpansions;
    let steps = 0;
    while (heap.size > 0) {
      const node = heap.pop();
      if (this.closed[node] === this.cur) continue;
      this.closed[node] = this.cur;
      const cell = (node / 5) | 0;
      const ld = node % 5;
      const px = g.x(cell);
      const py = g.y(cell);
      const pz = g.z(cell);
      const gp = this.gScore[node];
      if (++steps > budget) return null;
      this.expansions++;
      if (cell === target) {
        // восстановление пути
        const cells: number[] = [];
        let n = node;
        while (n >= 0) {
          cells.push((n / 5) | 0);
          n = this.prev[n];
        }
        cells.reverse();
        return { start: cells[0], path: cells.slice(1, -1) };
      }
      for (let d = 0; d < 4; d++) {
        const nx = px + DX[d];
        const nz = pz + DZ[d];
        if (nx < 0 || nz < 0 || nx >= g.W || nz >= g.D) continue;
        for (let m = 0; m < 3; m++) {
          const dy = m === 0 ? 0 : m === 1 ? 1 : -1;
          const qy = py + dy;
          if (qy < 1 || qy >= g.H) continue;
          const qi = g.idx(nx, qy, nz);
          const isTarget = qi === target;
          if (!isTarget) {
            if (!this.moveOk(px, py, pz, d, dy)) continue;
            if (!this.canPlaceDust(nx, qy, nz, net, cell, target)) continue;
          } else {
            if (qy !== ty) continue;
            if (!this.moveOk(px, py, pz, d, dy)) continue;
          }
          let cost = 1;
          if (ld !== 4 && ld !== d) cost += 0.45;
          if (dy !== 0) cost += 1.4;
          if (qy > 1) cost += 0.25 * (qy - 1);
          const ng = gp + cost;
          const nnode = qi * 5 + d;
          if (this.stamp[nnode] === this.cur && this.gScore[nnode] <= ng) continue;
          this.stamp[nnode] = this.cur;
          this.gScore[nnode] = ng;
          this.prev[nnode] = node;
          heap.push(ng + H(nx, nz), nnode);
        }
      }
    }
    return null;
  }

  /** Клетки, физически соединённые с пылью в (x,y,z) (по правилам игры). */
  private connNeighbors(i: number): number[] {
    const g = this.g;
    const x = g.x(i);
    const y = g.y(i);
    const z = g.z(i);
    const out: number[] = [];
    const upCond = this.isCond(x, y + 1, z);
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d];
      const nz = z + DZ[d];
      if (nx < 0 || nz < 0 || nx >= g.W || nz >= g.D) continue;
      const kn = g.kind[g.idx(nx, y, nz)] as K;
      if (kn === K.Dust) out.push(g.idx(nx, y, nz));
      if (!upCond && y + 1 < g.H && g.kind[g.idx(nx, y + 1, nz)] === K.Dust && isConductor(kn)) out.push(g.idx(nx, y + 1, nz));
      if (!isConductor(kn) && y >= 1 && g.kind[g.idx(nx, y - 1, nz)] === K.Dust) out.push(g.idx(nx, y - 1, nz));
    }
    return out;
  }

  /** Фиксирует найденный путь в сетке. */
  private commit(tree: NetTree, start: number, path: number[], target: number): boolean {
    const g = this.g;
    const net = tree.id;
    let prevCell = start;
    // сначала ставим всё, потом проверяем самосоприкосновение
    const seq = [...path, target];
    for (const q of path) {
      const x = g.x(q);
      const y = g.y(q);
      const z = g.z(q);
      g.kind[q] = K.Dust;
      g.net[q] = net;
      g.mat[q] = MAT_WIRE;
      g.routed[q] = 1;
      const s = g.idx(x, y - 1, z);
      g.kind[s] = K.Solid;
      g.mat[s] = MAT_WIRE;
      g.routed[s] = 1;
    }
    // резервы воздуха
    prevCell = start;
    for (const q of seq) {
      const dy = g.y(q) - g.y(prevCell);
      if (dy === 1) g.res[g.idx(g.x(prevCell), g.y(prevCell) + 1, g.z(prevCell))] |= RES_NOSOLID;
      else if (dy === -1) g.res[g.idx(g.x(q), g.y(prevCell), g.z(q))] |= RES_NOSOLID;
      prevCell = q;
    }
    // дерево
    prevCell = start;
    for (const q of seq) {
      link(tree, prevCell, q);
      prevCell = q;
    }
    // проверка: в пути нет лишних соединений (кроме соседей по цепочке)
    const full = [start, ...seq];
    for (let i = 0; i < full.length - 1; i++) {
      // соседние клетки пути обязаны быть физически соединены
      if (!this.connNeighbors(full[i]).includes(full[i + 1])) return false;
    }
    for (let i = 1; i < full.length - 1; i++) {
      const allowed = new Set([full[i - 1], full[i + 1]]);
      for (const nb of this.connNeighbors(full[i])) {
        if (allowed.has(nb)) continue;
        if (g.net[nb] !== net) return false;
        // допустим только родитель/ребёнок по дереву
        if (tree.parent.get(nb) === full[i] || tree.parent.get(full[i]) === nb) continue;
        return false;
      }
    }
    return true;
  }

  /** Прокладывает всю сеть. Возвращает false при неудаче. */
  routeNet(tree: NetTree): boolean {
    const g = this.g;
    // приёмники по возрастанию расстояния от корня
    const rx = g.x(tree.root[tree.root.length - 1]);
    const rz = g.z(tree.root[tree.root.length - 1]);
    const order = [...tree.sinks].sort((a, b) => Math.abs(g.x(a[0]) - rx) + Math.abs(g.z(a[0]) - rz) - (Math.abs(g.x(b[0]) - rx) + Math.abs(g.z(b[0]) - rz)));
    for (const chain of order) {
      const target = chain[0];
      if (!this.hasAccess(tree, target)) {
        this.lastFail = `no access net ${tree.id} target (${this.g.x(target)},${this.g.y(target)},${this.g.z(target)})`;
        return false;
      }
      const res = this.search(tree, target);
      if (!res) {
        this.lastFail = `search failed net ${tree.id} target (${this.g.x(target)},${this.g.y(target)},${this.g.z(target)})`;
        return false;
      }
      if (!this.commit(tree, res.start, res.path, target)) {
        this.lastFail = `commit failed net ${tree.id} target (${this.g.x(target)},${this.g.y(target)},${this.g.z(target)}) path ${res.path.map((c) => `(${this.g.x(c)},${this.g.y(c)},${this.g.z(c)})`).join('')}`;
        return false;
      }
      for (let i = 1; i < chain.length; i++) link(tree, chain[i - 1], chain[i]);
    }
    this.releasePins(tree.id);
    return true;
  }
}

/** Вставляет повторители там, где сигнал затухает (длина без усиления > maxRun). */
export function insertRepeaters(g: Grid, tree: NetTree, maxRun: number): boolean {
  for (let guard = 0; guard < 10000; guard++) {
    // возраст = число клеток пыли от последнего источника
    const age = new Map<number, number>();
    const order: number[] = [];
    const stack = [tree.root[0]];
    age.set(tree.root[0], 1);
    while (stack.length) {
      const c = stack.shift()!;
      order.push(c);
      for (const ch of tree.children.get(c) ?? []) {
        age.set(ch, g.kind[c] === K.Repeater ? 1 : (age.get(c) ?? 1) + 1);
        stack.push(ch);
      }
    }
    const bad = order.find((c) => g.kind[c] === K.Dust && (age.get(c) ?? 0) > maxRun);
    if (bad === undefined) return true;
    // ищем подходящую клетку для повторителя вверх по цепочке
    let chosen = -1;
    for (let c = tree.parent.get(bad)!; c >= 0; c = tree.parent.get(c)!) {
      if (g.kind[c] === K.Repeater) break;
      if (!g.routed[c] || g.kind[c] !== K.Dust) continue;
      const kids = tree.children.get(c) ?? [];
      const p = tree.parent.get(c)!;
      if (kids.length !== 1 || p < 0 || g.kind[p] !== K.Dust) continue;
      const k = kids[0];
      if (g.kind[k] !== K.Dust) continue;
      if (g.y(p) !== g.y(c) || g.y(k) !== g.y(c)) continue;
      const dx1 = g.x(c) - g.x(p);
      const dz1 = g.z(c) - g.z(p);
      const dx2 = g.x(k) - g.x(c);
      const dz2 = g.z(k) - g.z(c);
      if (dx1 !== dx2 || dz1 !== dz2) continue;
      chosen = c;
      break;
    }
    if (chosen < 0) return false;
    const p = tree.parent.get(chosen)!;
    let flow = 0;
    for (let d = 0; d < 4; d++) if (g.x(p) + DX[d] === g.x(chosen) && g.z(p) + DZ[d] === g.z(chosen)) flow = d;
    g.kind[chosen] = K.Repeater;
    g.dir[chosen] = opp(flow);
    g.delay[chosen] = 1;
  }
  return false;
}
