import { it } from 'vitest';
import { appendFileSync } from 'node:fs';
import { compile, defaultSettings } from '../src/compiler/compile';
import { randomCircuit } from './helpers';

it.skipIf(!process.env.PERF)('perf', { timeout: 600000 }, () => {
  for (const [seed, nin, ng] of [[21, 5, 20], [22, 6, 25], [23, 4, 30], [24, 8, 40]] as [number, number, number][]) {
    const c = randomCircuit(seed, nin, ng);
    const t0 = performance.now();
    const r = compile(c, defaultSettings());
    appendFileSync('/tmp/perf.txt', `seed ${seed} gates=${c.gates.length} ok=${r.ok} ${r.structure ? `${r.structure.sx}x${r.structure.sy}x${r.structure.sz}` : ''} att=${r.stats?.attempts} ${Math.round(performance.now() - t0)}ms ${r.issues.map((i) => i.message).join('|')} ${r.verify?.message ?? ''}\n`);
  }
});
