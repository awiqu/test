import { ALL_ALU_OPS, AluOp, ComputerSpec, DeviceSpec, DeviceType, FlagName, Issue } from './types';

export interface PortDef {
  name: string;
  /** Смещение порта внутри устройства. */
  offset: number;
  access: 'r' | 'w' | 'rw';
  desc: string;
}

export interface DeviceInfo {
  type: DeviceType;
  name: string;
  desc: string;
  icon: string;
  /** Параметры по умолчанию. */
  defaults: Record<string, number>;
  ports: (opts: Record<string, number>, spec: ComputerSpec) => PortDef[];
}

export const DEVICE_INFO: Record<DeviceType, DeviceInfo> = {
  leds: {
    type: 'leds',
    name: 'Светодиоды',
    desc: 'Ряд ламп: бит записанного значения = горит/не горит.',
    icon: '💡',
    defaults: { count: 8 },
    ports: () => [{ name: 'LEDS', offset: 0, access: 'rw', desc: 'Запись: биты → лампы (бит 0 — первая лампа). Чтение: текущее значение.' }],
  },
  switches: {
    type: 'switches',
    name: 'Переключатели',
    desc: 'Набор рычагов, которые вы переключаете сами.',
    icon: '🎚',
    defaults: { count: 8 },
    ports: () => [{ name: 'SWITCH', offset: 0, access: 'r', desc: 'Чтение: состояние рычагов (бит 0 — первый).' }],
  },
  buttons: {
    type: 'buttons',
    name: 'Кнопки',
    desc: 'Четыре кнопки: пока нажата — бит равен 1.',
    icon: '🔘',
    defaults: { count: 4 },
    ports: () => [{ name: 'BTN', offset: 0, access: 'r', desc: 'Чтение: нажатые кнопки (бит 0 — первая).' }],
  },
  sevenseg: {
    type: 'sevenseg',
    name: 'Семисегментный индикатор',
    desc: 'Показывает записанное число в шестнадцатеричном виде.',
    icon: '8',
    defaults: {},
    ports: (_o, spec) => [{ name: 'SEG', offset: 0, access: 'rw', desc: `Запись: число показывается ${Math.ceil(spec.dataBits / 4)} цифрами hex.` }],
  },
  text: {
    type: 'text',
    name: 'Текстовый экран',
    desc: 'Символьный дисплей (как LCD): пишем ASCII-коды.',
    icon: '▭',
    defaults: { cols: 16, rows: 2 },
    ports: () => [
      { name: 'TXT', offset: 0, access: 'w', desc: 'Запись: символ в позицию курсора. 10 — перевод строки, 12 — очистка, 8 — забой, 13 — в начало строки.' },
      { name: 'TXTPOS', offset: 1, access: 'rw', desc: 'Позиция курсора: строка × cols + столбец.' },
    ],
  },
  pixel: {
    type: 'pixel',
    name: 'Пиксельный экран',
    desc: 'Монохромная матрица: задаём координаты и значение пикселя.',
    icon: '▦',
    defaults: { width: 8, height: 8 },
    ports: () => [
      { name: 'PX', offset: 0, access: 'rw', desc: 'Координата X.' },
      { name: 'PY', offset: 1, access: 'rw', desc: 'Координата Y.' },
      { name: 'PIX', offset: 2, access: 'rw', desc: 'Запись: бит 0 → пиксель (PX,PY) вкл/выкл. Чтение: текущий пиксель.' },
      { name: 'PCLR', offset: 3, access: 'w', desc: 'Любая запись очищает экран.' },
    ],
  },
  keyboard: {
    type: 'keyboard',
    name: 'Клавиатура',
    desc: 'Последняя нажатая клавиша (ASCII-код), 0 если нет.',
    icon: '⌨',
    defaults: {},
    ports: () => [{ name: 'KEY', offset: 0, access: 'rw', desc: 'Чтение: код клавиши (0 — нет) и сброс. Запись: сброс.' }],
  },
  timer: {
    type: 'timer',
    name: 'Таймер',
    desc: 'Счётчик, который растёт сам (каждые N тактов).',
    icon: '⏱',
    defaults: { period: 16 },
    ports: () => [{ name: 'TIMER', offset: 0, access: 'rw', desc: 'Чтение: счётчик. Запись: сброс в записанное значение.' }],
  },
  random: {
    type: 'random',
    name: 'Генератор случайных чисел',
    desc: 'Каждое чтение даёт случайное число.',
    icon: '🎲',
    defaults: {},
    ports: () => [{ name: 'RAND', offset: 0, access: 'r', desc: 'Чтение: случайное число.' }],
  },
  sound: {
    type: 'sound',
    name: 'Нотный блок (звук)',
    desc: 'Играет ноту: 0 — тишина, 1…24 — высота (ноты нотного блока).',
    icon: '♪',
    defaults: {},
    ports: () => [{ name: 'SOUND', offset: 0, access: 'w', desc: 'Запись: номер ноты (0 — выкл.).' }],
  },
  terminal: {
    type: 'terminal',
    name: 'Терминал (вывод)',
    desc: 'Простой журнал вывода: каждая запись — символ (10 — перевод строки).',
    icon: '>_',
    defaults: {},
    ports: () => [{ name: 'TERM', offset: 0, access: 'w', desc: 'Запись: символ ASCII в журнал вывода.' }],
  },
};

