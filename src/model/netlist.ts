import { Circuit, GATE_INFO, Gate, GateType, GRID, Wire } from './types';
import { createGate, gateSize, snap, uid } from './circuit';

/**
 * Текстовый формат схемы («нетлист»): удобен для ИИ и для быстрого набора.
 *
 *   input x y z
 *   nx = NOT(x)
 *   a  = AND(x, y)
 *   w  = OR(a, nx)
 *   output w0 = w
 *
 * Подробности — docs/ai/circuit-netlist.md.
 */

export interface NetlistIssue {
  line: number;
  level: 'error' | 'warning';
  message: string;
}

const TYPE_ALIASES: Record<string, GateType> = {
  NOT: 'NOT',
  INV: 'NOT',
  BUF: 'BUFFER',
  BUFFER: 'BUFFER',
  REPEATER: 'BUFFER',
  DELAY: 'BUFFER',
  AND: 'AND',
  NAND: 'NAND',
  OR: 'OR',
  NOR: 'NOR',
  XOR: 'XOR',
  XNOR: 'XNOR',
};

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const KEYWORDS = new Set(['input', 'inputs', 'in', 'output', 'outputs', 'out', 'circuit']);

export interface NetlistParseResult {
  circuit: Circuit | null;
  issues: NetlistIssue[];
  /** Число входов / выходов / гейтов (без входов и выходов). */
  stats: { inputs: number; outputs: number; gates: number };
}

interface GateDef {
  name: string;
  type: GateType;
  args: string[];
  delay: number;
  line: number;
}

interface OutDef {
  label: string;
  src: string;
  line: number;
}

function stripComment(line: string): string {
  const a = line.indexOf('#');
  const b = line.indexOf('//');
  const cut = [a, b].filter((i) => i >= 0);
  return (cut.length ? line.slice(0, Math.min(...cut)) : line).trim();
}

