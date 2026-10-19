import { useMemo, useState } from 'react';
import { useComputer } from '../store';
import { ComputerProject, Instruction } from '../types';
import { generatePython } from '../pyexport';
import { layoutOf } from '../isa';
import { portMap } from '../spec';
import { saveFile } from '../../storage/project';
import { CopyButton, Section, notify } from './common';

function sampleOperand(f: string, p: ComputerProject): string {
  const prefix = p.asm.regPrefix || 'r';
  switch (f) {
    case 'rd': return `${prefix}0`;
    case 'rs': return `${prefix}${Math.min(1, p.spec.regCount - 1)}`;
    case 'rt': return `${prefix}${Math.min(2, p.spec.regCount - 1)}`;
    case 'imm': return '10';
    case 'addr': return portMap(p.spec)[0]?.name ?? '0';
    case 'target':
    case 'off': return 'loop';
    default: return '?';
  }
}

export function sampleLine(inst: Instruction, p: ComputerProject): string {
  const fields = layoutOf(inst.format, p.spec).fields.map((f) => f.name);
  return `${inst.mnemonic.toLowerCase()}${fields.length ? ' ' + fields.map((f) => sampleOperand(f, p)).join(', ') : ''}`;
}

export function AsmStep() {
  const project = useComputer((s) => s.project);
  const { setAsm, setPython, setStep } = useComputer.getState();
  const [editing, setEditing] = useState(false);
  const generated = useMemo(() => generatePython(project), [project]);
  const code = project.pythonAssembler ?? generated;
  const ports = portMap(project.spec);
  const sorted = [...project.instructions].sort((a, b) => a.opcode - b.opcode);

  return (
    <div className="cs-page">
      <div className="cs-welcome slim">
        <h2>Ассемблер вашего компьютера</h2>
        <p>
          Ассемблер строится автоматически из набора команд: мнемоники и операнды берутся из инструкций. Работает сразу в браузере (вкладка «Программы»)
          и в виде отдельного <b>Python-файла</b> — его можно скачать, править и запускать у себя: он умеет ассемблировать, дизассемблировать и выполнять программы.
        </p>
      </div>

      <div className="cs-grid">
        <Section title="Настройки">
          <label className="field">
            <span>Префикс имён регистров</span>
            <input value={project.asm.regPrefix} maxLength={4} onChange={(e) => setAsm({ regPrefix: e.target.value.replace(/[^A-Za-z]/g, '') || 'r' })} spellCheck={false} />
            <small className="dim">{project.spec.arch === 'accumulator' ? 'Аккумуляторная архитектура: регистры в командах не указываются.' : `Регистры: ${Array.from({ length: project.spec.regCount }, (_, i) => `${project.asm.regPrefix}${i}`).join(', ')}`}</small>
          </label>
          <label className="check">
            <input type="checkbox" checked={project.asm.caseSensitiveLabels} onChange={(e) => setAsm({ caseSensitiveLabels: e.target.checked })} />
            Различать регистр в метках и константах
          </label>
        </Section>
        <Section title="Общие правила">
          <ul className="cs-rules">
            <li>Метка — <code>имя:</code>, комментарий — <code>;</code> или <code>//</code></li>
            <li>Числа: <code>10</code> <code>0x1F</code> <code>0b101</code> <code>'A'</code>; выражения <code>+ - * / % &lt;&lt; &gt;&gt; &amp; | ^ ~</code></li>
            <li><code>.org адрес</code> · <code>.equ ИМЯ, знач</code> (или <code>ИМЯ = знач</code>) · <code>.word a, b</code> · <code>.fill n[, v]</code> · <code>.string "текст"</code></li>
            <li><code>$</code> — адрес текущей строки; для относительных переходов (<code>off</code>) указывайте адрес назначения</li>
            <li>Данные <code>.word</code>/<code>.string</code> лежат в ПЗУ, а не в ОЗУ</li>
          </ul>
        </Section>
      </div>

      <Section title="Команды ассемблера" aside={<span className="dim">{sorted.length} шт.</span>}>
        <div className="tt-wrap">
          <table className="cs-table wide">
            <thead><tr><th>Команда</th><th>Операнды</th><th>Пример</th><th>Что делает</th></tr></thead>
            <tbody>
              {sorted.map((i) => (
                <tr key={i.opcode}>
                  <td><b>{i.mnemonic}</b></td>
                  <td className="mono dim">{i.format ? i.format.split(',').join(', ') : '—'}</td>
                  <td className="mono">{sampleLine(i, project)}</td>
                  <td>{i.pseudo || i.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Константы-порты устройств">
        {ports.length === 0 ? (
          <p className="hint">Устройств нет.</p>
        ) : (
          <div className="tt-wrap">
            <table className="cs-table wide">
              <thead><tr><th>Имя</th><th>Адрес</th><th>Устройство</th><th>Доступ</th><th>Описание</th></tr></thead>
              <tbody>
                {ports.map((p) => (
                  <tr key={p.addr}>
                    <td className="mono"><b>{p.name}</b></td>
                    <td className="mono">{p.addr} (0x{p.addr.toString(16).toUpperCase()})</td>
                    <td>{p.device}</td>
                    <td className="mono">{p.access}</td>
                    <td>{p.desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="hint">Дополнительно доступны <code>ROM_SIZE</code>, <code>RAM_SIZE</code>{project.spec.stack.enabled ? ', STACK_TOP' : ''}.</p>
      </Section>

      <Section
        title="Ассемблер на Python"
        aside={
          <div className="cs-actions">
            <CopyButton text={code} label="Копировать" />
            <button
              className="btn small"
              onClick={async () => {
                const r = await saveFile('assembler.py', code, 'text/x-python');
                if (r !== 'cancelled') notify(r === 'zipped' ? 'assembler.py сохранён в архиве .zip' : 'assembler.py сохранён');
              }}
            >
              Скачать assembler.py
            </button>
            <button className="btn small" onClick={() => setEditing((v) => !v)}>{editing ? 'Готово' : 'Править'}</button>
            {project.pythonAssembler !== undefined && (
              <button className="btn small danger" onClick={() => setPython(undefined)}>Вернуть сгенерированный</button>
            )}
          </div>
        }
      >
        <p className="hint">
          Только стандартная библиотека Python 3. Команды: <code className="mono">python assembler.py asm prog.asm -o prog.hex</code> ·{' '}
          <code className="mono">python assembler.py run prog.asm</code> (эмулятор с устройствами) · <code className="mono">python assembler.py dis prog.hex</code>.
          {project.pythonAssembler !== undefined && <b> Сейчас используется ваша правка.</b>}
        </p>
        {editing ? (
          <textarea className="mono cs-code tall" value={code} onChange={(e) => setPython(e.target.value)} spellCheck={false} aria-label="Код Python" />
        ) : (
          <pre className="cs-pre mono">{code}</pre>
        )}
      </Section>

      <div className="cs-footer">
        <button className="btn" onClick={() => setStep('isa')}>← Инструкции</button>
        <div className="tb-spacer" />
        <button className="btn primary big" onClick={() => setStep('prog')}>Далее: программы →</button>
      </div>
    </div>
  );
}
