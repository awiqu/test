import { Vox } from './vox';

/**
 * Разводка «поверх узлов». Узлы (карточки) стоят на земле и не выше y=3; провода идут над ними на слоях y=6, y=8, … по сетке с шагом 2:
 * параллельные провода всегда разделены пустой клеткой, поэтому случайных касаний нет. Слои разделены опорными блоками (так же, как
 * магистрали и обходы в старой шине: проверено на сервере). Вывод карточки (клетка пыли на земле) подключается «рампой» — диагональным
 * подъёмом по одной клетке на уровень; между слоями — такая же рампа через клетку.
 *
 * Сетка: узел (l, i, j) — клетка (X0 + 2i, y_l, Z0 + 2j). Ребро между соседними узлами — две клетки (серединная клетка может быть
 * повторителем). Один узел принадлежит одной цепи; перекрещиваются цепи только на разных слоях.
 */

export const floorDebug: { edges: { net: string; from: [number, number, number]; to: [number, number, number]; kind: string; strength: number }[] } = { edges: [] };

export const LAYER0_Y = 6;
export const layerY = (l: number): number => LAYER0_Y + 2 * l;

/** Вывод карточки: клетка пыли (x, y, z) на самой карточке и направление «наружу» (dx, dz). */
export interface FPin {
  x: number;
  y: number;
  z: number;
  dx: number;
  dz: number;
  /** Приёмник с длинной внутренней трассой: рядом с карточкой ставится повторитель (на вывод приходит полная сила). */
  boost?: boolean;
}

export interface FNet {
  name: string;
  src: FPin;
  sinks: FPin[];
}

export interface FloorStats {
  nets: number;
  /** Клеток провода (пыль + повторители) без рамп выводов. */
  wireCells: number;
  repeaters: number;
  vias: number;
  attempts: number;
  size: { x: number; z: number; y: number };
  ms: number;
}

export class FloorError extends Error {
  constructor(
    message: string,
    readonly failed: string[],
  ) {
    super(message);
  }
}

const SIDE = (dx: number, dz: number): number => (dx === 1 ? 1 : dx === -1 ? 3 : dz === 1 ? 2 : 0);
const D4: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

type Key = string;
const key = (x: number, y: number, z: number): Key => `${x},${y},${z}`;

interface EscCell {
  x: number;
  y: number;
  z: number;
  kind: 'dust' | 'rep';
  /** Для повторителя — сторона входа. */
  side?: number;
}

interface Escape {
  cells: EscCell[];
  /** Узел сетки (слой 0), куда выходит рампа. */
  node: { x: number; z: number };
  /** Число клеток пыли после узла до вывода карточки (для приёмника) или от повторителя до узла включительно (для источника). */
  len: number;
  /** Клетки (x, z) вдоль коридора между узлом и карточкой: узлы сетки тут закрыты. */
  corridor: { x: number; z: number }[];
  /** Нужная сила в узле (приёмник) или сила в узле (источник). */
  strength: number;
}

/**
 * Выход вывода на слой 0: плоские клетки наружу (при необходимости со сдвигом на одну клетку вбок, чтобы попасть в сетку узлов),
 * затем рампа с подъёмом по клетке на уровень. Для источника первая клетка — повторитель (даёт полную силу на всём пути).
 * Для приёмника с boost — повторитель рядом с карточкой.
 */
