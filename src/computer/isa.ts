import { ALL_FLAGS, Block, ComputerSpec, Instruction, Issue, JumpCond } from './types';
import { ALU_INFO, regBits } from './spec';
import { analyzeRtl } from './rtl';

// ───────────── Формат и кодирование ─────────────

export const FIELD_NAMES = ['rd', 'rs', 'rt', 'imm', 'addr', 'target', 'off'] as const;
export type FieldName = (typeof FIELD_NAMES)[number];

export const FIELD_DESC: Record<FieldName, string> = {
  rd: 'регистр-приёмник (он же первый операнд)',
  rs: 'регистр-источник',
  rt: 'третий регистр',
  imm: 'число-константа (разрядность данных)',
  addr: 'адрес памяти данных',
  target: 'адрес в ПЗУ (куда перейти)',
  off: 'знаковое смещение относительно адреса инструкции',
};

export function fieldBits(name: FieldName, spec: ComputerSpec): number {
  switch (name) {
    case 'rd':
    case 'rs':
    case 'rt':
      return regBits(spec);
    case 'imm':
      return spec.dataBits;
    case 'addr':
      return spec.ramAddrBits;
    case 'target':
    case 'off':
      return spec.pcBits;
  }
}

export function parseFormat(format: string): { fields: FieldName[]; error?: string } {
  const text = format.trim();
  if (text === '') return { fields: [] };
  const fields: FieldName[] = [];
  for (const raw of text.split(',')) {
    const f = raw.trim().toLowerCase();
    if (!(FIELD_NAMES as readonly string[]).includes(f)) return { fields, error: `Неизвестное поле «${raw.trim()}» (доступны: ${FIELD_NAMES.join(', ')})` };
    if (fields.includes(f as FieldName)) return { fields, error: `Поле «${f}» повторяется` };
    fields.push(f as FieldName);
  }
  return { fields };
}

export interface FieldSlot {
  name: FieldName;
  bits: number;
  /** Сдвиг от младшего бита слова. */
  shift: number;
  signed: boolean;
}

export interface InstrLayout {
  opcodeShift: number;
  fields: FieldSlot[];
  usedBits: number;
  error?: string;
}

export function layoutOf(format: string, spec: ComputerSpec): InstrLayout {
  const { fields: names, error } = parseFormat(format);
  let shift = spec.instrBits - spec.opcodeBits;
  const fields: FieldSlot[] = [];
  let used = spec.opcodeBits;
  let err = error;
  for (const name of names) {
    const bits = fieldBits(name, spec);
    if ((name === 'rd' || name === 'rs' || name === 'rt') && spec.arch === 'accumulator') {
      err ??= `Поле «${name}» недоступно в аккумуляторной архитектуре`;
    }
    if (bits === 0 && name !== 'rd' && name !== 'rs' && name !== 'rt') err ??= `Поле «${name}» имеет нулевую ширину`;
    shift -= bits;
    used += bits;
    fields.push({ name, bits, shift, signed: name === 'off' });
  }
  if (shift < 0) err ??= `Операнды не помещаются в ${spec.instrBits}-битное слово: нужно ${used} бит`;
  return { opcodeShift: spec.instrBits - spec.opcodeBits, fields, usedBits: used, error: err };
}

export function encodeWord(inst: Instruction, vals: Partial<Record<FieldName, number>>, spec: ComputerSpec): number {
  const lay = layoutOf(inst.format, spec);
  let word = inst.opcode * 2 ** lay.opcodeShift;
  for (const f of lay.fields) {
    const raw = vals[f.name] ?? 0;
    const v = f.signed ? raw & (2 ** f.bits - 1) : raw;
    word += (v & (2 ** f.bits - 1)) * 2 ** f.shift;
  }
  return word;
}

export interface Decoded {
  inst: Instruction;
  fields: Partial<Record<FieldName, number>>;
}

