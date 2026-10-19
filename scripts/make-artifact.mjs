// Превращает dist-single/index.html во фрагмент страницы для публикации как артефакт (без <html>/<head>).
// Запуск: npm run build:single && node scripts/make-artifact.mjs [выходной_файл]
import { readFileSync, writeFileSync } from 'node:fs';

const out = process.argv[2] ?? 'dist-single/artifact.html';
const html = readFileSync('dist-single/index.html', 'utf8');
const sOpen = '<script type="module" crossorigin>';
const a = html.indexOf(sOpen);
const styleOpen = '<style rel="stylesheet" crossorigin>';
const b = html.indexOf(styleOpen);
if (a < 0 || b < 0) throw new Error('Не найдены <script>/<style> в dist-single/index.html — изменился формат сборки?');
const scriptEnd = html.lastIndexOf('</script>', b);
const script = html.slice(a + sOpen.length, scriptEnd);
const styleEnd = html.indexOf('</style>', b);
const style = html.slice(b + styleOpen.length, styleEnd);
const fragment = `<title>RedLogic</title>\n<style>${style}</style>\n<div id="root"></div>\n<script type="module">${script}</script>\n`;
writeFileSync(out, fragment);
console.log(`${out}: ${(fragment.length / 1024).toFixed(0)} КБ`);
