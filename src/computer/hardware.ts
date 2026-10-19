import { ComputerProject } from './types';

/**
 * Генераторы схем для постройки компьютера: каждая возвращает текст нетлиста (см. docs/ai/circuit-netlist.md),
 * который открывается в редакторе схем и компилируется в редстоун.
 */

class NetlistBuilder {
  private lines: string[] = [];
  private n = 0;
  private notCache = new Map<string, string>();
  readonly inputs: string[] = [];

  addInputs(...names: string[]): void {
    this.inputs.push(...names);
  }

  fresh(prefix: string): string {
    return `${prefix}${++this.n}`;
  }

  gate(type: string, args: string[], prefix = 'g'): string {
    const name = this.fresh(prefix);
    this.lines.push(`${name} = ${type}(${args.join(', ')})`);
    return name;
  }

  not(a: string): string {
    let n = this.notCache.get(a);
    if (!n) {
      n = this.gate('NOT', [a], 'n_');
      this.notCache.set(a, n);
    }
    return n;
  }

  /** Дерево из гейтов с ≤4 входами. */
  tree(type: 'AND' | 'OR', list: string[], prefix = 't'): string {
    if (list.length === 0) throw new Error('пустой список входов');
    if (list.length === 1) return list[0];
    if (list.length <= 4) return this.gate(type, list, prefix);
    const next: string[] = [];
    for (let i = 0; i < list.length; i += 4) next.push(this.tree(type, list.slice(i, i + 4), prefix));
    return this.tree(type, next, prefix);
  }

  and(list: string[], prefix = 't'): string {
    return this.tree('AND', list, prefix);
  }

  or(list: string[], prefix = 't'): string {
    return this.tree('OR', list, prefix);
  }

  out: string[] = [];
  output(label: string, signal: string): void {
    this.out.push(`output ${label} = ${signal}`);
  }

  text(title?: string): string {
    return [...(title ? [`# ${title}`] : []), `input ${this.inputs.join(' ')}`, ...this.lines, ...this.out].join('\n') + '\n';
  }
}

/** Литералы числа `value` по битам `sig[0..n-1]` (sig[i] — бит i): прямой или инвертированный вход. */
function literals(b: NetlistBuilder, sig: string[], value: number): string[] {
  return sig.map((s, i) => (((value >> i) & 1) === 1 ? s : b.not(s)));
}

/** Предварительный дешифратор: one-hot по группе бит. */
function predecode(b: NetlistBuilder, sig: string[], prefix: string): string[] {
  if (sig.length === 1) return [b.not(sig[0]), sig[0]];
  return Array.from({ length: 2 ** sig.length }, (_, v) => b.and(literals(b, sig, v), prefix));
}

export function decoderNetlist(bits: number, names?: { inputs?: string[]; outputs?: (string | null)[] }): string {
  if (bits < 1 || bits > 8) throw new Error('Разрядность дешифратора: 1…8');
  const b = new NetlistBuilder();
  const ins = names?.inputs ?? Array.from({ length: bits }, (_, i) => `a${bits - 1 - i}`);
  // ins перечислены от старшего бита к младшему; sig[i] — бит i
  const sig = [...ins].reverse();
  b.addInputs(...ins);
  const total = 2 ** bits;
  const lo = sig.slice(0, Math.min(4, Math.ceil(bits / 2)));
  const hi = sig.slice(lo.length);
  const loP = hi.length ? predecode(b, lo, 'lo_') : [];
  const hiP = hi.length ? predecode(b, hi, 'hi_') : [];
  for (let v = 0; v < total; v++) {
    const label = names?.outputs ? names.outputs[v] : `y${v}`;
    if (!label) continue;
    let s: string;
    if (!hi.length) s = b.and(literals(b, sig, v), 'y_');
    else s = b.and([hiP[v >> lo.length], loP[v & ((1 << lo.length) - 1)]], 'y_');
    b.output(label, s);
  }
  return b.text(`Дешифратор ${bits}→${total}`);
}

