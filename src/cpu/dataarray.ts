import { K } from '../compiler/voxel';
import { Vox } from './vox';
import { EXT, LINE_PITCH, XYZ, addressPair, decodeChain, descendBottom, descendTop, elevatedLine } from './arrays';

const N = 0, S = 2, W = 3;

export type RowKind = 'ram' | 'out' | 'in';

export interface DataRow {
  /** Адрес слова в пространстве данных. */
  addr: number;
  /** ram — слово ОЗУ; out — порт вывода (ОЗУ + лампы); in — порт ввода (рычаги/кнопки на месте ячейки). */
  kind: RowKind;
  /** Для out/in: сколько младших разрядов подключено к лампам/рычагам. */
  count?: number;
  /** Для in: чем вводить. */
  device?: 'lever' | 'button';
  name?: string;
}

export interface DataOptions {
  /** Число бит адреса (линий адреса 2·RA: прямая и инверсная). */
  RA: number;
  /** Разрядность слова. */
  D: number;
  rows: DataRow[];
  /** Блок на месте ламп. */
  lamps?: boolean;
}

export interface DataLayout {
  /** Клеммы прямых линий адреса: addr[бит][0] (обратные линии строятся внутри). */
  addr: XYZ[][];
  /** Верхняя клетка линии «запись не идёт» (низкий уровень = импульс записи). */
  nwm: XYZ;
  /** Верхние клетки линий данных записи (по разрядам). */
  wbl: XYZ[];
  /** Нижние клетки линий данных чтения. */
  rbl: XYZ[];
  rowZ: number[];
  /** Повторитель-защёлка каждого бита: [строка][разряд] (может быть undefined у порта ввода). */
  cell: (XYZ | undefined)[][];
  /** Рычаги/кнопки портов ввода. */
  inputs: { row: number; bit: number; pos: XYZ; name?: string }[];
  lamps: { row: number; bit: number; pos: XYZ; name?: string }[];
  bounds: { x0: number; x1: number; z0: number; z1: number };
}

export const DATA_PZ = 6;
export const DATA_PX = 9;

/**
 * Массив слов данных. Каждое слово — ряд ячеек; ячейка бита — запертый повторитель (D-защёлка):
 *   запись:  линия данных WBL → отвод → R; замок R снимается только для выбранного слова во время импульса записи;
 *   чтение:  R → блок → компаратор в режиме вычитания (боковой вход — «слово не выбрано») → линия RBL.
 * Выбор слова — цепочка «ИЛИ несовпадений адреса» (как в ПЗУ); для записи в цепочку добавлена ещё линия nWM.
 * Профиль ряда (z): zc-2 цепочка чтения, zc-1 повторитель G, zc ячейки, zc+1 замок LK, zc+2 цепочка записи, zc+3 пусто.
 */
