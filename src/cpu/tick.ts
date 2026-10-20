import { Grid, K, DX, DZ, isConductor, opp } from '../compiler/voxel';
import { dustShape } from '../redstone/rules';
import { Vox, toGrid } from './vox';

/**
 * Покадровый симулятор редстоуна на воксельной сетке (шаг = игровой тик, редстоун-тик = 2 игровых).
 * Правила взяты из Java Edition и сверены с настоящим сервером на защёлках, триггерах и компараторах:
 *  - пыль и питание блоков мгновенны; факел реагирует через 2 тика; повторитель — через 2·delay;
 *  - заблокированный повторитель (сбоку питает другой повторитель/компаратор) держит состояние;
 *  - компаратор: сравнение / вычитание, читает бочку сзади, сторона — пыль или повторитель; задержка 2 тика;
 *  - лампа включается сразу, гаснет через 4 тика.
 */
const DIRS = 6; // 0..3 горизонталь, 4 вверх, 5 вниз

export class TickSim {
  readonly g: Grid;
  readonly ox: number;
  readonly oy: number;
  readonly oz: number;
  readonly sub: Uint8Array;
  readonly sig: Uint8Array;
  readonly power: Uint8Array;
  readonly lit: Uint8Array;
  readonly out: Uint8Array;
  readonly locked: Uint8Array;
  private due: Int32Array;
  private events = new Map<number, number[]>();
  time = 0;
  /** Сколько раз менялось состояние компонентов (метрика активности). */
  toggles = 0;
  private n: number;
  private dustNb: Int32Array[] = [];
  private dustComp: Int32Array;
  private compCells: number[][] = [];
  private compBase: Uint8Array;
  private torchSet: number[] = [];
  private tags: Map<string, [number, number, number]>;

  constructor(v: Vox) {
    const t = toGrid(v);
    this.g = t.grid;
    this.ox = t.ox;
    this.oy = t.oy;
    this.oz = t.oz;
    this.sub = t.sub;
    this.sig = t.sig;
    this.tags = v.tags;
    const g = this.g;
    this.n = g.kind.length;
    this.power = new Uint8Array(this.n);
    this.lit = new Uint8Array(this.n);
    this.out = new Uint8Array(this.n);
    this.locked = new Uint8Array(this.n);
    this.due = new Int32Array(this.n).fill(-1);
    this.dustComp = new Int32Array(this.n).fill(-1);
    this.compBase = new Uint8Array(this.n);
    v.forEach((x, y, z, c) => {
      const i = g.idx(x + this.ox, y + this.oy, z + this.oz);
      if (c.kind === K.Lever || c.kind === K.Button) this.lit[i] = c.on ? 1 : 0;
      if (c.kind === K.Torch) this.lit[i] = 1;
    });
    this.buildDust();
    this.initialPass();
  }

  // ───────────── геометрия ─────────────

  private nbr(i: number, k: number): number {
    const g = this.g;
    const x = g.x(i);
    const y = g.y(i);
    const z = g.z(i);
    let nx = x;
    let ny = y;
    let nz = z;
    if (k < 4) {
      nx += DX[k];
      nz += DZ[k];
    } else ny += k === 4 ? 1 : -1;
    return g.inb(nx, ny, nz) ? g.idx(nx, ny, nz) : -1;
  }

  private kindOf(i: number): K {
    return i < 0 ? K.Air : (this.g.kind[i] as K);
  }

  private cond(i: number): boolean {
    return isConductor(this.kindOf(i));
  }

  // ───────────── пыль ─────────────

