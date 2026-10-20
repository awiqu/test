import { describe, it, expect } from 'vitest';
import { Vox } from '../../src/cpu/vox';
import { TickSim } from '../../src/cpu/tick';
import { clockRingPart } from '../../src/cpu/parts';

describe('auto clock ring', () => {
  it('is frozen while the stop lever is on and oscillates with the computed half period', () => {
    const v = new Vox();
    const part = clockRingPart(v, 0, 0, 6, 4);
    const sim = new TickSim(v);
    const out = part.pins.out.dust;
    sim.run(2000);
    const frozen = sim.powerAt(...out);
    sim.run(1000);
    expect(sim.powerAt(...out)).toBe(frozen);
    sim.setLever(...part.stop, false);
    // измеряем длительности фаз на выходе
    const edges: number[] = [];
    let prev = sim.powerAt(...out) > 0;
    for (let t = 0; t < 4000; t++) {
      sim.run(1);
      const cur = sim.powerAt(...out) > 0;
      if (cur !== prev) edges.push(t);
      prev = cur;
    }
    expect(edges.length).toBeGreaterThan(6);
    const halves = edges.slice(1).map((e, i) => e - edges[i]);
    const avg = halves.slice(1).reduce((a, b) => a + b, 0) / (halves.length - 1);
    process.stderr.write(`half periods (gt): ${halves.join(',')} expected ${part.half * 2}\n`);
    expect(Math.abs(avg - part.half * 2)).toBeLessThan(part.half * 2 * 0.15);
  });
});
