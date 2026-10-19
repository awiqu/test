import { useEffect, useMemo, useRef, useState } from 'react';
import { useComputer } from '../store';
import { EXAMPLES } from '../examples';
import { Machine } from '../sim';
import { disassemble } from '../asm';
import { SPEEDS, useSim } from './useSim';
import { CodeEditor } from './CodeEditor';
import { DevicesPanel } from './DevicesPanel';
import { IssueList, Section, hexOf } from './common';
import { confirmDialog, textDialog } from '../../ui/ask';

type Tab = 'listing' | 'image' | 'trace';

export function ProgramStep() {
  const project = useComputer((s) => s.project);
  const activeId = useComputer((s) => s.activeProgram);
  const { updateProgram, addProgram, deleteProgram, setActiveProgram, setStep } = useComputer.getState();
  const program = project.programs.find((p) => p.id === activeId) ?? project.programs[0];
  const [tab, setTab] = useState<Tab>('listing');
  const source = program?.source ?? '';
  const sim = useSim(project, source);
  const { asm, machine } = sim;
  const spec = project.spec;
  const examples = EXAMPLES[spec.arch === 'accumulator' ? 'acc4' : spec.dataBits >= 16 ? 'risc16' : 'risc8'] ?? [];
  const mnemonics = useMemo(() => new Set(project.instructions.map((i) => i.mnemonic.toUpperCase())), [project.instructions]);
  const errors = useMemo(() => {
    const m = new Map<number, string[]>();
    for (const i of asm.issues) if (i.line && i.level === 'error') m.set(i.line, [...(m.get(i.line) ?? []), i.message]);
    return m;
  }, [asm]);
  const errCount = asm.issues.filter((i) => i.level === 'error').length;
  const digits = Math.ceil(spec.instrBits / 4);

  if (!program) {
    return (
      <div className="cs-page">
        <p className="hint">Программ пока нет.</p>
        <button className="btn primary" onClick={() => addProgram('Новая программа', '; программа\n        hlt\n')}>Создать программу</button>
      </div>
    );
  }

  return (
    <div className="cs-page wide">
      <div className="cs-progbar">
        <select value={program.id} onChange={(e) => setActiveProgram(e.target.value)} aria-label="Программа">
          {project.programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button className="btn small" onClick={async () => {
          const name = await textDialog('Название новой программы', 'Моя программа', 'Создать');
          if (name) addProgram(name, '; ' + name + '\n        hlt\n');
        }}>＋ Новая</button>
        <button className="btn small" onClick={() => addProgram(`${program.name} (копия)`, program.source)}>Копия</button>
        <button className="btn small" onClick={async () => {
          const name = await textDialog('Новое название', program.name, 'Переименовать');
          if (name) updateProgram(program.id, { name });
        }}>Переименовать</button>
        <button className="btn small danger" onClick={async () => {
          if (await confirmDialog(`Удалить «${program.name}»?`, { okLabel: 'Удалить', danger: true })) deleteProgram(program.id);
        }}>Удалить</button>
        <div className="tb-spacer" />
        <select value="" onChange={(e) => {
          const ex = examples[Number(e.target.value)];
          if (ex) addProgram(ex.name, ex.source);
        }} aria-label="Добавить пример">
          <option value="">Добавить пример…</option>
          {examples.map((ex, i) => <option key={ex.name} value={i}>{ex.name}</option>)}
        </select>
      </div>

      <div className="cs-prog">
        <div className="cs-prog-left">
          <div className="cs-editor-box">
            <CodeEditor
              value={source}
              onChange={(v) => updateProgram(program.id, { source: v })}
              mnemonics={mnemonics}
              errors={errors}
              breakLines={sim.breakLines}
              currentLine={sim.state === 'idle' && sim.machine.steps === 0 ? null : sim.currentLine}
              onToggleBreak={sim.toggleBreakLine}
            />
          </div>
          <div className={`badge ${errCount ? 'bad' : 'ok'}`}>
            {errCount ? `Ошибок: ${errCount}` : `Собрано: ${asm.size} из ${spec.romWords} слов ПЗУ (${Math.round((asm.size / spec.romWords) * 100)}%)`}
            {asm.issues.some((i) => i.level === 'warning') && ` · предупреждений: ${asm.issues.filter((i) => i.level === 'warning').length}`}
          </div>
          <IssueList issues={asm.issues} />

          <div className="cs-tabs" role="tablist">
            {([['listing', 'Листинг'], ['image', 'Образ ПЗУ'], ['trace', 'Трасса']] as [Tab, string][]).map(([id, label]) => (
              <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>
            ))}
          </div>
          {tab === 'listing' && <Listing sim={sim} digits={digits} />}
          {tab === 'image' && <Image words={asm.words} used={asm.used} digits={digits} pc={machine.pc} />}
          {tab === 'trace' && <Trace machine={machine} rev={sim.rev} digits={digits} />}
        </div>

        <div className="cs-prog-right">
          <Section title="Выполнение">
            <div className="sim-controls">
              {sim.state === 'running' ? (
                <button className="btn" onClick={sim.pause}>⏸ Пауза</button>
              ) : (
                <button className="btn primary" onClick={sim.run} disabled={errCount > 0}>▶ Запустить</button>
              )}
              <button className="btn" onClick={sim.step} disabled={errCount > 0 || sim.state === 'running'} title="Выполнить одну команду">⏭ Шаг</button>
              <button className="btn" onClick={sim.reset}>⟲ Сброс</button>
              <select value={sim.speed} onChange={(e) => sim.setSpeed(Number(e.target.value))} aria-label="Скорость">
                {SPEEDS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>
            <StatusLine sim={sim} />
            <Registers machine={machine} rev={sim.rev} />
          </Section>
          <Section title="Устройства">
            <DevicesPanel machine={machine} rev={sim.rev} poke={sim.poke} />
          </Section>
          <Section title="Память данных (ОЗУ)">
            <Memory machine={machine} rev={sim.rev} />
          </Section>
        </div>
      </div>
      <div className="cs-footer">
        <button className="btn" onClick={() => setStep('asm')}>← Ассемблер</button>
        <div className="tb-spacer" />
        <button className="btn primary big" disabled={errCount > 0} onClick={() => setStep('rom')}>Далее: ПЗУ из бочек →</button>
      </div>
    </div>
  );
}

const STATE_TEXT: Record<string, string> = {
  idle: 'Готов к запуску',
  running: 'Выполняется…',
  paused: 'Пауза',
  halted: 'Остановлен командой HLT',
  fault: 'Сбой',
  breakpoint: 'Остановлен на точке останова',
};

function StatusLine({ sim }: { sim: ReturnType<typeof useSim> }) {
  const m = sim.machine;
  const next = m.pc < m.rom.length ? disassemble(m.rom[m.pc], m.spec, m.isa, undefined) : '—';
  return (
    <div className={`sim-status ${sim.state}`} aria-live="polite">
      <b>{STATE_TEXT[sim.state]}</b>
      {m.fault && <span className="bad-text"> — {m.fault}</span>}
      <div className="mono dim">
        PC={m.pc} → <span className="next">{next}</span>
      </div>
      <div className="dim">
        команд: {m.steps} · тактов: {m.cycles} · ≈ {m.gameSeconds.toFixed(1)} с в игре
      </div>
    </div>
  );
}

function Registers({ machine, rev }: { machine: Machine; rev: number }) {
  const prev = useRef<number[]>([]);
  const spec = machine.spec;
  const digits = Math.ceil(spec.dataBits / 4);
  const changed = machine.env.R.map((v, i) => prev.current[i] !== undefined && prev.current[i] !== v);
  void rev;
  useEffect(() => {
    prev.current = [...machine.env.R];
  });
  return (
    <div className="regs">
      <div className="regs-grid">
        {machine.env.R.map((v, i) => (
          <div key={i} className={`reg ${changed[i] ? 'chg' : ''}`}>
            <small>{spec.arch === 'accumulator' ? 'A' : `r${i}`}</small>
            <b className="mono">{v}</b>
            <span className="mono dim">0x{hexOf(v, digits)}</span>
          </div>
        ))}
      </div>
      <div className="regs-flags">
        {spec.flags.map((f) => <span key={f} className={`flag ${machine.env.flags[f] ? 'on' : ''}`} title={f}>{f}</span>)}
        {spec.stack.enabled && <span className="mono dim">SP={machine.env.sp}</span>}
        <span className="mono dim">PC={machine.pc}</span>
      </div>
    </div>
  );
}

function Memory({ machine, rev }: { machine: Machine; rev: number }) {
  const prev = useRef<number[]>([]);
  const spec = machine.spec;
  const digits = Math.ceil(spec.dataBits / 4);
  const per = spec.dataBits <= 8 ? 8 : 6;
  const cells = machine.ram;
  const changed = cells.map((v, i) => prev.current[i] !== undefined && prev.current[i] !== v);
  void rev;
  useEffect(() => {
    prev.current = [...machine.ram];
  });
  if (cells.length === 0) return <p className="hint">ОЗУ нет.</p>;
  const stackFrom = spec.stack.enabled ? spec.ramWords - spec.stack.words : spec.ramWords;
  const rows = Math.ceil(cells.length / per);
  return (
    <div className="mem" style={{ gridTemplateColumns: `auto repeat(${per}, 1fr)` }}>
      {Array.from({ length: rows }, (_, r) => (
        <MemRow key={r} r={r} per={per} cells={cells} changed={changed} digits={digits} stackFrom={stackFrom} sp={machine.env.sp} />
      ))}
    </div>
  );
}

function MemRow({ r, per, cells, changed, digits, stackFrom, sp }: { r: number; per: number; cells: number[]; changed: boolean[]; digits: number; stackFrom: number; sp: number }) {
  const out = [<small key="a" className="mono dim">{hexOf(r * per, 2)}</small>];
  for (let c = 0; c < per; c++) {
    const i = r * per + c;
    if (i >= cells.length) out.push(<span key={c} />);
    else out.push(<span key={c} className={`mem-cell mono ${changed[i] ? 'chg' : ''} ${i >= stackFrom ? 'stk' : ''} ${i === sp ? 'sp' : ''}`} title={`M[${i}] = ${cells[i]}`}>{hexOf(cells[i], digits)}</span>);
  }
  return <>{out}</>;
}

function Listing({ sim, digits }: { sim: ReturnType<typeof useSim>; digits: number }) {
  const cur = sim.machine.pc;
  return (
    <div className="listing mono" role="table" aria-label="Листинг">
      {sim.asm.listing.filter((l) => l.text.trim() !== '' || l.words).map((l) => (
        <div key={l.line} className={`ls-row ${l.addr !== undefined && l.addr === cur ? 'cur' : ''}`}>
          <span className="ls-ln dim">{l.line}</span>
          <span className="ls-ad">{l.addr !== undefined ? hexOf(l.addr, 2) : ''}</span>
          <span className="ls-wd">{l.words ? l.words.map((w) => hexOf(w, digits)).join(' ') : ''}</span>
          <span className="ls-tx">{l.text}</span>
        </div>
      ))}
    </div>
  );
}

function Image({ words, used, digits, pc }: { words: number[]; used: boolean[]; digits: number; pc: number }) {
  const per = 8;
  const rows = Math.ceil(words.length / per);
  return (
    <div className="image mono" aria-label="Образ ПЗУ">
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="img-row">
          <small className="dim">{hexOf(r * per, 2)}</small>
          {Array.from({ length: per }, (_, c) => {
            const i = r * per + c;
            return i < words.length ? <span key={c} className={`${used[i] ? 'used' : 'dim'} ${i === pc ? 'cur' : ''}`}>{hexOf(words[i], digits)}</span> : <span key={c} />;
          })}
        </div>
      ))}
      <p className="hint">Подсвечены занятые слова. Именно этот образ записывается в бочки на шаге «ПЗУ из бочек».</p>
    </div>
  );
}

function Trace({ machine, rev, digits }: { machine: Machine; rev: number; digits: number }) {
  void rev;
  const rows = machine.trace.slice(-40).reverse();
  if (rows.length === 0) return <p className="hint">Выполните хотя бы одну команду.</p>;
  return (
    <div className="listing mono">
      {rows.map((t, i) => (
        <div key={i} className="ls-row">
          <span className="ls-ad">{hexOf(t.pc, 2)}</span>
          <span className="ls-wd">{hexOf(t.word, digits)}</span>
          <span className="ls-tx">{t.text}{t.fault ? ` — ${t.fault}` : ''}</span>
        </div>
      ))}
    </div>
  );
}

