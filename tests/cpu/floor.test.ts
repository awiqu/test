import { describe, it, expect } from 'vitest';
import { Vox } from '../../src/cpu/vox';
import { TickSim } from '../../src/cpu/tick';
import { leverCard, lampCard, placeMacro } from '../../src/cpu/cards';
import { getMacro } from '../../src/cpu/macrolib';
import { macroSettings } from '../../src/cpu/macro';
import { aluMuxNetlist } from '../../src/cpu/hwnets';
import { FNet, FPin, routeFloor } from '../../src/cpu/floor';
import { findShorts } from '../../src/cpu/netcheck';
import { rng } from '../helpers';

type XYZ = [number, number, number];

/** Рычаги и лампы вразброс по полю, между ними — настоящий макрос (препятствие для проводов на земле, но не поверх). */
function scene(seed: number, nLevers: number, nLamps: number, field: number) {
  const r = rng(seed);
  const v = new Vox();
  const m = getMacro(aluMuxNetlist({ D: 4, P: 4, RA: 4, OB: 4, flags: [], used: new Set(['eSum', 'eAnd', 'eB']) } as never), macroSettings());
  const mx = Math.floor(field / 2) - 20;
  const mz = Math.floor(field / 2) - 20;
  placeMacro(v, 'obstacle', m, mx, mz);
  const taken: { x0: number; x1: number; z0: number; z1: number }[] = [{ x0: mx - 8, x1: mx + 60, z0: mz - 8, z1: mz + 40 }];
  const free = (x: number, z: number): boolean => !taken.some((t) => x >= t.x0 - 15 && x <= t.x1 + 15 && z >= t.z0 - 3 && z <= t.z1 + 3);
  const place = (): [number, number] => {
    for (let k = 0; k < 500; k++) {
      const x = 30 + Math.floor(r() * (field - 60));
      const z = 10 + Math.floor(r() * (field - 20));
      if (free(x, z)) {
        taken.push({ x0: x - 2, x1: x + 3, z0: z - 1, z1: z + 1 });
        return [x, z];
      }
    }
    throw new Error('нет места');
  };
  const levers: { pos: XYZ; pin: FPin }[] = [];
  for (let i = 0; i < nLevers; i++) {
    const [x, z] = place();
    const c = leverCard(v, `lev${i}`, x, z);
    levers.push({ pos: c.lever, pin: { x: x + 1, y: 1, z, dx: 1, dz: 0 } });
  }
  const lamps: { pos: XYZ; pin: FPin; lever: number }[] = [];
  for (let i = 0; i < nLamps; i++) {
    const [x, z] = place();
    const c = lampCard(v, `lamp${i}`, x, z);
    lamps.push({ pos: c.lamp, pin: { x: x - 1, y: 1, z, dx: -1, dz: 0, boost: i % 2 === 0 }, lever: Math.floor(r() * nLevers) });
  }
  const nets: FNet[] = levers.map((l, i) => ({ name: `n${i}`, src: l.pin, sinks: lamps.filter((m2) => m2.lever === i).map((m2) => m2.pin) })).filter((n) => n.sinks.length > 0);
  return { v, levers, lamps, nets };
}

describe('over-cell floor routing', () => {
  for (const seed of [4, 5, 6]) {
    it(`dense scene ${seed}: 12 levers, 26 lamps`, () => {
      const { v, levers, lamps, nets } = scene(seed, 12, 26, 230);
      const st = routeFloor(v, nets, { layers: 2 });
      process.stderr.write(`dense ${seed}: ${JSON.stringify(st)}\n`);
      expect(findShorts(v)).toEqual([]);
      const sim = new TickSim(v);
      sim.settle(30000);
      for (let i = 0; i < levers.length; i++) {
        sim.setLever(...levers[i].pos, true);
        sim.run(1200);
        for (const l of lamps) expect(sim.litAt(...l.pos), `lever ${i} on, lamp of lever ${l.lever}`).toBe(l.lever === i);
        sim.setLever(...levers[i].pos, false);
        sim.run(1200);
      }
    }, 900000);
  }

  for (const layers of [1, 3]) {
    it(`dense scene with ${layers} base layer(s) (extra layer added on demand)`, () => {
      const { v, levers, lamps, nets } = scene(4, 12, 26, 230);
      const st = routeFloor(v, nets, { layers });
      process.stderr.write(`layers ${layers}: ${JSON.stringify(st)}\n`);
      expect(findShorts(v)).toEqual([]);
      const sim = new TickSim(v);
      sim.settle(30000);
      for (let i = 0; i < levers.length; i++) {
        sim.setLever(...levers[i].pos, true);
        sim.run(1200);
        for (const l of lamps) expect(sim.litAt(...l.pos), `lever ${i} on, lamp of lever ${l.lever}`).toBe(l.lever === i);
        sim.setLever(...levers[i].pos, false);
        sim.run(1200);
      }
    }, 900000);
  }

  for (const seed of [1, 2, 3]) {
    it(`levers → lamps, scene ${seed}: no shorts, lamps follow their lever`, () => {
      const { v, levers, lamps, nets } = scene(seed, 5, 9, 160);
      const st = routeFloor(v, nets, { layers: 2 });
      process.stderr.write(`scene ${seed}: ${JSON.stringify(st)}\n`);
      expect(findShorts(v)).toEqual([]);
      const sim = new TickSim(v);
      sim.settle(20000);
      for (const l of lamps) expect(sim.litAt(...l.pos)).toBe(false);
      for (let i = 0; i < levers.length; i++) {
        sim.setLever(...levers[i].pos, true);
        sim.run(900);
        for (const l of lamps) expect(sim.litAt(...l.pos), `lever ${i} on, lamp of lever ${l.lever}`).toBe(l.lever === i);
        sim.setLever(...levers[i].pos, false);
        sim.run(900);
      }
    }, 600000);
  }
});