export function parseNetlist(text: string): NetlistParseResult {
  const issues: NetlistIssue[] = [];
  const err = (line: number, message: string): void => void issues.push({ line, level: 'error', message });
  const warn = (line: number, message: string): void => void issues.push({ line, level: 'warning', message });
  const inputs: { name: string; line: number }[] = [];
  const gates: GateDef[] = [];
  const outs: OutDef[] = [];
  const known = new Map<string, number>(); // имя сигнала → строка объявления
  const lines = text.replace(/\r/g, '').split('\n');

  const declare = (name: string, line: number): boolean => {
    if (!NAME_RE.test(name)) {
      err(line, `Некорректное имя «${name}»: допустимы латинские буквы, цифры и _, первый символ не цифра`);
      return false;
    }
    if (KEYWORDS.has(name.toLowerCase())) {
      err(line, `Имя «${name}» зарезервировано (input/output/circuit)`);
      return false;
    }
    if (known.has(name)) {
      err(line, `Имя «${name}» уже объявлено в строке ${known.get(name)}`);
      return false;
    }
    known.set(name, line);
    return true;
  };

  lines.forEach((raw, i) => {
    const ln = i + 1;
    const s = stripComment(raw);
    if (!s) return;
    const head = s.split(/\s+/)[0].toLowerCase();
    if (head === 'circuit') return; // название — только для людей
    if (KEYWORDS.has(head) && /^\S+\s*=/.test(s)) {
      err(ln, `Имя «${head}» зарезервировано (input/output/circuit) — переименуйте сигнал`);
      return;
    }
    if (head === 'input' || head === 'inputs' || head === 'in') {
      const names = s.slice(head.length).split(/[\s,]+/).filter(Boolean);
      if (!names.length) err(ln, 'После input нужен хотя бы один идентификатор: input x y z');
      for (const n of names) if (declare(n, ln)) inputs.push({ name: n, line: ln });
      return;
    }
    if (head === 'output' || head === 'outputs' || head === 'out') {
      const rest = s.slice(head.length).trim();
      // допускается список с «=»: output w0 = a, w1 = b   или одиночный output w0 = a
      const parts = rest.split(',').map((p) => p.trim()).filter(Boolean);
      if (!parts.length) err(ln, 'Формат: output имя = сигнал');
      for (const p of parts) {
        const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([A-Za-z_][A-Za-z0-9_]*)$/.exec(p);
        if (!m) {
          err(ln, `Не понимаю «${p}». Формат: output имя = сигнал`);
          continue;
        }
        if (outs.some((o) => o.label === m[1])) err(ln, `Выход «${m[1]}» уже объявлен`);
        else outs.push({ label: m[1], src: m[2], line: ln });
      }
      return;
    }
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([A-Za-z_][A-Za-z0-9_]*)\s*\((.*)\)$/.exec(s);
    if (!m) {
      err(ln, `Не понимаю строку «${s}». Ожидалось: имя = ТИП(арг, арг), input …, output имя = сигнал`);
      return;
    }
    const [, name, typeRaw, argText] = m;
    const type = TYPE_ALIASES[typeRaw.toUpperCase()];
    if (!type) {
      err(ln, `Неизвестный тип гейта «${typeRaw}». Доступны: ${Object.keys(TYPE_ALIASES).join(', ')}`);
      return;
    }
    let delay = 1;
    const args: string[] = [];
    for (const a of argText.split(',').map((x) => x.trim()).filter(Boolean)) {
      const dm = /^delay\s*=\s*(\d+)$/i.exec(a);
      if (dm) {
        if (type !== 'BUFFER') warn(ln, 'delay имеет смысл только у BUF');
        delay = Number(dm[1]);
        if (delay < 1 || delay > 4) {
          err(ln, 'delay у повторителя — число от 1 до 4');
          delay = 1;
        }
      } else if (NAME_RE.test(a)) args.push(a);
      else err(ln, `Некорректный аргумент «${a}»`);
    }
    if (!declare(name, ln)) return;
    gates.push({ name, type, args, delay, line: ln });
  });

  // проверки
  const info = (t: GateType) => GATE_INFO[t];
  for (const g of gates) {
    const gi = info(g.type);
    if (g.args.length < gi.minInputs || g.args.length > gi.maxInputs) {
      err(g.line, `${g.type}: нужно ${gi.minInputs === gi.maxInputs ? gi.minInputs : `${gi.minInputs}–${gi.maxInputs}`} входов, указано ${g.args.length}. Для большего числа входов соберите дерево из нескольких гейтов`);
    }
    for (const a of g.args) if (!known.has(a)) err(g.line, `Сигнал «${a}» не объявлен (используется в ${g.name})`);
  }
  for (const o of outs) if (!known.has(o.src)) err(o.line, `Сигнал «${o.src}» не объявлен (используется в output ${o.label})`);
  if (!inputs.length) err(1, 'Нет входов: добавьте строку «input x y z»');
  if (!outs.length) err(1, 'Нет выходов: добавьте строки «output имя = сигнал»');
  const used = new Set<string>([...gates.flatMap((g) => g.args), ...outs.map((o) => o.src)]);
  for (const i of inputs) if (!used.has(i.name)) warn(i.line, `Вход «${i.name}» нигде не используется`);
  for (const g of gates) if (!used.has(g.name)) warn(g.line, `Гейт «${g.name}» ни к чему не подключён`);

  const stats = { inputs: inputs.length, outputs: outs.length, gates: gates.length };
  if (issues.some((x) => x.level === 'error')) return { circuit: null, issues, stats };

  // построение схемы
  const byName = new Map<string, Gate>();
  const all: Gate[] = [];
  for (const i of inputs) {
    const g = createGate('INPUT', 0, 0, i.name);
    byName.set(i.name, g);
    all.push(g);
  }
  for (const d of gates) {
    const g = createGate(d.type, 0, 0, '');
    g.inputs = d.args.length;
    g.delay = d.delay;
    g.label = d.name;
    byName.set(d.name, g);
    all.push(g);
  }
  const wires: Wire[] = [];
  for (const d of gates) {
    d.args.forEach((a, pin) => wires.push({ id: uid('w'), from: byName.get(a)!.id, to: byName.get(d.name)!.id, toPin: pin }));
  }
  for (const o of outs) {
    const g = createGate('OUTPUT', 0, 0, o.label);
    all.push(g);
    wires.push({ id: uid('w'), from: byName.get(o.src)!.id, to: g.id, toPin: 0 });
  }
  const circuit = layoutCircuit({ gates: all, wires });
  return { circuit, issues, stats };
}

