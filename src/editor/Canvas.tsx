import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from './store';
import { GateShape, COLORS } from './GateShape';
import { layoutWires, pathToD } from './wires';
import { evaluate } from '../sim/logic';
import { boundsOf, createGate, gateById, gateSize, inputCount, inputPinPos, nextLabel, outputPinPos, snap, wirePath } from '../model/circuit';
import { GRID, Gate, Point } from '../model/types';
import { ContextMenu, MenuState } from './ContextMenu';

type Drag =
  | { kind: 'pan'; sx: number; sy: number; px: number; py: number }
  | { kind: 'move'; start: Point; orig: Map<string, Point>; moved: boolean }
  | { kind: 'band'; start: Point; cur: Point; additive: boolean; base: Set<string> }
  | { kind: 'wire'; from: { gateId: string; side: 'out' | 'in'; pin: number }; cur: Point }
  | { kind: 'wireMid'; id: string; moved: boolean }
  | null;

interface PinRef {
  gateId: string;
  kind: 'in' | 'out';
  idx: number;
}

function parsePin(s: string): PinRef {
  const [kind, gateId, idx] = s.split(':');
  return { kind: kind as 'in' | 'out', gateId, idx: Number(idx) };
}

export function Canvas() {
  const svgRef = useRef<SVGSVGElement>(null);
  const circuit = useEditor((s) => s.circuit);
  const selection = useEditor((s) => s.selection);
  const wireSelection = useEditor((s) => s.wireSelection);
  const view = useEditor((s) => s.view);
  const tool = useEditor((s) => s.tool);
  const placing = useEditor((s) => s.placing);
  const live = useEditor((s) => s.live);
  const store = useEditor;

  const [drag, setDrag] = useState<Drag>(null);
  const dragRef = useRef<Drag>(null);
  dragRef.current = drag;
  const [cursor, setCursor] = useState<Point>({ x: 0, y: 0 });
  const [hoverPin, setHoverPin] = useState<PinRef | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [, setSize] = useState({ w: 800, h: 600 });
  const spaceRef = useRef(false);

  const toWorld = useCallback(
    (cx: number, cy: number): Point => {
      const r = svgRef.current!.getBoundingClientRect();
      const v = store.getState().view;
      return { x: (cx - r.left - v.panX) / v.zoom, y: (cy - r.top - v.panY) / v.zoom };
    },
    [store],
  );

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const sim = useMemo(() => evaluate(circuit), [circuit]);
  const gm = useMemo(() => gateById(circuit), [circuit]);
  const wl = useMemo(() => layoutWires(circuit), [circuit]);

  const incoming = useMemo(() => {
    const m = new Map<string, (string | null)[]>();
    for (const g of circuit.gates) m.set(g.id, new Array(inputCount(g)).fill(null));
    for (const w of circuit.wires) {
      const a = m.get(w.to);
      if (a && w.toPin < a.length) a[w.toPin] = w.from;
    }
    return m;
  }, [circuit]);

  /** Подогнать вид под всю схему. */
  const fit = useCallback(() => {
    const b = boundsOf(store.getState().circuit.gates);
    const el = svgRef.current;
    if (!b || !el) {
      store.getState().setView({ zoom: 1, panX: 20, panY: 20 });
      return;
    }
    const pad = 50;
    const z = Math.min(2, Math.max(0.2, Math.min((el.clientWidth - pad * 2) / b.w, (el.clientHeight - pad * 2) / b.h)));
    store.getState().setView({ zoom: z, panX: (el.clientWidth - b.w * z) / 2 - b.x * z, panY: (el.clientHeight - b.h * z) / 2 - b.y * z });
  }, [store]);

  useEffect(() => {
    const onFit = () => fit();
    window.addEventListener('redlogic:fit', onFit);
    return () => window.removeEventListener('redlogic:fit', onFit);
  }, [fit]);

  // ближайший подходящий пин для протягиваемого провода
  const findPin = useCallback(
    (p: Point, from: { gateId: string; side: 'out' | 'in' }): PinRef | null => {
      const c = store.getState().circuit;
      const R = 14 / store.getState().view.zoom;
      let best: PinRef | null = null;
      let bd = R;
      for (const g of c.gates) {
        if (g.id === from.gateId) continue;
        if (from.side === 'out') {
          for (let i = 0; i < inputCount(g); i++) {
            const q = inputPinPos(g, i);
            const d = Math.hypot(q.x - p.x, q.y - p.y);
            if (d < bd) {
              bd = d;
              best = { gateId: g.id, kind: 'in', idx: i };
            }
          }
        } else if (g.type !== 'OUTPUT') {
          const q = outputPinPos(g);
          const d = Math.hypot(q.x - p.x, q.y - p.y);
          if (d < bd) {
            bd = d;
            best = { gateId: g.id, kind: 'out', idx: 0 };
          }
        }
      }
      return best;
    },
    [store],
  );

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (menu) setMenu(null);
    const st = store.getState();
    const target = e.target as Element;
    const w = toWorld(e.clientX, e.clientY);
    // ПКМ обрабатывается в onContextMenu; захват указателя подменил бы целевой элемент
    if (e.button === 2) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);

    if (e.button === 1 || st.tool === 'pan' || spaceRef.current) {
      setDrag({ kind: 'pan', sx: e.clientX, sy: e.clientY, px: st.view.panX, py: st.view.panY });
      return;
    }
    if (e.button !== 0) return;

    if (st.placing) {
      const type = st.placing;
      const size = gateSize({ ...createGate(type, 0, 0), inputs: 2 });
      const id = st.addGate(type, w.x - size.w / 2, w.y - size.h / 2);
      void id;
      if (!e.shiftKey) st.setPlacing(null);
      return;
    }

    const pinEl = target.closest('[data-pin]') as SVGElement | null;
    if (pinEl && st.tool !== 'erase') {
      const pin = parsePin(pinEl.getAttribute('data-pin')!);
      if (pin.kind === 'in') {
        // потянули за уже подключённый вход — «переносим» конец провода
        const wire = st.circuit.wires.find((x) => x.to === pin.gateId && x.toPin === pin.idx);
        if (wire) {
          st.commit({ ...st.circuit, wires: st.circuit.wires.filter((x) => x.id !== wire.id) });
          setDrag({ kind: 'wire', from: { gateId: wire.from, side: 'out', pin: 0 }, cur: w });
          return;
        }
        setDrag({ kind: 'wire', from: { gateId: pin.gateId, side: 'in', pin: pin.idx }, cur: w });
      } else setDrag({ kind: 'wire', from: { gateId: pin.gateId, side: 'out', pin: 0 }, cur: w });
      return;
    }

    const sw = target.closest('[data-switch]');
    if (sw && st.tool !== 'erase') {
      st.toggleInput(sw.getAttribute('data-switch')!);
      return;
    }

    const midEl = target.closest('[data-wiremid]');
    if (midEl && st.tool === 'select') {
      st.pushHistory();
      setDrag({ kind: 'wireMid', id: midEl.getAttribute('data-wiremid')!, moved: false });
      return;
    }

    const gateEl = target.closest('[data-gate]');
    if (gateEl) {
      const id = gateEl.getAttribute('data-gate')!;
      if (st.tool === 'erase') {
        st.select([id]);
        st.deleteSelection();
        return;
      }
      if (st.tool === 'wire') return;
      if (e.shiftKey || e.ctrlKey || e.metaKey) st.select([id], true);
      else if (!st.selection.has(id)) st.select([id]);
      const sel = store.getState().selection;
      if (!sel.has(id)) return;
      const orig = new Map<string, Point>();
      for (const g of store.getState().circuit.gates) if (sel.has(g.id)) orig.set(g.id, { x: g.x, y: g.y });
      setDrag({ kind: 'move', start: w, orig, moved: false });
      return;
    }

    const wireEl = target.closest('[data-wire]');
    if (wireEl) {
      const id = wireEl.getAttribute('data-wire')!;
      if (st.tool === 'erase') {
        st.deleteWires([id]);
        return;
      }
      if (e.shiftKey) st.selectWires([...st.wireSelection, id]);
      else st.selectWires([id]);
      return;
    }

    // фон
    if (st.tool === 'erase') return;
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    if (!additive) st.clearSelection();
    setDrag({ kind: 'band', start: w, cur: w, additive, base: new Set(additive ? st.selection : []) });
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const w = toWorld(e.clientX, e.clientY);
    setCursor(w);
    const d = dragRef.current;
    if (!d) return;
    const st = store.getState();
    if (d.kind === 'pan') {
      st.setView({ panX: d.px + (e.clientX - d.sx), panY: d.py + (e.clientY - d.sy) });
    } else if (d.kind === 'move') {
      const dx = snap(w.x - d.start.x);
      const dy = snap(w.y - d.start.y);
      if (!d.moved && (dx !== 0 || dy !== 0)) {
        st.pushHistory();
        setDrag({ ...d, moved: true });
      }
      st.setCircuitSilent({
        ...st.circuit,
        gates: st.circuit.gates.map((g) => {
          const o = d.orig.get(g.id);
          return o ? { ...g, x: o.x + dx, y: o.y + dy } : g;
        }),
      });
    } else if (d.kind === 'band') {
      const next: Drag = { ...d, cur: w };
      setDrag(next);
      const x0 = Math.min(d.start.x, w.x);
      const x1 = Math.max(d.start.x, w.x);
      const y0 = Math.min(d.start.y, w.y);
      const y1 = Math.max(d.start.y, w.y);
      const hit = st.circuit.gates
        .filter((g) => {
          const { w: gw, h: gh } = gateSize(g);
          return g.x < x1 && g.x + gw > x0 && g.y < y1 && g.y + gh > y0;
        })
        .map((g) => g.id);
      const ids = new Set([...d.base, ...hit]);
      useEditor.setState({ selection: ids, wireSelection: new Set() });
    } else if (d.kind === 'wire') {
      setDrag({ ...d, cur: w });
      setHoverPin(findPin(w, d.from));
    } else if (d.kind === 'wireMid') {
      st.setWireMid(d.id, snap(w.x));
      if (!d.moved) setDrag({ ...d, moved: true });
    }
  };

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = dragRef.current;
    const st = store.getState();
    if (d?.kind === 'wire') {
      const w = toWorld(e.clientX, e.clientY);
      const pin = findPin(w, d.from);
      if (pin) {
        if (d.from.side === 'out' && pin.kind === 'in') st.connect(d.from.gateId, pin.gateId, pin.idx);
        else if (d.from.side === 'in' && pin.kind === 'out') st.connect(pin.gateId, d.from.gateId, d.from.pin);
      }
    }
    setDrag(null);
    setHoverPin(null);
    try {
      (e.currentTarget as Element).releasePointerCapture(e.pointerId);
    } catch {
      /* указатель уже отпущен */
    }
  };

  const onWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    const st = store.getState();
    const r = svgRef.current!.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) >= 1) {
      const z = Math.min(3, Math.max(0.2, st.view.zoom * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))));
      const k = z / st.view.zoom;
      st.setView({ zoom: z, panX: mx - (mx - st.view.panX) * k, panY: my - (my - st.view.panY) * k });
    }
  };

  const onContextMenu = (e: React.MouseEvent<SVGSVGElement>) => {
    e.preventDefault();
    const st = store.getState();
    const target = e.target as Element;
    const w = toWorld(e.clientX, e.clientY);
    const gateEl = target.closest('[data-gate]');
    const wireEl = target.closest('[data-wire]');
    if (gateEl) {
      const id = gateEl.getAttribute('data-gate')!;
      if (!st.selection.has(id)) st.select([id]);
      setMenu({ x: e.clientX, y: e.clientY, kind: 'gate', gateId: id, world: w });
    } else if (wireEl) {
      const id = wireEl.getAttribute('data-wire')!;
      st.selectWires([id]);
      setMenu({ x: e.clientX, y: e.clientY, kind: 'wire', wireId: id, world: w });
    } else setMenu({ x: e.clientX, y: e.clientY, kind: 'canvas', world: w });
  };

  // клавиатура
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      const st = store.getState();
      if (st.exportOpen || st.dialog) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (e.code === 'Space') {
        spaceRef.current = true;
        e.preventDefault();
        return;
      }
      if (mod && k === 'z') {
        e.preventDefault();
        if (e.shiftKey) st.redo();
        else st.undo();
      } else if (mod && k === 'y') {
        e.preventDefault();
        st.redo();
      } else if (mod && k === 'c') {
        st.copy();
      } else if (mod && k === 'x') {
        e.preventDefault();
        st.cut();
      } else if (mod && k === 'v') {
        e.preventDefault();
        st.paste();
      } else if (mod && k === 'd') {
        e.preventDefault();
        st.duplicate();
      } else if (mod && k === 'a') {
        e.preventDefault();
        st.selectAll();
      } else if (k === 'delete' || k === 'backspace') {
        e.preventDefault();
        st.deleteSelection();
      } else if (k === 'escape') {
        st.setPlacing(null);
        st.setTool('select');
        st.clearSelection();
        setMenu(null);
      } else if (k.startsWith('arrow') && st.selection.size) {
        e.preventDefault();
        const step = e.shiftKey ? GRID * 4 : GRID;
        st.nudge(k === 'arrowleft' ? -step : k === 'arrowright' ? step : 0, k === 'arrowup' ? -step : k === 'arrowdown' ? step : 0);
      } else if (!mod && k === 'v') st.setTool('select');
      else if (!mod && k === 'h') st.setTool('pan');
      else if (!mod && k === 'w') st.setTool('wire');
      else if (!mod && k === 'x') st.setTool('erase');
      else if (!mod && k === 'f') fit();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceRef.current = false;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [store, fit]);

  // вставка из системного буфера (JSON от другой вкладки)
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
      const text = e.clipboardData?.getData('text');
      if (!text) return;
      try {
        const data = JSON.parse(text);
        if (data?.kind === 'redlogic-clip') {
          useEditor.setState({ clipboard: data, pasteCount: 0 });
          store.getState().paste();
          e.preventDefault();
        }
      } catch {
        /* не наш формат */
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [store]);

  const placingGhost: Gate | null = useMemo(() => {
    if (!placing) return null;
    const g = createGate(placing, 0, 0, nextLabel(circuit, placing));
    return g;
  }, [placing, circuit]);

  const cursorStyle = tool === 'pan' ? (drag?.kind === 'pan' ? 'grabbing' : 'grab') : tool === 'erase' ? 'not-allowed' : placing ? 'copy' : tool === 'wire' ? 'crosshair' : 'default';

  const selectedWireSet = wireSelection;

  return (
    <div className="canvas-wrap" data-tool={tool}>
      <svg
        ref={svgRef}
        className="canvas"
        style={{ cursor: cursorStyle }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        onContextMenu={onContextMenu}
      >
        <defs>
          <pattern id="dots" width={GRID} height={GRID} patternUnits="userSpaceOnUse">
            <circle cx={GRID / 2} cy={GRID / 2} r={0.9} fill="#34363d" />
          </pattern>
          <pattern id="dotsBig" width={GRID * 4} height={GRID * 4} patternUnits="userSpaceOnUse">
            <circle cx={GRID * 2} cy={GRID * 2} r={1.3} fill="#444750" />
          </pattern>
        </defs>
        <g transform={`translate(${view.panX} ${view.panY}) scale(${view.zoom})`}>
          <rect x={-20000} y={-20000} width={40000} height={40000} fill="url(#dots)" pointerEvents="none" />
          <rect x={-20000} y={-20000} width={40000} height={40000} fill="url(#dotsBig)" pointerEvents="none" />

          {/* провода */}
          <g fill="none" strokeLinecap="round" strokeLinejoin="round">
            {circuit.wires.map((w) => {
              const pts = wl.paths.get(w.id);
              if (!pts) return null;
              const val = live ? sim.out.get(w.from) : undefined;
              const sel = selectedWireSet.has(w.id);
              const d = pathToD(pts);
              return (
                <g key={w.id}>
                  <path d={d} stroke={sel ? COLORS.select : val === undefined ? COLORS.line : val ? COLORS.on : COLORS.lineDim} strokeWidth={sel ? 2.6 : 1.8} />
                  <path d={d} stroke="transparent" strokeWidth={10} data-wire={w.id} style={{ cursor: 'pointer' }} />
                  {pts.length >= 4 && (
                    <line
                      x1={pts[1].x}
                      y1={pts[1].y}
                      x2={pts[2].x}
                      y2={pts[2].y}
                      stroke="transparent"
                      strokeWidth={8}
                      data-wiremid={w.id}
                      style={{ cursor: 'ew-resize' }}
                    />
                  )}
                </g>
              );
            })}
            {wl.dots.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={3.4} fill={COLORS.line} stroke="none" />
            ))}
          </g>

          {/* временный провод */}
          {drag?.kind === 'wire' &&
            (() => {
              const g = gm.get(drag.from.gateId);
              if (!g) return null;
              const a = drag.from.side === 'out' ? outputPinPos(g) : inputPinPos(g, drag.from.pin);
              const target = hoverPin ? (hoverPin.kind === 'in' ? inputPinPos(gm.get(hoverPin.gateId)!, hoverPin.idx) : outputPinPos(gm.get(hoverPin.gateId)!)) : drag.cur;
              const pts = drag.from.side === 'out' ? wirePath(a, target) : wirePath(target, a);
              return <path d={pathToD(pts)} fill="none" stroke={COLORS.select} strokeWidth={2} strokeDasharray="5 4" pointerEvents="none" />;
            })()}

          {/* гейты */}
          {circuit.gates.map((g) => {
            const ins = incoming.get(g.id) ?? [];
            const inValues = ins.map((src) => (src && live ? sim.out.get(src) ?? false : src ? undefined : undefined));
            return (
              <g key={g.id} transform={`translate(${g.x} ${g.y})`}>
                <GateShape
                  gate={g}
                  selected={selection.has(g.id)}
                  inValues={live ? inValues : undefined}
                  outValue={live ? sim.out.get(g.id) : undefined}
                  hoverPin={hoverPin && hoverPin.gateId === g.id ? hoverPin : null}
                  showPins={tool === 'wire' || drag?.kind === 'wire'}
                />
              </g>
            );
          })}

          {/* призрак при расстановке */}
          {placingGhost && (
            <g transform={`translate(${snap(cursor.x - gateSize({ ...placingGhost, inputs: placingGhost.inputs }).w / 2)} ${snap(cursor.y - gateSize(placingGhost).h / 2)})`} pointerEvents="none">
              <GateShape gate={placingGhost} ghost />
            </g>
          )}

          {/* рамка выделения */}
          {drag?.kind === 'band' && (
            <rect
              x={Math.min(drag.start.x, drag.cur.x)}
              y={Math.min(drag.start.y, drag.cur.y)}
              width={Math.abs(drag.cur.x - drag.start.x)}
              height={Math.abs(drag.cur.y - drag.start.y)}
              fill="rgba(77,163,255,0.10)"
              stroke="rgba(77,163,255,0.75)"
              strokeDasharray="4 3"
              strokeWidth={1 / view.zoom}
              pointerEvents="none"
            />
          )}
        </g>
      </svg>

      {circuit.gates.length === 0 && !placing && (
        <div className="empty-state">
          <div className="empty-title">Пустая схема</div>
          <div className="empty-text">Выберите гейт на панели слева и кликните по полю — или откройте готовый пример.</div>
          <button className="btn primary" onClick={() => store.getState().loadExample()}>
            Загрузить пример
          </button>
        </div>
      )}

      <div className="hud">
        <span>{Math.round(view.zoom * 100)}%</span>
        <span className="sep" />
        <span>{circuit.gates.length} гейт.</span>
        <span>{circuit.wires.length} пров.</span>
        {!sim.stable && live && <span className="warn">нестабильна</span>}
      </div>

      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} fit={fit} />}
    </div>
  );
}
