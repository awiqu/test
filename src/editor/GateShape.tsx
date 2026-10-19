import { memo } from 'react';
import { Gate, GateType } from '../model/types';
import { gateSize, inputPinPos, outputPinPos } from '../model/circuit';

export const COLORS = {
  line: '#c5cad3',
  lineDim: '#7d838f',
  body: '#202226',
  on: '#ff5448',
  onGlow: '#ff8a7a',
  off: '#6b7180',
  select: '#4da3ff',
  text: '#d7dae0',
  muted: '#8b909a',
};

const BUBBLE_R = 4.5;

function bodyPath(type: GateType, h: number): { d: string; extra?: string; bubble: boolean } {
  const t = 3;
  const b = h - 3;
  const mid = h / 2;
  const ry = (b - t) / 2;
  switch (type) {
    case 'AND':
    case 'NAND':
      return { d: `M15,${t} H32 A28,${ry} 0 0 1 32,${b} H15 Z`, bubble: type === 'NAND' };
    case 'OR':
    case 'NOR':
    case 'XOR':
    case 'XNOR': {
      const d = `M15,${t} C34,${t} 52,${mid - 10} 60,${mid} C52,${mid + 10} 34,${b} 15,${b} Q31,${mid} 15,${t} Z`;
      const xor = type === 'XOR' || type === 'XNOR';
      return {
        d,
        extra: xor ? `M8,${t} Q24,${mid} 8,${b}` : undefined,
        bubble: type === 'NOR' || type === 'XNOR',
      };
    }
    default:
      return { d: '', bubble: false };
  }
}

interface Props {
  gate: Gate;
  selected?: boolean;
  /** Значения входов и выхода для подсветки (если включена симуляция). */
  inValues?: (boolean | undefined)[];
  outValue?: boolean;
  /** Подсвеченные пины (во время протягивания провода). */
  hoverPin?: { kind: 'in' | 'out'; idx: number } | null;
  showPins?: boolean;
  ghost?: boolean;
  /** Иконка: без интерактивных зон. */
  icon?: boolean;
}

function stroke(v: boolean | undefined): string {
  if (v === undefined) return COLORS.line;
  return v ? COLORS.on : COLORS.lineDim;
}

