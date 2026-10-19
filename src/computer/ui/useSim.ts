import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ComputerProject } from '../types';
import { AsmResult, assemble } from '../asm';
import { Machine, StepInfo } from '../sim';

export const SPEEDS = [
  { id: 1, label: '1 команда/с' },
  { id: 5, label: '5 команд/с' },
  { id: 30, label: '30 команд/с' },
  { id: 300, label: '300 команд/с' },
  { id: 3000, label: '3 000 команд/с' },
  { id: 60000, label: 'максимум' },
];

export type RunState = 'idle' | 'running' | 'paused' | 'halted' | 'fault' | 'breakpoint';

export interface Sim {
  asm: AsmResult;
  machine: Machine;
  /** Растёт после каждого изменения состояния — для перерисовки. */
  rev: number;
  state: RunState;
  speed: number;
  setSpeed: (s: number) => void;
  breakpoints: Set<number>;
  /** Строки исходника с точками останова. */
  breakLines: Set<number>;
  toggleBreakLine: (line: number) => void;
  step: () => void;
  run: () => void;
  pause: () => void;
  reset: () => void;
  last: StepInfo | null;
  /** Номер строки исходника, которая исполняется следующей. */
  currentLine: number | null;
  poke: () => void;
}

export function useSim(project: ComputerProject, source: string): Sim {
  const asm = useMemo(() => assemble(source, project.spec, project.instructions, project.asm), [source, project.spec, project.instructions, project.asm]);
  const rom = asm.words;
  const romKey = useMemo(() => `${rom.join(',')}|${JSON.stringify(project.spec)}|${JSON.stringify(project.instructions.map((i) => [i.opcode, i.format, i.code, i.cycles]))}`, [rom, project.spec, project.instructions]);
  const machine = useMemo(() => new Machine(project.spec, project.instructions, rom), [romKey]);
  const [rev, setRev] = useState(0);
  const [state, setState] = useState<RunState>('idle');
  const [speed, setSpeed] = useState(300);
  const [breakLines, setBreakLines] = useState<Set<number>>(new Set());
  const [last, setLast] = useState<StepInfo | null>(null);
  const inputs = useRef<{ sw: number }>({ sw: 0 });
  const bump = useCallback(() => setRev((r) => r + 1), []);

  // новая сборка → сброс исполнения
  useEffect(() => {
    setState('idle');
    setLast(null);
    bump();
  }, [machine, bump]);

  const breakpoints = useMemo(() => {
    const out = new Set<number>();
    const byLine = new Map<number, number[]>();
    for (const [addr, line] of Object.entries(asm.lineOf)) {
      const a = byLine.get(line) ?? [];
      a.push(Number(addr));
      byLine.set(line, a);
    }
    for (const l of breakLines) for (const a of byLine.get(l) ?? []) out.add(a);
    return out;
  }, [breakLines, asm]);

  const finish = useCallback(
    (reason: 'halted' | 'limit' | 'breakpoint' | 'fault'): void => {
      if (reason === 'halted') setState('halted');
      else if (reason === 'fault') setState('fault');
      else if (reason === 'breakpoint') setState('breakpoint');
    },
    [],
  );

  const step = useCallback(() => {
    if (machine.halted) return;
    setLast(machine.step());
    setState(machine.halted ? (machine.fault ? 'fault' : 'halted') : 'paused');
    bump();
  }, [machine, bump]);

  const run = useCallback(() => {
    if (machine.halted) machine.reset();
    setState('running');
  }, [machine]);
  const pause = useCallback(() => setState((s) => (s === 'running' ? 'paused' : s)), []);
  const reset = useCallback(() => {
    machine.reset();
    setState('idle');
    setLast(null);
    bump();
  }, [machine, bump]);

  const speedRef = useRef(speed);
  speedRef.current = speed;
  const bpRef = useRef(breakpoints);
  bpRef.current = breakpoints;
  useEffect(() => {
    if (state !== 'running') return;
    let acc = 0;
    let prev = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      acc += ((now - prev) / 1000) * speedRef.current;
      prev = now;
      const n = Math.min(Math.floor(acc), 60000);
      if (n < 1) return;
      acc -= n;
      const reason = machine.run(n, bpRef.current);
      setLast(machine.trace[machine.trace.length - 1] ?? null);
      bump();
      if (reason !== 'limit') {
        clearInterval(id);
        finish(reason);
      }
    }, 16);
    return () => clearInterval(id);
  }, [state, machine, bump, finish]);

  const toggleBreakLine = useCallback((line: number) => {
    setBreakLines((s) => {
      const n = new Set(s);
      if (n.has(line)) n.delete(line);
      else n.add(line);
      return n;
    });
  }, []);

  const currentLine = asm.lineOf[machine.pc] ?? null;
  void inputs;
  return { asm, machine, rev, state, speed, setSpeed, breakpoints: breakLines.size ? breakpoints : new Set(), breakLines, toggleBreakLine, step, run, pause, reset, last, currentLine, poke: bump };
}
