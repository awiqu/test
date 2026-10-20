import { FlagName } from '../computer/types';
import { CtlName } from './micro';

/** Что реально нужно построить: набор используемых управляющих сигналов и размеры. */
export interface Feat {
  /** Разрядность данных. */
  D: number;
  /** Разрядность счётчика команд. */
  P: number;
  /** Бит адреса данных. */
  RA: number;
  /** Ширина поля операнда в строке ПЗУ. */
  OB: number;
  used: Set<CtlName>;
  /** Флаги, которые читаются условиями перехода (для них строятся триггеры). */
  flags: FlagName[];
}

const has = (f: Feat, ...names: CtlName[]): boolean => names.some((n) => f.used.has(n));

/** Дерево из гейтов с ограничением в 4 входа. */
function tree(lines: string[], kind: 'OR' | 'AND' | 'NOR', names: string[], out: string, tmp: string): void {
  if (names.length === 0) throw new Error('пустое дерево');
  if (names.length === 1) {
    lines.push(kind === 'NOR' ? `${out} = NOT(${names[0]})` : `${out} = BUF(${names[0]})`);
    return;
  }
  if (names.length <= 4) {
    lines.push(`${out} = ${kind}(${names.join(', ')})`);
    return;
  }
  const groups: string[] = [];
  for (let i = 0; i < names.length; i += 4) {
    const chunk = names.slice(i, i + 4);
    if (chunk.length === 1) {
      groups.push(chunk[0]);
      continue;
    }
    const g = `${tmp}${groups.length}`;
    lines.push(`${g} = ${kind === 'NOR' ? 'OR' : kind}(${chunk.join(', ')})`);
    groups.push(g);
  }
  tree(lines, kind, groups, out, `${tmp}x`);
}

/**
 * Такты и замки: lkM — замок ведущих триггеров, lkS — ведомых; замок записи в A/флаги и «стоп» счётчика;
 * nwm — отрицательный импульс записи в ОЗУ (идёт только при weM).
 */
export function ctlNetlist(): string {
  return `# Такты и замки триггеров
input clk reset nweA nweF halt weM
nclk = NOT(clk)
clkd = BUF(clk, delay=3)
nclkd = NOT(clkd)
lkM = OR(clk, clkd)
lkS = OR(nclk, nclkd)
cw1 = BUF(clk, delay=4)
cw2 = BUF(cw1, delay=4)
w = NOR(nclk, cw2)
nreset = NOT(reset)
hh = AND(halt, nreset)
lkMA = OR(lkM, nweA)
lkMF = OR(lkM, nweF)
lkMP = OR(lkM, hh)
wm = AND(w, weM)
nwm = NOT(wm)
output lkMA = lkMA
output lkMF = lkMF
output lkMP = lkMP
output lkS = lkS
output nwm = nwm
output nreset = nreset
`;
}

/** Разряд счётчика команд: следующее значение = reset ? 0 : take ? операнд : pc + 1 (перенос c — от младшего). */
export function pcSliceNetlist(hasTake: boolean): string {
  const L = ['# Разряд счётчика команд', `input pc ob c nreset${hasTake ? ' take ntake' : ''}`, 's = XOR(pc, c)'];
  if (hasTake) L.push('a = AND(take, ob)', 'b = AND(ntake, s)', 'm = OR(a, b)', 'd = AND(nreset, m)');
  else L.push('d = AND(nreset, s)');
  L.push('co = AND(c, pc)', 'output d = d', 'output co = co');
  return L.join('\n') + '\n';
}

