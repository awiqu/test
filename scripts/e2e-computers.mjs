// Сквозная проверка вкладки «Компьютеры» в Chromium: характеристики, конструктор, симулятор, ПЗУ-бочки, ИИ-импорт, нетлист.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const URL = process.env.URL ?? 'http://localhost:4173/';
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

// 1. вход во вкладку: при первом заходе спрашивают характеристики
await page.click('.mode-tabs button:has-text("Компьютеры")');
check('первый заход: приветствие и характеристики', (await page.locator('.cs-welcome h2').innerText()).includes('опишем ваш компьютер'));
await page.locator('.cs-card', { hasText: 'Мини-4' }).click();
check('заготовка «Мини-4» применилась', (await page.locator('.topbar .project-name').inputValue()) === 'Мини-4');
const specText = await page.locator('.cs-content').innerText();
check('в сводке 16 слов × 8 бит → 32 бочки', specText.includes('32') && specText.includes('бочек в ПЗУ'));

// 2. дальше — предложение запрограммировать
await page.click('text=Далее: набор команд');
check('после характеристик предлагается программировать', (await page.locator('.cs-welcome h2').innerText()).includes('запрограммировать'));
await page.click('text=Настроить команды самому');

// 2a. конструктор (на «Учебный-8»): удалить DEC, добавить «Инкремент» из каталога и проверить на примере
await step('Характеристики');
await page.locator('.cs-card', { hasText: 'Учебный-8' }).click();
await step('Инструкции');
await page.click('text=Настроить команды самому').catch(() => {});
await page.locator('.cs-isa-list tbody tr', { hasText: 'DEC' }).first().click();
await page.click('.cs-isa-main button:has-text("Удалить")');
const n0 = await page.locator('.cs-isa-list tbody tr').count();
await page.click('text=＋ Из каталога');
await page.locator('.cs-cat-item', { hasText: 'Инкремент' }).first().locator('button:has-text("Добавить")').click();
const n1 = await page.locator('.cs-isa-list tbody tr').count();
check('каталог: инструкция добавлена', n1 === n0 + 1, `${n0}→${n1}`);
check('редактор показал новую инструкцию и её RTL', (await page.locator('.cs-preview').innerText()).includes('inc('));
await page.click('text=Проверить инструкцию на примере');
await page.locator('.cs-tester-grid .field:has-text("rd") input').first().fill('0');
await page.locator('.cs-tester-grid .field:has-text("r0") input').fill('5');
await page.click('.cs-tester-body button:has-text("Выполнить")');
check('проверка инструкции на примере: r0 5 → 6', (await page.locator('.cs-tester-out').innerText()).includes('r0: 5 → 6'), (await page.locator('.cs-tester-out').innerText()).replace(/\n/g, ' | '));
// переключение на RTL и ошибка в коде
await page.click('.cs-isa-main button:has-text("Код RTL")');
await page.fill('.cs-isa-main textarea.cs-code', 'R[rd] = foo(R[rd])');
check('ошибка RTL показывается', (await page.locator('.cs-isa-main .issues').first().innerText()).length > 5);
await page.fill('.cs-isa-main textarea.cs-code', 'R[rd] = inc(R[rd])');
// вернуть стандартный набор, затем «Мини-4» для компактного ПЗУ
await page.click('text=Стандартный набор');
const confirmBtn = page.locator('.modal.tiny .btn.danger-solid');
if (await confirmBtn.count()) await confirmBtn.first().click();
await step('Характеристики');
await page.locator('.cs-card', { hasText: 'Мини-4' }).click();

