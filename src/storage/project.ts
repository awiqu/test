import { zipSync } from 'fflate';
import { Circuit } from '../model/types';
import { ExportSettings } from '../compiler/compile';

export interface ProjectFile {
  name: string;
  circuit: Circuit;
  settings?: Partial<ExportSettings>;
}

interface FileEnvelope {
  format: 'redlogic-project';
  version: 1;
  name: string;
  savedAt: string;
  circuit: Circuit;
  settings?: Partial<ExportSettings>;
}

const KEY = 'redlogic:autosave:v1';

export function saveAutosave(p: ProjectFile): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* хранилище недоступно — автосохранение пропускаем */
  }
}

export function loadAutosave(): ProjectFile | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as ProjectFile;
    return validate(p) ? p : null;
  } catch {
    return null;
  }
}

function validate(p: unknown): p is ProjectFile {
  const q = p as ProjectFile;
  return !!q && typeof q.name === 'string' && !!q.circuit && Array.isArray(q.circuit.gates) && Array.isArray(q.circuit.wires);
}

export function serializeProject(p: ProjectFile): string {
  const env: FileEnvelope = {
    format: 'redlogic-project',
    version: 1,
    name: p.name,
    savedAt: new Date().toISOString(),
    circuit: p.circuit,
    settings: p.settings,
  };
  return JSON.stringify(env, null, 2);
}

export function parseProject(text: string): ProjectFile {
  const data = JSON.parse(text) as Partial<FileEnvelope>;
  if (data.format !== 'redlogic-project' || !data.circuit) throw new Error('Это не файл проекта RedLogic');
  const p: ProjectFile = { name: data.name ?? 'Без названия', circuit: data.circuit, settings: data.settings };
  if (!validate(p)) throw new Error('Файл проекта повреждён');
  // нормализация: гарантируем поля
  p.circuit = {
    gates: p.circuit.gates.map((g) => ({ ...g, label: g.label ?? '', value: g.value ?? false, delay: g.delay ?? 1, inputs: g.inputs ?? 0 })),
    wires: p.circuit.wires,
  };
  return p;
}

interface ClaudeRuntime {
  use?: (name: string) => Promise<unknown>;
}
interface DownloadsApi {
  save(req: { filename: string; data: string | Blob | ArrayBuffer | ArrayBufferView }): Promise<{ status: string }>;
}

/** Расширения, которые принимает встроенное сохранение хост-страницы (песочница блокирует обычные скачивания). */
const HOST_EXTENSIONS = new Set(['json', 'txt', 'md', 'csv', 'zip', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'pdf', 'html']);

/**
 * Сохраняет файл. В обычном браузере — скачивание по ссылке. Внутри встроенного окна (где скачивание
 * запрещено) — через возможность `downloads`; неподдерживаемые расширения (.litematic) упаковываются в .zip.
 */
export async function saveFile(
  fileName: string,
  data: string | Uint8Array,
  mime = 'application/octet-stream',
): Promise<'saved' | 'zipped' | 'cancelled'> {
  const runtime = (window as unknown as { claude?: ClaudeRuntime }).claude;
  if (runtime?.use) {
    let api: DownloadsApi | null = null;
    try {
      api = (await runtime.use('downloads')) as DownloadsApi | null;
    } catch {
      api = null;
    }
    if (api) {
      const ext = fileName.split('.').pop()!.toLowerCase();
      let name = fileName;
      let payload: string | Uint8Array = data;
      let zipped = false;
      if (!HOST_EXTENSIONS.has(ext)) {
        const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
        payload = zipSync({ [fileName]: bytes });
        name = `${fileName}.zip`;
        zipped = true;
      }
      try {
        await api.save({ filename: name, data: payload as BlobPart as Blob });
        return zipped ? 'zipped' : 'saved';
      } catch {
        return 'cancelled';
      }
    }
  }
  downloadBlob(new Blob([data as BlobPart], { type: mime }), fileName, mime);
  return 'saved';
}

export function downloadBlob(data: BlobPart, fileName: string, mime = 'application/octet-stream'): void {
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}
