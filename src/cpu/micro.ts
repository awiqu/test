import { Block, ComputerSpec, FlagName, Instruction, JumpCond } from '../computer/types';
import { decodeWord, layoutOf } from '../computer/isa';
import { Expr, LValue, Stmt, parseRtl } from '../computer/rtl';

/**
 * Управление физического процессора (аккумуляторная и регистровая архитектуры).
 * Каждая инструкция превращается в набор управляющих сигналов, которые хранятся в строке ПЗУ рядом с операндом:
 * дешифратора кода операции в железе нет — «микрокод» записывается заранее.
 */

export const CTL_NAMES = [
  'uImm', // операнд B = поле операнда инструкции
  'uMem', // операнд B = слово данных по адресу из поля операнда
  'k1', // операнд B = 1
  'sub', // вычитание (B инвертируется, перенос в младший разряд = 1)
  'eSum', // результат = сумма
  'eAnd',
  'eOr',
  'eXor',
  'eNot',
  'eShl',
  'eShr',
  'eB', // результат = B (загрузка)
  'weA', // записать результат в A
  'weF', // обновить флаги
  'weM', // записать A в память данных
  'halt',
  'jAlways',
  'jZ',
  'jNZ',
  'jC',
  'jNC',
  'jN',
  'jNN',
  'jV',
  'jNV',
  // регистровая архитектура: порты чтения файла регистров A (rd/первый операнд, адрес, цель перехода) и B (второй операнд, данные записи)
  'uReg', // операнд B = регистр на порту B
  'uAddrR', // адрес памяти = регистр на порту A (иначе — поле операнда)
  'jReg', // цель перехода = регистр на порту A
] as const;
export type CtlName = (typeof CTL_NAMES)[number];
export type Ctl = Record<CtlName, boolean>;

export function emptyCtl(): Ctl {
  const c = {} as Ctl;
  for (const n of CTL_NAMES) c[n] = false;
  return c;
}

export type OperandField = 'imm' | 'addr' | 'target';

/** Поля инструкции, которые выбирают регистры. */
export type RegField = 'rd' | 'rs' | 'rt';

/** Регистровая архитектура: какое поле выбирает регистр на порту A, на порту B и куда пишется результат. */
export interface RegRoles {
  a?: RegField;
  b?: RegField;
  w?: RegField;
}

export interface MicroInst {
  ctl: Ctl;
  /** Какое поле инструкции подаётся как операнд. */
  field: OperandField | null;
  /** Регистровая архитектура: роли регистровых полей. */
  regs?: RegRoles;
}

export interface MicroResult {
  micro?: MicroInst;
  error?: string;
}

const COND_CTL: Record<JumpCond, { name: CtlName; flag?: FlagName; neg?: boolean }> = {
  always: { name: 'jAlways' },
  Z: { name: 'jZ', flag: 'Z' },
  NZ: { name: 'jNZ', flag: 'Z', neg: true },
  C: { name: 'jC', flag: 'C' },
  NC: { name: 'jNC', flag: 'C', neg: true },
  N: { name: 'jN', flag: 'N' },
  NN: { name: 'jNN', flag: 'N', neg: true },
  V: { name: 'jV', flag: 'V' },
  NV: { name: 'jNV', flag: 'V', neg: true },
};

type Src =
  | { kind: 'A' }
  | { kind: 'imm' }
  | { kind: 'const'; v: 0 | 1 }
  | { kind: 'mem' }
  | { kind: 'reg'; f: RegField }
  | { kind: 'memr'; f: RegField };

const REG_RE = /^R\[(rd|rs|rt)\]$/;
const MEMR_RE = /^M\[R\[(rd|rs|rt)\]\]$/;

function parseSrc(s: string | undefined): Src | null {
  if (s === undefined) return null;
  const t = s.replace(/\s+/g, '');
  if (t === 'A') return { kind: 'A' };
  if (t === 'imm' || t === 'sext(imm)' || t === 'addr' || t === 'target') return { kind: 'imm' };
  if (t === '0') return { kind: 'const', v: 0 };
  if (t === '1') return { kind: 'const', v: 1 };
  if (t === 'M[addr]' || t === 'M[imm]') return { kind: 'mem' };
  let m = REG_RE.exec(t);
  if (m) return { kind: 'reg', f: m[1] as RegField };
  m = MEMR_RE.exec(t);
  if (m) return { kind: 'memr', f: m[1] as RegField };
  return null;
}