function planEscape(pin: FPin, role: 'src' | 'sink', X0: number, Z0: number): Escape[] {
  const out: Escape[] = [];
  const n = LAYER0_Y - pin.y;
  const ax = pin.dx;
  const az = pin.dz;
  const cx = az !== 0 ? 1 : 0; // поперечная ось
  const cz = ax !== 0 ? 1 : 0;
  const boost = role === 'sink' && pin.boost === true;
  const needRep = role === 'src' || boost;
  // у повторителя (клетка 1) вход: у источника — со стороны карточки, у приёмника — снаружи
  const repSide = role === 'src' ? SIDE(-ax, -az) : SIDE(ax, az);
  for (const jog of [0, 1, -1]) {
    for (let tj = 1; tj <= (jog === 0 ? 1 : 4); tj++) {
      if (jog !== 0 && tj < (needRep ? 2 : 1)) continue;
      for (let f = needRep ? 2 : 1; f <= 9; f++) {
        if (jog !== 0 && f < tj) continue;
        const cross = jog;
        const nx = pin.x + ax * (f + n) + cx * cross;
        const nz = pin.z + az * (f + n) + cz * cross;
        if (((nx - X0) & 1) !== 0 || ((nz - Z0) & 1) !== 0) continue;
        const cells: EscCell[] = [];
        let g = 0;
        for (let t = 1; t <= f; t++) {
          const off = jog !== 0 && t >= tj ? jog : 0;
          const rep = t === 1 && needRep;
          if (jog !== 0 && t === tj) {
            cells.push({ x: pin.x + ax * t, y: pin.y, z: pin.z + az * t, kind: rep ? 'rep' : 'dust', side: rep ? repSide : undefined });
            cells.push({ x: pin.x + ax * t + cx * jog, y: pin.y, z: pin.z + az * t + cz * jog, kind: 'dust' });
            g += 2;
          } else {
            cells.push({ x: pin.x + ax * t + cx * off, y: pin.y, z: pin.z + az * t + cz * off, kind: rep ? 'rep' : 'dust', side: rep ? repSide : undefined });
            g++;
          }
        }
        for (let k = 1; k <= n; k++) cells.push({ x: pin.x + ax * (f + k) + cx * cross, y: pin.y + k, z: pin.z + az * (f + k) + cz * cross, kind: 'dust' });
        // коридор: узлы сетки на линии рампы между узлом и карточкой (закрыты для чужих проводов)
        const corridor: { x: number; z: number }[] = [];
        for (let s = 2; s <= f + n + 2; s += 2) corridor.push({ x: nx - ax * s, z: nz - az * s });
        let len: number;
        let strength: number;
        if (role === 'src') {
          // повторитель в начале даёт 15 первой клетке пыли; от неё до узла включительно (g − 1) + n клеток
          len = g - 1 + n;
          strength = 16 - len;
        } else {
          // после узла: рампа n − 1 клеток и плоские g клеток; на выводе нужно не меньше 2 (при boost — запас перед повторителем)
          len = n - 1 + g;
          strength = boost ? n - 1 + (g - 1) + 1 + 3 : len + 1 + 2;
        }
        out.push({ cells, node: { x: nx, z: nz }, len, corridor, strength });
      }
    }
  }
  // самые короткие выходы — первыми
  out.sort((a, b) => a.cells.length - b.cells.length);
  return out;
}

class MinHeap {
  private a: number[] = [];
  private p: number[] = [];
  get size(): number {
    return this.a.length;
  }
  push(v: number, pri: number): void {
    const a = this.a;
    const p = this.p;
    let i = a.length;
    a.push(v);
    p.push(pri);
    while (i > 0) {
      const par = (i - 1) >> 1;
      if (p[par] <= p[i]) break;
      [a[par], a[i]] = [a[i], a[par]];
      [p[par], p[i]] = [p[i], p[par]];
      i = par;
    }
  }
  pop(): [number, number] {
    const a = this.a;
    const p = this.p;
    const top: [number, number] = [a[0], p[0]];
    const la = a.pop()!;
    const lp = p.pop()!;
    if (a.length > 0) {
      a[0] = la;
      p[0] = lp;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && p[l] < p[m]) m = l;
        if (r < a.length && p[r] < p[m]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        [p[m], p[i]] = [p[i], p[m]];
        i = m;
      }
    }
    return top;
  }
}

interface NetState {
  idx: number;
  net: FNet;
  srcEsc: Escape;
  sinkEsc: Escape[];
  /** Узлы дерева (индексы) → родитель (к источнику) или −1 у корня. */
  parent: Map<number, number>;
  /** Узлы, соединённые с родителем рампой между слоями. */
  viaTo: Set<number>;
}

export interface FloorOptions {
  layers?: number;
  /** Сколько раз пересобирать порядок цепей при неудаче. */
  attempts?: number;
  progress?: (msg: string) => void;
  seed?: number;
}

/**
 * Прокладывает все цепи поверх уже расставленных карточек и записывает провода в Vox.
 * Карточки — всё, что уже лежит в Vox без владельца; их верхняя граница определяет, где можно вести провод.
 */
export function routeFloor(v: Vox, nets: FNet[], opts: FloorOptions = {}): FloorStats {
  const base = opts.layers ?? 2;
  // сначала два слоя; если часть цепей не проложить — ещё один слой (стоят провода выше, плата та же)
  for (let layers = base; ; layers++) {
    try {
      return routeFloorLayers(v, nets, opts, layers, opts.attempts ?? (layers === base ? 4 : 8));
    } catch (e) {
      if (!(e instanceof FloorError) || e.failed.length === 0 || layers >= base + 1) throw e;
      opts.progress?.(`Слоёв проводов не хватило (${e.failed.length} цепей) — добавляю слой…`);
    }
  }
}

