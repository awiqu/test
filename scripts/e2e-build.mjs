// Сквозная проверка шага «Постройка ПК»: настройки компонентов, постройка в воркере, предпросмотр, скачивание .litematic и руководства.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const URL = process.env.URL ?? 'http://localhost:4173/';
const SHOT = process.env.SHOT_DIR ?? '/tmp';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });
let failed = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!cond) failed++;
};
const step = (t) => page.locator('.cs-steps .cs-step', { hasText: t }).first().click();

await page.goto(URL);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForTimeout(400);
await page.click('.mode-tabs button:has-text("Компьютеры")');
await page.locator('.cs-card', { hasText: 'Мини-4' }).click();
await step('Постройка ПК');
check('шаг «Постройка ПК» открылся', (await page.locator('.cs-welcome h2').innerText()).includes('Постройка компьютера'));
const sideText = await page.locator('.cs-rom-opts').innerText();
check('показан разбор ПЗУ до постройки', /ПЗУ \d+ слов × \d+ бит/.test(sideText), (/ПЗУ \d+ слов × \d+ бит[^\n]*/.exec(sideText) ?? [''])[0]);
check('предложены все 5 контейнеров', (await page.locator('.cs-cont').count()) === 5);
await page.locator('.cs-cont', { hasText: 'Воронка' }).click();
check('контейнер «Воронка» выбран', (await page.locator('.cs-cont.on').innerText()).includes('Воронка'));
const need = await page.locator('.cs-rom-opts').innerText();
check('число предметов пересчитано под воронку (5 на единицу)', /предметов в них: [\d\s ]+/.test(need));
await page.selectOption('.cs-rom-opts select >> nth=1', 'minecraft:wooden_sword').catch(() => {});

// постройка
await page.click('button:has-text("Построить компьютер")');
check('идёт постройка (кнопка и прогресс)', (await page.locator('.preview-bar').innerText()).includes('Строю'));
await page.waitForSelector('.result-bar .stats', { timeout: 300000 });
const stats = await page.locator('.result-bar .stats').innerText();
check('показаны габариты и число блоков', /\d+×\d+×\d+/.test(stats) && stats.includes('блоков'), stats.replace(/\n/g, ' '));
check('показано время такта', stats.includes('игр. тиков на фазу'));
await page.screenshot({ path: `${SHOT}/build-board.png` });
await page.click('.preview-bar button:has-text("План")');
await page.waitForSelector('.preview-stage canvas');
await page.screenshot({ path: `${SHOT}/build-plan.png` });
await page.click('.preview-bar button:has-text("Руководство")');
const guide = await page.locator('.cs-guide').innerText();
check('руководство: рычаги и содержимое ПЗУ', guide.includes('RESET') && guide.includes('## Содержимое ПЗУ') && guide.includes('Воронка'));
await page.screenshot({ path: `${SHOT}/build-guide.png` });

const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("Скачать .litematic")')]);
const path = await dl.path();
const raw = readFileSync(path);
let ok = false;
try { ok = gunzipSync(raw).length > 1000; } catch { ok = false; }
check('скачан валидный .litematic (gzip NBT)', dl.suggestedFilename().endsWith('.litematic') && ok, `${dl.suggestedFilename()} ${raw.length} байт`);
const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("Руководство .md")')]);
check('скачано руководство .md', dl2.suggestedFilename().endsWith('.md'));

// ошибка программы: плата не строится, причина показана
await step('Программы');
const src = page.locator('textarea').first();
await src.fill('bogus 1\n');
await step('Постройка ПК');
check('ошибка программы видна до постройки', (await page.locator('.cs-rom-opts .badge.bad').count()) > 0);
check('кнопка «Построить» недоступна при ошибке', await page.locator('button:has-text("Построить")').first().isDisabled());

check('без ошибок в консоли', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(failed ? `\n${failed} проверок не пройдено` : '\nВсе проверки пройдены');
process.exit(failed ? 1 : 0);
