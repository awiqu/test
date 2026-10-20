import { describe, it, expect } from 'vitest';
import { newProject } from '../../src/computer/project';
import { assemble } from '../../src/computer/asm';
import { Machine } from '../../src/computer/sim';
import { ComputerProject } from '../../src/computer/types';
import { BuildMode, planComputer } from '../../src/cpu/plan';
import { Built, BuildSettings, defaultBuildSettings } from '../../src/cpu/computer';
import { buildTimed } from '../../src/cpu/timing';
import { TickSim } from '../../src/cpu/tick';
import { richProject } from './richProject';
import { regProject, regRichProject } from './regProject';
import { macroSettings } from '../../src/cpu/macro';

const log = (s: string) => process.stderr.write(s + '\n');
type XYZ = [number, number, number];

interface RunOptions {
  cycles: number;
  high?: number;
  low?: number;
  /** Положение рычагов порта ввода (младший бит — первый рычаг). */
  switches?: number;
  mode?: BuildMode;
  settings?: Partial<BuildSettings>;
}

/** Строит физический компьютер, прогоняет его в тиковом симуляторе и сравнивает с эмулятором после каждой инструкции. */
function physicalVsEmulator(project: ComputerProject, source: string, o: RunOptions): string | null {
  const spec = project.spec;
  const plan = planComputer(project, { mode: o.mode ?? 'program', source });
  if (!plan.ok) return 'план: ' + plan.issues.map((i) => i.message).join('; ');
  const timed = buildTimed(plan, { ...defaultBuildSettings(), ...o.settings });
  const built: Built = timed.built;
  log(`guard ${timed.guardRt} rt, запас фаз ${timed.timing.fall}/${timed.timing.rise} gt, замки доходят за ${timed.timing.settle} gt, фаза ${timed.halfPeriod} gt`);
  const asm = assemble(source, spec, project.instructions, project.asm);
  const m = new Machine(spec, project.instructions, asm.words);
  const sw = m.device('switches');
  if (sw) for (let b = 0; b < sw.count; b++) sw.set(b, (((o.switches ?? 0) >> b) & 1) === 1);
  const sim = new TickSim(built.vox);
  const pr = built.probes;
  for (const inp of pr.inputs) if (inp.port === 'SWITCH') sim.setLever(...inp.pos, (((o.switches ?? 0) >> inp.bit) & 1) === 1);
  const bits = (cells: XYZ[]) => cells.reduce((a, c, i) => a + ((sim.powerAt(...c) > 0 ? 1 : 0) << i), 0);
  const lever = (p: XYZ, on: boolean) => sim.setLever(...p, on);
  const high = o.high ?? timed.halfPeriod;
  const low = o.low ?? timed.halfPeriod;
  const cycle = () => {
    lever(pr.clk!, true);
    sim.run(high);
    lever(pr.clk!, false);
    sim.run(low);
  };
  sim.settle(100000);
  // содержимое ОЗУ и портов после включения неопределено (гонка сигналов); эмулятор считает его нулевым — как и проверка на сервере
  for (const cells of pr.ram.values()) for (const c of cells) sim.forceRepeater(...c, false);
  sim.run(200);
  lever(pr.reset, true);
  sim.run(Math.max(800, high));
  cycle();
  cycle();
  lever(pr.reset, false);
  sim.run(Math.max(800, high));
  if (bits(pr.pc) !== 0) return `после сброса PC=${bits(pr.pc)}`;
  const lampValue = (port: string): number => pr.lamps.filter((l) => l.port === port).reduce((a, l) => a + ((sim.litAt(...l.pos) ? 1 : 0) << l.bit), 0);
  for (let k = 0; k < o.cycles; k++) {
    if (m.halted) break;
    if (m.pc >= plan.rows.length - 1) break;
    m.step();
    cycle();
    const pc = bits(pr.pc);
    const a = bits(pr.a);
    if (!m.halted && pc !== m.pc) return `шаг ${k}: PC ${pc}, ожидалось ${m.pc}`;
    if (spec.arch === 'accumulator' && a !== m.env.R[0]) return `шаг ${k}: A=${a}, ожидалось ${m.env.R[0]} (PC ${m.pc})`;
    if (spec.arch === 'register') {
      for (let r = 0; r < spec.regCount; r++) {
        const cells = pr.regs.get(r);
        const got = cells ? bits(cells) : 0;
        if (got !== m.env.R[r]) return `шаг ${k}: R${r}=${got}, ожидалось ${m.env.R[r]} (PC ${m.pc})`;
      }
    }
    for (const f of spec.flags) {
      const cell = pr.flags[f];
      if (cell && plan.feat.flags.includes(f) && sim.powerAt(...cell) > 0 !== (m.env.flags[f] === 1)) return `шаг ${k}: флаг ${f}=${sim.powerAt(...cell) > 0 ? 1 : 0}, ожидалось ${m.env.flags[f]}`;
    }
    for (const [name, cells] of pr.ram) {
      const mm = /^M\[(\d+)\]$/.exec(name);
      if (!mm) continue;
      const got = cells.reduce((acc, c, i) => acc + ((sim.litAt(...c) ? 1 : 0) << i), 0);
      if (got !== m.ram[Number(mm[1])]) return `шаг ${k}: M[${mm[1]}]=${got}, ожидалось ${m.ram[Number(mm[1])]}`;
    }
    const leds = m.device('leds');
    if (leds && pr.lamps.some((l) => l.port === 'LEDS') && lampValue('LEDS') !== leds.peek()) return `шаг ${k}: LEDS=${lampValue('LEDS')}, ожидалось ${leds.peek()}`;
    const seg = m.device('sevenseg');
    if (seg && pr.lamps.some((l) => l.port === 'SEG') && lampValue('SEG') !== seg.peek()) return `шаг ${k}: SEG=${lampValue('SEG')}, ожидалось ${seg.peek()}`;
  }
  return null;
}

