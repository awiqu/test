import { Circuit } from '../model/types';
import { evaluate } from '../sim/logic';
import { RedstoneSim } from '../redstone/sim';
import { dustShape } from '../redstone/rules';
import { Grid, K, DIR_NAMES, MAT_GATE, MAT_WIRE, RES_BLOCKED } from './voxel';
import { Issue, Netlist, techmap } from './techmap';
import { ModuleDef, ModuleOptions, InputDevice, getModule } from './modules';
import { layoutModules, Layout } from './place';
import { NetTree, Router, insertRepeaters, makeTree } from './route';
import { BlockChoice, blockName } from './materials';
import { VariantChoice, defaultVariants } from './variants';

export const MC_DATA_VERSION_26_2 = 4903;

export interface ExportSettings {
  name: string;
  author: string;
  description: string;
  /** Автоматически подбирать минимальные расстояния. */
  autoGap: boolean;
  /** Расстояние между гейтами по X (колонки) и Z (ряды), в блоках, ≥ 1. */
  gapX: number;
  gapZ: number;
  /** Максимальный уровень проводов над полом (для мостов-пересечений). */
  maxLevel: number;
  /** Максимум клеток пыли между усилителями (повторителями), 1..15. */
  maxRun: number;
  wireBlock: BlockChoice;
  gateBlock: BlockChoice;
  inputDevice: InputDevice;
  floorPlate: boolean;
  pruneDead: boolean;
  variants: VariantChoice;
  dataVersion: number;
  verify: boolean;
  /** Все входы слева, а все выходы — в последнем столбце (для макросов процессора). */
  edgePins?: boolean;
}

export function defaultSettings(): ExportSettings {
  return {
    name: 'RedLogic',
    author: 'RedLogic',
    description: 'Логическая схема, собранная в RedLogic',
    autoGap: true,
    gapX: 1,
    gapZ: 1,
    maxLevel: 5,
    maxRun: 15,
    wireBlock: { material: 'stone', color: 'gray' },
    gateBlock: { material: 'concrete', color: 'gray' },
    inputDevice: 'lever',
    floorPlate: false,
    pruneDead: true,
    variants: defaultVariants(),
    dataVersion: MC_DATA_VERSION_26_2,
    verify: true,
  };
}

export interface BlockSpec {
  name: string;
  props?: Record<string, string>;
}

export interface StructBlock {
  x: number;
  y: number;
  z: number;
  kind: K;
  spec: BlockSpec;
}

export interface Marker {
  x: number;
  y: number;
  z: number;
  text: string;
  kind: 'in' | 'out';
}

export interface TileItem {
  slot: number;
  id: string;
  count: number;
}

/** Блок-сущность (контейнер с предметами) в структуре. */
export interface TileEntityData {
  x: number;
  y: number;
  z: number;
  id: string;
  /** Содержимое контейнера (бочки). */
  items?: TileItem[];
  /** Дополнительные целочисленные поля NBT (например, OutputSignal у компаратора). */
  ints?: Record<string, number>;
}

export interface Structure {
  sx: number;
  sy: number;
  sz: number;
  blocks: StructBlock[];
  markers: Marker[];
  tileEntities?: TileEntityData[];
}

export interface CompileStats {
  gapX: number;
  gapZ: number;
  attempts: number;
  dust: number;
  repeaters: number;
  torches: number;
  solid: number;
  levers: number;
  lamps: number;
  total: number;
  ms: number;
}

export interface VerifyResult {
  ok: boolean;
  checked: number;
  total: number;
  message: string;
}

export interface CompileResult {
  ok: boolean;
  issues: Issue[];
  structure?: Structure;
  stats?: CompileStats;
  verify?: VerifyResult;
}

export interface Attempt {
  grid: Grid;
  layout: Layout;
  defs: ModuleDef[];
  trees: NetTree[];
  leverCell: Map<number, number>;
  lampCell: Map<number, number>;
  offX: number;
  offZ: number;
}

const MARGIN = 4;

