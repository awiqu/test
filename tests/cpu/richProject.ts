import { newProject } from '../../src/computer/project';
import { buildPresetIsa } from '../../src/computer/isa';
import { defaultSpec } from '../../src/computer/spec';
import { ComputerProject } from '../../src/computer/types';

/** 4-битный аккумуляторный компьютер с расширенным набором инструкций (арифметика, логика, сдвиги, все флаги, переходы) без регистровых переходов. */
export function richProject(): { project: ComputerProject; source: string } {
  const spec = { ...defaultSpec('acc4'), opcodeBits: 5, instrBits: 10, pcBits: 5, romWords: 32, devices: [] as never[], ramAddrBits: 4, ramWords: 16, aluOps: ['ADD', 'SUB', 'AND', 'OR', 'XOR', 'NOT', 'SHL', 'SHR', 'INC', 'DEC'] as never[], flags: ['Z', 'C', 'N', 'V'] as never[] };
  const project = newProject('acc4');
  project.spec = spec;
  project.instructions = buildPresetIsa(spec).instructions.filter((i) => !i.mnemonic.startsWith('BR') && i.mnemonic !== 'JMPR');
  const source = `
        ldi 11
        sta 0
        ldi 6
        sta 1
        lda 0
        add 1
        jc  carry
        ldi 0
carry:  sta 2
        lda 0
        sub 1
        sta 3
        lda 0
        and 1
        or  1
        xor 0
        not
        shl
        shr
        sta 4
        lda 1
loop:   sub 2
        jnz loop
        hlt
`;
  project.programs = [{ ...project.programs[0], name: 'Проверка АЛУ', source }];
  return { project, source };
}
