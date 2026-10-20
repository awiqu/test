import { describe, it, expect } from 'vitest';
import { Vox } from '../../src/cpu/vox';
import { TickSim } from '../../src/cpu/tick';
import { Bus, BusNet } from '../../src/cpu/bus';

/** Карточка-источник на востоке: рычаг и пыль-вывод справа от него. */
function eastSource(v: Vox, x: number, z: number): { pin: { x: number; z: number }; lever: [number, number, number] } {
  v.lever(x - 1, 1, z, false);
  v.dust(x, 1, z);
  return { pin: { x, z }, lever: [x - 1, 1, z] };
}
/** Источник на западной стороне карточки: пыль-вывод слева от рычага. */
function westSource(v: Vox, x: number, z: number): { pin: { x: number; z: number }; lever: [number, number, number] } {
  v.dust(x, 1, z);
  v.lever(x + 1, 1, z, false);
  return { pin: { x, z }, lever: [x + 1, 1, z] };
}
/** Приёмник: пыль-вывод и лампа справа. */
function sinkLamp(v: Vox, x: number, z: number): { pin: { x: number; z: number }; lamp: [number, number, number] } {
  v.dust(x, 1, z);
  v.lamp(x + 1, 1, z);
  return { pin: { x, z }, lamp: [x + 1, 1, z] };
}

describe('bus interconnect', () => {
  it('routes east-source (wrap), west-source and rail nets without crossings', () => {
    const v = new Vox();
    const xS = 60; // западная граница стека
    const se = eastSource(v, xS + 30, 40);
    const sw = westSource(v, xS, 60);
    const sinks = [sinkLamp(v, xS, 30), sinkLamp(v, xS, 80), sinkLamp(v, xS, 100)];
    const sinks2 = [sinkLamp(v, xS, 50), sinkLamp(v, xS, 120)];
    const sinks3 = [sinkLamp(v, xS, 70), sinkLamp(v, xS, 90)];
    // «рельса»: рычаг питает верхний конец магистрали
    const railX = 8;
    v.lever(railX, 3, 9, false);
    const bus = new Bus({ leftXs: [20, 24, 28], rightXs: [120, 124], wrapZs: [10, 14] });
    const nets: BusNet[] = [
      { name: 'wrapped', src: { kind: 'east', pin: se.pin }, sinks: sinks.map((s) => s.pin) },
      { name: 'west', src: { kind: 'west', pin: sw.pin }, sinks: sinks2.map((s) => s.pin) },
      { name: 'rail', src: { kind: 'rail', z: 10 }, x: railX, sinks: sinks3.map((s) => s.pin) },
    ];
    nets.forEach((n) => bus.add(n));
    bus.build(v);
    const sim = new TickSim(v);
    const lit = (l: [number, number, number][]) => l.map((p) => (sim.litAt(...p) ? 1 : 0));
    const L1 = sinks.map((s) => s.lamp), L2 = sinks2.map((s) => s.lamp), L3 = sinks3.map((s) => s.lamp);
    sim.run(600);
    expect([lit(L1), lit(L2), lit(L3)]).toEqual([[0, 0, 0], [0, 0], [0, 0]]);
    sim.setLever(...se.lever, true);
    sim.run(2000);
    expect([lit(L1), lit(L2), lit(L3)]).toEqual([[1, 1, 1], [0, 0], [0, 0]]);
    sim.setLever(...sw.lever, true);
    sim.run(2000);
    expect([lit(L1), lit(L2), lit(L3)]).toEqual([[1, 1, 1], [1, 1], [0, 0]]);
    sim.setLever(railX, 3, 9, true);
    sim.run(2000);
    expect([lit(L1), lit(L2), lit(L3)]).toEqual([[1, 1, 1], [1, 1], [1, 1]]);
    sim.setLever(...se.lever, false);
    sim.run(2000);
    expect([lit(L1), lit(L2), lit(L3)]).toEqual([[0, 0, 0], [1, 1], [1, 1]]);
    sim.setLever(...sw.lever, false);
    sim.setLever(railX, 3, 9, false);
    sim.run(2000);
    expect([lit(L1), lit(L2), lit(L3)]).toEqual([[0, 0, 0], [0, 0], [0, 0]]);
  });
});