function fieldOfSrc(s: string): OperandField | null {
  const t = s.replace(/\s+/g, '');
  if (t.includes('imm')) return 'imm';
  if (t.includes('addr')) return 'addr';
  if (t.includes('target')) return 'target';
  return null;
}

// ───────────── RTL → блоки (для инструкций, написанных вручную) ─────────────

const REG_FIELDS = ['rd', 'rs', 'rt'];

function exprToSrc(e: Expr): string | null {
  switch (e.t) {
    case 'id':
      return e.name === 'A' || e.name === 'imm' || e.name === 'addr' ? e.name : null;
    case 'num':
      return e.v === 0 || e.v === 1 ? String(e.v) : null;
    case 'idx': {
      if (e.base === 'R') return e.index.t === 'id' && REG_FIELDS.includes(e.index.name) ? `R[${e.index.name}]` : null;
      if (e.index.t === 'id' && (e.index.name === 'addr' || e.index.name === 'imm')) return `M[${e.index.name}]`;
      const r = exprToSrc(e.index);
      return r !== null && REG_RE.test(r) ? `M[${r}]` : null;
    }
    case 'call':
      return e.name === 'sext' && e.args.length === 1 && e.args[0].t === 'id' && e.args[0].name === 'imm' ? 'imm' : null;
    default:
      return null;
  }
}

/** Приёмник присваивания: A (аккумулятор) или R[rd|rs|rt]. */
function dstOf(t: LValue): string | null {
  if (t.k === 'name' && t.name === 'A') return 'A';
  if (t.k === 'R' && t.index.t === 'id' && REG_FIELDS.includes(t.index.name)) return `R[${t.index.name}]`;
  return null;
}

const isOperandReg = (x: string | null): x is string => x === 'A' || (x !== null && REG_RE.test(x));

const BIN_OPS: Record<string, 'ADD' | 'SUB' | 'AND' | 'OR' | 'XOR'> = { '+': 'ADD', '-': 'SUB', '&': 'AND', '|': 'OR', '^': 'XOR' };
const CALL_OPS: Record<string, 'ADD' | 'SUB' | 'AND' | 'OR' | 'XOR' | 'NOT' | 'SHL' | 'SHR' | 'INC' | 'DEC'> = {
  add: 'ADD',
  sub: 'SUB',
  and: 'AND',
  or: 'OR',
  xor: 'XOR',
  not: 'NOT',
  shl: 'SHL',
  shr: 'SHR',
  inc: 'INC',
  dec: 'DEC',
};

function negCond(name: string): JumpCond {
  return ({ Z: 'NZ', C: 'NC', N: 'NN', V: 'NV' } as Record<string, JumpCond>)[name];
}

