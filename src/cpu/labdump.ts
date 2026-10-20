import { DIR_NAMES, K, MAT_GATE } from '../compiler/voxel';
import { Vox } from './vox';
import { ContainerKind, containerDef, itemsForSignal } from './export';

/** Блоки для настоящего сервера (скрипты scripts/mc_*.py): [x, y, z, состояние в формате setblock]. */
export function voxToLab(vox: Vox, container: ContainerKind = 'barrel', item = 'minecraft:wooden_pickaxe'): [number, number, number, string][] {
  const out: [number, number, number, string][] = [];
  const cont = containerDef(container);
  const props = (p: Record<string, string>): string => '[' + Object.entries(p).map(([k, v]) => `${k}=${v}`).join(',') + ']';
  vox.forEach((x, y, z, c) => {
    const f = DIR_NAMES[c.dir ?? 0];
    let s: string | null = null;
    switch (c.kind) {
      case K.Solid:
        s = c.mat === MAT_GATE ? 'minecraft:smooth_stone' : 'minecraft:stone';
        break;
      case K.Dust:
        s = 'minecraft:redstone_wire';
        break;
      case K.Torch:
        s = `minecraft:redstone_wall_torch${props({ facing: f })}`;
        break;
      case K.Repeater:
        s = `minecraft:repeater${props({ facing: f, delay: String(c.delay ?? 1) })}`;
        break;
      case K.Comparator:
        s = `minecraft:comparator${props({ facing: f, mode: c.sub ? 'subtract' : 'compare' })}`;
        break;
      case K.Lever:
        s = `minecraft:lever${props({ face: 'floor', facing: f, powered: c.on ? 'true' : 'false' })}`;
        break;
      case K.Button:
        s = `minecraft:stone_button${props({ face: 'floor', facing: f })}`;
        break;
      case K.Lamp:
        s = 'minecraft:redstone_lamp';
        break;
      case K.Barrel: {
        const n = itemsForSignal(c.sig ?? 0, cont.slots);
        const items = Array.from({ length: n }, (_, i) => `{Slot:${i}b,id:"${item}",count:1}`).join(',');
        s = `${cont.block}${props(cont.props)}{Items:[${items}]}`;
        break;
      }
      default:
        break;
    }
    if (s) out.push([x, y, z, s]);
  });
  return out;
}
