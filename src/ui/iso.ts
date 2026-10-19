import { Structure, StructBlock } from '../compiler/compile';
import { K } from '../compiler/voxel';

export interface PreviewColors {
  wire: string;
  gate: string;
}

function shade(hex: string, f: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = Math.max(0, Math.min(255, Math.round(((n >> 16) & 255) * f)));
  const g = Math.max(0, Math.min(255, Math.round(((n >> 8) & 255) * f)));
  const b = Math.max(0, Math.min(255, Math.round((n & 255) * f)));
  return `rgb(${r},${g},${b})`;
}

const FACING_VEC: Record<string, [number, number]> = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };

function blockColor(b: StructBlock, colors: PreviewColors, solidIsGate: boolean): string {
  switch (b.kind) {
    case K.Solid:
      return solidIsGate ? colors.gate : colors.wire;
    case K.Lamp:
      return b.spec.props?.lit === 'true' ? '#f6d66b' : '#8a7a43';
    default:
      return '#888';
  }
}

/** Изометрическая отрисовка структуры (по слоям до maxY включительно). */
export function drawIso(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  s: Structure,
  opts: { maxY: number; colors: PreviewColors; gateName: string; showLabels: boolean },
): void {
  ctx.clearRect(0, 0, width, height);
  const blocks = s.blocks.filter((b) => b.y <= opts.maxY);
  // масштаб: вписываем в холст
  const spanX = (s.sx + s.sz) * 1; // в единицах s
  const spanY = (s.sx + s.sz) * 0.5 + (s.sy + 1) * 0.9;
  const unit = Math.max(3, Math.min(34, Math.min((width - 40) / spanX, (height - 40) / spanY)));
  const hh = unit * 0.92;
  const ox = width / 2 + ((s.sz - s.sx) * unit) / 2;
  const oy = (height - spanY * unit) / 2 + s.sy * hh + 8;
  const proj = (x: number, y: number, z: number): [number, number] => [ox + (x - z) * unit, oy + ((x + z) * unit) / 2 - y * hh];

  const order = [...blocks].sort((a, b) => a.x + a.y + a.z - (b.x + b.y + b.z) || a.y - b.y);
  const poly = (pts: [number, number][], fill: string, stroke?: string): void => {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }
  };
  const cube = (x: number, y: number, z: number, color: string, h = 1, inset = 0): void => {
    const [px, py] = proj(x, y + h, z);
    const i = inset * unit;
    const A: [number, number] = [px, py + i / 2];
    const B: [number, number] = [px + unit - i, py + unit / 2];
    const C: [number, number] = [px, py + unit - i / 2];
    const D: [number, number] = [px - unit + i, py + unit / 2];
    const dh = h * hh;
    poly([A, B, C, D], shade(color, 1.18), 'rgba(0,0,0,0.35)');
    poly([D, C, [C[0], C[1] + dh], [D[0], D[1] + dh]], shade(color, 0.82), 'rgba(0,0,0,0.35)');
    poly([C, B, [B[0], B[1] + dh], [C[0], C[1] + dh]], shade(color, 0.62), 'rgba(0,0,0,0.35)');
  };
  const flat = (x: number, y: number, z: number, color: string, lift = 0.06, inset = 0.12): void => {
    const [px, py] = proj(x, y + lift, z);
    const i = inset * unit;
    // нижняя плоскость клетки: диагональ ромба сдвинута вниз на всю высоту блока
    const top = py + hh;
    poly(
      [
        [px, top + i / 2],
        [px + unit - i, top + unit / 2],
        [px, top + unit - i / 2],
        [px - unit + i, top + unit / 2],
      ],
      color,
      'rgba(0,0,0,0.4)',
    );
  };

  for (const b of order) {
    const { x, y, z } = b;
    switch (b.kind) {
      case K.Solid:
        cube(x, y, z, blockColor(b, opts.colors, b.spec.name === opts.gateName));
        break;
      case K.Lamp:
        cube(x, y, z, blockColor(b, opts.colors, false));
        break;
      case K.Dust: {
        const p = Number(b.spec.props?.power ?? 0);
        flat(x, y, z, p > 0 ? shade('#ff5a48', 0.55 + p * 0.03) : '#7a1f1a');
        break;
      }
      case K.Repeater: {
        const [vx, vz] = FACING_VEC[b.spec.props!.facing];
        cube(x, y, z, '#a9a9a9', 0.22, 0.08);
        // стрелка направления сигнала (противоположна facing)
        const [px, py] = proj(x, y + 0.22, z);
        const fx = -vx;
        const fz = -vz;
        const c: [number, number] = [px, py + hh * 0.0 + unit * 0.5];
        const tip: [number, number] = [c[0] + (fx - fz) * unit * 0.45, c[1] + ((fx + fz) * unit * 0.45) / 2];
        const back: [number, number] = [c[0] - (fx - fz) * unit * 0.3, c[1] - ((fx + fz) * unit * 0.3) / 2];
        ctx.strokeStyle = b.spec.props?.powered === 'true' ? '#ff6a58' : '#7a1f1a';
        ctx.lineWidth = Math.max(1, unit * 0.12);
        ctx.beginPath();
        ctx.moveTo(back[0], back[1]);
        ctx.lineTo(tip[0], tip[1]);
        ctx.stroke();
        break;
      }
      case K.Torch: {
        const lit = b.spec.props?.lit === 'true';
        const [vx, vz] = FACING_VEC[b.spec.props!.facing];
        // факел стоит у края клетки, дальнего от блока крепления
        const [px, py] = proj(x, y, z);
        const cx = px + (vx - vz) * unit * 0.18;
        const cy = py + unit * 0.5 + ((vx + vz) * unit * 0.18) / 2;
        ctx.strokeStyle = '#6b4a24';
        ctx.lineWidth = Math.max(2, unit * 0.2);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(cx, cy + hh * 0.95);
        ctx.lineTo(cx, cy + hh * 0.3);
        ctx.stroke();
        ctx.lineCap = 'butt';
        if (lit) {
          ctx.fillStyle = 'rgba(255,106,77,0.28)';
          ctx.beginPath();
          ctx.arc(cx, cy + hh * 0.25, Math.max(3, unit * 0.55), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = lit ? '#ff5a3c' : '#5a2a22';
        ctx.beginPath();
        ctx.arc(cx, cy + hh * 0.25, Math.max(2, unit * 0.26), 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case K.Barrel:
        cube(x, y, z, '#8a6a3c');
        cube(x, y + 1, z, '#5b4426', 0.02, 0.28);
        break;
      case K.Comparator: {
        cube(x, y, z, '#a3a3a3', 0.22, 0.06);
        const [px, py] = proj(x, y + 0.22, z);
        ctx.fillStyle = b.spec.props?.powered === 'true' ? '#ff5a48' : '#7a1f1a';
        ctx.beginPath();
        ctx.arc(px, py + unit * 0.5, Math.max(1.5, unit * 0.16), 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case K.Lever:
      case K.Button: {
        cube(x, y, z, '#777', 0.18, 0.2);
        const [px, py] = proj(x, y + 0.18, z);
        ctx.strokeStyle = b.kind === K.Lever ? '#c9a46a' : '#555';
        ctx.lineWidth = Math.max(1.5, unit * 0.18);
        ctx.beginPath();
        ctx.moveTo(px, py + unit * 0.5 + hh * 0.2);
        ctx.lineTo(px + unit * 0.2, py + unit * 0.5 - hh * 0.35);
        ctx.stroke();
        break;
      }
    }
  }

  if (opts.showLabels) {
    ctx.font = `600 ${Math.max(10, Math.min(15, unit * 0.9))}px ui-monospace, monospace`;
    ctx.textAlign = 'center';
    for (const m of s.markers) {
      if (!m.text || m.y > opts.maxY) continue;
      const [px, py] = proj(m.x, m.y + 1, m.z);
      const ty = py - hh * 0.9;
      ctx.fillStyle = m.kind === 'in' ? '#7fd1ff' : '#ffd479';
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.lineWidth = 3;
      ctx.strokeText(m.text, px, ty);
      ctx.fillText(m.text, px, ty);
    }
  }
}

/** Вид сверху (план) выбранного слоя. layer = null — верхние блоки всех слоёв. */
export function drawPlan(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  s: Structure,
  opts: { layer: number | null; colors: PreviewColors; gateName: string; showLabels: boolean },
): void {
  ctx.clearRect(0, 0, width, height);
  const cell = Math.max(3, Math.min(28, Math.min((width - 24) / s.sx, (height - 24) / s.sz)));
  const ox = (width - cell * s.sx) / 2;
  const oy = (height - cell * s.sz) / 2;
  const grid = new Map<string, StructBlock>();
  const below = new Map<string, StructBlock>();
  for (const b of s.blocks) {
    const key = `${b.x},${b.z}`;
    if (opts.layer === null) {
      const cur = grid.get(key);
      if (!cur || b.y >= cur.y) grid.set(key, b);
    } else if (b.y === opts.layer) grid.set(key, b);
    else if (b.y < opts.layer) {
      const cur = below.get(key);
      if (!cur || b.y >= cur.y) below.set(key, b);
    }
  }
  const draw = (b: StructBlock, dim: boolean): void => {
    const x = ox + b.x * cell;
    const y = oy + b.z * cell;
    ctx.globalAlpha = dim ? 0.28 : 1;
    switch (b.kind) {
      case K.Solid:
        ctx.fillStyle = b.spec.name === opts.gateName ? opts.colors.gate : opts.colors.wire;
        ctx.fillRect(x, y, cell, cell);
        break;
      case K.Lamp:
        ctx.fillStyle = b.spec.props?.lit === 'true' ? '#f6d66b' : '#8a7a43';
        ctx.fillRect(x, y, cell, cell);
        break;
      case K.Dust: {
        const p = Number(b.spec.props?.power ?? 0);
        ctx.fillStyle = p > 0 ? '#ff5a48' : '#9b2a22';
        ctx.fillRect(x + cell * 0.12, y + cell * 0.12, cell * 0.76, cell * 0.76);
        break;
      }
      case K.Torch:
        ctx.fillStyle = '#2b1b10';
        ctx.fillRect(x, y, cell, cell);
        ctx.fillStyle = b.spec.props?.lit === 'true' ? '#ffb36b' : '#6a3a2a';
        ctx.beginPath();
        ctx.arc(x + cell / 2, y + cell / 2, cell * 0.28, 0, Math.PI * 2);
        ctx.fill();
        break;
      case K.Repeater: {
        ctx.fillStyle = '#9a9a9a';
        ctx.fillRect(x + 1, y + 1, cell - 2, cell - 2);
        const vec = FACING_VEC[b.spec.props!.facing];
        const cx = x + cell / 2;
        const cy = y + cell / 2;
        ctx.strokeStyle = '#7a1f1a';
        ctx.lineWidth = Math.max(1, cell * 0.14);
        ctx.beginPath();
        ctx.moveTo(cx + vec[0] * cell * 0.3, cy + vec[1] * cell * 0.3);
        ctx.lineTo(cx - vec[0] * cell * 0.3, cy - vec[1] * cell * 0.3);
        ctx.stroke();
        ctx.fillStyle = '#7a1f1a';
        ctx.beginPath();
        ctx.arc(cx - vec[0] * cell * 0.3, cy - vec[1] * cell * 0.3, cell * 0.14, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case K.Barrel:
        ctx.fillStyle = '#8a6a3c';
        ctx.fillRect(x, y, cell, cell);
        ctx.fillStyle = '#5b4426';
        ctx.fillRect(x + cell * 0.2, y + cell * 0.2, cell * 0.6, cell * 0.6);
        break;
      case K.Comparator:
        ctx.fillStyle = '#a3a3a3';
        ctx.fillRect(x + 1, y + 1, cell - 2, cell - 2);
        ctx.fillStyle = b.spec.props?.powered === 'true' ? '#ff5a48' : '#7a1f1a';
        ctx.fillRect(x + cell * 0.35, y + cell * 0.35, cell * 0.3, cell * 0.3);
        break;
      case K.Lever:
      case K.Button:
        ctx.fillStyle = '#6b6b6b';
        ctx.fillRect(x, y, cell, cell);
        ctx.fillStyle = b.kind === K.Lever ? '#d9b36f' : '#444';
        ctx.fillRect(x + cell * 0.38, y + cell * 0.2, cell * 0.24, cell * 0.6);
        break;
    }
    ctx.globalAlpha = 1;
  };
  for (const b of below.values()) draw(b, true);
  for (const b of grid.values()) draw(b, false);
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  if (cell >= 8) {
    ctx.beginPath();
    for (let i = 0; i <= s.sx; i++) {
      ctx.moveTo(ox + i * cell + 0.5, oy);
      ctx.lineTo(ox + i * cell + 0.5, oy + s.sz * cell);
    }
    for (let j = 0; j <= s.sz; j++) {
      ctx.moveTo(ox, oy + j * cell + 0.5);
      ctx.lineTo(ox + s.sx * cell, oy + j * cell + 0.5);
    }
    ctx.stroke();
  }
  if (opts.showLabels) {
    ctx.font = `700 ${Math.max(10, Math.min(15, cell * 0.8))}px ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const m of s.markers) {
      if (!m.text || (opts.layer !== null && m.y !== opts.layer)) continue;
      const cx = ox + m.x * cell + cell / 2;
      const cy = oy + m.z * cell - cell * 0.55;
      ctx.fillStyle = m.kind === 'in' ? '#7fd1ff' : '#ffd479';
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.lineWidth = 3;
      ctx.strokeText(m.text, cx, cy);
      ctx.fillText(m.text, cx, cy);
    }
  }
}
