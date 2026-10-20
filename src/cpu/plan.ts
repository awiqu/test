import { ComputerProject, FlagName, Issue } from '../computer/types';
import { assemble, disassemble } from '../computer/asm';
import { portMap } from '../computer/spec';
import { CTL_NAMES, CtlName, MicroRow, deriveControl, expandRom, fieldWidth, emptyCtl } from './micro';
import { Feat, JUMP_CTLS } from './hwnets';
import { DataRow } from './dataarray';

export type BuildMode = 'program' | 'isa';

export interface PlanOptions {
  /** program — оборудование урезано под программу (компактно); isa — всё, что нужно для любых поддерживаемых инструкций, ПЗУ можно перепрошивать. */
  mode: BuildMode;
  /** Номер программы в проекте (по id) или готовый исходник. */
  programId?: string;
  source?: string;
}

export interface RomColumn {
  name: string;
  /** Значение бита в строке ПЗУ. */
  bit: (row: number) => boolean;
}

export interface Plan {
  ok: boolean;
  issues: Issue[];
  feat: Feat;
  /** Строки управления (в порядке адресов; последняя может быть служебной остановкой). */
  rows: MicroRow[];
  columns: RomColumn[];
  dataRows: DataRow[];
  /** Соответствие «адрес в программе → индекс строки в массиве данных» (для сжатия адресов). */
  addrIndex: Map<number, number>;
  hasAlu: boolean;
  hasData: boolean;
  /** Порты устройств, которых нет в железе. */
  skippedPorts: string[];
  programName: string;
  mode: BuildMode;
}

const log2c = (n: number): number => Math.max(1, Math.ceil(Math.log2(Math.max(2, n))));

