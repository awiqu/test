import { describe, it, expect } from 'vitest';
import { compileMacro } from '../../src/cpu/macro';
import { Board } from '../../src/cpu/board';
import { TickSim } from '../../src/cpu/tick';
import { lampPart, leverPart } from '../../src/cpu/parts';

describe('board: macros joined by the router', () => {
  it('lever → NOT → (routed) → NOT → lamp', () => {
    const a = compileMacro('input x\nn = NOT(x)\noutput y = n\n');
    const b = compileMacro('input p\nq = NOT(p)\noutput r = q\n');
    const board = new Board(9);
    const pa = board.addMacro(a, 0, 20);
    const pb = board.addMacro(b, 40, 0);
    board.connect('a-to-b', pa.get('y')!.dust, [pb.get('p')!.dust]);
    // внешние устройства: рычаг слева от A, лампа справа от B
    const lv = board.addPart(leverPart(board.base, -14, 20, 'x'));
    board.connect('x', lv.get('out')!, [pa.get('x')!.dust]);
    const lp = board.addPart(lampPart(board.base, 120, 0, 'r'));
    board.connect('r', pb.get('r')!.dust, [lp.get('in')!]);
    const lx = -14, ly = 1, lz = 20, px = 120, py = 1, pz = 0;
    const rep = board.route({ maxLevel: 7 });
    expect(rep.ok, JSON.stringify(rep)).toBe(true);
    const sim = new TickSim(board.toVox());
    sim.run(100);
    expect(sim.litAt(px, py, pz)).toBe(false);
    sim.setLever(lx, ly, lz, true);
    sim.run(200);
    expect(sim.litAt(px, py, pz)).toBe(true);
    sim.setLever(lx, ly, lz, false);
    sim.run(200);
    expect(sim.litAt(px, py, pz)).toBe(false);
  });
});