export function decodeWord(word: number, spec: ComputerSpec, isa: Instruction[], byOpcode?: Map<number, Instruction>): Decoded | null {
  const opcode = Math.floor(word / 2 ** (spec.instrBits - spec.opcodeBits)) & (2 ** spec.opcodeBits - 1);
  const inst = byOpcode ? byOpcode.get(opcode) : isa.find((i) => i.opcode === opcode);
  if (!inst) return null;
  const lay = layoutOf(inst.format, spec);
  const fields: Partial<Record<FieldName, number>> = {};
  for (const f of lay.fields) {
    let v = Math.floor(word / 2 ** f.shift) & (2 ** f.bits - 1);
    if (f.signed && v >= 2 ** (f.bits - 1)) v -= 2 ** f.bits;
    fields[f.name] = v;
  }
  return { inst, fields };
}

// ───────────── Проверка набора инструкций ─────────────

export function validateIsa(spec: ComputerSpec, isa: Instruction[]): Issue[] {
  const out: Issue[] = [];
  const names = new Set<string>();
  const codes = new Map<number, string>();
  if (isa.length === 0) out.push({ level: 'warning', message: 'Набор инструкций пуст.' });
  for (const inst of isa) {
    const w = inst.mnemonic || '(без имени)';
    const err = (message: string): void => void out.push({ level: 'error', message, where: w });
    const warn = (message: string): void => void out.push({ level: 'warning', message, where: w });
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(inst.mnemonic)) err('Мнемоника: латинские буквы и цифры, начинается с буквы.');
    const key = inst.mnemonic.toUpperCase();
    if (names.has(key)) err('Мнемоника повторяется.');
    names.add(key);
    if (!Number.isInteger(inst.opcode) || inst.opcode < 0 || inst.opcode >= 2 ** spec.opcodeBits) err(`Код операции ${inst.opcode} не помещается в ${spec.opcodeBits} бит (0…${2 ** spec.opcodeBits - 1}).`);
    else if (codes.has(inst.opcode)) err(`Код операции ${inst.opcode} уже занят инструкцией ${codes.get(inst.opcode)}.`);
    else codes.set(inst.opcode, inst.mnemonic);
    const lay = layoutOf(inst.format, spec);
    if (lay.error) err(lay.error);
    if (!Number.isInteger(inst.cycles) || inst.cycles < 1) err('Число тактов — целое, не меньше 1.');
    if (inst.code.trim() === '') warn('Код (RTL) пуст — инструкция ничего не делает.');
    else {
      const a = analyzeRtl(inst.code, spec, lay.fields.map((f) => f.name));
      for (const e of a.errors) err(`RTL, строка ${e.line}: ${e.message}`);
      if (a.errors.length === 0) {
        for (const f of lay.fields) {
          if (!a.uses.fields.has(f.name) && f.name !== 'off') warn(`Поле «${f.name}» есть в формате, но не используется в коде.`);
        }
      }
    }
  }
  return out;
}

// ───────────── Конструктор: блоки → RTL / псевдокод ─────────────

const COND_RTL: Record<JumpCond, string> = {
  always: '',
  Z: 'Z',
  NZ: '!Z',
  C: 'C',
  NC: '!C',
  N: 'N',
  NN: '!N',
  V: 'V',
  NV: '!V',
};

export const COND_TEXT: Record<JumpCond, string> = {
  always: 'всегда',
  Z: 'Z=1 (ноль)',
  NZ: 'Z=0 (не ноль)',
  C: 'C=1 (перенос)',
  NC: 'C=0 (нет переноса)',
  N: 'N=1 (отрицательно)',
  NN: 'N=0 (неотрицательно)',
  V: 'V=1 (переполнение)',
  NV: 'V=0 (нет переполнения)',
};

