import { useMemo, useState } from 'react';
import { useComputer } from '../store';
import { Block, ComputerSpec, Instruction, JumpCond } from '../types';
import {
  FIELD_DESC,
  FIELD_NAMES,
  FieldName,
  InstrTemplate,
  availableTemplates,
  blocksToPseudo,
  blocksToRtl,
  instructionFromTemplate,
  layoutOf,
  operandChoices,
  parseFormat,
  validateIsa,
} from '../isa';
import { analyzeRtl, execProgram, parseRtl } from '../rtl';
import { Machine } from '../sim';
import { confirmDialog } from '../../ui/ask';
import { IssueList, Section, hexOf, notify } from './common';

const UNARY = ['NOT', 'INC', 'DEC', 'NEG', 'SHL', 'SHR', 'ASR', 'ROL', 'ROR'];

function freeOpcode(spec: ComputerSpec, isa: Instruction[]): number {
  const used = new Set(isa.map((i) => i.opcode));
  for (let o = 0; o < 2 ** spec.opcodeBits; o++) if (!used.has(o)) return o;
  return -1;
}

export function IsaStep() {
  const project = useComputer((s) => s.project);
  const isaSeen = useComputer((s) => s.isaSeen);
  const isaCustom = useComputer((s) => s.isaCustom);
  const { setInstructions, rebuildIsa, markIsaSeen, setStep } = useComputer.getState();
  const spec = project.spec;
  const isa = project.instructions;
  const [sel, setSel] = useState<number>(0);
  const [showCatalog, setShowCatalog] = useState(false);
  const issues = useMemo(() => validateIsa(spec, isa), [spec, isa]);
  const errCount = issues.filter((i) => i.level === 'error').length;
  const sorted = useMemo(() => [...isa].map((inst, idx) => ({ inst, idx })).sort((a, b) => a.inst.opcode - b.inst.opcode), [isa]);
  const cur = isa[sel] ? sel : isa.length ? 0 : -1;
  const inst = cur >= 0 ? isa[cur] : null;

  const update = (idx: number, patch: Partial<Instruction>) => setInstructions(isa.map((x, i) => (i === idx ? { ...x, ...patch } : x)));
  const addBlank = (opcode?: number) => {
    const op = opcode ?? freeOpcode(spec, isa);
    if (op < 0) return notify('Свободных кодов операции нет — увеличьте число бит кода операции на шаге «Характеристики»');
    let n = 1;
    const names = new Set(isa.map((i) => i.mnemonic.toUpperCase()));
    while (names.has(`OP${n}`)) n++;
    const blocks: Block[] = [{ kind: 'nop' }];
    setInstructions([...isa, { mnemonic: `OP${n}`, opcode: op, format: '', description: '', pseudo: blocksToPseudo(blocks), code: blocksToRtl(blocks), cycles: 1, blocks }]);
    setSel(isa.length);
  };
  const addFromTemplate = (tpl: InstrTemplate, params: Record<string, string>) => {
    const made = instructionFromTemplate(tpl, params, spec, isa);
    if (made.opcode >= 2 ** spec.opcodeBits || isa.some((i) => i.opcode === made.opcode)) return notify('Свободных кодов операции нет — увеличьте число бит кода операции');
    setInstructions([...isa, made]);
    setSel(isa.length);
    notify(`Добавлено: ${made.mnemonic}`);
  };
  const remove = (idx: number) => {
    setInstructions(isa.filter((_, i) => i !== idx));
    setSel(Math.max(0, idx - 1));
  };

  return (
    <div className="cs-page">
      {!isaSeen && (
        <div className="cs-welcome">
          <h2>Теперь — запрограммировать компьютер</h2>
          <p>
            Компьютер умеет ровно то, что вы опишете в наборе команд. Для «{spec.name}» уже подобран стандартный набор из {isa.length} команд — с ним можно сразу писать программы.
            Хотите — соберите свои инструкции в конструкторе: выберите операнды, нажмите блоки «сложить», «перейти, если ноль», «записать в память» — и получите
            псевдокод, исполняемое описание и код операции.
          </p>
          <div className="cs-welcome-actions">
            <button
              className="btn primary big"
              onClick={() => {
                markIsaSeen();
                setStep('prog');
              }}
            >
              Оставить стандартные и писать программы →
            </button>
            <button className="btn big" onClick={markIsaSeen}>Настроить команды самому</button>
          </div>
        </div>
      )}

      <div className="cs-isa">
        <aside className="cs-isa-list">
          <header>
            <h3>Набор команд · {isa.length}</h3>
            <div className="tb-spacer" />
            <button className="btn small" onClick={() => setShowCatalog((v) => !v)}>{showCatalog ? 'Скрыть каталог' : '＋ Из каталога'}</button>
            <button className="btn small" onClick={() => addBlank()}>＋ Своя</button>
          </header>
          <table className="cs-table">
            <thead>
              <tr><th>Код</th><th>Команда</th><th>Операнды</th><th /></tr>
            </thead>
            <tbody>
              {sorted.map(({ inst: it, idx }) => {
                const bad = issues.some((x) => x.level === 'error' && x.where === it.mnemonic);
                return (
                  <tr key={idx} className={`${idx === cur ? 'on' : ''} ${bad ? 'bad' : ''}`} onClick={() => setSel(idx)}>
                    <td className="mono">{hexOf(it.opcode, Math.ceil(spec.opcodeBits / 4))}</td>
                    <td><b>{it.mnemonic}</b></td>
                    <td className="dim mono">{it.format || '—'}</td>
                    <td className="dim">{bad ? '✕' : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <OpcodeMap spec={spec} isa={isa} onPick={(op, idx) => (idx >= 0 ? setSel(idx) : addBlank(op))} />
          <div className="cs-list-actions">
            <button
              className="btn small danger"
              onClick={async () => {
                if (isaCustom && !(await confirmDialog('Вернуть стандартный набор?', { message: 'Ваши инструкции будут заменены набором по умолчанию для текущих характеристик.', okLabel: 'Заменить', danger: true }))) return;
                const dropped = rebuildIsa();
                setSel(0);
                notify(dropped.length ? `Набор пересобран, не поместилось: ${dropped.length}` : 'Стандартный набор восстановлен');
              }}
            >
              Стандартный набор
            </button>
          </div>
        </aside>

        <div className="cs-isa-main">
          {showCatalog && <Catalog spec={spec} onAdd={addFromTemplate} />}
          {inst ? (
            <InstructionEditor key={cur} spec={spec} inst={inst} onChange={(p) => update(cur, p)} onDelete={() => remove(cur)} isa={isa} />
          ) : (
            <p className="hint">Набор пуст. Добавьте инструкцию из каталога или создайте свою.</p>
          )}
          <Section title="Проверка набора" aside={<span className={errCount ? 'bad-text' : 'dim'}>{errCount ? `ошибок: ${errCount}` : 'ошибок нет'}</span>}>
            <IssueList issues={issues} empty="Все инструкции корректны" />
          </Section>
        </div>
      </div>
      <div className="cs-footer">
        <button className="btn" onClick={() => setStep('spec')}>← Характеристики</button>
        <div className="tb-spacer" />
        <button className="btn primary big" disabled={errCount > 0} onClick={() => setStep('asm')}>Далее: ассемблер →</button>
      </div>
    </div>
  );
}

// ───────────── Карта кодов операций ─────────────

function OpcodeMap({ spec, isa, onPick }: { spec: ComputerSpec; isa: Instruction[]; onPick: (op: number, idx: number) => void }) {
  const total = 2 ** spec.opcodeBits;
  if (total > 128) return <p className="hint">Кодов операции: {total}, занято {isa.length}.</p>;
  const byOp = new Map(isa.map((i, idx) => [i.opcode, { i, idx }]));
  const digits = Math.ceil(spec.opcodeBits / 4);
  return (
    <div className="cs-opmap" aria-label="Карта кодов операций">
      <div className="dim">Карта кодов операций ({isa.length}/{total})</div>
      <div className="cs-opgrid">
        {Array.from({ length: total }, (_, op) => {
          const e = byOp.get(op);
          return (
            <button key={op} className={`cs-op ${e ? 'used' : 'free'}`} title={e ? `${e.i.mnemonic} — ${e.i.description}` : `Код ${op} свободен — создать инструкцию`} onClick={() => onPick(op, e ? e.idx : -1)}>
              <small>{hexOf(op, digits)}</small>
              <span>{e ? e.i.mnemonic : '+'}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ───────────── Каталог шаблонов ─────────────

function Catalog({ spec, onAdd }: { spec: ComputerSpec; onAdd: (t: InstrTemplate, p: Record<string, string>) => void }) {
  const [all, setAll] = useState(false);
  const [params, setParams] = useState<Record<string, Record<string, string>>>({});
  const list = availableTemplates(spec);
  const groups = [...new Set(list.map((x) => x.template.group))];
  return (
    <Section
      title="Каталог функционала"
      aside={
        <label className="check small">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> показать недоступные
        </label>
      }
    >
      <p className="hint">Готовые «кирпичики» учитывают ваши характеристики: например, переход «если перенос» появится, только если выбран флаг C.</p>
      {groups.map((g) => (
        <div key={g} className="cs-cat-group">
          <h4>{g}</h4>
          <div className="cs-cat">
            {list
              .filter((x) => x.template.group === g && (all || !x.reason))
              .map(({ template: t, reason }) => {
                const ps = t.params?.(spec) ?? [];
                const val = params[t.id] ?? {};
                return (
                  <div key={t.id} className={`cs-cat-item ${reason ? 'off' : ''}`}>
                    <b>{t.name}</b>
                    <code className="dim">{t.format(spec) || '—'}</code>
                    {ps.map((p) => (
                      <select key={p.id} value={val[p.id] ?? p.options[0]?.value ?? ''} onChange={(e) => setParams({ ...params, [t.id]: { ...val, [p.id]: e.target.value } })} aria-label={p.label}>
                        {p.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    ))}
                    {reason ? <small className="dim">{reason}</small> : <button className="btn small" onClick={() => onAdd(t, { ...Object.fromEntries(ps.map((p) => [p.id, p.options[0]?.value ?? ''])), ...val })}>Добавить</button>}
                  </div>
                );
              })}
          </div>
        </div>
      ))}
    </Section>
  );
}

// ───────────── Редактор одной инструкции ─────────────

function InstructionEditor({ spec, inst, isa, onChange, onDelete }: { spec: ComputerSpec; inst: Instruction; isa: Instruction[]; onChange: (p: Partial<Instruction>) => void; onDelete: () => void }) {
  const fields = parseFormat(inst.format).fields;
  const lay = layoutOf(inst.format, spec);
  const blockMode = !!inst.blocks;
  const analysis = useMemo(() => analyzeRtl(inst.code, spec, fields), [inst.code, spec, inst.format]);
  const availableFields = FIELD_NAMES.filter((f) => !(spec.arch === 'accumulator' && (f === 'rd' || f === 'rs' || f === 'rt')));

  const setFormat = (list: FieldName[]) => onChange({ format: list.join(',') });
  const toggleField = (f: FieldName) => setFormat(fields.includes(f) ? fields.filter((x) => x !== f) : [...fields, f]);
  const move = (i: number, d: number) => {
    const next = [...fields];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setFormat(next);
  };
  const setBlocks = (blocks: Block[]) => onChange({ blocks, code: blocksToRtl(blocks), pseudo: blocksToPseudo(blocks) });
  const toRtlMode = () => onChange({ blocks: undefined });
  const toBlockMode = async () => {
    if (inst.code.trim() && !(await confirmDialog('Перейти к конструктору?', { message: 'Текущий RTL-код будет заменён пустым набором блоков.', okLabel: 'Заменить код', danger: true }))) return;
    setBlocks([{ kind: 'nop' }]);
  };
  const dup = isa.filter((i) => i.mnemonic.toUpperCase() === inst.mnemonic.toUpperCase()).length > 1;

  return (
    <Section
      title={`Инструкция ${inst.mnemonic || '…'}`}
      aside={<button className="btn small danger" onClick={onDelete}>Удалить</button>}
    >
      <div className="cs-form-row">
        <label className="field">
          <span>Мнемоника</span>
          <input className={dup ? 'bad' : ''} value={inst.mnemonic} onChange={(e) => onChange({ mnemonic: e.target.value.replace(/[^A-Za-z0-9_]/g, '').toUpperCase() })} spellCheck={false} />
        </label>
        <label className="field">
          <span>Код операции ({spec.opcodeBits} бит)</span>
          <input type="number" min={0} max={2 ** spec.opcodeBits - 1} value={inst.opcode} onChange={(e) => onChange({ opcode: Math.floor(Number(e.target.value)) })} />
        </label>
        <label className="field">
          <span>Тактов</span>
          <input type="number" min={1} max={16} value={inst.cycles} onChange={(e) => onChange({ cycles: Math.max(1, Math.floor(Number(e.target.value)) || 1) })} />
        </label>
      </div>
      <label className="field">
        <span>Описание</span>
        <input value={inst.description} onChange={(e) => onChange({ description: e.target.value })} />
      </label>

      <div className="field">
        <span>Операнды (порядок = порядок в ассемблере и в слове)</span>
        <div className="chips">
          {availableFields.map((f) => (
            <button key={f} className={`chip ${fields.includes(f) ? 'on' : ''}`} title={FIELD_DESC[f]} onClick={() => toggleField(f)} aria-pressed={fields.includes(f)}>
              {f}
            </button>
          ))}
        </div>
        {fields.length > 1 && (
          <div className="cs-order">
            {fields.map((f, i) => (
              <span key={f} className="cs-order-item">
                <button className="btn small" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`${f} влево`}>◀</button>
                <b>{f}</b>
                <button className="btn small" onClick={() => move(i, 1)} disabled={i === fields.length - 1} aria-label={`${f} вправо`}>▶</button>
              </span>
            ))}
          </div>
        )}
        <BitBar spec={spec} lay={lay} />
        {lay.error && <small className="bad-text">{lay.error}</small>}
      </div>

      <div className="field">
        <span>Функционал</span>
        <div className="seg" role="group" aria-label="Режим описания">
          <button className={blockMode ? 'on' : ''} onClick={() => !blockMode && toBlockMode()}>Конструктор</button>
          <button className={!blockMode ? 'on' : ''} onClick={() => blockMode && toRtlMode()}>Код RTL</button>
        </div>
      </div>

      {blockMode ? (
        <BlockBuilder spec={spec} fields={fields} blocks={inst.blocks!} onChange={setBlocks} />
      ) : (
        <>
          <label className="field">
            <span>Код (язык RTL, см. справку во вкладке «ИИ и документация»)</span>
            <textarea className="mono cs-code" rows={5} value={inst.code} onChange={(e) => onChange({ code: e.target.value })} spellCheck={false} />
          </label>
          <label className="field">
            <span>Псевдокод для человека</span>
            <input value={inst.pseudo} onChange={(e) => onChange({ pseudo: e.target.value })} />
          </label>
        </>
      )}

      <div className="cs-preview">
        <div><span className="dim">Псевдокод</span><p>{inst.pseudo || '—'}</p></div>
        <div><span className="dim">RTL</span><pre className="mono">{inst.code || '—'}</pre></div>
      </div>
      {analysis.errors.length > 0 && (
        <ul className="issues">
          {analysis.errors.map((e, i) => (
            <li key={i} className="error"><b>✕</b><span><em>строка {e.line}: </em>{e.message}</span></li>
          ))}
        </ul>
      )}
      <Tester spec={spec} inst={inst} fields={fields} />
    </Section>
  );
}

function BitBar({ spec, lay }: { spec: ComputerSpec; lay: ReturnType<typeof layoutOf> }) {
  const free = Math.max(0, spec.instrBits - lay.usedBits);
  const over = lay.usedBits > spec.instrBits;
  const segs: { label: string; bits: number; cls: string }[] = [{ label: 'код', bits: spec.opcodeBits, cls: 'op' }];
  for (const f of lay.fields) segs.push({ label: f.name, bits: f.bits, cls: 'fld' });
  if (free > 0) segs.push({ label: 'не исп.', bits: free, cls: 'free' });
  return (
    <div className={`cs-bitbar ${over ? 'over' : ''}`} role="img" aria-label={`Слово ${spec.instrBits} бит: занято ${lay.usedBits}`}>
      {segs.map((s, i) => (
        <div key={i} className={s.cls} style={{ flex: `${s.bits} 0 0`, minWidth: s.bits ? 22 : 0 }} title={`${s.label}: ${s.bits} бит`}>
          <span>{s.label}</span>
          <small>{s.bits}</small>
        </div>
      ))}
      <em className="dim">{lay.usedBits}/{spec.instrBits} бит{over ? ` — не помещается: нужно ${lay.usedBits} бит` : ''}</em>
    </div>
  );
}

// ───────────── Конструктор блоков ─────────────

const KINDS: { kind: Block['kind']; label: string }[] = [
  { kind: 'alu', label: 'Вычислить (АЛУ)' },
  { kind: 'move', label: 'Копировать значение' },
  { kind: 'load', label: 'Прочитать из памяти' },
  { kind: 'store', label: 'Записать в память' },
  { kind: 'jump', label: 'Перейти' },
  { kind: 'cmp', label: 'Сравнить (только флаги)' },
  { kind: 'push', label: 'Положить в стек' },
  { kind: 'pop', label: 'Снять со стека' },
  { kind: 'call', label: 'Вызвать подпрограмму' },
  { kind: 'ret', label: 'Вернуться из подпрограммы' },
  { kind: 'skip', label: 'Пропустить следующую' },
  { kind: 'halt', label: 'Остановить процессор' },
  { kind: 'nop', label: 'Ничего' },
];

function newBlock(kind: Block['kind'], spec: ComputerSpec, ch: ReturnType<typeof operandChoices>): Block {
  const dst = ch.dst[0] ?? 'A';
  const src = ch.src[0] ?? '0';
  switch (kind) {
    case 'alu': {
      const op = spec.aluOps[0] ?? 'ADD';
      return { kind, op, dst, a: dst, b: UNARY.includes(op) ? undefined : src, flags: spec.flags.length > 0 };
    }
    case 'move': return { kind, dst, src };
    case 'load': return { kind, dst, addr: ch.addr[0] ?? '0' };
    case 'store': return { kind, addr: ch.addr[0] ?? '0', src };
    case 'jump': return { kind, target: ch.target[0] ?? '0', cond: 'always' };
    case 'cmp': return { kind, a: dst, b: src };
    case 'push': return { kind, src };
    case 'pop': return { kind, dst };
    case 'call': return { kind, target: ch.target[0] ?? '0' };
    case 'skip': return { kind, cond: 'always' };
    case 'ret': return { kind };
    case 'halt': return { kind };
    default: return { kind: 'nop' };
  }
}

function Pick({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  const opts = options.includes(value) ? options : [value, ...options];
  return (
    <label className="cs-pick">
      <small>{label}</small>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {opts.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}

function condOptions(spec: ComputerSpec): JumpCond[] {
  const all: JumpCond[] = ['always', 'Z', 'NZ', 'C', 'NC', 'N', 'NN', 'V', 'NV'];
  return all.filter((c) => c === 'always' || spec.flags.includes(c.replace(/^N(?=[ZCNV])/, '') as 'Z' | 'C' | 'N' | 'V'));
}

function BlockBuilder({ spec, fields, blocks, onChange }: { spec: ComputerSpec; fields: string[]; blocks: Block[]; onChange: (b: Block[]) => void }) {
  const ch = operandChoices(spec, fields);
  const [adding, setAdding] = useState<Block['kind']>('alu');
  const patch = (i: number, p: Partial<Block>) => onChange(blocks.map((b, k) => (k === i ? ({ ...b, ...p } as Block) : b)));
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const conds = condOptions(spec);
  const srcAddr = ch.addr.length ? ch.addr : ['0'];
  return (
    <div className="cs-blocks">
      {blocks.map((b, i) => (
        <div key={i} className={`cs-block k-${b.kind}`}>
          <span className="cs-block-n">{i + 1}</span>
          <b className="cs-block-title">{KINDS.find((k) => k.kind === b.kind)?.label}</b>
          <div className="cs-block-fields">
            {b.kind === 'alu' && (
              <>
                <Pick label="операция" value={b.op} options={spec.aluOps} onChange={(v) => patch(i, { op: v as typeof b.op, b: UNARY.includes(v) ? undefined : b.b ?? ch.src[0] ?? '0' })} />
                <Pick label="результат" value={b.dst} options={ch.dst} onChange={(v) => patch(i, { dst: v })} />
                <Pick label="операнд 1" value={b.a} options={ch.src} onChange={(v) => patch(i, { a: v })} />
                {!UNARY.includes(b.op) && <Pick label="операнд 2" value={b.b ?? '0'} options={ch.src} onChange={(v) => patch(i, { b: v })} />}
                {spec.flags.length > 0 && (
                  <label className="check small"><input type="checkbox" checked={b.flags} onChange={(e) => patch(i, { flags: e.target.checked })} /> обновить флаги</label>
                )}
              </>
            )}
            {b.kind === 'move' && (
              <>
                <Pick label="куда" value={b.dst} options={ch.dst} onChange={(v) => patch(i, { dst: v })} />
                <Pick label="откуда" value={b.src} options={ch.src} onChange={(v) => patch(i, { src: v })} />
              </>
            )}
            {b.kind === 'load' && (
              <>
                <Pick label="куда" value={b.dst} options={ch.dst} onChange={(v) => patch(i, { dst: v })} />
                <Pick label="адрес" value={b.addr} options={srcAddr} onChange={(v) => patch(i, { addr: v })} />
              </>
            )}
            {b.kind === 'store' && (
              <>
                <Pick label="адрес" value={b.addr} options={srcAddr} onChange={(v) => patch(i, { addr: v })} />
                <Pick label="что" value={b.src} options={ch.src} onChange={(v) => patch(i, { src: v })} />
              </>
            )}
            {b.kind === 'jump' && (
              <>
                <Pick label="условие" value={b.cond} options={conds} onChange={(v) => patch(i, { cond: v as JumpCond })} />
                <Pick label="куда" value={b.target} options={ch.target.length ? ch.target : ['0']} onChange={(v) => patch(i, { target: v })} />
                <label className="check small"><input type="checkbox" checked={!!b.relative} onChange={(e) => patch(i, { relative: e.target.checked })} /> от текущего адреса</label>
              </>
            )}
            {b.kind === 'cmp' && (
              <>
                <Pick label="первое" value={b.a} options={ch.src} onChange={(v) => patch(i, { a: v })} />
                <Pick label="второе" value={b.b} options={ch.src} onChange={(v) => patch(i, { b: v })} />
              </>
            )}
            {b.kind === 'push' && <Pick label="что" value={b.src} options={ch.src} onChange={(v) => patch(i, { src: v })} />}
            {b.kind === 'pop' && <Pick label="куда" value={b.dst} options={ch.dst} onChange={(v) => patch(i, { dst: v })} />}
            {b.kind === 'call' && <Pick label="куда" value={b.target} options={ch.target.length ? ch.target : ['0']} onChange={(v) => patch(i, { target: v })} />}
            {b.kind === 'skip' && <Pick label="условие" value={b.cond} options={conds} onChange={(v) => patch(i, { cond: v as JumpCond })} />}
          </div>
          <div className="cs-block-tools">
            <button className="btn small" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Выше">▲</button>
            <button className="btn small" onClick={() => move(i, 1)} disabled={i === blocks.length - 1} aria-label="Ниже">▼</button>
            <button className="btn small danger" onClick={() => onChange(blocks.filter((_, k) => k !== i))} aria-label="Удалить блок">✕</button>
          </div>
          <small className="dim cs-block-pseudo">{blocksToPseudo([b])}</small>
        </div>
      ))}
      <div className="cs-block-add">
        <select value={adding} onChange={(e) => setAdding(e.target.value as Block['kind'])} aria-label="Тип нового блока">
          {KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
        </select>
        <button className="btn small" onClick={() => onChange([...blocks, newBlock(adding, spec, ch)])}>＋ Добавить блок</button>
        {blocks.length === 0 && <small className="dim">Пустая инструкция ничего не делает</small>}
      </div>
      {spec.aluOps.length === 0 && <small className="bad-text">В характеристиках не выбрано ни одной операции АЛУ.</small>}
    </div>
  );
}

// ───────────── Проверка инструкции на примере ─────────────

function Tester({ spec, inst, fields }: { spec: ComputerSpec; inst: Instruction; fields: FieldName[] }) {
  const [open, setOpen] = useState(false);
  const [vals, setVals] = useState<Record<string, number>>({});
  const [regs, setRegs] = useState<number[]>([]);
  const [flagsOn, setFlagsOn] = useState<Record<string, boolean>>({});
  const [result, setResult] = useState<string[] | null>(null);
  const mask = 2 ** spec.dataBits - 1;
  const run = () => {
    const { prog, errors } = parseRtl(inst.code);
    if (errors.length) return setResult(['В коде есть ошибки — исправьте их выше.']);
    const m = new Machine(spec, [{ ...inst }], [0]);
    const env = m.env;
    for (let i = 0; i < spec.regCount; i++) env.R[i] = (regs[i] ?? 0) & mask;
    for (const f of spec.flags) env.flags[f] = flagsOn[f] ? 1 : 0;
    env.pc = 5 & env.pcMask;
    env.nextPc = null;
    env.fields = {};
    for (const f of fields) {
      const bits = layoutOf(inst.format, spec).fields.find((x) => x.name === f)!.bits;
      env.fields[f] = f === 'off' ? vals[f] ?? 0 : (vals[f] ?? 0) & (2 ** bits - 1);
    }
    const before = { R: [...env.R], flags: { ...env.flags }, sp: env.sp };
    const writes: string[] = [];
    const origWrite = env.write;
    env.write = (a, v) => {
      writes.push(`M[${a}] ← ${v}`);
      origWrite(a, v);
    };
    try {
      execProgram(prog, env);
    } catch (e) {
      return setResult([`Ошибка выполнения: ${(e as Error).message}`]);
    }
    const out: string[] = [];
    env.R.forEach((v, i) => v !== before.R[i] && out.push(`${spec.arch === 'accumulator' ? 'A' : `r${i}`}: ${before.R[i]} → ${v}`));
    for (const f of spec.flags) if (env.flags[f] !== before.flags[f]) out.push(`${f}: ${before.flags[f]} → ${env.flags[f]}`);
    if (env.sp !== before.sp) out.push(`SP: ${before.sp} → ${env.sp}`);
    out.push(...writes);
    if (env.nextPc !== null) out.push(`PC: ${5} → ${env.nextPc}`);
    if (env.halted) out.push('Процессор остановлен');
    setResult(out.length ? out : ['Состояние не изменилось']);
  };
  return (
    <div className="cs-tester">
      <button className="btn small" onClick={() => setOpen((v) => !v)}>{open ? '▾' : '▸'} Проверить инструкцию на примере</button>
      {open && (
        <div className="cs-tester-body">
          <p className="hint">Задайте значения операндов и регистров — симулятор выполнит только эту инструкцию (она «стоит» по адресу 5) и покажет, что изменилось.</p>
          <div className="cs-tester-grid">
            {fields.map((f) => (
              <label key={f} className="field">
                <span>{f}</span>
                <input type="number" value={vals[f] ?? 0} onChange={(e) => setVals({ ...vals, [f]: Math.floor(Number(e.target.value)) || 0 })} />
              </label>
            ))}
            {Array.from({ length: spec.regCount }, (_, i) => (
              <label key={i} className="field">
                <span>{spec.arch === 'accumulator' ? 'A' : `r${i}`}</span>
                <input type="number" value={regs[i] ?? 0} onChange={(e) => setRegs(Object.assign([...regs], { [i]: Math.floor(Number(e.target.value)) || 0 }))} />
              </label>
            ))}
            {spec.flags.map((f) => (
              <label key={f} className="check"><input type="checkbox" checked={!!flagsOn[f]} onChange={(e) => setFlagsOn({ ...flagsOn, [f]: e.target.checked })} /> {f}</label>
            ))}
          </div>
          <button className="btn small primary" onClick={run}>Выполнить</button>
          {result && <ul className="cs-tester-out">{result.map((r, i) => <li key={i} className="mono">{r}</li>)}</ul>}
        </div>
      )}
    </div>
  );
}
