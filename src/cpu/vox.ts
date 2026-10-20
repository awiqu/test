import { Grid, K, MAT_GATE, MAT_WIRE } from '../compiler/voxel';

/**
 * Разреженная воксельная модель постройки: клетки добавляются по координатам (любым, в том числе отрицательным).
 * Направления: 0=N(-z) 1=E(+x) 2=S(+z) 3=W(-x). У повторителя и компаратора dir — сторона ВХОДА (как blockstate facing),
 * у настенного факела dir — направление «от стены».
 */
export interface VCell {
  kind: K;
  dir?: number;
  delay?: number;
  /** Компаратор в режиме вычитания. */
  sub?: boolean;
  mat?: number;
  /** Бочка: сила сигнала компаратора (0…15) и содержимое слотов (количества). */
  sig?: number;
  items?: number[];
  /** Начальное состояние рычага/кнопки. */
  on?: boolean;
  /** Подпись (метки входов/выходов, отладка). */
  tag?: string;
}

const KIND_NAMES = ['воздух', 'блок', 'пыль', 'факел', 'повторитель', 'рычаг', 'кнопка', 'лампа', 'бочка', 'компаратор'];
const kindName = (k: K): string => KIND_NAMES[k as number] ?? String(k);

export class Vox {
  private m = new Map<string, VCell>();
  tags = new Map<string, [number, number, number]>();

  private key(x: number, y: number, z: number): string {
    return `${x},${y},${z}`;
  }

  get size(): number {
    return this.m.size;
  }

  get(x: number, y: number, z: number): VCell | undefined {
    return this.m.get(this.key(x, y, z));
  }

  has(x: number, y: number, z: number): boolean {
    return this.m.has(this.key(x, y, z));
  }

  /** Ставит клетку; повторная установка на занятое место допустима только для идентичной клетки. */
  set(x: number, y: number, z: number, c: VCell): void {
    const k = this.key(x, y, z);
    const old = this.m.get(k);
    if (old) {
      const same = old.kind === c.kind && (old.dir ?? 0) === (c.dir ?? 0) && (old.delay ?? 1) === (c.delay ?? 1) && !!old.sub === !!c.sub && (old.sig ?? 0) === (c.sig ?? 0);
      if (!same) throw new Error(`Конфликт клеток в (${x},${y},${z}): уже стоит ${kindName(old.kind)}, ставим ${kindName(c.kind)}`);
      return;
    }
    this.m.set(k, c);
  }

  /** Принудительная замена (для осознанных правок после сборки). */
  force(x: number, y: number, z: number, c: VCell): void {
    this.m.set(this.key(x, y, z), c);
  }

  remove(x: number, y: number, z: number): void {
    this.m.delete(this.key(x, y, z));
  }

  solid(x: number, y: number, z: number, mat = MAT_WIRE): void {
    this.set(x, y, z, { kind: K.Solid, mat });
  }
  /** Пыль на опорном блоке (опора ставится под пылью, если там пусто). */
  dust(x: number, y: number, z: number, support = true): void {
    this.set(x, y, z, { kind: K.Dust });
    if (support && !this.has(x, y - 1, z)) this.set(x, y - 1, z, { kind: K.Solid, mat: MAT_WIRE });
  }
  repeater(x: number, y: number, z: number, inputSide: number, delay = 1, support = true): void {
    this.set(x, y, z, { kind: K.Repeater, dir: inputSide, delay });
    if (support && !this.has(x, y - 1, z)) this.set(x, y - 1, z, { kind: K.Solid, mat: MAT_WIRE });
  }
  comparator(x: number, y: number, z: number, inputSide: number, sub: boolean, support = true): void {
    this.set(x, y, z, { kind: K.Comparator, dir: inputSide, sub });
    if (support && !this.has(x, y - 1, z)) this.set(x, y - 1, z, { kind: K.Solid, mat: MAT_WIRE });
  }
  /** Настенный факел в (x,y,z), прикреплён к блоку в направлении `attach`. */
  torch(x: number, y: number, z: number, attach: number): void {
    this.set(x, y, z, { kind: K.Torch, dir: (attach + 2) & 3 });
  }
  lever(x: number, y: number, z: number, on = false, tag?: string): void {
    this.set(x, y, z, { kind: K.Lever, dir: 1, on, tag });
    if (!this.has(x, y - 1, z)) this.set(x, y - 1, z, { kind: K.Solid, mat: MAT_GATE });
  }
  lamp(x: number, y: number, z: number, tag?: string): void {
    this.set(x, y, z, { kind: K.Lamp, mat: MAT_GATE, tag });
  }
  barrel(x: number, y: number, z: number, sig: number, items: number[]): void {
    this.set(x, y, z, { kind: K.Barrel, sig, items });
  }

  forEach(fn: (x: number, y: number, z: number, c: VCell) => void): void {
    for (const [k, c] of this.m) {
      const [x, y, z] = k.split(',').map(Number);
      fn(x, y, z, c);
    }
  }

  bounds(): { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number } {
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    this.forEach((x, y, z) => {
      x0 = Math.min(x0, x); x1 = Math.max(x1, x);
      y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      z0 = Math.min(z0, z); z1 = Math.max(z1, z);
    });
    return { x0, x1, y0, y1, z0, z1 };
  }

  /** Копирует чужую модель со смещением. */
  merge(other: Vox, dx: number, dy: number, dz: number): void {
    other.forEach((x, y, z, c) => this.set(x + dx, y + dy, z + dz, { ...c }));
  }
}

/** Плотная сетка для симулятора (с запасом в 2 клетки по краям). */
export function toGrid(v: Vox, pad = 2): { grid: Grid; ox: number; oy: number; oz: number; sub: Uint8Array; sig: Uint8Array } {
  const b = v.bounds();
  const ox = pad - b.x0;
  const oy = pad - b.y0;
  const oz = pad - b.z0;
  const g = new Grid(b.x1 - b.x0 + 1 + 2 * pad, b.y1 - b.y0 + 1 + 2 * pad, b.z1 - b.z0 + 1 + 2 * pad);
  const sub = new Uint8Array(g.kind.length);
  const sig = new Uint8Array(g.kind.length);
  v.forEach((x, y, z, c) => {
    const i = g.idx(x + ox, y + oy, z + oz);
    g.kind[i] = c.kind;
    g.dir[i] = c.dir ?? 0;
    g.delay[i] = c.delay ?? 1;
    g.mat[i] = c.mat ?? MAT_WIRE;
    if (c.sub) sub[i] = 1;
    if (c.sig) sig[i] = c.sig;
  });
  return { grid: g, ox, oy, oz, sub, sig };
}