function routeFloorLayers(v: Vox, nets: FNet[], opts: FloorOptions, NL: number, attempts: number): FloorStats {
  const t0 = performance.now();
  floorDebug.edges.length = 0;
  // границы и высоты карточек
  const bb = v.bounds();
  const pad = 20;
  const X0 = bb.x0 - pad - (((bb.x0 - pad) % 2) + 2) % 2;
  const Z0 = bb.z0 - pad - (((bb.z0 - pad) % 2) + 2) % 2;
  const W = Math.ceil((bb.x1 + pad - X0) / 2) + 1;
  const H = Math.ceil((bb.z1 + pad - Z0) / 2) + 1;
  const top = new Map<number, number>(); // z * 65536 + x → максимальный y клеток карточек
  const cardCells = new Set<Key>();
  v.forEach((x, y, z) => {
    if (v.ownerOf(x, y, z)) return;
    const k = (z - Z0) * 100003 + (x - X0);
    if ((top.get(k) ?? -1) < y) top.set(k, y);
    cardCells.add(key(x, y, z));
  });
  const colTop = (x: number, z: number): number => top.get((z - Z0) * 100003 + (x - X0)) ?? -1;
  const nodeX = (i: number): number => X0 + 2 * i;
  const nodeZ = (j: number): number => Z0 + 2 * j;
  const NI = (l: number, i: number, j: number): number => (l * H + j) * W + i;
  const total = NL * W * H;
  const li = (n: number): number => Math.floor(n / (W * H));
  const jj = (n: number): number => Math.floor((n % (W * H)) / W);
  const ii = (n: number): number => n % W;

  // ───── выходы (рампы) ─────
  const claims = new Map<Key, number>(); // клетка → индекс цепи (для проверки касаний между выходами)
  const states: NetState[] = [];
  const planFor = (pin: FPin, role: 'src' | 'sink', netIdx: number): Escape => {
    const variants = planEscape(pin, role, X0, Z0);
    for (const e of variants) {
      let ok = true;
      for (const c of e.cells) {
        // клетка и её опора не должны лежать на карточке; рядом (по сторонам и по вертикали) не должно быть чужого выхода
        if (cardCells.has(key(c.x, c.y, c.z)) || cardCells.has(key(c.x, c.y - 1, c.z))) ok = false;
        for (const [dx, dy, dz] of [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]] as [number, number, number][]) {
          const o = claims.get(key(c.x + dx, c.y + dy, c.z + dz));
          if (o !== undefined && o !== netIdx) ok = false;
        }
        if (!ok) break;
      }
      if (!ok) continue;
      for (const c of e.cells) {
        claims.set(key(c.x, c.y, c.z), netIdx);
        claims.set(key(c.x, c.y - 1, c.z), netIdx);
        // над пылью рампы не должно быть проводящего блока (иначе пыль не поднимается к следующей клетке)
        if (c.y < LAYER0_Y) claims.set(key(c.x, c.y + 1, c.z), netIdx);
      }
      return e;
    }
    if (process.env.FLOOR_DEBUG) {
      const why = new Map<string, number>();
      for (const e of variants) {
        for (const c of e.cells) {
          if (cardCells.has(key(c.x, c.y, c.z))) { why.set('card', (why.get('card') ?? 0) + 1); break; }
          if (cardCells.has(key(c.x, c.y - 1, c.z))) { why.set('cardBelow', (why.get('cardBelow') ?? 0) + 1); break; }
          let bad = false;
          for (const [dx, dy, dz] of [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]] as [number, number, number][]) {
            const o = claims.get(key(c.x + dx, c.y + dy, c.z + dz));
            if (o !== undefined && o !== netIdx) bad = true;
          }
          if (bad) { why.set('claim', (why.get('claim') ?? 0) + 1); break; }
        }
      }
      const near: string[] = [];
      for (const [k, o] of claims) {
        const [x, y, z] = k.split(',').map(Number);
        if (Math.abs(x - pin.x) <= 12 && Math.abs(z - pin.z) <= 4 && y === pin.y) near.push(`${x},${z}:#${o}`);
      }
      process.stderr.write(`near claims ${near.join(' ')}\n`);
      process.stderr.write(`ESC FAIL ${role} pin=${JSON.stringify(pin)} variants=${variants.length} why=${JSON.stringify([...why])}\n`);
    }
    throw new FloorError(`Нет места для выхода вывода (${pin.x}, ${pin.y}, ${pin.z}) цепи #${netIdx}`, []);
  };
  nets.forEach((net, idx) => {
    const srcEsc = planFor(net.src, 'src', idx);
    const sinkEsc = net.sinks.map((s) => planFor(s, 'sink', idx));
    states.push({ idx, net, srcEsc, sinkEsc, parent: new Map(), viaTo: new Set() });
  });

  // ───── сетка ─────
  const FREE = -1;
  const BLOCK = -2;
  const SHADOW = -3;
  const baseOwner = new Int32Array(total).fill(FREE);
  /** Соседние колонки не должны содержать чужую пыль на уровне провода или вплотную под ним (пыль соединяется по диагонали). */
  const quietAround = (x: number, z: number, y: number): boolean => {
    for (const [dx, dz] of D4) if (colTop(x + dx, z + dz) > y - 2) return false;
    return true;
  };
  const usableCol = (l: number, x: number, z: number): boolean =>
    colTop(x, z) <= layerY(l) - 3 && quietAround(x, z, layerY(l)) && !claims.has(key(x, layerY(l), z)) && !claims.has(key(x, layerY(l) - 1, z));
  for (let l = 0; l < NL; l++)
    for (let j = 0; j < H; j++)
      for (let i = 0; i < W; i++) {
        const x = nodeX(i);
        const z = nodeZ(j);
        if (!usableCol(l, x, z)) baseOwner[NI(l, i, j)] = BLOCK;
      }
  // коридоры выходов закрыты на слое 0 (выше рампы стоят на ≤ 5 уровне и не мешают проводам верхних слоёв)
  const closeCorridor = (e: Escape): void => {
    for (const c of e.corridor) {
      const i = (c.x - X0) / 2;
      const j = (c.z - Z0) / 2;
      if (i < 0 || j < 0 || i >= W || j >= H || !Number.isInteger(i) || !Number.isInteger(j)) continue;
      baseOwner[NI(0, i, j)] = BLOCK;
    }
  };
  for (const s of states) {
    closeCorridor(s.srcEsc);
    s.sinkEsc.forEach(closeCorridor);
  }
  // узлы выходов: слой 0
  const termNode = (e: Escape): number => NI(0, (e.node.x - X0) / 2, (e.node.z - Z0) / 2);
  for (const s of states) {
    const ts = [termNode(s.srcEsc), ...s.sinkEsc.map(termNode)];
    for (const t of ts) baseOwner[t] = FREE; // пометится владельцем при каждой попытке
  }

  // ребро (a, b) на одном слое — клетка-середина; рёбра, занятые рампами между слоями
  const edgeKey = (a: number, b: number): number => (a < b ? a * total + b : b * total + a);
  const midCol = (_l: number, a: number, b: number): [number, number] => {
    const x = (nodeX(ii(a)) + nodeX(ii(b))) / 2;
    const z = (nodeZ(jj(a)) + nodeZ(jj(b))) / 2;
    return [x, z];
  };

  /** Дети узлов дерева цепи и требуемая сила сигнала в узле (максимум по приёмникам ниже). */
  const treeInfo = (s: NetState): { children: Map<number, number[]>; need: (nd: number) => number } => {
    const children = new Map<number, number[]>();
    for (const [node, par] of s.parent) {
      if (par < 0) continue;
      if (!children.has(par)) children.set(par, []);
      children.get(par)!.push(node);
    }
    const sinkReq = new Map<number, number>();
    s.sinkEsc.forEach((e) => sinkReq.set(termNode(e), e.strength));
    // повторитель можно поставить на любом плоском ребре, поэтому через плоское ребро требуется только 4; рампа стоит 2 единицы
    const req = new Map<number, number>();
    const need = (nd: number): number => {
      const cached = req.get(nd);
      if (cached !== undefined) return cached;
      let r = sinkReq.get(nd) ?? 1;
      for (const c of children.get(nd) ?? []) r = Math.max(r, s.viaTo.has(c) ? need(c) + 2 : 4);
      req.set(nd, r);
      return r;
    };
    return { children, need };
  };

  const bannedVia = new Set<number>();
  /** Цепи, которые не удалось проложить, получают приоритет в следующей попытке (как «выдавливание вперёд» при перерасстановке). */
  const prio = new Map<number, number>();
  let bestFail: string[] = [];
  let finalStates: NetState[] | null = null;
  let tries = 0;
  const rnd = mulberry(opts.seed ?? 1);

  for (; tries < attempts && !finalStates; tries++) {
    opts.progress?.(`Разводка поверх узлов: попытка ${tries + 1}…`);
    const owner = Int32Array.from(baseOwner);
    const usedEdge = new Set<number>();
    for (const s of states) {
      s.parent.clear();
      s.viaTo.clear();
    }
    // порядок цепей: сначала длинные (трудные) — затем перемешивание при повторных попытках
    const spread = (s: NetState): number => {
      const xs = [s.net.src.x, ...s.net.sinks.map((p) => p.x)];
      const zs = [s.net.src.z, ...s.net.sinks.map((p) => p.z)];
      return Math.max(...xs) - Math.min(...xs) + Math.max(...zs) - Math.min(...zs) + (tries > 0 ? rnd() * 40 * tries : 0);
    };
    const order = [...states].sort((a, b) => (prio.get(b.idx) ?? 0) - (prio.get(a.idx) ?? 0) || spread(b) - spread(a));
    // терминалы закрепляются за цепями заранее; слой над терминалом остаётся пустым для рампы вверх (иначе вывод заперт чужими проводами)
    for (const s of states) {
      for (const e of [s.srcEsc, ...s.sinkEsc]) {
        const t = termNode(e);
        owner[t] = s.idx;
        if (NL > 1 && owner[t + W * H] === FREE) owner[t + W * H] = -10 - s.idx;
      }
    }
    const failedBy = new Map<number, string[]>();
    const dist = new Float64Array(total);
    const prev = new Int32Array(total);
    const prevVia = new Uint8Array(total);
    const seen = new Int32Array(total);
    let stamp = 0;
    const isTerm = new Uint8Array(total);
    for (const s of states) for (const e of [s.srcEsc, ...s.sinkEsc]) isTerm[termNode(e)] = 1;
    const netEdges: number[][] = states.map(() => []);
    const netShadows: number[][] = states.map(() => []);
    const ripCount = new Int32Array(states.length);
    const RIP_MAX = 6;
    const STEAL_COST = 30;

    const inGrid = (l: number, i: number, j: number): boolean => l >= 0 && l < NL && i >= 0 && j >= 0 && i < W && j < H;

    /** Освобождает всё, что цепь заняла (кроме закреплённых терминалов): потом её прокладывают заново. */
    const ripUp = (s: NetState): void => {
      for (const nd of s.parent.keys()) if (!isTerm[nd]) owner[nd] = FREE;
      for (const k of netEdges[s.idx]) usedEdge.delete(k);
      for (const sh of netShadows[s.idx]) if (owner[sh] === SHADOW) owner[sh] = FREE;
      netEdges[s.idx] = [];
      netShadows[s.idx] = [];
      s.parent.clear();
      s.viaTo.clear();
      failedBy.delete(s.idx);
      if (NL > 1)
        for (const e of [s.srcEsc, ...s.sinkEsc]) {
          const t = termNode(e) + W * H;
          if (owner[t] === FREE) owner[t] = -10 - s.idx;
        }
    };

    /**
     * Ищет путь от приёмника к дереву цепи и фиксирует его. С steal узлы других цепей можно занимать за штраф: их владельцев
     * выдавливают (ripUp) и возвращают в список `victims` для повторной прокладки.
     */
    const routeSink = (s: NetState, sk: { node: number; k: number }, steal: boolean): { ok: boolean; victims: number[] } => {
      const mine = (nd: number): boolean => owner[nd] === FREE || owner[nd] === s.idx;
      const foreign = (nd: number): boolean => owner[nd] >= 0 && owner[nd] !== s.idx && !isTerm[nd] && ripCount[owner[nd]] < RIP_MAX;
      const passable = (nd: number): boolean => mine(nd) || (steal && foreign(nd));
      const extra = (nd: number): number => (steal && foreign(nd) ? STEAL_COST : 0);
      const sameDir = (p: number, c: number, n2: number): boolean => ii(c) - ii(p) === ii(n2) - ii(c) && jj(c) - jj(p) === jj(n2) - jj(c) && li(p) === li(c);
      bannedVia.clear();
      for (let retry = 0; ; retry++) {
        stamp++;
        const heap = new MinHeap();
        seen[sk.node] = stamp;
        dist[sk.node] = 0;
        prev[sk.node] = -1;
        heap.push(sk.node, 0);
        let hit = -1;
        const viaOk = (lo: number, hi: number, dx: number, dz: number): boolean => {
          if (bannedVia.has(lo * total + hi)) return false;
          if (!passable(lo) || !passable(hi)) return false;
          const l0 = li(lo);
          const shadow = NI(l0 + 1, ii(lo), jj(lo));
          if (owner[shadow] !== FREE && owner[shadow] !== -10 - s.idx && !(steal && foreign(shadow))) return false;
          const lowEdge = NI(l0, ii(lo) + dx, jj(lo) + dz);
          if (usedEdge.has(edgeKey(lo, lowEdge)) && !(steal && (foreign(lo) || foreign(lowEdge)))) return false;
          const [mx, mz] = midCol(l0, lo, lowEdge);
          const y0 = layerY(l0);
          // клетки рампы: серединная опора на уровне нижнего слоя и пыль на уровень выше; над нижним узлом должно быть пусто
          if (colTop(mx, mz) > y0 - 3 || !quietAround(mx, mz, y0 + 1)) return false;
          if (claims.has(key(mx, y0, mz)) || claims.has(key(mx, y0 + 1, mz))) return false;
          const hx = nodeX(ii(hi));
          const hz = nodeZ(jj(hi));
          if (colTop(hx, hz) > y0 - 2 || !quietAround(hx, hz, y0 + 2)) return false;
          if (claims.has(key(hx, y0 + 1, hz))) return false;
          return true;
        };
        const relaxVia = (from: number, to: number, d: number): void => {
          // две рампы подряд запрещены: между ними нужно плоское ребро, где можно поставить повторитель
          if (prevVia[from] === 1 && prev[from] >= 0) return;
          const nd2 = d + 7 + extra(to);
          if (seen[to] !== stamp || nd2 < dist[to]) {
            seen[to] = stamp;
            dist[to] = nd2;
            prev[to] = from;
            prevVia[to] = 1;
            heap.push(to, nd2);
          }
        };
        while (heap.size > 0) {
          const [nd, d] = heap.pop();
          if (d > dist[nd]) continue;
          if (s.parent.has(nd) && !(prevVia[nd] === 1 && prev[nd] >= 0 && s.viaTo.has(nd))) {
            hit = nd;
            break;
          }
          const l = li(nd);
          const i = ii(nd);
          const j = jj(nd);
          // шаги по слою
          for (const [dx, dz] of D4) {
            const i2 = i + dx;
            const j2 = j + dz;
            if (!inGrid(l, i2, j2)) continue;
            const nb = NI(l, i2, j2);
            if (!passable(nb)) continue;
            if (usedEdge.has(edgeKey(nd, nb)) && !(steal && (foreign(nd) || foreign(nb)))) continue;
            const [mx, mz] = midCol(l, nd, nb);
            if (!usableCol(l, mx, mz)) continue;
            const nd2 = d + 1 + extra(nb) + (prev[nd] >= 0 && sameDir(prev[nd], nd, nb) ? 0 : 0.35);
            if (seen[nb] !== stamp || nd2 < dist[nb]) {
              seen[nb] = stamp;
              dist[nb] = nd2;
              prev[nb] = nd;
              prevVia[nb] = 0;
              heap.push(nb, nd2);
            }
          }
          // рампы между слоями: этот узел — нижний (вверх) или верхний (вниз)
          for (const [dx, dz] of D4) {
            // вверх: нижний узел = (l, i, j), верхний = (l+1, i+dx, j+dz)
            if (l + 1 < NL && inGrid(l + 1, i + dx, j + dz)) {
              const up = NI(l + 1, i + dx, j + dz);
              if (viaOk(nd, up, dx, dz)) relaxVia(nd, up, d);
            }
            // вниз: верхний = (l, i, j), нижний = (l−1, i−dx, j−dz) со смещением (dx, dz) от нижнего к верхнему
            if (l - 1 >= 0 && inGrid(l - 1, i - dx, j - dz)) {
              const lo = NI(l - 1, i - dx, j - dz);
              if (viaOk(lo, nd, dx, dz)) relaxVia(nd, lo, d);
            }
          }
        }
        if (hit < 0) return { ok: false, victims: [] };
        // фиксируем путь: от hit назад по prev до приёмника, родители указывают к источнику
        let cur = hit;
        const chain: number[] = [];
        while (cur !== -1) {
          chain.push(cur);
          cur = prev[cur];
        }
        // самопересечение: ребро нижнего слоя одновременно проводом и опорой рампы, либо узел пути стоит над нижним узлом рампы
        const flat = new Set<number>();
        const viaEdges = new Map<number, number>();
        const chainSet = new Set(chain);
        const bad: number[] = [];
        const victimSet = new Set<number>();
        for (let t = 0; t + 1 < chain.length; t++) {
          const a = chain[t];
          const b = chain[t + 1];
          for (const nd of [a, b]) if (owner[nd] >= 0 && owner[nd] !== s.idx) victimSet.add(owner[nd]);
          if (li(a) === li(b)) {
            flat.add(edgeKey(a, b));
            continue;
          }
          const lo = li(a) < li(b) ? a : b;
          const hi = lo === a ? b : a;
          const l0 = li(lo);
          const lowEdge = NI(l0, ii(hi), jj(hi));
          const ek = edgeKey(lo, lowEdge);
          const shadow = NI(l0 + 1, ii(lo), jj(lo));
          if (owner[shadow] >= 0 && owner[shadow] !== s.idx) victimSet.add(owner[shadow]);
          if (viaEdges.has(ek) || chainSet.has(shadow)) bad.push(lo * total + hi);
          viaEdges.set(ek, lo * total + hi);
        }
        for (const [ek, vk] of viaEdges) if (flat.has(ek)) bad.push(vk);
        if (bad.length > 0) {
          if (retry >= 30) return { ok: false, victims: [] };
          for (const b of bad) bannedVia.add(b);
          continue;
        }
        const victims = [...victimSet];
        if (victims.length > 3) return { ok: false, victims: [] };
        for (const vi of victims) ripUp(states[vi]);
        // chain: hit → ... → sk.node ; родитель узла chain[t+1] — chain[t]
        for (let t = 0; t + 1 < chain.length; t++) {
          const a = chain[t];
          const b = chain[t + 1];
          if (!s.parent.has(b)) s.parent.set(b, a);
          owner[b] = s.idx;
          if (prevVia[a] === 1 || li(a) !== li(b)) {
            s.viaTo.add(b);
            const lo = li(a) < li(b) ? a : b;
            const hi = lo === a ? b : a;
            const l0 = li(lo);
            const lowEdge = NI(l0, ii(hi), jj(hi));
            const ek = edgeKey(lo, lowEdge);
            usedEdge.add(ek);
            netEdges[s.idx].push(ek);
            const shadow = NI(l0 + 1, ii(lo), jj(lo));
            owner[shadow] = SHADOW;
            netShadows[s.idx].push(shadow);
          } else {
            const ek = edgeKey(a, b);
            usedEdge.add(ek);
            netEdges[s.idx].push(ek);
          }
        }
        return { ok: true, victims };
      }
    };

    const queue: NetState[] = [...order];
    let ripTotal = 0;
    const RIP_BUDGET = states.length * 3;
    const routeNet = (s: NetState): void => {
      const root = termNode(s.srcEsc);
      s.parent.set(root, -1);
      const sinks = s.sinkEsc
        .map((e, k) => ({ node: termNode(e), k }))
        .sort((x, y) => Math.abs(ii(x.node) - ii(root)) + Math.abs(jj(x.node) - jj(root)) - (Math.abs(ii(y.node) - ii(root)) + Math.abs(jj(y.node) - jj(root))));
      for (const sk of sinks) {
        if (s.parent.has(sk.node)) continue;
        let r = routeSink(s, sk, false);
        if (!r.ok && ripTotal < RIP_BUDGET) {
          r = routeSink(s, sk, true);
          for (const vi of r.victims) {
            ripCount[vi]++;
            ripTotal++;
            queue.push(states[vi]);
          }
        }
        if (!r.ok) {
          const f = failedBy.get(s.idx) ?? [];
          f.push(`${s.net.name} → вывод ${sk.k}`);
          failedBy.set(s.idx, f);
          prio.set(s.idx, (prio.get(s.idx) ?? 0) + 1);
        }
      }
    };
    while (queue.length > 0) routeNet(queue.shift()!);
    // запас силы сигнала: в каждом узле силы должно хватать на самый требовательный приёмник ниже
    for (const s of states) {
      if (failedBy.has(s.idx)) continue;
      const { children, need } = treeInfo(s);
      let ok = true;
      const walk = (nd: number, strength: number): void => {
        if (strength < need(nd)) ok = false;
        for (const c of children.get(nd) ?? []) walk(c, s.viaTo.has(c) ? strength - 2 : strength <= 9 || strength - 2 < need(c) ? 15 : strength - 2);
      };
      walk(termNode(s.srcEsc), s.srcEsc.strength);
      if (!ok) {
        failedBy.set(s.idx, [`${s.net.name} (не хватает силы сигнала)`]);
        prio.set(s.idx, (prio.get(s.idx) ?? 0) + 1);
      }
    }
    const failed = [...failedBy.values()].flat();
    opts.progress?.(`  не проложено цепей: ${failed.length}${failed.length ? ` (${failed.slice(0, 4).join('; ')})` : ''}`);
    if (failed.length === 0) finalStates = order;
    else if (failed.length < bestFail.length || bestFail.length === 0) bestFail = failed;
    if (!finalStates && tries === attempts - 1) {
      throw new FloorError(`Не удалось проложить цепи: ${bestFail.slice(0, 6).join('; ')}${bestFail.length > 6 ? ` … (всего ${bestFail.length})` : ''}`, bestFail);
    }
  }
  if (!finalStates) throw new FloorError('Разводка не удалась', bestFail);

  // ───── запись проводов ─────
  let wireCells = 0;
  let repeaters = 0;
  let vias = 0;
  for (const s of finalStates) {
    v.owner = s.net.name;
    const { children, need } = treeInfo(s);
    const root = termNode(s.srcEsc);
    // выходы
    const emitEscape = (e: Escape): void => {
      for (const c of e.cells) {
        if (c.kind === 'rep') v.repeater(c.x, c.y, c.z, c.side!, 1);
        else v.dust(c.x, c.y, c.z);
      }
    };
    emitEscape(s.srcEsc);
    s.sinkEsc.forEach(emitEscape);
    const emitNode = (nd: number): void => {
      const x = nodeX(ii(nd));
      const z = nodeZ(jj(nd));
      v.dust(x, layerY(li(nd)), z);
      wireCells++;
    };
    const walk = (nd: number, strength: number): void => {
      emitNode(nd);
      for (const c of children.get(nd) ?? []) {
        const l = li(nd);
        const x0 = nodeX(ii(nd));
        const z0 = nodeZ(jj(nd));
        const x1 = nodeX(ii(c));
        const z1 = nodeZ(jj(c));
        if (s.viaTo.has(c)) {
          // рампа между слоями
          const lo = li(nd) < li(c) ? nd : c;
          const hi = lo === nd ? c : nd;
          const l0 = li(lo);
          const y0 = layerY(l0);
          const dx = Math.sign(nodeX(ii(hi)) - nodeX(ii(lo)));
          const dz = Math.sign(nodeZ(jj(hi)) - nodeZ(jj(lo)));
          const lx = nodeX(ii(lo));
          const lz = nodeZ(jj(lo));
          if (process.env.FLOOR_DEBUG) floorDebug.edges.push({ net: s.net.name, from: [x0, layerY(l), z0], to: [x1, layerY(li(c)), z1], kind: 'via', strength });
          v.solid(lx + dx, y0, lz + dz); // середина ребра нижнего слоя — опора рампы
          v.dust(lx + dx, y0 + 1, lz + dz);
          wireCells += 1;
          vias++;
          walk(c, strength - 2);
          continue;
        }
        const mx = (x0 + x1) / 2;
        const mz = (z0 + z1) / 2;
        const cs = need(c);
        const y = layerY(l);
        // повторитель на середине ребра: если сил почти не осталось или дальше не хватит
        let s2 = strength;
        if (strength <= 9 || strength - 2 < cs) {
          const dx = x1 - x0;
          const dz = z1 - z0;
          if (process.env.FLOOR_DEBUG) floorDebug.edges.push({ net: s.net.name, from: [x0, y, z0], to: [x1, y, z1], kind: 'rep', strength });
          v.repeater(mx, y, mz, SIDE(-Math.sign(dx), -Math.sign(dz)), 1);
          repeaters++;
          s2 = 15;
          wireCells++;
          walk(c, 15);
          continue;
        }
        if (process.env.FLOOR_DEBUG && v.get(mx, y, mz)) {
          process.stderr.write(`COLLIDE net=${s.net.name} cell=(${mx},${y},${mz}) existing owner=${v.ownerOf(mx, y, mz)} kind=${v.get(mx, y, mz)!.kind} nodes (${x0},${z0},l${l})->(${x1},${z1})\n`);
        }
        if (process.env.FLOOR_DEBUG) floorDebug.edges.push({ net: s.net.name, from: [x0, y, z0], to: [x1, y, z1], kind: 'flat', strength });
        v.dust(mx, y, mz);
        wireCells++;
        s2 = strength - 2;
        walk(c, s2);
      }
    };
    walk(root, s.srcEsc.strength);
  }
  v.owner = null;
  const nb = v.bounds();
  return {
    nets: nets.length,
    wireCells,
    repeaters,
    vias,
    attempts: tries,
    size: { x: nb.x1 - nb.x0 + 1, z: nb.z1 - nb.z0 + 1, y: nb.y1 - nb.y0 + 1 },
    ms: Math.round(performance.now() - t0),
  };
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
