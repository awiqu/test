import { K, MAT_GATE, MAT_WIRE } from './voxel';

/**
 * Физические модули (3D-шаблоны) примитивов. Все модули развёрнуты «слева направо»:
 * входы с запада (W) и с севера/юга (N/S), выход на восток.
 * Локальные координаты: x — на восток, z — на юг, y: 0 = уровень пыли, -1 = пол.
 */
export type SlotName = 'W' | 'N' | 'S';

export interface ModCell {
  x: number;
  y: number;
  z: number;
  kind: K;
  dir?: number;
  delay?: number;
  mat?: number;
  /** Пыль, принадлежащая сети, которая приходит в слот с таким индексом. */
  slot?: number;
  /** Пыль выходной сети модуля. */
  out?: boolean;
}

export interface ModuleDef {
  name: string;
  cells: ModCell[];
  /** Клетки, которые должны оставаться пустыми (рядом с блоком/факелом/рычагом/лампой). */
  blocked: { x: number; y: number; z: number }[];
  /** Габарит модуля в плане (включительно) — по клеткам модуля и блокировкам. */
  box: { x0: number; x1: number; z0: number; z1: number };
  /** Клетка приёмника (пыль A) для каждого слота. */
  sinks: { x: number; z: number }[];
  /** Клетка, с которой стартует выходной провод. */
  src?: { x: number; z: number };
}

export type ModuleKind = 'IN' | 'OUT' | 'NOT' | 'NOR' | 'MERGE' | 'REP';

export type InputDevice = 'lever' | 'button';

export interface ModuleOptions {
  inputDevice: InputDevice;
  delay?: number;
}

/** Порядок слотов в зависимости от числа входов. */
export function slotsFor(k: number): SlotName[] {
  if (k <= 1) return ['W'];
  if (k === 2) return ['N', 'S'];
  return ['W', 'N', 'S'];
}

const SLOT_DIR: Record<SlotName, { dx: number; dz: number }> = {
  W: { dx: -1, dz: 0 },
  N: { dx: 0, dz: -1 },
  S: { dx: 0, dz: 1 },
};

function finish(name: string, cells: ModCell[], blocked: { x: number; y: number; z: number }[], sinks: { x: number; z: number }[], src?: { x: number; z: number }): ModuleDef {
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const c of [...cells, ...blocked]) {
    x0 = Math.min(x0, c.x);
    x1 = Math.max(x1, c.x);
    z0 = Math.min(z0, c.z);
    z1 = Math.max(z1, c.z);
  }
  return { name, cells, blocked, box: { x0, x1, z0, z1 }, sinks, src };
}

function floor(x: number, z: number, mat = MAT_WIRE): ModCell {
  return { x, y: -1, z, kind: K.Solid, mat };
}

/** Торчовый NOR (NOT при одном входе): вход → блок → факел на дальней стороне блока. */
function norModule(k: number): ModuleDef {
  const slots = slotsFor(k);
  const cells: ModCell[] = [];
  cells.push({ x: 0, y: 0, z: 0, kind: K.Solid, mat: MAT_GATE });
  cells.push({ x: 1, y: 0, z: 0, kind: K.Torch, dir: 1 });
  cells.push({ x: 2, y: 0, z: 0, kind: K.Dust, out: true });
  cells.push(floor(2, 0));
  const sinks: { x: number; z: number }[] = [];
  slots.forEach((s, i) => {
    const d = SLOT_DIR[s];
    cells.push({ x: d.dx, y: 0, z: d.dz, kind: K.Dust, slot: i });
    cells.push({ x: 2 * d.dx, y: 0, z: 2 * d.dz, kind: K.Dust, slot: i });
    cells.push(floor(d.dx, d.dz));
    cells.push(floor(2 * d.dx, 2 * d.dz));
    sinks.push({ x: 2 * d.dx, z: 2 * d.dz });
  });
  // рядом с факелом (по бокам и сверху) и у неиспользуемых сторон блока пыли быть не должно
  const blocked = [
    { x: 1, y: 0, z: -1 },
    { x: 1, y: 0, z: 1 },
    { x: 1, y: 1, z: 0 },
  ];
  for (const s of ['W', 'N', 'S'] as SlotName[]) {
    if (!slots.includes(s)) blocked.push({ x: SLOT_DIR[s].dx, y: 0, z: SLOT_DIR[s].dz });
  }
  return finish(k === 1 ? 'NOT' : `NOR${k}`, cells, blocked, sinks, { x: 2, z: 0 });
}