describe('physical computer = emulator (tick simulator)', () => {
  it('acc4 counter', () => {
    const p = newProject('acc4');
    const t0 = performance.now();
    expect(physicalVsEmulator(p, p.programs[0].source, { cycles: 30 })).toBeNull();
    log(`counter: ${Math.round(performance.now() - t0)} ms`);
  }, 1800000);

  it('acc4 sum of switches (input port, LEDS and SEG outputs)', () => {
    const p = newProject('acc4');
    expect(physicalVsEmulator(p, p.programs[1].source, { cycles: 16, switches: 0b0101 })).toBeNull();
  }, 1800000);

  it('register machine: registers, memory, ports', () => {
    const p = regProject();
    expect(physicalVsEmulator(p, p.programs[0].source, { cycles: 12 })).toBeNull();
  }, 3600000);

  it('register machine: ALU, flags, indirect memory (LDR/STR), jumps and JR', () => {
    const { project, source } = regRichProject();
    expect(physicalVsEmulator(project, source, { cycles: 30 })).toBeNull();
  }, 3600000);

  it('alternative gate variants (OR/AND/NOR/XOR implementations) still compute correctly', () => {
    const p = newProject('acc4');
    const macro = macroSettings({ variants: { OR: 'nor-not', AND: 'merge-not', NOR: 'merge-not', XOR: 'and-or' } });
    expect(physicalVsEmulator(p, p.programs[1].source, { cycles: 14, switches: 0b0110, settings: { macro } })).toBeNull();
  }, 1800000);

  it('richer ISA: arithmetic, logic, shifts, flags and jumps', () => {
    const { project, source } = richProject();
    log('ISA: ' + project.instructions.map((i) => i.mnemonic).join(' '));
    expect(physicalVsEmulator(project, source, { cycles: 40 })).toBeNull();
  }, 3600000);
});
