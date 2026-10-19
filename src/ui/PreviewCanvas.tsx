import { useEffect, useRef, useState } from 'react';
import { Structure } from '../compiler/compile';
import { drawIso, drawPlan, PreviewColors } from './iso';

interface Props {
  structure: Structure;
  mode: 'iso' | 'plan';
  /** iso: показывать слои ≤ layer; plan: показывать только этот слой (null — все). */
  layer: number | null;
  colors: PreviewColors;
  gateName: string;
  showLabels: boolean;
}

interface View {
  k: number;
  x: number;
  y: number;
}

export function PreviewCanvas({ structure, mode, layer, colors, gateName, showLabels }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ k: 1, x: 0, y: 0 });
  const dragRef = useRef<{ sx: number; sy: number; vx: number; vy: number } | null>(null);

  useEffect(() => setView({ k: 1, x: 0, y: 0 }), [structure, mode]);

  useEffect(() => {
    const canvas = ref.current;
    const box = wrap.current;
    if (!canvas || !box) return;
    const render = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = box.clientWidth;
      const h = box.clientHeight;
      if (w === 0 || h === 0) return;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext('2d')!;
      ctx.setTransform(dpr * view.k, 0, 0, dpr * view.k, dpr * view.x, dpr * view.y);
      if (mode === 'iso') drawIso(ctx, w, h, structure, { maxY: layer ?? structure.sy, colors, gateName, showLabels });
      else drawPlan(ctx, w, h, structure, { layer, colors, gateName, showLabels });
    };
    render();
    const ro = new ResizeObserver(render);
    ro.observe(box);
    return () => ro.disconnect();
  }, [structure, mode, layer, colors, gateName, showLabels, view]);

  const onWheel = (e: React.WheelEvent) => {
    const r = wrap.current!.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    setView((v) => {
      const k = Math.min(12, Math.max(0.5, v.k * Math.exp(-e.deltaY * 0.0015)));
      const f = k / v.k;
      return { k, x: mx - (mx - v.x) * f, y: my - (my - v.y) * f };
    });
  };

  return (
    <div
      ref={wrap}
      className="preview-canvas"
      onWheel={onWheel}
      onPointerDown={(e) => {
        dragRef.current = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = dragRef.current;
        if (d) setView((v) => ({ ...v, x: d.vx + e.clientX - d.sx, y: d.vy + e.clientY - d.sy }));
      }}
      onPointerUp={() => (dragRef.current = null)}
      onDoubleClick={() => setView({ k: 1, x: 0, y: 0 })}
      title="Колесо — масштаб, перетаскивание — сдвиг, двойной клик — сбросить"
    >
      <canvas ref={ref} />
    </div>
  );
}
