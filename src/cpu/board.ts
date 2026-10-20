import { Grid, K, DX, DZ, RES_BLOCKED, isConductor, MAT_WIRE } from '../compiler/voxel';
import { NetTree, Router, insertRepeaters, makeTree } from '../compiler/route';
import { Macro } from './macro';
import { Vox, VCell } from './vox';
import { XYZ } from './arrays';
import { Part } from './parts';

/** Подключение: клетки пыли-выводов (кто питает и кого питаем). */
export interface BoardNet {
  name: string;
  /** Пыль источника (одна клетка). */
  from: XYZ;
  /** Пыль приёмников. */
  to: XYZ[];
}

export interface RouteReport {
  ok: boolean;
  failed?: string;
  routed: number;
  ms: number;
}

/**
 * Плата: воксельная сетка, в которую ставятся готовые блоки (макросы, массивы), после чего недостающие
 * соединения между ними прокладывает маршрутизатор схем (с мостами и повторителями).
 */
export class Board {
  readonly base = new Vox();
  W = 0;
  D = 0;
  readonly H: number;
  private offX = 0;
  private offZ = 0;
  private margin: number;
  readonly nets: BoardNet[] = [];
  private keepOut: { x0: number; z0: number; x1: number; z1: number; y1: number; free: XYZ[] }[] = [];
  g!: Grid;

  /** Размеры платы вычисляются по содержимому при прокладке; H — число уровней по высоте. */
  constructor(H = 9, margin = 12) {
    this.H = H;
    this.margin = margin;
  }

  private fit(): void {
    const b = this.base.bounds();
    let x0 = b.x0;
    let x1 = b.x1;
    let z0 = b.z0;
    let z1 = b.z1;
    for (const k of this.keepOut) {
      x0 = Math.min(x0, k.x0);
      x1 = Math.max(x1, k.x1);
      z0 = Math.min(z0, k.z0);
      z1 = Math.max(z1, k.z1);
    }
    this.offX = this.margin - x0;
    this.offZ = this.margin - z0;
    this.W = x1 - x0 + 1 + 2 * this.margin;
    this.D = z1 - z0 + 1 + 2 * this.margin;
  }

  /** Короткая «ножка» из пыли от вывода наружу: резервирует подход к выводу и служит клеммой для маршрутизатора. */
  private stub(cells: XYZ[]): XYZ {
    for (const c of cells) this.base.set(c[0], c[1], c[2], { kind: K.Dust });
    return cells[cells.length - 1];
  }

  /** Ставит макрос со смещением; возвращает клеммы его выводов (концы ножек) в координатах платы. */
  addMacro(m: Macro, ox: number, oz: number): Map<string, { dust: XYZ; approach: XYZ }> {
    this.base.merge(m.vox, ox, 0, oz);
    const out = new Map<string, { dust: XYZ; approach: XYZ }>();
    const b = m.vox.bounds();
    for (const [name, p] of m.pins) {
      const approach: XYZ = [p.approach[0] + ox, p.approach[1], p.approach[2] + oz];
      // ножка наружу: у входа — к западу, у выхода — к востоку (3 клетки, считая клетку подхода)
      const dx = p.kind === 'in' ? -1 : 1;
      // первая клетка ножки — повторитель (поток слева направо): вход получает полные 15, выход восстанавливает затухание
      this.base.set(approach[0], approach[1], approach[2], { kind: K.Repeater, dir: 3, delay: 1 });
      const end = this.stub([1, 2].map((i) => [approach[0] + dx * i, approach[1], approach[2]] as XYZ));
      out.set(name, { dust: end, approach });
    }
    this.keepOut.push({ x0: b.x0 + ox - 1, z0: b.z0 + oz - 1, x1: b.x1 + ox + 1, z1: b.z1 + oz + 1, y1: b.y1 + 1, free: [] });
    return out;
  }

