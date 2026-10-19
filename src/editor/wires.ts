import { Circuit, GRID, Point } from '../model/types';
import { gateById, inputPinPos, outputPinPos, snap, wirePath } from '../model/circuit';

export interface WireLayout {
  paths: Map<string, Point[]>;
  /** Точки ответвлений («узлы») на общих магистралях. */
  dots: Point[];
}

/**
 * Укладывает провода: все «прямые» провода одного источника идут по общей вертикальной магистрали,
 * в точках ответвления рисуются узлы — как на схеме-образце.
 */
export function layoutWires(c: Circuit): WireLayout {
  const gm = gateById(c);
  const paths = new Map<string, Point[]>();
  const dots: Point[] = [];
  const bySource = new Map<string, typeof c.wires>();
  for (const w of c.wires) {
    const arr = bySource.get(w.from);
    if (arr) arr.push(w);
    else bySource.set(w.from, [w]);
  }
  // 1) для каждого источника — «прямые» провода и диапазон магистрали
  interface Group {
    src: string;
    a: Point;
    ends: { w: (typeof c.wires)[number]; b: Point | null }[];
    forward: { w: (typeof c.wires)[number]; b: Point | null }[];
    lo: number;
    hi: number;
    base: number;
    minB: number;
  }
  const groups: Group[] = [];
  for (const [src, wires] of bySource) {
    const sg = gm.get(src);
    if (!sg) continue;
    const a = outputPinPos(sg);
    const ends = wires.map((w) => {
      const tg = gm.get(w.to);
      return { w, b: tg ? inputPinPos(tg, w.toPin) : null };
    });
    const forward = ends.filter((e) => e.b && e.w.midX === undefined && e.b.x - a.x >= GRID * 2);
    let base = a.x + GRID;
    let minB = a.x + GRID * 2;
    let lo = a.y;
    let hi = a.y;
    if (forward.length > 0) {
      const minSpan = Math.min(...forward.map((e) => e.b!.x - a.x));
      minB = Math.min(...forward.map((e) => e.b!.x));
      base = Math.min(a.x + Math.max(GRID, snap(minSpan / 2)), minB - GRID);
      for (const e of forward) {
        lo = Math.min(lo, e.b!.y);
        hi = Math.max(hi, e.b!.y);
      }
    }
    groups.push({ src, a, ends, forward, lo, hi, base, minB });
  }

  // 2) разводим магистрали разных источников по разным X, чтобы линии не сливались
  groups.sort((p, q) => p.a.x - q.a.x || p.a.y - q.a.y);
  const placed: { x: number; lo: number; hi: number }[] = [];
  const trunkOf = new Map<string, number>();
  for (const g of groups) {
    if (g.forward.length === 0) {
      trunkOf.set(g.src, g.base);
      continue;
    }
    const minX = g.a.x + GRID;
    const maxX = g.minB - GRID;
    const clash = (x: number): boolean => placed.some((p) => p.x === x && p.lo - 4 <= g.hi && g.lo - 4 <= p.hi);
    let chosen = g.base;
    if (clash(chosen)) {
      for (let k = 1; k < 12; k++) {
        const cands = [g.base + k * GRID, g.base - k * GRID];
        const ok = cands.find((x) => x >= minX && x <= maxX && !clash(x));
        if (ok !== undefined) {
          chosen = ok;
          break;
        }
      }
    }
    trunkOf.set(g.src, chosen);
    placed.push({ x: chosen, lo: g.lo, hi: g.hi });
  }

  // 3) пути и узлы
  for (const g of groups) {
    const { a, ends, forward } = g;
    const trunk = trunkOf.get(g.src)!;
    for (const e of ends) {
      if (!e.b) continue;
      if (e.w.midX === undefined && e.b.x - a.x >= GRID * 2) {
        const pts: Point[] = [a];
        if (e.b.y === a.y && forward.length === 1) pts.push(e.b);
        else pts.push({ x: trunk, y: a.y }, { x: trunk, y: e.b.y }, e.b);
        paths.set(e.w.id, dedupe(pts));
      } else {
        paths.set(e.w.id, wirePath(a, e.b, e.w.midX));
      }
    }
    if (forward.length >= 2) {
      const ys = new Set<number>([a.y, ...forward.map((e) => e.b!.y)]);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const branchYs = new Set(forward.map((e) => e.b!.y));
      for (const y of ys) {
        let degree = 0;
        if (y > minY) degree++;
        if (y < maxY) degree++;
        if (branchYs.has(y)) degree++;
        if (y === a.y) degree++;
        if (degree >= 3) dots.push({ x: trunk, y });
      }
    }
  }
  return { paths, dots };
}

function dedupe(pts: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || last.x !== p.x || last.y !== p.y) out.push(p);
  }
  return out;
}

export function pathToD(pts: Point[]): string {
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
}
