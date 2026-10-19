/** Типы «редстоун-компьютера»: характеристики, устройства, инструкции, проект. */

export type FlagName = 'Z' | 'C' | 'N' | 'V';
export const ALL_FLAGS: FlagName[] = ['Z', 'C', 'N', 'V'];

export type AluOp = 'ADD' | 'SUB' | 'AND' | 'OR' | 'XOR' | 'NOT' | 'SHL' | 'SHR' | 'ASR' | 'ROL' | 'ROR' | 'INC' | 'DEC' | 'NEG' | 'MUL';
export const ALL_ALU_OPS: AluOp[] = ['ADD', 'SUB', 'AND', 'OR', 'XOR', 'NOT', 'SHL', 'SHR', 'ASR', 'ROL', 'ROR', 'INC', 'DEC', 'NEG', 'MUL'];

export type DeviceType = 'leds' | 'switches' | 'buttons' | 'sevenseg' | 'text' | 'pixel' | 'keyboard' | 'timer' | 'random' | 'sound' | 'terminal';

export interface DeviceSpec {
  id: string;
  type: DeviceType;
  /** Параметры устройства (размер экрана и т.п.). */
  options: Record<string, number>;
}

export type Arch = 'register' | 'accumulator';

export interface ComputerSpec {
  name: string;
  arch: Arch;
  /** Разрядность данных (регистры, ОЗУ), 2..16. */
  dataBits: number;
  /** Число регистров (для accumulator всегда 1). */
  regCount: number;
  /** Ширина слова инструкции (бит ПЗУ), 8..32. */
  instrBits: number;
  /** Число бит кода операции. */
  opcodeBits: number;
  /** Число бит адреса ПЗУ (счётчик команд). */
  pcBits: number;
  /** Сколько слов ПЗУ реально используется (≤ 2^pcBits). */
  romWords: number;
  /** Число бит адреса данных (ОЗУ + порты устройств). */
  ramAddrBits: number;
  /** Размер ОЗУ в словах (≤ 2^ramAddrBits − число портов). */
  ramWords: number;
  flags: FlagName[];
  aluOps: AluOp[];
  stack: { enabled: boolean; words: number };
  /** Тактовый период: тиков редстоуна на один такт процессора. */
  clockTicks: number;
  devices: DeviceSpec[];
}

export interface Instruction {
  mnemonic: string;
  opcode: number;
  /** Поля операндов через запятую: rd, rs, rt, imm, addr, target, off (или пусто). */
  format: string;
  description: string;
  /** Псевдокод для человека. */
  pseudo: string;
  /** Исполняемое описание на языке RTL. */
  code: string;
  /** Число тактов. */
  cycles: number;
  /** Блоки конструктора (если инструкция собрана в нём). */
  blocks?: Block[];
}

/** Блоки визуального конструктора функционала. */
export type Operand = string;
export type Block =
  | { kind: 'alu'; op: AluOp; dst: Operand; a: Operand; b?: Operand; flags: boolean }
  | { kind: 'move'; dst: Operand; src: Operand }
  | { kind: 'load'; dst: Operand; addr: Operand }
  | { kind: 'store'; addr: Operand; src: Operand }
  | { kind: 'jump'; target: Operand; cond: JumpCond; relative?: boolean }
  | { kind: 'cmp'; a: Operand; b: Operand }
  | { kind: 'push'; src: Operand }
  | { kind: 'pop'; dst: Operand }
  | { kind: 'call'; target: Operand }
  | { kind: 'ret' }
  | { kind: 'skip'; cond: JumpCond }
  | { kind: 'halt' }
  | { kind: 'nop' };

export type JumpCond = 'always' | 'Z' | 'NZ' | 'C' | 'NC' | 'N' | 'NN' | 'V' | 'NV';

export interface Program {
  id: string;
  name: string;
  source: string;
}

export interface AsmOptions {
  /** Регистр: префикс имени (r0, r1…). */
  regPrefix: string;
  /** Регистр символов в мнемониках игнорируется. */
  caseSensitiveLabels: boolean;
}

export interface ComputerProject {
  format: 'redlogic-computer';
  version: 1;
  name: string;
  spec: ComputerSpec;
  instructions: Instruction[];
  programs: Program[];
  asm: AsmOptions;
  /** Пользовательская версия Python-ассемблера (если правили). */
  pythonAssembler?: string;
}

export interface Issue {
  level: 'error' | 'warning';
  message: string;
  /** Где: имя инструкции, поле спецификации и т.п. */
  where?: string;
  line?: number;
}
