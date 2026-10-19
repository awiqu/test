import { describe, it, expect } from 'vitest';
import { defaultSpec, validateSpec, portMap, ioBase } from '../../src/computer/spec';
import { buildPresetIsa, validateIsa, layoutOf, encodeWord, decodeWord } from '../../src/computer/isa';
import { assemble, disassemble } from '../../src/computer/asm';
import { Machine } from '../../src/computer/sim';
import { analyzeRtl, parseRtl } from '../../src/computer/rtl';
import { EXAMPLES } from '../../src/computer/examples';
import { TextDevice } from '../../src/computer/devices';

function setup(preset: 'risc8' | 'acc4' | 'risc16') {
  const spec = defaultSpec(preset);
  const { instructions, dropped } = buildPresetIsa(spec);
  return { spec, isa: instructions, dropped };
}

describe('spec', () => {
  it('default specs are valid', () => {
    for (const p of ['risc8', 'acc4', 'risc16'] as const) {
      const spec = defaultSpec(p);
      expect(validateSpec(spec).filter((i) => i.level === 'error'), p).toEqual([]);
    }
  });
  it('maps device ports to the top of the data address space', () => {
    const spec = defaultSpec('risc8');
    const ports = portMap(spec);
    expect(ports.length).toBe(12);
    expect(ports[0].addr).toBe(ioBase(spec));
    expect(ports[ports.length - 1].addr).toBe(255);
    expect(ports.find((p) => p.name === 'LEDS')).toBeTruthy();
  });
  it('detects overlapping RAM and devices', () => {
    const spec = defaultSpec('risc8');
    spec.ramWords = 250;
    expect(validateSpec(spec).some((i) => i.level === 'error' && i.where === 'ramWords')).toBe(true);
  });
});

describe('isa presets', () => {
  for (const p of ['risc8', 'acc4', 'risc16'] as const) {
    it(`${p}: preset instruction set validates cleanly`, () => {
      const { spec, isa, dropped } = setup(p);
      const issues = validateIsa(spec, isa).filter((i) => i.level === 'error');
      expect(issues).toEqual([]);
      expect(isa.length).toBeGreaterThan(8);
      expect(dropped.filter((d) => !/не хватило/.test(d))).toEqual([]);
    });
  }
  it('encodes and decodes a word', () => {
    const { spec, isa } = setup('risc8');
    const ldi = isa.find((i) => i.mnemonic === 'LDI')!;
    const w = encodeWord(ldi, { rd: 2, imm: 0xab }, spec);
    const d = decodeWord(w, spec, isa)!;
    expect(d.inst.mnemonic).toBe('LDI');
    expect(d.fields).toEqual({ rd: 2, imm: 0xab });
    const lay = layoutOf(ldi.format, spec);
    expect(lay.usedBits).toBe(5 + 2 + 8);
  });
  it('rejects instruction using a component that is not selected', () => {
    const { spec, isa } = setup('risc8');
    const bad = { ...isa[0], mnemonic: 'MULX', opcode: 31, format: 'rd,rs', code: 'R[rd] = mul(R[rd], R[rs])', blocks: undefined };
    const issues = validateIsa(spec, [...isa.filter((i) => i.opcode !== 31), bad]);
    expect(issues.some((i) => i.level === 'error' && /MUL/.test(i.message))).toBe(true);
    const bad2 = { ...bad, mnemonic: 'WEIRD', opcode: 30, code: 'R[rd] = imm' };
    expect(validateIsa(spec, [bad2]).some((i) => /imm/.test(i.message))).toBe(true);
  });
});

describe('rtl', () => {
  it('parses and reports errors with positions', () => {
    const r = parseRtl('R[rd] = (1 +');
    expect(r.errors.length).toBeGreaterThan(0);
    const spec = defaultSpec('risc8');
    const a = analyzeRtl('foo = 1', spec, ['rd']);
    expect(a.errors[0].message).toMatch(/foo/);
  });
});

