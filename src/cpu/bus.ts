import { K } from '../compiler/voxel';
import { Vox } from './vox';

/**
 * Детерминированная «шинная» разводка вместо поиска пути.
 *
 * Два слоя: горизонтальные участки лежат на земле (y=1), вертикальные магистрали — приподняты (y=3, опоры на y=2),
 * поэтому пересекаются свободно. Для обхода карточек справа налево есть третий слой (y=5, опоры на y=4).
 *
 *   • выводы-приёмники — на западных краях карточек: от левой магистрали идёт «отвод» (повторитель-диод) и прямой участок на восток;
 *   • выводы-источники на западной стороне вливаются в левую магистраль прямым участком на запад;
 *   • источники на восточной стороне вливаются в правую магистраль, та поднимается к «обходу» (y=5), который идёт на запад
 *     над всеми магистралями и опускается в левую магистраль цепи.
 *
 * Каждая цепь получает собственные столбец и (если нужен обход) строку, строки выводов уникальны — пересечений проводов нет по построению.
 */

type XYZ = [number, number, number];

const N = 0, E = 1, S = 2, W = 3;

/** Вывод карточки: клетка пыли на конце ножки (y=1). */
export interface BusPin {
  x: number;
  z: number;
  /** Приёмник с длинной внутренней трассой: прямой участок заканчивается повторителем (на вывод приходит полная сила). */
  boost?: boolean;
}

export interface BusNet {
  name: string;
  src: { kind: 'east' | 'west'; pin: BusPin } | { kind: 'rail'; z: number };
  /** Приёмники (на западных краях карточек). */
  sinks: BusPin[];
  /** Заданный столбец левой магистрали (линии ПЗУ). */
  x?: number;
  /** Для линий, уже идущих сверху (адрес ПЗУ): магистраль должна дотянуться вверх до этой строки. */
  zTop?: number;
  /** Строка обхода (для источников на восточной стороне); без неё берётся из layout.wrapZs. */
  wrapZ?: number;
}

export interface BusLayout {
  /** Столбцы левых магистралей для цепей без заданного x (по порядку). */
  leftXs: number[];
  /** Столбцы правых магистралей (по порядку). */
  rightXs: number[];
  /** Строки обходов (по порядку, шаг ≥ 4). */
  wrapZs: number[];
}

export interface BusStats {
  nets: number;
  wraps: number;
  maxRunBoosters: number;
}

export const RUN_PERIOD = 10;

/**
 * Повторители на приподнятой магистрали: первый — сразу за клеткой origin (там сила сигнала не гарантирована), дальше не реже чем
 * через 11 клеток; только на свободных строках (не на строках отводов).
 */
function trunkBoosters(origin: number, zMin: number, zMax: number, reserved: Set<number>): Map<number, 'S' | 'N'> {
  const out = new Map<number, 'S' | 'N'>();
  for (const dir of ['S', 'N'] as const) {
    const step = dir === 'S' ? 1 : -1;
    const end = dir === 'S' ? zMax : zMin;
    if (Math.abs(end - origin) === 0) continue;
    let prev = origin;
    let first = true;
    while (Math.abs(end - prev) > (first ? 0 : 11)) {
      let z = prev + step * (first ? 1 : 11);
      // если строка занята отводом — сдвигаем к следующей свободной (в сторону конца)
      while (reserved.has(z) && Math.abs(end - z) > 0) z += step;
      if (reserved.has(z) || (dir === 'S' ? z > end : z < end)) break;
      if (Math.abs(end - z) === 0) break; // конечная клетка остаётся пылью
      out.set(z, dir);
      prev = z;
      first = false;
    }
  }
  return out;
}

/** Приподнятая магистраль x, z ∈ [zMin, zMax]; origin — строка, откуда сигнал течёт в обе стороны. */
export function buildTrunk(v: Vox, x: number, zMin: number, zMax: number, origin: number, reserved: Set<number>): void {
  const res = new Set(reserved);
  res.add(origin);
  res.add(zMin);
  res.add(zMax);
  const boosters = trunkBoosters(origin, zMin, zMax, res);
  for (let z = zMin; z <= zMax; z++) {
    v.solid(x, 2, z);
    const b = boosters.get(z);
    // течёт на юг → вход повторителя с севера; течёт на север → вход с юга
    if (b) v.set(x, 3, z, { kind: K.Repeater, dir: b === 'S' ? N : S, delay: 1 });
    else v.set(x, 3, z, { kind: K.Dust });
  }
}

/**
 * Наземный участок вдоль x на строке z от xFrom к xTo (включительно) с повторителями каждые RUN_PERIOD клеток.
 * startRepeater — первая клетка повторитель (вывод-источник даёт слабый сигнал); endRepeater — последняя.
 */
