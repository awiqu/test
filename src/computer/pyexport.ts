import { ComputerProject } from './types';
import { PY_TEMPLATE } from './py/template';
import { parseRtl, rtlToPython } from './rtl';
import { safeFileName } from '../export/litematic';

/** Python-файл: ассемблер, дизассемблер и эмулятор выбранного компьютера. */
export function generatePython(project: ComputerProject): string {
  const spec = project.spec;
  const exec: string[] = [];
  const table: string[] = [];
  const safe = (s: string): string => s.replace(/'''/g, "\\u0027\\u0027\\u0027");
  for (const inst of project.instructions) {
    const { prog, errors } = parseRtl(inst.code);
    const body = errors.length ? ['        m.fault = "Ошибка в RTL инструкции %s"'.replace('%s', inst.mnemonic), '        m.halted = True'] : rtlToPython(prog);
    exec.push(`def exec_${inst.mnemonic.toUpperCase()}(m, f_rd=0, f_rs=0, f_rt=0, f_imm=0, f_addr=0, f_target=0, f_off=0):`);
    exec.push(`    """${inst.mnemonic}: ${inst.description.replace(/"""/g, '"')}"""`);
    exec.push(...body.map((l) => l.replace(/^ {8}/, '    ')));
    exec.push('');
    table.push(`    ${inst.opcode}: exec_${inst.mnemonic.toUpperCase()},`);
  }
  const file = `${safeFileName(project.name)}.py`;
  const isa = project.instructions.map((i) => ({ mnemonic: i.mnemonic, opcode: i.opcode, format: i.format, cycles: i.cycles }));
  return PY_TEMPLATE.replace(/@@TITLE@@/g, project.name)
    .replace(/@@FILE@@/g, file)
    .replace('@@SPEC_JSON@@', safe(JSON.stringify(spec)))
    .replace('@@ISA_JSON@@', safe(JSON.stringify(isa)))
    .replace('@@ASM_JSON@@', safe(JSON.stringify(project.asm)))
    .replace('@@EXEC_FUNCS@@', exec.join('\n'))
    .replace('@@EXEC_TABLE@@', table.join('\n'));
}

export function pythonFileName(project: ComputerProject): string {
  return `${safeFileName(project.name)}.py`;
}
