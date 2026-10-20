import { useEffect, useMemo, useRef, useState } from 'react';
import { useComputer } from '../store';
import { BuildMode, planComputer } from '../../cpu/plan';
import { CONTAINERS, ContainerKind, containerDef } from '../../cpu/export';
import { ComputerExportSettings, defaultExportSettings } from '../../cpu/computerExport';
import { BuildOutput } from '../../cpu/buildResult';
import { boardFit } from '../../cpu/fit';
import { GATE_VARIANTS } from '../../compiler/variants';
import { blockCss } from '../../compiler/materials';
import { saveFile } from '../../storage/project';
import { PreviewCanvas } from '../../ui/PreviewCanvas';
import { BlockPicker } from '../../ui/ExportDialog';
import { Section, notify } from './common';
import { useComputerBuild } from './useComputerBuild';

const ITEMS = [
  ['minecraft:wooden_pickaxe', 'Деревянная кирка'],
  ['minecraft:wooden_sword', 'Деревянный меч'],
  ['minecraft:wooden_shovel', 'Деревянная лопата'],
  ['minecraft:wooden_hoe', 'Деревянная мотыга'],
  ['minecraft:leather_helmet', 'Кожаный шлем'],
] as const;

const MODES: { id: BuildMode; title: string; desc: string }[] = [
  { id: 'program', title: 'Под программу', desc: 'Оборудование урезано до того, что нужно программе: меньше блоков, адреса сжаты. ПЗУ перепрошить нельзя.' },
  { id: 'isa', title: 'Весь набор инструкций', desc: 'Строятся все узлы, нужные набору команд (и АЛУ, и флаги). ПЗУ можно переписать вручную, если включить «бочки во всех клетках».' },
];

type Tab = 'board' | 'plan' | 'guide';

/** Вентили, которые используют блоки логики. Повторитель (BUFFER) не меняем: от его задержки зависят зазоры между фазами замков. */
const VARIANT_GATES = ['AND', 'OR', 'NOR', 'XOR'] as const;

const fmt = (n: number): string => n.toLocaleString('ru-RU');

