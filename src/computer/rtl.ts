import { AluOp, ComputerSpec, FlagName } from './types';
import { ALU_FN_TO_OP, portMap } from './spec';

/**
 * RTL — маленький язык описания работы инструкции.
 * Подробности — в docs/ai/rtl-reference.md.
 */

export interface RtlError {
  message: string;
  line: number;
  col: number;
}

export type Expr =
  | { t: 'num'; v: number }
  | { t: 'id'; name: string; line: number; col: number }
  | { t: 'idx'; base: 'R' | 'M'; index: Expr }
  | { t: 'un'; op: '!' | '~' | '-'; e: Expr }
  | { t: 'bin'; op: string; l: Expr; r: Expr }
  | { t: 'tern'; c: Expr; a: Expr; b: Expr }
  | { t: 'call'; name: string; args: Expr[]; line: number; col: number };

export type LValue = { k: 'R'; index: Expr } | { k: 'M'; index: Expr } | { k: 'name'; name: string; line: number; col: number };

export type Stmt =
  | { t: 'assign'; target: LValue; op: string; e: Expr }
  | { t: 'if'; c: Expr; a: Stmt; b?: Stmt }
  | { t: 'block'; body: Stmt[] }
  | { t: 'call'; name: string; args: Expr[]; line: number; col: number };

// ───────────── Токенизатор ─────────────

interface Tok {
  t: 'num' | 'id' | 'op' | 'sep' | 'eof';
  v: string;
  n?: number;
  line: number;
  col: number;
}

const OPS3 = ['<<=', '>>='];
const OPS2 = ['<<', '>>', '<=', '>=', '==', '!=', '&&', '||', '+=', '-=', '&=', '|=', '^=', '*='];

function tokenize(src: string, errors: RtlError[]): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  let line = 1;
  let col = 1;
  let depth = 0;
  const push = (t: Tok['t'], v: string, n?: number, c = col): void => void toks.push({ t, v, n, line, col: c });
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\n') {
      if (depth === 0) push('sep', ';');
      i++;
      line++;
      col = 1;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      i++;
      col++;
      continue;
    }
    if (ch === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    const c0 = col;
    if (/[0-9]/.test(ch)) {
      let j = i;
      let v: number;
      if (ch === '0' && (src[i + 1] === 'x' || src[i + 1] === 'X')) {
        j = i + 2;
        while (j < src.length && /[0-9a-fA-F]/.test(src[j])) j++;
        v = parseInt(src.slice(i + 2, j), 16);
      } else if (ch === '0' && (src[i + 1] === 'b' || src[i + 1] === 'B')) {
        j = i + 2;
        while (j < src.length && /[01]/.test(src[j])) j++;
        v = parseInt(src.slice(i + 2, j), 2);
      } else {
        while (j < src.length && /[0-9]/.test(src[j])) j++;
        v = parseInt(src.slice(i, j), 10);
      }
      if (Number.isNaN(v)) errors.push({ message: `Неверное число «${src.slice(i, j)}»`, line, col });
      push('num', src.slice(i, j), v, c0);
      col += j - i;
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      push('id', src.slice(i, j), undefined, c0);
      col += j - i;
      i = j;
      continue;
    }
    const three = src.slice(i, i + 3);
    const two = src.slice(i, i + 2);
    if (OPS3.includes(three)) {
      push('op', three, undefined, c0);
      i += 3;
      col += 3;
      continue;
    }
    if (OPS2.includes(two)) {
      push('op', two, undefined, c0);
      i += 2;
      col += 2;
      continue;
    }
    if ('+-*&|^~!<>=?:()[]{},;'.includes(ch)) {
      if (ch === '(' || ch === '[') depth++;
      if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
      if (ch === ';') push('sep', ';', undefined, c0);
      else push('op', ch, undefined, c0);
      i++;
      col++;
      continue;
    }
    errors.push({ message: `Неожиданный символ «${ch}»`, line, col });
    i++;
    col++;
  }
  toks.push({ t: 'eof', v: '', line, col });
  return toks;
}

// ───────────── Разбор ─────────────

class Parser {
  private p = 0;
  constructor(
    private toks: Tok[],
    readonly errors: RtlError[],
  ) {}

