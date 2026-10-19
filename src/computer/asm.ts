import { AsmOptions, ComputerSpec, Instruction, Issue } from './types';
import { FieldName, decodeWord, encodeWord, layoutOf, parseFormat } from './isa';
import { portMap } from './spec';

export const DEFAULT_ASM_OPTIONS: AsmOptions = { regPrefix: 'r', caseSensitiveLabels: false };

export interface ListingLine {
  line: number;
  addr?: number;
  words?: number[];
  text: string;
}

export interface AsmResult {
  /** Образ ПЗУ (длина = romWords). */
  words: number[];
  /** Какие адреса заняты программой. */
  used: boolean[];
  listing: ListingLine[];
  labels: Record<string, number>;
  /** адрес → номер строки исходника. */
  lineOf: Record<number, number>;
  issues: Issue[];
  /** Число занятых слов (последний адрес + 1). */
  size: number;
  ok: boolean;
}

interface SrcLine {
  no: number;
  raw: string;
  label?: string;
  labels: string[];
  op?: string;
  args: string[];
  text: string;
}

/** Удаляет комментарии (`;` и `//`), учитывая кавычки. */
function stripComment(s: string): string {
  let q: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '\\') i++;
      else if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'") q = c;
    else if (c === ';') return s.slice(0, i);
    else if (c === '/' && s[i + 1] === '/') return s.slice(0, i);
  }
  return s;
}

function splitArgs(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let q: string | null = null;
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      cur += c;
      if (c === '\\') cur += s[++i] ?? '';
      else if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'") {
      q = c;
      cur += c;
    } else if (c === '(' || c === '[') {
      depth++;
      cur += c;
    } else if (c === ')' || c === ']') {
      depth--;
      cur += c;
    } else if (c === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  if (cur.trim() !== '' || out.length > 0) out.push(cur.trim());
  return out;
}

function parseLines(source: string): SrcLine[] {
  const lines: SrcLine[] = [];
  source.split(/\r?\n/).forEach((raw, i) => {
    let s = stripComment(raw).trim();
    const labels: string[] = [];
    for (;;) {
      const m = /^([A-Za-z_.][A-Za-z0-9_.]*)\s*:\s*(.*)$/.exec(s);
      if (!m) break;
      labels.push(m[1]);
      s = m[2];
    }
    // NAME = expr
    const eq = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/.exec(s);
    if (eq) {
      lines.push({ no: i + 1, raw, labels, op: '.equ', args: [eq[1], eq[2].trim()], text: s });
      return;
    }
    if (s === '') {
      lines.push({ no: i + 1, raw, labels, args: [], text: '' });
      return;
    }
    const m = /^(\S+)\s*(.*)$/.exec(s)!;
    lines.push({ no: i + 1, raw, labels, op: m[1], args: m[2] === '' ? [] : splitArgs(m[2]), text: s });
  });
  return lines;
}

// ───────────── Выражения ─────────────

class ExprError extends Error {}

function evalExpr(src: string, sym: (name: string) => number | undefined, here: number): number {
  let i = 0;
  const peek = (): string => src[i] ?? '';
  const ws = (): void => {
    while (src[i] === ' ' || src[i] === '\t') i++;
  };
  const primary = (): number => {
    ws();
    const c = peek();
    if (c === '(') {
      i++;
      const v = or();
      ws();
      if (peek() !== ')') throw new ExprError('Ожидалось «)»');
      i++;
      return v;
    }
    if (c === '-') {
      i++;
      return -primary();
    }
    if (c === '+') {
      i++;
      return primary();
    }
    if (c === '~') {
      i++;
      return ~primary();
    }
    if (c === '$') {
      i++;
      return here;
    }
    if (c === "'") {
      const m = /^'(\\.|[^'\\])'/.exec(src.slice(i));
      if (!m) throw new ExprError('Неверный символьный литерал');
      i += m[0].length;
      const ch = m[1];
      if (ch[0] === '\\') return ({ n: 10, t: 9, r: 13, '0': 0, '\\': 92, "'": 39 } as Record<string, number>)[ch[1]] ?? ch.charCodeAt(1);
      return ch.charCodeAt(0);
    }
    const num = /^(0[xX][0-9a-fA-F]+|0[bB][01]+|[0-9]+)/.exec(src.slice(i));
    if (num) {
      i += num[0].length;
      const t = num[0];
      if (/^0[xX]/.test(t)) return parseInt(t.slice(2), 16);
      if (/^0[bB]/.test(t)) return parseInt(t.slice(2), 2);
      return parseInt(t, 10);
    }
    const id = /^[A-Za-z_.][A-Za-z0-9_.]*/.exec(src.slice(i));
    if (id) {
      i += id[0].length;
      const v = sym(id[0]);
      if (v === undefined) throw new ExprError(`Неизвестное имя «${id[0]}»`);
      return v;
    }
    throw new ExprError(`Неожиданный символ «${peek() || 'конец'}» в выражении «${src}»`);
  };
  const binary = (next: () => number, ops: string[]): (() => number) => {
    return () => {
      let l = next();
      for (;;) {
        ws();
        const op = ops.find((o) => src.startsWith(o, i));
        if (!op) return l;
        i += op.length;
        const r = next();
        switch (op) {
          case '*':
            l = l * r;
            break;
          case '/':
            if (r === 0) throw new ExprError('Деление на ноль');
            l = Math.trunc(l / r);
            break;
          case '%':
            if (r === 0) throw new ExprError('Деление на ноль');
            l = l % r;
            break;
          case '+':
            l = l + r;
            break;
          case '-':
            l = l - r;
            break;
          case '<<':
            l = l * 2 ** r;
            break;
          case '>>':
            l = Math.floor(l / 2 ** r);
            break;
          case '&':
            l = l & r;
            break;
          case '^':
            l = l ^ r;
            break;
          case '|':
            l = l | r;
            break;
        }
      }
    };
  };
  const mul = binary(primary, ['*', '/', '%']);
  const add = binary(mul, ['+', '-']);
  const shift = binary(add, ['<<', '>>']);
  const and = binary(shift, ['&']);
  const xor = binary(and, ['^']);
  const or = binary(xor, ['|']);
  const v = or();
  ws();
  if (i < src.length) throw new ExprError(`Лишний текст «${src.slice(i)}» в выражении`);
  return v;
}

