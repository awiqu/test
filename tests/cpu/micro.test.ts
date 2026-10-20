import { describe, it, expect } from 'vitest';
import { newProject } from '../../src/computer/project';
import { defaultSpec } from '../../src/computer/spec';
import { buildPresetIsa, encodeWord, FIELD_NAMES, layoutOf } from '../../src/computer/isa';
import { assemble } from '../../src/computer/asm';
import { Machine } from '../../src/computer/sim';
import { EXAMPLES } from '../../src/computer/examples';
import { ComputerSpec, Instruction } from '../../src/computer/types';
import { MicroMachine, controlFromBlocks, deriveControl, expandRom, rtlToBlocks } from '../../src/cpu/micro';
import { rng } from '../helpers';

function accSpec(over: Partial<ComputerSpec> = {}): ComputerSpec {
  return { ...defaultSpec('acc4'), devices: [], ramAddrBits: 4, ramWords: 16, ...over };
}

/** Прогоняет одну программу в эмуляторе и в модели железа и сравнивает состояние на каждом шаге. */
function compare(spec: ComputerSpec, isa: Instruction[], words: number[], steps: number): string | null {
  const m = new Machine(spec, isa, words);
  const rom = expandRom(words, words.length, spec, isa);
  if (rom.errors.length) return rom.errors.join('; ');
  const hw = new MicroMachine(
    spec,
    rom.rows,
    (a, st) => st.ram[a & (2 ** spec.ramAddrBits - 1)] ?? 0,
    (a, v, st) => {
      const i = a & (2 ** spec.ramAddrBits - 1);
      if (i < st.ram.length) st.ram[i] = v;
    },
    spec.ramWords,
  );
  for (let s = 0; s < steps; s++) {
    if (m.halted) break;
    // эмулятор не допускает PC за пределами образа — в железе строки кончаются
    if (m.pc >= words.length) break;
    m.step();
    hw.step();
    const f = m.env.flags;
    const same =
      (spec.arch === 'register' ? m.env.R.every((v, i) => v === hw.state.regs[i]) : m.env.R[0] === hw.state.a) &&
      (m.halted ? hw.state.halted : m.pc === hw.state.pc) &&
      spec.flags.every((fl) => f[fl] === hw.state.flags[fl]) &&
      m.ram.every((v, i) => v === hw.state.ram[i]);
    if (!same) {
      return `шаг ${s}: PC ${m.pc}/${hw.state.pc}, A ${m.env.R[0]}/${hw.state.a}, R ${m.env.R.join(',')}/${hw.state.regs.join(',')}, флаги ${JSON.stringify(f)}/${JSON.stringify(hw.state.flags)}, RAM ${m.ram.join(',')}/${hw.state.ram.join(',')}`;
    }
  }
  return null;
}

