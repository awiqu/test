import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseNetlist } from '../../src/model/netlist';
import { parseComputer, newProject, issuesToText } from '../../src/computer/project';
import { assemble } from '../../src/computer/asm';
import { analyzeRtl } from '../../src/computer/rtl';
import { layoutOf } from '../../src/computer/isa';
import { defaultSpec } from '../../src/computer/spec';
import { AI_DOCS, computerMarkdown, designCircuitPrompt, designComputerPrompt, fixPrompt, isaTable, memoryMapText, writeProgramPrompt } from '../../src/computer/docs';

const doc = (name: string): string => readFileSync(`/home/user/test/docs/ai/${name}`, 'utf8');
const blocks = (text: string, lang: string): string[] => [...text.matchAll(new RegExp('```' + lang + '\\n([\\s\\S]*?)```', 'g'))].map((m) => m[1]);

describe('AI docs stay in sync with the implementation', () => {
  it('every netlist example in circuit-netlist.md parses', () => {
    const list = blocks(doc('circuit-netlist.md'), 'netlist');
    expect(list.length).toBeGreaterThanOrEqual(4);
    for (const src of list) {
      const r = parseNetlist(src);
      expect(r.issues.filter((i) => i.level === 'error'), src).toEqual([]);
    }
  });

  it('example-computer.json is accepted without errors and its programs assemble', () => {
    const r = parseComputer(doc('example-computer.json'));
    expect(issuesToText(r.issues.filter((i) => i.level === 'error'))).toBe('');
    const p = r.project!;
    for (const prog of p.programs) {
      const a = assemble(prog.source, p.spec, p.instructions, p.asm);
      expect(a.issues.filter((i) => i.level === 'error'), prog.name).toEqual([]);
    }
  });

  it('assembler-syntax.md examples assemble on matching presets', () => {
    const asm = blocks(doc('assembler-syntax.md'), 'asm');
    expect(asm.length).toBe(2);
    const reg = newProject('risc8');
    const a1 = assemble(asm[0], reg.spec, reg.instructions, reg.asm);
    expect(a1.issues.filter((i) => i.level === 'error')).toEqual([]);
    const acc = newProject('acc4');
    const a2 = assemble(asm[1], acc.spec, acc.instructions, acc.asm);
    expect(a2.issues.filter((i) => i.level === 'error')).toEqual([]);
  });

  it('the "typical instructions" table in rtl-reference.md is valid RTL', () => {
    const section = doc('rtl-reference.md').split('## Типовые инструкции')[1].split('## Частые ошибки')[0];
    const rows = section
      .split('\n')
      .filter((l) => /^\| `[A-Z]+/.test(l))
      .map((l) => l.split('|').slice(1, 4).map((c) => c.trim().replace(/^`|`$/g, '')));
    expect(rows.length).toBeGreaterThan(15);
    for (const [label, format, code] of rows) {
      const acc = /\(аккумулятор\)/.test(label) || /^(LDA|ADD addr)/.test(label);
      const spec = defaultSpec(acc ? 'acc4' : 'risc16');
      spec.flags = ['Z', 'C', 'N', 'V'];
      spec.aluOps = ['ADD', 'SUB', 'AND', 'OR', 'XOR', 'NOT', 'SHL', 'SHR', 'INC', 'DEC'];
      const fields = format && format !== '—' ? format.split(',').map((f) => f.trim()) : [];
      const a = analyzeRtl(code, spec, fields);
      expect(a.errors, `${label}: ${code}`).toEqual([]);
      if (fields.length) expect(layoutOf(fields.join(','), spec).error, label).toBeUndefined();
    }
  });
});

describe('prompts', () => {
  it('design-computer prompt embeds all reference docs and has no unfilled placeholders', () => {
    const t = designComputerPrompt('Хочу 4-битный процессор с дисплеем');
    expect(t).toContain('Хочу 4-битный процессор с дисплеем');
    expect(t).toContain('redlogic-computer');
    expect(t).toContain('RTL: язык описания инструкции');
    expect(t).toContain('Синтаксис ассемблера RedLogic');
    expect(t).not.toMatch(/\{\{[A-Z_]+\}\}/);
  });
  it('write-program prompt describes the actual ISA, memory map and devices', () => {
    for (const preset of ['risc8', 'acc4', 'risc16'] as const) {
      const p = newProject(preset);
      const t = writeProgramPrompt(p, 'мигать светодиодами');
      expect(t).not.toMatch(/\{\{[A-Z_]+\}\}/);
      for (const i of p.instructions) expect(t).toContain('`' + i.mnemonic + '`');
      expect(t).toContain(p.spec.name);
      expect(t).toContain('`LEDS`');
      expect(isaTable(p)).toContain('opcode(');
      expect(memoryMapText(p)).toContain('Порты устройств');
    }
  });
  it('circuit prompt and fix prompt', () => {
    expect(designCircuitPrompt('сумматор')).toContain('сумматор');
    expect(designCircuitPrompt('')).not.toMatch(/\{\{[A-Z_]+\}\}/);
    expect(fixPrompt('computer', 'ОШИБКА: x')).toContain('```json');
  });
  it('computer markdown and the docs list are non-empty', () => {
    expect(computerMarkdown(newProject('risc8'))).toContain('## Набор инструкций');
    expect(AI_DOCS.every((d) => d.text.length > 100)).toBe(true);
  });
});