// 3. программы и симулятор
await step('Программы');
check('редактор с номерами строк', (await page.locator('.ce-gl').count()) > 3);
check('программа собрана', (await page.locator('.badge.ok').first().innerText()).includes('Собрано'));
await page.selectOption('.sim-controls select', '60000');
await page.click('text=▶ Запустить');
await page.waitForTimeout(500);
await page.click('text=⏸ Пауза');
const ran = await page.locator('.sim-status').innerText();
const nSteps = Number((/команд: (\d+)/.exec(ran) ?? [])[1] ?? 0);
check('программа выполняется (сотни команд за полсекунды)', nSteps > 100, ran.replace(/\n/g, ' | '));
await page.click('text=⟲ Сброс');
await page.click('button:has-text("⏭ Шаг")');
const status = await page.locator('.sim-status').innerText();
check('шаг выполняет одну команду', /команд: 1\b/.test(status), status.replace(/\n/g, ' | '));

// 3a. ошибка в коде подсвечивается
const ta = page.locator('.ce-ta');
await ta.click();
await page.keyboard.press('Control+End');
await page.keyboard.type('\n        bogus 1\n');
await page.waitForTimeout(150);
check('ошибка ассемблера: неизвестная инструкция', (await page.locator('.issues').innerText()).includes('Неизвестная инструкция'));
for (let i = 0; i < 20; i++) await page.keyboard.press('Backspace');
await page.waitForTimeout(100);

// 3b. программа на рычагах: переключаем рычаг, лампы повторяют
await page.selectOption('.cs-progbar select >> nth=0', { label: 'Сумма рычагов' }).catch(() => {});
await page.waitForTimeout(150);
await page.selectOption('.sim-controls select', '60000');
await page.click('text=▶ Запустить');
await page.locator('.dev-switch').nth(0).click();
await page.locator('.dev-switch').nth(1).click();
await page.waitForTimeout(400);
const leds2 = (await page.locator('.dev-leds').first().innerText()).replace(/\n/g, ' ');
check('рычаги влияют на программу (сумма ≠ 0)', !/^\s*0\s*·/.test(leds2), leds2);
await page.click('text=⏸ Пауза');

// 4. ПЗУ-бочки
await step('ПЗУ');
await page.waitForSelector('.cs-rom-main .stats');
const stats = await page.locator('.cs-rom-main .stats').innerText();
check('ПЗУ: превью и статистика', stats.includes('бочек'), stats.replace(/\n/g, ' '));
await page.click('text=Карта значений');
check('карта значений рисуется', (await page.locator('.rom-nib').count()) > 8);
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('text=Скачать .litematic')]);
const bytes = readFileSync(await dl.path());
writeFileSync('/tmp/e2e_rom.litematic', bytes);
check('скачан .litematic ПЗУ (gzip)', bytes[0] === 0x1f && bytes[1] === 0x8b, `${bytes.length} B, ${dl.suggestedFilename()}`);
const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text(".json")')]);
const romJson = JSON.parse(readFileSync(await dl2.path(), 'utf8'));
writeFileSync('/tmp/e2e_rom.json', JSON.stringify(romJson));
check('ROM json: слова и карта бочек', romJson.format === 'redlogic-rom' && romJson.words.length > 0 && romJson.barrels.length === romJson.words.length);

// 5. ассемблер на Python скачивается
await step('Ассемблер');
check('таблица команд ассемблера', (await page.locator('.cs-table.wide tbody tr').count()) >= 10);
const [dl3] = await Promise.all([page.waitForEvent('download'), page.click('text=Скачать assembler.py')]);
const py = readFileSync(await dl3.path(), 'utf8');
writeFileSync('/tmp/e2e_assembler.py', py);
check('assembler.py скачан', py.includes('def main') && py.includes('SPEC ='), `${py.length} B`);