/** Разряд АЛУ, часть 1: выбор операнда B, сумматор и логика. */
export function aluANetlist(f: Feat): string {
  const ins = ['a'];
  const gates: string[] = [];
  const sum = has(f, 'eSum');
  if (sum) ins.push('cin');
  const terms: string[] = [];
  if (has(f, 'uImm')) {
    ins.push('uImm', 'ob');
    gates.push('x1 = AND(uImm, ob)');
    terms.push('x1');
  }
  if (has(f, 'uMem')) {
    ins.push('uMem', 'mem');
    gates.push('x2 = AND(uMem, mem)');
    terms.push('x2');
  }
  if (has(f, 'k1')) {
    ins.push('k1');
    terms.push('k1');
  }
  if (has(f, 'sub')) ins.push('sub');
  let b0: string;
  if (terms.length === 0) {
    gates.push('na = NOT(a)', 'b0 = NOR(a, na)');
    b0 = 'b0';
  } else if (terms.length === 1) b0 = terms[0];
  else {
    gates.push(`b0 = OR(${terms.join(', ')})`);
    b0 = 'b0';
  }
  let bx = b0;
  if (has(f, 'sub')) {
    gates.push(`bx = XOR(${b0}, sub)`);
    bx = 'bx';
  }
  const needP = has(f, 'eSum', 'eXor', 'eOr');
  const needG = has(f, 'eSum', 'eAnd', 'eOr');
  if (needP) gates.push(`p = XOR(a, ${bx})`);
  if (needG) gates.push(`g = AND(a, ${bx})`);
  if (sum) gates.push('s = XOR(p, cin)', 't = AND(p, cin)', 'co = OR(g, t)');
  if (has(f, 'eOr')) gates.push('o = OR(p, g)');
  const outs: string[] = [];
  if (has(f, 'eB')) outs.push(`output bx = ${bx}`);
  if (has(f, 'eXor')) outs.push('output p = p');
  if (has(f, 'eAnd')) outs.push('output g = g');
  if (has(f, 'eOr')) outs.push('output o = o');
  if (sum) outs.push('output s = s', 'output co = co');
  if (outs.length === 0) outs.push(`output bx = ${bx}`);
  return ['# Разряд АЛУ: операнд B и сумматор', `input ${ins.join(' ')}`, ...gates, ...outs].join('\n') + '\n';
}

export interface MuxTerm {
  ctl: CtlName;
  /** Имя входа данных. */
  src: string;
}

export function muxTerms(f: Feat): MuxTerm[] {
  const t: MuxTerm[] = [];
  if (has(f, 'eSum')) t.push({ ctl: 'eSum', src: 's' });
  if (has(f, 'eAnd')) t.push({ ctl: 'eAnd', src: 'g' });
  if (has(f, 'eOr')) t.push({ ctl: 'eOr', src: 'o' });
  if (has(f, 'eXor')) t.push({ ctl: 'eXor', src: 'p' });
  if (has(f, 'eNot')) t.push({ ctl: 'eNot', src: 'na' });
  if (has(f, 'eShl')) t.push({ ctl: 'eShl', src: 'ap' });
  if (has(f, 'eShr')) t.push({ ctl: 'eShr', src: 'an' });
  if (has(f, 'eB')) t.push({ ctl: 'eB', src: 'bx' });
  return t;
}

/** Разряд АЛУ, часть 2: выбор результата по одному из e*. */
export function aluMuxNetlist(f: Feat): string {
  const terms = muxTerms(f);
  const ins: string[] = [];
  const L: string[] = [];
  for (const t of terms) {
    ins.push(t.ctl);
    if (t.src === 'na') {
      ins.push('a');
      L.push('na = NOT(a)');
    } else ins.push(t.src);
  }
  const names: string[] = [];
  terms.forEach((t, i) => {
    L.push(`r${i} = AND(${t.ctl}, ${t.src})`);
    names.push(`r${i}`);
  });
  const out: string[] = [];
  if (names.length === 1) {
    out.push(`r = BUF(${names[0]})`);
  } else tree(out, 'OR', names, 'r', 'q');
  return [`input ${[...new Set(ins)].join(' ')}`, ...L, ...out, 'output r = r'].join('\n') + '\n';
}

