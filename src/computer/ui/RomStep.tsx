import { useMemo, useState } from 'react';
import { useComputer } from '../store';
import { assemble } from '../asm';
import { DEFAULT_ROM_OPTIONS, DEFAULT_UNSTACKABLE_ITEM, ItemKind, buildRom, fillFor, romMapText } from '../rom';
import { nibblesPerWord } from '../spec';
import { buildLitematic, safeFileName } from '../../export/litematic';
import { MC_DATA_VERSION_26_2 } from '../../compiler/compile';
import { blockCss } from '../../compiler/materials';
import { saveFile } from '../../storage/project';
import { PreviewCanvas } from '../../ui/PreviewCanvas';
import { BlockPicker } from '../../ui/ExportDialog';
import { Section, hexOf, notify } from './common';

const STACKABLE = [
  ['minecraft:cobblestone', 'Булыжник'],
  ['minecraft:dirt', 'Земля'],
  ['minecraft:stone', 'Камень'],
  ['minecraft:sand', 'Песок'],
  ['minecraft:gravel', 'Гравий'],
  ['minecraft:oak_planks', 'Дубовые доски'],
] as const;
const UNSTACKABLE = [
  ['minecraft:wooden_pickaxe', 'Деревянная кирка'],
  ['minecraft:wooden_sword', 'Деревянный меч'],
  ['minecraft:wooden_shovel', 'Деревянная лопата'],
  ['minecraft:leather_helmet', 'Кожаный шлем'],
] as const;

type View = 'iso' | 'plan' | 'map';

