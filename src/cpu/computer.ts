import { ExportSettings } from '../compiler/compile';
import { Board, RouteReport } from './board';
import { EXT, RomLayout, buildRom } from './arrays';
import { DataLayout, buildData } from './dataarray';
import { Part, ffPart, lampPart, leverPart } from './parts';
import { Macro, macroSettings } from './macro';
import { getMacro } from './macrolib';
import { JUMP_CTLS, aluANetlist, aluMuxNetlist, ctlNetlist, flagsNetlist, muxTerms, pcSliceNetlist, takeNetlist } from './hwnets';
import { Plan } from './plan';
import { Vox } from './vox';
import { CtlName } from './micro';

type XYZ = [number, number, number];

export interface BuildSettings {
  /** Матрица ПЗУ: полная (бочки во всех клетках, можно перепрошивать) или только единицы. */
  romFull: boolean;
  /** Настройки компилятора для блоков логики (варианты вентилей, материалы, рычаги/кнопки). */
  macro: ExportSettings;
  /** Лампы-индикаторы счётчика команд, аккумулятора и флагов. */
  indicators: boolean;
  /** Лампы на портах вывода. */
  portLamps: boolean;
  /** Предел расширений поиска пути на одну сеть. */
  maxExpansions: number;
  /** Сколько раз пересчитывать порядок прокладки при неудаче. */
  rounds?: number;
  /** Отладочный журнал прокладки. */
  trace?: (msg: string) => void;
}

export function defaultBuildSettings(): BuildSettings {
  return { romFull: false, macro: macroSettings(), indicators: true, portLamps: true, maxExpansions: 1_500_000 };
}

export interface Probes {
  clk: XYZ;
  reset: XYZ;
  pc: XYZ[];
  a: XYZ[];
  flags: Partial<Record<'Z' | 'C' | 'N' | 'V', XYZ>>;
  /** Ячейки данных: адрес в программе → повторители битов (младший первым). */
  ram: Map<string, XYZ[]>;
  inputs: { port: string; bit: number; pos: XYZ }[];
  lamps: { port: string; bit: number; pos: XYZ }[];
}

export interface Built {
  vox: Vox;
  probes: Probes;
  report: RouteReport & { macros: { name: string; gates: number; ms: number; size: string }[]; nets: number; msTotal: number };
  rom: RomLayout;
  data?: DataLayout;
}

class Shelf {
  private x: number;
  private z: number;
  private rowH = 0;
  maxZ = 0;
  constructor(private x0: number, z0: number, private maxX: number, private gapX: number, private gapZ: number) {
    this.x = x0;
    this.z = z0;
  }
  place(w: number, h: number): { x: number; z: number } {
    if (this.x > this.x0 && this.x + w > this.maxX) {
      this.x = this.x0;
      this.z += this.rowH + this.gapZ;
      this.rowH = 0;
    }
    const p = { x: this.x, z: this.z };
    this.x += w + this.gapX;
    this.rowH = Math.max(this.rowH, h);
    this.maxZ = Math.max(this.maxZ, this.z + h);
    return p;
  }
}

function constPart(v: Vox, x: number, z: number): Part {
  v.solid(x, 1, z);
  v.torch(x + 1, 1, z, 3);
  v.dust(x + 2, 1, z);
  return { name: 'const1', pins: { out: { dust: [x + 2, 1, z], free: [[x + 3, 1, z], [x + 4, 1, z]] } }, bbox: { x0: x, z0: z - 1, x1: x + 2, z1: z + 1, y1: 2 } };
}

/**
 * Собирает физический компьютер по плану: массивы (ПЗУ, ОЗУ), блоки логики (счётчик, АЛУ, флаги, условия, такты),
 * триггеры и провода между ними.
 */
