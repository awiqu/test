import { ReactNode, useState } from 'react';
import { Issue } from '../types';
import { useEditor } from '../../editor/store';
import { safeFileName } from '../../export/litematic';

export function notify(msg: string): void {
  useEditor.getState().notify(msg);
}

/** Копирование в буфер обмена с запасным вариантом (во встроенных окнах Clipboard API может быть закрыт). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    /* пробуем запасной способ */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

export function CopyButton({ text, label = 'Копировать', className = 'btn small' }: { text: string | (() => string); label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className={className}
      onClick={async () => {
        const ok = await copyText(typeof text === 'function' ? text() : text);
        notify(ok ? 'Скопировано в буфер обмена' : 'Не удалось скопировать — выделите текст в поле вручную и нажмите Ctrl+C');
        setDone(ok);
        setTimeout(() => setDone(false), 1600);
      }}
    >
      {done ? '✓ Скопировано' : label}
    </button>
  );
}

export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="cs-section">
      <header className="cs-section-head">
        <h3>{title}</h3>
        {aside}
      </header>
      {children}
    </section>
  );
}

export function NumField({
  label,
  value,
  min,
  max,
  onChange,
  hint,
  suffix,
  step = 1,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  hint?: ReactNode;
  suffix?: string;
  step?: number;
}) {
  const set = (v: number) => onChange(Math.max(min, Math.min(max, Math.round(v))));
  return (
    <div className="field">
      <span>{label}</span>
      <div className="num-row">
        <div className="stepper">
          <button onClick={() => set(value - step)} disabled={value <= min} aria-label={`${label}: меньше`}>−</button>
          <b>{value}</b>
          <button onClick={() => set(value + step)} disabled={value >= max} aria-label={`${label}: больше`}>+</button>
        </div>
        {suffix && <span className="dim">{suffix}</span>}
      </div>
      {hint && <small className="dim">{hint}</small>}
    </div>
  );
}

export function Chips<T extends string>({ options, value, onChange, title }: { options: { id: T; label: string; hint?: string; disabled?: boolean }[]; value: T[]; onChange: (v: T[]) => void; title?: string }) {
  return (
    <div className="chips" role="group" aria-label={title}>
      {options.map((o) => {
        const on = value.includes(o.id);
        return (
          <button
            key={o.id}
            className={`chip ${on ? 'on' : ''}`}
            title={o.hint}
            disabled={o.disabled}
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== o.id) : [...value, o.id])}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function IssueList({ issues, empty }: { issues: Issue[]; empty?: string }) {
  if (issues.length === 0) return empty ? <div className="badge ok">{empty}</div> : null;
  return (
    <ul className="issues">
      {issues.map((i, k) => (
        <li key={k} className={i.level}>
          <b>{i.level === 'error' ? '✕' : '!'}</b>
          <span>
            {i.where && <code>{i.where}</code>} {i.line ? <em>строка {i.line}: </em> : null}
            {i.message}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function hexOf(n: number, digits: number): string {
  return n.toString(16).toUpperCase().padStart(digits, '0');
}

export function downloadName(base: string): string {
  return safeFileName(base || 'computer');
}
