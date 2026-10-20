import { describe, it, expect } from 'vitest';
import { Vox } from '../../src/cpu/vox';
import { TickSim } from '../../src/cpu/tick';

const N = 0, S = 2, W = 3;

function floor(v: Vox, x0: number, x1: number, z0: number, z1: number, y = 0): void {
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) v.solid(x, y, z);
}

describe('TickSim reproduces the experiments done on the real 26.2 server', () => {
  it('locked-repeater D latch (exp1)', () => {
    const v = new Vox();
    floor(v, -1, 6, -4, 2);
    v.lever(0, 1, 0);
    v.dust(1, 1, 0);
    v.repeater(2, 1, 0, W);
    v.dust(3, 1, 0);
    v.lamp(4, 1, 0);
    v.lever(2, 1, -3);
    v.dust(2, 1, -2);
    v.repeater(2, 1, -1, N);
    const s = new TickSim(v);
    const R = () => s.litAt(2, 1, 0);
    const settle = () => s.run(12);
    settle();
    expect(R()).toBe(false);
    s.setLever(0, 1, 0, true); settle();
    expect(R()).toBe(true);
    s.setLever(2, 1, -3, true); settle();
    expect(s.lockedAt(2, 1, 0)).toBe(true);
    s.setLever(0, 1, 0, false); settle();
    expect(R()).toBe(true); // держит
    s.setLever(2, 1, -3, false); settle();
    expect(R()).toBe(false); // отпустило
    expect(s.lockedAt(2, 1, 0)).toBe(false);
  });

  it('master-slave flip-flop of locked repeaters (exp3)', () => {
    const v = new Vox();
    floor(v, -4, 6, -5, 5);
    v.lever(-2, 1, 0); v.dust(-1, 1, 0);
    v.repeater(0, 1, 0, W); v.repeater(1, 1, 0, W);
    v.dust(2, 1, 0);
    v.repeater(0, 1, -1, N); v.dust(0, 1, -2); v.lever(0, 1, -3);
    v.repeater(1, 1, 1, S); v.dust(1, 1, 2); v.lever(1, 1, 3, true);
    const s = new TickSim(v);
    const Q = () => s.powerAt(2, 1, 0) > 0;
    s.run(15);
    s.setLever(-2, 1, 0, true); s.run(15);
    expect(s.litAt(0, 1, 0)).toBe(true); expect(Q()).toBe(false);
    s.setLever(0, 1, -3, true); s.run(15);
    expect(s.lockedAt(0, 1, 0)).toBe(true); expect(Q()).toBe(false);
    s.setLever(1, 1, 3, false); s.run(15);
    expect(Q()).toBe(true);
    s.setLever(-2, 1, 0, false); s.run(15);
    expect(Q()).toBe(true);
    s.setLever(1, 1, 3, true); s.run(15);
    s.setLever(0, 1, -3, false); s.run(15);
    expect(s.litAt(0, 1, 0)).toBe(false); expect(Q()).toBe(true);
    s.setLever(0, 1, -3, true); s.run(15);
    s.setLever(1, 1, 3, false); s.run(15);
    expect(Q()).toBe(false);
  });

  it('comparator in subtract mode gates a barrel signal (exp2)', () => {
    const v = new Vox();
    floor(v, -1, 6, -5, 3);
    v.barrel(0, 1, 0, 15, Array(27).fill(1));
    v.comparator(1, 1, 0, W, true);
    v.dust(2, 1, 0);
    v.lamp(3, 1, 0);
    v.repeater(1, 1, -1, N);
    v.dust(1, 1, -2);
    v.lever(1, 1, -3);
    const s = new TickSim(v);
    s.run(20);
    expect(s.outAt(1, 1, 0)).toBe(15);
    expect(s.powerAt(2, 1, 0)).toBe(15);
    expect(s.litAt(3, 1, 0)).toBe(true);
    s.setLever(1, 1, -3, true); s.run(20);
    expect(s.outAt(1, 1, 0)).toBe(0);
    expect(s.litAt(3, 1, 0)).toBe(false);
  });

  it('2x2 barrel ROM with elevated bit lines (exp4)', () => {
    const PZ = 4, XB = [0, 8], Z0 = 4;
    const words = [[1, 0], [0, 1]];
    const v = new Vox();
    floor(v, -3, 14, -2, 16);
    const bl = Z0 + PZ * words.length;
    words.forEach((bits, w) => {
      const z = Z0 + PZ * w;
      v.lever(-1, 1, z - 2);
      for (let x = 0; x < 14; x++) v.dust(x, 1, z - 2);
      XB.forEach((x0, b) => {
        v.comparator(x0 + 1, 1, z, W, true);
        v.dust(x0 + 2, 1, z);
        v.solid(x0 + 3, 1, z);
        v.dust(x0 + 3, 2, z, false);
        v.repeater(x0 + 1, 1, z - 1, N);
        v.barrel(x0, 1, z, bits[b] ? 15 : 0, bits[b] ? Array(27).fill(1) : []);
      });
    });
    XB.forEach((x0) => {
      const xb = x0 + 4;
      for (let z = Z0 - 2; z < bl; z++) { v.solid(xb, 2, z); v.dust(xb, 3, z, false); }
      v.lamp(xb, 3, bl); v.solid(xb, 2, bl);
    });
    const s = new TickSim(v);
    const select = (w: number) => { for (let i = 0; i < words.length; i++) s.setLever(-1, 1, Z0 + PZ * i - 2, i !== w); s.run(40); };
    const lamps = () => XB.map((x0) => s.litAt(x0 + 4, 3, bl));
    select(0); expect(lamps()).toEqual([true, false]);
    select(1); expect(lamps()).toEqual([false, true]);
    select(-1); expect(lamps()).toEqual([false, false]);
  });
});
