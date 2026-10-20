import { useCallback, useEffect, useRef, useState } from 'react';
import { ComputerProject } from '../types';
import { ComputerBuildError, ComputerExportSettings, exportComputer } from '../../cpu/computerExport';
import { BuildOutput, toBuildOutput } from '../../cpu/buildResult';
import type { BuildRequest, BuildResponse } from '../../cpu/worker';
import { createComputerWorker } from '../../ui/workerFactory';

export interface BuildState {
  status: 'idle' | 'running' | 'done' | 'error';
  progress: string;
  result: BuildOutput | null;
  error: string | null;
  issues: string[];
  /** Время постройки, мс. */
  elapsed: number;
  /** Расчёт идёт в основном потоке (воркер недоступен) — страница на это время замирает. */
  mainThread: boolean;
}

const IDLE: BuildState = { status: 'idle', progress: '', result: null, error: null, issues: [], elapsed: 0, mainThread: false };

/** Запускает постройку по кнопке: в воркере, а если он недоступен — в основном потоке. */
export function useComputerBuild(): BuildState & { start: (project: ComputerProject, settings: ComputerExportSettings) => void; cancel: () => void } {
  const [state, setState] = useState<BuildState>(IDLE);
  const idRef = useRef(0);
  const workerRef = useRef<Worker | null>(null);

  const cancel = useCallback(() => {
    idRef.current++;
    workerRef.current?.terminate();
    workerRef.current = null;
    setState((s) => (s.status === 'running' ? { ...IDLE, result: s.result } : s));
  }, []);

  useEffect(
    () => () => {
      idRef.current++;
      workerRef.current?.terminate();
    },
    [],
  );

  const start = useCallback((project: ComputerProject, settings: ComputerExportSettings) => {
    const id = ++idRef.current;
    const t0 = performance.now();
    setState((s) => ({ ...s, status: 'running', progress: 'Подготовка…', error: null, issues: [], mainThread: false }));
    const live = (): boolean => id === idRef.current;
    const done = (result: BuildOutput): void => {
      if (live()) setState({ status: 'done', progress: '', result, error: null, issues: [], elapsed: Math.round(performance.now() - t0), mainThread: false });
    };
    const fail = (message: string, issues: string[]): void => {
      if (live()) setState((s) => ({ ...s, status: 'error', progress: '', error: message, issues, elapsed: 0 }));
    };
    const inMainThread = (): void => {
      setState((s) => ({ ...s, mainThread: true, progress: 'Расчёт в основном потоке: страница может ненадолго замереть…' }));
      setTimeout(() => {
        if (!live()) return;
        try {
          done(toBuildOutput(exportComputer(project, settings)));
        } catch (e) {
          fail(e instanceof Error ? e.message : String(e), e instanceof ComputerBuildError ? e.issues : []);
        }
      }, 60);
    };
    setTimeout(() => {
      if (!live()) return;
      // воркер живёт между постройками: в нём хранится кэш скомпилированных блоков логики, и повторная постройка идёт заметно быстрее
      let worker: Worker | null = workerRef.current;
      if (!worker) {
        try {
          worker = typeof Worker === 'undefined' ? null : createComputerWorker();
        } catch {
          worker = null;
        }
      }
      if (!worker) return inMainThread();
      workerRef.current = worker;
      worker.onmessage = (e: MessageEvent<BuildResponse>) => {
        const m = e.data;
        if (m.id !== idRef.current) return;
        if (m.type === 'progress') setState((s) => ({ ...s, progress: m.message }));
        else if (m.type === 'result') done(m.result);
        else fail(m.message, m.issues);
      };
      worker.onerror = () => {
        worker?.terminate();
        workerRef.current = null;
        if (live()) inMainThread();
      };
      const req: BuildRequest = { id, project, settings };
      worker.postMessage(req);
    }, 50);
  }, []);

  return { ...state, start, cancel };
}