/** Флаги: Z — все разряды результата нулевые; C и V — по переносам сумматора и сдвигам. */
export function flagsNetlist(f: Feat): string {
  const ins: string[] = [];
  const L: string[] = [];
  const outs: string[] = [];
  if (f.flags.includes('Z')) {
    const rs = Array.from({ length: f.D }, (_, i) => `r${i}`);
    ins.push(...rs);
    tree(L, 'NOR', rs, 'z', 'zq');
    outs.push('output z = z');
  }
  if (f.flags.includes('C')) {
    const c: string[] = [];
    if (has(f, 'eSum')) {
      ins.push('eSum', 'co');
      if (has(f, 'sub')) {
        ins.push('sub');
        L.push('cx = XOR(co, sub)', 'c1 = AND(eSum, cx)');
      } else L.push('c1 = AND(eSum, co)');
      c.push('c1');
    }
    if (has(f, 'eShl')) {
      ins.push('eShl', 'am');
      L.push('c2 = AND(eShl, am)');
      c.push('c2');
    }
    if (has(f, 'eShr')) {
      ins.push('eShr', 'a0');
      L.push('c3 = AND(eShr, a0)');
      c.push('c3');
    }
    if (c.length === 0) {
      // перенос всегда 0: цепочка из констант не нужна — триггер просто не получит данных
    } else if (c.length === 1) L.push(`cn = BUF(${c[0]})`);
    else L.push(`cn = OR(${c.join(', ')})`);
    if (c.length) outs.push('output cn = cn');
  }
  if (f.flags.includes('V') && has(f, 'eSum')) {
    ins.push('eSum', 'co', 'cm');
    L.push('vx = XOR(cm, co)', 'vn = AND(eSum, vx)');
    outs.push('output vn = vn');
  }
  return [`input ${[...new Set(ins)].join(' ')}`, ...L, ...outs].join('\n') + '\n';
}

const COND_FLAG: Partial<Record<CtlName, { flag: FlagName; neg: boolean }>> = {
  jZ: { flag: 'Z', neg: false },
  jNZ: { flag: 'Z', neg: true },
  jC: { flag: 'C', neg: false },
  jNC: { flag: 'C', neg: true },
  jN: { flag: 'N', neg: false },
  jNN: { flag: 'N', neg: true },
  jV: { flag: 'V', neg: false },
  jNV: { flag: 'V', neg: true },
};

export const JUMP_CTLS: CtlName[] = ['jAlways', 'jZ', 'jNZ', 'jC', 'jNC', 'jN', 'jNN', 'jV', 'jNV'];

/** Условие перехода: take = OR(j* & флаг). */
export function takeNetlist(f: Feat): string {
  const ins: string[] = [];
  const L: string[] = [];
  const names: string[] = [];
  const flagIn = new Set<FlagName>();
  const negIn = new Set<FlagName>();
  for (const j of JUMP_CTLS) {
    if (!f.used.has(j)) continue;
    ins.push(j);
    if (j === 'jAlways') {
      names.push('jAlways');
      continue;
    }
    const cf = COND_FLAG[j]!;
    flagIn.add(cf.flag);
    if (cf.neg) negIn.add(cf.flag);
  }
  for (const fl of flagIn) ins.push(`f${fl.toLowerCase()}`);
  for (const fl of negIn) L.push(`nf${fl.toLowerCase()} = NOT(f${fl.toLowerCase()})`);
  for (const j of JUMP_CTLS) {
    if (!f.used.has(j) || j === 'jAlways') continue;
    const cf = COND_FLAG[j]!;
    const n = `t_${j}`;
    L.push(`${n} = AND(${j}, ${cf.neg ? 'nf' : 'f'}${cf.flag.toLowerCase()})`);
    names.push(n);
  }
  const out: string[] = [];
  if (names.length === 1) out.push(`take = BUF(${names[0]})`);
  else tree(out, 'OR', names, 'take', 'q');
  return [`input ${ins.join(' ')}`, ...L, ...out, 'ntake = NOT(take)', 'output take = take', 'output ntake = ntake'].join('\n') + '\n';
}