// 5a. аппаратура: схема сумматора из генератора открывается в редакторе схем
await step('Аппаратура');
check('аппаратура: генераторы узлов', (await page.locator('.cs-hw-list .cs-card').count()) >= 5);
await page.locator('.cs-hw-list .cs-card', { hasText: 'Сумматор' }).click();
const hwText = await page.locator('textarea[aria-label="Нетлист схемы"]').inputValue();
check('нетлист сумматора', hwText.includes('XOR(') && hwText.includes('output cout'));
await page.click('button:has-text("Открыть в редакторе схем")');
if (await page.locator('.modal.tiny').count()) await page.locator('.modal.tiny .btn.primary, .modal.tiny .btn.danger-solid').first().click();
await page.waitForTimeout(300);
const hwGates = await page.evaluate(() => window.__redlogic.getState().circuit.gates.length);
check('схема сумматора открыта в редакторе схем', hwGates > 15 && (await page.locator('.canvas').count()) === 1, String(hwGates));
await page.click('.mode-tabs button:has-text("Компьютеры")');

// 6. ИИ: доки, промпты, импорт
await page.locator('.cs-steps .cs-step', { hasText: 'документация' }).click();
check('документация отрисована', (await page.locator('.md').innerText()).length > 200);
await page.click('.cs-tabs button:has-text("Промпты")');
await page.locator('.cs-card', { hasText: 'Написать программу' }).click();
await page.fill('.cs-wishes', 'мигать лампами');
const prompt = await page.locator('textarea[aria-label="Промпт"]').inputValue();
check('промпт программы содержит ISA, порты и задачу', prompt.includes('мигать лампами') && prompt.includes('`LEDS`') && prompt.includes('`LDI`'), `${prompt.length} символов`);
await page.click('.cs-tabs button:has-text("Импорт")');
await page.fill('textarea[aria-label="Ответ ИИ"]', '{"format":"redlogic-computer","spec":{"dataBits":99},"instructions":[]}');
await page.waitForTimeout(150);
check('импорт: ошибки показаны', (await page.locator('.badge.bad').count()) === 1);
const example = readFileSync('/home/user/test/docs/ai/example-computer.json', 'utf8');
await page.fill('textarea[aria-label="Ответ ИИ"]', '```json\n' + example + '\n```');
await page.waitForTimeout(150);
check('импорт: пример принят', (await page.locator('.badge.ok').innerText()).includes('Файл принят'));
await page.click('button:has-text("Загрузить компьютер")');
await page.locator('.modal.tiny .btn.danger-solid').click();
await page.waitForTimeout(200);
check('импорт: компьютер загружен', (await page.locator('.topbar .project-name').inputValue()) === 'Мини-4');

// 7. автосохранение переживает перезагрузку
await page.waitForTimeout(700);
await page.reload();
await page.waitForTimeout(500);
check('после перезагрузки остаёмся во вкладке с тем же компьютером', (await page.locator('.topbar .project-name').inputValue()) === 'Мини-4' && (await page.locator('.cs-root').count()) === 1);

// 8. схемы: вставка нетлиста от ИИ
await page.click('.mode-tabs button:has-text("Схемы")');
await page.waitForTimeout(300);
await page.click('button:has-text("Текст / ИИ")');
await page.fill('textarea[aria-label="Нетлист"]', 'input a b\ns = XOR(a, b)\nc = AND(a, b)\noutput sum = s\noutput carry = c\n');
await page.waitForTimeout(150);
check('нетлист разобран', (await page.locator('.badge.ok').innerText()).includes('2 входов'));
await page.click('button:has-text("Заменить схему")');
const confirm2 = page.locator('.modal.tiny .btn:not(.danger-solid)').last();
if (await page.locator('.modal.tiny').count()) await page.locator('.modal.tiny .btn.primary, .modal.tiny .btn.danger-solid').first().click();
await page.waitForTimeout(300);
const gates = await page.evaluate(() => window.__redlogic.getState().circuit.gates.length);
check('схема из текста: 2 входа + 2 гейта + 2 выхода', gates === 6, String(gates));
void confirm2;

check('нет ошибок в консоли', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(failed === 0 ? '\nВСЕ ПРОВЕРКИ ПРОЙДЕНЫ' : `\nПРОВАЛЕНО: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
