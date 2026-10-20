import { it } from 'vitest';
import { newProject } from '../../src/computer/project';
import { planComputer } from '../../src/cpu/plan';
import { buildComputer, defaultBuildSettings } from '../../src/cpu/computer';
import { Board } from '../../src/cpu/board';
import { K, RES_BLOCKED } from '../../src/compiler/voxel';
import { writeFileSync } from 'fs';

it('dbg', () => {
  const p = newProject('acc4');
  const plan = planComputer(p, { mode: 'program', programId: p.programs[0].id });
  const st = defaultBuildSettings();
  st.rounds = 1;
  st.trace = (m) => process.stderr.write('  ' + m + '\n');
  st.maxExpansions = 2000000;
  try { buildComputer(plan, st); } catch (e) { process.stderr.write(String(e).slice(0, 300) + '\n'); }
  const b = (globalThis as { __board?: Board }).__board!;
  const g = b.g;
  const r = b.lastRouter!;
  {
    const n = b.nets[8];
    const off = b as unknown as { offX: number; offZ: number };
    process.stderr.write(`net8 ${n.name} from ${n.from.join(',')} -> grid ${n.from[0] + off.offX},${n.from[2] + off.offZ}\n`);
  }
  const tgt: [number, number, number] = [16, 1, 165];
  for (const [dx, dy, dz] of [[0, 0, -1], [0, 1, -1], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 1, 0], [1, 1, 0], [-1, 1, 0]]) {
    const x = tgt[0] + dx, y = tgt[1] + dy, z = tgt[2] + dz;
    process.stderr.write(`explain (${x},${y},${z}) -> ${r.explain(x, y, z, 8, g.idx(tgt[0], tgt[1], tgt[2]))}\n`);
  }
  {
    const rr = r as unknown as { pin: Int32Array; pin2: Int32Array };
    const lines: string[] = [];
    for (let z = tgt[2] - 14; z <= tgt[2] + 14; z++) {
      let l = '';
      for (let x = tgt[0] - 30; x <= tgt[0] + 30; x++) {
        const i = g.idx(x, 1, z);
        const k = g.kind[i];
        let c = '.';
        if (k === 2) c = String.fromCharCode(97 + (g.net[i] % 26));
        else if (k === 1) c = '#';
        else if (k !== 0) c = 'R';
        else if (g.res[i] & 1) c = '+';
        if (k === 0 && !(g.res[i] & 1) && (rr.pin[i] !== -1 || rr.pin2[i] !== -1)) c = rr.pin[i] === 8 || rr.pin2[i] === 8 ? 'o' : ':';
        if (x === tgt[0] && z === tgt[2]) c = '@';
        l += c;
      }
      lines.push(String(z).padStart(3) + ' ' + l);
    }
    process.stderr.write(lines.join('\n') + '\n');
  }
  process.stderr.write(`grid ${g.W}x${g.H}x${g.D}\n`);
  // карта всей платы: уровень 1, масштаб 1:1 в файл
  const ch = (i: number): string => {
    const k = g.kind[i] as K;
    if (k === K.Air) return g.res[i] & RES_BLOCKED ? '+' : '.';
    if (k === K.Solid) return '#';
    if (k === K.Dust) return String.fromCharCode(97 + (g.net[i] % 26));
    if (k === K.Repeater) return 'R';
    if (k === K.Torch) return 'T';
    if (k === K.Comparator) return 'C';
    if (k === K.Lever) return 'L';
    if (k === K.Lamp) return 'O';
    return '?';
  };
  for (const y of [1, 2, 3]) {
    const lines: string[] = [];
    for (let z = 0; z < g.D; z++) {
      let l = '';
      for (let x = 0; x < g.W; x++) l += ch(g.idx(x, y, z));
      lines.push(l);
    }
    writeFileSync(`/tmp/map_y${y}.txt`, lines.join('\n'));
  }
}, 600000);
