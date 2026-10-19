import { Circuit, Gate } from '../model/types';
import { inputCount } from '../model/circuit';
import { ModuleKind, MAX_MODULE_INPUTS } from './modules';
import { VariantChoice, defaultVariants } from './variants';

export interface Inst {
  id: number;
  kind: ModuleKind;
  /** Число входов (слотов). */
  k: number;
  delay: number;
  /** Сети, подключённые к слотам. */
  ins: number[];
  /** Выходная сеть (или -1 у OUT). */
  out: number;
  /** Подсказка вертикального порядка (из редактора). */
  yhint: number;
  gateId?: string;
  label?: string;
}

export interface Net {
  id: number;
  driver: number;
  sinks: { inst: number; slot: number }[];
}

export interface Netlist {
  insts: Inst[];
  nets: Net[];
  /** gate.id → id экземпляра. */
  inputOf: Map<string, number>;
  outputOf: Map<string, number>;
}

export interface Issue {
  level: 'error' | 'warning';
  message: string;
  gateId?: string;
}

class Builder {
  insts: Inst[] = [];
  netDriver: number[] = [];
  private inverted = new Map<number, number>();
  yhint = 0;
  seq = 0;
  gateId?: string;

  add(kind: ModuleKind, ins: number[], extra: { delay?: number; label?: string } = {}): number {
    const id = this.insts.length;
    const out = kind === 'OUT' ? -1 : this.netDriver.length;
    if (out >= 0) this.netDriver.push(id);
    this.insts.push({
      id,
      kind,
      k: ins.length,
      delay: extra.delay ?? 1,
      ins,
      out,
      yhint: this.yhint + this.seq++ * 0.01,
      gateId: this.gateId,
      label: extra.label,
    });
    return out;
  }

  not(a: number): number {
    const cached = this.inverted.get(a);
    if (cached !== undefined) return cached;
    const o = this.add('NOT', [a]);
    this.inverted.set(a, o);
    return o;
  }
  nor(list: number[]): number {
    return this.add('NOR', list);
  }
  merge(list: number[]): number {
    return this.add('MERGE', list);
  }

  split<T>(list: T[]): [T[], T[]] {
    const h = Math.ceil(list.length / 2);
    return [list.slice(0, h), list.slice(h)];
  }

  and(list: number[], variant: string): number {
    if (list.length === 1) return list[0];
    if (list.length > MAX_MODULE_INPUTS) {
      const [a, b] = this.split(list);
      return this.and([this.and(a, variant), this.and(b, variant)], variant);
    }
    if (variant === 'merge-not') return this.not(this.merge(list.map((n) => this.not(n))));
    return this.nor(list.map((n) => this.not(n)));
  }

  or(list: number[], variant: string): number {
    if (list.length === 1) return list[0];
    if (list.length > MAX_MODULE_INPUTS) {
      const [a, b] = this.split(list);
      return this.or([this.or(a, variant), this.or(b, variant)], variant);
    }
    if (variant === 'nor-not') return this.not(this.nor(list));
    return this.merge(list);
  }

  norGate(list: number[], variant: string): number {
    if (list.length === 1) return this.not(list[0]);
    if (list.length > MAX_MODULE_INPUTS) return this.not(this.or(list, 'merge'));
    if (variant === 'merge-not') return this.not(this.merge(list));
    return this.nor(list);
  }

  nand(list: number[], variant: string): number {
    if (list.length === 1) return this.not(list[0]);
    if (list.length > MAX_MODULE_INPUTS) return this.not(this.and(list, 'demorgan'));
    if (variant === 'and-not') return this.not(this.and(list, 'demorgan'));
    return this.merge(list.map((n) => this.not(n)));
  }

  xor2(a: number, b: number, variant: string): number {
    if (variant === 'and-or') return this.merge([this.nor([this.not(a), b]), this.nor([a, this.not(b)])]);
    return this.nor([this.nor([a, b]), this.nor([this.not(a), this.not(b)])]);
  }

  xor(list: number[], variant: string): number {
    let acc = list[0];
    for (let i = 1; i < list.length; i++) acc = this.xor2(acc, list[i], variant);
    return acc;
  }

  xnor(list: number[], variant: string): number {
    if (list.length === 2 && variant === 'nor-merge') {
      const [a, b] = list;
      return this.merge([this.nor([this.not(a), this.not(b)]), this.nor([a, b])]);
    }
    return this.not(this.xor(list, 'nor'));
  }
}

/** Топологический порядок гейтов; null если есть цикл. */
function topoOrder(c: Circuit): Gate[] | null {
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const g of c.gates) {
    indeg.set(g.id, 0);
    adj.set(g.id, []);
  }
  for (const w of c.wires) {
    if (!indeg.has(w.from) || !indeg.has(w.to)) continue;
    indeg.set(w.to, (indeg.get(w.to) ?? 0) + 1);
    adj.get(w.from)!.push(w.to);
  }
  const queue = c.gates.filter((g) => indeg.get(g.id) === 0);
  const byId = new Map(c.gates.map((g) => [g.id, g]));
  const out: Gate[] = [];
  while (queue.length) {
    const g = queue.shift()!;
    out.push(g);
    for (const n of adj.get(g.id)!) {
      indeg.set(n, indeg.get(n)! - 1);
      if (indeg.get(n) === 0) queue.push(byId.get(n)!);
    }
  }
  return out.length === c.gates.length ? out : null;
}

