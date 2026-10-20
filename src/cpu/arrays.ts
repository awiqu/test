import { K, MAT_GATE } from '../compiler/voxel';
import { Vox } from './vox';

const N = 0, E = 1, S = 2, W = 3;

/** Координаты клетки. */
export type XYZ = [number, number, number];

export interface RomOptions {
  /** Бит адреса ПЗУ (число линий адреса = 2P: прямая и инверсная на каждый бит). */
  P: number;
  rows: number;
  cols: number;
  bit: (row: number, col: number) => boolean;
  /** Полная матрица (компараторы и бочки во всех клетках — ПЗУ можно перепрошить) или только единицы. */
  full: boolean;
  /** Количество предметов в бочке «1»: 27 нестакающихся = сигнал 15. */
  itemsOne?: number;
  /** Чем заполнять: id предмета (для экспорта). */
  item?: string;
}

export interface RomLayout {
  /** Клемма (пыль на земле) прямой линии адреса каждого бита: addr[бит][0]; обратная линия строится внутри факелом. */
  addr: XYZ[][];
  /** Нижняя клетка каждой линии столбца (выход ПЗУ). */
  out: XYZ[];
  /** z ряда компараторов каждого слова. */
  rowZ: number[];
  /** x бочек каждого столбца. */
  colX: number[];
  bounds: { x0: number; x1: number; z0: number; z1: number };
}

export const ROM_PZ = 4;
export const ROM_PX = 6;
export const LINE_PITCH = 4;
/** Линии адреса и столбцов выходят за границу массива на столько клеток — туда подключается маршрутизатор. */
export const EXT = 5;

/** Ставит «отвод»: сигнал с приподнятой линии (xv, y=3) спускается на землю и через повторитель идёт на восток. */
function tap(v: Vox, xv: number, z: number): void {
  v.solid(xv + 1, 1, z); // опора лестницы (на ней же питается повторитель)
  v.set(xv + 1, 2, z, { kind: K.Dust });
  v.repeater(xv + 2, 1, z, W, 1);
}

/** Спуск с приподнятой линии на землю у верхнего края: возвращает клемму (пыль на земле). */
export function descendTop(v: Vox, x: number, zT: number): XYZ {
  v.solid(x, 1, zT - 1);
  v.set(x, 2, zT - 1, { kind: K.Dust });
  v.dust(x, 1, zT - 2);
  return [x, 1, zT - 2];
}

/** То же у нижнего края. */
export function descendBottom(v: Vox, x: number, zB: number): XYZ {
  v.solid(x, 1, zB + 1);
  v.set(x, 2, zB + 1, { kind: K.Dust });
  v.dust(x, 1, zB + 2);
  return [x, 1, zB + 2];
}

/**
 * Приподнятая линия вдоль Z (опорные блоки на y=2, пыль на y=3). Повторители ставятся сразу за входным концом и далее не реже чем
 * через 12 клеток — только в «свободных» рядах (free); sections — на 12 клеток нет ограничения у внешних концов.
 */
export function elevatedLine(v: Vox, xv: number, zFrom: number, zTo: number, flow: 'S' | 'N', free: (z: number) => boolean, outBoost = false): void {
  const step = flow === 'S' ? 1 : -1;
  const start = flow === 'S' ? zFrom : zTo;
  const end = flow === 'S' ? zTo : zFrom;
  const boosts = new Set<number>();
  let prev = start + step;
  boosts.add(prev);
  while (Math.abs(end - prev) > 12) {
    let z = prev + step * 12;
    while (!free(z) && z !== prev) z -= step;
    if (z === prev) break;
    boosts.add(z);
    prev = z;
  }
  if (outBoost) boosts.add(zTo - 3);
  for (let z = zFrom; z <= zTo; z++) {
    v.solid(xv, 2, z);
    if (boosts.has(z)) v.set(xv, 3, z, { kind: K.Repeater, dir: flow === 'S' ? N : S, delay: 1 });
    else v.set(xv, 3, z, { kind: K.Dust });
  }
}

/**
 * Пара линий адреса: прямая (вход сверху, клемма на земле) и обратная. Обратная получается из прямой факелом-инвертором
 * под нижним концом и течёт вверх.
 */
export function addressPair(v: Vox, xd: number, zTop: number, zTap0: number, zLast: number, free: (z: number) => boolean): XYZ {
  const xi = xd + LINE_PITCH;
  elevatedLine(v, xd, zTop, zLast, 'S', free);
  const term = descendTop(v, xd, zTop);
  // инвертор: блок в продолжении линии, факел сбоку, пыль до обратной линии
  v.set(xd, 3, zLast + 1, { kind: K.Solid, mat: 0 });
  v.torch(xd + 1, 3, zLast + 1, 3);
  for (let x = xd + 2; x <= xi; x++) {
    v.solid(x, 2, zLast + 1);
    v.set(x, 3, zLast + 1, { kind: K.Dust });
  }
  elevatedLine(v, xi, zTap0, zLast, 'N', free);
  return term;
}

