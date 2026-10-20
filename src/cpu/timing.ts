import { Built, BuildSettings, buildComputer } from './computer';
import { Plan } from './plan';
import { TickSim } from './tick';
import { K } from '../compiler/voxel';

/** Результат замера фаз замков триггеров на готовой плате (игровые тики, 1 тик редстоуна = 2). */
export interface LockTiming {
  /** CLK 1→0: запас между запиранием самого позднего ведомого и отпиранием самого раннего ведущего (по каждой карточке — минимум). */
  fall: number;
  /** CLK 0→1: запас между запиранием самого позднего ведущего и отпиранием самого раннего ведомого. */
  rise: number;
  /** Когда сигналы замков достигают самой дальней карточки после смены CLK. */
  settle: number;
  /** Сколько триггеров удалось измерить / всего. */
  measured: number;
  total: number;
}

/** Минимальный запас между фазами (игровые тики): с него начинается надёжная работа. */
export const MIN_LOCK_MARGIN = 40;

/**
 * Рекомендуемая длина каждой фазы такта (игровые тики). Замки доходят до самой дальней карточки за settle, но главное — данные
 * (счётчик → ПЗУ → шина → файл регистров/АЛУ → флаги → ведущие триггеры) должны успеть установиться за такт. Замер на готовых платах
 * показал: данные устанавливаются за ≈ 2,3–3,5 × settle (на плате регистровой машины с settle = 926 последним меняется вход флага C
 * через 3280 тиков после фронта, поэтому фазы по 1400 не хватило, а 3000 хватило; на аккумуляторной с settle = 778 безотказны фазы от 1000).
 * Берётся запас: 2,2 × settle + 300.
 */
export function recommendedHalfPeriod(t: LockTiming): number {
  return Math.ceil((2.2 * t.settle + 300) / 50) * 50;
}

/**
 * Замеряет в покадровом симуляторе, насколько вовремя доходят замки до триггеров. В сбросе замки всех ведущих меняются на каждом такте,
 * поэтому замер не зависит от программы. Работа триггера «ведущий-ведомый» корректна, если ведомый успевает закрыться до того, как откроется
 * ведущий (и наоборот), — на каждой карточке и между разными карточками.
 */
export function measureLockTiming(built: Built, sim: TickSim = new TickSim(built.vox), broken?: Set<string>): LockTiming {
  const pr = built.probes;
  if (!pr.clk) throw new Error('Замер замков требует рычага CLK (выберите тактирование «рычаг»)');
  sim.settle(100000);
  sim.setLever(...pr.reset, true);
  sim.run(1200);
  const pins: { id: string; x: number; z: number; kind: 'S' | 'M' }[] = [];
  for (const [name, c] of built.cards) {
    if (!name.startsWith('ff')) continue;
    const s = c.west.lkS;
    const m = c.west.lkM;
    if (s) pins.push({ id: name, x: s.x, z: s.z, kind: 'S' });
    if (m) pins.push({ id: name, x: m.x, z: m.z, kind: 'M' });
  }
  const on = (p: { x: number; z: number }): boolean => sim.powerAt(p.x, 1, p.z) > 0;
  /** Переключает CLK и возвращает момент первой смены каждого вывода. */
  const edge = (high: boolean, span: number): Map<(typeof pins)[number], number> => {
    sim.setLever(...pr.clk!, high);
    const t0 = new Map<(typeof pins)[number], boolean>();
    for (const p of pins) t0.set(p, on(p));
    const at = new Map<(typeof pins)[number], number>();
    for (let t = 1; t <= span; t++) {
      sim.run(1);
      for (const p of pins) if (!at.has(p) && on(p) !== t0.get(p)) at.set(p, t);
    }
    return at;
  };
  sim.setLever(...pr.clk, true);
  sim.run(2500);
  const fall = edge(false, 1500);
  sim.run(1000);
  if (broken) for (const n of brokenNets(built, sim)) broken.add(n);
  const rise = edge(true, 1500);
  sim.run(1000);
  if (broken) for (const n of brokenNets(built, sim)) broken.add(n);
  const timeOf = (m: Map<(typeof pins)[number], number>, kind: 'S' | 'M'): Map<string, number> => {
    const r = new Map<string, number>();
    for (const [p, t] of m) if (p.kind === kind) r.set(p.id, t);
    return r;
  };
  const sFall = timeOf(fall, 'S');
  const mFall = timeOf(fall, 'M');
  const sRise = timeOf(rise, 'S');
  const mRise = timeOf(rise, 'M');
  // CLK ↓: каждая карточка — своя пара (ведомый заперт раньше, чем отперт ведущий)
  let fallMargin = Infinity;
  for (const [id, tm] of mFall) {
    const ts = sFall.get(id);
    if (ts !== undefined) fallMargin = Math.min(fallMargin, tm - ts);
  }
  // CLK ↑: ведомый любой карточки меняет выходы, которые видят ведущие всех карточек, поэтому сравниваем с самым поздним ведущим
  const lastMasterLock = Math.max(-Infinity, ...mRise.values());
  const firstSlaveOpen = Math.min(Infinity, ...sRise.values());
  const riseMargin = firstSlaveOpen - lastMasterLock;
  const times = [...fall.values(), ...rise.values()];
  const total = new Set(pins.map((p) => p.id)).size;
  return {
    fall: Number.isFinite(fallMargin) ? fallMargin : -Infinity,
    rise: Number.isFinite(riseMargin) ? riseMargin : -Infinity,
    settle: times.length ? Math.max(...times) : 0,
    measured: Math.min(sFall.size, mFall.size, sRise.size, mRise.size),
    total,
  };
}

