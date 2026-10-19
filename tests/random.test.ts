import { describe, it, expect } from 'vitest';
import { appendFileSync } from 'node:fs';
import { randomCircuit } from './helpers';
import { compile, defaultSettings } from '../src/compiler/compile';
import { GATE_VARIANTS } from '../src/compiler/variants';

describe('random circuits', () => {
  const N = Number(process.env.N ?? 10);
  for (let seed = 1; seed <= N; seed++) {
    it(`seed ${seed}`, () => {
      const circ = randomCircuit(seed, 2 + (seed % 3), 3 + (seed % 7));
      const s = defaultSettings();
      const res = compile(circ, s);
      const st = res.stats;
      appendFileSync('/tmp/rlog.txt', `seed ${seed}: ok=${res.ok} gates=${circ.gates.length} ${st ? `size=${res.structure!.sx}x${res.structure!.sy}x${res.structure!.sz} gap=${st.gapX}/${st.gapZ} att=${st.attempts} blocks=${st.total} ${st.ms}ms` : ''} ${res.issues.map((i) => i.message).join('|')} ${res.verify?.message ?? ''}\n`);
      expect(res.ok).toBe(true);
    }, 120000);
  }
  it('variants', { timeout: 600000 }, () => {
    // перебор вариантов для небольшой схемы
    const circ = randomCircuit(99, 3, 6);
    for (const [type, list] of Object.entries(GATE_VARIANTS)) {
      for (const v of list!) {
        const s = defaultSettings();
        s.variants = { ...s.variants, [type]: v.id };
        const res = compile(circ, s);
        appendFileSync('/tmp/rlog.txt', `variant ${type}/${v.id}: ok=${res.ok} ${res.verify?.message ?? res.issues.map((i) => i.message).join('|')}\n`);
        expect(res.ok).toBe(true);
      }
    }
  });
});
