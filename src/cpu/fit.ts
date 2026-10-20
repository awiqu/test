/**
 * Помещается ли плата в дальность прорисовки и симуляции игры. Редстоун работает только в загруженных и тикающих чанках вокруг
 * игрока (по умолчанию дальность прорисовки 12, дальность симуляции 10 чанков), поэтому плату надо рассматривать, стоя в её центре:
 * от центра до самого дальнего края — max(x, z) / 2 блоков.
 */
export interface BoardFit {
  /** Радиус от центра платы до дальнего края в чанках (с округлением вверх). */
  chunks: number;
  level: 'ok' | 'warn' | 'bad';
  text: string;
}

export const DEFAULT_RENDER_DISTANCE = 12;
export const DEFAULT_SIMULATION_DISTANCE = 10;

export function boardFit(size: { x: number; z: number }): BoardFit {
  const chunks = Math.ceil(Math.max(size.x, size.z) / 2 / 16);
  if (chunks <= DEFAULT_SIMULATION_DISTANCE) {
    return { chunks, level: 'ok', text: `Плата помещается в стандартную дальность симуляции (${DEFAULT_SIMULATION_DISTANCE} чанков): встаньте в её центре.` };
  }
  if (chunks <= DEFAULT_RENDER_DISTANCE) {
    return {
      chunks,
      level: 'warn',
      text: `От центра до края платы ${chunks} чанков: встаньте в центре и поднимите дальность симуляции до ${chunks} (по умолчанию ${DEFAULT_SIMULATION_DISTANCE}), иначе дальние узлы не будут работать.`,
    };
  }
  return {
    chunks,
    level: 'bad',
    text: `От центра до края платы ${chunks} чанков — больше стандартной дальности прорисовки (${DEFAULT_RENDER_DISTANCE}). Поднимите дальность прорисовки и симуляции до ${chunks}, выберите компактную раскладку или упростите программу.`,
  };
}
