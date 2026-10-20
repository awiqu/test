import { describe, it, expect } from 'vitest';
import { gunzipSync } from 'fflate';
import { newProject } from '../../src/computer/project';
import { regProject } from './regProject';
import { CONTAINERS, containerDef } from '../../src/cpu/export';
import { ComputerBuildError, defaultExportSettings, exportComputer } from '../../src/cpu/computerExport';

describe('computer export', () => {
  it('program mode: schematic, summary and guide for the counter', () => {
    const p = newProject('acc4');
    const e = exportComputer(p, { ...defaultExportSettings(), autoTiming: false });
    expect(e.fileName.endsWith('.litematic')).toBe(true);
    expect(gunzipSync(e.bytes).length).toBeGreaterThan(1000);
    expect(e.summary.blocks).toBeGreaterThan(10000);
    const barrels = (e.structure.tileEntities ?? []).filter((t) => t.id === 'minecraft:barrel');
    expect(barrels.length).toBe(e.summary.romContainers);
    expect(e.summary.romItems).toBe(barrels.length * 27);
    for (const t of barrels) expect(t.items!.length).toBe(27);
    expect(e.docs).toContain('RESET');
    expect(e.docs).toContain('## Содержимое ПЗУ');
    expect(e.docs).toContain('CLK');
    // все рычаги управления присутствуют в схеме
    expect(e.structure.blocks.filter((b) => b.spec.name === 'minecraft:lever').length).toBeGreaterThanOrEqual(2);
  });

  it('component choices: hopper container, full ROM matrix, other blocks, lamps off', () => {
    const p = newProject('acc4');
    const base = defaultExportSettings();
    const e = exportComputer(p, {
      ...base,
      autoTiming: false,
      container: 'hopper',
      item: 'minecraft:wooden_sword',
      romFull: true,
      indicators: false,
      portLamps: false,
      wireBlock: { material: 'stone', color: 'gray' },
      gateBlock: { material: 'concrete', color: 'red' },
      lampBlock: 'minecraft:copper_bulb',
    });
    const hop = containerDef('hopper');
    const hoppers = (e.structure.tileEntities ?? []).filter((t) => t.id === hop.block);
    expect(hoppers.length).toBe(e.summary.romWords * e.summary.romBits);
    const full = hoppers.filter((t) => (t.items?.length ?? 0) > 0);
    expect(full.length).toBeGreaterThan(0);
    expect(full.length).toBeLessThan(hoppers.length);
    for (const t of full) {
      expect(t.items!.length).toBe(hop.slots);
      expect(t.items!.every((i) => i.id === 'minecraft:wooden_sword')).toBe(true);
    }
    expect(e.structure.blocks.some((b) => b.spec.name === 'minecraft:redstone_lamp' || b.spec.name === 'minecraft:copper_bulb')).toBe(false);
    expect(e.structure.blocks.some((b) => b.spec.name.includes('red_concrete'))).toBe(true);
    // без индикаторов плата меньше
    const withLamps = exportComputer(p, { ...base, autoTiming: false, romFull: true, container: 'hopper' });
    expect(e.summary.blocks).toBeLessThan(withLamps.summary.blocks);
  });

  it('register machine: schematic, registers in the guide, isa mode builds all registers', () => {
    const p = regProject();
    const e = exportComputer(p, { ...defaultExportSettings(), autoTiming: false });
    expect(e.built.probes.regs.size).toBe(4);
    expect(e.built.probes.a.length).toBe(0);
    expect(e.docs).toContain('регистровый процессор');
    expect(e.docs).toContain('регистр R3');
    expect(e.summary.blocks).toBeGreaterThan(50000);
    const full = exportComputer(p, { ...defaultExportSettings(), autoTiming: false, mode: 'isa' });
    expect(full.built.probes.regs.size).toBe(4);
    expect(full.summary.romBits).toBeGreaterThan(e.summary.romBits);
  }, 600000);

  it('auto clock + isa mode build', () => {
    const p = newProject('acc4');
    const e = exportComputer(p, { ...defaultExportSettings(), autoTiming: false, mode: 'isa', clock: 'auto', clockHalfTicks: 1000 });
    expect(e.built.probes.clockStop).not.toBeNull();
    expect(e.built.probes.clk).toBeNull();
    expect(e.docs).toContain('СТОП');
    expect(e.summary.romWords).toBeGreaterThan(0);
  });

  it('refuses a program the hardware cannot execute', () => {
    const p = newProject('acc4');
    p.programs[0].source = 'bogus 1\n';
    expect(() => exportComputer(p, { ...defaultExportSettings(), autoTiming: false })).toThrow(ComputerBuildError);
  });

  it('lists every container kind', () => {
    expect(CONTAINERS.map((c) => c.id)).toEqual(['barrel', 'chest', 'hopper', 'dropper', 'dispenser']);
  });
});
