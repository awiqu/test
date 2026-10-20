import { K } from '../compiler/voxel';
import { Macro } from './macro';
import { BusPin, groundPath } from './bus';
import { clockRingPart } from './parts';
import { Vox } from './vox';

type XYZ = [number, number, number];

const N = 0, S = 2, W = 3;

/** Карточка на плате: блок логики, триггер, рычаг… Выводы — клетки пыли на концах ножек, к ним подводит провода шина. */
export interface Card {
  name: string;
  box: { x0: number; x1: number; z0: number; z1: number };
  /** Западные выводы (приёмники, а у триггера — ещё и источник Q). */
  west: Record<string, BusPin>;
  /** Восточные выводы (источники). */
  east: Record<string, BusPin>;
  /** Клетки для проверки (например, Q триггера). */
  probe?: Record<string, XYZ>;
}

/** Ставит скомпилированный блок (макрос) со смещением и достраивает ножки: повторитель у вывода и две клетки пыли наружу. */
export function placeMacro(v: Vox, name: string, m: Macro, ox: number, oz: number): Card {
  v.merge(m.vox, ox, 0, oz);
  const west: Record<string, BusPin> = {};
  const east: Record<string, BusPin> = {};
  for (const [pin, p] of m.pins) {
    const ax = p.approach[0] + ox;
    const ay = p.approach[1];
    const az = p.approach[2] + oz;
    v.set(ax, ay, az, { kind: K.Repeater, dir: W, delay: 1 });
    if (!v.has(ax, ay - 1, az)) v.set(ax, ay - 1, az, { kind: K.Solid, mat: 0 });
    const d = p.kind === 'in' ? -1 : 1;
    for (const i of [1, 2]) v.dust(ax + d * i, ay, az);
    const stub: BusPin = { x: ax + d * 2, z: az };
    if (p.kind === 'in') west[pin] = { ...stub, boost: false };
    else east[pin] = stub;
  }
  return { name, box: { x0: ox - 4, x1: ox + m.size.sx + 3, z0: oz - 2, z1: oz + m.size.sz + 1 }, west, east };
}

/**
 * Триггер «ведущий-ведомый» (два запертых повторителя) со всеми выводами на западной стороне:
 * D (строка z), lkM (z-2), lkS (z+2) — приёмники; Q (z-4) — источник (обходит триггер сверху).
 */
export function ffCard(v: Vox, name: string, x: number, z: number): Card {
  v.dust(x - 1, 1, z); // D
  v.repeater(x, 1, z, W, 1); // M
  v.repeater(x + 1, 1, z, W, 1); // S
  v.dust(x + 2, 1, z); // Q
  v.repeater(x, 1, z - 1, N, 1); // Lm
  v.dust(x, 1, z - 2); // lkM
  v.repeater(x + 1, 1, z + 1, S, 1); // Ls
  v.dust(x + 1, 1, z + 2); // lkS
  const xp = x - 6;
  for (let xx = x - 2; xx >= xp; xx--) v.dust(xx, 1, z); // D → запад
  for (let xx = x - 1; xx >= xp; xx--) v.dust(xx, 1, z - 2); // lkM → запад
  for (let xx = x; xx >= xp; xx--) v.dust(xx, 1, z + 2); // lkS → запад
  // Q: на север, затем над триггером на запад
  const q: [number, number][] = [];
  for (let zz = z - 1; zz >= z - 4; zz--) q.push([x + 2, zz]);
  for (let xx = x + 1; xx >= xp; xx--) q.push([xx, z - 4]);
  groundPath(v, q, { period: 99 });
  return {
    name,
    box: { x0: xp - 1, x1: x + 3, z0: z - 5, z1: z + 3 },
    west: { D: { x: xp, z, boost: true }, lkM: { x: xp, z: z - 2, boost: true }, lkS: { x: xp, z: z + 2, boost: true }, Q: { x: xp, z: z - 4 } },
    east: {},
    probe: { Q: [x + 2, 1, z] },
  };
}

