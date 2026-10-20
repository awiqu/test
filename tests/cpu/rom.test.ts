import { describe, it, expect } from 'vitest';
import { Vox } from '../../src/cpu/vox';
import { TickSim } from '../../src/cpu/tick';
import { buildRom } from '../../src/cpu/arrays';
import { K } from '../../src/compiler/voxel';

function setup(P: number, rows: number, cols: number, content: number[][], full: boolean) {
  const v = new Vox();
  const rom = buildRom(v, 0, 0, { P, rows, cols, bit: (w, j) => content[w][j] === 1, full });
  // рычаги, имитирующие регистр адреса: питают нижние концы прямых линий адреса
  const levers = rom.addrX.map((x) => {
    v.lever(x, 3, rom.addrBottom + 1, false);
    return { x, z: rom.addrBottom + 1 };
  });
  // лампы под нижними концами линий столбцов
  const lamps = rom.outX.map((x) => {
    v.set(x, 3, rom.outBottom + 1, { kind: K.Lamp, mat: 1 });
    return [x, 3, rom.outBottom + 1] as [number, number, number];
  });
  return { v, rom, levers, lamps };
}

describe('barrel ROM array with tap decoder', () => {
  for (const full of [true, false]) {
    it(`reads every word (full matrix = ${full})`, () => {
      const P = 2, rows = 4, cols = 3;
      const content = [[1, 0, 1], [0, 1, 1], [1, 1, 0], [0, 0, 1]];
      const { v, levers, lamps } = setup(P, rows, cols, content, full);
      const sim = new TickSim(v);
      for (let addr = 0; addr < rows; addr++) {
        for (let b = 0; b < P; b++) sim.setLever(levers[b].x, 3, levers[b].z, ((addr >> b) & 1) === 1);
        sim.run(400);
        const got = lamps.map((p) => (sim.litAt(...p) ? 1 : 0));
        expect(got, `addr ${addr}`).toEqual(content[addr]);
      }
    });
  }

  it('works for a longer ROM (16 words, 4 address bits)', () => {
    const P = 4, rows = 16, cols = 5;
    const content = Array.from({ length: rows }, (_, w) => Array.from({ length: cols }, (_, j) => ((w * 7 + j * 3 + (w >> 2)) & 1)));
    const { v, levers, lamps } = setup(P, rows, cols, content, false);
    const sim = new TickSim(v);
    for (let addr = 0; addr < rows; addr++) {
      for (let b = 0; b < P; b++) sim.setLever(levers[b].x, 3, levers[b].z, ((addr >> b) & 1) === 1);
      sim.run(600);
      expect(lamps.map((p) => (sim.litAt(...p) ? 1 : 0)), `addr ${addr}`).toEqual(content[addr]);
    }
  });
});