const PLAIN_OPS: Record<string, (a: string, b: string) => string> = {
  ADD: (a, b) => `${a} + ${b}`,
  SUB: (a, b) => `${a} - ${b}`,
  AND: (a, b) => `${a} & ${b}`,
  OR: (a, b) => `${a} | ${b}`,
  XOR: (a, b) => `${a} ^ ${b}`,
  NOT: (a) => `~${a}`,
  SHL: (a) => `${a} << 1`,
  SHR: (a) => `${a} >> 1`,
  INC: (a) => `${a} + 1`,
  DEC: (a) => `${a} - 1`,
  NEG: (a) => `-${a}`,
  MUL: (a, b) => `${a} * ${b}`,
};

export function blockToRtl(b: Block): string {
  switch (b.kind) {
    case 'alu': {
      const fn = ALU_INFO[b.op].fn;
      if (!b.flags && PLAIN_OPS[b.op]) return `${b.dst} = ${PLAIN_OPS[b.op](b.a, b.b ?? '0')}`;
      return `${b.dst} = ${fn}(${b.a}${b.b !== undefined && !['not', 'inc', 'dec', 'neg'].includes(fn) ? `, ${b.b}` : ''})`;
    }
    case 'move':
      return `${b.dst} = ${b.src}`;
    case 'load':
      return `${b.dst} = M[${b.addr}]`;
    case 'store':
      return `M[${b.addr}] = ${b.src}`;
    case 'jump': {
      const dst = b.relative ? `PC = PC + ${b.target}` : `PC = ${b.target}`;
      return b.cond === 'always' ? dst : `if (${COND_RTL[b.cond]}) ${dst}`;
    }
    case 'cmp':
      return `sub(${b.a}, ${b.b})`;
    case 'push':
      return `push(${b.src})`;
    case 'pop':
      return `${b.dst} = pop()`;
    case 'call':
      return `call(${b.target})`;
    case 'ret':
      return 'ret()';
    case 'skip':
      return b.cond === 'always' ? 'skip()' : `if (${COND_RTL[b.cond]}) skip()`;
    case 'halt':
      return 'halt()';
    case 'nop':
      return 'nop()';
  }
}

export function blocksToRtl(blocks: Block[]): string {
  return blocks.map(blockToRtl).join('\n');
}

/** Читаемый псевдокод блока (в виде формул, понятных человеку). */
export function blockToPseudo(b: Block): string {
  const nice = (s: string): string => s.replace(/R\[(\w+)\]/g, '$1').replace(/M\[(.+?)\]/g, 'mem[$1]');
  switch (b.kind) {
    case 'alu': {
      const sym: Record<string, string> = { ADD: '+', SUB: '−', AND: '&', OR: '|', XOR: '^', MUL: '×' };
      const dst = nice(b.dst);
      const a = nice(b.a);
      const bb = b.b !== undefined ? nice(b.b) : '';
      let body: string;
      if (sym[b.op]) body = `${dst} ← ${a} ${sym[b.op]} ${bb}`;
      else if (b.op === 'NOT') body = `${dst} ← ~${a}`;
      else if (b.op === 'INC') body = `${dst} ← ${a} + 1`;
      else if (b.op === 'DEC') body = `${dst} ← ${a} − 1`;
      else if (b.op === 'NEG') body = `${dst} ← −${a}`;
      else body = `${dst} ← ${ALU_INFO[b.op].name.toLowerCase()}(${a})`;
      return body + (b.flags ? ', обновить флаги' : '');
    }
    case 'move':
      return `${nice(b.dst)} ← ${nice(b.src)}`;
    case 'load':
      return `${nice(b.dst)} ← mem[${nice(b.addr)}]`;
    case 'store':
      return `mem[${nice(b.addr)}] ← ${nice(b.src)}`;
    case 'jump': {
      const where = b.relative ? `PC + ${b.target}` : b.target;
      return b.cond === 'always' ? `PC ← ${where}` : `если ${COND_TEXT[b.cond]}: PC ← ${where}`;
    }
    case 'cmp':
      return `сравнить ${nice(b.a)} и ${nice(b.b)} (только флаги)`;
    case 'push':
      return `положить ${nice(b.src)} в стек`;
    case 'pop':
      return `${nice(b.dst)} ← снять со стека`;
    case 'call':
      return `положить адрес возврата в стек; PC ← ${b.target}`;
    case 'ret':
      return 'PC ← снять со стека';
    case 'skip':
      return b.cond === 'always' ? 'пропустить следующую инструкцию' : `если ${COND_TEXT[b.cond]}: пропустить следующую инструкцию`;
    case 'halt':
      return 'остановить процессор';
    case 'nop':
      return 'ничего не делать';
  }
}

