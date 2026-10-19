import { Fragment, ReactNode } from 'react';

/** Небольшой рендер Markdown (заголовки, таблицы, код, списки, цитаты, **жирный**, `код`) для встроенной документации. */
function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > last) out.push(text.slice(last, i));
    const t = m[0];
    const key = `${keyBase}-${k++}`;
    if (m[1]) out.push(<code key={key}>{t.slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={key}>{t.slice(2, -2)}</strong>);
    else if (m[3]) out.push(<em key={key}>{t.slice(1, -1)}</em>);
    else {
      const lm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(t)!;
      out.push(/^https?:/.test(lm[2]) ? <a key={key} href={lm[2]} target="_blank" rel="noreferrer">{lm[1]}</a> : <span key={key} className="md-ref">{lm[1]}</span>);
    }
    last = i + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function splitRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
}

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r/g, '').split('\n');
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const lang = line.slice(3).trim();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(<pre key={key++} className="md-code mono" data-lang={lang}>{buf.join('\n')}</pre>);
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const L = h[1].length;
      const Tag = (`h${Math.min(4, L + 1)}`) as 'h2' | 'h3' | 'h4' | 'h5';
      out.push(<Tag key={key++}>{inline(h[2], `h${key}`)}</Tag>);
      i++;
      continue;
    }
    if (/^\s*\|/.test(line) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? '')) {
      const head = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(splitRow(lines[i++]));
      out.push(
        <div key={key++} className="tt-wrap">
          <table className="md-table">
            <thead><tr>{head.map((c, j) => <th key={j}>{inline(c, `th${j}`)}</th>)}</tr></thead>
            <tbody>{rows.map((r, a) => <tr key={a}>{r.map((c, b) => <td key={b}>{inline(c, `td${a}-${b}`)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*]|\d+\.)\s+/, ''));
      const els = items.map((t, j) => <li key={j}>{inline(t, `li${j}`)}</li>);
      out.push(ordered ? <ol key={key++}>{els}</ol> : <ul key={key++}>{els}</ul>);
      continue;
    }
    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
      out.push(<blockquote key={key++}>{inline(buf.join(' '), `bq${key}`)}</blockquote>);
      continue;
    }
    if (/^---+\s*$/.test(line)) {
      out.push(<hr key={key++} />);
      i++;
      continue;
    }
    if (line.trim() === '') {
      i++;
      continue;
    }
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() !== '' && !/^(```|#{1,4}\s|\s*\||\s*([-*]|\d+\.)\s+|>|---)/.test(lines[i])) buf.push(lines[i++]);
    if (buf.length === 0) buf.push(lines[i++]);
    out.push(<p key={key++}>{buf.map((b, j) => <Fragment key={j}>{j > 0 && <br />}{inline(b, `p${key}-${j}`)}</Fragment>)}</p>);
  }
  return <div className="md">{out}</div>;
}
