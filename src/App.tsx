import { useEffect } from 'react';
import { Canvas } from './editor/Canvas';
import { Toolbar } from './ui/Toolbar';
import { TopBar } from './ui/TopBar';
import { Inspector } from './ui/Inspector';
import { ExportDialog } from './ui/ExportDialog';
import { ProjectsDialog } from './ui/ProjectsDialog';
import { ComputersDialog } from './ui/ComputersDialog';
import { AskHost } from './ui/ask';
import { useEditor } from './editor/store';

export function App() {
  const toast = useEditor((s) => s.toast);
  const placing = useEditor((s) => s.placing);

  useEffect(() => {
    // при первой загрузке подгоняем вид под схему
    const t = setTimeout(() => window.dispatchEvent(new Event('redlogic:fit')), 60);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="app">
      <TopBar />
      <div className="main">
        <Toolbar />
        <main className="stage">
          <Canvas />
          {placing && <div className="placing-hint">Кликните по полю, чтобы поставить гейт · Shift — ставить несколько · Esc — отмена</div>}
        </main>
        <Inspector />
      </div>
      <ExportDialog />
      <ProjectsDialog />
      <ComputersDialog />
      <AskHost />
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
