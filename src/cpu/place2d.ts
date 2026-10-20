/**
 * Плотная двумерная расстановка карточек: отжиг по суммарной длине связей (полупериметр охватывающего прямоугольника цепи)
 * с штрафом за перекрытие «охранных» прямоугольников (карточка + поля под рампы выводов).
 */

export interface PlaceCard {
  name: string;
  /** Размеры охранного прямоугольника. */
  w: number;
  h: number;
  /** Положение выводов относительно левого верхнего угла прямоугольника. */
  pins: { x: number; z: number }[];
  /** Чётность, которой должны обладать X / Z положения прямоугольника (чтобы выводы попадали на сетку узлов). */
  parX?: 0 | 1;
  parZ?: 0 | 1;
}

export interface PlaceNet {
  pins: { card: number; pin: number }[];
}

export interface PlaceOptions {
  seed?: number;
  iterations?: number;
  /** Зазор между прямоугольниками. */
  gap?: number;
  /** Вес габаритов платы относительно длины связей (по умолчанию 1). */
  bboxWeight?: number;
  /** Подсказка про вес по осям (линии вдоль Z обычно дороже). */
  progress?: (msg: string) => void;
}

export interface PlaceResult {
  x: number[];
  z: number[];
  width: number;
  height: number;
  wire: number;
  overlap: number;
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

export function placeCards(cards: PlaceCard[], nets: PlaceNet[], opts: PlaceOptions = {}): PlaceResult {
  const n = cards.length;
  const gap = opts.gap ?? 1;
  const rnd = mulberry(opts.seed ?? 1);
  /** Подгоняет координату под нужную чётность (в большую сторону). */
  const fx = (i: number, x: number): number => (cards[i].parX === undefined ? x : x + ((((x - cards[i].parX!) % 2) + 2) % 2));
  const fz = (i: number, z: number): number => (cards[i].parZ === undefined ? z : z + ((((z - cards[i].parZ!) % 2) + 2) % 2));
  const X = new Array<number>(n).fill(0);
  const Z = new Array<number>(n).fill(0);
  // начальная расстановка полками по убыванию площади
  const order = cards.map((_, i) => i).sort((a, b) => cards[b].w * cards[b].h - cards[a].w * cards[a].h);
  const totalArea = cards.reduce((a, c) => a + (c.w + gap) * (c.h + gap), 0);
  const target = Math.ceil(Math.sqrt(totalArea * 1.25));
  {
    let cx = 0;
    let cz = 0;
    let rowH = 0;
    for (const i of order) {
      if (cx + cards[i].w > target && cx > 0) {
        cx = 0;
        cz += rowH + gap;
        rowH = 0;
      }
      X[i] = fx(i, cx);
      Z[i] = fz(i, cz);
      cx = X[i] + cards[i].w + gap;
      rowH = Math.max(rowH, cards[i].h);
    }
  }
  // цепи по карточкам
  const netsOf: number[][] = Array.from({ length: n }, () => []);
  nets.forEach((net, k) => {
    for (const p of net.pins) if (!netsOf[p.card].includes(k)) netsOf[p.card].push(k);
  });
  const hp = (k: number): number => {
    const pins = nets[k].pins;
    if (pins.length < 2) return 0;
    let x0 = Infinity,
      x1 = -Infinity,
      z0 = Infinity,
      z1 = -Infinity;
    for (const p of pins) {
      const x = X[p.card] + cards[p.card].pins[p.pin].x;
      const z = Z[p.card] + cards[p.card].pins[p.pin].z;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (z < z0) z0 = z;
      if (z > z1) z1 = z;
    }
    return x1 - x0 + 1.15 * (z1 - z0);
  };
  const netCost = nets.map((_, k) => hp(k));
  const ovl = (i: number, j: number): number => {
    const ox = Math.min(X[i] + cards[i].w + gap, X[j] + cards[j].w + gap) - Math.max(X[i], X[j]);
    const oz = Math.min(Z[i] + cards[i].h + gap, Z[j] + cards[j].h + gap) - Math.max(Z[i], Z[j]);
    return ox > 0 && oz > 0 ? ox * oz : 0;
  };
  const ovlOf = (i: number): number => {
    let s = 0;
    for (let j = 0; j < n; j++) if (j !== i) s += ovl(i, j);
    return s;
  };
  const bboxCost = (): number => {
    let x1 = 0;
    let z1 = 0;
    for (let i = 0; i < n; i++) {
      x1 = Math.max(x1, X[i] + cards[i].w);
      z1 = Math.max(z1, Z[i] + cards[i].h);
    }
    return x1 + z1;
  };
  const iters = opts.iterations ?? Math.max(60000, n * 2500);
  let wire = netCost.reduce((a, b) => a + b, 0);
  let bbox = bboxCost();
  const w0 = Math.max(1, wire / Math.max(1, nets.length));
  const T0 = w0 * 0.6;
  const T1 = 0.15;
  const maxR = Math.max(60, target * 0.6);
  return anneal();

  function anneal(): PlaceResult {
    const ITER = iters;
    for (let it = 0; it < ITER; it++) {
      const frac = it / ITER;
      const T = T0 * Math.pow(T1 / T0, frac);
      const ow = 0.5 + 40 * frac;
      const bw = (opts.bboxWeight ?? 1) * 0.6 * (0.3 + frac);
      const i = Math.floor(rnd() * n);
      const sw = rnd() < 0.25 ? Math.floor(rnd() * n) : -1;
      const j = sw >= 0 && sw !== i ? sw : -1;
      const ax = X[i];
      const az = Z[i];
      const bx = j >= 0 ? X[j] : 0;
      const bz = j >= 0 ? Z[j] : 0;
      let nx: number;
      let nz: number;
      if (j >= 0) {
        nx = fx(i, bx);
        nz = fz(i, bz);
      } else {
        const r = Math.max(2, maxR * (1 - frac) * (0.2 + 0.8 * rnd()));
        nx = fx(i, Math.max(0, Math.round(ax + (rnd() * 2 - 1) * r)));
        nz = fz(i, Math.max(0, Math.round(az + (rnd() * 2 - 1) * r)));
      }
      const touched = new Set<number>(netsOf[i]);
      if (j >= 0) for (const k of netsOf[j]) touched.add(k);
      const ovBefore = ovlOf(i) + (j >= 0 ? ovlOf(j) - ovl(i, j) : 0);
      let wireBefore = 0;
      for (const k of touched) wireBefore += netCost[k];
      const bboxBefore = bbox;
      // применяем
      X[i] = nx;
      Z[i] = nz;
      if (j >= 0) {
        X[j] = fx(j, ax);
        Z[j] = fz(j, az);
      }
      let wireAfter = 0;
      const nc = new Map<number, number>();
      for (const k of touched) {
        const c = hp(k);
        nc.set(k, c);
        wireAfter += c;
      }
      const ovAfter = ovlOf(i) + (j >= 0 ? ovlOf(j) - ovl(i, j) : 0);
      const bboxAfter = bboxCost();
      const dCost = wireAfter - wireBefore + ow * (ovAfter - ovBefore) / 20 + bw * (bboxAfter - bboxBefore);
      if (dCost <= 0 || rnd() < Math.exp(-dCost / T)) {
        for (const [k, c] of nc) netCost[k] = c;
        wire += wireAfter - wireBefore;
        bbox = bboxAfter;
      } else {
        X[i] = ax;
        Z[i] = az;
        if (j >= 0) {
          X[j] = bx;
          Z[j] = bz;
        }
      }
    }
    legalize();
    compact();
    // сдвиг к началу координат
    let mx = Infinity;
    let mz = Infinity;
    for (let i = 0; i < n; i++) {
      mx = Math.min(mx, X[i]);
      mz = Math.min(mz, Z[i]);
    }
    mx -= mx % 2;
    mz -= mz % 2;
    let w = 0;
    let h = 0;
    for (let i = 0; i < n; i++) {
      X[i] -= mx;
      Z[i] -= mz;
      w = Math.max(w, X[i] + cards[i].w);
      h = Math.max(h, Z[i] + cards[i].h);
    }
    let ov = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) ov += ovl(i, j);
    return { x: [...X], z: [...Z], width: w, height: h, wire: nets.reduce((a, _, k) => a + hp(k), 0), overlap: ov };
  }