  /** Деталь, уже поставленная в base (триггер, рычаг…): охранное кольцо и ножки к выводам. */
  addPart(p: Part): Map<string, XYZ> {
    const out = new Map<string, XYZ>();
    for (const [k, pin] of Object.entries(p.pins)) {
      out.set(k, this.stub(pin.free.length ? pin.free.slice(0, 3) : [pin.dust]));
    }
    const b = p.bbox;
    this.keepOut.push({ x0: b.x0 - 1, z0: b.z0 - 1, x1: b.x1 + 1, z1: b.z1 + 1, y1: b.y1, free: [] });
    return out;
  }

  /** Запрет прокладки в окрестности блока (например, массивы). */
  guard(x0: number, z0: number, x1: number, z1: number, y1: number, free: XYZ[] = []): void {
    this.keepOut.push({ x0, z0, x1, z1, y1, free });
  }

  connect(name: string, from: XYZ, to: XYZ[]): void {
    this.nets.push({ name, from, to });
  }

  private idx(p: XYZ): number {
    return this.g.idx(p[0] + this.offX, p[1], p[2] + this.offZ);
  }

  /** Соседи по пыли (правила соединения пыли в игре). */
  private dustNeighbors(i: number): number[] {
    const g = this.g;
    const x = g.x(i);
    const y = g.y(i);
    const z = g.z(i);
    const out: number[] = [];
    const upCond = isConductor(g.kindAt(x, y + 1, z));
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

  private toGrid(): void {
    this.fit();
    const g = new Grid(this.W, this.H, this.D);
    this.base.forEach((x, y, z, c) => {
      // опорные блоки пола (y=0) убираем: маршрутизатор сам ставит опоры под проводами, а общий пол добавляется в конце
      if (y === 0 && c.kind === K.Solid) return;
      const gx = x + this.offX;
      const gz = z + this.offZ;
      if (gx < 0 || gz < 0 || gx >= this.W || gz >= this.D || y < 0 || y >= this.H) throw new Error(`Клетка (${x},${y},${z}) вне платы ${this.W}×${this.H}×${this.D}`);
      const i = g.idx(gx, y, gz);
      g.kind[i] = c.kind;
      g.dir[i] = c.dir ?? 0;
      g.delay[i] = c.delay ?? 1;
      g.mat[i] = c.mat ?? MAT_WIRE;
    });
    // запретные зоны (кольцо вокруг макросов)
    for (const k of this.keepOut) {
      for (let y = 1; y <= Math.min(k.y1, this.H - 1); y++) {
        for (let z = k.z0; z <= k.z1; z++) {
          for (let x = k.x0; x <= k.x1; x++) {
            const gx = x + this.offX;
            const gz = z + this.offZ;
            if (gx < 0 || gz < 0 || gx >= this.W || gz >= this.D) continue;
            const i = g.idx(gx, y, gz);
            if (g.kind[i] === K.Air) g.res[i] |= RES_BLOCKED;
          }
        }
      }
    }
    for (const k of this.keepOut) {
      for (const p of k.free) {
        const gx = p[0] + this.offX;
        const gz = p[2] + this.offZ;
        if (gx < 0 || gz < 0 || gx >= this.W || gz >= this.D) continue;
        const i = g.idx(gx, p[1], gz);
        if (g.kind[i] === K.Air) g.res[i] &= ~RES_BLOCKED;
      }
    }
    this.g = g;
  }

  route(opts: { maxLevel?: number; maxRun?: number; maxExpansions?: number; rounds?: number } = {}): RouteReport {
    const t0 = performance.now();
    let order: number[] | null = null;
    let last: RouteReport = { ok: false, routed: 0, ms: 0 };
    for (let round = 0; round < (opts.rounds ?? 12); round++) {
      const r = this.routeOnce(opts, order);
      last = r.report;
      if (r.report.ok) {
        last.ms = Math.round(performance.now() - t0);
        return last;
      }
      if (r.failedId === undefined || (order && order[0] === r.failedId)) break;
      // упавшую сеть ставим первой и пробуем заново (остальные не мешают ей занять подход)
      order = [r.failedId, ...(r.order ?? []).filter((x) => x !== r.failedId)];
    }
    last.ms = Math.round(performance.now() - t0);
    return last;
  }

  private routeOnce(opts: { maxLevel?: number; maxRun?: number; maxExpansions?: number }, forced: number[] | null): { report: RouteReport; failedId?: number; order?: number[] } {
    const t0 = performance.now();
    this.toGrid();
    const g = this.g;
    const maxLevel = opts.maxLevel ?? this.H - 2;
    // метки сетей: пыль, связанная с выводами сети, получает её номер
    const trees: NetTree[] = [];
    this.nets.forEach((n, id) => {
      const label = (p: XYZ): void => {
        const start = this.idx(p);
        if (g.kind[start] !== K.Dust) throw new Error(`Вывод «${n.name}»: в (${p.join(',')}) нет пыли`);
        const stack = [start];
        g.net[start] = id;
        while (stack.length) {
          const c = stack.pop()!;
          for (const m of this.dustNeighbors(c)) {
            if (g.net[m] !== id) {
              g.net[m] = id;
              stack.push(m);
            }
          }
        }
      };
      label(n.from);
      n.to.forEach(label);
      trees.push(makeTree(id, [this.idx(n.from)], n.to.map((p) => [this.idx(p)])));
    });
    const router = new Router(g, { maxLevel, maxExpansions: opts.maxExpansions ?? 150000 });
    router.reservePins(trees);
    const hp = (t: NetTree): number => {
      const r = t.root[0];
      let s = 0;
      for (const ch of t.sinks) s += Math.abs(g.x(ch[0]) - g.x(r)) + Math.abs(g.z(ch[0]) - g.z(r));
      return s;
    };
    const order = forced ?? [...trees].sort((a, b) => hp(a) - hp(b) || a.id - b.id).map((t) => t.id);
    const byId = new Map(trees.map((t) => [t.id, t]));
    let routed = 0;
    for (const id of order) {
      const t = byId.get(id)!;
      if (!router.routeNet(t)) return { report: { ok: false, failed: `${this.nets[t.id].name}: ${router.lastFail}`, routed, ms: Math.round(performance.now() - t0) }, failedId: id, order };
      routed++;
    }
    for (const t of trees) {
      if (!insertRepeaters(g, t, opts.maxRun ?? 12)) return { report: { ok: false, failed: `повторители в сети ${this.nets[t.id].name}`, routed, ms: Math.round(performance.now() - t0) } };
    }
    return { report: { ok: true, routed, ms: Math.round(performance.now() - t0) } };
  }

  /** Итоговая модель: исходные блоки + проложенные провода. */
  toVox(): Vox {
    const out = new Vox();
    this.base.forEach((x, y, z, c) => out.set(x, y, z, { ...c }));
    const g = this.g;
    for (let i = 0; i < g.kind.length; i++) {
      if (!g.routed[i]) continue;
      const x = g.x(i) - this.offX;
      const y = g.y(i);
      const z = g.z(i) - this.offZ;
      const cell: VCell = { kind: g.kind[i] as K, dir: g.dir[i], delay: g.delay[i] || 1, mat: g.mat[i] };
      out.force(x, y, z, cell);
    }
    // сплошной пол под всем, что стоит на земле
    const b = out.bounds();
    const floor = new Set<string>();
    out.forEach((x, y, z) => {
      if (y === 1) floor.add(`${x},${z}`);
    });
    for (const k of floor) {
      const [x, z] = k.split(',').map(Number);
      if (!out.has(x, 0, z)) out.set(x, 0, z, { kind: K.Solid, mat: MAT_WIRE });
    }
    void b;
    out.tags = this.base.tags;
    return out;
  }
}
