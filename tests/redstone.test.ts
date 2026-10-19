import { describe, it, expect } from 'vitest';
import { Grid, K, MAT_GATE, MAT_WIRE } from '../src/compiler/voxel';
import { RedstoneSim } from '../src/redstone/sim';
import { dustShape } from '../src/redstone/rules';

/** Мелкие эталонные конструкции, поведение которых в игре известно. */
function world(): Grid {
  return new Grid(40, 8, 8);
}
const floor = (g: Grid, x: number, z: number, y = 0) => g.set(x, y, z, K.Solid, { mat: MAT_WIRE });

describe('redstone simulator — known vanilla behaviour', () => {
  it('lever powers dust, dust decays by 1 per block, lamp at the end lights', () => {
    const g = world();
    for (let x = 0; x <= 12; x++) floor(g, x, 3);
    g.set(0, 1, 3, K.Lever, { dir: 1 });
    for (let x = 1; x <= 10; x++) g.set(x, 1, 3, K.Dust, { net: 0 });
    g.set(11, 1, 3, K.Lamp, { mat: MAT_GATE });
    const sim = new RedstoneSim(g);
    sim.setLever(g.idx(0, 1, 3), true);
    expect(sim.settle()).toBe(true);
    expect(sim.power[g.idx(1, 1, 3)]).toBe(15);
    expect(sim.power[g.idx(10, 1, 3)]).toBe(6);
    expect(sim.lit[g.idx(11, 1, 3)]).toBe(1);
    sim.setLever(g.idx(0, 1, 3), false);
    sim.settle();
    expect(sim.lit[g.idx(11, 1, 3)]).toBe(0);
  });

  it('dust signal dies after 15 blocks; a repeater restores it', () => {
    const build = (withRepeater: boolean) => {
      const g = new Grid(60, 8, 8);
      for (let x = 0; x <= 40; x++) floor(g, x, 3);
      g.set(0, 1, 3, K.Lever, { dir: 1 });
      for (let x = 1; x <= 30; x++) g.set(x, 1, 3, K.Dust, { net: 0 });
      if (withRepeater) g.set(15, 1, 3, K.Repeater, { dir: 3, delay: 1 });
      g.set(31, 1, 3, K.Lamp, { mat: MAT_GATE });
      const sim = new RedstoneSim(g);
      sim.setLever(g.idx(0, 1, 3), true);
      sim.settle();
      return sim.lit[g.idx(31, 1, 3)];
    };
    expect(build(false)).toBe(0);
    expect(build(true)).toBe(1);
  });

  it('dust → block → wall torch inverts (NOT gate)', () => {
    const g = world();
    for (let x = 0; x <= 8; x++) floor(g, x, 3);
    g.set(0, 1, 3, K.Lever, { dir: 1 });
    g.set(1, 1, 3, K.Dust, { net: 0 });
    g.set(2, 1, 3, K.Dust, { net: 0 });
    g.set(3, 1, 3, K.Solid, { mat: MAT_GATE });
    g.set(4, 1, 3, K.Torch, { dir: 1 });
    g.set(5, 1, 3, K.Dust, { net: 1 });
    g.set(6, 1, 3, K.Lamp, { mat: MAT_GATE });
    const sim = new RedstoneSim(g);
    sim.settle();
    expect(sim.lit[g.idx(6, 1, 3)]).toBe(1); // вход 0 → выход 1
    sim.setLever(g.idx(0, 1, 3), true);
    sim.settle();
    expect(sim.lit[g.idx(4, 1, 3)]).toBe(0); // факел погас
    expect(sim.lit[g.idx(6, 1, 3)]).toBe(0);
  });

  it('dust that arrives from the side does not power a block it does not point at', () => {
    const g = world();
    for (let x = 0; x <= 8; x++) for (let z = 0; z <= 5; z++) floor(g, x, z);
    g.set(0, 1, 3, K.Lever, { dir: 1 });
    g.set(1, 1, 3, K.Dust, { net: 0 });
    g.set(2, 1, 3, K.Dust, { net: 0 });
    g.set(2, 1, 2, K.Dust, { net: 0 }); // поворот на север → точка (2,3) соединена с W и N
    g.set(3, 1, 3, K.Solid, { mat: MAT_GATE });
    g.set(4, 1, 3, K.Torch, { dir: 1 });
    const sim = new RedstoneSim(g);
    sim.setLever(g.idx(0, 1, 3), true);
    sim.settle();
    // (2,3) соединена с запада и севера (угол) → блок на востоке не запитан → факел горит
    expect(dustShape(g, 2, 1, 3)).toEqual([1, 0, 0, 1]);
    expect(sim.lit[g.idx(4, 1, 3)]).toBe(1);
  });

  it('bridge: dust over a block over another dust does not connect', () => {
    const g = world();
    for (let x = 0; x <= 10; x++) floor(g, x, 4);
    for (let z = 0; z <= 8; z++) floor(g, 5, z);
    // нижняя линия по X на уровне 1 (z=4)
    g.set(0, 1, 4, K.Lever, { dir: 1 });
    for (let x = 1; x <= 9; x++) if (x !== 5) g.set(x, 1, 4, K.Dust, { net: 0 });
    // (5,1,4) — пыль нижней линии
    g.set(5, 1, 4, K.Dust, { net: 0 });
    // мост по Z: уровень 3 над опорой на уровне 2 над нижней пылью
    g.set(5, 2, 4, K.Solid, { mat: MAT_WIRE });
    g.set(5, 3, 4, K.Dust, { net: 1 });
    const sim = new RedstoneSim(g);
    sim.setLever(g.idx(0, 1, 4), true);
    sim.settle();
    expect(sim.power[g.idx(5, 1, 4)]).toBeGreaterThan(0);
    expect(sim.power[g.idx(5, 3, 4)]).toBe(0);
  });

  it('dust shape: single connection extends to a line, lone dust becomes a cross', () => {
    const g = world();
    for (let x = 0; x <= 8; x++) floor(g, x, 3);
    g.set(1, 1, 3, K.Dust, { net: 0 });
    g.set(2, 1, 3, K.Dust, { net: 0 });
    g.set(6, 1, 3, K.Dust, { net: 1 });
    expect(dustShape(g, 1, 1, 3)).toEqual([0, 1, 0, 1]);
    expect(dustShape(g, 6, 1, 3)).toEqual([1, 1, 1, 1]);
  });
});