export function techmap(
  c: Circuit,
  variantChoice: VariantChoice = {},
  opts: { pruneDead?: boolean } = {},
): { netlist: Netlist | null; issues: Issue[] } {
  const issues: Issue[] = [];
  const variants = { ...defaultVariants(), ...variantChoice };
  const order = topoOrder(c);
  if (!order) {
    issues.push({ level: 'error', message: 'В схеме есть обратные связи (циклы) — экспорт триггеров и защёлок пока не поддерживается.' });
    return { netlist: null, issues };
  }
  if (!c.gates.some((g) => g.type === 'OUTPUT')) {
    issues.push({ level: 'error', message: 'Добавьте хотя бы один выход (лампу).' });
    return { netlist: null, issues };
  }
  const incoming = new Map<string, (string | null)[]>();
  for (const g of c.gates) incoming.set(g.id, new Array(inputCount(g)).fill(null));
  for (const w of c.wires) {
    const arr = incoming.get(w.to);
    if (arr && w.toPin < arr.length) arr[w.toPin] = w.from;
  }

  // логика, не влияющая ни на один выход, не строится и ошибок не даёт
  const live = new Set<string>();
  {
    const stack = c.gates.filter((g) => g.type === 'OUTPUT').map((g) => g.id);
    while (stack.length) {
      const id = stack.pop()!;
      if (live.has(id)) continue;
      live.add(id);
      for (const src of incoming.get(id) ?? []) if (src) stack.push(src);
    }
  }
  const pruneDead = opts.pruneDead !== false;

  const b = new Builder();
  const gateNet = new Map<string, number>();
  const inputOf = new Map<string, number>();
  const outputOf = new Map<string, number>();
  const outInsts: number[] = [];

  for (const g of order) {
    if (pruneDead && !live.has(g.id) && g.type !== 'INPUT') continue;
    b.yhint = g.y;
    b.seq = 0;
    b.gateId = g.id;
    const srcs = incoming.get(g.id)!;
    const ins: number[] = [];
    let missing = false;
    for (const s of srcs) {
      const n = s === null ? undefined : gateNet.get(s);
      if (n === undefined) missing = true;
      else ins.push(n);
    }
    if (g.type !== 'INPUT' && missing) {
      issues.push({ level: 'error', message: `У гейта «${g.label || g.type}» есть неподключённые входы.`, gateId: g.id });
      continue;
    }
    let out = -1;
    switch (g.type) {
      case 'INPUT':
        out = b.add('IN', [], { label: g.label });
        inputOf.set(g.id, b.insts.length - 1);
        break;
      case 'OUTPUT':
        b.add('OUT', ins, { label: g.label });
        outInsts.push(b.insts.length - 1);
        outputOf.set(g.id, b.insts.length - 1);
        break;
      case 'NOT':
        out = b.not(ins[0]);
        break;
      case 'BUFFER':
        out = variants.BUFFER === 'torches' ? b.not(b.not(ins[0])) : b.add('REP', ins, { delay: g.delay });
        break;
      case 'AND':
        out = b.and(ins, variants.AND ?? 'demorgan');
        break;
      case 'NAND':
        out = b.nand(ins, variants.NAND ?? 'merge');
        break;
      case 'OR':
        out = b.or(ins, variants.OR ?? 'merge');
        break;
      case 'NOR':
        out = b.norGate(ins, variants.NOR ?? 'torch');
        break;
      case 'XOR':
        out = b.xor(ins, variants.XOR ?? 'nor');
        break;
      case 'XNOR':
        out = b.xnor(ins, variants.XNOR ?? 'nor-merge');
        break;
    }
    if (out >= 0) gateNet.set(g.id, out);
  }
  if (issues.some((i) => i.level === 'error')) return { netlist: null, issues };

  // Сети и приёмники
  let insts = b.insts;
  const keep = new Set<number>();
  if (opts.pruneDead !== false) {
    const stack = [...outInsts];
    while (stack.length) {
      const id = stack.pop()!;
      if (keep.has(id)) continue;
      keep.add(id);
      for (const n of insts[id].ins) stack.push(b.netDriver[n]);
    }
    for (const i of insts) if (i.kind === 'IN') keep.add(i.id);
  } else for (const i of insts) keep.add(i.id);

  // перенумерация
  const remap = new Map<number, number>();
  const kept = insts.filter((i) => keep.has(i.id));
  kept.forEach((i, idx) => remap.set(i.id, idx));
  const netRemap = new Map<number, number>();
  const nets: Net[] = [];
  for (const i of kept) {
    if (i.out >= 0) {
      netRemap.set(i.out, nets.length);
      nets.push({ id: nets.length, driver: remap.get(i.id)!, sinks: [] });
    }
  }
  insts = kept.map((i) => ({ ...i, id: remap.get(i.id)!, out: i.out >= 0 ? netRemap.get(i.out)! : -1, ins: i.ins.map((n) => netRemap.get(n)!) }));
  for (const i of insts) i.ins.forEach((n, slot) => nets[n].sinks.push({ inst: i.id, slot }));
  const fixMap = (m: Map<string, number>) => {
    for (const [k, v] of [...m.entries()]) {
      const nv = remap.get(v);
      if (nv === undefined) m.delete(k);
      else m.set(k, nv);
    }
  };
  fixMap(inputOf);
  fixMap(outputOf);
  return { netlist: { insts, nets, inputOf, outputOf }, issues };
}
