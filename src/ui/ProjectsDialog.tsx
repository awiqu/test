import { useEffect, useState } from 'react';
import { useEditor } from '../editor/store';
import { confirmDialog, textDialog } from './ask';
import { LibraryEntry, loadLibrary, removeFromLibrary, renameInLibrary, saveToLibrary } from '../storage/library';

export function ProjectsDialog() {
  const open = useEditor((s) => s.dialog === 'projects');
  const [list, setList] = useState<LibraryEntry[]>([]);
  const close = () => useEditor.getState().setDialog(null);

  useEffect(() => {
    if (open) setList(loadLibrary());
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  if (!open) return null;
  const st = useEditor.getState();

  const saveCurrent = () => {
    setList(saveToLibrary(st.projectName || 'Без названия', st.circuit, st.settings));
    st.notify('Проект сохранён в браузере');
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal small" role="dialog" aria-modal="true" aria-label="Проекты">
        <header className="modal-head">
          <h2>Проекты в браузере</h2>
          <div className="tb-spacer" />
          <button className="btn icon" onClick={close} aria-label="Закрыть">✕</button>
        </header>
        <div className="modal-pad">
          <div className="save-row">
            <div>
              <b>{st.projectName || 'Без названия'}</b>
              <div className="dim">текущий проект · {st.circuit.gates.length} гейт.</div>
            </div>
            <button className="btn primary" onClick={saveCurrent}>Сохранить сюда</button>
          </div>
          <p className="hint">Проекты хранятся в этом браузере. Чтобы перенести на другой компьютер — используйте «Сохранить» (файл .redlogic.json).</p>
          {list.length === 0 ? (
            <div className="dim center">Пока ничего не сохранено</div>
          ) : (
            <ul className="lib">
              {list.map((e) => (
                <li key={e.id}>
                  <div className="lib-main">
                    <b>{e.name}</b>
                    <span className="dim">
                      {e.gateCount} гейт. · {new Date(e.savedAt).toLocaleString('ru-RU')}
                    </span>
                  </div>
                  <button
                    className="btn small"
                    onClick={() => {
                      st.loadProject({ name: e.name, circuit: e.circuit, settings: e.settings });
                      close();
                      window.dispatchEvent(new Event('redlogic:fit'));
                    }}
                  >
                    Открыть
                  </button>
                  <button
                    className="btn small"
                    onClick={async () => {
                      const v = await textDialog('Новое название', e.name, 'Переименовать');
                      if (v) setList(renameInLibrary(e.id, v));
                    }}
                  >
                    Переименовать
                  </button>
                  <button
                    className="btn small danger"
                    onClick={async () => (await confirmDialog(`Удалить «${e.name}»?`, { okLabel: 'Удалить', danger: true })) && setList(removeFromLibrary(e.id))}
                  >
                    Удалить
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