export function RomStep() {
  const project = useComputer((s) => s.project);
  const opts = useComputer((s) => s.romOptions);
  const activeId = useComputer((s) => s.activeProgram);
  const { setRomOptions, setActiveProgram, setStep } = useComputer.getState();
  const spec = project.spec;
  const program = project.programs.find((p) => p.id === activeId) ?? project.programs[0];
  const [view, setView] = useState<View>('iso');
  const [trim, setTrim] = useState(true);
  const [layer, setLayer] = useState<number | null>(null);
  const asm = useMemo(() => (program ? assemble(program.source, spec, project.instructions, project.asm) : null), [program, spec, project.instructions, project.asm]);
  const nib = nibblesPerWord(spec);

  const words = useMemo(() => {
    if (!asm) return [];
    return trim ? asm.words.slice(0, Math.max(1, asm.size)) : asm.words;
  }, [asm, trim]);
  const build = useMemo(() => (asm?.ok ? buildRom(words, spec, opts) : null), [asm, words, spec, opts]);
  const hexWords = words.map((w) => hexOf(w, nib));

  if (!program || !asm) {
    return (
      <div className="cs-page">
        <p className="hint">Сначала создайте программу на шаге «Программы».</p>
        <button className="btn" onClick={() => setStep('prog')}>К программам</button>
      </div>
    );
  }

  const baseName = `${safeFileName(spec.name)}_${safeFileName(program.name)}`;
  const save = async (name: string, data: string | Uint8Array, mime: string) => {
    const r = await saveFile(name, data, mime);
    if (r === 'zipped') notify(`${name} сохранён в архиве .zip (расширение не поддерживается окном)`);
    else if (r === 'saved') notify(`Сохранено: ${name}`);
  };
  const exportLitematic = () => {
    if (!build) return;
    const bytes = buildLitematic(build.structure, {
      name: `${spec.name} — ${program.name}`.slice(0, 60),
      author: 'RedLogic',
      description: `ПЗУ из бочек: ${words.length} слов × ${spec.instrBits} бит (${nib} бочек на слово, сила сигнала = ниббл)`,
      dataVersion: MC_DATA_VERSION_26_2,
      regionName: 'ROM',
    });
    void save(`${baseName}.rom.litematic`, bytes, 'application/octet-stream');
  };
  const exportHex = () => void save(`${baseName}.hex`, `v2.0 raw\n${hexWords.join('\n')}\n`, 'text/plain');
  const exportJson = () =>
    void save(
      `${baseName}.rom.json`,
      JSON.stringify({ format: 'redlogic-rom', computer: spec.name, program: program.name, instrBits: spec.instrBits, nibblesPerWord: nib, nibbleOrder: opts.nibbleOrder, words, hex: hexWords, barrels: build?.map.map((e) => ({ address: e.address, word: e.word, barrels: e.barrels })) }, null, 2),
      'application/json',
    );
  const exportMd = () => build && void save(`${baseName}.rom.md`, romMapText(build, spec, hexWords), 'text/markdown');

  const stack = opts.itemKind === 'stack64';
  const items = stack ? STACKABLE : UNSTACKABLE;
  const perBarrel = (n: number) => fillFor(n, opts.itemKind).reduce((a, b) => a + b, 0);
  const totalItems = build ? build.structure.tileEntities!.reduce((a, t) => a + (t.items?.reduce((x, i) => x + i.count, 0) ?? 0), 0) : 0;

  return (
    <div className="cs-page wide">
      <div className="cs-welcome slim">
        <h2>ПЗУ из бочек для Litematica</h2>
        <p>
          Каждое слово программы хранится в {nib} бочках — по одной на 4 бита. Сила сигнала компаратора за бочкой равна значению ниббла (0…15): пустая бочка — 0,
          полная — 15. Сигналы читаются компараторами и пылью; дальше их подключают к вашей схеме выбора адреса. Файл проверен на сервере Minecraft Java 26.2.
        </p>
      </div>

      <div className="cs-rom">
        <aside className="cs-rom-opts">
          <Section title="Что записываем">
            <label className="field">
              <span>Программа</span>
              <select value={program.id} onChange={(e) => setActiveProgram(e.target.value)}>
                {project.programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label className="check">
              <input type="checkbox" checked={trim} onChange={(e) => setTrim(e.target.checked)} />
              Только занятые слова ({asm.size} из {spec.romWords})
            </label>
            {!asm.ok && <div className="badge bad">В программе есть ошибки — исправьте их на шаге «Программы».</div>}
          </Section>

          <Section title="Бочки и предметы">
            <div className="field">
              <span>Предметы-заполнители</span>
              <div className="seg" role="group" aria-label="Тип предмета">
                {([['stack64', 'Стакуются (64)'], ['unstackable', 'Не стакуются (1)']] as [ItemKind, string][]).map(([k, l]) => (
                  <button key={k} className={opts.itemKind === k ? 'on' : ''} onClick={() => setRomOptions({ itemKind: k, item: k === 'stack64' ? DEFAULT_ROM_OPTIONS.item : DEFAULT_UNSTACKABLE_ITEM })}>{l}</button>
                ))}
              </div>
            </div>
            <label className="field">
              <span>Предмет</span>
              <select value={opts.item} onChange={(e) => setRomOptions({ item: e.target.value })}>
                {items.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
              <small className="dim">{stack ? 'Сигнал 15 = 27 полных стаков (1728 предметов). В креативе неважно, в выживании дорого.' : 'Сигнал 15 = 27 предметов (по одному в слот) — гораздо дешевле.'}</small>
            </label>
            <div className="field">
              <span>Предметов на сигнал</span>
              <div className="cs-sig">
                {Array.from({ length: 16 }, (_, n) => <span key={n} title={`сигнал ${n}: ${perBarrel(n)} шт.`}><b>{n.toString(16).toUpperCase()}</b>{perBarrel(n)}</span>)}
              </div>
            </div>
            <div className="field">
              <span>Порядок бочек в слове</span>
              <div className="seg" role="group" aria-label="Порядок нибблов">
                <button className={opts.nibbleOrder === 'msb' ? 'on' : ''} onClick={() => setRomOptions({ nibbleOrder: 'msb' })}>Старший первым</button>
                <button className={opts.nibbleOrder === 'lsb' ? 'on' : ''} onClick={() => setRomOptions({ nibbleOrder: 'lsb' })}>Младший первым</button>
              </div>
              <small className="dim">Слева направо (с запада на восток). Для слова 0x{hexOf(0xA5C, 3)}: {opts.nibbleOrder === 'msb' ? 'A · 5 · C' : 'C · 5 · A'}.</small>
            </div>
          </Section>

          <Section title="Раскладка">
            <label className="field">
              <span>Слов в ряду</span>
              <input type="number" min={1} max={32} value={opts.wordsPerRow} onChange={(e) => setRomOptions({ wordsPerRow: Math.max(1, Math.min(32, Math.floor(Number(e.target.value)) || 1)) })} />
              <small className="dim">1 — длинная лента вдоль оси Z; больше — компактная сетка.</small>
            </label>
            <label className="check"><input type="checkbox" checked={opts.comparators} onChange={(e) => setRomOptions({ comparators: e.target.checked, outputDust: e.target.checked && opts.outputDust })} /> Компараторы за бочками</label>
            <label className="check"><input type="checkbox" checked={opts.outputDust} disabled={!opts.comparators} onChange={(e) => setRomOptions({ outputDust: e.target.checked })} /> Пыль на выходе (видно уровень сигнала)</label>
            <label className="check"><input type="checkbox" checked={opts.floor} onChange={(e) => setRomOptions({ floor: e.target.checked })} /> Сплошной пол</label>
            <BlockPicker label="Блок пола" value={opts.support} onChange={(v) => setRomOptions({ support: v })} />
          </Section>
        </aside>

        <div className="cs-rom-main">
          <div className="preview-bar">
            <div className="seg" role="group" aria-label="Вид">
              <button className={view === 'iso' ? 'on' : ''} onClick={() => setView('iso')}>Изометрия</button>
              <button className={view === 'plan' ? 'on' : ''} onClick={() => setView('plan')}>План</button>
              <button className={view === 'map' ? 'on' : ''} onClick={() => setView('map')}>Карта значений</button>
            </div>
            {view !== 'map' && build && (
              <label className="layer">
                Слой
                <input type="range" min={0} max={build.structure.sy - 1} value={layer ?? build.structure.sy - 1} onChange={(e) => setLayer(Number(e.target.value))} />
                <b>{(layer ?? build.structure.sy - 1) + 1}</b>
              </label>
            )}
          </div>
          <div className="preview-stage">
            {build && view !== 'map' && (
              <PreviewCanvas structure={build.structure} mode={view} layer={layer ?? (view === 'iso' ? build.structure.sy - 1 : null)} colors={{ wire: blockCss(opts.support), gate: '#888' }} gateName="" showLabels />
            )}
            {build && view === 'map' && <RomMap words={words} nib={nib} order={opts.nibbleOrder} wordsPerRow={opts.wordsPerRow} />}
            {!build && <div className="preview-empty">Нет данных для предпросмотра</div>}
          </div>
          {build && (
            <div className="result-bar">
              <div className="stats">
                <div><b>{words.length}</b><span>слов</span></div>
                <div><b>{build.barrelCount}</b><span>бочек</span></div>
                <div><b>{build.structure.sx}×{build.structure.sy}×{build.structure.sz}</b><span>габариты</span></div>
                <div><b>{totalItems.toLocaleString('ru-RU')}</b><span>предметов</span></div>
                <div><b>{build.structure.blocks.length}</b><span>блоков</span></div>
                <div><b>{nib}</b><span>бочек в слове</span></div>
              </div>
              <div className="result-actions">
                <button className="btn" onClick={exportHex} title="Logisim «v2.0 raw»">.hex</button>
                <button className="btn" onClick={exportJson}>.json</button>
                <button className="btn" onClick={exportMd} title="Карта адресов бочек">.md (карта)</button>
                <button className="btn primary big" onClick={exportLitematic}>Скачать .litematic</button>
              </div>
              <details className="cs-howto">
                <summary>Как пользоваться</summary>
                <ol>
                  <li>Положите файл в <code>schematics/</code> Litematica и загрузите схему (в креативе — «Вставить схему»).</li>
                  <li>Ряд за рядом идут слова: адрес 0 — первый ряд (минимальный Z). Внутри слова бочки идут с запада на восток ({opts.nibbleOrder === 'msb' ? 'старший ниббл первым' : 'младший ниббл первым'}).</li>
                  <li>Сила сигнала компаратора за бочкой = значение ниббла. Если пыль не загорелась сразу, обновите блок рядом с компаратором (поставьте/уберите любой блок).</li>
                  <li>Собирайте декодер адреса и тракт данных из схем (вкладка «Схемы»), а выходы пыли подключайте к своим шинам.</li>
                </ol>
              </details>
            </div>
          )}
        </div>
      </div>
      <div className="cs-footer">
        <button className="btn" onClick={() => setStep('prog')}>← Программы</button>
        <div className="tb-spacer" />
        <button className="btn primary big" onClick={() => setStep('build')}>Далее: постройка ПК →</button>
      </div>
    </div>
  );
}

function RomMap({ words, nib, order, wordsPerRow }: { words: number[]; nib: number; order: 'msb' | 'lsb'; wordsPerRow: number }) {
  const per = Math.max(wordsPerRow, 1);
  return (
    <div className="rom-map" aria-label="Карта значений">
      <div className="rom-map-grid" style={{ gridTemplateColumns: `repeat(${per}, max-content)` }}>
        {words.map((w, a) => {
          const nibs: number[] = [];
          for (let i = 0; i < nib; i++) nibs.push(Math.floor(w / 16 ** i) & 15);
          if (order === 'msb') nibs.reverse();
          return (
            <div key={a} className="rom-word" title={`адрес ${a}: 0x${hexOf(w, nib)}`}>
              <small className="mono dim">{hexOf(a, 2)}</small>
              <div className="rom-nibs">
                {nibs.map((n, i) => (
                  <span key={i} className="rom-nib mono" style={{ background: `rgba(255, 84, 72, ${n / 15 * 0.85 + (n ? 0.1 : 0)})` }}>{n.toString(16).toUpperCase()}</span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <p className="hint">Каждая клетка — одна бочка; цвет и цифра — сила сигнала, которую она даёт компаратору.</p>
    </div>
  );
}