export function planComputer(project: ComputerProject, opts: PlanOptions): Plan {
  const spec = project.spec;
  const issues: Issue[] = [];
  const err = (message: string, where?: string): void => void issues.push({ level: 'error', message, where });
  const warn = (message: string, where?: string): void => void issues.push({ level: 'warning', message, where });
  const empty: Plan = {
    ok: false,
    issues,
    feat: { D: spec.dataBits, P: 1, RA: 1, OB: 1, used: new Set(), flags: [] },
    rows: [],
    columns: [],
    dataRows: [],
    addrIndex: new Map(),
    hasAlu: false,
    hasData: false,
    skippedPorts: [],
    programName: '',
    mode: opts.mode,
  };
  if (spec.arch !== 'accumulator') {
    err('Физическая постройка пока поддерживает только аккумуляторную архитектуру (один регистр A).');
    return empty;
  }
  if (spec.stack.enabled) warn('Стек в физической постройке не реализован: инструкции PUSH/POP/CALL/RET не поддерживаются.');
  const prog = opts.programId ? project.programs.find((p) => p.id === opts.programId) : project.programs[0];
  const source = opts.source ?? prog?.source;
  if (source === undefined) {
    err('Нет программы для постройки.');
    return empty;
  }
  empty.programName = prog?.name ?? 'Программа';
  const asm = assemble(source, spec, project.instructions, project.asm);
  if (!asm.ok) {
    for (const i of asm.issues) if (i.level === 'error') err(`Программа: ${i.message}${i.line ? ` (строка ${i.line})` : ''}`);
    return empty;
  }
  const size = asm.size;
  if (size === 0) {
    err('Программа пуста.');
    return empty;
  }
  const dis = (w: number): string => disassemble(w, spec, project.instructions, project.asm);
  const micro = expandRom(asm.words, size, spec, project.instructions, dis);
  for (const e of micro.errors) err(e);
  if (micro.errors.length) return empty;
  const rows = micro.rows.map((r) => ({ ...r, ctl: { ...r.ctl } }));

  // Аппаратная остановка после последней инструкции (в эмуляторе выход за ПЗУ — ошибка и остановка)
  const limitRows = 2 ** spec.pcBits;
  if (rows.length < limitRows) {
    const ctl = emptyCtl();
    ctl.halt = true;
    rows.push({ address: rows.length, ob: 0, ctl, mnemonic: 'HLT*', text: '(остановка за концом программы)' });
  }

  // Какие сигналы нужны
  const used = new Set<CtlName>();
  for (const r of rows) for (const n of CTL_NAMES) if (r.ctl[n]) used.add(n);
  if (opts.mode === 'isa') {
    for (const inst of project.instructions) {
      const d = deriveControl(inst, spec);
      if (d.micro) {
        for (const n of CTL_NAMES) if (d.micro.ctl[n]) used.add(n);
      } else warn(`Инструкция ${inst.mnemonic} не выполняется физическим процессором: ${d.error}`, inst.mnemonic);
    }
  }

  // Память данных
  const ports = portMap(spec);
  const memAddrs = new Set<number>();
  for (const r of rows) if (r.ctl.uMem || r.ctl.weM) memAddrs.add(r.ob);
  const dataRows: DataRow[] = [];
  const skippedPorts: string[] = [];
  const addrIndex = new Map<number, number>();
  const rowFor = (addr: number, idx: number): DataRow | null => {
    if (addr < spec.ramWords) return { addr: idx, kind: 'ram', name: `M[${addr}]` };
    const p = ports.find((q) => q.addr === addr);
    if (!p) return null;
    const dev = spec.devices.find((d) => d.id === p.device);
    if (p.type === 'leds' || p.type === 'sevenseg') {
      const count = p.type === 'leds' ? Math.min(dev?.options.count ?? spec.dataBits, spec.dataBits) : spec.dataBits;
      if (p.access === 'r') return null;
      return { addr: idx, kind: 'out', count, name: p.name };
    }
    if (p.type === 'switches' || p.type === 'buttons') {
      const count = Math.min(dev?.options.count ?? spec.dataBits, spec.dataBits);
      return { addr: idx, kind: 'in', count, device: p.type === 'buttons' ? 'button' : 'lever', name: p.name };
    }
    skippedPorts.push(p.name);
    return null;
  };
  let RA: number;
  if (opts.mode === 'program') {
    const sorted = [...memAddrs].sort((a, b) => a - b);
    sorted.forEach((a, i) => addrIndex.set(a, i));
    RA = log2c(sorted.length);
    for (const a of sorted) {
      const row = rowFor(a, addrIndex.get(a)!);
      if (row) dataRows.push(row);
    }
  } else {
    RA = spec.ramAddrBits;
    for (let a = 0; a < 2 ** spec.ramAddrBits; a++) {
      addrIndex.set(a, a);
      const row = rowFor(a, a);
      if (row) dataRows.push(row);
    }
  }
  if (skippedPorts.length) warn(`Устройства без физической реализации: порты ${[...new Set(skippedPorts)].join(', ')} не работают (чтение даёт 0, запись игнорируется).`);
  const hasData = memAddrs.size > 0 || opts.mode === 'isa';

  // Сжатие адресов и размеры
  const P = opts.mode === 'program' ? log2c(rows.length) : spec.pcBits;
  for (const r of rows) {
    if (r.ctl.uMem || r.ctl.weM) r.ob = addrIndex.get(r.ob) ?? 0;
    const jumps = JUMP_CTLS.some((j) => r.ctl[j]);
    if (jumps && r.ob >= 2 ** P) err(`Адрес ${r.address}: переход на ${r.ob}, а счётчик команд ${P}-битный (доступно ${2 ** P} адресов).`);
  }
  if (issues.some((i) => i.level === 'error')) return { ...empty, issues };

  let OB = 1;
  for (const r of rows) {
    const jumps = JUMP_CTLS.some((j) => r.ctl[j]);
    const w = jumps ? P : r.ctl.uMem || r.ctl.weM ? RA : r.ctl.uImm ? spec.dataBits : 0;
    OB = Math.max(OB, w);
  }
  if (opts.mode === 'isa') OB = Math.max(OB, P, RA, spec.dataBits);

  // Флаги: триггеры строятся только для тех, что читают условия переходов
  const flagOf: Partial<Record<CtlName, FlagName>> = { jZ: 'Z', jNZ: 'Z', jC: 'C', jNC: 'C', jN: 'N', jNN: 'N', jV: 'V', jNV: 'V' };
  const flags: FlagName[] = [];
  for (const n of used) {
    const f = flagOf[n];
    if (f && spec.flags.includes(f) && !flags.includes(f)) flags.push(f);
  }
  const hasAlu = used.has('weA') || used.has('weF');
  if (!used.has('weF')) flags.length = 0;

  const feat: Feat = { D: spec.dataBits, P, RA, OB, used, flags };

  // Столбцы ПЗУ
  const columns: RomColumn[] = [];
  for (let i = 0; i < OB; i++) columns.push({ name: `ob${i}`, bit: (r) => ((rows[r]?.ob ?? 0) >> i & 1) === 1 });
  for (const n of CTL_NAMES) if (used.has(n) && n !== 'weA' && n !== 'weF') columns.push({ name: n, bit: (r) => rows[r]?.ctl[n] === true });
  if (used.has('weA')) columns.push({ name: 'nweA', bit: (r) => rows[r]?.ctl.weA !== true });
  if (used.has('weF')) columns.push({ name: 'nweF', bit: (r) => rows[r]?.ctl.weF !== true });
  void fieldWidth;
  return {
    ok: true,
    issues,
    feat,
    rows,
    columns,
    dataRows,
    addrIndex,
    hasAlu,
    hasData,
    skippedPorts,
    programName: empty.programName,
    mode: opts.mode,
  };
}
