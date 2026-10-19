import { useEffect } from 'react';
import { Canvas } from './editor/Canvas';
import { Toolbar } from './ui/Toolbar';
import { TopBar } from './ui/TopBar';
import { Inspector } from './ui/Inspector';
import { ExportDialog } from './ui/ExportDialog';
import { ProjectsDialog } from './ui/ProjectsDialog';
import { NetlistDialog } from './ui/NetlistDialog';
import { ComputersTab } from './computer/ui/ComputersTab';
import { useMode } from './ui/mode';
import { AskHost } from './ui/ask';
import { useEditor } from './editor/store';

export function App() {
  const toast = useEditor((s) => s.toast);
  const placing = useEditor((s) => s.placing);
  const mode = useMode((s) => s.mode);

  useEffect(() => {
    // при первой загрузке подгоняем вид под схему
    const t = setTimeout(() => window.dispatchEvent(new Event('redlogic:fit')), 60);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="app">
      <TopBar />
      {mode === 'circuits' ? (
        <div className="main">
          <Toolbar />
          <main className="stage">
            <Canvas />
            {placing && <div className="placing-hint">Кликните по полю, чтобы поставить гейт · Shift — ставить несколько · Esc — отмена</div>}
          </main>
          <Inspector />
        </div>
      ) : (
        <ComputersTab />
      )}
      <ExportDialog />
      <ProjectsDialog />
      <NetlistDialog />
      <AskHost />
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
