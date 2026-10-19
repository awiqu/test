import './computer.css';
import { Component, ReactNode } from 'react';
import { STEPS, Step, useComputer } from '../store';
import { validateSpec } from '../spec';
import { validateIsa } from '../isa';
import { SpecStep } from './SpecStep';
import { IsaStep } from './IsaStep';
import { AsmStep } from './AsmStep';
import { ProgramStep } from './ProgramStep';
import { RomStep } from './RomStep';
import { AiStep } from './AiStep';
import { HardwareStep } from './HardwareStep';

/** Ошибка в одном шаге не должна ронять всё приложение. */
class StepBoundary extends Component<{ step: Step; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidUpdate(prev: { step: Step }) {
    if (prev.step !== this.props.step && this.state.error) this.setState({ error: null });
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="cs-page">
        <div className="badge bad">
          <b>Этот шаг не смог открыться:</b> {this.state.error.message}
          <div className="cs-actions" style={{ marginTop: 8 }}>
            <button className="btn" onClick={() => useComputer.getState().setStep('spec')}>К характеристикам</button>
            <button className="btn" onClick={() => this.setState({ error: null })}>Попробовать снова</button>
          </div>
        </div>
      </div>
    );
  }
}

export function ComputersTab() {
  const step = useComputer((s) => s.step);
  const project = useComputer((s) => s.project);
  const welcomed = useComputer((s) => s.welcomed);
  const setStep = useComputer((s) => s.setStep);
  const specErr = validateSpec(project.spec).some((i) => i.level === 'error');
  const isaErr = validateIsa(project.spec, project.instructions).some((i) => i.level === 'error');
  const mark = (id: Step): string => {
    if (id === 'spec') return specErr ? 'bad' : welcomed ? 'ok' : '';
    if (id === 'isa') return isaErr ? 'bad' : '';
    return '';
  };
  return (
    <div className="cs-root">
      <nav className="cs-steps" aria-label="Шаги">
        {STEPS.map((s, i) => (
          <button key={s.id} className={`cs-step ${step === s.id ? 'on' : ''} ${mark(s.id)}`} onClick={() => setStep(s.id)} aria-current={step === s.id ? 'step' : undefined}>
            <i>{mark(s.id) === 'ok' ? '✓' : mark(s.id) === 'bad' ? '!' : i + 1}</i>
            <span>
              <b>{s.title}</b>
              <small>{s.hint}</small>
            </span>
          </button>
        ))}
        <div className="cs-steps-foot">
          <b>{project.spec.name}</b>
          <small>
            {project.spec.dataBits} бит · {project.instructions.length} команд · {project.spec.romWords}×{project.spec.instrBits} ПЗУ
          </small>
        </div>
      </nav>
      <main className="cs-content">
        <StepBoundary step={step}>
        {step === 'spec' && <SpecStep />}
        {step === 'isa' && <IsaStep />}
        {step === 'asm' && <AsmStep />}
        {step === 'prog' && <ProgramStep />}
        {step === 'rom' && <RomStep />}
        {step === 'hw' && <HardwareStep />}
        {step === 'ai' && <AiStep />}
        </StepBoundary>
      </main>
    </div>
  );
}