/** Дешифратор кодов операций по набору команд: на выходе единица у выбранной команды. */
export function instructionDecoderNetlist(p: ComputerProject): string {
  const k = p.spec.opcodeBits;
  if (k > 8) throw new Error('Для кода операции длиннее 8 бит схему лучше собирать вручную');
  const outputs: (string | null)[] = Array.from({ length: 2 ** k }, () => null);
  for (const i of p.instructions) if (i.opcode >= 0 && i.opcode < 2 ** k && /^[A-Za-z][A-Za-z0-9_]*$/.test(i.mnemonic)) outputs[i.opcode] = i.mnemonic;
  const inputs = Array.from({ length: k }, (_, i) => `op${k - 1 - i}`);
  return decoderNetlist(k, { inputs, outputs }).replace(/^# .*$/m, `# Дешифратор команд «${p.spec.name}»: код операции (${k} бит) → линия на каждую команду`);
}

export function adderNetlist(bits: number): string {
  if (bits < 1 || bits > 8) throw new Error('Разрядность сумматора: 1…8');
  const b = new NetlistBuilder();
  const a = Array.from({ length: bits }, (_, i) => `a${i}`);
  const c = Array.from({ length: bits }, (_, i) => `b${i}`);
  b.addInputs(...a, ...c, 'cin');
  let carry = 'cin';
  for (let i = 0; i < bits; i++) {
    const x = b.gate('XOR', [a[i], c[i]], 'x');
    const s = b.gate('XOR', [x, carry], 's');
    const g = b.gate('AND', [a[i], c[i]], 'g');
    const pp = b.gate('AND', [x, carry], 'p');
    const co = b.gate('OR', [g, pp], 'c');
    b.output(`s${i}`, s);
    carry = co;
  }
  b.output('cout', carry);
  return b.text(`Сумматор ${bits} бит (с переносом)`);
}

export function equalityNetlist(bits: number): string {
  if (bits < 1 || bits > 8) throw new Error('Разрядность компаратора: 1…8');
  const b = new NetlistBuilder();
  const a = Array.from({ length: bits }, (_, i) => `a${i}`);
  const c = Array.from({ length: bits }, (_, i) => `b${i}`);
  b.addInputs(...a, ...c);
  const eqs = a.map((x, i) => b.gate('XNOR', [x, c[i]], 'e'));
  b.output('equal', b.and(eqs, 'q'));
  return b.text(`Равенство ${bits}-битных чисел`);
}

export function muxNetlist(bits: number): string {
  if (bits < 1 || bits > 8) throw new Error('Разрядность мультиплексора: 1…8');
  const b = new NetlistBuilder();
  const a = Array.from({ length: bits }, (_, i) => `a${i}`);
  const c = Array.from({ length: bits }, (_, i) => `b${i}`);
  b.addInputs(...a, ...c, 'sel');
  const ns = b.not('sel');
  for (let i = 0; i < bits; i++) {
    const t0 = b.gate('AND', [a[i], ns], 't');
    const t1 = b.gate('AND', [c[i], 'sel'], 't');
    b.output(`y${i}`, b.gate('OR', [t0, t1], 'y'));
  }
  return b.text(`Мультиплексор 2→1, ${bits} бит (sel=0 → a, sel=1 → b)`);
}

/** Регистр на D-защёлках: пока we=1, выход повторяет вход; при we=0 хранит значение. */
export function latchRegisterNetlist(bits: number): string {
  if (bits < 1 || bits > 8) throw new Error('Разрядность регистра: 1…8');
  const b = new NetlistBuilder();
  const d = Array.from({ length: bits }, (_, i) => `d${i}`);
  b.addInputs(...d, 'we');
  const lines: string[] = [];
  for (let i = 0; i < bits; i++) {
    const nd = b.not(d[i]);
    const s = b.gate('AND', [d[i], 'we'], 'set');
    const r = b.gate('AND', [nd, 'we'], 'rst');
    // перекрёстная связь NOR: имена задаём явно, потому что сигналы ссылаются друг на друга
    const q = `q${i}`;
    const nq = `nq${i}`;
    lines.push(`${q} = NOR(${r}, ${nq})`, `${nq} = NOR(${s}, ${q})`);
    b.output(`q${i}`, q);
  }
  const text = b.text(`Регистр ${bits} бит на D-защёлках (we=1 — запись)`);
  const i = text.indexOf('output ');
  return text.slice(0, i) + lines.join('\n') + '\n' + text.slice(i);
}

export interface HardwareParam {
  id: string;
  label: string;
  min: number;
  max: number;
  value: number;
}

export interface HardwareGenerator {
  id: string;
  title: string;
  desc: string;
  params: (p: ComputerProject) => HardwareParam[];
  build: (values: Record<string, number>, p: ComputerProject) => string;
}

const bitsParam = (label: string, max: number, value: number): HardwareParam => ({ id: 'bits', label, min: 1, max, value: Math.max(1, Math.min(max, value)) });

export const HARDWARE: HardwareGenerator[] = [
  {
    id: 'idec',
    title: 'Дешифратор команд',
    desc: 'Код операции вашего процессора → отдельная линия на каждую инструкцию (по набору команд). Основа блока управления.',
    params: () => [],
    build: (_v, p) => instructionDecoderNetlist(p),
  },
  {
    id: 'rom-addr',
    title: 'Дешифратор адреса ПЗУ',
    desc: 'Адрес слова → линия выбора нужного ряда бочек. Для больших адресов гейтов много — берите первые 4–5 бит.',
    params: (p) => [bitsParam('Бит адреса', 6, Math.min(p.spec.pcBits, 4))],
    build: (v) => decoderNetlist(v.bits),
  },
  {
    id: 'adder',
    title: 'Сумматор',
    desc: 'Многоразрядное сложение с переносом — ядро АЛУ.',
    params: (p) => [bitsParam('Разрядность', 8, Math.min(p.spec.dataBits, 4))],
    build: (v) => adderNetlist(v.bits),
  },
  {
    id: 'eq',
    title: 'Компаратор «равно»',
    desc: 'Равенство двух чисел — для команд сравнения и флага Z.',
    params: (p) => [bitsParam('Разрядность', 8, Math.min(p.spec.dataBits, 4))],
    build: (v) => equalityNetlist(v.bits),
  },
  {
    id: 'mux',
    title: 'Мультиплексор 2→1',
    desc: 'Выбор одного из двух чисел — выбор источника операнда или адреса.',
    params: (p) => [bitsParam('Разрядность', 8, Math.min(p.spec.dataBits, 4))],
    build: (v) => muxNetlist(v.bits),
  },
  {
    id: 'reg',
    title: 'Регистр на защёлках',
    desc: 'Хранит число, пока we=0; пока we=1 повторяет вход. Из таких собираются регистры и аккумулятор.',
    params: (p) => [bitsParam('Разрядность', 8, Math.min(p.spec.dataBits, 4))],
    build: (v) => latchRegisterNetlist(v.bits),
  },
];
