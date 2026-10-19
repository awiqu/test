import { useEffect, useState } from 'react';
import { useEditor } from '../editor/store';
import { COMPUTERS, ComputerConfig } from '../computers';

export function ComputersDialog() {
  const open = useEditor((s) => s.dialog === 'computers');
  const close = () => useEditor.getState().setDialog(null);
  const gen = COMPUTERS[0];
  const [cfg, setCfg] = useState<ComputerConfig>(gen.defaultConfig);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  if (!open) return null;
  const set = <K extends keyof ComputerConfig>(k: K, v: ComputerConfig[K]) => setCfg((c) => ({ ...c, [k]: v }));

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal small" role="dialog" aria-modal="true" aria-label="Редстоун-компьютеры">
        <header className="modal-head">
          <h2>Редстоун-компьютеры</h2>
          <span className="pill">скоро</span>
          <div className="tb-spacer" />
          <button className="btn icon" onClick={close} aria-label="Закрыть">✕</button>
        </header>
        <div className="modal-pad">
          <div className="soon">
            <b>{gen.name}</b>
            <p>{gen.description}</p>
            <p className="dim">Это заглушка: параметры ниже уже можно настроить, но генератор ещё не реализован. Когда он появится, компьютер соберётся как обычная схема и пойдёт через тот же экспорт в .litematic.</p>
          </div>
          <div className="two">
            <label className="field">
              <span>Разрядность</span>
              <select value={cfg.bits} onChange={(e) => set('bits', Number(e.target.value) as ComputerConfig['bits'])}>
                <option value={4}>4 бита</option>
                <option value={8}>8 бит</option>
                <option value={16}>16 бит</option>
              </select>
            </label>
            <label className="field">
              <span>Регистры</span>
              <select value={cfg.registers} onChange={(e) => set('registers', Number(e.target.value))}>
                {[2, 4, 8, 16].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>ПЗУ программ (слов)</span>
              <select value={cfg.romWords} onChange={(e) => set('romWords', Number(e.target.value))}>
                {[8, 16, 32, 64, 256].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>ОЗУ (слов)</span>
              <select value={cfg.ramWords} onChange={(e) => set('ramWords', Number(e.target.value))}>
                {[0, 8, 16, 32, 64].map((n) => (
                  <option key={n} value={n}>
                    {n === 0 ? 'нет' : n}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Набор инструкций</span>
              <select value={cfg.isa} onChange={(e) => set('isa', e.target.value as ComputerConfig['isa'])}>
                <option value="minimal">Минимальный</option>
                <option value="extended">Расширенный</option>
              </select>
            </label>
            <label className="field">
              <span>Такт (тики редстоуна)</span>
              <select value={cfg.clockTicks} onChange={(e) => set('clockTicks', Number(e.target.value))}>
                {[2, 4, 8, 16].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="result-actions">
            <button className="btn primary big" disabled title="Генератор в разработке">
              Собрать компьютер
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