/** Диодное ИЛИ: каждый вход через повторитель (развязка), выходы сходятся на общей пыли. */
function mergeModule(k: number): ModuleDef {
  const slots = slotsFor(k);
  const cells: ModCell[] = [];
  cells.push({ x: 0, y: 0, z: 0, kind: K.Dust, out: true });
  cells.push(floor(0, 0));
  cells.push({ x: 1, y: 0, z: 0, kind: K.Dust, out: true });
  cells.push(floor(1, 0));
  const facing: Record<SlotName, number> = { N: 0, S: 2, W: 3 };
  const sinks: { x: number; z: number }[] = [];
  slots.forEach((s, i) => {
    const d = SLOT_DIR[s];
    cells.push({ x: d.dx, y: 0, z: d.dz, kind: K.Repeater, dir: facing[s], delay: 1 });
    cells.push(floor(d.dx, d.dz));
    cells.push({ x: 2 * d.dx, y: 0, z: 2 * d.dz, kind: K.Dust, slot: i });
    cells.push(floor(2 * d.dx, 2 * d.dz));
    sinks.push({ x: 2 * d.dx, z: 2 * d.dz });
  });
  const blocked: { x: number; y: number; z: number }[] = [];
  for (const s of ['W', 'N', 'S'] as SlotName[]) {
    if (!slots.includes(s)) blocked.push({ x: SLOT_DIR[s].dx, y: 0, z: SLOT_DIR[s].dz });
  }
  return finish(`MERGE${k}`, cells, blocked, sinks, { x: 1, z: 0 });
}

function repModule(delay: number): ModuleDef {
  const cells: ModCell[] = [
    { x: 0, y: 0, z: 0, kind: K.Repeater, dir: 3, delay },
    floor(0, 0),
    { x: -1, y: 0, z: 0, kind: K.Dust, slot: 0 },
    floor(-1, 0),
    { x: 1, y: 0, z: 0, kind: K.Dust, out: true },
    floor(1, 0),
  ];
  return finish('REP', cells, [], [{ x: -1, z: 0 }], { x: 1, z: 0 });
}

function inModule(device: InputDevice): ModuleDef {
  const cells: ModCell[] = [
    floor(0, 0, MAT_GATE),
    { x: 0, y: 0, z: 0, kind: device === 'button' ? K.Button : K.Lever, dir: 1 },
    { x: 1, y: 0, z: 0, kind: K.Dust, out: true },
    floor(1, 0),
  ];
  return finish('IN', cells, [{ x: -1, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }, { x: 0, y: 0, z: 1 }], [], { x: 1, z: 0 });
}

function outModule(): ModuleDef {
  const cells: ModCell[] = [
    { x: 0, y: 0, z: 0, kind: K.Lamp, mat: MAT_GATE },
    { x: -1, y: 0, z: 0, kind: K.Dust, slot: 0 },
    { x: -2, y: 0, z: 0, kind: K.Dust, slot: 0 },
    floor(-1, 0),
    floor(-2, 0),
  ];
  return finish('OUT', cells, [{ x: 0, y: 0, z: -1 }, { x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }], [{ x: -2, z: 0 }]);
}

const cache = new Map<string, ModuleDef>();

export function getModule(kind: ModuleKind, k: number, opts: ModuleOptions): ModuleDef {
  const key = `${kind}:${k}:${opts.inputDevice}:${opts.delay ?? 1}`;
  let m = cache.get(key);
  if (!m) {
    switch (kind) {
      case 'NOT':
        m = norModule(1);
        break;
      case 'NOR':
        m = norModule(k);
        break;
      case 'MERGE':
        m = mergeModule(k);
        break;
      case 'REP':
        m = repModule(opts.delay ?? 1);
        break;
      case 'IN':
        m = inModule(opts.inputDevice);
        break;
      case 'OUT':
        m = outModule();
        break;
    }
    cache.set(key, m);
  }
  return m;
}

/** Максимум входов у одного физического модуля. */
export const MAX_MODULE_INPUTS = 3;
