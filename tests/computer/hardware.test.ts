import { describe, it, expect } from 'vitest';
import { parseNetlist } from '../../src/model/netlist';
import { evaluate, gateFunction } from '../../src/sim/logic';
import { compile, defaultSettings } from '../../src/compiler/compile';
import { newProject } from '../../src/computer/project';
import { HARDWARE, adderNetlist, decoderNetlist, equalityNetlist, instructionDecoderNetlist, latchRegisterNetlist, muxNetlist } from '../../src/computer/hardware';
import { Circuit } from '../../src/model/types';

function load(text: string): Circuit {
  const r = parseNetlist(text);
  expect(r.issues.filter((i) => i.level === 'error'), text).toEqual([]);
  return r.circuit!;
}

/** Вычисляет схему: входы по меткам, возвращает выходы по меткам. */
function run(c: Circuit, ins: Record<string, number>): Record<string, number> {
  const vals = new Map<string, boolean>();
  for (const g of c.gates) if (g.type === 'INPUT') vals.set(g.id, !!ins[g.label]);
  const st = evaluate(c, vals);
  const out: Record<string, number> = {};
  for (const g of c.gates) if (g.type === 'OUTPUT') out[g.label] = st.out.get(g.id) ? 1 : 0;
  return out;
}

describe('hardware generators', () => {
  it('every generator produces a parsable netlist', () => {
    const p = newProject('acc4');
    for (const g of HARDWARE) {
      const values = Object.fromEntries(g.params(p).map((x) => [x.id, x.value]));
      load(g.build(values, p));
    }
  });

  it('decoders are one-hot for 1…6 bits', () => {
    for (let bits = 1; bits <= 6; bits++) {
      const c = load(decoderNetlist(bits));
      for (let v = 0; v < 2 ** bits; v++) {
        const ins: Record<string, number> = {};
        for (let i = 0; i < bits; i++) ins[`a${i}`] = (v >> i) & 1;
        const out = run(c, ins);
        for (let y = 0; y < 2 ** bits; y++) expect(out[`y${y}`], `bits=${bits} v=${v} y=${y}`).toBe(y === v ? 1 : 0);
      }
    }
  });

  it('instruction decoder selects exactly the instruction with the given opcode', () => {
    for (const preset of ['acc4', 'risc8'] as const) {
      const p = newProject(preset);
      const c = load(instructionDecoderNetlist(p));
      const k = p.spec.opcodeBits;
      for (const inst of p.instructions) {
        const ins: Record<string, number> = {};
        for (let i = 0; i < k; i++) ins[`op${i}`] = (inst.opcode >> i) & 1;
        const out = run(c, ins);
        for (const other of p.instructions) expect(out[other.mnemonic], `${preset}: opcode ${inst.opcode} vs ${other.mnemonic}`).toBe(other === inst ? 1 : 0);
      }
    }
  });

  it('adder adds, equality compares, mux selects, latch register stores', () => {
    const add = load(adderNetlist(4));
    for (let a = 0; a < 16; a += 3) for (let b = 0; b < 16; b += 5) for (const cin of [0, 1]) {
      const ins: Record<string, number> = { cin };
      for (let i = 0; i < 4; i++) { ins[`a${i}`] = (a >> i) & 1; ins[`b${i}`] = (b >> i) & 1; }
      const out = run(add, ins);
      const sum = a + b + cin;
      const got = [0, 1, 2, 3].reduce((acc, i) => acc + out[`s${i}`] * 2 ** i, 0) + out.cout * 16;
      expect(got, `${a}+${b}+${cin}`).toBe(sum);
    }
    const eq = load(equalityNetlist(3));
    for (let a = 0; a < 8; a++) for (let b = 0; b < 8; b++) {
      const ins: Record<string, number> = {};
      for (let i = 0; i < 3; i++) { ins[`a${i}`] = (a >> i) & 1; ins[`b${i}`] = (b >> i) & 1; }
      expect(run(eq, ins).equal).toBe(a === b ? 1 : 0);
    }
    const mux = load(muxNetlist(2));
    for (let m = 0; m < 32; m++) {
      const ins = { a0: m & 1, a1: (m >> 1) & 1, b0: (m >> 2) & 1, b1: (m >> 3) & 1, sel: (m >> 4) & 1 };
      const out = run(mux, ins);
      const pick = ins.sel ? [ins.b0, ins.b1] : [ins.a0, ins.a1];
      expect([out.y0, out.y1]).toEqual(pick);
    }
    // защёлка: состояние переносится между вызовами (evaluate() без памяти для хранения не годится)
    const reg = load(latchRegisterNetlist(2));
    const state = new Map<string, boolean>();
    const settle = (ins: Record<string, boolean>) => {
      for (const g of reg.gates) if (g.type === 'INPUT') state.set(g.id, ins[g.label]);
      for (let iter = 0; iter < 60; iter++) {
        let changed = false;
        for (const g of reg.gates) {
          if (g.type === 'INPUT') continue;
          const inputs = reg.wires.filter((w) => w.to === g.id).sort((a, b) => a.toPin - b.toPin).map((w) => state.get(w.from) ?? false);
          const v = g.type === 'OUTPUT' ? inputs[0] : gateFunction(g, inputs);
          if (state.get(g.id) !== v) {
            state.set(g.id, v);
            changed = true;
          }
        }
        if (!changed) break;
      }
      return reg.gates.filter((g) => g.type === 'OUTPUT').map((g) => (state.get(g.id) ? 1 : 0));
    };
    expect(settle({ d0: true, d1: false, we: true })).toEqual([1, 0]);
    expect(settle({ d0: false, d1: true, we: false })).toEqual([1, 0]); // удерживает
    expect(settle({ d0: false, d1: true, we: true })).toEqual([0, 1]);
    expect(settle({ d0: true, d1: false, we: false })).toEqual([0, 1]);
  });

  it('small generated circuits compile to verified redstone', () => {
    for (const text of [decoderNetlist(3), adderNetlist(2), instructionDecoderNetlist(newProject('acc4'))]) {
      const res = compile(load(text), defaultSettings());
      expect(res.ok, res.issues.map((i) => i.message).join('; ')).toBe(true);
    }
  }, 120000);
});