export function blocksToPseudo(blocks: Block[]): string {
  return blocks.map(blockToPseudo).join('; ');
}

/** Какие операнды предлагать в блоках конструктора для данного формата. */
export function operandChoices(spec: ComputerSpec, fields: string[]): { dst: string[]; src: string[]; addr: string[]; target: string[] } {
  const has = (f: string): boolean => fields.includes(f);
  const reg = spec.arch === 'accumulator';
  const regs: string[] = [];
  if (reg) regs.push('A');
  else for (const f of ['rd', 'rs', 'rt']) if (has(f)) regs.push(`R[${f}]`);
  const dst = [...regs];
  const src = [...regs];
  if (has('imm')) {
    src.push('imm', 'sext(imm)');
  }
  const addr: string[] = [];
  if (has('addr')) addr.push('addr');
  if (has('imm')) addr.push('imm');
  for (const r of regs) if (r !== 'A') addr.push(r);
  if (reg && !has('addr')) addr.push('A');
  if (addr.length) src.push(...addr.map((a) => `M[${a}]`));
  src.push('0', '1');
  const target: string[] = [];
  if (has('target')) target.push('target');
  if (has('off')) target.push('off');
  if (has('addr')) target.push('addr');
  for (const r of regs) if (r !== 'A') target.push(r);
  return { dst, src: [...new Set(src)], addr, target };
}

// ───────────── Шаблоны инструкций (каталог функционала) ─────────────

export interface TemplateParam {
  id: string;
  label: string;
  options: { value: string; label: string }[];
}

export interface InstrTemplate {
  id: string;
  group: string;
  name: string;
  /** Предлагаемая мнемоника. */
  mnemonic: (p: Record<string, string>) => string;
  format: (spec: ComputerSpec) => string;
  blocks: (p: Record<string, string>, spec: ComputerSpec) => Block[];
  description: (p: Record<string, string>) => string;
  /** Подходит ли шаблон к характеристикам; иначе — причина. */
  requires: (spec: ComputerSpec) => string | null;
  params?: (spec: ComputerSpec) => TemplateParam[];
  cycles?: number;
}

const FLAG_ONLY = (spec: ComputerSpec): boolean => spec.flags.length > 0;

function aluTemplate(op: keyof typeof ALU_INFO, kind: 'rr' | 'r' | 'ri' | 'acc' | 'accimm'): InstrTemplate {
  const mn = op;
  const info = ALU_INFO[op];
  const unary = ['NOT', 'INC', 'DEC', 'NEG', 'SHL', 'SHR', 'ASR', 'ROL', 'ROR'].includes(op);
  const fmt = (spec: ComputerSpec): string => {
    if (spec.arch === 'accumulator') return kind === 'accimm' ? 'imm' : unary ? '' : 'addr';
    if (kind === 'rr') return 'rd,rs';
    if (kind === 'ri') return 'rd,imm';
    return 'rd';
  };
  return {
    id: `alu-${op}-${kind}`,
    group: 'Арифметика и логика',
    name: `${info.name}${kind === 'ri' || kind === 'accimm' ? ' с числом' : kind === 'acc' || kind === 'rr' ? (unary ? '' : ' (два операнда)') : ''}`,
    mnemonic: () => (kind === 'ri' || kind === 'accimm' ? `${mn}I` : mn),
    format: fmt,
    blocks: (_p, spec) => {
      const acc = spec.arch === 'accumulator';
      const dst = acc ? 'A' : 'R[rd]';
      if (unary) return [{ kind: 'alu', op, dst, a: dst, flags: FLAG_ONLY(spec) }];
      const b = acc ? (kind === 'accimm' ? 'imm' : 'M[addr]') : kind === 'ri' ? 'imm' : 'R[rs]';
      return [{ kind: 'alu', op, dst, a: dst, b, flags: FLAG_ONLY(spec) }];
    },
    description: () => `${info.name}`,
    requires: (spec) => {
      if (!spec.aluOps.includes(op)) return `нужна операция АЛУ ${op}`;
      if (spec.arch === 'accumulator' && (kind === 'rr' || kind === 'ri' || kind === 'r')) return 'только для регистровой архитектуры';
      if (spec.arch === 'register' && (kind === 'acc' || kind === 'accimm')) return 'только для аккумуляторной архитектуры';
      return null;
    },
  };
}

