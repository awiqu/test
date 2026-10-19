// Выгружает скомпилированные схемы и ожидаемые таблицы истинности для проверки на настоящем сервере Minecraft
// (scripts/mc_verify.py). Запускается только при DUMP=1.
import { describe, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Circuit, GateType } from '../src/model/types';
import { addWire, createGate, exampleCircuit } from '../src/model/circuit';
import { compile, defaultSettings, ExportSettings } from '../src/compiler/compile';
import { GATE_VARIANTS } from '../src/compiler/variants';
import { evaluate } from '../src/sim/logic';
import { K } from '../src/compiler/voxel';
import { randomCircuit } from './helpers';

const OUT = process.env.DUMP_DIR ?? '/tmp/mcverify';

function dump(name: string, circuit: Circuit, settings: ExportSettings = defaultSettings()): string {
  const res = compile(circuit, settings);
  if (!res.ok || !res.structure) return `${name}: КОМПИЛЯЦИЯ НЕ УДАЛАСЬ ${res.issues.map((i) => i.message).join('|')}`;
  const s = res.structure;
  const inputs = circuit.gates.filter((g) => g.type === 'INPUT');
  const outputs = circuit.gates.filter((g) => g.type === 'OUTPUT');
  const pos = (label: string, kind: 'in' | 'out') => {
    const m = s.markers.find((q) => q.text === label && q.kind === kind);
    return m ? [m.x, m.y, m.z] : null;
  };
  const used = inputs.filter((g) => pos(g.label, 'in'));
  const truth: { in: Record<string, boolean>; out: Record<string, boolean> }[] = [];
  for (let m = 0; m < 1 << used.length; m++) {
    const vals = new Map<string, boolean>();
    const inMap: Record<string, boolean> = {};
    used.forEach((g, i) => {
      const v = ((m >> i) & 1) === 1;
      vals.set(g.id, v);
      inMap[g.label] = v;
    });
    const st = evaluate(circuit, vals);
    const outMap: Record<string, boolean> = {};
    for (const o of outputs) outMap[o.label] = st.out.get(o.id) ?? false;
    truth.push({ in: inMap, out: outMap });
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(
    `${OUT}/${name}.json`,
    JSON.stringify({
      name,
      size: [s.sx, s.sy, s.sz],
      blocks: s.blocks.map((b) => [b.x, b.y, b.z, b.spec.name, b.spec.props ?? {}, b.kind === K.Solid ? 0 : 1]),
      inputs: Object.fromEntries(used.map((g) => [g.label, pos(g.label, 'in')])),
      outputs: Object.fromEntries(outputs.map((g) => [g.label, pos(g.label, 'out')])),
      truth,
    }),
  );
  return `${name}: ${s.sx}x${s.sy}x${s.sz}, ${s.blocks.length} блоков, vectors=${truth.length}`;
}

function single(type: GateType, inputs: number, delay = 1): Circuit {
  let c: Circuit = { gates: [], wires: [] };
  const ins = Array.from({ length: type === 'NOT' || type === 'BUFFER' ? 1 : inputs }, (_, i) => createGate('INPUT', 0, i * 60, 'abcd'[i]));
  const g = createGate(type, 200, 0);
  g.inputs = type === 'NOT' || type === 'BUFFER' ? 1 : inputs;
  g.delay = delay;
  const o = createGate('OUTPUT', 400, 0, 'q');
  c.gates.push(...ins, g, o);
  ins.forEach((i, p) => (c = addWire(c, i.id, g.id, p)));
  c = addWire(c, g.id, o.id, 0);
  return c;
}

describe.skipIf(!process.env.DUMP)('dump for the real server', () => {
  it('dumps', () => {
    const lines: string[] = [];
    lines.push(dump('example', exampleCircuit()));
    for (const seed of [1, 2, 3, 5, 7, 8, 10, 11, 13]) lines.push(dump(`random${seed}`, randomCircuit(seed, 2 + (seed % 3), 3 + (seed % 7))));
    const types: GateType[] = ['NOT', 'BUFFER', 'AND', 'NAND', 'OR', 'NOR', 'XOR', 'XNOR'];
    for (const t of types) {
      const counts = t === 'NOT' || t === 'BUFFER' ? [1] : [2, 3, 4];
      const variants = GATE_VARIANTS[t] ?? [{ id: 'default' }];
      for (const v of variants) {
        for (const k of counts) {
          const s = defaultSettings();
          s.variants = { ...s.variants, [t]: v.id };
          lines.push(dump(`${t}_${v.id}_${k}`, single(t, k, t === 'BUFFER' ? 3 : 1), s));
        }
      }
    }
    // кнопки вместо рычагов и подложка
    const s2 = defaultSettings();
    s2.floorPlate = true;
    lines.push(dump('example_plate', exampleCircuit(), s2));
    writeFileSync(`${OUT}/_index.txt`, lines.join('\n'));
    console.log(lines.join('\n'));
  });
});
