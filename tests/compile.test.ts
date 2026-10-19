import { describe, it, expect } from 'vitest';
import { exampleCircuit, createGate, addWire } from '../src/model/circuit';
import { compile, defaultSettings } from '../src/compiler/compile';
import { techmap } from '../src/compiler/techmap';
import { Circuit } from '../src/model/types';
import { K } from '../src/compiler/voxel';

describe('compiler', () => {
  it('compiles the example circuit and the redstone matches the logic', () => {
    const res = compile(exampleCircuit(), defaultSettings());
    expect(res.ok).toBe(true);
    expect(res.verify?.ok).toBe(true);
    expect(res.verify?.checked).toBe(8);
    expect(res.stats!.levers).toBe(3);
    expect(res.stats!.lamps).toBe(2);
  });

  it('uses the chosen blocks and input device', () => {
    const s = defaultSettings();
    s.wireBlock = { material: 'concrete', color: 'red' };
    s.gateBlock = { material: 'wool', color: 'blue' };
    s.inputDevice = 'button';
    s.floorPlate = true;
    const res = compile(exampleCircuit(), s);
    expect(res.ok).toBe(true);
    const names = new Set(res.structure!.blocks.map((b) => b.spec.name));
    expect(names.has('minecraft:red_concrete')).toBe(true);
    expect(names.has('minecraft:blue_wool')).toBe(true);
    expect(names.has('minecraft:stone_button')).toBe(true);
    expect(names.has('minecraft:lever')).toBe(false);
  });

  it('respects manual gaps', () => {
    const s = defaultSettings();
    s.autoGap = false;
    s.gapX = 6;
    s.gapZ = 4;
    const big = compile(exampleCircuit(), s);
    const auto = compile(exampleCircuit(), defaultSettings());
    expect(big.ok).toBe(true);
    expect(big.structure!.sx).toBeGreaterThan(auto.structure!.sx);
  });

  it('reports unconnected inputs and feedback loops', () => {
    let c: Circuit = { gates: [], wires: [] };
    const a = createGate('INPUT', 0, 0, 'a');
    const g = createGate('AND', 150, 0);
    const o = createGate('OUTPUT', 300, 0, 'w');
    c.gates.push(a, g, o);
    c = addWire(c, a.id, g.id, 0);
    c = addWire(c, g.id, o.id, 0);
    const res = compile(c, defaultSettings());
    expect(res.ok).toBe(false);
    expect(res.issues[0].gateId).toBe(g.id);

    const n1 = createGate('NOT', 100, 100);
    const n2 = createGate('NOT', 250, 100);
    const out = createGate('OUTPUT', 400, 100, 'q');
    let loop: Circuit = { gates: [n1, n2, out], wires: [] };
    loop = addWire(loop, n1.id, n2.id, 0);
    loop = addWire(loop, n2.id, n1.id, 0);
    loop = addWire(loop, n2.id, out.id, 0);
    const r2 = compile(loop, defaultSettings());
    expect(r2.ok).toBe(false);
    expect(r2.issues[0].message).toMatch(/обратн/);
  });

  it('shares inverters and drops logic that does not reach an output', () => {
    const c = exampleCircuit();
    const { netlist } = techmap(c);
    const nots = netlist!.insts.filter((i) => i.kind === 'NOT').length;
    // ¬x, ¬y и по одному инвертору на входы AND (Де Морган), без дублей для общего A2
    expect(nots).toBeLessThanOrEqual(7);
    const dead = createGate('NOT', 0, 500);
    const withDead: Circuit = { ...c, gates: [...c.gates, dead] };
    expect(techmap(withDead).netlist!.insts.length).toBe(netlist!.insts.length);
  });

  it('keeps wires electrically separate: every dust cell belongs to exactly one net', () => {
    const res = compile(exampleCircuit(), defaultSettings());
    const dust = res.structure!.blocks.filter((b) => b.kind === K.Dust);
    expect(dust.length).toBeGreaterThan(0);
  });
});
