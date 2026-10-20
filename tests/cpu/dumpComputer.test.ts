// Выгрузка собранного компьютера для проверки на настоящем сервере (scripts/mc_verify_computer.py).
// Запуск: DUMP_COMPUTER=1 [RICH=1 | REG=1 | REGRICH=1] [PROGRAM=0] [STEPS=12] [SWITCHES=0] npx vitest run tests/cpu/dumpComputer.test.ts
import { describe, it } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { newProject } from '../../src/computer/project';
import { assemble } from '../../src/computer/asm';
import { Machine } from '../../src/computer/sim';
import { defaultExportSettings, exportComputer } from '../../src/cpu/computerExport';
import { richProject } from './richProject';
import { regProject, regRichProject } from './regProject';

const dir = process.env.DUMP_DIR ?? '/tmp/mccomp';

describe.skipIf(!process.env.DUMP_COMPUTER)('dump computer for the real server', () => {
  it('writes litematic and expectations', () => {
    mkdirSync(dir, { recursive: true });
    const p = process.env.REGRICH ? regRichProject().project : process.env.REG ? regProject() : process.env.RICH ? richProject().project : newProject('acc4');
    const idx = Number(process.env.PROGRAM ?? 0);
    p.programs = [p.programs[idx]];
    const switches = Number(process.env.SWITCHES ?? 0);
    const e = exportComputer(p, { ...defaultExportSettings() }, (m) => process.stderr.write(m + '\n'));
    writeFileSync(`${dir}/computer.litematic`, e.bytes);
    writeFileSync(`${dir}/computer.md`, e.docs);
    const b = e.built.vox.bounds();
    const rel = (c: [number, number, number]) => [c[0] - b.x0, c[1] - b.y0, c[2] - b.z0];
    const pr = e.built.probes;
    const asm = assemble(p.programs[0].source, p.spec, p.instructions, p.asm);
    const m = new Machine(p.spec, p.instructions, asm.words);
    const sw = m.device('switches');
    if (sw) for (let i = 0; i < sw.count; i++) sw.set(i, ((switches >> i) & 1) === 1);
    const steps: unknown[] = [];
    const n = Number(process.env.STEPS ?? 12);
    for (let k = 0; k < n && !m.halted; k++) {
      m.step();
      const leds = m.device('leds');
      const seg = m.device('sevenseg');
      steps.push({ pc: m.pc, a: m.env.R[0], regs: [...m.env.R], flags: { ...m.env.flags }, ram: [...m.ram], leds: leds ? leds.peek() : null, seg: seg ? seg.peek() : null });
    }
    const out = {
      size: [e.summary.size.x, e.summary.size.y, e.summary.size.z],
      halfPeriod: e.summary.halfPeriod,
      clk: pr.clk ? rel(pr.clk) : null,
      reset: rel(pr.reset),
      pc: pr.pc.map(rel),
      a: pr.a.map(rel),
      regs: Object.fromEntries([...pr.regs].map(([r, cells]) => [r, cells.map(rel)])),
      flags: Object.fromEntries(Object.entries(pr.flags).map(([k, v]) => [k, rel(v as [number, number, number])])),
      ram: Object.fromEntries([...pr.ram].map(([k, v]) => [k, v.map(rel)])),
      inputs: pr.inputs.map((i) => ({ port: i.port, bit: i.bit, pos: rel(i.pos) })),
      lamps: pr.lamps.map((l) => ({ port: l.port, bit: l.bit, pos: rel(l.pos) })),
      switches,
      steps,
    };
    writeFileSync(`${dir}/expect.json`, JSON.stringify(out));
    process.stderr.write(`written ${e.bytes.length} bytes; size ${out.size}; half ${out.halfPeriod}\n`);
  }, 600000);
});
