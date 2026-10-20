import { describe, it, expect } from 'vitest';
import { compileMacro } from '../../src/cpu/macro';
import { TickSim } from '../../src/cpu/tick';

describe('macro compile + tick simulation', () => {
  it('compiled combinational macro behaves like its logic in the tick simulator', () => {
    const src = `input a b c
x = XOR(a, b)
y = AND(x, c)
z = OR(y, a)
output p = x
output q = z
`;
    const m = compileMacro(src);
    const sim = new TickSim(m.testVox);
    // позиции рычагов и ламп: ищем по маркерам через пины
    const lever = (name: string) => { const p = m.pins.get(name)!.approach; return p; };
    for (let mask = 0; mask < 8; mask++) {
      const [a, b, c] = [mask & 1, (mask >> 1) & 1, (mask >> 2) & 1];
      sim.setLever(...(lever('a') as [number, number, number]), !!a);
      sim.setLever(...(lever('b') as [number, number, number]), !!b);
      sim.setLever(...(lever('c') as [number, number, number]), !!c);
      sim.run(120);
      const x = a ^ b;
      const z = (x & c) | a;
      const lamp = (name: string) => { const p = m.pins.get(name)!.approach; return sim.litAt(p[0], p[1], p[2]); };
      expect(lamp('p'), `mask ${mask} p`).toBe(!!x);
      expect(lamp('q'), `mask ${mask} q`).toBe(!!z);
    }
  });
});
