import { useEditor } from '../editor/store';
import { parseProject, pickFile, saveFile, serializeProject } from '../storage/project';
import { safeFileName } from '../export/litematic';
import { confirmDialog } from './ask';
import { useMode } from './mode';
import { useComputer } from '../computer/store';
import { parseComputer, serializeComputer } from '../computer/project';

export function TopBar() {
  const mode = useMode((s) => s.mode);
  const setMode = useMode((s) => s.setMode);
  return (
    <header className="topbar">
      <div className="brand">
        <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden>
          <rect width="32" height="32" rx="7" fill="#2a2b30" />
          <path d="M6 11h7M6 21h7M13 8h5c5 0 8 4 8 8s-3 8-8 8h-5z" fill="none" stroke="#ff5448" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
        <span className="brand-name">RedLogic</span>
      </div>
      <div className="seg mode-tabs" role="tablist" aria-label="Раздел">
        <button role="tab" aria-selected={mode === 'circuits'} className={mode === 'circuits' ? 'on' : ''} onClick={() => setMode('circuits')}>Схемы</button>
        <button role="tab" aria-selected={mode === 'computers'} className={mode === 'computers' ? 'on' : ''} onClick={() => setMode('computers')}>Компьютеры</button>
      </div>
      {mode === 'circuits' ? <CircuitControls /> : <ComputerControls />}
    </header>
  );
}

function ComputerControls() {
  const name = useComputer((s) => s.project.spec.name);
  const { setName, setProject, setStep, setImportText, reset } = useComputer.getState();
  const notify = (m: string) => useEditor.getState().notify(m);
  const save = () => {
    const p = useComputer.getState().project;
    void saveFile(`${safeFileName(p.spec.name)}.rlcomputer.json`, serializeComputer(p), 'application/json').then((r) => {
      if (r !== 'cancelled') notify('Компьютер сохранён в файл');
    });
  };
  const open = async () => {
    const f = await pickFile('.json,application/json');
    if (!f) return;
    const text = await f.text();
    const r = parseComputer(text);
    if (r.project) {
      setProject(r.project, { welcomed: true, isaCustom: true });
      setStep('spec');
      notify(`Открыто: ${f.name}`);
    } else {
      setImportText(text);
      setStep('ai');
      notify('Файл не принят — список ошибок на вкладке «ИИ и документация → Импорт»');
    }
  };
  const fresh = async () => {
    if (!(await confirmDialog('Начать новый компьютер?', { message: 'Текущий компьютер и его программы будут заменены. Сохраните файл, если он нужен.', okLabel: 'Новый компьютер', danger: true }))) return;
    reset('risc8');
  };
  return (
    <>
      <input className="project-name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Название компьютера" spellCheck={false} />
      <div className="tb-spacer" />
      <div className="btn-group">
        <button className="btn" onClick={fresh} title="Новый компьютер">Новый</button>
        <button className="btn" onClick={open} title="Открыть компьютер (.rlcomputer.json)">Открыть</button>
        <button className="btn" onClick={save} title="Сохранить компьютер в файл">Сохранить</button>
      </div>
      <button className="btn primary" onClick={() => setStep('rom')} title="Выгрузить программу в ПЗУ из бочек (.litematic)">ПЗУ → .litematic</button>
    </>
  );
}

function CircuitControls() {
  const name = useEditor((s) => s.projectName);
  const setName = useEditor((s) => s.setProjectName);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const live = useEditor((s) => s.live);
  const st = useEditor;

  const save = () => {
    const s = st.getState();
    void saveFile(`${safeFileName(s.projectName)}.redlogic.json`, serializeProject({ name: s.projectName, circuit: s.circuit, settings: s.settings }), 'application/json').then((r) => {
      if (r !== 'cancelled') s.notify('Проект сохранён в файл');
    });
  };
  const open = async () => {
    const f = await pickFile('.json,application/json');
    if (!f) return;
    try {
      st.getState().loadProject(parseProject(await f.text()));
      st.getState().notify(`Открыто: ${f.name}`);
      window.dispatchEvent(new Event('redlogic:fit'));
    } catch (e) {
      st.getState().notify(e instanceof Error ? e.message : 'Не удалось открыть файл');
    }
  };
  const newProject = async () => {
    const s = st.getState();
    if (s.circuit.gates.length > 0 && !(await confirmDialog('Начать новый проект?', { message: 'Несохранённые изменения будут потеряны.', okLabel: 'Новый проект', danger: true }))) return;
    s.newProject();
  };

  return (
    <>
      <input className="project-name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Название проекта" spellCheck={false} />
      <div className="tb-spacer" />
      <div className="btn-group">
        <button className="btn" onClick={newProject} title="Новый проект">Новый</button>
        <button className="btn" onClick={open} title="Открыть проект (.redlogic.json)">Открыть</button>
        <button className="btn" onClick={save} title="Сохранить проект в файл">Сохранить</button>
        <button className="btn" onClick={() => st.getState().setDialog('projects')} title="Проекты, сохранённые в браузере">Проекты</button>
      </div>
      <div className="btn-group">
        <button className="btn icon" onClick={() => st.getState().undo()} disabled={!canUndo} title="Отменить (Ctrl+Z)" aria-label="Отменить">↶</button>
        <button className="btn icon" onClick={() => st.getState().redo()} disabled={!canRedo} title="Повторить (Ctrl+Y)" aria-label="Повторить">↷</button>
      </div>
      <div className="btn-group">
        <button className="btn icon" onClick={() => window.dispatchEvent(new Event('redlogic:fit'))} title="Показать всю схему (F)" aria-label="Показать всё">⤢</button>
        <label className="btn toggle" title="Подсвечивать сигналы на схеме">
          <input type="checkbox" checked={live} onChange={(e) => st.getState().setLive(e.target.checked)} />
          <span>Симуляция</span>
        </label>
      </div>
      <button className="btn" onClick={() => st.getState().setDialog('netlist')} title="Схема в виде текста: вставить ответ ИИ, скопировать схему, промпт">
        Текст / ИИ
      </button>
      <button className="btn primary" onClick={() => st.getState().setExportOpen(true)} title="Сгенерировать редстоун-схему и скачать .litematic">
        Экспорт в .litematic
      </button>
    </>
  );
}
