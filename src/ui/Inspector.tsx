import { useMemo } from 'react';
import { useEditor } from '../editor/store';
import { GATE_INFO } from '../model/types';
import { truthTable } from '../sim/logic';

function TruthTable() {
  const circuit = useEditor((s) => s.circuit);
  const tt = useMemo(() => truthTable(circuit), [circuit]);
  if (!tt) return <div className="hint">Нужно от 1 до 8 входов.</div>;
  if (tt.outputs.length === 0) return <div className="hint">Добавьте выходы (лампы), чтобы увидеть таблицу.</div>;
  return (
    <div className="tt-wrap">
      <table className="tt">
        <thead>
          <tr>
            {tt.inputs.map((g) => (
              <th key={g.id}>{g.label || '·'}</th>
            ))}
            <th className="sp" />
            {tt.outputs.map((g) => (
              <th key={g.id} className="out">
                {g.label || '·'}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tt.rows.map((r, i) => (
            <tr key={i}>
              {r.ins.map((v, j) => (
                <td key={j} className={v ? 'one' : ''}>{v ? 1 : 0}</td>
              ))}
              <td className="sp" />
              {r.outs.map((v, j) => (
                <td key={j} className={v ? 'one out' : 'out'}>{v ? 1 : 0}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Inspector() {
  const circuit = useEditor((s) => s.circuit);
  const selection = useEditor((s) => s.selection);
  const wireSel = useEditor((s) => s.wireSelection);
  const showTable = useEditor((s) => s.showTable);
  const st = useEditor;
  const selected = circuit.gates.filter((g) => selection.has(g.id));
  const one = selected.length === 1 ? selected[0] : null;

  return (
    <aside className="inspector" aria-label="Свойства">
      <section>
        <h3>Свойства</h3>
        {one ? (
          <div className="props">
            <div className="prop-title">{GATE_INFO[one.type].name}</div>
            <div className="hint">{GATE_INFO[one.type].hint}</div>
            {(one.type === 'INPUT' || one.type === 'OUTPUT') && (
              <label className="field">
                <span>Название</span>
                <input value={one.label} maxLength={8} onChange={(e) => st.getState().updateGate(one.id, { label: e.target.value })} spellCheck={false} />
              </label>
            )}
            {one.type === 'INPUT' && (
              <label className="field row">
                <span>Состояние</span>
                <button className={`switch${one.value ? ' on' : ''}`} onClick={() => st.getState().toggleInput(one.id)} aria-pressed={one.value}>
                  <i />
                </button>
                <b>{one.value ? '1' : '0'}</b>
              </label>
            )}
            {GATE_INFO[one.type].variableInputs && (
              <label className="field">
                <span>Входов</span>
                <div className="stepper">
                  <button onClick={() => st.getState().updateGate(one.id, { inputs: Math.max(GATE_INFO[one.type].minInputs, one.inputs - 1) })} disabled={one.inputs <= GATE_INFO[one.type].minInputs}>−</button>
                  <b>{one.inputs}</b>
                  <button onClick={() => st.getState().updateGate(one.id, { inputs: Math.min(GATE_INFO[one.type].maxInputs, one.inputs + 1) })} disabled={one.inputs >= GATE_INFO[one.type].maxInputs}>+</button>
                </div>
              </label>
            )}
            {one.type === 'BUFFER' && (
              <label className="field">
                <span>Задержка (тики)</span>
                <div className="stepper">
                  <button onClick={() => st.getState().updateGate(one.id, { delay: Math.max(1, one.delay - 1) })} disabled={one.delay <= 1}>−</button>
                  <b>{one.delay}</b>
                  <button onClick={() => st.getState().updateGate(one.id, { delay: Math.min(4, one.delay + 1) })} disabled={one.delay >= 4}>+</button>
                </div>
              </label>
            )}
            <div className="field-actions">
              <button className="btn small" onClick={() => st.getState().duplicate()}>Дублировать</button>
              <button className="btn small danger" onClick={() => st.getState().deleteSelection()}>Удалить</button>
            </div>
          </div>
        ) : selected.length > 1 ? (
          <div className="props">
            <div className="prop-title">Выбрано: {selected.length}</div>
            <div className="field-actions">
              <button className="btn small" onClick={() => st.getState().copy()}>Копировать</button>
              <button className="btn small" onClick={() => st.getState().duplicate()}>Дублировать</button>
              <button className="btn small danger" onClick={() => st.getState().deleteSelection()}>Удалить</button>
            </div>
          </div>
        ) : wireSel.size > 0 ? (
          <div className="props">
            <div className="prop-title">Провод</div>
            <div className="hint">Потяните вертикальный участок, чтобы сдвинуть его.</div>
            <div className="field-actions">
              <button className="btn small danger" onClick={() => st.getState().deleteWires([...wireSel])}>Удалить</button>
            </div>
          </div>
        ) : (
          <div className="hint">Выберите гейт или провод. Клик по рычагу переключает вход, тяните от пина к пину, чтобы соединить.</div>
        )}
      </section>

      <section>
        <button className="section-toggle" onClick={() => st.getState().setShowTable(!showTable)} aria-expanded={showTable}>
          <h3>Таблица истинности</h3>
          <span>{showTable ? '▾' : '▸'}</span>
        </button>
        {showTable && <TruthTable />}
      </section>

      <section className="keys">
        <h3>Горячие клавиши</h3>
        <dl>
          <dt>V / H / W / X</dt><dd>выделение / рука / провода / ластик</dd>
          <dt>Ctrl+C / X / V</dt><dd>копировать / вырезать / вставить</dd>
          <dt>Ctrl+D</dt><dd>дублировать</dd>
          <dt>Ctrl+Z / Y</dt><dd>отмена / повтор</dd>
          <dt>Del</dt><dd>удалить</dd>
          <dt>Стрелки</dt><dd>сдвиг (Shift — крупнее)</dd>
          <dt>Колесо</dt><dd>масштаб</dd>
          <dt>Пробел / СКМ</dt><dd>панорама</dd>
          <dt>ПКМ</dt><dd>контекстное меню</dd>
        </dl>
      </section>
    </aside>
  );
}
