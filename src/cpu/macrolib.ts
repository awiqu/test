import { ExportSettings } from '../compiler/compile';
import { Macro, compileMacro, macroSettings } from './macro';

const cache = new Map<string, Macro>();

/** Скомпилированные блоки (макросы) кэшируются по тексту нетлиста и настройкам: одинаковые разряды собираются один раз. */
export function getMacro(netlist: string, settings: ExportSettings = macroSettings()): Macro {
  const key = `${JSON.stringify({ v: settings.variants, w: settings.wireBlock, g: settings.gateBlock, d: settings.inputDevice })}\n${netlist}`;
  let m = cache.get(key);
  if (!m) {
    m = compileMacro(netlist, settings);
    cache.set(key, m);
  }
  return m;
}

export function clearMacroCache(): void {
  cache.clear();
}