export const DEVICE_ORDER: DeviceType[] = ['leds', 'switches', 'buttons', 'sevenseg', 'text', 'pixel', 'keyboard', 'timer', 'random', 'sound', 'terminal'];

export function makeDevice(type: DeviceType, n = 1): DeviceSpec {
  return { id: `${type}${n}`, type, options: { ...DEVICE_INFO[type].defaults } };
}

export function regBits(spec: ComputerSpec): number {
  return spec.regCount <= 1 ? 0 : Math.ceil(Math.log2(spec.regCount));
}

export interface MappedPort extends PortDef {
  device: string;
  type: DeviceType;
  addr: number;
}

/** Карта портов: устройства занимают верхние адреса адресного пространства данных. */
export function portMap(spec: ComputerSpec): MappedPort[] {
  const all: Omit<MappedPort, 'addr'>[] = [];
  for (const d of spec.devices) {
    for (const p of DEVICE_INFO[d.type].ports(d.options, spec)) all.push({ ...p, device: d.id, type: d.type });
  }
  const top = 2 ** spec.ramAddrBits;
  const base = top - all.length;
  return all.map((p, i) => ({ ...p, addr: base + i }));
}

export function ioBase(spec: ComputerSpec): number {
  return 2 ** spec.ramAddrBits - portMap(spec).length;
}

export function pcMax(spec: ComputerSpec): number {
  return 2 ** spec.pcBits;
}

export function dataMask(spec: ComputerSpec): number {
  return 2 ** spec.dataBits - 1;
}

/** Ширина слова ПЗУ в «ниббл-бочках» (по 4 бита на бочку). */
export function nibblesPerWord(spec: ComputerSpec): number {
  return Math.ceil(spec.instrBits / 4);
}

export const FLAG_INFO: Record<FlagName, { name: string; desc: string }> = {
  Z: { name: 'Z — ноль', desc: 'Результат равен нулю' },
  C: { name: 'C — перенос/заём', desc: 'Перенос при сложении; заём (a<b) при вычитании; выдвинутый бит при сдвиге' },
  N: { name: 'N — знак', desc: 'Старший бит результата' },
  V: { name: 'V — переполнение', desc: 'Знаковое переполнение' },
};