export function buildRun(v: Vox, z: number, xFrom: number, xTo: number, o: { startRepeater?: boolean; endRepeater?: boolean } = {}): number {
  const step = xTo >= xFrom ? 1 : -1;
  const inputSide = step === 1 ? W : E;
  let since = 0;
  let boosters = 0;
  for (let x = xFrom; x !== xTo + step; x += step) {
    const last = x === xTo;
    const first = x === xFrom;
    since++;
    if ((last && o.endRepeater) || (first && o.startRepeater)) {
      v.repeater(x, 1, z, inputSide, 1);
      boosters++;
      since = 0;
    } else if (since >= RUN_PERIOD && !last) {
      v.repeater(x, 1, z, inputSide, 1);
      since = 0;
      boosters++;
    } else v.dust(x, 1, z);
  }
  return boosters;
}

/**
 * Произвольная наземная трасса по клеткам [x, z] в порядке течения сигнала: пыль, на прямых участках — повторители каждые `period` клеток.
 * Первая и последняя клетки остаются пылью (если не заданы стартовый/конечный повторители).
 */
export function groundPath(v: Vox, cells: [number, number][], o: { period?: number; startRepeater?: boolean; endRepeater?: boolean } = {}): void {
  const period = o.period ?? RUN_PERIOD;
  let since = 0;
  for (let i = 0; i < cells.length; i++) {
    const [x, z] = cells[i];
    const prev = cells[i - 1];
    const next = cells[i + 1];
    since++;
    // направление, в котором сигнал входит в клетку
    const din = prev ? [x - prev[0], z - prev[1]] : next ? [next[0] - x, next[1] - z] : [1, 0];
    const dout = next ? [next[0] - x, next[1] - z] : din;
    const straight = din[0] === dout[0] && din[1] === dout[1];
    const inputSide = din[0] === 1 ? W : din[0] === -1 ? E : din[1] === 1 ? N : S;
    const first = i === 0;
    const last = i === cells.length - 1;
    const wantRep = (first && o.startRepeater) || (last && o.endRepeater) || (!first && !last && straight && since >= period);
    if (wantRep && straight) {
      v.repeater(x, 1, z, inputSide, 1);
      since = 0;
    } else v.dust(x, 1, z);
  }
}

/** Отвод с левой магистрали (xT) на строке z: диод на восток. Возвращает x первой клетки прямого участка. */
function tapEast(v: Vox, xT: number, z: number): number {
  v.solid(xT + 1, 1, z);
  v.set(xT + 1, 2, z, { kind: K.Dust });
  v.repeater(xT + 2, 1, z, W, 1);
  return xT + 3;
}

/** Вливание прямого участка, идущего с востока (на запад), в левую магистраль xT. Последняя клетка участка — (xT+2, z). */
function injectFromEast(v: Vox, xT: number, z: number): void {
  v.solid(xT + 1, 1, z);
  v.set(xT + 1, 2, z, { kind: K.Dust });
}

/** Вливание участка, идущего с запада (на восток), в правую магистраль xR. Последняя клетка участка — (xR-2, z). */
function injectFromWest(v: Vox, xR: number, z: number): void {
  v.solid(xR - 1, 1, z);
  v.set(xR - 1, 2, z, { kind: K.Dust });
}

/** Подъём с верхнего конца магистрали (xR, z=zw+2) на слой обхода (y=5) в строке zw. */
function ascend(v: Vox, x: number, zw: number): void {
  v.solid(x, 3, zw + 1);
  v.set(x, 4, zw + 1, { kind: K.Dust });
  v.solid(x, 4, zw);
  v.set(x, 5, zw, { kind: K.Dust });
}

/** Подъём на обход с нижнего конца магистрали, которая идёт сверху: конец (x, zw-2), обход в строке zw. */
function ascendFromAbove(v: Vox, x: number, zw: number): void {
  v.solid(x, 3, zw - 1);
  v.set(x, 4, zw - 1, { kind: K.Dust });
  v.solid(x, 4, zw);
  v.set(x, 5, zw, { kind: K.Dust });
}

/** Спуск с обхода (x, zw) в верхний конец магистрали (x, zw+2). */
const descend = ascend;

/** Обход вдоль x на уровне y=5 от xFrom к xTo (на запад). Углы — клетки подъёма/спуска. */
function buildWrap(v: Vox, zw: number, xFrom: number, xTo: number): void {
  const step = xTo >= xFrom ? 1 : -1;
  const inputSide = step === 1 ? W : E;
  let since = 10; // первый повторитель сразу за углом
  for (let x = xFrom + step; x !== xTo; x += step) {
    since++;
    v.solid(x, 4, zw);
    if (since >= 11) {
      v.set(x, 5, zw, { kind: K.Repeater, dir: inputSide, delay: 1 });
      since = 0;
    } else v.set(x, 5, zw, { kind: K.Dust });
  }
}