/** Послойная раскладка: слой = длина самого длинного пути от входов (обратные связи игнорируются). */
export function layoutCircuit(c: Circuit): Circuit {
  const byId = new Map(c.gates.map((g) => [g.id, g]));
  const incoming = new Map<string, string[]>();
  for (const g of c.gates) incoming.set(g.id, []);
  for (const w of c.wires) incoming.get(w.to)!.push(w.from);

  // слой через DFS с отбрасыванием обратных рёбер
  const layer = new Map<string, number>();
  const state = new Map<string, 0 | 1 | 2>();
  const visit = (id: string): number => {
    if (layer.has(id)) return layer.get(id)!;
    state.set(id, 1);
    let l = 0;
    const g = byId.get(id)!;
    if (g.type !== 'INPUT') {
      for (const f of incoming.get(id)!) {
        if (state.get(f) === 1) continue; // обратная связь
        l = Math.max(l, visit(f) + 1);
      }
    }
    state.set(id, 2);
    layer.set(id, l);
    return l;
  };
  for (const g of c.gates) visit(g.id);
  // выходы — в последний слой
  const maxLayer = Math.max(0, ...[...layer.values()]);
  for (const g of c.gates) if (g.type === 'OUTPUT') layer.set(g.id, Math.max(layer.get(g.id)!, maxLayer));

  const layers: Gate[][] = [];
  for (const g of c.gates) {
    const l = layer.get(g.id)!;
    (layers[l] ??= []).push(g);
  }
  for (let i = 0; i < layers.length; i++) layers[i] ??= [];
  const outgoing = new Map<string, string[]>();
  for (const g of c.gates) outgoing.set(g.id, []);
  for (const w of c.wires) outgoing.get(w.from)!.push(w.to);

  // барицентрическая сортировка внутри слоёв (несколько проходов туда-обратно)
  const order = new Map<string, number>();
  const declared = new Map(c.gates.map((g, i) => [g.id, i]));
  // порядок входов и выходов задан автором (от него зависит нумерация битов) — барицентр его не меняет
  const pinOrder = (L: Gate[]): void => {
    for (const t of ['INPUT', 'OUTPUT'] as const) {
      const slots = L.map((g, i) => (g.type === t ? i : -1)).filter((i) => i >= 0);
      const sorted = slots.map((i) => L[i]).sort((a, b) => declared.get(a.id)! - declared.get(b.id)!);
      slots.forEach((i, k) => (L[i] = sorted[k]));
    }
  };
  const reindex = (): void =>
    layers.forEach((L) => {
      pinOrder(L);
      L.forEach((g, i) => order.set(g.id, i));
    });
  reindex();
  const bary = (g: Gate, nb: string[]): number => (nb.length ? nb.reduce((a, id) => a + (order.get(id) ?? 0), 0) / nb.length : order.get(g.id)!);
  for (let pass = 0; pass < 4; pass++) {
    for (let l = 1; l < layers.length; l++) {
      layers[l].sort((a, b) => bary(a, incoming.get(a.id)!) - bary(b, incoming.get(b.id)!));
      reindex();
    }
    for (let l = layers.length - 2; l >= 0; l--) {
      layers[l].sort((a, b) => bary(a, outgoing.get(a.id)!) - bary(b, outgoing.get(b.id)!));
      reindex();
    }
  }

  const colW = 75 + GRID * 7; // ширина гейта + зазор под провода
  const rowGap = GRID * 2;
  const heights = layers.map((L) => L.reduce((a, g) => a + gateSize(g).h + rowGap, -rowGap));
  const H = Math.max(0, ...heights);
  const gates = c.gates.map((g) => ({ ...g }));
  const pos = new Map(gates.map((g) => [g.id, g]));
  layers.forEach((L, l) => {
    let y = GRID * 2 + (H - heights[l]) / 2;
    for (const g0 of L) {
      const g = pos.get(g0.id)!;
      g.x = snap(GRID * 2 + l * colW);
      g.y = snap(y);
      y += gateSize(g).h + rowGap;
    }
  });
  return { gates, wires: c.wires };
}

// ───────────────────────── печать схемы в нетлист ─────────────────────────

const TYPE_NAMES: Record<GateType, string> = {
  INPUT: 'INPUT',
  OUTPUT: 'OUTPUT',
  NOT: 'NOT',
  BUFFER: 'BUF',
  AND: 'AND',
  NAND: 'NAND',
  OR: 'OR',
  NOR: 'NOR',
  XOR: 'XOR',
  XNOR: 'XNOR',
};

function sanitize(label: string): string {
  const s = label.replace(/[^A-Za-z0-9_]/g, '_');
  return /^[A-Za-z_]/.test(s) ? s : `n_${s}`;
}

export function printNetlist(c: Circuit, title?: string): string {
  const byId = new Map(c.gates.map((g) => [g.id, g]));
  const used = new Set<string>();
  const name = new Map<string, string>();
  const unique = (base: string): string => {
    let n = base;
    for (let k = 2; used.has(n) || KEYWORDS.has(n.toLowerCase()); k++) n = `${base}_${k}`;
    used.add(n);
    return n;
  };
  const inputs = c.gates.filter((g) => g.type === 'INPUT').sort((a, b) => a.y - b.y || a.x - b.x);
  const logic = c.gates.filter((g) => g.type !== 'INPUT' && g.type !== 'OUTPUT').sort((a, b) => a.x - b.x || a.y - b.y);
  const outputs = c.gates.filter((g) => g.type === 'OUTPUT').sort((a, b) => a.y - b.y || a.x - b.x);
  inputs.forEach((g, i) => name.set(g.id, unique(sanitize(g.label || `in${i}`))));
  logic.forEach((g, i) => name.set(g.id, unique(g.label ? sanitize(g.label) : `g${i + 1}`)));
  const lines: string[] = [];
  if (title) lines.push(`circuit ${JSON.stringify(title)}`);
  if (inputs.length) lines.push(`input ${inputs.map((g) => name.get(g.id)).join(' ')}`);
  for (const g of logic) {
    const args: string[] = [];
    for (let p = 0; p < g.inputs; p++) {
      const w = c.wires.find((x) => x.to === g.id && x.toPin === p);
      args.push(w ? name.get(w.from) ?? '?' : '?');
    }
    if (g.type === 'BUFFER' && g.delay > 1) args.push(`delay=${g.delay}`);
    lines.push(`${name.get(g.id)} = ${TYPE_NAMES[g.type]}(${args.join(', ')})`);
  }
  outputs.forEach((g, i) => {
    const w = c.wires.find((x) => x.to === g.id);
    const src = w ? name.get(w.from) : undefined;
    if (!src || !byId.has(w!.from)) return;
    lines.push(`output ${sanitize(g.label || `w${i}`)} = ${src}`);
  });
  return lines.join('\n') + '\n';
}