  private buildDust(): void {
    const g = this.g;
    const nbs: Map<number, number[]> = new Map();
    for (let i = 0; i < this.n; i++) {
      if (g.kind[i] !== K.Dust) continue;
      const x = g.x(i);
      const y = g.y(i);
      const z = g.z(i);
      const list: number[] = [];
      const aboveCond = isConductor(g.kindAt(x, y + 1, z));
      for (let d = 0; d < 4; d++) {
        const mx = x + DX[d];
        const mz = z + DZ[d];
        const mk = g.kindAt(mx, y, mz);
        if (mk === K.Dust) list.push(g.idx(mx, y, mz));
        if (isConductor(mk) && !aboveCond) {
          if (g.kindAt(mx, y + 1, mz) === K.Dust) list.push(g.idx(mx, y + 1, mz));
        } else if (!isConductor(mk)) {
          if (g.kindAt(mx, y - 1, mz) === K.Dust) list.push(g.idx(mx, y - 1, mz));
        }
      }
      nbs.set(i, list);
    }
    // компоненты связности
    for (const [i] of nbs) {
      if (this.dustComp[i] >= 0) continue;
      const id = this.compCells.length;
      const cells: number[] = [];
      const stack = [i];
      this.dustComp[i] = id;
      while (stack.length) {
        const c = stack.pop()!;
        cells.push(c);
        for (const m of nbs.get(c)!) {
          if (this.dustComp[m] < 0) {
            this.dustComp[m] = id;
            stack.push(m);
          }
        }
      }
      this.compCells.push(cells);
    }
    for (const [i, l] of nbs) this.dustNb[i] = Int32Array.from(l);
    // формы пыли (нужны для «подключена ли пыль к соседу»)
    this.shape = new Uint8Array(this.n * 4);
    for (const [i] of nbs) {
      const sh = dustShape(g, g.x(i), g.y(i), g.z(i));
      for (let d = 0; d < 4; d++) this.shape[i * 4 + d] = sh[d];
    }
    for (let i = 0; i < this.n; i++) if (g.kind[i] === K.Torch) this.torchSet.push(i);
  }
  private shape!: Uint8Array;

  // ───────────── сигналы ─────────────

  /** Сигнал, который источник m отдаёт потребителю; q — направление от потребителя к m. */
  private emit(m: number, q: number, wires: boolean): number {
    if (m < 0) return 0;
    const g = this.g;
    switch (g.kind[m] as K) {
      case K.Torch:
        return this.lit[m] === 1 && g.dir[m] !== q ? 15 : 0;
      case K.Lever:
      case K.Button:
        return this.lit[m] === 1 ? 15 : 0;
      case K.Repeater:
        return this.lit[m] === 1 && g.dir[m] === q ? 15 : 0;
      case K.Comparator:
        return g.dir[m] === q ? this.out[m] : 0;
      case K.Dust: {
        if (!wires) return 0;
        const p = this.power[m];
        if (p === 0) return 0;
        if (q === 4) return p; // пыль над потребителем питает блок под собой
        if (q === 5) return 0;
        return this.shape[m * 4 + opp(q)] !== 0 ? p : 0;
      }
      default:
        return 0;
    }
  }

  /** Сильное питание проводящего блока b (сумма источников вокруг, как getDirectSignalTo). */
  private strong(b: number, wires: boolean): number {
    const g = this.g;
    let best = 0;
    for (let k = 0; k < DIRS; k++) {
      const m = this.nbr(b, k);
      if (m < 0) continue;
      let v = 0;
      switch (g.kind[m] as K) {
        case K.Torch:
          if (k === 5 && this.lit[m] === 1) v = 15;
          break;
        case K.Lever:
        case K.Button:
          if (k === 4 && this.lit[m] === 1) v = 15;
          break;
        case K.Repeater:
          if (k < 4 && this.lit[m] === 1 && g.dir[m] === k) v = 15;
          break;
        case K.Comparator:
          if (k < 4 && g.dir[m] === k) v = this.out[m];
          break;
        case K.Dust:
          if (wires) v = this.emit(m, k, true);
          break;
        default:
          break;
      }
      if (v > best) best = v;
    }
    return best;
  }

  /** Уровень сигнала, который потребитель i получает со стороны k. */
  private signalFrom(i: number, k: number, wires: boolean): number {
    const m = this.nbr(i, k);
    if (m < 0) return 0;
    if (this.cond(m)) return this.strong(m, wires);
    return this.emit(m, k, wires);
  }

  /** Вход повторителя/компаратора: сигнал сзади (сторона dir). */
  private rearSignal(i: number): number {
    const g = this.g;
    const f = g.dir[i];
    const r = this.nbr(i, f);
    if (r < 0) return 0;
    if (g.kind[r] === K.Barrel) return this.sig[r];
    if (this.cond(r)) return this.strong(r, true);
    return this.emit(r, f, true);
  }

  private sideSignal(i: number, diodesOnly: boolean): number {
    const g = this.g;
    const f = g.dir[i];
    let best = 0;
    for (const k of [(f + 1) & 3, (f + 3) & 3]) {
      const s = this.nbr(i, k);
      if (s < 0) continue;
      const kind = g.kind[s] as K;
      let v = 0;
      if (kind === K.Repeater) v = this.lit[s] === 1 && g.dir[s] === k ? 15 : 0;
      else if (kind === K.Comparator) v = g.dir[s] === k ? this.out[s] : 0;
      else if (!diodesOnly && kind === K.Dust) v = this.power[s];
      if (v > best) best = v;
    }
    return best;
  }

