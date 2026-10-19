import { create } from 'zustand';
import { ComputerProject, ComputerSpec, Instruction, Program } from './types';
import { SpecPreset, defaultSpec, validateSpec } from './spec';
import { buildPresetIsa } from './isa';
import { newProject, parseComputer, programId } from './project';
import { DEFAULT_ROM_OPTIONS, RomOptions } from './rom';

export type Step = 'spec' | 'isa' | 'asm' | 'prog' | 'rom' | 'hw' | 'ai';

export const STEPS: { id: Step; title: string; hint: string }[] = [
  { id: 'spec', title: 'Характеристики', hint: 'Разрядность, память, устройства' },
  { id: 'isa', title: 'Инструкции', hint: 'Конструктор набора команд' },
  { id: 'asm', title: 'Ассемблер', hint: 'Синтаксис и Python-версия' },
  { id: 'prog', title: 'Программы', hint: 'Редактор и симулятор' },
  { id: 'rom', title: 'ПЗУ из бочек', hint: 'Экспорт в .litematic' },
  { id: 'hw', title: 'Аппаратура', hint: 'Схемы узлов процессора' },
  { id: 'ai', title: 'ИИ и документация', hint: 'Доки, промпты, импорт' },
];

const KEY = 'redlogic:computer:v1';

interface Saved {
  project: ComputerProject;
  step: Step;
  welcomed: boolean;
  isaCustom: boolean;
  isaSeen: boolean;
  activeProgram: string;
  romOptions: RomOptions;
}

function loadSaved(): Saved | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Saved;
    if (s?.project?.format !== 'redlogic-computer' || !Array.isArray(s.project.instructions)) return null;
    return s;
  } catch {
    return null;
  }
}

interface ComputerState extends Saved {
  /** Текст, который надо показать в окне импорта (например, не открывшийся файл). */
  importText: string;
  setStep: (s: Step) => void;
  setProject: (p: ComputerProject, opts?: { welcomed?: boolean; isaCustom?: boolean }) => void;
  setName: (n: string) => void;
  updateSpec: (patch: Partial<ComputerSpec>) => void;
  rebuildIsa: () => string[];
  loadPreset: (p: SpecPreset) => void;
  setInstructions: (list: Instruction[]) => void;
  setPrograms: (list: Program[]) => void;
  addProgram: (name: string, source: string) => string;
  updateProgram: (id: string, patch: Partial<Program>) => void;
  deleteProgram: (id: string) => void;
  setActiveProgram: (id: string) => void;
  setPython: (src: string | undefined) => void;
  setAsm: (patch: Partial<ComputerProject['asm']>) => void;
  setRomOptions: (patch: Partial<RomOptions>) => void;
  markWelcomed: () => void;
  markIsaSeen: () => void;
  setImportText: (t: string) => void;
  reset: (preset?: SpecPreset) => void;
}

const initial = (): Saved => {
  const saved = loadSaved();
  if (saved) {
    return {
      ...saved,
      romOptions: { ...DEFAULT_ROM_OPTIONS, ...saved.romOptions },
      activeProgram: saved.project.programs.some((p) => p.id === saved.activeProgram) ? saved.activeProgram : saved.project.programs[0]?.id ?? '',
    };
  }
  const project = newProject('risc8');
  return { project, step: 'spec', welcomed: false, isaCustom: false, isaSeen: false, activeProgram: project.programs[0]?.id ?? '', romOptions: { ...DEFAULT_ROM_OPTIONS } };
};

/** Подгоняет зависимые поля характеристик, чтобы форма не создавала заведомо неверных значений. */
export function normalizeSpec(spec: ComputerSpec): ComputerSpec {
  const s = { ...spec };
  if (s.arch === 'accumulator') s.regCount = 1;
  else if (s.regCount < 2) s.regCount = 2;
  s.opcodeBits = Math.min(s.opcodeBits, s.instrBits - 1);
  s.romWords = Math.max(1, Math.min(s.romWords, 2 ** s.pcBits));
  return s;
}

export const useComputer = create<ComputerState>((set, get) => ({
  ...initial(),
  importText: '',
  setStep: (step) => set({ step }),
  setProject: (project, opts = {}) =>
    set({ project, activeProgram: project.programs[0]?.id ?? '', welcomed: opts.welcomed ?? true, isaCustom: opts.isaCustom ?? true, isaSeen: true }),
  setName: (n) => set((s) => ({ project: { ...s.project, name: n, spec: { ...s.project.spec, name: n } } })),
  updateSpec: (patch) =>
    set((s) => {
      const spec = normalizeSpec({ ...s.project.spec, ...patch });
      const project = { ...s.project, spec, name: spec.name };
      if (!s.isaCustom) project.instructions = buildPresetIsa(spec).instructions;
      return { project };
    }),
  rebuildIsa: () => {
    const { instructions, dropped } = buildPresetIsa(get().project.spec);
    set((s) => ({ project: { ...s.project, instructions }, isaCustom: false }));
    return dropped;
  },
  loadPreset: (preset) => {
    const p = newProject(preset);
    set({ project: p, activeProgram: p.programs[0]?.id ?? '', isaCustom: false });
  },
  setInstructions: (list) => set((s) => ({ project: { ...s.project, instructions: list }, isaCustom: true })),
  setPrograms: (list) => set((s) => ({ project: { ...s.project, programs: list } })),
  addProgram: (name, source) => {
    const id = programId();
    set((s) => ({ project: { ...s.project, programs: [...s.project.programs, { id, name, source }] }, activeProgram: id }));
    return id;
  },
  updateProgram: (id, patch) => set((s) => ({ project: { ...s.project, programs: s.project.programs.map((p) => (p.id === id ? { ...p, ...patch } : p)) } })),
  deleteProgram: (id) =>
    set((s) => {
      const programs = s.project.programs.filter((p) => p.id !== id);
      return { project: { ...s.project, programs }, activeProgram: s.activeProgram === id ? programs[0]?.id ?? '' : s.activeProgram };
    }),
  setActiveProgram: (activeProgram) => set({ activeProgram }),
  setPython: (src) => set((s) => ({ project: { ...s.project, pythonAssembler: src } })),
  setAsm: (patch) => set((s) => ({ project: { ...s.project, asm: { ...s.project.asm, ...patch } } })),
  setRomOptions: (patch) => set((s) => ({ romOptions: { ...s.romOptions, ...patch } })),
  markWelcomed: () => set({ welcomed: true }),
  markIsaSeen: () => set({ isaSeen: true }),
  setImportText: (importText) => set({ importText }),
  reset: (preset = 'risc8') => {
    const p = newProject(preset);
    set({ project: p, step: 'spec', welcomed: false, isaCustom: false, isaSeen: false, activeProgram: p.programs[0]?.id ?? '', romOptions: { ...DEFAULT_ROM_OPTIONS } });
  },
}));

let timer: ReturnType<typeof setTimeout> | undefined;
useComputer.subscribe((s) => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    const { project, step, welcomed, isaCustom, isaSeen, activeProgram, romOptions } = s;
    try {
      localStorage.setItem(KEY, JSON.stringify({ project, step, welcomed, isaCustom, isaSeen, activeProgram, romOptions } satisfies Saved));
    } catch {
      /* хранилище недоступно — автосохранение пропускаем */
    }
  }, 400);
});

export function specIssues(spec: ComputerSpec) {
  return validateSpec(spec);
}

export { parseComputer, defaultSpec };