function lowerStmt(s: Stmt, out: Block[]): string | null {
  switch (s.t) {
    case 'block':
      for (const x of s.body) {
        const r = lowerStmt(x, out);
        if (r) return r;
      }
      return null;
    case 'call': {
      if (s.name === 'halt') out.push({ kind: 'halt' });
      else if (s.name === 'nop') out.push({ kind: 'nop' });
      else if (s.name === 'sub' && s.args.length === 2) {
        const a = exprToSrc(s.args[0]);
        const b = exprToSrc(s.args[1]);
        if (!isOperandReg(a) || b === null) return 'сравнение: поддерживается sub(A или R[..], операнд)';
        out.push({ kind: 'cmp', a, b });
      } else return `вызов ${s.name}() в физическом процессоре не поддерживается`;
      return null;
    }
    case 'if': {
      if (s.b) return 'условие с веткой else не поддерживается';
      let cond: JumpCond | null = null;
      if (s.c.t === 'id' && ['Z', 'C', 'N', 'V'].includes(s.c.name)) cond = s.c.name as JumpCond;
      else if (s.c.t === 'un' && s.c.op === '!' && s.c.e.t === 'id' && ['Z', 'C', 'N', 'V'].includes(s.c.e.name)) cond = negCond(s.c.e.name);
      if (!cond) return 'условие должно быть флагом (Z, C, N, V) или его отрицанием';
      const inner: Block[] = [];
      const r = lowerStmt(s.a, inner);
      if (r) return r;
      if (inner.length !== 1 || inner[0].kind !== 'jump' || inner[0].cond !== 'always') return 'в условии поддерживается только переход PC = ...';
      out.push({ kind: 'jump', target: inner[0].target, cond });
      return null;
    }
    case 'assign': {
      const t = s.target;
      if (t.k === 'name' && t.name === 'PC' && s.op === '=') {
        const src = s.e.t === 'id' && ['target', 'addr', 'imm'].includes(s.e.name) ? s.e.name : exprToSrc(s.e);
        if (!src || !(['target', 'addr', 'imm'].includes(src) || REG_RE.test(src))) return 'PC можно присвоить только значение поля target/addr/imm или регистр R[..]';
        out.push({ kind: 'jump', target: src, cond: 'always' });
        return null;
      }
      if (t.k === 'M' && s.op === '=') {
        const ix = exprToSrc({ t: 'idx', base: 'M', index: t.index });
        const data = exprToSrc(s.e);
        if (!ix || !isOperandReg(data)) return 'запись в память: M[addr] = A или M[addr] = R[..]';
        out.push({ kind: 'store', addr: ix.slice(2, -1), src: data });
        return null;
      }
      const dst = dstOf(t);
      if (dst !== null) {
        const self: Expr = dst === 'A' ? { t: 'id', name: 'A', line: 0, col: 0 } : { t: 'idx', base: 'R', index: (t as { index: Expr }).index };
        let e = s.e;
        let opFromAssign: string | null = null;
        if (s.op !== '=') {
          opFromAssign = s.op.slice(0, -1);
          if (opFromAssign !== '<<' && opFromAssign !== '>>' && !BIN_OPS[opFromAssign]) return `операция ${s.op} не поддерживается`;
          e = { t: 'bin', op: opFromAssign, l: self, r: s.e } as Expr;
        }
        const src = exprToSrc(e);
        if (src !== null) {
          if (src.startsWith('M[')) out.push({ kind: 'load', dst, addr: src.slice(2, -1) });
          else if (src === dst) out.push({ kind: 'nop' });
          else out.push({ kind: 'move', dst, src });
          return null;
        }
        if (e.t === 'un' && e.op === '~' && isOperandReg(exprToSrc(e.e))) {
          out.push({ kind: 'alu', op: 'NOT', dst, a: exprToSrc(e.e)!, flags: false });
          return null;
        }
        if (e.t === 'bin') {
          const l = exprToSrc(e.l);
          const r = exprToSrc(e.r);
          if (isOperandReg(l) && (e.op === '<<' || e.op === '>>') && e.r.t === 'num' && e.r.v === 1) {
            out.push({ kind: 'alu', op: e.op === '<<' ? 'SHL' : 'SHR', dst, a: l, flags: false });
            return null;
          }
          const op = BIN_OPS[e.op];
          if (op && isOperandReg(l) && r !== null) {
            out.push({ kind: 'alu', op, dst, a: l, b: r, flags: false });
            return null;
          }
        }
        if (e.t === 'call' && CALL_OPS[e.name]) {
          const op = CALL_OPS[e.name];
          const unary = ['NOT', 'SHL', 'SHR', 'INC', 'DEC'].includes(op);
          const a = exprToSrc(e.args[0]);
          if (!isOperandReg(a)) return `${e.name}(): первый аргумент должен быть A или R[..]`;
          if (unary) {
            if (e.args.length !== 1) return `${e.name}() с несколькими аргументами не поддерживается`;
            out.push({ kind: 'alu', op, dst, a, flags: true });
            return null;
          }
          const b = e.args[1] ? exprToSrc(e.args[1]) : null;
          if (e.args.length !== 2 || b === null) return `${e.name}(A, X): X — imm, M[addr], 0, 1 или регистр`;
          out.push({ kind: 'alu', op, dst, a, b, flags: true });
          return null;
        }
        return 'выражение не распознано физическим процессором';
      }
      return `присваивание в ${t.k === 'name' ? t.name : t.k} не поддерживается`;
    }
  }
}