function stripOperand(op: string): string {
  let s = op.trim();
  if (s.startsWith('#')) s = s.slice(1).trim();
  if (s.startsWith('[') && s.endsWith(']')) {
    // убираем скобки только если они парные и охватывают всё выражение
    let d = 0;
    let wraps = true;
    for (let i = 0; i < s.length - 1; i++) {
      if (s[i] === '[') d++;
      else if (s[i] === ']') d--;
      if (d === 0) {
        wraps = false;
        break;
      }
    }
    if (wraps) s = s.slice(1, -1).trim();
  }
  return s;
}

// ───────────── Ассемблер ─────────────

export function assemble(source: string, spec: ComputerSpec, isa: Instruction[], opts: AsmOptions = DEFAULT_ASM_OPTIONS): AsmResult {
  const issues: Issue[] = [];
  const err = (line: number, message: string): void => void issues.push({ level: 'error', message, line });
  const warn = (line: number, message: string): void => void issues.push({ level: 'warning', message, line });
  const byMn = new Map(isa.map((i) => [i.mnemonic.toUpperCase(), i]));
  const lines = parseLines(source);
  const labels: Record<string, number> = {};
  const labelKey = (n: string): string => (opts.caseSensitiveLabels ? n : n.toLowerCase());
  const symbols = new Map<string, number>();
  const labelLine = new Map<string, number>();
  for (const p of portMap(spec)) symbols.set(labelKey(p.name), p.addr);
  symbols.set(labelKey('ROM_SIZE'), spec.romWords);
  symbols.set(labelKey('RAM_SIZE'), spec.ramWords);
  if (spec.stack.enabled) symbols.set(labelKey('STACK_TOP'), spec.ramWords);
  const lookup = (n: string): number | undefined => symbols.get(labelKey(n));
  const words: number[] = new Array(spec.romWords).fill(0);
  const used: boolean[] = new Array(spec.romWords).fill(false);
  const listing: ListingLine[] = [];
  const lineOf: Record<number, number> = {};

  interface Item {
    line: SrcLine;
    addr: number;
    kind: 'inst' | 'word' | 'fill' | 'string';
    inst?: Instruction;
    args: string[];
  }
  const items: Item[] = [];

  // проход 1: адреса, метки, .equ
  let pc = 0;
  for (const ln of lines) {
    for (const lab of ln.labels) {
      const k = labelKey(lab);
      if (symbols.has(k)) err(ln.no, `Имя «${lab}» уже определено${labelLine.has(k) ? ` (строка ${labelLine.get(k)})` : ''}`);
      else {
        symbols.set(k, pc);
        labels[lab] = pc;
        labelLine.set(k, ln.no);
      }
    }
    if (!ln.op) continue;
    const op = ln.op;
    if (op.startsWith('.')) {
      const d = op.toLowerCase();
      if (d === '.org') {
        if (ln.args.length !== 1) {
          err(ln.no, '.org принимает один адрес');
          continue;
        }
        try {
          pc = evalExpr(stripOperand(ln.args[0]), lookup, pc);
        } catch (e) {
          err(ln.no, (e as Error).message);
        }
      } else if (d === '.equ' || d === '.set') {
        if (ln.args.length !== 2) {
          err(ln.no, '.equ принимает имя и значение: .equ ИМЯ, значение');
          continue;
        }
        const name = ln.args[0];
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) err(ln.no, `Неверное имя «${name}»`);
        else if (symbols.has(labelKey(name))) err(ln.no, `Имя «${name}» уже определено`);
        else {
          try {
            symbols.set(labelKey(name), evalExpr(stripOperand(ln.args[1]), lookup, pc));
          } catch (e) {
            err(ln.no, (e as Error).message);
          }
        }
      } else if (d === '.word') {
        if (ln.args.length === 0) err(ln.no, '.word требует значения');
        items.push({ line: ln, addr: pc, kind: 'word', args: ln.args });
        pc += ln.args.length;
      } else if (d === '.fill') {
        if (ln.args.length < 1 || ln.args.length > 2) {
          err(ln.no, '.fill: количество[, значение]');
          continue;
        }
        let n = 0;
        try {
          n = evalExpr(stripOperand(ln.args[0]), lookup, pc);
        } catch (e) {
          err(ln.no, (e as Error).message);
        }
        items.push({ line: ln, addr: pc, kind: 'fill', args: ln.args });
        pc += Math.max(0, n);
      } else if (d === '.string' || d === '.ascii') {
        const m = /^"((?:\\.|[^"\\])*)"$/.exec(ln.args.join(',').trim());
        if (!m) {
          err(ln.no, `${d} ожидает строку в кавычках`);
          continue;
        }
        const len = unescapeString(m[1]).length + (d === '.string' ? 1 : 0);
        items.push({ line: ln, addr: pc, kind: 'string', args: [d, m[1]] });
        pc += len;
      } else err(ln.no, `Неизвестная директива «${op}»`);
      continue;
    }
    const inst = byMn.get(op.toUpperCase());
    if (!inst) {
      err(ln.no, `Неизвестная инструкция «${op}»`);
      continue;
    }
    items.push({ line: ln, addr: pc, kind: 'inst', inst, args: ln.args });
    pc += 1;
  }

  // проход 2: кодирование
  const emit = (addr: number, w: number, line: number): void => {
    if (addr < 0 || addr >= spec.romWords) {
      err(line, `Адрес ${addr} вне ПЗУ (0…${spec.romWords - 1})`);
      return;
    }
    if (used[addr]) warn(line, `Адрес ${addr} уже занят — значение перезаписано`);
    words[addr] = w;
    used[addr] = true;
    lineOf[addr] = line;
  };
  const wordMask = 2 ** spec.instrBits;
  for (const it of items) {
    const ln = it.line;
    const here = it.addr;
    const ev = (s: string): number => evalExpr(stripOperand(s), lookup, here);
    try {
      if (it.kind === 'word') {
        const ws = it.args.map((a) => ((ev(a) % wordMask) + wordMask) % wordMask);
        ws.forEach((w, k) => emit(here + k, w, ln.no));
        listing.push({ line: ln.no, addr: here, words: ws, text: ln.text });
      } else if (it.kind === 'fill') {
        const n = ev(it.args[0]);
        const v = it.args.length > 1 ? ev(it.args[1]) : 0;
        const ws = new Array(Math.max(0, n)).fill(((v % wordMask) + wordMask) % wordMask);
        ws.forEach((w, k) => emit(here + k, w, ln.no));
        listing.push({ line: ln.no, addr: here, words: ws.slice(0, 8), text: ln.text });
      } else if (it.kind === 'string') {
        const chars = [...unescapeString(it.args[1])].map((c) => c.charCodeAt(0));
        if (it.args[0] === '.string') chars.push(0);
        chars.forEach((w, k) => emit(here + k, w % wordMask, ln.no));
        listing.push({ line: ln.no, addr: here, words: chars.slice(0, 8), text: ln.text });
      } else {
        const inst = it.inst!;
        const lay = layoutOf(inst.format, spec);
        const need = parseFormat(inst.format).fields;
        if (lay.error) {
          err(ln.no, `Инструкция ${inst.mnemonic}: ${lay.error}`);
          continue;
        }
        if (it.args.length !== need.length) {
          err(ln.no, `${inst.mnemonic} ждёт операндов: ${need.length}${need.length ? ` (${need.join(', ')})` : ''}, получено ${it.args.length}`);
          continue;
        }
        const vals: Partial<Record<FieldName, number>> = {};
        let bad = false;
        need.forEach((f, k) => {
          const raw = it.args[k];
          try {
            vals[f] = operandValue(f, raw, spec, opts, ev, here);
          } catch (e) {
            err(ln.no, `${inst.mnemonic}, операнд ${k + 1} (${f}): ${(e as Error).message}`);
            bad = true;
          }
        });
        if (bad) continue;
        const w = encodeWord(inst, vals, spec);
        emit(here, w, ln.no);
        listing.push({ line: ln.no, addr: here, words: [w], text: ln.text });
      }
    } catch (e) {
      err(ln.no, (e as Error).message);
    }
  }
  // строки без кода (метки/комментарии) для полного листинга
  const have = new Set(listing.map((l) => l.line));
  for (const ln of lines) if (!have.has(ln.no)) listing.push({ line: ln.no, text: ln.text });
  listing.sort((a, b) => a.line - b.line);

  let size = 0;
  for (let a = 0; a < used.length; a++) if (used[a]) size = a + 1;
  if (pc > spec.romWords) err(1, `Программа не помещается в ПЗУ: ${pc} слов, доступно ${spec.romWords}`);
  return { words, used, listing, labels, lineOf, issues, size, ok: !issues.some((i) => i.level === 'error') };
}

