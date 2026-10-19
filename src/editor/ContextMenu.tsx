import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useEditor } from './store';
import { GATE_INFO, PALETTE_ORDER, Point } from '../model/types';
import { textDialog } from '../ui/ask';

export interface MenuState {
  x: number;
  y: number;
  kind: 'gate' | 'wire' | 'canvas';
  gateId?: string;
  wireId?: string;
  world: Point;
}

interface Item {
  label: string;
  shortcut?: string;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
  sub?: Item[];
  sep?: boolean;
}

export function ContextMenu({ menu, onClose, fit }: { menu: MenuState; onClose: () => void; fit: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: menu.x, y: menu.y });
  const st = useEditor.getState();
  const circuit = st.circuit;
  const gate = menu.gateId ? circuit.gates.find((g) => g.id === menu.gateId) : undefined;
  const hasSel = st.selection.size > 0;
  const act = (fn: () => void) => () => {
    fn();
    onClose();
  };

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ x: Math.min(menu.x, window.innerWidth - r.width - 8), y: Math.min(menu.y, window.innerHeight - r.height - 8) });
  }, [menu]);

  useEffect(() => {
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
      if (e instanceof MouseEvent && ref.current?.contains(e.target as Node)) return;
      onClose();
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', close);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', close);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  const items: Item[] = [];
  if (menu.kind === 'gate' && gate) {
    const info = GATE_INFO[gate.type];
    const ids = [...st.selection];
    items.push(
      { label: 'Копировать', shortcut: 'Ctrl+C', onClick: act(() => st.copy()) },
      { label: 'Вырезать', shortcut: 'Ctrl+X', onClick: act(() => st.cut()) },
      { label: 'Дублировать', shortcut: 'Ctrl+D', onClick: act(() => st.duplicate()) },
      { label: 'Удалить', shortcut: 'Del', danger: true, onClick: act(() => st.deleteSelection()) },
      { label: '', sep: true },
    );
    if (gate.type === 'INPUT') {
      items.push({ label: gate.value ? 'Выключить (0)' : 'Включить (1)', onClick: act(() => st.toggleInput(gate.id)) });
    }
    if (info.variableInputs) {
      items.push(
        { label: gate.inputs >= info.maxInputs ? 'Добавить вход (максимум)' : `Добавить вход (${gate.inputs} → ${gate.inputs + 1})`, disabled: gate.inputs >= info.maxInputs, onClick: act(() => st.updateGates(ids, (g) => ({ inputs: Math.min(GATE_INFO[g.type].maxInputs, g.inputs + 1) }))) },
        { label: gate.inputs <= info.minInputs ? 'Убрать вход (минимум)' : `Убрать вход (${gate.inputs} → ${gate.inputs - 1})`, disabled: gate.inputs <= info.minInputs, onClick: act(() => st.updateGates(ids, (g) => ({ inputs: Math.max(GATE_INFO[g.type].minInputs, g.inputs - 1) }))) },
      );
    }
    if (gate.type === 'BUFFER') {
      items.push({ label: `Задержка: ${gate.delay} → ${(gate.delay % 4) + 1} тик.`, onClick: act(() => st.updateGate(gate.id, { delay: (gate.delay % 4) + 1 })) });
    }
    if (gate.type === 'INPUT' || gate.type === 'OUTPUT' || ids.length === 1) {
      items.push({
        label: 'Переименовать…',
        onClick: act(() => {
          void textDialog('Название', gate.label).then((v) => {
            if (v !== null) st.updateGate(gate.id, { label: v.slice(0, 8) });
          });
        }),
      });
    }
    items.push(
      { label: '', sep: true },
      {
        label: 'Отсоединить все провода',
        onClick: act(() => {
          const set = new Set(ids);
          st.commit({ ...circuit, wires: circuit.wires.filter((w) => !set.has(w.from) && !set.has(w.to)) });
        }),
      },
    );
  } else if (menu.kind === 'wire' && menu.wireId) {
    const w = circuit.wires.find((x) => x.id === menu.wireId);
    items.push(
      { label: 'Удалить провод', shortcut: 'Del', danger: true, onClick: act(() => st.deleteWires([menu.wireId!])) },
      {
        label: 'Сбросить изгиб',
        disabled: w?.midX === undefined,
        onClick: act(() => {
          st.pushHistory();
          st.setWireMid(menu.wireId!, undefined);
        }),
      },
    );
  } else {
    items.push(
      {
        label: 'Добавить гейт',
        sub: PALETTE_ORDER.map((t) => ({
          label: GATE_INFO[t].name,
          onClick: act(() => {
            st.addGate(t, menu.world.x - 30, menu.world.y - 15);
          }),
        })),
      },
      { label: '', sep: true },
      { label: 'Вставить', shortcut: 'Ctrl+V', disabled: !st.clipboard, onClick: act(() => st.paste(menu.world)) },
      { label: 'Выделить всё', shortcut: 'Ctrl+A', disabled: circuit.gates.length === 0, onClick: act(() => st.selectAll()) },
      { label: 'Снять выделение', disabled: !hasSel, onClick: act(() => st.clearSelection()) },
      { label: '', sep: true },
      { label: 'Показать всю схему', shortcut: 'F', onClick: act(fit) },
    );
  }

  return (
    <div ref={ref} className="ctx" style={{ left: pos.x, top: pos.y }} onContextMenu={(e) => e.preventDefault()}>
      {items.map((it, i) =>
        it.sep ? (
          <div key={i} className="ctx-sep" />
        ) : it.sub ? (
          <div key={i} className="ctx-item has-sub">
            <span>{it.label}</span>
            <span className="ctx-arrow">▸</span>
            <div className="ctx-sub">
              {it.sub.map((s, j) => (
                <button key={j} className="ctx-item" onClick={s.onClick}>
                  <span>{s.label}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <button key={i} className={`ctx-item${it.danger ? ' danger' : ''}`} disabled={it.disabled} onClick={it.onClick}>
            <span>{it.label}</span>
            {it.shortcut && <span className="ctx-key">{it.shortcut}</span>}
          </button>
        ),
      )}
    </div>
  );
}
