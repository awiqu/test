import { ComputerSpec, DeviceSpec } from './types';

export interface Device {
  id: string;
  type: DeviceSpec['type'];
  /** Чтение порта (offset — номер порта внутри устройства). Может иметь побочный эффект. */
  read(offset: number): number;
  /** Чтение без побочных эффектов (для отладчика). */
  peek(offset: number): number;
  write(offset: number, value: number): void;
  /** Вызывается после каждой инструкции с числом потраченных тактов. */
  tick(cycles: number): void;
  reset(): void;
}

class LedsDevice implements Device {
  type = 'leds' as const;
  value = 0;
  constructor(
    readonly id: string,
    readonly count: number,
    private mask: number,
  ) {}
  read(): number {
    return this.value;
  }
  peek(): number {
    return this.value;
  }
  write(_o: number, v: number): void {
    this.value = v & this.mask;
  }
  tick(): void {}
  reset(): void {
    this.value = 0;
  }
}

abstract class InputDevice implements Device {
  value = 0;
  abstract readonly type: 'switches' | 'buttons';
  constructor(
    readonly id: string,
    readonly count: number,
    private mask: number,
  ) {}
  read(): number {
    return this.value & this.mask;
  }
  peek(): number {
    return this.value & this.mask;
  }
  write(): void {}
  tick(): void {}
  reset(): void {
    // положение рычагов — внешнее состояние, не сбрасывается
  }
  set(bit: number, on: boolean): void {
    this.value = on ? this.value | (1 << bit) : this.value & ~(1 << bit);
  }
}

class SwitchesDevice extends InputDevice {
  readonly type = 'switches' as const;
}

class ButtonsDevice extends InputDevice {
  readonly type = 'buttons' as const;
}

class SevenSegDevice implements Device {
  type = 'sevenseg' as const;
  value = 0;
  constructor(
    readonly id: string,
    readonly digits: number,
    private mask: number,
  ) {}
  read(): number {
    return this.value;
  }
  peek(): number {
    return this.value;
  }
  write(_o: number, v: number): void {
    this.value = v & this.mask;
  }
  tick(): void {}
  reset(): void {
    this.value = 0;
  }
}

class TextDevice implements Device {
  type = 'text' as const;
  cells: number[];
  cursor = 0;
  constructor(
    readonly id: string,
    readonly cols: number,
    readonly rows: number,
  ) {
    this.cells = new Array(cols * rows).fill(0);
  }
  read(o: number): number {
    return o === 1 ? this.cursor : 0;
  }
  peek(o: number): number {
    return this.read(o);
  }
  private scroll(): void {
    this.cells.splice(0, this.cols);
    for (let i = 0; i < this.cols; i++) this.cells.push(0);
  }
  write(o: number, v: number): void {
    if (o === 1) {
      this.cursor = Math.max(0, Math.min(this.cols * this.rows - 1, v));
      return;
    }
    if (v === 12) {
      this.cells.fill(0);
      this.cursor = 0;
    } else if (v === 13) this.cursor -= this.cursor % this.cols;
    else if (v === 10) {
      this.cursor = (Math.floor(this.cursor / this.cols) + 1) * this.cols;
      if (this.cursor >= this.cols * this.rows) {
        this.scroll();
        this.cursor = (this.rows - 1) * this.cols;
      }
    } else if (v === 8) {
      if (this.cursor > 0) {
        this.cursor--;
        this.cells[this.cursor] = 0;
      }
    } else {
      this.cells[this.cursor] = v;
      this.cursor++;
      if (this.cursor >= this.cols * this.rows) {
        this.scroll();
        this.cursor = (this.rows - 1) * this.cols;
      }
    }
  }
  tick(): void {}
  reset(): void {
    this.cells.fill(0);
    this.cursor = 0;
  }
  /** Строки экрана для отображения. */
  lines(): string[] {
    const out: string[] = [];
    for (let r = 0; r < this.rows; r++) {
      let s = '';
      for (let c = 0; c < this.cols; c++) {
        const v = this.cells[r * this.cols + c];
        s += v >= 32 && v < 127 ? String.fromCharCode(v) : ' ';
      }
      out.push(s);
    }
    return out;
  }
}

class PixelDevice implements Device {
  type = 'pixel' as const;
  pixels: Uint8Array;
  x = 0;
  y = 0;
  constructor(
    readonly id: string,
    readonly width: number,
    readonly height: number,
  ) {
    this.pixels = new Uint8Array(width * height);
  }
  read(o: number): number {
    if (o === 0) return this.x;
    if (o === 1) return this.y;
    if (o === 2) return this.x < this.width && this.y < this.height ? this.pixels[this.y * this.width + this.x] : 0;
    return 0;
  }
  peek(o: number): number {
    return this.read(o);
  }
  write(o: number, v: number): void {
    if (o === 0) this.x = v;
    else if (o === 1) this.y = v;
    else if (o === 2) {
      if (this.x < this.width && this.y < this.height) this.pixels[this.y * this.width + this.x] = v & 1;
    } else this.pixels.fill(0);
  }
  tick(): void {}
  reset(): void {
    this.pixels.fill(0);
    this.x = 0;
    this.y = 0;
  }
}

