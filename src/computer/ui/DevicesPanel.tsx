import { useEffect, useRef, useState } from 'react';
import { Machine } from '../sim';
import { DEVICE_INFO } from '../spec';
import { AnyDevice, ButtonsDevice, KeyboardDevice, LedsDevice, PixelDevice, RandomDevice, SevenSegDevice, SoundDevice, SwitchesDevice, TerminalDevice, TextDevice, TimerDevice } from '../devices';
import { hexOf } from './common';

interface Props {
  machine: Machine;
  rev: number;
  poke: () => void;
}

export function DevicesPanel({ machine, rev, poke }: Props) {
  return (
    <div className="dev-panel">
      {machine.devices.length === 0 && <p className="hint">У этого компьютера нет устройств — добавьте их на шаге «Характеристики».</p>}
      {machine.devices.map((d) => (
        <div key={d.id} className="dev-card">
          <header>
            <span>{DEVICE_INFO[d.type].icon}</span>
            <b>{DEVICE_INFO[d.type].name}</b>
            <code>{d.id}</code>
          </header>
          <DeviceView dev={d} machine={machine} rev={rev} poke={poke} />
        </div>
      ))}
    </div>
  );
}

function DeviceView({ dev, machine, rev, poke }: { dev: AnyDevice; machine: Machine; rev: number; poke: () => void }) {
  switch (dev.type) {
    case 'leds':
      return <Leds dev={dev} />;
    case 'switches':
      return <Switches dev={dev} poke={poke} />;
    case 'buttons':
      return <Buttons dev={dev} poke={poke} />;
    case 'sevenseg':
      return <SevenSeg dev={dev} />;
    case 'text':
      return <Text dev={dev} />;
    case 'pixel':
      return <Pixels dev={dev} rev={rev} />;
    case 'keyboard':
      return <Keyboard dev={dev} poke={poke} />;
    case 'timer':
      return <TimerView dev={dev} machine={machine} />;
    case 'random':
      return <RandomView dev={dev} />;
    case 'sound':
      return <Sound dev={dev} />;
    case 'terminal':
      return <Terminal dev={dev} />;
  }
}

function Leds({ dev }: { dev: LedsDevice }) {
  return (
    <div className="dev-leds" aria-label="Светодиоды">
      {Array.from({ length: dev.count }, (_, i) => {
        const on = (dev.value >> i) & 1;
        return <i key={i} className={`led ${on ? 'on' : ''}`} title={`бит ${i}: ${on}`} />;
      }).reverse()}
      <span className="mono dim">{dev.value} · 0x{hexOf(dev.value, Math.ceil(dev.count / 4))}</span>
    </div>
  );
}

function Switches({ dev, poke }: { dev: SwitchesDevice; poke: () => void }) {
  return (
    <div className="dev-sw">
      {Array.from({ length: dev.count }, (_, i) => {
        const on = (dev.value >> i) & 1;
        return (
          <button key={i} className={`dev-switch ${on ? 'on' : ''}`} aria-pressed={!!on} aria-label={`Рычаг ${i}`} title={`бит ${i}`} onClick={() => { dev.set(i, !on); poke(); }}>
            <i />
          </button>
        );
      }).reverse()}
      <span className="mono dim">{dev.value}</span>
    </div>
  );
}

function Buttons({ dev, poke }: { dev: ButtonsDevice; poke: () => void }) {
  return (
    <div className="dev-btns">
      {Array.from({ length: dev.count }, (_, i) => {
        const on = (dev.value >> i) & 1;
        const set = (v: boolean) => { dev.set(i, v); poke(); };
        return (
          <button
            key={i}
            className={`dev-button ${on ? 'on' : ''}`}
            aria-label={`Кнопка ${i}`}
            onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); set(true); }}
            onPointerUp={() => set(false)}
            onPointerCancel={() => set(false)}
            onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && set(true)}
            onKeyUp={(e) => (e.key === ' ' || e.key === 'Enter') && set(false)}
          >
            {i}
          </button>
        );
      })}
    </div>
  );
}

// сегменты: a(верх) b(прав-верх) c(прав-низ) d(низ) e(лев-низ) f(лев-верх) g(середина)
const HEX_SEGS = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f, 0x77, 0x7c, 0x39, 0x5e, 0x79, 0x71];
const SEG_PATHS = [
  'M4 2h14l-2 3H6z',
  'M19 3l1 1v12l-2 2-1-3V6z',
  'M19 22l1 1v12l-3 3-1-3V25z',
  'M4 40h14l-2-3H6z',
  'M3 22l-1 1v12l3 3 1-3V25z',
  'M3 3L2 4v12l3 2 1-3V6z',
  'M5 20.5l2-2h10l2 2-2 2H7z',
];