function unescapeString(s: string): string {
  return s.replace(/\\(.)/g, (_m, c: string) => ({ n: '\n', t: '\t', r: '\r', '0': '\0', '\\': '\\', '"': '"' } as Record<string, string>)[c] ?? c);
}

function operandValue(f: FieldName, raw: string, spec: ComputerSpec, opts: AsmOptions, ev: (s: string) => number, here: number): number {
  if (f === 'rd' || f === 'rs' || f === 'rt') {
    const m = new RegExp(`^${opts.regPrefix}(\\d+)$`, 'i').exec(raw.trim());
    if (!m) throw new Error(`ожидался регистр ${opts.regPrefix}0…${opts.regPrefix}${spec.regCount - 1}, получено «${raw}»`);
    const n = Number(m[1]);
    if (n >= spec.regCount) throw new Error(`регистра ${raw} нет (всего ${spec.regCount})`);
    return n;
  }
  let v: number;
  try {
    v = ev(raw);
  } catch (e) {
    throw new Error((e as Error).message);
  }
  if (f === 'imm') {
    const lo = -(2 ** (spec.dataBits - 1));
    const hi = 2 ** spec.dataBits - 1;
    if (v < lo || v > hi) throw new Error(`значение ${v} не помещается в ${spec.dataBits} бит (${lo}…${hi})`);
    return ((v % 2 ** spec.dataBits) + 2 ** spec.dataBits) % 2 ** spec.dataBits;
  }
  if (f === 'addr') {
    if (v < 0 || v >= 2 ** spec.ramAddrBits) throw new Error(`адрес ${v} вне 0…${2 ** spec.ramAddrBits - 1}`);
    return v;
  }
  if (f === 'target') {
    if (v < 0 || v >= 2 ** spec.pcBits) throw new Error(`адрес перехода ${v} вне 0…${2 ** spec.pcBits - 1}`);
    return v;
  }
  // off: операнд — абсолютный адрес, кодируем смещение
  const off = v - here;
  const half = 2 ** (spec.pcBits - 1);
  if (off < -half || off >= half) throw new Error(`переход на ${v} слишком далёк (смещение ${off}, допустимо ${-half}…${half - 1})`);
  return off;
}