  private get cur(): Tok {
    return this.toks[this.p];
  }
  private err(message: string, t = this.cur): void {
    if (!this.errors.some((e) => e.line === t.line && e.col === t.col)) this.errors.push({ message, line: t.line, col: t.col });
  }
  private atEof(): boolean {
    return this.toks[this.p].t === 'eof';
  }
  private isOp(v: string): boolean {
    return this.cur.t === 'op' && this.cur.v === v;
  }
  private eat(v: string): boolean {
    if (this.isOp(v)) {
      this.p++;
      return true;
    }
    return false;
  }
  private expect(v: string): void {
    if (!this.eat(v)) {
      this.err(`Ожидалось «${v}»`);
      throw new Error('parse');
    }
  }
  private skipSeps(): void {
    while (this.cur.t === 'sep') this.p++;
  }

  parseProgram(): Stmt[] {
    const out: Stmt[] = [];
    this.skipSeps();
    while (!this.atEof()) {
      try {
        out.push(this.parseStmt());
      } catch {
        // синхронизация: пропускаем до ближайшего разделителя
        while (!this.atEof() && this.toks[this.p].t !== 'sep') this.p++;
      }
      this.skipSeps();
    }
    return out;
  }

  private parseStmt(): Stmt {
    this.skipSeps();
    const t = this.cur;
    if (this.isOp('{')) {
      this.p++;
      const body: Stmt[] = [];
      this.skipSeps();
      while (!this.isOp('}')) {
        if (this.atEof()) {
          this.err('Не закрыта «{»');
          throw new Error('parse');
        }
        body.push(this.parseStmt());
        this.skipSeps();
      }
      this.p++;
      return { t: 'block', body };
    }
    if (t.t === 'id' && t.v === 'if') {
      this.p++;
      this.expect('(');
      const c = this.parseExpr();
      this.expect(')');
      this.skipSeps();
      const a = this.parseStmt();
      let b: Stmt | undefined;
      const save = this.p;
      this.skipSeps();
      if (this.cur.t === 'id' && this.cur.v === 'else') {
        this.p++;
        this.skipSeps();
        b = this.parseStmt();
      } else this.p = save;
      return { t: 'if', c, a, b };
    }
    if (t.t === 'id') {
      // вызов функции или присваивание
      const next = this.toks[this.p + 1];
      if (next.t === 'op' && next.v === '(' && t.v !== 'R' && t.v !== 'M') {
        this.p += 2;
        const args = this.parseArgs();
        return { t: 'call', name: t.v, args, line: t.line, col: t.col };
      }
      const target = this.parseLValue();
      const opTok = this.cur;
      if (opTok.t === 'op' && ['=', '+=', '-=', '&=', '|=', '^=', '<<=', '>>=', '*='].includes(opTok.v)) {
        this.p++;
        const e = this.parseExpr();
        return { t: 'assign', target, op: opTok.v, e };
      }
      this.err('Ожидалось присваивание «=»', opTok);
      throw new Error('parse');
    }
    this.err(`Неожиданный элемент «${t.v || 'конец'}»`);
    throw new Error('parse');
  }

  private parseLValue(): LValue {
    const t = this.cur;
    if (t.t !== 'id') {
      this.err('Ожидалось имя');
      throw new Error('parse');
    }
    this.p++;
    if ((t.v === 'R' || t.v === 'M') && this.isOp('[')) {
      this.p++;
      const index = this.parseExpr();
      this.expect(']');
      return { k: t.v, index };
    }
    return { k: 'name', name: t.v, line: t.line, col: t.col };
  }

  private parseArgs(): Expr[] {
    const args: Expr[] = [];
    if (this.eat(')')) return args;
    for (;;) {
      args.push(this.parseExpr());
      if (this.eat(',')) continue;
      this.expect(')');
      return args;
    }
  }

  parseExpr(): Expr {
    return this.parseTernary();
  }

  private parseTernary(): Expr {
    const c = this.parseBin(0);
    if (this.eat('?')) {
      const a = this.parseTernary();
      this.expect(':');
      const b = this.parseTernary();
      return { t: 'tern', c, a, b };
    }
    return c;
  }

  private static LEVELS: string[][] = [['||'], ['&&'], ['|'], ['^'], ['&'], ['==', '!='], ['<', '<=', '>', '>='], ['<<', '>>'], ['+', '-'], ['*']];

  private parseBin(level: number): Expr {
    if (level >= Parser.LEVELS.length) return this.parseUnary();
    let l = this.parseBin(level + 1);
    for (;;) {
      const t = this.cur;
      if (t.t === 'op' && Parser.LEVELS[level].includes(t.v)) {
        this.p++;
        const r = this.parseBin(level + 1);
        l = { t: 'bin', op: t.v, l, r };
      } else return l;
    }
  }

