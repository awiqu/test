import { describe, it, expect } from 'vitest';
import { compileMacro, Macro } from '../../src/cpu/macro';
import { TickSim } from '../../src/cpu/tick';
import { Feat, aluANetlist, aluMuxNetlist, flagsNetlist, pcSliceNetlist, takeNetlist } from '../../src/cpu/hwnets';
import { CtlName, CTL_NAMES } from '../../src/cpu/micro';
import { rng } from '../helpers';

const T0 = performance.now();
const log = (s: string) => process.stderr.write(`[${Math.round((performance.now() - T0) / 100) / 10}s] ${s}\n`);

type XYZ = [number, number, number];

/** Прогоняет макрос в тиковом симуляторе: входы — рычаги в подходах, выходы — лампы. */
function evaluator(m: Macro) {
  const sim = new TickSim(m.testVox);
  const ins = [...m.pins.values()].filter((p) => p.kind === 'in');
  const outs = [...m.pins.values()].filter((p) => p.kind === 'out');
  return (vec: Record<string, number>): Record<string, number> => {
    for (const p of ins) sim.setLever(...(p.approach as XYZ), !!vec[p.name]);
    sim.settle(3000);
    const r: Record<string, number> = {};
    for (const p of outs) r[p.name] = sim.litAt(...(p.approach as XYZ)) ? 1 : 0;
    return r;
  };
}

function feat(over: Omit<Partial<Feat>, 'used'> & { used: CtlName[] }): Feat {
  return { D: 4, P: 4, RA: 4, OB: 4, flags: ['Z', 'C', 'N', 'V'], ...over, used: new Set(over.used) };
}

