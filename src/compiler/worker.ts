import { compile, ExportSettings, CompileResult } from './compile';
import { Circuit } from '../model/types';

export interface WorkerRequest {
  id: number;
  circuit: Circuit;
  settings: ExportSettings;
}

export type WorkerResponse =
  | { id: number; type: 'progress'; message: string }
  | { id: number; type: 'result'; result: CompileResult }
  | { id: number; type: 'error'; message: string };

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const { id, circuit, settings } = e.data;
  const post = (m: WorkerResponse): void => (self as unknown as Worker).postMessage(m);
  try {
    const result = compile(circuit, settings, { onProgress: (message) => post({ id, type: 'progress', message }) });
    post({ id, type: 'result', result });
  } catch (err) {
    post({ id, type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