// ───────────── Дизассемблер ─────────────

export function formatOperand(name: FieldName, v: number, spec: ComputerSpec, opts: AsmOptions, labelOf?: (addr: number) => string | undefined): string {
  switch (name) {
    case 'rd':
    case 'rs':
    case 'rt':
      return `${opts.regPrefix}${v}`;
    case 'imm':
      return v > 9 ? `0x${v.toString(16).toUpperCase()}` : String(v);
    case 'addr': {
      const port = portMap(spec).find((p) => p.addr === v);
      return port ? port.name : v > 9 ? `0x${v.toString(16).toUpperCase()}` : String(v);
    }
    case 'target':
      return labelOf?.(v) ?? String(v);
    case 'off':
      return v >= 0 ? `$+${v}` : `$${v}`;
  }
}

export function disassemble(word: number, spec: ComputerSpec, isa: Instruction[], opts: AsmOptions = DEFAULT_ASM_OPTIONS, labelOf?: (addr: number) => string | undefined): string {
  const d = decodeWord(word, spec, isa);
  if (!d) return `.word 0x${word.toString(16).toUpperCase()}   ; неизвестный код`;
  const lay = layoutOf(d.inst.format, spec);
  const ops = lay.fields.map((f) => formatOperand(f.name, d.fields[f.name] ?? 0, spec, opts, labelOf));
  return ops.length ? `${d.inst.mnemonic} ${ops.join(', ')}` : d.inst.mnemonic;
}

/** Таблица «адрес → слово» в шестнадцатеричном виде (для отладки и файлов .hex). */
export function wordsToHex(words: number[], spec: ComputerSpec): string[] {
  const digits = Math.ceil(spec.instrBits / 4);
  return words.map((w) => w.toString(16).toUpperCase().padStart(digits, '0'));
}