  /** Сдвигает карточки к началу координат, пока это возможно без перекрытий (поочерёдно по осям). */
  function compact(): void {
    const stepX = (i: number): number => (cards[i].parX === undefined ? 1 : 2);
    const stepZ = (i: number): number => (cards[i].parZ === undefined ? 1 : 2);
    for (let pass = 0; pass < 40; pass++) {
      let moved = false;
      const byX = cards.map((_, i) => i).sort((a, b) => X[a] - X[b]);
      for (const i of byX) {
        while (X[i] - stepX(i) >= 0) {
          X[i] -= stepX(i);
          if (ovlOf(i) > 0) {
            X[i] += stepX(i);
            break;
          }
          moved = true;
        }
      }
      const byZ = cards.map((_, i) => i).sort((a, b) => Z[a] - Z[b]);
      for (const i of byZ) {
        while (Z[i] - stepZ(i) >= 0) {
          Z[i] -= stepZ(i);
          if (ovlOf(i) > 0) {
            Z[i] += stepZ(i);
            break;
          }
          moved = true;
        }
      }
      if (!moved) break;
    }
  }

  /** Устраняет остаточные перекрытия: карточка переносится на ближайшее свободное место. */
  function legalize(): void {
    for (let pass = 0; pass < 6; pass++) {
      let moved = false;
      for (let i = 0; i < n; i++) {
        if (ovlOf(i) === 0) continue;
        const ox = X[i];
        const oz = Z[i];
        let best: { x: number; z: number; cost: number } | null = null;
        const R = 400;
        for (let r = 1; r <= R && !best; r += 2) {
          for (let dxs = -r; dxs <= r; dxs += Math.max(1, Math.floor(r / 6))) {
            for (const dz of [-r, r]) tryAt(ox + dxs, oz + dz);
          }
          for (let dzs = -r; dzs <= r; dzs += Math.max(1, Math.floor(r / 6))) {
            for (const dx of [-r, r]) tryAt(ox + dx, oz + dzs);
          }
        }
        function tryAt(x: number, z: number): void {
          if (x < 0 || z < 0) return;
          X[i] = fx(i, x);
          Z[i] = fz(i, z);
          if (ovlOf(i) === 0) {
            let c = 0;
            for (const k of netsOf[i]) c += hp(k);
            if (!best || c < best.cost) best = { x, z, cost: c };
          }
        }
        if (best) {
          X[i] = fx(i, (best as { x: number }).x);
          Z[i] = fz(i, (best as { z: number }).z);
          moved = true;
        } else {
          X[i] = ox;
          Z[i] = oz;
        }
      }
      if (!moved) break;
    }
  }
}