describe('assembler', () => {
  it('assembles labels, directives and operand syntax', () => {
    const { spec, isa } = setup('risc8');
    const r = assemble(
      `.equ ONE, 1
start:  ldi r0, ONE + 2   ; comment
        st  [LEDS], r0
        jmp start
        .word 0x1234
        .org 10
        hlt
`,
      spec,
      isa,
    );
    expect(r.issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(r.labels.start).toBe(0);
    expect(r.size).toBe(11);
    expect(disassemble(r.words[0], spec, isa)).toBe('LDI r0, 3');
    expect(disassemble(r.words[1], spec, isa)).toBe('ST LEDS, r0');
    expect(r.words[3]).toBe(0x1234);
  });
  it('reports readable errors', () => {
    const { spec, isa } = setup('risc8');
    const r = assemble('  foo r1\n  ldi r9, 1\n  ldi r1, 999\n  jmp nowhere\n  add r1\n', spec, isa);
    const msgs = r.issues.map((i) => `${i.line}:${i.message}`);
    expect(msgs.some((m) => m.startsWith('1:') && /Неизвестная инструкция/.test(m))).toBe(true);
    expect(msgs.some((m) => m.startsWith('2:') && /регистра/.test(m))).toBe(true);
    expect(msgs.some((m) => m.startsWith('3:') && /не помещается/.test(m))).toBe(true);
    expect(msgs.some((m) => m.startsWith('4:') && /nowhere/.test(m))).toBe(true);
    expect(msgs.some((m) => m.startsWith('5:') && /операндов/.test(m))).toBe(true);
    expect(r.ok).toBe(false);
  });
});

describe('simulator', () => {
  const run = (preset: 'risc8' | 'acc4', src: string, steps = 100000) => {
    const { spec, isa } = setup(preset);
    const asm = assemble(src, spec, isa);
    expect(asm.issues.filter((i) => i.level === 'error'), JSON.stringify(asm.issues)).toEqual([]);
    const m = new Machine(spec, isa, asm.words);
    const reason = m.run(steps);
    return { m, reason, spec, isa };
  };

  it('arithmetic and flags', () => {
    const { m, reason } = run(
      'risc8',
      `ldi r0, 200
       ldi r1, 100
       add r0, r1      ; 300 -> 44, C=1
       hlt`,
    );
    expect(reason).toBe('halted');
    expect(m.env.R[0]).toBe(44);
    expect(m.env.flags.C).toBe(1);
    expect(m.env.flags.Z).toBe(0);
  });

  it('subtraction uses borrow in C', () => {
    const { m } = run('risc8', 'ldi r0, 3\n ldi r1, 5\n sub r0, r1\n hlt');
    expect(m.env.R[0]).toBe(254);
    expect(m.env.flags.C).toBe(1);
    expect(m.env.flags.N).toBe(1);
  });

  it('every example program for risc8 assembles and runs without fault', () => {
    for (const ex of EXAMPLES.risc8) {
      const { spec, isa } = setup('risc8');
      const asm = assemble(ex.source, spec, isa);
      expect(asm.issues.filter((i) => i.level === 'error'), ex.name).toEqual([]);
      const m = new Machine(spec, isa, asm.words);
      const reason = m.run(20000);
      expect(['halted', 'limit'], `${ex.name}: ${m.fault}`).toContain(reason);
      expect(m.fault, ex.name).toBeUndefined();
    }
  });

  it('prints Fibonacci numbers in hex to the terminal (calls, stack, compare)', () => {
    const ex = EXAMPLES.risc8.find((e) => e.name.startsWith('Числа Фибоначчи'))!;
    const { spec, isa } = setup('risc8');
    const m = new Machine(spec, isa, assemble(ex.source, spec, isa).words);
    expect(m.run(100000)).toBe('halted');
    const term = m.device('terminal')!;
    expect(term.text).toBe('00\n01\n01\n02\n03\n05\n08\n0D\n15\n22\n37\n59\n');
    expect(m.env.sp).toBe(spec.ramWords); // стек сбалансирован
  });

  it('text display, pixels and multiplication', () => {
    const { spec, isa } = setup('risc8');
    const get = (name: string) => EXAMPLES.risc8.find((e) => e.name.startsWith(name))!.source;
    const hello = new Machine(spec, isa, assemble(get('Привет'), spec, isa).words);
    hello.run(1000);
    expect((hello.device('text') as TextDevice).lines()[0].trim()).toBe('Hello!');
    expect(hello.device('terminal')!.text).toBe('Hello!\n');
    const diag = new Machine(spec, isa, assemble(get('Диагональ'), spec, isa).words);
    diag.run(1000);
    const px = diag.device('pixel')!;
    for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) expect(px.pixels[j * 8 + i]).toBe(i === j ? 1 : 0);
    const mul = new Machine(spec, isa, assemble(get('Умножение'), spec, isa).words);
    mul.run(1000);
    expect(mul.device('sevenseg')!.value).toBe(42);
    expect(mul.device('leds')!.value).toBe(42);
  });

  it('input devices: switches and keyboard', () => {
    const { spec, isa } = setup('risc8');
    const src = EXAMPLES.risc8.find((e) => e.name.startsWith('Рычаги'))!.source;
    const m = new Machine(spec, isa, assemble(src, spec, isa).words);
    const sw = m.device('switches')!;
    sw.set(0, true);
    sw.set(3, true);
    m.run(50);
    expect(m.device('leds')!.value).toBe(0b1001);
    const k = EXAMPLES.risc8.find((e) => e.name.startsWith('Эхо'))!.source;
    const m2 = new Machine(spec, isa, assemble(k, spec, isa).words);
    m2.run(30);
    m2.device('keyboard')!.press('A'.charCodeAt(0));
    m2.run(30);
    expect((m2.device('text') as TextDevice).lines()[0].startsWith('A')).toBe(true);
  });

  it('accumulator 4-bit machine counts', () => {
    const { spec, isa } = setup('acc4');
    const src = EXAMPLES.acc4[0].source;
    const m = new Machine(spec, isa, assemble(src, spec, isa).words);
    m.run(5 + 6 * 7); // 4 init + 7 loops
    expect(m.device('leds')!.value).toBe(7);
  });

  it('illegal opcode faults', () => {
    const { spec, isa } = setup('risc8');
    const m = new Machine(spec, isa.filter((i) => i.opcode !== 31), [0xffff]);
    expect(m.run(10)).toBe('fault');
    expect(m.fault).toMatch(/Неизвестный код/);
  });
});
