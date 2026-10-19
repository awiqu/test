import { useMemo, useState } from 'react';
import { useComputer } from '../store';
import { HARDWARE } from '../hardware';
import { parseNetlist } from '../../model/netlist';
import { hasCycle } from '../../sim/logic';
import { applyCircuit } from '../../ui/NetlistDialog';
import { useMode } from '../../ui/mode';
import { useEditor } from '../../editor/store';
import { saveFile } from '../../storage/project';
import { safeFileName } from '../../export/litematic';
import { CopyButton, IssueList, NumField, Section, notify } from './common';

export function HardwareStep() {
  const project = useComputer((s) => s.project);
  const { setStep } = useComputer.getState();
  const [id, setId] = useState(HARDWARE[0].id);
  const gen = HARDWARE.find((g) => g.id === id) ?? HARDWARE[0];
  const [values, setValues] = useState<Record<string, number>>({});
  const params = gen.params(project);
  const merged = Object.fromEntries(params.map((p) => [p.id, values[`${gen.id}.${p.id}`] ?? p.value]));

  const built = useMemo(() => {
    try {
      const text = gen.build(merged, project);
      const parsed = parseNetlist(text);
      return { text, parsed, error: null as string | null };
    } catch (e) {
      return { text: '', parsed: null, error: (e as Error).message };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gen, JSON.stringify(merged), project.instructions, project.spec]);

  const open = async (mode: 'replace' | 'append') => {
    if (!built.parsed?.circuit) return;
    if (await applyCircuit(built.parsed.circuit, mode)) {
      if (mode === 'replace') useEditor.getState().setProjectName(gen.title);
      useMode.getState().setMode('circuits');
      notify('Схема открыта в редакторе — проверьте таблицу истинности и экспортируйте в .litematic');
    }
  };
  const gates = built.parsed?.stats.gates ?? 0;

  return (
    <div className="cs-page wide">
      <div className="cs-welcome slim">
        <h2>Аппаратура: блоки для постройки компьютера</h2>
        <p>
          ПЗУ-бочки хранят программу, а исполнять её должен процессор, собранный из редстоуна. Здесь — готовые логические схемы для его основных узлов: они подстраиваются под ваши
          характеристики и набор команд, открываются в редакторе схем и экспортируются в .litematic так же, как любая другая схема.
        </p>
      </div>

      <Section title="Из чего состоит компьютер">
        <ol className="cs-arch">
          <li><b>Счётчик команд (PC)</b><span>хранит адрес текущей команды: регистр из защёлок + сумматор «+1»</span></li>
          <li><b>ПЗУ из бочек</b><span>выдаёт слово по адресу; ряд выбирается дешифратором адреса</span></li>
          <li><b>Дешифратор команд</b><span>код операции → линия «выполняется именно эта команда»</span></li>
          <li><b>АЛУ и регистры</b><span>сумматор, логика, мультиплексоры; регистры — защёлки с входом записи</span></li>
          <li><b>Память и устройства</b><span>ОЗУ и порты (лампы, рычаги, экран) подключены к общей шине данных</span></li>
        </ol>
        <p className="hint">Приложение генерирует эти узлы по отдельности. Сборка узлов в единый процессор по набору команд — на вас (в этом поможет ИИ: промпт на вкладке «ИИ и документация»).</p>
      </Section>

      <div className="cs-hw">
        <aside className="cs-hw-list">
          {HARDWARE.map((g) => (
            <button key={g.id} className={`cs-card ${g.id === id ? 'on' : ''}`} onClick={() => setId(g.id)}>
              <b>{g.title}</b>
              <em>{g.desc}</em>
            </button>
          ))}
        </aside>
        <div className="cs-hw-main">
          <Section title={gen.title}>
            <p className="hint">{gen.desc}</p>
            <div className="cs-form-row">
              {params.map((p) => (
                <NumField key={p.id} label={p.label} value={merged[p.id]} min={p.min} max={p.max} onChange={(v) => setValues({ ...values, [`${gen.id}.${p.id}`]: v })} />
              ))}
            </div>
            {built.error && <div className="badge bad">{built.error}</div>}
            {built.parsed?.circuit && hasCycle(built.parsed.circuit) && (
              <div className="badge bad">
                В схеме есть обратные связи (защёлки): в редакторе она считается и показывает сигналы, но экспорт в .litematic для таких схем пока не поддерживается.
              </div>
            )}
            {built.parsed && (
              <>
                <div className={`badge ${gates > 60 ? 'bad' : 'ok'}`}>
                  {built.parsed.stats.inputs} входов · {gates} гейтов · {built.parsed.stats.outputs} выходов
                  {gates > 60 && ' — схема большая, компилятор может не справиться: уменьшите разрядность'}
                </div>
                <IssueList issues={built.parsed.issues.map((i) => ({ level: i.level, message: i.message, line: i.line }))} />
              </>
            )}
            <textarea className="mono cs-code tall" readOnly value={built.text} aria-label="Нетлист схемы" />
            <div className="cs-actions">
              <CopyButton text={built.text} label="Копировать нетлист" />
              <button className="btn small" onClick={() => void saveFile(`${safeFileName(gen.title)}.netlist.txt`, built.text, 'text/plain')}>Скачать .txt</button>
              <div className="tb-spacer" />
              <button className="btn" disabled={!built.parsed?.circuit} onClick={() => open('append')}>Добавить в схему справа</button>
              <button className="btn primary" disabled={!built.parsed?.circuit} onClick={() => open('replace')}>Открыть в редакторе схем</button>
            </div>
          </Section>
        </div>
      </div>
      <div className="cs-footer">
        <button className="btn" onClick={() => setStep('rom')}>← ПЗУ из бочек</button>
        <div className="tb-spacer" />
        <button className="btn primary big" onClick={() => setStep('ai')}>Далее: ИИ и документация →</button>
      </div>
    </div>
  );
}
