import { Circuit } from '../model/types';
import { parseNetlist } from '../model/netlist';
import { ExportSettings, compile, defaultSettings, Structure } from '../compiler/compile';
import { K, MAT_GATE, MAT_WIRE, DIR_NAMES } from '../compiler/voxel';
import { Vox } from './vox';

/** Точка подключения макроса: клетка пыли внутри и «подход» снаружи (освобождённая клетка рычага/лампы). */
export interface MacroPin {
  name: string;
  kind: 'in' | 'out';
  /** Пыль макроса, к которой подключается внешний провод (вход) / от которой стартует (выход). */
  dust: [number, number, number];
  /** Свободная клетка между пылью и внешним миром. */
  approach: [number, number, number];
}

export interface Macro {
  /** Все блоки, кроме рычагов и ламп входов/выходов (они убраны). */
  vox: Vox;
  /** Вариант с рычагами и лампами — для проверки самого макроса. */
  testVox: Vox;
  pins: Map<string, MacroPin>;
  size: { sx: number; sy: number; sz: number };
  stats: { gates: number; ms: number };
}

const GATE_MARK = { material: 'smooth_stone', color: 'gray' };
const WIRE_MARK = { material: 'stone', color: 'gray' };

function facingIndex(f: string): number {
  return DIR_NAMES.indexOf(f);
}

/** Структура компилятора → воксельная модель (направления восстанавливаются по blockstate). */
export function structureToVox(st: Structure): Vox {
  const v = new Vox();
  for (const b of st.blocks) {
    const n = b.spec.name;
    const p = b.spec.props ?? {};
    switch (b.kind) {
      case K.Solid:
        v.set(b.x, b.y, b.z, { kind: K.Solid, mat: n === 'minecraft:smooth_stone' ? MAT_GATE : MAT_WIRE });
        break;
      case K.Dust:
        v.set(b.x, b.y, b.z, { kind: K.Dust });
        break;
      case K.Torch:
        v.set(b.x, b.y, b.z, { kind: K.Torch, dir: facingIndex(p.facing) });
        break;
      case K.Repeater:
        v.set(b.x, b.y, b.z, { kind: K.Repeater, dir: facingIndex(p.facing), delay: Number(p.delay ?? 1) });
        break;
      case K.Lever:
        v.set(b.x, b.y, b.z, { kind: K.Lever, dir: 1, on: false });
        break;
      case K.Button:
        v.set(b.x, b.y, b.z, { kind: K.Button, dir: 1, on: false });
        break;
      case K.Lamp:
        v.set(b.x, b.y, b.z, { kind: K.Lamp, mat: MAT_GATE });
        break;
      default:
        break;
    }
  }
  return v;
}

export function macroSettings(over: Partial<ExportSettings> = {}): ExportSettings {
  const s = defaultSettings();
  s.floorPlate = true;
  s.edgePins = true;
  s.wireBlock = WIRE_MARK;
  s.gateBlock = GATE_MARK;
  return { ...s, ...over };
}

/** Компилирует логическую схему (нетлист) в макрос с именованными выводами. */
export function compileMacro(source: string | Circuit, settings: ExportSettings = macroSettings()): Macro {
  const t0 = performance.now();
  let circuit: Circuit;
  if (typeof source === 'string') {
    const r = parseNetlist(source);
    if (!r.circuit) throw new Error(`Нетлист макроса не разобран: ${r.issues.map((i) => i.message).join('; ')}`);
    circuit = r.circuit;
  } else circuit = source;
  const res = compile(circuit, settings);
  if (!res.ok || !res.structure) throw new Error(`Макрос не скомпилирован: ${res.issues.map((i) => i.message).join('; ')}`);
  const st = res.structure;
  const testVox = structureToVox(st);
  const vox = structureToVox(st);
  const pins = new Map<string, MacroPin>();
  for (const m of st.markers) {
    const name = m.text;
    if (!name) throw new Error('У входов и выходов макроса должны быть подписи');
    if (m.kind === 'in') {
      // модуль IN: рычаг в (0,0), пыль-выход в (1,0)
      vox.remove(m.x, m.y, m.z);
      pins.set(name, { name, kind: 'in', dust: [m.x + 1, m.y, m.z], approach: [m.x, m.y, m.z] });
    } else {
      // модуль OUT: лампа в (0,0), пыль слота в (-1,0), (-2,0)
      vox.remove(m.x, m.y, m.z);
      pins.set(name, { name, kind: 'out', dust: [m.x - 1, m.y, m.z], approach: [m.x, m.y, m.z] });
    }
  }
  return { vox, testVox, pins, size: { sx: st.sx, sy: st.sy, sz: st.sz }, stats: { gates: circuit.gates.length, ms: Math.round(performance.now() - t0) } };
}
