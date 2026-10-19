import { useEffect, useMemo, useState } from 'react';
import { useEditor } from '../editor/store';
import { useCompile } from './useCompile';
import { PreviewCanvas } from './PreviewCanvas';
import { GATE_VARIANTS } from '../compiler/variants';
import { BlockChoice, COLORS, MATERIALS, blockCss, blockName } from '../compiler/materials';
import { ExportSettings, MC_DATA_VERSION_26_2, defaultSettings } from '../compiler/compile';
import { buildLitematic, safeFileName } from '../export/litematic';
import { saveFile } from '../storage/project';
import { GATE_INFO, GateType } from '../model/types';

function BlockPicker({ label, value, onChange }: { label: string; value: BlockChoice; onChange: (v: BlockChoice) => void }) {
  const mat = MATERIALS.find((m) => m.id === value.material) ?? MATERIALS[0];
  return (
    <div className="field">
      <span>{label}</span>
      <div className="block-picker">
        <i className="swatch" style={{ background: blockCss(value) }} />
        <select value={value.material} onChange={(e) => onChange({ ...value, material: e.target.value })} aria-label={`${label}: материал`}>
          {MATERIALS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        {mat.colored && (
          <select value={value.color} onChange={(e) => onChange({ ...value, color: e.target.value })} aria-label={`${label}: цвет`}>
            {COLORS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
      </div>
      <small className="mono dim">{blockName(value)}</small>
    </div>
  );
}

function NumberField({ label, value, min, max, onChange, hint }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void; hint?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="stepper">
        <button onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label="меньше">−</button>
        <b>{value}</b>
        <button onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label="больше">+</button>
      </div>
      {hint && <small className="dim">{hint}</small>}
    </label>
  );
}

export function ExportDialog() {
  const open = useEditor((s) => s.exportOpen);
  const circuit = useEditor((s) => s.circuit);
  const settings = useEditor((s) => s.settings);
  const projectName = useEditor((s) => s.projectName);
  const setSettings = useEditor((s) => s.setSettings);
  const close = () => useEditor.getState().setExportOpen(false);
  const showGate = (id: string) => {
    const st = useEditor.getState();
    st.select([id]);
    st.setExportOpen(false);
  };
  const compile = useCompile(circuit, settings, open);
  const [mode, setMode] = useState<'iso' | 'plan'>('iso');
  const [layer, setLayer] = useState<number | null>(null);
  const [labels, setLabels] = useState(true);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const typesPresent = useMemo(() => {
    const set = new Set<GateType>(circuit.gates.map((g) => g.type));
    return (Object.keys(GATE_VARIANTS) as GateType[]).filter((t) => set.has(t));
  }, [circuit]);

  const colors = useMemo(() => ({ wire: blockCss(settings.wireBlock), gate: blockCss(settings.gateBlock) }), [settings.wireBlock, settings.gateBlock]);

  if (!open) return null;
  const res = compile.result;
  const s = res?.structure;
  const set = <K extends keyof ExportSettings>(key: K, v: ExportSettings[K]) => setSettings({ [key]: v } as Partial<ExportSettings>);

  const download = () => {
    if (!s) return;
    const bytes = buildLitematic(s, {
      name: settings.name || projectName,
      author: settings.author,
      description: settings.description,
      dataVersion: settings.dataVersion,
    });
    void saveFile(`${safeFileName(settings.name || projectName)}.litematic`, bytes).then((r) => {
      if (r === 'saved') useEditor.getState().notify('Файл .litematic сохранён');
      else if (r === 'zipped') useEditor.getState().notify('Сохранён архив .zip — распакуйте его, внутри файл .litematic');
    });
  };

  const verify = res?.verify;
  const errors = res?.issues.filter((i) => i.level === 'error') ?? [];

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Экспорт в litematic">
        <header className="modal-head">
          <h2>Экспорт в .litematic</h2>
          <span className="dim">Minecraft Java 26.2 · Litematica</span>
          <div className="tb-spacer" />
          <button className="btn icon" onClick={close} aria-label="Закрыть">✕</button>
        </header>

        <div className="modal-body">
          <div className="settings">
            <section>
              <h3>Размещение</h3>
              <div className="field">
                <span>Расстояния между гейтами</span>
                <div className="seg" role="radiogroup">
                  <button role="radio" aria-checked={settings.autoGap} className={settings.autoGap ? 'on' : ''} onClick={() => set('autoGap', true)}>Авто (компактно)</button>
                  <button role="radio" aria-checked={!settings.autoGap} className={!settings.autoGap ? 'on' : ''} onClick={() => set('autoGap', false)}>Вручную</button>
                </div>
                <small className="dim">{settings.autoGap ? 'Берётся наименьший зазор, при котором все провода прокладываются.' : 'Зазоры в блоках между колонками и рядами модулей.'}</small>
              </div>
              {!settings.autoGap && (
                <div className="two">
                  <NumberField label="По X (между колонками)" value={settings.gapX} min={1} max={16} onChange={(v) => set('gapX', v)} />
                  <NumberField label="По Z (между рядами)" value={settings.gapZ} min={1} max={16} onChange={(v) => set('gapZ', v)} />
                </div>
              )}
              <div className="two">
                <label className="field">
                  <span>Мосты для пересечений</span>
                  <select value={settings.maxLevel} onChange={(e) => set('maxLevel', Number(e.target.value))}>
                    <option value={1}>Нет (плоская схема)</option>
                    <option value={3}>1 уровень моста</option>
                    <option value={5}>2 уровня (по умолч.)</option>
                    <option value={7}>3 уровня</option>
                  </select>
                </label>
                <NumberField label="Повторитель каждые, блоков" value={settings.maxRun} min={4} max={15} onChange={(v) => set('maxRun', v)} hint="Пыль гаснет за 15 блоков" />
              </div>
              <label className="check">
                <input type="checkbox" checked={settings.floorPlate} onChange={(e) => set('floorPlate', e.target.checked)} />
                <span>Сплошная подложка под схемой</span>
              </label>
              <label className="check">
                <input type="checkbox" checked={settings.pruneDead} onChange={(e) => set('pruneDead', e.target.checked)} />
                <span>Не строить логику, не влияющую на выходы</span>
              </label>
            </section>

            <section>
              <h3>Блоки</h3>
              <BlockPicker label="Блок для проводов и пола" value={settings.wireBlock} onChange={(v) => set('wireBlock', v)} />
              <BlockPicker label="Блок для гейтов" value={settings.gateBlock} onChange={(v) => set('gateBlock', v)} />
              <div className="field">
                <span>Вход схемы</span>
                <div className="seg" role="radiogroup">
                  <button role="radio" aria-checked={settings.inputDevice === 'lever'} className={settings.inputDevice === 'lever' ? 'on' : ''} onClick={() => set('inputDevice', 'lever')}>Рычаг</button>
                  <button role="radio" aria-checked={settings.inputDevice === 'button'} className={settings.inputDevice === 'button' ? 'on' : ''} onClick={() => set('inputDevice', 'button')}>Кнопка</button>
                </div>
              </div>
            </section>

            {typesPresent.length > 0 && (
              <section>
                <h3>Варианты гейтов</h3>
                {typesPresent.map((t) => {
                  const list = GATE_VARIANTS[t]!;
                  const cur = settings.variants[t] ?? list[0].id;
                  return (
                    <label className="field" key={t}>
                      <span>{GATE_INFO[t].name}</span>
                      <select value={cur} onChange={(e) => set('variants', { ...settings.variants, [t]: e.target.value })}>
                        {list.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name}
                          </option>
                        ))}
                      </select>
                      <small className="dim">{list.find((v) => v.id === cur)?.desc}</small>
                    </label>
                  );
                })}
              </section>
            )}

            <section>
              <h3>Файл</h3>
              <label className="field">
                <span>Название схемы</span>
                <input value={settings.name} onChange={(e) => set('name', e.target.value)} placeholder={projectName} />
              </label>
              <label className="field">
                <span>Автор</span>
                <input value={settings.author} onChange={(e) => set('author', e.target.value)} />
              </label>
              <label className="field">
                <span>Версия данных Minecraft (DataVersion)</span>
                <input type="number" value={settings.dataVersion} onChange={(e) => set('dataVersion', Number(e.target.value) || MC_DATA_VERSION_26_2)} />
                <small className="dim">4903 — Minecraft 26.2</small>
              </label>
              <button className="btn small" onClick={() => setSettings({ ...defaultSettings(), name: settings.name, author: settings.author })}>Сбросить настройки</button>
            </section>
          </div>

          <div className="preview-pane">
            <div className="preview-bar">
              <div className="seg">
                <button className={mode === 'iso' ? 'on' : ''} onClick={() => setMode('iso')}>Объём</button>
                <button className={mode === 'plan' ? 'on' : ''} onClick={() => setMode('plan')}>План</button>
              </div>
              {s && (
                <label className="layer">
                  <span>{mode === 'iso' ? 'Слои до' : 'Слой'}</span>
                  <input type="range" min={0} max={s.sy - 1} value={layer ?? s.sy - 1} onChange={(e) => setLayer(Number(e.target.value))} />
                  <b>{layer === null ? 'все' : `Y${layer}`}</b>
                  <button className="btn small" onClick={() => setLayer(null)} disabled={layer === null}>все</button>
                </label>
              )}
              <label className="check">
                <input type="checkbox" checked={labels} onChange={(e) => setLabels(e.target.checked)} />
                <span>Подписи</span>
              </label>
            </div>

            <div className="preview-stage">
              {s ? (
                <PreviewCanvas structure={s} mode={mode} layer={layer} colors={colors} gateName={blockName(settings.gateBlock)} showLabels={labels} />
              ) : (
                <div className="preview-empty">
                  {compile.status === 'running' ? (
                    <>
                      <div className="spinner" />
                      <div>{compile.progress || 'Генерация схемы…'}</div>
                    </>
                  ) : errors.length > 0 ? (
                    <div className="err-list">
                      {errors.map((e, i) => (
                        <p key={i}>
                          ⚠ {e.message}
                          {e.gateId && (
                            <button className="link" onClick={() => showGate(e.gateId!)}>
                              показать на схеме
                            </button>
                          )}
                        </p>
                      ))}
                    </div>
                  ) : (
                    <div className="dim">{compile.error ?? 'Нет данных'}</div>
                  )}
                </div>
              )}
              {s && compile.status === 'running' && (
                <div className="stale">
                  <div className="spinner small" /> пересчёт…
                </div>
              )}
            </div>

            <div className="result-bar">
              {s && res?.stats && (
                <div className="stats">
                  <div><b>{s.sx} × {s.sy} × {s.sz}</b><span>блоков (X × Y × Z)</span></div>
                  <div><b>{res.stats.total}</b><span>всего блоков</span></div>
                  <div><b>{res.stats.torches}</b><span>факелов</span></div>
                  <div><b>{res.stats.repeaters}</b><span>повторителей</span></div>
                  <div><b>{res.stats.dust}</b><span>пыли</span></div>
                  <div><b>{res.stats.gapX}/{res.stats.gapZ}</b><span>зазор X/Z</span></div>
                </div>
              )}
              {verify && (
                <div className={`badge ${verify.ok ? 'ok' : 'bad'}`} title={verify.message}>
                  {verify.ok ? '✓' : '✕'} {verify.message}
                </div>
              )}
              {errors.length > 0 && s && (
                <div className="err-list">
                  {errors.map((e, i) => (
                    <p key={i}>
                      ⚠ {e.message}
                      {e.gateId && (
                        <button className="link" onClick={() => showGate(e.gateId!)}>
                          показать на схеме
                        </button>
                      )}
                    </p>
                  ))}
                </div>
              )}
              <div className="result-actions">
                <button className="btn" onClick={compile.rerun} disabled={compile.status === 'running'}>Пересчитать</button>
                <button className="btn primary big" onClick={download} disabled={!s || !res?.ok || compile.status === 'running'}>
                  Скачать .litematic
                </button>
              </div>
              <small className="dim">Загрузите файл в папку <span className="mono">.minecraft/schematics</span> и откройте через Litematica (M → Загрузить схему).</small>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
