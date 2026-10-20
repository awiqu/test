import { K } from '../compiler/voxel';
import { rawConnection } from '../redstone/rules';
import { Vox, toGrid } from './vox';

export interface Short {
  /** Цепи, провода которых электрически соединены. */
  nets: string[];
  /** Одна из клеток соединения (координаты платы). */
  at: [number, number, number];
}

/**
 * Ищет короткие замыкания между цепями шины: связные куски пыли/повторителей (по правилам соединения пыли игры), в которых
 * встречаются провода двух разных цепей. Каждую клетку, поставленную шиной, Vox помечает именем цепи (Vox.ownerOf).
 */
export function findShorts(v: Vox, withCards = false): Short[] {
  const { grid: g, ox, oy, oz } = toGrid(v);
  const parent = new Map<number, number>();
  const find = (a: number): number => {
    let r = a;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let c = a;
    while (parent.get(c) !== r) {
      const n = parent.get(c)!;
      parent.set(c, r);
      c = n;
    }
    return r;
  };
  const node = (n: number): number => {
    if (!parent.has(n)) parent.set(n, n);
    return n;
  };
  const union = (a: number, b: number): void => {
    const ra = find(node(a));
    const rb = find(node(b));
    if (ra !== rb) parent.set(ra, rb);
  };
  const DX = [0, 1, 0, -1];
  const DZ = [-1, 0, 1, 0];
  // Пыль — один узел на клетку; у повторителя два узла (сторона входа и сторона выхода): сигнал через него идёт намеренно,
  // но чужой провод, коснувшийся любой из его сторон, — замыкание.
  const cells: [number, number, number][] = [];
  v.forEach((x, y, z, c) => {
    if (c.kind === K.Dust || c.kind === K.Repeater) cells.push([x, y, z]);
  });
  for (const [x, y, z] of cells) {
    const c = v.get(x, y, z)!;
    const gx = x + ox, gy = y + oy, gz = z + oz;
    const here = g.idx(gx, gy, gz);
    if (c.kind === K.Repeater) {
      node(here * 2);
      node(here * 2 + 1);
      continue;
    }
    node(here * 2);
    for (let d = 0; d < 4; d++) {
      const s = rawConnection(g, gx, gy, gz, d);
      if (s === 0) continue;
      const mx = gx + DX[d];
      const mz = gz + DZ[d];
      const cands = s === 2 ? [g.idx(mx, gy + 1, mz)] : [g.idx(mx, gy, mz), g.idx(mx, gy - 1, mz)];
      for (const ci of cands) {
        const k = g.kind[ci];
        if (k === K.Dust) union(here * 2, ci * 2);
        else if (k === K.Repeater) {
          // клетка с пылью лежит со стороны входа повторителя, если её направление «от повторителя» совпадает с его dir
          const onInput = ((d + 2) & 3) === g.dir[ci];
          union(here * 2, ci * 2 + (onInput ? 0 : 1));
        }
      }
    }
  }
  // владельцы цепей по компонентам
  const owners = new Map<number, Map<string, [number, number, number]>>();
  for (const [x, y, z] of cells) {
    const o = v.ownerOf(x, y, z) ?? (withCards ? '(карточка)' : undefined);
    if (!o) continue;
    const i = g.idx(x + ox, y + oy, z + oz);
    // у повторителя владелец записан в оба узла
    for (const n of v.get(x, y, z)!.kind === K.Repeater ? [i * 2, i * 2 + 1] : [i * 2]) {
      const r = find(n);
      let m = owners.get(r);
      if (!m) owners.set(r, (m = new Map()));
      if (!m.has(o)) m.set(o, [x, y, z]);
    }
  }
  const out: Short[] = [];
  for (const m of owners.values()) if (m.size > 1) out.push({ nets: [...m.keys()], at: [...m.values()][0] });
  return out;
}
