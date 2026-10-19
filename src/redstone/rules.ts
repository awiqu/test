import { Grid, K, DX, DZ, isConductor, isSignalSource, opp } from '../compiler/voxel';

/** 0 = нет, 1 = сбоку, 2 = вверх по стене (как RedstoneSide в игре). */
export type Side = 0 | 1 | 2;

/** RedStoneWireBlock.shouldConnectTo(state, direction). */
function shouldConnectTo(g: Grid, x: number, y: number, z: number, d: number): boolean {
  const k = g.kindAt(x, y, z);
  if (k === K.Dust) return true;
  if (k === K.Repeater) {
    const f = g.dir[g.idx(x, y, z)];
    return f === d || opp(f) === d;
  }
  return isSignalSource(k);
}

/** RedStoneWireBlock.getConnectingSide — «сырое» соединение без достройки линии. */
export function rawConnection(g: Grid, x: number, y: number, z: number, d: number): Side {
  const mx = x + DX[d];
  const mz = z + DZ[d];
  const mk = g.kindAt(mx, y, mz);
  const nonNormalCubeAbove = !isConductor(g.kindAt(x, y + 1, z));
  if (nonNormalCubeAbove && isConductor(mk) && g.kindAt(mx, y + 1, mz) === K.Dust) return 2;
  if (shouldConnectTo(g, mx, y, mz, d)) return 1;
  if (!isConductor(mk) && g.kindAt(mx, y - 1, mz) === K.Dust) return 1;
  return 0;
}

/**
 * Итоговое состояние соединений пыли, как после установки блока в игре
 * (getConnectionState: одиночное соединение достраивается до линии, одиночная точка — до креста).
 */
export function dustShape(g: Grid, x: number, y: number, z: number): [Side, Side, Side, Side] {
  const n = rawConnection(g, x, y, z, 0);
  const e = rawConnection(g, x, y, z, 1);
  const s = rawConnection(g, x, y, z, 2);
  const w = rawConnection(g, x, y, z, 3);
  const nsEmpty = !n && !s;
  const ewEmpty = !e && !w;
  const out: [Side, Side, Side, Side] = [n, e, s, w];
  if (!w && nsEmpty) out[3] = 1;
  if (!e && nsEmpty) out[1] = 1;
  if (!n && ewEmpty) out[0] = 1;
  if (!s && ewEmpty) out[2] = 1;
  return out;
}