export function buildData(v: Vox, ox: number, oz: number, o: DataOptions): DataLayout {
  const { RA, D, rows } = o;
  const nrows = rows.length;
  const lineX = (bit: number, comp: number): number => ox + LINE_PITCH + 2 * LINE_PITCH * bit + LINE_PITCH * comp;
  const xNwm = ox; // линия nWM — крайняя слева, чтобы цепочки не затухали до первого столбца
  const cx0 = ox + 2 * LINE_PITCH * RA + LINE_PITCH;
  const colX = Array.from({ length: D }, (_, j) => cx0 + DATA_PX * j);
  const rowZ = Array.from({ length: nrows }, (_, w) => oz + 2 + DATA_PZ * w);
  const zLast = rowZ[nrows - 1] + 3;
  const xEnd = colX[D - 1] + 7;

  // повторители на приподнятых линиях — только в свободных рядах (zc+3) или за пределами матрицы
  const freeRows = new Set<number>(rowZ.map((z) => z + 3));
  const free = (z: number): boolean => z < rowZ[0] - 2 || z > zLast || freeRows.has(z);

  // линии адреса: клемма у прямой линии, обратная получается факелом; nWM — отдельная линия сверху
  const addr: XYZ[][] = [];
  for (let b = 0; b < RA; b++) addr.push([addressPair(v, lineX(b, 0), oz - EXT, rowZ[0] - 2, zLast, free)]);
  elevatedLine(v, xNwm, oz - EXT, zLast, 'S', free);
  const nwm: XYZ = descendTop(v, xNwm, oz - EXT);

  // линии данных записи (вход снизу, течёт вверх) и чтения (течёт вниз к выходу)
  const wbl: XYZ[] = [];
  const rbl: XYZ[] = [];
  for (let j = 0; j < D; j++) {
    const xw = colX[j];
    elevatedLine(v, xw, rowZ[0], zLast + EXT, 'N', free);
    wbl.push(descendBottom(v, xw, zLast + EXT));
    const xr = colX[j] + 7;
    elevatedLine(v, xr, rowZ[0], zLast + EXT, 'S', free, true);
    rbl.push(descendBottom(v, xr, zLast + EXT));
  }

  const cell: (XYZ | undefined)[][] = [];
  const inputs: DataLayout['inputs'] = [];
  const lamps: DataLayout['lamps'] = [];
  for (let w = 0; w < nrows; w++) {
    const row = rows[w];
    const zc = rowZ[w];
    const taps: number[] = [];
    for (let b = 0; b < RA; b++) taps.push(lineX(b, ((row.addr >> b) & 1) === 1 ? 1 : 0));
    // цепочка чтения
    const xr = decodeChain(v, taps, zc - 2);
    for (let xx = xr; xx <= xEnd; xx++) {
      const gap = colX.findIndex((c, j) => j < D - 1 && xx === c + 8);
      if (gap >= 0) v.repeater(xx, 1, zc - 2, W, 1);
      else v.dust(xx, 1, zc - 2);
    }
    const writable = row.kind !== 'in';
    if (writable) {
      // цепочка записи: те же отводы + линия nWM
      const xw = decodeChain(v, [...taps, xNwm], zc + 2);
      for (let xx = xw; xx <= xEnd; xx++) {
        const gap = colX.findIndex((c, j) => j < D - 1 && xx === c + 8);
        if (gap >= 0) v.repeater(xx, 1, zc + 2, W, 1);
        else v.dust(xx, 1, zc + 2);
      }
    }
    const cells: (XYZ | undefined)[] = [];
    for (let j = 0; j < D; j++) {
      const cx = colX[j];
      const present = row.kind !== 'in' || j < (row.count ?? D);
      if (row.kind === 'in') {
        if (present) {
          // рычаг/кнопка питает пыль перед компаратором
          if (row.device === 'button') v.set(cx + 2, 1, zc, { kind: K.Button, dir: 1, on: false, tag: `${row.name ?? 'in'}${j}` });
          else v.lever(cx + 2, 1, zc, false, `${row.name ?? 'in'}${j}`);
          if (!v.has(cx + 2, 0, zc)) v.solid(cx + 2, 0, zc);
          v.dust(cx + 3, 1, zc);
          inputs.push({ row: w, bit: j, pos: [cx + 2, 1, zc], name: row.name });
        } else {
          v.dust(cx + 3, 1, zc);
        }
        cells.push(undefined);
      } else {
        v.solid(cx + 1, 1, zc);
        v.set(cx + 1, 2, zc, { kind: K.Dust });
        v.repeater(cx + 2, 1, zc, W, 1); // R
        v.repeater(cx + 2, 1, zc + 1, S, 1); // LK
        v.solid(cx + 3, 1, zc); // X
        if (row.kind === 'out' && j < (row.count ?? D) && o.lamps !== false) {
          v.lamp(cx + 3, 2, zc, `${row.name ?? 'out'}${j}`);
          lamps.push({ row: w, bit: j, pos: [cx + 3, 2, zc], name: row.name });
        }
        cells.push([cx + 2, 1, zc]);
      }
      v.comparator(cx + 4, 1, zc, W, true); // C
      v.repeater(cx + 4, 1, zc - 1, N, 1); // G
      v.dust(cx + 5, 1, zc);
      v.solid(cx + 6, 1, zc);
      v.set(cx + 6, 2, zc, { kind: K.Dust });
    }
    cell.push(cells);
  }
  return { addr, nwm, wbl, rbl, rowZ, cell, inputs, lamps, bounds: { x0: ox, x1: xEnd, z0: oz, z1: zLast } };
}
