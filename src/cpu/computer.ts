import { ExportSettings } from '../compiler/compile';
import { RomLayout, buildRom, EXT } from './arrays';
import { buildData, DataLayout } from './dataarray';
import { Bus, BusNet, BusPin } from './bus';
import { Card, arrayFeeder, clockCard, delayCard, delayCells, ffCard, lampCard, leverCard, placeMacro } from './cards';
import { Macro, macroSettings } from './macro';
import { getMacro } from './macrolib';
import { JUMP_CTLS, aluANetlist, aluMuxNetlist, amuxNetlist, ctlNetlist, flagsNetlist, muxTerms, pcSliceNetlist, rfBitNetlist, takeNetlist } from './hwnets';
import { CtlName } from './micro';
import { findShorts } from './netcheck';
import { FNet, FPin, FloorError, FloorStats, routeFloor } from './floor';
import { PlaceCard, PlaceNet, placeCards } from './place2d';
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
  /** compact — провода поверх плотно расставленных узлов (по умолчанию); stack — старая колонка с шиной. */
  layout?: 'compact' | 'stack';
}

export function defaultBuildSettings(): BuildSettings {
  return { romFull: false, macro: macroSettings(), indicators: true, portLamps: true, clock: 'lever', clockHalfTicks: 0, guardRt: 60, layout: 'compact' };
}

export interface Probes {
  clk: XYZ | null;
  reset: XYZ;
  /** Рычаг «стоп» автогенератора (включён → такта нет). */
  clockStop: XYZ | null;
  pc: XYZ[];
  /** Аккумулятор (аккумуляторная архитектура). */
  a: XYZ[];
  /** Регистры (регистровая архитектура): номер → клетки Q триггеров (младший бит первым). Регистры без триггеров всегда равны нулю. */
  regs: Map<number, XYZ[]>;
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
  const regsF = f.regs;
  const mCtl = macro('такты и замки', ctlNetlist(regsF?.list));
  // разряды счётчика: переход по регистру (jReg) есть только у разрядов, которые есть и у данных
  const hasJr = has('jReg');
  const pcMacros: Macro[] = [];
  const pcMacro = (i: number): Macro => {
    const jr = hasJr && i < D;
    const key = i === 0 ? 0 : jr ? 1 : 2;
    pcMacros[key] ??= macro(i === 0 ? 'разряд счётчика (младший)' : jr ? 'разряд счётчика' : 'разряд счётчика (без регистра)', pcSliceNetlist(hasTake, i === 0, jr));
    return pcMacros[key];
  };
  const mTake = hasTake ? macro('условия переходов', takeNetlist(f)) : null;
  const mAluA = plan.hasAlu ? macro('АЛУ: сумматор', aluANetlist(f)) : null;
  const mMux = plan.hasAlu ? macro('АЛУ: выбор результата', aluMuxNetlist(f)) : null;
  const mFlags = plan.hasAlu && f.flags.length > 0 ? macro('флаги', flagsNetlist(f)) : null;
  const rfPorts = regsF ? { a: regsF.readA.length > 0, b: regsF.readB.length > 0 } : { a: false, b: false };
  const mRf = regsF && (rfPorts.a || rfPorts.b) ? macro('файл регистров (разряд)', rfBitNetlist(f)) : null;
  const AMUX = has('uAddrR') ? Math.min(D, RA) : 0;
  const mAmux = AMUX > 0 ? macro('адрес данных (разряд)', amuxNetlist()) : null;
  progress('Раскладка платы…');

