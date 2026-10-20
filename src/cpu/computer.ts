import { ExportSettings } from '../compiler/compile';
import { buildRom, EXT } from './arrays';
import { buildData, DataLayout } from './dataarray';
import { Bus, BusNet, BusPin } from './bus';
import { Card, arrayFeeder, clockCard, ffCard, lampCard, leverCard, placeMacro } from './cards';
import { Macro, macroSettings } from './macro';
import { getMacro } from './macrolib';
import { JUMP_CTLS, aluANetlist, aluMuxNetlist, ctlNetlist, flagsNetlist, muxTerms, pcSliceNetlist, takeNetlist } from './hwnets';
import { CtlName } from './micro';
import { Plan } from './plan';
import { Vox } from './vox';

type XYZ = [number, number, number];

export type ClockKind = 'lever' | 'auto';

export interface BuildSettings {
  /** Матрица ПЗУ: полная (бочки во всех клетках, можно перепрошивать) или только единицы. */
  romFull: boolean;
  /** Настройки компилятора для блоков логики (варианты вентилей, материалы, рычаги/кнопки). */
  macro: ExportSettings;
  /** Лампы-индикаторы счётчика команд, аккумулятора и флагов. */
  indicators: boolean;
  /** Лампы на портах вывода. */
  portLamps: boolean;
  /** Тактирование: рычаг (вручную) или автоматический генератор. */
  clock: ClockKind;
  /** Для автогенератора: полупериод в игровых тиках (округляется вверх до числа повторителей кольца); 0 — подобрать по замеру (buildTimed) или 800. */
  clockHalfTicks: number;
  /** Зазор между фазами замков триггеров, тики редстоуна (должен превышать разброс длин проводов). */
  guardRt: number;
}

export function defaultBuildSettings(): BuildSettings {
  return { romFull: false, macro: macroSettings(), indicators: true, portLamps: true, clock: 'lever', clockHalfTicks: 0, guardRt: 60 };
}

export interface Probes {
  clk: XYZ | null;
  reset: XYZ;
  /** Рычаг «стоп» автогенератора (включён → такта нет). */
  clockStop: XYZ | null;
  pc: XYZ[];
  a: XYZ[];
  flags: Partial<Record<'Z' | 'C' | 'N' | 'V', XYZ>>;
  /** Ячейки данных: имя слова → повторители битов (младший первым). */
  ram: Map<string, XYZ[]>;
  inputs: { port: string; bit: number; pos: XYZ }[];
  lamps: { port: string; bit: number; pos: XYZ }[];
}

export interface BuildStats {
  nets: number;
  wraps: number;
  macros: { name: string; gates: number; ms: number; size: string }[];
  ms: number;
  size: { x: number; y: number; z: number };
  blocks: number;
}

export interface Built {
  vox: Vox;
  probes: Probes;
  stats: BuildStats;
  labels: { name: string; pos: XYZ }[];
  /** Карточки платы (для отладки и интерфейса). */
  cards: Map<string, Card>;
  /** Области платы (ПЗУ, карточки) в координатах Vox — для документации. */
  regions: { name: string; x0: number; x1: number; z0: number; z1: number }[];
}

interface CardPlan {
  name: string;
  /** Размеры отведённого прямоугольника (с запасом). */
  w: number;
  h: number;
  /** Ставит карточку с левым верхним углом прямоугольника в (x0, z0). */
  place: (x0: number, z0: number) => Card;
}

type NetSrc = { card: string; side: 'east' | 'west'; pin: string } | { rail: number };

/**
 * Собирает физический компьютер: ПЗУ сверху, под ним «стопка» карточек (блоки логики, триггеры, ОЗУ), а соединения прокладывает
 * детерминированная шина (bus.ts) — без поиска пути.
 */