function GateShapeImpl({ gate, selected, inValues, outValue, hoverPin, showPins, ghost, icon }: Props) {
  const { w, h } = gateSize(gate);
  const mid = h / 2;
  const lineColor = selected ? COLORS.select : COLORS.line;
  const sw = 1.8;
  const n = gate.type === 'INPUT' ? 0 : gate.inputs;
  const pins: { kind: 'in' | 'out'; idx: number; x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const p = inputPinPos(gate, i);
    pins.push({ kind: 'in', idx: i, x: p.x - gate.x, y: p.y - gate.y });
  }
  if (gate.type !== 'OUTPUT') {
    const p = outputPinPos(gate);
    pins.push({ kind: 'out', idx: 0, x: p.x - gate.x, y: p.y - gate.y });
  }

  const leads: JSX.Element[] = [];
  const lead = (key: string, x1: number, y1: number, x2: number, y2: number, v: boolean | undefined) => (
    <line key={key} x1={x1} y1={y1} x2={x2} y2={y2} stroke={selected ? COLORS.select : stroke(v)} strokeWidth={sw} strokeLinecap="round" />
  );

  let body: JSX.Element | null = null;
  const t = gate.type;
  if (t === 'AND' || t === 'NAND' || t === 'OR' || t === 'NOR' || t === 'XOR' || t === 'XNOR') {
    const bp = bodyPath(t, h);
    for (let i = 0; i < n; i++) {
      const p = inputPinPos(gate, i);
      leads.push(lead(`i${i}`, 0, p.y - gate.y, 18, p.y - gate.y, inValues?.[i]));
    }
    const outStart = bp.bubble ? 60 + BUBBLE_R * 2 : 60;
    leads.push(lead('o', outStart, mid, w, mid, outValue));
    body = (
      <>
        <path d={bp.d} fill={COLORS.body} stroke={lineColor} strokeWidth={sw} strokeLinejoin="round" />
        {bp.extra && <path d={bp.extra} fill="none" stroke={lineColor} strokeWidth={sw} strokeLinecap="round" />}
        {bp.bubble && <circle cx={60 + BUBBLE_R} cy={mid} r={BUBBLE_R} fill={COLORS.body} stroke={lineColor} strokeWidth={sw} />}
      </>
    );
  } else if (t === 'NOT' || t === 'BUFFER') {
    const bubble = t === 'NOT';
    leads.push(lead('i0', 0, mid, 10, mid, inValues?.[0]));
    leads.push(lead('o', bubble ? 55 : 52, mid, w, mid, outValue));
    body = (
      <>
        <path d={`M10,5 L10,${h - 5} L${bubble ? 46 : 52},${mid} Z`} fill={COLORS.body} stroke={lineColor} strokeWidth={sw} strokeLinejoin="round" />
        {bubble && <circle cx={50.5} cy={mid} r={BUBBLE_R} fill={COLORS.body} stroke={lineColor} strokeWidth={sw} />}
        {t === 'BUFFER' && (
          <text x={19} y={mid + 3.5} fontSize={9} fill={COLORS.muted} fontFamily="ui-monospace, monospace">
            {gate.delay}t
          </text>
        )}
      </>
    );
  } else if (t === 'INPUT') {
    const on = gate.value;
    leads.push(lead('o', 48, mid, w, mid, outValue ?? on));
    body = (
      <>
        <rect x={1} y={3} width={47} height={h - 6} rx={5} fill={COLORS.body} stroke={lineColor} strokeWidth={sw} />
        <text x={10} y={mid + 4} fontSize={12} fill={COLORS.text} fontFamily="ui-monospace, monospace" fontWeight={600}>
          {gate.label.slice(0, 3)}
        </text>
        <g>
          <rect x={27} y={mid - 6.5} width={17} height={13} rx={6.5} fill={on ? COLORS.on : '#3a3d45'} />
          <circle cx={on ? 37.5 : 33.5} cy={mid} r={4.6} fill="#f2f3f5" />
        </g>
      </>
    );
  } else if (t === 'OUTPUT') {
    const on = outValue ?? inValues?.[0];
    leads.push(lead('i0', 0, mid, 12, mid, inValues?.[0]));
    body = (
      <>
        {on && <circle cx={23} cy={mid} r={15} fill={COLORS.onGlow} opacity={0.18} />}
        <circle cx={23} cy={mid} r={11} fill={on ? '#ffb347' : '#2b2c31'} stroke={lineColor} strokeWidth={sw} />
        <path d={`M17.5,${mid - 5} L28.5,${mid + 5} M28.5,${mid - 5} L17.5,${mid + 5}`} stroke={on ? '#7a4a00' : '#4a4d55'} strokeWidth={1.4} strokeLinecap="round" />
        <text x={38} y={mid + 4} fontSize={12} fill={COLORS.text} fontFamily="ui-monospace, monospace" fontWeight={600}>
          {gate.label.slice(0, 4)}
        </text>
      </>
    );
  }

  return (
    <g opacity={ghost ? 0.55 : 1}>
      {/* невидимая область для захвата */}
      {!icon && <rect data-gate={gate.id} x={0} y={0} width={w} height={h} fill="transparent" />}
      {leads}
      <g pointerEvents="none">{body}</g>
      {!icon && gate.type === 'INPUT' && (
        <g data-switch={gate.id} style={{ cursor: 'pointer' }}>
          <rect data-switch={gate.id} x={27} y={mid - 8} width={17} height={16} fill="transparent" />
        </g>
      )}
      {(showPins || selected) &&
        pins.map((p) => (
          <circle key={`${p.kind}${p.idx}`} cx={p.x} cy={p.y} r={2.6} fill={hoverPin && hoverPin.kind === p.kind && hoverPin.idx === p.idx ? COLORS.select : '#9aa1ad'} pointerEvents="none" />
        ))}
      {!icon && pins.map((p) => (
        <circle
          key={`hit${p.kind}${p.idx}`}
          data-pin={`${p.kind}:${gate.id}:${p.idx}`}
          cx={p.x}
          cy={p.y}
          r={hoverPin && hoverPin.kind === p.kind && hoverPin.idx === p.idx ? 7 : 6}
          fill={hoverPin && hoverPin.kind === p.kind && hoverPin.idx === p.idx ? 'rgba(77,163,255,0.35)' : 'transparent'}
          style={{ cursor: 'crosshair' }}
        />
      ))}
      {gate.label && gate.type !== 'INPUT' && gate.type !== 'OUTPUT' && (
        <text x={w / 2} y={h + 12} fontSize={10} textAnchor="middle" fill={COLORS.muted} fontFamily="ui-monospace, monospace" pointerEvents="none">
          {gate.label}
        </text>
      )}
    </g>
  );
}

export const GateShape = memo(GateShapeImpl);

/** Иконка гейта для панели инструментов. */
export function GateIcon({ type, size = 34 }: { type: GateType; size?: number }) {
  const g: Gate = { id: 'icon', type, x: 0, y: 0, inputs: type === 'NOT' || type === 'BUFFER' || type === 'OUTPUT' ? 1 : 2, label: type === 'INPUT' ? 'x' : type === 'OUTPUT' ? 'w' : '', value: false, delay: 1 };
  const { w, h } = gateSize(g);
  return (
    <svg width={size} height={(size * h) / w} viewBox={`-2 -2 ${w + 4} ${h + 4}`} style={{ display: 'block' }}>
      <GateShape gate={g} icon />
    </svg>
  );
}
