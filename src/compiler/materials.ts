/** Строительные блоки (только полные непрозрачные блоки — они проводят редстоун-сигнал). */
export interface MaterialDef {
  id: string;
  name: string;
  /** Если задано — блок цветной: итоговый id = `${color}_${suffix}`. */
  colored?: string;
  block?: string;
}

export const MATERIALS: MaterialDef[] = [
  { id: 'stone', name: 'Камень', block: 'minecraft:stone' },
  { id: 'smooth_stone', name: 'Гладкий камень', block: 'minecraft:smooth_stone' },
  { id: 'stone_bricks', name: 'Каменные кирпичи', block: 'minecraft:stone_bricks' },
  { id: 'cobblestone', name: 'Булыжник', block: 'minecraft:cobblestone' },
  { id: 'polished_andesite', name: 'Полированный андезит', block: 'minecraft:polished_andesite' },
  { id: 'polished_deepslate', name: 'Полированный глубинный сланец', block: 'minecraft:polished_deepslate' },
  { id: 'quartz_block', name: 'Кварцевый блок', block: 'minecraft:quartz_block' },
  { id: 'oak_planks', name: 'Дубовые доски', block: 'minecraft:oak_planks' },
  { id: 'concrete', name: 'Бетон (цветной)', colored: 'concrete' },
  { id: 'wool', name: 'Шерсть (цветная)', colored: 'wool' },
  { id: 'terracotta', name: 'Терракота (цветная)', colored: 'terracotta' },
];

export interface DyeColor {
  id: string;
  name: string;
  css: string;
}

export const COLORS: DyeColor[] = [
  { id: 'white', name: 'Белый', css: '#d9dde1' },
  { id: 'light_gray', name: 'Светло-серый', css: '#9d9d97' },
  { id: 'gray', name: 'Серый', css: '#474f52' },
  { id: 'black', name: 'Чёрный', css: '#080a0f' },
  { id: 'brown', name: 'Коричневый', css: '#724728' },
  { id: 'red', name: 'Красный', css: '#8e2121' },
  { id: 'orange', name: 'Оранжевый', css: '#e06101' },
  { id: 'yellow', name: 'Жёлтый', css: '#f0af15' },
  { id: 'lime', name: 'Лаймовый', css: '#5ea918' },
  { id: 'green', name: 'Зелёный', css: '#495b24' },
  { id: 'cyan', name: 'Бирюзовый', css: '#157788' },
  { id: 'light_blue', name: 'Голубой', css: '#258ec9' },
  { id: 'blue', name: 'Синий', css: '#2c2e8f' },
  { id: 'purple', name: 'Фиолетовый', css: '#64209c' },
  { id: 'magenta', name: 'Пурпурный', css: '#a9309f' },
  { id: 'pink', name: 'Розовый', css: '#d5658f' },
];

export interface BlockChoice {
  material: string;
  color: string;
}

export function blockName(choice: BlockChoice): string {
  const m = MATERIALS.find((x) => x.id === choice.material) ?? MATERIALS[0];
  if (m.colored) return `minecraft:${choice.color}_${m.colored}`;
  return m.block!;
}

/** Цвет для предпросмотра. */
export function blockCss(choice: BlockChoice): string {
  const m = MATERIALS.find((x) => x.id === choice.material) ?? MATERIALS[0];
  if (m.colored) return COLORS.find((c) => c.id === choice.color)?.css ?? '#888';
  const table: Record<string, string> = {
    stone: '#7d7d7d',
    smooth_stone: '#9a9a9a',
    stone_bricks: '#777777',
    cobblestone: '#6f6f6f',
    polished_andesite: '#888a88',
    polished_deepslate: '#4b4b4f',
    quartz_block: '#e8e3da',
    oak_planks: '#a8864f',
  };
  return table[m.id] ?? '#888';
}
