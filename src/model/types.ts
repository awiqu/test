export type GateType =
  | 'INPUT'
  | 'OUTPUT'
  | 'NOT'
  | 'BUFFER'
  | 'AND'
  | 'NAND'
  | 'OR'
  | 'NOR'
  | 'XOR'
  | 'XNOR';

export interface Gate {
  id: string;
  type: GateType;
  /** Позиция левого верхнего угла, px (кратна GRID). */
  x: number;
  y: number;
  /** Количество входов (для INPUT = 0, для NOT/BUFFER/OUTPUT = 1). */
  inputs: number;
  label: string;
  /** Состояние переключателя (только INPUT). */
  value: boolean;
  /** Задержка повторителя в тиках 1..4 (только BUFFER). */
  delay: number;
}

export interface Wire {
  id: string;
  /** id гейта-источника (его единственный выход). */
  from: string;
  /** id гейта-приёмника. */
  to: string;
  /** Индекс входного пина приёмника. */
  toPin: number;
  /** Необязательное ручное положение вертикального участка провода (px). */
  midX?: number;
}

export interface Circuit {
  gates: Gate[];
  wires: Wire[];
}

export interface Point {
  x: number;
  y: number;
}

export const GRID = 15;

export interface GateInfo {
  type: GateType;
  name: string;
  short: string;
  hint: string;
  /** Можно ли менять число входов. */
  variableInputs: boolean;
  minInputs: number;
  maxInputs: number;
  defaultInputs: number;
}

export const GATE_INFO: Record<GateType, GateInfo> = {
  INPUT: { type: 'INPUT', name: 'Вход (рычаг)', short: 'IN', hint: 'Источник сигнала — рычаг', variableInputs: false, minInputs: 0, maxInputs: 0, defaultInputs: 0 },
  OUTPUT: { type: 'OUTPUT', name: 'Выход (лампа)', short: 'OUT', hint: 'Индикатор — редстоун-лампа', variableInputs: false, minInputs: 1, maxInputs: 1, defaultInputs: 1 },
  NOT: { type: 'NOT', name: 'НЕ (NOT)', short: 'NOT', hint: 'Инвертор', variableInputs: false, minInputs: 1, maxInputs: 1, defaultInputs: 1 },
  BUFFER: { type: 'BUFFER', name: 'Повторитель', short: 'BUF', hint: 'Буфер с задержкой 1–4 тика', variableInputs: false, minInputs: 1, maxInputs: 1, defaultInputs: 1 },
  AND: { type: 'AND', name: 'И (AND)', short: 'AND', hint: '1 только если все входы = 1', variableInputs: true, minInputs: 2, maxInputs: 4, defaultInputs: 2 },
  NAND: { type: 'NAND', name: 'И-НЕ (NAND)', short: 'NAND', hint: 'Инвертированное И', variableInputs: true, minInputs: 2, maxInputs: 4, defaultInputs: 2 },
  OR: { type: 'OR', name: 'ИЛИ (OR)', short: 'OR', hint: '1 если хотя бы один вход = 1', variableInputs: true, minInputs: 2, maxInputs: 4, defaultInputs: 2 },
  NOR: { type: 'NOR', name: 'ИЛИ-НЕ (NOR)', short: 'NOR', hint: 'Инвертированное ИЛИ', variableInputs: true, minInputs: 2, maxInputs: 4, defaultInputs: 2 },
  XOR: { type: 'XOR', name: 'Искл. ИЛИ (XOR)', short: 'XOR', hint: '1 при нечётном числе единиц', variableInputs: true, minInputs: 2, maxInputs: 4, defaultInputs: 2 },
  XNOR: { type: 'XNOR', name: 'Искл. ИЛИ-НЕ (XNOR)', short: 'XNOR', hint: '1 при чётном числе единиц', variableInputs: true, minInputs: 2, maxInputs: 4, defaultInputs: 2 },
};

export const PALETTE_ORDER: GateType[] = [
  'INPUT',
  'OUTPUT',
  'NOT',
  'BUFFER',
  'AND',
  'NAND',
  'OR',
  'NOR',
  'XOR',
  'XNOR',
];
