// Сквозная проверка редактора в Chromium: размещение, провода, перемещение, копирование, отмена, меню, файлы, экспорт.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const URL = process.env.URL ?? 'http://localhost:4173/';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });
page.on('dialog', (d) => d.accept());

let failed = 0;
const newProject = async () => {
  await page.locator('.topbar button', { hasText: /^Новый$/ }).click();
  const confirm = page.locator('.modal.tiny .btn.danger-solid');
  if (await confirm.count()) await confirm.click();
};
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!cond) failed++;
};
const state = () => page.evaluate(() => {
  const s = window.__redlogic.getState();
  return { gates: s.circuit.gates.length, wires: s.circuit.wires.length, sel: s.selection.size, past: s.past.length, view: s.view, tool: s.tool, placing: s.placing, circuit: s.circuit };
});

await page.goto(URL);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForTimeout(500);

let st = await state();
check('пример загружен (13 гейтов, 16 проводов)', st.gates === 13 && st.wires === 16, `${st.gates}/${st.wires}`);

// переключатель входа
await page.locator('.canvas rect[data-switch]').first().click();
const v = await page.evaluate(() => window.__redlogic.getState().circuit.gates.filter((g) => g.type === 'INPUT').map((g) => g.value));
check('клик по рычагу переключает вход', v.includes(true), JSON.stringify(v));

// новый проект
await newProject();
st = await state();
check('новый проект пуст', st.gates === 0);

// расстановка гейтов
const place = async (label, x, y) => {
  await page.click(`.tb-gate[aria-label^="${label}"]`);
  await page.mouse.click(x, y);
};
await place('Вход', 330, 250);
await place('Вход', 330, 400);
await place('И (AND)', 620, 320);
await place('Выход', 900, 330);
st = await state();
check('поставлено 4 гейта', st.gates === 4, String(st.gates));
check('режим расстановки сброшен', st.placing === null);

// провода перетаскиванием
const pinPos = async (sel) => { const b = await page.locator(sel).first().boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
const ids = await page.evaluate(() => window.__redlogic.getState().circuit.gates.map((g) => ({ id: g.id, type: g.type })));
const idOf = (t, n = 0) => ids.filter((g) => g.type === t)[n].id;
const drag = async (a, b) => { await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 5 }); await page.mouse.move(b.x, b.y, { steps: 5 }); await page.mouse.up(); };
await drag(await pinPos(`[data-pin="out:${idOf('INPUT', 0)}:0"]`), await pinPos(`[data-pin="in:${idOf('AND')}:0"]`));
await drag(await pinPos(`[data-pin="out:${idOf('INPUT', 1)}:0"]`), await pinPos(`[data-pin="in:${idOf('AND')}:1"]`));
await drag(await pinPos(`[data-pin="out:${idOf('AND')}:0"]`), await pinPos(`[data-pin="in:${idOf('OUTPUT')}:0"]`));
st = await state();
check('3 провода создано перетаскиванием', st.wires === 3, String(st.wires));

// симуляция: оба входа в 1 → выход 1
for (const sw of await page.locator('.canvas rect[data-switch]').all()) await sw.click();
const outOn = await page.evaluate(() => { const c = window.__redlogic.getState().circuit; return c.gates.filter((g) => g.type === 'INPUT').every((g) => g.value); });
check('оба входа включены', outOn);

// перемещение гейта
const before = (await state()).circuit.gates.find((g) => g.type === 'AND');
const andBox = await page.locator(`[data-gate="${idOf('AND')}"]`).boundingBox();
await drag({ x: andBox.x + andBox.width / 2, y: andBox.y + andBox.height / 2 }, { x: andBox.x + andBox.width / 2 + 90, y: andBox.y + andBox.height / 2 + 60 });
const after = (await state()).circuit.gates.find((g) => g.type === 'AND');
check('перетаскивание сдвигает гейт', after.x > before.x && after.y > before.y && after.x % 15 === 0, `${before.x},${before.y} → ${after.x},${after.y}`);

