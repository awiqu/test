import { ComputerSpec, FlagName, Instruction } from './types';
import { Stmt, RtlEnv, execProgram, parseRtl } from './rtl';
import { decodeWord, layoutOf } from './isa';
import { portMap } from './spec';
import { AnyDevice, createDevice } from './devices';
import { disassemble } from './asm';

export interface StepInfo {
  pc: number;
  word: number;
  mnemonic: string;
  text: string;
  cycles: number;
  halted: boolean;
  fault?: string;
}

/** Процессор + память + устройства: исполняет образ ПЗУ по описанию инструкций (RTL). */
export class Machine {
  readonly spec: ComputerSpec;
  readonly isa: Instruction[];
  rom: number[];
  ram: number[];
  env: RtlEnv;
  devices: AnyDevice[] = [];
  /** адрес порта → (устройство, номер порта). */
  private portAt = new Map<number, { dev: AnyDevice; off: number }>();
  private byOpcode = new Map<number, Instruction>();
  private compiled = new Map<number, { prog: Stmt[]; bad: boolean }>();
  steps = 0;
  cycles = 0;
  halted = false;
  fault: string | undefined;
  trace: StepInfo[] = [];
  private traceLimit = 200;

  constructor(spec: ComputerSpec, isa: Instruction[], rom: number[]) {
    this.spec = spec;
    this.isa = isa;
    this.rom = rom;
    for (const i of isa) {
      this.byOpcode.set(i.opcode, i);
      const { prog, errors } = parseRtl(i.code);
      this.compiled.set(i.opcode, { prog, bad: errors.length > 0 });
    }
    this.ram = new Array(spec.ramWords).fill(0);
    for (const d of spec.devices) this.devices.push(createDevice(d, spec));
    const ports = portMap(spec);
    for (const p of ports) {
      const dev = this.devices.find((d) => d.id === p.device)!;
      const off = ports.filter((q) => q.device === p.device).indexOf(p);
      this.portAt.set(p.addr, { dev, off });
    }
    const consts: Record<string, number> = {};
    for (const p of ports) consts[p.name] = p.addr;
    const hasFlag = { Z: false, C: false, N: false, V: false } as Record<FlagName, boolean>;
    for (const f of spec.flags) hasFlag[f] = true;
    this.env = {
      dataBits: spec.dataBits,
      mask: 2 ** spec.dataBits - 1,
      ramMask: 2 ** spec.ramAddrBits - 1,
      pcMask: 2 ** spec.pcBits - 1,
      hasFlag,
      stackEnabled: spec.stack.enabled,
      R: new Array(spec.regCount).fill(0),
      read: (a) => this.read(a),
      write: (a, v) => this.write(a, v),
      pc: 0,
      nextPc: null,
      sp: 0,
      flags: { Z: 0, C: 0, N: 0, V: 0 },
      t: [0, 0, 0, 0],
      fields: {},
      consts,
      halted: false,
    };
    this.reset();
  }

  get pc(): number {
    return this.env.pc;
  }

  reset(): void {
    this.env.R.fill(0);
    this.env.flags = { Z: 0, C: 0, N: 0, V: 0 };
    this.env.pc = 0;
    this.env.nextPc = null;
    this.env.sp = this.spec.stack.enabled ? this.spec.ramWords & this.env.ramMask : 0;
    this.env.halted = false;
    this.ram.fill(0);
    for (const d of this.devices) d.reset();
    this.steps = 0;
    this.cycles = 0;
    this.halted = false;
    this.fault = undefined;
    this.trace = [];
  }

  setRom(rom: number[]): void {
    this.rom = rom;
  }

  /** Шина данных: чтение (с побочными эффектами устройств). */
  read(addr: number): number {
    addr &= this.env.ramMask;
    if (addr < this.ram.length) return this.ram[addr];
    const p = this.portAt.get(addr);
    return p ? p.dev.read(p.off) & this.env.mask : 0;
  }

