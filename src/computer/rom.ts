import { Structure, StructBlock, TileEntityData, TileItem } from '../compiler/compile';
import { K } from '../compiler/voxel';
import { BlockChoice, blockName } from '../compiler/materials';
import { ComputerSpec } from './types';
import { nibblesPerWord } from './spec';

/**
 * ПЗУ из бочек: каждая бочка хранит один «ниббл» (4 бита) как силу сигнала компаратора (0…15).
 * Слово из N бит занимает ceil(N/4) бочек.
 */

export type ItemKind = 'stack64' | 'unstackable';

export interface RomOptions {
  /** Порядок бочек в слове: старший ниббл первым (по возрастанию X) или младший. */
  nibbleOrder: 'msb' | 'lsb';
  itemKind: ItemKind;
  /** Предмет-заполнитель. */
  item: string;
  /** Сколько слов в одной строке сетки (1 — «лента»). */
  wordsPerRow: number;
  /** Компаратор за каждой бочкой. */
  comparators: boolean;
  /** Пыль за компаратором (показывает уровень сигнала). */
  outputDust: boolean;
  /** Сплошной пол из опорного блока. */
  floor: boolean;
  support: BlockChoice;
  /** Размер ПЗУ в словах (пустые слова дополняются нулями). */
  words?: number;
}

export const DEFAULT_ROM_OPTIONS: RomOptions = {
  nibbleOrder: 'msb',
  itemKind: 'stack64',
  item: 'minecraft:cobblestone',
  wordsPerRow: 1,
  comparators: true,
  outputDust: true,
  floor: true,
  support: { material: 'stone', color: 'gray' },
};

export const DEFAULT_UNSTACKABLE_ITEM = 'minecraft:wooden_pickaxe';

const BARREL_SLOTS = 27;

/** Сила сигнала компаратора для бочки с данным содержимым (формула игры). */
export function barrelSignal(counts: number[], stackLimit: number): number {
  let any = false;
  let num = 0; // сумма count/stackLimit, домноженная на stackLimit для точной арифметики
  for (const c of counts) {
    if (c > 0) any = true;
    num += c;
  }
  if (!any) return 0;
  // f = (Σ count/limit)/27;  сигнал = floor(14 f) + 1
  return Math.floor((14 * num) / (stackLimit * BARREL_SLOTS)) + 1;
}

/** Минимальное содержимое бочки, дающее нужную силу сигнала (слот → количество). */
export function fillFor(signal: number, kind: ItemKind): number[] {
  if (signal <= 0) return [];
  const limit = kind === 'stack64' ? 64 : 1;
  const total = signal === 1 ? 1 : Math.ceil(((signal - 1) * limit * BARREL_SLOTS) / 14);
  const slots: number[] = [];
  let left = total;
  while (left > 0) {
    const take = Math.min(limit, left);
    slots.push(take);
    left -= take;
  }
  // проверка: игра должна посчитать ровно signal
  if (barrelSignal(slots, limit) !== signal) throw new Error(`Не удалось подобрать содержимое для сигнала ${signal}`);
  return slots;
}

export function splitNibbles(word: number, nibbles: number, order: 'msb' | 'lsb'): number[] {
  const out: number[] = [];
  for (let i = 0; i < nibbles; i++) out.push(Math.floor(word / 16 ** i) & 15);
  return order === 'msb' ? out.reverse() : out;
}

export interface RomMapEntry {
  address: number;
  word: number;
  /** Координаты бочек (в структуре) от первой к последней по порядку нибблов. */
  barrels: { x: number; y: number; z: number; nibble: number }[];
}

export interface RomBuild {
  structure: Structure;
  map: RomMapEntry[];
  strideX: number;
  rowPitch: number;
  barrelCount: number;
  wordsPerRow: number;
}