  private comparatorTarget(i: number): number {
    const a = this.rearSignal(i);
    const b = this.sideSignal(i, false);
    if (this.sub[i]) return Math.max(a - b, 0);
    return a >= b ? a : 0;
  }

  private torchPowered(i: number): boolean {
    const g = this.g;
    const attach = this.nbr(i, opp(g.dir[i]));
    return attach >= 0 && this.cond(attach) && this.strong(attach, true) > 0;
  }

  private lampSignal(i: number): boolean {
    for (let k = 0; k < DIRS; k++) if (this.signalFrom(i, k, true) > 0) return true;
    return false;
  }

  // ───────────── обновление пыли ─────────────

  private recomputeComp(id: number, changedOut: number[]): void {
    const cells = this.compCells[id];
    const g = this.g;
    const base = this.compBase;
    for (const i of cells) {
      let p = 0;
      for (let k = 0; k < DIRS && p < 15; k++) {
        const v = this.signalFrom(i, k, false);
        if (v > p) p = v;
      }
      base[i] = p;
    }
    const np = new Map<number, number>();
    for (const i of cells) np.set(i, base[i]);
    let changed = true;
    let guard = 0;
    while (changed && guard++ < 40) {
      changed = false;
      for (const i of cells) {
        let best = base[i];
        for (const m of this.dustNb[i]) {
          const v = np.get(m)! - 1;
          if (v > best) best = v;
        }
        if (best > np.get(i)!) {
          np.set(i, best);
          changed = true;
        }
      }
    }
    for (const i of cells) {
      const v = np.get(i)!;
      if (this.power[i] !== v) {
        this.power[i] = v;
        changedOut.push(i);
      }
    }
    void g;
  }

  // ───────────── распространение изменений ─────────────

  private dirty = new Set<number>();

