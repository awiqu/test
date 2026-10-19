import { useEditor } from '../editor/store';
import { parseProject, pickFile, saveFile, serializeProject } from '../storage/project';
import { safeFileName } from '../export/litematic';
import { confirmDialog } from './ask';

export function TopBar() {
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
    <header className="topbar">
      <div className="brand">
        <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden>
          <rect width="32" height="32" rx="7" fill="#2a2b30" />
          <path d="M6 11h7M6 21h7M13 8h5c5 0 8 4 8 8s-3 8-8 8h-5z" fill="none" stroke="#ff5448" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
        <span className="brand-name">RedLogic</span>
      </div>
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
      <button className="btn" onClick={() => st.getState().setDialog('computers')} title="Генератор редстоун-компьютеров (в разработке)">
        Компьютеры <span className="pill">скоро</span>
      </button>
      <button className="btn primary" onClick={() => st.getState().setExportOpen(true)} title="Сгенерировать редстоун-схему и скачать .litematic">
        Экспорт в .litematic
      </button>
    </header>
  );
}
