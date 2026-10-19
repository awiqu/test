import { describe, it, expect } from 'vitest';
import { exampleCircuit, gateSize } from '../src/model/circuit';
import { parseNetlist, printNetlist } from '../src/model/netlist';
import { truthTable } from '../src/sim/logic';
import { compile, defaultSettings } from '../src/compiler/compile';
import { Circuit } from '../src/model/types';
import { randomCircuit } from './helpers';

const SRC = `
# пример из задания
input x y z
nx = NOT(x)
ny = NOT(y)
a1 = AND(x, y)
a2 = AND(y, nx)
o3 = OR(z, ny)
o1 = OR(a1, a2)
p0 = AND(o1, a2)
p1 = AND(o3, a2)
output w0 = p0
output w1 = p1
`;

function same(a: Circuit, b: Circuit): void {
  const ta = truthTable(a)!;
  const tb = truthTable(b)!;
  expect(tb.inputs.map((g) => g.label)).toEqual(ta.inputs.map((g) => g.label));
  expect(tb.outputs.map((g) => g.label)).toEqual(ta.outputs.map((g) => g.label));
  expect(tb.rows).toEqual(ta.rows);
}

describe('netlist', () => {
  it('parses the sample and matches the example circuit truth table', () => {
    const r = parseNetlist(SRC);
    expect(r.issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(r.stats).toEqual({ inputs: 3, outputs: 2, gates: 8 });
    same(exampleCircuit(), r.circuit!);
  });

  it('lays gates out left-to-right without overlaps', () => {
    const c = parseNetlist(SRC).circuit!;
    const byId = new Map(c.gates.map((g) => [g.id, g]));
    for (const w of c.wires) expect(byId.get(w.from)!.x).toBeLessThan(byId.get(w.to)!.x);
    for (let i = 0; i < c.gates.length; i++) {
      for (let j = i + 1; j < c.gates.length; j++) {
        const a = c.gates[i];
        const b = c.gates[j];
        const sa = gateSize(a);
        const sb = gateSize(b);
        const overlap = a.x < b.x + sb.w && b.x < a.x + sa.w && a.y < b.y + sb.h && b.y < a.y + sa.h;
        expect(overlap, `${a.label}/${b.label}`).toBe(false);
      }
    }
    // входы идут сверху вниз в объявленном порядке
    const ins = c.gates.filter((g) => g.type === 'INPUT').sort((a, b) => a.y - b.y);
    expect(ins.map((g) => g.label)).toEqual(['x', 'y', 'z']);
  });

  it('round-trips through print → parse (example and random circuits)', () => {
    same(exampleCircuit(), parseNetlist(printNetlist(exampleCircuit())).circuit!);
    for (let seed = 1; seed <= 12; seed++) {
      const c = randomCircuit(seed, 3, 8);
      const text = printNetlist(c);
      const r = parseNetlist(text);
      const errors = r.issues.filter((i) => i.level === 'error');
      expect(errors, text).toEqual([]);
      same(c, r.circuit!);
    }
  });

  it('supports forward references (SR latch) and BUF delay', () => {
    const r = parseNetlist(`input s r
q = NOR(r, nq)
nq = NOR(s, q)
d = BUF(q, delay=3)
output Q = d
output NQ = nq`);
    expect(r.issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(r.circuit!.gates.find((g) => g.label === 'd')!.delay).toBe(3);
  });

  it('compiles a parsed circuit to a verified redstone build', () => {
    const r = parseNetlist(SRC);
    const res = compile(r.circuit!, defaultSettings());
    expect(res.ok, res.issues.map((i) => i.message).join('; ')).toBe(true);
  });

  it('reports errors with line numbers', () => {
    const r = parseNetlist(`input a b
x = FOO(a, b)
y = AND(a, zz)
z = AND(a)
a = NOT(b)
output q = y
output q = y
???`);
    expect(r.circuit).toBeNull();
    const msgs = r.issues.map((i) => `${i.line}: ${i.message}`).join('\n');
    expect(msgs).toMatch(/2: Неизвестный тип гейта «FOO»/);
    expect(msgs).toMatch(/3: Сигнал «zz» не объявлен/);
    expect(msgs).toMatch(/4: AND: нужно 2–4 входов/);
    expect(msgs).toMatch(/5: Имя «a» уже объявлено в строке 1/);
    expect(msgs).toMatch(/7: Выход «q» уже объявлен/);
    expect(msgs).toMatch(/8: Не понимаю строку/);
  });
});
