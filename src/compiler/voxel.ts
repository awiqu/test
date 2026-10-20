/** Вид блока в воксельной сетке компилятора. */
export const enum K {
  Air = 0,
  Solid = 1,
  Dust = 2,
  Torch = 3, // настенный факел, dir = facing
  Repeater = 4, // dir = facing (сторона входа)
  Lever = 5, // напольный рычаг
  Button = 6, // напольная кнопка
  Lamp = 7,
  /** Только для структур ПЗУ (не участвует в маршрутизации/симуляции схем). */
  Barrel = 8,
  Comparator = 9,
}

/** Горизонтальные направления: 0=N(-z) 1=E(+x) 2=S(+z) 3=W(-x). */
export const DX = [0, 1, 0, -1];
export const DZ = [-1, 0, 1, 0];
export const DIR_NAMES = ['north', 'east', 'south', 'west'];
export const opp = (d: number): number => (d + 2) & 3;

/** Флаги резервирования клеток. */
export const RES_BLOCKED = 1; // ничего не ставить (охранная зона модулей)
export const RES_NOSOLID = 2; // должна оставаться непроводящей (воздух)

/** Материал твёрдого блока. */
export const MAT_WIRE = 0;
export const MAT_GATE = 1;

export class Grid {
  readonly W: number;
  readonly H: number;
  readonly D: number;
  kind: Uint8Array;
  net: Int32Array;
  dir: Uint8Array;
  delay: Uint8Array;
  mat: Uint8Array;
  res: Uint8Array;
  /** Клетка создана маршрутизатором (а не модулем). */
  routed: Uint8Array;

  constructor(W: number, H: number, D: number) {
    this.W = W;
    this.H = H;
    this.D = D;
    const n = W * H * D;
    this.kind = new Uint8Array(n);
    this.net = new Int32Array(n).fill(-1);
    this.dir = new Uint8Array(n);
    this.delay = new Uint8Array(n);
    this.mat = new Uint8Array(n);
    this.res = new Uint8Array(n);
    this.routed = new Uint8Array(n);
  }

  idx(x: number, y: number, z: number): number {
    return (y * this.D + z) * this.W + x;
  }

  inb(x: number, y: number, z: number): boolean {
    return x >= 0 && y >= 0 && z >= 0 && x < this.W && y < this.H && z < this.D;
  }

  x(i: number): number {
    return i % this.W;
  }
  z(i: number): number {
    return Math.floor(i / this.W) % this.D;
  }
  y(i: number): number {
    return Math.floor(i / (this.W * this.D));
  }

  kindAt(x: number, y: number, z: number): K {
    return this.inb(x, y, z) ? (this.kind[this.idx(x, y, z)] as K) : K.Air;
  }

  set(x: number, y: number, z: number, kind: K, extra: { net?: number; dir?: number; delay?: number; mat?: number } = {}): void {
    const i = this.idx(x, y, z);
    this.kind[i] = kind;
    if (extra.net !== undefined) this.net[i] = extra.net;
    if (extra.dir !== undefined) this.dir[i] = extra.dir;
    if (extra.delay !== undefined) this.delay[i] = extra.delay;
    if (extra.mat !== undefined) this.mat[i] = extra.mat;
  }
}

export function isConductor(k: K): boolean {
  return k === K.Solid || k === K.Lamp;
}

/** Источник сигнала, к которому пыль «присоединяется» сбоку. */
export function isSignalSource(k: K): boolean {
  return k === K.Torch || k === K.Lever || k === K.Button || k === K.Comparator;
}