  private markAround(i: number, r = 2): void {
    const g = this.g;
    const x = g.x(i);
    const y = g.y(i);
    const z = g.z(i);
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > r) continue;
          if (g.inb(x + dx, y + dy, z + dz)) this.dirty.add(g.idx(x + dx, y + dy, z + dz));
        }
      }
    }
  }

  /** Источник изменил состояние: пересчитать пыль и пометить потребителей. */
  private touched(i: number): void {
    this.markAround(i, 2);
  }

  /** Обрабатывает пометки: пыль → потребители → новые события. */
  private propagate(): void {
    let guard = 0;
    while (this.dirty.size && guard++ < 10000) {
      const batch = [...this.dirty];
      this.dirty.clear();
      const comps = new Set<number>();
      for (const i of batch) if (this.g.kind[i] === K.Dust) comps.add(this.dustComp[i]);
      const changedDust: number[] = [];
      for (const c of comps) this.recomputeComp(c, changedDust);
      for (const d of changedDust) this.markAround(d, 2);
      // потребители
      const consumers = new Set<number>(batch);
      for (const d of changedDust) {
        const g = this.g;
        const x = g.x(d);
        const y = g.y(d);
        const z = g.z(d);
        for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) for (let dz = -2; dz <= 2; dz++) {
          if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > 2) continue;
          if (g.inb(x + dx, y + dy, z + dz)) consumers.add(g.idx(x + dx, y + dy, z + dz));
        }
      }
      for (const i of consumers) this.evaluate(i);
      // повторители могли изменить блокировку — это уже учтено в evaluate; если что-то поменялось, dirty пополнится
    }
  }

  private schedule(i: number, delay: number): void {
    if (this.due[i] >= 0) return;
    const t = this.time + delay;
    this.due[i] = t;
    const arr = this.events.get(t);
    if (arr) arr.push(i);
    else this.events.set(t, [i]);
  }

  /** Оценивает потребителя и при необходимости планирует событие. */
  private evaluate(i: number): void {
    const g = this.g;
    switch (g.kind[i] as K) {
      case K.Torch: {
        const target = this.torchPowered(i) ? 0 : 1;
        if (target !== this.lit[i]) this.schedule(i, 2);
        break;
      }
      case K.Repeater: {
        const lockNow = this.sideSignal(i, true) > 0 ? 1 : 0;
        if (lockNow !== this.locked[i]) this.locked[i] = lockNow;
        if (!this.locked[i]) {
          const should = this.rearSignal(i) > 0 ? 1 : 0;
          if (should !== this.lit[i]) this.schedule(i, 2 * (g.delay[i] || 1));
        }
        break;
      }
      case K.Comparator: {
        const target = this.comparatorTarget(i);
        if (target !== this.out[i]) this.schedule(i, 2);
        break;
      }
      case K.Lamp: {
        const sig = this.lampSignal(i);
        if (sig && !this.lit[i]) {
          this.lit[i] = 1;
        } else if (!sig && this.lit[i]) this.schedule(i, 4);
        break;
      }
      default:
        break;
    }
  }

  private execute(i: number): void {
    const g = this.g;
    this.due[i] = -1;
    switch (g.kind[i] as K) {
      case K.Torch: {
        const v = this.torchPowered(i) ? 0 : 1;
        if (v !== this.lit[i]) {
          this.lit[i] = v;
          this.toggles++;
          this.touched(i);
        }
        break;
      }
      case K.Repeater: {
        if (this.locked[i]) break;
        const should = this.rearSignal(i) > 0 ? 1 : 0;
        const powered = this.lit[i];
        if (powered && !should) {
          this.lit[i] = 0;
          this.toggles++;
          this.touched(i);
        } else if (!powered) {
          this.lit[i] = 1;
          this.toggles++;
          this.touched(i);
          if (!should) this.schedule(i, 2 * (g.delay[i] || 1));
        }
        break;
      }
      case K.Comparator: {
        const v = this.comparatorTarget(i);
        if (v !== this.out[i]) {
          this.out[i] = v;
          this.toggles++;
          this.touched(i);
        }
        break;
      }
      case K.Lamp: {
        if (this.lit[i] && !this.lampSignal(i)) {
          this.lit[i] = 0;
          this.toggles++;
        }
        break;
      }
      default:
        break;
    }
  }

  /** Начальное состояние: всё «выключено», факелы горят; даём схеме устояться без учёта времени. */
  private initialPass(): void {
    for (let i = 0; i < this.n; i++) {
      const k = this.g.kind[i] as K;
      if (k === K.Dust || k === K.Torch || k === K.Repeater || k === K.Comparator || k === K.Lamp || k === K.Lever || k === K.Button) this.dirty.add(i);
    }
    this.propagate();
  }

  // ───────────── управление ─────────────

  /** Один игровой тик. */
  tick(): void {
    this.time++;
    const list = this.events.get(this.time);
    if (list) {
      this.events.delete(this.time);
      for (const i of list) {
        if (this.due[i] !== this.time) continue;
        this.execute(i);
        this.propagate();
      }
    }
    this.propagate();
  }

  run(ticks: number): void {
    for (let t = 0; t < ticks; t++) this.tick();
  }

  /** Крутит, пока есть события; возвращает число потраченных тиков (или -1, если не успокоилось). */
  settle(maxTicks = 2000): number {
    const t0 = this.time;
    for (let t = 0; t < maxTicks; t++) {
      let pending = false;
      for (const [, v] of this.events) if (v.length) pending = true;
      if (!pending) return this.time - t0;
      this.tick();
    }
    return -1;
  }

  idxAt(x: number, y: number, z: number): number {
    return this.g.idx(x + this.ox, y + this.oy, z + this.oz);
  }

  setLever(x: number, y: number, z: number, on: boolean): void {
    const i = this.idxAt(x, y, z);
    const k = this.g.kind[i] as K;
    if (k !== K.Lever && k !== K.Button) throw new Error(`В (${x},${y},${z}) нет рычага`);
    const v = on ? 1 : 0;
    if (this.lit[i] === v) return;
    this.lit[i] = v;
    this.touched(i);
    this.propagate();
  }

  powerAt(x: number, y: number, z: number): number {
    return this.power[this.idxAt(x, y, z)];
  }
  litAt(x: number, y: number, z: number): boolean {
    return this.lit[this.idxAt(x, y, z)] === 1;
  }
  outAt(x: number, y: number, z: number): number {
    return this.out[this.idxAt(x, y, z)];
  }
  lockedAt(x: number, y: number, z: number): boolean {
    return this.locked[this.idxAt(x, y, z)] === 1;
  }
  /** Подключён ли сигнал на метке (лампа горит / пыль под напряжением / повторитель включён). */
  probe(tag: string): number {
    const p = this.tags.get(tag);
    if (!p) throw new Error(`Нет метки «${tag}»`);
    const i = this.idxAt(p[0], p[1], p[2]);
    switch (this.g.kind[i] as K) {
      case K.Dust:
        return this.power[i];
      case K.Comparator:
        return this.out[i];
      default:
        return this.lit[i];
    }
  }
}
