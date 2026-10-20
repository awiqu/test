import { DIR_NAMES, K, MAT_GATE } from '../compiler/voxel';
import { BlockChoice, blockName } from '../compiler/materials';
import { BlockSpec, StructBlock, Structure, TileEntityData, TileItem } from '../compiler/compile';
import { dustShape } from '../redstone/rules';
import { TickSim } from './tick';
import { Vox } from './vox';

/** Контейнеры, из которых компаратор читает «значение бита» ПЗУ. */
export type ContainerKind = 'barrel' | 'chest' | 'hopper' | 'dropper' | 'dispenser';

export interface ContainerDef {
  id: ContainerKind;
  name: string;
  desc: string;
  block: string;
  props: Record<string, string>;
  /** Число слотов: столько нестакающихся предметов дают сигнал 15. */
  slots: number;
}

export const CONTAINERS: ContainerDef[] = [
  { id: 'barrel', name: 'Бочка', desc: '27 слотов → 27 предметов на единицу. Классика, не открывается случайно.', block: 'minecraft:barrel', props: { facing: 'up', open: 'false' }, slots: 27 },
  { id: 'chest', name: 'Сундук', desc: '27 слотов, как бочка; рядом нельзя ставить второй сундук (слипнутся).', block: 'minecraft:chest', props: { facing: 'north', type: 'single', waterlogged: 'false' }, slots: 27 },
  { id: 'hopper', name: 'Воронка', desc: 'Всего 5 слотов → 5 предметов на единицу: ПЗУ в разы легче по предметам.', block: 'minecraft:hopper', props: { enabled: 'true', facing: 'down' }, slots: 5 },
  { id: 'dropper', name: 'Выбрасыватель', desc: '9 слотов → 9 предметов на единицу.', block: 'minecraft:dropper', props: { facing: 'up', triggered: 'false' }, slots: 9 },
  { id: 'dispenser', name: 'Раздатчик', desc: '9 слотов → 9 предметов на единицу.', block: 'minecraft:dispenser', props: { facing: 'up', triggered: 'false' }, slots: 9 },
];

export const DEFAULT_ROM_ITEM = 'minecraft:wooden_pickaxe';

export interface VoxExportOptions {
  wireBlock: BlockChoice;
  gateBlock: BlockChoice;
  container: ContainerKind;
  /** Нестакающийся предмет-заполнитель. */
  item: string;
  /** Блок для ламп. */
  lampBlock?: string;
}

export function containerDef(kind: ContainerKind): ContainerDef {
  return CONTAINERS.find((c) => c.id === kind) ?? CONTAINERS[0];
}

/** Сколько нестакающихся предметов нужно контейнеру, чтобы компаратор показал сигнал `sig` (формула игры). */
export function itemsForSignal(sig: number, slots: number): number {
  if (sig <= 0) return 0;
  if (sig === 1) return 1;
  const n = Math.ceil(((sig - 1) * slots) / 14);
  if (Math.floor((14 * n) / slots) + 1 !== sig) throw new Error(`Нельзя получить сигнал ${sig} в контейнере на ${slots} слотов`);
  return n;
}

/**
 * Воксельная модель → структура для .litematic в «устоявшемся» состоянии (все рычаги выключены):
 * состояния пыли, повторителей, факелов и компараторов берутся из покадрового симулятора.
 */
export function voxToStructure(vox: Vox, o: VoxExportOptions): Structure {
  const sim = new TickSim(vox);
  sim.settle(5000);
  const g = sim.g;
  const b = vox.bounds();
  const sx = b.x1 - b.x0 + 1;
  const sy = b.y1 - b.y0 + 1;
  const sz = b.z1 - b.z0 + 1;
  const wire = blockName(o.wireBlock);
  const gate = blockName(o.gateBlock);
  const cont = containerDef(o.container);
  const blocks: StructBlock[] = [];
  const tiles: TileEntityData[] = [];
  vox.forEach((x, y, z, c) => {
    const gx = x + sim.ox;
    const gy = y + sim.oy;
    const gz = z + sim.oz;
    const i = g.idx(gx, gy, gz);
    const X = x - b.x0;
    const Y = y - b.y0;
    const Z = z - b.z0;
    const put = (kind: K, spec: BlockSpec): void => void blocks.push({ x: X, y: Y, z: Z, kind, spec });
    switch (c.kind) {
      case K.Solid:
        put(K.Solid, { name: c.mat === MAT_GATE ? gate : wire });
        break;
      case K.Dust: {
        const sh = dustShape(g, gx, gy, gz);
        const side = (s: number): string => (s === 0 ? 'none' : s === 2 ? 'up' : 'side');
        put(K.Dust, { name: 'minecraft:redstone_wire', props: { east: side(sh[1]), north: side(sh[0]), power: String(sim.power[i]), south: side(sh[2]), west: side(sh[3]) } });
        break;
      }
      case K.Torch:
        put(K.Torch, { name: 'minecraft:redstone_wall_torch', props: { facing: DIR_NAMES[c.dir ?? 0], lit: sim.lit[i] ? 'true' : 'false' } });
        break;
      case K.Repeater:
        put(K.Repeater, { name: 'minecraft:repeater', props: { delay: String(c.delay ?? 1), facing: DIR_NAMES[c.dir ?? 0], locked: sim.locked[i] ? 'true' : 'false', powered: sim.lit[i] ? 'true' : 'false' } });
        break;
      case K.Comparator: {
        put(K.Comparator, { name: 'minecraft:comparator', props: { facing: DIR_NAMES[c.dir ?? 0], mode: c.sub ? 'subtract' : 'compare', powered: sim.out[i] > 0 ? 'true' : 'false' } });
        tiles.push({ x: X, y: Y, z: Z, id: 'minecraft:comparator', ints: { OutputSignal: sim.out[i] } });
        break;
      }
      case K.Lever:
        put(K.Lever, { name: 'minecraft:lever', props: { face: 'floor', facing: DIR_NAMES[c.dir ?? 0], powered: sim.lit[i] ? 'true' : 'false' } });
        break;
      case K.Button:
        put(K.Button, { name: 'minecraft:stone_button', props: { face: 'floor', facing: DIR_NAMES[c.dir ?? 0], powered: sim.lit[i] ? 'true' : 'false' } });
        break;
      case K.Lamp:
        put(K.Lamp, { name: o.lampBlock ?? 'minecraft:redstone_lamp', props: { lit: sim.lit[i] ? 'true' : 'false' } });
        break;
      case K.Barrel: {
        put(K.Barrel, { name: cont.block, props: { ...cont.props } });
        const n = itemsForSignal(c.sig ?? 0, cont.slots);
        const items: TileItem[] = Array.from({ length: n }, (_, slot) => ({ slot, id: o.item, count: 1 }));
        tiles.push({ x: X, y: Y, z: Z, id: cont.block, items });
        break;
      }
      default:
        break;
    }
  });
  const markers: Structure['markers'] = [];
  for (const [tag, p] of vox.tags) markers.push({ x: p[0] - b.x0, y: p[1] - b.y0, z: p[2] - b.z0, text: tag, kind: 'in' });
  return { sx, sy, sz, blocks, markers, tileEntities: tiles };
}