export const TEMPLATES: InstrTemplate[] = (() => {
  const t: InstrTemplate[] = [];
  t.push({
    id: 'sys-nop',
    group: 'Система',
    name: 'Пустая операция',
    mnemonic: () => 'NOP',
    format: () => '',
    blocks: () => [{ kind: 'nop' }],
    description: () => 'Ничего не делает',
    requires: () => null,
  });
  t.push({
    id: 'sys-halt',
    group: 'Система',
    name: 'Остановка',
    mnemonic: () => 'HLT',
    format: () => '',
    blocks: () => [{ kind: 'halt' }],
    description: () => 'Останавливает процессор',
    requires: () => null,
  });
  t.push({
    id: 'data-ldi',
    group: 'Данные',
    name: 'Загрузить число в регистр',
    mnemonic: () => 'LDI',
    format: (s) => (s.arch === 'accumulator' ? 'imm' : 'rd,imm'),
    blocks: (_p, s) => [{ kind: 'move', dst: s.arch === 'accumulator' ? 'A' : 'R[rd]', src: 'imm' }],
    description: () => 'Загружает константу',
    requires: () => null,
  });
  t.push({
    id: 'data-mov',
    group: 'Данные',
    name: 'Копировать регистр',
    mnemonic: () => 'MOV',
    format: () => 'rd,rs',
    blocks: () => [{ kind: 'move', dst: 'R[rd]', src: 'R[rs]' }],
    description: () => 'Копирует регистр в регистр',
    requires: (s) => (s.arch === 'accumulator' ? 'только для регистровой архитектуры' : null),
  });
  t.push({
    id: 'mem-ld',
    group: 'Память',
    name: 'Загрузить из памяти по адресу',
    mnemonic: (_p) => (_p.arch === 'acc' ? 'LDA' : 'LD'),
    format: (s) => (s.arch === 'accumulator' ? 'addr' : 'rd,addr'),
    blocks: (_p, s) => [{ kind: 'load', dst: s.arch === 'accumulator' ? 'A' : 'R[rd]', addr: 'addr' }],
    description: () => 'Читает слово из памяти данных (или порта устройства)',
    requires: () => null,
  });
  t.push({
    id: 'mem-st',
    group: 'Память',
    name: 'Записать в память по адресу',
    mnemonic: () => 'ST',
    format: (s) => (s.arch === 'accumulator' ? 'addr' : 'addr,rs'),
    blocks: (_p, s) => [{ kind: 'store', addr: 'addr', src: s.arch === 'accumulator' ? 'A' : 'R[rs]' }],
    description: () => 'Пишет слово в память данных (или порт устройства)',
    requires: () => null,
  });
  t.push({
    id: 'mem-ldr',
    group: 'Память',
    name: 'Загрузить из памяти по адресу в регистре',
    mnemonic: () => 'LDR',
    format: () => 'rd,rs',
    blocks: () => [{ kind: 'load', dst: 'R[rd]', addr: 'R[rs]' }],
    description: () => 'Косвенная загрузка: адрес берётся из регистра',
    requires: (s) => (s.arch === 'accumulator' ? 'только для регистровой архитектуры' : null),
  });
  t.push({
    id: 'mem-str',
    group: 'Память',
    name: 'Записать в память по адресу в регистре',
    mnemonic: () => 'STR',
    format: () => 'rd,rs',
    blocks: () => [{ kind: 'store', addr: 'R[rd]', src: 'R[rs]' }],
    description: () => 'Косвенная запись: адрес в rd, значение в rs',
    requires: (s) => (s.arch === 'accumulator' ? 'только для регистровой архитектуры' : null),
  });
  for (const op of ['ADD', 'SUB', 'AND', 'OR', 'XOR', 'MUL'] as const) {
    t.push(aluTemplate(op, 'rr'));
    t.push(aluTemplate(op, 'ri'));
    t.push(aluTemplate(op, 'acc'));
    t.push(aluTemplate(op, 'accimm'));
  }
  for (const op of ['NOT', 'INC', 'DEC', 'NEG', 'SHL', 'SHR', 'ASR', 'ROL', 'ROR'] as const) {
    t.push(aluTemplate(op, 'r'));
    t.push(aluTemplate(op, 'acc'));
  }
  t.push({
    id: 'cmp-rr',
    group: 'Арифметика и логика',
    name: 'Сравнить два регистра (только флаги)',
    mnemonic: () => 'CMP',
    format: (s) => (s.arch === 'accumulator' ? 'addr' : 'rd,rs'),
    blocks: (_p, s) => [{ kind: 'cmp', a: s.arch === 'accumulator' ? 'A' : 'R[rd]', b: s.arch === 'accumulator' ? 'M[addr]' : 'R[rs]' }],
    description: () => 'Вычитает без записи результата, выставляя флаги',
    requires: (s) => (!s.aluOps.includes('SUB') ? 'нужна операция АЛУ SUB' : s.flags.length === 0 ? 'нужен хотя бы один флаг' : null),
  });
  t.push({
    id: 'cmp-ri',
    group: 'Арифметика и логика',
    name: 'Сравнить регистр с числом',
    mnemonic: () => 'CMPI',
    format: (s) => (s.arch === 'accumulator' ? 'imm' : 'rd,imm'),
    blocks: (_p, s) => [{ kind: 'cmp', a: s.arch === 'accumulator' ? 'A' : 'R[rd]', b: 'imm' }],
    description: () => 'Сравнение с константой (только флаги)',
    requires: (s) => (!s.aluOps.includes('SUB') ? 'нужна операция АЛУ SUB' : s.flags.length === 0 ? 'нужен хотя бы один флаг' : null),
  });
  const flagJumps: { cond: JumpCond; mn: string; flag: 'Z' | 'C' | 'N' | 'V' }[] = [
    { cond: 'Z', mn: 'JZ', flag: 'Z' },
    { cond: 'NZ', mn: 'JNZ', flag: 'Z' },
    { cond: 'C', mn: 'JC', flag: 'C' },
    { cond: 'NC', mn: 'JNC', flag: 'C' },
    { cond: 'N', mn: 'JN', flag: 'N' },
    { cond: 'NN', mn: 'JNN', flag: 'N' },
    { cond: 'V', mn: 'JV', flag: 'V' },
    { cond: 'NV', mn: 'JNV', flag: 'V' },
  ];
  t.push({
    id: 'jmp',
    group: 'Переходы',
    name: 'Безусловный переход',
    mnemonic: () => 'JMP',
    format: () => 'target',
    blocks: () => [{ kind: 'jump', target: 'target', cond: 'always' }],
    description: () => 'Переход на адрес в ПЗУ',
    requires: () => null,
  });
  for (const j of flagJumps) {
    t.push({
      id: `jmp-${j.cond}`,
      group: 'Переходы',
      name: `Переход, если ${COND_TEXT[j.cond]}`,
      mnemonic: () => j.mn,
      format: () => 'target',
      blocks: () => [{ kind: 'jump', target: 'target', cond: j.cond }],
      description: () => `Переход при условии ${COND_TEXT[j.cond]}`,
      requires: (s) => (s.flags.includes(j.flag) ? null : `нужен флаг ${j.flag}`),
    });
  }
  t.push({
    id: 'jmp-rel',
    group: 'Переходы',
    name: 'Относительный переход',
    mnemonic: () => 'BR',
    format: () => 'off',
    blocks: () => [{ kind: 'jump', target: 'off', cond: 'always', relative: true }],
    description: () => 'Переход на PC + смещение (знаковое)',
    requires: () => null,
  });
  t.push({
    id: 'jmp-reg',
    group: 'Переходы',
    name: 'Переход по адресу в регистре',
    mnemonic: () => 'JR',
    format: () => 'rd',
    blocks: () => [{ kind: 'jump', target: 'R[rd]', cond: 'always' }],
    description: () => 'Переход на адрес, лежащий в регистре',
    requires: (s) => (s.arch === 'accumulator' ? 'только для регистровой архитектуры' : null),
  });
  t.push({
    id: 'skip-if',
    group: 'Переходы',
    name: 'Пропустить следующую, если…',
    mnemonic: (p) => `SK${(p.cond ?? 'Z').replace('N', 'N')}`,
    format: () => '',
    blocks: (p) => [{ kind: 'skip', cond: (p.cond ?? 'Z') as JumpCond }],
    description: (p) => `Пропускает следующую инструкцию, если ${COND_TEXT[(p.cond ?? 'Z') as JumpCond]}`,
    requires: (s) => (s.flags.length === 0 ? 'нужен хотя бы один флаг' : null),
    params: (s) => [
      {
        id: 'cond',
        label: 'Условие',
        options: (['Z', 'NZ', 'C', 'NC', 'N', 'NN', 'V', 'NV'] as JumpCond[])
          .filter((c) => {
            const f = c.replace(/^N(?=[ZCNV])/, '');
            return s.flags.includes(f as 'Z' | 'C' | 'N' | 'V');
          })
          .map((c) => ({ value: c, label: COND_TEXT[c] })),
      },
    ],
  });
  t.push({
    id: 'stack-push',
    group: 'Стек и подпрограммы',
    name: 'Положить в стек',
    mnemonic: () => 'PUSH',
    format: (s) => (s.arch === 'accumulator' ? '' : 'rd'),
    blocks: (_p, s) => [{ kind: 'push', src: s.arch === 'accumulator' ? 'A' : 'R[rd]' }],
    description: () => 'Кладёт значение в стек',
    requires: (s) => (s.stack.enabled ? null : 'нужен стек'),
  });
  t.push({
    id: 'stack-pop',
    group: 'Стек и подпрограммы',
    name: 'Снять со стека',
    mnemonic: () => 'POP',
    format: (s) => (s.arch === 'accumulator' ? '' : 'rd'),
    blocks: (_p, s) => [{ kind: 'pop', dst: s.arch === 'accumulator' ? 'A' : 'R[rd]' }],
    description: () => 'Снимает значение со стека',
    requires: (s) => (s.stack.enabled ? null : 'нужен стек'),
  });
  t.push({
    id: 'stack-call',
    group: 'Стек и подпрограммы',
    name: 'Вызов подпрограммы',
    mnemonic: () => 'CALL',
    format: () => 'target',
    blocks: () => [{ kind: 'call', target: 'target' }],
    description: () => 'Кладёт адрес возврата в стек и переходит',
    requires: (s) => (s.stack.enabled ? null : 'нужен стек'),
  });
  t.push({
    id: 'stack-ret',
    group: 'Стек и подпрограммы',
    name: 'Возврат из подпрограммы',
    mnemonic: () => 'RET',
    format: () => '',
    blocks: () => [{ kind: 'ret' }],
    description: () => 'Снимает адрес возврата со стека и переходит',
    requires: (s) => (s.stack.enabled ? null : 'нужен стек'),
  });
  return t;
})();