describe('micro: control derivation and hardware equations match the emulator', () => {
  it('presets: all supported instructions derive control', () => {
    const spec = accSpec();
    const { instructions } = buildPresetIsa(spec);
    for (const i of instructions) expect(deriveControl(i, spec).error, i.mnemonic).toBeUndefined();
  });

  it('examples run identically', () => {
    const spec = defaultSpec('acc4');
    const { instructions } = buildPresetIsa(spec);
    for (const ex of EXAMPLES.acc4) {
      const a = assemble(ex.source, spec, instructions);
      expect(a.ok).toBe(true);
      // порты в модели железа: без устройств — сравниваем только до первого обращения к ним
      const e = compare({ ...spec, devices: [], ramWords: 16 }, instructions, a.words.slice(0, a.size), 60);
      expect(e).toBeNull();
    }
  });

  it('fuzz: random programs with a rich ISA (4..8 bits, flags Z C N V)', () => {
    const r = rng(777);
    const pick = <T,>(a: T[]): T => a[Math.floor(r() * a.length)];
    for (let it = 0; it < 300; it++) {
      const dataBits = pick([3, 4, 5, 6, 8]);
      const spec = accSpec({
        dataBits,
        opcodeBits: 5,
        instrBits: 5 + Math.max(dataBits, 4),
        pcBits: 4,
        romWords: 16,
        ramAddrBits: 4,
        ramWords: 16,
        flags: pick([['Z', 'C'], ['Z', 'C', 'N', 'V'], ['Z'], ['C', 'N']]) as ComputerSpec['flags'],
        aluOps: ['ADD', 'SUB', 'AND', 'OR', 'XOR', 'NOT', 'SHL', 'SHR', 'INC', 'DEC'],
      });
      const all = buildPresetIsa(spec).instructions.filter((i) => !deriveControl(i, spec).error);
      const isa = r() < 0.85 ? all.filter((i) => i.mnemonic !== 'HLT') : all;
      const n = 1 + Math.floor(r() * 16);
      const words: number[] = [];
      for (let k = 0; k < n; k++) {
        const inst = pick(isa);
        const op = Math.floor(r() * 2 ** Math.max(spec.dataBits, spec.pcBits, spec.ramAddrBits));
        words.push(inst.opcode * 2 ** (spec.instrBits - spec.opcodeBits) + (op & (2 ** (spec.instrBits - spec.opcodeBits) - 1)));
      }
      const e = compare(spec, all, words, 80);
      expect(e, `iteration ${it} ${JSON.stringify(spec.flags)} bits=${dataBits} words=${words.join(',')}`).toBeNull();
    }
  });

  it('register machines: presets derive control, hardware equations match the emulator (fuzz)', () => {
    const r = rng(4242);
    const pick = <T,>(a: T[]): T => a[Math.floor(r() * a.length)];
    let supported = 0;
    for (let it = 0; it < 400; it++) {
      const dataBits = pick([3, 4, 5, 6, 8]);
      const regCount = pick([2, 4, 8]);
      const spec: ComputerSpec = {
        ...defaultSpec('risc8'),
        devices: [],
        stack: { enabled: false, words: 0 },
        dataBits,
        regCount,
        opcodeBits: 6,
        instrBits: 20,
        pcBits: 4,
        romWords: 16,
        ramAddrBits: 4,
        ramWords: 16,
        flags: pick([['Z', 'C'], ['Z', 'C', 'N', 'V'], ['Z'], ['C', 'N']]) as ComputerSpec['flags'],
        aluOps: ['ADD', 'SUB', 'AND', 'OR', 'XOR', 'NOT', 'SHL', 'SHR', 'INC', 'DEC'],
      };
      const all = buildPresetIsa(spec).instructions.filter((i) => !deriveControl(i, spec).error);
      if (it === 0) {
        expect(all.map((i) => i.mnemonic)).toEqual(expect.arrayContaining(['LDI', 'MOV', 'LD', 'ST', 'LDR', 'STR', 'ADD', 'ADDI', 'CMP', 'JMP', 'JR', 'NOT', 'SHL', 'INC']));
      }
      supported = Math.max(supported, all.length);
      const isa = r() < 0.85 ? all.filter((i) => i.mnemonic !== 'HLT') : all;
      const n = 1 + Math.floor(r() * 16);
      const words: number[] = [];
      for (let k = 0; k < n; k++) {
        const inst = pick(isa);
        const vals: Partial<Record<(typeof FIELD_NAMES)[number], number>> = {};
        for (const f of layoutOf(inst.format, spec).fields) vals[f.name] = Math.floor(r() * 2 ** f.bits);
        words.push(encodeWord(inst, vals, spec));
      }
      const e = compare(spec, all, words, 80);
      expect(e, `iteration ${it} regs=${regCount} bits=${dataBits} ${JSON.stringify(spec.flags)} words=${words.join(',')}`).toBeNull();
    }
    expect(supported).toBeGreaterThan(25);
  });

  it('hand-written RTL for register machines is recognised', () => {
    const spec = { ...defaultSpec('risc8'), devices: [] };
    const cases = ['R[rd] = R[rd] + R[rs]', 'R[rd] = imm', 'R[rd] = R[rs]', 'R[rd] += imm', 'R[rd] = M[addr]', 'R[rd] = M[R[rs]]', 'M[addr] = R[rs]', 'M[R[rd]] = R[rs]', 'PC = R[rd]', 'if (!Z) PC = target', 'sub(R[rd], R[rs])', 'R[rd] = ~R[rd]', 'R[rd] = shl(R[rd])', 'R[rd] = add(R[rs], R[rt])'];
    for (const c of cases) {
      const b = rtlToBlocks(c);
      expect(b.error, c).toBeUndefined();
      expect(controlFromBlocks(b.blocks!, spec).error, c).toBeUndefined();
    }
    // два разных регистра на одном порту чтения — не бывает
    expect(controlFromBlocks([{ kind: 'alu', op: 'ADD', dst: 'R[rd]', a: 'R[rd]', b: 'M[R[rs]]', flags: true }], spec).error).toBeDefined();
    expect(rtlToBlocks('R[rd] = mul(R[rd], R[rs])').error).toBeDefined();
  });

  it('hand-written RTL is recognised', () => {
    const cases = ['A = add(A, M[addr])', 'A = A + imm', 'if (!Z) PC = target', 'M[addr] = A', 'sub(A, imm)', 'A = ~A', 'A = A << 1', 'A = shr(A)', 'halt()', 'A = M[imm]', 'A = 1', 'PC = target', 'A &= imm'];
    for (const c of cases) expect(rtlToBlocks(c).error, c).toBeUndefined();
    expect(rtlToBlocks('push(A)').error).toBeDefined();
    expect(rtlToBlocks('A = mul(A, imm)').error).toBeDefined();
  });

  it('unsupported instructions are reported, not silently dropped', () => {
    const p = newProject('risc8');
    for (const mn of ['PUSH', 'CALL', 'RET', 'MUL']) {
      const inst = p.instructions.find((i) => i.mnemonic === mn);
      if (inst) expect(deriveControl(inst, p.spec).error, mn).toBeDefined();
    }
    const acc = newProject('acc4');
    expect(controlFromBlocks([{ kind: 'move', dst: 'R[rd]', src: 'imm' }], acc.spec).error).toBeDefined();
  });
});