  /** Чтение без побочных эффектов. */
  peek(addr: number): number {
    addr &= this.env.ramMask;
    if (addr < this.ram.length) return this.ram[addr];
    const p = this.portAt.get(addr);
    return p ? p.dev.peek(p.off) & this.env.mask : 0;
  }

  write(addr: number, v: number): void {
    addr &= this.env.ramMask;
    v &= this.env.mask;
    if (addr < this.ram.length) {
      this.ram[addr] = v;
      return;
    }
    const p = this.portAt.get(addr);
    if (p) p.dev.write(p.off, v);
  }

  device<T extends AnyDevice['type']>(type: T): Extract<AnyDevice, { type: T }> | undefined {
    return this.devices.find((d) => d.type === type) as Extract<AnyDevice, { type: T }> | undefined;
  }

  step(): StepInfo {
    const pc = this.env.pc;
    const info: StepInfo = { pc, word: 0, mnemonic: '?', text: '', cycles: 0, halted: false };
    if (this.halted) {
      info.halted = true;
      info.fault = this.fault;
      return info;
    }
    if (pc >= this.rom.length) {
      this.fault = `PC=${pc} вне ПЗУ`;
      this.halted = true;
      info.fault = this.fault;
      info.halted = true;
      return info;
    }
    const word = this.rom[pc];
    info.word = word;
    const d = decodeWord(word, this.spec, this.isa, this.byOpcode);
    if (!d) {
      this.fault = `Неизвестный код операции в слове 0x${word.toString(16)} по адресу ${pc}`;
      this.halted = true;
      info.fault = this.fault;
      info.halted = true;
      info.text = `.word 0x${word.toString(16)}`;
      return info;
    }
    info.mnemonic = d.inst.mnemonic;
    info.text = disassemble(word, this.spec, this.isa);
    const c = this.compiled.get(d.inst.opcode)!;
    if (c.bad) {
      this.fault = `В описании инструкции ${d.inst.mnemonic} ошибка RTL`;
      this.halted = true;
      info.fault = this.fault;
      info.halted = true;
      return info;
    }
    const env = this.env;
    env.nextPc = null;
    env.t[0] = env.t[1] = env.t[2] = env.t[3] = 0;
    env.fields = { ...d.fields } as Record<string, number>;
    execProgram(c.prog, env);
    this.steps++;
    this.cycles += d.inst.cycles;
    info.cycles = d.inst.cycles;
    for (const dev of this.devices) dev.tick(d.inst.cycles);
    if (env.halted) {
      this.halted = true;
      info.halted = true;
      env.halted = false;
    } else env.pc = env.nextPc !== null ? env.nextPc : (pc + 1) & env.pcMask;
    this.trace.push(info);
    if (this.trace.length > this.traceLimit) this.trace.shift();
    return info;
  }

  /** Выполняет до остановки или до лимита шагов; возвращает причину. */
  run(maxSteps: number, breakpoints?: Set<number>): 'halted' | 'limit' | 'breakpoint' | 'fault' {
    for (let i = 0; i < maxSteps; i++) {
      if (breakpoints && i > 0 && breakpoints.has(this.env.pc)) return 'breakpoint';
      this.step();
      if (this.halted) return this.fault ? 'fault' : 'halted';
    }
    return 'limit';
  }

  get flagsText(): string {
    return this.spec.flags.map((f) => `${f}=${this.env.flags[f]}`).join(' ');
  }

  /** Оценка времени в игре: такты × тики на такт × 0,1 с. */
  get gameSeconds(): number {
    return this.cycles * this.spec.clockTicks * 0.1;
  }
}

/** Краткое описание форматов для справки (какие поля есть у инструкции). */
export function instructionFields(inst: Instruction, spec: ComputerSpec): string[] {
  return layoutOf(inst.format, spec).fields.map((f) => f.name);
}