export function BuildStep() {
  const project = useComputer((s) => s.project);
  const settings = useComputer((s) => s.buildSettings);
  const activeId = useComputer((s) => s.activeProgram);
  const { setBuildSettings, setActiveProgram, setStep } = useComputer.getState();
  const program = project.programs.find((p) => p.id === activeId) ?? project.programs[0];
  const build = useComputerBuild();
  const [tab, setTab] = useState<Tab>('board');
  const set = (patch: Partial<ComputerExportSettings>) => setBuildSettings(patch);
  const cont = containerDef(settings.container);

  // быстрый предварительный разбор (без постройки платы): сразу видно, подходит ли программа железу
  const plan = useMemo(() => (program ? planComputer(project, { mode: settings.mode, programId: program.id }) : null), [project, program, settings.mode]);
  const planErrors = plan?.issues.filter((i) => i.level === 'error') ?? [];
  const planWarns = plan?.issues.filter((i) => i.level === 'warning') ?? [];
  const ones = useMemo(() => {
    if (!plan?.ok) return 0;
    let n = 0;
    for (let r = 0; r < plan.rows.length; r++) for (const c of plan.columns) if (c.bit(r)) n++;
    return n;
  }, [plan]);
  const containers = plan?.ok ? (settings.romFull ? plan.rows.length * plan.columns.length : ones) : 0;

  const result = build.result;
  const stale = useRef(false);
  useEffect(() => {
    stale.current = true;
  }, [project, settings, activeId]);

  if (!program) {
    return (
      <div className="cs-page">
        <p className="hint">Сначала создайте программу на шаге «Программы».</p>
        <button className="btn" onClick={() => setStep('prog')}>К программам</button>
      </div>
    );
  }

  const start = () => {
    stale.current = false;
    build.start(project, { ...settings, programId: program.id });
  };
  const save = async (name: string, data: string | Uint8Array, mime: string) => {
    const r = await saveFile(name, data, mime);
    if (r === 'zipped') notify(`${name} сохранён в архиве .zip (расширение не поддерживается окном)`);
    else if (r === 'saved') notify(`Сохранено: ${name}`);
  };
  const variants = settings.macro.variants ?? {};
  const setVariant = (gate: string, id: string) => set({ macro: { ...settings.macro, variants: { ...variants, [gate]: id } } });

  return (
    <div className="cs-page wide">
      <div className="cs-welcome slim">
        <h2>Постройка компьютера для Minecraft</h2>
        <p>
          Из вашей архитектуры (аккумуляторной или регистровой) и программы получается настоящий компьютер из редстоуна: ПЗУ с готовыми управляющими словами, счётчик команд, АЛУ, файл регистров, флаги, ОЗУ и порты с рычагами и лампами,
          а также такты и сброс. Результат — схема <code>.litematic</code> для Litematica (Minecraft Java 26.2) и руководство по запуску. Перед выдачей плата прогоняется в покадровом
          симуляторе редстоуна: по нему подбирается зазор между фазами триггеров и рекомендуемый такт.
        </p>
      </div>

      <div className="cs-rom">
        <aside className="cs-rom-opts">
          <Section title="Что строим">
            <label className="field">
              <span>Программа</span>
              <select value={program.id} onChange={(e) => setActiveProgram(e.target.value)}>
                {project.programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <div className="field">
              <span>Режим</span>
              <div className="seg" role="group" aria-label="Режим постройки">
                {MODES.map((m) => <button key={m.id} className={settings.mode === m.id ? 'on' : ''} onClick={() => set({ mode: m.id })}>{m.title}</button>)}
              </div>
              <small className="dim">{MODES.find((m) => m.id === settings.mode)?.desc}</small>
            </div>
            {plan?.ok && plan.feat.regs && (
              <div className="badge warn">
                Регистровая машина: на каждый бит каждого регистра — триггер, плюс файл регистров с двумя портами чтения. Плата в 2–5 раз больше аккумуляторной (сотни тысяч блоков),
                постройка и проверка занимают несколько минут. Режим «под программу» строит только регистры, в которые программа пишет.
              </div>
            )}
            {planErrors.map((i, k) => <div key={k} className="badge bad">{i.message}</div>)}
            {planWarns.map((i, k) => <div key={k} className="badge warn">{i.message}</div>)}
            {plan?.ok && (
              <small className="dim">
                ПЗУ {plan.rows.length} слов × {plan.columns.length} бит · данные {plan.feat.D} бит · счётчик {plan.feat.P} бит
                {plan.feat.regs ? ` · регистров с триггерами: ${plan.feat.regs.list.length} (R${plan.feat.regs.list.join(', R')})` : ''}
                {plan.skippedPorts.length ? ` · без оборудования: ${plan.skippedPorts.join(', ')}` : ''}
              </small>
            )}
          </Section>

          <Section title="ПЗУ: контейнеры и предметы">
            <div className="field">
              <span>Контейнер для бита</span>
              <div className="cs-containers" role="radiogroup" aria-label="Контейнер ПЗУ">
                {CONTAINERS.map((c) => (
                  <button key={c.id} role="radio" aria-checked={settings.container === c.id} className={`cs-cont ${settings.container === c.id ? 'on' : ''}`} onClick={() => set({ container: c.id as ContainerKind })} title={c.desc}>
                    <b>{c.name}</b>
                    <small>{c.slots} предм.</small>
                  </button>
                ))}
              </div>
              <small className="dim">{cont.desc}</small>
            </div>
            <label className="field">
              <span>Предмет-заполнитель (не стакуется)</span>
              <select value={settings.item} onChange={(e) => set({ item: e.target.value })}>
                {ITEMS.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                {!ITEMS.some(([id]) => id === settings.item) && <option value={settings.item}>{settings.item}</option>}
              </select>
            </label>
            <label className="check">
              <input type="checkbox" checked={settings.romFull} onChange={(e) => set({ romFull: e.target.checked })} />
              Контейнеры во всех клетках матрицы (можно перепрошить вручную)
            </label>
            {plan?.ok && (
              <small className="dim">
                Нужно контейнеров: {fmt(containers)}, предметов в них: {fmt(ones * cont.slots)} (единицы заполняются полностью — сигнал 15).
              </small>
            )}
          </Section>

          <Section title="Блоки">
            <BlockPicker label="Провода и опоры" value={settings.wireBlock} onChange={(v) => set({ wireBlock: v })} />
            <BlockPicker label="Корпуса вентилей" value={settings.gateBlock} onChange={(v) => set({ gateBlock: v })} />
            <small className="dim">Лампы — редстоуновые (<code>minecraft:redstone_lamp</code>): другие лампы реагируют на импульсы иначе.</small>
          </Section>

          <Section title="Такт и индикаторы">
            <div className="field">
              <span>Тактирование</span>
              <div className="seg" role="group" aria-label="Тактирование">
                <button className={settings.clock === 'lever' ? 'on' : ''} onClick={() => set({ clock: 'lever' })}>Рычаг CLK</button>
                <button className={settings.clock === 'auto' ? 'on' : ''} onClick={() => set({ clock: 'auto' })}>Автогенератор</button>
              </div>
              <small className="dim">{settings.clock === 'lever' ? 'Один такт — вверх и вниз по рычагу: удобно отлаживать по шагам.' : 'Кольцо повторителей с рычагом «стоп». Скорость берётся из замера платы.'}</small>
            </div>
            {settings.clock === 'auto' && (
              <label className="field">
                <span>Полупериод генератора, игровых тиков (0 — по замеру)</span>
                <input type="number" min={0} max={20000} step={50} value={settings.clockHalfTicks} onChange={(e) => set({ clockHalfTicks: Math.max(0, Math.floor(Number(e.target.value)) || 0) })} />
              </label>
            )}
            <label className="check"><input type="checkbox" checked={settings.indicators} onChange={(e) => set({ indicators: e.target.checked })} /> Лампы счётчика команд, аккумулятора/регистров и флагов</label>
            <label className="check"><input type="checkbox" checked={settings.portLamps} onChange={(e) => set({ portLamps: e.target.checked })} /> Лампы на портах вывода</label>
            <label className="check"><input type="checkbox" checked={settings.autoTiming} onChange={(e) => set({ autoTiming: e.target.checked })} /> Подобрать зазор между фазами замером в симуляторе</label>
            {!settings.autoTiming && (
              <label className="field">
                <span>Зазор между фазами, тиков редстоуна</span>
                <input type="number" min={4} max={400} value={settings.guardRt} onChange={(e) => set({ guardRt: Math.max(4, Math.min(400, Math.floor(Number(e.target.value)) || 4)) })} />
                <small className="dim">Должен превышать разброс длин проводов замков (для больших плат — 70–110). Без замера лучше держать с запасом.</small>
              </label>
            )}
          </Section>

          <Section title="Раскладка платы">
            <div className="field">
              <span>Как расположить узлы</span>
              <div className="seg" role="group" aria-label="Раскладка платы">
                <button className={settings.layout === 'compact' ? 'on' : ''} onClick={() => set({ layout: 'compact' })}>Компактная</button>
                <button className={settings.layout === 'stack' ? 'on' : ''} onClick={() => set({ layout: 'stack' })}>Колонкой</button>
              </div>
              <small className="dim">
                {settings.layout === 'compact'
                  ? 'Узлы плотно на плоскости, провода идут поверх них в нескольких слоях: плата в разы меньше и помещается в дальность прорисовки. Если разводка не получится, будет использована раскладка колонкой.'
                  : 'Узлы стоят колонкой, шина идёт сбоку по земле: проверенная, но очень длинная плата (сотни блоков в длину).'}
              </small>
            </div>
          </Section>

          <Section title="Вентили блоков логики">
            <details className="cs-howto">
              <summary>Выбор реализации вентилей (АЛУ, счётчик, управление)</summary>
              <p className="hint">Блоки логики собираются из вентилей; здесь можно выбрать, на чём они реализованы. Менять нужно осознанно: от этого зависят размеры и задержки (зазор подбирается замером).</p>
              {VARIANT_GATES.map((gate) => [gate, GATE_VARIANTS[gate] ?? []] as const).filter(([, list]) => list.length > 0).map(([gate, list]) => (
                <label key={gate} className="field">
                  <span>{gate}</span>
                  <select value={variants[gate as keyof typeof variants] ?? list[0].id} onChange={(e) => setVariant(gate, e.target.value)}>
                    {list.map((v) => <option key={v.id} value={v.id} title={v.desc}>{v.name}</option>)}
                  </select>
                </label>
              ))}
            </details>
          </Section>

          <Section title="Файл">
            <label className="field">
              <span>Название схемы</span>
              <input type="text" value={settings.name} maxLength={60} onChange={(e) => set({ name: e.target.value })} />
            </label>
            <button className="btn" onClick={() => setBuildSettings({ ...defaultExportSettings(), name: settings.name })}>Сбросить настройки</button>
          </Section>
        </aside>

        <div className="cs-rom-main">
          <div className="preview-bar">
            <button className="btn primary big" disabled={!plan?.ok || build.status === 'running'} onClick={start}>
              {build.status === 'running' ? 'Строю…' : result ? 'Построить заново' : 'Построить компьютер'}
            </button>
            {build.status === 'running' && <button className="btn" onClick={build.cancel}>Отмена</button>}
            {build.status === 'running' && <span className="dim">{build.progress}</span>}
            {result && build.status !== 'running' && (
              <div className="seg" role="group" aria-label="Вид">
                <button className={tab === 'board' ? 'on' : ''} onClick={() => setTab('board')}>Карта платы</button>
                <button className={tab === 'plan' ? 'on' : ''} onClick={() => setTab('plan')}>План</button>
                <button className={tab === 'guide' ? 'on' : ''} onClick={() => setTab('guide')}>Руководство</button>
              </div>
            )}
          </div>
          {build.status === 'error' && (
            <div className="badge bad" style={{ margin: 12 }}>
              <b>{build.error}</b>
              {build.issues.length > 0 && <ul>{build.issues.map((m, i) => <li key={i}>{m}</li>)}</ul>}
            </div>
          )}
          <div className="preview-stage">
            {result && tab === 'board' && <BoardMap out={result} />}
            {result && tab === 'plan' && <PreviewCanvas structure={result.structure} mode="plan" layer={null} colors={{ wire: blockCss(settings.wireBlock), gate: blockCss(settings.gateBlock) }} gateName="" showLabels={false} />}
            {result && tab === 'guide' && <pre className="cs-guide mono">{result.docs}</pre>}
            {!result && build.status !== 'running' && build.status !== 'error' && <div className="preview-empty">Нажмите «Построить компьютер»: плата строится и проверяется за ~20–60 секунд</div>}
            {build.status === 'running' && !result && <div className="preview-empty">{build.progress}</div>}
          </div>
          {result && (
            <div className="result-bar">
              {build.mainThread && <div className="badge warn">Расчёт шёл в основном потоке (воркер недоступен), поэтому страница могла замереть.</div>}
              <Stats out={result} seconds={build.elapsed / 1000} />
              <FitNote out={result} wanted={settings.layout} />
              <div className="result-actions">
                <button className="btn" onClick={() => void save(result.fileName.replace(/\.litematic$/, '.md'), result.docs, 'text/markdown')}>Руководство .md</button>
                <button className="btn primary big" onClick={() => void save(result.fileName, result.bytes, 'application/octet-stream')}>Скачать .litematic</button>
              </div>
              <details className="cs-howto">
                <summary>Как запустить в игре</summary>
                <ol>
                  <li>Положите файл в <code>schematics/</code> Litematica и вставьте схему. Плата большая: загрузите чанки под ней (<code>/forceload add</code>) и подождите, пока они прогрузятся.</li>
                  <li>Включите RESET, подайте 2–3 такта CLK, выключите RESET. ОЗУ при сбросе не очищается.</li>
                  <li>{settings.clock === 'lever' ? 'Переключайте CLK вверх-вниз, выдерживая в каждом положении не меньше рекомендованного времени.' : 'Выключите рычаг «стоп» — генератор начнёт тактировать.'}</li>
                  <li>Плата протяжённая, поэтому такт длинный (десятки секунд). Ускорьте мир: <code>/tick rate 200</code> (Java 1.20.3+), вернуть — <code>/tick rate 20</code>. Задержки считаются в игровых тиках, плата работает так же, только быстрее.</li>
                  <li>Координаты всех рычагов и ламп, а также содержимое ПЗУ — в руководстве (вкладка «Руководство»).</li>
                </ol>
              </details>
            </div>
          )}
        </div>
      </div>
      <div className="cs-footer">
        <button className="btn" onClick={() => setStep('rom')}>← ПЗУ из бочек</button>
        <div className="tb-spacer" />
        <button className="btn primary big" onClick={() => setStep('hw')}>Далее: аппаратура →</button>
      </div>
    </div>
  );
}

/** Помещается ли плата в дальность прорисовки/симуляции игры и не откатилась ли компактная раскладка. */
function FitNote({ out, wanted }: { out: BuildOutput; wanted: 'compact' | 'stack' }) {
  const s = out.summary;
  const fit = boardFit(s.size);
  return (
    <>
      {wanted === 'compact' && s.layout === 'stack' && <div className="badge warn">Компактная раскладка не получилась — использована запасная (колонкой), плата длиннее.</div>}
      {fit.level === 'ok' ? <small className="dim">{fit.text}</small> : <div className={`badge ${fit.level === 'warn' ? 'warn' : 'bad'}`}>{fit.text}</div>}
    </>
  );
}

function Stats({ out, seconds }: { out: BuildOutput; seconds: number }) {
  const s = out.summary;
  return (
    <div className="stats">
      <div><b>{s.size.x}×{s.size.y}×{s.size.z}</b><span>габариты</span></div>
      <div><b>{fmt(s.blocks)}</b><span>блоков</span></div>
      <div><b>{s.romWords}×{s.romBits}</b><span>ПЗУ, слов×бит</span></div>
      <div><b>{fmt(s.romContainers)}</b><span>контейнеров ПЗУ</span></div>
      <div><b>{fmt(s.romItems)}</b><span>предметов</span></div>
      {s.halfPeriod !== undefined && <div><b>{s.halfPeriod}</b><span>игр. тиков на фазу CLK</span></div>}
      <div><b>{s.guardRt}</b><span>зазор, тиков RS</span></div>
      <div><b>{s.layout === 'compact' ? `компактная, ${s.layers} сл.` : 'колонкой'}</b><span>раскладка</span></div>
      <div><b>{seconds.toFixed(1)} с</b><span>расчёт</span></div>
    </div>
  );
}

/** Схема платы сверху: области (ПЗУ, блоки логики, триггеры, ОЗУ) и расположение рычагов/ламп. */
function BoardMap({ out }: { out: BuildOutput }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const { size } = out.summary;
  useEffect(() => {
    const canvas = ref.current;
    const box = wrap.current;
    if (!canvas || !box) return;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = box.clientWidth;
      const h = box.clientHeight;
      if (w === 0 || h === 0) return;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const g = canvas.getContext('2d');
      if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      const pad = 12;
      const k = Math.min((w - 2 * pad) / size.x, (h - 2 * pad) / size.z);
      const X = (x: number): number => pad + x * k;
      const Z = (z: number): number => pad + z * k;
      const fg = getComputedStyle(canvas).color || '#ccc';
      g.lineWidth = 1;
      g.strokeStyle = fg;
      g.globalAlpha = 0.35;
      g.strokeRect(X(0), Z(0), size.x * k, size.z * k);
      g.globalAlpha = 1;
      g.font = '11px ui-sans-serif, system-ui, sans-serif';
      g.textBaseline = 'top';
      out.regions.forEach((r, i) => {
        const hue = r.name.startsWith('ПЗУ') ? 8 : r.name.startsWith('ff') ? 200 : r.name.startsWith('data') ? 130 : (i * 47) % 360;
        g.fillStyle = `hsla(${hue}, 60%, 55%, 0.25)`;
        g.strokeStyle = `hsla(${hue}, 60%, 55%, 0.9)`;
        const x = X(r.x0);
        const z = Z(r.z0);
        const ww = Math.max(1, (r.x1 - r.x0 + 1) * k);
        const hh = Math.max(1, (r.z1 - r.z0 + 1) * k);
        g.fillRect(x, z, ww, hh);
        g.strokeRect(x, z, ww, hh);
        if (hh > 11 && ww > 24) {
          g.fillStyle = fg;
          g.fillText(r.name, x + 2, z + 1, ww - 3);
        }
      });
      for (const c of out.controls) {
        g.fillStyle = c.kind === 'lever' ? '#ff5448' : c.kind === 'lamp' ? '#f4c430' : '#40c8ff';
        g.beginPath();
        g.arc(X(c.pos[0]), Z(c.pos[2]), c.kind === 'state' ? 1.6 : 3, 0, Math.PI * 2);
        g.fill();
      }
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(box);
    return () => ro.disconnect();
  }, [out, size.x, size.z]);
  return (
    <div className="cs-board" ref={wrap} role="img" aria-label="Карта платы сверху">
      <canvas ref={ref} />
      <div className="cs-board-legend">
        <span><i style={{ background: '#ff5448' }} /> рычаги</span>
        <span><i style={{ background: '#f4c430' }} /> лампы портов</span>
        <span><i style={{ background: '#40c8ff' }} /> состояния PC/A</span>
        <span className="dim">север сверху, восток справа</span>
      </div>
    </div>
  );
}