describe('hardware macros compile and behave like their equations', () => {
  it('PC slice', () => {
    for (const hasTake of [true, false]) {
      const m = compileMacro(pcSliceNetlist(hasTake, false));
      log(`pc slice take=${hasTake}: ${m.stats.gates} gates, ${m.stats.ms} ms, ${m.size.sx}x${m.size.sz}`);
      const ev = evaluator(m);
      for (let mask = 0; mask < 64; mask++) {
        const pc = mask & 1, ob = (mask >> 1) & 1, c = (mask >> 2) & 1, nreset = (mask >> 3) & 1, take = hasTake ? (mask >> 4) & 1 : 0;
        const s = pc ^ c;
        const d = nreset & (hasTake ? (take ? ob : s) : s);
        const got = ev({ pc, ob, c, nreset, take, ntake: take ? 0 : 1 });
        expect(got, `mask ${mask}`).toEqual({ d, co: c & pc });
        if (!hasTake && mask >= 15) break;
      }
    }
  });

  it('take logic', () => {
    const f = feat({ used: ['jAlways', 'jZ', 'jNZ', 'jC', 'jNC'], flags: ['Z', 'C'] });
    const m = compileMacro(takeNetlist(f));
    log(`take: ${m.stats.gates} gates, ${m.stats.ms} ms, ${m.size.sx}x${m.size.sz}`);
    const ev = evaluator(m);
    const r = rng(5);
    for (let k = 0; k < 40; k++) {
      const v: Record<string, number> = { jAlways: 0, jZ: 0, jNZ: 0, jC: 0, jNC: 0, fz: 0, fc: 0 };
      // ровно одно условие активно (как в ПЗУ)
      const names = ['jAlways', 'jZ', 'jNZ', 'jC', 'jNC'];
      if (r() < 0.9) v[names[Math.floor(r() * names.length)]] = 1;
      v.fz = r() < 0.5 ? 1 : 0;
      v.fc = r() < 0.5 ? 1 : 0;
      const take = v.jAlways || (v.jZ && v.fz) || (v.jNZ && !v.fz) || (v.jC && v.fc) || (v.jNC && !v.fc) ? 1 : 0;
      expect(ev(v), JSON.stringify(v)).toEqual({ take, ntake: 1 - take });
    }
  });

  it('flags', () => {
    const f = feat({ used: ['eSum', 'sub', 'eShl', 'eShr'] });
    const m = compileMacro(flagsNetlist(f));
    log(`flags: ${m.stats.gates} gates, ${m.stats.ms} ms, ${m.size.sx}x${m.size.sz}`);
    const ev = evaluator(m);
    const r = rng(6);
    for (let k = 0; k < 40; k++) {
      const v: Record<string, number> = { r0: 0, r1: 0, r2: 0, r3: 0, eSum: 0, eShl: 0, eShr: 0, sub: 0, co: 0, cm: 0, am: 0, a0: 0, nreset: 1 };
      for (const n of Object.keys(v)) if (n !== 'nreset') v[n] = r() < 0.5 ? 1 : 0;
      if (k % 7 === 3) v.nreset = 0;
      const op = Math.floor(r() * 3);
      v.eSum = op === 0 ? 1 : 0;
      v.eShl = op === 1 ? 1 : 0;
      v.eShr = op === 2 ? 1 : 0;
      const z = (v.r0 | v.r1 | v.r2 | v.r3 ? 0 : 1) & v.nreset;
      const cn = ((v.eSum & (v.co ^ v.sub)) | (v.eShl & v.am) | (v.eShr & v.a0)) & v.nreset;
      const vn = (v.eSum & (v.cm ^ v.co)) & v.nreset;
      expect(ev(v), JSON.stringify(v)).toEqual({ z, cn, vn });
    }
  });

  it('ALU slice: operand select + adder, result mux', () => {
    const f = feat({ used: ['uImm', 'uMem', 'k1', 'sub', 'eSum', 'eAnd', 'eOr', 'eXor', 'eNot', 'eShl', 'eShr', 'eB'] });
    const a = compileMacro(aluANetlist(f));
    log(`alu A: ${a.stats.gates} gates, ${a.stats.ms} ms, ${a.size.sx}x${a.size.sz}`);
    const mux = compileMacro(aluMuxNetlist(f));
    log(`alu mux: ${mux.stats.gates} gates, ${mux.stats.ms} ms, ${mux.size.sx}x${mux.size.sz}`);
    const evA = evaluator(a);
    const evM = evaluator(mux);
    const r = rng(7);
    for (let k = 0; k < 40; k++) {
      const v: Record<string, number> = { a: 0, cin: 0, uImm: 0, ob: 0, uMem: 0, mem: 0, k1: 0, sub: 0 };
      for (const n of Object.keys(v)) v[n] = r() < 0.5 ? 1 : 0;
      const b0 = (v.uImm & v.ob) | (v.uMem & v.mem) | v.k1;
      const bx = b0 ^ v.sub;
      const p = v.a ^ bx;
      const g = v.a & bx;
      const s = p ^ v.cin;
      const co = g | (p & v.cin);
      const o = p | g;
      expect(evA(v), JSON.stringify(v)).toEqual({ bx, p, g, o, s, co });
      const mv: Record<string, number> = { eSum: 0, s, eAnd: 0, g, eOr: 0, o, eXor: 0, p, eNot: 0, a: v.a, eShl: 0, ap: r() < 0.5 ? 1 : 0, eShr: 0, an: r() < 0.5 ? 1 : 0, eB: 0, bx, nreset: 1 };
      const sel = ['eSum', 'eAnd', 'eOr', 'eXor', 'eNot', 'eShl', 'eShr', 'eB'][Math.floor(r() * 8)];
      mv[sel] = 1;
      if (k % 5 === 2) mv.nreset = 0;
      const val: Record<string, number> = { eSum: s, eAnd: g, eOr: o, eXor: p, eNot: 1 - v.a, eShl: mv.ap, eShr: mv.an, eB: bx };
      expect(evM(mv), JSON.stringify(mv)).toEqual({ r: val[sel] & mv.nreset });
    }
  });

  it('trimmed ALU slice for an add-only program', () => {
    const f = feat({ used: ['uMem', 'eSum', 'eB', 'weA'] });
    const a = compileMacro(aluANetlist(f));
    const mux = compileMacro(aluMuxNetlist(f));
    log(`trimmed: A ${a.stats.gates} gates ${a.stats.ms} ms ${a.size.sx}x${a.size.sz}; mux ${mux.stats.gates} gates ${mux.stats.ms} ms ${mux.size.sx}x${mux.size.sz}`);
    expect(CTL_NAMES.length).toBeGreaterThan(0);
  });
});