function stamp(nl: Netlist, defs: ModuleDef[], layout: Layout, settings: ExportSettings): Attempt & { sinkChains: Map<number, number[][]> } {
  const W = layout.width + 2 * MARGIN;
  const D = layout.depth + 2 * MARGIN;
  const H = settings.maxLevel + 2;
  const g = new Grid(W, H, D);
  const leverCell = new Map<number, number>();
  const lampCell = new Map<number, number>();
  const rootChains = new Map<number, number[]>();
  const sinkChains = new Map<number, number[][]>();
  for (const inst of nl.insts) {
    const def = defs[inst.id];
    const { ox, oz } = layout.pos[inst.id];
    const wx = (lx: number): number => MARGIN + ox + (lx - def.box.x0);
    const wz = (lz: number): number => MARGIN + oz + (lz - def.box.z0);
    const slotCells = new Map<number, number[]>();
    const outCells: number[] = [];
    for (const c of def.cells) {
      const x = wx(c.x);
      const y = 1 + c.y;
      const z = wz(c.z);
      const idx = g.idx(x, y, z);
      let net = -1;
      if (c.out) net = inst.out;
      else if (c.slot !== undefined) net = layout.slotNets[inst.id][c.slot];
      g.set(x, y, z, c.kind, { net, dir: c.dir ?? 0, delay: c.delay ?? 1, mat: c.mat ?? MAT_WIRE });
      if (c.out && c.kind === K.Dust) outCells.push(idx);
      if (c.slot !== undefined && c.kind === K.Dust) {
        const arr = slotCells.get(c.slot) ?? [];
        arr.push(idx);
        slotCells.set(c.slot, arr);
      }
      if (c.kind === K.Lever || c.kind === K.Button) leverCell.set(inst.id, idx);
      if (c.kind === K.Lamp) lampCell.set(inst.id, idx);
    }
    for (const b of def.blocked) {
      const i = g.idx(wx(b.x), 1 + b.y, wz(b.z));
      if (g.kind[i] === K.Air) g.res[i] |= RES_BLOCKED;
    }
    if (inst.out >= 0) rootChains.set(inst.out, outCells);
    inst.ins.forEach((_net, slot) => {
      const cells = slotCells.get(slot) ?? [];
      const sink = def.sinks[slot];
      const a = g.idx(wx(sink.x), 1, wz(sink.z));
      const chain = [a, ...cells.filter((c) => c !== a)];
      const list = sinkChains.get(layout.slotNets[inst.id][slot]) ?? [];
      list.push(chain);
      sinkChains.set(layout.slotNets[inst.id][slot], list);
    });
  }
  const trees: NetTree[] = [];
  for (const net of nl.nets) {
    const root = rootChains.get(net.id);
    const sinks = sinkChains.get(net.id) ?? [];
    if (!root || root.length === 0) continue;
    trees.push(makeTree(net.id, root, sinks));
  }
  return { grid: g, layout, defs, trees, leverCell, lampCell, offX: 0, offZ: 0, sinkChains };
}

export function tryLayout(nl: Netlist, settings: ExportSettings, gapX: number, gapZ: number, seed: number): { ok: boolean; attempt?: Attempt; reason?: string; router?: Router; failedTree?: NetTree } {
  const modOpts = (inst: { delay: number }): ModuleOptions => ({ inputDevice: settings.inputDevice, delay: inst.delay });
  const defs = nl.insts.map((inst) => getModule(inst.kind, inst.k, modOpts(inst)));
  const layout = layoutModules(nl, defs, gapX, gapZ, seed, settings.edgePins === true);
  let order: number[] | null = null;
  let lastReason = '';
  let lastFailure: { attempt?: Attempt; router?: Router; failedTree?: NetTree } = {};
  for (let round = 0; round < 8; round++) {
    const att = stamp(nl, defs, layout, settings);
    const g = att.grid;
    const router = new Router(g, { maxLevel: settings.maxLevel, maxExpansions: 50000 });
    const hpwl = (t: NetTree): number => {
      const r = t.root[t.root.length - 1];
      let s = 0;
      for (const ch of t.sinks) s += Math.abs(g.x(ch[0]) - g.x(r)) + Math.abs(g.z(ch[0]) - g.z(r));
      return s;
    };
    if (!order) order = [...att.trees].sort((a, b) => hpwl(a) - hpwl(b) || a.id - b.id).map((t) => t.id);
    const byId = new Map(att.trees.map((t) => [t.id, t]));
    let failed = -1;
    for (const id of order) {
      const t = byId.get(id)!;
      if (t.sinks.length === 0) continue;
      if (!router.routeNet(t)) {
        failed = id;
        lastReason = router.lastFail;
        break;
      }
    }
    if (failed < 0) {
      for (const t of att.trees) {
        if (!insertRepeaters(g, t, settings.maxRun)) return { ok: false, attempt: att, reason: `repeaters net ${t.id}` };
      }
      return { ok: true, attempt: att };
    }
    if (order[0] === failed) return { ok: false, attempt: att, reason: lastReason, router, failedTree: byId.get(failed) };
    lastFailure = { attempt: att, router, failedTree: byId.get(failed) };
    order = [failed, ...order.filter((x) => x !== failed)];
  }
  return { ok: false, reason: lastReason, ...lastFailure };
}

const GAP_SCHEDULE: [number, number][] = [
  [1, 1],
  [1, 2],
  [2, 1],
  [2, 2],
  [3, 2],
  [2, 3],
  [3, 3],
  [4, 3],
  [4, 4],
  [5, 5],
  [6, 6],
  [8, 8],
  [10, 10],
];