export function buildComputer(plan: Plan, st: BuildSettings = defaultBuildSettings(), progress: (msg: string) => void = () => {}): Built {
  if (!plan.ok) throw new Error('План постройки содержит ошибки');
  const t0 = performance.now();
  const f = plan.feat;
  const { D, P, RA } = f;
  const used = f.used;
  const has = (n: CtlName): boolean => used.has(n);
  const hasTake = JUMP_CTLS.some((j) => has(j));
  const macroInfo: BuildStats['macros'] = [];
  const macro = (name: string, text: string): Macro => {
    progress(`Блок «${name}»…`);
    const m = getMacro(text, st.macro);
    macroInfo.push({ name, gates: m.stats.gates, ms: m.stats.ms, size: `${m.size.sx}×${m.size.sz}` });
    return m;
  };
  const mCtl = macro('такты и замки', ctlNetlist(st.guardRt));
  const mPc0 = macro('разряд счётчика (младший)', pcSliceNetlist(hasTake, true));
  const mPc = P > 1 ? macro('разряд счётчика', pcSliceNetlist(hasTake, false)) : mPc0;
  const mTake = hasTake ? macro('условия переходов', takeNetlist(f)) : null;
  const mAluA = plan.hasAlu ? macro('АЛУ: сумматор', aluANetlist(f)) : null;
  const mMux = plan.hasAlu ? macro('АЛУ: выбор результата', aluMuxNetlist(f)) : null;
  const mFlags = plan.hasAlu && f.flags.length > 0 ? macro('флаги', flagsNetlist(f)) : null;
  progress('Раскладка платы…');

  const v = new Vox();

  // ───── ПЗУ (размеры; сама матрица ставится после расчёта столбцов шины) ─────
  const rows = plan.rows.length;
  const cols = plan.columns.length;
  const romOpts = { P, rows, cols, bit: (r: number, c: number) => plan.columns[c].bit(r), full: st.romFull };
  const dryRom = buildRom(new Vox(), 0, 0, romOpts);
  const romW = dryRom.bounds.x1 - dryRom.bounds.x0 + 1;

  const hasData = plan.hasData && plan.dataRows.length > 0;
  const dryData = hasData ? buildData(new Vox(), 0, 0, { RA, D, rows: plan.dataRows, lamps: st.portLamps }) : null;

  // ───── соединения: сначала считаем столбцы и строки шины (они не зависят от геометрии карточек) ─────
  type Forced = { out: number } | { addr: number };
  const netSpecs: { name: string; src: NetSrc; sinks: { card: string; pin: string }[]; forced?: Forced; zTop?: boolean }[] = [];
  const net = (name: string, src: NetSrc, forced?: Forced, zTop?: boolean) => {
    const n: (typeof netSpecs)[number] = { name, src, sinks: [], forced, zTop };
    netSpecs.push(n);
    return (card: string, pin: string): void => {
      n.sinks.push({ card, pin });
    };
  };

  // рельсы ПЗУ
  plan.columns.forEach((c, j) => {
    const add = net(`rom_${c.name}`, { rail: j }, { out: j });
    const m = /^ob(\d+)$/.exec(c.name);
    if (m) {
      const k = Number(m[1]);
      if (hasTake && k < P) add(`pcs${k}`, 'ob');
      if (k < D && plan.hasAlu) add(`aluA${k}`, 'ob');
      if (hasData && k < RA) add('data', `addr${k}`);
    } else {
      const ctl = c.name as CtlName;
      if (['uImm', 'uMem', 'sub'].includes(ctl)) for (let i = 0; i < D; i++) add(`aluA${i}`, ctl);
      if (ctl === 'k1') add('aluA0', 'k1');
      if (ctl === 'sub') add('aluA0', 'cin');
      if (['eSum', 'eAnd', 'eOr', 'eXor', 'eNot', 'eShl', 'eShr', 'eB'].includes(ctl)) for (let i = 0; i < D; i++) add(`mux${i}`, ctl);
      if (['eSum', 'eShl', 'eShr', 'sub'].includes(ctl)) add('flags', ctl);
      if (JUMP_CTLS.includes(ctl)) add('take', ctl);
      if (['weM', 'halt', 'nweA', 'nweF'].includes(ctl)) add('ctl', ctl);
    }
  });
  // счётчик команд
  for (let i = 0; i < P; i++) {
    const add = net(`pc${i}`, { card: `ffP${i}`, side: 'west', pin: 'Q' }, { addr: i }, true);
    add(`pcs${i}`, 'pc');
    if (st.indicators) add(`lampPc${i}`, 'in');
    net(`d${i}`, { card: `pcs${i}`, side: 'east', pin: 'd' })(`ffP${i}`, 'D');
    if (i > 0) net(`pcc${i}`, { card: `pcs${i - 1}`, side: 'east', pin: 'co' })(`pcs${i}`, 'c');
  }
  if (hasTake) {
    const t = net('take', { card: 'take', side: 'east', pin: 'take' });
    const nt = net('ntake', { card: 'take', side: 'east', pin: 'ntake' });
    for (let i = 0; i < P; i++) {
      t(`pcs${i}`, 'take');
      nt(`pcs${i}`, 'ntake');
    }
  }
  for (const fl of f.flags) {
    const add = net(`flag${fl}`, { card: `ffF${fl}`, side: 'west', pin: 'Q' });
    if (hasTake) add('take', `f${fl.toLowerCase()}`);
    if (st.indicators) add(`lampF${fl}`, 'in');
  }
  // замки и сброс
  const lkS = net('lkS', { card: 'ctl', side: 'east', pin: 'lkS' });
  const lkMP = net('lkMP', { card: 'ctl', side: 'east', pin: 'lkMP' });
  const nreset = net('nreset', { card: 'ctl', side: 'east', pin: 'nreset' });
  for (let i = 0; i < P; i++) {
    lkS(`ffP${i}`, 'lkS');
    lkMP(`ffP${i}`, 'lkM');
    nreset(`pcs${i}`, 'nreset');
  }
  if (plan.hasAlu) for (let i = 0; i < D; i++) nreset(`mux${i}`, 'nreset');
  if (plan.hasAlu && f.flags.length) nreset('flags', 'nreset');
  if (plan.hasAlu) {
    const lkMA = net('lkMA', { card: 'ctl', side: 'east', pin: 'lkMA' });
    for (let i = 0; i < D; i++) {
      lkS(`ffA${i}`, 'lkS');
      lkMA(`ffA${i}`, 'lkM');
    }
  }
  if (f.flags.length) {
    const lkMF = net('lkMF', { card: 'ctl', side: 'east', pin: 'lkMF' });
    for (const fl of f.flags) {
      lkS(`ffF${fl}`, 'lkS');
      lkMF(`ffF${fl}`, 'lkM');
    }
  }
  if (hasData) net('nwm', { card: 'ctl', side: 'east', pin: 'nwm' })('data', 'nwm');
  net('clk', { card: 'clock', side: 'east', pin: 'out' })('ctl', 'clk');
  net('reset', { card: 'resetLever', side: 'east', pin: 'out' })('ctl', 'reset');

  // тракт данных
  if (plan.hasAlu) {
    const hasNot = muxTerms(f).some((t) => t.ctl === 'eNot');
    for (let i = 0; i < D; i++) {
      const a = net(`a${i}`, { card: `ffA${i}`, side: 'west', pin: 'Q' });
      a(`aluA${i}`, 'a');
      if (hasNot) a(`mux${i}`, 'a');
      if (has('eShr') && i >= 1) a(`mux${i - 1}`, 'an');
      if (has('eShl') && i + 1 < D) a(`mux${i + 1}`, 'ap');
      if (hasData) a('data', `wbl${i}`);
      if (mFlags && i === D - 1) a('flags', 'am');
      if (mFlags && i === 0) a('flags', 'a0');
      if (st.indicators) a(`lampA${i}`, 'in');
      const r = net(`r${i}`, { card: `mux${i}`, side: 'east', pin: 'r' });
      r(`ffA${i}`, 'D');
      if (mFlags && f.flags.includes('Z')) r('flags', `r${i}`);
      if (f.flags.includes('N') && i === D - 1) r('ffFN', 'D');
      for (const o of ['bx', 'p', 'g', 'o', 's']) net(`${o}${i}`, { card: `aluA${i}`, side: 'east', pin: o })(`mux${i}`, o);
      if (has('uMem') && hasData) net(`mem${i}`, { card: 'data', side: 'west', pin: `rbl${i}` })(`aluA${i}`, 'mem');
      if (has('eSum')) {
        const co = net(`co${i}`, { card: `aluA${i}`, side: 'east', pin: 'co' });
        if (i + 1 < D) co(`aluA${i + 1}`, 'cin');
        if (mFlags && i === D - 2) co('flags', 'cm');
        if (mFlags && i === D - 1) co('flags', 'co');
      }
    }
    if (mFlags) {
      for (const [out, fl] of [['z', 'Z'], ['cn', 'C'], ['vn', 'V']] as const) {
        if (f.flags.includes(fl)) net(`fl_${out}`, { card: 'flags', side: 'east', pin: out })(`ffF${fl}`, 'D');
      }
    }
  }

  // ───── карточки (план) ─────
  const plans: CardPlan[] = [];
  const cardMap = new Map<string, Card>();
  const addPlan = (p: CardPlan): void => void plans.push(p);
  const macroPlan = (name: string, m: Macro): void =>
    addPlan({ name, w: m.size.sx + 10, h: m.size.sz + 4, place: (x0, z0) => placeMacro(v, name, m, x0 + 5, z0 + 2) });
  const ffPlan = (name: string): void => addPlan({ name, w: 12, h: 10, place: (x0, z0) => ffCard(v, name, x0 + 7, z0 + 5) });
  const lampPlan = (name: string): void => addPlan({ name, w: 6, h: 4, place: (x0, z0) => lampCard(v, name, x0 + 3, z0 + 2) });
  let clockInfo: { stop: XYZ; half: number } | null = null;
  let clkLever: XYZ | null = null;
  let resetLever: XYZ | null = null;
  if (st.clock === 'auto') {
    const delay = 4;
    const n = Math.max(2, Math.ceil(((st.clockHalfTicks > 0 ? st.clockHalfTicks : 800) / 2 - 1) / delay / 2));
    addPlan({
      name: 'clock',
      w: n + 14,
      h: 12,
      place: (x0, z0) => {
        const c = clockCard(v, 'clock', x0 + 3, z0 + 5, n, delay);
        clockInfo = { stop: c.stop, half: c.half };
        return c;
      },
    });
  } else {
    addPlan({
      name: 'clock',
      w: 6,
      h: 4,
      place: (x0, z0) => {
        const c = leverCard(v, 'clock', x0 + 2, z0 + 2, 'clk');
        clkLever = c.lever;
        return c;
      },
    });
  }
  addPlan({
    name: 'resetLever',
    w: 6,
    h: 4,
    place: (x0, z0) => {
      const c = leverCard(v, 'resetLever', x0 + 2, z0 + 2, 'reset');
      resetLever = c.lever;
      return c;
    },
  });
  macroPlan('ctl', mCtl);
  if (mTake) macroPlan('take', mTake);
  for (let i = 0; i < P; i++) {
    macroPlan(`pcs${i}`, i === 0 ? mPc0 : mPc);
    ffPlan(`ffP${i}`);
  }
  let dataLayout: DataLayout | undefined;
  if (hasData && dryData) {
    const topRows = (RA + 1) * 3 + 6;
    const botRows = 2 * D * 3 + 6;
    const w = dryData.bounds.x1 - dryData.bounds.x0 + 14;
    const h = topRows + (dryData.bounds.z1 - dryData.bounds.z0 + 1 + 2 * EXT) + botRows + 4;
    addPlan({
      name: 'data',
      w,
      h,
      place: (x0, z0) => {
        const ox = x0 + 8;
        const oz = z0 + topRows + EXT + 4;
        const d = buildData(v, ox, oz, { RA, D, rows: plan.dataRows, lamps: st.portLamps });
        dataLayout = d;
        const xWest = x0 + 1;
        const west: Record<string, BusPin> = {};
        // верхние клеммы: адрес (RA штук) и nWM, по возрастанию x
        const top: [string, XYZ][] = [['nwm', d.nwm], ...d.addr.map((a, k) => [`addr${k}`, a[0]] as [string, XYZ])];
        top.sort((a, b) => a[1][0] - b[1][0]);
        top.forEach(([name, t], rank) => (west[name] = arrayFeeder(v, t, rank, 'top', xWest, 'sink')));
        const bot: [string, XYZ, 'sink' | 'source'][] = [
          ...d.wbl.map((t, k) => [`wbl${k}`, t, 'sink'] as [string, XYZ, 'sink' | 'source']),
          ...d.rbl.map((t, k) => [`rbl${k}`, t, 'source'] as [string, XYZ, 'sink' | 'source']),
        ];
        bot.sort((a, b) => a[1][0] - b[1][0]);
        bot.forEach(([name, t, kind], rank) => (west[name] = arrayFeeder(v, t, rank, 'bottom', xWest, kind)));
        return { name: 'data', box: { x0: xWest - 1, x1: x0 + w, z0, z1: z0 + h }, west, east: {} };
      },
    });
  }
  if (plan.hasAlu && mAluA && mMux) {
    for (let i = 0; i < D; i++) {
      macroPlan(`aluA${i}`, mAluA);
      macroPlan(`mux${i}`, mMux);
      ffPlan(`ffA${i}`);
    }
  }
  if (mFlags) {
    macroPlan('flags', mFlags);
    for (const fl of f.flags) ffPlan(`ffF${fl}`);
  }
  if (st.indicators) {
    for (let i = 0; i < P; i++) lampPlan(`lampPc${i}`);
    if (plan.hasAlu) for (let i = 0; i < D; i++) lampPlan(`lampA${i}`);
    for (const fl of f.flags) lampPlan(`lampF${fl}`);
  }

  // ───── порядок карточек по потоку данных ─────
  const rankOf = (name: string): number => {
    const m = /^(pcs|ffP|lampPc|aluA|mux|ffA|lampA)(\d+)$/.exec(name);
    if (name === 'take') return 0;
    if (name.startsWith('ffF')) return 1;
    if (name.startsWith('lampF')) return 2;
    if (m) {
      const i = Number(m[2]);
      const k = ['pcs', 'ffP', 'lampPc'].indexOf(m[1]);
      if (k >= 0) return 10 + 4 * i + k;
      return 200 + 4 * i + ['aluA', 'mux', 'ffA', 'lampA'].indexOf(m[1]);
    }
    return { ctl: 100, clock: 101, resetLever: 102, data: 110, flags: 300 }[name] ?? 400;
  };
  plans.sort((a, b2) => rankOf(a.name) - rankOf(b2.name));
  const idx = new Map(plans.map((p, i) => [p.name, i]));

  // обход каждой цепи с источником на востоке — в зазоре над самым верхним приёмником
  const wrapGap = new Map<string, { gap: number; slot: number }>();
  const wrapsIn: number[] = new Array(plans.length).fill(0);
  let freeLeft = 0;
  for (const n of netSpecs) {
    const sinkIdx = n.sinks.map((s) => idx.get(s.card)).filter((i): i is number => i !== undefined);
    if (!sinkIdx.length) continue;
    if (!n.forced) freeLeft++;
    if ('card' in n.src && n.src.side === 'east') {
      const g = Math.min(...sinkIdx);
      wrapGap.set(n.name, { gap: g, slot: wrapsIn[g]++ });
    }
  }
  const rightCount = wrapGap.size;

  // ───── геометрия платы ─────
  const X0 = Math.max(romW + 8, freeLeft * 3 + 40);
  const rom = buildRom(v, X0 - 8 - romW, 0, romOpts);
  const forcedX = (fx: Forced): number => ('out' in fx ? rom.outX[fx.out] : rom.addrX[fx.addr]);
  const near = (x: number): boolean => [...rom.outX, ...rom.addrX].some((a) => Math.abs(a - x) <= 1);
  const leftXs: number[] = [];
  for (let x = X0 - 16; leftXs.length < freeLeft; x -= 3) if (!near(x)) leftXs.push(x);
  progress('Размещение карточек…');
  const wrapZOf = new Map<string, number>();
  let z = rom.bounds.z1 + 14;
  let maxEast = 0;
  plans.forEach((p, c) => {
    const gapStart = z;
    for (const [name, w] of wrapGap) if (w.gap === c) wrapZOf.set(name, gapStart + 4 + 4 * w.slot);
    z = gapStart + (wrapsIn[c] ? 8 + 4 * wrapsIn[c] : 4);
    const card = p.place(X0, z);
    cardMap.set(p.name, card);
    for (const pin of Object.values(card.east)) maxEast = Math.max(maxEast, pin.x);
    z += p.h;
  });
  const rightXs = Array.from({ length: rightCount }, (_, k) => maxEast + 16 + 3 * k);

  // ───── шина ─────
  progress('Прокладка шины…');
  const bus = new Bus({ leftXs, rightXs, wrapZs: [] });
  const pinOf = (card: string, side: 'east' | 'west', pin: string): BusPin | undefined => cardMap.get(card)?.[side][pin];
  for (const n of netSpecs) {
    const sinks: BusPin[] = [];
    for (const s of n.sinks) {
      const p = pinOf(s.card, 'west', s.pin);
      if (p) sinks.push(p);
    }
    if (!sinks.length) continue;
    let src: BusNet['src'] | undefined;
    if ('rail' in n.src) src = { kind: 'rail', z: rom.outBottom + 1 };
    else {
      const p = pinOf(n.src.card, n.src.side, n.src.pin);
      if (p) src = { kind: n.src.side, pin: p };
    }
    if (!src) continue;
    bus.add({ name: n.name, src, sinks, x: n.forced ? forcedX(n.forced) : undefined, zTop: n.zTop ? rom.addrBottom + 1 : undefined, wrapZ: wrapZOf.get(n.name) });
  }
  bus.build(v);

  // ───── метки ─────
  const q = (name: string): XYZ => {
    const c = cardMap.get(name);
    if (!c?.probe?.Q) throw new Error(`Нет триггера ${name}`);
    return c.probe.Q;
  };
  const probes: Probes = {
    clk: clkLever,
    reset: resetLever!,
    clockStop: clockInfo ? (clockInfo as { stop: XYZ }).stop : null,
    pc: Array.from({ length: P }, (_, i) => q(`ffP${i}`)),
    a: plan.hasAlu ? Array.from({ length: D }, (_, i) => q(`ffA${i}`)) : [],
    flags: {},
    ram: new Map(),
    inputs: [],
    lamps: [],
  };
  for (const fl of f.flags) probes.flags[fl as 'Z'] = q(`ffF${fl}`);
  if (dataLayout) {
    plan.dataRows.forEach((dr, i) => {
      const cells = dataLayout!.cell[i].filter((c): c is XYZ => !!c);
      if (cells.length) probes.ram.set(dr.name ?? `row${i}`, cells);
    });
    for (const inp of dataLayout.inputs) probes.inputs.push({ port: inp.name ?? '', bit: inp.bit, pos: inp.pos });
    for (const l of dataLayout.lamps) probes.lamps.push({ port: l.name ?? '', bit: l.bit, pos: l.pos });
  }
  const b = v.bounds();
  const labels: Built['labels'] = [];
  if (clkLever) labels.push({ name: 'Рычаг CLK (такт)', pos: clkLever });
  if (clockInfo) labels.push({ name: 'Рычаг «стоп» тактового генератора', pos: (clockInfo as { stop: XYZ }).stop });
  if (resetLever) labels.push({ name: 'Рычаг RESET (сброс)', pos: resetLever });
  const stats: BuildStats = {
    nets: bus.stats.nets,
    wraps: bus.stats.wraps,
    macros: macroInfo,
    ms: Math.round(performance.now() - t0),
    size: { x: b.x1 - b.x0 + 1, y: b.y1 - b.y0 + 1, z: b.z1 - b.z0 + 1 },
    blocks: v.size,
  };
  const regions: Built['regions'] = [{ name: 'ПЗУ (программа)', ...rom.bounds }];
  for (const [name, c] of cardMap) regions.push({ name, ...c.box });
  return { vox: v, probes, stats, labels, cards: cardMap, regions };
}
