import { useEffect, useMemo, useState } from 'react';
import { useEditor } from '../editor/store';
import { boundsOf } from '../model/circuit';
import { parseNetlist, printNetlist } from '../model/netlist';
import { Circuit } from '../model/types';
import { designCircuitPrompt, fixPrompt } from '../computer/docs';
import { CopyButton, IssueList } from '../computer/ui/common';
import { confirmDialog } from './ask';
import { saveFile } from '../storage/project';

const SAMPLE = `# Полусумматор: сумма и перенос
input a b
s = XOR(a, b)
c = AND(a, b)
output sum = s
output carry = c
`;

type Tab = 'paste' | 'current' | 'prompt';

/** Применяет разобранную схему в редакторе (с возможностью отмены). */
export async function applyCircuit(circuit: Circuit, mode: 'replace' | 'append'): Promise<boolean> {
  const st = useEditor.getState();
  if (mode === 'replace') {
    if (st.circuit.gates.length > 0 && !(await confirmDialog('Заменить текущую схему?', { message: 'Действие можно отменить (Ctrl+Z).', okLabel: 'Заменить' }))) return false;
    st.commit(circuit);
  } else {
    const b = boundsOf(st.circuit.gates);
    const dx = b ? b.x + b.w + 90 : 0;
    const dy = b ? b.y : 0;
    const ob = boundsOf(circuit.gates);
    const gates = circuit.gates.map((g) => ({ ...g, x: g.x - (ob?.x ?? 0) + dx, y: g.y - (ob?.y ?? 0) + dy }));
    st.commit({ gates: [...st.circuit.gates, ...gates], wires: [...st.circuit.wires, ...circuit.wires] });
  }
  window.dispatchEvent(new Event('redlogic:fit'));
  return true;
}

export function NetlistDialog() {
  const open = useEditor((s) => s.dialog === 'netlist');
  const circuit = useEditor((s) => s.circuit);
  const name = useEditor((s) => s.projectName);
  const [tab, setTab] = useState<Tab>('paste');
  const [text, setText] = useState('');
  const [wishes, setWishes] = useState('');
  const close = () => useEditor.getState().setDialog(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const parsed = useMemo(() => (text.trim() ? parseNetlist(text) : null), [text]);
  const current = useMemo(() => (open ? printNetlist(circuit, name) : ''), [open, circuit, name]);
  const prompt = useMemo(() => (open && tab === 'prompt' ? designCircuitPrompt(wishes) : ''), [open, tab, wishes]);
  if (!open) return null;
  const errors = parsed?.issues.filter((i) => i.level === 'error') ?? [];
  const asIssues = (parsed?.issues ?? []).map((i) => ({ level: i.level, message: i.message, line: i.line }));
  const errorText = errors.map((i) => `строка ${i.line}: ${i.message}`).join('\n');
  const apply = async (mode: 'replace' | 'append') => {
    if (!parsed?.circuit) return;
    if (await applyCircuit(parsed.circuit, mode)) {
      useEditor.getState().notify(`Схема добавлена: ${parsed.stats.gates} гейтов, ${parsed.stats.inputs} входов, ${parsed.stats.outputs} выходов`);
      close();
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal mid" role="dialog" aria-modal="true" aria-label="Нетлист и ИИ">
        <header className="modal-head">
          <h2>Схема в виде текста · ИИ</h2>
          <div className="tb-spacer" />
          <button className="btn icon" onClick={close} aria-label="Закрыть">✕</button>
        </header>
        <div className="cs-tabs pad" role="tablist">
          {([['paste', 'Вставить схему'], ['current', 'Текущая схема как текст'], ['prompt', 'Промпт для ИИ']] as [Tab, string][]).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>
          ))}
        </div>
        <div className="modal-pad">
          {tab === 'paste' && (
            <>
              <p className="hint">Вставьте текст схемы (например, ответ ИИ). Гейты будут расставлены автоматически, провода проложены; затем схему можно проверить и экспортировать в .litematic.</p>
              <textarea className="mono cs-code tall" value={text} onChange={(e) => setText(e.target.value)} placeholder={SAMPLE} spellCheck={false} aria-label="Нетлист" />
              {parsed && (
                <>
                  {errors.length === 0 ? <div className="badge ok">Разобрано: {parsed.stats.inputs} входов, {parsed.stats.gates} гейтов, {parsed.stats.outputs} выходов</div> : <div className="badge bad">Ошибок: {errors.length}</div>}
                  <IssueList issues={asIssues} />
                </>
              )}
              <div className="result-actions">
                <button className="btn" onClick={() => setText(SAMPLE)}>Подставить пример</button>
                {errors.length > 0 && <CopyButton className="btn" label="Скопировать запрос на исправление" text={() => fixPrompt('circuit', errorText)} />}
                <div className="tb-spacer" />
                <button className="btn" disabled={!parsed?.circuit} onClick={() => apply('append')}>Добавить справа</button>
                <button className="btn primary" disabled={!parsed?.circuit} onClick={() => apply('replace')}>Заменить схему</button>
              </div>
            </>
          )}
          {tab === 'current' && (
            <>
              <p className="hint">Текстовое описание схемы на экране — его удобно отправить ИИ (например, чтобы упростить или найти ошибку) и вернуть обратно.</p>
              <textarea className="mono cs-code tall" readOnly value={current} aria-label="Текущая схема" />
              <div className="result-actions">
                <CopyButton className="btn" text={current} />
                <button className="btn" onClick={() => void saveFile(`${name || 'circuit'}.netlist.txt`, current, 'text/plain')}>Скачать .txt</button>
              </div>
            </>
          )}
          {tab === 'prompt' && (
            <>
              <p className="hint">Опишите схему — приложение соберёт полный промпт со справкой по формату. Вставьте его в любой чат с ИИ, а ответ — на вкладке «Вставить схему».</p>
              <textarea className="cs-wishes" value={wishes} onChange={(e) => setWishes(e.target.value)} placeholder="Например: сумматор двух 2-битных чисел с переносом" aria-label="Описание схемы" />
              <textarea className="mono cs-code tall" readOnly value={prompt} aria-label="Промпт" />
              <div className="result-actions"><span className="dim">{prompt.length.toLocaleString('ru-RU')} символов</span><CopyButton className="btn primary" label="Скопировать промпт" text={prompt} /></div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
