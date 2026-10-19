import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { fileURLToPath } from 'node:url';

// Сборка в один HTML-файл (без воркера): удобно открывать локально или публиковать как страницу.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  base: './',
  resolve: { alias: [{ find: /^\.\/workerFactory$/, replacement: fileURLToPath(new URL('./src/ui/workerFactory.stub.ts', import.meta.url)) }] },
  build: { outDir: 'dist-single', emptyOutDir: true },
});