  let v = new Vox();

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
    const sel = /^(selA|selB|nweR)(\d+)$/.exec(c.name);
    if (m) {
      const k = Number(m[1]);
      if (hasTake && k < P) add(`pcs${k}`, 'ob');
      if (k < D && plan.hasAlu) add(`aluA${k}`, 'ob');
      if (hasData && k < RA) {
        if (k < AMUX) add(`amux${k}`, 'ob');
        else add('data', `addr${k}`);
      }
    } else if (sel) {
      // регистровая архитектура: по одному столбцу ПЗУ на выбор регистра портом A/B и на запись в регистр
      if (sel[1] === 'nweR') add('ctl', c.name);
      else for (let i = 0; i < D; i++) add(`rf${i}`, c.name);
    } else {
      const ctl = c.name as CtlName;
      if (['uImm', 'uMem', 'sub', 'uReg'].includes(ctl)) for (let i = 0; i < D; i++) add(`aluA${i}`, ctl);
      if (ctl === 'k1') add('aluA0', 'k1');
      if (ctl === 'sub') add('aluA0', 'cin');
      if (['eSum', 'eAnd', 'eOr', 'eXor', 'eNot', 'eShl', 'eShr', 'eB'].includes(ctl)) for (let i = 0; i < D; i++) add(`mux${i}`, ctl);
      if (['eSum', 'eShl', 'eShr', 'sub'].includes(ctl)) add('flags', ctl);
      if (JUMP_CTLS.includes(ctl)) add('take', ctl);
      if (['weM', 'halt', 'nweA', 'nweF'].includes(ctl)) add('ctl', ctl);
      if (ctl === 'uAddrR') for (let k = 0; k < AMUX; k++) add(`amux${k}`, 'uAddrR');
      if (ctl === 'jReg') for (let k = 0; k < Math.min(P, D); k++) add(`pcs${k}`, 'jReg');
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
  if (plan.hasAlu && regsF) {
    for (const r of regsF.list) {
      const lk = net(`lkMR${r}`, { card: 'ctl', side: 'east', pin: `lkMR${r}` });
      for (let i = 0; i < D; i++) {
        lkS(`ffR${r}_${i}`, 'lkS');
        lk(`ffR${r}_${i}`, 'lkM');
      }
    }
  } else if (plan.hasAlu) {
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
  const clkNet = net('clk', { card: 'clock', side: 'east', pin: 'out' });
  clkNet('ctl', 'clk');
  clkNet('guard', 'in');
  net('clkd0', { card: 'guard', side: 'east', pin: 'out' })('ctl', 'clkd0');
  net('reset', { card: 'resetLever', side: 'east', pin: 'out' })('ctl', 'reset');
  // адрес данных из регистра: мультиплексор адреса ставится между ПЗУ/портом A и массивом данных
  for (let k = 0; k < AMUX; k++) net(`ad${k}`, { card: `amux${k}`, side: 'east', pin: 'ad' })('data', `addr${k}`);

  // тракт данных
  if (plan.hasAlu) {
    const hasNot = muxTerms(f).some((t) => t.ctl === 'eNot');
    for (let i = 0; i < D; i++) {
      // источник первого операнда: аккумулятор или порт A файла регистров
      const portA = regsF ? (rfPorts.a ? net(`ra${i}`, { card: `rf${i}`, side: 'east', pin: 'ra' }) : null) : net(`a${i}`, { card: `ffA${i}`, side: 'west', pin: 'Q' });
      const a = (card: string, pin: string): void => portA?.(card, pin);
      a(`aluA${i}`, 'a');
      if (hasNot) a(`mux${i}`, 'a');
      if (has('eShr') && i >= 1) a(`mux${i - 1}`, 'an');
      if (has('eShl') && i + 1 < D) a(`mux${i + 1}`, 'ap');
      if (mFlags && i === D - 1) a('flags', 'am');
      if (mFlags && i === 0) a('flags', 'a0');
      if (regsF) {
        if (hasJr && i < P) a(`pcs${i}`, 'ra');
        if (i < AMUX) a(`amux${i}`, 'ra');
        for (const r of regsF.list) {
          const q = net(`q${r}_${i}`, { card: `ffR${r}_${i}`, side: 'west', pin: 'Q' });
          if (mRf && (regsF.readA.includes(r) || regsF.readB.includes(r))) q(`rf${i}`, `q${r}`);
          if (st.indicators) q(`lampR${r}_${i}`, 'in');
        }
        if (rfPorts.b) {
          const rb = net(`rb${i}`, { card: `rf${i}`, side: 'east', pin: 'rb' });
          if (has('uReg')) rb(`aluA${i}`, 'rb');
          if (hasData && has('weM')) rb('data', `wbl${i}`);
        }
      } else {
        if (hasData) a('data', `wbl${i}`);
        if (st.indicators) a(`lampA${i}`, 'in');
      }
      const r = net(`r${i}`, { card: `mux${i}`, side: 'east', pin: 'r' });
      if (regsF) for (const reg of regsF.list) r(`ffR${reg}_${i}`, 'D');
      else r(`ffA${i}`, 'D');
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
  addPlan({ name: 'guard', w: delayCells(st.guardRt) + 8, h: 4, place: (x0, z0) => delayCard(v, 'guard', x0 + 4, z0 + 2, st.guardRt) });
  macroPlan('ctl', mCtl);
  if (mTake) macroPlan('take', mTake);
  for (let i = 0; i < P; i++) {
    macroPlan(`pcs${i}`, pcMacro(i));
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
      if (regsF) {
        if (mRf) macroPlan(`rf${i}`, mRf);
        for (const r of regsF.list) ffPlan(`ffR${r}_${i}`);
      } else ffPlan(`ffA${i}`);
    }
  }
  if (mAmux) for (let k = 0; k < AMUX; k++) macroPlan(`amux${k}`, mAmux);
  if (mFlags) {
    macroPlan('flags', mFlags);
    for (const fl of f.flags) ffPlan(`ffF${fl}`);
  }
  if (st.indicators) {
    for (let i = 0; i < P; i++) lampPlan(`lampPc${i}`);
    if (plan.hasAlu) {
      if (regsF) for (let i = 0; i < D; i++) for (const r of regsF.list) lampPlan(`lampR${r}_${i}`);
      else for (let i = 0; i < D; i++) lampPlan(`lampA${i}`);
    }
    for (const fl of f.flags) lampPlan(`lampF${fl}`);
  }

  // ───── компактная раскладка: узлы плотно, провода поверх них ─────
  let rom: RomLayout | undefined;
  let stackRom: RomLayout | undefined;
  let busStats = { nets: 0, wraps: 0 };
  let floorStats: FloorStats | undefined;

  const compactLayout = (): { rom: RomLayout; stats: FloorStats } => {
    const ESC = 10; // поле под выходы выводов (плоский участок + рампа в 5 уровней)
    const dryRun = <T,>(fn: () => T): T => {
      const real = v;
      v = new Vox();
      try {
        return fn();
      } finally {
        v = real;
      }
    };
    interface Dry {
      name: string;
      /** Охранный прямоугольник в системе координат карточки (origin = (0, 0) у place). */
      rect: { x0: number; x1: number; z0: number; z1: number };
      pins: { key: string; x: number; z: number }[];
    }
    const drys: Dry[] = [];
    for (const p of plans) {
      const c = dryRun(() => p.place(0, 0));
      const pins: Dry['pins'] = [];
      let x0 = c.box.x0;
      let x1 = c.box.x1;
      for (const [n, q] of Object.entries(c.west)) {
        pins.push({ key: `${p.name}|west|${n}`, x: q.x, z: q.z });
        x0 = Math.min(x0, q.x);
      }
      for (const [n, q] of Object.entries(c.east)) {
        pins.push({ key: `${p.name}|east|${n}`, x: q.x, z: q.z });
        x1 = Math.max(x1, q.x);
      }
      const hasW = Object.keys(c.west).length > 0;
      const hasE = Object.keys(c.east).length > 0;
      drys.push({ name: p.name, rect: { x0: x0 - (hasW ? ESC : 2), x1: x1 + (hasE ? ESC : 2), z0: c.box.z0 - 2, z1: c.box.z1 + 2 }, pins });
    }
    // ПЗУ: выводы (адрес и выходы) на южной стороне
    const romDry = dryRun(() => buildRom(v, 0, 0, romOpts));
    {
      const pins: Dry['pins'] = [];
      romDry.addrX.forEach((x, b) => pins.push({ key: `rom|addr|${b}`, x, z: romDry.addrBottom }));
      romDry.outX.forEach((x, j) => pins.push({ key: `rom|out|${j}`, x, z: romDry.outBottom }));
      drys.push({ name: 'rom', rect: { x0: romDry.bounds.x0 - 2, x1: romDry.bounds.x1 + 2, z0: romDry.bounds.z0 - 2, z1: romDry.bounds.z1 + 8 }, pins });
    }
    if (process.env.FLOOR_DEBUG) {
      for (const d of drys) {
        const zs = d.pins.filter((q) => !q.key.startsWith('rom')).map((q) => q.z - d.rect.z0);
        const xs = d.pins.filter((q) => q.key.startsWith('rom')).map((q) => q.x - d.rect.x0);
        process.stderr.write(`${d.name}: w=${d.rect.x1 - d.rect.x0 + 1} h=${d.rect.z1 - d.rect.z0 + 1} zpar=${zs.map((z) => z & 1).join('')} z=${zs.join(',')} x=${xs.join(',')}\n`);
      }
    }
    const pinKeyOf = (card: string, side: 'east' | 'west', pin: string): string => `${card}|${side}|${pin}`;
    const cardIdx = new Map(drys.map((d, i) => [d.name, i]));
    const pinIdx = new Map<string, [number, number]>();
    drys.forEach((d, ci) => d.pins.forEach((p, pi) => pinIdx.set(p.key, [ci, pi])));
    const netPins = (n: (typeof netSpecs)[number]): { src: string | null; sinks: string[] } => {
      const sinks: string[] = [];
      for (const s of n.sinks) {
        const k = pinKeyOf(s.card, 'west', s.pin);
        if (pinIdx.has(k)) sinks.push(k);
      }
      if (n.forced && 'addr' in n.forced) sinks.push(`rom|addr|${n.forced.addr}`);
      let src: string | null = null;
      if ('rail' in n.src) src = `rom|out|${(n.forced as { out: number }).out}`;
      else {
        const k = pinKeyOf(n.src.card, n.src.side, n.src.pin);
        if (pinIdx.has(k)) src = k;
      }
      return { src, sinks };
    };
    const placeNets: PlaceNet[] = [];
    for (const n of netSpecs) {
      const { src, sinks } = netPins(n);
      if (!src || !sinks.length) continue;
      placeNets.push({ pins: [src, ...sinks].map((k) => ({ card: pinIdx.get(k)![0], pin: pinIdx.get(k)![1] })) });
    }
    const majority = (vals: number[]): 0 | 1 | undefined => {
      if (!vals.length) return undefined;
      const odd = vals.filter((q) => (q & 1) === 1).length;
      return odd * 2 > vals.length ? 1 : 0;
    };
    const pcs: PlaceCard[] = drys.map((d) => {
      const pins = d.pins.map((p) => ({ x: p.x - d.rect.x0, z: p.z - d.rect.z0 }));
      const isRom = d.name === 'rom';
      return {
        name: d.name,
        w: d.rect.x1 - d.rect.x0 + 1,
        h: d.rect.z1 - d.rect.z0 + 1,
        pins,
        // выводы по сторонам идут вдоль Z (нужна чётность Z); выводы ПЗУ — вдоль X
        parZ: isRom ? undefined : majority(pins.map((q) => q.z)),
        parX: isRom ? majority(pins.map((q) => q.x)) : undefined,
      };
    });
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      progress(`Расстановка узлов${attempt ? ` (попытка ${attempt + 1})` : ''}…`);
      const pr = placeCards(pcs, placeNets, { seed: 7 + attempt * 13, gap: 1 + attempt });
      // реальная расстановка
      v = new Vox();
      cardMap.clear();
      const placed = new Map<string, { ox: number; oz: number }>();
      for (const p of plans) {
        const ci = cardIdx.get(p.name)!;
        const d = drys[ci];
        const ox = pr.x[ci] - d.rect.x0;
        const oz = pr.z[ci] - d.rect.z0;
        placed.set(p.name, { ox, oz });
        cardMap.set(p.name, p.place(ox, oz));
      }
      const rd = drys[cardIdx.get('rom')!];
      const rom2 = buildRom(v, pr.x[cardIdx.get('rom')!] - rd.rect.x0, pr.z[cardIdx.get('rom')!] - rd.rect.z0, romOpts);
      const pinOfKey = (k: string, role: 'src' | 'sink'): FPin => {
        const [card, side, name] = k.split('|');
        if (card === 'rom') {
          const b = Number(name);
          return side === 'addr' ? { x: rom2.addrX[b], y: 3, z: rom2.addrBottom, dx: 0, dz: 1 } : { x: rom2.outX[b], y: 3, z: rom2.outBottom, dx: 0, dz: 1 };
        }
        const q = cardMap.get(card)![side as 'west' | 'east'][name];
        return { x: q.x, y: 1, z: q.z, dx: side === 'west' ? -1 : 1, dz: 0, boost: role === 'sink' ? q.boost : undefined };
      };
      const fnets: FNet[] = [];
      for (const n of netSpecs) {
        const { src, sinks } = netPins(n);
        if (!src || !sinks.length) continue;
        fnets.push({ name: n.name, src: pinOfKey(src, 'src'), sinks: sinks.map((k) => pinOfKey(k, 'sink')) });
      }
      try {
        progress('Прокладка проводов поверх узлов…');
        const stats = routeFloor(v, fnets, { layers: 2, progress, seed: attempt + 1 });
        const shorts = findShorts(v);
        if (process.env.FLOOR_DEBUG) {
          const ign = new Set<string>();
          for (const n of fnets) for (const q of [n.src, ...n.sinks]) ign.add(`${q.x},${q.y},${q.z}`);
          const contacts = findShorts(v, { cards: true, ignore: ign }).filter((q) => q.nets.includes('(карточка)'));
          process.stderr.write(`CONTACTS ${contacts.length}\n`);
          for (const q of contacts.slice(0, 12)) process.stderr.write(`  ${q.nets.join(' × ')} at ${q.at.join(',')}\n`);
        }
        if (shorts.length) throw new FloorError(`короткое замыкание цепей: ${shorts.slice(0, 3).map((x) => x.nets.join(' × ')).join('; ')}`, []);
        return { rom: rom2, stats };
      } catch (e) {
        if (!(e instanceof FloorError)) throw e;
        lastErr = e;
      }
    }
    throw lastErr;
  };

  if (st.layout !== 'stack') {
    try {
      const r = compactLayout();
      rom = r.rom;
      floorStats = r.stats;
      busStats = { nets: r.stats.nets, wraps: 0 };
    } catch (e) {
      if (!(e instanceof FloorError)) throw e;
      progress(`Компактная раскладка не удалась (${e.message}) — использую раскладку колонкой`);
      v = new Vox();
      cardMap.clear();
    }
  }

  if (!rom) {
    // ───── порядок карточек по потоку данных ─────
    const rankOf = (name: string): number => {
      const m = /^(pcs|ffP|lampPc|aluA|mux|ffA|lampA)(\d+)$/.exec(name);
      const rr = /^(ffR|lampR)(\d+)_(\d+)$/.exec(name);
      const rf = /^(rf|amux)(\d+)$/.exec(name);
      if (name === 'take') return 0;
      if (name.startsWith('ffF')) return 1;
      if (name.startsWith('lampF')) return 2;
      if (m) {
        const i = Number(m[2]);
        const k = ['pcs', 'ffP', 'lampPc'].indexOf(m[1]);
        if (k >= 0) return 10 + 4 * i + k;
        if (!regsF) return 200 + 4 * i + ['aluA', 'mux', 'ffA', 'lampA'].indexOf(m[1]);
        // разряд тракта данных регистровой машины: триггеры регистров, файл чтения, АЛУ, лампы
        return 1000 + 64 * i + ({ aluA: 17, mux: 18 } as Record<string, number>)[m[1]];
      }
      if (rr) return 1000 + 64 * Number(rr[3]) + (rr[1] === 'ffR' ? 0 : 32) + Number(rr[2]);
      if (rf) return rf[1] === 'rf' ? 1000 + 64 * Number(rf[2]) + 16 : 120 + Number(rf[2]);
      return { ctl: 100, clock: 101, resetLever: 102, guard: 103, data: 110, flags: regsF ? 5000 : 300 }[name] ?? 6000;
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
    stackRom = rom;
    const forcedX = (fx: Forced): number => ('out' in fx ? rom.outX[fx.out] : rom.addrX[fx.addr]);
    // между приподнятыми магистралями нужно ≥ 3 клеток: «лестница» отвода (x+1, y=2) соседней цепи касается пыли магистрали по диагонали
    const near = (x: number): boolean => [...rom.outX, ...rom.addrX].some((a) => Math.abs(a - x) <= 2);
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
    busStats = { nets: bus.stats.nets, wraps: bus.stats.wraps };
    // самопроверка: провода разных цепей не должны касаться друг друга (иначе плата считает неверно, хотя блоки «по отдельности» исправны)
    const shorts = findShorts(v);
    if (shorts.length) throw new Error(`Короткое замыкание цепей на плате: ${shorts.slice(0, 5).map((x) => `${x.nets.join(' × ')} (${x.at.join(', ')})`).join('; ')}`);

  }
  rom = rom ?? stackRom!;
  void floorStats;

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
    a: plan.hasAlu && !regsF ? Array.from({ length: D }, (_, i) => q(`ffA${i}`)) : [],
    regs: new Map(regsF && plan.hasAlu ? regsF.list.map((r) => [r, Array.from({ length: D }, (_, i) => q(`ffR${r}_${i}`))] as [number, XYZ[]]) : []),
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
    nets: busStats.nets,
    wraps: busStats.wraps,
    macros: macroInfo,
    ms: Math.round(performance.now() - t0),
    size: { x: b.x1 - b.x0 + 1, y: b.y1 - b.y0 + 1, z: b.z1 - b.z0 + 1 },
    blocks: v.size,
  };
  const regions: Built['regions'] = [{ name: 'ПЗУ (программа)', ...rom.bounds }];
  for (const [name, c] of cardMap) regions.push({ name, ...c.box });
  return { vox: v, probes, stats, labels, cards: cardMap, regions };
}