function SevenSeg({ dev }: { dev: SevenSegDevice }) {
  const digits = dev.digits;
  const out = [];
  for (let k = digits - 1; k >= 0; k--) {
    const nib = Math.floor(dev.value / 16 ** k) & 15;
    const m = HEX_SEGS[nib];
    out.push(
      <svg key={k} viewBox="0 0 22 42" className="seg7" aria-label={`цифра ${nib.toString(16)}`}>
        {SEG_PATHS.map((d, i) => <path key={i} d={d} className={(m >> i) & 1 ? 'on' : ''} />)}
      </svg>,
    );
  }
  return (
    <div className="dev-seg">
      {out}
      <span className="mono dim">{dev.value}</span>
    </div>
  );
}

function Text({ dev }: { dev: TextDevice }) {
  return (
    <div className="dev-text mono" style={{ gridTemplateColumns: `repeat(${dev.cols}, 1ch)` }} aria-label="Текстовый экран">
      {dev.cells.map((c, i) => (
        <span key={i} className={i === dev.cursor ? 'cur' : ''}>{c >= 32 && c < 127 ? String.fromCharCode(c) : ' '}</span>
      ))}
    </div>
  );
}

function Pixels({ dev, rev }: { dev: PixelDevice; rev: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const scale = Math.max(4, Math.min(22, Math.floor(200 / Math.max(dev.width, dev.height))));
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#10110f';
    ctx.fillRect(0, 0, c.width, c.height);
    for (let y = 0; y < dev.height; y++) for (let x = 0; x < dev.width; x++) {
      ctx.fillStyle = dev.pixels[y * dev.width + x] ? '#ff5a48' : '#241413';
      ctx.fillRect(x * scale + 1, y * scale + 1, scale - 1, scale - 1);
    }
  }, [rev, dev, scale]);
  return <canvas ref={ref} className="dev-pixels" width={dev.width * scale} height={dev.height * scale} aria-label="Пиксельный экран" />;
}

function Keyboard({ dev, poke }: { dev: KeyboardDevice; poke: () => void }) {
  const [shown, setShown] = useState('');
  return (
    <div className="dev-kbd">
      <input
        placeholder="Нажимайте клавиши здесь"
        value=""
        readOnly
        aria-label="Клавиатура"
        onKeyDown={(e) => {
          let code = 0;
          if (e.key.length === 1) code = e.key.charCodeAt(0);
          else if (e.key === 'Enter') code = 10;
          else if (e.key === 'Backspace') code = 8;
          else if (e.key === 'Escape') code = 27;
          else return;
          e.preventDefault();
          dev.press(code);
          setShown(`${e.key.length === 1 ? e.key : e.key} → ${code}`);
          poke();
        }}
      />
      <span className="mono dim">очередь: {dev.queue.length}{shown ? ` · ${shown}` : ''}</span>
    </div>
  );
}

function TimerView({ dev }: { dev: TimerDevice; machine: Machine }) {
  return <div className="mono">счётчик: <b>{dev.value}</b> <span className="dim">(+1 каждые {dev.period} тактов)</span></div>;
}

function RandomView({ dev }: { dev: RandomDevice }) {
  return <div className="dim" data-id={dev.id}>Каждое чтение порта даёт новое случайное число.</div>;
}

function Sound({ dev }: { dev: SoundDevice }) {
  const [on, setOn] = useState(false);
  const ctx = useRef<AudioContext | null>(null);
  const osc = useRef<OscillatorNode | null>(null);
  useEffect(() => {
    if (!on) return;
    try {
      if (!ctx.current) ctx.current = new AudioContext();
      osc.current?.stop();
      osc.current = null;
      if (dev.note > 0) {
        const o = ctx.current.createOscillator();
        const g = ctx.current.createGain();
        o.type = 'triangle';
        o.frequency.value = 185 * 2 ** ((dev.note - 1) / 12);
        g.gain.value = 0.06;
        o.connect(g).connect(ctx.current.destination);
        o.start();
        osc.current = o;
      }
    } catch {
      /* звук недоступен */
    }
    return () => {
      try { osc.current?.stop(); } catch { /* ignore */ }
      osc.current = null;
    };
  }, [dev.note, on, dev]);
  return (
    <div className="dev-sound">
      <span className="mono">нота: <b>{dev.note || '—'}</b></span>
      <label className="check small"><input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} /> проигрывать звук</label>
    </div>
  );
}

function Terminal({ dev }: { dev: TerminalDevice }) {
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  });
  return <pre ref={ref} className="dev-term mono" aria-label="Терминал">{dev.text || ' '}</pre>;
}