export function availableTemplates(spec: ComputerSpec): { template: InstrTemplate; reason: string | null }[] {
  return TEMPLATES.map((template) => ({ template, reason: template.requires(spec) }));
}

/** Собирает инструкцию из шаблона (опкод подбирается свободный). */
export function instructionFromTemplate(tpl: InstrTemplate, params: Record<string, string>, spec: ComputerSpec, isa: Instruction[]): Instruction {
  const blocks = tpl.blocks(params, spec);
  const used = new Set(isa.map((i) => i.opcode));
  const names = new Set(isa.map((i) => i.mnemonic.toUpperCase()));
  let opcode = 0;
  while (used.has(opcode) && opcode < 2 ** spec.opcodeBits) opcode++;
  let mn = tpl.mnemonic({ ...params, arch: spec.arch === 'accumulator' ? 'acc' : 'reg' });
  if (spec.arch === 'accumulator' && tpl.id === 'mem-ld') mn = 'LDA';
  if (spec.arch === 'accumulator' && tpl.id === 'mem-st') mn = 'STA';
  let n = 2;
  const base = mn;
  while (names.has(mn.toUpperCase())) mn = `${base}${n++}`;
  return {
    mnemonic: mn,
    opcode,
    format: tpl.format(spec),
    description: tpl.description(params),
    pseudo: blocksToPseudo(blocks),
    code: blocksToRtl(blocks),
    cycles: tpl.cycles ?? 1,
    blocks,
  };
}