export class Bus {
  private nets: BusNet[] = [];
  readonly stats: BusStats = { nets: 0, wraps: 0, maxRunBoosters: 0 };
  constructor(private layout: BusLayout) {}

  add(net: BusNet): void {
    this.nets.push(net);
  }

  /** Число свободных столбцов и строк, которые потребуются (для планировщика). */
  static need(nets: BusNet[]): { left: number; right: number; wraps: number } {
    let left = 0;
    let right = 0;
    for (const n of nets) {
      if (n.x === undefined) left++;
      if (n.src.kind === 'east') right++;
    }
    return { left, right, wraps: right };
  }

  build(v: Vox): void {
    const lay = this.layout;
    let li = 0;
    let ri = 0;
    let wi = 0;
    for (const net of this.nets) {
      v.owner = net.name;
      const left = net.x ?? lay.leftXs[li++];
      if (left === undefined) throw new Error(`Не хватило столбцов левых магистралей (цепь ${net.name})`);
      const sinkZs = net.sinks.map((s) => s.z);
      const reserved = new Set<number>(sinkZs);
      if (net.src.kind === 'rail') {
        const z0 = net.src.z;
        const zMax = Math.max(z0, ...sinkZs);
        if (sinkZs.length) {
          buildTrunk(v, left, z0, zMax, z0, reserved);
          for (const s of net.sinks) this.sink(v, left, s);
        }
      } else if (net.src.kind === 'west') {
        const p = net.src.pin;
        reserved.add(p.z);
        const zMin = Math.min(p.z, ...sinkZs, net.zTop ?? p.z);
        const zMax = Math.max(p.z, ...sinkZs);
        buildTrunk(v, left, zMin, zMax, p.z, reserved);
        this.stats.maxRunBoosters = Math.max(this.stats.maxRunBoosters, buildRun(v, p.z, p.x - 1, left + 2, { startRepeater: true, endRepeater: true }));
        injectFromEast(v, left, p.z);
        for (const s of net.sinks) this.sink(v, left, s);
      } else {
        const p = net.src.pin;
        const right = lay.rightXs[ri++];
        const zw = net.wrapZ ?? lay.wrapZs[wi++];
        if (right === undefined || zw === undefined) throw new Error(`Не хватило столбцов/строк для обхода (цепь ${net.name})`);
        if (p.z < zw) {
          // источник выше строки обхода: магистраль идёт вниз до подъёма
          if (zw - 2 - p.z < 2) throw new Error(`Источник цепи ${net.name} слишком близко к строке обхода`);
          const rRes = new Set<number>([p.z, zw - 2, zw - 1, zw]);
          buildTrunk(v, right, p.z, zw - 2, p.z, rRes);
          buildRun(v, p.z, p.x + 1, right - 2, { startRepeater: true, endRepeater: true });
          injectFromWest(v, right, p.z);
          ascendFromAbove(v, right, zw);
        } else {
          // источник ниже: магистраль идёт вверх до подъёма
          const rRes = new Set<number>([p.z, zw, zw + 1, zw + 2]);
          buildTrunk(v, right, zw + 2, p.z, p.z, rRes);
          buildRun(v, p.z, p.x + 1, right - 2, { startRepeater: true, endRepeater: true });
          injectFromWest(v, right, p.z);
          ascend(v, right, zw);
        }
        // обход на запад и спуск в левую магистраль
        buildWrap(v, zw, right, left);
        descend(v, left, zw);
        // левая магистраль: от спуска вниз до последнего приёмника
        const zMax = Math.max(zw + 2, ...sinkZs);
        const lRes = new Set<number>([...sinkZs, zw, zw + 1, zw + 2]);
        buildTrunk(v, left, zw + 2, zMax, zw + 2, lRes);
        for (const s of net.sinks) this.sink(v, left, s);
        this.stats.wraps++;
      }
      this.stats.nets++;
    }
    v.owner = null;
  }

  private sink(v: Vox, left: number, s: BusPin): void {
    const x0 = tapEast(v, left, s.z);
    if (s.x - 1 < x0) throw new Error(`Приёмник слишком близко к магистрали: x=${s.x}, магистраль ${left}`);
    this.stats.maxRunBoosters = Math.max(this.stats.maxRunBoosters, buildRun(v, s.z, x0, s.x - 1, { endRepeater: s.boost }));
  }
}

export type { XYZ };
