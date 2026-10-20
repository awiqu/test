import { it } from 'vitest';
import { newProject } from '../../src/computer/project';
import { planComputer } from '../../src/cpu/plan';
import { buildComputer, defaultBuildSettings } from '../../src/cpu/computer';
import { TickSim } from '../../src/cpu/tick';

it('dbg', () => {
  const out = (s: string) => process.stderr.write(s + '\n');
  const p = newProject('acc4');
  const plan = planComputer(p, { mode: 'program', programId: p.programs[0].id });
  const t0 = performance.now();
  const b = buildComputer(plan, defaultBuildSettings());
  out(`build ${Math.round(performance.now() - t0)} ms size ${JSON.stringify(b.stats.size)} blocks ${b.stats.blocks} nets ${b.stats.nets} wraps ${b.stats.wraps}`);
  const sim = new TickSim(b.vox);
  const pr = b.probes;
  const bits = (cells: [number, number, number][]) => cells.map((c) => (sim.powerAt(...c) > 0 ? 1 : 0)).join('');
  out('initial settle ' + sim.settle(200000) + ' pc=' + bits(pr.pc) + ' a=' + bits(pr.a));
  sim.setLever(...pr.reset, true);
  out('reset settle ' + sim.settle(200000) + ' pc=' + bits(pr.pc));
  for (let c = 0; c < 2; c++) {
    sim.setLever(...pr.clk!, true); const r1 = sim.settle(200000);
    sim.setLever(...pr.clk!, false); const r2 = sim.settle(200000);
    out(`reset cycle ${c}: ${r1}/${r2} pc=${bits(pr.pc)} a=${bits(pr.a)}`);
  }
  sim.setLever(...pr.reset, false);
  out('release settle ' + sim.settle(200000) + ' pc=' + bits(pr.pc) + ' a=' + bits(pr.a));
  for (let c = 0; c < 8; c++) {
    sim.setLever(...pr.clk!, true); const r1 = sim.settle(200000);
    sim.setLever(...pr.clk!, false); const r2 = sim.settle(200000);
    out(`run cycle ${c}: settle ${r1}/${r2} pc=${bits(pr.pc)} a=${bits(pr.a)}`);
  }
}, 900000);
