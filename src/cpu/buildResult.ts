import { Structure } from '../compiler/compile';
import { ComputerExport, ComputerSummary } from './computerExport';

type XYZ = [number, number, number];

/** То, что нужно интерфейсу после постройки (только простые данные — их можно передать из воркера). */
export interface BuildOutput {
  fileName: string;
  bytes: Uint8Array;
  docs: string;
  summary: ComputerSummary;
  structure: Structure;
  /** Области платы в координатах схемы (от минимального угла). */
  regions: { name: string; x0: number; x1: number; z0: number; z1: number }[];
  /** Рычаги и лампы в координатах схемы. */
  controls: { name: string; kind: 'lever' | 'lamp' | 'state'; pos: XYZ }[];
  issues: string[];
  skippedPorts: string[];
}

export function toBuildOutput(e: ComputerExport): BuildOutput {
  const b = e.built.vox.bounds();
  const rel = (p: XYZ): XYZ => [p[0] - b.x0, p[1] - b.y0, p[2] - b.z0];
  const pr = e.built.probes;
  const controls: BuildOutput['controls'] = [];
  if (pr.clk) controls.push({ name: 'CLK', kind: 'lever', pos: rel(pr.clk) });
  controls.push({ name: 'RESET', kind: 'lever', pos: rel(pr.reset) });
  if (pr.clockStop) controls.push({ name: 'СТОП', kind: 'lever', pos: rel(pr.clockStop) });
  for (const i of pr.inputs) controls.push({ name: `${i.port}${i.bit}`, kind: 'lever', pos: rel(i.pos) });
  for (const l of pr.lamps) controls.push({ name: `${l.port}${l.bit}`, kind: 'lamp', pos: rel(l.pos) });
  pr.pc.forEach((c, i) => controls.push({ name: `PC${i}`, kind: 'state', pos: rel(c) }));
  pr.a.forEach((c, i) => controls.push({ name: `A${i}`, kind: 'state', pos: rel(c) }));
  return {
    fileName: e.fileName,
    bytes: e.bytes,
    docs: e.docs,
    summary: e.summary,
    structure: e.structure,
    regions: e.built.regions.map((r) => ({ name: r.name, x0: r.x0 - b.x0, x1: r.x1 - b.x0, z0: r.z0 - b.z0, z1: r.z1 - b.z0 })),
    controls,
    issues: e.plan.issues.map((i) => `${i.level === 'error' ? 'Ошибка' : 'Предупреждение'}: ${i.message}`),
    skippedPorts: e.plan.skippedPorts,
  };
}
