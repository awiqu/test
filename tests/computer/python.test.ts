import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newProject, parseComputer, serializeComputer } from '../../src/computer/project';
import { generatePython } from '../../src/computer/pyexport';
import { assemble } from '../../src/computer/asm';
import { Machine } from '../../src/computer/sim';
import { EXAMPLES } from '../../src/computer/examples';
import { TextDevice } from '../../src/computer/devices';

const python = spawnSync('python3', ['--version']);
const hasPython = python.status === 0;

describe.skipIf(!hasPython)('generated Python assembler/emulator', () => {
  for (const preset of ['risc8', 'acc4', 'risc16'] as const) {
    it(`${preset}: Python and TypeScript agree on every example`, () => {
      const project = newProject(preset);
      const dir = mkdtempSync(join(tmpdir(), 'rl-py-'));
      const py = join(dir, 'computer.py');
      writeFileSync(py, generatePython(project));
      for (const ex of EXAMPLES[preset]) {
        const src = join(dir, 'prog.asm');
        writeFileSync(src, ex.source);
        // ассемблер
        const a = spawnSync('python3', ['-I', py, 'asm', src, '--format', 'json'], { encoding: 'utf8', cwd: dir });
        expect(a.status, `${ex.name}: ${a.stderr}`).toBe(0);
        const out = JSON.parse(a.stdout) as { words: number[]; size: number };
        const ts = assemble(ex.source, project.spec, project.instructions, project.asm);
        expect(out.size).toBe(ts.size);
        expect(out.words, ex.name).toEqual(ts.words.slice(0, Math.max(ts.size, 1)));
        // эмулятор
        const r = spawnSync('python3', ['-I', py, 'run', src, '--max-steps', '5000', '--json'], { encoding: 'utf8', cwd: dir });
        expect(r.status, `${ex.name}: ${r.stderr}`).toBe(0);
        const st = JSON.parse(r.stdout);
        const m = new Machine(project.spec, project.instructions, ts.words);
        m.run(5000);
        expect(st.steps, `${ex.name} steps`).toBe(m.steps);
        expect(st.cycles).toBe(m.cycles);
        expect(st.regs, `${ex.name} regs`).toEqual(m.env.R);
        expect(st.pc).toBe(m.env.pc);
        expect(st.leds).toBe(m.device('leds')!.value);
        expect(st.terminal).toBe(m.device('terminal')?.text ?? '');
        if (st.text) expect(st.text).toEqual((m.device('text') as TextDevice).lines());
        if (st.pixels) expect(st.pixels).toEqual([...m.device('pixel')!.pixels]);
        expect(st.ram).toEqual(m.ram);
      }
    });
  }

  it('assembler errors are reported by Python too', () => {
    const project = newProject('risc8');
    const dir = mkdtempSync(join(tmpdir(), 'rl-py-'));
    const py = join(dir, 'c.py');
    writeFileSync(py, generatePython(project));
    const src = join(dir, 'bad.asm');
    writeFileSync(src, 'foo r1\nldi r9, 1\n');
    const a = spawnSync('python3', ['-I', py, 'asm', src], { encoding: 'utf8', cwd: dir });
    expect(a.status).toBe(1);
    expect(a.stderr).toMatch(/Неизвестная инструкция/);
    expect(a.stderr).toMatch(/регистра/);
  });
});

describe('project JSON import', () => {
  it('round-trips a project', () => {
    const p = newProject('risc8');
    const parsed = parseComputer(serializeComputer(p));
    expect(parsed.issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(parsed.project!.instructions.length).toBe(p.instructions.length);
  });
  it('reports every problem in AI-written JSON', () => {
    const bad = JSON.stringify({
      format: 'redlogic-computer',
      spec: { dataBits: 40, regCount: 3, aluOps: ['ADD', 'DIV'], flags: ['Z', 'Q'], devices: ['leds', 'laser'] },
      instructions: [{ mnemonic: 'ADD', opcode: '0x1', format: 'rd,rs', code: 'R[rd] = add(R[rd], R[rt])' }, { opcode: 1 }],
    });
    const r = parseComputer(bad);
    const text = r.issues.map((i) => i.message).join('\n');
    expect(r.project).toBeNull();
    expect(text).toMatch(/dataBits|вне диапазона/);
    expect(text).toMatch(/DIV/);
    expect(text).toMatch(/Q/);
    expect(text).toMatch(/laser|устройства/);
    expect(text).toMatch(/rt/);
    expect(text).toMatch(/mnemonic/);
  });
});
