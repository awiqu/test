import { useMemo, useState } from 'react';
import { zipSync } from 'fflate';
import { useComputer } from '../store';
import { AI_DOCS, computerMarkdown, designComputerPrompt, designCircuitPrompt, fixPrompt, writeProgramPrompt } from '../docs';
import { assemble } from '../asm';
import { issuesToText, parseComputer, serializeComputer } from '../project';
import { parseNetlist } from '../../model/netlist';
import { applyCircuit } from '../../ui/NetlistDialog';
import { useMode } from '../../ui/mode';
import { saveFile } from '../../storage/project';
import { confirmDialog } from '../../ui/ask';
import { Issue } from '../types';
import { CopyButton, IssueList, Section, downloadName, notify } from './common';
import { Markdown } from './markdown';

type Tab = 'docs' | 'prompts' | 'import' | 'export';
type PromptKind = 'computer' | 'program' | 'circuit';
type ImportKind = 'computer' | 'program' | 'circuit';

export function AiStep() {
  const [tab, setTab] = useState<Tab>(useComputer.getState().importText ? 'import' : 'docs');
  return (
    <div className="cs-page wide">
      <div className="cs-welcome slim">
        <h2>Работа с ИИ</h2>
        <p>
          Всё, что умеет RedLogic, можно поручить языковой модели: документация описывает форматы так, чтобы ответ принимался с первого раза, а готовые промпты сами подставляют
          ваш процессор, набор команд, карту памяти и устройства. Вставьте промпт в любой чат, а ответ — в «Импорт».
        </p>
      </div>
      <div className="cs-tabs" role="tablist">
        {([['docs', 'Документация'], ['prompts', 'Промпты'], ['import', 'Импорт ответа ИИ'], ['export', 'Экспорт компьютера']] as [Tab, string][]).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      {tab === 'docs' && <Docs />}
      {tab === 'prompts' && <Prompts />}
      {tab === 'import' && <Import />}
      {tab === 'export' && <Export />}
    </div>
  );
}

function Docs() {
  const [id, setId] = useState(AI_DOCS[0].id);
  const doc = AI_DOCS.find((d) => d.id === id) ?? AI_DOCS[0];
  const project = useComputer((s) => s.project);
  const isJson = doc.file.endsWith('.json');
  const downloadAll = async () => {
    const files: Record<string, Uint8Array> = {};
    const enc = new TextEncoder();
    for (const d of AI_DOCS) files[`ai/${d.file}`] = enc.encode(d.text);
    files['ai/this-computer.md'] = enc.encode(computerMarkdown(project));
    files['ai/this-computer.json'] = enc.encode(serializeComputer(project));
    const r = await saveFile('redlogic-ai-docs.zip', zipSync(files), 'application/zip');
    if (r !== 'cancelled') notify('Документы сохранены в redlogic-ai-docs.zip');
  };
  return (
    <div className="cs-docs">
      <nav className="cs-docs-nav" aria-label="Документы">
        {AI_DOCS.map((d) => (
          <button key={d.id} className={d.id === id ? 'on' : ''} onClick={() => setId(d.id)}>
            <b>{d.title}</b>
            <small className="mono dim">{d.file}</small>
          </button>
        ))}
        <button className="btn small" onClick={downloadAll}>Скачать всё (.zip)</button>
      </nav>
      <article className="cs-docs-body">
        <div className="cs-actions">
          <CopyButton text={doc.text} label="Копировать документ" />
          <button className="btn small" onClick={() => void saveFile(doc.file, doc.text, isJson ? 'application/json' : 'text/markdown')}>Скачать {doc.file}</button>
        </div>
        {isJson ? <pre className="cs-pre mono">{doc.text}</pre> : <Markdown text={doc.text} />}
      </article>
    </div>
  );
}

function Prompts() {
  const project = useComputer((s) => s.project);
  const [kind, setKind] = useState<PromptKind>('program');
  const [wishes, setWishes] = useState<Record<PromptKind, string>>({ computer: '', program: '', circuit: '' });
  const text = useMemo(() => {
    if (kind === 'computer') return designComputerPrompt(wishes.computer);
    if (kind === 'program') return writeProgramPrompt(project, wishes.program);
    return designCircuitPrompt(wishes.circuit);
  }, [kind, wishes, project]);
  const meta: Record<PromptKind, { title: string; label: string; ph: string; note: string }> = {
    computer: {
      title: 'Спроектировать процессор',
      label: 'Какой процессор хотите?',
      ph: 'Например: 8-битный, 4 регистра, есть стек, текстовый экран и кнопки. Нужна команда умножения.',
      note: 'ИИ вернёт файл компьютера (JSON) — импортируйте его на вкладке «Импорт».',
    },
    program: {
      title: 'Написать программу',
      label: 'Что должна делать программа?',
      ph: 'Например: считать нажатия кнопок и показывать счётчик на семисегментном индикаторе; при переполнении мигнуть всеми светодиодами.',
      note: `Промпт включает набор команд «${project.spec.name}», карту памяти, устройства и синтаксис ассемблера. Ответ вставьте в «Импорт».`,
    },
    circuit: {
      title: 'Составить логическую схему',
      label: 'Какая нужна схема?',
      ph: 'Например: сумматор двух 2-битных чисел, выходы s0 s1 carry.',
      note: 'Ответ ИИ (нетлист) можно открыть прямо в редакторе схем.',
    },
  };
  const m = meta[kind];
  return (
    <div className="cs-prompts">
      <div className="cs-cards three">
        {(Object.keys(meta) as PromptKind[]).map((k) => (
          <button key={k} className={`cs-card ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)}>
            <b>{meta[k].title}</b>
          </button>
        ))}
      </div>
      <label className="field">
        <span>{m.label}</span>
        <textarea className="cs-wishes" value={wishes[kind]} onChange={(e) => setWishes({ ...wishes, [kind]: e.target.value })} placeholder={m.ph} />
      </label>
      <p className="hint">{m.note}</p>
      <div className="cs-actions">
        <CopyButton className="btn primary" label="Скопировать промпт" text={text} />
        <span className="dim">{text.length.toLocaleString('ru-RU')} символов</span>
      </div>
      <textarea className="mono cs-code tall" readOnly value={text} aria-label="Промпт" />
    </div>
  );
}

function Import() {
  const importText = useComputer((s) => s.importText);
  const [kind, setKind] = useState<ImportKind>('computer');
  const [text, setText] = useState(importText);
  const { setProject, setImportText, addProgram, setStep } = useComputer.getState();
  const cur = useComputer((s) => s.project);

  const result = useMemo(() => {
    if (!text.trim()) return null;
    // допускаем ответ ИИ в блоке ```
    const fence = /```[a-z]*\n([\s\S]*?)```/i.exec(text);
    const body = fence ? fence[1] : text;
    if (kind === 'computer') {
      const r = parseComputer(body);
      return { issues: r.issues, ok: !!r.project, project: r.project, body };
    }
    if (kind === 'program') {
      const a = assemble(body, cur.spec, cur.instructions, cur.asm);
      return { issues: a.issues, ok: a.ok, size: a.size, body };
    }
    const n = parseNetlist(body);
    return { issues: n.issues.map((i): Issue => ({ level: i.level, message: i.message, line: i.line })), ok: !!n.circuit, circuit: n.circuit, stats: n.stats, body };
  }, [text, kind, cur]);

  const errors = result?.issues.filter((i) => i.level === 'error') ?? [];
  const apply = async () => {
    if (!result?.ok) return;
    if (kind === 'computer' && 'project' in result && result.project) {
      if (!(await confirmDialog('Заменить текущий компьютер?', { message: 'Характеристики, набор команд и программы будут заменены импортированными.', okLabel: 'Заменить', danger: true }))) return;
      setProject(result.project);
      setImportText('');
      setStep('isa');
      notify(`Компьютер «${result.project.spec.name}» загружен: ${result.project.instructions.length} инструкций`);
    } else if (kind === 'program') {
      addProgram('Программа от ИИ', result.body);
      setStep('prog');
      notify('Программа добавлена');
    } else if (kind === 'circuit' && 'circuit' in result && result.circuit) {
      if (await applyCircuit(result.circuit, 'replace')) {
        useMode.getState().setMode('circuits');
        notify('Схема открыта в редакторе');
      }
    }
  };

  return (
    <div className="cs-import">
      <div className="seg" role="group" aria-label="Что импортируем">
        {([['computer', 'Компьютер (JSON)'], ['program', 'Программа (ассемблер)'], ['circuit', 'Схема (нетлист)']] as [ImportKind, string][]).map(([k, l]) => (
          <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{l}</button>
        ))}
      </div>
      <p className="hint">
        Вставьте ответ ИИ целиком — блок <code>```</code> распознается автоматически.{' '}
        {kind === 'program' && `Проверка идёт по набору команд «${cur.spec.name}».`}
      </p>
      <textarea className="mono cs-code tall" value={text} onChange={(e) => { setText(e.target.value); setImportText(''); }} placeholder="Вставьте сюда ответ ИИ…" spellCheck={false} aria-label="Ответ ИИ" />
      {result && (
        <Section title="Результат проверки">
          {result.ok ? (
            <div className="badge ok">
              {kind === 'computer' && 'project' in result && result.project && `Файл принят: «${result.project.spec.name}», инструкций: ${result.project.instructions.length}, программ: ${result.project.programs.length}`}
              {kind === 'program' && `Программа собрана: ${'size' in result ? result.size : 0} слов`}
              {kind === 'circuit' && 'stats' in result && result.stats && `Схема принята: ${result.stats.inputs} входов, ${result.stats.gates} гейтов, ${result.stats.outputs} выходов`}
            </div>
          ) : (
            <div className="badge bad">Ошибок: {errors.length}. Скопируйте запрос на исправление и отправьте ИИ.</div>
          )}
          <IssueList issues={result.issues} />
        </Section>
      )}
      <div className="cs-actions">
        {errors.length > 0 && (
          <CopyButton
            className="btn"
            label="Скопировать запрос на исправление"
            text={() => fixPrompt(kind, kind === 'program' ? errors.map((i) => `строка ${i.line ?? '?'}: ${i.message}`).join('\n') : issuesToText(errors))}
          />
        )}
        <div className="tb-spacer" />
        <button className="btn primary" disabled={!result?.ok} onClick={apply}>
          {kind === 'computer' ? 'Загрузить компьютер' : kind === 'program' ? 'Добавить программу' : 'Открыть в редакторе схем'}
        </button>
      </div>
    </div>
  );
}

function Export() {
  const project = useComputer((s) => s.project);
  const json = useMemo(() => serializeComputer(project), [project]);
  const md = useMemo(() => computerMarkdown(project), [project]);
  const base = downloadName(project.spec.name);
  return (
    <div className="cs-export">
      <Section
        title="Файл компьютера (JSON)"
        aside={
          <div className="cs-actions">
            <CopyButton text={json} />
            <button className="btn small" onClick={() => void saveFile(`${base}.rlcomputer.json`, json, 'application/json')}>Скачать .rlcomputer.json</button>
          </div>
        }
      >
        <p className="hint">Полное описание: характеристики, набор инструкций, программы. Можно отправить ИИ как контекст («доработай этот процессор») или открыть позже кнопкой «Открыть» вверху.</p>
        <textarea className="mono cs-code tall" readOnly value={json} aria-label="JSON компьютера" />
      </Section>
      <Section
        title="Документация этого компьютера (Markdown)"
        aside={
          <div className="cs-actions">
            <CopyButton text={md} />
            <button className="btn small" onClick={() => void saveFile(`${base}.md`, md, 'text/markdown')}>Скачать .md</button>
          </div>
        }
      >
        <div className="cs-md-preview"><Markdown text={md} /></div>
      </Section>
    </div>
  );
}
