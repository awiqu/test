import { KeyboardEvent, useMemo, useRef } from 'react';

const LH = 20;
const DIRECTIVES = /^\.(org|equ|set|word|fill|string|ascii)$/i;

interface Props {
  value: string;
  onChange: (v: string) => void;
  mnemonics: Set<string>;
  errors: Map<number, string[]>;
  breakLines: Set<number>;
  currentLine: number | null;
  onToggleBreak: (line: number) => void;
}

function highlight(line: string, mnemonics: Set<string>): (string | JSX.Element)[] {
  const out: (string | JSX.Element)[] = [];
  let rest = line;
  let key = 0;
  const push = (cls: string | null, text: string) => {
    if (!text) return;
    out.push(cls ? <span key={key++} className={cls}>{text}</span> : text);
  };
  // комментарий
  let commentAt = -1;
  let q: string | null = null;
  for (let i = 0; i < rest.length; i++) {
    const c = rest[i];
    if (q) {
      if (c === '\\') i++;
      else if (c === q) q = null;
    } else if (c === '"' || c === "'") q = c;
    else if (c === ';' || (c === '/' && rest[i + 1] === '/')) {
      commentAt = i;
      break;
    }
  }
  const comment = commentAt >= 0 ? rest.slice(commentAt) : '';
  if (commentAt >= 0) rest = rest.slice(0, commentAt);
  const re = /(\s+)|([A-Za-z_.][A-Za-z0-9_.]*:)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])')|(0[xX][0-9a-fA-F]+|0[bB][01]+|\d+)|([A-Za-z_.][A-Za-z0-9_.]*)|(.)/g;
  let first = true;
  for (const m of rest.matchAll(re)) {
    if (m[1]) push(null, m[1]);
    else if (m[2]) push('tk-label', m[2]);
    else if (m[3]) push('tk-str', m[3]);
    else if (m[4]) push('tk-num', m[4]);
    else if (m[5]) {
      if (DIRECTIVES.test(m[5])) push('tk-dir', m[5]);
      else if (first && mnemonics.has(m[5].toUpperCase())) push('tk-op', m[5]);
      else if (/^[rR]\d+$/.test(m[5]) || m[5] === 'A') push('tk-reg', m[5]);
      else push('tk-sym', m[5]);
      first = false;
    } else push(null, m[6] ?? '');
  }
  push('tk-com', comment);
  return out;
}

/** Редактор ассемблера: нумерация строк, подсветка, точки останова, пометки ошибок. */
export function CodeEditor({ value, onChange, mnemonics, errors, breakLines, currentLine, onToggleBreak }: Props) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const lines = useMemo(() => value.split('\n'), [value]);
  const widest = Math.max(30, ...lines.map((l) => l.length + 2));
  const height = lines.length * LH + 16;

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const t = e.currentTarget;
      const s = t.selectionStart;
      const next = value.slice(0, s) + '    ' + value.slice(t.selectionEnd);
      onChange(next);
      requestAnimationFrame(() => t.setSelectionRange(s + 4, s + 4));
    }
  };

  return (
    <div className="ce" role="group" aria-label="Редактор программы">
      <div className="ce-inner" style={{ height, minWidth: `calc(52px + ${widest}ch)` }}>
        <div className="ce-gutter">
          {lines.map((_, i) => {
            const n = i + 1;
            const err = errors.get(n);
            return (
              <div key={n} className={`ce-gl ${err ? 'err' : ''} ${currentLine === n ? 'cur' : ''}`} style={{ height: LH }} title={err ? err.join('\n') : 'Клик — точка останова'} onClick={() => onToggleBreak(n)}>
                <i className={`ce-bp ${breakLines.has(n) ? 'on' : ''}`} />
                <span>{n}</span>
              </div>
            );
          })}
        </div>
        <div className="ce-body">
          {currentLine !== null && <div className="ce-line cur" style={{ top: 8 + (currentLine - 1) * LH, height: LH }} />}
          {[...errors.keys()].map((n) => (
            <div key={n} className="ce-line err" style={{ top: 8 + (n - 1) * LH, height: LH }} />
          ))}
          <pre className="ce-hl" aria-hidden>
            {lines.map((l, i) => (
              <div key={i} style={{ height: LH }}>{highlight(l, mnemonics)}{'\u200b'}</div>
            ))}
          </pre>
          <textarea
            ref={ta}
            className="ce-ta"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKey}
            spellCheck={false}
            wrap="off"
            autoCapitalize="off"
            autoCorrect="off"
            aria-label="Текст программы"
            style={{ height }}
          />
        </div>
      </div>
    </div>
  );
}
