import { useEditor, Tool } from '../editor/store';
import { GATE_INFO, GateType, PALETTE_ORDER } from '../model/types';
import { GateIcon } from '../editor/GateShape';

const ToolIcon = ({ kind }: { kind: Tool }) => {
  const p = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (kind) {
    case 'select':
      return (
        <svg {...p}>
          <path d="M5 3l14 8-6 1.8L10.5 19z" />
        </svg>
      );
    case 'pan':
      return (
        <svg {...p}>
          <path d="M8 12V5.5a1.5 1.5 0 013 0V11m0-1V4.5a1.5 1.5 0 013 0V11m0-.5V6a1.5 1.5 0 013 0v8.5c0 3-2 5.5-5.5 5.5S7 18 6 15.5L4.6 12.7a1.4 1.4 0 012.4-1.4L8 12.5" />
        </svg>
      );
    case 'wire':
      return (
        <svg {...p}>
          <circle cx="5" cy="7" r="1.8" />
          <circle cx="19" cy="17" r="1.8" />
          <path d="M6.8 7H12v10h5.2" />
        </svg>
      );
    case 'erase':
      return (
        <svg {...p}>
          <path d="M4 16l9-9a2 2 0 012.8 0l3.2 3.2a2 2 0 010 2.8L13 19H8z" />
          <path d="M9 19h11M8 12l5 5" />
        </svg>
      );
  }
};

const TOOLS: { id: Tool; name: string; key: string }[] = [
  { id: 'select', name: 'Выделение и перемещение', key: 'V' },
  { id: 'pan', name: 'Рука — перемещение поля', key: 'H' },
  { id: 'wire', name: 'Провода: тяните от пина к пину', key: 'W' },
  { id: 'erase', name: 'Ластик — клик удаляет гейт или провод', key: 'X' },
];

export function Toolbar() {
  const tool = useEditor((s) => s.tool);
  const placing = useEditor((s) => s.placing);
  const setTool = useEditor((s) => s.setTool);
  const setPlacing = useEditor((s) => s.setPlacing);

  return (
    <aside className="toolbar" aria-label="Панель инструментов">
      <div className="tb-group-title">Инструменты</div>
      <div className="tb-tools">
        {TOOLS.map((t) => (
          <button key={t.id} className={`tb-tool${tool === t.id && !placing ? ' active' : ''}`} title={`${t.name} (${t.key})`} onClick={() => setTool(t.id)} aria-label={t.name}>
            <ToolIcon kind={t.id} />
          </button>
        ))}
      </div>
      <div className="tb-group-title">Гейты</div>
      <div className="tb-gates">
        {PALETTE_ORDER.map((t: GateType) => (
          <button
            key={t}
            className={`tb-gate${placing === t ? ' active' : ''}`}
            title={`${GATE_INFO[t].name} — ${GATE_INFO[t].hint}\nКликните, затем по полю (Shift — несколько)`}
            onClick={() => setPlacing(placing === t ? null : t)}
            aria-label={GATE_INFO[t].name}
          >
            <GateIcon type={t} />
            <span>{GATE_INFO[t].short}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}
