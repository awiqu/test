import { describe, it, expect } from 'vitest';
import { Vox } from '../../src/cpu/vox';
import { TickSim } from '../../src/cpu/tick';
import { buildRom } from '../../src/cpu/arrays';

function setup(P: number, rows: number, cols: number, content: number[][], full: boolean) {
  const v = new Vox();
  const rom = buildRom(v, 0, 0, { P, rows, cols, bit: (w, j) => content[w][j] === 1, full });
  // рычаги, имитирующие регистр адреса: питают верхние клетки линий (прямая и инверсная)
  const levers: { x: number; z: number }[][] = [];
  for (let b = 0; b < P; b++) {
    const pair: { x: number; z: number }[] = [];
    {
      const [x, , z] = rom.addr[b][0];
      v.lever(x, 1, z - 1, false);
      pair.push({ x, z: z - 1 });
    }
    levers.push(pair);
  }
  // выходные лампы под столбцами
  rom.out.forEach(([x, , z]) => { v.set(x, 1, z + 1, { kind: 7 as never, mat: 1 }); });
  return { v, rom, levers };
}

describe('barrel ROM array with tap decoder', () => {
  for (const full of [true, false]) {
    it(`reads every word (full matrix = ${full})`, () => {
      const P = 2, rows = 4, cols = 3;
      const content = [[1, 0, 1], [0, 1, 1], [1, 1, 0], [0, 0, 1]];
      const { v, rom, levers } = setup(P, rows, cols, content, full);
      const sim = new TickSim(v);
      for (let addr = 0; addr < rows; addr++) {
        for (let b = 0; b < P; b++) {
          const bit = (addr >> b) & 1;
          sim.setLever(levers[b][0].x, 1, levers[b][0].z, bit === 1); // прямая
        }
        sim.run(260);
        const got = rom.out.map(([x, , z]) => (sim.litAt(x, 1, z + 1) ? 1 : 0));
        expect(got, `addr ${addr}`).toEqual(content[addr]);
      }
    });
  }
});