export function rtlToBlocks(code: string): { blocks?: Block[]; error?: string } {
  const { prog, errors } = parseRtl(code);
  if (errors.length) return { error: 'ошибка в RTL' };
  const out: Block[] = [];
  for (const s of prog) {
    const r = lowerStmt(s, out);
    if (r) return { error: r };
  }
  return { blocks: out };
}

// ───────────── блоки → управляющие сигналы ─────────────

function condCtl(cond: JumpCond, spec: ComputerSpec, ctl: Ctl): void {
  const c = COND_CTL[cond];
  if (c.flag && !spec.flags.includes(c.flag)) {
    // нет такого флага: он всегда 0
    if (c.neg) ctl.jAlways = true;
    return;
  }
  ctl[c.name] = true;
}

export function controlFromBlocks(blocks: Block[], spec: ComputerSpec): MicroResult {
  const ctl = emptyCtl();
  const acc = spec.arch === 'accumulator';
  const roles: RegRoles = {};
  let field: OperandField | null = null;
  const useField = (s: string): string | null => {
    const f = fieldOfSrc(s);
    if (f) {
      if (field && field !== f) return `используются разные поля операнда (${field} и ${f})`;
      field = f;
    }
    return null;
  };
  /** Закрепляет регистровое поле за портом: порт A, порт B или запись. */
  const useReg = (role: keyof RegRoles, f: RegField): string | null => {
    if (roles[role] && roles[role] !== f) {
      const port = role === 'w' ? 'записи' : `чтения ${role.toUpperCase()}`;
      return `на порту ${port} нужны два разных регистра (${roles[role]} и ${f}) — в одном такте это невозможно`;
    }
    roles[role] = f;
    return null;
  };
  const real = blocks.filter((b) => b.kind !== 'nop');
  if (real.length > 1) return { error: 'в одной инструкции несколько действий — физический процессор выполняет одно действие за такт' };
  /** Приёмник результата: A (аккумулятор) или R[..] (запись в регистр). */
  const dest = (text: string): string | null => {
    const d = parseSrc(text);
    if (acc) return d?.kind === 'A' ? null : 'запись допускается только в аккумулятор A';
    if (d?.kind !== 'reg') return 'запись допускается только в регистр R[rd|rs|rt]';
    return useReg('w', d.f);
  };
  /** Первый операнд АЛУ/сравнения. */
  const firstOperand = (text: string): string | null => {
    const d = parseSrc(text);
    if (acc) return d?.kind === 'A' ? null : 'первый операнд АЛУ должен быть A';
    if (d?.kind !== 'reg') return 'первый операнд АЛУ должен быть регистром R[rd|rs|rt]';
    return useReg('a', d.f);
  };
  /** Второй операнд / источник: число, константа, память или регистр. */
  const sourceOperand = (text: string): string | null => {
    const src = parseSrc(text);
    if (!src || src.kind === 'A') return `источник «${text}» не поддерживается`;
    const e = useField(text);
    if (e) return e;
    switch (src.kind) {
      case 'imm':
        ctl.uImm = true;
        return null;
      case 'mem':
        ctl.uMem = true;
        return null;
      case 'const':
        if (src.v === 1) ctl.k1 = true;
        return null;
      case 'reg':
        if (acc) return `регистр «${text}» есть только в регистровой архитектуре`;
        ctl.uReg = true;
        return useReg('b', src.f);
      case 'memr':
        if (acc) return `адрес в регистре «${text}» возможен только в регистровой архитектуре`;
        ctl.uMem = true;
        ctl.uAddrR = true;
        return useReg('a', src.f);
    }
  };
  for (const b of real) {
    switch (b.kind) {
      case 'halt':
        ctl.halt = true;
        break;
      case 'move':
      case 'load': {
        const e1 = dest(b.dst);
        if (e1) return { error: e1 };
        const srcText = b.kind === 'move' ? b.src : `M[${b.addr}]`;
        const e2 = sourceOperand(srcText);
        if (e2) return { error: e2 };
        ctl.eB = true;
        ctl.weA = true;
        break;
      }
      case 'store': {
        const data = parseSrc(b.src);
        if (acc) {
          if (data?.kind !== 'A') return { error: 'в память можно записать только A' };
        } else if (data?.kind !== 'reg') return { error: 'в память можно записать только регистр R[rd|rs|rt]' };
        else {
          const e = useReg('b', data.f);
          if (e) return { error: e };
        }
        const addr = parseSrc(`M[${b.addr}]`);
        if (!addr || (addr.kind !== 'mem' && addr.kind !== 'memr')) return { error: `адрес «${b.addr}» не поддерживается (нужен addr, imm или регистр)` };
        if (addr.kind === 'memr') {
          if (acc) return { error: 'адрес в регистре возможен только в регистровой архитектуре' };
          ctl.uAddrR = true;
          const e = useReg('a', addr.f);
          if (e) return { error: e };
        } else {
          const e = useField(`M[${b.addr}]`);
          if (e) return { error: e };
        }
        ctl.weM = true;
        break;
      }
      case 'alu':
      case 'cmp': {
        const e0 = firstOperand(b.a);
        if (e0) return { error: e0 };
        if (b.kind === 'alu') {
          const ed = dest(b.dst);
          if (ed) return { error: ed };
        }
        const op = b.kind === 'alu' ? b.op : 'SUB';
        const unary = ['NOT', 'SHL', 'SHR'].includes(op);
        if (!['ADD', 'SUB', 'AND', 'OR', 'XOR', 'NOT', 'SHL', 'SHR', 'INC', 'DEC'].includes(op)) return { error: `операция ${op} в физическом АЛУ не поддерживается` };
        if (op !== 'INC' && op !== 'DEC' && !unary) {
          if (b.b === undefined) return { error: `второй операнд не задан` };
          const e = sourceOperand(b.b);
          if (e) return { error: e };
        } else if (b.b !== undefined && !unary) {
          return { error: `${op} не принимает второй операнд` };
        }
        if (op === 'ADD' || op === 'INC') ctl.eSum = true;
        if (op === 'SUB' || op === 'DEC') {
          ctl.eSum = true;
          ctl.sub = true;
        }
        if (op === 'INC' || op === 'DEC') ctl.k1 = true;
        if (op === 'AND') ctl.eAnd = true;
        if (op === 'OR') ctl.eOr = true;
        if (op === 'XOR') ctl.eXor = true;
        if (op === 'NOT') ctl.eNot = true;
        if (op === 'SHL') ctl.eShl = true;
        if (op === 'SHR') ctl.eShr = true;
        if (b.kind === 'alu') {
          ctl.weA = true;
          if (b.flags) ctl.weF = true;
        } else ctl.weF = true;
        break;
      }
      case 'jump': {
        if (b.relative) return { error: 'относительные переходы не поддерживаются' };
        const t = parseSrc(b.target);
        if (t?.kind === 'reg') {
          if (acc) return { error: 'переход по регистру возможен только в регистровой архитектуре' };
          ctl.jReg = true;
          const e = useReg('a', t.f);
          if (e) return { error: e };
        } else {
          if (!['target', 'addr', 'imm'].includes(b.target)) return { error: `цель перехода «${b.target}» не поддерживается` };
          const e = useField(b.target);
          if (e) return { error: e };
        }
        condCtl(b.cond, spec, ctl);
        break;
      }
      default:
        return { error: `блок «${b.kind}» (стек, пропуск и т.п.) физический процессор не выполняет` };
    }
  }
  return { micro: { ctl, field, regs: acc ? undefined : roles } };
}

