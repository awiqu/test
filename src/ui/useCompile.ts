import { useEffect, useRef, useState } from 'react';
import { Circuit } from '../model/types';
import { CompileResult, ExportSettings, compile } from '../compiler/compile';
import type { WorkerRequest, WorkerResponse } from '../compiler/worker';
import { createCompileWorker } from './workerFactory';

export interface CompileState {
  status: 'idle' | 'running' | 'done' | 'error';
  progress: string;
  result: CompileResult | null;
  error: string | null;
  /** Время расчёта, мс. */
  elapsed: number;
}

/**
 * Запускает генерацию в Web Worker (UI не подвисает); при изменении входных данных предыдущий расчёт отменяется.
 * Если воркер недоступен (песочница, file://) — считаем в основном потоке.
 */
export function useCompile(circuit: Circuit, settings: ExportSettings, enabled: boolean): CompileState & { rerun: () => void } {
  const [state, setState] = useState<CompileState>({ status: 'idle', progress: '', result: null, error: null, elapsed: 0 });
  const [nonce, setNonce] = useState(0);
  const idRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    const id = ++idRef.current;
    setState((s) => ({ ...s, status: 'running', progress: 'Подготовка…', error: null }));
    const t0 = performance.now();
    let worker: Worker | null = null;
    let cancelled = false;
    const done = (result: CompileResult): void => {
      if (cancelled || id !== idRef.current) return;
      setState({ status: 'done', progress: '', result, error: null, elapsed: Math.round(performance.now() - t0) });
    };
    const fail = (message: string): void => {
      if (cancelled || id !== idRef.current) return;
      setState({ status: 'error', progress: '', result: null, error: message, elapsed: 0 });
    };
    const runInMainThread = (): void => {
      setTimeout(() => {
        if (cancelled) return;
        try {
          done(compile(circuit, settings, { onProgress: (message) => !cancelled && setState((s) => ({ ...s, progress: message })) }));
        } catch (e) {
          fail(e instanceof Error ? e.message : String(e));
        }
      }, 30);
    };
    const timer = setTimeout(() => {
      if (typeof Worker === 'undefined') return runInMainThread();
      try {
        worker = createCompileWorker();
      } catch {
        worker = null;
      }
      if (!worker) return runInMainThread();
      worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const m = e.data;
        if (m.id !== idRef.current || cancelled) return;
        if (m.type === 'progress') setState((s) => ({ ...s, progress: m.message }));
        else if (m.type === 'result') {
          done(m.result);
          worker?.terminate();
        } else {
          fail(m.message);
          worker?.terminate();
        }
      };
      worker.onerror = () => {
        // воркер не запустился (например, запрещён политикой страницы) — считаем здесь
        worker?.terminate();
        worker = null;
        runInMainThread();
      };
      const req: WorkerRequest = { id, circuit, settings };
      worker.postMessage(req);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      worker?.terminate();
    };
  }, [circuit, settings, enabled, nonce]);

  return { ...state, rerun: () => setNonce((n) => n + 1) };
}
