import { describe, it, expect } from 'vitest';
import { Vox } from '../../src/cpu/vox';
import { buildRom } from '../../src/cpu/arrays';
import { CONTAINERS, itemsForSignal, voxToStructure } from '../../src/cpu/export';
import { buildLitematic } from '../../src/export/litematic';
import { MC_DATA_VERSION_26_2 } from '../../src/compiler/compile';

describe('vox → structure → litematic', () => {
  it('item counts give signal 15 for every container', () => {
    for (const c of CONTAINERS) {
      const n = itemsForSignal(15, c.slots);
      expect(n).toBe(c.slots);
      expect(Math.floor((14 * n) / c.slots) + 1).toBe(15);
    }
    expect(itemsForSignal(0, 27)).toBe(0);
    expect(itemsForSignal(1, 27)).toBe(1);
  });

  for (const c of CONTAINERS) {
    it(`ROM with ${c.id}: containers, comparators and states are exported`, () => {
      const v = new Vox();
      buildRom(v, 0, 0, { P: 2, rows: 4, cols: 3, bit: (w, j) => (w + j) % 2 === 0, full: true });
      const st = voxToStructure(v, { wireBlock: { material: 'stone', color: 'gray' }, gateBlock: { material: 'smooth_stone', color: 'gray' }, container: c.id, item: 'minecraft:wooden_pickaxe' });
      const ones = (st.tileEntities ?? []).filter((t) => t.id === c.block && (t.items?.length ?? 0) > 0);
      expect(ones.length).toBe(6); // 12 клеток, половина — единицы
      for (const t of ones) expect(t.items!.length).toBe(c.slots);
      const comps = st.blocks.filter((b) => b.spec.name === 'minecraft:comparator');
      expect(comps.length).toBe(12);
      expect(comps.every((b) => b.spec.props?.mode === 'subtract')).toBe(true);
      const bytes = buildLitematic(st, { name: 't', author: 'a', description: 'd', dataVersion: MC_DATA_VERSION_26_2 });
      expect(bytes.length).toBeGreaterThan(100);
    });
  }
});