  private parseUnary(): Expr {
    const t = this.cur;
    if (t.t === 'op' && (t.v === '!' || t.v === '~' || t.v === '-')) {
      this.p++;
      return { t: 'un', op: t.v, e: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Expr {
    const t = this.cur;
    if (t.t === 'num') {
      this.p++;
      return { t: 'num', v: t.n ?? 0 };
    }
    if (t.t === 'op' && t.v === '(') {
      this.p++;
      const e = this.parseExpr();
      this.expect(')');
      return e;
    }
    if (t.t === 'id') {
      this.p++;
      if ((t.v === 'R' || t.v === 'M') && this.isOp('[')) {
        this.p++;
        const index = this.parseExpr();
        this.expect(']');
        return { t: 'idx', base: t.v, index };
      }
      if (this.isOp('(')) {
        this.p++;
        const args = this.parseArgs();
        return { t: 'call', name: t.v, args, line: t.line, col: t.col };
      }
      return { t: 'id', name: t.v, line: t.line, col: t.col };
    }
    this.err(`Ожидалось выражение, найдено «${t.v || 'конец'}»`);
    throw new Error('parse');
  }
}

export function parseRtl(src: string): { prog: Stmt[]; errors: RtlError[] } {
  const errors: RtlError[] = [];
  const toks = tokenize(src, errors);
  const parser = new Parser(toks, errors);
  const prog = parser.parseProgram();
  return { prog, errors };
}

// ───────────── Справочник функций ─────────────

/** Выражения-функции: [мин. аргументов, макс. аргументов, меняет флаги]. */
export const EXPR_FUNCS: Record<string, [number, number]> = {
  add: [2, 3],
  sub: [2, 2],
  and: [2, 2],
  or: [2, 2],
  xor: [2, 2],
  not: [1, 1],
  shl: [1, 2],
  shr: [1, 2],
  asr: [1, 2],
  rol: [1, 2],
  ror: [1, 2],
  inc: [1, 1],
  dec: [1, 1],
  neg: [1, 1],
  mul: [2, 2],
  sext: [1, 1],
  msb: [1, 1],
  lsb: [1, 1],
  mask: [1, 1],
  lt_s: [2, 2],
  pop: [0, 0],
  peek: [0, 0],
};

export const STMT_FUNCS: Record<string, [number, number]> = {
  halt: [0, 0],
  nop: [0, 0],
  push: [1, 1],
  call: [1, 1],
  ret: [0, 0],
  setZN: [1, 1],
  setC: [1, 1],
  setV: [1, 1],
  skip: [0, 0],
};

export const RTL_FIELDS = ['rd', 'rs', 'rt', 'imm', 'addr', 'target', 'off'];
const SPECIAL_NAMES = ['A', 'PC', 'SP', 'Z', 'C', 'N', 'V', 't0', 't1', 't2', 't3', 'W', 'MASK'];
const WRITABLE_NAMES = ['A', 'PC', 'SP', 'Z', 'C', 'N', 'V', 't0', 't1', 't2', 't3'];

// ───────────── Анализ ─────────────

export interface RtlUses {
  fields: Set<string>;
  alu: Set<AluOp>;
  flagsRead: Set<FlagName>;
  flagsWritten: Set<FlagName>;
  stack: boolean;
  writesPc: boolean;
  writesMem: boolean;
  readsMem: boolean;
  halts: boolean;
  ports: Set<string>;
}

export interface RtlAnalysis {
  prog: Stmt[];
  errors: RtlError[];
  uses: RtlUses;
}

/** Разбор и проверка кода инструкции относительно характеристик и формата. */
export function analyzeRtl(src: string, spec: ComputerSpec, formatFields: string[]): RtlAnalysis {
  const { prog, errors } = parseRtl(src);
  const uses: RtlUses = {
    fields: new Set(),
    alu: new Set(),
    flagsRead: new Set(),
    flagsWritten: new Set(),
    stack: false,
    writesPc: false,
    writesMem: false,
    readsMem: false,
    halts: false,
    ports: new Set(),
  };
  const ports = new Set(portMap(spec).map((p) => p.name));
  const err = (message: string, line: number, col: number): void => void errors.push({ message, line, col });
  const hasFlag = (f: string): boolean => spec.flags.includes(f as FlagName);

  const needStack = (name: string, line: number, col: number): void => {
    uses.stack = true;
    if (!spec.stack.enabled) err(`«${name}» требует стека — включите стек в характеристиках`, line, col);
  };

  const visitExpr = (e: Expr): void => {
    switch (e.t) {
      case 'num':
        return;
      case 'id': {
        const n = e.name;
        if (RTL_FIELDS.includes(n)) {
          uses.fields.add(n);
          if (!formatFields.includes(n)) err(`Поле «${n}» не входит в формат инструкции`, e.line, e.col);
        } else if (['Z', 'C', 'N', 'V'].includes(n)) {
          uses.flagsRead.add(n as FlagName);
          if (!hasFlag(n)) err(`Флаг ${n} не выбран в характеристиках`, e.line, e.col);
        } else if (n === 'A') {
          if (spec.arch !== 'accumulator') err('Имя «A» — только для аккумуляторной архитектуры; используйте R[...]', e.line, e.col);
        } else if (SPECIAL_NAMES.includes(n)) {
          if (n === 'SP') needStack('SP', e.line, e.col);
        } else if (ports.has(n)) uses.ports.add(n);
        else err(`Неизвестное имя «${n}»`, e.line, e.col);
        return;
      }
      case 'idx':
        if (e.base === 'M') uses.readsMem = true;
        visitExpr(e.index);
        return;
      case 'un':
        visitExpr(e.e);
        return;
      case 'bin':
        visitExpr(e.l);
        visitExpr(e.r);
        return;
      case 'tern':
        visitExpr(e.c);
        visitExpr(e.a);
        visitExpr(e.b);
        return;
      case 'call': {
        const sig = EXPR_FUNCS[e.name];
        if (!sig) {
          if (STMT_FUNCS[e.name]) err(`«${e.name}()» нельзя использовать внутри выражения`, e.line, e.col);
          else err(`Неизвестная функция «${e.name}»`, e.line, e.col);
        } else {
          if (e.args.length < sig[0] || e.args.length > sig[1]) err(`«${e.name}» принимает аргументов: ${sig[0] === sig[1] ? sig[0] : `${sig[0]}–${sig[1]}`}`, e.line, e.col);
          const op = ALU_FN_TO_OP[e.name];
          if (op) {
            uses.alu.add(op);
            if (!spec.aluOps.includes(op)) err(`Операция АЛУ ${op} (${e.name}) не выбрана в характеристиках`, e.line, e.col);
          }
          if (e.name === 'pop' || e.name === 'peek') needStack(e.name, e.line, e.col);
        }
        e.args.forEach(visitExpr);
        return;
      }
    }
  };

  const visitStmt = (s: Stmt): void => {
    switch (s.t) {
      case 'block':
        s.body.forEach(visitStmt);
        return;
      case 'if':
        visitExpr(s.c);
        visitStmt(s.a);
        if (s.b) visitStmt(s.b);
        return;
      case 'assign': {
        const t = s.target;
        if (t.k === 'R' || t.k === 'M') {
          if (t.k === 'M') uses.writesMem = true;
          visitExpr(t.index);
        } else if (!WRITABLE_NAMES.includes(t.name)) {
          if (RTL_FIELDS.includes(t.name)) err(`Поле «${t.name}» нельзя изменять`, t.line, t.col);
          else if (ports.has(t.name)) err(`«${t.name}» — адрес порта, пишите через M[${t.name}] = …`, t.line, t.col);
          else err(`Нельзя присваивать «${t.name}»`, t.line, t.col);
        } else {
          if (t.name === 'PC') uses.writesPc = true;
          if (t.name === 'SP') needStack('SP', t.line, t.col);
          if (t.name === 'A' && spec.arch !== 'accumulator') err('Имя «A» — только для аккумуляторной архитектуры', t.line, t.col);
          if (['Z', 'C', 'N', 'V'].includes(t.name)) {
            uses.flagsWritten.add(t.name as FlagName);
            if (!hasFlag(t.name)) err(`Флаг ${t.name} не выбран в характеристиках`, t.line, t.col);
          }
        }
        if (s.op !== '=' && t.k === 'M') uses.readsMem = true;
        visitExpr(s.e);
        return;
      }
      case 'call': {
        const sig = STMT_FUNCS[s.name] ?? EXPR_FUNCS[s.name];
        if (!sig) {
          err(`Неизвестная функция «${s.name}»`, s.line, s.col);
        } else if (s.args.length < sig[0] || s.args.length > sig[1]) {
          err(`«${s.name}» принимает аргументов: ${sig[0] === sig[1] ? sig[0] : `${sig[0]}–${sig[1]}`}`, s.line, s.col);
        }
        if (s.name === 'halt') uses.halts = true;
        if (s.name === 'call' || s.name === 'ret' || s.name === 'push') needStack(s.name, s.line, s.col);
        if (s.name === 'call' || s.name === 'ret' || s.name === 'skip') uses.writesPc = true;
        if (s.name === 'push') uses.writesMem = true;
        if (s.name === 'pop' || s.name === 'peek') needStack(s.name, s.line, s.col);
        if (s.name === 'setC' || s.name === 'setV' || s.name === 'setZN') {
          const fl = s.name === 'setC' ? ['C'] : s.name === 'setV' ? ['V'] : ['Z', 'N'];
          for (const f of fl) {
            if (hasFlag(f)) uses.flagsWritten.add(f as FlagName);
          }
        }
        const op = ALU_FN_TO_OP[s.name];
        if (op) {
          uses.alu.add(op);
          if (!spec.aluOps.includes(op)) err(`Операция АЛУ ${op} (${s.name}) не выбрана в характеристиках`, s.line, s.col);
        }
        s.args.forEach(visitExpr);
        return;
      }
    }
  };
  prog.forEach(visitStmt);
  return { prog, errors, uses };
}

// ───────────── Исполнение ─────────────

export interface RtlEnv {
  dataBits: number;
  mask: number;
  ramMask: number;
  pcMask: number;
  hasFlag: Record<FlagName, boolean>;
  stackEnabled: boolean;
  R: number[];
  read(addr: number): number;
  write(addr: number, v: number): void;
  /** Адрес выполняемой инструкции. */
  pc: number;
  /** Куда перейти после инструкции (null — на следующую). */
  nextPc: number | null;
  sp: number;
  flags: Record<FlagName, number>;
  t: number[];
  fields: Record<string, number>;
  consts: Record<string, number>;
  halted: boolean;
}

function setFlag(env: RtlEnv, f: FlagName, v: number): void {
  if (env.hasFlag[f]) env.flags[f] = v ? 1 : 0;
}

function msbOf(env: RtlEnv, x: number): number {
  return (x >>> (env.dataBits - 1)) & 1;
}

function flagsZN(env: RtlEnv, res: number): void {
  setFlag(env, 'Z', res === 0 ? 1 : 0);
  setFlag(env, 'N', msbOf(env, res));
}

export function aluCall(name: string, a: number, b: number, c: number, env: RtlEnv): number {
  const m = env.mask;
  const W = env.dataBits;
  a &= m;
  b &= m;
  switch (name) {
    case 'add':
    case 'inc': {
      if (name === 'inc') {
        b = 1;
        c = 0;
      }
      const full = a + b + (c & 1);
      const res = full & m;
      setFlag(env, 'C', full > m ? 1 : 0);
      setFlag(env, 'V', ((~(a ^ b) & (a ^ res)) >>> (W - 1)) & 1);
      flagsZN(env, res);
      return res;
    }
    case 'sub':
    case 'dec':
    case 'neg': {
      if (name === 'dec') b = 1;
      if (name === 'neg') {
        b = a;
        a = 0;
      }
      const res = (a - b) & m;
      setFlag(env, 'C', a < b ? 1 : 0);
      setFlag(env, 'V', (((a ^ b) & (a ^ res)) >>> (W - 1)) & 1);
      flagsZN(env, res);
      return res;
    }
    case 'and':
    case 'or':
    case 'xor': {
      const res = name === 'and' ? a & b : name === 'or' ? a | b : a ^ b;
      setFlag(env, 'C', 0);
      setFlag(env, 'V', 0);
      flagsZN(env, res);
      return res;
    }
    case 'not': {
      const res = ~a & m;
      setFlag(env, 'C', 0);
      setFlag(env, 'V', 0);
      flagsZN(env, res);
      return res;
    }
    case 'shl':
    case 'shr':
    case 'asr':
    case 'rol':
    case 'ror': {
      let n = b;
      let res = a;
      let carry = 0;
      if (c === 0 && b === 0) n = 1; // значение по умолчанию (один бит)
      for (let i = 0; i < n; i++) {
        if (name === 'shl') {
          carry = msbOf(env, res);
          res = (res << 1) & m;
        } else if (name === 'shr') {
          carry = res & 1;
          res = res >>> 1;
        } else if (name === 'asr') {
          carry = res & 1;
          res = (res >>> 1) | (res & (1 << (W - 1)));
        } else if (name === 'rol') {
          carry = msbOf(env, res);
          res = ((res << 1) | carry) & m;
        } else {
          carry = res & 1;
          res = (res >>> 1) | (carry << (W - 1));
        }
      }
      setFlag(env, 'C', carry);
      setFlag(env, 'V', 0);
      flagsZN(env, res);
      return res;
    }
    case 'mul': {
      const full = a * b;
      const res = full & m;
      setFlag(env, 'C', Math.floor(full / (m + 1)) !== 0 ? 1 : 0);
      setFlag(env, 'V', 0);
      flagsZN(env, res);
      return res;
    }
  }
  return 0;
}

function evalExpr(e: Expr, env: RtlEnv): number {
  switch (e.t) {
    case 'num':
      return e.v;
    case 'id': {
      const n = e.name;
      if (n in env.fields) return env.fields[n];
      switch (n) {
        case 'A':
          return env.R[0];
        case 'PC':
          return env.pc;
        case 'SP':
          return env.sp;
        case 'Z':
        case 'C':
        case 'N':
        case 'V':
          return env.flags[n];
        case 't0':
        case 't1':
        case 't2':
        case 't3':
          return env.t[Number(n[1])];
        case 'W':
          return env.dataBits;
        case 'MASK':
          return env.mask;
      }
      return env.consts[n] ?? 0;
    }
    case 'idx': {
      const i = evalExpr(e.index, env);
      if (e.base === 'R') return env.R[((i % env.R.length) + env.R.length) % env.R.length];
      return env.read(i & env.ramMask) & env.mask;
    }
    case 'un': {
      const v = evalExpr(e.e, env);
      if (e.op === '!') return v === 0 ? 1 : 0;
      if (e.op === '~') return ~v & env.mask;
      return -v & env.mask;
    }
    case 'bin': {
      if (e.op === '&&') return evalExpr(e.l, env) !== 0 && evalExpr(e.r, env) !== 0 ? 1 : 0;
      if (e.op === '||') return evalExpr(e.l, env) !== 0 || evalExpr(e.r, env) !== 0 ? 1 : 0;
      const l = evalExpr(e.l, env);
      const r = evalExpr(e.r, env);
      switch (e.op) {
        case '+':
          return l + r;
        case '-':
          return l - r;
        case '*':
          return l * r;
        case '&':
          return l & r;
        case '|':
          return l | r;
        case '^':
          return l ^ r;
        case '<<':
          return l << (r & 31);
        case '>>':
          return l >> (r & 31);
        case '==':
          return l === r ? 1 : 0;
        case '!=':
          return l !== r ? 1 : 0;
        case '<':
          return l < r ? 1 : 0;
        case '<=':
          return l <= r ? 1 : 0;
        case '>':
          return l > r ? 1 : 0;
        case '>=':
          return l >= r ? 1 : 0;
      }
      return 0;
    }
    case 'tern':
      return evalExpr(e.c, env) !== 0 ? evalExpr(e.a, env) : evalExpr(e.b, env);
    case 'call': {
      const a = e.args.map((x) => evalExpr(x, env));
      switch (e.name) {
        case 'sext': {
          const v = a[0] & env.mask;
          return v & (1 << (env.dataBits - 1)) ? v - (1 << env.dataBits) : v;
        }
        case 'msb':
          return msbOf(env, a[0] & env.mask);
        case 'lsb':
          return a[0] & 1;
        case 'mask':
          return a[0] & env.mask;
        case 'lt_s': {
          const sx = (v: number): number => ((v & env.mask) & (1 << (env.dataBits - 1)) ? (v & env.mask) - (1 << env.dataBits) : v & env.mask);
          return sx(a[0]) < sx(a[1]) ? 1 : 0;
        }
        case 'pop': {
          const v = env.read(env.sp & env.ramMask) & env.mask;
          env.sp = (env.sp + 1) & env.ramMask;
          return v;
        }
        case 'peek':
          return env.read(env.sp & env.ramMask) & env.mask;
        case 'add':
          return aluCall('add', a[0], a[1], a[2] ?? 0, env);
        case 'shl':
        case 'shr':
        case 'asr':
        case 'rol':
        case 'ror':
          return aluCall(e.name, a[0], a[1] ?? 0, a.length > 1 ? 1 : 0, env);
        default:
          return aluCall(e.name, a[0], a[1] ?? 0, 0, env);
      }
    }
  }
}

function assignValue(env: RtlEnv, t: LValue, v: number): void {
  if (t.k === 'R') {
    const i = evalExpr(t.index, env);
    env.R[((i % env.R.length) + env.R.length) % env.R.length] = v & env.mask;
    return;
  }
  if (t.k === 'M') {
    env.write(evalExpr(t.index, env) & env.ramMask, v & env.mask);
    return;
  }
  switch (t.name) {
    case 'A':
      env.R[0] = v & env.mask;
      return;
    case 'PC':
      env.nextPc = v & env.pcMask;
      return;
    case 'SP':
      env.sp = v & env.ramMask;
      return;
    case 'Z':
    case 'C':
    case 'N':
    case 'V':
      setFlag(env, t.name, v);
      return;
    default:
      env.t[Number(t.name[1])] = v;
  }
}

function currentValue(env: RtlEnv, t: LValue): number {
  if (t.k === 'R') return evalExpr({ t: 'idx', base: 'R', index: t.index }, env);
  if (t.k === 'M') return evalExpr({ t: 'idx', base: 'M', index: t.index }, env);
  return evalExpr({ t: 'id', name: t.name, line: 0, col: 0 }, env);
}

function push(env: RtlEnv, v: number): void {
  env.sp = (env.sp - 1) & env.ramMask;
  env.write(env.sp, v & env.mask);
}

function execStmt(s: Stmt, env: RtlEnv): void {
  switch (s.t) {
    case 'block':
      for (const x of s.body) execStmt(x, env);
      return;
    case 'if':
      if (evalExpr(s.c, env) !== 0) execStmt(s.a, env);
      else if (s.b) execStmt(s.b, env);
      return;
    case 'assign': {
      let v = evalExpr(s.e, env);
      if (s.op !== '=') {
        const cur = currentValue(env, s.target);
        switch (s.op) {
          case '+=':
            v = cur + v;
            break;
          case '-=':
            v = cur - v;
            break;
          case '*=':
            v = cur * v;
            break;
          case '&=':
            v = cur & v;
            break;
          case '|=':
            v = cur | v;
            break;
          case '^=':
            v = cur ^ v;
            break;
          case '<<=':
            v = cur << (v & 31);
            break;
          case '>>=':
            v = cur >> (v & 31);
            break;
        }
      }
      assignValue(env, s.target, v);
      return;
    }
    case 'call': {
      const a = s.args.map((x) => evalExpr(x, env));
      switch (s.name) {
        case 'halt':
          env.halted = true;
          return;
        case 'nop':
          return;
        case 'push':
          push(env, a[0]);
          return;
        case 'call':
          push(env, env.pc + 1);
          env.nextPc = a[0] & env.pcMask;
          return;
        case 'ret': {
          const v = env.read(env.sp & env.ramMask) & env.mask;
          env.sp = (env.sp + 1) & env.ramMask;
          env.nextPc = v & env.pcMask;
          return;
        }
        case 'setZN':
          flagsZN(env, a[0] & env.mask);
          return;
        case 'setC':
          setFlag(env, 'C', a[0]);
          return;
        case 'setV':
          setFlag(env, 'V', a[0]);
          return;
        case 'skip':
          env.nextPc = (env.pc + 2) & env.pcMask;
          return;
        default:
          // функции-выражения как операторы (например, sub(...) ради флагов)
          evalExpr({ t: 'call', name: s.name, args: s.args, line: s.line, col: s.col }, env);
      }
    }
  }
}

export function execProgram(prog: Stmt[], env: RtlEnv): void {
  for (const s of prog) execStmt(s, env);
}

// ───────────── Перевод в Python ─────────────

const PY_FUNCS: Record<string, string> = {
  add: 'alu_add',
  sub: 'alu_sub',
  and: 'alu_and',
  or: 'alu_or',
  xor: 'alu_xor',
  not: 'alu_not',
  shl: 'alu_shl',
  shr: 'alu_shr',
  asr: 'alu_asr',
  rol: 'alu_rol',
  ror: 'alu_ror',
  inc: 'alu_inc',
  dec: 'alu_dec',
  neg: 'alu_neg',
  mul: 'alu_mul',
  sext: 'sext',
  msb: 'msb',
  lsb: 'lsb',
  mask: 'mask',
  lt_s: 'lt_s',
  pop: 'pop',
  peek: 'peek',
  halt: 'halt',
  nop: 'nop',
  push: 'push',
  call: 'do_call',
  ret: 'ret',
  setZN: 'set_zn',
  setC: 'set_c',
  setV: 'set_v',
  skip: 'skip',
};

function pyExpr(e: Expr): string {
  switch (e.t) {
    case 'num':
      return String(e.v);
    case 'id':
      if (RTL_FIELDS.includes(e.name)) return `f_${e.name}`;
      if (['Z', 'C', 'N', 'V'].includes(e.name)) return `m.flag('${e.name}')`;
      if (e.name === 'A') return 'm.R[0]';
      if (e.name === 'PC') return 'm.pc';
      if (e.name === 'SP') return 'm.sp';
      if (/^t[0-3]$/.test(e.name)) return `m.t[${e.name[1]}]`;
      if (e.name === 'W') return 'm.W';
      if (e.name === 'MASK') return 'm.MASK';
      return `m.PORTS['${e.name}']`;
    case 'idx':
      return e.base === 'R' ? `m.R[(${pyExpr(e.index)}) % len(m.R)]` : `m.read(${pyExpr(e.index)})`;
    case 'un':
      if (e.op === '!') return `(1 if (${pyExpr(e.e)}) == 0 else 0)`;
      if (e.op === '~') return `((~(${pyExpr(e.e)})) & m.MASK)`;
      return `((-(${pyExpr(e.e)})) & m.MASK)`;
    case 'bin': {
      const l = pyExpr(e.l);
      const r = pyExpr(e.r);
      if (e.op === '&&') return `(1 if ((${l}) != 0 and (${r}) != 0) else 0)`;
      if (e.op === '||') return `(1 if ((${l}) != 0 or (${r}) != 0) else 0)`;
      if (['==', '!=', '<', '<=', '>', '>='].includes(e.op)) return `(1 if (${l}) ${e.op} (${r}) else 0)`;
      if (e.op === '<<') return `((${l}) << ((${r}) & 31))`;
      if (e.op === '>>') return `((${l}) >> ((${r}) & 31))`;
      return `((${l}) ${e.op} (${r}))`;
    }
    case 'tern':
      return `((${pyExpr(e.a)}) if (${pyExpr(e.c)}) != 0 else (${pyExpr(e.b)}))`;
    case 'call': {
      const args = e.args.map(pyExpr);
      if (['shl', 'shr', 'asr', 'rol', 'ror'].includes(e.name)) return `m.${PY_FUNCS[e.name]}(${args[0]}, ${args.length > 1 ? args[1] : 'None'})`;
      return `m.${PY_FUNCS[e.name] ?? e.name}(${args.join(', ')})`;
    }
  }
}

function pyAssign(t: LValue, valueExpr: string): string {
  if (t.k === 'R') return `m.R[(${pyExpr(t.index)}) % len(m.R)] = (${valueExpr}) & m.MASK`;
  if (t.k === 'M') return `m.write(${pyExpr(t.index)}, ${valueExpr})`;
  switch (t.name) {
    case 'A':
      return `m.R[0] = (${valueExpr}) & m.MASK`;
    case 'PC':
      return `m.next_pc = (${valueExpr}) & m.PC_MASK`;
    case 'SP':
      return `m.sp = (${valueExpr}) & m.RAM_MASK`;
    case 'Z':
    case 'C':
    case 'N':
    case 'V':
      return `m.set_flag('${t.name}', ${valueExpr})`;
    default:
      return `m.t[${t.name[1]}] = ${valueExpr}`;
  }
}

function pyStmt(s: Stmt, ind: string, out: string[]): void {
  switch (s.t) {
    case 'block':
      if (s.body.length === 0) out.push(`${ind}pass`);
      for (const x of s.body) pyStmt(x, ind, out);
      return;
    case 'if':
      out.push(`${ind}if (${pyExpr(s.c)}) != 0:`);
      pyStmt(s.a, ind + '    ', out);
      if (s.b) {
        out.push(`${ind}else:`);
        pyStmt(s.b, ind + '    ', out);
      }
      return;
    case 'assign': {
      let v = pyExpr(s.e);
      if (s.op !== '=') {
        const cur = pyExpr(s.target.k === 'name' ? { t: 'id', name: s.target.name, line: 0, col: 0 } : { t: 'idx', base: s.target.k, index: s.target.index });
        const op = s.op.slice(0, -1);
        v = `(${cur}) ${op} (${v})`;
      }
      out.push(`${ind}${pyAssign(s.target, v)}`);
      return;
    }
    case 'call': {
      const args = s.args.map(pyExpr);
      if (['shl', 'shr', 'asr', 'rol', 'ror'].includes(s.name)) out.push(`${ind}m.${PY_FUNCS[s.name]}(${args[0]}, ${args.length > 1 ? args[1] : 'None'})`);
      else out.push(`${ind}m.${PY_FUNCS[s.name] ?? s.name}(${args.join(', ')})`);
    }
  }
}

/** Python-код тела инструкции (строки с отступом `indent`). */
export function rtlToPython(prog: Stmt[], indent = '        '): string[] {
  const out: string[] = [];
  for (const s of prog) pyStmt(s, indent, out);
  if (out.length === 0) out.push(`${indent}pass`);
  return out;
}