export function buildRom(words: number[], spec: ComputerSpec, opts: RomOptions): RomBuild {
  const n = nibblesPerWord(spec);
  const total = Math.max(words.length, opts.words ?? 0, 1);
  const wordsPerRow = Math.max(1, Math.floor(opts.wordsPerRow));
  const strideX = opts.comparators ? (opts.outputDust ? 3 : 2) : 1;
  const rowPitch = opts.comparators && opts.outputDust ? 2 : 1;
  const colWidth = n * strideX;
  const colPitch = colWidth + 1;
  const rows = Math.ceil(total / wordsPerRow);
  const sx = Math.min(wordsPerRow, total) * colPitch - 1;
  const sz = (rows - 1) * rowPitch + 1;
  const sy = 2; // пол + бочки
  const itemId = opts.item;
  const blocks: StructBlock[] = [];
  const tiles: TileEntityData[] = [];
  const map: RomMapEntry[] = [];
  const supportName = blockName(opts.support);
  const put = (x: number, y: number, z: number, kind: K, name: string, props?: Record<string, string>): void => {
    blocks.push({ x, y, z, kind, spec: { name, props } });
  };

  if (opts.floor) {
    for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) put(x, 0, z, K.Solid, supportName);
  }
  const supports = new Set<string>();
  const need = (x: number, z: number): void => {
    if (opts.floor) return;
    const key = `${x},${z}`;
    if (!supports.has(key)) {
      supports.add(key);
      put(x, 0, z, K.Solid, supportName);
    }
  };

  for (let a = 0; a < total; a++) {
    const word = words[a] ?? 0;
    const col = a % wordsPerRow;
    const row = Math.floor(a / wordsPerRow);
    const x0 = col * colPitch;
    const z = row * rowPitch;
    const nibs = splitNibbles(word, n, opts.nibbleOrder);
    const entry: RomMapEntry = { address: a, word, barrels: [] };
    nibs.forEach((value, j) => {
      const x = x0 + j * strideX;
      const slots = fillFor(value, opts.itemKind);
      const items: TileItem[] = slots.map((count, slot) => ({ slot, id: itemId, count }));
      put(x, 1, z, K.Barrel, 'minecraft:barrel', { facing: 'up', open: 'false' });
      tiles.push({ x, y: 1, z, id: 'minecraft:barrel', items });
      entry.barrels.push({ x, y: 1, z, nibble: value });
      if (opts.comparators) {
        need(x + 1, z);
        put(x + 1, 1, z, K.Comparator, 'minecraft:comparator', { facing: 'west', mode: 'compare', powered: value > 0 ? 'true' : 'false' });
        // facing указывает на сторону входа (как у повторителя). Без OutputSignal компаратор после вставки выдаёт 0, пока соседний блок не «разбудит» его
        tiles.push({ x: x + 1, y: 1, z, id: 'minecraft:comparator', ints: { OutputSignal: value } });
        if (opts.outputDust) {
          need(x + 2, z);
          put(x + 2, 1, z, K.Dust, 'minecraft:redstone_wire', { east: 'side', north: 'none', power: String(value), south: 'none', west: 'side' });
        }
      }
    });
    map.push(entry);
  }
  const markers: Structure['markers'] = [];
  for (let r = 0; r < rows; r += Math.max(1, Math.ceil(rows / 16))) {
    markers.push({ x: 0, y: 1, z: r * rowPitch, text: `${r * wordsPerRow}`.padStart(2, '0'), kind: 'in' });
  }
  const structure: Structure = { sx, sy, sz, blocks, markers, tileEntities: tiles };
  return { structure, map, strideX, rowPitch, barrelCount: map.reduce((a, e) => a + e.barrels.length, 0), wordsPerRow };
}

/** Текстовая карта адресов для документации. */
export function romMapText(build: RomBuild, spec: ComputerSpec, hex: string[]): string {
  const lines: string[] = [];
  lines.push('# Карта ПЗУ из бочек');
  lines.push('');
  lines.push(`Слов: ${build.map.length}, бочек: ${build.barrelCount}, ниббл-бочек на слово: ${nibblesPerWord(spec)}.`);
  lines.push('Сила сигнала компаратора бочки = значение ниббла (0 — пустая бочка).');
  lines.push('');
  lines.push('| Адрес | Слово (hex) | Бочки (x,y,z → ниббл) |');
  lines.push('|---|---|---|');
  for (const e of build.map) lines.push(`| ${e.address} | ${hex[e.address] ?? '0'} | ${e.barrels.map((b) => `(${b.x},${b.y},${b.z})→${b.nibble.toString(16).toUpperCase()}`).join(' ')} |`);
  return lines.join('\n') + '\n';
}
