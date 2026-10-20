import { ExportSettings, MC_DATA_VERSION_26_2, Structure } from '../compiler/compile';
import { BlockChoice, blockName } from '../compiler/materials';
import { ComputerProject } from '../computer/types';
import { buildLitematic, safeFileName } from '../export/litematic';
import { BuildSettings, Built, ClockKind, buildComputer, defaultBuildSettings } from './computer';
import { ContainerKind, DEFAULT_ROM_ITEM, containerDef, voxToStructure } from './export';
import { macroSettings } from './macro';
import { BuildMode, Plan, planComputer } from './plan';
import { LockTiming, TimedBuild, buildTimed } from './timing';

type XYZ = [number, number, number];

/** Настройки постройки и экспорта: выбор типа компонентов (контейнеры ПЗУ, блоки, варианты вентилей, такт, индикаторы). */
export interface ComputerExportSettings {
  /** program — оборудование урезано под одну программу; isa — всё, что нужно для набора инструкций (ПЗУ можно перепрошивать). */
  mode: BuildMode;
  programId?: string;
  /** ПЗУ: контейнер и предмет-заполнитель (нестакающийся). */
  container: ContainerKind;
  item: string;
  /** Матрица ПЗУ: бочки во всех клетках (перепрошивка вручную) или только в единицах. */
  romFull: boolean;
  /** Материалы проводящих и «логических» блоков, блок ламп. */
  wireBlock: BlockChoice;
  gateBlock: BlockChoice;
  lampBlock: string;
  /** Реализации вентилей, расстояния и т. п. для блоков логики (АЛУ, счётчик, управление). */
  macro: ExportSettings;
  clock: ClockKind;
  /** Для автогенератора: полупериод в игровых тиках, 0 — по замеру. */
  clockHalfTicks: number;
  /** Лампы счётчика команд, аккумулятора и флагов; лампы портов вывода. */
  indicators: boolean;
  portLamps: boolean;
  /** Подбирать зазор между фазами замков по замеру в симуляторе (рекомендуется). */
  autoTiming: boolean;
  guardRt: number;
  name: string;
  author: string;
  description: string;
}

export function defaultExportSettings(): ComputerExportSettings {
  const b = defaultBuildSettings();
  return {
    mode: 'program',
    container: 'barrel',
    item: DEFAULT_ROM_ITEM,
    romFull: b.romFull,
    wireBlock: { material: 'stone', color: 'gray' },
    gateBlock: { material: 'concrete', color: 'gray' },
    lampBlock: 'minecraft:redstone_lamp',
    macro: macroSettings(),
    clock: b.clock,
    clockHalfTicks: b.clockHalfTicks,
    indicators: b.indicators,
    portLamps: b.portLamps,
    autoTiming: true,
    guardRt: b.guardRt,
    name: 'Redstone Computer',
    author: 'RedLogic',
    description: 'Компьютер, собранный в RedLogic',
  };
}

export function buildSettingsOf(s: ComputerExportSettings): BuildSettings {
  return {
    romFull: s.romFull,
    macro: { ...s.macro, variants: s.macro.variants },
    indicators: s.indicators,
    portLamps: s.portLamps,
    clock: s.clock,
    clockHalfTicks: s.clockHalfTicks,
    guardRt: s.guardRt,
  };
}

export interface ComputerSummary {
  program: string;
  mode: BuildMode;
  size: { x: number; y: number; z: number };
  blocks: number;
  /** Число слов ПЗУ, разрядов в слове и разрядность счётчика команд. */
  romWords: number;
  romBits: number;
  pcBits: number;
  dataBits: number;
  /** Сколько предметов нужно положить в ПЗУ, чтобы оно читалось (с учётом выбранного контейнера). */
  romItems: number;
  romContainers: number;
  timing?: LockTiming;
  guardRt: number;
  halfPeriod?: number;
  buildMs: number;
}

export interface ComputerExport {
  plan: Plan;
  built: Built;
  timed?: TimedBuild;
  structure: Structure;
  /** Содержимое файла .litematic. */
  bytes: Uint8Array;
  fileName: string;
  /** Руководство к постройке (Markdown). */
  docs: string;
  summary: ComputerSummary;
}

export class ComputerBuildError extends Error {
  constructor(
    message: string,
    readonly issues: string[],
  ) {
    super(message);
  }
}

