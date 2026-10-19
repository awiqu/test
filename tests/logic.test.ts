import { describe, it, expect } from 'vitest';
import { addWire, createGate, exampleCircuit } from '../src/model/circuit';
import { evaluate, hasCycle, truthTable } from '../src/sim/logic';
import { Circuit } from '../src/model/types';

describe('logic simulation', () => {
  it('example circuit truth table matches the schematic', () => {
    const tt = truthTable(exampleCircuit())!;
    expect(tt.inputs.map((g) => g.label)).toEqual(['x', 'y', 'z']);
    expect(tt.outputs.map((g) => g.label)).toEqual(['w0', 'w1']);
    // w0 = (x·y + ¬x·y) · ¬x·y = ¬x·y ; w1 = (z + ¬y) · ¬x·y = ¬x·y·z
    for (const r of tt.rows) {
      const [x, y, z] = r.ins;
      const a2 = !x && y;
      expect(r.outs[0]).toBe(a2);
      expect(r.outs[1]).toBe(a2 && z);
    }
  });

  it('detects feedback loops and settles an SR latch', () => {
    let c: Circuit = { gates: [], wires: [] };
    const s = createGate('INPUT', 0, 0, 's');
    const r = createGate('INPUT', 0, 90, 'r');
    const n1 = createGate('NOR', 150, 0);
    const n2 = createGate('NOR', 150, 90);
    c.gates.push(s, r, n1, n2);
    c = addWire(c, r.id, n1.id, 0);
    c = addWire(c, n2.id, n1.id, 1);
    c = addWire(c, s.id, n2.id, 0);
    c = addWire(c, n1.id, n2.id, 1);
    expect(hasCycle(c)).toBe(true);
    const set = { ...c, gates: c.gates.map((g) => (g.id === s.id ? { ...g, value: true } : g)) };
    const st = evaluate(set);
    expect(st.stable).toBe(true);
    expect(st.out.get(n1.id)).toBe(true); // Q = 1 после Set
  });

  it('n-ary gates', () => {
    const mk = (type: 'XOR' | 'AND' | 'NOR', vals: boolean[]) => {
      let c: Circuit = { gates: [], wires: [] };
      const g = createGate(type, 200, 0);
      g.inputs = vals.length;
      const ins = vals.map((v, i) => ({ ...createGate('INPUT', 0, i * 30), value: v }));
      c.gates.push(g, ...ins);
      ins.forEach((i, p) => (c = addWire(c, i.id, g.id, p)));
      return evaluate(c).out.get(g.id);
    };
    expect(mk('XOR', [true, true, true])).toBe(true);
    expect(mk('XOR', [true, true, false, false])).toBe(false);
    expect(mk('AND', [true, true, true, true])).toBe(true);
    expect(mk('NOR', [false, false, false])).toBe(true);
  });
});
