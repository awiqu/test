// Снимает скриншоты редактора через Playwright (Chromium).
// Запуск: npm run build && npx vite preview --port 4173 & node scripts/screenshots.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require('/opt/node22/lib/node_modules/playwright'));
}

const URL = process.env.URL ?? 'http://localhost:4173/';
const OUT = process.env.OUT ?? 'docs/screenshots';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('dialog', (d) => d.accept());

await page.goto(URL);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/01-editor.png` });

// включаем входы x и y — сигналы подсвечиваются
const sw = await page.$$('.canvas rect[data-switch]');
await sw[0].click();
await sw[1].click();
await page.waitForTimeout(150);
await page.screenshot({ path: `${OUT}/02-simulation.png` });

// выделение рамкой + контекстное меню гейта
await page.mouse.move(500, 290);
await page.mouse.down();
await page.mouse.move(990, 480, { steps: 8 });
await page.mouse.up();
await page.mouse.click(540, 342, { button: 'right' });
await page.waitForSelector('.ctx');
await page.waitForTimeout(120);
await page.screenshot({ path: `${OUT}/03-selection-context-menu.png` });
await page.keyboard.press('Escape');

// режим расстановки гейта (призрак у курсора)
await page.click('.tb-gate[aria-label^="Искл. ИЛИ-НЕ"]');
await page.mouse.move(780, 640);
await page.waitForTimeout(100);
await page.screenshot({ path: `${OUT}/04-placing-gate.png` });
await page.keyboard.press('Escape');

// таблица истинности
await page.click('.section-toggle');
await page.waitForTimeout(150);
await page.screenshot({ path: `${OUT}/05-truth-table.png` });

// экспорт: красные гейты
await page.click('text=Экспорт в .litematic');
await page.waitForSelector('.stats', { timeout: 60000 });
await page.selectOption('.settings .field:has-text("Блок для гейтов") select >> nth=1', 'red');
await page.waitForTimeout(600);
await page.waitForSelector('.stats', { timeout: 60000 });
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/06-export-iso.png` });
await page.click('.preview-bar .seg button:has-text("План")');
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/07-export-plan.png` });
// варианты гейтов (прокрутка настроек)
await page.evaluate(() => { document.querySelector('.settings').scrollTop = 9999; });
await page.waitForTimeout(200);
await page.screenshot({ path: `${OUT}/08-export-variants.png` });
await page.keyboard.press('Escape');

// проекты и компьютеры
await page.click('text=Проекты');
await page.click('text=Сохранить сюда');
await page.waitForTimeout(200);
await page.screenshot({ path: `${OUT}/09-projects.png` });
await page.keyboard.press('Escape');
await page.click('text=Компьютеры');
await page.waitForTimeout(200);
await page.screenshot({ path: `${OUT}/10-computers-stub.png` });

await browser.close();
console.log(logs.join('\n') || 'консоль без ошибок');
