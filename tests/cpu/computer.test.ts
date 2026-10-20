import { describe, it, expect } from 'vitest';
import { newProject } from '../../src/computer/project';
import { assemble } from '../../src/computer/asm';
import { Machine } from '../../src/computer/sim';
import { portMap } from '../../src/computer/spec';
import { planComputer } from '../../src/cpu/plan';
import { Built, buildComputer, defaultBuildSettings } from '../../src/cpu/computer';
import { TickSim } from '../../src/cpu/tick';

const log = (s: string) => process.stderr.write(s + '\n');
type XYZ = [number, number, number];

/** Прогоняет построенный компьютер в тиковом симуляторе и сравнивает с эмулятором после каждой инструкции. */
function compareRun(built: Built, source: string, cycles: number, half: number): string | null {
  const project = newProject('acc4');
  const spec = project.spec;
  const asm = assemble(source, spec, project.instructions, project.asm);
  const m = new Machine(spec, project.instructions, asm.words);
  const sim = new TickSim(built.vox);
  const pr = built.probes;
  const bits = (cells: XYZ[]) => cells.reduce((a, c, i) => a + ((sim.powerAt(...c) > 0 ? 1 : 0) << i), 0);
  const lever = (p: XYZ, on: boolean) => sim.setLever(...p, on);
  const cycle = () => {
    lever(pr.clk, true);
    sim.run(half);
    lever(pr.clk, false);
    sim.run(half);
  };
  lever(pr.reset, true);
  cycle();
  cycle();
  lever(pr.reset, false);
  if (bits(pr.pc) !== 0) return `после сброса PC=${bits(pr.pc)}`;
  const ports = portMap(spec);
  for (let k = 0; k < cycles; k++) {
    if (m.halted) break;
    m.step();
    cycle();
    const pc = bits(pr.pc);
    const a = bits(pr.a);
    const wantPc = m.halted ? m.pc : m.pc;
    if (pc !== wantPc && !m.halted) return `шаг ${k}: PC ${pc}, ожидалось ${wantPc}`;
    if (a !== m.env.R[0]) return `шаг ${k}: A=${a}, ожидалось ${m.env.R[0]} (PC ${m.pc})`;
    for (const [name, cells] of pr.ram) {
      const mm = /^M\[(\d+)\]$/.exec(name);
      if (!mm) continue;
      const want = m.ram[Number(mm[1])];
      const got = cells.reduce((acc, c, i) => acc + ((sim.litAt(...c) ? 1 : 0) << i), 0);
      if (got !== want) return `шаг ${k}: M[${mm[1]}]=${got}, ожидалось ${want}`;
    }
    void ports;
  }
  return null;
}

describe('physical computer', () => {
  it('builds and runs the acc4 counter', () => {
    const p = newProject('acc4');
    const prog = p.programs[0];
    const plan = planComputer(p, { mode: 'program', programId: prog.id });
    expect(plan.ok).toBe(true);
    const t0 = performance.now();
    const b = buildComputer(plan, defaultBuildSettings(), (msg) => log(`  ${Math.round(performance.now() - t0)} ms: ${msg}`));
    log('built: ' + JSON.stringify(b.report));
    const bnd = b.vox.bounds();
    log(`bounds ${JSON.stringify(bnd)} blocks ${b.vox.size}`);
    const err = compareRun(b, prog.source, 40, 600);
    expect(err).toBeNull();
  }, 3600000);
});
