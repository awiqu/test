import { describe, it, expect } from 'vitest';
import { Vox } from '../../src/cpu/vox';
import { Bus, BusNet } from '../../src/cpu/bus';
import { findShorts } from '../../src/cpu/netcheck';
import { newProject } from '../../src/computer/project';
import { planComputer } from '../../src/cpu/plan';
import { buildComputer, defaultBuildSettings } from '../../src/cpu/computer';
import { regRichProject } from './regProject';

/** Две цепи с левыми магистралями в столбцах xa и xb; приёмники лежат на разных строках, как у карточек. */
function twoNets(xa: number, xb: number): Vox {
  const v = new Vox();
  const mk = (name: string, x: number, z: number): BusNet => ({ name, src: { kind: 'rail', z: 0 }, x, sinks: [{ x: 30, z }] });
  const bus = new Bus({ leftXs: [], rightXs: [], wrapZs: [] });
  bus.add(mk('A', xa, 10));
  bus.add(mk('B', xb, 12));
  bus.build(v);
  return v;
}

describe('bus short-circuit detector', () => {
  it('finds neighbouring trunks closer than 3 columns (the tap stair touches the next trunk)', () => {
    const shorts = findShorts(twoNets(0, 2));
    expect(shorts.length).toBeGreaterThan(0);
    expect(shorts[0].nets.sort()).toEqual(['A', 'B']);
  });

  it('accepts trunks 3 columns apart', () => {
    expect(findShorts(twoNets(0, 3))).toEqual([]);
  });
});

describe('built computers have no shorts (the build itself fails otherwise)', () => {
  it('accumulator counter', () => {
    const p = newProject('acc4');
    const plan = planComputer(p, { mode: 'program', source: p.programs[0].source });
    expect(() => buildComputer(plan, defaultBuildSettings())).not.toThrow();
  }, 300000);

  it('register machine with LDR/STR/JR', () => {
    const { project, source } = regRichProject();
    const plan = planComputer(project, { mode: 'program', source });
    expect(() => buildComputer(plan, defaultBuildSettings())).not.toThrow();
  }, 1500000);
});
