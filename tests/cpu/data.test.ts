import { describe, it, expect } from 'vitest';
import { Vox } from '../../src/cpu/vox';
import { TickSim } from '../../src/cpu/tick';
import { buildData, DataRow } from '../../src/cpu/dataarray';
import { K } from '../../src/compiler/voxel';

function setup(RA: number, D: number, rows: DataRow[]) {
  const v = new Vox();
  const lay = buildData(v, 0, 0, { RA, D, rows });
  const drive = (p: [number, number, number], dz = -1) => {
    v.lever(p[0], 1, p[2] + dz, false);
    return { x: p[0], z: p[2] + dz };
  };
  const addr = lay.addr.map((pair) => pair.map((p) => drive(p)));
  const nwm = drive(lay.nwm);
  const wbl = lay.wbl.map((p) => drive(p, 1));
  lay.rbl.forEach(([x, , z]) => v.set(x, 1, z + 1, { kind: K.Lamp, mat: 1 }));
  const sim = new TickSim(v);
  const lever = (p: { x: number; z: number }, on: boolean) => sim.setLever(p.x, 1, p.z, on);
  const setAddr = (a: number) => {
    for (let b = 0; b < RA; b++) {
      lever(addr[b][0], ((a >> b) & 1) === 1);
    }
  };
  const setData = (d: number) => wbl.forEach((p, j) => lever(p, ((d >> j) & 1) === 1));
  const read = () => lay.rbl.reduce((acc, [x, , z], j) => acc + ((sim.litAt(x, 1, z + 1) ? 1 : 0) << j), 0);
  const write = (a: number, d: number) => {
    setAddr(a);
    setData(d);
    sim.run(200);
    lever(nwm, false); // импульс записи (низкий уровень)
    sim.run(12);
    lever(nwm, true);
    sim.run(60);
  };
  lever(nwm, true);
  sim.run(200);
  return { v, lay, sim, setAddr, setData, read, write };
}

describe('data array: RAM words, output port with lamps, input port with levers', () => {
  it('writes and reads back independent words', () => {
    const rows: DataRow[] = [
      { addr: 0, kind: 'ram' },
      { addr: 1, kind: 'ram' },
      { addr: 2, kind: 'out', name: 'LEDS' },
      { addr: 3, kind: 'in', name: 'SW', device: 'lever' },
    ];
    const t = setup(2, 3, rows);
    // после включения всё нули
    for (let a = 0; a < 3; a++) {
      t.setAddr(a);
      t.sim.run(300);
      expect(t.read(), `initial ${a}`).toBe(0);
    }
    t.write(0, 5);
    t.write(1, 2);
    t.write(2, 7);
    const vals = [5, 2, 7];
    for (let a = 0; a < 3; a++) {
      t.setAddr(a);
      t.sim.run(300);
      expect(t.read(), `addr ${a}`).toBe(vals[a]);
    }
    // перезапись и стирание
    t.write(1, 0);
    t.write(0, 6);
    t.setAddr(1);
    t.sim.run(300);
    expect(t.read()).toBe(0);
    t.setAddr(0);
    t.sim.run(300);
    expect(t.read()).toBe(6);
    t.setAddr(2);
    t.sim.run(300);
    expect(t.read()).toBe(7);
    // лампы порта вывода
    expect(t.lay.lamps.map((l) => (t.sim.litAt(...l.pos) ? 1 : 0))).toEqual([1, 1, 1]);
    // порт ввода
    for (const inp of t.lay.inputs) {
      if (inp.bit === 1) t.sim.setLever(...inp.pos, true);
    }
    t.setAddr(3);
    t.sim.run(300);
    expect(t.read()).toBe(2);
    // запись в порт ввода никуда не попадает
    t.write(3, 7);
    t.sim.run(100);
    expect(t.read()).toBe(2);
  });

  it('a write changes only the addressed word (including the last row)', () => {
    const rows: DataRow[] = [
      { addr: 0, kind: 'ram' },
      { addr: 1, kind: 'ram' },
      { addr: 2, kind: 'out', name: 'LEDS', count: 4 },
      { addr: 3, kind: 'out', name: 'SEG', count: 4 },
    ];
    const t = setup(2, 4, rows);
    const words = () => t.lay.cell.map((cs) => cs.reduce((acc, c, j) => acc + ((c && t.sim.litAt(...c) ? 1 : 0) << j), 0));
    const expected = [0, 0, 0, 0];
    for (const [a, d] of [[0, 3], [1, 5], [2, 9], [3, 6], [0, 1], [1, 2], [2, 4], [3, 15], [0, 0], [1, 7]] as const) {
      t.write(a, d);
      expected[a] = d;
      expect(words(), `write ${a}=${d}`).toEqual(expected);
    }
  });

  it('acc4-sized array: 10 RAM words + 3 ports, 4-bit data, 4-bit address', () => {
    const rows: DataRow[] = [];
    for (let a = 0; a < 10; a++) rows.push({ addr: a, kind: 'ram' });
    rows.push({ addr: 13, kind: 'out', name: 'LEDS' }, { addr: 14, kind: 'in', name: 'SW', device: 'lever' }, { addr: 15, kind: 'out', name: 'SEG' });
    const t = setup(4, 4, rows);
    const vals = [3, 9, 0, 15, 6, 10, 1, 8, 12, 5];
    vals.forEach((v, a) => t.write(a, v));
    t.write(13, 11);
    t.write(15, 4);
    for (let a = 0; a < 10; a++) {
      t.setAddr(a);
      t.sim.run(400);
      expect(t.read(), `ram ${a}`).toBe(vals[a]);
    }
    for (const [a, v] of [[13, 11], [15, 4], [10, 0], [12, 0]] as const) {
      t.setAddr(a);
      t.sim.run(400);
      expect(t.read(), `port ${a}`).toBe(v);
    }
    t.lay.inputs.filter((i) => i.bit === 0 || i.bit === 3).forEach((i) => t.sim.setLever(...i.pos, true));
    t.setAddr(14);
    t.sim.run(400);
    expect(t.read()).toBe(9);
  });
});