export const ALU_INFO: Record<AluOp, { name: string; fn: string }> = {
  ADD: { name: 'Сложение', fn: 'add' },
  SUB: { name: 'Вычитание', fn: 'sub' },
  AND: { name: 'И', fn: 'and' },
  OR: { name: 'ИЛИ', fn: 'or' },
  XOR: { name: 'Исключающее ИЛИ', fn: 'xor' },
  NOT: { name: 'Инверсия', fn: 'not' },
  SHL: { name: 'Сдвиг влево', fn: 'shl' },
  SHR: { name: 'Логический сдвиг вправо', fn: 'shr' },
  ASR: { name: 'Арифметический сдвиг вправо', fn: 'asr' },
  ROL: { name: 'Циклический сдвиг влево', fn: 'rol' },
  ROR: { name: 'Циклический сдвиг вправо', fn: 'ror' },
  INC: { name: 'Инкремент', fn: 'inc' },
  DEC: { name: 'Декремент', fn: 'dec' },
  NEG: { name: 'Смена знака', fn: 'neg' },
  MUL: { name: 'Умножение', fn: 'mul' },
};

export const ALU_FN_TO_OP: Record<string, AluOp> = Object.fromEntries(ALL_ALU_OPS.map((o) => [ALU_INFO[o].fn, o]));

export type SpecPreset = 'risc8' | 'acc4' | 'risc16';

export function defaultSpec(preset: SpecPreset = 'risc8'): ComputerSpec {
  switch (preset) {
    case 'acc4':
      return {
        name: 'Мини-4',
        arch: 'accumulator',
        dataBits: 4,
        regCount: 1,
        instrBits: 8,
        opcodeBits: 4,
        pcBits: 4,
        romWords: 16,
        ramAddrBits: 4,
        ramWords: 10,
        flags: ['Z', 'C'],
        aluOps: ['ADD', 'SUB', 'AND', 'OR', 'XOR', 'NOT', 'SHL', 'SHR'],
        stack: { enabled: false, words: 0 },
        clockTicks: 4,
        devices: [makeDevice('leds'), makeDevice('switches'), makeDevice('sevenseg')].map((d) => (d.type === 'leds' || d.type === 'switches' ? { ...d, options: { count: 4 } } : d)),
      };
    case 'risc16':
      return {
        name: 'Учебный-16',
        arch: 'register',
        dataBits: 16,
        regCount: 8,
        instrBits: 28,
        opcodeBits: 6,
        pcBits: 8,
        romWords: 256,
        ramAddrBits: 8,
        ramWords: 192,
        flags: ['Z', 'C', 'N', 'V'],
        aluOps: ['ADD', 'SUB', 'AND', 'OR', 'XOR', 'NOT', 'SHL', 'SHR', 'ASR', 'INC', 'DEC', 'NEG', 'MUL'],
        stack: { enabled: true, words: 32 },
        clockTicks: 4,
        devices: [makeDevice('leds'), makeDevice('switches'), makeDevice('buttons'), makeDevice('text'), makeDevice('pixel'), makeDevice('keyboard'), makeDevice('timer'), makeDevice('terminal')],
      };
    default:
      return {
        name: 'Учебный-8',
        arch: 'register',
        dataBits: 8,
        regCount: 4,
        instrBits: 16,
        opcodeBits: 5,
        pcBits: 6,
        romWords: 64,
        ramAddrBits: 8,
        ramWords: 128,
        flags: ['Z', 'C', 'N'],
        aluOps: ['ADD', 'SUB', 'AND', 'OR', 'XOR', 'NOT', 'SHL', 'SHR', 'INC', 'DEC'],
        stack: { enabled: true, words: 16 },
        clockTicks: 4,
        devices: [makeDevice('leds'), makeDevice('switches'), makeDevice('buttons'), makeDevice('sevenseg'), makeDevice('text'), makeDevice('pixel'), makeDevice('keyboard'), makeDevice('terminal')],
      };
  }
}