/**
 * Самопроверка проводки: все клетки пыли одной цепи в установившемся состоянии должны быть либо под напряжением, либо нет.
 * Цепь, у которой часть пыли горит, а часть нет, — разрыв (или чужое касание) в разводке. Возвращает имена таких цепей.
 */
export function brokenNets(built: Built, sim: TickSim): string[] {
  const v = built.vox;
  const stat = new Map<string, { on: number; off: number }>();
  v.forEach((x, y, z, c) => {
    const o = v.ownerOf(x, y, z);
    if (!o || c.kind !== K.Dust) return;
    const e = stat.get(o) ?? { on: 0, off: 0 };
    if (sim.powerAt(x, y, z) > 0) e.on++;
    else e.off++;
    stat.set(o, e);
  });
  return [...stat].filter(([, e]) => e.on > 0 && e.off > 0).map(([n]) => n);
}

export interface TimedBuild {
  built: Built;
  timing: LockTiming;
  /** Фактический зазор между фазами (тики редстоуна) после подбора. */
  guardRt: number;
  /** Рекомендуемая длина фазы такта (игровые тики) — столько держать CLK в каждом состоянии. */
  halfPeriod: number;
  /** Сколько раз пришлось пересобирать плату. */
  passes: number;
}

/**
 * Собирает плату и подбирает зазор между фазами замков по замеру: пока запас меньше MIN_LOCK_MARGIN, зазор увеличивается и плата строится заново.
 * Для автогенератора замер делается на копии платы с рычагом CLK (раскладка отличается только карточкой генератора).
 */
export function buildTimed(plan: Plan, st: BuildSettings, progress: (msg: string) => void = () => {}): TimedBuild {
  let guardRt = st.guardRt;
  for (let passes = 1; ; passes++) {
    const probe = buildComputer(plan, { ...st, guardRt, clock: 'lever' }, progress);
    progress('Замер фаз замков…');
    const broken = new Set<string>();
    const timing = measureLockTiming(probe, new TickSim(probe.vox), broken);
    if (broken.size > 0 && st.layout !== 'stack') {
      progress(`Самопроверка проводки: разрыв в цепях ${[...broken].slice(0, 6).join(', ')} — строю раскладку колонкой`);
      return buildTimed(plan, { ...st, layout: 'stack' }, progress);
    }
    const worst = Math.min(timing.fall, timing.rise);
    if (!Number.isFinite(worst)) throw new Error('Замер фаз замков не удался: замки не меняются при переключении CLK (разрыв в тактовой цепи)');
    if (worst >= MIN_LOCK_MARGIN || passes >= 4) {
      const halfPeriod = recommendedHalfPeriod(timing);
      const clockHalfTicks = st.clockHalfTicks > 0 ? st.clockHalfTicks : halfPeriod;
      const built = st.clock === 'lever' ? probe : buildComputer(plan, { ...st, guardRt, clockHalfTicks }, progress);
      return { built, timing, guardRt, halfPeriod, passes };
    }
    guardRt += Math.max(2, Math.ceil((MIN_LOCK_MARGIN - worst) / 2) + 2);
    progress(`Запас фаз ${worst} тиков — увеличиваю зазор до ${guardRt}…`);
  }
}