/**
 * Цепочка «ИЛИ несовпадений»: отводы с приподнятых линий (xs по возрастанию) складываются повторителями вдоль ряда z.
 * Возвращает x, с которого цепочку можно продолжать пылью (выход последнего повторителя).
 */
export function decodeChain(v: Vox, xs: number[], z: number): number {
  const sorted = [...xs].sort((a, b) => a - b);
  let x = sorted[0];
  for (const xv of sorted) {
    // пыль от текущего x до xv (включительно) на земле
    for (let xx = x; xx <= xv; xx++) if (xx > sorted[0] || xx === xv) v.dust(xx, 1, z);
    tap(v, xv, z);
    x = xv + 3; // выход повторителя — пыль на xv+3
  }
  return x;
}

/**
 * Матрица ПЗУ на бочках: строки — слова, столбцы — биты слова. Слово выбирается дешифратором «несовпадение адреса»:
 * линия слова (ряд z-2) получает 15, если хоть один бит адреса не совпал; пока она 15, компараторы строки закрыты.
 */
export function buildRom(v: Vox, ox: number, oz: number, o: RomOptions): RomLayout {
  const { P, rows, cols } = o;
  const xr0 = ox + 2 * LINE_PITCH * P + 2; // первый столбец ПЗУ
  const colX = Array.from({ length: cols }, (_, j) => xr0 + ROM_PX * j);
  const rowZ = Array.from({ length: rows }, (_, w) => oz + 2 + ROM_PZ * w);
  const xEnd = colX[cols - 1] + 5;
  const zLast = rowZ[rows - 1] + 1;
  const items = o.itemsOne ?? 27;

  // «пустые» ряды между словами: в них можно ставить повторители приподнятых линий
  const freeRows = new Set<number>(rowZ.map((z) => z + 1));
  const free = (z: number): boolean => z < oz || z > zLast || freeRows.has(z);

  // линии адреса: клемма только у прямой линии, обратная получается факелом
  const addr: XYZ[][] = [];
  const lineX = (bit: number, comp: number): number => ox + 2 * LINE_PITCH * bit + LINE_PITCH * comp;
  for (let b = 0; b < P; b++) addr.push([addressPair(v, lineX(b, 0), oz - EXT, oz, zLast, free)]);

  // ряды
  for (let w = 0; w < rows; w++) {
    const zc = rowZ[w];
    const zWL = zc - 2;
    // отводы: на каждый бит адреса — прямая линия, если бит слова = 0 (несовпадение при адресе=1), иначе инверсная
    const taps: number[] = [];
    for (let b = 0; b < P; b++) taps.push(lineX(b, ((w >> b) & 1) === 1 ? 1 : 0));
    taps.sort((a, b2) => a - b2);
    // цепочка линии слова: пыль между отводами и до конца матрицы
    const x = decodeChain(v, taps, zWL);
    // линия слова через матрицу: усилитель в зазоре после каждого второго столбца (затухание 1 на клетку)
    const boostX = new Set<number>();
    for (let j = 0; j < cols - 1; j += 2) boostX.add(colX[j] + 5);
    for (let xx = x; xx <= xEnd; xx++) {
      if (boostX.has(xx)) v.repeater(xx, 1, zWL, W, 1);
      else v.dust(xx, 1, zWL);
    }

    for (let j = 0; j < cols; j++) {
      const one = o.bit(w, j);
      if (!one && !o.full) continue;
      const x0 = colX[j];
      v.barrel(x0, 1, zc, one ? 15 : 0, one ? Array(items).fill(1) : []);
      v.comparator(x0 + 1, 1, zc, W, true);
      v.dust(x0 + 2, 1, zc);
      v.solid(x0 + 3, 1, zc);
      v.set(x0 + 3, 2, zc, { kind: K.Dust });
      v.repeater(x0 + 1, 1, zc - 1, N, 1); // G: вход с севера (линия слова), выход на юг в бок компаратора
    }
  }

  // столбцы выхода (приподнятые, вдоль Z) с усилителями; выходная клемма снова получает почти полные 15
  const out: XYZ[] = [];
  for (let j = 0; j < cols; j++) {
    const xb = colX[j] + 4;
    elevatedLine(v, xb, rowZ[0], zLast + EXT, 'S', free, true);
    out.push(descendBottom(v, xb, zLast + EXT));
  }
  return { addr, out, rowZ, colX, bounds: { x0: ox, x1: xEnd, z0: oz, z1: zLast } };
}

export { E, S, MAT_GATE };