export function deriveControl(inst: Instruction, spec: ComputerSpec): MicroResult {
  let blocks = inst.blocks;
  if (!blocks) {
    const r = rtlToBlocks(inst.code);
    if (!r.blocks) return { error: `RTL: ${r.error}` };
    blocks = r.blocks;
  }
  return controlFromBlocks(blocks, spec);
}

// ───────────── образ ПЗУ → строки управления ─────────────

export interface MicroRow {
  address: number;
  /** Значение поля операнда (0, если у инструкции нет операнда). */
  ob: number;
  ctl: Ctl;
  /** Регистровая архитектура: номера регистров на порту A, порту B и приёмника результата. */
  regs?: { a?: number; b?: number; w?: number };
  mnemonic: string;
  text: string;
}

export interface MicroRom {
  rows: MicroRow[];
  /** Ошибки: инструкции программы, которые нельзя выполнить физически. */
  errors: string[];
  /** Ширина поля операнда в строке (бит). */
  operandBits: number;
}

export function fieldWidth(field: OperandField | null, spec: ComputerSpec): number {
  if (field === 'imm') return spec.dataBits;
  if (field === 'addr') return spec.ramAddrBits;
  if (field === 'target') return spec.pcBits;
  return 0;
}

export function expandRom(words: number[], size: number, spec: ComputerSpec, isa: Instruction[], disasm?: (w: number) => string): MicroRom {
  const rows: MicroRow[] = [];
  const errors: string[] = [];
  const cache = new Map<number, MicroResult>();
  const byOpcode = new Map(isa.map((i) => [i.opcode, i]));
  let operandBits = 0;
  for (let a = 0; a < size; a++) {
    const word = words[a] ?? 0;
    const d = decodeWord(word, spec, isa, byOpcode);
    if (!d) {
      // неизвестный код: эмулятор останавливается с ошибкой — в железе это HLT
      const ctl = emptyCtl();
      ctl.halt = true;
      rows.push({ address: a, ob: 0, ctl, mnemonic: '?', text: `.word 0x${word.toString(16)}` });
      continue;
    }
    let r = cache.get(d.inst.opcode);
    if (!r) {
      r = deriveControl(d.inst, spec);
      cache.set(d.inst.opcode, r);
    }
    if (!r.micro) {
      errors.push(`Адрес ${a}: ${d.inst.mnemonic} — ${r.error}`);
      continue;
    }
    const field = r.micro.field;
    const lay = layoutOf(d.inst.format, spec);
    if (lay.fields.length > 1 && field === null) {
      // в формате несколько полей, но блоки их не используют
    }
    let ob = 0;
    if (field) {
      const v = d.fields[field];
      if (v === undefined) {
        errors.push(`Адрес ${a}: ${d.inst.mnemonic} — в формате инструкции нет поля «${field}»`);
        continue;
      }
      ob = v;
      operandBits = Math.max(operandBits, fieldWidth(field, spec));
    }
    let regs: MicroRow['regs'];
    if (r.micro.regs) {
      regs = {};
      let bad = false;
      for (const role of ['a', 'b', 'w'] as const) {
        const f = r.micro.regs[role];
        if (!f) continue;
        const v = d.fields[f];
        if (v === undefined) {
          errors.push(`Адрес ${a}: ${d.inst.mnemonic} — в формате инструкции нет поля «${f}»`);
          bad = true;
        } else regs[role] = v & (spec.regCount - 1);
      }
      if (bad) continue;
    }
    rows.push({ address: a, ob, ctl: { ...r.micro.ctl }, regs, mnemonic: d.inst.mnemonic, text: disasm ? disasm(word) : d.inst.mnemonic });
  }
  return { rows, errors, operandBits };
}