/** Рычаг: пыль-вывод справа от него (источник на восточной стороне). */
export function leverCard(v: Vox, name: string, x: number, z: number, tag?: string): Card & { lever: XYZ } {
  v.lever(x, 1, z, false, tag ?? name);
  v.dust(x + 1, 1, z);
  return { name, box: { x0: x - 1, x1: x + 2, z0: z - 1, z1: z + 1 }, west: {}, east: { out: { x: x + 1, z } }, lever: [x, 1, z] };
}

/** Лампа-индикатор: пыль-вывод слева (приёмник на западной стороне). */
export function lampCard(v: Vox, name: string, x: number, z: number): Card & { lamp: XYZ } {
  v.dust(x - 1, 1, z);
  v.lamp(x, 1, z, name);
  return { name, box: { x0: x - 2, x1: x + 1, z0: z - 1, z1: z + 1 }, west: { in: { x: x - 1, z } }, east: {}, lamp: [x, 1, z] };
}

/** Автоматический тактовый генератор (кольцо повторителей): источник на восточной стороне, рычаг «стоп» рядом. */
export function clockCard(v: Vox, name: string, x: number, z: number, n: number, delay: number): Card & { stop: XYZ; half: number } {
  const part = clockRingPart(v, x, z, n, delay, name);
  const out = part.pins.out.dust;
  return { name, box: { x0: part.bbox.x0 - 1, x1: part.bbox.x1 + 2, z0: part.bbox.z0 - 1, z1: part.bbox.z1 + 1 }, west: {}, east: { out: { x: out[0], z: out[2] } }, stop: part.stop, half: part.half };
}

/**
 * Выводы массива (клеммы на земле сверху или снизу) выводятся фидерами на западный край: вложенные «Г» —
 * чем правее клемма, тем дальше от массива строка фидера, поэтому провода не пересекаются.
 * term — клемма (пыль), rank — порядковый номер клеммы слева направо среди клемм этой стороны.
 */
export function arrayFeeder(v: Vox, term: XYZ, rank: number, side: 'top' | 'bottom', xWest: number, kind: 'sink' | 'source'): BusPin {
  const x = term[0];
  const zT = term[2];
  const r = side === 'top' ? zT - 3 - 3 * rank : zT + 3 + 3 * rank;
  const step = side === 'top' ? -1 : 1;
  const cells: [number, number][] = [];
  // от клеммы наружу до строки фидера, затем на запад до xWest
  for (let zz = zT; zz !== r + step; zz += step) cells.push([x, zz]);
  for (let xx = x - 1; xx >= xWest; xx--) cells.push([xx, r]);
  if (kind === 'sink') cells.reverse();
  groundPath(v, cells, { period: 9 });
  return { x: xWest, z: r, boost: kind === 'sink' };
}

/**
 * Линия задержки: цепочка повторителей по 4 тика редстоуна, всего rt тиков. Нужна, чтобы замки ведущего и ведомого триггеров
 * не открывались одновременно: зазор должен превышать разброс времени прихода замков на разные карточки.
 */
export function delayCard(v: Vox, name: string, x: number, z: number, rt: number): Card {
  let left = Math.max(1, rt);
  let n = 0;
  v.dust(x - 1, 1, z);
  while (left > 0) {
    const d = Math.min(4, left);
    v.repeater(x + n, 1, z, W, d);
    left -= d;
    n++;
  }
  v.dust(x + n, 1, z);
  return { name, box: { x0: x - 2, x1: x + n + 1, z0: z - 1, z1: z + 1 }, west: { in: { x: x - 1, z, boost: false } }, east: { out: { x: x + n, z } } };
}

/** Сколько клеток в ширину занимает линия задержки на rt тиков. */
export function delayCells(rt: number): number {
  return Math.ceil(Math.max(1, rt) / 4);
}
