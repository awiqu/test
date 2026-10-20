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
  /** Верхняя клетка каждой линии адреса: [бит][0=прямая,1=инверсная]. */
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
const EXT = 5;

/** Ставит «отвод»: сигнал с приподнятой линии (xv, y=3) спускается на землю и через повторитель идёт на восток. */
function tap(v: Vox, xv: number, z: number): void {
  v.solid(xv + 1, 1, z); // опора лестницы (на ней же питается повторитель)
  v.set(xv + 1, 2, z, { kind: K.Dust });
  v.repeater(xv + 2, 1, z, W, 1);
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

  // усилитель в приподнятой линии ставится в «пустом» ряду после каждых трёх слов
  const boostRows = new Set<number>();
  for (let w = 1; w < rows - 1; w += 2) boostRows.add(rowZ[w] + 1);
  const boostRow = (z: number): boolean => boostRows.has(z);

  // линии адреса (приподнятые, вдоль Z)
  const addr: XYZ[][] = [];
  const lineX = (bit: number, comp: number): number => ox + 2 * LINE_PITCH * bit + LINE_PITCH * comp;
  for (let b = 0; b < P; b++) {
    const pair: XYZ[] = [];
    for (let c = 0; c < 2; c++) {
      const xv = lineX(b, c);
      for (let z = oz - EXT; z <= zLast; z++) {
        v.solid(xv, 2, z);
        // повторитель сразу за входной клеммой: линия адреса стартует с полных 15
        if (boostRow(z) || z === oz - EXT + 1) v.set(xv, 3, z, { kind: K.Repeater, dir: N, delay: 1 });
        else v.set(xv, 3, z, { kind: K.Dust });
      }
      pair.push([xv, 3, oz - EXT]);
    }
    addr.push(pair);
  }

  // ряды
  for (let w = 0; w < rows; w++) {
    const zc = rowZ[w];
    const zWL = zc - 2;
    // отводы: на каждый бит адреса — прямая линия, если бит слова = 0 (несовпадение при адресе=1), иначе инверсная
    const taps: number[] = [];
    for (let b = 0; b < P; b++) taps.push(lineX(b, ((w >> b) & 1) === 1 ? 1 : 0));
    taps.sort((a, b2) => a - b2);
    // цепочка линии слова: пыль между отводами и до конца матрицы
    let x = taps[0];
    for (const xv of taps) {
      // пыль от текущего x до xv (включительно) на земле
      for (let xx = x; xx <= xv; xx++) if (xx > taps[0] || xx === xv) v.dust(xx, 1, zWL);
      tap(v, xv, zWL);
      x = xv + 3; // выход повторителя — пыль на xv+3
    }
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

  // столбцы выхода (приподнятые, вдоль Z) с усилителями каждые 3 слова
  const out: XYZ[] = [];
  for (let j = 0; j < cols; j++) {
    const xb = colX[j] + 4;
    for (let z = rowZ[0]; z <= zLast + EXT; z++) {
      v.solid(xb, 2, z);
      // выходной повторитель: на клемме снова полные 15
      if (boostRow(z) || z === zLast + 2) v.set(xb, 3, z, { kind: K.Repeater, dir: N, delay: 1 });
      else v.set(xb, 3, z, { kind: K.Dust });
    }
    out.push([xb, 3, zLast + EXT]);
  }
  return { addr, out, rowZ, colX, bounds: { x0: ox, x1: xEnd, z0: oz, z1: zLast } };
}

export { E, S, MAT_GATE };