function blockSpecFor(
  g: Grid,
  i: number,
  sim: RedstoneSim,
  settings: ExportSettings,
): BlockSpec | null {
  const kind = g.kind[i] as K;
  switch (kind) {
    case K.Air:
      return null;
    case K.Solid:
      return { name: blockName(g.mat[i] === MAT_GATE ? settings.gateBlock : settings.wireBlock) };
    case K.Lamp:
      return { name: 'minecraft:redstone_lamp', props: { lit: sim.lit[i] ? 'true' : 'false' } };
    case K.Dust: {
      const sh = dustShape(g, g.x(i), g.y(i), g.z(i));
      const side = (s: number): string => (s === 0 ? 'none' : s === 2 ? 'up' : 'side');
      return {
        name: 'minecraft:redstone_wire',
        props: { east: side(sh[1]), north: side(sh[0]), power: String(sim.power[i]), south: side(sh[2]), west: side(sh[3]) },
      };
    }
    case K.Torch:
      return { name: 'minecraft:redstone_wall_torch', props: { facing: DIR_NAMES[g.dir[i]], lit: sim.lit[i] ? 'true' : 'false' } };
    case K.Repeater:
      return {
        name: 'minecraft:repeater',
        props: { delay: String(g.delay[i] || 1), facing: DIR_NAMES[g.dir[i]], locked: 'false', powered: sim.lit[i] ? 'true' : 'false' },
      };
    case K.Lever:
      return { name: 'minecraft:lever', props: { face: 'floor', facing: DIR_NAMES[g.dir[i]], powered: 'false' } };
    case K.Button:
      return { name: 'minecraft:stone_button', props: { face: 'floor', facing: DIR_NAMES[g.dir[i]], powered: 'false' } };
    default:
      // Barrel/Comparator используются только в структурах ПЗУ и не попадают в сетку компилятора
      return null;
  }
}

function verifyAttempt(circuit: Circuit, nl: Netlist, att: Attempt): VerifyResult {
  const g = att.grid;
  const sim = new RedstoneSim(g);
  const inGates = [...nl.inputOf.entries()].sort((a, b) => a[1] - b[1]);
  const outGates = [...nl.outputOf.entries()].sort((a, b) => a[1] - b[1]);
  const n = inGates.length;
  const vectors: number[] = [];
  if (n <= 8) for (let m = 0; m < 1 << n; m++) vectors.push(m);
  else {
    vectors.push(0, (1 << n) - 1);
    let s = 12345;
    for (let i = 0; i < 254; i++) {
      s = (Math.imul(s, 1103515245) + 12345) >>> 0;
      vectors.push(s & ((1 << Math.min(n, 30)) - 1));
    }
  }
  const labelOf = (gid: string): string => circuit.gates.find((x) => x.id === gid)?.label || gid;
  let checked = 0;
  for (const m of vectors) {
    const vals = new Map<string, boolean>();
    inGates.forEach(([gid, instId], bit) => {
      const on = ((m >> bit) & 1) === 1;
      vals.set(gid, on);
      sim.setLever(att.leverCell.get(instId)!, on);
    });
    const settled = sim.settle();
    const expected = evaluate(circuit, vals);
    const desc = inGates.map(([gid], bit) => `${labelOf(gid)}=${(m >> bit) & 1}`).join(' ');
    if (!settled) return { ok: false, checked, total: vectors.length, message: `Схема не стабилизировалась при ${desc}` };
    for (const [gid, instId] of outGates) {
      const got = sim.lit[att.lampCell.get(instId)!] === 1;
      const want = expected.out.get(gid) ?? false;
      if (got !== want) {
        return {
          ok: false,
          checked,
          total: vectors.length,
          message: `Несовпадение на «${labelOf(gid)}» при ${desc}: ожидалось ${want ? 1 : 0}, получено ${got ? 1 : 0}`,
        };
      }
    }
    checked++;
  }
  return { ok: true, checked, total: vectors.length, message: `Проверено ${checked} из ${vectors.length} комбинаций входов — совпадает с логической схемой` };
}

export interface CompileHooks {
  onProgress?: (message: string) => void;
}

interface Bounds {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  z0: number;
  z1: number;
}

/** Габариты по непустым клеткам + (опционально) подложка; вызывается один раз на выбранной раскладке. */
function finishGrid(g: Grid, floorPlate: boolean): Bounds {
  let x0 = Infinity,
    y0 = Infinity,
    z0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity,
    z1 = -Infinity;
  for (let i = 0; i < g.kind.length; i++) {
    if (g.kind[i] === K.Air) continue;
    const x = g.x(i);
    const y = g.y(i);
    const z = g.z(i);
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
    z0 = Math.min(z0, z);
    z1 = Math.max(z1, z);
  }
  if (floorPlate) {
    y0 = 0;
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const i = g.idx(x, 0, z);
        if (g.kind[i] === K.Air) {
          g.kind[i] = K.Solid;
          g.mat[i] = MAT_WIRE;
        }
      }
    }
  }
  return { x0, x1, y0, y1, z0, z1 };
}