// ───────────── программная модель железа ─────────────

export interface MicroState {
  pc: number;
  /** Аккумулятор (аккумуляторная архитектура). */
  a: number;
  /** Файл регистров (регистровая архитектура). */
  regs: number[];
  flags: Record<FlagName, number>;
  ram: number[];
  halted: boolean;
}

/**
 * Модель тракта данных «в уравнениях» — повторяет то, что считает построенная схема:
 * B = (uImm ? ob : 0) | (uMem ? mem : 0) | (uReg ? порт B : 0) | k1;  Bx = B ^ sub;  сумма с переносом sub; результат — выбор по e*.
 * Регистровая архитектура: первый операнд и адрес/цель перехода — порт A, второй операнд и данные записи — порт B.
 */
export class MicroMachine {
  state: MicroState;
  constructor(
    readonly spec: ComputerSpec,
    readonly rows: MicroRow[],
    readonly read: (addr: number, st: MicroState) => number,
    readonly write: (addr: number, v: number, st: MicroState) => void,
    ramWords: number,
  ) {
    this.state = { pc: 0, a: 0, regs: new Array(Math.max(1, spec.regCount)).fill(0), flags: { Z: 0, C: 0, N: 0, V: 0 }, ram: new Array(ramWords).fill(0), halted: false };
  }