class KeyboardDevice implements Device {
  type = 'keyboard' as const;
  queue: number[] = [];
  constructor(readonly id: string) {}
  read(): number {
    return this.queue.shift() ?? 0;
  }
  peek(): number {
    return this.queue[0] ?? 0;
  }
  write(): void {
    this.queue = [];
  }
  press(code: number): void {
    if (this.queue.length < 16) this.queue.push(code & 0xff);
  }
  tick(): void {}
  reset(): void {
    this.queue = [];
  }
}

class TimerDevice implements Device {
  type = 'timer' as const;
  value = 0;
  private acc = 0;
  constructor(
    readonly id: string,
    readonly period: number,
    private mask: number,
  ) {}
  read(): number {
    return this.value;
  }
  peek(): number {
    return this.value;
  }
  write(_o: number, v: number): void {
    this.value = v & this.mask;
  }
  tick(cycles: number): void {
    this.acc += cycles;
    while (this.acc >= this.period) {
      this.acc -= this.period;
      this.value = (this.value + 1) & this.mask;
    }
  }
  reset(): void {
    this.value = 0;
    this.acc = 0;
  }
}

class RandomDevice implements Device {
  type = 'random' as const;
  private seed = 12345;
  constructor(
    readonly id: string,
    private mask: number,
  ) {}
  read(): number {
    this.seed = (Math.imul(this.seed, 1103515245) + 12345) >>> 0;
    return (this.seed >>> 8) & this.mask;
  }
  peek(): number {
    return 0;
  }
  write(): void {}
  tick(): void {}
  reset(): void {
    this.seed = 12345;
  }
}

class SoundDevice implements Device {
  type = 'sound' as const;
  note = 0;
  constructor(readonly id: string) {}
  read(): number {
    return 0;
  }
  peek(): number {
    return 0;
  }
  write(_o: number, v: number): void {
    this.note = v;
  }
  tick(): void {}
  reset(): void {
    this.note = 0;
  }
}

class TerminalDevice implements Device {
  type = 'terminal' as const;
  text = '';
  constructor(readonly id: string) {}
  read(): number {
    return 0;
  }
  peek(): number {
    return 0;
  }
  write(_o: number, v: number): void {
    if (this.text.length < 20000) this.text += String.fromCharCode(v & 0xff);
  }
  tick(): void {}
  reset(): void {
    this.text = '';
  }
}

export type AnyDevice = LedsDevice | SwitchesDevice | ButtonsDevice | SevenSegDevice | TextDevice | PixelDevice | KeyboardDevice | TimerDevice | RandomDevice | SoundDevice | TerminalDevice;

export function createDevice(d: DeviceSpec, spec: ComputerSpec): AnyDevice {
  const mask = 2 ** spec.dataBits - 1;
  const o = d.options;
  switch (d.type) {
    case 'leds':
      return new LedsDevice(d.id, o.count ?? 8, 2 ** Math.min(o.count ?? 8, spec.dataBits) - 1);
    case 'switches':
      return new SwitchesDevice(d.id, o.count ?? 8, 2 ** Math.min(o.count ?? 8, spec.dataBits) - 1);
    case 'buttons':
      return new ButtonsDevice(d.id, o.count ?? 4, 2 ** Math.min(o.count ?? 4, spec.dataBits) - 1);
    case 'sevenseg':
      return new SevenSegDevice(d.id, Math.ceil(spec.dataBits / 4), mask);
    case 'text':
      return new TextDevice(d.id, o.cols ?? 16, o.rows ?? 2);
    case 'pixel':
      return new PixelDevice(d.id, o.width ?? 8, o.height ?? 8);
    case 'keyboard':
      return new KeyboardDevice(d.id);
    case 'timer':
      return new TimerDevice(d.id, Math.max(1, o.period ?? 16), mask);
    case 'random':
      return new RandomDevice(d.id, mask);
    case 'sound':
      return new SoundDevice(d.id);
    case 'terminal':
      return new TerminalDevice(d.id);
  }
}

export { LedsDevice, SwitchesDevice, ButtonsDevice, SevenSegDevice, TextDevice, PixelDevice, KeyboardDevice, TimerDevice, RandomDevice, SoundDevice, TerminalDevice };
