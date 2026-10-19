import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';

/**
 * Собственные диалоги подтверждения и ввода текста вместо window.confirm / window.prompt:
 * во встроенных окнах и песочницах нативные диалоги не показываются.
 */
interface AskState {
  kind: 'confirm' | 'text';
  title: string;
  message?: string;
  value?: string;
  okLabel: string;
  danger?: boolean;
  resolve: (v: boolean | string | null) => void;
}

const useAsk = create<{ ask: AskState | null }>(() => ({ ask: null }));

export function confirmDialog(title: string, opts: { message?: string; okLabel?: string; danger?: boolean } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    useAsk.setState({ ask: { kind: 'confirm', title, message: opts.message, okLabel: opts.okLabel ?? 'Да', danger: opts.danger, resolve: (v) => resolve(v === true) } });
  });
}

export function textDialog(title: string, value = '', okLabel = 'Готово'): Promise<string | null> {
  return new Promise((resolve) => {
    useAsk.setState({ ask: { kind: 'text', title, value, okLabel, resolve: (v) => resolve(typeof v === 'string' ? v : null) } });
  });
}

export function AskHost() {
  const ask = useAsk((s) => s.ask);
  const [text, setText] = useState('');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ask?.kind === 'text') {
      setText(ask.value ?? '');
      setTimeout(() => input.current?.select(), 30);
    }
  }, [ask]);

  if (!ask) return null;
  const finish = (v: boolean | string | null): void => {
    useAsk.setState({ ask: null });
    ask.resolve(v);
  };
  const ok = (): void => finish(ask.kind === 'text' ? text : true);

  return (
    <div className="modal-backdrop ask" onMouseDown={(e) => e.target === e.currentTarget && finish(ask.kind === 'text' ? null : false)}>
      <div
        className="modal tiny"
        role="dialog"
        aria-modal="true"
        aria-label={ask.title}
        onKeyDown={(e) => {
          if (e.key === 'Escape') finish(ask.kind === 'text' ? null : false);
          if (e.key === 'Enter') ok();
          e.stopPropagation();
        }}
      >
        <div className="modal-pad">
          <b className="ask-title">{ask.title}</b>
          {ask.message && <p className="dim">{ask.message}</p>}
          {ask.kind === 'text' && <input ref={input} id="ask-input" value={text} onChange={(e) => setText(e.target.value)} maxLength={64} spellCheck={false} autoFocus />}
          <div className="result-actions">
            <button className="btn" onClick={() => finish(ask.kind === 'text' ? null : false)}>Отмена</button>
            <button className={`btn ${ask.danger ? 'danger-solid' : 'primary'}`} onClick={ok} autoFocus={ask.kind === 'confirm'}>
              {ask.okLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
