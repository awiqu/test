import { K } from '../compiler/voxel';
import { Vox } from './vox';
import { XYZ } from './arrays';

const N = 0, S = 2, W = 3;

/** Вывод детали: клетка пыли и клетки коридора снаружи, которые должны остаться свободными для провода. */
export interface PartPin {
  dust: XYZ;
  free: XYZ[];
}

export interface Part {
  name: string;
  pins: Record<string, PartPin>;
  bbox: { x0: number; z0: number; x1: number; z1: number; y1: number };
}

/**
 * D-триггер «ведущий-ведомый» на двух заблокированных повторителях (проверено на сервере).
 *   D (запад) → M → S → Q (восток); замок ведущего Lm — с севера (lkM), замок ведомого Ls — с юга (lkS).
 * Ведущий прозрачен, пока lkM=0, ведомый — пока lkS=0; запись по фронту, когда lkM поднимается, а lkS опускается.
 */
export function ffPart(v: Vox, x: number, z: number, name = 'ff'): Part {
  v.dust(x - 1, 1, z); // D
  v.repeater(x, 1, z, W, 1); // M
  v.repeater(x + 1, 1, z, W, 1); // S
  v.dust(x + 2, 1, z); // Q
  v.repeater(x, 1, z - 1, N, 1); // Lm: вход с севера, бьёт в северный бок M
  v.dust(x, 1, z - 2); // lkM
  v.repeater(x + 1, 1, z + 1, S, 1); // Ls: вход с юга, бьёт в южный бок S
  v.dust(x + 1, 1, z + 2); // lkS
  return {
    name,
    pins: {
      D: { dust: [x - 1, 1, z], free: [[x - 2, 1, z], [x - 3, 1, z]] },
      Q: { dust: [x + 2, 1, z], free: [[x + 3, 1, z], [x + 4, 1, z]] },
      lkM: { dust: [x, 1, z - 2], free: [[x, 1, z - 3], [x, 1, z - 4]] },
      lkS: { dust: [x + 1, 1, z + 2], free: [[x + 1, 1, z + 3], [x + 1, 1, z + 4]] },
    },
    bbox: { x0: x - 1, z0: z - 2, x1: x + 2, z1: z + 2, y1: 2 },
  };
}

export function leverPart(v: Vox, x: number, z: number, name: string, tag?: string): Part {
  // рычаг на блоке, пыль справа от него — вывод
  v.lever(x, 1, z, false, tag ?? name);
  v.dust(x + 1, 1, z);
  return {
    name,
    pins: { out: { dust: [x + 1, 1, z], free: [[x + 2, 1, z], [x + 3, 1, z]] } },
    bbox: { x0: x, z0: z, x1: x + 1, z1: z, y1: 2 },
  };
}

export { K };

/** Лампа с пылью слева: вывод in — пыль, питающая лампу. */
export function lampPart(v: Vox, x: number, z: number, name: string, tag?: string): Part {
  v.dust(x - 1, 1, z);
  v.lamp(x, 1, z, tag ?? name);
  return {
    name,
    pins: { in: { dust: [x - 1, 1, z], free: [[x - 2, 1, z], [x - 3, 1, z]] } },
    bbox: { x0: x - 1, z0: z, x1: x, z1: z, y1: 2 },
  };
}
