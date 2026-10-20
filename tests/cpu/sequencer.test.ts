import { describe, it, expect } from 'vitest';
import { TickSim } from '../../src/cpu/tick';
import { Board } from '../../src/cpu/board';
import { buildRom } from '../../src/cpu/arrays';
import { ffPart, leverPart } from '../../src/cpu/parts';
import { compileMacro } from '../../src/cpu/macro';
import { clockNetlist, pcLogicNetlist } from '../../src/cpu/netlists';

describe('sequencer: PC flip-flops + PC logic + ROM + clock', () => {
  it('steps through ROM addresses with jump and reset', () => {
    const P = 2;
    const rows = 4;
    const content = [[0, 0, 0], [0, 0, 0], [1, 0, 1], [0, 0, 0]]; // cols: ob0, ob1, take
    const board = new Board(9);
    const base = board.base;
    const rom = buildRom(base, 0, 0, { P, rows, cols: 3, bit: (w, j) => content[w][j] === 1, full: false });
    board.guard(rom.bounds.x0 - 1, rom.bounds.z0 - 1, rom.bounds.x1 + 1, rom.bounds.z1 + 1, 3, [...rom.addr.flat(), ...rom.out]);
    // триггеры PC над ПЗУ
    const ffs = Array.from({ length: P }, (_, i) => board.addPart(ffPart(base, 6 + 12 * i, -16, `pc${i}`)));
    const clock = compileMacro(clockNetlist());
    const pcl = compileMacro(pcLogicNetlist(P));
    const pclPins = board.addMacro(pcl, 0, -110);
    const clkX = pcl.size.sx + 24;
    const clkPins = board.addMacro(clock, clkX, -110);
    const levers = {
      clk: board.addPart(leverPart(base, clkX - 12, -99, 'clk')),
      reset: board.addPart(leverPart(base, -12, -95, 'reset')),
    };
    board.connect('clk', levers.clk.get('out')!, [clkPins.get('clk')!.dust]);
    board.connect('reset', levers.reset.get('out')!, [pclPins.get('reset')!.dust]);
    board.connect('lkM', clkPins.get('lkM')!.dust, ffs.map((f) => f.get('lkM')!));
    board.connect('lkS', clkPins.get('lkS')!.dust, ffs.map((f) => f.get('lkS')!));
    for (let i = 0; i < P; i++) {
      board.connect(`pc${i}`, ffs[i].get('Q')!, [pclPins.get(`pc${i}`)!.dust, rom.addr[i][0]]);
      board.connect(`npc${i}`, pclPins.get(`npc${i}`)!.dust, [rom.addr[i][1]]);
      board.connect(`d${i}`, pclPins.get(`d${i}`)!.dust, [ffs[i].get('D')!]);
      board.connect(`ob${i}`, rom.out[i], [pclPins.get(`ob${i}`)!.dust]);
    }
    board.connect('take', rom.out[2], [pclPins.get('take')!.dust]);
    const rep = board.route({ maxLevel: 7, maxExpansions: 1500000 });
    expect(rep.ok, JSON.stringify(rep)).toBe(true);

    const vox = board.toVox();
    const sim = new TickSim(vox);
    const lever = (name: string) => (name === 'clk' ? [clkX - 12, 1, -99] : [-12, 1, -95]) as [number, number, number];
    const setL = (n: string, on: boolean) => sim.setLever(...lever(n), on);
    const pc = () => ffs.reduce((a, f, i) => a + ((sim.powerAt(...f.get('Q')!) > 0 ? 1 : 0) << i), 0);
    const cycle = () => { setL("clk", true); sim.run(500); setL("clk", false); sim.run(500); };
    // сброс
    setL('reset', true);
    cycle(); cycle();
    expect(pc()).toBe(0);
    setL('reset', false);
    const seen: number[] = [];
    for (let k = 0; k < 7; k++) { cycle(); seen.push(pc()); }
    expect(seen).toEqual([1, 2, 1, 2, 1, 2, 1]);
  });
});
