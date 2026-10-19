import { GateType } from '../model/types';

export interface VariantInfo {
  id: string;
  name: string;
  desc: string;
}

/** Доступные реализации гейтов в редстоуне. Первая — по умолчанию. */
export const GATE_VARIANTS: Partial<Record<GateType, VariantInfo[]>> = {
  BUFFER: [
    { id: 'repeater', name: 'Повторитель', desc: '1 повторитель с заданной задержкой' },
    { id: 'torches', name: 'Два факела', desc: 'Двойная инверсия на двух факелах (без повторителя)' },
  ],
  AND: [
    { id: 'demorgan', name: 'Де Морган (факелы)', desc: 'Инверторы на входах → общий NOR-блок: 1 + N факелов' },
    { id: 'merge-not', name: 'Инверторы → диодное ИЛИ → НЕ', desc: 'Инверторы на входах, диодное объединение и ещё один инвертор' },
  ],
  NAND: [
    { id: 'merge', name: 'Инверторы + диодное ИЛИ', desc: 'Самый компактный вариант: N факелов и повторители на сходящихся входах' },
    { id: 'and-not', name: 'И → НЕ', desc: 'Схема И (Де Морган) с инвертором на выходе' },
  ],
  OR: [
    { id: 'merge', name: 'Диодное объединение', desc: 'Входы сходятся на пыли через повторители (компактно)' },
    { id: 'nor-not', name: 'NOR + НЕ (факелы)', desc: 'Без повторителей: NOR-блок и инвертор' },
  ],
  NOR: [
    { id: 'torch', name: 'Факельный NOR', desc: 'Один факел на общем блоке — классика' },
    { id: 'merge-not', name: 'Диодное ИЛИ + НЕ', desc: 'Объединение через повторители и инвертор' },
  ],
  XOR: [
    { id: 'nor', name: 'NOR-схема (5 факелов)', desc: 'XOR = NOR(NOR(a,b), AND(a,b)) — только факелы' },
    { id: 'and-or', name: '(a·¬b) + (¬a·b)', desc: 'Два AND-блока и диодное ИЛИ' },
  ],
  XNOR: [
    { id: 'nor-merge', name: 'NOR(a,b) + AND(a,b)', desc: 'Два блока и диодное ИЛИ' },
    { id: 'xor-not', name: 'XOR → НЕ', desc: 'XOR с инвертором на выходе' },
  ],
};

export type VariantChoice = Partial<Record<GateType, string>>;

export function defaultVariants(): VariantChoice {
  const out: VariantChoice = {};
  for (const [type, list] of Object.entries(GATE_VARIANTS)) out[type as GateType] = list![0].id;
  return out;
}
