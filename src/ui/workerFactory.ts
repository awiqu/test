/** Создаёт воркер генерации. В одно-файловой сборке подменяется заглушкой (workerFactory.stub.ts). */
export function createCompileWorker(): Worker | null {
  return new Worker(new URL('../compiler/worker.ts', import.meta.url), { type: 'module' });
}

/** Воркер постройки компьютера (вкладка «Компьютеры»). */
export function createComputerWorker(): Worker | null {
  return new Worker(new URL('../cpu/worker.ts', import.meta.url), { type: 'module' });
}