// ───────────── Готовые наборы инструкций ─────────────

/** Порядок важности: если опкодов мало, то менее важное отбрасывается. */
const PRESET_ORDER: string[] = [
  'sys-nop',
  'sys-halt',
  'data-ldi',
  'data-mov',
  'mem-ld',
  'mem-st',
  'alu-ADD-rr',
  'alu-SUB-rr',
  'alu-AND-rr',
  'alu-OR-rr',
  'alu-XOR-rr',
  'alu-ADD-acc',
  'alu-SUB-acc',
  'alu-AND-acc',
  'alu-OR-acc',
  'alu-XOR-acc',
  'jmp',
  'jmp-Z',
  'jmp-NZ',
  'jmp-C',
  'jmp-NC',
  'alu-NOT-r',
  'alu-NOT-acc',
  'alu-SHL-r',
  'alu-SHL-acc',
  'alu-SHR-r',
  'alu-SHR-acc',
  'alu-INC-r',
  'alu-DEC-r',
  'stack-call',
  'stack-ret',
  'stack-push',
  'stack-pop',
  'mem-ldr',
  'mem-str',
  'cmp-rr',
  'alu-ADD-ri',
  'alu-SUB-ri',
  'cmp-ri',
  'jmp-N',
  'jmp-NN',
  'alu-NEG-r',
  'alu-ASR-r',
  'alu-ROL-r',
  'alu-ROR-r',
  'alu-MUL-rr',
  'alu-AND-ri',
  'alu-OR-ri',
  'alu-XOR-ri',
  'jmp-rel',
  'jmp-reg',
  'jmp-V',
  'jmp-NV',
];

export function buildPresetIsa(spec: ComputerSpec): { instructions: Instruction[]; dropped: string[] } {
  const isa: Instruction[] = [];
  const dropped: string[] = [];
  const cap = 2 ** spec.opcodeBits;
  for (const id of PRESET_ORDER) {
    const tpl = TEMPLATES.find((x) => x.id === id);
    if (!tpl || tpl.requires(spec)) continue;
    const params: Record<string, string> = {};
    const inst = instructionFromTemplate(tpl, params, spec, isa);
    if (layoutOf(inst.format, spec).error) {
      dropped.push(`${inst.mnemonic}: ${layoutOf(inst.format, spec).error}`);
      continue;
    }
    if (isa.length >= cap) {
      dropped.push(`${inst.mnemonic}: не хватило кодов операции`);
      continue;
    }
    isa.push(inst);
  }
  return { instructions: isa, dropped };
}

export { ALL_FLAGS };