// выделить всё, копировать, вставить
await page.mouse.click(700, 700);
await page.keyboard.press('Control+a');
await page.keyboard.press('Control+c');
await page.keyboard.press('Control+v');
st = await state();
check('копирование/вставка: 8 гейтов, 6 проводов', st.gates === 8 && st.wires === 6, `${st.gates}/${st.wires}`);
await page.keyboard.press('Control+z');
st = await state();
check('отмена вставки', st.gates === 4 && st.wires === 3, `${st.gates}/${st.wires}`);
await page.keyboard.press('Control+y');
st = await state();
check('повтор вставки', st.gates === 8);
await page.keyboard.press('Control+a');
await page.keyboard.press('Delete');
st = await state();
check('удаление всего выделенного', st.gates === 0, String(st.gates));

// контекстное меню на гейте
await page.keyboard.press('Control+z');
st = await state();
const gid = idOf('AND');
const gb = await page.locator(`[data-gate="${gid}"]`).boundingBox();
const hitId = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('[data-gate]')?.getAttribute('data-gate'), [gb.x + gb.width / 2, gb.y + gb.height / 2]);
await page.mouse.click(gb.x + gb.width / 2, gb.y + gb.height / 2, { button: 'right' });
await page.waitForSelector('.ctx');
const menuText = await page.locator('.ctx').innerText();
check('контекстное меню гейта содержит «Копировать» и «Удалить»', menuText.includes('Копировать') && menuText.includes('Удалить'), menuText.replace(/\n/g, ' | '));
await page.click('.ctx >> text=Добавить вход (2 → 3)');
st = await state();
check('меню: число входов AND → 3', st.circuit.gates.find((g) => g.id === hitId)?.inputs === 3, JSON.stringify(st.circuit.gates.filter((g) => g.type === 'AND').map((g) => [g.id === gid, g.inputs])));

// масштаб и панорама
const z0 = (await state()).view.zoom;
await page.mouse.move(700, 450);
await page.mouse.wheel(0, -300);
await page.waitForTimeout(100);
const z1 = (await state()).view.zoom;
check('колесо мыши масштабирует', z1 > z0, `${z0.toFixed(2)} → ${z1.toFixed(2)}`);
await page.keyboard.press('h');
const pan0 = (await state()).view;
await page.mouse.move(600, 600); await page.mouse.down(); await page.mouse.move(660, 640, { steps: 4 }); await page.mouse.up();
const pan1 = (await state()).view;
check('инструмент «рука» двигает поле', pan1.panX !== pan0.panX);
await page.keyboard.press('v');

// сохранение/загрузка
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('text=Сохранить')]);
const saved = JSON.parse(readFileSync(await dl.path(), 'utf8'));
const nSaved = (await state()).gates;
check('сохранение проекта в .redlogic.json', saved.format === 'redlogic-project' && saved.circuit.gates.length === nSaved, `${dl.suggestedFilename()} (${nSaved} гейтов)`);
writeFileSync('/tmp/saved.redlogic.json', JSON.stringify(saved));
await newProject();
const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('text=Открыть')]);
await fc.setFiles('/tmp/saved.redlogic.json');
await page.waitForTimeout(300);
st = await state();
check('загрузка проекта из файла', st.gates === nSaved, `${st.gates}/${st.wires}`);

// пример + экспорт
await newProject();
await page.click('text=Загрузить пример');
await page.click('text=Экспорт в .litematic');
await page.waitForSelector('.stats', { timeout: 60000 });
const badge = await page.locator('.badge').innerText();
check('экспорт: проверка пройдена', badge.includes('✓'), badge);
// смена материала и цвета
await page.selectOption('.settings .field:has-text("Блок для гейтов") select >> nth=1', 'red');
await page.waitForSelector('.stats', { timeout: 60000 });
await page.waitForTimeout(800);
const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('text=Скачать .litematic')]);
const bytes = readFileSync(await dl2.path());
writeFileSync('/tmp/e2e.litematic', bytes);
check('скачан .litematic (gzip)', bytes[0] === 0x1f && bytes[1] === 0x8b, `${bytes.length} B, ${dl2.suggestedFilename()}`);
check('нет ошибок в консоли', errors.length === 0, errors.join(' | '));

await browser.close();
console.log(failed === 0 ? '\nВСЕ ПРОВЕРКИ ПРОЙДЕНЫ' : `\nПРОВАЛЕНО: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