/** Планирует и строит компьютер, экспортирует в .litematic и готовит руководство. */
export function exportComputer(project: ComputerProject, s: ComputerExportSettings, progress: (msg: string) => void = () => {}): ComputerExport {
  const t0 = performance.now();
  progress('План постройки…');
  const plan = planComputer(project, { mode: s.mode, programId: s.programId });
  if (!plan.ok) throw new ComputerBuildError('Постройка невозможна', plan.issues.filter((i) => i.level === 'error').map((i) => i.message));
  const bs = buildSettingsOf(s);
  let built: Built;
  let timed: TimedBuild | undefined;
  if (s.autoTiming) {
    timed = buildTimed(plan, bs, progress);
    built = timed.built;
  } else built = buildComputer(plan, bs, progress);
  progress('Экспорт в схему…');
  const structure = voxToStructure(built.vox, { wireBlock: s.wireBlock, gateBlock: s.gateBlock, container: s.container, item: s.item, lampBlock: s.lampBlock });
  const bytes = buildLitematic(structure, { name: s.name, author: s.author, description: s.description, dataVersion: MC_DATA_VERSION_26_2 });
  const cont = containerDef(s.container);
  const ones = countOnes(plan);
  const summary: ComputerSummary = {
    program: plan.programName,
    mode: plan.mode,
    size: built.stats.size,
    blocks: built.stats.blocks,
    romWords: plan.rows.length,
    romBits: plan.columns.length,
    pcBits: plan.feat.P,
    dataBits: plan.feat.D,
    romItems: (s.romFull ? plan.rows.length * plan.columns.length : ones) * cont.slots,
    romContainers: s.romFull ? plan.rows.length * plan.columns.length : ones,
    timing: timed?.timing,
    guardRt: timed?.guardRt ?? s.guardRt,
    halfPeriod: timed?.halfPeriod,
    buildMs: Math.round(performance.now() - t0),
  };
  const fileName = `${safeFileName(s.name)}_${safeFileName(plan.programName)}.litematic`;
  progress('Руководство…');
  const docs = computerDocs(plan, built, s, summary);
  return { plan, built, timed, structure, bytes, fileName, docs, summary };
}

function countOnes(plan: Plan): number {
  let n = 0;
  for (let r = 0; r < plan.rows.length; r++) for (const c of plan.columns) if (c.bit(r)) n++;
  return n;
}