/** Проверка характеристик. */
export function validateSpec(spec: ComputerSpec): Issue[] {
  const out: Issue[] = [];
  const err = (message: string, where?: string): void => void out.push({ level: 'error', message, where });
  const warn = (message: string, where?: string): void => void out.push({ level: 'warning', message, where });
  if (!Number.isInteger(spec.dataBits) || spec.dataBits < 2 || spec.dataBits > 16) err('Разрядность данных должна быть от 2 до 16 бит.', 'dataBits');
  if (spec.arch === 'accumulator' && spec.regCount !== 1) err('Для аккумуляторной архитектуры регистр один.', 'regCount');
  if (spec.arch === 'register' && (spec.regCount < 2 || spec.regCount > 16 || spec.regCount & (spec.regCount - 1))) err('Число регистров — степень двойки от 2 до 16.', 'regCount');
  if (spec.instrBits < 8 || spec.instrBits > 32) err('Ширина инструкции — от 8 до 32 бит.', 'instrBits');
  if (spec.opcodeBits < 1 || spec.opcodeBits >= spec.instrBits) err('Число бит кода операции должно быть меньше ширины инструкции.', 'opcodeBits');
  if (spec.pcBits < 1 || spec.pcBits > 12) err('Адрес ПЗУ — от 1 до 12 бит.', 'pcBits');
  if (spec.romWords < 1 || spec.romWords > 2 ** spec.pcBits) err(`ПЗУ не может быть больше ${2 ** spec.pcBits} слов при ${spec.pcBits} битах адреса.`, 'romWords');
  if (spec.ramAddrBits < 1 || spec.ramAddrBits > 12) err('Адрес данных — от 1 до 12 бит.', 'ramAddrBits');
  const ports = portMap(spec).length;
  if (2 ** spec.ramAddrBits - ports < 0) err(`Устройства (${ports} портов) не помещаются в адресное пространство данных (${2 ** spec.ramAddrBits}).`, 'devices');
  else if (spec.ramWords > 2 ** spec.ramAddrBits - ports) err(`ОЗУ (${spec.ramWords}) пересекается с портами устройств: допустимо не больше ${2 ** spec.ramAddrBits - ports} слов.`, 'ramWords');
  if (spec.ramWords < 0) err('Размер ОЗУ не может быть отрицательным.', 'ramWords');
  if (spec.stack.enabled) {
    if (spec.stack.words < 2) err('Стеку нужно минимум 2 слова.', 'stack');
    else if (spec.stack.words > spec.ramWords) err('Стек не помещается в ОЗУ.', 'stack');
  }
  if (spec.aluOps.length === 0) warn('Не выбрано ни одной операции АЛУ: арифметики не будет.', 'aluOps');
  if (spec.clockTicks < 1) err('Такт — не меньше 1 тика редстоуна.', 'clockTicks');
  const ids = new Set<string>();
  for (const d of spec.devices) {
    if (ids.has(d.id)) err(`Повтор устройства «${d.id}».`, 'devices');
    ids.add(d.id);
    if (d.type === 'text' && d.options.cols * d.options.rows > 2 ** spec.dataBits) warn('Позиций экрана больше, чем помещается в слове данных.', d.id);
    if (d.type === 'pixel' && (d.options.width > 2 ** spec.dataBits || d.options.height > 2 ** spec.dataBits)) warn('Размер пиксельного экрана больше, чем адресуют координаты.', d.id);
    if (d.type === 'leds' && d.options.count > spec.dataBits) warn('Ламп больше, чем бит в слове.', d.id);
  }
  return out;
}

export function describeEstimate(spec: ComputerSpec): { romBarrels: number; romBits: number; ramBits: number; ioPorts: number; ioBase: number } {
  return {
    romBarrels: spec.romWords * nibblesPerWord(spec),
    romBits: spec.romWords * spec.instrBits,
    ramBits: spec.ramWords * spec.dataBits,
    ioPorts: portMap(spec).length,
    ioBase: ioBase(spec),
  };
}
