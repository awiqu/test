import { Circuit, Gate, GateType } from '../src/model/types';
import { addWire, createGate } from '../src/model/circuit';
import { CompileResult } from '../src/compiler/compile';
import { K } from '../src/compiler/voxel';

/** ASCII-вид слоёв для отладки. */
export function ascii(res: CompileResult): string {
  const s = res.structure!;
  const lines: string[] = [];
  for (let y = 0; y < s.sy; y++) {
    lines.push(`--- y=${y} ---`);
    for (let z = 0; z < s.sz; z++) {
      let row = '';
      for (let x = 0; x < s.sx; x++) {
        const b = s.blocks.find((q) => q.x === x && q.y === y && q.z === z);
        if (!b) row += '.';
        else if (b.kind === K.Solid) row += '#';
        else if (b.kind === K.Dust) row += '+';
        else if (b.kind === K.Torch) row += 'T';
        else if (b.kind === K.Repeater) row += '>^<v'[['east', 'south', 'west', 'north'].indexOf(b.spec.props!.facing)] ?? 'R';
        else if (b.kind === K.Lever || b.kind === K.Button) row += 'L';
        else if (b.kind === K.Lamp) row += 'O';
        else row += '?';
      }
      lines.push(row);
    }
  }
  return lines.join('\n');
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomCircuit(seed: number, nIn: number, nGates: number): Circuit {
  const r = rng(seed);
  const types: GateType[] = ['NOT', 'BUFFER', 'AND', 'NAND', 'OR', 'NOR', 'XOR', 'XNOR'];
  const gates: Gate[] = [];
  let c: Circuit = { gates: [], wires: [] };
  const add = (g: Gate) => {
    gates.push(g);
    c = { ...c, gates: [...c.gates, g] };
  };
  for (let i = 0; i < nIn; i++) add(createGate('INPUT', 0, i * 90, 'abcdefgh'[i]));
  const pool: Gate[] = [...gates];
  for (let i = 0; i < nGates; i++) {
    const t = types[Math.floor(r() * types.length)];
    const g = createGate(t, 150 * (1 + Math.floor(i / 3)), (i % 3) * 90 + Math.floor(r() * 3) * 15);
    if (t !== 'NOT' && t !== 'BUFFER') g.inputs = 2 + Math.floor(r() * 2.2);
    add(g);
    for (let p = 0; p < (t === 'NOT' || t === 'BUFFER' ? 1 : g.inputs); p++) {
      const src = pool[Math.floor(r() * pool.length)];
      c = addWire(c, src.id, g.id, p);
    }
    pool.push(g);
  }
  // outputs: последние гейты без потребителей
  const used = new Set(c.wires.map((w) => w.from));
  const leaves = pool.filter((g) => g.type !== 'INPUT' && !used.has(g.id));
  leaves.slice(0, 3).forEach((g, i) => {
    const o = createGate('OUTPUT', 1000, i * 60, `w${i}`);
    c = { ...c, gates: [...c.gates, o] };
    c = addWire(c, g.id, o.id, 0);
  });
  return c;
}

