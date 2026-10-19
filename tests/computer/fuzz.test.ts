import { describe, it, expect } from 'vitest';
import { newProject } from '../../src/computer/project';
import { normalizeSpec } from '../../src/computer/store';
import { buildPresetIsa, validateIsa } from '../../src/computer/isa';
import { validateSpec, DEVICE_ORDER, makeDevice } from '../../src/computer/spec';
import { assemble } from '../../src/computer/asm';
import { Machine } from '../../src/computer/sim';
import { buildRom, DEFAULT_ROM_OPTIONS } from '../../src/computer/rom';
import { generatePython } from '../../src/computer/pyexport';
import { computerMarkdown, writeProgramPrompt, designComputerPrompt } from '../../src/computer/docs';
import { HARDWARE } from '../../src/computer/hardware';
import { EXAMPLES } from '../../src/computer/examples';
import { ALL_ALU_OPS } from '../../src/computer/types';
import { rng } from '../helpers';

/** Случайные (в том числе заведомо неверные) характеристики не должны ронять ни один слой — только давать замечания. */
describe('computer pipeline never throws on odd specs', () => {
  it('fuzz: spec → ISA → assemble → run → ROM → docs → hardware', () => {
    const r = rng(20261019);
    const pick = <T,>(a: T[]): T => a[Math.floor(r() * a.length)];
    for (let it = 0; it < 150; it++) {
      const p = newProject(pick(['risc8', 'acc4', 'risc16'] as const));
      const spec = normalizeSpec({
        ...p.spec,
        arch: r() < 0.3 ? 'accumulator' : 'register',
        dataBits: 2 + Math.floor(r() * 15),
        regCount: pick([1, 2, 4, 8, 16, 3]),
        instrBits: 8 + Math.floor(r() * 25),
        opcodeBits: 1 + Math.floor(r() * 8),
        pcBits: 1 + Math.floor(r() * 9),
        romWords: 1 + Math.floor(r() * 200),
        ramAddrBits: 1 + Math.floor(r() * 10),
        ramWords: Math.floor(r() * 300),
        flags: (['Z', 'C', 'N', 'V'] as const).filter(() => r() < 0.6),
        aluOps: ALL_ALU_OPS.filter(() => r() < 0.5),
        stack: { enabled: r() < 0.5, words: Math.floor(r() * 40) },
        devices: DEVICE_ORDER.filter(() => r() < 0.4).map((t) => makeDevice(t)),
      });
      p.spec = spec;
      validateSpec(spec);
      const { instructions } = buildPresetIsa(spec);
      p.instructions = instructions;
      validateIsa(spec, instructions);
      for (const ex of EXAMPLES[spec.arch === 'accumulator' ? 'acc4' : 'risc8']) {
        const a = assemble(ex.source, spec, instructions, p.asm);
        const m = new Machine(spec, instructions, a.words);
        m.run(300);
        if (a.ok && a.size > 0) buildRom(a.words.slice(0, a.size), spec, DEFAULT_ROM_OPTIONS);
      }
      generatePython(p);
      computerMarkdown(p);
      writeProgramPrompt(p, 'test');
      for (const g of HARDWARE) {
        try {
          g.build(Object.fromEntries(g.params(p).map((x) => [x.id, x.value])), p);
        } catch (e) {
          // допустимо: понятная ошибка «слишком длинный код операции» и т. п.
          expect((e as Error).message).toMatch(/[А-Яа-я]/);
        }
      }
    }
    expect(designComputerPrompt('x').length).toBeGreaterThan(1000);
  }, 120000);
});
