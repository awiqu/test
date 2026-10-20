import { newProject } from '../../src/computer/project';
import { buildPresetIsa } from '../../src/computer/isa';
import { defaultSpec } from '../../src/computer/spec';
import { ComputerProject } from '../../src/computer/types';

/** Компактный 4-битный регистровый компьютер (4 регистра, лампы, рычаги, индикатор) для проверки физической постройки. */
export function regProject(over: Partial<ComputerProject['spec']> = {}): ComputerProject {
  const acc = defaultSpec('acc4');
  const spec = {
    ...defaultSpec('risc8'),
    name: 'Мини-R4',
    dataBits: 4,
    regCount: 4,
    opcodeBits: 5,
    instrBits: 12,
    pcBits: 4,
    romWords: 16,
    ramAddrBits: 4,
    ramWords: 10,
    flags: ['Z', 'C', 'N'] as ComputerProject['spec']['flags'],
    aluOps: ['ADD', 'SUB', 'AND', 'OR', 'XOR', 'NOT', 'SHL', 'SHR', 'INC', 'DEC'] as ComputerProject['spec']['aluOps'],
    stack: { enabled: false, words: 0 },
    devices: acc.devices,
    ...over,
  };
  const project = newProject('risc8');
  project.spec = spec;
  project.name = spec.name;
  project.instructions = buildPresetIsa(spec).instructions;
  project.programs = [
    {
      ...project.programs[0],
      name: 'Сумма и память',
      source: `; регистры и память
        ldi r0, 5
        ldi r1, 3
        add r0, r1
        st 2, r0
        ld r2, 2
        sub r2, r1
        mov r3, r2
        st LEDS, r3
        hlt
`,
    },
  ];
  return project;
}

/** Расширенный регистровый компьютер: 4 бита, 4 регистра, флаги Z C N V, без устройств — вся память данных доступна косвенно (LDR/STR), есть JR. */
export function regRichProject(): { project: ComputerProject; source: string } {
  const project = regProject({ devices: [], ramWords: 16, flags: ['Z', 'C', 'N', 'V'] as ComputerProject['spec']['flags'], opcodeBits: 6, instrBits: 12, pcBits: 5, romWords: 32 });
  const source = `
        jmp main
end:    hlt
main:   ldi r0, 11
        ldi r1, 6
        mov r2, r0
        add r2, r1
        jc  c1
        ldi r2, 0
c1:     st 3, r2
        ldi r3, 3
        str r3, r0
        ldr r1, r3
        sub r1, r2
        not r0
        shl r0
        shr r0
        inc r1
        dec r2
        addi r0, 5
        and r1, r0
        or r2, r1
        xor r2, r0
        cmpi r0, 3
        jz  end
        ldi r3, end
        jr  r3
`;
  project.programs = [{ ...project.programs[0], name: 'Регистры: АЛУ, косвенная память, JR', source }];
  return { project, source };
}
