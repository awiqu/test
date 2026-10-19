/** Создаёт воркер генерации. В одно-файловой сборке подменяется заглушкой (workerFactory.stub.ts). */
export function createCompileWorker(): Worker | null {
  return new Worker(new URL('../compiler/worker.ts', import.meta.url), { type: 'module' });
}