  step(): void {
    const st = this.state;
    const spec = this.spec;
    if (st.halted) return;
    const row = this.rows[st.pc];
    const m = 2 ** spec.dataBits - 1;
    const W = spec.dataBits;
    const pcMask = 2 ** spec.pcBits - 1;
    if (!row) {
      // за концом программы строк нет: сигналы нулевые, счётчик идёт дальше
      st.pc = (st.pc + 1) & pcMask;
      return;
    }
    const c = row.ctl;
    const reg = spec.arch === 'register';
    const portA = reg ? (row.regs?.a !== undefined ? st.regs[row.regs.a] : 0) : st.a;
    const portB = reg && row.regs?.b !== undefined ? st.regs[row.regs.b] : 0;
    const addr = c.uAddrR ? portA & (2 ** spec.ramAddrBits - 1) : row.ob;
    const mem = c.uMem ? this.read(addr, st) & m : 0;
    const b0 = ((c.uImm ? row.ob & m : 0) | mem | (c.uReg ? portB : 0) | (c.k1 ? 1 : 0)) & m;
    const bx = c.sub ? ~b0 & m : b0;
    const cin = c.sub ? 1 : 0;
    const a = portA;
    const full = a + bx + cin;
    const sum = full & m;
    const cout = full > m ? 1 : 0;
    const carryIntoMsb = ((a & (m >> 1)) + (bx & (m >> 1)) + cin) >> (W - 1);
    let r = 0;
    if (c.eSum) r |= sum;
    if (c.eAnd) r |= a & bx;
    if (c.eOr) r |= a | bx;
    if (c.eXor) r |= a ^ bx;
    if (c.eNot) r |= ~a & m;
    if (c.eShl) r |= (a << 1) & m;
    if (c.eShr) r |= a >> 1;
    if (c.eB) r |= bx;
    r &= m;
    const taken =
      c.jAlways ||
      (c.jZ && st.flags.Z === 1) ||
      (c.jNZ && st.flags.Z === 0) ||
      (c.jC && st.flags.C === 1) ||
      (c.jNC && st.flags.C === 0) ||
      (c.jN && st.flags.N === 1) ||
      (c.jNN && st.flags.N === 0) ||
      (c.jV && st.flags.V === 1) ||
      (c.jNV && st.flags.V === 0);
    if (c.weF) {
      const nz = r === 0 ? 1 : 0;
      const nc = c.eSum ? cout ^ (c.sub ? 1 : 0) : c.eShl ? (a >> (W - 1)) & 1 : c.eShr ? a & 1 : 0;
      const nv = c.eSum ? cout ^ carryIntoMsb : 0;
      const nn = (r >> (W - 1)) & 1;
      if (spec.flags.includes('Z')) st.flags.Z = nz;
      if (spec.flags.includes('C')) st.flags.C = nc;
      if (spec.flags.includes('N')) st.flags.N = nn;
      if (spec.flags.includes('V')) st.flags.V = nv;
    }
    if (c.weM) this.write(addr, reg ? portB : a, st);
    if (c.weA) {
      if (reg) {
        if (row.regs?.w !== undefined) st.regs[row.regs.w] = r;
      } else st.a = r;
    }
    if (c.halt) {
      st.halted = true;
      return;
    }
    const target = c.jReg ? portA & pcMask : row.ob & pcMask;
    st.pc = taken ? target : (st.pc + 1) & pcMask;
  }
}
