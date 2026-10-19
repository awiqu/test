import { Circuit } from '../model/types';

/**
 * Генераторы редстоун-компьютеров — заглушка.
 *
 * Идея: генератор по конфигурации строит обычную логическую схему (`Circuit`),
 * которая дальше проходит тот же путь, что и нарисованная вручную: симуляция → компилятор → .litematic.
 * Поэтому здесь нужно реализовать только `generate`.
 */
export interface ComputerConfig {
  /** Разрядность данных. */
  bits: 4 | 8 | 16;
  /** Число регистров общего назначения. */
  registers: number;
  /** Размер ПЗУ программ (слов). */
  romWords: number;
  /** Размер ОЗУ (слов). */
  ramWords: number;
  /** Набор инструкций. */
  isa: 'minimal' | 'extended';
  /** Тактовый период, тиков редстоуна. */
  clockTicks: number;
}

export interface ComputerGenerator {
  id: string;
  name: string;
  description: string;
  available: boolean;
  defaultConfig: ComputerConfig;
  generate(config: ComputerConfig): Circuit;
}

export const COMPUTERS: ComputerGenerator[] = [
  {
    id: 'simple-cpu',
    name: 'Простой процессор',
    description: 'Аккумуляторный процессор с ПЗУ программ: АЛУ, счётчик команд, регистры.',
    available: false,
    defaultConfig: { bits: 8, registers: 4, romWords: 16, ramWords: 16, isa: 'minimal', clockTicks: 4 },
    generate() {
      throw new Error('Генератор компьютеров пока не реализован');
    },
  },
];