export function buildComputer(plan: Plan, st: BuildSettings = defaultBuildSettings(), progress: (msg: string) => void = () => {}): Built {
  if (!plan.ok) throw new Error('План постройки содержит ошибки');
  const t0 = performance.now();
  const f = plan.feat;
  const { D, P, RA } = f;
  const used = f.used;
  const has = (n: CtlName): boolean => used.has(n);
  const hasTake = JUMP_CTLS.some((j) => has(j));
  const macroInfo: Built['report']['macros'] = [];
  const macro = (name: string, text: string): Macro => {
    progress(`Блок «${name}»…`);
    const m = getMacro(text, st.macro);
    macroInfo.push({ name, gates: m.stats.gates, ms: m.stats.ms, size: `${m.size.sx}×${m.size.sz}` });
    return m;
  };
  const mCtl = macro('такты и замки', ctlNetlist());
  const mPc = macro('разряд счётчика', pcSliceNetlist(hasTake));
  const mTake = hasTake ? macro('условия переходов', takeNetlist(f)) : null;
  const mAluA = plan.hasAlu ? macro('АЛУ: сумматор', aluANetlist(f)) : null;
  const mMux = plan.hasAlu ? macro('АЛУ: выбор результата', aluMuxNetlist(f)) : null;
  const mFlags = plan.hasAlu && f.flags.length > 0 ? macro('флаги', flagsNetlist(f)) : null;

  const board = new Board(9, 10);
  const base = board.base;
  const nets: Record<string, { from?: XYZ; to: XYZ[] }> = {};
  const net = (name: string): { from?: XYZ; to: XYZ[] } => (nets[name] ??= { to: [] });
  const src = (name: string, p: XYZ | undefined): void => {
    if (p) net(name).from = p;
  };
  const dst = (name: string, p: XYZ | undefined): void => {
    if (p) net(name).to.push(p);
  };
  const pinDust = (pins: Map<string, { dust: XYZ }>, name: string): XYZ | undefined => pins.get(name)?.dust;

  // ───── измеряем массивы (пробная сборка) ─────
  const rows = plan.rows.length;
  const cols = plan.columns.length;
  const romOpts = { P, rows, cols, bit: (r: number, c: number) => plan.columns[c].bit(r), full: st.romFull };
  const probeRom = buildRom(new Vox(), 0, 0, romOpts);
  const romW = probeRom.bounds.x1 - probeRom.bounds.x0 + 1;
  const romH = probeRom.bounds.z1 - probeRom.bounds.z0 + 1 + 2 * EXT;
  let dataW = 0;
  if (plan.hasData && plan.dataRows.length > 0) {
    const pd = buildData(new Vox(), 0, 0, { RA, D, rows: plan.dataRows, lamps: st.portLamps });
    dataW = pd.bounds.x1 - pd.bounds.x0 + 1;
  }

  // ───── верхняя полоса: такты, условия, разряды счётчика ─────
  const footprint = (m: Macro): { w: number; h: number } => ({ w: m.size.sx + 12, h: m.size.sz + 6 });
  const top = new Shelf(50, 0, Math.max(romW, 360) + 50, 44, 40);
  const place = (m: Macro): { x: number; z: number } => {
    const fp = footprint(m);
    const p = top.place(fp.w, fp.h);
    return { x: p.x + 5, z: p.z + 3 };
  };
  const pCtl = place(mCtl);
  const ctlPins = board.addMacro(mCtl, pCtl.x, pCtl.z);
  const takePins = mTake ? (() => { const p = place(mTake); return board.addMacro(mTake, p.x, p.z); })() : null;
  const pcPins: Map<string, { dust: XYZ }>[] = [];
  for (let i = 0; i < P; i++) {
    const p = place(mPc);
    pcPins.push(board.addMacro(mPc, p.x, p.z));
  }
  const levers = {
    clk: leverPart(base, pCtl.x - 44, pCtl.z + 4, 'clk'),
    reset: leverPart(base, pCtl.x - 44, pCtl.z + 12, 'reset'),
  };
  const leverPins = { clk: board.addPart(levers.clk), reset: board.addPart(levers.reset) };
  const one = constPart(base, pCtl.x - 44, pCtl.z + 20);
  const onePin = board.addPart(one);

  const rz = top.maxZ + 70;
  // триггеры счётчика команд над ПЗУ
  const pcFf: Map<string, XYZ>[] = [];
  const pcFfPart: Part[] = [];
  for (let i = 0; i < P; i++) {
    const part = ffPart(base, 8 + 14 * i, rz - 26, `pc${i}`);
    pcFfPart.push(part);
    pcFf.push(board.addPart(part));
  }
  const rom = buildRom(base, 0, rz, romOpts);
  const guardArr = (b: { x0: number; z0: number; x1: number; z1: number }, free: XYZ[]): void => board.guard(b.x0 - 1, b.z0 - EXT, b.x1 + 1, b.z1 + EXT, 6, free);
  guardArr(rom.bounds, []);
  for (const t of rom.addr.flat()) board.terminal(t, 0, -1);
  for (const t of rom.out) board.terminal(t, 0, 1);

  // ───── нижняя часть: ОЗУ слева, АЛУ-полосы справа ─────
  const dz = rz + romH + 60;
  let data: DataLayout | undefined;
  if (plan.hasData && plan.dataRows.length > 0) {
    data = buildData(base, 0, dz, { RA, D, rows: plan.dataRows, lamps: st.portLamps });
    guardArr(data.bounds, []);
    for (const t of [...data.addr.flat(), data.nwm]) board.terminal(t, 0, -1);
    for (const t of [...data.wbl, ...data.rbl]) board.terminal(t, 0, 1);
  }
  const aluX = data ? dataW + 80 : 0;
  const ffA: Map<string, XYZ>[] = [];
  const ffAPart: Part[] = [];
  const aPins: Map<string, { dust: XYZ }>[] = [];
  const mxPins: Map<string, { dust: XYZ }>[] = [];
  let zStrip = dz;
  if (mAluA && mMux) {
    const stripH = Math.max(mAluA.size.sz, mMux.size.sz) + 30;
    for (let i = 0; i < D; i++) {
      const xA = aluX;
      aPins.push(board.addMacro(mAluA, xA + 5, zStrip + 4));
      const xM = xA + mAluA.size.sx + 40;
      mxPins.push(board.addMacro(mMux, xM + 5, zStrip + 4));
      const part = ffPart(base, xM + mMux.size.sx + 40, zStrip + 14, `a${i}`);
      ffAPart.push(part);
      ffA.push(board.addPart(part));
      zStrip += stripH;
    }
  }
  // флаги
  const flagFf: Partial<Record<string, Map<string, XYZ>>> = {};
  const flagPart: Partial<Record<string, Part>> = {};
  let flagsPins: Map<string, { dust: XYZ }> | null = null;
  if (mFlags) {
    const p = { x: aluX + 5, z: zStrip + 10 };
    flagsPins = board.addMacro(mFlags, p.x, p.z);
    let fx = p.x + mFlags.size.sx + 40;
    for (const fl of f.flags) {
      const part = ffPart(base, fx, p.z + 14, `f${fl}`);
      flagPart[fl] = part;
      flagFf[fl] = board.addPart(part);
      fx += 16;
    }
  }

  // ───── соединения ─────
  const clkPin = pinDust(ctlPins, 'clk');
  src('clk', leverPins.clk.get('out'));
  dst('clk', clkPin);
  src('reset', leverPins.reset.get('out'));
  dst('reset', pinDust(ctlPins, 'reset'));
  // замки
  src('lkS', pinDust(ctlPins, 'lkS'));
  src('lkMP', pinDust(ctlPins, 'lkMP'));
  src('lkMA', pinDust(ctlPins, 'lkMA'));
  src('lkMF', pinDust(ctlPins, 'lkMF'));
  src('nreset', pinDust(ctlPins, 'nreset'));
  src('nwm', pinDust(ctlPins, 'nwm'));
  for (const ff of pcFf) {
    dst('lkS', ff.get('lkS'));
    dst('lkMP', ff.get('lkM'));
  }
  for (const ff of ffA) {
    dst('lkS', ff.get('lkS'));
    dst('lkMA', ff.get('lkM'));
  }
  for (const fl of f.flags) {
    dst('lkS', flagFf[fl]?.get('lkS'));
    dst('lkMF', flagFf[fl]?.get('lkM'));
  }
  if (data) dst('nwm', data.nwm);

  // счётчик команд
  for (let i = 0; i < P; i++) {
    src(`pc${i}`, pcFf[i].get('Q'));
    dst(`pc${i}`, pinDust(pcPins[i], 'pc'));
    dst(`pc${i}`, rom.addr[i][0]);
    src(`d${i}`, pinDust(pcPins[i], 'd'));
    dst(`d${i}`, pcFf[i].get('D'));
    dst('nreset', pinDust(pcPins[i], 'nreset'));
    if (i === 0) {
      src('one', onePin.get('out'));
      dst('one', pinDust(pcPins[i], 'c'));
    } else {
      src(`pcc${i}`, pinDust(pcPins[i - 1], 'co'));
      dst(`pcc${i}`, pinDust(pcPins[i], 'c'));
    }
    if (hasTake) {
      dst('take', pinDust(pcPins[i], 'take'));
      dst('ntake', pinDust(pcPins[i], 'ntake'));
    }
  }
  if (takePins) {
    src('take', pinDust(takePins, 'take'));
    src('ntake', pinDust(takePins, 'ntake'));
    for (const fl of f.flags) {
      src(`flag${fl}`, flagFf[fl]?.get('Q'));
      dst(`flag${fl}`, pinDust(takePins, `f${fl.toLowerCase()}`));
    }
  }

  // столбцы ПЗУ → потребители
  plan.columns.forEach((c, j) => {
    const name = `rom_${c.name}`;
    src(name, rom.out[j]);
    const m = /^ob(\d+)$/.exec(c.name);
    if (m) {
      const k = Number(m[1]);
      if (hasTake && k < P) dst(name, pinDust(pcPins[k], 'ob'));
      if (k < D && aPins[k]) dst(name, pinDust(aPins[k], 'ob'));
      if (data && k < RA) dst(name, data.addr[k][0]);
    } else {
      const ctl = c.name;
      if (['uImm', 'uMem', 'sub'].includes(ctl)) for (const p of aPins) dst(name, pinDust(p, ctl));
      if (ctl === 'k1' && aPins[0]) dst(name, pinDust(aPins[0], 'k1'));
      if (ctl === 'sub' && aPins[0]) dst(name, pinDust(aPins[0], 'cin'));
      if (['eSum', 'eAnd', 'eOr', 'eXor', 'eNot', 'eShl', 'eShr', 'eB'].includes(ctl)) for (const p of mxPins) dst(name, pinDust(p, ctl));
      if (flagsPins && ['eSum', 'eShl', 'eShr', 'sub'].includes(ctl)) dst(name, pinDust(flagsPins, ctl));
      if (JUMP_CTLS.includes(ctl as CtlName)) dst(name, takePins ? pinDust(takePins, ctl) : undefined);
      if (ctl === 'weM' || ctl === 'halt' || ctl === 'nweA' || ctl === 'nweF') dst(name, pinDust(ctlPins, ctl));
    }
  });

  // тракт данных
  if (mAluA && mMux) {
    for (let i = 0; i < D; i++) {
      src(`a${i}`, ffA[i].get('Q'));
      dst(`a${i}`, pinDust(aPins[i], 'a'));
      if (muxTerms(f).some((t) => t.ctl === 'eNot')) dst(`a${i}`, pinDust(mxPins[i], 'a'));
      if (has('eShr') && i >= 1) dst(`a${i}`, pinDust(mxPins[i - 1], 'an'));
      if (has('eShl') && i + 1 < D) dst(`a${i}`, pinDust(mxPins[i + 1], 'ap'));
      if (data) dst(`a${i}`, data.wbl[i]);
      if (flagsPins && i === D - 1) dst(`a${i}`, pinDust(flagsPins, 'am'));
      if (flagsPins && i === 0) dst(`a${i}`, pinDust(flagsPins, 'a0'));
      src(`r${i}`, pinDust(mxPins[i], 'r'));
      dst(`r${i}`, ffA[i].get('D'));
      if (flagsPins && f.flags.includes('Z')) dst(`r${i}`, pinDust(flagsPins, `r${i}`));
      if (f.flags.includes('N') && i === D - 1) dst(`r${i}`, flagFf.N?.get('D'));
      for (const o of ['bx', 'p', 'g', 'o', 's']) {
        if (aPins[i].has(o)) {
          src(`${o}${i}`, pinDust(aPins[i], o));
          dst(`${o}${i}`, pinDust(mxPins[i], o));
        }
      }
      if (has('uMem') && data) {
        src(`mem${i}`, data.rbl[i]);
        dst(`mem${i}`, pinDust(aPins[i], 'mem'));
      }
      if (has('eSum')) {
        if (i + 1 < D) {
          src(`co${i}`, pinDust(aPins[i], 'co'));
          dst(`co${i}`, pinDust(aPins[i + 1], 'cin'));
        }
        if (i === D - 2 && flagsPins) dst(`co${i}`, pinDust(flagsPins, 'cm'));
        if (i === D - 1 && flagsPins) {
          src('coMsb', pinDust(aPins[i], 'co'));
          dst('coMsb', pinDust(flagsPins, 'co'));
        }
      }
    }
    if (flagsPins) {
      for (const [out, fl] of [['z', 'Z'], ['cn', 'C'], ['vn', 'V']] as const) {
        if (flagsPins.has(out) && flagFf[fl]) {
          src(`fl_${out}`, pinDust(flagsPins, out));
          dst(`fl_${out}`, flagFf[fl]!.get('D'));
        }
      }
    }
  }
  for (const [name, n] of Object.entries(nets)) {
    if (!n.from || n.to.length === 0) continue;
    board.connect(name, n.from, n.to);
  }
  progress(`Прокладка проводов: ${board.nets.length} цепей…`);
  (globalThis as { __board?: Board }).__board = board;
  board.trace = st.trace;
  const rep = board.route({ maxLevel: 7, maxExpansions: st.maxExpansions, rounds: st.rounds, spread: 0.9 });
  if (!rep.ok) throw new Error(`Не удалось проложить провода: ${rep.failed}`);
  const vox = board.toVox();

  // метки для проверки и интерфейса
  const probes: Probes = {
    clk: [pCtl.x - 44, 1, pCtl.z + 4],
    reset: [pCtl.x - 44, 1, pCtl.z + 12],
    pc: pcFf.map((m) => m.get('Q')!),
    a: ffA.map((m) => m.get('Q')!),
    flags: {},
    ram: new Map(),
    inputs: [],
    lamps: [],
  };
  for (const fl of f.flags) probes.flags[fl as 'Z'] = flagFf[fl]?.get('Q');
  void ffAPart;
  void pcFfPart;
  void flagPart;
  void lampPart;
  if (data) {
    plan.dataRows.forEach((dr, i) => {
      const cells = data!.cell[i].filter((c): c is XYZ => !!c);
      if (cells.length) probes.ram.set(dr.name ?? `row${i}`, cells);
    });
    for (const inp of data.inputs) probes.inputs.push({ port: inp.name ?? '', bit: inp.bit, pos: inp.pos });
    for (const l of data.lamps) probes.lamps.push({ port: l.name ?? '', bit: l.bit, pos: l.pos });
  }
  return { vox, probes, report: { ...rep, macros: macroInfo, nets: board.nets.length, msTotal: Math.round(performance.now() - t0) }, rom, data };
}