/** Руководство: как запускать постройку, где рычаги и лампы, что лежит в ПЗУ. Координаты — от минимального угла схемы (x, y, z). */
export function computerDocs(plan: Plan, built: Built, s: ComputerExportSettings, sum: ComputerSummary): string {
  const b = built.vox.bounds();
  const rel = (p: XYZ): string => `(${p[0] - b.x0}, ${p[1] - b.y0}, ${p[2] - b.z0})`;
  const cont = containerDef(s.container);
  const pr = built.probes;
  const L: string[] = [];
  L.push(`# ${s.name}: ${plan.programName}`);
  L.push('');
  L.push(`Схема для Minecraft Java 26.2 (Litematica, \`.litematic\`). Размер ${sum.size.x}×${sum.size.y}×${sum.size.z} блоков (X×Y×Z), всего блоков: ${sum.blocks}.`);
  L.push('Координаты ниже — смещения от минимального угла схемы (x, y, z).');
  L.push('');
  L.push('## Что построено');
  L.push('');
  L.push(`- Архитектура: однотактовый аккумуляторный процессор, ${sum.dataBits}-битные данные, счётчик команд ${sum.pcBits} бит.`);
  L.push(`- Режим: ${plan.mode === 'program' ? 'урезанное оборудование под одну программу (адреса сжаты)' : 'полный набор инструкций (ПЗУ можно перепрошивать)'}.`);
  L.push(`- ПЗУ: ${sum.romWords} слов × ${sum.romBits} бит, контейнер «${cont.name}» (${cont.block}), в каждом включённом бите ${cont.slots} шт. предмета ${s.item} (сигнал компаратора 15).`);
  L.push(`  ${s.romFull ? 'Контейнеры стоят во всех клетках матрицы: бит 1 — полный контейнер, бит 0 — пустой.' : 'Контейнеры стоят только в клетках с единицами; пустые клетки матрицы — это нули.'}`);
  L.push(`  Контейнеров с предметами: ${sum.romContainers} (предметов: ${sum.romItems}).`);
  L.push(`- Такт: ${s.clock === 'auto' ? 'автоматический генератор (кольцо повторителей), рычаг «стоп» останавливает его' : 'рычаг CLK (переключайте вручную: вверх — вниз = один такт)'}.`);
  if (sum.timing) {
    L.push(`- Замер в симуляторе: зазор между фазами замков ${sum.guardRt} тиков редстоуна, запас фаз ${sum.timing.fall}/${sum.timing.rise} игровых тиков, замки доходят до дальних триггеров за ${sum.timing.settle} игровых тиков.`);
    L.push(`  **Держите рычаг CLK в каждом положении не меньше ${sum.halfPeriod} игровых тиков (${((sum.halfPeriod ?? 0) / 20).toFixed(1)} с при 20 тик/с).** Быстрее — сбои.`);
    L.push('  Плата протяжённая, сигналам нужно время дойти от одного конца до другого — отсюда медленный такт. Ускорить можно сам мир: команда `/tick rate 200` (Java 1.20.3+) — все задержки редстоуна считаются в игровых тиках, поэтому плата работает так же, только в 10 раз быстрее; вернуть — `/tick rate 20`.');
  } else L.push(`- Зазор между фазами замков: ${sum.guardRt} тиков редстоуна (без замера в симуляторе: держите CLK в каждом положении подольше — несколько секунд).`);
  L.push('');
  L.push('## Запуск');
  L.push('');
  L.push('1. Загрузите чанки под всей схемой (она большая; в Litematica включите «Paste» либо поставьте командой `/forceload`).');
  L.push('2. Включите RESET, сделайте 2–3 такта CLK, выключите RESET — счётчик команд, аккумулятор и флаги обнулятся. ОЗУ не очищается.');
  L.push('3. Переключайте CLK: каждый такт выполняет одну инструкцию.');
  L.push('');
  L.push('## Рычаги');
  L.push('');
  L.push('| Назначение | Координаты |');
  L.push('|---|---|');
  if (pr.clk) L.push(`| CLK (такт) | ${rel(pr.clk)} |`);
  L.push(`| RESET (сброс) | ${rel(pr.reset)} |`);
  if (pr.clockStop) L.push(`| СТОП автогенератора (включён — такта нет) | ${rel(pr.clockStop)} |`);
  for (const inp of pr.inputs) L.push(`| Вход ${inp.port}, бит ${inp.bit} | ${rel(inp.pos)} |`);
  L.push('');
  const indicator = (title: string, cells: XYZ[]): void => {
    if (cells.length === 0) return;
    L.push(`- ${title}: ` + cells.map((c, i) => `бит ${i} ${rel(c)}`).join('; '));
  };
  L.push('## Что смотреть');
  L.push('');
  L.push('Состояния триггеров (в игре это повторители; лампы-индикаторы на плате повторяют те же значения):');
  L.push('');
  indicator('счётчик команд PC', pr.pc);
  indicator('аккумулятор A', pr.a);
  for (const f of ['Z', 'C', 'N', 'V'] as const) if (pr.flags[f]) L.push(`- флаг ${f}: ${rel(pr.flags[f]!)}`);
  if (pr.lamps.length) {
    L.push('');
    L.push('Лампы портов вывода:');
    L.push('');
    for (const l of pr.lamps) L.push(`- ${l.port}, бит ${l.bit}: ${rel(l.pos)}`);
  }
  L.push('');
  L.push('## Области платы');
  L.push('');
  L.push('| Область | X | Z |');
  L.push('|---|---|---|');
  for (const r of built.regions) L.push(`| ${r.name} | ${r.x0 - b.x0}…${r.x1 - b.x0} | ${r.z0 - b.z0}…${r.z1 - b.z0} |`);
  L.push('');
  L.push('## Содержимое ПЗУ');
  L.push('');
  L.push('Каждое слово ПЗУ — готовое управляющее слово (декодер инструкций «зашит» в ПЗУ). Столбцы: ' + plan.columns.map((c) => `\`${c.name}\``).join(', ') + '.');
  L.push('');
  L.push('| Адрес | Инструкция | ' + plan.columns.map((c) => c.name).join(' | ') + ' |');
  L.push('|---|---|' + plan.columns.map(() => '---').join('|') + '|');
  plan.rows.forEach((row, r) => {
    L.push(`| ${r} | ${row.text.replace(/\|/g, '/')} | ` + plan.columns.map((c) => (c.bit(r) ? '1' : '0')).join(' | ') + ' |');
  });
  L.push('');
  if (plan.skippedPorts.length) {
    L.push('Порты без оборудования (записи в них в железе игнорируются): ' + plan.skippedPorts.join(', ') + '.');
    L.push('');
  }
  L.push('## Компоненты');
  L.push('');
  L.push(`- Провода и опоры: ${blockName(s.wireBlock)}; корпуса вентилей: ${blockName(s.gateBlock)}; лампы: ${s.lampBlock}.`);
  L.push(`- Блоки логики (АЛУ, счётчик, управление) скомпилированы из вентилей с выбранными вариантами реализации.`);
  L.push('');
  return L.join('\n');
}
