import { describe, it, expect } from 'vitest';
import { gunzipSync } from 'fflate';
import { writeFileSync } from 'node:fs';
import { defaultSpec } from '../../src/computer/spec';
import { buildPresetIsa } from '../../src/computer/isa';
import { assemble } from '../../src/computer/asm';
import { EXAMPLES } from '../../src/computer/examples';
import { DEFAULT_ROM_OPTIONS, DEFAULT_UNSTACKABLE_ITEM, barrelSignal, buildRom, fillFor, splitNibbles } from '../../src/computer/rom';
import { buildLitematic } from '../../src/export/litematic';
import { readNbt } from '../../src/export/nbt';

describe('barrel signal', () => {
  it('fillFor gives exactly the requested signal for every strength', () => {
    for (const kind of ['stack64', 'unstackable'] as const) {
      const limit = kind === 'stack64' ? 64 : 1;
      expect(barrelSignal(fillFor(0, kind), limit)).toBe(0);
      for (let s = 1; s <= 15; s++) {
        const slots = fillFor(s, kind);
        expect(slots.length).toBeLessThanOrEqual(27);
        expect(slots.every((c) => c >= 1 && c <= limit)).toBe(true);
        expect(barrelSignal(slots, limit), `${kind} ${s}`).toBe(s);
      }
    }
  });
  it('splits words into nibbles in both orders', () => {
    expect(splitNibbles(0xabc, 3, 'msb')).toEqual([0xa, 0xb, 0xc]);
    expect(splitNibbles(0xabc, 3, 'lsb')).toEqual([0xc, 0xb, 0xa]);
    expect(splitNibbles(0x5, 2, 'msb')).toEqual([0, 5]);
  });
});

describe('rom build', () => {
  const spec = defaultSpec('risc8');
  const { instructions } = buildPresetIsa(spec);
  const ex = EXAMPLES.risc8.find((e) => e.name.startsWith('Числа Фибоначчи')) ?? EXAMPLES.risc8[0];
  const asm = assemble(ex.source, spec, instructions);
  it('assembles the sample program', () => expect(asm.ok).toBe(true));

  it('creates one barrel per nibble with matching contents and comparator/dust', () => {
    const words = asm.words;
    const rom = buildRom(words, spec, DEFAULT_ROM_OPTIONS);
    const nib = Math.ceil(spec.instrBits / 4);
    expect(rom.barrelCount).toBe(words.length * nib);
    const st = rom.structure;
    expect(st.tileEntities!.filter((t) => t.id === 'minecraft:barrel').length).toBe(rom.barrelCount);
    // каждая бочка стоит на блоке Barrel и имеет компаратор справа и пыль мощностью = ниббл
    const at = new Map(st.blocks.map((b) => [`${b.x},${b.y},${b.z}`, b]));
    for (const e of rom.map) {
      e.barrels.forEach((b) => {
        expect(at.get(`${b.x},${b.y},${b.z}`)!.spec.name).toBe('minecraft:barrel');
        expect(at.get(`${b.x + 1},${b.y},${b.z}`)!.spec.name).toBe('minecraft:comparator');
        expect(at.get(`${b.x + 2},${b.y},${b.z}`)!.spec.props!.power).toBe(String(b.nibble));
        const te = st.tileEntities!.find((t) => t.id === 'minecraft:barrel' && t.x === b.x && t.y === b.y && t.z === b.z)!;
        expect(barrelSignal(te.items!.map((i) => i.count), 64)).toBe(b.nibble);
        const cmp = st.tileEntities!.find((t) => t.id === 'minecraft:comparator' && t.x === b.x + 1 && t.z === b.z)!;
        expect(cmp.ints!.OutputSignal).toBe(b.nibble);
      });
      // слово собирается обратно из нибблов
      expect(e.barrels.reduce((acc, b) => acc * 16 + b.nibble, 0)).toBe(e.word);
    }
  });

  it('supports grid layout, unstackable items and no-comparator mode', () => {
    const rom = buildRom(asm.words, spec, { ...DEFAULT_ROM_OPTIONS, wordsPerRow: 4, itemKind: 'unstackable', item: DEFAULT_UNSTACKABLE_ITEM, comparators: false, outputDust: false, floor: false });
    for (const t of rom.structure.tileEntities!) {
      expect(t.items!.every((i) => i.count === 1 && i.id === DEFAULT_UNSTACKABLE_ITEM)).toBe(true);
    }
    const names = new Set(rom.structure.blocks.map((b) => b.spec.name));
    expect(names.has('minecraft:comparator')).toBe(false);
    // все блоки внутри габаритов
    for (const b of rom.structure.blocks) {
      expect(b.x).toBeLessThan(rom.structure.sx);
      expect(b.z).toBeLessThan(rom.structure.sz);
      expect(b.y).toBeLessThan(rom.structure.sy);
    }
  });

  it('dumps a grid/unstackable variant for server verification', () => {
    const rom = buildRom(asm.words, spec, { ...DEFAULT_ROM_OPTIONS, wordsPerRow: 4, itemKind: 'unstackable', item: DEFAULT_UNSTACKABLE_ITEM });
    const bytes = buildLitematic(rom.structure, { name: 'ROM grid', author: 'RedLogic', description: 'grid', dataVersion: 4903, now: 1700000000000 });
    writeFileSync('/tmp/rom_grid.litematic', bytes);
    writeFileSync('/tmp/rom_grid.json', JSON.stringify({ map: rom.map }));
  });

  it('writes a litematic with TileEntities for barrels', () => {
    const rom = buildRom(asm.words, spec, DEFAULT_ROM_OPTIONS);
    const bytes = buildLitematic(rom.structure, { name: 'RedLogic ROM', author: 'RedLogic', description: ex.name, dataVersion: 4903, now: 1700000000000 });
    writeFileSync('/home/user/test/docs/examples/rom_example.litematic', bytes);
    const root = readNbt(gunzipSync(bytes)) as any;
    const region = Object.values(root.Regions.v)[0] as any;
    const tiles = region.v.TileEntities.v;
    expect(tiles.length ?? tiles.items?.length).toBeGreaterThan(0);
    writeFileSync(
      '/tmp/rom_example.json',
      JSON.stringify({ origin: 'rom', map: rom.map, size: [rom.structure.sx, rom.structure.sy, rom.structure.sz] }),
    );
  });
});
