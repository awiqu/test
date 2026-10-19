import { ALL_ALU_OPS, ALL_FLAGS, AluOp, ComputerProject, ComputerSpec, DeviceSpec, DeviceType, FlagName, Instruction, Issue, Program } from './types';
import { DEVICE_INFO, SpecPreset, defaultSpec, makeDevice, validateSpec } from './spec';
import { buildPresetIsa, validateIsa } from './isa';
import { DEFAULT_ASM_OPTIONS } from './asm';
import { EXAMPLES } from './examples';

let counter = 0;
export function programId(): string {
  counter += 1;
  return `p${Date.now().toString(36)}${counter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

export function newProject(preset: SpecPreset = 'risc8'): ComputerProject {
  const spec = defaultSpec(preset);
  const { instructions } = buildPresetIsa(spec);
  return {
    format: 'redlogic-computer',
    version: 1,
    name: spec.name,
    spec,
    instructions,
    programs: EXAMPLES[preset].map((e) => ({ id: programId(), name: e.name, source: e.source })),
    asm: { ...DEFAULT_ASM_OPTIONS },
  };
}

export function projectIssues(p: ComputerProject): Issue[] {
  return [...validateSpec(p.spec), ...validateIsa(p.spec, p.instructions)];
}

export function serializeComputer(p: ComputerProject): string {
  return JSON.stringify({ ...p, savedAt: new Date().toISOString() }, null, 2);
}

// ───────────── Разбор и проверка JSON (в том числе от ИИ) ─────────────

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^(0x[0-9a-f]+|0b[01]+|\d+)$/i.test(v.trim())) return Number(v.trim());
  return null;
}

/**
 * Разбирает описание компьютера из JSON. Возвращает проект (если удалось) и ПОЛНЫЙ список замечаний —
 * текст замечаний написан так, чтобы его можно было отправить ИИ для исправления.
 */
export function parseComputer(text: string): { project: ComputerProject | null; issues: Issue[] } {
  const issues: Issue[] = [];
  const err = (where: string, message: string): void => void issues.push({ level: 'error', where, message });
  const warn = (where: string, message: string): void => void issues.push({ level: 'warning', where, message });
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    err('json', `Не удалось разобрать JSON: ${(e as Error).message}`);
    return { project: null, issues };
  }
  if (!isObj(data)) {
    err('json', 'Корень должен быть объектом { "format": "redlogic-computer", "spec": …, "instructions": [...] }');
    return { project: null, issues };
  }
  if (data.format !== undefined && data.format !== 'redlogic-computer') err('format', 'Поле "format" должно быть "redlogic-computer".');
  if (!isObj(data.spec)) {
    err('spec', 'Нет объекта "spec" с характеристиками компьютера.');
    return { project: null, issues };
  }
  const s = data.spec;
  const base = defaultSpec('risc8');
  const int = (key: string, min: number, max: number, def?: number): number => {
    const raw = s[key];
    if (raw === undefined && def !== undefined) return def;
    const v = num(raw);
    if (v === null || !Number.isInteger(v)) {
      err(`spec.${key}`, `Ожидалось целое число${min !== max ? ` от ${min} до ${max}` : ''}.`);
      return def ?? min;
    }
    if (v < min || v > max) err(`spec.${key}`, `Значение ${v} вне диапазона ${min}…${max}.`);
    return v;
  };
  const arch = s.arch === 'accumulator' ? 'accumulator' : s.arch === 'register' || s.arch === undefined ? 'register' : null;
  if (arch === null) err('spec.arch', 'Допустимо "register" или "accumulator".');
  const dataBits = int('dataBits', 2, 16, 8);
  const regCount = (arch ?? 'register') === 'accumulator' ? 1 : int('regCount', 2, 16, 4);
  const instrBits = int('instrBits', 8, 32, 16);
  const opcodeBits = int('opcodeBits', 1, 16, 5);
  const pcBits = int('pcBits', 1, 12, 6);
  const romWords = int('romWords', 1, 4096, 2 ** pcBits);
  const ramAddrBits = int('ramAddrBits', 1, 12, 8);
  const ramWords = int('ramWords', 0, 4096, 128);
  const clockTicks = int('clockTicks', 1, 64, 4);
  const flagsRaw = Array.isArray(s.flags) ? s.flags : s.flags === undefined ? base.flags : null;
  const flags: FlagName[] = [];
  if (flagsRaw === null) err('spec.flags', 'Ожидался массив из "Z", "C", "N", "V".');
  else
    for (const f of flagsRaw) {
      if (ALL_FLAGS.includes(f as FlagName)) flags.push(f as FlagName);
      else err('spec.flags', `Неизвестный флаг "${String(f)}" (допустимы Z, C, N, V).`);
    }
  const aluRaw = Array.isArray(s.aluOps) ? s.aluOps : s.aluOps === undefined ? base.aluOps : null;
  const aluOps: AluOp[] = [];
  if (aluRaw === null) err('spec.aluOps', `Ожидался массив из: ${ALL_ALU_OPS.join(', ')}.`);
  else
    for (const o of aluRaw) {
      const up = String(o).toUpperCase();
      if (ALL_ALU_OPS.includes(up as AluOp)) aluOps.push(up as AluOp);
      else err('spec.aluOps', `Неизвестная операция АЛУ "${String(o)}" (допустимы: ${ALL_ALU_OPS.join(', ')}).`);
    }
  let stack = { enabled: false, words: 0 };
  if (s.stack !== undefined) {
    if (isObj(s.stack)) stack = { enabled: s.stack.enabled === true, words: num(s.stack.words) ?? 0 };
    else err('spec.stack', 'Ожидался объект { "enabled": true, "words": 16 }.');
  }
  const devices: DeviceSpec[] = [];
  if (s.devices !== undefined && !Array.isArray(s.devices)) err('spec.devices', 'Ожидался массив устройств.');
  else if (Array.isArray(s.devices)) {
    s.devices.forEach((d, i) => {
      const where = `spec.devices[${i}]`;
      const rec = typeof d === 'string' ? { type: d } : d;
      if (!isObj(rec) || typeof rec.type !== 'string' || !(rec.type in DEVICE_INFO)) {
        err(where, `Неизвестный тип устройства. Допустимы: ${Object.keys(DEVICE_INFO).join(', ')}.`);
        return;
      }
      const type = rec.type as DeviceType;
      const dev = makeDevice(type, devices.filter((x) => x.type === type).length + 1);
      if (typeof rec.id === 'string' && rec.id) dev.id = rec.id;
      if (isObj(rec.options)) {
        for (const [k, v] of Object.entries(rec.options)) {
          const n = num(v);
          if (n === null) err(`${where}.options.${k}`, 'Ожидалось число.');
          else if (k in DEVICE_INFO[type].defaults) dev.options[k] = n;
          else warn(`${where}.options.${k}`, 'Неизвестный параметр устройства — проигнорирован.');
        }
      }
      devices.push(dev);
    });
  }
  const spec: ComputerSpec = {
    name: typeof s.name === 'string' && s.name ? s.name : typeof data.name === 'string' && data.name ? data.name : 'Компьютер',
    arch: arch ?? 'register',
    dataBits,
    regCount,
    instrBits,
    opcodeBits,
    pcBits,
    romWords,
    ramAddrBits,
    ramWords,
    flags,
    aluOps,
    stack,
    clockTicks,
    devices,
  };
  issues.push(...validateSpec(spec));

  const instructions: Instruction[] = [];
  if (!Array.isArray(data.instructions)) err('instructions', 'Нет массива "instructions".');
  else {
    data.instructions.forEach((raw, i) => {
      const where = `instructions[${i}]`;
      if (!isObj(raw)) {
        err(where, 'Ожидался объект инструкции.');
        return;
      }
      const mn = typeof raw.mnemonic === 'string' ? raw.mnemonic.trim() : '';
      if (!mn) err(where, 'Нет "mnemonic".');
      const opcode = num(raw.opcode);
      if (opcode === null) err(`${where}${mn ? ` (${mn})` : ''}`, '"opcode" должен быть целым числом (можно строкой "0x1F").');
      const code = typeof raw.code === 'string' ? raw.code : '';
      if (typeof raw.code !== 'string') err(`${where}${mn ? ` (${mn})` : ''}`, 'Нет строки "code" (RTL).');
      instructions.push({
        mnemonic: mn,
        opcode: opcode ?? -1,
        format: typeof raw.format === 'string' ? raw.format : '',
        description: typeof raw.description === 'string' ? raw.description : '',
        pseudo: typeof raw.pseudo === 'string' ? raw.pseudo : '',
        code,
        cycles: num(raw.cycles) ?? 1,
      });
    });
  }
  issues.push(...validateIsa(spec, instructions));

  const programs: Program[] = [];
  if (Array.isArray(data.programs)) {
    data.programs.forEach((p, i) => {
      if (isObj(p) && typeof p.source === 'string') programs.push({ id: programId(), name: typeof p.name === 'string' && p.name ? p.name : `Программа ${i + 1}`, source: p.source });
      else err(`programs[${i}]`, 'Ожидался объект { "name": "...", "source": "..." }.');
    });
  }
  const project: ComputerProject = {
    format: 'redlogic-computer',
    version: 1,
    name: spec.name,
    spec,
    instructions,
    programs,
    asm: { ...DEFAULT_ASM_OPTIONS, ...(isObj(data.asm) ? (data.asm as Partial<typeof DEFAULT_ASM_OPTIONS>) : {}) },
    pythonAssembler: typeof data.pythonAssembler === 'string' ? data.pythonAssembler : undefined,
  };
  return { project: issues.some((i) => i.level === 'error') ? null : project, issues };
}

export function issuesToText(issues: Issue[]): string {
  return issues.map((i) => `${i.level === 'error' ? 'ОШИБКА' : 'предупреждение'}${i.where ? ` [${i.where}]` : ''}${i.line ? ` (строка ${i.line})` : ''}: ${i.message}`).join('\n');
}