export function compile(circuit: Circuit, settings: ExportSettings, hooks: CompileHooks = {}): CompileResult {
  const t0 = performance.now();
  const { netlist, issues } = techmap(circuit, settings.variants, { pruneDead: settings.pruneDead });
  if (!netlist) return { ok: false, issues };
  const nl = netlist;

  const schedule: [number, number][] = settings.autoGap ? GAP_SCHEDULE : [[Math.max(1, settings.gapX), Math.max(1, settings.gapZ)]];
  let chosen: { att: Attempt; bounds: Bounds; verify?: VerifyResult; gap: [number, number] } | undefined;
  let lastVerify: VerifyResult | undefined;
  let attempts = 0;
  let routedOnce = false;
  const seedsFor = (idx: number): number[] => (settings.autoGap ? (idx === schedule.length - 1 ? [0, 1, 2] : [0]) : [0, 1, 2, 3]);
  outer: for (let idx = 0; idx < schedule.length; idx++) {
    const [gx, gz] = schedule[idx];
    for (const seed of seedsFor(idx)) {
      attempts++;
      hooks.onProgress?.(`Раскладка ${gx}×${gz}${seed ? ` (вариант ${seed})` : ''}…`);
      const r = tryLayout(nl, settings, gx, gz, seed);
      if (!r.ok || !r.attempt) continue;
      routedOnce = true;
      const bounds = finishGrid(r.attempt.grid, settings.floorPlate);
      let verify: VerifyResult | undefined;
      if (settings.verify) {
        verify = verifyAttempt(circuit, nl, r.attempt);
        if (!verify.ok) {
          lastVerify = verify;
          continue; // раскладка электрически не совпала с логикой — пробуем другую
        }
      }
      chosen = { att: r.attempt, bounds, verify, gap: [gx, gz] };
      break outer;
    }
  }
  if (!chosen) {
    if (routedOnce && lastVerify) {
      issues.push({ level: 'error', message: `Проверка редстоун-схемы не пройдена: ${lastVerify.message}` });
    } else {
      issues.push({
        level: 'error',
        message: settings.autoGap
          ? 'Не удалось проложить провода даже с большими расстояниями. Попробуйте увеличить «макс. высоту» или упростить схему.'
          : 'Не удалось проложить провода при заданных расстояниях — увеличьте расстояния между гейтами или включите автоподбор.',
      });
    }
    return { ok: false, issues, verify: lastVerify };
  }

  const { att, bounds, verify } = chosen;
  const g = att.grid;
  const { x0, x1, y0, y1, z0, z1 } = bounds;

  // итоговое состояние при выключенных входах
  const sim = new RedstoneSim(g);
  sim.settle();
  const blocks: StructBlock[] = [];
  const stats: CompileStats = { gapX: chosen.gap[0], gapZ: chosen.gap[1], attempts, dust: 0, repeaters: 0, torches: 0, solid: 0, levers: 0, lamps: 0, total: 0, ms: 0 };
  for (let y = y0; y <= y1; y++) {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const i = g.idx(x, y, z);
        const spec = blockSpecFor(g, i, sim, settings);
        if (!spec) continue;
        const kind = g.kind[i] as K;
        blocks.push({ x: x - x0, y: y - y0, z: z - z0, kind, spec });
        stats.total++;
        if (kind === K.Dust) stats.dust++;
        else if (kind === K.Repeater) stats.repeaters++;
        else if (kind === K.Torch) stats.torches++;
        else if (kind === K.Solid) stats.solid++;
        else if (kind === K.Lever || kind === K.Button) stats.levers++;
        else if (kind === K.Lamp) stats.lamps++;
      }
    }
  }
  const markers: Marker[] = [];
  const labelOf = (gid: string): string => circuit.gates.find((q) => q.id === gid)?.label || '';
  for (const [gid, instId] of nl.inputOf) {
    const i = att.leverCell.get(instId)!;
    markers.push({ x: g.x(i) - x0, y: g.y(i) - y0, z: g.z(i) - z0, text: labelOf(gid), kind: 'in' });
  }
  for (const [gid, instId] of nl.outputOf) {
    const i = att.lampCell.get(instId)!;
    markers.push({ x: g.x(i) - x0, y: g.y(i) - y0, z: g.z(i) - z0, text: labelOf(gid), kind: 'out' });
  }
  stats.ms = Math.round(performance.now() - t0);
  return {
    ok: true,
    issues,
    structure: { sx: x1 - x0 + 1, sy: y1 - y0 + 1, sz: z1 - z0 + 1, blocks, markers },
    stats,
    verify,
  };
}
