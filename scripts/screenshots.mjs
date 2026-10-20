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
// ───────── вкладка «Компьютеры» ─────────
await page.waitForTimeout(3200); // дать исчезнуть уведомлению
await page.setViewportSize({ width: 1440, height: 1000 });
await page.click('.mode-tabs button:has-text("Компьютеры")');
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/10-computers-spec.png` });
await page.evaluate(() => { document.querySelector('.cs-content').scrollTop = 700; });
await page.waitForTimeout(150);
await page.screenshot({ path: `${OUT}/11-computers-devices.png` });

const step = (t) => page.locator('.cs-steps .cs-step', { hasText: t }).first().click();
await step('Инструкции');
await page.click('text=Настроить команды самому');
await page.locator('.cs-isa-list tbody tr', { hasText: 'ADD' }).first().click();
await page.waitForTimeout(150);
await page.screenshot({ path: `${OUT}/12-computers-isa.png` });
await page.click('text=＋ Из каталога');
await page.waitForTimeout(200);
await page.screenshot({ path: `${OUT}/13-computers-catalog.png` });

await step('Ассемблер');
await page.waitForTimeout(200);
await page.evaluate(() => { document.querySelector('.cs-content').scrollTop = 99999; });
await page.waitForTimeout(150);
await page.screenshot({ path: `${OUT}/14-computers-assembler-python.png` });

await step('Программы');
await page.selectOption('.cs-progbar select >> nth=0', { label: 'Привет, мир!' });
await page.selectOption('.sim-controls select', '60000');
await page.click('text=▶ Запустить');
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/15-computers-simulator-hello.png` });
await page.click('text=⟲ Сброс');
await page.selectOption('.cs-progbar select >> nth=0', { label: 'Числа Фибоначчи (hex)' });
await page.selectOption('.sim-controls select', '60000');
await page.click('text=▶ Запустить');
await page.waitForTimeout(900);
await page.evaluate(() => { document.querySelector('.cs-content').scrollTop = 500; });
await page.waitForTimeout(150);
await page.screenshot({ path: `${OUT}/16-computers-simulator-fibonacci.png` });

await step('ПЗУ');
await page.waitForSelector('.cs-rom-main .stats');
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/17-computers-rom-iso.png` });
await page.click('.cs-rom-main .preview-bar .seg button:has-text("Карта значений")');
await page.waitForTimeout(250);
await page.screenshot({ path: `${OUT}/18-computers-rom-map.png` });

await step('Аппаратура');
await page.locator('.cs-hw-list .cs-card', { hasText: 'Дешифратор команд' }).click();
await page.waitForTimeout(250);
await page.screenshot({ path: `${OUT}/19-computers-hardware.png` });

await page.locator('.cs-steps .cs-step', { hasText: 'документация' }).click();
await page.click('.cs-tabs button:has-text("Промпты")');
await page.locator('.cs-card', { hasText: 'Написать программу' }).click();
await page.fill('.cs-wishes', 'Сделай бегущий огонёк на светодиодах: лампы зажигаются по очереди туда и обратно.');
await page.waitForTimeout(250);
await page.screenshot({ path: `${OUT}/20-computers-ai-prompt.png` });
await page.click('.cs-tabs button:has-text("Документация")');
await page.locator('.cs-docs-nav button', { hasText: 'Язык RTL' }).click();
await page.waitForTimeout(200);
await page.screenshot({ path: `${OUT}/21-computers-ai-docs.png` });

// постройка ПК (нужна аккумуляторная заготовка — переключаем в самом конце вкладки)
await step('Характеристики');
await page.locator('.cs-card', { hasText: 'Мини-4' }).click();
await step('Постройка ПК');
await page.click('button:has-text("Построить компьютер")');
await page.waitForSelector('.result-bar .stats', { timeout: 300000 });
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/24-computers-build.png` });
await page.click('.preview-bar button:has-text("План")');
await page.waitForSelector('.preview-stage canvas');
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/25-computers-build-plan.png` });

// схемы из текста
await page.click('.mode-tabs button:has-text("Схемы")');
await page.waitForTimeout(300);
await page.click('button:has-text("Текст / ИИ")');
await page.fill('textarea[aria-label="Нетлист"]', 'input a b cin\nx = XOR(a, b)\nsum = XOR(x, cin)\ng = AND(a, b)\np = AND(x, cin)\ncout = OR(g, p)\noutput S = sum\noutput Cout = cout\n');
await page.waitForTimeout(250);
await page.screenshot({ path: `${OUT}/22-circuit-netlist.png` });
await page.click('button:has-text("Заменить схему")');
await page.waitForTimeout(150);
if (await page.locator('.modal.tiny').count()) await page.locator('.modal.tiny .btn.primary, .modal.tiny .btn.danger-solid').first().click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/23-circuit-from-text.png` });

await browser.close();
console.log(logs.join('\n') || 'консоль без ошибок');
