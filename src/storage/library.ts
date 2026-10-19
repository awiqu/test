import { Circuit } from '../model/types';
import { ExportSettings } from '../compiler/compile';
import { uid } from '../model/circuit';

export interface LibraryEntry {
  id: string;
  name: string;
  savedAt: number;
  gateCount: number;
  circuit: Circuit;
  settings?: Partial<ExportSettings>;
}

const KEY = 'redlogic:library:v1';

export function loadLibrary(): LibraryEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as LibraryEntry[];
    return Array.isArray(list) ? list.filter((e) => e && e.circuit && Array.isArray(e.circuit.gates)) : [];
  } catch {
    return [];
  }
}

function write(list: LibraryEntry[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

/** Сохраняет проект; запись с тем же именем перезаписывается. */
export function saveToLibrary(name: string, circuit: Circuit, settings?: Partial<ExportSettings>): LibraryEntry[] {
  const list = loadLibrary();
  const existing = list.findIndex((e) => e.name === name);
  const entry: LibraryEntry = {
    id: existing >= 0 ? list[existing].id : uid('p'),
    name,
    savedAt: Date.now(),
    gateCount: circuit.gates.length,
    circuit,
    settings,
  };
  if (existing >= 0) list[existing] = entry;
  else list.unshift(entry);
  write(list);
  return list;
}

export function removeFromLibrary(id: string): LibraryEntry[] {
  const list = loadLibrary().filter((e) => e.id !== id);
  write(list);
  return list;
}

export function renameInLibrary(id: string, name: string): LibraryEntry[] {
  const list = loadLibrary().map((e) => (e.id === id ? { ...e, name } : e));
  write(list);
  return list;
}
